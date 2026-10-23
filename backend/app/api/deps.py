"""Зависимости авторизации: каждый эндпоинт явно объявляет current_user или require_admin (FR-15)."""

from dataclasses import dataclass

from fastapi import Depends, Request, Security
from fastapi.security import APIKeyCookie, HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import Clock, get_clock
from app.core.db import get_db
from app.core.errors import forbidden, unauthorized
from app.core.security import hash_token
from app.models import Role, User, UserSession

SESSION_COOKIE = "ik_session"

cookie_scheme = APIKeyCookie(
    name=SESSION_COOKIE,
    auto_error=False,
    scheme_name="cookieAuth",
    description="httpOnly-cookie сессии, ставится `POST /auth/login` (используется веб-панелью)",
)
bearer_scheme = HTTPBearer(
    auto_error=False,
    scheme_name="bearerAuth",
    description="`access_token` из ответа `POST /auth/login`",
)


@dataclass(frozen=True)
class AuthContext:
    user: User
    session: UserSession


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def get_auth(
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
    cookie_token: str | None = Security(cookie_scheme),
    bearer: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
) -> AuthContext:
    token = bearer.credentials if bearer else cookie_token
    if not token:
        raise unauthorized()
    row = db.execute(
        select(UserSession, User)
        .join(User, User.id == UserSession.user_id)
        .where(
            UserSession.token_hash == hash_token(token),
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > clock.now(),
            User.deleted_at.is_(None),
        )
    ).first()
    if row is None:
        raise unauthorized("Сессия завершена или истекла. Войдите снова")
    session, user = row
    return AuthContext(user=user, session=session)


def current_user(auth: AuthContext = Depends(get_auth)) -> User:
    return auth.user


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != Role.admin:
        raise forbidden("Действие доступно только администратору")
    return user
