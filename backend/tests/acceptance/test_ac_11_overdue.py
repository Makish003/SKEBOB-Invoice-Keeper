"""AC-11 Просрочка: сегодня = срок → не просрочен; сегодня = срок + 1 → просрочен на 1 день."""

from datetime import date

from fastapi.testclient import TestClient

from app.core.clock import FrozenClock
from tests.acceptance.helpers import OCCURRENCES, create_payment, periods


def test_overdue_boundary(client: TestClient, clock: FrozenClock, admin_headers: dict[str, str]) -> None:
    occ = periods(client, admin_headers, create_payment(client, admin_headers)["id"])[0]
    clock.set(date(2026, 10, 26))
    assert client.get(f"{OCCURRENCES}/{occ['id']}", headers=admin_headers).json()["is_overdue"] is False
    clock.set(date(2026, 10, 27))
    body = client.get(f"{OCCURRENCES}/{occ['id']}", headers=admin_headers).json()
    assert (body["is_overdue"], body["overdue_days"]) == (True, 1)


def test_payment_on_due_date_is_on_time(client: TestClient, clock: FrozenClock, admin_headers: dict[str, str]) -> None:
    occ = periods(client, admin_headers, create_payment(client, admin_headers)["id"])[0]
    clock.set(date(2026, 11, 3))
    body = client.patch(
        f"{OCCURRENCES}/{occ['id']}", json={"status": "paid", "paid_at": "2026-10-26"}, headers=admin_headers
    ).json()
    assert body["is_overdue"] is False
