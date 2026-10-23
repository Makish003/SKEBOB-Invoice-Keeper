"""Подготовка при старте backend (после alembic upgrade): админ из .env, демо-данные."""

import logging

from app.core.clock import get_clock
from app.core.config import get_settings
from app.core.db import get_sessionmaker
from app.core.logging import setup_logging
from app.seed import seed_demo_data
from app.services.users import sync_system_admin

log = logging.getLogger("app.bootstrap")


def main() -> None:
    setup_logging()
    settings = get_settings()
    clock = get_clock()
    if settings.app_env == "production" and (
        settings.secret_key.startswith("change-me") or settings.admin_password == "admin12345"
    ):
        log.warning("APP_ENV=production, но SECRET_KEY или ADMIN_PASSWORD оставлены по умолчанию из .env.example")
    with get_sessionmaker()() as db:
        sync_system_admin(db, settings, clock)
        db.commit()
        if settings.seed_demo_data and seed_demo_data(db, clock, settings):
            log.info("Demo data loaded (SEED_DEMO_DATA=true)")
    log.info("Bootstrap done (today=%s, tz=%s)", clock.today(), settings.app_timezone)


if __name__ == "__main__":
    main()
