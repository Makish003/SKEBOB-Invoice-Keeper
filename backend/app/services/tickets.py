"""Заявки администратору (ADR-029): создание с файлами и периодами платежей, выдача, обработка.

Файлы лежат в томе uploads рядом с чеками и проверяются так же (тип по сигнатуре, ReceiptStorage). Порядок как у
чеков: файлы пишутся до COMMIT и удаляются, если транзакция не прошла.
"""

from pathlib import Path

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import unprocessable
from app.models import PaymentOccurrence, Role, SupportTicket, TicketAttachment, TicketStatus, TicketTopic, User
from app.schemas.tickets import Ticket, TicketPatch
from app.services import audit
from app.services.receipts import SIGNATURES, ReceiptStorage

MAX_FILES = 5
MAX_PAYMENTS = 10


def visible_tickets(user: User) -> Select[tuple[SupportTicket]]:
    """Администратор видит все заявки, пользователь — только свои."""
    query = select(SupportTicket).options(
        selectinload(SupportTicket.author),
        selectinload(SupportTicket.attachments),
        selectinload(SupportTicket.occurrences).selectinload(PaymentOccurrence.recurring_payment),
    )
    return query if user.role == Role.admin else query.where(SupportTicket.author_id == user.id)


def count_visible(db: Session, user: User, status: TicketStatus | None) -> int:
    query = select(func.count()).select_from(SupportTicket)
    if user.role != Role.admin:
        query = query.where(SupportTicket.author_id == user.id)
    if status is not None:
        query = query.where(SupportTicket.status == status)
    return db.scalar(query) or 0


def to_schema(ticket: SupportTicket) -> Ticket:
    return Ticket.model_validate(
        {
            "id": ticket.id,
            "topic": ticket.topic,
            "status": ticket.status,
            "description": ticket.description,
            "admin_reply": ticket.admin_reply,
            "author": {"id": ticket.author.id, "login": ticket.author.login, "display_name": ticket.author.display_name},
            "attachments": [
                {"id": a.id, "file_name": a.file_name, "content_type": a.content_type, "size": a.size}
                for a in ticket.attachments
            ],
            "payments": [
                {
                    "occurrence_id": o.id,
                    "recurring_payment_id": o.recurring_payment_id,
                    "name": o.recurring_payment.name,
                    "due_date": o.due_date,
                    "amount": o.amount,
                    "currency": o.currency,
                    "status": o.status,
                }
                for o in ticket.occurrences
            ],
            "created_at": ticket.created_at,
            "updated_at": ticket.updated_at,
        }
    )


def create(
    db: Session,
    storage: ReceiptStorage,
    *,
    author: User,
    topic: TicketTopic,
    description: str,
    occurrence_ids: list[int],
    files: list[tuple[bytes, str | None]],
    ip: str | None,
) -> SupportTicket:
    """Создаёт заявку и коммитит. Файлы — (содержимое, имя), уже прочитанные с ограничением размера."""
    description = description.strip()
    if not description:
        raise unprocessable("Опишите вопрос или неполадку")
    if len(files) > MAX_FILES:
        raise unprocessable(f"Не больше {MAX_FILES} файлов в заявке")
    ids = list(dict.fromkeys(occurrence_ids))
    if len(ids) > MAX_PAYMENTS:
        raise unprocessable(f"Не больше {MAX_PAYMENTS} платежей в заявке")
    occurrences = list(db.scalars(select(PaymentOccurrence).where(PaymentOccurrence.id.in_(ids)))) if ids else []
    if len(occurrences) != len(ids):
        raise unprocessable("Платёж не найден", details={"occurrence_ids": sorted(set(ids) - {o.id for o in occurrences})})

    ticket = SupportTicket(author_id=author.id, topic=topic, description=description, occurrences=occurrences)
    saved: list[str] = []
    try:
        for content, file_name in files:
            key, kind = storage.save(content)
            saved.append(key)
            name = Path(file_name or f"file{SIGNATURES[kind][1]}").name[:255]
            ticket.attachments.append(TicketAttachment(file_name=name, file_key=key, content_type=kind, size=len(content)))
        db.add(ticket)
        db.flush()
        audit.record(
            db,
            "ticket.created",
            actor=author,
            entity="support_ticket",
            entity_id=ticket.id,
            payload={"topic": topic.value, "files": len(files), "payments": ids},
            ip=ip,
        )
        db.commit()
    except BaseException:
        db.rollback()
        for key in saved:
            storage.remove(key)
        raise
    return ticket


def update(db: Session, ticket: SupportTicket, body: TicketPatch, *, admin: User, ip: str | None) -> None:
    """Статус и ответ администратора; в журнал — что было и что стало. Коммитит."""
    changes: dict[str, dict[str, str | None]] = {}
    if body.status is not None and body.status != ticket.status:
        changes["status"] = {"from": ticket.status.value, "to": body.status.value}
        ticket.status = body.status
    if "admin_reply" in body.model_fields_set:
        reply = body.admin_reply or None
        if reply != ticket.admin_reply:
            changes["admin_reply"] = {"from": ticket.admin_reply, "to": reply}
            ticket.admin_reply = reply
    if changes:
        audit.record(
            db, "ticket.updated", actor=admin, entity="support_ticket", entity_id=ticket.id, payload=changes, ip=ip
        )
    db.commit()
