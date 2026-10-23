"""Канал email (FR-B7): письмо через SMTP (для демо — mailpit, `docker compose --profile extras up -d`)."""

import asyncio
import smtplib
from collections.abc import Callable
from email.message import EmailMessage

from app.models import Channel
from app.services.notifiers.base import NotifierError, ReminderMessage, ago_text, format_amount, when_text

TIMEOUT_SECONDS = 10


def build_email(message: ReminderMessage, sender: str, recipients: list[str]) -> EmailMessage:
    amount = f"{format_amount(message.amount)} {message.currency}"
    due = f"{message.due_date:%d.%m.%Y}"
    email = EmailMessage()
    overdue = message.kind == "overdue"
    if overdue:
        email["Subject"] = f"Просрочена оплата: {message.payment_name}, {amount}, срок был {due}"
    else:
        email["Subject"] = f"Напоминание об оплате: {message.payment_name}, {amount} до {due}"
    email["From"] = sender
    email["To"] = ", ".join(recipients)
    when = ago_text(-message.days_until_due) if overdue else when_text(message.days_until_due)
    title = "Просрочена оплата" if overdue else "Напоминание об оплате"
    email.set_content(
        f"{title}\n\n{message.payment_name}\nСумма: {amount}\nСрок оплаты: {due} ({when})\n\nInvoice Keeper"
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
