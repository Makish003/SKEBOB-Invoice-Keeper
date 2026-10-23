from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import current_user, require_admin
from app.core.clock import Clock, get_clock
from app.core.db import get_db
from app.core.errors import AppError
from app.models import User
from app.schemas.common import errors
from app.schemas.payments import RecurringPayment, RecurringPaymentCreate, RecurringPaymentList

router = APIRouter(prefix="/recurring-payments", tags=["Регулярные платежи"])


@router.get(
    "",
    response_model=RecurringPaymentList,
    summary="Список регулярных платежей",
    responses=errors(401, 422),
)
def list_recurring_payments(
    include_deleted: bool = Query(False, description="Включить прекращённые (удалённые) платежи"),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
    user: User = Depends(current_user),
) -> RecurringPaymentList:
    raise AppError(501, "Ещё не реализовано")


@router.get(
    "/{payment_id}",
    response_model=RecurringPayment,
    summary="Регулярный платёж по id",
    responses=errors(401, 404),
)
def get_recurring_payment(
    payment_id: int,
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
    user: User = Depends(current_user),
) -> RecurringPayment:
    raise AppError(501, "Ещё не реализовано")


@router.post(
    "",
    response_model=RecurringPayment,
    status_code=201,
    summary="Создание регулярного платежа",
    description=(
        "Создаёт платёж и его периоды. Если срок ближайшего периода не дальше чем через "
        "REMINDER_DAYS_BEFORE дней, напоминание ставится в очередь сразу (FR-19)."
    ),
    responses=errors(401, 403, 422),
)
def create_recurring_payment(
    body: RecurringPaymentCreate,
    request: Request,
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
    admin: User = Depends(require_admin),
) -> RecurringPayment:
    raise AppError(501, "Ещё не реализовано")


@router.delete(
    "/{payment_id}",
    status_code=204,
    summary="Прекращение регулярного платежа",
    description=(
        "Мягкое удаление с сохранением истории: прошлые периоды и оплаты остаются, будущие неоплаченные "
        "периоды удаляются, новые периоды и напоминания не создаются. Повторное удаление → 404."
    ),
    responses=errors(401, 403, 404),
)
def delete_recurring_payment(
    payment_id: int,
    request: Request,
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
    admin: User = Depends(require_admin),
) -> Response:
    raise AppError(501, "Ещё не реализовано")
