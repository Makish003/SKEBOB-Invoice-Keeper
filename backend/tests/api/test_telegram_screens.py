"""Экраны Telegram-бота на реальной БД: сводка, списки, карточка, итоги, ссылки и цвет кнопок."""

from datetime import date

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.db import get_sessionmaker
from app.services.telegram_screens import (
    ActCb,
    Action,
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
    shift_month,
)
from tests.acceptance.helpers import OCCURRENCES, create_payment, periods

TODAY = date(2026, 10, 23)
LOCAL = Links("http://localhost:8080")
PUBLIC = Links("https://keeper.example.com")


def view(links: Links = LOCAL, private: bool = False, today: date = TODAY) -> View:
    return View(today, get_settings(), links, private)


def buttons(markup: InlineKeyboardMarkup) -> list[InlineKeyboardButton]:
    return [b for row in markup.inline_keyboard for b in row]


def by_text(screen: Screen, start: str) -> InlineKeyboardButton:
    return next(b for b in buttons(screen.markup) if b.text.startswith(start))


def render(build, *args, **kwargs) -> Screen:  # type: ignore[no-untyped-def]
    with get_sessionmaker()() as db:
        return build(db, *args, **kwargs)


def seed(client: TestClient, headers: dict[str, str]) -> dict[str, int]:
    """Срок сегодня (USD), через 2 дня, просрочка 13 дней, оплаченный — и id их первых периодов."""
    ids = {}
    for key, fields in {
        "today": {"name": "Hetzner", "amount": "49.90", "currency": "USD", "first_due_date": "2026-10-23"},
        "soon": {"name": "Аренда офиса", "amount": "85000.00", "first_due_date": "2026-10-25", "description": "Договор №7"},
        "overdue": {"name": "Интернет", "amount": "3000.00", "first_due_date": "2026-10-10"},
        "paid": {"name": "Бухгалтерия", "amount": "12000.00", "first_due_date": "2026-10-27"},
    }.items():
        ids[key] = periods(client, headers, create_payment(client, headers, **fields)["id"])[0]["id"]
    client.patch(f"{OCCURRENCES}/{ids['paid']}", json={"status": "paid"}, headers=headers)
    return ids


def test_all_callback_data_fits_telegram_limit() -> None:
    longest = ActCb(action=Action.ask_unpay, id=2**31, kind=Kind.payments, page=999).pack()
    assert len(longest.encode()) <= 64
    assert ListCb.unpack(ListCb(kind=Kind.overdue, page=2).pack()) == ListCb(kind=Kind.overdue, page=2)
    assert CardCb.unpack(CardCb(id=5, kind=Kind.payments, page=1).pack()).kind is Kind.payments


def test_links_skip_addresses_telegram_rejects() -> None:
    assert not LOCAL.clickable and not Links("http://127.0.0.1:8080").clickable
    assert PUBLIC.clickable and PUBLIC.web_app and not Links("http://keeper.example.com").web_app
    assert LOCAL.button("x") is None
    assert PUBLIC.url("/payments", tab="all", q="Аренда офиса") == "https://keeper.example.com/payments?tab=all&q=%D0%90%D1%80%D0%B5%D0%BD%D0%B4%D0%B0+%D0%BE%D1%84%D0%B8%D1%81%D0%B0"


def test_home_shows_counts_and_styled_buttons(client: TestClient, admin_headers: dict[str, str]) -> None:
    seed(client, admin_headers)
    screen = render(home, view())
    assert "23.10.2026, пятница" in screen.text
    assert "Просрочено: <b>1</b> · 3 000,00 RUB" in screen.text
    # 7 дней: Hetzner сегодня и аренда; оплаченная бухгалтерия не считается
    assert "Ближайшие 7 дней: <b>2</b> · 85 000,00 RUB + 49,90 USD" in screen.text
    assert "До конца октября: <b>2</b>" in screen.text
    assert by_text(screen, "⏰ Ближайшие").style == "primary"
    assert by_text(screen, "🔴 Просрочено · 1").style == "danger"
    # localhost Telegram не примет: адрес копируется и виден в тексте
    panel = by_text(screen, "🌐")
    assert panel.copy_text is not None and panel.copy_text.text == "http://localhost:8080" and panel.url is None
    assert "<code>http://localhost:8080</code>" in screen.text


