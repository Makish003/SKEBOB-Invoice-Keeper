"""Настройки приложения из переменных окружения (.env, см. .env.example)."""

from datetime import date
from functools import lru_cache
from typing import Literal
from urllib.parse import quote

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    # --- App ---
    app_env: Literal["development", "production", "test"] = "development"
    app_timezone: str = "Europe/Moscow"
    secret_key: str = "change-me"
    cookie_secure: bool = False
    session_ttl_hours: int = 168
    seed_demo_data: bool = True
    clock_override: date | None = None

    # --- Admin (FR-12) ---
    admin_login: str = "admin"
    admin_password: str = "admin12345"
    admin_display_name: str = "Администратор"

    # --- Database (DATABASE_URL необязателен: по умолчанию собирается из POSTGRES_*) ---
    postgres_db: str = "invoice_keeper"
    postgres_user: str = "invoice_keeper"
    postgres_password: str = "invoice_keeper"
    postgres_host: str = "db"
    postgres_port: int = 5432
    database_url: str = ""

    # --- Reminders ---
    reminder_days_before: int = 3
    reminder_check_interval_seconds: int = 60
    pending_poll_seconds: int = 5
    generation_horizon_days: int = 35
    reminder_max_attempts: int = 5
    overdue_reminder_max: int = 3  # напоминаний о просрочке на период (раз в день); 0 — выключено
    overdue_reminder_window_days: int = 30  # о более старых просрочках не напоминаем (защита от лавины сообщений)

    # --- Telegram ---
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""
    # Адрес панели для кнопок бота. Пусто — https://DOMAIN (сервер) или http://localhost:WEB_PORT (локально).
    public_url: str = ""
    domain: str = ""
    web_port: int = 8080

    # --- Чеки (FR-B8) ---
    uploads_dir: str = "/srv/uploads"
    max_upload_mb: int = 5

    # --- Bonus channels ---
    webhook_url: str = ""
    webhook_secret: str = ""
    smtp_host: str = ""
    smtp_port: int = 1025
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "invoice-keeper@example.com"
    email_to: str = ""

    @field_validator("clock_override", mode="before")
    @classmethod
    def _empty_to_none(cls, value: object) -> object:
        return None if value in ("", None) else value

    @model_validator(mode="after")
    def _default_database_url(self) -> "Settings":
        if not self.database_url:
            self.database_url = (
                f"postgresql+psycopg://{quote(self.postgres_user)}:{quote(self.postgres_password)}"
                f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
            )
        return self

    @property
    def telegram_enabled(self) -> bool:
        return bool(self.telegram_bot_token and self.telegram_chat_id)

    @property
    def site_url(self) -> str:
        if self.public_url:
            return self.public_url.rstrip("/")
        return f"https://{self.domain}" if self.domain else f"http://localhost:{self.web_port}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
