"""AC-8 Оплачено → без напоминания: период оплачен до входа в окно 3 дней."""

from datetime import date

from fastapi.testclient import TestClient

from app.core.clock import FrozenClock
from tests.acceptance.helpers import OCCURRENCES, RecordingNotifier, check_reminders, create_payment, periods


def test_paid_period_gets_no_reminder(client: TestClient, clock: FrozenClock, admin_headers: dict[str, str]) -> None:
    payment = create_payment(client, admin_headers, first_due_date="2026-11-20")
    occ = periods(client, admin_headers, payment["id"])[0]
    client.patch(f"{OCCURRENCES}/{occ['id']}", json={"status": "paid"}, headers=admin_headers)
    notifier = RecordingNotifier()
    for day in (date(2026, 11, 17), date(2026, 11, 19), date(2026, 11, 20)):
        clock.set(day)
        check_reminders(clock, notifier)
    assert notifier.sent == []
