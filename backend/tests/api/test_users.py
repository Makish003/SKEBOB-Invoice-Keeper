"""B-10: управление пользователями — только admin (AC-3), админ из .env неизменяем (AC-4), EC-8, EC-12."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditLog, PaymentOccurrence, User
from tests.conftest import USER_PASSWORD, login

URL = "/api/v1/users"


@pytest.mark.parametrize(
    ("method", "path"),
    [("get", URL), ("post", URL), ("get", f"{URL}/1"), ("patch", f"{URL}/1"), ("delete", f"{URL}/1")],
)
def test_requires_auth(client: TestClient, method: str, path: str) -> None:
    assert client.request(method, path, json={} if method in ("post", "patch") else None).status_code == 401


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("get", URL, None),
        ("post", URL, {"login": "hacker", "password": "password123"}),
        ("get", f"{URL}/1", None),
        ("patch", f"{URL}/1", {"display_name": "Взломщик"}),
        ("patch", f"{URL}/2", {"role": "admin"}),
        ("delete", f"{URL}/1", None),
    ],
)
def test_user_role_is_forbidden(
    client: TestClient, db: Session, admin: User, user: User, user_headers: dict[str, str], method: str, path: str, body: dict | None
) -> None:
    """AC-3 / EC-12: обычный пользователь не управляет пользователями, в т.ч. собой и админом."""
    response = client.request(method, path, json=body, headers=user_headers)
    assert response.status_code == 403
    db.expire_all()
    assert db.get(User, user.id).role == "user"  # type: ignore[union-attr]
    assert db.get(User, admin.id).display_name == admin.display_name  # type: ignore[union-attr]
    assert db.scalar(select(User).where(User.login == "hacker")) is None


def test_admin_lists_users(client: TestClient, admin_headers: dict[str, str], user: User) -> None:
    body = client.get(URL, headers=admin_headers).json()
    assert body["total"] == 2
    assert [(u["login"], u["role"], u["is_system"]) for u in body["items"]] == [("admin", "admin", True), ("user", "user", False)]


def test_create_user_always_role_user(client: TestClient, db: Session, admin_headers: dict[str, str]) -> None:
    response = client.post(URL, json={"login": "maria", "password": "maria-pass-1", "display_name": "Мария"}, headers=admin_headers)
    assert response.status_code == 201
    assert response.json() | {"id": 0, "created_at": ""} == {
        "id": 0,
        "login": "maria",
        "display_name": "Мария",
        "role": "user",
        "is_system": False,
        "created_at": "",
    }
    login(client, "maria", "maria-pass-1")
    assert "user.created" in db.scalars(select(AuditLog.action)).all()


def test_display_name_defaults_to_login(client: TestClient, admin_headers: dict[str, str]) -> None:
    assert client.post(URL, json={"login": "petr", "password": "petr-pass-1"}, headers=admin_headers).json()["display_name"] == "petr"


def test_cannot_create_admin(client: TestClient, admin_headers: dict[str, str]) -> None:
    """AC-4: создать пользователя с ролью admin нельзя."""
    response = client.post(URL, json={"login": "boss", "password": "boss-pass-1", "role": "admin"}, headers=admin_headers)
    assert response.status_code == 403


def test_duplicate_login_is_409(client: TestClient, admin_headers: dict[str, str], user: User) -> None:
    assert client.post(URL, json={"login": "user", "password": "another-pass"}, headers=admin_headers).status_code == 409
    assert client.post(URL, json={"login": "admin", "password": "another-pass"}, headers=admin_headers).status_code == 409


@pytest.mark.parametrize(
    "body",
    [{"login": "ab", "password": "password1"}, {"login": "ivan petrov", "password": "password1"}, {"login": "ivan", "password": "short"}],
)
def test_create_validation(client: TestClient, admin_headers: dict[str, str], body: dict) -> None:
    assert client.post(URL, json=body, headers=admin_headers).status_code == 422


def test_system_admin_cannot_be_changed_or_deleted(client: TestClient, admin: User, admin_headers: dict[str, str]) -> None:
    """AC-4: PATCH/DELETE /users/{admin_id} → 403."""
    for body in ({"display_name": "Другой"}, {"password": "new-password-1"}, {"login": "root"}):
        assert client.patch(f"{URL}/{admin.id}", json=body, headers=admin_headers).status_code == 403
    assert client.delete(f"{URL}/{admin.id}", headers=admin_headers).status_code == 403


def test_update_user(client: TestClient, db: Session, admin_headers: dict[str, str], user: User) -> None:
    old_session = login(client, "user", USER_PASSWORD)
    response = client.patch(
        f"{URL}/{user.id}", json={"login": "ivan", "display_name": "Иван Петров", "password": "new-password-1"}, headers=admin_headers
    )
    assert response.status_code == 200
    assert (response.json()["login"], response.json()["display_name"]) == ("ivan", "Иван Петров")
    assert client.get("/api/v1/auth/me", headers=old_session).status_code == 401  # смена пароля завершает сессии
    login(client, "ivan", "new-password-1")


def test_cannot_promote_to_admin(client: TestClient, admin_headers: dict[str, str], user: User) -> None:
    assert client.patch(f"{URL}/{user.id}", json={"role": "admin"}, headers=admin_headers).status_code == 403


def test_update_to_taken_login_is_409(client: TestClient, admin_headers: dict[str, str], user: User) -> None:
    assert client.patch(f"{URL}/{user.id}", json={"login": "admin"}, headers=admin_headers).status_code == 409


def test_delete_user_revokes_sessions_and_keeps_history(
    client: TestClient, db: Session, admin_headers: dict[str, str], user: User
) -> None:
    """EC-8: сессии аннулированы, вход невозможен, отметки оплат сохраняются с именем."""
    payment = client.post(
        "/api/v1/recurring-payments",
        json={"name": "Аренда", "amount": "100.00", "currency": "RUB", "first_due_date": "2026-10-20"},
        headers=admin_headers,
    ).json()
    user_session = login(client, "user", USER_PASSWORD)
    occ_id = client.get(
        "/api/v1/payment-occurrences", params={"recurring_payment_id": payment["id"]}, headers=user_session
    ).json()["items"][0]["id"]
    client.patch(f"/api/v1/payment-occurrences/{occ_id}", json={"status": "paid"}, headers=user_session)

    assert client.delete(f"{URL}/{user.id}", headers=admin_headers).status_code == 204
    assert client.get("/api/v1/auth/me", headers=user_session).status_code == 401
    assert client.post("/api/v1/auth/login", json={"login": "user", "password": USER_PASSWORD}).status_code == 401
    assert client.get(f"{URL}/{user.id}", headers=admin_headers).status_code == 404
    assert client.delete(f"{URL}/{user.id}", headers=admin_headers).status_code == 404
    assert db.get(PaymentOccurrence, occ_id).paid_by_label == "Иван"  # type: ignore[union-attr]
    assert client.get(URL, headers=admin_headers).json()["total"] == 1

    # Логин удалённого пользователя можно выдать снова (ADR-014).
    assert client.post(URL, json={"login": "user", "password": "fresh-pass-1"}, headers=admin_headers).status_code == 201


def test_missing_user_is_404(client: TestClient, admin_headers: dict[str, str]) -> None:
    assert client.patch(f"{URL}/999", json={"display_name": "X"}, headers=admin_headers).status_code == 404
