"""Заявки администратору (ADR-029): пользователь создаёт и видит свои, администратор видит все и обрабатывает."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, current_user, require_admin
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import not_found
from app.models import SupportTicket, TicketStatus, TicketTopic, User
from app.schemas.common import errors
from app.schemas.tickets import Ticket, TicketList, TicketPatch
from app.services import tickets
from app.services.receipts import ReceiptStorage

router = APIRouter(prefix="/support-tickets", tags=["Заявки"])

NOT_FOUND = "Заявка не найдена"


def _storage() -> ReceiptStorage:
    settings = get_settings()
    return ReceiptStorage(settings.uploads_dir, settings.max_upload_mb)


def _visible(db: Session, user: User, ticket_id: int) -> SupportTicket:
    """Чужая заявка для пользователя неотличима от несуществующей: 404, а не 403."""
    query = tickets.visible_tickets(user).where(SupportTicket.id == ticket_id).execution_options(populate_existing=True)
    ticket = db.scalar(query)
    if ticket is None:
        raise not_found(NOT_FOUND)
    return ticket


@router.post(
    "",
    response_model=Ticket,
    status_code=201,
    summary="Создать заявку",
    description=(
        "multipart/form-data: тема, описание, до 10 периодов платежей (`occurrence_ids`, поле повторяется) и до 5 "
        "файлов PDF, PNG или JPG до 5 МБ каждый (`files`, тип проверяется по содержимому). Доступно всем авторизованным."
    ),
    responses={**errors(401, 422), 413: {"description": "Файл больше 5 МБ"}},
)
def create_ticket(
    request: Request,
    topic: Annotated[TicketTopic, Form(description="Тема заявки")],
    description: Annotated[str, Form(max_length=4000, description="Описание вопроса или неполадки")],
    occurrence_ids: Annotated[list[int], Form(description="Периоды платежей, к которым относится заявка")] = [],  # noqa: B006
    files: Annotated[list[UploadFile], File(description="Скриншоты или документы")] = [],  # noqa: B006
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> Ticket:
    storage = _storage()
    contents = [(storage.read_limited(f.file), f.filename) for f in files]
    ticket = tickets.create(
        db,
        storage,
        author=user,
        topic=topic,
        description=description,
        occurrence_ids=occurrence_ids,
        files=contents,
        ip=client_ip(request),
    )
    return tickets.to_schema(_visible(db, user, ticket.id))


@router.get(
    "",
    response_model=TicketList,
    summary="Список заявок",
    description="Администратор видит все заявки, пользователь — только свои. Сначала новые.",
    responses=errors(401, 422),
)
def list_tickets(
    status: TicketStatus | None = Query(None, description="Статус заявки"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> TicketList:
    query = tickets.visible_tickets(user)
    if status is not None:
        query = query.where(SupportTicket.status == status)
    rows = db.scalars(query.order_by(SupportTicket.created_at.desc(), SupportTicket.id.desc()).limit(limit).offset(offset))
    return TicketList(items=[tickets.to_schema(t) for t in rows], total=tickets.count_visible(db, user, status))


@router.get(
    "/{ticket_id}",
    response_model=Ticket,
    summary="Заявка по id",
    description="Своя заявка или любая для администратора; чужая — 404.",
    responses=errors(401, 404),
)
def get_ticket(ticket_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> Ticket:
    return tickets.to_schema(_visible(db, user, ticket_id))


@router.patch(
    "/{ticket_id}",
    response_model=Ticket,
    summary="Обработать заявку",
    description="Только администратор: статус (`open`, `in_progress`, `resolved`) и ответ пользователю.",
    responses=errors(401, 403, 404, 422),
)
def patch_ticket(
    ticket_id: int,
    body: TicketPatch,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> Ticket:
    ticket = db.scalar(select(SupportTicket).where(SupportTicket.id == ticket_id).with_for_update())
    if ticket is None:
        raise not_found(NOT_FOUND)
    tickets.update(db, ticket, body, admin=admin, ip=client_ip(request))
    return tickets.to_schema(_visible(db, admin, ticket_id))


@router.get(
    "/{ticket_id}/attachments/{attachment_id}",
    summary="Скачать файл заявки",
    response_class=FileResponse,
    responses={**errors(401, 404), 200: {"content": {"application/pdf": {}, "image/png": {}, "image/jpeg": {}}}},
)
def download_attachment(
    ticket_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> FileResponse:
    ticket = _visible(db, user, ticket_id)
    attachment = next((a for a in ticket.attachments if a.id == attachment_id), None)
    path = _storage().path(attachment.file_key) if attachment else None
    if attachment is None or path is None or not path.is_file():
        raise not_found("Файл не найден")
    return FileResponse(
        path,
        media_type=attachment.content_type,
        filename=attachment.file_name,
        content_disposition_type="inline",
        headers={"X-Content-Type-Options": "nosniff"},
    )

