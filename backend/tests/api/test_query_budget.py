"""Списки не деградируют с ростом данных: число SQL-запросов на GET не зависит от числа платежей (нет N+1),
а повторный GET в установившемся режиме ничего не пишет в БД (нет INSERT и COMMIT)."""

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.core.db import get_engine
from tests.acceptance.helpers import create_payment

ENDPOINTS = [
    "/api/v1/recurring-payments",
    "/api/v1/payment-occurrences",
    "/api/v1/payments/summary",
    "/api/v1/budgets/overview",
]


@dataclass
class Recorded:
    statements: list[str] = field(default_factory=list)
    commits: int = 0

    @property
    def writes(self) -> list[str]:
        return [s for s in self.statements if s.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE"))]


@contextmanager
def recording() -> Iterator[Recorded]:
    rec, engine = Recorded(), get_engine()

    def on_execute(conn, cursor, statement, *args) -> None:  # type: ignore[no-untyped-def]
        rec.statements.append(statement)

    def on_commit(conn) -> None:  # type: ignore[no-untyped-def]
        rec.commits += 1

    event.listen(engine, "before_cursor_execute", on_execute)
    event.listen(engine, "commit", on_commit)
    try:
        yield rec
    finally:
        event.remove(engine, "before_cursor_execute", on_execute)
        event.remove(engine, "commit", on_commit)


def statements_for(client: TestClient, url: str, headers: dict[str, str]) -> Recorded:
    client.get(url, headers=headers)  # прогрев: периоды уже материализованы
    with recording() as rec:
        assert client.get(url, headers=headers).status_code == 200
    return rec


@pytest.mark.parametrize("url", ENDPOINTS)
def test_query_count_does_not_grow_with_payments(client: TestClient, admin_headers: dict[str, str], url: str) -> None:
    for i in range(2):
        create_payment(client, admin_headers, name=f"Платёж {i}", first_due_date=f"2026-11-0{i + 1}")
    few = len(statements_for(client, url, admin_headers).statements)
    for i in range(2, 9):
        create_payment(client, admin_headers, name=f"Платёж {i}", first_due_date=f"2026-11-0{i + 1}")
    many = len(statements_for(client, url, admin_headers).statements)
    assert many == few, f"{url}: {few} запросов при 2 платежах, {many} при 9"


@pytest.mark.parametrize("url", ENDPOINTS)
def test_steady_state_get_does_not_write(client: TestClient, admin_headers: dict[str, str], url: str) -> None:
    create_payment(client, admin_headers)
    rec = statements_for(client, url, admin_headers)
    assert rec.writes == [] and rec.commits == 0, (rec.writes, rec.commits)
