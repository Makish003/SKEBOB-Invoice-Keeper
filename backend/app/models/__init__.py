"""SQLAlchemy-модели (PLAN §1.1)."""

import enum
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

NAMING = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


class Role(enum.StrEnum):
    admin = "admin"
    user = "user"


class Currency(enum.StrEnum):
    RUB = "RUB"
    USD = "USD"
    EUR = "EUR"


class Period(enum.StrEnum):
    monthly = "monthly"
    weekly = "weekly"
    quarterly = "quarterly"
    yearly = "yearly"


class OccurrenceStatus(enum.StrEnum):
    unpaid = "unpaid"
    paid = "paid"


class Channel(enum.StrEnum):
    telegram = "telegram"
    email = "email"
    webhook = "webhook"
    console = "console"


class ReminderKind(enum.StrEnum):
    upcoming = "upcoming"
    overdue = "overdue"


class ReminderStatus(enum.StrEnum):
    pending = "pending"
    sent = "sent"
    failed = "failed"
    cancelled = "cancelled"


def _enum(cls: type[enum.Enum], name: str) -> Enum:
    return Enum(cls, name=name, values_callable=lambda e: [m.value for m in e])


def _created_at() -> Any:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def _updated_at() -> Any:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        # Логин уникален среди не удалённых пользователей: логин удалённого можно выдать снова.
        Index("uq_users_login_active", "login", unique=True, postgresql_where=text("deleted_at IS NULL")),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    login: Mapped[str] = mapped_column(String(64), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    role: Mapped[Role] = mapped_column(_enum(Role, "user_role"), nullable=False, default=Role.user)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class UserSession(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = _created_at()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user_agent: Mapped[str | None] = mapped_column(String(400))
    ip: Mapped[str | None] = mapped_column(String(64))

    user: Mapped[User] = relationship()


class RecurringPayment(Base):
    __tablename__ = "recurring_payments"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("anchor_day BETWEEN 1 AND 31", name="anchor_day_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    currency: Mapped[Currency] = mapped_column(_enum(Currency, "currency"), nullable=False)
    period: Mapped[Period] = mapped_column(
        _enum(Period, "payment_period"), nullable=False, default=Period.monthly, server_default="monthly"
    )
    first_due_date: Mapped[date] = mapped_column(Date, nullable=False)
    anchor_day: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = _created_at()
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    @property
    def is_active(self) -> bool:
        return self.deleted_at is None


class PaymentOccurrence(Base):
    __tablename__ = "payment_occurrences"
    __table_args__ = (
        UniqueConstraint("recurring_payment_id", "seq", name="uq_payment_occurrences_payment_seq"),
        UniqueConstraint("recurring_payment_id", "due_date", name="uq_payment_occurrences_payment_due_date"),
        CheckConstraint("(status = 'paid') = (paid_at IS NOT NULL)", name="paid_at_matches_status"),
        CheckConstraint("amount > 0", name="amount_positive"),
        Index("ix_payment_occurrences_due_date", "due_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    recurring_payment_id: Mapped[int] = mapped_column(
        ForeignKey("recurring_payments.id", ondelete="CASCADE"), nullable=False
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    currency: Mapped[Currency] = mapped_column(_enum(Currency, "currency"), nullable=False)
    status: Mapped[OccurrenceStatus] = mapped_column(
        _enum(OccurrenceStatus, "occurrence_status"),
        nullable=False,
        default=OccurrenceStatus.unpaid,
        server_default="unpaid",
    )
    paid_at: Mapped[date | None] = mapped_column(Date)
    paid_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    paid_by_label: Mapped[str | None] = mapped_column(String(200))
    note: Mapped[str | None] = mapped_column(Text)
    receipt_url: Mapped[str | None] = mapped_column(String(1000))
    receipt_file_name: Mapped[str | None] = mapped_column(String(255))  # имя для пользователя
    receipt_file_key: Mapped[str | None] = mapped_column(String(64))  # имя файла в томе uploads
    receipt_content_type: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _updated_at()

    recurring_payment: Mapped[RecurringPayment] = relationship()


class Reminder(Base):
    __tablename__ = "reminders"
    __table_args__ = (
        # Гарантия «без дублей» (FR-20, NFR-6, ADR-007).
        UniqueConstraint("occurrence_id", "channel", "kind", name="uq_reminders_occurrence_channel_kind"),
        Index("ix_reminders_status_next_attempt", "status", "next_attempt_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    occurrence_id: Mapped[int] = mapped_column(
        ForeignKey("payment_occurrences.id", ondelete="CASCADE"), nullable=False
    )
    channel: Mapped[Channel] = mapped_column(_enum(Channel, "reminder_channel"), nullable=False)
    kind: Mapped[ReminderKind] = mapped_column(
        _enum(ReminderKind, "reminder_kind"), nullable=False, default=ReminderKind.upcoming, server_default="upcoming"
    )
    status: Mapped[ReminderStatus] = mapped_column(
        _enum(ReminderStatus, "reminder_status"),
        nullable=False,
        default=ReminderStatus.pending,
        server_default="pending",
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_error: Mapped[str | None] = mapped_column(Text)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    external_id: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = _created_at()

    occurrence: Mapped[PaymentOccurrence] = relationship()


class AuditLog(Base):
    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_log_at", "at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    actor_label: Mapped[str | None] = mapped_column(String(200))
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    entity: Mapped[str | None] = mapped_column(String(64))
    entity_id: Mapped[int | None] = mapped_column(BigInteger)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    ip: Mapped[str | None] = mapped_column(String(64))
