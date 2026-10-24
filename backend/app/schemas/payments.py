"""Схемы регулярных платежей, периодов и итогов."""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, StringConstraints, UrlConstraints

from app.domain.status import DisplayStatus
from app.models import Currency, OccurrenceStatus, Period
from app.schemas.common import Money


class RecurringPaymentRef(BaseModel):
    id: int
    name: str
    period: Period
    is_active: bool


class Occurrence(BaseModel):
    """Период регулярного платежа: собственный срок и собственная отметка оплаты (FR-5)."""

    id: int
    recurring_payment: RecurringPaymentRef
    seq: int = Field(description="Номер периода: 0 — первый")
    due_date: date
    amount: Money
    currency: Currency
    status: OccurrenceStatus
    paid_at: date | None
    paid_by_label: str | None = Field(description="Кто отметил оплату (снимок имени)")
    note: str | None
    is_overdue: bool = Field(description="Не оплачен и сегодня > срока, либо оплачен позже срока")
    overdue_days: int = Field(description="Дней просрочки (0, если нет)")
    days_until_due: int = Field(description="Дней до срока (отрицательно — срок прошёл)")
    display_status: DisplayStatus
    reminder_sent_at: datetime | None = Field(description="Когда отправлено напоминание")
    receipt_url: str | None = Field(default=None, description="Ссылка на чек или платёжку")
    receipt_file_name: str | None = Field(
        default=None, description="Имя прикреплённого файла чека; скачать: GET /payment-occurrences/{id}/receipt"
    )
    updated_at: datetime


class OccurrenceList(BaseModel):
    items: list[Occurrence]
    total: int


class OccurrencePatch(BaseModel):
    """Подтверждение/отмена оплаты, исправление фактической даты.

    - `status=paid` без `paid_at` → `paid_at` = сегодня;
    - `status=unpaid` → `paid_at` очищается (передавать `paid_at` нельзя);
    - `paid_at` без `status` — только для оплаченного периода (исправление даты);
    - `paid_at` в будущем → 422.
    """

    model_config = ConfigDict(extra="forbid")

    status: OccurrenceStatus | None = None
    paid_at: date | None = None
    note: Annotated[str, StringConstraints(max_length=500)] | None = None
    receipt_url: Annotated[AnyHttpUrl, UrlConstraints(max_length=1000)] | None = Field(
        default=None, description="Ссылка на чек (http/https); null — убрать"
    )


class RecurringPayment(BaseModel):
    id: int
    name: str
    amount: Money
    currency: Currency
    period: Period
    first_due_date: date
    description: str | None
    is_active: bool
    created_at: datetime
    deleted_at: datetime | None
    next_occurrence: Occurrence | None = Field(description="Ближайший период со сроком сегодня или позже")


class RecurringPaymentList(BaseModel):
    items: list[RecurringPayment]
    total: int


class RecurringPaymentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)] = Field(
        examples=["Аренда офиса"]
    )
    amount: Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2)] = Field(
        examples=["85000.00"], description="Строка или число, не более 2 знаков после запятой"
    )
    currency: Currency
    first_due_date: date = Field(description="Дата ближайшей оплаты (YYYY-MM-DD)", examples=["2026-10-26"])
    period: Period = Period.monthly
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)] | None = None


class RecurringPaymentPatch(BaseModel):
    """Изменение регулярного платежа (передаются только меняемые поля).

    - `amount` — новая сумма шаблона и всех **неоплаченных периодов со сроком сегодня или позже**; оплаченные и уже
      просроченные периоды сохраняют сумму, по которой их выставили;
    - `description: null` — убрать описание;
    - валюта и график не меняются: для другого графика прекратите платёж и создайте новый (история сохранится).
    """

    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)] | None = None
    amount: Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2)] | None = Field(
        default=None, examples=["90000.00"]
    )
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)] | None = None


class SummaryPeriod(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    date_from: date = Field(alias="from")
    date_to: date = Field(alias="to")


class CurrencySummary(BaseModel):
    currency: Currency
    total: Money = Field(description="Сумма всех периодов со сроком в выбранном интервале")
    paid: Money = Field(description="Оплачено на дату as_of")
    unpaid: Money = Field(description="Не оплачено на дату as_of")
    overdue: Money = Field(description="Просрочено на дату as_of (срок прошёл, не оплачено)")
    due: Money = Field(description="Должно быть оплачено к дате as_of (срок ≤ as_of)")
    count_total: int
    count_paid: int
    count_overdue: int
    count_due: int


class Summary(BaseModel):
    period: SummaryPeriod
    as_of: date
    currencies: list[CurrencySummary] = Field(description="Всегда три валюты: RUB, USD, EUR — без конвертации")
