"""B-11: конвейер напоминаний без сети (фейковый нотифаер): AC-6, AC-7, AC-8, AC-14, EC-6."""

import asyncio
from datetime import date, timedelta
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import FrozenClock
from app.core.config import get_settings
from app.core.db import get_sessionmaker
from app.models import Channel, Reminder, ReminderStatus
from app.services.delivery import deliver_pending, tick
from app.services.notifiers.base import NotifierError, ReminderMessage, format_message


class FakeNotifier:
    channel = Channel.console

    def __init__(self, fail_times: int = 0) -> None:
        self.sent: list[ReminderMessage] = []
        self.fail_times = fail_times

    async def send(self, message: ReminderMessage) -> str | None:
        if self.fail_times > 0:
            self.fail_times -= 1
            raise NotifierError("Telegram недоступен")
        self.sent.append(message)
        return str(len(self.sent))


def run_tick(clock: FrozenClock) -> None:
    with get_sessionmaker()() as db:
        tick(db, clock.today(), get_settings())


def deliver(clock: FrozenClock, notifier: FakeNotifier, now_shift: timedelta = timedelta()) -> int:
    return asyncio.run(
        deliver_pending(
            get_sessionmaker(),
            clock.today(),
            get_settings(),
            {Channel.console: notifier},
            now=clock.now() + now_shift,
        )
    )


