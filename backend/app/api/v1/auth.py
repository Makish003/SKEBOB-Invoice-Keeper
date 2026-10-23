from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import SESSION_COOKIE, AuthContext, client_ip, current_user, get_auth
from app.core.clock import Clock, get_clock
from app.core.config import get_settings
from app.core.db import get_db
from app.core.errors import AppError, unauthorized
from app.models import User
from app.schemas.auth import LoginIn, LoginOut
from app.schemas.common import errors
from app.schemas.users import UserOut
from app.services import audit
from app.services.auth import LoginLimiter, authenticate, open_session

router = APIRouter(prefix="/auth", tags=["Авторизация"])

login_limiter = LoginLimiter(limit=5, window=60)

INVALID_CREDENTIALS = "Неверный логин или пароль"


@router.post(
    "/login",
    response_model=LoginOut,
    summary="Вход по логину и паролю",
    description=(
        "Создаёт сессию: ставит httpOnly-cookie `ik_session` и возвращает `access_token` для Bearer. "
        "После 5 неудачных попыток за минуту с одного IP для логина — 429."
    ),
    responses=errors(401, 422, 429),
)
def login(
    body: LoginIn,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> LoginOut:
    settings = get_settings()
    ip = client_ip(request)
    key = f"{ip}:{body.login.strip().lower()}"
    if login_limiter.is_blocked(key):
        raise AppError(429, "Слишком много попыток входа. Подождите минуту и попробуйте снова")

    user = authenticate(db, body.login.strip(), body.password)
    if user is None:
        login_limiter.fail(key)
        audit.record(db, "auth.login.failed", actor_label=body.login[:64], payload={"login": body.login[:64]}, ip=ip)
        db.commit()
        raise unauthorized(INVALID_CREDENTIALS)

    login_limiter.succeed(key)
    token, expires_at = open_session(
        db, user, clock, settings.session_ttl_hours, request.headers.get("user-agent"), ip
    )
    audit.record(db, "auth.login.success", actor=user, entity="user", entity_id=user.id, ip=ip)
    db.commit()

    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    return LoginOut(access_token=token, expires_at=expires_at, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut, summary="Текущий пользователь", responses=errors(401))
def me(user: User = Depends(current_user)) -> UserOut:
    return UserOut.model_validate(user)


@router.post(
    "/logout",
    status_code=204,
    summary="Завершение текущей сессии",
    description="Отзывает текущую сессию: её токен и cookie больше не действуют. Другие сессии пользователя остаются.",
    responses=errors(401),
)
def logout(
    request: Request,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> Response:
    session = db.merge(auth.session)
    session.revoked_at = clock.now()
    audit.record(db, "auth.logout", actor=auth.user, entity="user", entity_id=auth.user.id, ip=client_ip(request))
    db.commit()
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="lax")
    return response
