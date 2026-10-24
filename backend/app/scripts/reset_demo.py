"""Сброс к демо-данным: удаляет все платежи, пользователей, журнал и файлы чеков, затем заново создаёт
админа из .env и демо-набор. Для стенда демонстрации, а не для рабочей базы.

docker compose run --rm backend python -m app.scripts.reset_demo            # APP_ENV != production
docker compose run --rm backend python -m app.scripts.reset_demo --force    # в production — только явно
"""

import argparse
import logging
import shutil
import sys
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.clock import Clock, get_clock
from app.core.config import Settings, get_settings
from app.core.db import get_sessionmaker
from app.core.logging import setup_logging
from app.seed import seed_demo_data
from app.services.users import sync_system_admin

log = logging.getLogger("app.reset_demo")

TABLES = "budgets, audit_log, reminders, payment_occurrences, recurring_payments, sessions, users"


def reset_demo(db: Session, clock: Clock, settings: Settings) -> None:
    db.execute(text(f"TRUNCATE {TABLES} RESTART IDENTITY CASCADE"))
    db.expunge_all()  # объекты сессии ссылаются на удалённые строки
    uploads = Path(settings.uploads_dir)
    if uploads.is_dir():
        for item in uploads.iterdir():
            shutil.rmtree(item) if item.is_dir() else item.unlink(missing_ok=True)
    sync_system_admin(db, settings, clock)
    db.flush()
    seed_demo_data(db, clock, settings)  # коммитит сам


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Сбросить базу к демо-данным")
    parser.add_argument("--force", action="store_true", help="разрешить при APP_ENV=production")
    args = parser.parse_args(argv)
    setup_logging()
    settings = get_settings()
    if settings.app_env == "production" and not args.force:
        log.error("APP_ENV=production: сброс удалит рабочие данные. Если это действительно нужно — --force")
        return 2
    with get_sessionmaker()() as db:
        reset_demo(db, get_clock(), settings)
    log.info("Demo data reset done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
