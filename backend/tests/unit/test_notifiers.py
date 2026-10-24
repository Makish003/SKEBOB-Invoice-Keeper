"""Каналы напоминаний без сети: Telegram через фейковый Bot, console через лог."""

import asyncio
import logging
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.services.notifiers.base import NotifierError, ReminderMessage, format_amount, when_text
from app.services.notifiers.console import ConsoleNotifier
from app.services.notifiers.telegram import TelegramNotifier

MESSAGE = ReminderMessage(1, 2, "Сервер Hetzner", Decimal("49.90"), "USD", date(2026, 10, 26), 0)


class FakeBot:
    def __init__(self, error: Exception | None = None, failing: set[str] | None = None) -> None:
        self.error = error
        self.failing = failing or set()
        self.calls: list[tuple[str, str, str]] = []

    async def send_message(
        self, chat_id: str, text: str, parse_mode: str, request_timeout: int, reply_markup: object = None
    ) -> SimpleNamespace:
        self.markup = reply_markup
        if self.error:
            raise self.error
        if chat_id in self.failing:
            raise OSError(f"chat {chat_id} unavailable")
        self.calls.append((chat_id, text, parse_mode))
        return SimpleNamespace(message_id=40 + len(self.calls))


def test_telegram_sends_html_to_configured_chat() -> None:
    bot = FakeBot()
    external_id = asyncio.run(TelegramNotifier(bot, ("-100123",), "s3cret").send(MESSAGE))  # type: ignore[arg-type]
    assert external_id == "41"
    chat_id, text, mode = bot.calls[0]
    assert (chat_id, mode) == ("-100123", "HTML")
    assert "Сервер Hetzner" in text and "49,90 USD" in text and "26.10.2026 (сегодня)" in text
    button = bot.markup.inline_keyboard[0][0]
    assert button.text == "✅ Оплачено" and button.callback_data.startswith("pay:2:")


def test_telegram_network_error_becomes_notifier_error() -> None:
    with pytest.raises(NotifierError):
        asyncio.run(TelegramNotifier(FakeBot(OSError("network down")), ("1",), "s3cret").send(MESSAGE))  # type: ignore[arg-type]


def test_telegram_sends_to_every_configured_chat() -> None:
    bot = FakeBot()
    external_id = asyncio.run(TelegramNotifier(bot, ("-100123", "555"), "s3cret").send(MESSAGE))  # type: ignore[arg-type]
    assert [call[0] for call in bot.calls] == ["-100123", "555"]
    assert external_id == "41,42"


def test_telegram_chat_failure_does_not_fail_the_rest(caplog: pytest.LogCaptureFixture) -> None:
    # Повтор отправил бы напоминание и в чаты, где оно уже дошло; неудачный чат (бот не запущен в личке) — предупреждение.
    bot = FakeBot(failing={"555"})
    with caplog.at_level(logging.WARNING):
        assert asyncio.run(TelegramNotifier(bot, ("-100123", "555"), "s3cret").send(MESSAGE)) == "41"  # type: ignore[arg-type]
    assert "555" in caplog.text


def test_telegram_fails_when_no_chat_received_it() -> None:
    with pytest.raises(NotifierError):
        asyncio.run(TelegramNotifier(FakeBot(failing={"1", "2"}), ("1", "2"), "s3cret").send(MESSAGE))  # type: ignore[arg-type]


def test_console_logs_reminder(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO, logger="app.reminders"):
        assert asyncio.run(ConsoleNotifier().send(MESSAGE)) is None
    assert "Сервер Hetzner, 49,90 USD, срок 26.10.2026" in caplog.text


@pytest.mark.parametrize(("days", "text"), [(0, "сегодня"), (1, "завтра"), (2, "через 2 дня"), (5, "через 5 дней"), (21, "через 21 день")])
def test_when_text(days: int, text: str) -> None:
    assert when_text(days) == text


def test_format_amount() -> None:
    assert format_amount(Decimal("1234567.5")) == "1 234 567,50"
