"""Бот целиком: апдейты Telegram → диспетчер → БД → запросы Bot API (сеть заменена записывающей сессией)."""

import asyncio
from collections.abc import AsyncGenerator
from datetime import UTC, date, datetime
from typing import Any

import pytest
from aiogram import Bot
from aiogram.client.session.base import BaseSession
from aiogram.methods import (
    AnswerCallbackQuery,
    EditMessageText,
    GetChatMember,
    GetMyDescription,
    GetMyShortDescription,
    SendMessage,
    SetChatMenuButton,
    SetMessageReaction,
    SetMyCommands,
    SetMyDescription,
    TelegramMethod,
)
from aiogram.types import (
    BotDescription,
    BotShortDescription,
    Chat,
    ChatMemberLeft,
    ChatMemberMember,
    InlineKeyboardMarkup,
    MenuButtonCommands,
    MenuButtonWebApp,
    Message,
    ReplyKeyboardMarkup,
    Update,
    User,
)
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.clock import FrozenClock
from app.core.config import Settings
from app.core.db import get_sessionmaker
from app.models import OccurrenceStatus, PaymentOccurrence
from app.services.telegram_actions import pay_callback_data
from app.services.telegram_screens import ActCb, Action, Kind
from app.worker.bot import Access, build_dispatcher, configure
from tests.acceptance.helpers import create_payment, periods

CHAT = -100777
MEMBER, STRANGER = 5, 6
SECRET = "test-secret"
SENT_AT = int(datetime(2026, 10, 23, 9, tzinfo=UTC).timestamp())


class RecordingSession(BaseSession):
    """Вместо сети: запоминает вызовы Bot API и отвечает правдоподобными объектами."""

    def __init__(self, members: set[int] | None = None) -> None:
        super().__init__()
        self.members = members or set()
        self.calls: list[TelegramMethod[Any]] = []

    async def make_request(self, bot: Bot, method: TelegramMethod[Any], timeout: int | None = None) -> Any:
        self.calls.append(method)
        if isinstance(method, SendMessage | EditMessageText):
            chat = Chat(id=int(method.chat_id or CHAT), type="private" if int(method.chat_id or CHAT) > 0 else "supergroup")
            return Message(message_id=100, date=datetime.fromtimestamp(SENT_AT, UTC), chat=chat, text=method.text)
        if isinstance(method, GetChatMember):
            user = User(id=method.user_id, is_bot=False, first_name="U")
            return ChatMemberMember(user=user) if method.user_id in self.members else ChatMemberLeft(user=user)
        if isinstance(method, GetMyDescription):
            return BotDescription(description="")
        if isinstance(method, GetMyShortDescription):
            return BotShortDescription(short_description="")
        return True

    async def close(self) -> None:
        pass

    async def stream_content(self, *args: Any, **kwargs: Any) -> AsyncGenerator[bytes, None]:
        yield b""

    def of(self, kind: type) -> list[Any]:
        return [call for call in self.calls if isinstance(call, kind)]


def settings(**overrides: Any) -> Settings:
    return Settings(**{"telegram_chat_id": str(CHAT), "secret_key": SECRET, "public_url": "https://keeper.example.com", **overrides})


def user(user_id: int) -> dict[str, Any]:
    return {"id": user_id, "is_bot": False, "first_name": "Иван", "username": "ivan"}


def chat(chat_id: int) -> dict[str, Any]:
    return {"id": chat_id, "type": "private" if chat_id > 0 else "supergroup"}


def text_update(text: str, chat_id: int = CHAT, user_id: int = MEMBER) -> dict[str, Any]:
    entities = [{"type": "bot_command", "offset": 0, "length": len(text.split()[0])}] if text.startswith("/") else []
    message = {"message_id": 10, "date": SENT_AT, "chat": chat(chat_id), "from": user(user_id), "text": text, "entities": entities}
    return {"update_id": 1, "message": message}


def callback_update(data: str, chat_id: int = CHAT, user_id: int = MEMBER, text: str = "Экран") -> dict[str, Any]:
    message = {"message_id": 11, "date": SENT_AT, "chat": chat(chat_id), "text": text}
    query = {"id": "cb", "from": user(user_id), "chat_instance": "ci", "data": data, "message": message}
    return {"update_id": 2, "callback_query": query}


def feed(update: dict[str, Any], members: set[int] | None = None, **overrides: Any) -> RecordingSession:
    session = RecordingSession(members)
    bot = Bot("42:TEST", session=session)
    dispatcher = build_dispatcher(get_sessionmaker(), FrozenClock(date(2026, 10, 23)), settings(**overrides))
    asyncio.run(dispatcher.feed_update(bot, Update.model_validate(update, context={"bot": bot})))
    return session


@pytest.fixture
def occurrence(client: TestClient, admin_headers: dict[str, str]) -> int:
    payment = create_payment(client, admin_headers, first_due_date="2026-10-25")
    return periods(client, admin_headers, payment["id"])[0]["id"]


def test_command_in_team_chat_sends_styled_screen(occurrence: int) -> None:
    session = feed(text_update("/upcoming"))
    [sent] = session.of(SendMessage)
    assert sent.chat_id == CHAT and "Ближайшие сроки" in sent.text and "Аренда офиса" in sent.text
    assert isinstance(sent.reply_markup, InlineKeyboardMarkup)
    assert sent.link_preview_options is not None and sent.link_preview_options.is_disabled
    assert session.of(GetChatMember) == []  # командный чат проверяется по id, без запроса


