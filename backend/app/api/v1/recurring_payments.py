from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, current_user, require_admin
from app.core.clock import Clock, get_clock
from app.core.config import Settings, get_settings
from app.core.db import get_db
from app.core.errors import not_found, unprocessable
from app.models import OccurrenceStatus, PaymentOccurrence, RecurringPayment as PaymentModel, User
from app.schemas.common import errors
from app.schemas.payments import (
    Occurrence,
    RecurringPayment,
    RecurringPaymentCreate,
    RecurringPaymentList,
    RecurringPaymentPatch,
)
from app.services import audit
from app.services.payments import update_payment
from app.services.occurrences import ensure_for_payment, next_occurrences, occurrence_query, refresh_periods, to_schema
from app.services.reminders import cancel_open_for_payment, enqueue_due

router = APIRouter(prefix="/recurring-payments", tags=["Регулярные платежи"])

MAX_YEARS_FROM_TODAY = 10


def _next_occurrence(db: Session, payment: PaymentModel, today: date, settings: Settings) -> Occurrence | None:
    if not payment.is_active:
        return None
    row = db.execute(
        occurrence_query()
        .where(PaymentOccurrence.recurring_payment_id == payment.id, PaymentOccurrence.due_date >= today)
        .order_by(PaymentOccurrence.due_date)
        .limit(1)
    ).first()
    return to_schema(row[0], row[1], row[2], today, settings) if row else None


def _to_schema(db: Session, payment: PaymentModel, today: date, settings: Settings) -> RecurringPayment:
    return _build(payment, _next_occurrence(db, payment, today, settings))


def _build(payment: PaymentModel, next_occurrence: Occurrence | None) -> RecurringPayment:
    return RecurringPayment(
        id=payment.id,
        name=payment.name,
        amount=payment.amount,
        currency=payment.currency,
        period=payment.period,
        first_due_date=payment.first_due_date,
        description=payment.description,
        is_active=payment.is_active,
        created_at=payment.created_at,
        deleted_at=payment.deleted_at,
        next_occurrence=next_occurrence,
    )


def _get_or_404(db: Session, payment_id: int, *, lock: bool = False) -> PaymentModel:
    payment = db.get(PaymentModel, payment_id, with_for_update=lock)
    if payment is None:
        raise not_found("Регулярный платёж не найден")
    return payment


@router.get(
    "",
    response_model=RecurringPaymentList,
    summary="Список регулярных платежей",
    description="Активные платежи (по умолчанию) или вместе с прекращёнными. Доступно всем авторизованным.",
    responses=errors(401, 422),
)
def list_recurring_payments(
    include_deleted: bool = Query(False, description="Включить прекращённые (удалённые) платежи"),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
    user: User = Depends(current_user),
) -> RecurringPaymentList:
    settings, today = get_settings(), clock.today()
    refresh_periods(db, today, settings.generation_horizon_days)
    query = select(PaymentModel).order_by(PaymentModel.deleted_at.desc().nulls_first(), PaymentModel.name, PaymentModel.id)
    if not include_deleted:
        query = query.where(PaymentModel.deleted_at.is_(None))
    upcoming = next_occurrences(db, today, settings)
    items = [_build(payment, upcoming.get(payment.id) if payment.is_active else None) for payment in db.scalars(query)]
    return RecurringPaymentList(items=items, total=len(items))


@router.get(
    "/{payment_id}",
    response_model=RecurringPayment,
    summary="Регулярный платёж по id",
    description="Платёж (в т.ч. прекращённый) и его ближайший период.",
    responses=errors(401, 404),
)
def get_recurring_payment(
    payment_id: int,
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
    user: User = Depends(current_user),
) -> RecurringPayment:
    return _to_schema(db, _get_or_404(db, payment_id), clock.today(), get_settings())


