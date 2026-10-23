"""X-02: журнал аудита — только админ, фильтры, человекочитаемые подписи объектов."""

from fastapi.testclient import TestClient

URL = "/api/v1/audit-log"


def test_requires_auth(client: TestClient) -> None:
    assert client.get(URL).status_code == 401


def test_user_is_forbidden(client: TestClient, user_headers: dict[str, str]) -> None:
    assert client.get(URL, headers=user_headers).status_code == 403


def test_records_logins_and_actions_newest_first(
    client: TestClient, admin_headers: dict[str, str], user_headers: dict[str, str]
) -> None:
    client.post("/api/v1/auth/login", json={"login": "admin", "password": "wrong-password"})
    payment = client.post(
        "/api/v1/recurring-payments",
        json={"name": "Аренда офиса", "amount": "85000.00", "currency": "RUB", "first_due_date": "2026-10-26"},
        headers=admin_headers,
    ).json()
    occ = client.get("/api/v1/payment-occurrences", headers=user_headers).json()["items"][0]
    client.patch(f"/api/v1/payment-occurrences/{occ['id']}", json={"status": "paid"}, headers=user_headers)

    body = client.get(URL, headers=admin_headers).json()
    actions = [i["action"] for i in body["items"]]
    assert actions[0] == "occurrence.paid"
    assert {"auth.login.success", "auth.login.failed", "recurring_payment.created"} <= set(actions)
    assert body["total"] == len(body["items"])

    paid = body["items"][0]
    assert paid["actor_label"] == "user" and paid["entity_label"] == "Аренда офиса, срок 26.10.2026"
    created = next(i for i in body["items"] if i["action"] == "recurring_payment.created")
    assert created["entity_label"] == "Аренда офиса" and created["payload"]["amount"] == "85000.00"
    assert all(i["ip"] for i in body["items"] if i["action"].startswith("auth."))
    assert payment["id"] == created["entity_id"]


def test_filters(client: TestClient, admin_headers: dict[str, str], user_headers: dict[str, str]) -> None:
    client.post("/api/v1/auth/login", json={"login": "ghost", "password": "wrong-password"})
    auth_only = client.get(URL, params={"category": "auth"}, headers=admin_headers).json()["items"]
    assert auth_only and all(i["action"].startswith("auth.") for i in auth_only)
    failed = client.get(URL, params={"action": "auth.login.failed"}, headers=admin_headers).json()["items"]
    assert [i["actor_label"] for i in failed] == ["ghost"]
    by_actor = client.get(URL, params={"q": "user"}, headers=admin_headers).json()["items"]
    assert by_actor and all("user" in (i["actor_label"] or "") for i in by_actor)
    page = client.get(URL, params={"limit": 1, "offset": 1}, headers=admin_headers).json()
    assert len(page["items"]) == 1 and page["total"] >= 2
    assert client.get(URL, params={"category": "bogus"}, headers=admin_headers).status_code == 422
