"""Изменение регулярного платежа (ADR-022)."""

from datetime import date
from typing import Any

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.errors import conflict, unprocessable
from app.models import OccurrenceStatus, PaymentOccurrence, RecurringPayment
from app.schemas.payments import RecurringPaymentPatch


def update_payment(db: Session, payment: RecurringPayment, patch: RecurringPaymentPatch, today: date) -> dict[str, Any]:
    """Применяет изменения и возвращает данные для аудита: {"changes": {поле: [было, стало]}, "periods_repriced": n}."""
    fields = patch.model_fields_set
    if not fields:
        raise unprocessable("Нет изменений: передайте name, amount или description")
    for required in ("name", "amount"):
        if required in fields and getattr(patch, required) is None:
            raise unprocessable(f"Поле {required} не может быть пустым")
    if payment.deleted_at is not None:
        raise conflict("Платёж прекращён: изменить его нельзя. Создайте новый платёж")

    changes: dict[str, list[Any]] = {}
    if "name" in fields and patch.name != payment.name:
        changes["name"] = [payment.name, patch.name]
        payment.name = patch.name  # type: ignore[assignment]
    if "description" in fields and (patch.description or None) != payment.description:
        changes["description"] = [payment.description, patch.description or None]
        payment.description = patch.description or None
    repriced = 0
    if "amount" in fields and patch.amount != payment.amount:
        assert patch.amount is not None
        changes["amount"] = [f"{payment.amount:.2f}", f"{patch.amount:.2f}"]
        payment.amount = patch.amount
        repriced = (
            db.execute(
                update(PaymentOccurrence)
                .where(
                    PaymentOccurrence.recurring_payment_id == payment.id,
                    PaymentOccurrence.status == OccurrenceStatus.unpaid,
                    PaymentOccurrence.due_date >= today,
                )
                .values(amount=patch.amount)
            ).rowcount
            or 0
        )
    return {"changes": changes, "periods_repriced": repriced}
