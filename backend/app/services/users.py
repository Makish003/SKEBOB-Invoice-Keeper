"""Пользователи: синхронизация системного администратора из .env (FR-12)."""

import logging

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.config import Settings
from app.core.security import hash_password, verify_password
from app.models import Role, User, UserSession

log = logging.getLogger(__name__)


def revoke_sessions(db: Session, user_id: int, clock: Clock, except_session_id: int | None = None) -> None:
    stmt = update(UserSession).where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
    if except_session_id is not None:
        stmt = stmt.where(UserSession.id != except_session_id)
    db.execute(stmt.values(revoked_at=clock.now()))


def sync_system_admin(db: Session, settings: Settings, clock: Clock) -> User:
    """Создаёт/обновляет администратора из ADMIN_LOGIN/ADMIN_PASSWORD.

    Пароль всегда совпадает с .env. Если ADMIN_LOGIN сменили, прежний системный админ
    помечается удалённым и теряет сессии — администратор ровно один, и он из .env.
    """
    admin = db.scalar(select(User).where(User.login == settings.admin_login, User.deleted_at.is_(None)))
    if admin is None:
        admin = User(
            login=settings.admin_login,
            password_hash=hash_password(settings.admin_password),
            display_name=settings.admin_display_name,
            role=Role.admin,
            is_system=True,
        )
        db.add(admin)
        db.flush()
        log.info("System admin %r created", settings.admin_login)
    else:
        admin.role = Role.admin
        admin.is_system = True
        if not verify_password(admin.password_hash, settings.admin_password):
            admin.password_hash = hash_password(settings.admin_password)
            revoke_sessions(db, admin.id, clock)
            log.info("System admin password synced from .env")

    stale = db.scalars(
        select(User).where(User.is_system.is_(True), User.id != admin.id, User.deleted_at.is_(None))
    ).all()
    for old in stale:
        old.deleted_at = clock.now()
        revoke_sessions(db, old.id, clock)
        log.info("Previous system admin %r deactivated", old.login)
    db.flush()
    return admin
