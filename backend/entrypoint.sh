#!/bin/sh
# Точка входа backend-образа: serve | worker | bootstrap | <любая команда>.
set -e

migrate() {
  i=0
  until alembic upgrade head; do
    i=$((i + 1))
    if [ "$i" -ge 20 ]; then echo "Database is unavailable, giving up" >&2; exit 1; fi
    echo "Waiting for database... ($i)"; sleep 2
  done
}

case "$1" in
  serve)
    migrate
    python -m app.bootstrap
    exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'
    ;;
  worker)
    exec python -m app.worker
    ;;
  bootstrap)
    migrate
    exec python -m app.bootstrap
    ;;
  *)
    exec "$@"
    ;;
esac
