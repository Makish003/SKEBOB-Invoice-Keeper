"""AC-4 Админ из .env: изменить/удалить его нельзя; создать пользователя-администратора нельзя."""

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Role, User
from tests.conftest import ADMIN_PASSWORD, login


def test_env_admin_is_immutable(client: TestClient, db: Session, admin: User, admin_headers: dict[str, str]) -> None:
    assert admin.is_system and admin.role == Role.admin and admin.login == "admin"
    for body in ({"display_name": "Новый"}, {"login": "root"}, {"password": "changed-pass-1"}):
        assert client.patch(f"/api/v1/users/{admin.id}", json=body, headers=admin_headers).status_code == 403
    assert client.delete(f"/api/v1/users/{admin.id}", headers=admin_headers).status_code == 403
    login(client, "admin", ADMIN_PASSWORD)  # пароль по-прежнему из .env


def test_cannot_create_another_admin(client: TestClient, db: Session, admin_headers: dict[str, str]) -> None:
    response = client.post("/api/v1/users", json={"login": "boss", "password": "boss-pass-1", "role": "admin"}, headers=admin_headers)
    assert response.status_code == 403
    assert db.scalar(select(func.count()).select_from(User).where(User.role == Role.admin)) == 1
