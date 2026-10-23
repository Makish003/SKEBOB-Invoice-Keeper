"""X-07: email-канал без сети (фейковый SMTP)."""

import asyncio
import smtplib
from datetime import date
from decimal import Decimal
from email.message import EmailMessage

import pytest

from app.core.config import Settings
from app.models import Channel
from app.services.notifiers.base import NotifierError, ReminderMessage
from app.services.notifiers.email import EmailNotifier, recipients_from
from app.services.reminders import active_channels

MESSAGE = ReminderMessage(1, 2, "Подписка Figma", Decimal("15"), "EUR", date(2026, 11, 5), 2)


class FakeSMTP:
    sent: list[EmailMessage] = []
    fail = False

    def __init__(self, host: str, port: int, timeout: int) -> None:
        self.host, self.port = host, port

    def __enter__(self) -> "FakeSMTP":
        if FakeSMTP.fail:
            raise smtplib.SMTPConnectError(421, "busy")
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def starttls(self) -> None: ...

    def login(self, user: str, password: str) -> None: ...

    def send_message(self, message: EmailMessage) -> None:
        FakeSMTP.sent.append(message)


def test_sends_email_with_required_fields() -> None:
    FakeSMTP.sent, FakeSMTP.fail = [], False
    notifier = EmailNotifier("mailpit", 1025, "ik@example.com", ["team@example.com", "cfo@example.com"], smtp_factory=FakeSMTP)
    asyncio.run(notifier.send(MESSAGE))
    email = FakeSMTP.sent[0]
    assert email["To"] == "team@example.com, cfo@example.com"
    assert email["Subject"] == "Напоминание об оплате: Подписка Figma, 15,00 EUR до 05.11.2026"
    assert "через 2 дня" in email.get_content()


def test_smtp_error_is_notifier_error() -> None:
    FakeSMTP.fail = True
    with pytest.raises(NotifierError):
        asyncio.run(EmailNotifier("mailpit", 1025, "a@b", ["c@d"], smtp_factory=FakeSMTP).send(MESSAGE))
    FakeSMTP.fail = False


def test_recipients_and_channel() -> None:
    assert recipients_from(" a@b.c, ,d@e.f ") == ["a@b.c", "d@e.f"]
    assert Channel.email not in active_channels(Settings(smtp_host="mailpit", email_to=""))
    assert Channel.email in active_channels(Settings(smtp_host="mailpit", email_to="team@example.com"))
