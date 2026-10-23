from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.models import Role

Login = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=3, max_length=64, pattern=r"^[A-Za-z0-9._-]+$"),
    Field(description="Латиница, цифры, точка, дефис, подчёркивание; 3–64 символа", examples=["ivan"]),
]
Password = Annotated[str, StringConstraints(min_length=8, max_length=128), Field(examples=["secret-pass"])]
DisplayName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120), Field(examples=["Иван Петров"])
]


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    login: str
    display_name: str
    role: Role
    is_system: bool = Field(description="Администратор из .env: не изменяется и не удаляется через API")
    created_at: datetime


class UserList(BaseModel):
    items: list[UserOut]
    total: int


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    login: Login
    password: Password
    display_name: DisplayName | None = Field(default=None, description="По умолчанию равно логину")
    role: Role | None = Field(
        default=None, description="Только `user`. Администратор задаётся в .env, `admin` → 403"
    )


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    login: Login | None = None
    password: Password | None = Field(default=None, description="Новый пароль; сессии пользователя завершаются")
    display_name: DisplayName | None = None
    role: Role | None = Field(default=None, description="Повысить до `admin` нельзя → 403")
