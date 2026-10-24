"""Сброс демо-стенда: посторонние платежи и файлы исчезают, демо-набор и админ на месте; production защищён."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import FrozenClock
from app.core.config import get_settings
from app.models import RecurringPayment, User
from app.scripts import reset_demo as reset_module
from tests.acceptance.helpers import create_payment


def test_reset_replaces_everything_with_demo_data(
    client: TestClient, db: Session, clock: FrozenClock, admin_headers: dict[str, str]
) -> None:
    create_payment(client, admin_headers, name="E2E Хостинг 1792788843809")
    stray = Path(get_settings().uploads_dir) / "stray.pdf"
    stray.write_bytes(b"%PDF-1.4")

    reset_module.reset_demo(db, clock, get_settings())

    names = set(db.scalars(select(RecurringPayment.name)))
    assert "E2E Хостинг 1792788843809" not in names and "Аренда офиса" in names
    assert db.scalar(select(func.count()).select_from(RecurringPayment)) == 6
    assert db.scalar(select(User).where(User.login == "admin", User.is_system.is_(True))) is not None
    assert not stray.exists()


def test_reset_refuses_production_without_force(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "app_env", "production")
    called = []
    monkeypatch.setattr(reset_module, "reset_demo", lambda *a: called.append(a))
    assert reset_module.main([]) == 2
    assert called == []
