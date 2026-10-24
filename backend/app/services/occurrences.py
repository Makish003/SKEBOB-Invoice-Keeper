"""Периоды платежей: материализация (ADR-004), выборка с вычисляемыми полями (ADR-006)."""

from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import Select, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import unprocessable
from app.domain.schedule import planned_occurrences
from app.domain.status import compute_status
from app.models import OccurrenceStatus, PaymentOccurrence, RecurringPayment, Reminder, ReminderStatus, User
from app.schemas.payments import Occurrence, OccurrencePatch, RecurringPaymentRef


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


EARLIEST_PAYMENT_BEFORE_DUE = timedelta(days=366)


def apply_patch(occ: PaymentOccurrence, body: OccurrencePatch, user: User, today: date) -> tuple[str, dict[str, Any]]:
    """Отметка/отмена оплаты, исправление даты, заметка, ссылка на чек (FR-10…FR-14).

    Возвращает (действие для аудита, payload «было/стало»). Срок периода не меняется, просрочка пересчитывается.
    """
    fields = body.model_fields_set
    if not fields:
        raise unprocessable("Нет изменений: передайте status, paid_at, note или receipt_url")
    if "status" in fields and body.status is None:
        raise unprocessable("Поле status не может быть пустым: paid или unpaid")

    before = {"status": occ.status.value, "paid_at": occ.paid_at.isoformat() if occ.paid_at else None}
    new_status = body.status or occ.status

    if "paid_at" in fields:
        if body.paid_at is None:
            if new_status == OccurrenceStatus.paid:
                raise unprocessable("Для оплаченного периода нужна дата оплаты. Чтобы отменить оплату, передайте status=unpaid")
        elif new_status == OccurrenceStatus.unpaid:
            if "status" in fields:
                raise unprocessable("При status=unpaid дату оплаты передавать нельзя: она очищается")
            raise unprocessable("Период не оплачен: чтобы указать дату оплаты, передайте status=paid")
        elif body.paid_at > today:
            raise unprocessable("Дата оплаты не может быть в будущем")
        elif body.paid_at < occ.due_date - EARLIEST_PAYMENT_BEFORE_DUE:
            raise unprocessable("Дата оплаты слишком ранняя: больше чем за год до срока")

    if new_status == OccurrenceStatus.paid:
        if occ.status == OccurrenceStatus.unpaid:
            occ.paid_by_user_id, occ.paid_by_label = user.id, user.display_name
        occ.paid_at = body.paid_at if body.paid_at is not None else (occ.paid_at or today)
    else:
        occ.paid_at, occ.paid_by_user_id, occ.paid_by_label = None, None, None
    occ.status = new_status
    if "note" in fields:
        occ.note = (body.note or "").strip() or None
    if "receipt_url" in fields:
        occ.receipt_url = str(body.receipt_url) if body.receipt_url else None

    after = {"status": occ.status.value, "paid_at": occ.paid_at.isoformat() if occ.paid_at else None}
    if before["status"] != after["status"]:
        action = "occurrence.paid" if new_status == OccurrenceStatus.paid else "occurrence.unpaid"
    elif before["paid_at"] != after["paid_at"]:
        action = "occurrence.paid_at_changed"
    elif "receipt_url" in fields:
        action = "occurrence.receipt_link_changed"
    else:
        action = "occurrence.note_changed"
    return action, {"before": before, "after": after, "due_date": occ.due_date.isoformat()}
