"""Очередь напоминаний (PLAN §1.3, ADR-007, ADR-019).

Постановка идемпотентна за счёт UNIQUE(occurrence, channel, kind, remind_on): для upcoming remind_on = срок
(одно напоминание на период), для overdue — день напоминания (не чаще раза в день).
"""

from datetime import date, timedelta

from sqlalchemy import ColumnElement, func, literal, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import (
    Channel,
    OccurrenceStatus,
    PaymentOccurrence,
    RecurringPayment,
    Reminder,
    ReminderKind,
    ReminderStatus,
)

UNIQUE_KEY = "uq_reminders_occurrence_channel_kind_day"


def active_channels(settings: Settings) -> list[Channel]:
    """Основной канал — Telegram, без токена — лог воркера (NFR-9); webhook и email — дополнительно, если настроены."""
    channels = [Channel.telegram if settings.telegram_enabled else Channel.console]
    if settings.webhook_url:
        channels.append(Channel.webhook)
    if settings.smtp_host and settings.email_to:
        channels.append(Channel.email)
    return channels


def _enqueue(
    db: Session,
    channel: Channel,
    kind: ReminderKind,
    remind_on: ColumnElement[date],
    conditions: list[ColumnElement[bool]],
) -> int:
    source = (
        select(
            PaymentOccurrence.id,
            literal(channel, Reminder.__table__.c.channel.type),
            literal(kind, Reminder.__table__.c.kind.type),
            remind_on,
        )
        .join(RecurringPayment, RecurringPayment.id == PaymentOccurrence.recurring_payment_id)
        .where(RecurringPayment.deleted_at.is_(None), PaymentOccurrence.status == OccurrenceStatus.unpaid, *conditions)
    )
    stmt = (
        insert(Reminder)
        .from_select(["occurrence_id", "channel", "kind", "remind_on"], source)
        .on_conflict_do_nothing(constraint=UNIQUE_KEY)
        .returning(Reminder.id)
    )
    return len(db.execute(stmt).all())


def enqueue_due(db: Session, today: date, settings: Settings, *, payment_id: int | None = None) -> int:
    """Ставит pending-напоминания: о сроке в окне REMINDER_DAYS_BEFORE и (если включено) о просрочке.

    Повторный вызов не создаёт дублей: ON CONFLICT DO NOTHING по уникальному ключу.
    """
    scope = [RecurringPayment.id == payment_id] if payment_id is not None else []
    window_end = today + timedelta(days=settings.reminder_days_before)
    created = 0
    for channel in active_channels(settings):
        created += _enqueue(
            db,
            channel,
            ReminderKind.upcoming,
            PaymentOccurrence.due_date,
            [PaymentOccurrence.due_date >= today, PaymentOccurrence.due_date <= window_end, *scope],
        )
        if settings.overdue_reminder_max > 0:
            already = (
                select(func.count())
                .select_from(Reminder)
                .where(
                    Reminder.occurrence_id == PaymentOccurrence.id,
                    Reminder.channel == channel,
                    Reminder.kind == ReminderKind.overdue,
                )
                .correlate(PaymentOccurrence)
                .scalar_subquery()
            )
            created += _enqueue(
                db,
                channel,
                ReminderKind.overdue,
                literal(today, Reminder.__table__.c.remind_on.type),
                [
                    PaymentOccurrence.due_date < today,
                    PaymentOccurrence.due_date >= today - timedelta(days=settings.overdue_reminder_window_days),
                    already < settings.overdue_reminder_max,
                    *scope,
                ],
            )
    return created


def cancel_open_for_payment(db: Session, payment_id: int) -> None:
    occurrence_ids = select(PaymentOccurrence.id).where(PaymentOccurrence.recurring_payment_id == payment_id)
    db.execute(
        update(Reminder)
        .where(
            Reminder.occurrence_id.in_(occurrence_ids),
            Reminder.status.in_([ReminderStatus.pending, ReminderStatus.failed]),
        )
        .values(status=ReminderStatus.cancelled)
    )
