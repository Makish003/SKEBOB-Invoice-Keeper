"""Заявки администратору (ADR-029, ADR-030): создание с файлами и платежами, видимость, чат, непрочитанное, права."""

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
    assert body["topic"] == "payment" and body["status"] == "open" and body["messages"] == [] and body["unread"] is False
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


def say(client: TestClient, headers: dict[str, str], ticket_id: int, body: str = "", files: list | None = None):  # type: ignore[no-untyped-def,type-arg]
    return client.post(f"{URL}/{ticket_id}/messages", data={"body": body}, files=files, headers=headers)


def unread_total(client: TestClient, headers: dict[str, str]) -> int:
    return client.get(URL, params={"unread": True}, headers=headers).json()["total"]


def test_chat_between_author_and_admin(
    client: TestClient, db: Session, admin_headers: dict[str, str], user_headers: dict[str, str]
) -> None:
    ticket = create(client, user_headers).json()
    tid, url = ticket["id"], f"{URL}/{ticket['id']}"

    # Новая заявка непрочитана у администратора; GET не отмечает прочитанным, POST /read — отмечает.
    assert client.get(url, headers=admin_headers).json()["unread"] is True
    assert unread_total(client, admin_headers) == 1 and unread_total(client, user_headers) == 0
    assert client.post(f"{url}/read", headers=admin_headers).status_code == 204
    assert unread_total(client, admin_headers) == 0

    # Ответ администратора с файлом: заявка уходит в работу, у автора появляется непрочитанное.
    reply = say(client, admin_headers, tid, " Проверяем, пришлите выписку ", [("files", ("инструкция.pdf", PDF, "application/pdf"))])
    assert reply.status_code == 201, reply.text
    body = reply.json()
    assert body["status"] == "in_progress" and body["unread"] is False
    message = body["messages"][0]
    assert message["body"] == "Проверяем, пришлите выписку" and message["author"]["role"] == "admin"
    assert [a["file_name"] for a in message["attachments"]] == ["инструкция.pdf"] and body["attachments"] == []
    assert unread_total(client, user_headers) == 1
    download = client.get(f"{url}/attachments/{message['attachments'][0]['id']}", headers=user_headers)
    assert download.status_code == 200 and download.content == PDF

    # Автор читает и отвечает только файлом.
    client.post(f"{url}/read", headers=user_headers)
    assert unread_total(client, user_headers) == 0
    answer = say(client, user_headers, tid, files=[("files", ("выписка.png", PNG, "image/png"))]).json()
    assert answer["messages"][1]["body"] == "" and answer["messages"][1]["author"]["login"] == "user"
    assert unread_total(client, admin_headers) == 1

    # Решённая заявка снова открывается, если автор пишет в неё.
    assert client.patch(url, json={"status": "resolved"}, headers=admin_headers).json()["status"] == "resolved"
    assert say(client, user_headers, tid, "Опять не работает").json()["status"] == "open"

    seen = client.get(url, headers=admin_headers).json()
    assert [m["body"] for m in seen["messages"]] == ["Проверяем, пришлите выписку", "", "Опять не работает"]
    actions = db.scalars(
        select(AuditLog.payload).where(AuditLog.action.in_(["ticket.message", "ticket.updated"])).order_by(AuditLog.id)
    ).all()
    assert [p.get("status") for p in actions] == [
        {"from": "open", "to": "in_progress"},
        None,
        {"from": "in_progress", "to": "resolved"},
        {"from": "resolved", "to": "open"},
    ]


def test_list_orders_by_last_message(client: TestClient, admin_headers: dict[str, str], user_headers: dict[str, str]) -> None:
    older = create(client, user_headers, description="Первая").json()
    newer = create(client, user_headers, description="Вторая").json()
    assert [t["id"] for t in client.get(URL, headers=user_headers).json()["items"]] == [newer["id"], older["id"]]
    say(client, admin_headers, older["id"], "Ответ")
    assert [t["id"] for t in client.get(URL, headers=user_headers).json()["items"]] == [older["id"], newer["id"]]
    unread = client.get(URL, params={"unread": True}, headers=user_headers).json()
    assert [t["id"] for t in unread["items"]] == [older["id"]]


@pytest.mark.parametrize(
    ("body", "files"),
    [
        ("   ", None),
        ("x" * 4001, None),
        ("", [("files", (f"{i}.png", PNG, "image/png")) for i in range(6)]),
        ("Вот", [("files", ("ok.png", PNG, "image/png")), ("files", ("fake.pdf", b"<html>", "application/pdf"))]),
    ],
)
def test_message_validation(client: TestClient, user_headers: dict[str, str], body: str, files: list | None) -> None:  # type: ignore[type-arg]
    ticket = create(client, user_headers).json()
    uploads = Path(get_settings().uploads_dir)
    before = set(uploads.iterdir()) if uploads.exists() else set()
    assert say(client, user_headers, ticket["id"], body, files).status_code == 422
    assert client.get(f"{URL}/{ticket['id']}", headers=user_headers).json()["messages"] == []
    assert (set(uploads.iterdir()) if uploads.exists() else set()) == before


def test_stranger_cannot_write_or_read(client: TestClient, db: Session, user_headers: dict[str, str]) -> None:
    ticket = create(client, user_headers).json()
    create_user(db, login="petr", name="Пётр")
    petr = login(client, "petr", USER_PASSWORD)
    assert say(client, petr, ticket["id"], "Чужой чат").status_code == 404
    assert client.post(f"{URL}/{ticket['id']}/read", headers=petr).status_code == 404
    assert client.get(f"{URL}/{ticket['id']}", headers=user_headers).json()["messages"] == []


@pytest.mark.parametrize("body", [{}, {"status": None}, {"status": "closed"}, {"admin_reply": "x"}, {"status": "open", "extra": 1}])
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
    assert client.post(f"{URL}/1/messages", data={"body": "x"}).status_code == 401
    assert client.post(f"{URL}/1/read").status_code == 401
