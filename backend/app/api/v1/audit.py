"""Журнал аудита (FR-B2): кто, что, когда, откуда. Только администратор."""

from datetime import date, datetime, time, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.core.clock import Clock, get_clock
from app.core.db import get_db
from app.models import AuditLog, PaymentOccurrence, RecurringPayment, User
from app.schemas.common import errors

router = APIRouter(prefix="/audit-log", tags=["Журнал"])

Category = Literal["auth", "payments", "occurrences", "users", "tickets"]
_CATEGORY_PREFIX = {"auth": "auth.", "payments": "recurring_payment.", "occurrences": "occurrence.", "users": "user.", "tickets": "ticket."}


class AuditEntry(BaseModel):
    id: int
    at: datetime
    actor_user_id: int | None
    actor_label: str | None
    action: str
    entity: str | None
    entity_id: int | None
    entity_label: str | None
    payload: dict[str, Any] | None
    ip: str | None


class AuditList(BaseModel):
    items: list[AuditEntry]
    total: int


def _entity_labels(db: Session, rows: list[AuditLog]) -> dict[tuple[str, int], str]:
    ids: dict[str, set[int]] = {}
    for row in rows:
        if row.entity and row.entity_id is not None:
            ids.setdefault(row.entity, set()).add(row.entity_id)
    labels: dict[tuple[str, int], str] = {}
    if ids.get("recurring_payment"):
        for pid, name in db.execute(select(RecurringPayment.id, RecurringPayment.name).where(RecurringPayment.id.in_(ids["recurring_payment"]))):
            labels[("recurring_payment", pid)] = name
    if ids.get("payment_occurrence"):
        query = (
            select(PaymentOccurrence.id, RecurringPayment.name, PaymentOccurrence.due_date)
            .join(RecurringPayment, RecurringPayment.id == PaymentOccurrence.recurring_payment_id)
            .where(PaymentOccurrence.id.in_(ids["payment_occurrence"]))
        )
        for oid, name, due in db.execute(query):
            labels[("payment_occurrence", oid)] = f"{name}, срок {due:%d.%m.%Y}"
    if ids.get("user"):
        for uid, login, display in db.execute(select(User.id, User.login, User.display_name).where(User.id.in_(ids["user"]))):
            labels[("user", uid)] = f"{display} ({login})"
    for tid in ids.get("support_ticket", ()):
        labels[("support_ticket", tid)] = f"Заявка №{tid}"
    return labels


@router.get(
    "",
    response_model=AuditList,
    summary="Журнал действий",
    description=(
        "Входы и выходы (в т.ч. неудачные), создание и прекращение платежей, отметки и отмены оплат, исправления дат, "
        "изменения пользователей, заявки администратору. Новые записи первыми."
    ),
    responses=errors(401, 403, 422),
)
def list_audit_log(
    category: Category | None = Query(None, description="auth | payments | occurrences | users | tickets"),
    action: str | None = Query(None, max_length=64, description="Точное действие, например auth.login.failed"),
    q: str | None = Query(None, max_length=100, description="Поиск по автору"),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
    admin: User = Depends(require_admin),
) -> AuditList:
    tz = clock.tz
    conditions: list[ColumnElement[bool]] = []
    if category:
        conditions.append(AuditLog.action.startswith(_CATEGORY_PREFIX[category]))
    if action:
        conditions.append(AuditLog.action == action)
    if q and q.strip():
        pattern = f"%{q.strip()}%"
        conditions.append(or_(AuditLog.actor_label.ilike(pattern), AuditLog.ip.ilike(pattern)))
    if date_from:
        conditions.append(AuditLog.at >= datetime.combine(date_from, time.min, tz))
    if date_to:
        conditions.append(AuditLog.at < datetime.combine(date_to + timedelta(days=1), time.min, tz))

    total = db.scalar(select(func.count()).select_from(AuditLog).where(*conditions)) or 0
    rows = list(db.scalars(select(AuditLog).where(*conditions).order_by(AuditLog.id.desc()).limit(limit).offset(offset)))
    labels = _entity_labels(db, rows)
    items = [
        AuditEntry(
            id=row.id,
            at=row.at,
            actor_user_id=row.actor_user_id,
            actor_label=row.actor_label,
            action=row.action,
            entity=row.entity,
            entity_id=row.entity_id,
            entity_label=labels.get((row.entity, row.entity_id)) if row.entity and row.entity_id is not None else None,
            payload=row.payload,
            ip=row.ip,
        )
        for row in rows
    ]
    return AuditList(items=items, total=total)
