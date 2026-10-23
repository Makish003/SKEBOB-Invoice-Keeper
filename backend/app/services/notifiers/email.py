"""Канал email (FR-B7): письмо через SMTP (для демо — mailpit, `docker compose --profile extras up -d`)."""

import asyncio
import smtplib
from collections.abc import Callable
from email.message import EmailMessage

from app.models import Channel
from app.services.notifiers.base import NotifierError, ReminderMessage, format_amount, when_text

TIMEOUT_SECONDS = 10


def build_email(message: ReminderMessage, sender: str, recipients: list[str]) -> EmailMessage:
    amount = f"{format_amount(message.amount)} {message.currency}"
    due = f"{message.due_date:%d.%m.%Y}"
    email = EmailMessage()
    email["Subject"] = f"Напоминание об оплате: {message.payment_name}, {amount} до {due}"
    email["From"] = sender
    email["To"] = ", ".join(recipients)
    email.set_content(
        f"Напоминание об оплате\n\n{message.payment_name}\nСумма: {amount}\n"
        f"Срок оплаты: {due} ({when_text(message.days_until_due)})\n\nInvoice Keeper"
    )
    return email


class EmailNotifier:
    channel = Channel.email

    def __init__(
        self,
        host: str,
        port: int,
        sender: str,
        recipients: list[str],
        user: str = "",
        password: str = "",
        smtp_factory: Callable[..., smtplib.SMTP] = smtplib.SMTP,
    ) -> None:
        self.host, self.port, self.sender, self.recipients = host, port, sender, recipients
        self.user, self.password, self.smtp_factory = user, password, smtp_factory

    def _send_sync(self, message: ReminderMessage) -> None:
        with self.smtp_factory(self.host, self.port, timeout=TIMEOUT_SECONDS) as smtp:
            if self.user:
                smtp.starttls()
                smtp.login(self.user, self.password)
            smtp.send_message(build_email(message, self.sender, self.recipients))

    async def send(self, message: ReminderMessage) -> str | None:
        try:
            await asyncio.to_thread(self._send_sync, message)
        except (smtplib.SMTPException, OSError) as exc:
            raise NotifierError(f"SMTP: {exc}") from exc
        return None


def recipients_from(setting: str) -> list[str]:
    return [address.strip() for address in setting.split(",") if address.strip()]
