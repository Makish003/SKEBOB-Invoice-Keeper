"""X-01: кнопка «Оплачено» в Telegram — подпись, чат, идемпотентность, аудит."""

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import FrozenClock
from app.core.db import get_sessionmaker
from app.models import AuditLog, OccurrenceStatus, PaymentOccurrence
from app.services.telegram_actions import PayResult, handle_pay_callback, pay_callback_data, pay_keyboard_payload

SECRET = "test-secret"
CHAT = "-100777"


def occurrence_id(client: TestClient, headers: dict[str, str]) -> int:
    payment = client.post(
        "/api/v1/recurring-payments",
        json={"name": "Аренда офиса", "amount": "85000.00", "currency": "RUB", "first_due_date": "2026-10-25"},
        headers=headers,
    ).json()
    return client.get(
        "/api/v1/payment-occurrences", params={"recurring_payment_id": payment["id"]}, headers=headers
    ).json()["items"][0]["id"]


def press(data: str, chat: str = CHAT, user: str = "ivan", today: date = date(2026, 10, 23)) -> PayResult:
    return handle_pay_callback(
        get_sessionmaker(), data=data, chat_id=chat, allowed_chat_id=CHAT, username=user, today=today, secret=SECRET
    )


def test_callback_data_is_signed_and_short() -> None:
    data = pay_callback_data(123456, SECRET)
    assert data.startswith("pay:123456:") and len(data.encode()) <= 64
    assert pay_callback_data(123456, "other") != data
    assert pay_keyboard_payload(5, SECRET)["inline_keyboard"][0][0]["callback_data"] == pay_callback_data(5, SECRET)


def test_button_marks_period_paid_today_with_label(
    client: TestClient, db: Session, clock: FrozenClock, admin_headers: dict[str, str]
) -> None:
    occ = occurrence_id(client, admin_headers)
    result = press(pay_callback_data(occ, SECRET))
    assert result.status == "paid"
    assert "Аренда офиса" in result.message_suffix and "@ivan" in result.message_suffix and "23.10.2026" in result.message_suffix
    row = db.get(PaymentOccurrence, occ)
    assert row is not None and row.status == OccurrenceStatus.paid
    assert (row.paid_at, row.paid_by_label) == (date(2026, 10, 23), "Telegram @ivan")
    entry = db.scalar(select(AuditLog).where(AuditLog.action == "occurrence.paid"))
    assert entry is not None and entry.actor_label == "Telegram @ivan" and entry.payload["source"] == "telegram"


def test_second_press_says_already_paid(client: TestClient, admin_headers: dict[str, str]) -> None:
    occ = occurrence_id(client, admin_headers)
    press(pay_callback_data(occ, SECRET))
    again = press(pay_callback_data(occ, SECRET), user="anna")
    assert again.status == "already_paid" and "уже" in again.answer.lower()


def test_forged_signature_is_rejected(client: TestClient, db: Session, admin_headers: dict[str, str]) -> None:
    occ = occurrence_id(client, admin_headers)
    assert press(f"pay:{occ}:0000000000000000").status == "forbidden"
    assert press(pay_callback_data(occ, "attacker-secret")).status == "forbidden"
    assert press("pay:not-a-number:abc").status == "forbidden"
    assert db.get(PaymentOccurrence, occ).status == OccurrenceStatus.unpaid  # type: ignore[union-attr]


def test_other_chat_is_rejected(client: TestClient, db: Session, admin_headers: dict[str, str]) -> None:
    occ = occurrence_id(client, admin_headers)
    assert press(pay_callback_data(occ, SECRET), chat="-100999").status == "forbidden"
    assert db.get(PaymentOccurrence, occ).status == OccurrenceStatus.unpaid  # type: ignore[union-attr]


def test_missing_period(client: TestClient, admin_headers: dict[str, str]) -> None:
    assert press(pay_callback_data(999999, SECRET)).status == "not_found"


def test_user_without_username_is_labelled_by_name(client: TestClient, db: Session, admin_headers: dict[str, str]) -> None:
    occ = occurrence_id(client, admin_headers)
    press(pay_callback_data(occ, SECRET), user="")
    assert db.get(PaymentOccurrence, occ).paid_by_label == "Telegram"  # type: ignore[union-attr]