@router.post(
    "",
    response_model=RecurringPayment,
    status_code=201,
    summary="Создание регулярного платежа",
    description=(
        "Создаёт платёж и его периоды (все периоды с даты ближайшей оплаты, включая прошедшие). Если срок "
        "не дальше чем через REMINDER_DAYS_BEFORE дней, напоминание ставится в очередь сразу (FR-19) и "
        "уходит в течение нескольких секунд."
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
    settings, today = get_settings(), clock.today()
    limit = timedelta(days=365 * MAX_YEARS_FROM_TODAY)
    if not today - limit <= body.first_due_date <= today + limit:
        raise unprocessable(
            f"Дата ближайшей оплаты должна быть в пределах {MAX_YEARS_FROM_TODAY} лет от сегодняшнего дня",
            details=[{"loc": ["body", "first_due_date"], "msg": "out of range", "type": "date_range"}],
        )
    payment = PaymentModel(
        name=body.name,
        amount=body.amount,
        currency=body.currency,
        period=body.period,
        first_due_date=body.first_due_date,
        anchor_day=body.first_due_date.day,
        description=body.description or None,
        created_by=admin.id,
    )
    db.add(payment)
    db.flush()
    ensure_for_payment(db, payment, today, settings.generation_horizon_days)
    queued = enqueue_due(db, today, settings, payment_id=payment.id)
    audit.record(
        db,
        "recurring_payment.created",
        actor=admin,
        entity="recurring_payment",
        entity_id=payment.id,
        payload={
            "name": payment.name,
            "amount": f"{payment.amount:.2f}",
            "currency": payment.currency.value,
            "period": payment.period.value,
            "first_due_date": payment.first_due_date.isoformat(),
            "reminders_queued": queued,
        },
        ip=client_ip(request),
    )
    db.commit()
    return _to_schema(db, payment, today, settings)


@router.patch(
    "/{payment_id}",
    response_model=RecurringPayment,
    summary="Изменение регулярного платежа",
    description=(
        "Название, описание и сумма. Новая сумма применяется к шаблону и к неоплаченным периодам со сроком сегодня или "
        "позже; оплаченные и просроченные периоды сохраняют прежнюю сумму. Валюта и график не меняются. "
        "Прекращённый платёж изменить нельзя (409)."
    ),
    responses=errors(401, 403, 404, 409, 422),
)
def patch_recurring_payment(
    payment_id: int,
    body: RecurringPaymentPatch,
    request: Request,
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
    admin: User = Depends(require_admin),
) -> RecurringPayment:
    today = clock.today()
    payment = _get_or_404(db, payment_id, lock=True)
    result = update_payment(db, payment, body, today)
    if result["changes"]:
        audit.record(
            db,
            "recurring_payment.updated",
            actor=admin,
            entity="recurring_payment",
            entity_id=payment.id,
            payload=result,
            ip=client_ip(request),
        )
    db.commit()
    return _to_schema(db, payment, today, get_settings())


@router.delete(
    "/{payment_id}",
    status_code=204,
    summary="Прекращение регулярного платежа",
    description=(
        "Мягкое удаление с сохранением истории: прошлые периоды и все оплаты остаются (видны с "
        "`include_deleted=true`), будущие неоплаченные периоды удаляются, открытые напоминания отменяются, "
        "новые периоды и напоминания не создаются. Повторное удаление → 404."
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
    payment = _get_or_404(db, payment_id, lock=True)  # параллельный DELETE ждёт и получает 404
    if payment.deleted_at is not None:
        raise not_found("Регулярный платёж уже прекращён")
    today = clock.today()
    payment.deleted_at = clock.now()
    payment.deleted_by = admin.id
    cancel_open_for_payment(db, payment.id)
    removed = db.execute(
        delete(PaymentOccurrence).where(
            PaymentOccurrence.recurring_payment_id == payment.id,
            PaymentOccurrence.status == OccurrenceStatus.unpaid,
            PaymentOccurrence.due_date > today,
        )
    ).rowcount
    audit.record(
        db,
        "recurring_payment.deleted",
        actor=admin,
        entity="recurring_payment",
        entity_id=payment.id,
        payload={"name": payment.name, "future_periods_removed": removed},
        ip=client_ip(request),
    )
    db.commit()
    return Response(status_code=204)
