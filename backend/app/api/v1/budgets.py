"""Бюджет на месяц и год по валютам (FR-B9): план против запланированных платежей и оплат."""

import calendar
from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, case, delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.api.deps import client_ip, current_user, require_admin
from app.core.clock import Clock, get_clock
from app.core.config import get_settings
from app.core.db import get_db
from app.models import Budget, Currency, OccurrenceStatus, PaymentOccurrence, RecurringPayment, User
from app.schemas.common import Money, errors
from app.services import audit
from app.services.occurrences import refresh_periods

router = APIRouter(prefix="/budgets", tags=["Бюджет"])

Year = Annotated[int, Field(ge=2000, le=2100)]
Month = Annotated[int, Field(ge=1, le=12)]


class BudgetLine(BaseModel):
    budget: Money | None = Field(description="Плановые расходы; null — бюджет не задан")
    planned: Money = Field(description="Сумма периодов со сроком в этом месяце/году")
    paid: Money = Field(description="Из них оплачено")


class CurrencyBudget(BaseModel):
    currency: Currency
    month: BudgetLine
    year: BudgetLine


class BudgetOverview(BaseModel):
    year: int
    month: int
    currencies: list[CurrencyBudget]


class BudgetSet(BaseModel):
    model_config = ConfigDict(extra="forbid")

    year: Year
    month: Month | None = Field(default=None, description="1–12 — бюджет месяца, null — бюджет года")
    currency: Currency
    amount: Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2)] | None = Field(
        description="Сумма; null — удалить бюджет", examples=["150000.00"]
    )


def _sums(db: Session, start: date, end: date) -> dict[Currency, tuple[Decimal, Decimal]]:
    paid = PaymentOccurrence.status == OccurrenceStatus.paid
    rows = db.execute(
        select(
            PaymentOccurrence.currency,
            func.coalesce(func.sum(PaymentOccurrence.amount), 0),
            func.coalesce(func.sum(case((paid, PaymentOccurrence.amount), else_=0)), 0),
        )
        .join(RecurringPayment, RecurringPayment.id == PaymentOccurrence.recurring_payment_id)
        .where(and_(PaymentOccurrence.due_date >= start, PaymentOccurrence.due_date <= end))
        .group_by(PaymentOccurrence.currency)
    )
    return {currency: (Decimal(planned), Decimal(paid_sum)) for currency, planned, paid_sum in rows}


@router.get(
    "/overview",
    response_model=BudgetOverview,
    summary="Бюджет: план и факт по валютам",
    description="Бюджет месяца и года по каждой валюте против суммы периодов со сроком в этом месяце/году и оплат.",
    responses=errors(401, 422),
)
def budget_overview(
    year: int | None = Query(None, ge=2000, le=2100),
    month: int | None = Query(None, ge=1, le=12),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
    user: User = Depends(current_user),
) -> BudgetOverview:
    today = clock.today()
    year, month = year or today.year, month or today.month
    refresh_periods(db, today, get_settings().generation_horizon_days)
    month_sums = _sums(db, date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1]))
    year_sums = _sums(db, date(year, 1, 1), date(year, 12, 31))
    budgets = {
        (b.currency, b.month): b.amount
        for b in db.scalars(select(Budget).where(Budget.year == year, (Budget.month == month) | Budget.month.is_(None)))
    }
    zero = (Decimal("0"), Decimal("0"))
    return BudgetOverview(
        year=year,
        month=month,
        currencies=[
            CurrencyBudget(
                currency=currency,
                month=BudgetLine(budget=budgets.get((currency, month)), planned=month_sums.get(currency, zero)[0], paid=month_sums.get(currency, zero)[1]),
                year=BudgetLine(budget=budgets.get((currency, None)), planned=year_sums.get(currency, zero)[0], paid=year_sums.get(currency, zero)[1]),
            )
            for currency in Currency
        ],
    )


@router.put(
    "",
    response_model=BudgetSet,
    summary="Задать или удалить бюджет",
    description="Создаёт или меняет бюджет месяца (month 1–12) или года (month = null) в валюте; amount = null удаляет.",
    responses=errors(401, 403, 422),
)
def set_budget(
    body: BudgetSet,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> BudgetSet:
    match = (Budget.year == body.year, Budget.currency == body.currency)
    month_match = Budget.month.is_(None) if body.month is None else Budget.month == body.month
    if body.amount is None:
        db.execute(delete(Budget).where(*match, month_match))
    else:
        existing = db.scalar(select(Budget).where(*match, month_match).with_for_update())
        if existing:
            existing.amount = body.amount
        else:
            db.execute(insert(Budget).values(year=body.year, month=body.month, currency=body.currency, amount=body.amount))
    audit.record(
        db,
        "budget.set" if body.amount is not None else "budget.deleted",
        actor=admin,
        entity="budget",
        payload={"year": body.year, "month": body.month, "currency": body.currency.value, "amount": f"{body.amount:.2f}" if body.amount else None},
        ip=client_ip(request),
    )
    db.commit()
    return body
