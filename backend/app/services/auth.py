"""Вход и сессии (ADR-009): серверные сессии, в БД только sha256 токена."""

import time
from collections import defaultdict, deque
from datetime import datetime, timedelta
from threading import Lock

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import Clock
from app.core.security import hash_password, hash_token, new_session_token, verify_password
from app.models import User, UserSession

# Хеш для выравнивания времени ответа, когда логина нет (не выдаём существование пользователя).
_DUMMY_HASH = hash_password("timing-equalizer")


class LoginLimiter:
    """Не более `limit` неудачных попыток за `window` секунд на пару (IP, логин). In-memory: один процесс API."""

    def __init__(self, limit: int = 5, window: float = 60.0) -> None:
        self.limit = limit
        self.window = window
        self._failures: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def _prune(self, key: str, now: float) -> deque[float]:
        attempts = self._failures[key]
        while attempts and now - attempts[0] > self.window:
            attempts.popleft()
        return attempts

    def is_blocked(self, key: str) -> bool:
        with self._lock:
            return len(self._prune(key, time.monotonic())) >= self.limit

    def fail(self, key: str) -> None:
        with self._lock:
            now = time.monotonic()
            self._prune(key, now).append(now)

    def succeed(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)

    def reset(self) -> None:
        with self._lock:
            self._failures.clear()


def authenticate(db: Session, login: str, password: str) -> User | None:
    user = db.scalar(select(User).where(User.login == login, User.deleted_at.is_(None)))
    if user is None:
        verify_password(_DUMMY_HASH, password)
        return None
    return user if verify_password(user.password_hash, password) else None


def open_session(
    db: Session, user: User, clock: Clock, ttl_hours: int, user_agent: str | None, ip: str | None
) -> tuple[str, datetime]:
    token = new_session_token()
    expires_at = clock.now() + timedelta(hours=ttl_hours)
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_token(token),
            expires_at=expires_at,
            user_agent=(user_agent or "")[:400] or None,
            ip=ip,
        )
    )
    return token, expires_at
