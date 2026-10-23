"""Когда пора напоминать о периоде (FR-18…FR-22). Чистая функция; дедупликация — в БД (ADR-007)."""

from datetime import date, timedelta

from app.models import OccurrenceStatus


def reminder_due(
    *, due_date: date, status: OccurrenceStatus, payment_active: bool, today: date, days_before: int
) -> bool:
    """Неоплаченный период активного платежа, срок в окне [сегодня; сегодня + days_before].

    Если платёж добавлен позже начала окна, условие истинно сразу (FR-19).
    """
    return (
        payment_active
        and status == OccurrenceStatus.unpaid
        and today <= due_date <= today + timedelta(days=days_before)
    )
