"""B-09 / AC-12: итоги отдельно по RUB, USD, EUR, без конвертации; Decimal строкой."""

from fastapi.testclient import TestClient

URL = "/api/v1/payments/summary"


def make(client: TestClient, headers: dict[str, str], name: str, amount: str, currency: str, due: str) -> int:
    body = {"name": name, "amount": amount, "currency": currency, "first_due_date": due}
    response = client.post("/api/v1/recurring-payments", json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def first_occurrence(client: TestClient, headers: dict[str, str], payment_id: int) -> int:
    items = client.get(
        "/api/v1/payment-occurrences", params={"recurring_payment_id": payment_id}, headers=headers
    ).json()["items"]
    return items[0]["id"]


def by_currency(body: dict) -> dict[str, dict]:
    return {row["currency"]: row for row in body["currencies"]}


def test_requires_auth(client: TestClient) -> None:
    assert client.get(URL).status_code == 401


def test_empty_summary_has_three_zero_currencies(client: TestClient, user_headers: dict[str, str]) -> None:
    body = client.get(URL, headers=user_headers).json()
    assert body["period"] == {"from": "2026-10-01", "to": "2026-10-31"}  # текущий месяц по умолчанию
    assert body["as_of"] == "2026-10-23"
    assert [row["currency"] for row in body["currencies"]] == ["RUB", "USD", "EUR"]
    assert all(row["total"] == "0.00" and row["count_total"] == 0 for row in body["currencies"])


def test_totals_are_separate_per_currency(
    client: TestClient, admin_headers: dict[str, str], user_headers: dict[str, str]
) -> None:
    """AC-12: три отдельные суммы, без конвертации."""
    make(client, admin_headers, "Аренда офиса", "85000.00", "RUB", "2026-10-26")
    make(client, admin_headers, "Аренда склада", "15000.50", "RUB", "2026-10-28")
    make(client, admin_headers, "Сервер Hetzner", "49.90", "USD", "2026-10-13")
    figma = make(client, admin_headers, "Подписка Figma", "15.00", "EUR", "2026-10-05")
    client.patch(
        f"/api/v1/payment-occurrences/{first_occurrence(client, admin_headers, figma)}",
        json={"status": "paid", "paid_at": "2026-10-07"},
        headers=admin_headers,
    )

    rows = by_currency(client.get(URL, headers=user_headers).json())
    assert rows["RUB"] == {
        "currency": "RUB",
        "total": "100000.50",
        "paid": "0.00",
        "unpaid": "100000.50",
        "overdue": "0.00",
        "count_total": 2,
        "count_paid": 0,
        "count_overdue": 0,
        "due": "0.00",
        "count_due": 0,
    }
    assert (rows["USD"]["total"], rows["USD"]["overdue"], rows["USD"]["count_overdue"]) == ("49.90", "49.90", 1)
    assert (rows["EUR"]["total"], rows["EUR"]["paid"], rows["EUR"]["unpaid"], rows["EUR"]["count_paid"]) == (
        "15.00",
        "15.00",
        "0.00",
        1,
    )


def test_custom_period_and_as_of(client: TestClient, admin_headers: dict[str, str]) -> None:
    figma = make(client, admin_headers, "Подписка Figma", "15.00", "EUR", "2026-10-05")
    client.patch(
        f"/api/v1/payment-occurrences/{first_occurrence(client, admin_headers, figma)}",
        json={"status": "paid", "paid_at": "2026-10-07"},
        headers=admin_headers,
    )
    # На 06.10 период ещё не оплачен и уже просрочен; на 05.10 — не просрочен (оплата в день срока вовремя).
    on_06 = by_currency(client.get(URL, params={"as_of": "2026-10-06"}, headers=admin_headers).json())["EUR"]
    assert (on_06["paid"], on_06["overdue"], on_06["count_overdue"]) == ("0.00", "15.00", 1)
    on_05 = by_currency(client.get(URL, params={"as_of": "2026-10-05"}, headers=admin_headers).json())["EUR"]
    assert on_05["overdue"] == "0.00"

    november = client.get(URL, params={"due_from": "2026-11-01", "due_to": "2026-11-30"}, headers=admin_headers).json()
    assert november["period"] == {"from": "2026-11-01", "to": "2026-11-30"}
    assert by_currency(november)["EUR"]["total"] == "15.00"  # период 05.11


def test_invalid_range_is_422(client: TestClient, admin_headers: dict[str, str]) -> None:
    response = client.get(URL, params={"due_from": "2026-11-01", "due_to": "2026-10-01"}, headers=admin_headers)
    assert response.status_code == 422


def test_deleted_payment_excluded_by_default(client: TestClient, admin_headers: dict[str, str]) -> None:
    server = make(client, admin_headers, "Сервер", "49.90", "USD", "2026-10-13")
    client.delete(f"/api/v1/recurring-payments/{server}", headers=admin_headers)
    assert by_currency(client.get(URL, headers=admin_headers).json())["USD"]["total"] == "0.00"
    with_history = client.get(URL, params={"include_deleted": True}, headers=admin_headers).json()
    assert by_currency(with_history)["USD"]["total"] == "49.90"


def test_as_of_reports_due_paid_overdue(client: TestClient, admin_headers: dict[str, str]) -> None:
    """X-04: на дату X — сколько должно было быть оплачено, оплачено, просрочено (по валютам)."""
    rent = make(client, admin_headers, "Аренда", "100.00", "RUB", "2026-10-05")  # 05.10, 05.11
    make(client, admin_headers, "Склад", "50.00", "RUB", "2026-10-20")
    client.patch(
        f"/api/v1/payment-occurrences/{first_occurrence(client, admin_headers, rent)}",
        json={"status": "paid", "paid_at": "2026-10-04"},
        headers=admin_headers,
    )
    params = {"due_from": "2026-01-01", "due_to": "2026-10-15", "as_of": "2026-10-15"}
    rub = by_currency(client.get(URL, params=params, headers=admin_headers).json())["RUB"]
    assert (rub["due"], rub["paid"], rub["overdue"], rub["count_due"]) == ("100.00", "100.00", "0.00", 1)

    params = {"due_from": "2026-01-01", "due_to": "2026-10-22", "as_of": "2026-10-22"}
    rub = by_currency(client.get(URL, params=params, headers=admin_headers).json())["RUB"]
    assert (rub["due"], rub["paid"], rub["overdue"], rub["count_due"], rub["count_overdue"]) == ("150.00", "100.00", "50.00", 2, 1)
