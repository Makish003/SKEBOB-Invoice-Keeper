#!/usr/bin/env sh
# Дымовая проверка запущенного стека: sh scripts/smoke.sh [http://localhost:8080]
set -eu
BASE="${1:-http://localhost:8080}"
fail() { echo "FAIL: $*" >&2; exit 1; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

[ "$(code "$BASE/")" = "200" ] || fail "панель не открывается"
[ "$(code "$BASE/api/v1/health")" = "200" ] || fail "health"
[ "$(code "$BASE/api/v1/docs")" = "200" ] || fail "Swagger /api/v1/docs"
[ "$(code "$BASE/api/v1/payment-occurrences")" = "401" ] || fail "без сессии данные доступны"

# Подмена X-Forwarded-For не обходит ограничение попыток входа.
ghost="smoke-ghost-$$"
for i in 1 2 3 4 5; do
  code -X POST "$BASE/api/v1/auth/login" -H 'content-type: application/json' \
    -H "X-Forwarded-For: 10.9.9.$i" -d "{\"login\":\"$ghost\",\"password\":\"wrong-pass\"}" >/dev/null
done
[ "$(code -X POST "$BASE/api/v1/auth/login" -H 'content-type: application/json' \
  -H 'X-Forwarded-For: 10.9.9.99' -d "{\"login\":\"$ghost\",\"password\":\"wrong-pass\"}")" = "429" ] \
  || fail "rate-limit входа обходится подменой X-Forwarded-For"

echo "OK: панель, Swagger, 401 без сессии, rate-limit входа"