def test_home_without_overdue_and_panel_links(client: TestClient, admin_headers: dict[str, str]) -> None:
    screen = render(home, view(PUBLIC))
    assert "Просрочек нет" in screen.text and by_text(screen, "Просрочек нет").style is None
    assert by_text(screen, "🌐 Открыть панель").url == "https://keeper.example.com/"
    private = render(home, view(PUBLIC, private=True))
    assert by_text(private, "🌐 Открыть панель").web_app.url == "https://keeper.example.com/"  # type: ignore[union-attr]


def test_upcoming_list_orders_by_due_and_links_to_card(client: TestClient, admin_headers: dict[str, str]) -> None:
    ids = seed(client, admin_headers)
    screen = render(occurrence_list, view(PUBLIC), Kind.upcoming)
    assert screen.text.index("Hetzner") < screen.text.index("Аренда офиса")
    # просроченный период 10.10 и оплаченная бухгалтерия — не здесь; ноябрьский период интернета — через 18 дней
    assert "10.10.2026" not in screen.text and "Бухгалтерия" not in screen.text
    assert "3 000,00 RUB · 10.11.2026 · через 18 дней" in screen.text
    assert "49,90 USD · 23.10.2026 · сегодня" in screen.text and "через 2 дня" in screen.text
    first = by_text(screen, "1 · Hetzner")
    assert first.style == "primary"  # срок сегодня
    assert CardCb.unpack(first.callback_data or "") == CardCb(id=ids["today"], kind=Kind.upcoming, page=0)
    assert by_text(screen, "🌐 В панели").url == "https://keeper.example.com/payments?tab=due"


def test_overdue_list_is_red_and_empty_state(client: TestClient, admin_headers: dict[str, str]) -> None:
    empty = render(occurrence_list, view(), Kind.overdue)
    assert "Просрочек нет" in empty.text and not any(b.text.startswith("1 ·") for b in buttons(empty.markup))
    seed(client, admin_headers)
    screen = render(occurrence_list, view(), Kind.overdue)
    assert "Интернет" in screen.text and "срок был 13 дней назад" in screen.text
    assert by_text(screen, "1 · Интернет").style == "danger"
    assert not any(b.text.startswith("🌐") for b in buttons(screen.markup))  # localhost — без ссылки


def test_list_pagination(client: TestClient, admin_headers: dict[str, str]) -> None:
    for n in range(7):
        create_payment(client, admin_headers, name=f"Платёж {n}", first_due_date=f"2026-10-{24 + n}")
    first = render(occurrence_list, view(), Kind.upcoming)
    assert "7 периодов" in first.text and "5. " in first.text and "6. " not in first.text
    assert [b.text for b in first.markup.inline_keyboard[5]] == ["·", "1 / 2", "▶"]
    second = render(occurrence_list, view(), Kind.upcoming, 1)
    assert "6. " in second.text and "Платёж 6" in second.text
    assert [b.text for b in second.markup.inline_keyboard[2]] == ["◀", "2 / 2", "·"]
    assert "6. " in render(occurrence_list, view(), Kind.upcoming, 99).text  # страница за краем — последняя


