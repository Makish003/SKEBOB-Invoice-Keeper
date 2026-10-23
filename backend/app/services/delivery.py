"""Конвейер напоминаний (PLAN §1.3, ADR-007).

tick(): периоды → постановка pending (идемпотентно, UNIQUE в БД).
deliver_pending(): claim одной строки FOR UPDATE SKIP LOCKED → перепроверка → send → sent | failed с backoff.
"""

import logging
from collections.abc import Mapping
from datetime import date, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.models import Channel, OccurrenceStatus, PaymentOccurrence, RecurringPayment, Reminder, ReminderStatus
from app.services.notifiers.base import Notifier, ReminderMessage
from app.services.occurrences import ensure_all
from app.services.reminders import enqueue_due

log = logging.getLogger("app.delivery")

BACKOFF_BASE_SECONDS = 30
BACKOFF_MAX = timedelta(hours=1)
MAX_PER_RUN = 50


def backoff(attempts: int) -> timedelta:
    return min(timedelta(seconds=BACKOFF_BASE_SECONDS * 2 ** max(attempts - 1, 0)), BACKOFF_MAX)


def tick(db: Session, today: date, settings: Settings) -> int:
    """Шаги 1–2: материализовать периоды и поставить напоминания со сроком в окне."""
    ensure_all(db, today, settings.generation_horizon_days)
    queued = enqueue_due(db, today, settings)
    db.commit()
    if queued:
        log.info("Queued %s reminder(s)", queued)
    return queued


def _claim(db: Session, now: datetime, max_attempts: int) -> Reminder | None:
    return db.scalar(
        select(Reminder)
        .where(
            or_(Reminder.status == ReminderStatus.pending, Reminder.status == ReminderStatus.failed),
            Reminder.next_attempt_at <= now,
            Reminder.attempts < max_attempts,
        )
        .order_by(Reminder.next_attempt_at, Reminder.id)
        .limit(1)
        .with_for_update(skip_locked=True)
    )


def _cancel_reason(occ: PaymentOccurrence, payment: RecurringPayment, today: date) -> str | None:
    if payment.deleted_at is not None:
        return "платёж прекращён"
    if occ.status != OccurrenceStatus.unpaid:
        return "период уже оплачен"
    if occ.due_date < today:
        return "срок прошёл до отправки"
    return None


async def deliver_pending(
    session_factory: sessionmaker[Session],
    today: date,
    settings: Settings,
    notifiers: Mapping[Channel, Notifier],
    *,
    now: datetime,
) -> int:
    """Шаги 3–4. Возвращает число отправленных. Каждое напоминание — в своей транзакции."""
    sent = 0
    for _ in range(MAX_PER_RUN):
        with session_factory() as db:
            reminder = _claim(db, now, settings.reminder_max_attempts)
            if reminder is None:
                return sent
            occ = reminder.occurrence
            payment = db.get(RecurringPayment, occ.recurring_payment_id)
            assert payment is not None
            reason = _cancel_reason(occ, payment, today)
            notifier = notifiers.get(reminder.channel)
            if reason is None and notifier is None:
                reason = f"канал {reminder.channel.value} не настроен"
            if reason is not None:
                reminder.status, reminder.last_error = ReminderStatus.cancelled, reason
                db.commit()
                log.info("Reminder #%s cancelled: %s", reminder.id, reason)
                continue

            assert notifier is not None
            message = ReminderMessage(
                reminder_id=reminder.id,
                occurrence_id=occ.id,
                payment_name=payment.name,
                amount=occ.amount,
                currency=occ.currency.value,
                due_date=occ.due_date,
                days_until_due=(occ.due_date - today).days,
            )
            reminder.attempts += 1
            try:
                reminder.external_id = await notifier.send(message)
            except Exception as exc:  # любая ошибка канала — ретрай, а не падение воркера
                reminder.status = ReminderStatus.failed
                reminder.last_error = str(exc)[:1000]
                reminder.next_attempt_at = now + backoff(reminder.attempts)
                db.commit()
                log.warning("Reminder #%s failed (attempt %s): %s", reminder.id, reminder.attempts, exc)
                continue
            reminder.status, reminder.sent_at, reminder.last_error = ReminderStatus.sent, now, None
            db.commit()
            sent += 1
            log.info("Reminder #%s sent via %s", reminder.id, reminder.channel.value)
    return sent
