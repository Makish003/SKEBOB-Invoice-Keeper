"""X-06: webhook — тело, подпись, ошибки как NotifierError (без сети: httpx.MockTransport)."""

import asyncio
import hashlib
import hmac
import json
from datetime import date
from decimal import Decimal

import httpx
import pytest

from app.core.config import Settings
from app.models import Channel
from app.services.notifiers.base import NotifierError, ReminderMessage
from app.services.notifiers.webhook import WebhookNotifier
from app.services.reminders import active_channels

MESSAGE = ReminderMessage(5, 9, "Аренда офиса", Decimal("85000"), "RUB", date(2026, 10, 26), 3)


def test_posts_signed_json() -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(204)

    notifier = WebhookNotifier("https://hooks.example.com/ik", "s3cret", httpx.MockTransport(handler))
    assert asyncio.run(notifier.send(MESSAGE)) == "204"
    request = captured[0]
    body = json.loads(request.content)
    assert body["event"] == "payment.reminder" and body["amount"] == "85000.00" and body["due_date"] == "2026-10-26"
    assert body["payment_name"] == "Аренда офиса" and body["currency"] == "RUB"
    expected = "sha256=" + hmac.new(b"s3cret", request.content, hashlib.sha256).hexdigest()
    assert request.headers["X-Signature"] == expected


@pytest.mark.parametrize("status", [400, 500])
def test_error_status_is_retryable_failure(status: int) -> None:
    notifier = WebhookNotifier("https://x", "", httpx.MockTransport(lambda r: httpx.Response(status)))
    with pytest.raises(NotifierError):
        asyncio.run(notifier.send(MESSAGE))


def test_network_error_is_notifier_error() -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    with pytest.raises(NotifierError):
        asyncio.run(WebhookNotifier("https://x", "", httpx.MockTransport(boom)).send(MESSAGE))


def test_webhook_channel_enabled_by_url() -> None:
    assert active_channels(Settings(webhook_url="")) == [Channel.console]
    assert active_channels(Settings(webhook_url="https://x")) == [Channel.console, Channel.webhook]
