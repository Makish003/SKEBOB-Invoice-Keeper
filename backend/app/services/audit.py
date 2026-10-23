"""Журнал аудита: кто, что, когда, откуда (FR-B2; таблица ведётся с первого дня)."""

from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog, User


def record(
    db: Session,
    action: str,
    *,
    actor: User | None = None,
    actor_label: str | None = None,
    entity: str | None = None,
    entity_id: int | None = None,
    payload: dict[str, Any] | None = None,
    ip: str | None = None,
) -> None:
    db.add(
        AuditLog(
            action=action,
            actor_user_id=actor.id if actor else None,
            actor_label=actor_label or (actor.login if actor else None),
            entity=entity,
            entity_id=entity_id,
            payload=payload,
            ip=ip,
        )
    )
