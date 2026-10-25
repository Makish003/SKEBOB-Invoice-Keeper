"""Схемы заявок администратору (ADR-029)."""

from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.models import Currency, OccurrenceStatus, TicketStatus, TicketTopic
from app.schemas.common import Money


class TicketAuthor(BaseModel):
    id: int
    login: str
    display_name: str


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


class Ticket(BaseModel):
    id: int
    topic: TicketTopic
    status: TicketStatus
    description: str
    admin_reply: str | None = Field(description="Ответ администратора")
    author: TicketAuthor
    attachments: list[TicketAttachment] = Field(
        description="Файлы; скачать: GET /support-tickets/{id}/attachments/{attachment_id}"
    )
    payments: list[TicketPayment]
    created_at: datetime
    updated_at: datetime


class TicketList(BaseModel):
    items: list[Ticket]
    total: int


class TicketPatch(BaseModel):
    """Обработка заявки администратором: статус и/или ответ (пустая строка или null убирает ответ)."""

    model_config = ConfigDict(extra="forbid")

    status: TicketStatus | None = None
    admin_reply: Annotated[str, StringConstraints(strip_whitespace=True, max_length=4000)] | None = None

    @model_validator(mode="after")
    def _not_empty(self) -> "TicketPatch":
        if not self.model_fields_set:
            raise ValueError("Передайте status или admin_reply")
        if self.status is None and "status" in self.model_fields_set:
            raise ValueError("status не может быть null")
        return self
