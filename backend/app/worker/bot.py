"""Telegram-бот (long polling, ADR-003): /start и /chatid — чтобы узнать id чата для .env."""

from aiogram import Dispatcher, Router
from aiogram.filters import Command, CommandStart
from aiogram.types import Message

router = Router(name="commands")


@router.message(CommandStart())
async def on_start(message: Message) -> None:
    await message.answer(
        "Привет! Я Invoice Keeper: напоминаю о регулярных платежах за 3 дня до срока.\n"
        "Добавьте меня в чат команды и отправьте /chatid — я пришлю id чата для TELEGRAM_CHAT_ID в .env."
    )


@router.message(Command("chatid"))
async def on_chat_id(message: Message) -> None:
    await message.answer(
        f"ID этого чата: <code>{message.chat.id}</code>\n"
        f"Укажите его в .env: <code>TELEGRAM_CHAT_ID={message.chat.id}</code> и перезапустите: "
        "<code>docker compose up -d</code>",
        parse_mode="HTML",
    )


def build_dispatcher() -> Dispatcher:
    dispatcher = Dispatcher()
    dispatcher.include_router(router)
    return dispatcher
