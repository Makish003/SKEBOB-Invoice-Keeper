"""P-04 / ADR-022: изменение регулярного платежа — название, описание, сумма текущих и будущих неоплаченных периодов."""

from datetime import date
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import FrozenClock
from app.models import AuditLog, PaymentOccurrence
from tests.acceptance.helpers import OCCURRENCES, PAYMENTS, create_payment, periods


def amounts_by_due(client: TestClient, headers: dict[str, str], payment_id: int) -> dict[str, tuple[str, str]]:
    return {p["due_date"]: (p["amount"], p["status"]) for p in periods(client, headers, payment_id, include_deleted=True)}


def test_requires_auth_and_admin(client: TestClient, admin_headers: dict[str, str], user_headers: dict[str, str]) -> None:
    payment = create_payment(client, admin_headers)
    assert client.patch(f"{PAYMENTS}/{payment['id']}", json={"name": "X"}).status_code == 401
    assert client.patch(f"{PAYMENTS}/{payment['id']}", json={"name": "X"}, headers=user_headers).status_code == 403
    assert client.get(f"{PAYMENTS}/{payment['id']}", headers=admin_headers).json()["name"] == "Аренда офиса"


def test_rename_and_describe(client: TestClient, admin_headers: dict[str, str]) -> None:
    payment = create_payment(client, admin_headers, description="старое")
    body = client.patch(
        f"{PAYMENTS}/{payment['id']}", json={"name": "  Аренда склада ", "description": None}, headers=admin_headers
    )
    assert body.status_code == 200, body.text
    assert (body.json()["name"], body.json()["description"]) == ("Аренда склада", None)
    assert periods(client, admin_headers, payment["id"])[0]["recurring_payment"]["name"] == "Аренда склада"


def test_new_amount_applies_to_current_and_future_unpaid_only(
    client: TestClient, clock: FrozenClock, admin_headers: dict[str, str]
) -> None:
    # сегодня 23.10.2026; периоды 23.08 (оплачен), 23.09 (просрочен), 23.10 (сегодня), 23.11 (будущий)
    payment = create_payment(client, admin_headers, first_due_date="2026-08-23", amount="1000.00")
    first = periods(client, admin_headers, payment["id"])[0]
    client.patch(f"{OCCURRENCES}/{first['id']}", json={"status": "paid", "paid_at": "2026-08-23"}, headers=admin_headers)

    response = client.patch(f"{PAYMENTS}/{payment['id']}", json={"amount": "1200.50"}, headers=admin_headers)
    assert response.status_code == 200, response.text
    assert response.json()["amount"] == "1200.50"
    assert response.json()["next_occurrence"]["amount"] == "1200.50"

    by_due = amounts_by_due(client, admin_headers, payment["id"])
    assert by_due["2026-08-23"] == ("1000.00", "paid")  # оплаченный — как платили
    assert by_due["2026-09-23"] == ("1000.00", "unpaid")  # уже просроченный долг — прежняя сумма
    assert by_due["2026-10-23"] == ("1200.50", "unpaid")
    assert by_due["2026-11-23"] == ("1200.50", "unpaid")

    clock.set(date(2027, 1, 1))  # новые периоды создаются уже с новой суммой
    assert amounts_by_due(client, admin_headers, payment["id"])["2027-01-23"] == ("1200.50", "unpaid")


def test_audit_records_changes(client: TestClient, db: Session, admin_headers: dict[str, str]) -> None:
    payment = create_payment(client, admin_headers, amount="100.00")
    client.patch(f"{PAYMENTS}/{payment['id']}", json={"amount": "150.00", "name": "Новое"}, headers=admin_headers)
    entry = db.scalars(select(AuditLog).where(AuditLog.action == "recurring_payment.updated")).one()
    assert entry.entity_id == payment["id"]
    assert entry.payload["changes"] == {"amount": ["100.00", "150.00"], "name": ["Аренда офиса", "Новое"]}
    assert entry.payload["periods_repriced"] >= 1


def test_validation_and_state_errors(client: TestClient, db: Session, admin_headers: dict[str, str]) -> None:
    payment = create_payment(client, admin_headers)
    url = f"{PAYMENTS}/{payment['id']}"
    for body in ({}, {"name": None}, {"name": "  "}, {"amount": "0"}, {"amount": "1.234"}, {"currency": "USD"}):
        assert client.patch(url, json=body, headers=admin_headers).status_code == 422, body
    assert client.patch(f"{PAYMENTS}/999", json={"name": "X"}, headers=admin_headers).status_code == 404

    assert client.delete(url, headers=admin_headers).status_code == 204
    stopped = client.patch(url, json={"name": "X"}, headers=admin_headers)
    assert stopped.status_code == 409 and "прекращ" in stopped.json()["error"]["message"]
    assert all(o.amount == Decimal(payment["amount"]) for o in db.scalars(select(PaymentOccurrence)))
