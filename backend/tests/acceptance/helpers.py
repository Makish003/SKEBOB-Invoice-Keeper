"""Общие шаги приёмочных тестов (Given/When/Then по SPEC §5)."""

import asyncio
from datetime import timedelta

from fastapi.testclient import TestClient

from app.core.clock import FrozenClock
from app.core.config import get_settings
from app.core.db import get_sessionmaker
from app.models import Channel
from app.services.delivery import deliver_pending, tick
from app.services.notifiers.base import ReminderMessage

PAYMENTS = "/api/v1/recurring-payments"
OCCURRENCES = "/api/v1/payment-occurrences"


class RecordingNotifier:
    """Вместо Telegram: запоминает отправленные сообщения."""

    channel = Channel.console

    def __init__(self) -> None:
        self.sent: list[ReminderMessage] = []

    async def send(self, message: ReminderMessage) -> str | None:
        self.sent.append(message)
        return None


def check_reminders(clock: FrozenClock, notifier: RecordingNotifier, *, with_tick: bool = True) -> None:
    """Одна «проверка» воркера: плановый тик (если нужен) и отправка очереди."""
    settings = get_settings()
    if with_tick:
        with get_sessionmaker()() as db:
            tick(db, clock.today(), settings)
    asyncio.run(
        deliver_pending(get_sessionmaker(), clock.today(), settings, {Channel.console: notifier}, now=clock.now() + timedelta(hours=2))
    )


def create_payment(client: TestClient, headers: dict[str, str], **fields: str) -> dict:
    body = {"name": "Аренда офиса", "amount": "85000.00", "currency": "RUB", "first_due_date": "2026-10-26", **fields}
    response = client.post(PAYMENTS, json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def periods(client: TestClient, headers: dict[str, str], payment_id: int, **params: object) -> list[dict]:
    response = client.get(OCCURRENCES, params={"recurring_payment_id": payment_id, **params}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["items"]
