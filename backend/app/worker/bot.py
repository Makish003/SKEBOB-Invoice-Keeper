"""Telegram-бот (long polling, ADR-003): /start, /chatid и кнопка «Оплачено» в напоминаниях (FR-B1)."""

import asyncio
import html
import logging

from aiogram import Dispatcher, F, Router
from aiogram.filters import Command, CommandStart
from aiogram.types import CallbackQuery, Message
from sqlalchemy.orm import Session, sessionmaker

from app.core.clock import Clock
from app.core.config import Settings
from app.services.telegram_actions import PREFIX, handle_pay_callback

log = logging.getLogger("app.bot")


async def on_start(message: Message) -> None:
    await message.answer(
        "Привет! Я Invoice Keeper: напоминаю о регулярных платежах за 3 дня до срока.\n"
        "Добавьте меня в чат команды и отправьте /chatid — я пришлю id чата для TELEGRAM_CHAT_ID в .env."
    )


async def on_chat_id(message: Message) -> None:
    await message.answer(
        f"ID этого чата: <code>{message.chat.id}</code>\n"
        f"Укажите его в .env: <code>TELEGRAM_CHAT_ID={message.chat.id}</code> и перезапустите: "
        "<code>docker compose up -d</code>",
        parse_mode="HTML",
    )


def build_dispatcher(sessions: sessionmaker[Session], clock: Clock, settings: Settings) -> Dispatcher:
    router = Router(name="commands")
    router.message.register(on_start, CommandStart())
    router.message.register(on_chat_id, Command("chatid"))

    @router.callback_query(F.data.startswith(f"{PREFIX}:"))
    async def on_pay(callback: CallbackQuery) -> None:
        message = callback.message
        chat_id = str(message.chat.id) if message else ""
        result = await asyncio.to_thread(
            handle_pay_callback,
            sessions,
            data=callback.data or "",
            chat_id=chat_id,
            allowed_chat_id=settings.telegram_chat_id,
            username=callback.from_user.username or "",
            today=clock.today(),
            secret=settings.secret_key,
        )
        log.info("Pay button %s from %s: %s", callback.data, callback.from_user.id, result.status)
        await callback.answer(result.answer, show_alert=result.status != "paid")
        if result.status == "paid" and isinstance(message, Message) and message.html_text:
            await message.edit_text(message.html_text + html.escape(result.message_suffix), parse_mode="HTML", reply_markup=None)

    dispatcher = Dispatcher()
    dispatcher.include_router(router)
    return dispatcher
