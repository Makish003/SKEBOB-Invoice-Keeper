"""AC-10 Исправление даты: оплачен позже срока (просрочка) → PATCH paid_at = due_date → is_overdue=false, срок прежний."""

from datetime import date

from fastapi.testclient import TestClient

from app.core.clock import FrozenClock
from tests.acceptance.helpers import OCCURRENCES, create_payment, periods


def test_fixing_date_clears_overdue(client: TestClient, clock: FrozenClock, admin_headers: dict[str, str]) -> None:
    occ = periods(client, admin_headers, create_payment(client, admin_headers)["id"])[0]
    clock.set(date(2026, 10, 30))
    late = client.patch(
        f"{OCCURRENCES}/{occ['id']}", json={"status": "paid", "paid_at": "2026-10-29"}, headers=admin_headers
    ).json()
    assert late["is_overdue"] is True and late["overdue_days"] == 3
    fixed = client.patch(f"{OCCURRENCES}/{occ['id']}", json={"paid_at": occ["due_date"]}, headers=admin_headers).json()
    assert fixed["is_overdue"] is False and fixed["due_date"] == occ["due_date"] == "2026-10-26"
