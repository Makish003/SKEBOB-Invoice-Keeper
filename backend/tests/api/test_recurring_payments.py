"""B-07: регулярные платежи — права (AC-3), создание с периодами и напоминанием (AC-7), мягкое удаление (AC-14)."""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import FrozenClock
from app.models import AuditLog, OccurrenceStatus, PaymentOccurrence, RecurringPayment, Reminder, ReminderStatus

URL = "/api/v1/recurring-payments"
RENT = {"name": "Аренда офиса", "amount": "85000.00", "currency": "RUB", "first_due_date": "2026-10-24"}


def create(client: TestClient, headers: dict[str, str], **overrides: object) -> dict:
    response = client.post(URL, json={**RENT, **overrides}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.parametrize(("method", "path"), [("get", URL), ("post", URL), ("get", f"{URL}/1"), ("delete", f"{URL}/1")])
def test_requires_auth(client: TestClient, method: str, path: str) -> None:
    response = client.request(method, path, json=RENT if method == "post" else None)
    assert response.status_code == 401


def test_user_cannot_create_or_delete(
    client: TestClient, db: Session, admin_headers: dict[str, str], user_headers: dict[str, str]
) -> None:
    payment = create(client, admin_headers)
    assert client.post(URL, json=RENT, headers=user_headers).status_code == 403
    assert client.delete(f"{URL}/{payment['id']}", headers=user_headers).status_code == 403
    assert db.scalar(select(func.count()).select_from(RecurringPayment)) == 1
    assert db.get(RecurringPayment, payment["id"]).deleted_at is None  # type: ignore[union-attr]


def test_user_can_list_and_get(client: TestClient, admin_headers: dict[str, str], user_headers: dict[str, str]) -> None:
    payment = create(client, admin_headers)
    listed = client.get(URL, headers=user_headers)
    assert listed.status_code == 200 and listed.json()["total"] == 1
    assert client.get(f"{URL}/{payment['id']}", headers=user_headers).json()["name"] == "Аренда офиса"


def test_create_returns_payment_with_next_occurrence(
    client: TestClient, db: Session, admin_headers: dict[str, str]
) -> None:
    body = create(client, admin_headers, first_due_date="2026-10-31", description="Офис на Ленина")
    assert body["amount"] == "85000.00" and body["currency"] == "RUB" and body["period"] == "monthly"
    assert body["is_active"] is True and body["deleted_at"] is None
    assert body["next_occurrence"]["due_date"] == "2026-10-31"
    assert body["next_occurrence"]["display_status"] == "upcoming"
    dues = db.scalars(select(PaymentOccurrence.due_date).order_by(PaymentOccurrence.seq)).all()
    assert dues == [date(2026, 10, 31)]  # 30.11 за горизонтом 35 дней (до 27.11) — появится позже
    assert db.scalar(select(AuditLog.action).where(AuditLog.entity == "recurring_payment")) == "recurring_payment.created"


def test_create_due_tomorrow_queues_reminder_immediately(client: TestClient, db: Session, admin_headers: dict[str, str]) -> None:
    """AC-7 / FR-19: создан внутри окна 3 дней — напоминание ставится в очередь сразу при POST."""
    create(client, admin_headers, first_due_date="2026-10-24")
    reminders = db.scalars(select(Reminder)).all()
    assert len(reminders) == 1
    assert reminders[0].status == ReminderStatus.pending and reminders[0].channel == "console"
    audit_entry = db.scalar(select(AuditLog).where(AuditLog.action == "recurring_payment.created"))
    assert audit_entry is not None and audit_entry.payload["reminders_queued"] == 1


def test_create_far_due_has_no_reminder_yet(client: TestClient, db: Session, admin_headers: dict[str, str]) -> None:
    create(client, admin_headers, first_due_date="2026-11-10")
    assert db.scalar(select(func.count()).select_from(Reminder)) == 0


def test_create_with_past_date_generates_overdue_periods(client: TestClient, admin_headers: dict[str, str]) -> None:
    """EC-2: дата в прошлом — периоды с этой даты, прошлые просрочены."""
    body = create(client, admin_headers, first_due_date="2026-08-31", name="Сервер", currency="USD", amount="49.90")
    occurrences = client.get(
        "/api/v1/payment-occurrences", params={"recurring_payment_id": body["id"]}, headers=admin_headers
    ).json()["items"]
    assert [o["due_date"] for o in occurrences] == ["2026-08-31", "2026-09-30", "2026-10-31"]
    assert [o["is_overdue"] for o in occurrences] == [True, True, False]


@pytest.mark.parametrize(
    "overrides",
    [
        {"amount": "0"},
        {"amount": "-5"},
        {"amount": "1.234"},
        {"amount": "abc"},
        {"currency": "GBP"},
        {"name": "   "},
        {"period": "daily"},
        {"first_due_date": "2026-02-30"},
        {"first_due_date": "1990-01-01"},
        {"role": "admin"},
    ],
)
def test_create_validation(client: TestClient, admin_headers: dict[str, str], overrides: dict) -> None:
    response = client.post(URL, json={**RENT, **overrides}, headers=admin_headers)
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "validation_error"


def test_amount_accepts_number_and_normalizes(client: TestClient, admin_headers: dict[str, str]) -> None:
    assert create(client, admin_headers, amount=49.9)["amount"] == "49.90"


def test_soft_delete_keeps_history_and_stops_future(
    client: TestClient, db: Session, clock: FrozenClock, admin_headers: dict[str, str]
) -> None:
    """AC-14: прошлые периоды и оплаты видны, будущие не создаются, напоминания отменены."""
    payment = create(client, admin_headers, first_due_date="2026-09-24")
    past = db.scalar(select(PaymentOccurrence).where(PaymentOccurrence.due_date == date(2026, 9, 24)))
    assert past is not None
    past.status, past.paid_at = OccurrenceStatus.paid, date(2026, 9, 24)
    db.commit()

    assert client.delete(f"{URL}/{payment['id']}", headers=admin_headers).status_code == 204

    remaining = db.scalars(select(PaymentOccurrence.due_date).order_by(PaymentOccurrence.due_date)).all()
    assert remaining == [date(2026, 9, 24)]  # будущие неоплаченные (24.10, 24.11) удалены, история на месте
    assert all(r.status == ReminderStatus.cancelled for r in db.scalars(select(Reminder)))

    active = client.get(URL, headers=admin_headers).json()
    assert active["total"] == 0
    archived = client.get(URL, params={"include_deleted": True}, headers=admin_headers).json()
    assert archived["items"][0]["is_active"] is False and archived["items"][0]["next_occurrence"] is None

    clock.set(date(2027, 1, 10))  # прошли месяцы: новых периодов у прекращённого платежа нет
    client.get("/api/v1/payment-occurrences", params={"include_deleted": True}, headers=admin_headers)
    assert db.scalar(select(func.count()).select_from(PaymentOccurrence)) == 1


def test_delete_twice_and_missing_are_404(client: TestClient, admin_headers: dict[str, str]) -> None:
    payment = create(client, admin_headers)
    assert client.delete(f"{URL}/{payment['id']}", headers=admin_headers).status_code == 204
    assert client.delete(f"{URL}/{payment['id']}", headers=admin_headers).status_code == 404
    assert client.delete(f"{URL}/999", headers=admin_headers).status_code == 404
    assert client.get(f"{URL}/999", headers=admin_headers).status_code == 404


def test_same_payment_can_be_created_twice(client: TestClient, admin_headers: dict[str, str]) -> None:
    """EC-10: повторный POST — это другой платёж."""
    create(client, admin_headers)
    create(client, admin_headers)
    assert client.get(URL, headers=admin_headers).json()["total"] == 2
