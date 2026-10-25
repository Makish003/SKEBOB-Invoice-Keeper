"""Схемы заявок администратору: каждая заявка — чат автора с администратором (ADR-029, ADR-030)."""

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import Currency, OccurrenceStatus, Role, TicketStatus, TicketTopic
from app.schemas.common import Money


class TicketAuthor(BaseModel):
    id: int
    login: str
    display_name: str
    role: Role


class TicketAttachment(BaseModel):
    id: int
    file_name: str
    content_type: str
    size: int = Field(description="Размер в байтах")


class TicketPayment(BaseModel):
    """Период платежа, приложенный к заявке (снимок на момент чтения)."""

    occurrence_id: int
    recurring_payment_id: int
    name: str
    due_date: date
    amount: Money
    currency: Currency
    status: OccurrenceStatus


class TicketMessage(BaseModel):
    id: int
    author: TicketAuthor
    body: str = Field(description="Текст; пустой, если в сообщении только файлы")
    attachments: list[TicketAttachment]
    created_at: datetime


class Ticket(BaseModel):
    """Заявка-чат: первое сообщение — описание, файлы и периоды платежей; дальше — переписка."""

    id: int
    topic: TicketTopic
    status: TicketStatus
    description: str = Field(description="Текст первого сообщения")
    author: TicketAuthor
    attachments: list[TicketAttachment] = Field(
        description="Файлы первого сообщения; скачать любой файл заявки: GET /support-tickets/{id}/attachments/{attachment_id}"
    )
    payments: list[TicketPayment]
    messages: list[TicketMessage] = Field(description="Переписка после первого сообщения, по времени")
    unread: bool = Field(description="Есть сообщения другой стороны, которые текущий пользователь ещё не открыл")
    created_at: datetime
    updated_at: datetime
    last_message_at: datetime


class TicketList(BaseModel):
    items: list[Ticket]
    total: int


class TicketPatch(BaseModel):
    """Статус заявки меняет администратор; ответ пишется сообщением в чат."""

    model_config = ConfigDict(extra="forbid")

    status: TicketStatus
