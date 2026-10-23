"""B-06: правило «пора напоминать» (FR-18, FR-19, FR-21, FR-22)."""

from datetime import date

import pytest

from app.domain.reminders import reminder_due
from app.models import OccurrenceStatus

DUE = date(2026, 10, 26)
U, P = OccurrenceStatus.unpaid, OccurrenceStatus.paid


@pytest.mark.parametrize(
    ("today", "status", "active", "expected"),
    [
        (date(2026, 10, 22), U, True, False),  # за 4 дня — рано
        (date(2026, 10, 23), U, True, True),  # ровно за 3 дня
        (date(2026, 10, 25), U, True, True),  # создан позже окна — сразу (FR-19)
        (date(2026, 10, 26), U, True, True),  # в день срока
        (date(2026, 10, 27), U, True, False),  # срок прошёл — это уже «просрочка», не upcoming
        (date(2026, 10, 24), P, True, False),  # оплачен — без напоминания (FR-21)
        (date(2026, 10, 24), U, False, False),  # платёж прекращён (FR-22)
    ],
)
def test_reminder_due(today: date, status: OccurrenceStatus, active: bool, expected: bool) -> None:
    assert reminder_due(due_date=DUE, status=status, payment_active=active, today=today, days_before=3) is expected


def test_days_before_is_configurable() -> None:
    assert reminder_due(due_date=DUE, status=U, payment_active=True, today=date(2026, 10, 19), days_before=7)
