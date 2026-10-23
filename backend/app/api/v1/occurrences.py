from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import ColumnElement, and_, func, not_, or_, select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, current_user
from app.core.clock import Clock, get_clock
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import not_found, unprocessable
from app.models import Currency, OccurrenceStatus, PaymentOccurrence, RecurringPayment, User
from app.schemas.common import errors
from app.schemas.payments import Occurrence, OccurrenceList, OccurrencePatch
from app.services import audit
from app.services.occurrences import ensure_all, get_occurrence, occurrence_query, to_schema

router = APIRouter(prefix="/payment-occurrences", tags=["Периоды оплаты"])

SortField = Literal["due_date", "-due_date", "amount", "-amount", "name", "-name"]
_SORT_COLUMNS = {
    "due_date": PaymentOccurrence.due_date,
    "amount": PaymentOccurrence.amount,
    "name": RecurringPayment.name,
}
EARLIEST_PAYMENT_BEFORE_DUE = timedelta(days=366)


def overdue_condition(today: date) -> ColumnElement[bool]:
    """FR-9 в SQL: не оплачен и срок прошёл, либо оплачен позже срока."""
    return or_(
        and_(PaymentOccurrence.status == OccurrenceStatus.unpaid, PaymentOccurrence.due_date < today),
        and_(PaymentOccurrence.status == OccurrenceStatus.paid, PaymentOccurrence.paid_at > PaymentOccurrence.due_date),
    )


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@router.get(
    "",
    response_model=OccurrenceList,
    summary="Список периодов (платежей)",
    description=(
        "Все периоды, в т.ч. оплаченные и просроченные. Фильтры комбинируются через И. "
        "По умолчанию — только периоды активных платежей; история прекращённых — `include_deleted=true`."
    ),
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
    settings, today = get_settings(), clock.today()
    ensure_all(db, today, settings.generation_horizon_days)
    db.commit()

    conditions: list[ColumnElement[bool]] = []
    if not include_deleted:
        conditions.append(RecurringPayment.deleted_at.is_(None))
    if status is not None:
        conditions.append(PaymentOccurrence.status == status)
    if overdue is not None:
        conditions.append(overdue_condition(today) if overdue else not_(overdue_condition(today)))
    if currency is not None:
        conditions.append(PaymentOccurrence.currency == currency)
    if recurring_payment_id is not None:
        conditions.append(PaymentOccurrence.recurring_payment_id == recurring_payment_id)
    if due_from is not None:
        conditions.append(PaymentOccurrence.due_date >= due_from)
    if due_to is not None:
        conditions.append(PaymentOccurrence.due_date <= due_to)
    if q and q.strip():
        conditions.append(RecurringPayment.name.ilike(f"%{_escape_like(q.strip())}%", escape="\\"))

    total = db.scalar(
        select(func.count())
        .select_from(PaymentOccurrence)
        .join(RecurringPayment, RecurringPayment.id == PaymentOccurrence.recurring_payment_id)
        .where(*conditions)
    )
    column = _SORT_COLUMNS[sort.lstrip("-")]
    order = column.desc() if sort.startswith("-") else column.asc()
    rows = db.execute(
        occurrence_query().where(*conditions).order_by(order, PaymentOccurrence.id).limit(limit).offset(offset)
    ).all()
    return OccurrenceList(items=[to_schema(o, p, sent, today, settings) for o, p, sent in rows], total=total or 0)


@router.get(
    "/{occurrence_id}",
    response_model=Occurrence,
    summary="Конкретный период",
    responses=errors(401, 404),
)
def get_occurrence_by_id(
    occurrence_id: int,
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
    user: User = Depends(current_user),
) -> Occurrence:
    occurrence = get_occurrence(db, occurrence_id, clock.today(), get_settings())
    if occurrence is None:
        raise not_found("Период не найден")
    return occurrence


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
    fields = body.model_fields_set
    if not fields:
        raise unprocessable("Нет изменений: передайте status, paid_at или note")
    if "status" in fields and body.status is None:
        raise unprocessable("Поле status не может быть пустым: paid или unpaid")

    occ = db.scalar(select(PaymentOccurrence).where(PaymentOccurrence.id == occurrence_id).with_for_update())
    if occ is None:
        raise not_found("Период не найден")

    today = clock.today()
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

    after = {"status": occ.status.value, "paid_at": occ.paid_at.isoformat() if occ.paid_at else None}
    if before["status"] != after["status"]:
        action = "occurrence.paid" if new_status == OccurrenceStatus.paid else "occurrence.unpaid"
    elif before["paid_at"] != after["paid_at"]:
        action = "occurrence.paid_at_changed"
    else:
        action = "occurrence.note_changed"
    audit.record(
        db,
        action,
        actor=user,
        entity="payment_occurrence",
        entity_id=occ.id,
        payload={"before": before, "after": after, "due_date": occ.due_date.isoformat()},
        ip=client_ip(request),
    )
    db.commit()
    result = get_occurrence(db, occ.id, today, get_settings())
    assert result is not None
    return result
