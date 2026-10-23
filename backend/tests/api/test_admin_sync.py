"""FR-12 / AC-4: администратор берётся из .env и синхронизируется при старте."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import FrozenClock
from app.core.config import Settings
from app.core.security import verify_password
from app.models import Role, User
from app.services.users import sync_system_admin


def test_sync_creates_system_admin(db: Session, clock: FrozenClock) -> None:
    admin = sync_system_admin(db, Settings(admin_login="boss", admin_password="s3cret-pass"), clock)
    db.commit()
    assert admin.role == Role.admin and admin.is_system
    assert verify_password(admin.password_hash, "s3cret-pass")


def test_sync_is_idempotent_and_updates_password(db: Session, clock: FrozenClock) -> None:
    first = sync_system_admin(db, Settings(admin_login="boss", admin_password="old-password"), clock)
    second = sync_system_admin(db, Settings(admin_login="boss", admin_password="new-password"), clock)
    db.commit()
    assert first.id == second.id
    assert db.scalar(select(User).where(User.login == "boss")) is not None
    assert verify_password(second.password_hash, "new-password")


def test_changed_admin_login_deactivates_previous_admin(db: Session, clock: FrozenClock) -> None:
    old = sync_system_admin(db, Settings(admin_login="boss", admin_password="password-1"), clock)
    new = sync_system_admin(db, Settings(admin_login="chief", admin_password="password-2"), clock)
    db.commit()
    db.refresh(old)
    assert old.deleted_at is not None and new.deleted_at is None
    active_admins = db.scalars(select(User).where(User.role == Role.admin, User.deleted_at.is_(None))).all()
    assert [u.login for u in active_admins] == ["chief"]
