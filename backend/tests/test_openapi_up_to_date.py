"""docs/openapi.yml должен совпадать с тем, что генерирует приложение (FR-26, AC-15)."""

from app.scripts.export_openapi import OPENAPI_PATH, render


def test_openapi_file_is_up_to_date() -> None:
    assert OPENAPI_PATH.exists(), "docs/openapi.yml отсутствует: python -m app.scripts.export_openapi"
    assert OPENAPI_PATH.read_text(encoding="utf-8") == render(), (
        "docs/openapi.yml устарел: выполните python -m app.scripts.export_openapi и закоммитьте файл"
    )


def test_all_case_endpoints_present() -> None:
    import yaml

    spec = yaml.safe_load(OPENAPI_PATH.read_text(encoding="utf-8"))
    paths = spec["paths"]
    required = {
        ("post", "/api/v1/auth/login"),
        ("get", "/api/v1/auth/me"),
        ("post", "/api/v1/auth/logout"),
        ("get", "/api/v1/recurring-payments"),
        ("post", "/api/v1/recurring-payments"),
        ("delete", "/api/v1/recurring-payments/{payment_id}"),
        ("get", "/api/v1/payment-occurrences"),
        ("get", "/api/v1/payment-occurrences/{occurrence_id}"),
        ("patch", "/api/v1/payment-occurrences/{occurrence_id}"),
        ("get", "/api/v1/payments/summary"),
        ("get", "/api/v1/users"),
        ("post", "/api/v1/users"),
        ("patch", "/api/v1/users/{user_id}"),
        ("delete", "/api/v1/users/{user_id}"),
    }
    present = {(m, p) for p, ops in paths.items() for m in ops}
    assert required <= present, required - present