def create(client: TestClient, headers: dict[str, str], due: str, **extra: str) -> dict:
    body = {"name": "Аренда офиса", "amount": "85000.00", "currency": "RUB", "first_due_date": due, **extra}
    response = client.post("/api/v1/recurring-payments", json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def statuses(db: Session) -> list[str]:
    db.expire_all()
    return [r.status.value for r in db.scalars(select(Reminder).order_by(Reminder.id))]


def test_reminder_sent_once_despite_repeated_checks(
    client: TestClient, db: Session, clock: FrozenClock, admin_headers: dict[str, str]
) -> None:
    """AC-6: срок через ≤ 3 дня → одно сообщение с названием, суммой, валютой, датой; повторы без дублей."""
    create(client, admin_headers, "2026-11-10")  # пока вне окна
    notifier = FakeNotifier()
    clock.set(date(2026, 11, 7))  # за 3 дня до срока
    for _ in range(3):
        run_tick(clock)
        deliver(clock, notifier)
    assert len(notifier.sent) == 1
    message = notifier.sent[0]
    assert (message.payment_name, message.amount, message.currency, message.due_date) == (
        "Аренда офиса",
        Decimal("85000.00"),
        "RUB",
        date(2026, 11, 10),
    )
    assert statuses(db) == ["sent"]


def test_payment_created_inside_window_is_sent_without_tick(
    client: TestClient, db: Session, clock: FrozenClock, admin_headers: dict[str, str]
) -> None:
    """AC-7: POST со сроком через 1 день → напоминание уходит на ближайшем коротком опросе, без планового тика."""
    create(client, admin_headers, "2026-10-24")
    notifier = FakeNotifier()
    assert deliver(clock, notifier) == 1
    assert notifier.sent[0].days_until_due == 1


def test_paid_before_window_gets_no_reminder(
    client: TestClient, db: Session, clock: FrozenClock, admin_headers: dict[str, str]
) -> None:
    """AC-8: оплачен до входа в окно 3 дней → напоминания нет."""
    payment = create(client, admin_headers, "2026-11-10")
    occ_id = client.get(
        "/api/v1/payment-occurrences", params={"recurring_payment_id": payment["id"]}, headers=admin_headers
    ).json()["items"][0]["id"]
    client.patch(f"/api/v1/payment-occurrences/{occ_id}", json={"status": "paid"}, headers=admin_headers)
    clock.set(date(2026, 11, 8))
    run_tick(clock)
    notifier = FakeNotifier()
    deliver(clock, notifier)
    assert notifier.sent == [] and statuses(db) == []


def test_paid_after_queueing_is_cancelled_not_sent(
    client: TestClient, db: Session, clock: FrozenClock, admin_headers: dict[str, str]
) -> None:
    payment = create(client, admin_headers, "2026-10-25")  # pending сразу
    occ_id = client.get(
        "/api/v1/payment-occurrences", params={"recurring_payment_id": payment["id"]}, headers=admin_headers
    ).json()["items"][0]["id"]
    client.patch(f"/api/v1/payment-occurrences/{occ_id}", json={"status": "paid"}, headers=admin_headers)
    notifier = FakeNotifier()
    deliver(clock, notifier)
    assert notifier.sent == [] and statuses(db) == ["cancelled"]


def test_deleted_payment_has_no_new_reminders_or_periods(
    client: TestClient, db: Session, clock: FrozenClock, admin_headers: dict[str, str]
) -> None:
    """AC-14: после удаления проверка напоминаний и генерация периодов ничего не создают."""
    payment = create(client, admin_headers, "2026-10-25")
    client.delete(f"/api/v1/recurring-payments/{payment['id']}", headers=admin_headers)
    notifier = FakeNotifier()
    for day in (date(2026, 10, 24), date(2026, 11, 22), date(2026, 12, 23)):
        clock.set(day)
        run_tick(clock)
        deliver(clock, notifier)
    assert notifier.sent == []
    history = client.get("/api/v1/payment-occurrences", params={"include_deleted": True}, headers=admin_headers).json()
    assert history["total"] == 0  # единственный период был в будущем и удалён при прекращении


def test_failure_is_retried_with_backoff_without_duplicates(
    client: TestClient, db: Session, clock: FrozenClock, admin_headers: dict[str, str]
) -> None:
    """EC-6: ошибка → failed, ретрай после паузы → sent, без дублей."""
    create(client, admin_headers, "2026-10-24")
    notifier = FakeNotifier(fail_times=2)
    deliver(clock, notifier)
    assert statuses(db) == ["failed"]
    reminder = db.scalar(select(Reminder))
    assert reminder is not None and reminder.attempts == 1 and "недоступен" in (reminder.last_error or "")

    deliver(clock, notifier)  # пауза ещё не прошла — попытки нет
    db.refresh(reminder)
    assert reminder.attempts == 1

    deliver(clock, notifier, now_shift=timedelta(minutes=2))  # вторая неудача
    deliver(clock, notifier, now_shift=timedelta(hours=1))  # успех
    deliver(clock, notifier, now_shift=timedelta(hours=2))  # больше ничего не уходит
    db.refresh(reminder)
    assert (reminder.status, reminder.attempts, len(notifier.sent)) == (ReminderStatus.sent, 3, 1)


def test_gives_up_after_max_attempts(
    client: TestClient, db: Session, clock: FrozenClock, admin_headers: dict[str, str]
) -> None:
    create(client, admin_headers, "2026-10-24")
    notifier = FakeNotifier(fail_times=100)
    for hours in range(0, 20, 2):
        deliver(clock, notifier, now_shift=timedelta(hours=hours))
    reminder = db.scalar(select(Reminder))
    assert reminder is not None and reminder.status == ReminderStatus.failed
    assert reminder.attempts == get_settings().reminder_max_attempts


def test_overdue_by_the_time_of_sending_is_cancelled(
    client: TestClient, db: Session, clock: FrozenClock, admin_headers: dict[str, str]
) -> None:
    create(client, admin_headers, "2026-10-24")
    clock.set(date(2026, 10, 26))  # воркер не работал, срок уже прошёл
    notifier = FakeNotifier()
    deliver(clock, notifier)
    assert notifier.sent == [] and statuses(db) == ["cancelled"]


def test_message_text_contains_required_fields() -> None:
    """FR-18: название, сумма, валюта, дата оплаты."""
    text = format_message(
        ReminderMessage(
            reminder_id=1,
            occurrence_id=7,
            payment_name="Аренда <офиса>",
            amount=Decimal("85000.00"),
            currency="RUB",
            due_date=date(2026, 10, 26),
            days_until_due=3,
        )
    )
    assert "Аренда &lt;офиса&gt;" in text  # HTML экранирован
    assert "85 000,00 RUB" in text
    assert "26.10.2026" in text and "через 3 дня" in text


def test_worker_leaves_channels_it_cannot_send(
    client: TestClient, db: Session, clock: FrozenClock, admin_headers: dict[str, str]
) -> None:
    """Воркер без webhook-нотифаера не трогает webhook-напоминания (их отправит воркер, у которого он есть)."""
    create(client, admin_headers, "2026-10-24")
    occ_id = db.scalar(select(Reminder.occurrence_id))
    db.add(Reminder(occurrence_id=occ_id, channel=Channel.webhook, remind_on=date(2026, 10, 24)))
    db.commit()
    deliver(clock, FakeNotifier())  # только console
    db.expire_all()
    rows = {r.channel.value: r.status.value for r in db.scalars(select(Reminder))}
    assert rows == {"console": "sent", "webhook": "pending"}
