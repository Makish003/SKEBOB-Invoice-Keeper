"""Q-04: параллельные DELETE не дают двойного эффекта.

Страховочный тест: окно гонки узкое, без SELECT … FOR UPDATE он тоже обычно проходит (проверено), поэтому
корректность обеспечивает блокировка строки в обработчике, а тест фиксирует ожидаемый контракт ответа.
"""

from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.main import app
from app.models import AuditLog


def test_parallel_delete_of_payment_happens_once(client: TestClient, db: Session, admin_headers: dict[str, str]) -> None:
    payment = client.post(
        "/api/v1/recurring-payments",
        json={"name": "Аренда", "amount": "10.00", "currency": "RUB", "first_due_date": "2026-11-01"},
        headers=admin_headers,
    ).json()

    def delete() -> int:
        with TestClient(app) as other:
            return other.delete(f"/api/v1/recurring-payments/{payment['id']}", headers=admin_headers).status_code

    with ThreadPoolExecutor(max_workers=4) as pool:
        codes = sorted(pool.map(lambda _: delete(), range(4)))
    assert codes == [204, 404, 404, 404]
    deleted = select(func.count()).select_from(AuditLog).where(AuditLog.action == "recurring_payment.deleted")
    assert db.scalar(deleted) == 1
