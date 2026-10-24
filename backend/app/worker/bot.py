"""Telegram-бот (long polling, ADR-003): упрощённая панель в чате и кнопка «Оплачено» в напоминаниях (FR-B1, FR-B10).

Меню доступно в командном чате TELEGRAM_CHAT_ID и в личных чатах его участников (проверка get_chat_member с кешем).
Экраны строятся в app.services.telegram_screens, здесь — только команды, кнопки и настройка бота.
"""

import asyncio
import contextlib
import html
import logging
import time
from collections.abc import Callable

from aiogram import Bot, Dispatcher, F, Router
from aiogram.enums import ButtonStyle, ChatMemberStatus, ChatType, ParseMode
from aiogram.exceptions import TelegramAPIError, TelegramBadRequest
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import (
    BotCommand,
    CallbackQuery,
    Chat,
    CopyTextButton,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    LinkPreviewOptions,
    MenuButtonCommands,
    MenuButtonWebApp,
    Message,
    ReactionTypeEmoji,
    ReplyKeyboardMarkup,
    WebAppInfo,
)
from sqlalchemy.orm import Session, sessionmaker

from app.core.clock import Clock
from app.core.config import Settings
from app.services.occurrences import refresh_periods
from app.services.telegram_actions import PREFIX, handle_pay_callback, set_paid
from app.services.telegram_screens import (
    HOME,
    NOOP,
    Action,
    ActCb,
    CardCb,
    Kind,
    Links,
    ListCb,
    MonthCb,
    Screen,
    View,
    card,
    home,
    month_summary,
    occurrence_list,
    plural,
)

log = logging.getLogger("app.bot")

Build = Callable[[Session, View], Screen]
NO_PREVIEW = LinkPreviewOptions(is_disabled=True)

COMMANDS = {
    "menu": "Главное меню и сводка",
    "upcoming": "Ближайшие сроки",
    "overdue": "Просроченные платежи",
    "summary": "Итоги месяца",
    "payments": "Все регулярные платежи",
    "chatid": "ID этого чата для .env",
    "help": "Что умеет бот",
}
SCREENS: dict[str, Build] = {
    "menu": home,
    "upcoming": lambda db, view: occurrence_list(db, view, Kind.upcoming),
    "overdue": lambda db, view: occurrence_list(db, view, Kind.overdue),
    "summary": lambda db, view: month_summary(db, view, view.today.year, view.today.month),
    "payments": lambda db, view: occurrence_list(db, view, Kind.payments),
}
# Кнопки под полем ввода в личном чате: текст кнопки → экран.
REPLY_BUTTONS = {"⏰ Ближайшие": "upcoming", "🔴 Просрочено": "overdue", "📊 Итоги": "summary", "🏠 Меню": "menu"}

SHORT_DESCRIPTION = "Напоминаю о регулярных платежах команды: сроки, просрочки, итоги и отметка «Оплачено»."
DESCRIPTION = (
    "Invoice Keeper — напоминания о регулярных платежах.\n\n"
    "• За несколько дней до срока пишу в командный чат, оплату можно отметить прямо в сообщении.\n"
    "• Показываю ближайшие сроки, просрочки и итоги месяца по валютам.\n"
    "• Из любой карточки — переход в веб-панель.\n\n"
    "Нажмите «Запустить» или отправьте /menu."
)

MEMBER_STATUSES = {ChatMemberStatus.CREATOR, ChatMemberStatus.ADMINISTRATOR, ChatMemberStatus.MEMBER, ChatMemberStatus.RESTRICTED}


class Access:
    """Кто может открыть меню: командный чат и личные чаты его участников. Членство кешируется на TTL."""

    TTL_SECONDS = 300

    def __init__(self, allowed_chat_id: str, now: Callable[[], float] = time.monotonic) -> None:
        self.allowed_chat_id = str(allowed_chat_id)
        self.now = now
        self._members: dict[int, tuple[bool, float]] = {}

    async def allows(self, bot: Bot, chat: Chat, user_id: int | None) -> bool:
        if not self.allowed_chat_id:
            return False
        if str(chat.id) == self.allowed_chat_id:
            return True
        if chat.type != ChatType.PRIVATE or user_id is None:
            return False
        cached = self._members.get(user_id)
        if cached and self.now() - cached[1] < self.TTL_SECONDS:
            return cached[0]
        try:
            member = await bot.get_chat_member(self.allowed_chat_id, user_id)
        except TelegramAPIError as exc:  # бот не в чате, пользователь не найден — не участник
            log.info("Membership check for %s failed: %s", user_id, exc)
            allowed = False
        else:
            allowed = member.status in MEMBER_STATUSES and getattr(member, "is_member", True)
        self._members[user_id] = (allowed, self.now())
        return allowed


