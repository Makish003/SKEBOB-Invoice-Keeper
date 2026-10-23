"""Просрочка и отображаемый статус периода (FR-9, ADR-006): вычисляются от «сегодня», не хранятся."""

import enum
from dataclasses import dataclass
from datetime import date

from app.models import OccurrenceStatus


class DisplayStatus(enum.StrEnum):
    paid = "paid"
    paid_late = "paid_late"
    upcoming = "upcoming"
    due_soon = "due_soon"
    due_today = "due_today"
    overdue = "overdue"


@dataclass(frozen=True)
class StatusInfo:
    is_overdue: bool
    overdue_days: int
    days_until_due: int
    display_status: DisplayStatus


def compute_status(
    due_date: date, status: OccurrenceStatus, paid_at: date | None, today: date, *, soon_days: int
) -> StatusInfo:
    """Просрочка = (не оплачен и сегодня > срока) или (оплачен и paid_at > срока). В день срока — вовремя."""
    days_until_due = (due_date - today).days
    if status == OccurrenceStatus.paid:
        if paid_at is None:
            raise ValueError("paid occurrence must have paid_at")
        late_days = max((paid_at - due_date).days, 0)
        display = DisplayStatus.paid_late if late_days else DisplayStatus.paid
        return StatusInfo(late_days > 0, late_days, days_until_due, display)

    if days_until_due < 0:
        return StatusInfo(True, -days_until_due, days_until_due, DisplayStatus.overdue)
    if days_until_due == 0:
        display = DisplayStatus.due_today
    elif days_until_due <= soon_days:
        display = DisplayStatus.due_soon
    else:
        display = DisplayStatus.upcoming
    return StatusInfo(False, 0, days_until_due, display)
