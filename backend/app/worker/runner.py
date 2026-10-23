"""Жизненный цикл воркера: планировщик, heartbeat для healthcheck, корректная остановка по SIGTERM."""

import asyncio
import logging
import signal
import time
from pathlib import Path

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.clock import get_clock
from app.core.config import get_settings
from app.core.logging import setup_logging

log = logging.getLogger("app.worker")

HEARTBEAT_FILE = Path("/tmp/worker.heartbeat")


def beat() -> None:
    HEARTBEAT_FILE.write_text(str(int(time.time())))


async def run() -> None:
    setup_logging()
    settings = get_settings()
    clock = get_clock()

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)

    scheduler = AsyncIOScheduler()
    scheduler.add_job(beat, "interval", seconds=15, id="heartbeat", next_run_time=clock.now())
    scheduler.start()
    log.info("Worker started (today=%s, tz=%s)", clock.today(), settings.app_timezone)

    await stop.wait()
    scheduler.shutdown(wait=False)
    log.info("Worker stopped")
