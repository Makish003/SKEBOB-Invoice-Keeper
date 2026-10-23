from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.api.deps import AuthContext, get_auth, require_admin
from app.core.clock import Clock, get_clock
from app.core.db import get_db
from app.core.errors import AppError
from app.models import User
from app.schemas.common import errors
from app.schemas.users import UserCreate, UserList, UserOut, UserUpdate

router = APIRouter(prefix="/users", tags=["Пользователи"])


@router.get("", response_model=UserList, summary="Список пользователей", responses=errors(401, 403))
def list_users(db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> UserList:
    raise AppError(501, "Ещё не реализовано")


@router.get("/{user_id}", response_model=UserOut, summary="Пользователь по id", responses=errors(401, 403, 404))
def get_user(user_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> UserOut:
    raise AppError(501, "Ещё не реализовано")


@router.post(
    "",
    response_model=UserOut,
    status_code=201,
    summary="Создание обычного пользователя",
    description="Всегда создаёт роль `user`. Администратор задаётся только в .env.",
    responses=errors(401, 403, 409, 422),
)
def create_user(
    body: UserCreate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> UserOut:
    raise AppError(501, "Ещё не реализовано")


@router.patch(
    "/{user_id}",
    response_model=UserOut,
    summary="Изменение пользователя",
    description="Логин, имя, пароль обычного пользователя. Администратор из .env не изменяется → 403.",
    responses=errors(401, 403, 404, 409, 422),
)
def update_user(
    user_id: int,
    body: UserUpdate,
    request: Request,
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
    admin: User = Depends(require_admin),
) -> UserOut:
    raise AppError(501, "Ещё не реализовано")


@router.delete(
    "/{user_id}",
    status_code=204,
    summary="Удаление пользователя",
    description="Мягкое удаление: сессии завершаются, отметки оплат в истории сохраняются. Администратор → 403.",
    responses=errors(401, 403, 404),
)
def delete_user(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
    auth: AuthContext = Depends(get_auth),
    admin: User = Depends(require_admin),
) -> Response:
    raise AppError(501, "Ещё не реализовано")
