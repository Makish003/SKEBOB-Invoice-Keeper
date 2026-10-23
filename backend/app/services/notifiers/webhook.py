"""Канал webhook (FR-B6): POST JSON на WEBHOOK_URL, подпись X-Signature: sha256=<hmac(body)>."""

import hashlib
import hmac
import json
from typing import Any

import httpx

from app.models import Channel
from app.services.notifiers.base import NotifierError, ReminderMessage, format_plain

TIMEOUT_SECONDS = 10


def webhook_body(message: ReminderMessage) -> dict[str, Any]:
    return {
        "event": "payment.overdue" if message.kind == "overdue" else "payment.reminder",
        "kind": message.kind,
        "reminder_id": message.reminder_id,
        "occurrence_id": message.occurrence_id,
        "payment_name": message.payment_name,
        "amount": f"{message.amount:.2f}",
        "currency": message.currency,
        "due_date": message.due_date.isoformat(),
        "days_until_due": message.days_until_due,
        "text": format_plain(message),
    }


def signature(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


class WebhookNotifier:
    channel = Channel.webhook

    def __init__(self, url: str, secret: str, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.url = url
        self.secret = secret
        self.transport = transport

    async def send(self, message: ReminderMessage) -> str | None:
        body = json.dumps(webhook_body(message), ensure_ascii=False).encode()
        headers = {"Content-Type": "application/json", "X-Event": "payment.reminder"}
        if self.secret:
            headers["X-Signature"] = signature(self.secret, body)
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS, transport=self.transport) as client:
                response = await client.post(self.url, content=body, headers=headers)
        except httpx.HTTPError as exc:
            raise NotifierError(f"Webhook: {exc}") from exc
        if response.status_code >= 300:
            raise NotifierError(f"Webhook ответил {response.status_code}")
        return str(response.status_code)
