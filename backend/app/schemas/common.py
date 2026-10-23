from decimal import Decimal
from typing import Annotated, Any

from pydantic import BaseModel, Field, PlainSerializer

# Деньги: Decimal внутри, строка с двумя знаками в JSON (NFR-5, ADR-010).
Money = Annotated[
    Decimal,
    PlainSerializer(lambda v: f"{v:.2f}", return_type=str, when_used="json"),
    Field(examples=["85000.00"]),
]


class ErrorBody(BaseModel):
    code: str = Field(examples=["forbidden"])
    message: str = Field(examples=["Недостаточно прав для этого действия"])
    details: Any | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


_DESCRIPTIONS = {
    400: "Некорректный запрос",
    401: "Не выполнен вход или сессия истекла",
    403: "Недостаточно прав",
    404: "Объект не найден",
    409: "Конфликт (например, логин занят)",
    422: "Ошибка валидации входных данных",
    429: "Слишком много попыток входа",
}


def errors(*codes: int) -> dict[int | str, dict[str, Any]]:
    """Описание ошибок операции для OpenAPI в едином формате."""
    return {code: {"model": ErrorResponse, "description": _DESCRIPTIONS[code]} for code in codes}
