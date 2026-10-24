from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.core.clock import Clock, get_clock
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import unprocessable
from app.models import User
from app.schemas.common import errors
from app.schemas.payments import Summary, SummaryPeriod
from app.services.occurrences import refresh_periods
from app.services.summary import currency_summaries

router = APIRouter(prefix="/payments", tags=["Итоги"])


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
        "(по умолчанию сегодня): должно быть оплачено — срок ≤ as_of, оплачено — отметка с датой ≤ as_of, просрочено — срок < as_of и не оплачено к as_of."
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

    refresh_periods(db, today, settings.generation_horizon_days)

    currencies = currency_summaries(db, date_from, date_to, as_of_date, include_deleted)
    return Summary(period=SummaryPeriod(**{"from": date_from, "to": date_to}), as_of=as_of_date, currencies=currencies)
