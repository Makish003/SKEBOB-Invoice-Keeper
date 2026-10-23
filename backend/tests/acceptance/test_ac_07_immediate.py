"""AC-7 Сразу: платёж со сроком через 1 день → напоминание без ожидания планового тика."""

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import FrozenClock
from app.models import Reminder, ReminderStatus
from tests.acceptance.helpers import RecordingNotifier, check_reminders, create_payment


def test_reminder_goes_out_without_scheduled_tick(
    client: TestClient, db: Session, clock: FrozenClock, admin_headers: dict[str, str]
) -> None:
    create_payment(client, admin_headers, first_due_date="2026-10-24")  # сегодня 23.10 → срок завтра
    reminder = db.scalar(select(Reminder))
    assert reminder is not None and reminder.status == ReminderStatus.pending  # поставлено прямо в POST

    notifier = RecordingNotifier()
    check_reminders(clock, notifier, with_tick=False)  # только быстрый опрос очереди (каждые 5 с)
    assert len(notifier.sent) == 1 and notifier.sent[0].days_until_due == 1
