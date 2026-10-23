"""Отправка напоминаний в Telegram-чат из TELEGRAM_CHAT_ID (aiogram 3)."""

from aiogram import Bot
from aiogram.exceptions import TelegramAPIError

from app.models import Channel
from app.services.notifiers.base import NotifierError, ReminderMessage, format_message


class TelegramNotifier:
    channel = Channel.telegram

    def __init__(self, bot: Bot, chat_id: str) -> None:
        self.bot = bot
        self.chat_id = chat_id

    async def send(self, message: ReminderMessage) -> str | None:
        try:
            sent = await self.bot.send_message(self.chat_id, format_message(message), parse_mode="HTML")
        except (TelegramAPIError, OSError, TimeoutError) as exc:
            raise NotifierError(f"Telegram: {exc}") from exc
        return str(sent.message_id)
