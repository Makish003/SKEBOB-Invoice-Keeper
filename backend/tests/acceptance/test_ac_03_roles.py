"""AC-3 Роли: пользователь не выполнит действия администратора даже через API; данные не меняются."""

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import RecurringPayment, User
from tests.acceptance.helpers import PAYMENTS, create_payment


def test_user_gets_403_on_admin_actions(
    client: TestClient, db: Session, admin: User, admin_headers: dict[str, str], user: User, user_headers: dict[str, str]
) -> None:
    payment = create_payment(client, admin_headers)
    attempts = [
        ("post", PAYMENTS, {"name": "X", "amount": "1.00", "currency": "RUB", "first_due_date": "2026-11-01"}),
        ("delete", f"{PAYMENTS}/{payment['id']}", None),
        ("get", "/api/v1/users", None),
        ("post", "/api/v1/users", {"login": "intruder", "password": "password123"}),
        ("get", f"/api/v1/users/{admin.id}", None),
        ("patch", f"/api/v1/users/{user.id}", {"role": "admin"}),
        ("patch", f"/api/v1/users/{admin.id}", {"password": "hijacked-1"}),
        ("delete", f"/api/v1/users/{admin.id}", None),
    ]
    for method, path, body in attempts:
        response = client.request(method, path, json=body, headers=user_headers)
        assert response.status_code == 403, f"{method.upper()} {path} → {response.status_code}"

    db.expire_all()
    assert db.scalar(select(func.count()).select_from(RecurringPayment)) == 1
    assert db.get(RecurringPayment, payment["id"]).deleted_at is None  # type: ignore[union-attr]
    assert db.get(User, user.id).role == "user"  # type: ignore[union-attr]
    assert db.scalar(select(User).where(User.login == "intruder")) is None


def test_user_can_do_user_things(client: TestClient, admin_headers: dict[str, str], user_headers: dict[str, str]) -> None:
    payment = create_payment(client, admin_headers)
    assert client.get(PAYMENTS, headers=user_headers).status_code == 200
    occ_id = client.get("/api/v1/payment-occurrences", headers=user_headers).json()["items"][0]["id"]
    assert client.patch(f"/api/v1/payment-occurrences/{occ_id}", json={"status": "paid"}, headers=user_headers).status_code == 200
    assert client.get("/api/v1/payments/summary", headers=user_headers).status_code == 200
    assert payment["id"]
