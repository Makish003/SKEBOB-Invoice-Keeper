"""AC-2 Доступ: без сессии любой /api/v1/* кроме входа и документации → 401."""

import re

import pytest
from fastapi.testclient import TestClient

from app.main import app

PUBLIC = {("post", "/api/v1/auth/login"), ("get", "/api/v1/health")}  # health — для healthcheck контейнера
OPERATIONS = [
    (method, re.sub(r"\{[^}]+\}", "1", path))
    for path, ops in app.openapi()["paths"].items()
    for method in ops
    if (method, path) not in PUBLIC
]


@pytest.mark.parametrize(("method", "path"), OPERATIONS)
def test_every_endpoint_requires_session(client: TestClient, method: str, path: str) -> None:
    response = client.request(method, path, json={})
    assert response.status_code == 401, f"{method.upper()} {path} → {response.status_code}"
    assert response.json()["error"]["code"] == "unauthorized"


def test_operations_are_enumerated() -> None:
    assert len(OPERATIONS) >= 15


def test_docs_and_spec_are_public(client: TestClient) -> None:
    assert client.get("/api/v1/docs").status_code == 200
    assert client.get("/api/v1/openapi.json").status_code == 200
