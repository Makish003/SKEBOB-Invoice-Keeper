"""Заявки администратору (ADR-029): создание с файлами и платежами, видимость, обработка, права."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import AuditLog, TicketAttachment
from tests.conftest import USER_PASSWORD, create_user, login

URL = "/api/v1/support-tickets"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
PDF = b"%PDF-1.7\n" + b"0" * 64


def occurrence_id(client: TestClient, admin_headers: dict[str, str]) -> int:
    client.post(
        "/api/v1/recurring-payments",
        json={"name": "Аренда офиса", "amount": "85000.00", "currency": "RUB", "first_due_date": "2026-10-26"},
        headers=admin_headers,
    )
    return client.get("/api/v1/payment-occurrences", headers=admin_headers).json()["items"][0]["id"]


def create(client: TestClient, headers: dict[str, str], **form: object):  # type: ignore[no-untyped-def]
    files = form.pop("files", None)
    data = {"topic": "bug", "description": "Не отмечается оплата", **form}
    return client.post(URL, data=data, files=files, headers=headers)  # type: ignore[arg-type]


def test_user_creates_ticket_with_files_and_payments(
    client: TestClient, db: Session, admin_headers: dict[str, str], user_headers: dict[str, str]
) -> None:
    occ = occurrence_id(client, admin_headers)
    response = create(
        client,
        user_headers,
        topic="payment",
        description="  Сумма в периоде не совпадает со счётом  ",
        occurrence_ids=[occ, occ],
        files=[("files", ("счёт.pdf", PDF, "application/pdf")), ("files", ("screen.png", PNG, "image/png"))],
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["topic"] == "payment" and body["status"] == "open" and body["admin_reply"] is None
    assert body["description"] == "Сумма в периоде не совпадает со счётом"
    assert body["author"]["login"] == "user"
    assert [a["file_name"] for a in body["attachments"]] == ["счёт.pdf", "screen.png"]
    assert body["attachments"][0]["content_type"] == "application/pdf" and body["attachments"][0]["size"] == len(PDF)
    assert body["payments"] == [
        {
            "occurrence_id": occ,
            "recurring_payment_id": body["payments"][0]["recurring_payment_id"],
            "name": "Аренда офиса",
            "due_date": "2026-10-26",
            "amount": "85000.00",
            "currency": "RUB",
            "status": "unpaid",
        }
    ]

    file_url = f"{URL}/{body['id']}/attachments/{body['attachments'][0]['id']}"
    download = client.get(file_url, headers=admin_headers)
    assert download.status_code == 200 and download.content == PDF
    assert download.headers["content-type"] == "application/pdf"
    assert client.get(file_url, headers=user_headers).status_code == 200

    entry = db.scalars(select(AuditLog).where(AuditLog.action == "ticket.created")).one()
    assert entry.entity_id == body["id"] and entry.payload == {"topic": "payment", "files": 2, "payments": [occ]}


def test_ticket_without_files_and_payments(client: TestClient, user_headers: dict[str, str]) -> None:
    response = create(client, user_headers, topic="question")
    assert response.status_code == 201, response.text
    assert response.json()["attachments"] == [] and response.json()["payments"] == []


@pytest.mark.parametrize(
    "form",
    [
        {"topic": "unknown"},
        {"description": "   "},
        {"description": "x" * 4001},
        {"occurrence_ids": [999]},
        {"occurrence_ids": list(range(1, 12))},
        {"files": [("files", ("evil.exe", b"MZ\x90\x00" + b"0" * 32, "application/octet-stream"))]},
        {"files": [("files", (f"{i}.png", PNG, "image/png")) for i in range(6)]},
    ],
)
def test_validation(client: TestClient, user_headers: dict[str, str], form: dict[str, object]) -> None:
    assert create(client, user_headers, **form).status_code == 422
    assert client.get(URL, headers=user_headers).json()["total"] == 0


def test_bad_file_after_good_one_leaves_no_orphans(client: TestClient, user_headers: dict[str, str]) -> None:
    uploads = Path(get_settings().uploads_dir)
    before = set(uploads.iterdir()) if uploads.exists() else set()
    files = [("files", ("ok.png", PNG, "image/png")), ("files", ("fake.pdf", b"<html>", "application/pdf"))]
    assert create(client, user_headers, files=files).status_code == 422
    assert (set(uploads.iterdir()) if uploads.exists() else set()) == before


def test_too_large_file(client: TestClient, user_headers: dict[str, str]) -> None:
    big = PNG + b"0" * (get_settings().max_upload_mb * 1024 * 1024)
    assert create(client, user_headers, files=[("files", ("big.png", big, "image/png"))]).status_code == 413


def test_user_sees_only_own_tickets_admin_sees_all(
    client: TestClient, db: Session, admin_headers: dict[str, str], user_headers: dict[str, str]
) -> None:
    create_user(db, login="petr", name="Пётр")
    petr_headers = login(client, "petr", USER_PASSWORD)
    own = create(client, user_headers, files=[("files", ("a.png", PNG, "image/png"))]).json()
    other = create(client, petr_headers, topic="access", description="Не могу войти с телефона").json()

    mine = client.get(URL, headers=user_headers).json()
    assert [t["id"] for t in mine["items"]] == [own["id"]] and mine["total"] == 1
    everyone = client.get(URL, headers=admin_headers).json()
    assert [t["id"] for t in everyone["items"]] == [other["id"], own["id"]] and everyone["total"] == 2

    # Чужая заявка и её файлы для пользователя не существуют.
    assert client.get(f"{URL}/{own['id']}", headers=petr_headers).status_code == 404
    file_url = f"{URL}/{own['id']}/attachments/{own['attachments'][0]['id']}"
    assert client.get(file_url, headers=petr_headers).status_code == 404
    assert client.get(f"{URL}/{own['id']}/attachments/{own['attachments'][0]['id'] + 99}", headers=user_headers).status_code == 404
    assert db.scalar(select(TicketAttachment.id)) is not None


def test_admin_processes_ticket(
    client: TestClient, db: Session, admin_headers: dict[str, str], user_headers: dict[str, str]
) -> None:
    ticket = create(client, user_headers).json()
    url = f"{URL}/{ticket['id']}"

    body = client.patch(url, json={"status": "in_progress"}, headers=admin_headers).json()
    assert body["status"] == "in_progress" and body["admin_reply"] is None
    body = client.patch(url, json={"status": "resolved", "admin_reply": " Исправили, проверьте "}, headers=admin_headers).json()
    assert body["status"] == "resolved" and body["admin_reply"] == "Исправили, проверьте"

    seen = client.get(url, headers=user_headers).json()
    assert seen["status"] == "resolved" and seen["admin_reply"] == "Исправили, проверьте"
    assert client.get(URL, params={"status": "resolved"}, headers=user_headers).json()["total"] == 1
    assert client.get(URL, params={"status": "open"}, headers=admin_headers).json()["total"] == 0

    assert client.patch(url, json={"admin_reply": ""}, headers=admin_headers).json()["admin_reply"] is None
    payloads = db.scalars(select(AuditLog.payload).where(AuditLog.action == "ticket.updated").order_by(AuditLog.id)).all()
    assert payloads == [
        {"status": {"from": "open", "to": "in_progress"}},
        {"status": {"from": "in_progress", "to": "resolved"}, "admin_reply": {"from": None, "to": "Исправили, проверьте"}},
        {"admin_reply": {"from": "Исправили, проверьте", "to": None}},
    ]


@pytest.mark.parametrize("body", [{}, {"status": None}, {"status": "closed"}, {"admin_reply": "x" * 4001}, {"extra": 1}])
def test_patch_validation(client: TestClient, admin_headers: dict[str, str], user_headers: dict[str, str], body: dict[str, object]) -> None:
    ticket = create(client, user_headers).json()
    assert client.patch(f"{URL}/{ticket['id']}", json=body, headers=admin_headers).status_code == 422


def test_only_admin_processes_tickets(client: TestClient, admin_headers: dict[str, str], user_headers: dict[str, str]) -> None:
    ticket = create(client, user_headers).json()
    response = client.patch(f"{URL}/{ticket['id']}", json={"status": "resolved"}, headers=user_headers)
    assert response.status_code == 403
    assert client.get(f"{URL}/{ticket['id']}", headers=admin_headers).json()["status"] == "open"
    assert client.patch(f"{URL}/999", json={"status": "resolved"}, headers=admin_headers).status_code == 404


def test_requires_session(client: TestClient) -> None:
    assert client.post(URL, data={"topic": "bug", "description": "x"}).status_code == 401
    assert client.get(URL).status_code == 401
    assert client.get(f"{URL}/1/attachments/1").status_code == 401
