"""B-08: периоды — список/фильтры, отметка и отмена оплаты, исправление даты, просрочка."""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import FrozenClock
from app.models import AuditLog

URL = "/api/v1/payment-occurrences"


def make_payment(client: TestClient, headers: dict[str, str], **fields: object) -> dict:
    body = {"name": "Аренда офиса", "amount": "85000.00", "currency": "RUB", "first_due_date": "2026-10-26", **fields}
    response = client.post("/api/v1/recurring-payments", json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def occurrences(client: TestClient, headers: dict[str, str], **params: object) -> dict:
    response = client.get(URL, params=params, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def first_occurrence_id(client: TestClient, headers: dict[str, str], payment_id: int) -> int:
    return occurrences(client, headers, recurring_payment_id=payment_id)["items"][0]["id"]


@pytest.mark.parametrize(("method", "path"), [("get", URL), ("get", f"{URL}/1"), ("patch", f"{URL}/1")])
def test_requires_auth(client: TestClient, method: str, path: str) -> None:
    assert client.request(method, path, json={"status": "paid"} if method == "patch" else None).status_code == 401


def test_user_marks_paid_and_unpaid(
    client: TestClient, db: Session, admin_headers: dict[str, str], user_headers: dict[str, str]
) -> None:
    """AC-9: отметить с датой; отменить — дата очищается. Пользователь вправе (FR-14)."""
    occ_id = first_occurrence_id(client, admin_headers, make_payment(client, admin_headers)["id"])

    paid = client.patch(f"{URL}/{occ_id}", json={"status": "paid", "paid_at": "2026-10-22"}, headers=user_headers)
    assert paid.status_code == 200, paid.text
    body = paid.json()
    assert (body["status"], body["paid_at"], body["paid_by_label"], body["display_status"]) == (
        "paid",
        "2026-10-22",
        "Иван",
        "paid",
    )

    unpaid = client.patch(f"{URL}/{occ_id}", json={"status": "unpaid"}, headers=user_headers).json()
    assert (unpaid["status"], unpaid["paid_at"], unpaid["paid_by_label"]) == ("unpaid", None, None)
    actions = db.scalars(select(AuditLog.action).where(AuditLog.entity == "payment_occurrence")).all()
    assert actions == ["occurrence.paid", "occurrence.unpaid"]


def test_paid_without_date_defaults_to_today(client: TestClient, admin_headers: dict[str, str]) -> None:
    occ_id = first_occurrence_id(client, admin_headers, make_payment(client, admin_headers)["id"])
    body = client.patch(f"{URL}/{occ_id}", json={"status": "paid"}, headers=admin_headers).json()
    assert body["paid_at"] == "2026-10-23"


def test_fixing_paid_date_removes_overdue(client: TestClient, clock: FrozenClock, admin_headers: dict[str, str]) -> None:
    """AC-10: оплачен позже срока (просрочка) → исправили дату на срок → просрочки нет, срок прежний."""
    occ_id = first_occurrence_id(client, admin_headers, make_payment(client, admin_headers)["id"])
    clock.set(date(2026, 10, 29))
    late = client.patch(f"{URL}/{occ_id}", json={"status": "paid", "paid_at": "2026-10-28"}, headers=admin_headers).json()
    assert (late["is_overdue"], late["overdue_days"], late["display_status"]) == (True, 2, "paid_late")

    fixed = client.patch(f"{URL}/{occ_id}", json={"paid_at": "2026-10-26"}, headers=admin_headers).json()
    assert (fixed["is_overdue"], fixed["overdue_days"], fixed["display_status"]) == (False, 0, "paid")
    assert fixed["due_date"] == "2026-10-26" and fixed["status"] == "paid"


def test_overdue_starts_the_day_after_due(client: TestClient, clock: FrozenClock, admin_headers: dict[str, str]) -> None:
    """AC-11: сегодня = срок — не просрочен; срок + 1 — просрочен на 1 день."""
    occ_id = first_occurrence_id(client, admin_headers, make_payment(client, admin_headers)["id"])
    clock.set(date(2026, 10, 26))
    on_due = client.get(f"{URL}/{occ_id}", headers=admin_headers).json()
    assert (on_due["is_overdue"], on_due["display_status"], on_due["days_until_due"]) == (False, "due_today", 0)
    clock.set(date(2026, 10, 27))
    after = client.get(f"{URL}/{occ_id}", headers=admin_headers).json()
    assert (after["is_overdue"], after["overdue_days"], after["display_status"]) == (True, 1, "overdue")


@pytest.mark.parametrize(
    ("body", "fragment"),
    [
        ({"status": "paid", "paid_at": "2026-10-24"}, "будущ"),  # EC-4: дата в будущем
        ({"paid_at": "2026-10-20"}, "status"),  # EC-5: дата у неоплаченного без status=paid
        ({"status": "unpaid", "paid_at": "2026-10-20"}, "unpaid"),
        ({"status": "paid", "paid_at": None}, "дат"),
        ({}, "изменений"),
        ({"status": None}, "status"),
    ],
)
def test_patch_rules(client: TestClient, admin_headers: dict[str, str], body: dict, fragment: str) -> None:
    occ_id = first_occurrence_id(client, admin_headers, make_payment(client, admin_headers)["id"])
    response = client.patch(f"{URL}/{occ_id}", json=body, headers=admin_headers)
    assert response.status_code == 422, response.text
    assert fragment in response.json()["error"]["message"]


def test_due_date_cannot_be_changed(client: TestClient, admin_headers: dict[str, str]) -> None:
    occ_id = first_occurrence_id(client, admin_headers, make_payment(client, admin_headers)["id"])
    response = client.patch(f"{URL}/{occ_id}", json={"due_date": "2026-11-01"}, headers=admin_headers)
    assert response.status_code == 422


def test_early_payment_is_allowed(client: TestClient, admin_headers: dict[str, str]) -> None:
    occ_id = first_occurrence_id(client, admin_headers, make_payment(client, admin_headers, first_due_date="2026-11-20")["id"])
    body = client.patch(f"{URL}/{occ_id}", json={"status": "paid", "paid_at": "2026-10-01"}, headers=admin_headers).json()
    assert (body["status"], body["is_overdue"]) == ("paid", False)


def test_note_can_be_set_and_cleared(client: TestClient, admin_headers: dict[str, str]) -> None:
    occ_id = first_occurrence_id(client, admin_headers, make_payment(client, admin_headers)["id"])
    assert client.patch(f"{URL}/{occ_id}", json={"note": "Счёт №15"}, headers=admin_headers).json()["note"] == "Счёт №15"
    assert client.patch(f"{URL}/{occ_id}", json={"note": None}, headers=admin_headers).json()["note"] is None


def test_missing_is_404(client: TestClient, admin_headers: dict[str, str]) -> None:
    assert client.get(f"{URL}/999", headers=admin_headers).status_code == 404
    assert client.patch(f"{URL}/999", json={"status": "paid"}, headers=admin_headers).status_code == 404


def test_filters_sort_and_pagination(client: TestClient, admin_headers: dict[str, str]) -> None:
    rent = make_payment(client, admin_headers)  # 26.10, 26.11
    server = make_payment(client, admin_headers, name="Сервер Hetzner", amount="49.90", currency="USD", first_due_date="2026-10-13")
    make_payment(client, admin_headers, name="Подписка Figma", amount="15.00", currency="EUR", first_due_date="2026-11-05")
    paid_id = first_occurrence_id(client, admin_headers, rent["id"])
    client.patch(f"{URL}/{paid_id}", json={"status": "paid", "paid_at": "2026-10-20"}, headers=admin_headers)

    everything = occurrences(client, admin_headers)
    assert everything["total"] == len(everything["items"]) >= 5
    assert [i["due_date"] for i in everything["items"]] == sorted(i["due_date"] for i in everything["items"])

    assert {i["currency"] for i in occurrences(client, admin_headers, currency="USD")["items"]} == {"USD"}
    assert [i["id"] for i in occurrences(client, admin_headers, status="paid")["items"]] == [paid_id]
    overdue = occurrences(client, admin_headers, overdue=True)["items"]
    assert [(i["recurring_payment"]["id"], i["due_date"]) for i in overdue] == [(server["id"], "2026-10-13")]
    assert all(not i["is_overdue"] for i in occurrences(client, admin_headers, overdue=False)["items"])
    assert {i["recurring_payment"]["name"] for i in occurrences(client, admin_headers, q="figma")["items"]} == {"Подписка Figma"}

    window = occurrences(client, admin_headers, due_from="2026-10-20", due_to="2026-11-10")["items"]
    assert all("2026-10-20" <= i["due_date"] <= "2026-11-10" for i in window)

    desc = occurrences(client, admin_headers, sort="-due_date")["items"]
    assert [i["due_date"] for i in desc] == sorted((i["due_date"] for i in desc), reverse=True)

    page = occurrences(client, admin_headers, limit=2, offset=2)
    assert len(page["items"]) == 2 and page["total"] == everything["total"]
    assert [i["id"] for i in page["items"]] == [i["id"] for i in everything["items"][2:4]]


def test_deleted_payment_history_only_with_flag(client: TestClient, admin_headers: dict[str, str]) -> None:
    payment = make_payment(client, admin_headers, first_due_date="2026-09-26")
    client.delete(f"/api/v1/recurring-payments/{payment['id']}", headers=admin_headers)
    assert occurrences(client, admin_headers)["total"] == 0
    history = occurrences(client, admin_headers, include_deleted=True)["items"]
    assert [i["due_date"] for i in history] == ["2026-09-26"]
    assert history[0]["recurring_payment"]["is_active"] is False


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 500}, {"offset": -1}, {"sort": "bogus"}, {"status": "maybe"}])
def test_invalid_query_params(client: TestClient, admin_headers: dict[str, str], params: dict) -> None:
    assert client.get(URL, params=params, headers=admin_headers).status_code == 422
