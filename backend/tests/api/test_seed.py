"""B-12: демо-данные показывают все статусы, идемпотентны и дают пользователя user/user12345."""

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import FrozenClock
from app.core.config import get_settings
from app.models import RecurringPayment, Reminder
from app.seed import seed_demo_data
from tests.conftest import login


def test_seed_shows_every_status_and_is_idempotent(
    client: TestClient, db: Session, clock: FrozenClock, admin_headers: dict[str, str]
) -> None:
    assert seed_demo_data(db, clock, get_settings()) is True
    assert seed_demo_data(db, clock, get_settings()) is False  # повторный запуск ничего не делает
    assert db.scalar(select(func.count()).select_from(RecurringPayment)) == 6

    user_headers = login(client, "user", "user12345")
    items = client.get("/api/v1/payment-occurrences", params={"limit": 200}, headers=user_headers).json()["items"]
    statuses = {i["display_status"] for i in items}
    assert {"paid", "paid_late", "due_soon", "due_today", "overdue", "upcoming"} <= statuses
    assert {i["currency"] for i in items} == {"RUB", "USD", "EUR"}

    names: dict[str, dict] = {}
    for item in items:  # отсортированы по сроку: берём первый неоплаченный период каждого платежа
        if item["status"] == "unpaid":
            names.setdefault(item["recurring_payment"]["name"], item)
    assert names["Аренда офиса"]["days_until_due"] == 2  # напоминание при старте
    assert names["Сервер Hetzner"]["is_overdue"] and names["Сервер Hetzner"]["overdue_days"] == 10
    assert any(i["recurring_payment"]["name"] == "Подписка Figma" and i["display_status"] == "paid_late" for i in items)
    assert any(i["paid_by_label"] == "Иван Петров" for i in items)

    rent = names["Аренда офиса"]
    assert db.scalar(select(func.count()).select_from(Reminder).where(Reminder.occurrence_id == rent["id"])) == 1

    summary = client.get("/api/v1/payments/summary", headers=user_headers).json()
    assert all(row["count_total"] > 0 for row in summary["currencies"])
