from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, case, func, not_, select
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.core.clock import Clock, get_clock
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import unprocessable
from app.models import Currency, OccurrenceStatus, PaymentOccurrence, RecurringPayment, User
from app.schemas.common import errors
from app.schemas.payments import CurrencySummary, Summary, SummaryPeriod
from app.services.occurrences import ensure_all

router = APIRouter(prefix="/payments", tags=["Итоги"])

ZERO = Decimal("0.00")


def _month_bounds(today: date) -> tuple[date, date]:
    first = today.replace(day=1)
    next_month = (first + timedelta(days=32)).replace(day=1)
    return first, next_month - timedelta(days=1)


@router.get(
    "/summary",
    response_model=Summary,
    summary="Итоговые суммы по валютам",
    description=(
        "Суммы по периодам со сроком в интервале [due_from, due_to] (по умолчанию — текущий месяц), отдельно "
        "по RUB, USD, EUR, без конвертации. `as_of` — дата, на которую считаются оплачено/просрочено "
        "(по умолчанию сегодня): оплачено — отметка с датой ≤ as_of, просрочено — срок < as_of и не оплачено к as_of."
    ),
    responses=errors(401, 422),
)
def payments_summary(
    due_from: date | None = Query(None, description="Начало интервала сроков (включительно)"),
    due_to: date | None = Query(None, description="Конец интервала сроков (включительно)"),
    as_of: date | None = Query(None, description="Дата, на которую считаются итоги"),
    include_deleted: bool = Query(False, description="Учитывать периоды прекращённых платежей"),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
    user: User = Depends(current_user),
) -> Summary:
    settings, today = get_settings(), clock.today()
    month_start, month_end = _month_bounds(today)
    date_from, date_to, as_of_date = due_from or month_start, due_to or month_end, as_of or today
    if date_from > date_to:
        raise unprocessable("Начало интервала позже конца: проверьте due_from и due_to")

    ensure_all(db, today, settings.generation_horizon_days)
    db.commit()

    paid_by = and_(PaymentOccurrence.status == OccurrenceStatus.paid, PaymentOccurrence.paid_at <= as_of_date)
    overdue_by = and_(PaymentOccurrence.due_date < as_of_date, not_(paid_by))
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
        _, total, paid, overdue, count_total, count_paid, count_overdue = rows.get(
            currency, (currency, ZERO, ZERO, ZERO, 0, 0, 0)
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
            )
        )
    return Summary(period=SummaryPeriod(**{"from": date_from, "to": date_to}), as_of=as_of_date, currencies=currencies)
