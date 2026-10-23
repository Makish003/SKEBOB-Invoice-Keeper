"""Общее для каналов напоминаний: сообщение, его текст (FR-18), интерфейс отправки."""

import html
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Protocol

from app.models import Channel


class NotifierError(Exception):
    """Канал не принял сообщение (сеть, неверный токен, chat id) — напоминание уйдёт на ретрай."""


@dataclass(frozen=True)
class ReminderMessage:
    reminder_id: int
    occurrence_id: int
    payment_name: str
    amount: Decimal
    currency: str
    due_date: date
    days_until_due: int


class Notifier(Protocol):
    channel: Channel

    async def send(self, message: ReminderMessage) -> str | None:
        """Отправляет сообщение; возвращает внешний id (например, message_id в Telegram)."""
        ...


def format_amount(amount: Decimal) -> str:
    """85000.5 -> «85 000,50» (как в ru-RU)."""
    return f"{amount:,.2f}".replace(",", " ").replace(".", ",")


def _plural_days(n: int) -> str:
    n_abs = abs(n)
    if n_abs % 10 == 1 and n_abs % 100 != 11:
        return f"{n} день"
    if n_abs % 10 in (2, 3, 4) and n_abs % 100 not in (12, 13, 14):
        return f"{n} дня"
    return f"{n} дней"


def when_text(days_until_due: int) -> str:
    if days_until_due == 0:
        return "сегодня"
    if days_until_due == 1:
        return "завтра"
    return f"через {_plural_days(days_until_due)}"


def format_message(message: ReminderMessage) -> str:
    """Текст для Telegram (HTML parse mode)."""
    return (
        "🔔 <b>Напоминание об оплате</b>\n"
        f"<b>{html.escape(message.payment_name)}</b>\n"
        f"Сумма: {format_amount(message.amount)} {message.currency}\n"
        f"Срок оплаты: {message.due_date:%d.%m.%Y} ({when_text(message.days_until_due)})"
    )


def format_plain(message: ReminderMessage) -> str:
    """Тот же текст без разметки — для лога и email."""
    return (
        f"Напоминание об оплате: {message.payment_name}, {format_amount(message.amount)} {message.currency}, "
        f"срок {message.due_date:%d.%m.%Y} ({when_text(message.days_until_due)})"
    )
