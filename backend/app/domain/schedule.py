"""Сроки периодов регулярного платежа (FR-2, FR-4, ADR-005). Чистые функции, без БД."""

import calendar
from datetime import date, timedelta

from app.models import Period

_MONTHS_PER_PERIOD = {Period.monthly: 1, Period.quarterly: 3, Period.yearly: 12}
MAX_GENERATED = 1000


def add_months(start: date, months: int, anchor_day: int) -> date:
    """Месяц + N; день = anchor_day или последний день месяца, если такого числа нет."""
    index = start.year * 12 + (start.month - 1) + months
    year, month = divmod(index, 12)
    month += 1
    return date(year, month, min(anchor_day, calendar.monthrange(year, month)[1]))


def due_date_for(first_due_date: date, anchor_day: int, period: Period, seq: int) -> date:
    """Срок периода номер seq (0 — первый). Считается от исходной даты, а не от предыдущего срока."""
    if seq < 0:
        raise ValueError("seq must be >= 0")
    if period == Period.weekly:
        return first_due_date + timedelta(weeks=seq)
    return add_months(first_due_date, _MONTHS_PER_PERIOD[period] * seq, anchor_day)


def planned_occurrences(
    first_due_date: date,
    anchor_day: int,
    period: Period,
    *,
    today: date,
    horizon_days: int,
    start_seq: int = 0,
) -> list[tuple[int, date]]:
    """Периоды, которые должны существовать, начиная с start_seq (уже созданные — раньше).

    Создаются все периоды со сроком не позже today + horizon_days и, кроме того, минимум один
    будущий (срок > today), чтобы «следующий период» всегда был виден (ADR-004).
    """
    until = today + timedelta(days=horizon_days)
    has_future = start_seq > 0 and due_date_for(first_due_date, anchor_day, period, start_seq - 1) > today
    planned: list[tuple[int, date]] = []
    for seq in range(start_seq, start_seq + MAX_GENERATED):
        due = due_date_for(first_due_date, anchor_day, period, seq)
        if due > until and has_future:
            break
        planned.append((seq, due))
        has_future = has_future or due > today
    return planned
