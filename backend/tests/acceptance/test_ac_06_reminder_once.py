"""AC-6 Напоминание: срок через ≤ 3 дня → ровно одно сообщение с названием, суммой, валютой, датой; повторные
проверки дублей не создают."""

from datetime import date
from decimal import Decimal

from fastapi.testclient import TestClient

from app.core.clock import FrozenClock
from app.services.notifiers.base import format_message
from tests.acceptance.helpers import RecordingNotifier, check_reminders, create_payment


def test_one_message_with_required_fields(client: TestClient, clock: FrozenClock, admin_headers: dict[str, str]) -> None:
    create_payment(client, admin_headers, name="Сервер Hetzner", amount="49.90", currency="USD", first_due_date="2026-11-15")
    notifier = RecordingNotifier()
    for day in (date(2026, 11, 11), date(2026, 11, 12), date(2026, 11, 12), date(2026, 11, 14), date(2026, 11, 15)):
        clock.set(day)
        check_reminders(clock, notifier)
    assert len(notifier.sent) == 1
    message = notifier.sent[0]
    assert (message.payment_name, message.amount, message.currency, message.due_date) == (
        "Сервер Hetzner",
        Decimal("49.90"),
        "USD",
        date(2026, 11, 15),
    )
    assert message.days_until_due == 3  # не позднее чем за 3 дня
    text = format_message(message)
    assert all(part in text for part in ("Сервер Hetzner", "49,90 USD", "15.11.2026"))
