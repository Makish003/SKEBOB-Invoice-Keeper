"""AC-12 Валюты: платежи в RUB, USD, EUR → три отдельные суммы, без конвертации."""

from fastapi.testclient import TestClient

from tests.acceptance.helpers import create_payment


def test_three_separate_totals(client: TestClient, admin_headers: dict[str, str], user_headers: dict[str, str]) -> None:
    create_payment(client, admin_headers, name="Аренда", amount="85000.00", currency="RUB", first_due_date="2026-10-26")
    create_payment(client, admin_headers, name="Сервер", amount="49.90", currency="USD", first_due_date="2026-10-27")
    create_payment(client, admin_headers, name="Подписка", amount="15.00", currency="EUR", first_due_date="2026-10-28")
    summary = client.get("/api/v1/payments/summary", headers=user_headers).json()
    assert {r["currency"]: r["total"] for r in summary["currencies"]} == {"RUB": "85000.00", "USD": "49.90", "EUR": "15.00"}
