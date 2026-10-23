"""Очередь напоминаний (PLAN §1.3, ADR-007): постановка идемпотентна за счёт UNIQUE(occurrence, channel, kind)."""

from datetime import date, timedelta

from sqlalchemy import literal, select, update
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


def active_channels(settings: Settings) -> list[Channel]:
    """Без Telegram-токена напоминания уходят в лог воркера (NFR-9)."""
    return [Channel.telegram if settings.telegram_enabled else Channel.console]


def enqueue_due(
    db: Session, today: date, settings: Settings, *, payment_id: int | None = None
) -> int:
    """Ставит pending-напоминания для неоплаченных периодов активных платежей со сроком в окне.

    Повторный вызов не создаёт дублей: ON CONFLICT DO NOTHING по UNIQUE(occurrence_id, channel, kind).
    """
    window_end = today + timedelta(days=settings.reminder_days_before)
    created = 0
    for channel in active_channels(settings):
        source = (
            select(
                PaymentOccurrence.id,
                literal(channel, Reminder.__table__.c.channel.type),
                literal(ReminderKind.upcoming, Reminder.__table__.c.kind.type),
            )
            .join(RecurringPayment, RecurringPayment.id == PaymentOccurrence.recurring_payment_id)
            .where(
                RecurringPayment.deleted_at.is_(None),
                PaymentOccurrence.status == OccurrenceStatus.unpaid,
                PaymentOccurrence.due_date >= today,
                PaymentOccurrence.due_date <= window_end,
            )
        )
        if payment_id is not None:
            source = source.where(RecurringPayment.id == payment_id)
        stmt = (
            insert(Reminder)
            .from_select(["occurrence_id", "channel", "kind"], source)
            .on_conflict_do_nothing(constraint="uq_reminders_occurrence_channel_kind")
        )
        created += db.execute(stmt).rowcount or 0
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
