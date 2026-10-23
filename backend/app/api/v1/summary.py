from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.core.clock import Clock, get_clock
from app.core.db import get_db
from app.core.errors import AppError
from app.models import User
from app.schemas.common import errors
from app.schemas.payments import Summary

router = APIRouter(prefix="/payments", tags=["Итоги"])


@router.get(
    "/summary",
    response_model=Summary,
    summary="Итоговые суммы по валютам",
    description=(
        "Суммы по периодам со сроком в интервале [due_from, due_to] (по умолчанию — текущий месяц), отдельно "
        "по RUB, USD, EUR, без конвертации. `as_of` — дата, на которую считаются оплачено/просрочено "
        "(по умолчанию сегодня)."
    ),
    responses=errors(401, 422),
)
def payments_summary(
    due_from: date | None = Query(None),
    due_to: date | None = Query(None),
    as_of: date | None = Query(None),
    include_deleted: bool = Query(False, description="Учитывать периоды прекращённых платежей"),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
    user: User = Depends(current_user),
) -> Summary:
    raise AppError(501, "Ещё не реализовано")
