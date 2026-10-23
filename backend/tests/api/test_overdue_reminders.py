"""X-10: напоминания о просрочке — раз в день до оплаты, не больше OVERDUE_REMINDER_MAX; upcoming по-прежнему одно."""

import asyncio
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import FrozenClock
from app.core.config import get_settings
from app.core.db import get_sessionmaker
from app.models import Channel, Reminder, ReminderKind
from app.services.delivery import deliver_pending, tick
from app.services.notifiers.base import ReminderMessage, format_message


class Recorder:
    channel = Channel.console

    def __init__(self) -> None:
        self.sent: list[ReminderMessage] = []

    async def send(self, message: ReminderMessage) -> str | None:
        self.sent.append(message)
        return None


def check(clock: FrozenClock, notifier: Recorder, settings_override: dict | None = None) -> None:
    settings = get_settings().model_copy(update=settings_override or {})
    with get_sessionmaker()() as db:
        tick(db, clock.today(), settings)
    asyncio.run(deliver_pending(get_sessionmaker(), clock.today(), settings, {Channel.console: notifier}, now=clock.now() + timedelta(hours=3)))


def create(client: TestClient, headers: dict[str, str], due: str) -> int:
    payment = client.post(
        "/api/v1/recurring-payments",
        json={"name": "Сервер Hetzner", "amount": "49.90", "currency": "USD", "first_due_date": due},
        headers=headers,
    ).json()
    return client.get("/api/v1/payment-occurrences", params={"recurring_payment_id": payment["id"]}, headers=headers).json()[
        "items"
    ][0]["id"]


def test_daily_overdue_reminders_up_to_max(client: TestClient, clock: FrozenClock, admin_headers: dict[str, str]) -> None:
    create(client, admin_headers, "2026-10-26")
    notifier = Recorder()
    for day in range(23, 32):  # с 23.10 по 31.10, по две проверки в день
        clock.set(date(2026, 10, day))
        check(clock, notifier)
        check(clock, notifier)
    kinds = [(m.kind, m.days_until_due) for m in notifier.sent]
    assert kinds == [("upcoming", 3), ("overdue", -1), ("overdue", -2), ("overdue", -3)]


def test_overdue_stops_after_payment(client: TestClient, clock: FrozenClock, admin_headers: dict[str, str]) -> None:
    occ = create(client, admin_headers, "2026-10-20")  # уже просрочен на 3 дня
    notifier = Recorder()
    check(clock, notifier)
    client.patch(f"/api/v1/payment-occurrences/{occ}", json={"status": "paid"}, headers=admin_headers)
    clock.set(date(2026, 10, 24))
    check(clock, notifier)
    assert [m.kind for m in notifier.sent] == ["overdue"]


def test_overdue_reminders_can_be_disabled(
    client: TestClient, db: Session, clock: FrozenClock, admin_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "overdue_reminder_max", 0)
    create(client, admin_headers, "2026-10-20")
    notifier = Recorder()
    check(clock, notifier, {"overdue_reminder_max": 0})
    assert notifier.sent == []
    assert db.scalar(select(Reminder).where(Reminder.kind == ReminderKind.overdue)) is None


def test_overdue_message_text() -> None:
    message = ReminderMessage(1, 2, "Сервер Hetzner", __import__("decimal").Decimal("49.90"), "USD", date(2026, 10, 20), -3, "overdue")
    text = format_message(message)
    assert "Просрочена оплата" in text and "20.10.2026" in text and "3 дня назад" in text
