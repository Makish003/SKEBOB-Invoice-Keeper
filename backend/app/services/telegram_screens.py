"""Экраны Telegram-бота: упрощённая панель прямо в чате (FR-B10).

Экран — HTML-текст и inline-клавиатура. Навигация редактирует одно сообщение, ссылки ведут в нужный раздел панели.
Цвет кнопок — поле style Bot API: primary — главное действие экрана, success — «Оплачено», danger — просрочки и
снятие отметки. Запросы синхронные: бот вызывает экраны через asyncio.to_thread.
"""

import enum
import html
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Any
from urllib.parse import urlencode, urlsplit

from aiogram.enums import ButtonStyle
from aiogram.filters.callback_data import CallbackData
from aiogram.types import CopyTextButton, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from sqlalchemy import ColumnElement, func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.domain.status import DisplayStatus
from app.models import Currency, OccurrenceStatus, PaymentOccurrence, Period, RecurringPayment
from app.schemas.payments import Occurrence
from app.services.notifiers.base import ago_text, format_amount, when_text
from app.services.occurrences import get_occurrence, next_occurrences, occurrence_query, to_schema
from app.services.summary import currency_summaries

PAGE_SIZE = 5
UPCOMING_DAYS = 30
WEEK_DAYS = 7
BAR_WIDTH = 10

HOME = "home"
NOOP = "noop"

MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]
MONTHS_GENITIVE = [
    "января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"
]  # fmt: skip
WEEKDAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]
PERIODS = {
    Period.monthly: "Ежемесячно",
    Period.weekly: "Еженедельно",
    Period.quarterly: "Ежеквартально",
    Period.yearly: "Ежегодно",
}
# Те же статусы и тона, что у бейджей панели (StatusBadge.tsx).
STATUS = {
    DisplayStatus.paid: ("🟢", "Оплачен"),
    DisplayStatus.paid_late: ("🟡", "Оплачен с опозданием"),
    DisplayStatus.upcoming: ("⚪️", "Ожидает"),
    DisplayStatus.due_soon: ("🔵", "Скоро срок"),
    DisplayStatus.due_today: ("🟠", "Срок сегодня"),
    DisplayStatus.overdue: ("🔴", "Просрочен"),
}


class Kind(enum.StrEnum):
    upcoming = "up"
    overdue = "od"
    payments = "pl"


class Action(enum.StrEnum):
    pay = "pay"
    ask_unpay = "ask"
    unpay = "unpay"


class ListCb(CallbackData, prefix="ls"):
    kind: Kind
    page: int = 0


class MonthCb(CallbackData, prefix="mo"):
    year: int
    month: int


class CardCb(CallbackData, prefix="oc"):
    id: int
    kind: Kind = Kind.upcoming  # куда ведёт «Назад»
    page: int = 0


class ActCb(CallbackData, prefix="ac"):
    action: Action
    id: int
    kind: Kind = Kind.upcoming
    page: int = 0


@dataclass(frozen=True)
class Links:
    """Ссылки на панель. Telegram отклоняет в кнопках localhost и 127.0.0.1 — тогда кнопка копирует адрес."""

    base: str

    @property
    def clickable(self) -> bool:
        host = urlsplit(self.base).hostname or ""
        return "." in host and not host.startswith("127.")

    @property
    def web_app(self) -> bool:
        """Mini App принимает только HTTPS."""
        return self.clickable and self.base.startswith("https://")

    def url(self, path: str = "/", **params: str) -> str:
        return f"{self.base}{path}" + (f"?{urlencode(params)}" if params else "")

    def button(self, text: str, path: str = "/", **params: str) -> InlineKeyboardButton | None:
        return InlineKeyboardButton(text=text, url=self.url(path, **params)) if self.clickable else None


@dataclass(frozen=True)
class View:
    today: date
    settings: Settings
    links: Links
    private: bool = False  # Mini App (web_app) открывается только из личного чата с ботом


@dataclass(frozen=True)
class Screen:
    text: str
    markup: InlineKeyboardMarkup


@dataclass(frozen=True)
class Totals:
    count: int
    sums: dict[Currency, Decimal]


def plural(n: int, one: str, few: str, many: str) -> str:
    if n % 10 == 1 and n % 100 != 11:
        return f"{n} {one}"
    if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14):
        return f"{n} {few}"
    return f"{n} {many}"


def money(sums: dict[Currency, Decimal]) -> str:
    return " + ".join(f"{format_amount(sums[c])} {c}" for c in Currency if sums.get(c)) or "0"


def month_end(day: date) -> date:
    return (day.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)


def shift_month(year: int, month: int, delta: int) -> tuple[int, int]:
    index = year * 12 + month - 1 + delta
    return index // 12, index % 12 + 1


