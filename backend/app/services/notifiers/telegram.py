"""Отправка напоминаний в Telegram-чат из TELEGRAM_CHAT_ID (aiogram 3)."""

from aiogram import Bot
from aiogram.exceptions import TelegramAPIError
from aiogram.types import InlineKeyboardMarkup

from app.models import Channel
from app.services.notifiers.base import NotifierError, ReminderMessage, format_message
from app.services.telegram_actions import pay_keyboard_payload


# Отправка идёт под блокировкой строки напоминания: зависший запрос не должен держать очередь дольше этого.
SEND_TIMEOUT_SECONDS = 15


class TelegramNotifier:
    channel = Channel.telegram

    def __init__(self, bot: Bot, chat_id: str, secret: str, site_url: str | None = None) -> None:
        self.bot = bot
        self.chat_id = chat_id
        self.secret = secret
        self.site_url = site_url  # кнопка «Открыть в панели»; None — адрес не принимается Telegram (localhost)

    async def send(self, message: ReminderMessage) -> str | None:
        try:
            sent = await self.bot.send_message(
                self.chat_id,
                format_message(message),
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup.model_validate(pay_keyboard_payload(message.occurrence_id, self.secret, self.site_url)),
                request_timeout=SEND_TIMEOUT_SECONDS,
            )
        except (TelegramAPIError, OSError, TimeoutError) as exc:
            raise NotifierError(f"Telegram: {exc}") from exc
        return str(sent.message_id)
