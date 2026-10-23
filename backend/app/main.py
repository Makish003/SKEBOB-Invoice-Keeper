"""FastAPI-приложение Invoice Keeper. Swagger — /api/v1/docs, OpenAPI — /api/v1/openapi.json."""

from fastapi import FastAPI

from app.api.v1.router import api_router
from app.core.errors import install_error_handlers
from app.core.logging import setup_logging

API_PREFIX = "/api/v1"


def create_app() -> FastAPI:
    setup_logging()
    app = FastAPI(
        title="Invoice Keeper API",
        version="1.0.0",
        description="Напоминания о регулярных платежах: регулярные платежи, периоды, оплаты, итоги, пользователи.",
        docs_url=f"{API_PREFIX}/docs",
        redoc_url=None,
        openapi_url=f"{API_PREFIX}/openapi.json",
    )
    install_error_handlers(app)
    app.include_router(api_router, prefix=API_PREFIX)
    return app


app = create_app()
