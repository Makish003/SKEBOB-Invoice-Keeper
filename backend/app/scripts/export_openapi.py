"""Экспорт OpenAPI-спецификации в docs/openapi.yml (FR-26).

Запуск: python -m app.scripts.export_openapi [--check]
"""

import sys
from pathlib import Path

import yaml

from app.main import create_app

OPENAPI_PATH = Path(__file__).resolve().parents[3] / "docs" / "openapi.yml"


def render() -> str:
    spec = create_app().openapi()
    return yaml.safe_dump(spec, allow_unicode=True, sort_keys=False, width=120)


def main() -> int:
    text = render()
    if "--check" in sys.argv:
        current = OPENAPI_PATH.read_text(encoding="utf-8") if OPENAPI_PATH.exists() else ""
        if current != text:
            print(f"{OPENAPI_PATH} is outdated: run python -m app.scripts.export_openapi", file=sys.stderr)
            return 1
        print("openapi.yml is up to date")
        return 0
    OPENAPI_PATH.write_text(text, encoding="utf-8", newline="\n")
    print(f"written {OPENAPI_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
