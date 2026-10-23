from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, current_user, get_auth
from app.core.clock import Clock, get_clock
from app.core.db import get_db
from app.core.errors import AppError
from app.models import User
from app.schemas.auth import LoginIn, LoginOut
from app.schemas.common import errors
from app.schemas.users import UserOut

router = APIRouter(prefix="/auth", tags=["Авторизация"])


@router.post(
    "/login",
    response_model=LoginOut,
    summary="Вход по логину и паролю",
    description="Создаёт сессию: ставит httpOnly-cookie `ik_session` и возвращает `access_token` для Bearer.",
    responses=errors(401, 422, 429),
)
def login(
    body: LoginIn,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> LoginOut:
    raise AppError(501, "Ещё не реализовано")


@router.get("/me", response_model=UserOut, summary="Текущий пользователь", responses=errors(401))
def me(user: User = Depends(current_user)) -> UserOut:
    raise AppError(501, "Ещё не реализовано")


@router.post(
    "/logout",
    status_code=204,
    summary="Завершение текущей сессии",
    description="Отзывает текущую сессию: её токен и cookie больше не действуют.",
    responses=errors(401),
)
def logout(
    request: Request,
    response: Response,
    auth: AuthContext = Depends(get_auth),
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
) -> Response:
    raise AppError(501, "Ещё не реализовано")
