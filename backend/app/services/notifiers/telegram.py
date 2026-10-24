"""Отправка напоминаний в Telegram-чаты из TELEGRAM_CHAT_ID (aiogram 3)."""

import logging

from aiogram import Bot
from aiogram.exceptions import TelegramAPIError
from aiogram.types import InlineKeyboardMarkup

from app.models import Channel
from app.services.notifiers.base import NotifierError, ReminderMessage, format_message
from app.services.telegram_actions import pay_keyboard_payload

log = logging.getLogger("app.notifiers.telegram")

# Отправка идёт под блокировкой строки напоминания: зависший запрос не должен держать очередь дольше этого.
SEND_TIMEOUT_SECONDS = 15


class TelegramNotifier:
    channel = Channel.telegram

    def __init__(self, bot: Bot, chat_ids: tuple[str, ...], secret: str, site_url: str | None = None) -> None:
        self.bot = bot
        self.chat_ids = chat_ids
        self.secret = secret
        self.site_url = site_url  # кнопка «Открыть в панели»; None — адрес не принимается Telegram (localhost)

    async def send(self, message: ReminderMessage) -> str | None:
        """Шлёт во все чаты. Успех, если дошло хотя бы в один: повтор продублировал бы напоминание там, где оно уже есть."""
        sent_ids: list[str] = []
        errors: list[str] = []
        for chat_id in self.chat_ids:
            try:
                sent = await self.bot.send_message(
                    chat_id,
                    format_message(message),
                    parse_mode="HTML",
                    reply_markup=InlineKeyboardMarkup.model_validate(pay_keyboard_payload(message.occurrence_id, self.secret, self.site_url)),
                    request_timeout=SEND_TIMEOUT_SECONDS,
                )
            except (TelegramAPIError, OSError, TimeoutError) as exc:
                errors.append(f"{chat_id}: {exc}")
                continue
            sent_ids.append(str(sent.message_id))
        if not sent_ids:
            raise NotifierError(f"Telegram: {'; '.join(errors)}")
        for error in errors:
            log.warning("Telegram: напоминание %s не доставлено в чат %s", message.reminder_id, error)
        return ",".join(sent_ids)[:64]  # reminders.external_id — String(64)
