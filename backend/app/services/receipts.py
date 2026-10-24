"""Файлы чеков (FR-B8): том uploads, имя — серверный uuid, тип — по сигнатуре содержимого.

Файловая система не участвует в транзакции БД, поэтому порядок такой: новый файл пишется до COMMIT и удаляется,
если транзакция не прошла; прежний файл удаляется только после успешного COMMIT. Иначе сбой оставлял бы запись,
ссылающуюся на удалённый файл, и файлы-сироты.
"""

import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.errors import AppError, not_found, unprocessable
from app.models import PaymentOccurrence, User
from app.services import audit

SIGNATURES = {
    "application/pdf": (b"%PDF-", ".pdf"),
    "image/png": (bytes.fromhex("89504e470d0a1a0a"), ".png"),
    "image/jpeg": (bytes.fromhex("ffd8ff"), ".jpg"),
}
WRONG_FILE = "Прикрепите файл PDF, PNG или JPG"


class ReceiptStorage:
    def __init__(self, root: str | Path, max_mb: int) -> None:
        self.root = Path(root)
        self.max_mb = max_mb

    def path(self, key: str) -> Path:
        return self.root / key

    def read_limited(self, stream) -> bytes:  # type: ignore[no-untyped-def]
        limit = self.max_mb * 1024 * 1024
        content: bytes = stream.read(limit + 1)
        if len(content) > limit:
            raise AppError(413, f"Файл больше {self.max_mb} МБ", code="payload_too_large")
        return content

    def save(self, content: bytes) -> tuple[str, str]:
        """Возвращает (ключ файла, content-type) или 422, если это не PDF/PNG/JPG."""
        kind = next((ct for ct, (magic, _) in SIGNATURES.items() if content.startswith(magic)), None)
        if kind is None:
            raise unprocessable(WRONG_FILE)
        self.root.mkdir(parents=True, exist_ok=True)
        key = f"{uuid.uuid4().hex}{SIGNATURES[kind][1]}"
        self.path(key).write_bytes(content)
        return key, kind

    def remove(self, key: str | None) -> None:
        if key:
            self.path(key).unlink(missing_ok=True)


def attach(
    db: Session,
    storage: ReceiptStorage,
    occ: PaymentOccurrence,
    content: bytes,
    file_name: str | None,
    *,
    actor: User,
    ip: str | None,
) -> None:
    """Прикрепляет файл (заменяя прежний) и коммитит."""
    key, kind = storage.save(content)
    previous = occ.receipt_file_key
    try:
        occ.receipt_file_key, occ.receipt_content_type = key, kind
        occ.receipt_file_name = Path(file_name or f"receipt{SIGNATURES[kind][1]}").name[:255]
        audit.record(
            db,
            "occurrence.receipt_uploaded",
            actor=actor,
            entity="payment_occurrence",
            entity_id=occ.id,
            payload={"file_name": occ.receipt_file_name, "size": len(content), "content_type": kind},
            ip=ip,
        )
        db.commit()
    except BaseException:
        db.rollback()
        storage.remove(key)
        raise
    storage.remove(previous)


def detach(db: Session, storage: ReceiptStorage, occ: PaymentOccurrence, *, actor: User, ip: str | None) -> None:
    """Удаляет файл чека и коммитит; файл стирается с диска только после COMMIT."""
    if not occ.receipt_file_key:
        raise not_found("Файл чека не прикреплён")
    key, name = occ.receipt_file_key, occ.receipt_file_name
    occ.receipt_file_key = occ.receipt_file_name = occ.receipt_content_type = None
    audit.record(
        db, "occurrence.receipt_deleted", actor=actor, entity="payment_occurrence", entity_id=occ.id,
        payload={"file_name": name}, ip=ip,
    )
    db.commit()
    storage.remove(key)
