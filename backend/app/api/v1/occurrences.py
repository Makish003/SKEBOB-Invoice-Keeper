from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.core.clock import Clock, get_clock
from app.core.db import get_db
from app.core.errors import AppError
from app.models import Currency, OccurrenceStatus, User
from app.schemas.common import errors
from app.schemas.payments import Occurrence, OccurrenceList, OccurrencePatch

router = APIRouter(prefix="/payment-occurrences", tags=["Периоды оплаты"])

SortField = Literal["due_date", "-due_date", "amount", "-amount", "name", "-name"]


@router.get(
    "",
    response_model=OccurrenceList,
    summary="Список периодов (платежей)",
    description="Все периоды, в т.ч. оплаченные и просроченные. Фильтры комбинируются через И.",
    responses=errors(401, 422),
)
def list_occurrences(
    status: OccurrenceStatus | None = Query(None, description="Статус оплаты"),
    overdue: bool | None = Query(None, description="true — только просроченные, false — без просрочки"),
    currency: Currency | None = Query(None),
    recurring_payment_id: int | None = Query(None),
    due_from: date | None = Query(None, description="Срок не раньше (включительно)"),
    due_to: date | None = Query(None, description="Срок не позже (включительно)"),
    q: str | None = Query(None, max_length=100, description="Поиск по названию"),
    include_deleted: bool = Query(False, description="Включить периоды прекращённых платежей (история)"),
    sort: SortField = Query("due_date"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
    user: User = Depends(current_user),
) -> OccurrenceList:
    raise AppError(501, "Ещё не реализовано")


@router.get(
    "/{occurrence_id}",
    response_model=Occurrence,
    summary="Конкретный период",
    responses=errors(401, 404),
)
def get_occurrence(
    occurrence_id: int,
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
    user: User = Depends(current_user),
) -> Occurrence:
    raise AppError(501, "Ещё не реализовано")


@router.patch(
    "/{occurrence_id}",
    response_model=Occurrence,
    summary="Подтверждение/отмена оплаты, исправление фактической даты",
    description=(
        "Доступно всем авторизованным (FR-14). `status=paid` без `paid_at` → сегодня; `status=unpaid` очищает "
        "`paid_at`; `paid_at` без `status` — исправление даты оплаченного периода; дата в будущем → 422. "
        "Срок периода (`due_date`) не меняется, просрочка пересчитывается."
    ),
    responses=errors(401, 404, 422),
)
def patch_occurrence(
    occurrence_id: int,
    body: OccurrencePatch,
    request: Request,
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
    user: User = Depends(current_user),
) -> Occurrence:
    raise AppError(501, "Ещё не реализовано")
