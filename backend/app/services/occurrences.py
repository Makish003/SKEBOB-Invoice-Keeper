"""Периоды платежей: материализация (ADR-004), выборка с вычисляемыми полями (ADR-006)."""

from datetime import date, datetime
from typing import Any

from sqlalchemy import Select, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.domain.schedule import planned_occurrences
from app.domain.status import compute_status
from app.models import PaymentOccurrence, RecurringPayment, Reminder, ReminderStatus
from app.schemas.payments import Occurrence, RecurringPaymentRef


def _planned_rows(payment: RecurringPayment, last_seq: int | None, today: date, horizon_days: int) -> list[dict[str, Any]]:
    planned = planned_occurrences(
        payment.first_due_date,
        payment.anchor_day,
        payment.period,
        today=today,
        horizon_days=horizon_days,
        start_seq=0 if last_seq is None else last_seq + 1,
    )
    return [
        {"recurring_payment_id": payment.id, "seq": seq, "due_date": due, "amount": payment.amount, "currency": payment.currency}
        for seq, due in planned
    ]


def _insert(db: Session, rows: list[dict[str, Any]]) -> int:
    """Идемпотентно: UNIQUE(payment, seq) + ON CONFLICT DO NOTHING."""
    if not rows:
        return 0
    return db.execute(insert(PaymentOccurrence).values(rows).on_conflict_do_nothing()).rowcount or 0


def ensure_for_payment(db: Session, payment: RecurringPayment, today: date, horizon_days: int) -> int:
    """Создаёт недостающие периоды одного платежа."""
    if payment.deleted_at is not None:
        return 0
    last_seq = db.scalar(
        select(func.max(PaymentOccurrence.seq)).where(PaymentOccurrence.recurring_payment_id == payment.id)
    )
    return _insert(db, _planned_rows(payment, last_seq, today, horizon_days))


def ensure_all(db: Session, today: date, horizon_days: int) -> int:
    """Недостающие периоды всех активных платежей: один SELECT, INSERT — только если чего-то не хватает."""
    rows = db.execute(
        select(RecurringPayment, func.max(PaymentOccurrence.seq))
        .outerjoin(PaymentOccurrence, PaymentOccurrence.recurring_payment_id == RecurringPayment.id)
        .where(RecurringPayment.deleted_at.is_(None))
        .group_by(RecurringPayment.id)
    ).all()
    return _insert(db, [row for payment, last_seq in rows for row in _planned_rows(payment, last_seq, today, horizon_days)])


def refresh_periods(db: Session, today: date, horizon_days: int) -> None:
    """Догоняющая материализация для чтения (ADR-021): основной источник — тик воркера; если он отстал
    (смена даты, воркер стоял), чтение само создаёт недостающие периоды. Без изменений — без COMMIT."""
    if ensure_all(db, today, horizon_days):
        db.commit()


def _reminder_sent_at():  # type: ignore[no-untyped-def]
    return (
        select(func.max(Reminder.sent_at))
        .where(Reminder.occurrence_id == PaymentOccurrence.id, Reminder.status == ReminderStatus.sent)
        .correlate(PaymentOccurrence)
        .scalar_subquery()
    )


def occurrence_query() -> Select[tuple[PaymentOccurrence, RecurringPayment, datetime | None]]:
    return select(PaymentOccurrence, RecurringPayment, _reminder_sent_at().label("reminder_sent_at")).join(
        RecurringPayment, RecurringPayment.id == PaymentOccurrence.recurring_payment_id
    )


def to_schema(
    occ: PaymentOccurrence,
    payment: RecurringPayment,
    reminder_sent_at: datetime | None,
    today: date,
    settings: Settings,
) -> Occurrence:
    info = compute_status(occ.due_date, occ.status, occ.paid_at, today, soon_days=settings.reminder_days_before)
    return Occurrence(
        id=occ.id,
        recurring_payment=RecurringPaymentRef(
            id=payment.id, name=payment.name, period=payment.period, is_active=payment.is_active
        ),
        seq=occ.seq,
        due_date=occ.due_date,
        amount=occ.amount,
        currency=occ.currency,
        status=occ.status,
        paid_at=occ.paid_at,
        paid_by_label=occ.paid_by_label,
        note=occ.note,
        is_overdue=info.is_overdue,
        overdue_days=info.overdue_days,
        days_until_due=info.days_until_due,
        display_status=info.display_status,
        reminder_sent_at=reminder_sent_at,
        receipt_url=occ.receipt_url,
        receipt_file_name=occ.receipt_file_name,
        updated_at=occ.updated_at,
    )


def get_occurrence(db: Session, occurrence_id: int, today: date, settings: Settings) -> Occurrence | None:
    row = db.execute(occurrence_query().where(PaymentOccurrence.id == occurrence_id)).first()
    return to_schema(row[0], row[1], row[2], today, settings) if row else None


def next_occurrences(db: Session, today: date, settings: Settings) -> dict[int, Occurrence]:
    """Ближайший период (срок ≥ сегодня) каждого активного платежа — одним запросом (DISTINCT ON)."""
    rows = db.execute(
        occurrence_query()
        .where(RecurringPayment.deleted_at.is_(None), PaymentOccurrence.due_date >= today)
        .order_by(PaymentOccurrence.recurring_payment_id, PaymentOccurrence.due_date)
        .distinct(PaymentOccurrence.recurring_payment_id)
    ).all()
    return {occ.recurring_payment_id: to_schema(occ, payment, sent, today, settings) for occ, payment, sent in rows}
