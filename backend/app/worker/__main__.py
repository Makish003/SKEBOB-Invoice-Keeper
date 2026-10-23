"""Фоновый воркер: python -m app.worker (ADR-003)."""

import asyncio

from app.worker.runner import run

if __name__ == "__main__":
    asyncio.run(run())
