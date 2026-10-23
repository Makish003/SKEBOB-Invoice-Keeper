from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import client_ip, require_admin
from app.core.clock import Clock, get_clock
from app.core.db import get_db
from app.core.errors import conflict, forbidden, not_found
from app.core.security import hash_password
from app.models import Role, User
from app.schemas.common import errors
from app.schemas.users import UserCreate, UserList, UserOut, UserUpdate
from app.services import audit
from app.services.users import revoke_sessions

router = APIRouter(prefix="/users", tags=["Пользователи"])

ADMIN_IMMUTABLE = "Администратор задаётся в .env и не изменяется через панель или API"
NO_ADMIN_ROLE = "Роль администратора назначить нельзя: администратор задаётся в .env"
LOGIN_TAKEN = "Логин уже занят. Выберите другой"


def _active_user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise not_found("Пользователь не найден")
    return user


def _ensure_login_free(db: Session, login: str, exclude_id: int | None = None) -> None:
    query = select(User.id).where(User.login == login, User.deleted_at.is_(None))
    if exclude_id is not None:
        query = query.where(User.id != exclude_id)
    if db.scalar(query) is not None:
        raise conflict(LOGIN_TAKEN)


@router.get(
    "",
    response_model=UserList,
    summary="Список пользователей",
    description="Активные пользователи; первым — администратор из .env.",
    responses=errors(401, 403),
)
def list_users(db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> UserList:
    users = db.scalars(
        select(User).where(User.deleted_at.is_(None)).order_by(User.is_system.desc(), User.login)
    ).all()
    return UserList(items=[UserOut.model_validate(u) for u in users], total=len(users))


@router.get("/{user_id}", response_model=UserOut, summary="Пользователь по id", responses=errors(401, 403, 404))
def get_user(user_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)) -> UserOut:
    return UserOut.model_validate(_active_user(db, user_id))


@router.post(
    "",
    response_model=UserOut,
    status_code=201,
    summary="Создание обычного пользователя",
    description="Всегда создаёт роль `user`. Попытка передать `role=admin` → 403. Занятый логин → 409.",
    responses=errors(401, 403, 409, 422),
)
def create_user(
    body: UserCreate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> UserOut:
    if body.role is not None and body.role != Role.user:
        raise forbidden(NO_ADMIN_ROLE)
    _ensure_login_free(db, body.login)
    user = User(
        login=body.login,
        password_hash=hash_password(body.password),
        display_name=body.display_name or body.login,
        role=Role.user,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise conflict(LOGIN_TAKEN) from exc
    audit.record(
        db, "user.created", actor=admin, entity="user", entity_id=user.id, payload={"login": user.login}, ip=client_ip(request)
    )
    db.commit()
    return UserOut.model_validate(user)


@router.patch(
    "/{user_id}",
    response_model=UserOut,
    summary="Изменение пользователя",
    description=(
        "Логин, имя, пароль обычного пользователя. Смена пароля завершает все сессии пользователя. "
        "Администратор из .env не изменяется (403); повысить роль до admin нельзя (403)."
    ),
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
    user = _active_user(db, user_id)
    if user.is_system or user.role == Role.admin:
        raise forbidden(ADMIN_IMMUTABLE)
    if body.role is not None and body.role != Role.user:
        raise forbidden(NO_ADMIN_ROLE)

    changed: list[str] = []
    if body.login is not None and body.login != user.login:
        _ensure_login_free(db, body.login, exclude_id=user.id)
        user.login = body.login
        changed.append("login")
    if body.display_name is not None and body.display_name != user.display_name:
        user.display_name = body.display_name
        changed.append("display_name")
    if body.password is not None:
        user.password_hash = hash_password(body.password)
        revoke_sessions(db, user.id, clock)
        changed.append("password")
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise conflict(LOGIN_TAKEN) from exc
    if changed:
        audit.record(
            db, "user.updated", actor=admin, entity="user", entity_id=user.id, payload={"fields": changed}, ip=client_ip(request)
        )
    db.commit()
    return UserOut.model_validate(user)


@router.delete(
    "/{user_id}",
    status_code=204,
    summary="Удаление пользователя",
    description=(
        "Мягкое удаление: сессии завершаются, вход невозможен, отметки оплат в истории сохраняются "
        "(с именем отметившего). Администратор из .env → 403. Повторное удаление → 404."
    ),
    responses=errors(401, 403, 404),
)
def delete_user(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    clock: Clock = Depends(get_clock),
    admin: User = Depends(require_admin),
) -> Response:
    user = _active_user(db, user_id)
    if user.is_system or user.role == Role.admin:
        raise forbidden(ADMIN_IMMUTABLE)
    user.deleted_at = clock.now()
    revoke_sessions(db, user.id, clock)
    audit.record(
        db, "user.deleted", actor=admin, entity="user", entity_id=user.id, payload={"login": user.login}, ip=client_ip(request)
    )
    db.commit()
    return Response(status_code=204)
