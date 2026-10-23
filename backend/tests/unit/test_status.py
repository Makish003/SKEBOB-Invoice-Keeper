"""B-06: просрочка и отображаемый статус (FR-9, AC-11, ADR-006)."""

from datetime import date

import pytest

from app.domain.status import DisplayStatus, compute_status
from app.models import OccurrenceStatus

DUE = date(2026, 10, 26)
U, P = OccurrenceStatus.unpaid, OccurrenceStatus.paid


@pytest.mark.parametrize(
    ("status", "paid_at", "today", "overdue", "days", "until", "display"),
    [
        # Не оплачен: просрочка со следующего дня после срока.
        (U, None, date(2026, 10, 20), False, 0, 6, DisplayStatus.upcoming),
        (U, None, date(2026, 10, 22), False, 0, 4, DisplayStatus.upcoming),
        (U, None, date(2026, 10, 23), False, 0, 3, DisplayStatus.due_soon),
        (U, None, date(2026, 10, 25), False, 0, 1, DisplayStatus.due_soon),
        (U, None, date(2026, 10, 26), False, 0, 0, DisplayStatus.due_today),  # в день срока — не просрочен
        (U, None, date(2026, 10, 27), True, 1, -1, DisplayStatus.overdue),  # срок + 1 — просрочен на 1 день
        (U, None, date(2026, 11, 5), True, 10, -10, DisplayStatus.overdue),
        # Оплачен: просрочка только если оплачен позже срока.
        (P, date(2026, 10, 20), date(2026, 10, 30), False, 0, -4, DisplayStatus.paid),  # ранняя оплата
        (P, date(2026, 10, 26), date(2026, 10, 30), False, 0, -4, DisplayStatus.paid),  # в день срока — вовремя
        (P, date(2026, 10, 27), date(2026, 10, 30), True, 1, -4, DisplayStatus.paid_late),
        (P, date(2026, 10, 29), date(2026, 10, 30), True, 3, -4, DisplayStatus.paid_late),
        (P, date(2026, 10, 1), date(2026, 10, 1), False, 0, 25, DisplayStatus.paid),  # оплачен заранее, срок впереди
    ],
)
def test_compute_status(
    status: OccurrenceStatus,
    paid_at: date | None,
    today: date,
    overdue: bool,
    days: int,
    until: int,
    display: DisplayStatus,
) -> None:
    info = compute_status(DUE, status, paid_at, today, soon_days=3)
    assert (info.is_overdue, info.overdue_days, info.days_until_due, info.display_status) == (
        overdue,
        days,
        until,
        display,
    )


def test_fixing_paid_date_to_due_date_removes_overdue() -> None:
    """AC-10: исправили фактическую дату на срок — просрочка пропала, срок тот же."""
    late = compute_status(DUE, P, date(2026, 10, 28), date(2026, 10, 30), soon_days=3)
    fixed = compute_status(DUE, P, DUE, date(2026, 10, 30), soon_days=3)
    assert late.is_overdue and not fixed.is_overdue


def test_paid_without_date_is_invalid() -> None:
    with pytest.raises(ValueError):
        compute_status(DUE, P, None, DUE, soon_days=3)