def start_text(reminder_days: int) -> str:
    return (
        f"Привет! Я Invoice Keeper: напоминаю о регулярных платежах за {plural(reminder_days, 'день', 'дня', 'дней')} "
        "до срока, показываю ближайшие сроки и итоги."
    )


def denied_text(settings: Settings) -> str:
    if not settings.telegram_chat_id:
        return (
            "Бот ещё не подключён к командному чату. Добавьте меня в чат команды, отправьте там /chatid "
            "и укажите id в .env (TELEGRAM_CHAT_ID)."
        )
    return "Меню доступно участникам командного чата. Попросите добавить вас в чат, куда я присылаю напоминания."


def help_text(settings: Settings) -> str:
    commands = "\n".join(f"/{name} — {description}" for name, description in COMMANDS.items())
    return (
        "<b>Что я умею</b>\n\n"
        f"{commands}\n\n"
        f"За {plural(settings.reminder_days_before, 'день', 'дня', 'дней')} до срока присылаю напоминание "
        "в командный чат — оплату можно отметить кнопкой «Оплачено». "
        "В карточке периода отметку можно снять, если нажали по ошибке."
    )


def reply_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="⏰ Ближайшие", style=ButtonStyle.PRIMARY), KeyboardButton(text="🔴 Просрочено", style=ButtonStyle.DANGER)],
            [KeyboardButton(text="📊 Итоги"), KeyboardButton(text="🏠 Меню")],
        ],
        resize_keyboard=True,
        is_persistent=True,
        input_field_placeholder="Выберите раздел или команду",
    )


def chat_id_markup(chat_id: int) -> InlineKeyboardMarkup:
    copy = CopyTextButton(text=f"TELEGRAM_CHAT_ID={chat_id}")
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="📋 Скопировать строку для .env", copy_text=copy, style=ButtonStyle.PRIMARY)]]
    )


async def on_chat_id(message: Message) -> None:
    await message.answer(
        f"ID этого чата: <code>{message.chat.id}</code>\n"
        f"Укажите его в .env: <code>TELEGRAM_CHAT_ID={message.chat.id}</code> и перезапустите: "
        "<code>docker compose up -d</code>",
        parse_mode=ParseMode.HTML,
        reply_markup=chat_id_markup(message.chat.id),
    )


async def configure(bot: Bot, settings: Settings) -> None:
    """Меню команд, описание в пустом чате и кнопка меню (Mini App панели при HTTPS). Ошибки не мешают воркеру."""
    links = Links(settings.site_url)
    try:
        await bot.set_my_commands([BotCommand(command=name, description=text) for name, text in COMMANDS.items()])
        if (await bot.get_my_short_description()).short_description != SHORT_DESCRIPTION:
            await bot.set_my_short_description(short_description=SHORT_DESCRIPTION)
        if (await bot.get_my_description()).description != DESCRIPTION:
            await bot.set_my_description(description=DESCRIPTION)
        if links.web_app:
            menu: MenuButtonWebApp | MenuButtonCommands = MenuButtonWebApp(text="Панель", web_app=WebAppInfo(url=links.url()))
        else:
            menu = MenuButtonCommands()
        await bot.set_chat_menu_button(menu_button=menu)
        log.info("Bot menu configured (panel %s)", links.base)
    except (TelegramAPIError, OSError, TimeoutError) as exc:
        log.warning("Не удалось настроить меню бота: %s", exc)


