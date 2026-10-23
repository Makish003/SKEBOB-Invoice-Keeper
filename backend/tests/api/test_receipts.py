"""X-08: ссылка или файл чека у конкретного периода."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AuditLog

URL = "/api/v1/payment-occurrences"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
PDF = b"%PDF-1.7\n" + b"0" * 64


def occurrence_id(client: TestClient, headers: dict[str, str]) -> int:
    client.post(
        "/api/v1/recurring-payments",
        json={"name": "Аренда офиса", "amount": "100.00", "currency": "RUB", "first_due_date": "2026-10-26"},
        headers=headers,
    )
    return client.get(URL, headers=headers).json()["items"][0]["id"]


def test_receipt_link_set_and_cleared(client: TestClient, admin_headers: dict[str, str], user_headers: dict[str, str]) -> None:
    occ = occurrence_id(client, admin_headers)
    body = client.patch(f"{URL}/{occ}", json={"receipt_url": "https://bank.example.com/receipt/42"}, headers=user_headers).json()
    assert body["receipt_url"] == "https://bank.example.com/receipt/42" and body["status"] == "unpaid"
    assert client.patch(f"{URL}/{occ}", json={"receipt_url": None}, headers=user_headers).json()["receipt_url"] is None


@pytest.mark.parametrize("bad", ["javascript:alert(1)", "ftp://x/y", "not a url", "http://" + "a" * 1100 + ".ru"])
def test_receipt_link_validation(client: TestClient, admin_headers: dict[str, str], bad: str) -> None:
    occ = occurrence_id(client, admin_headers)
    assert client.patch(f"{URL}/{occ}", json={"receipt_url": bad}, headers=admin_headers).status_code == 422


def test_upload_download_and_delete_file(
    client: TestClient, db: Session, admin_headers: dict[str, str], user_headers: dict[str, str]
) -> None:
    occ = occurrence_id(client, admin_headers)
    response = client.post(f"{URL}/{occ}/receipt", files={"file": ("чек.pdf", PDF, "application/pdf")}, headers=user_headers)
    assert response.status_code == 200, response.text
    assert response.json()["receipt_file_name"] == "чек.pdf"

    download = client.get(f"{URL}/{occ}/receipt", headers=admin_headers)
    assert download.status_code == 200 and download.content == PDF
    assert download.headers["content-type"] == "application/pdf"
    assert client.get(f"{URL}/{occ}/receipt").status_code == 401

    # Новый файл заменяет старый.
    client.post(f"{URL}/{occ}/receipt", files={"file": ("photo.png", PNG, "image/png")}, headers=user_headers)
    assert client.get(f"{URL}/{occ}/receipt", headers=admin_headers).content == PNG

    assert client.delete(f"{URL}/{occ}/receipt", headers=user_headers).status_code == 204
    assert client.get(f"{URL}/{occ}/receipt", headers=admin_headers).status_code == 404
    assert client.get(f"{URL}/{occ}", headers=admin_headers).json()["receipt_file_name"] is None
    actions = db.scalars(select(AuditLog.action).where(AuditLog.action.like("occurrence.receipt%"))).all()
    assert actions == ["occurrence.receipt_uploaded", "occurrence.receipt_uploaded", "occurrence.receipt_deleted"]


@pytest.mark.parametrize(
    ("name", "content", "ctype"),
    [
        ("evil.exe", b"MZ\x90\x00" + b"0" * 32, "application/octet-stream"),
        ("fake.pdf", b"<html><script>", "application/pdf"),  # расширение не совпадает с содержимым
        ("empty.png", b"", "image/png"),
    ],
)
def test_rejects_wrong_files(client: TestClient, admin_headers: dict[str, str], name: str, content: bytes, ctype: str) -> None:
    occ = occurrence_id(client, admin_headers)
    response = client.post(f"{URL}/{occ}/receipt", files={"file": (name, content, ctype)}, headers=admin_headers)
    assert response.status_code == 422
    assert "PDF, PNG или JPG" in response.json()["error"]["message"]


def test_rejects_too_large(client: TestClient, admin_headers: dict[str, str]) -> None:
    occ = occurrence_id(client, admin_headers)
    big = PDF + b"0" * (5 * 1024 * 1024)
    response = client.post(f"{URL}/{occ}/receipt", files={"file": ("big.pdf", big, "application/pdf")}, headers=admin_headers)
    assert response.status_code == 413


def test_receipt_endpoints_require_auth(client: TestClient) -> None:
    assert client.post(f"{URL}/1/receipt", files={"file": ("a.pdf", PDF, "application/pdf")}).status_code == 401
    assert client.delete(f"{URL}/1/receipt").status_code == 401


def test_missing_occurrence_is_404(client: TestClient, admin_headers: dict[str, str]) -> None:
    response = client.post(f"{URL}/999/receipt", files={"file": ("a.pdf", PDF, "application/pdf")}, headers=admin_headers)
    assert response.status_code == 404