def test_private_chat_of_non_member_is_denied(occurrence: int) -> None:
    session = feed(text_update("/menu", chat_id=STRANGER, user_id=STRANGER))
    [sent] = session.of(SendMessage)
    assert "участникам командного чата" in sent.text and sent.reply_markup is None
    assert session.of(GetChatMember)[0].user_id == STRANGER


def test_start_in_private_chat_of_member_adds_reply_keyboard(occurrence: int) -> None:
    session = feed(text_update("/start", chat_id=MEMBER), members={MEMBER})
    greeting, menu = session.of(SendMessage)
    keyboard = greeting.reply_markup
    assert isinstance(keyboard, ReplyKeyboardMarkup) and keyboard.is_persistent
    assert [(b.text, b.style) for b in keyboard.keyboard[0]] == [("⏰ Ближайшие", "primary"), ("🔴 Просрочено", "danger")]
    assert "Invoice Keeper" in menu.text
    # в личном чате и по HTTPS панель открывается как Mini App
    assert any(b.web_app for row in menu.reply_markup.inline_keyboard for b in row)  # type: ignore[union-attr]


def test_reply_button_opens_screen(occurrence: int) -> None:
    session = feed(text_update("📊 Итоги", chat_id=MEMBER), members={MEMBER})
    assert "Итоги · Октябрь 2026" in session.of(SendMessage)[0].text


def test_start_without_chat_configured_explains_setup() -> None:
    session = feed(text_update("/start", chat_id=MEMBER), telegram_chat_id="")
    assert "/chatid" in session.of(SendMessage)[0].text


def test_card_pay_button_marks_paid_and_redraws(occurrence: int, db: Session) -> None:
    data = ActCb(action=Action.pay, id=occurrence, kind=Kind.upcoming).pack()
    session = feed(callback_update(data))
    assert db.get(PaymentOccurrence, occurrence).status == OccurrenceStatus.paid  # type: ignore[union-attr]
    [edit] = session.of(EditMessageText)
    assert "🟢 Оплачен" in edit.text and "Telegram @ivan" in edit.text
    assert any(b.text == "↩ Отменить оплату" for row in edit.reply_markup.inline_keyboard for b in row)  # type: ignore[union-attr]
    assert session.of(AnswerCallbackQuery)[0].text == "Отмечено как оплаченное"


def test_card_button_from_stranger_changes_nothing(occurrence: int, db: Session) -> None:
    data = ActCb(action=Action.pay, id=occurrence, kind=Kind.upcoming).pack()
    session = feed(callback_update(data, chat_id=STRANGER, user_id=STRANGER))
    assert db.get(PaymentOccurrence, occurrence).status == OccurrenceStatus.unpaid  # type: ignore[union-attr]
    assert session.of(EditMessageText) == [] and session.of(AnswerCallbackQuery)[0].show_alert


def test_reminder_pay_button_edits_message_and_reacts(occurrence: int) -> None:
    session = feed(callback_update(pay_callback_data(occurrence, SECRET), text="Напоминание об оплате"))
    [edit] = session.of(EditMessageText)
    assert edit.text.startswith("Напоминание об оплате") and "оплачено @ivan 23.10.2026" in edit.text
    assert session.of(SetMessageReaction)[0].reaction[0].emoji == "👍"  # type: ignore[union-attr]


def test_chatid_offers_copy_button() -> None:
    session = feed(text_update("/chatid", chat_id=-100555), telegram_chat_id="")
    button = session.of(SendMessage)[0].reply_markup.inline_keyboard[0][0]  # type: ignore[union-attr]
    assert button.copy_text.text == "TELEGRAM_CHAT_ID=-100555" and button.style == "primary"


def test_configure_sets_commands_descriptions_and_menu_button() -> None:
    session = RecordingSession()
    asyncio.run(configure(Bot("42:TEST", session=session), settings()))
    assert {c.command for c in session.of(SetMyCommands)[0].commands} >= {"menu", "upcoming", "overdue", "summary"}
    assert session.of(SetMyDescription)
    menu = session.of(SetChatMenuButton)[0].menu_button
    assert isinstance(menu, MenuButtonWebApp) and menu.web_app.url == "https://keeper.example.com/"

    local = RecordingSession()
    asyncio.run(configure(Bot("42:TEST", session=local), settings(public_url="http://localhost:8080")))
    assert isinstance(local.of(SetChatMenuButton)[0].menu_button, MenuButtonCommands)


def test_access_caches_membership_for_ttl() -> None:
    session, now = RecordingSession({MEMBER}), [0.0]
    bot, access = Bot("42:TEST", session=session), Access(str(CHAT), now=lambda: now[0])
    private = Chat(id=MEMBER, type="private")
    assert asyncio.run(access.allows(bot, private, MEMBER))
    assert asyncio.run(access.allows(bot, private, MEMBER)) and len(session.of(GetChatMember)) == 1
    now[0] = Access.TTL_SECONDS + 1
    asyncio.run(access.allows(bot, private, MEMBER))
    assert len(session.of(GetChatMember)) == 2
    # чужая группа — без запроса и без доступа
    assert not asyncio.run(access.allows(bot, Chat(id=-100999, type="supergroup"), MEMBER))
    assert len(session.of(GetChatMember)) == 2
