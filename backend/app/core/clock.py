"""Единственный источник «сегодня» и «сейчас» (FR-3, ADR-011).

Вне этого модуля нельзя вызывать date.today() / datetime.now().
"""

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from app.core.config import Settings, get_settings


class Clock:
    def __init__(self, timezone: str, override: date | None = None) -> None:
        self.tz = ZoneInfo(timezone)
        self.override = override

    def today(self) -> date:
        """Текущая дата в часовом поясе приложения (APP_TIMEZONE)."""
        if self.override is not None:
            return self.override
        return datetime.now(self.tz).date()

    def now(self) -> datetime:
        """Текущий момент (UTC, aware) — для меток времени, не для сроков."""
        return datetime.now(UTC)


class FrozenClock(Clock):
    """Часы с ручным управлением «сегодня» — для тестов."""

    def __init__(self, today: date, timezone: str = "Europe/Moscow") -> None:
        super().__init__(timezone, override=today)

    def set(self, today: date) -> None:
        self.override = today


def build_clock(settings: Settings) -> Clock:
    override = settings.clock_override if settings.app_env != "production" else None
    return Clock(settings.app_timezone, override)


_clock: Clock | None = None


def get_clock() -> Clock:
    global _clock
    if _clock is None:
        _clock = build_clock(get_settings())
    return _clock
