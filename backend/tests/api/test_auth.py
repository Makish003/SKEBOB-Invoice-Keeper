"""B-05: вход, текущий пользователь, выход, перебор паролей, аудит (AC-2, AC-4)."""

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import AuditLog, User, UserSession
from tests.conftest import ADMIN_PASSWORD, USER_PASSWORD, login


def test_login_returns_token_user_and_httponly_cookie(client: TestClient, admin: User) -> None:
    response = client.post("/api/v1/auth/login", json={"login": "admin", "password": ADMIN_PASSWORD})
    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer" and len(body["access_token"]) > 30
    assert body["user"] == {
        "id": admin.id,
        "login": "admin",
        "display_name": admin.display_name,
        "role": "admin",
        "is_system": True,
        "created_at": body["user"]["created_at"],
    }
    cookie = response.headers["set-cookie"]
    assert "ik_session=" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie
    assert "password_hash" not in response.text


def test_wrong_password_and_unknown_login_give_same_401(client: TestClient, db: Session, admin: User) -> None:
    wrong = client.post("/api/v1/auth/login", json={"login": "admin", "password": "nope-nope"})
    unknown = client.post("/api/v1/auth/login", json={"login": "ghost", "password": "nope-nope"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["error"]["message"] == unknown.json()["error"]["message"]
    actions = db.scalars(select(AuditLog.action)).all()
    assert actions.count("auth.login.failed") == 2


def test_me_with_bearer_and_with_cookie(client: TestClient, admin: User) -> None:
    headers = login(client, "admin", ADMIN_PASSWORD)
    assert client.get("/api/v1/auth/me", headers=headers).json()["login"] == "admin"

    response = client.post("/api/v1/auth/login", json={"login": "admin", "password": ADMIN_PASSWORD})
    assert response.status_code == 200
    assert client.get("/api/v1/auth/me").json()["role"] == "admin"  # cookie из ответа логина


def test_me_without_session_is_401(client: TestClient) -> None:
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_garbage_token_is_401(client: TestClient) -> None:
    assert client.get("/api/v1/auth/me", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_logout_revokes_current_session_only(client: TestClient, db: Session, admin: User) -> None:
    first = login(client, "admin", ADMIN_PASSWORD)
    second = login(client, "admin", ADMIN_PASSWORD)
    response = client.post("/api/v1/auth/logout", headers=first)
    assert response.status_code == 204
    assert client.get("/api/v1/auth/me", headers=first).status_code == 401
    assert client.get("/api/v1/auth/me", headers=second).status_code == 200
    assert "auth.logout" in db.scalars(select(AuditLog.action)).all()


def test_logout_clears_cookie(client: TestClient, admin: User) -> None:
    client.post("/api/v1/auth/login", json={"login": "admin", "password": ADMIN_PASSWORD})
    response = client.post("/api/v1/auth/logout")
    assert response.status_code == 204
    assert 'ik_session=""' in response.headers["set-cookie"] or "Max-Age=0" in response.headers["set-cookie"]
    client.cookies.clear()
    assert client.get("/api/v1/auth/me").status_code == 401


def test_logout_without_session_is_401(client: TestClient) -> None:
    assert client.post("/api/v1/auth/logout").status_code == 401


def test_expired_session_is_401(client: TestClient, db: Session, admin: User) -> None:
    headers = login(client, "admin", ADMIN_PASSWORD)
    db.execute(update(UserSession).values(expires_at=UserSession.created_at - timedelta(seconds=1)))
    db.commit()
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


def test_deleted_user_cannot_login_and_loses_sessions(client: TestClient, db: Session, user: User) -> None:
    headers = login(client, "user", USER_PASSWORD)
    db.execute(update(User).where(User.id == user.id).values(deleted_at=User.created_at))
    db.commit()
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401
    assert client.post("/api/v1/auth/login", json={"login": "user", "password": USER_PASSWORD}).status_code == 401


def test_bruteforce_is_rate_limited(client: TestClient, admin: User) -> None:
    for _ in range(5):
        assert client.post("/api/v1/auth/login", json={"login": "admin", "password": "wrong-pass"}).status_code == 401
    blocked = client.post("/api/v1/auth/login", json={"login": "admin", "password": ADMIN_PASSWORD})
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "too_many_requests"


def test_successful_login_is_audited(client: TestClient, db: Session, admin: User) -> None:
    login(client, "admin", ADMIN_PASSWORD)
    entry = db.scalar(select(AuditLog).where(AuditLog.action == "auth.login.success"))
    assert entry is not None and entry.actor_user_id == admin.id and entry.ip


def test_login_validation_error_format(client: TestClient) -> None:
    response = client.post("/api/v1/auth/login", json={"login": "admin"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
