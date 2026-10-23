"""AC-14 Удаление: после удаления проверки не создают новых напоминаний и периодов; прошлые периоды и оплаты видны."""

from datetime import date

from fastapi.testclient import TestClient

from app.core.clock import FrozenClock
from tests.acceptance.helpers import OCCURRENCES, PAYMENTS, RecordingNotifier, check_reminders, create_payment, periods


def test_deleted_payment_is_silent_and_history_stays(
    client: TestClient, clock: FrozenClock, admin_headers: dict[str, str]
) -> None:
    payment = create_payment(client, admin_headers, first_due_date="2026-09-26")
    september = periods(client, admin_headers, payment["id"])[0]
    client.patch(
        f"{OCCURRENCES}/{september['id']}", json={"status": "paid", "paid_at": "2026-09-25"}, headers=admin_headers
    )

    assert client.delete(f"{PAYMENTS}/{payment['id']}", headers=admin_headers).status_code == 204

    notifier = RecordingNotifier()
    for day in (date(2026, 10, 24), date(2026, 11, 24), date(2026, 12, 24)):
        clock.set(day)
        check_reminders(clock, notifier)
    assert notifier.sent == []

    history = periods(client, admin_headers, payment["id"], include_deleted=True)
    assert [(i["due_date"], i["status"], i["paid_at"]) for i in history] == [("2026-09-26", "paid", "2026-09-25")]
    assert client.get(f"{PAYMENTS}/{payment['id']}", headers=admin_headers).json()["is_active"] is False
