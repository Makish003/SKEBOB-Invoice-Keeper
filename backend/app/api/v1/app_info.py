from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.deps import current_user
from app.core.clock import Clock, get_clock
from app.core.config import get_settings
from app.models import User
from app.schemas.common import errors
from app.services.reminders import active_channels

router = APIRouter(tags=["Служебное"])


class AppInfo(BaseModel):
    today: date = Field(description="«Сегодня» в часовом поясе приложения (с учётом CLOCK_OVERRIDE в dev)")
    timezone: str
    reminder_days_before: int
    reminder_channels: list[str] = Field(description="Куда уходят напоминания: telegram или console (лог воркера)")
    version: str


@router.get(
    "/app-info",
    response_model=AppInfo,
    summary="Параметры приложения для интерфейса",
    description="«Сегодня» в часовом поясе приложения и настройки напоминаний — чтобы интерфейс не зависел от часов браузера.",
    responses=errors(401),
)
def app_info(clock: Clock = Depends(get_clock), user: User = Depends(current_user)) -> AppInfo:
    settings = get_settings()
    return AppInfo(
        today=clock.today(),
        timezone=settings.app_timezone,
        reminder_days_before=settings.reminder_days_before,
        reminder_channels=[c.value for c in active_channels(settings)],
        version="1.0.0",
    )