def build_dispatcher(sessions: sessionmaker[Session], clock: Clock, settings: Settings) -> Dispatcher:
    router = Router(name="bot")
    access = Access(settings.telegram_chat_id)
    links = Links(settings.site_url)

    async def render(build: Build, chat: Chat) -> Screen:
        view = View(clock.today(), settings, links, private=chat.type == ChatType.PRIVATE)

        def run() -> Screen:
            with sessions() as db:
                refresh_periods(db, view.today, settings.generation_horizon_days)
                return build(db, view)

        return await asyncio.to_thread(run)

    async def send(message: Message, bot: Bot, build: Build) -> None:
        if not await access.allows(bot, message.chat, message.from_user.id if message.from_user else None):
            await message.answer(denied_text(settings))
            return
        screen = await render(build, message.chat)
        await message.answer(screen.text, parse_mode=ParseMode.HTML, reply_markup=screen.markup, link_preview_options=NO_PREVIEW)

    async def guard(callback: CallbackQuery, bot: Bot) -> Message | None:
        """Сообщение с кнопкой, если нажавшему можно пользоваться меню; иначе отвечает всплывающим окном."""
        message = callback.message
        if not isinstance(message, Message):
            await callback.answer("Сообщение устарело: отправьте /menu", show_alert=True)
            return None
        if not await access.allows(bot, message.chat, callback.from_user.id):
            await callback.answer(denied_text(settings), show_alert=True)
            return None
        return message

    async def show(callback: CallbackQuery, message: Message, build: Build, notice: str | None = None) -> None:
        screen = await render(build, message.chat)
        try:
            await message.edit_text(screen.text, parse_mode=ParseMode.HTML, reply_markup=screen.markup, link_preview_options=NO_PREVIEW)
        except TelegramBadRequest as exc:
            if "not modified" not in str(exc):  # повторное нажатие «Обновить» без изменений — не ошибка
                raise
        await callback.answer(notice)

    @router.message(CommandStart())
    async def on_start(message: Message, bot: Bot) -> None:
        user_id = message.from_user.id if message.from_user else None
        if not await access.allows(bot, message.chat, user_id):
            await message.answer(f"{start_text(settings.reminder_days_before)}\n\n{denied_text(settings)}")
            return
        if message.chat.type == ChatType.PRIVATE:
            await message.answer(
                f"{start_text(settings.reminder_days_before)}\nРазделы — на кнопках под полем ввода.",
                reply_markup=reply_keyboard(),
            )
        await send(message, bot, home)

    router.message.register(on_chat_id, Command("chatid"))

    @router.message(Command("help"))
    async def on_help(message: Message) -> None:
        await message.answer(help_text(settings), parse_mode=ParseMode.HTML)

    @router.message(Command(*SCREENS))
    async def on_screen_command(message: Message, command: CommandObject, bot: Bot) -> None:
        await send(message, bot, SCREENS[command.command])

    @router.message(F.chat.type == ChatType.PRIVATE, F.text.in_(REPLY_BUTTONS))
    async def on_reply_button(message: Message, bot: Bot) -> None:
        await send(message, bot, SCREENS[REPLY_BUTTONS[message.text or ""]])

    @router.message(F.chat.type == ChatType.PRIVATE)
    async def on_other_text(message: Message) -> None:
        await message.answer("Выберите раздел кнопками под полем ввода или отправьте /menu. Все команды — /help.")

    @router.callback_query(F.data == NOOP)
    async def on_noop(callback: CallbackQuery) -> None:
        await callback.answer()

    @router.callback_query(F.data == HOME)
    async def on_home(callback: CallbackQuery, bot: Bot) -> None:
        if message := await guard(callback, bot):
            await show(callback, message, home)

    @router.callback_query(ListCb.filter())
    async def on_list(callback: CallbackQuery, callback_data: ListCb, bot: Bot) -> None:
        if message := await guard(callback, bot):
            await show(callback, message, lambda db, view: occurrence_list(db, view, callback_data.kind, callback_data.page))

    @router.callback_query(MonthCb.filter())
    async def on_month(callback: CallbackQuery, callback_data: MonthCb, bot: Bot) -> None:
        if message := await guard(callback, bot):
            year, month = min(max(callback_data.year, 2000), 2100), min(max(callback_data.month, 1), 12)
            await show(callback, message, lambda db, view: month_summary(db, view, year, month))

    @router.callback_query(CardCb.filter())
    async def on_card(callback: CallbackQuery, callback_data: CardCb, bot: Bot) -> None:
        if message := await guard(callback, bot):
            data = callback_data
            await show(callback, message, lambda db, view: card(db, view, data.id, data.kind, data.page))

    @router.callback_query(ActCb.filter())
    async def on_action(callback: CallbackQuery, callback_data: ActCb, bot: Bot) -> None:
        message = await guard(callback, bot)
        if not message:
            return
        data, notice = callback_data, None
        if data.action is not Action.ask_unpay:
            result = await asyncio.to_thread(
                set_paid,
                sessions,
                data.id,
                paid=data.action is Action.pay,
                username=callback.from_user.username or "",
                today=clock.today(),
            )
            log.info("Card %s %s from %s: %s", data.action, data.id, callback.from_user.id, result.status)
            notice = result.answer
        confirm = data.action is Action.ask_unpay
        await show(callback, message, lambda db, view: card(db, view, data.id, data.kind, data.page, confirm), notice)

    @router.callback_query(F.data.startswith(f"{PREFIX}:"))
    async def on_pay(callback: CallbackQuery, bot: Bot) -> None:
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
            await message.edit_text(message.html_text + html.escape(result.message_suffix), parse_mode=ParseMode.HTML, reply_markup=None)
            with contextlib.suppress(TelegramAPIError):  # реакция — украшение, без неё отметка всё равно видна
                await bot.set_message_reaction(message.chat.id, message.message_id, reaction=[ReactionTypeEmoji(emoji="👍")])

    dispatcher = Dispatcher()
    dispatcher.include_router(router)
    return dispatcher