def test_card_unpaid_paid_and_confirm(client: TestClient, admin_headers: dict[str, str]) -> None:
    ids = seed(client, admin_headers)
    unpaid = render(card, view(PUBLIC), ids["soon"], Kind.upcoming, 0)
    assert "<b>Аренда офиса</b>" in unpaid.text and "🔵 Скоро срок" in unpaid.text
    assert "💰 <b>85 000,00 RUB</b>" in unpaid.text and "Срок: 25.10.2026 · через 2 дня" in unpaid.text
    assert "<blockquote expandable>Договор №7</blockquote>" in unpaid.text
    pay = by_text(unpaid, "✅ Оплачено")
    assert pay.style == "success" and ActCb.unpack(pay.callback_data or "").action is Action.pay
    assert "q=%D0%90%D1%80" in (by_text(unpaid, "🌐 Открыть в панели").url or "")
    assert ListCb.unpack(by_text(unpaid, "⬅ Назад").callback_data or "") == ListCb(kind=Kind.upcoming, page=0)

    paid = render(card, view(), ids["paid"], Kind.payments, 2)
    assert "🟢 Оплачен" in paid.text and "✅ Оплачен 23.10.2026 · Администратор" in paid.text
    undo = by_text(paid, "↩ Отменить оплату")
    assert undo.style is None and ActCb.unpack(undo.callback_data or "").action is Action.ask_unpay
    confirm = render(card, view(), ids["paid"], Kind.payments, 2, confirm_unpay=True)
    assert "Снять отметку об оплате?" in confirm.text
    assert by_text(confirm, "Да, снять отметку").style == "danger"


def test_card_escapes_html_and_handles_missing(client: TestClient, admin_headers: dict[str, str]) -> None:
    payment = create_payment(client, admin_headers, name="<b>Хак</b> & Co")
    occ = periods(client, admin_headers, payment["id"])[0]["id"]
    assert "&lt;b&gt;Хак&lt;/b&gt; &amp; Co" in render(card, view(), occ, Kind.upcoming, 0).text
    missing = render(card, view(), 999999, Kind.overdue, 0)
    assert "не найден" in missing.text and by_text(missing, "⬅ Назад")


def test_payments_list_shows_next_due(client: TestClient, admin_headers: dict[str, str]) -> None:
    ids = seed(client, admin_headers)
    screen = render(occurrence_list, view(), Kind.payments)
    assert "4 активных" in screen.text
    assert screen.text.index("Аренда офиса") < screen.text.index("Бухгалтерия") < screen.text.index("Интернет")
    assert "3 000,00 RUB · ежемесячно · следующий срок 10.11.2026" in screen.text
    rent = next(b for b in buttons(screen.markup) if b.text.endswith("· Аренда офиса"))  # латиница — по правилам сортировки БД
    assert CardCb.unpack(rent.callback_data or "") == CardCb(id=ids["soon"], kind=Kind.payments, page=0)


def test_month_summary_and_navigation(client: TestClient, admin_headers: dict[str, str]) -> None:
    seed(client, admin_headers)
    screen = render(month_summary, view(), 2026, 10)
    assert "Итоги · Октябрь 2026" in screen.text
    assert "<b>RUB</b> · 3 периода" in screen.text and "Оплачено: 12 000,00 из 100 000,00" in screen.text
    assert "<code>▰▱▱▱▱▱▱▱▱▱</code> 12%" in screen.text and "🔴 Просрочено: 3 000,00 (1)" in screen.text
    assert "<b>USD</b> · 1 период" in screen.text and "EUR" not in screen.text
    assert MonthCb.unpack(by_text(screen, "◀ Сентябрь").callback_data or "") == MonthCb(year=2026, month=9)
    assert not any(b.text == "Текущий месяц" for b in buttons(screen.markup))
    empty = render(month_summary, view(), 2027, 1)
    assert "платежей нет" in empty.text and MonthCb.unpack(by_text(empty, "◀ Декабрь").callback_data or "").year == 2026
    assert by_text(empty, "Текущий месяц")


def test_plural_and_month_shift() -> None:
    assert [plural(n, "день", "дня", "дней") for n in (1, 2, 5, 11, 21, 22, 112)] == [
        "1 день", "2 дня", "5 дней", "11 дней", "21 день", "22 дня", "112 дней"
    ]  # fmt: skip
    assert shift_month(2026, 1, -1) == (2025, 12) and shift_month(2026, 12, 1) == (2027, 1)
