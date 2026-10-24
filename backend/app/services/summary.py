"""Итоги по валютам за интервал сроков (FR-15, FR-B4): общие для REST и Telegram-бота."""

from datetime import date
from decimal import Decimal

from sqlalchemy import and_, case, func, not_, select
from sqlalchemy.orm import Session

from app.models import Currency, OccurrenceStatus, PaymentOccurrence, RecurringPayment
from app.schemas.payments import CurrencySummary

ZERO = Decimal("0.00")


def currency_summaries(
    db: Session, date_from: date, date_to: date, as_of: date, include_deleted: bool = False
) -> list[CurrencySummary]:
    paid_by = and_(PaymentOccurrence.status == OccurrenceStatus.paid, PaymentOccurrence.paid_at <= as_of)
    overdue_by = and_(PaymentOccurrence.due_date < as_of, not_(paid_by))
    due_by = PaymentOccurrence.due_date <= as_of
    amount = PaymentOccurrence.amount
    query = (
        select(
            PaymentOccurrence.currency,
            func.coalesce(func.sum(amount), 0),
            func.coalesce(func.sum(case((paid_by, amount), else_=0)), 0),
            func.coalesce(func.sum(case((overdue_by, amount), else_=0)), 0),
            func.count(),
            func.count().filter(paid_by),
            func.count().filter(overdue_by),
            func.coalesce(func.sum(case((due_by, amount), else_=0)), 0),
            func.count().filter(due_by),
        )
        .join(RecurringPayment, RecurringPayment.id == PaymentOccurrence.recurring_payment_id)
        .where(PaymentOccurrence.due_date >= date_from, PaymentOccurrence.due_date <= date_to)
        .group_by(PaymentOccurrence.currency)
    )
    if not include_deleted:
        query = query.where(RecurringPayment.deleted_at.is_(None))
    rows = {row[0]: row for row in db.execute(query)}

    currencies = []
    for currency in Currency:
        _, total, paid, overdue, count_total, count_paid, count_overdue, due, count_due = rows.get(
            currency, (currency, ZERO, ZERO, ZERO, 0, 0, 0, ZERO, 0)
        )
        currencies.append(
            CurrencySummary(
                currency=currency,
                total=Decimal(total),
                paid=Decimal(paid),
                unpaid=Decimal(total) - Decimal(paid),
                overdue=Decimal(overdue),
                count_total=count_total,
                count_paid=count_paid,
                count_overdue=count_overdue,
                due=Decimal(due),
                count_due=count_due,
            )
        )
    return currencies