def _btn(text: str, data: str | CallbackData, style: ButtonStyle | None = None) -> InlineKeyboardButton:
    return InlineKeyboardButton(
        text=text, callback_data=data if isinstance(data, str) else data.pack(), style=style
    )


def _keyboard(*rows: list[InlineKeyboardButton | None]) -> InlineKeyboardMarkup:
    cleaned = [[b for b in row if b is not None] for row in rows]
    return InlineKeyboardMarkup(inline_keyboard=[row for row in cleaned if row])


def _short(text: str, limit: int = 28) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _unpaid_totals(db: Session, *where: ColumnElement[bool]) -> Totals:
    rows = db.execute(
        select(PaymentOccurrence.currency, func.count(), func.sum(PaymentOccurrence.amount))
        .join(RecurringPayment, RecurringPayment.id == PaymentOccurrence.recurring_payment_id)
        .where(RecurringPayment.deleted_at.is_(None), PaymentOccurrence.status == OccurrenceStatus.unpaid, *where)
        .group_by(PaymentOccurrence.currency)
    ).all()
    return Totals(sum(count for _, count, _ in rows), {currency: Decimal(total) for currency, _, total in rows})


def _list_conditions(kind: Kind, today: date) -> tuple[ColumnElement[bool], ...]:
    due = PaymentOccurrence.due_date
    if kind is Kind.overdue:
        return (due < today,)
    return (due >= today, due <= today + timedelta(days=UPCOMING_DAYS))


def _panel_button(view: View) -> InlineKeyboardButton:
    if view.private and view.links.web_app:
        return InlineKeyboardButton(text="🌐 Открыть панель", web_app=WebAppInfo(url=view.links.url()))
    return view.links.button("🌐 Открыть панель") or InlineKeyboardButton(
        text="🌐 Скопировать адрес панели", copy_text=CopyTextButton(text=view.links.base)
    )


def _menu_button() -> InlineKeyboardButton:
    return _btn("🏠 Меню", HOME)


def _stat(icon: str, label: str, totals: Totals) -> str:
    return f"{icon} {label}: <b>{totals.count}</b>" + (f" · {money(totals.sums)}" if totals.count else "")


# --- Главное меню ---


def home(db: Session, view: View) -> Screen:
    today = view.today
    due = PaymentOccurrence.due_date
    overdue = _unpaid_totals(db, due < today)
    week = _unpaid_totals(db, due >= today, due <= today + timedelta(days=WEEK_DAYS))
    rest_of_month = _unpaid_totals(db, due >= today, due <= month_end(today))

    lines = [
        "<b>Invoice Keeper</b> · платежи команды",
        f"Сегодня {today:%d.%m.%Y}, {WEEKDAYS[today.weekday()]}",
        "",
        _stat("🔴", "Просрочено", overdue) if overdue.count else "🟢 Просрочек нет",
        _stat("🟠", f"Ближайшие {WEEK_DAYS} дней", week),
        _stat("📅", f"До конца {MONTHS_GENITIVE[today.month - 1]}", rest_of_month),
        "",
        f"<i>Напоминаю в чат за {plural(view.settings.reminder_days_before, 'день', 'дня', 'дней')} до срока.</i>",
    ]
    if not view.links.clickable:
        lines.append(f"Панель: <code>{html.escape(view.links.base)}</code>")
    overdue_button = (
        _btn(f"🔴 Просрочено · {overdue.count}", ListCb(kind=Kind.overdue), ButtonStyle.DANGER)
        if overdue.count
        else _btn("Просрочек нет", ListCb(kind=Kind.overdue))
    )
    markup = _keyboard(
        [_btn("⏰ Ближайшие сроки", ListCb(kind=Kind.upcoming), ButtonStyle.PRIMARY)],
        [overdue_button],
        [_btn("📊 Итоги месяца", MonthCb(year=today.year, month=today.month)), _btn("📋 Платежи", ListCb(kind=Kind.payments))],
        [_panel_button(view)],
        [_btn("🔄 Обновить", HOME)],
    )
    return Screen("\n".join(lines), markup)


# --- Списки периодов: ближайшие и просроченные ---

LIST_TITLES = {
    Kind.upcoming: (f"⏰ Ближайшие сроки · {UPCOMING_DAYS} дней", f"В ближайшие {UPCOMING_DAYS} дней платить нечего.", "due"),
    Kind.overdue: ("🔴 Просрочено", "Просрочек нет — всё оплачено вовремя.", "overdue"),
}


