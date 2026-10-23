"""B-06: регулярность сроков (FR-2, FR-4, FR-6, EC-1, ADR-005)."""

from datetime import date

import pytest

from app.domain.schedule import due_date_for, planned_occurrences
from app.models import Period

M = Period.monthly


@pytest.mark.parametrize(
    ("first", "seq", "expected"),
    [
        # Нет числа в месяце -> последний день; в следующем месяце число возвращается (без «дрейфа»).
        (date(2027, 1, 31), 0, date(2027, 1, 31)),
        (date(2027, 1, 31), 1, date(2027, 2, 28)),
        (date(2027, 1, 31), 2, date(2027, 3, 31)),
        (date(2027, 1, 31), 3, date(2027, 4, 30)),
        (date(2027, 1, 31), 4, date(2027, 5, 31)),
        (date(2028, 1, 31), 1, date(2028, 2, 29)),  # високосный год
        (date(2028, 1, 31), 2, date(2028, 3, 31)),
        (date(2028, 1, 29), 1, date(2028, 2, 29)),
        (date(2027, 1, 29), 1, date(2027, 2, 28)),
        (date(2027, 1, 29), 2, date(2027, 3, 29)),
        (date(2026, 11, 30), 1, date(2026, 12, 30)),
        (date(2026, 11, 30), 3, date(2027, 2, 28)),
        (date(2026, 11, 30), 4, date(2027, 3, 30)),
        (date(2026, 10, 15), 2, date(2026, 12, 15)),
        (date(2026, 10, 15), 3, date(2027, 1, 15)),  # переход года
        (date(2026, 12, 31), 1, date(2027, 1, 31)),
        (date(2026, 12, 31), 2, date(2027, 2, 28)),
        (date(2026, 8, 31), 1, date(2026, 9, 30)),
        (date(2026, 8, 31), 2, date(2026, 10, 31)),
    ],
)
def test_monthly_due_dates_follow_anchor_day(first: date, seq: int, expected: date) -> None:
    assert due_date_for(first, first.day, M, seq) == expected


@pytest.mark.parametrize(
    ("period", "first", "seq", "expected"),
    [
        (Period.weekly, date(2026, 10, 26), 0, date(2026, 10, 26)),
        (Period.weekly, date(2026, 10, 26), 1, date(2026, 11, 2)),
        (Period.weekly, date(2026, 12, 28), 1, date(2027, 1, 4)),
        (Period.quarterly, date(2026, 11, 30), 1, date(2027, 2, 28)),
        (Period.quarterly, date(2026, 11, 30), 2, date(2027, 5, 30)),
        (Period.quarterly, date(2027, 1, 31), 1, date(2027, 4, 30)),
        (Period.yearly, date(2028, 2, 29), 1, date(2029, 2, 28)),
        (Period.yearly, date(2028, 2, 29), 4, date(2032, 2, 29)),
        (Period.yearly, date(2026, 10, 23), 1, date(2027, 10, 23)),
    ],
)
def test_other_periods(period: Period, first: date, seq: int, expected: date) -> None:
    assert due_date_for(first, first.day, period, seq) == expected


def test_negative_seq_is_rejected() -> None:
    with pytest.raises(ValueError):
        due_date_for(date(2026, 1, 1), 1, M, -1)


def test_planned_occurrences_cover_horizon_and_one_future() -> None:
    planned = planned_occurrences(date(2026, 10, 26), 26, M, today=date(2026, 10, 23), horizon_days=35)
    assert planned == [(0, date(2026, 10, 26)), (1, date(2026, 11, 26))]


def test_planned_occurrences_from_the_past_include_all_missed_periods() -> None:
    """EC-2: платёж с датой в прошлом — все периоды с этой даты (будут просрочены) + будущий."""
    planned = planned_occurrences(date(2026, 7, 31), 31, M, today=date(2026, 10, 23), horizon_days=0)
    assert [d for _, d in planned] == [
        date(2026, 7, 31),
        date(2026, 8, 31),
        date(2026, 9, 30),
        date(2026, 10, 31),
    ]


def test_planned_occurrences_always_contain_a_future_period_beyond_horizon() -> None:
    planned = planned_occurrences(date(2027, 3, 1), 1, Period.yearly, today=date(2026, 10, 23), horizon_days=35)
    assert planned == [(0, date(2027, 3, 1))]


def test_planned_occurrences_start_after_existing() -> None:
    planned = planned_occurrences(
        date(2026, 9, 26), 26, M, today=date(2026, 10, 27), horizon_days=0, start_seq=1
    )
    assert planned == [(1, date(2026, 10, 26)), (2, date(2026, 11, 26))]


def test_planned_occurrences_nothing_new_when_future_exists() -> None:
    planned = planned_occurrences(
        date(2026, 10, 26), 26, M, today=date(2026, 10, 23), horizon_days=0, start_seq=1
    )
    assert planned == []
