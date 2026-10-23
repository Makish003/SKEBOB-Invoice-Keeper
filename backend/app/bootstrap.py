"""Подготовка при старте backend (после alembic upgrade): админ из .env, демо-данные."""

import logging

from app.core.clock import get_clock
from app.core.config import get_settings
from app.core.db import get_sessionmaker
from app.core.logging import setup_logging
from app.services.users import sync_system_admin

log = logging.getLogger("app.bootstrap")


def main() -> None:
    setup_logging()
    settings = get_settings()
    clock = get_clock()
    with get_sessionmaker()() as db:
        sync_system_admin(db, settings, clock)
        db.commit()
    log.info("Bootstrap done (today=%s, tz=%s)", clock.today(), settings.app_timezone)


if __name__ == "__main__":
    main()
