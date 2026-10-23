"""AC-9 Отметка/отмена: PATCH status=paid, paid_at → «Оплачено»; PATCH status=unpaid → paid_at = null."""

from fastapi.testclient import TestClient

from tests.acceptance.helpers import OCCURRENCES, create_payment, periods


def test_mark_and_unmark(client: TestClient, admin_headers: dict[str, str], user_headers: dict[str, str]) -> None:
    occ = periods(client, admin_headers, create_payment(client, admin_headers)["id"])[0]
    paid = client.patch(f"{OCCURRENCES}/{occ['id']}", json={"status": "paid", "paid_at": "2026-10-23"}, headers=user_headers)
    assert (paid.json()["status"], paid.json()["paid_at"]) == ("paid", "2026-10-23")
    unpaid = client.patch(f"{OCCURRENCES}/{occ['id']}", json={"status": "unpaid"}, headers=user_headers)
    assert (unpaid.json()["status"], unpaid.json()["paid_at"]) == ("unpaid", None)
    assert client.get(f"{OCCURRENCES}/{occ['id']}", headers=user_headers).json()["paid_at"] is None
