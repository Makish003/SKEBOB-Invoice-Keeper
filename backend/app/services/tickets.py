"""Заявки администратору (ADR-029, ADR-030): каждая заявка — чат автора с администратором.

Файлы лежат в томе uploads рядом с чеками и проверяются так же (тип по сигнатуре, ReceiptStorage). Порядок как у
чеков: файлы пишутся до COMMIT и удаляются, если транзакция не прошла.

Непрочитанное считается по отметкам времени в самой заявке: у каждой стороны время её последнего сообщения и время,
когда она открывала чат. Время берётся из БД (`now()`), как у `created_at`.
"""

from pathlib import Path

from sqlalchemy import ColumnElement, Select, and_, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.errors import unprocessable
from app.models import (
    PaymentOccurrence,
    Role,
    SupportTicket,
    TicketAttachment,
    TicketMessage,
    TicketStatus,
    TicketTopic,
    User,
)
from app.schemas.tickets import Ticket, TicketPatch
from app.services import audit
from app.services.receipts import SIGNATURES, ReceiptStorage

MAX_FILES = 5
MAX_PAYMENTS = 10
MAX_TEXT = 4000


def _is_author(ticket: SupportTicket, user: User) -> bool:
    return ticket.author_id == user.id


def visible_tickets(user: User) -> Select[tuple[SupportTicket]]:
    """Администратор видит все заявки, пользователь — только свои."""
    query = select(SupportTicket).options(
        selectinload(SupportTicket.author),
        selectinload(SupportTicket.attachments),
        selectinload(SupportTicket.occurrences).selectinload(PaymentOccurrence.recurring_payment),
        selectinload(SupportTicket.messages).selectinload(TicketMessage.author),
        selectinload(SupportTicket.messages).selectinload(TicketMessage.attachments),
    )
    return query if user.role == Role.admin else query.where(SupportTicket.author_id == user.id)


def unread_condition(user: User) -> ColumnElement[bool]:
    """SQL: у другой стороны есть сообщение новее отметки «прочитано» текущего пользователя."""
    for_author = SupportTicket.last_admin_message_at > SupportTicket.author_read_at
    if user.role != Role.admin:
        return for_author
    for_admin = or_(
        SupportTicket.admin_read_at.is_(None), SupportTicket.last_author_message_at > SupportTicket.admin_read_at
    )
    return or_(and_(SupportTicket.author_id == user.id, for_author), and_(SupportTicket.author_id != user.id, for_admin))


def is_unread(ticket: SupportTicket, user: User) -> bool:
    if _is_author(ticket, user):
        return ticket.last_admin_message_at is not None and ticket.last_admin_message_at > ticket.author_read_at
    return ticket.admin_read_at is None or ticket.last_author_message_at > ticket.admin_read_at


def count_visible(db: Session, user: User, status: TicketStatus | None, unread: bool | None) -> int:
    query = select(func.count()).select_from(SupportTicket)
    if user.role != Role.admin:
        query = query.where(SupportTicket.author_id == user.id)
    if status is not None:
        query = query.where(SupportTicket.status == status)
    if unread is not None:
        condition = unread_condition(user)
        query = query.where(condition if unread else ~condition)
    return db.scalar(query) or 0


def _author(user: User) -> dict[str, object]:
    return {"id": user.id, "login": user.login, "display_name": user.display_name, "role": user.role}


def _attachment(a: TicketAttachment) -> dict[str, object]:
    return {"id": a.id, "file_name": a.file_name, "content_type": a.content_type, "size": a.size}


def to_schema(ticket: SupportTicket, viewer: User) -> Ticket:
    return Ticket.model_validate(
        {
            "id": ticket.id,
            "topic": ticket.topic,
            "status": ticket.status,
            "description": ticket.description,
            "author": _author(ticket.author),
            "attachments": [_attachment(a) for a in ticket.attachments if a.message_id is None],
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
            "messages": [
                {
                    "id": m.id,
                    "author": _author(m.author),
                    "body": m.body,
                    "attachments": [_attachment(a) for a in m.attachments],
                    "created_at": m.created_at,
                }
                for m in ticket.messages
            ],
            "unread": is_unread(ticket, viewer),
            "created_at": ticket.created_at,
            "updated_at": ticket.updated_at,
            "last_message_at": ticket.last_message_at,
        }
    )


def _save_files(
    storage: ReceiptStorage, files: list[tuple[bytes, str | None]], saved: list[str], ticket_id: int | None = None
) -> list[TicketAttachment]:
    attachments = []
    for content, file_name in files:
        key, kind = storage.save(content)
        saved.append(key)
        name = Path(file_name or f"file{SIGNATURES[kind][1]}").name[:255]
        attachments.append(
            TicketAttachment(ticket_id=ticket_id, file_name=name, file_key=key, content_type=kind, size=len(content))
        )
    return attachments


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
        ticket.attachments.extend(_save_files(storage, files, saved))
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


def post_message(
    db: Session,
    storage: ReceiptStorage,
    ticket: SupportTicket,
    *,
    sender: User,
    body: str,
    files: list[tuple[bytes, str | None]],
    ip: str | None,
) -> None:
    """Сообщение в чат заявки и коммит. Ответ администратора берёт новую заявку в работу, сообщение автора
    в решённой заявке открывает её снова: иначе администратор его не заметит."""
    body = body.strip()
    if not body and not files:
        raise unprocessable("Напишите сообщение или прикрепите файл")
    if len(body) > MAX_TEXT:
        raise unprocessable(f"Сообщение длиннее {MAX_TEXT} символов")
    if len(files) > MAX_FILES:
        raise unprocessable(f"Не больше {MAX_FILES} файлов в сообщении")

    from_author = _is_author(ticket, sender)
    before = ticket.status
    if from_author and ticket.status == TicketStatus.resolved:
        ticket.status = TicketStatus.open
    elif not from_author and ticket.status == TicketStatus.open:
        ticket.status = TicketStatus.in_progress

    saved: list[str] = []
    try:
        message = TicketMessage(ticket_id=ticket.id, author_id=sender.id, body=body)
        message.attachments.extend(_save_files(storage, files, saved, ticket_id=ticket.id))
        db.add(message)
        now = func.now()
        ticket.last_message_at = now
        if from_author:
            ticket.last_author_message_at = ticket.author_read_at = now
        else:
            ticket.last_admin_message_at = ticket.admin_read_at = now
        db.flush()
        payload: dict[str, object] = {"message_id": message.id, "files": len(files)}
        if ticket.status != before:
            payload["status"] = {"from": before.value, "to": ticket.status.value}
        audit.record(
            db, "ticket.message", actor=sender, entity="support_ticket", entity_id=ticket.id, payload=payload, ip=ip
        )
        db.commit()
    except BaseException:
        db.rollback()
        for key in saved:
            storage.remove(key)
        raise


def mark_read(db: Session, ticket: SupportTicket, reader: User) -> None:
    """Отметка «прочитано» стороны, открывшей чат. Не аудитируется: это не действие над данными."""
    if _is_author(ticket, reader):
        ticket.author_read_at = func.now()
    else:
        ticket.admin_read_at = func.now()
    db.commit()


def update(db: Session, ticket: SupportTicket, body: TicketPatch, *, admin: User, ip: str | None) -> None:
    """Статус заявки; в журнал — что было и что стало. Коммитит."""
    if body.status != ticket.status:
        audit.record(
            db,
            "ticket.updated",
            actor=admin,
            entity="support_ticket",
            entity_id=ticket.id,
            payload={"status": {"from": ticket.status.value, "to": body.status.value}},
            ip=ip,
        )
        ticket.status = body.status
    db.commit()