def _pages(total: int, page: int) -> tuple[int, int]:
    pages = max(1, -(-total // PAGE_SIZE))
    return min(max(page, 0), pages - 1), pages


def _pager(kind: Kind, page: int, pages: int) -> list[InlineKeyboardButton | None]:
    if pages <= 1:
        return []
    prev = _btn("◀", ListCb(kind=kind, page=page - 1)) if page > 0 else _btn("·", NOOP)
    after = _btn("▶", ListCb(kind=kind, page=page + 1)) if page < pages - 1 else _btn("·", NOOP)
    return [prev, _btn(f"{page + 1} / {pages}", NOOP), after]


def _when(occ: Occurrence) -> str:
    if occ.is_overdue and occ.status == OccurrenceStatus.unpaid:
        return f"срок был {ago_text(occ.overdue_days)}"
    return when_text(occ.days_until_due)


def _item_style(occ: Occurrence) -> ButtonStyle | None:
    if occ.display_status == DisplayStatus.overdue:
        return ButtonStyle.DANGER
    return ButtonStyle.PRIMARY if occ.display_status == DisplayStatus.due_today else None


def occurrence_list(db: Session, view: View, kind: Kind, page: int = 0) -> Screen:
    if kind is Kind.payments:
        return payment_list(db, view, page)
    title, empty, tab = LIST_TITLES[kind]
    conditions = _list_conditions(kind, view.today)
    totals = _unpaid_totals(db, *conditions)
    page, pages = _pages(totals.count, page)
    rows = db.execute(
        occurrence_query()
        .where(RecurringPayment.deleted_at.is_(None), PaymentOccurrence.status == OccurrenceStatus.unpaid, *conditions)
        .order_by(PaymentOccurrence.due_date, PaymentOccurrence.id)
        .limit(PAGE_SIZE)
        .offset(page * PAGE_SIZE)
    ).all()
    items = [to_schema(occ, payment, sent, view.today, view.settings) for occ, payment, sent in rows]

    lines = [f"<b>{title}</b>"]
    if not items:
        lines += ["", empty]
    else:
        lines.append(f"Не оплачено: {plural(totals.count, 'период', 'периода', 'периодов')} · {money(totals.sums)}")
    buttons = []
    for n, occ in enumerate(items, start=page * PAGE_SIZE + 1):
        icon = STATUS[occ.display_status][0]
        lines += [
            "",
            f"{n}. {icon} <b>{html.escape(occ.recurring_payment.name)}</b>",
            f"{format_amount(occ.amount)} {occ.currency} · {occ.due_date:%d.%m.%Y} · {_when(occ)}",
        ]
        card = CardCb(id=occ.id, kind=kind, page=page)
        buttons.append([_btn(f"{n} · {_short(occ.recurring_payment.name)}", card, _item_style(occ))])
    markup = _keyboard(
        *buttons, _pager(kind, page, pages), [view.links.button("🌐 В панели", "/payments", tab=tab), _menu_button()]
    )
    return Screen("\n".join(lines), markup)


# --- Список регулярных платежей ---


def payment_list(db: Session, view: View, page: int = 0) -> Screen:
    active = RecurringPayment.deleted_at.is_(None)
    total = db.scalar(select(func.count()).select_from(RecurringPayment).where(active)) or 0
    page, pages = _pages(total, page)
    payments = db.scalars(
        select(RecurringPayment)
        .where(active)
        .order_by(func.lower(RecurringPayment.name), RecurringPayment.id)
        .limit(PAGE_SIZE)
        .offset(page * PAGE_SIZE)
    ).all()
    upcoming = next_occurrences(db, view.today, view.settings)

    lines = [f"<b>📋 Платежи</b> · {plural(total, 'активный', 'активных', 'активных')}"]
    if not payments:
        lines += ["", "Регулярных платежей пока нет: добавьте их в панели."]
    buttons = []
    for n, payment in enumerate(payments, start=page * PAGE_SIZE + 1):
        nxt = upcoming.get(payment.id)
        when = f"следующий срок {nxt.due_date:%d.%m.%Y}" if nxt else "сроков впереди нет"
        lines += [
            "",
            f"{n}. <b>{html.escape(payment.name)}</b>",
            f"{format_amount(payment.amount)} {payment.currency} · {PERIODS[payment.period].lower()} · {when}",
        ]
        if nxt:
            card = CardCb(id=nxt.id, kind=Kind.payments, page=page)
            buttons.append([_btn(f"{n} · {_short(payment.name)}", card, _item_style(nxt))])
    markup = _keyboard(
        *buttons,
        _pager(Kind.payments, page, pages),
        [view.links.button("🌐 В панели", "/payments", tab="all"), _menu_button()],
    )
    return Screen("\n".join(lines), markup)


# --- Карточка периода ---


def card(db: Session, view: View, occurrence_id: int, kind: Kind, page: int, confirm_unpay: bool = False) -> Screen:
    back = _btn("⬅ Назад", ListCb(kind=kind, page=page))
    occ = get_occurrence(db, occurrence_id, view.today, view.settings)
    if occ is None:
        return Screen("Период не найден: возможно, платёж удалён.", _keyboard([back, _menu_button()]))
    payment = db.get(RecurringPayment, occ.recurring_payment.id)
    icon, label = STATUS[occ.display_status]
    if occ.display_status == DisplayStatus.paid_late:
        label += f" на {plural(occ.overdue_days, 'день', 'дня', 'дней')}"

    lines = [
        f"<b>{html.escape(occ.recurring_payment.name)}</b>",
        f"{icon} {label}",
        "",
        f"💰 <b>{format_amount(occ.amount)} {occ.currency}</b>",
        f"📅 Срок: {occ.due_date:%d.%m.%Y}" + ("" if occ.paid_at else f" · {_when(occ)}"),
        f"🔁 {PERIODS[occ.recurring_payment.period]} · период {occ.seq + 1}",
    ]
    if occ.paid_at:
        lines.append(f"✅ Оплачен {occ.paid_at:%d.%m.%Y}" + (f" · {html.escape(occ.paid_by_label)}" if occ.paid_by_label else ""))
    if occ.receipt_url or occ.receipt_file_name:
        lines.append("📎 Чек приложен")
    if occ.note:
        lines.append(f"📝 {html.escape(occ.note)}")
    if payment and payment.description:
        lines += ["", f"<blockquote expandable>{html.escape(payment.description)}</blockquote>"]
    if not occ.recurring_payment.is_active:
        lines += ["", "<i>Платёж прекращён: новые периоды не создаются.</i>"]

    act: dict[str, Any] = {"id": occ.id, "kind": kind, "page": page}
    if occ.status == OccurrenceStatus.unpaid:
        actions = [[_btn("✅ Оплачено", ActCb(action=Action.pay, **act), ButtonStyle.SUCCESS)]]
    elif confirm_unpay:
        lines += ["", "<b>Снять отметку об оплате?</b> Период снова станет неоплаченным, напоминания возобновятся."]
        actions = [
            [
                _btn("Да, снять отметку", ActCb(action=Action.unpay, **act), ButtonStyle.DANGER),
                _btn("Нет", CardCb(id=occ.id, kind=kind, page=page)),
            ]
        ]
    else:
        actions = [[_btn("↩ Отменить оплату", ActCb(action=Action.ask_unpay, **act))]]
    markup = _keyboard(
        *actions,
        [view.links.button("🌐 Открыть в панели", "/payments", tab="all", q=occ.recurring_payment.name)],
        [back, _menu_button()],
    )
    return Screen("\n".join(lines), markup)


# --- Итоги месяца ---


def _bar(paid: Decimal, total: Decimal) -> tuple[str, int]:
    percent = int(paid * 100 / total) if total else 0
    filled = percent * BAR_WIDTH // 100
    return "▰" * filled + "▱" * (BAR_WIDTH - filled), percent


def month_summary(db: Session, view: View, year: int, month: int) -> Screen:
    first = date(year, month, 1)
    last = month_end(first)
    currencies = [c for c in currency_summaries(db, first, last, view.today) if c.count_total]

    lines = [f"<b>📊 Итоги · {MONTHS[month - 1]} {year}</b>", f"Сроки {first:%d.%m}–{last:%d.%m.%Y}, состояние на {view.today:%d.%m.%Y}"]
    for c in currencies:
        bar, percent = _bar(c.paid, c.total)
        lines += [
            "",
            f"<b>{c.currency}</b> · {plural(c.count_total, 'период', 'периода', 'периодов')}",
            f"<code>{bar}</code> {percent}%",
            f"Оплачено: {format_amount(c.paid)} из {format_amount(c.total)}",
            f"Осталось: {format_amount(c.unpaid)}",
        ]
        if c.count_overdue:
            lines.append(f"🔴 Просрочено: {format_amount(c.overdue)} ({c.count_overdue})")
    if not currencies:
        lines += ["", "В этом месяце платежей нет."]

    prev_year, prev_month = shift_month(year, month, -1)
    next_year, next_month = shift_month(year, month, 1)
    current = (year, month) == (view.today.year, view.today.month)
    markup = _keyboard(
        [
            _btn(f"◀ {MONTHS[prev_month - 1]}", MonthCb(year=prev_year, month=prev_month)),
            _btn(f"{MONTHS[next_month - 1]} ▶", MonthCb(year=next_year, month=next_month)),
        ],
        [None if current else _btn("Текущий месяц", MonthCb(year=view.today.year, month=view.today.month))],
        [view.links.button("📈 Отчёты в панели", "/reports"), _menu_button()],
    )
    return Screen("\n".join(lines), markup)
