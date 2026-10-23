"""Настройки приложения из переменных окружения (.env, см. .env.example)."""

from datetime import date
from functools import lru_cache
from typing import Literal

from pydantic import field_validator
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

    # --- Database ---
    database_url: str = "postgresql+psycopg://invoice_keeper:invoice_keeper@db:5432/invoice_keeper"

    # --- Reminders ---
    reminder_days_before: int = 3
    reminder_check_interval_seconds: int = 60
    pending_poll_seconds: int = 5
    generation_horizon_days: int = 35
    reminder_max_attempts: int = 5

    # --- Telegram ---
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

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

    @property
    def telegram_enabled(self) -> bool:
        return bool(self.telegram_bot_token and self.telegram_chat_id)


@lru_cache
def get_settings() -> Settings:
    return Settings()
