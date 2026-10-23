"""FastAPI-приложение Invoice Keeper. Swagger — /api/v1/docs, OpenAPI — /api/v1/openapi.json."""

from fastapi import FastAPI

from app.api.v1.router import api_router
from app.core.errors import install_error_handlers
from app.core.logging import setup_logging

API_PREFIX = "/api/v1"

DESCRIPTION = """
Напоминания о регулярных платежах: регулярные платежи, их периоды и отметки оплаты, итоги по валютам, пользователи.

**Авторизация.** `POST /api/v1/auth/login` ставит httpOnly-cookie `ik_session` (её использует веб-панель и этот Swagger
после входа через «Try it out») и возвращает `access_token`: его можно вставить в **Authorize → bearerAuth**.
Без сессии все эндпоинты, кроме входа и документации, отвечают `401`.

**Роли.** Администратор (задаётся в `.env`) управляет регулярными платежами и пользователями; пользователь видит все
платежи и отмечает оплату. Права проверяются на сервере: действия администратора от пользователя — `403`.

**Форматы.** Даты — `YYYY-MM-DD`, «сегодня» — в часовом поясе `APP_TIMEZONE`. Деньги — строки с двумя знаками
(`"85000.00"`), валюты RUB, USD, EUR без конвертации. Ошибки — `{"error": {"code", "message", "details"}}`.
"""

TAGS = [
    {"name": "Авторизация", "description": "Вход, текущий пользователь, выход (завершение текущей сессии)."},
    {"name": "Регулярные платежи", "description": "Шаблоны повторяющихся расходов. Создание и прекращение — администратор."},
    {"name": "Периоды оплаты", "description": "Конкретные периоды со своим сроком и отметкой оплаты. Отмечать могут все."},
    {"name": "Итоги", "description": "Суммы по валютам отдельно, без конвертации."},
    {"name": "Пользователи", "description": "Управление обычными пользователями — только администратор."},
    {"name": "Служебное", "description": "Проверка работоспособности и параметры для интерфейса."},
]


def create_app() -> FastAPI:
    setup_logging()
    app = FastAPI(
        title="Invoice Keeper API",
        version="1.0.0",
        description=DESCRIPTION,
        openapi_tags=TAGS,
        servers=[{"url": "/", "description": "Текущий хост (веб-панель на :8080 проксирует /api)"}],
        contact={"name": "Команда SKEBOB", "url": "https://github.com/Makish003/SKEBOB-Invoice-Keeper"},
        docs_url=f"{API_PREFIX}/docs",
        redoc_url=None,
        openapi_url=f"{API_PREFIX}/openapi.json",
    )
    install_error_handlers(app)
    app.include_router(api_router, prefix=API_PREFIX)
    return app


app = create_app()
