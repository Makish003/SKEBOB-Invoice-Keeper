from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import ColumnElement, and_, func, not_, or_, select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, current_user
from app.core.clock import Clock, get_clock
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import not_found
from app.models import Currency, OccurrenceStatus, PaymentOccurrence, RecurringPayment, User
from app.schemas.common import errors
from app.schemas.payments import Occurrence, OccurrenceList, OccurrencePatch
from app.services import audit, receipts
from app.services.occurrences import apply_patch, get_occurrence, occurrence_query, refresh_periods, to_schema
from app.services.receipts import ReceiptStorage

router = APIRouter(prefix="/payment-occurrences", tags=["Периоды оплаты"])

SortField = Literal["due_date", "-due_date", "amount", "-amount", "name", "-name"]
_SORT_COLUMNS = {
    "due_date": PaymentOccurrence.due_date,
    "amount": PaymentOccurrence.amount,
    "name": RecurringPayment.name,
}
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
    refresh_periods(db, today, settings.generation_horizon_days)

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
    description="Период с вычисленными полями: просрочка, дней до срока, отображаемый статус.",
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
    occ = db.scalar(select(PaymentOccurrence).where(PaymentOccurrence.id == occurrence_id).with_for_update())
    if occ is None:
        raise not_found("Период не найден")
    today = clock.today()
    action, payload = apply_patch(occ, body, user, today)
    audit.record(
        db,
        action,
        actor=user,
        entity="payment_occurrence",
        entity_id=occ.id,
        payload=payload,
        ip=client_ip(request),
    )
    db.commit()
    result = get_occurrence(db, occ.id, today, get_settings())
    assert result is not None
    return result


# --- Чек к оплате (FR-B8) ---


def _storage() -> ReceiptStorage:
    settings = get_settings()
    return ReceiptStorage(settings.uploads_dir, settings.max_upload_mb)


def _occurrence_or_404(db: Session, occurrence_id: int) -> PaymentOccurrence:
    occ = db.scalar(select(PaymentOccurrence).where(PaymentOccurrence.id == occurrence_id).with_for_update())
    if occ is None:
        raise not_found("Период не найден")
    return occ


@router.post(
    "/{occurrence_id}/receipt",
    response_model=Occurrence,
    summary="Прикрепить файл чека",
    description="PDF, PNG или JPG до 5 МБ (тип проверяется по содержимому). Новый файл заменяет прежний.",
    responses={**errors(401, 404, 422), 413: {"description": "Файл больше 5 МБ"}},
)
def upload_receipt(
    occurrence_id: int,
    request: Request,
    file: UploadFile = File(description="Файл чека"),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
    user: User = Depends(current_user),
) -> Occurrence:
    storage = _storage()
    occ = _occurrence_or_404(db, occurrence_id)
    content = storage.read_limited(file.file)
    receipts.attach(db, storage, occ, content, file.filename, actor=user, ip=client_ip(request))
    result = get_occurrence(db, occ.id, clock.today(), get_settings())
    assert result is not None
    return result


@router.get(
    "/{occurrence_id}/receipt",
    summary="Скачать файл чека",
    response_class=FileResponse,
    responses={**errors(401, 404), 200: {"content": {"application/pdf": {}, "image/png": {}, "image/jpeg": {}}}},
)
def download_receipt(
    occurrence_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> FileResponse:
    occ = db.get(PaymentOccurrence, occurrence_id)
    path = _storage().path(occ.receipt_file_key) if occ and occ.receipt_file_key else None
    if occ is None or path is None or not path.is_file():
        raise not_found("Файл чека не прикреплён")
    return FileResponse(
        path,
        media_type=occ.receipt_content_type or "application/octet-stream",
        filename=occ.receipt_file_name or path.name,
        content_disposition_type="inline",
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.delete(
    "/{occurrence_id}/receipt",
    status_code=204,
    summary="Удалить файл чека",
    responses=errors(401, 404),
)
def delete_receipt(
    occurrence_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> Response:
    receipts.detach(db, _storage(), _occurrence_or_404(db, occurrence_id), actor=user, ip=client_ip(request))
    return Response(status_code=204)
