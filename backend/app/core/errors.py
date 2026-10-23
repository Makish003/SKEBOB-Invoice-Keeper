"""Единый формат ошибок API: {"error": {"code", "message", "details"}}."""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger(__name__)

_CODES = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    422: "validation_error",
    429: "too_many_requests",
    501: "not_implemented",
}


class AppError(Exception):
    def __init__(self, status: int, message: str, code: str | None = None, details: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code or _CODES.get(status, "error")
        self.message = message
        self.details = details


def unauthorized(message: str = "Требуется вход в систему") -> AppError:
    return AppError(401, message)


def forbidden(message: str = "Недостаточно прав для этого действия") -> AppError:
    return AppError(403, message)


def not_found(message: str = "Объект не найден") -> AppError:
    return AppError(404, message)


def conflict(message: str) -> AppError:
    return AppError(409, message)


def unprocessable(message: str, details: Any = None) -> AppError:
    return AppError(422, message, details=details)


def _body(code: str, message: str, details: Any = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        headers = {"WWW-Authenticate": "Bearer"} if exc.status == 401 else None
        return JSONResponse(_body(exc.code, exc.message, exc.details), status_code=exc.status, headers=headers)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        message = exc.detail if isinstance(exc.detail, str) else "Ошибка запроса"
        if exc.status_code == 404 and message == "Not Found":
            message = "Ресурс не найден"
        if exc.status_code == 405:
            message = "Метод не поддерживается"
        return JSONResponse(
            _body(_CODES.get(exc.status_code, "error"), message),
            status_code=exc.status_code,
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = [
            {"loc": list(err.get("loc", ())), "msg": err.get("msg", ""), "type": err.get("type", "")}
            for err in exc.errors()
        ]
        return JSONResponse(_body("validation_error", "Проверьте введённые данные", details), status_code=422)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("Unhandled error", exc_info=exc)
        return JSONResponse(_body("internal_error", "Внутренняя ошибка сервера"), status_code=500)
