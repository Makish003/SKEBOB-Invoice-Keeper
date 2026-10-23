"""Канал по умолчанию без Telegram-токена: напоминание пишется в лог воркера (NFR-9)."""

import logging

from app.models import Channel
from app.services.notifiers.base import ReminderMessage, format_plain

log = logging.getLogger("app.reminders")


class ConsoleNotifier:
    channel = Channel.console

    async def send(self, message: ReminderMessage) -> str | None:
        log.info("REMINDER #%s → %s", message.reminder_id, format_plain(message))
        return None
