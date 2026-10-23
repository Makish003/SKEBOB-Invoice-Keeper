from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.users import UserOut


class LoginIn(BaseModel):
    login: str = Field(min_length=1, max_length=64, examples=["admin"])
    password: str = Field(min_length=1, max_length=128, examples=["admin12345"])


class LoginOut(BaseModel):
    access_token: str = Field(description="Токен сессии: заголовок `Authorization: Bearer <token>` (Swagger → Authorize)")
    token_type: Literal["bearer"] = "bearer"
    expires_at: datetime
    user: UserOut
