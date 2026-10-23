"""Кнопка «Оплачено» в напоминании (FR-B1).

callback_data = "pay:<occurrence_id>:<hmac16>" — подпись от SECRET_KEY, иначе любой участник чата смог бы
сформировать callback для чужого периода. Нажатие принимается только из чата TELEGRAM_CHAT_ID.
"""

from dataclasses import dataclass
from datetime import date
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.core.security import sign, verify_signature
from app.models import OccurrenceStatus, PaymentOccurrence, RecurringPayment
from app.services import audit

PREFIX = "pay"


def pay_callback_data(occurrence_id: int, secret: str) -> str:
    return f"{PREFIX}:{occurrence_id}:{sign(secret, f'{PREFIX}:{occurrence_id}')}"


def pay_keyboard_payload(occurrence_id: int, secret: str) -> dict[str, Any]:
    """Inline-клавиатура в формате Bot API (reply_markup)."""
    return {"inline_keyboard": [[{"text": "✅ Оплачено", "callback_data": pay_callback_data(occurrence_id, secret)}]]}


@dataclass(frozen=True)
class PayResult:
    status: Literal["paid", "already_paid", "forbidden", "not_found"]
    answer: str  # всплывающий ответ на нажатие
    message_suffix: str = ""  # что дописать к сообщению после успешной отметки


def _parse(data: str, secret: str) -> int | None:
    parts = data.split(":")
    if len(parts) != 3 or parts[0] != PREFIX or not parts[1].isdigit():
        return None
    if not verify_signature(secret, f"{PREFIX}:{parts[1]}", parts[2]):
        return None
    return int(parts[1])


def handle_pay_callback(
    sessions: sessionmaker[Session],
    *,
    data: str,
    chat_id: str,
    allowed_chat_id: str,
    username: str,
    today: date,
    secret: str,
) -> PayResult:
    occurrence_id = _parse(data, secret)
    if occurrence_id is None or str(chat_id) != str(allowed_chat_id):
        return PayResult("forbidden", "Кнопка недействительна")

    label = f"Telegram @{username}" if username else "Telegram"
    with sessions() as db:
        occ = db.scalar(select(PaymentOccurrence).where(PaymentOccurrence.id == occurrence_id).with_for_update())
        if occ is None:
            return PayResult("not_found", "Период не найден: возможно, платёж удалён")
        payment = db.get(RecurringPayment, occ.recurring_payment_id)
        name = payment.name if payment else "Платёж"
        if occ.status == OccurrenceStatus.paid:
            return PayResult("already_paid", f"Уже оплачено {occ.paid_at:%d.%m.%Y}, {occ.paid_by_label or 'отметка в панели'}")

        occ.status, occ.paid_at, occ.paid_by_user_id, occ.paid_by_label = OccurrenceStatus.paid, today, None, label
        audit.record(
            db,
            "occurrence.paid",
            actor_label=label,
            entity="payment_occurrence",
            entity_id=occ.id,
            payload={
                "source": "telegram",
                "before": {"status": "unpaid", "paid_at": None},
                "after": {"status": "paid", "paid_at": today.isoformat()},
                "due_date": occ.due_date.isoformat(),
            },
        )
        db.commit()
        who = f"@{username}" if username else "в Telegram"
        return PayResult("paid", "Отмечено как оплаченное", f"\n\n✅ {name}: оплачено {who} {today:%d.%m.%Y}")
