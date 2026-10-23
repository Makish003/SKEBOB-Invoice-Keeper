"""Общие фикстуры: отдельная тестовая БД (<db>_test) на том же Postgres, управляемые часы, клиенты API."""

import os
import tempfile
from collections.abc import Iterator
from datetime import date

# Тестовая БД подменяется до импорта приложения: настройки кешируются.
os.environ.update(
    {
        "APP_ENV": "test",
        "SEED_DEMO_DATA": "false",
        "CLOCK_OVERRIDE": "",
        "ADMIN_LOGIN": "admin",
        "ADMIN_PASSWORD": "admin12345",
        "REMINDER_DAYS_BEFORE": "3",
        "GENERATION_HORIZON_DAYS": "35",
        "REMINDER_MAX_ATTEMPTS": "5",
        "TELEGRAM_BOT_TOKEN": "",
        "TELEGRAM_CHAT_ID": "",
        "WEBHOOK_URL": "",
        "SMTP_HOST": "",
        "SECRET_KEY": "test-secret",
        "UPLOADS_DIR": tempfile.mkdtemp(prefix="ik-uploads-"),
    }
)

from app.core.config import Settings  # noqa: E402

_base = Settings()
_test_db = f"{_base.postgres_db}_test"
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", _base.database_url.rsplit("/", 1)[0] + f"/{_test_db}"
)

import psycopg  # noqa: E402
import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.api.v1 import auth as auth_api  # noqa: E402
from app.core.clock import FrozenClock, get_clock  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.core.db import get_engine, get_sessionmaker  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Role, User  # noqa: E402
from app.services.users import sync_system_admin  # noqa: E402

TODAY = date(2026, 10, 23)
ADMIN_PASSWORD = "admin12345"
USER_PASSWORD = "user12345"
TABLES = "audit_log, reminders, payment_occurrences, recurring_payments, sessions, users"


def _create_test_database() -> None:
    settings = get_settings()
    dsn = settings.database_url.replace("postgresql+psycopg://", "postgresql://")
    admin_dsn = dsn.rsplit("/", 1)[0] + "/postgres"
    db_name = dsn.rsplit("/", 1)[1]
    with psycopg.connect(admin_dsn, autocommit=True) as conn:
        exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,)).fetchone()
        if not exists:
            conn.execute(f'CREATE DATABASE "{db_name}"')


@pytest.fixture(scope="session", autouse=True)
def _database() -> Iterator[None]:
    get_settings.cache_clear()
    _create_test_database()
    cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    cfg.attributes["configure_logger"] = False
    command.upgrade(cfg, "head")
    yield
    get_engine().dispose()


@pytest.fixture(autouse=True)
def _clean() -> Iterator[None]:
    with get_engine().begin() as conn:
        conn.execute(text(f"TRUNCATE {TABLES} RESTART IDENTITY CASCADE"))
    auth_api.login_limiter.reset()
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def clock() -> FrozenClock:
    frozen = FrozenClock(TODAY)
    app.dependency_overrides[get_clock] = lambda: frozen
    return frozen


@pytest.fixture
def db() -> Iterator[Session]:
    with get_sessionmaker()() as session:
        yield session


@pytest.fixture
def client(clock: FrozenClock) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def admin(db: Session, clock: FrozenClock) -> User:
    user = sync_system_admin(db, get_settings(), clock)
    db.commit()
    return user


def create_user(db: Session, login: str = "user", password: str = USER_PASSWORD, name: str = "Иван") -> User:
    user = User(login=login, password_hash=hash_password(password), display_name=name, role=Role.user)
    db.add(user)
    db.commit()
    return user


@pytest.fixture
def user(db: Session) -> User:
    return create_user(db)


def login(client: TestClient, login_: str, password: str) -> dict[str, str]:
    """Входит и возвращает Bearer-заголовок; cookie клиента очищаются, чтобы не влиять на другие проверки."""
    response = client.post("/api/v1/auth/login", json={"login": login_, "password": password})
    assert response.status_code == 200, response.text
    client.cookies.clear()
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def admin_headers(client: TestClient, admin: User) -> dict[str, str]:
    return login(client, admin.login, ADMIN_PASSWORD)


@pytest.fixture
def user_headers(client: TestClient, user: User) -> dict[str, str]:
    return login(client, user.login, USER_PASSWORD)
