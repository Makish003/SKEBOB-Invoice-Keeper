"""Жизненный цикл воркера: планировщик напоминаний, Telegram-бот, heartbeat, корректная остановка по SIGTERM."""

import asyncio
import contextlib
import logging
import signal
import time
from pathlib import Path

from aiogram import Bot
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.clock import get_clock
from app.core.config import get_settings
from app.core.db import get_sessionmaker
from app.core.logging import setup_logging
from app.models import Channel
from app.services.delivery import deliver_pending, tick
from app.services.notifiers.base import Notifier
from app.services.notifiers.console import ConsoleNotifier
from app.services.notifiers.telegram import TelegramNotifier
from app.worker.bot import build_dispatcher

log = logging.getLogger("app.worker")

HEARTBEAT_FILE = Path("/tmp/worker.heartbeat")


def beat() -> None:
    HEARTBEAT_FILE.write_text(str(int(time.time())))


async def run() -> None:
    setup_logging()
    settings = get_settings()
    clock = get_clock()
    sessions = get_sessionmaker()

    bot = Bot(settings.telegram_bot_token) if settings.telegram_bot_token else None
    notifiers: dict[Channel, Notifier] = {Channel.console: ConsoleNotifier()}
    if bot and settings.telegram_chat_id:
        notifiers[Channel.telegram] = TelegramNotifier(bot, settings.telegram_chat_id)
        log.info("Reminders → Telegram chat %s", settings.telegram_chat_id)
    elif bot:
        log.warning("TELEGRAM_CHAT_ID пуст: напоминания пишутся в лог. Отправьте боту /chatid в нужном чате")
    else:
        log.info("TELEGRAM_BOT_TOKEN не задан: напоминания пишутся в лог воркера (console)")

    def run_tick() -> None:
        with sessions() as db:
            tick(db, clock.today(), settings)

    async def run_delivery() -> None:
        await deliver_pending(sessions, clock.today(), settings, notifiers, now=clock.now())

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)

    scheduler = AsyncIOScheduler()
    common = {"max_instances": 1, "coalesce": True, "next_run_time": clock.now()}
    scheduler.add_job(beat, "interval", seconds=15, id="heartbeat", **common)
    scheduler.add_job(run_tick, "interval", seconds=settings.reminder_check_interval_seconds, id="tick", **common)
    scheduler.add_job(run_delivery, "interval", seconds=settings.pending_poll_seconds, id="delivery", **common)
    scheduler.start()
    log.info(
        "Worker started (today=%s, tz=%s, check every %ss, queue poll every %ss)",
        clock.today(),
        settings.app_timezone,
        settings.reminder_check_interval_seconds,
        settings.pending_poll_seconds,
    )

    polling: asyncio.Task[None] | None = None
    dispatcher = build_dispatcher()
    if bot:
        polling = asyncio.create_task(dispatcher.start_polling(bot, handle_signals=False))

    await stop.wait()
    log.info("Stopping worker")
    scheduler.shutdown(wait=False)
    if polling:
        with contextlib.suppress(Exception):
            await dispatcher.stop_polling()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await asyncio.wait_for(polling, timeout=5)
    if bot:
        await bot.session.close()
    log.info("Worker stopped")
