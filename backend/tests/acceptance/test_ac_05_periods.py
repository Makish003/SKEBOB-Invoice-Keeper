"""AC-5 Регулярность: ежемесячный платёж 31.01 → отдельный период 28/29.02 «Не оплачено», январь и его оплата
сохранены; затем 31.03."""

from datetime import date

from fastapi.testclient import TestClient

from app.core.clock import FrozenClock
from tests.acceptance.helpers import OCCURRENCES, create_payment, periods


def test_next_period_is_separate_and_history_kept(client: TestClient, clock: FrozenClock, admin_headers: dict[str, str]) -> None:
    clock.set(date(2027, 1, 20))
    payment = create_payment(client, admin_headers, first_due_date="2027-01-31")
    january = periods(client, admin_headers, payment["id"])[0]
    assert january["due_date"] == "2027-01-31"
    paid = client.patch(f"{OCCURRENCES}/{january['id']}", json={"status": "paid", "paid_at": "2027-01-19"}, headers=admin_headers)
    assert paid.status_code == 200, paid.text

    clock.set(date(2027, 2, 10))  # наступает следующий период
    by_due = {i["due_date"]: i for i in periods(client, admin_headers, payment["id"])}
    assert by_due["2027-01-31"]["status"] == "paid" and by_due["2027-01-31"]["paid_at"] == "2027-01-19"
    assert by_due["2027-02-28"]["status"] == "unpaid" and by_due["2027-02-28"]["id"] != january["id"]

    clock.set(date(2027, 3, 5))
    dues = [i["due_date"] for i in periods(client, admin_headers, payment["id"])]
    assert dues[:3] == ["2027-01-31", "2027-02-28", "2027-03-31"]


def test_leap_year_february(client: TestClient, clock: FrozenClock, admin_headers: dict[str, str]) -> None:
    clock.set(date(2028, 1, 20))
    payment = create_payment(client, admin_headers, first_due_date="2028-01-31")
    clock.set(date(2028, 3, 1))
    dues = [i["due_date"] for i in periods(client, admin_headers, payment["id"])]
    assert dues[:3] == ["2028-01-31", "2028-02-29", "2028-03-31"]


def test_overdue_does_not_stop_next_periods(client: TestClient, clock: FrozenClock, admin_headers: dict[str, str]) -> None:
    """FR-6: просрочка не останавливает генерацию следующих периодов."""
    payment = create_payment(client, admin_headers, first_due_date="2026-10-26")
    clock.set(date(2027, 1, 5))  # три месяца никто не платил
    items = periods(client, admin_headers, payment["id"])
    assert [i["due_date"] for i in items][:4] == ["2026-10-26", "2026-11-26", "2026-12-26", "2027-01-26"]
    assert [i["is_overdue"] for i in items][:4] == [True, True, True, False]
