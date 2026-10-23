from fastapi.testclient import TestClient


def test_app_info_requires_auth(client: TestClient) -> None:
    assert client.get("/api/v1/app-info").status_code == 401


def test_app_info_returns_app_today(client: TestClient, user_headers: dict[str, str]) -> None:
    body = client.get("/api/v1/app-info", headers=user_headers).json()
    assert body["today"] == "2026-10-23"
    assert body["timezone"] == "Europe/Moscow" and body["reminder_days_before"] == 3
    assert body["reminder_channels"] == ["console"]
