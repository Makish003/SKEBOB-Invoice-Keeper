"""X-09: бюджет на месяц и год по каждой валюте — план против запланированных платежей и оплат."""

import pytest
from fastapi.testclient import TestClient

OVERVIEW = "/api/v1/budgets/overview"
BUDGETS = "/api/v1/budgets"


def by_currency(body: dict) -> dict[str, dict]:
    return {row["currency"]: row for row in body["currencies"]}


def test_requires_auth(client: TestClient) -> None:
    assert client.get(OVERVIEW).status_code == 401
    assert client.put(BUDGETS, json={"year": 2026, "currency": "RUB", "amount": "1.00"}).status_code == 401


def test_user_can_view_but_not_change(client: TestClient, user_headers: dict[str, str]) -> None:
    assert client.get(OVERVIEW, headers=user_headers).status_code == 200
    response = client.put(BUDGETS, json={"year": 2026, "month": 10, "currency": "RUB", "amount": "1.00"}, headers=user_headers)
    assert response.status_code == 403


def test_overview_compares_budget_with_planned_and_paid(client: TestClient, admin_headers: dict[str, str]) -> None:
    rent = client.post(
        "/api/v1/recurring-payments",
        json={"name": "Аренда", "amount": "85000.00", "currency": "RUB", "first_due_date": "2026-10-05"},
        headers=admin_headers,
    ).json()
    occ = client.get("/api/v1/payment-occurrences", params={"recurring_payment_id": rent["id"]}, headers=admin_headers).json()
    client.patch(f"/api/v1/payment-occurrences/{occ['items'][0]['id']}", json={"status": "paid"}, headers=admin_headers)
    assert client.put(BUDGETS, json={"year": 2026, "month": 10, "currency": "RUB", "amount": "100000.00"}, headers=admin_headers).status_code == 200
    client.put(BUDGETS, json={"year": 2026, "month": None, "currency": "RUB", "amount": "1000000.00"}, headers=admin_headers)
    client.put(BUDGETS, json={"year": 2026, "month": 10, "currency": "USD", "amount": "10.00"}, headers=admin_headers)

    body = client.get(OVERVIEW, params={"year": 2026, "month": 10}, headers=admin_headers).json()
    assert (body["year"], body["month"]) == (2026, 10)
    rub = by_currency(body)["RUB"]
    assert rub["month"] == {"budget": "100000.00", "planned": "85000.00", "paid": "85000.00"}
    # год: 05.10 и 05.11 (горизонт 35 дней) — оба периода уже созданы
    assert rub["year"]["budget"] == "1000000.00" and rub["year"]["planned"] == "170000.00"
    assert by_currency(body)["USD"]["month"] == {"budget": "10.00", "planned": "0.00", "paid": "0.00"}
    assert by_currency(body)["EUR"]["month"]["budget"] is None


def test_upsert_and_clear(client: TestClient, admin_headers: dict[str, str]) -> None:
    client.put(BUDGETS, json={"year": 2026, "month": 10, "currency": "EUR", "amount": "50.00"}, headers=admin_headers)
    client.put(BUDGETS, json={"year": 2026, "month": 10, "currency": "EUR", "amount": "70.00"}, headers=admin_headers)
    eur = by_currency(client.get(OVERVIEW, params={"year": 2026, "month": 10}, headers=admin_headers).json())["EUR"]
    assert eur["month"]["budget"] == "70.00"
    client.put(BUDGETS, json={"year": 2026, "month": 10, "currency": "EUR", "amount": None}, headers=admin_headers)
    eur = by_currency(client.get(OVERVIEW, params={"year": 2026, "month": 10}, headers=admin_headers).json())["EUR"]
    assert eur["month"]["budget"] is None


def test_defaults_to_current_month(client: TestClient, user_headers: dict[str, str]) -> None:
    body = client.get(OVERVIEW, headers=user_headers).json()
    assert (body["year"], body["month"]) == (2026, 10)
    assert [row["currency"] for row in body["currencies"]] == ["RUB", "USD", "EUR"]


@pytest.mark.parametrize(
    "body",
    [
        {"year": 2026, "month": 13, "currency": "RUB", "amount": "1.00"},
        {"year": 1999, "month": 1, "currency": "RUB", "amount": "1.00"},
        {"year": 2026, "month": 1, "currency": "GBP", "amount": "1.00"},
        {"year": 2026, "month": 1, "currency": "RUB", "amount": "-5"},
    ],
)
def test_validation(client: TestClient, admin_headers: dict[str, str], body: dict) -> None:
    assert client.put(BUDGETS, json=body, headers=admin_headers).status_code == 422
