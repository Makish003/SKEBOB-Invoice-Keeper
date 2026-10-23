"""Демо-данные (FR-28): аренда в RUB, сервер в USD, подписка в EUR и ещё три платежа — все статусы сразу.

Сроки считаются от «сегодня», поэтому демо выглядит одинаково в любой день.
Запускается при старте backend, если SEED_DEMO_DATA=true и в БД ещё нет платежей; вручную: python -m app.seed
"""

import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import Clock, get_clock
from app.core.config import Settings, get_settings
from app.core.db import get_sessionmaker
from app.core.logging import setup_logging
from app.core.security import hash_password
from app.domain.schedule import add_months
from app.models import (
    Currency,
    OccurrenceStatus,
    PaymentOccurrence,
    Period,
    RecurringPayment,
    Role,
    User,
)
from app.services import audit
from app.services.occurrences import ensure_for_payment
from app.services.reminders import enqueue_due
from app.services.users import sync_system_admin

log = logging.getLogger("app.seed")

_MONTHS = {Period.monthly: 1, Period.quarterly: 3, Period.yearly: 12}


@dataclass
class DemoPayment:
    name: str
    amount: str
    currency: Currency
    period: Period
    due_in_days: int  # срок «текущего» периода относительно сегодня
    history: int  # сколько прошлых периодов до него
    paid: dict[int, tuple[int, str]] = field(default_factory=dict)  # seq -> (дней после срока, кто отметил)
    description: str | None = None


DEMO_USERS = [("user", "user12345", "Иван Петров"), ("anna", "anna12345", "Анна Смирнова")]

DEMO_PAYMENTS = [
    DemoPayment(
        "Аренда офиса", "85000.00", Currency.RUB, Period.monthly, 2, 3,
        {0: (0, "Иван Петров"), 1: (-1, "Анна Смирнова"), 2: (0, "Иван Петров")},
        "Офис на Садовой, договор № 12",
    ),
    DemoPayment(
        "Сервер Hetzner", "49.90", Currency.USD, Period.monthly, -10, 2,
        {0: (0, "Администратор"), 1: (0, "Администратор")},
        "CX31, продакшн",
    ),
    DemoPayment(
        "Подписка Figma", "15.00", Currency.EUR, Period.monthly, 12, 2,
        {0: (0, "Анна Смирнова"), 1: (2, "Анна Смирнова")},
    ),
    DemoPayment(
        "Домен invoice-keeper.ru", "1990.00", Currency.RUB, Period.yearly, 40, 1, {0: (-3, "Администратор")}
    ),
    DemoPayment(
        "Google Workspace", "36.00", Currency.USD, Period.monthly, 0, 2,
        {0: (0, "Иван Петров"), 1: (1, "Иван Петров")},
    ),
    DemoPayment(
        "Бухгалтерия (аутсорс)", "25000.00", Currency.RUB, Period.monthly, 6, 1, {0: (-2, "Анна Смирнова")}
    ),
]


def _create_payment(db: Session, demo: DemoPayment, admin: User, today: date, settings: Settings) -> None:
    target = today + timedelta(days=demo.due_in_days)
    first = add_months(target, -demo.history * _MONTHS[demo.period], target.day)
    payment = RecurringPayment(
        name=demo.name,
        amount=Decimal(demo.amount),
        currency=demo.currency,
        period=demo.period,
        first_due_date=first,
        anchor_day=first.day,
        description=demo.description,
        created_by=admin.id,
    )
    db.add(payment)
    db.flush()
    ensure_for_payment(db, payment, today, settings.generation_horizon_days)
    users = {u.display_name: u for u in db.scalars(select(User))}
    for occ in db.scalars(select(PaymentOccurrence).where(PaymentOccurrence.recurring_payment_id == payment.id)):
        if occ.seq in demo.paid:
            offset, who = demo.paid[occ.seq]
            occ.status = OccurrenceStatus.paid
            occ.paid_at = min(occ.due_date + timedelta(days=offset), today)
            payer = users.get(who)
            occ.paid_by_user_id, occ.paid_by_label = (payer.id if payer else None), who


def seed_demo_data(db: Session, clock: Clock, settings: Settings) -> bool:
    """Заполняет пустую БД. Возвращает False, если платежи уже есть (идемпотентно)."""
    if db.scalar(select(func.count()).select_from(RecurringPayment)):
        return False
    today = clock.today()
    admin = sync_system_admin(db, settings, clock)
    for login, password, name in DEMO_USERS:
        if db.scalar(select(User).where(User.login == login, User.deleted_at.is_(None))) is None:
            db.add(User(login=login, password_hash=hash_password(password), display_name=name, role=Role.user))
    db.flush()
    for demo in DEMO_PAYMENTS:
        _create_payment(db, demo, admin, today, settings)
    queued = enqueue_due(db, today, settings)
    audit.record(db, "seed.demo_data", actor_label="system", payload={"payments": len(DEMO_PAYMENTS), "reminders": queued})
    db.commit()
    log.info("Demo data created: %s payments, %s reminder(s) queued", len(DEMO_PAYMENTS), queued)
    return True


def main() -> None:
    setup_logging()
    with get_sessionmaker()() as db:
        if not seed_demo_data(db, get_clock(), get_settings()):
            log.info("Payments already exist: demo data not added")


if __name__ == "__main__":
    main()
