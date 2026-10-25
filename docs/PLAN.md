# PLAN — Invoice Keeper: код-план для Claude Code

> **Это живой документ и единственный отчёт о прогрессе.** Агент обновляет его после КАЖДОЙ задачи
> (см. §0 «Протокол отчётности»). Требования — в `docs/SPEC.md` (ID `FR-*`, `AC-*`, `EC-*`),
> архитектурные решения — в `docs/DECISIONS.md` (ID `ADR-*`), источник истины — `docs/case.pdf`.

---

## 0. Протокол отчётности (обязателен)

**Статусы задач:** `[ ]` не начата · `[~]` в работе · `[x]` готова и проверена · `[!]` заблокирована · `[-]` отменена (с причиной).

После завершения каждой задачи агент в одном коммите с кодом:
1. Меняет чекбокс задачи и дописывает под ней строку `↳ done: <коммит> · проверка: <команда> → <результат>`.
2. Добавляет запись в §9 «Журнал выполнения» (append-only, сверху вниз по времени).
3. Обновляет §8 «Трассировка требований», если задача закрыла `FR`/`AC`.
4. Если отступил от плана — запись `ADR-NNN` в `docs/DECISIONS.md` + ссылка в журнале.
5. Если заблокирован — `[!]`, блок «Эскалация» в §10 (вопрос + варианты + рекомендация), и переход к следующей незаблокированной задаче.

**Задача считается готовой (`[x]`), только если** выполнен её DoD и приведено доказательство: вывод теста/команды,
HTTP-ответ, скриншот Playwright. «Должно работать» — не доказательство.

**Владельцы задач:** `BACK` — агент бэкенда/воркера/инфры, `FRONT` — агент фронтенда/e2e/UX, `ANY` — кто свободен.
Если работает один агент — он выполняет всё по порядку фаз.

**Чекпойнты (milestones)** — после каждого агент пишет в журнал итог и % трассировки:
- **M1** Скелет: `docker compose up` поднимает db+backend+web, `/api/v1/docs` открывается, логин admin работает.
- **M2** MVP: все `AC-1…AC-15` зелёные (автотесты + ручная проверка демо-сценария). **Бонусы до M2 запрещены.**
- **M3** Бонусы P1 готовы, M2 не сломан.
- **M4** Freeze: README прогнан «с нуля» на чистом клоне, репетиция демо, `ship-gate` пройден. После M4 — только фиксы багов.

---

## 1. Архитектура (решения зафиксированы в `docs/DECISIONS.md`)

```
                    ┌──────────────────── docker compose ─────────────────────┐
 Браузер ──:8080──▶ │ web (nginx)                                             │
                    │  ├─ /            → SPA (React build)                    │
                    │  └─ /api/*       → backend:8000                         │
                    │ backend (FastAPI, uvicorn)  ──┐                         │
                    │   REST /api/v1, Swagger       ├──▶ db (PostgreSQL 16)   │
                    │ worker (APScheduler+aiogram) ─┘     volume pgdata       │
                    │   тик каждые N сек: генерация периодов → напоминания    │
                    │   long-polling бота: /chatid, кнопка «Оплачено»        │──▶ Telegram Bot API
                    │ mailpit (profile: extras) — SMTP-ловушка для бонуса     │
                    └─────────────────────────────────────────────────────────┘
```

| Слой | Выбор | Почему |
|---|---|---|
| Backend | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2 (sync) + psycopg 3, Alembic, pydantic-settings, argon2-cffi | Swagger/OpenAPI «из коробки» (FR-26), быстрая разработка, строгая валидация |
| Пакеты | `uv` (lock-файл) | Воспроизводимая сборка |
| БД | PostgreSQL 16 | `UNIQUE`/`ON CONFLICT`/`FOR UPDATE SKIP LOCKED` для идемпотентности напоминаний (NFR-6) |
| Фоновые задачи | Отдельный сервис `worker`: APScheduler (interval) + aiogram 3 (polling) | Не дублируется при нескольких воркерах uvicorn; бот получает callback-кнопки |
| Frontend | React 19 + Vite + TypeScript (strict), Tailwind v4, shadcn/ui, TanStack Query, React Router, react-hook-form + zod, `motion` (motion/react), date-fns (ru), sonner, lucide-react | Быстрый качественный UI; типы из OpenAPI |
| Клиент API | `openapi-typescript` + `openapi-fetch` из `docs/openapi.yml` | Контракт-first, фронт и бэк не расходятся |
| Раздача | nginx: статика + reverse-proxy `/api` | Один origin → httpOnly-cookie без CORS-проблем |
| Тесты | pytest (+ httpx TestClient, отдельная тестовая БД), Vitest, Playwright | Unit → API → e2e демо-сценария |

### 1.1 Модель данных

```
users(id PK, login UNIQUE, password_hash, display_name, role ENUM('admin','user'),
      is_system BOOL  -- true = админ из .env, неизменяем через API
      created_at, updated_at, deleted_at NULL)

sessions(id PK, user_id FK, token_hash UNIQUE, created_at, expires_at, revoked_at NULL,
         user_agent, ip)

recurring_payments(id PK, name, amount NUMERIC(14,2) CHECK>0, currency ENUM('RUB','USD','EUR'),
      period ENUM('monthly','weekly','quarterly','yearly') DEFAULT 'monthly',
      first_due_date DATE, anchor_day SMALLINT  -- число исходной даты, для FR-4
      description NULL, created_by FK users, created_at, deleted_at NULL, deleted_by NULL)

payment_occurrences(id PK, recurring_payment_id FK, seq INT  -- 0,1,2… номер периода
      due_date DATE, amount NUMERIC(14,2), currency  -- снимок на момент генерации
      status ENUM('unpaid','paid') DEFAULT 'unpaid', paid_at DATE NULL,
      paid_by_user_id FK NULL, paid_by_label TEXT NULL  -- «Иван» / «Telegram @ivan»
      note NULL, created_at, updated_at,
      UNIQUE(recurring_payment_id, seq), UNIQUE(recurring_payment_id, due_date),
      CHECK ((status='paid') = (paid_at IS NOT NULL)))

reminders(id PK, occurrence_id FK, channel ENUM('telegram','email','webhook','console'),
      kind ENUM('upcoming','overdue') DEFAULT 'upcoming',
      status ENUM('pending','sent','failed','cancelled'), attempts INT, last_error, next_attempt_at,
      sent_at, external_id  -- telegram message_id
      UNIQUE(occurrence_id, channel, kind))       ← гарантия «без дублей» (FR-20, NFR-6)

audit_log(id PK, at TIMESTAMPTZ, actor_user_id NULL, actor_label, action, entity, entity_id,
      payload JSONB, ip)                           ← бонус FR-B2, но таблица — сразу
```

**Вычисляемые поля периода** (не хранятся, считаются доменной функцией от `today`):
`is_overdue`, `overdue_days`, `days_until_due`, `display_status ∈ {paid, paid_late, upcoming, due_soon, due_today, overdue}`.

### 1.2 Доменные правила (чистые функции в `backend/app/domain/`, покрыты unit-тестами)

- `due_date_for(first_due_date, anchor_day, period, seq)`: monthly → месяц `+seq`, день = `min(anchor_day, last_day)`
  (никакого «дрейфа»: 31.01 → 29.02.2028 → 31.03.2028). weekly → `+7*seq` дней; quarterly → `+3*seq` мес.; yearly → `+12*seq` мес.
- `ensure_occurrences(payment, today)`: создаёт все периоды c `due_date ≤ today + GENERATION_HORIZON_DAYS` (по умолчанию 35),
  **минимум один будущий** (`due_date > today`) — так «следующий период» всегда виден. Идемпотентно (`ON CONFLICT DO NOTHING`).
  Для удалённых платежей не вызывается.
- `is_overdue(occ, today)`: `status=unpaid and today > due_date` **или** `status=paid and paid_at > due_date`.
- `reminder_due(occ, payment, today)`: `payment.deleted_at is null and occ.status=unpaid and today >= due_date - REMINDER_DAYS_BEFORE`
  (по умолчанию 3) **and** `today <= due_date` (для прошедших — отдельный kind `overdue`, бонус).
  Отсюда FR-19 автоматически: если создан позже окна — условие уже истинно.
- `today()` берётся из `Clock` (DI): `ZoneInfo(APP_TIMEZONE)`; в dev/тестах — `CLOCK_OVERRIDE=YYYY-MM-DD` (только при `APP_ENV != production`), для демо «следующего периода».

### 1.3 Конвейер напоминаний (идемпотентный, at-least-once с минимальным окном)

```
tick() каждые REMINDER_CHECK_INTERVAL_SECONDS (по умолчанию 60):
  1. для каждого активного платежа: ensure_occurrences(today)
  2. INSERT INTO reminders(occurrence_id, channel, kind, status='pending')
       SELECT … WHERE reminder_due(...) ON CONFLICT DO NOTHING        ← дубль невозможен
  3. SELECT … FROM reminders WHERE status IN ('pending','failed') AND next_attempt_at <= now()
       AND attempts < MAX ATTEMPTS FOR UPDATE SKIP LOCKED
     перед отправкой повторно проверить: период всё ещё unpaid и платёж не удалён → иначе status='cancelled' (не отправлять)
  4. send() → status='sent', sent_at, external_id | ошибка → 'failed', attempts+1, backoff
```
Сразу после `POST /recurring-payments` бэкенд выполняет шаги 1–2 синхронно, а воркер забирает `pending` на ближайшем коротком
тике (`PENDING_POLL_SECONDS=5`) — это закрывает FR-19/AC-7 без связности API↔Telegram.

Сообщение (HTML parse mode, ru):
```
🔔 Напоминание об оплате
<b>Аренда офиса</b>
Сумма: 85 000,00 RUB
Срок оплаты: 26.10.2026 (через 3 дня)
[ ✅ Оплачено ]   ← inline-кнопка (бонус FR-B1), callback_data = "pay:<occurrence_id>:<hmac8>"
```
Бот также отвечает на `/chatid` (выводит id чата — нужен для README) и `/start`.
Без `TELEGRAM_BOT_TOKEN` используется `ConsoleNotifier` (лог воркера), приложение работает (NFR-9).

### 1.4 Auth и права

- `POST /auth/login {login, password}` → создаёт строку `sessions`, ставит cookie `ik_session` (httpOnly, SameSite=Lax, Secure — по `COOKIE_SECURE`),
  **и** возвращает `{access_token, token_type:"bearer", user}` — чтобы Swagger «Authorize» работал через Bearer.
- Зависимости FastAPI: `current_user` (cookie **или** `Authorization: Bearer`), `require_admin`. Права проверяются **только на сервере**; UI лишь прячет кнопки.
- `logout` → `revoked_at=now()`. Удаление пользователя → все его сессии revoked.
- Админ из `.env` (`ADMIN_LOGIN`, `ADMIN_PASSWORD`) — upsert при старте backend (`is_system=true`, пароль синхронизируется с `.env`).
  `PATCH/DELETE /users/{id}` для `is_system` или `role=admin` → `403`. `POST /users` всегда создаёт `role=user` (поле роли не принимается).
- Ограничение перебора паролей на `login` (in-memory, 5 попыток/мин на IP+логин) — дешёво и показательно.
- Единый формат ошибок: `{"error": {"code": "forbidden", "message": "…", "details": …}}`; коды: 400/401/403/404/409/422.

### 1.5 Контракт ключевых эндпоинтов

```ts
// деньги — строки, даты — "YYYY-MM-DD"
type Currency = "RUB" | "USD" | "EUR";
type Period = "monthly" | "weekly" | "quarterly" | "yearly";

POST /recurring-payments  {name, amount:"85000.00", currency, first_due_date, period?="monthly", description?}
  → 201 RecurringPayment {id, name, amount, currency, period, first_due_date, is_active, next_occurrence?: Occurrence, created_at}
GET  /recurring-payments?include_deleted=false → {items: RecurringPayment[], total}
DELETE /recurring-payments/{id} → 204 (soft delete; повторно → 404)

GET /payment-occurrences?status=paid|unpaid&overdue=true|false&currency=&recurring_payment_id=
     &due_from=&due_to=&include_deleted=false&sort=due_date|-due_date&limit=50&offset=0
  → {items: Occurrence[], total}
Occurrence = {id, recurring_payment:{id,name,is_active}, seq, due_date, amount, currency,
              status, paid_at, paid_by_label, is_overdue, overdue_days, days_until_due, display_status,
              reminder_sent_at?}
PATCH /payment-occurrences/{id} {status?: "paid"|"unpaid", paid_at?: date|null, note?}
  правила: status=paid без paid_at → paid_at=today; status=unpaid → paid_at=null;
           paid_at без status у unpaid → 422; paid_at > today → 422.

GET /payments/summary?due_from=&due_to=&as_of=   (по умолчанию — текущий месяц)
  → {period:{from,to}, as_of, currencies: [{currency, total, paid, unpaid, overdue, count_total, count_paid, count_overdue}] }
     — всегда три валюты, нули если нет данных.

GET/POST/PATCH/DELETE /users  (admin) — User = {id, login, display_name, role, is_system, created_at}
  POST {login, password, display_name?}; PATCH {login?, password?, display_name?}
```

### 1.6 Структура репозитория

```
/                      README.md, docker-compose.yml, .env.example, .gitignore, .gitattributes, Makefile
/docs                  case.pdf, SPEC.md, PLAN.md, DECISIONS.md, MASTER_PROMPT.md, openapi.yml, DEMO.md
/backend               pyproject.toml, uv.lock, Dockerfile, alembic/, app/, tests/
  app/core             config.py, db.py, security.py, clock.py, errors.py, logging.py
  app/domain           schedule.py, status.py, reminders.py   ← чистые функции, без БД
  app/models           SQLAlchemy-модели
  app/schemas          Pydantic-схемы (вход/выход)
  app/services         occurrences.py, reminders.py, users.py, audit.py, notifiers/{telegram,console,email,webhook}.py
  app/api/v1           auth.py, recurring_payments.py, occurrences.py, summary.py, users.py, (calendar, audit, budget…)
  app/worker           __main__.py (scheduler + bot)
  app/seed.py          тестовые данные; app/scripts/export_openapi.py
  tests/unit, tests/api, tests/acceptance (по одному файлу на AC)
/frontend              package.json, vite.config.ts, Dockerfile (build → nginx), nginx.conf, src/, e2e/
  src/api              schema.d.ts (генерируется), client.ts, hooks/
  src/features         auth/, occurrences/, recurring/, users/, dashboard/, calendar/, audit/
  src/components/ui    shadcn
  src/lib              format.ts (деньги/даты ru-RU), motion.ts (общие transition-пресеты)
/scripts               setup-skills.ps1 / .sh, smoke.sh
```

---

## 2. Скиллы и инструменты (что вызывать на каком шаге)

Установка — `scripts/setup-skills.ps1` (или `.sh`) + команды `/plugin` из `CLAUDE.md`. Вызывать скилл явно в начале шага.

| Шаг | Скиллы | Зачем |
|---|---|---|
| Любой код | `karpathy-coder` | предположения вслух, простота, хирургические правки, проверяемые цели |
| Незнакомые API библиотек | `zero-hallucination-coder`, MCP `motion` (поиск по докам Motion) | никаких выдуманных API/импортов |
| Фаза 0 | `spec-driven-workflow`, `senior-architect`, `database-schema-designer`, `tech-stack-evaluator` (только если меняем стек) | спецификация → ADR → схема |
| Backend | `senior-backend`, `tdd-guide`, `api-design-reviewer`, `api-test-suite-builder`, `env-secrets-manager`, `senior-security` (STRIDE-lite по authz) | API, тесты, права, секреты |
| Баги | `red-green-proof`, `focused-fix` | сначала падающий тест, потом фикс |
| Инфра | `docker-development` | multi-stage, healthchecks, compose |
| Frontend: направление | `ux-ui-agent-skills:design-doctrine` (всегда), `ux-ui-agent-skills:apply-aesthetic` (система `linear-app` или `stripe`, светлая+тёмная), `frontend-design` | единая визуальная система, токены по смыслу |
| Frontend: экраны | `ux-ui-agent-skills:design-screen`, `ux-ui-agent-skills:data-dashboard` (сводка/итоги), `ux-ui-agent-skills:design-component`, `senior-frontend` | экраны, 8 состояний компонентов |
| Тексты UI | `ux-ui-agent-skills:ux-writing` | ошибки «что→почему→как», пустые состояния, ru |
| Анимации | `/motion` (Motion AI Kit), `motion-dev-animations` | осмысленная анимация, transform/opacity, `prefers-reduced-motion` |
| Качество UI | `ux-ui-agent-skills:gate`, `ux-ui-agent-skills:design-review`, `ux-ui-agent-skills:critique`, `a11y-audit` | объективные гейты + адверсариальная критика |
| E2E | `pw` (playwright-pro), `webapp-testing`, `senior-qa` | демо-сценарий как тест |
| Ревью перед M2/M4 | `adversarial-reviewer`, `code-reviewer`, `self-eval`, `ship-gate` | не «ревьюить самого себя» вслепую |
| Конец контекста | `handoff-engineering` | передача состояния следующей сессии (плюс §9 этого плана) |
| Защита (опц.) | `demo-video`; идеи моушна — prompt-motion.com (категории Product UI / Kinetic type) | ролик-подстраховка к демо |

---

## 3. Фаза 0 — Подготовка (BACK, до любого кода фич)

- [x] **P0-1** Прочитать `docs/case.pdf` целиком и `docs/SPEC.md`. Сверить: каждый пункт слайдов 2–16 отражён в SPEC. Расхождения → `DECISIONS.md`.
  DoD: в журнале строка «SPEC сверен, расхождений: N».
  ↳ done: P0 · проверка: `pdftotext -raw docs/case.pdf` с.2–17 построчно против SPEC → расхождений 0
- [x] **P0-2** `git init` (если нет), `.gitignore` (Python, Node, `.env`, `pgdata`), `.gitattributes` (`* text=auto eol=lf`, `*.ps1 eol=crlf`) — **критично для Windows**: иначе `entrypoint.sh` упадёт в Linux-контейнере.
  ↳ done: P0 · проверка: репозиторий есть (origin Makish003/SKEBOB-Invoice-Keeper), `.gitignore`/`.gitattributes` на месте и закоммичены
- [x] **P0-3** Проверить окружение: `docker --version`, `docker compose version`, `git`, `node -v` (≥ 20), `uv --version` (если нет — работать через контейнеры). Записать версии в журнал.
  ↳ done: P0 · проверка: версии в журнале §9; `uv` нет → бэкенд собирается/тестируется только в контейнерах
- [x] **P0-4** Проверить установку скиллов (`/plugin` список, `.claude/skills/`, `/mcp` → `motion`). Отсутствующие — поставить или отметить в журнале.
  ↳ done: P0 · проверка: список скиллов сессии; отсутствуют MCP `motion` и проектные скиллы `.claude/skills` (сессия открыта из другой папки) — читаются вручную из `.claude/skills/*/SKILL.md`

## 4. Фаза 1 — Скелет и контракт (→ M1)

- [x] **B-01** (BACK) `backend/` на uv: FastAPI-приложение, `core/config.py` (pydantic-settings, все переменные из `.env.example`), `/api/v1/health`, Swagger на `/api/v1/docs`, OpenAPI на `/api/v1/openapi.json`, единый обработчик ошибок.
  DoD: `curl localhost:8000/api/v1/health` → `{"status":"ok"}`.
  ↳ done: B-01 · проверка: `curl localhost:18000/api/v1/health` → `{"status":"ok"}`; `/api/v1/docs` → 200
- [x] **B-02** (BACK) Модели §1.1 + Alembic-миграция `0001_initial`. Enum-ы, CHECK, UNIQUE как в схеме.
  DoD: `alembic upgrade head` на чистой БД, `alembic downgrade base` без ошибок.
  ↳ done: B-02 · проверка: `alembic upgrade head && alembic check && alembic downgrade base && alembic upgrade head` → MIGRATIONS-OK, «No new upgrade operations detected»
- [x] **B-03** (BACK) `docker-compose.yml`: `db` (postgres:16-alpine, healthcheck, volume `pgdata`), `backend` (entrypoint: wait db → `alembic upgrade head` → sync admin → seed если `SEED_DEMO_DATA=true` и БД пуста → uvicorn), `worker`, `web`; `mailpit` в `profiles: [extras]`. `.env.example` (см. §11).
  DoD: `docker compose up -d --build` → все сервисы `healthy`.
  ↳ done: B-03 · проверка: `docker compose up -d --build` → db/backend/worker `(healthy)`; в `users` создан admin (argon2id, is_system=t). Сервис `web` добавляется в F-01 (нужен frontend/), `mailpit` — в X-07
- [x] **B-04** (BACK) **Контракт-first:** Pydantic-схемы и пустые роутеры ВСЕХ эндпоинтов FR-25 (возвращают `501`), `app/scripts/export_openapi.py` → `docs/openapi.yml`. Тест `test_openapi_up_to_date` падает, если файл устарел.
  DoD: `docs/openapi.yml` закоммичен; FRONT может генерировать типы. **Сообщить FRONT в журнале.**
  ↳ done: B-04 · проверка: `pytest tests/test_openapi_up_to_date.py` → 2 passed; в spec 17 операций, securitySchemes cookieAuth|bearerAuth (OR)
- [x] **F-01** (FRONT) `frontend/`: Vite + React 19 + TS strict + Tailwind v4 + shadcn/ui init, роутинг, TanStack Query, `openapi-typescript` → `src/api/schema.d.ts`, `openapi-fetch` клиент с `credentials: "include"`. Dockerfile (node build → nginx), `nginx.conf` (SPA fallback + proxy `/api` → `backend:8000`).
  DoD: `npm run build` без ошибок; `http://localhost:8080` открывает заглушку через compose.
  ↳ done: F-01 · проверка: `npm run build` OK; `docker compose up -d --build web` → web healthy; `curl :8080/` → `<title>Invoice Keeper</title>`, `/api/v1/health` через nginx → ok, `/api/v1/docs` → 200, SPA-fallback → 200
- [x] **F-02** (FRONT) Визуальная система: `design-doctrine` + `apply-aesthetic` → токены (CSS variables), светлая/тёмная тема, типографика (Inter/Manrope с кириллицей), `src/lib/motion.ts` (пресеты: `fadeUp`, `stagger`, `spring {stiffness: 380, damping: 30}`; `useReducedMotion`). Записать выбранное направление в `DECISIONS.md`.
  DoD: страница-витрина `/_ui` (только dev) со всеми базовыми компонентами в 8 состояниях; `gate` зелёный по контрасту.
  ↳ done: F-02 · проверка: XIAS `verify_states` light 62/dark 66 element-state OK, `axe_audit` 0 violations (обе темы), `slop_tells` OK, `lint_hardcodes`/`check_no_emoji` OK, `check-overflow` 320–1280px OK; гейты responsive/keyboard/target-size кита не запускались (нужен Google Chrome, channel=chrome) — UNMEASURED

## 5. Фаза 2 — Обязательная функциональность (→ M2)

### Backend
- [x] **B-05** Auth: argon2, sessions, cookie+bearer, `login/me/logout`, `current_user`, `require_admin`, sync админа из `.env`, rate-limit логина, аудит `auth.login.success/failed`, `auth.logout`.
  Тесты: AC-2, AC-4 (часть), неверный пароль → 401, logout → старый токен 401.
  ↳ done: B-05 · проверка: `pytest -q` → 18 passed (tests/api/test_auth.py 13, test_admin_sync.py 3); curl :8080 login → token+cookie, /auth/me по cookie → admin
- [x] **B-06** Домен `schedule.py`/`status.py` + **unit-тесты сначала** (`tdd-guide`): 31.01→28.02/29.02→31.03, 30.11→30.12…, weekly/quarterly/yearly, високосный год, просрочка на границе (due_date, due_date+1), paid_late, оплата в день срока.
  DoD: ≥ 25 параметризованных кейсов зелёные.
  ↳ done: B-06 · проверка: `pytest tests/unit --cov=app/domain` → 56 passed, покрытие app/domain 100%
- [x] **B-07** Recurring payments: `GET` (все авторизованные), `POST`/`DELETE` (admin, soft delete), при создании — `ensure_occurrences` + постановка `pending`-напоминания, аудит.
  Тесты: AC-3 (user → 403), AC-14 (после DELETE нет новых периодов и напоминаний, история видна).
  ↳ done: B-07 · проверка: `pytest tests/api/test_recurring_payments.py` → все зелёные (в составе 122 passed): 401 ×4, user POST/DELETE → 403 без изменений, POST внутри окна → pending-напоминание сразу, soft delete сохраняет историю и не порождает новых периодов при сдвиге часов
- [x] **B-08** Occurrences: список с фильтрами/сортировкой/пагинацией, `GET by id`, `PATCH` по правилам §1.5, вычисляемые поля, `paid_by_label`, аудит.
  Тесты: AC-9, AC-10, AC-11, EC-4, EC-5; пользователь может PATCH (не 403).
  ↳ done: B-08 · проверка: `pytest tests/api/test_occurrences.py` → все зелёные (в составе 122 passed); покрытие app 94%
- [x] **B-09** Summary по валютам (всегда 3 валюты, Decimal-суммы, фильтр периода, `as_of`).
  Тест: AC-12 на сид-данных.
  ↳ done: B-09 · проверка: `pytest tests/api/test_summary.py` → 6 passed: три валюты нулями на пустой БД, RUB 85000.00+15000.50=100000.50 отдельно от USD/EUR, as_of (оплата в день срока не просрочка), интервал, 422 на from>to, include_deleted
- [x] **B-10** Users CRUD (admin only), запрет на системного админа, soft delete + revoke сессий.
  Тесты: AC-3, AC-4, EC-8, EC-12, уникальность логина → 409.
  ↳ done: B-10 · проверка: `pytest -q` → 155 passed (test_users.py: 401 ×5, user → 403 ×6 без изменений данных, admin PATCH/DELETE системного админа → 403, role=admin → 403, дубль логина → 409, смена пароля отзывает сессии, удаление: сессии отозваны, вход 401, paid_by_label сохранён, повторно 404, логин можно выдать снова)
- [x] **B-11** Worker: `python -m app.worker` — APScheduler (tick + быстрый pending-poll), notifiers (`telegram` через aiogram, `console`), конвейер §1.3, ретраи с backoff, graceful shutdown. Бот: `/start`, `/chatid`.
  Тесты (без сети, notifier-фейк): AC-6 (два тика → одна отправка), AC-7, AC-8, AC-14, EC-6 (ошибка → failed → ретрай → sent, без дублей).
  ↳ done: B-11 · проверка: `pytest -q` → 173 passed (test_reminder_pipeline 9: AC-6 три тика → одна отправка, AC-7 без тика, AC-8, оплачен после постановки → cancelled, AC-14, EC-6 failed → backoff → sent без дублей, предел попыток, срок прошёл → cancelled, текст FR-18; test_notifiers 9); вживую: POST со сроком завтра 21:14:34 → `REMINDER … AC-7 Проверка, 1 234,50 EUR, срок 25.10.2026 (завтра)` в 21:14:35; `docker compose restart worker` → «Stopping worker / Worker stopped». Реальный Telegram не проверен (нет токена) → Q-03
- [x] **B-12** Seed (`app/seed.py`, идемпотентный; запускается при старте если `SEED_DEMO_DATA=true` и нет платежей): пользователь `user`/`user12345`;
  платежи относительно «сегодня»: «Аренда офиса» 85 000 RUB (срок через 2 дня → напоминание при старте), «Сервер Hetzner» 49.90 USD (срок 10 дней назад, не оплачен → просрочка),
  «Подписка Figma» 15.00 EUR (оплачена в прошлом периоде с опозданием, текущий — в будущем), «Домен invoice-keeper.ru» 1 990 RUB yearly; история за 2–3 прошлых периода с оплатами.
  DoD: после `docker compose up` в панели видны все статусы: оплачено, оплачено с опозданием, скоро, просрочено.
  ↳ done: B-12 · проверка: `pytest -q` → 174 passed (test_seed: все 6 display_status, три валюты, напоминание по аренде, идемпотентность); чистый запуск `WEB_PORT=8081 docker compose -p ik-fresh up -d --build` → 4× healthy, «Demo data created: 6 payments», воркер сразу отправил напоминания (Google Workspace — сегодня, Аренда офиса — через 2 дня); статусы: paid 9, paid_late 2, overdue 1, due_today 1, due_soon 1, upcoming 6
- [x] **B-13** OpenAPI финал: описания, примеры, теги на русском, security schemes (cookie + bearer), коды ошибок у каждой операции; `docs/openapi.yml` обновлён; `api-design-reviewer` прогнан, замечания закрыты.
  ↳ done: B-13 · проверка: `export_openapi` + `pytest tests/test_openapi_up_to_date.py` → 2 passed; `api_linter.py docs/openapi.yml` → 90.7/100, 0 errors (было 90.0); фронтенд-типы перегенерированы, tsc OK

### Frontend
- [x] **F-03** Логин: форма (rhf+zod), ошибки по `ux-writing`, редирект по роли; guard маршрутов (нет сессии → `/login`), обработка 401 глобально (сброс кэша → `/login`), выход.
  ↳ done: F-03 · проверка: `E2E_BASE_URL=http://127.0.0.1:5173 npx playwright test e2e/auth.spec.ts` → 6 passed (desktop+mobile): редирект /payments → /login?next=, ошибки полей, «Неверный логин или пароль», вход и возврат по next, выход
- [x] **F-04** Shell: сайдбар (Сводка, Платежи, Регулярные [admin], Пользователи [admin], Календарь, Журнал [admin]), шапка с пользователем и ролью, переключатель темы, мобильное меню.
  ↳ done: F-04 · проверка: e2e auth.spec (desktop+mobile) → 6 passed; скриншоты shell light/dark 1280 и 360px просмотрены
- [x] **F-05** **Платежи (главный экран, FR-24):** таблица периодов — название, сумма, валюта, срок, статус-бейдж, дата оплаты, просрочка («просрочен на 3 дн.», «оплачен с опозданием на 2 дн.»); фильтры (статус, просрочка, валюта, период), сортировка, пагинация; быстрые вкладки «К оплате / Просрочено / Оплачено / Все».
  Действие «Отметить оплату» → popover с датой (по умолчанию сегодня, будущие даты заблокированы) → оптимистичное обновление; «Отменить оплату»; «Исправить дату». Мобильная версия — карточки.
  DoD: доступно и admin, и user; empty/loading/error состояния; e2e шаги 4–6 демо.
  ↳ done: F-05 · проверка: `npx playwright test` → 8 passed (payments.spec: просроченный период → «Отметить оплату» (сегодня, позже срока) → «Оплачен с опозданием» → исправление даты на срок → «Оплачен» без просрочки → снятие отметки → снова «Просрочен», desktop+mobile); скриншоты light/dark/375px просмотрены
- [x] **F-06** **Регулярные платежи (admin):** список (активные/архив), форма создания (название, сумма с маской, валюта, дата ближайшей оплаты, периодичность), подсказка «напоминание придёт за 3 дня / сразу, если срок ближе», удаление с подтверждением и пояснением «история сохранится».
  ↳ done: F-06 · проверка: `npx playwright test e2e/recurring.spec.ts` → 2 passed (desktop+mobile): ошибки пустой формы, маска суммы «1500,5» → «1 500,50», USD, дата завтра → подсказка «напоминание уйдёт сразу», платёж в списке со статусом «Скоро срок», прекращение с подтверждением → «Прекращённые»
- [x] **F-07** **Пользователи (admin):** таблица, создание, редактирование (логин, имя, пароль), удаление; системный админ — с замком и без действий.
  ↳ done: F-07 · проверка: `npx playwright test` → 11 passed; users.spec: «Из .env» у системного админа, занятый логин → ошибка у поля, создание, вход пользователя → /payments без админ-разделов, /users → «только администратору», удаление, вход удалённого → «Неверный логин или пароль»
- [x] **F-08** **Сводка (dashboard):** три карточки валют (всего / оплачено / к оплате / просрочено) за выбранный месяц, блок «Ближайшие 7 дней», блок «Просрочено» — `data-dashboard`, анимации появления (stagger) и плавная смена чисел.
  ↳ done: F-08 · проверка: tsc/oxlint чисто; скриншоты light/dark 1280 и 375px просмотрены; check-overflow 320/360 OK; e2e (все спеки) зелёные
- [x] **F-09** Форматирование: `Intl.NumberFormat('ru-RU', {style:'currency'})` для RUB/USD/EUR, даты `dd.MM.yyyy`, относительные «через 3 дня», «сегодня».
  ↳ done: F-09 · проверка: используется на всех экранах; скриншоты: «85 000,00 ₽», «49,90 $», «15,00 €», даты dd.MM.yyyy, «через 21 день», «на 41 день», «сегодня/завтра»

### Проверка M2
- [x] **Q-01** (ANY) `tests/acceptance/test_ac_XX_*.py` — по файлу на каждый AC-2…AC-14, на реальной Postgres; `pytest -q` зелёный.
  ↳ done: Q-01 · проверка: `docker compose -f docker-compose.yml -f compose.dev.yml run --rm --no-deps backend pytest -q --cov=app` → 208 passed, покрытие app 95%, app/domain 100%; tests/acceptance: 34 passed (AC-2…AC-12, AC-14; AC-13 — ручная Q-05)
- [x] **Q-02** (FRONT) Playwright `e2e/demo.spec.ts` = сценарий со с.15: войти admin → добавить платёж со сроком через 1 день → (проверить `reminders` через API/лог console-notifier) → войти user → отметить оплату → показать просроченный → исправить дату → просрочка исчезла → показать следующий период с отдельным статусом.
  ↳ done: Q-02 · проверка: `cd frontend && npx playwright test` против `docker compose` (:8080) → 12 passed; demo.spec: вход admin → создание платежа со сроком завтра через UI → `reminder_sent_at` выставлен воркером ≤ 30 с (console) → вход user → отметка оплаты → просроченный (−4 дня) → «Оплачен с опозданием» → исправление даты на срок → «Оплачен» → Период 2 того же платежа «Ожидает»
- [!] **Q-03** (BACK) Реальный Telegram: создать бота, добавить в группу, `/chatid`, прописать в `.env`, проверить AC-6/AC-7 вживую; скриншот в `docs/screenshots/`.
  ↳ blocked: ESC-1 (нужны токен бота и chat id). Без них проверено: конвейер — тестами с фейковым нотифаером, console-канал — вживую (AC-7 ≈1 с), TelegramNotifier — юнит-тестом с фейковым Bot
- [x] **Q-04** (ANY) `adversarial-reviewer` + `senior-security` по authz: попытки обойти права через API (IDOR, смена роли, PATCH чужих полей). Найденное → `red-green-proof`.
  ↳ done: Q-04 · проверка: эксперимент на стеке — до фикса 7 входов с подменой X-Forwarded-For → 401×7 и поддельный IP в audit_log; после → 401×5, 429×2, IP реальный; `sh scripts/smoke.sh` → OK; `pytest -q` → 209 passed. Отчёт: docs/reviews/Q-04-adversarial.md
- [x] **Q-05** (ANY) AC-13: `docker compose down && docker compose up -d` → данные на месте. AC-1: свежий клон в другую папку, строго по README.
  DoD M2: §8 — все AC зелёные; запись «M2 достигнут» в журнале.
  ↳ done: Q-05 · проверка: AC-13 — счётчики до/после `docker compose down && up -d`: 30|45|7|5|6|208 = 30|45|7|5|6|208, smoke OK. AC-1 — `git clone` в новую папку → `cp .env.example .env` → `docker compose -p ik-clean up -d --build` (-p только чтобы не задеть рабочий том) → 4× healthy за 46 с (прогретый кеш), `sh scripts/smoke.sh` OK, `npx playwright test` на этом стеке → 12 passed; `docker compose run --rm backend pytest -q` → 209 passed

## 6. Фаза 3 — Бонусы (→ M3). Порядок = ценность/трудоёмкость. Каждый — отдельный коммит, M2-тесты зелёные.

- [!] **X-01** (BACK) **Кнопка «Оплачено» в Telegram** (FR-B1): callback `pay:<id>:<hmac>` (HMAC от `SECRET_KEY`, защита от подделки), только из `TELEGRAM_CHAT_ID`; отметка `paid_at=today`, `paid_by_label="Telegram @user"`, сообщение редактируется «✅ Оплачено @user 23.10.2026», повторный клик — ответ «уже оплачено». Аудит.
  ↳ код готов: services/telegram_actions.py (подпись HMAC-16 от SECRET_KEY, только TELEGRAM_CHAT_ID, FOR UPDATE, аудит source=telegram), кнопка в TelegramNotifier, обработчик в worker/bot.py; проверка: `pytest` → 216 passed (test_telegram_pay_button 7: подпись/чужой чат/подделка → forbidden, отметка сегодня с «Telegram @user», повторный клик → «уже оплачено»; test_notifiers: кнопка в reply_markup). Живой клик — после ESC-1
- [x] **X-02** (BACK+FRONT) **Журнал аудита** (FR-B2): `GET /api/v1/audit-log` (admin, фильтры), экран «Журнал» — кто, что, когда, IP; логин/логаут/неудачные входы/создание/удаление/оплата/отмена/смена даты.
  ↳ done: X-02 · проверка: `pytest` test_audit_log 4 passed (401, user → 403, порядок и подписи объектов, фильтры), test_ac_02 включает новый эндпоинт → 401; e2e audit.spec → 1 passed; скриншот просмотрен
- [x] **X-03** (FRONT; BACK — `GET /api/v1/calendar?month=YYYY-MM`) **Календарь оплат** (FR-B3): месячная сетка, точки-статусы по валютам, клик по дню → список периодов с действиями; layout-анимация смены месяца.
  ↳ done: X-03 · проверка: e2e calendar.spec → 2 passed (desktop+mobile): день с платежом «Срок сегодня» → отметка оплаты из панели дня → «Оплачен»; смена месяца; скриншоты 1280 light / 375 dark просмотрены, нет переполнения на 320px
- [x] **X-04** (BACK+FRONT) **Итоги на дату** (FR-B4): `as_of` в summary — «сколько должно было быть оплачено к дате X / оплачено / просрочено», date-picker на сводке.
  ↳ done: X-04 · проверка: `pytest tests/api/test_summary.py` → 7 passed (на 15.10: должно 100.00, оплачено 100.00, просрочено 0; на 22.10: 150.00 / 100.00 / 50.00); e2e asof.spec → 1 passed
- [x] **X-05** (FRONT) **UX/UI полировка** (FR-B5): `design-review` (6 измерений, Nielsen) → исправить top-10; `critique`; `a11y-audit` WCAG 2.2 AA; микро-анимации через `/motion` (hover/tap кнопок, появление строк, бейджи статусов, toast), skeleton-загрузка, горячие клавиши (`/` поиск), `prefers-reduced-motion`. Гейт `ux-ui-agent-skills:gate` зелёный.
  ↳ done: X-05 · проверка: XIAS-гейты на снимках всех 7 экранов (вход, сводка, платежи, календарь, регулярные, пользователи, журнал) в светлой и тёмной теме: axe_audit 0 violations, verify_states OK (default/hover/focus); lint_hardcodes/check_no_emoji/lint_native_select OK; e2e — все зелёные. Гейты keyboard/target-size/responsive кита не запускались (нужен Google Chrome) — адаптив проверен своим check-overflow 320–1280
- [x] **X-06** (BACK) **Webhook** (FR-B6): `WEBHOOK_URL` + `WEBHOOK_SECRET` → POST JSON при напоминании, подпись `X-Signature: sha256=…`; тот же конвейер `reminders` (channel=webhook).
  ↳ done: X-06 · проверка: `pytest` → 228 passed (test_webhook 5: подписанный JSON, 4xx/5xx и сетевые ошибки → ретрай, канал включается URL; pipeline: воркер не трогает каналы, которых не обслуживает); вживую: приёмник в сети compose получил `HOOK sha256=db5b… {"event": "payment.reminder", "payment_name": "AC-7 Проверка", "amount": "1234.50", "currency": "EUR", "due_date": "2026-10-25", …}`
- [x] **X-07** (BACK) **Email через SMTP** (FR-B7): `SMTP_*`, канал email в конвейере; mailpit в `profiles: [extras]` для демо (`http://localhost:8025`).
  ↳ done: X-07 · проверка: `pytest` → 231 passed (test_email 3: тема/получатели/текст, SMTP-ошибка → ретрай, канал включается SMTP_HOST+EMAIL_TO); вживую: `docker compose --profile extras up -d mailpit` + воркер с SMTP_HOST=mailpit → в mailpit API 6 писем «Напоминание об оплате: AC-7 Проверка, 1 234,50 EUR до 25.10.2026» для team@example.com
- [x] **X-08** (BACK+FRONT) **Чек или ссылка к оплате** (FR-B8): `receipt_url` (валидация URL) и загрузка файла (pdf/png/jpg ≤ 5 МБ) в volume `uploads`, `GET` с авторизацией; иконка-скрепка в таблице.
  ↳ done: X-08 · проверка: `pytest` → 246 passed (test_receipts 11: ссылка задать/убрать, javascript:/ftp:/мусор/слишком длинная → 422, загрузка PDF и замена PNG, скачивание только с сессией (401 без), удаление, .exe/HTML под видом PDF/пустой файл → 422, > 5 МБ → 413, 404); `alembic check` → без расхождений (миграция 0002); e2e → 17 passed (receipts.spec: ошибка ссылки, ссылка, загрузка PDF, скачивание 200 application/pdf); axe/states на «Платежах» OK в обеих темах
- [x] **X-09** (BACK+FRONT) **Бюджет** (FR-B9): `budgets(year, month NULL, currency, amount)`, план vs факт по валютам на сводке, прогресс-бар.
  ↳ done: X-09 · проверка: `pytest` → все зелёные (test_budgets 9: 401, user видит/не меняет (403), план/факт месяца и года, upsert и удаление (amount=null), валидация месяца/года/валюты/суммы); миграция 0003, `alembic check` без расхождений; e2e → 18 passed (budget.spec: админ задаёт бюджет RUB, на сводке «из 5 000 000,00 ₽» и остаток); скриншот карточки просмотрен
- [x] **X-10** (BACK) **Напоминание о просрочке** (kind=`overdue`, раз в день не более 1 / до оплаты, в пределах `OVERDUE_REMINDER_MAX`) — «другие каналы/поведение» (FR-B10).
  ↳ done: X-10 · проверка: `pytest` → 261 passed (test_overdue_reminders 4: upcoming одно + overdue на 27/28/29.10 и больше нет при двух проверках в день, после оплаты прекращаются, OVERDUE_REMINDER_MAX=0 выключает, текст «Просрочена оплата … 3 дня назад»); миграции 0001…0004 downgrade base → upgrade head → `alembic check` чисто; вживую воркер: «Queued 18», «REMINDER #489 → Просрочена оплата: Сервер Hetzner, 49,90 USD, срок был 13.10.2026 (11 дней назад)»

## 7. Фаза 4 — Сдача и защита (→ M4)

- [x] **D-01** README (ru): что это; требования (Docker Desktop); **быстрый старт за 3 команды** (`git clone` → `copy .env.example .env` / `cp` → `docker compose up -d --build`); адреса (панель, Swagger, mailpit); логины по умолчанию; как подключить Telegram (BotFather → добавить в группу → `/chatid` → `.env` → `docker compose up -d`); переменные окружения (таблица); архитектура (схема §1); как работает расписание и дедупликация; тесты (`docker compose run --rm backend pytest`, `npm run test:e2e`); список бонусов с путями в UI; известные ограничения. Команды для PowerShell и bash.
  ↳ done: D-01 · проверка: README перечитан на соответствие коду: команды запуска (PowerShell/bash) прогонялись в Q-05, тесты (261/18) — актуальные числа, переменные сверены с Settings/.env.example
- [x] **D-02** `docs/DEMO.md` — сценарий защиты по с.15 по минутам, с данными для ввода и запасным планом (если Telegram не отвечает — показать console-лог и таблицу reminders; `CLOCK_OVERRIDE` для «следующего периода»).
  ↳ done: D-02 · проверка: каждый шаг сценария покрыт e2e demo.spec (шаги 1–7, кроме живого Telegram) и прогонялся на чистом клоне в Q-05; данные для ввода совпадают с демо-сидом
- [x] **D-03** `ship-gate` + `self-eval` + `code-reviewer`; закрыть critical/high. `env-secrets-manager`: в репо нет секретов (`git grep -i token`).
  ↳ done: D-03 · проверка: секреты/console/TODO — чисто; npm audit 0; pip-audit 0; ship-gate CRITICAL 0 HIGH 0; red-green: test_old_backlog_does_not_flood_the_chat 105 → ≤ 5; `pytest` → 262 passed. Отчёт: docs/reviews/D-03-final.md
- [x] **D-04** Чистый прогон: `git clone` в новую папку → строго README → полный демо-сценарий руками. Время запуска записать в журнал.
  ↳ done: D-04 · проверка: `git clone` в новую папку @ fe3241f → `cp .env.example .env` → `docker compose -p ik-final up -d --build` → 4× healthy за 58 с (кеш прогрет; холодная сборка 2–4 мин), `sh scripts/smoke.sh` OK, Playwright 18 passed (включая демо-сценарий), `docker compose -p ik-final run --rm backend pytest -q` → 262 passed, воркер сразу отправил напоминания по демо-данным (срок сегодня, через 2 дня, просрочка)
- [-] **D-05** (опц.) `demo-video`: 60–90 сек ролик сценария (Playwright-скриншоты + моушн), идеи — prompt-motion.com.
  ↳ отменена: опциональна; страховка демо — docs/DEMO.md (запасной план) и e2e demo.spec, который воспроизводит сценарий целиком
- [x] **D-06** Финальный отчёт в §9: что сделано, что нет, известные ограничения; тег `v1.0.0`.
  ↳ done: D-06 · проверка: итоговая запись в §9; тег v1.0.0 на коммите финального отчёта
- [x] **D-07** README сверен с кодом после FIX-TG-2, P-16 и редизайна Aéza: несколько чатов Telegram в ограничениях, просрочки в боковой панели, число тестов, недостающие переменные окружения, `/health`, честная формулировка про axe.
  ↳ done: D-07 · проверка: `npx playwright test --list` → Total: 20 tests in 11 files; число pytest — по записи FIX-TG-2 (317 passed, последний коммит в backend/tests); переменные — по `core/config.py` и `deploy/compose.https.yml`

## 7a. Фаза 5 — Продуктовое усиление (после M4, ветка `improve/product-hardening`, ADR-020)

Цель — довести решение от «прошло приёмку» до «можно пользоваться завтра»: стабильность при росте данных, редактирование
платежей, чистый демо-стенд, понятный UI. Тег `v1.0.0` остаётся версией для защиты.

- [x] **P-01** (ANY) E2E на изолированном стенде (`compose.e2e.yml`: проект `invoice-keeper-e2e`, порт 8081, свои тома, каналы выключены) + `app.scripts.reset_demo` (в production — только `--force`).
  ↳ done: P-01 · проверка: `pytest tests/api/test_reset_demo.py` → 2 passed; `compose config` → name invoice-keeper-e2e, том invoice-keeper-e2e_pgdata, порт 8081
- [x] **P-02** (BACK) Материализация периодов за 1 запрос без записи в установившемся режиме; GET не делает commit без изменений (ADR-021).
  ↳ done: P-02 · проверка: red — `test_query_budget` 7→21 / 6→13 / 5→12 / 7→14 запросов при 2→9 платежах и COMMIT на каждом GET; green — 8 passed; `pytest` → 272 passed
- [x] **P-03** (BACK) N+1 в `GET /recurring-payments`: ближайшие периоды одним запросом (`DISTINCT ON`).
  ↳ done: P-03 · проверка: тот же `test_query_budget` (число запросов списка не зависит от числа платежей) → passed
- [x] **P-04** (BACK+FRONT) Редактирование регулярного платежа: `PATCH /recurring-payments/{id}` (название, описание, сумма текущих и будущих неоплаченных периодов), ADR-022.
  ↳ backend: `pytest tests/api/test_recurring_payment_edit.py` → 5 passed (401/403 без изменений, переименование, сумма только у текущих и будущих неоплаченных, новые периоды с новой суммой, аудит «было/стало», 422/404/409); test_ac_02/03 → passed; openapi.yml экспортирован
  ↳ frontend: диалог «Изменить платёж» (только изменённые поля, подсказка о том, к каким периодам применится сумма), журнал показывает «было → стало»; e2e recurring.spec дополнен шагом изменения суммы
- [x] **P-05** (BACK) Сервисный слой для отметки оплаты и чеков; старый файл чека удаляется только после commit (баг).
  ↳ done: P-05 · проверка: red — при сбое транзакции замены старый файл удалялся, новый оставался сиротой (`test_failed_replace_keeps_previous_file`, `test_failed_delete_keeps_file`); green — services/receipts.py (запись до COMMIT с откатом файла, удаление прежнего после COMMIT), services/occurrences.apply_patch; `pytest` → 281 passed
- [x] **P-06** (BACK) Воркер: обращения к БД при доставке — вне event loop (`asyncio.to_thread`).
  ↳ done: P-06 · проверка: red — `test_delivery_keeps_database_off_the_event_loop`: claim выполнялся в потоке event loop; green — _take/_mark_sent/_mark_failed через asyncio.to_thread; `pytest` → 281 passed
- [x] **P-07** (FRONT) Vitest; правила статуса и оптимистичного обновления — с порогом из `app-info`, а не «3».
  ↳ done: P-07 · проверка: `npm run test` → 11 passed (status: пороги как в domain/status.py, оптимистичная оплата с опозданием считает overdue_days; format/money-input). Заодно убраны захардкоженные «3 дня» в подсказке формы, на экране входа и в приветствии бота
- [x] **P-08** (FRONT) Сводка без противоречий и дублей; бюджет и итоги на дату — на странице «Отчёты».
  ↳ done: P-08 · проверка: Сводка — главный блок (число к оплате, «ещё N просрочено в прошлых месяцах» вместо расхождения 19/20, ближайший срок, прогресс), карточки валют с остатком бюджета, «Все просроченные» и 7 дней; «Отчёты» (/reports) — бюджет и итоги на дату; e2e budget.spec/asof.spec переведены на /reports → passed; скриншоты 1440 просмотрены
- [x] **P-09** (FRONT) Просрочка сообщается один раз (без «41 день назад» + «Просрочен» + «на 41 день»).
  ↳ done: P-09 · проверка: число дней — только у срока («5 дней назад»), под бейджем — лишь «на N дней позже срока» у оплаченных с опозданием; e2e payments.spec обновлён → passed (desktop + mobile)
- [x] **P-10** (FRONT) Календарь: сумма и число платежей за день, однозначные статусы (не только цвет).
  ↳ done: P-10 · проверка: ячейка — значок самого срочного статуса + число платежей + короткие суммы по валютам («85 тыс. ₽»), «оплачен с опозданием» = оплачен (жёлтый только «срок сегодня»), легенда со значками; все периоды месяца загружаются постранично (не обрезаются на 200); unit formatMoneyCompact; e2e calendar.spec → passed; скриншоты 1440 и 375 просмотрены
- [x] **P-11** (FRONT) Мобильная «Платежи»: компактная шапка и фильтры, плотная карточка.
  ↳ done: P-11 · проверка: на 375px видно 5 периодов вместо 2 (описание страницы скрыто на телефоне, фильтры за кнопкой с числом выбранных, карточка в три строки); 320px — scrollWidth = 320, без горизонтальной прокрутки страницы
- [x] **P-12** (FRONT) «Регулярные»: действия в меню (изменить / прекратить) вместо красной кнопки в каждой строке.
  ↳ done: P-12 · проверка: `tsc -b` чисто; e2e recurring.spec (меню «Действия: …» → Изменить / Прекратить) → passed. Баг найден в браузере: диалог «Изменить», открытый из меню, сразу закрывался (Radix возвращал фокус на кнопку меню) → onCloseAutoFocus
- [x] **P-13** (BACK) Telegram-бот как мини-панель (FR-B10, ADR-023): `/menu` со сводкой, «Ближайшие» и «Просрочено» с пагинацией, карточка периода (оплата, отмена с подтверждением, ссылка в панель), итоги месяца, список платежей; цветные кнопки `style`, меню команд, описание бота, reply-клавиатура в личке, Mini App при HTTPS, copy_text для `/chatid` и адреса панели, реакция на оплату; доступ — командный чат и личка его участников.
  ↳ done: P-13 · проверка: `pytest` → 306 passed (+25: test_telegram_screens, test_telegram_bot — апдейты через Dispatcher.feed_update с записывающей сессией Bot API, unpay/клавиатура в test_telegram_pay_button); экраны отрисованы на демо-БД в контейнере воркера; воркер без токена стартует (console). Живая проверка в Telegram — за человеком (ESC-1)
- [x] **P-14** (FRONT) Фирменный стиль Aéza по гайдбуку 2026 (ADR-024): палитра #000 / #4CC6F1 / #F4F4F4 (+ #182D48, #E97C35), Exo 2 для заголовков, логотип-«клавиши», фирменные плитки иконок, паттерн на входе, favicon.
  ↳ done: P-14 · проверка: `npm run build`, `oxlint`, `tsc` чисто; `npm run test` → 12 passed; Playwright на стенде e2e → 18 passed (desktop + mobile); lint_hardcodes → 0, check_no_emoji по изменённым файлам → OK; контраст всех новых пар текст/фон ≥ 5.1:1 (кнопка: чёрный на #4CC6F1 10.7:1); скриншоты 1440/375 в обеих темах просмотрены, горизонтальной прокрутки нет
- [x] **P-15** (FRONT) Логотип «Клавиша IK» (ADR-025): знак inline-SVG через токены brand-key / brand-key-fg / brand-accent (мелкая версия для 28px) в сайдбаре, мобильной шапке, меню и на входе; favicon .ico 16/32/48 + SVG со сменой темы, apple-touch-icon, icon-192/512 + maskable, site.webmanifest (nginx отдаёт application/manifest+json); полный комплект в `brand/`.
  ↳ done: P-15 · проверка: `npm run build`, `oxlint` чисто; `npm run test` → 12 passed; Playwright на стенде e2e → 18 passed (desktop + mobile); lint_hardcodes → 0, check_no_emoji → OK; скриншоты входа, сайдбара, мобильной шапки и меню в светлой и тёмной темах просмотрены; `curl :8080/site.webmanifest` → 200 application/manifest+json, `/favicon.ico` → 200 image/x-icon
- [x] **P-16** (FRONT) Просрочка в боковой панели: подстрока под «Платежами» (до 5 платежей, 2 строки на платёж: название и «Просрочен на N дней», «Ещё N» дальше), раскрывается после загрузки, новая просрочка въезжает с подсветкой (опрос раз в минуту), скрыть нельзя; клик → «Платежи / Просрочено» с этим платежом первым и подсвеченным (`focus`). Сайдбар 15 → 17.5rem, контент max-w-6xl → 96rem, на сводке карточка просрочки убрана, «Ближайшие 7 дней» на всю ширину.
  ↳ done: P-16 · проверка: `tsc`, `oxlint` чисто, `npm run build` ок; `npm run test` → 12 passed; Playwright на стенде e2e → 18 passed (desktop + mobile); lint_hardcodes → 0 по изменённым файлам; контраст пункта просрочки в тёмной теме: название 17.61:1, статус 8.48:1; в браузере 1920 и 375: клик → `/payments?tab=overdue&focus=8`, строка первая и подсвечена; отметка оплаты убирает блок, снятие отметки возвращает его с подсветкой
- [x] **P-17** (FRONT) Анимация входа страницы при смене раздела (opacity + сдвиг 12px, 0.32s; смена фильтров в search не анимируется). Просрочка в сайдбаре закрыта при загрузке и через 2 с выезжает каскадом из-под «Платежей» (без значка-треугольника), открыта до перезагрузки страницы, в мобильном меню не ждёт повторно.
  ↳ done: P-17 · проверка: `tsc`, `oxlint` чисто, `npm run build` ок; `npm run test` → 12 passed; Playwright на свежем стенде e2e → 18 passed (desktop + mobile), стенд после прогона снят (`e2e:down`); lint_hardcodes → 0, check_no_emoji → OK по изменённым файлам; в браузере после перезагрузки список пуст до ~2.6 с, затем пункт стартует с translateY(-24px) scale(0.96) opacity 0 и встаёт на место; переход «Сводка → Календарь» перемонтирует обёртку страницы
- [x] **P-18** (FRONT) Фирменный паттерн без обрывов (ADR-026): линии собраны из CSS-рамок, привязанных к краям, и уходят за край при любом размере; паттерн в основании боковой панели и мобильного меню и в углу главной карточки сводки; на входе форма по центру своей колонки.
  ↳ done: P-18 · проверка: Playwright на стенде e2e → 18 passed (desktop + mobile), стенд снят (`e2e:down`); `npm run build`, `oxlint` чисто; `npm run test` → 12 passed; check_no_emoji → OK по изменённым файлам; в браузере вход 1915×940 и 1280×800 без прокрутки, все концы линий за краями; сводка 1280 в тёмной и светлой темах, 375 (угол скрыт, меню с основанием)
- [x] **P-19** (FRONT) Паттерн строго по стр. 22 гайдбука (ADR-026): на входе три белые вертикали на всю высоту, три голубые горизонтали, голубая акцентная линия сверху с поворотом вправо; текст панели правее линий; в основании сайдбара три горизонтали и одна поворачивающая линия; угол на карточке сводки убран.
  ↳ done: P-19 · проверка: e2e без чистого прогона: стенд :8081 одновременно использовал другой процесс (прогон 1: 16/18, упавшие asof и budget по отдельности 2/2 passed; прогон 2: 17/18, ENOENT файла трассировки; прогон 3: стенд остановлен посреди прогона, ERR_CONNECTION_REFUSED); `npm run build`, `oxlint` чисто; `npm run test` → 12 passed; check_no_emoji → OK; в браузере вход 1915×940 и 1280×800 без прокрутки (scrollHeight = innerHeight), 1024×700 прокрутка 52px, линии текст не пересекают; сайдбар 1280 в тёмной теме
- [x] **P-20** (FRONT) Живые иконки (по мотивам kyssltd.ru): при наведении мышью, нажатии/тапе и фокусе с клавиатуры иконка в кнопке, пункте меню, разделе навигации, поле выбора и даты отыгрывает короткий жест по смыслу: плюс и крестик проворачиваются, корзина и колокольчик качаются, стрелки шагают по направлению, галочка щёлкает, карандаш черкает, остальные подпрыгивают; знак-клавиша в логотипе нажимается. CSS-кейфреймы только на transform, пружина `--ease-spring` (linear()), 480 мс; один делегированный обработчик `lib/icon-play.ts` перезапускает жест на каждое касание; при prefers-reduced-motion жест не запускается.
  ↳ done: P-20 · проверка: Playwright на свежем стенде e2e → 18 passed (desktop + mobile), стенд снят (`e2e:down`); `npm run build`, `tsc`, `oxlint` чисто; `npm run test` → 12 passed; lint_hardcodes → 0, check_no_emoji → OK по изменённым файлам; в браузере настоящим курсором: навигация → ik-icon-hop, «Отметить оплату» → ik-icon-pop, 4 клика по стрелкам месяца → 4 пары animationstart/animationend (повторный клик по той же кнопке перезапускает); Playwright с reducedMotion: reduce → жест не запущен, без него → запущен
- [x] **P-21** (FRONT) Живые иконки, доработка по отзыву: поза удерживается, пока курсор или фокус на элементе, и пружиной возвращается после ухода (transition вместо одноразовых keyframes: клик сразу после наведения больше не обрывает и не перезапускает жест; на сенсорных экранах поза на время касания; `lib/icon-play.ts` удалён). Текст логотипа не выделяется при кликах. Знак-клавиша при нажатии уходит вниз и звучит как клавиша механической клавиатуры: синтез Web Audio в `lib/key-sound.ts` (щелчок + «тук» при нажатии, тихий щелчок при отпускании), без аудиофайлов.
  ↳ done: P-21 · проверка: Playwright на свежем стенде e2e → 18 passed (desktop + mobile), стенд снят; `npm run build`, `tsc`, `oxlint` (exit 0) чисто; `npm run test` → 12 passed; lint_hardcodes → 0, check_no_emoji → OK; headless-сценарий на :5177 и на пересобранном :8080: наведение → поза держится (scale 1.13, −10°, −3px), уход → `none`, наведение + клик через 60 мс → один переход transform у шеврона, знак: наведение −1px, нажатие scale 0.92 и +1.5px, 1 осциллятор на нажатие и 1 на отпускание, после двойного и тройного клика выделение пустое; звук в OfflineAudioContext: пик 0.44 (без клиппинга), нажатие 38 мс, отпускание 17 мс
- [x] **P-22** (FRONT) Плитка иконки в навигации двигается вместе с иконкой: при наведении поднимается и наклоняется целиком (иконка внутри не двигается отдельно), при нажатии продавливается (scale 0.9, +1.5px), после отпускания пружиной возвращается в позу. Класс `ik-tile`, только transform, при prefers-reduced-motion без движения.
  ↳ done: P-22 · проверка: Playwright на свежем стенде e2e → 18 passed (desktop + mobile), стенд снят; `npm run build`, `tsc`, `oxlint` (exit 0) чисто; `npm run test` → 12 passed; lint_hardcodes → 0, check_no_emoji → OK; headless-сценарий на :5177 и пересобранном :8080: покой → плитка `none`, наведение → плитка matrix(1.089, −0.153, …, −3), иконка `none`, нажатие → matrix(0.9, 0, 0, 0.9, 0, 1.5), отпускание → снова поза, уход → `none`; скриншот наведения просмотрен
- [x] **P-23** (FRONT) Журнал и Отчёты в языке остального интерфейса. Журнал: вместо таблицы с серыми плашками лента по дням («Сегодня», «Вчера», «22 октября»), у события иконка на скруглённой плитке в тоне события (гайдбук, с. 21), заголовок без повтора («Вход» + «Вход в систему» стало одной строкой), подробность только если она что-то добавляет, автор и IP мелкой строкой, время справа. Отчёты: бюджет и итоги на дату собраны в колонки по валютам, как карточки сводки: валюта и её название, крупная сумма, полоса, легенда с точками («Оплачено», «Остаток» / «Сверх бюджета», «Просрочено»); годовой бюджет отдельной строкой под чертой. Общие части в `reports/CurrencyColumns.tsx`.
  ↳ done: P-23 · проверка: Playwright на свежем стенде e2e → 18 passed (desktop + mobile; asof.spec и audit.spec переведены с таблиц на группу «Итоги на <дата>» и список «Журнал действий»), стенд снят; `npm run build`, `tsc`, `oxlint` чисто; `npm run test` → 12 passed; lint_hardcodes → 0, check_no_emoji → OK; в браузере 1440 тёмная и светлая, 375 без горизонтальной прокрутки (scrollWidth 375); состояние «сверх бюджета» проверено на dev-базе (RUB месяц 100 000 при плане 110 000 → красная сумма, полоса и «Сверх бюджета 10 000,00 ₽»), бюджет затем снят
- [x] **P-24** (FRONT) Журнал плотнее, по отзыву «слишком много пустого места»: на широком экране событие занимает одну строку высотой с плитку и читается как запись лога: время, автор, плитка, событие с подробностью, IP справа (раньше две строки на событие и время у дальнего края). На телефоне прежняя раскладка в столбик. Добавлены подписи событий, которые показывались кодом: `budget.set` → «Задан бюджет» (период и сумма), `budget.deleted` → «Бюджет снят», `occurrence.receipt_uploaded` / `receipt_deleted` / `receipt_link_changed` → «Прикреплён чек», «Чек удалён», «Изменена ссылка на чек».
  ↳ done: P-24 · проверка: Playwright на свежем стенде e2e → 18 passed (desktop + mobile), стенд снят; `npm run build`, `tsc`, `oxlint` чисто; `npm run test` → 12 passed; lint_hardcodes → 0, check_no_emoji → OK; в браузере 1780 px: строка около 40 px вместо 64, на экран помещается вдвое больше событий; 375 px без горизонтальной прокрутки (scrollWidth 375); web на :8080 пересобран
- [x] **P-25** (FRONT) Плитка навигации — клавиша в объёме вместо поворота и уменьшения. В покое вид сверху. Под курсором или фокусом плитка наклоняется верхом от зрителя (`perspective(4rem) rotateX(28deg)`), колпачок поднимается над основанием и снизу видна боковина — силуэт клавиши под углом, как Esc на клавиатуре. Нажатие опускает колпачок до упора, боковина почти скрыта, верх уходит в тень прогиба; отпустили — пружиной обратно. Плитка разделена на основание (`.ik-tile`, боковина в `::before`) и колпачок (`.ik-tile-cap`), двигаются только transform и opacity. Новые токены `--key-cap`, `--key-wall`, `--brand-tile-wall`, `--shadow-key`, примитив `--p-navy-800`. При prefers-reduced-motion плитка плоская.
  ↳ done: P-25 · проверка: Playwright на свежем стенде e2e → 18 passed (desktop + mobile), стенд снят; `npm run build`, `tsc`, `oxlint` (exit 0) чисто; `npm run test` → 12 passed; lint_hardcodes → 0 (после выноса тени в `--shadow-key`), check_no_emoji → OK; в браузере на :5175 при увеличении 4× просмотрены наведение (активная и обычная плитка) и нажатие в тёмной и светлой теме; computed при нажатии: плитка matrix3d(rotateX 28°), колпачок matrix(0.96, 0, 0, 0.96, 0, −0.75), боковина и тень прогиба opacity 1; web на :8080 пересобран
- [x] **P-26** (FRONT) Фирменный паттерн на плитках вместо полосы внизу боковой панели (ADR-028). Шапка каждого раздела (`PageHeader`) стала плиткой с композицией стр. 22 справа (вертикали, голубой и второй поворот, горизонтали на всю ширину), слева заголовок, описание, действия и цифры раздела (журнал: событий сегодня, входов, изменений). Внизу боковой панели и мобильного меню плитка текущего месяца (`MonthPlate`): миниатюра паттерна, «N из M оплачено», просрочено или осталось, ведёт на сводку. В тёмной теме плитки чёрные, в светлой светлые (токены `--brand-plate`, `--brand-plate-sidebar`). Вариант `strip` удалён. Сначала HTML-прототип (сейчас / А / Б / А+Б), выбран А+Б с белой плиткой в светлой теме.
  ↳ done: P-26 · проверка: Playwright на свежем стенде e2e → 18 passed (desktop + mobile), стенд снят; `npm run build`, `tsc -b`, `oxlint` чисто; `npm run test` → 12 passed; lint_hardcodes и check_no_emoji по 5 изменённым файлам → OK; скриншоты на :5175 (1600×900, светлая и тёмная): журнал, сводка, регулярные; 390×844: журнал и меню; 1280×640: плитка месяца скрыта, меню целиком
- [x] **P-27** (FRONT) Знак IK в логотипе нажимается той же клавишей, что и плитка навигации, но объём появляется только при нажатии: в покое и под курсором знак плоский (под курсором по-прежнему чуть приподнят), при нажатии наклоняется (`perspective(4rem) rotateX(28deg)`), показывает боковину и уходит до упора с тенью прогиба; отпустили — пружиной обратно. Знак разделён на основание (`.ik-keycap`, боковина в `::before`, обработчики звука) и колпачок (`.ik-keycap-cap` с SVG), основание, колпачок и тень прогиба делят стили с `.ik-tile`. Токен `--brand-key-wall`. При prefers-reduced-motion знак плоский.
  ↳ done: P-27 · проверка: Playwright на изолированном стенде (`-p ik-e2e-p26`, порт 8091) → 18 passed (desktop + mobile), стенд снят; `npm run build`, `tsc`, `oxlint` (exit 0) чисто; `npm run test` → 12 passed; lint_hardcodes → 0, check_no_emoji → OK; в браузере на :5175 при увеличении 5×: покой и наведение плоские, нажатие (те же значения временным классом) в тёмной и светлой теме; computed: основание matrix3d(rotateX 28°), колпачок matrix(0.96, 0, 0, 0.96, 0, −0.75), боковина opacity 1, цвет rgb(158, 161, 168) в тёмной теме
- [x] **P-28** (FRONT) Клавиша навигации и знак IK повторяют силуэт кейкапа механической клавиатуры (по фото клавиатуры пользователя): вокруг колпачка появляется юбка (`components/KeySkirt.tsx`, SVG): основание шире площадки, боковины сужаются кверху, передняя стенка выше задней и в тени; площадка вогнутая (блик у ближнего края, тень у дальнего). Нажатие опускает колпачок, юбка проседает к основанию (`scaleY(0.9)` от нижнего края), площадка затеняется. Плитка навигации — под курсором и при нажатии, знак IK — только при нажатии. Наклон уменьшен до `rotateX(20deg)`: угол теперь передаёт сам силуэт. Подложка `::before` заменена юбкой. В тёмной теме обычная клавиша светлее (новый примитив `--p-ink-400`, площадка ink-400, боковины ink-300), иначе юбка сливалась с фоном.
  ↳ done: P-28 · проверка: Playwright на изолированном стенде (`-p ik-e2e-p28`, порт 8091, своя папка результатов) → 18 passed (desktop + mobile), стенд снят; `npm run build`, `tsc`, `oxlint` (exit 0) чисто; `npm run test` → 12 passed; lint_hardcodes и check_no_emoji по 5 файлам → OK; в браузере на :5175 при увеличении 4×: наведение (активная и обычная плитка) в светлой и тёмной теме, нажатие плитки и знака IK (те же значения временным классом); computed в тёмной теме: fill юбки обычной плитки rgb(48, 50, 55)
- [x] **P-29** (FRONT) Каждая кнопка с иконкой — кейкап механической клавиатуры, как плитка навигации: `Button` всех вариантов (у синей кнопки кейкапом становится вся кнопка), плитки навигации и ссылка «Из них N просрочен» на сводке. Клавишей становится сам элемент в своих границах: рамка — юбка (задняя стенка 1 px, боковины 2 px, передняя 4 px и темнее), стыки рамки дают скошенные грани, фон — площадка. В покое рамка прозрачная, элемент выглядит как раньше (обводка вторичной кнопки — отдельный слой `::after`). Под курсором или фокусом клавиша наклоняется (`perspective(12rem) rotateX(16deg)`), рамка окрашивается в стенки; нажатие опускает её и затеняет площадку. Только у элементов с иконкой (`:has(> svg)`), иконка внутри своей позы не держит. Плитка навигации больше не выходит за строку: SVG-юбка из P-28 у неё заменена рамкой, у знака IK юбка осталась (рамка изменила бы геометрию знака в покое). Цвета стенок — токены `--key-*` из `color-mix` от лица клавиши, следуют за темой.
  ↳ done: P-29 · проверка: Playwright на изолированном стенде (`-p ik-e2e-p29`, порт 8091) → 19 passed, 1 failed: `header.spec.ts` (незакоммиченный тест параллельной сессии, её правки шапки в рабочей копии) — правая стрелка месяца на 390 px заходит на линию паттерна; геометрия кнопок шапки с классом `ik-key` и без него совпадает (left/right 281.8/313.8 в обоих случаях), то есть падение не от кейкапа; `npm run build`, `tsc`, `oxlint` (exit 0) чисто; `npm run test` → 12 passed; lint_hardcodes и check_no_emoji по 5 файлам → OK; в браузере при увеличении 3×: наведение и нажатие «Добавить пользователя», наведение «Изменить», ссылки просрочки и плитки навигации в светлой и тёмной теме; обводка вторичных кнопок в покое на месте
- [x] **P-30** (FRONT) Кнопка «Добавить платёж» (шапка «Регулярных платежей») получила иконку `Plus`, как «Добавить пользователя», и вместе с ней кейкап из P-29: кейкап включается только у кнопок с иконкой.
  ↳ done: P-30 · проверка: Playwright на изолированном стенде (`-p ik-e2e-p30`, порт 8091) → 20 passed (desktop + mobile, вместе с header.spec), стенд снят; `npm run build`, `tsc`, `oxlint` (exit 0) чисто; `npm run test` → 12 passed; check_no_emoji → OK; в браузере на /recurring: у кнопки svg прямым потомком, рамка 1px 2px 4px, под курсором transform matrix3d (rotateX 16°), стенки oklab 0.65 / передняя 0.50 при лице rgb(125, 214, 245)
- [x] **P-31** (FRONT) Кейкапом становится любая кнопка `Button`, включая кнопки без иконок («Отмена», «Сохранить», «Отметить оплату», «Сбросить фильтры» и т.п.): из правил `.ik-key` убрано условие `:has(> svg)`. Переключатели, поля выбора и пункты меню — не кнопки и остаются прежними.
  ↳ done: P-31 · проверка: Playwright на изолированном стенде (`-p ik-e2e-p31`, порт 8091) → 20 passed (desktop + mobile, вместе с header.spec), стенд снят; `npm run build`, `tsc`, `oxlint` (exit 0) чисто; `npm run test` → 12 passed; lint_hardcodes и check_no_emoji → OK; в браузере в диалоге «Новый регулярный платёж»: у «Отмена» и «Добавить платёж» рамка 1px 2px 4px, под курсором обе встают кейкапом; диалог закрыт без сохранения
- [x] **P-32** (FRONT) Периоды на странице «Платежи» — карточки вместо таблицы (и вместо отдельного мобильного списка): одна сетка 1/2/3 колонки (`sm`, `xl`). В карточке плитка срока (число и месяц на сплошной скруглённой плитке, стр. 21 гайдбука; цвет по срочности, у оплаченных нейтральная), название Exo 2 и номер периода, сумма Exo 2 как главное, статус, срок; внизу дата оплаты с автором и действия. У просроченной рамка красноватая, у периода из боковой панели — кольцо. Оплаченный период уходит с вкладки «К оплате» с анимацией, соседи сдвигаются (`layout`, при reduced-motion без смещений). Страница — 24 периода (делится на 2 и 3). У `OccurrenceActions` проп `compact` заменён на `fill`, мёртвый вариант чека с подписью удалён. e2e ищут карточки в списке «Периоды платежей», а не `tr`.
  ↳ done: P-32 · проверка: Playwright на изолированном стенде (`npm run e2e:up`, порт 8081) → 20 passed (desktop + mobile), стенд снят; `npm run build` (exit 0), `tsc`, `oxlint` чисто; `npm run test` → 12 passed; lint_hardcodes и check_no_emoji → OK; в браузере на :5175 /payments: 1440 px три колонки в тёмной и светлой темах, 375 px одна колонка без горизонтального скролла (scrollWidth 375)
- [x] **FIX-P26** (FRONT) Действия шапки раздела заходили на вертикали паттерна на телефоне: переключатель месяца шире колонки текста слева от вертикалей (скриншот пользователя, сводка 412 px). Шапка стала сеткой: плитка — слой на строках текста, действий и места под горизонталями; действия стоят на плитке, только когда она шире 48rem (`@container`, `@3xl:`), иначе уходят строкой под плитку. Вертикали помечены `data-line="post"` для теста.
  ↳ done: FIX-P26 · red-green: новый `e2e/header.spec.ts` (7 разделов, desktop + mobile; ни h1, p, dl, кнопка или ссылка шапки не пересекает вертикаль) на :5175 до правки → mobile failed («/: заходят на линии», кнопка месяца), после → 2 passed; Playwright на свежем стенде e2e → 20 passed, стенд снят; `npm run build`, `tsc`, `oxlint` чисто; `npm run test` → 12 passed; скриншоты: 412 px сводка в обеих темах и регулярные, 1024 px сводка (действия под плиткой), 1600 px регулярные (кнопка на плитке)

---

## 8. Трассировка требований (обновлять при закрытии задач)

| Req | Задачи | Тест(ы) | Статус |
|---|---|---|---|
| AC-1 Запуск | B-03, B-12, D-01, D-04 | чистый клон → README → 4× healthy, smoke, 12 e2e (Q-05) | ✅ |
| AC-2 Доступ | B-05, F-03 | test_ac_02_auth_required.py (все операции из OpenAPI → 401), e2e auth.spec (редирект /login) | ✅ |
| AC-3 Роли | B-07, B-10, F-04 | test_ac_03_roles.py, test_users.py, e2e users.spec (нет админ-разделов у user) | ✅ |
| AC-4 Админ .env | B-05, B-10 | test_ac_04_env_admin.py, test_admin_sync.py | ✅ |
| AC-5 Регулярность | B-06, B-07 | test_schedule.py (31 кейс), test_ac_05_periods.py | ✅ |
| AC-6 Напоминание | B-11 | test_ac_06_reminder_once.py, test_reminder_pipeline.py | ✅ |
| AC-7 Сразу | B-07, B-11 | test_ac_07_immediate.py; вживую console ≈1 с | ✅ |
| AC-8 Оплачено — без напоминания | B-11 | test_ac_08_paid_no_reminder.py | ✅ |
| AC-9 Отметка/отмена | B-08, F-05 | test_ac_09_mark_unmark.py, e2e payments.spec | ✅ |
| AC-10 Исправление даты | B-08, F-05 | test_ac_10_fix_date.py, e2e payments.spec | ✅ |
| AC-11 Просрочка | B-06, B-08 | test_status.py, test_ac_11_overdue.py | ✅ |
| AC-12 Валюты | B-09, F-08 | test_ac_12_summary.py, test_summary.py | ✅ |
| AC-13 Сохранение | B-03 | down/up: все счётчики совпали (Q-05) | ✅ |
| AC-14 Удаление | B-07, B-11 | test_ac_14_delete.py, test_reminder_pipeline.py | ✅ |
| AC-15 Передача | B-04, B-13, D-01 | код, README, .env.example без секретов, seed, docs/openapi.yml + test_openapi_up_to_date.py | ✅ |
| FR-26 Swagger | B-01, B-13 | `GET /api/v1/docs` → 200 | ✅ |
| Бонусы B1–B10 | X-01…X-10 | B2–B10 ✅ (тесты + живые проверки: webhook-приёмник, письма в mailpit, лог просрочки); B1 — код и тесты есть, живой клик ждёт ESC-1 | 🟨 |

Легенда: ⬜ нет · 🟨 частично · ✅ зелёный (с доказательством в журнале).

---

## 9. Журнал выполнения (append-only)

Формат: `YYYY-MM-DD HH:MM · <AGENT> · <TASK-ID> · <результат> · <коммит> · <доказательство> · <заметки/ADR>`

- 2026-10-23 21:30 · HUMAN · — · План, SPEC, DECISIONS, CLAUDE.md подготовлены · — · — · старт работы агентов
- 2026-10-23 22:40 · SOLO · P0-1 · SPEC сверен, расхождений: 0 (таблицы API с.12–14 совпадают с FR-25 построчно) · P0 · `pdftotext -raw` · —
- 2026-10-23 22:40 · SOLO · P0-2 · git уже инициализирован, .gitignore/.gitattributes проверены · P0 · — · —
- 2026-10-23 22:40 · SOLO · P0-3 · Docker 29.9.2 (linux engine, 12 CPU, 8 ГБ), Compose v5.6.1, git 2.53, node 24.14, npm 11.9, python 3.11 (локально), uv — нет · P0 · `--version` · бэкенд только в контейнерах
- 2026-10-23 22:40 · SOLO · P0-4 · Плагины есть: karpathy-coder, engineering(-advanced)-skills, zero-hallucination-coder, docker-development, a11y-audit, pw, handoff-engineering, demo-video, ux-ui-agent-skills, example-skills. Нет: MCP motion в этой сессии; Playwright-браузер для гейтов XIAS не установлен (ставится в F-02) · P0 · — · —
- 2026-10-23 22:48 · SOLO · B-01 · FastAPI-скелет: config (pydantic-settings), Clock, единый формат ошибок, health, Swagger /api/v1/docs, export_openapi · B-01 · curl health → {"status":"ok"}, docs 200, 404 → {"error":{"code":"not_found",…}} · uv.lock сгенерирован в контейнере (uv локально нет)
- 2026-10-23 22:50 · SOLO · B-02 · Модели §1.1 (6 таблиц, 7 enum, CHECK paid_at↔status, UNIQUE(payment,seq)/(payment,due_date)/(occurrence,channel,kind), частичный UNIQUE логина среди не удалённых) + 0001_initial · B-02 · upgrade→check→downgrade→upgrade OK на postgres:16-alpine · логин уникален только среди активных — см. ADR-014
- 2026-10-23 22:52 · SOLO · B-03 · docker-compose.yml (db+backend+worker, healthchecks, volume pgdata, env_file .env необязателен — дефолты в Settings), entrypoint serve|worker|bootstrap (wait db → alembic → sync admin), .env.example без секретов, compose.dev.yml для разработки · B-03 · `docker compose ps` → 3× healthy · DATABASE_URL по умолчанию собирается из POSTGRES_* — нельзя рассинхронизировать пароль БД
- 2026-10-23 22:55 · SOLO · B-04 · Контракт-first: Pydantic-схемы (деньги — строка, единый ErrorResponse), роутеры всех эндпоинтов FR-25 (+ GET /recurring-payments/{id}, GET /users/{id} по FR-27) с 501, зависимости current_user/require_admin, docs/openapi.yml экспортирован
  ↳ frontend: диалог «Изменить платёж» (только изменённые поля, подсказка о том, к каким периодам применится сумма), журнал показывает «было → стало»; e2e recurring.spec дополнен шагом изменения суммы · B-04 · test_openapi_up_to_date 2 passed · FRONT: docs/openapi.yml готов для openapi-typescript
- 2026-10-23 23:08 · SOLO · F-01 · Vite 8 + React 19 + TS strict + Tailwind v4, React Router 8, TanStack Query, openapi-typescript → src/api/schema.d.ts, openapi-fetch (credentials: include, глобальный 401-листенер), Dockerfile node→nginx, nginx.conf (SPA fallback, proxy /api с Docker DNS, CSP), сервис web в compose · F-01 · curl через :8080 · ADR-015 (radix-ui вместо shadcn CLI, TS 5.9, oxlint)
- 2026-10-23 23:25 · SOLO · F-02 · Токены linear-app (light/dark), Inter cyrillic, motion.ts (fadeUp/stagger/spring 380/30/useReducedMotion), ThemeProvider, компоненты на radix-ui: Button, Input, Field, Select (listbox), Dialog/ConfirmDialog, Popover, DropdownMenu, Segmented (layoutId), Tooltip, Badge, Card, Skeleton, Table, Calendar (react-day-picker ru), Empty/ErrorState, Toaster; витрина /_ui (dev) · F-02 · гейты XIAS зелёные, скриншоты light/dark/360px просмотрены · ADR-016; хук XIAS ложно падает на кириллице (cp1252) — гейты гоняются вручную с PYTHONUTF8=1
- 2026-10-23 23:29 · SOLO · B-05 · Auth: argon2, серверные сессии (sha256 токена), cookie ik_session (httpOnly, SameSite=Lax) + Bearer, login/me/logout, rate-limit 5/мин на IP+логин (429), одинаковый 401 для неверного пароля и неизвестного логина, аудит auth.login.success/failed, auth.logout, sync админа из .env · B-05 · 18 passed
- 2026-10-23 23:29 · SOLO · M1 · **M1 достигнут**: `docker compose up -d --build` → db/backend/worker/web healthy; `/api/v1/docs` → 200 через :8080; логин admin (cookie+bearer) работает. Трассировка: 0/15 AC ✅, 3 🟨 (AC-2, AC-4, FR-26). Дальше: F-03/F-04 (логин, shell), затем B-06 домен · — · pytest 18 passed · —
- 2026-10-23 23:33 · SOLO · F-03 · Логин (rhf+zod, ошибки по ux-writing, 401/429/сеть), RequireAuth (нет сессии → /login?next=), RequireAdmin (UI-заглушка 403 с переходом к платежам), глобальный 401 → сброс кэша и /login, выход; редирект по роли (admin → Сводка, user → Платежи) · F-03 · e2e 6 passed · —
- 2026-10-23 23:33 · SOLO · F-04 · Shell: сайдбар (Сводка, Платежи, Регулярные [admin], Пользователи [admin]; Календарь/Журнал появятся с бонусами X-02/X-03), меню пользователя (роль, тема светлая/тёмная/системная, выход), мобильная шапка + выезжающее меню, skip-link · F-04 · e2e 6 passed · страницы разделов заполняются в F-05…F-08
- 2026-10-23 23:35 · SOLO · B-06 · Домен (TDD, тесты написаны первыми): schedule.due_date_for (anchor_day, без дрейфа, weekly/quarterly/yearly, високосный год), planned_occurrences (горизонт + минимум один будущий, EC-2), status.compute_status (просрочка со следующего дня, paid_late, due_soon/due_today), reminders.reminder_due (окно 3 дня, FR-19/21/22) · B-06 · 56 passed, cov 100% · —
- 2026-10-23 23:46 · SOLO · B-07 · Регулярные платежи: GET (все), GET/{id}, POST/DELETE (admin), ensure_for_payment (ON CONFLICT DO NOTHING), enqueue_due при создании (FR-19), soft delete: будущие неоплаченные периоды удаляются, открытые напоминания cancelled, повтор → 404 (EC-11), аудит created/deleted, диапазон даты ±10 лет · B-07 · 122 passed · ADR-017
- 2026-10-23 23:46 · SOLO · B-08 · Периоды: список (status, overdue в SQL, currency, payment, due_from/to, q, include_deleted, sort, limit/offset, total), GET/{id}, PATCH по правилам §1.5 (EC-4, EC-5, due_date неизменяем → 422), paid_by_label, reminder_sent_at, аудит paid/unpaid/paid_at_changed · B-08 · 122 passed · —
- 2026-10-23 23:56 · SOLO · F-05 · Экран «Платежи»: вкладки К оплате/Просрочено/Оплачено/Все со счётчиками, поиск (горячая клавиша /), валюта, срок (месяц), прекращённые, фильтры в URL, пагинация по 25; таблица (desktop) и карточки (mobile), бейдж статуса = иконка+текст+«на N дней»; поповер даты оплаты (по умолчанию сегодня, будущее заблокировано, подсказка «позже срока»), исправление даты, снятие отметки; оптимистичное обновление + тост с «Отменить»; loading/empty/filtered-empty/error; «сегодня» с сервера (GET /app-info, FR-27) · F-05 · e2e 8 passed · e2e-шаги под пользователем — в Q-02 после B-10
- 2026-10-24 00:01 · SOLO · F-06 · Экран «Регулярные платежи» (admin): Активные/Прекращённые со счётчиками, таблица/карточки, ближайший срок со статусом, ссылка в «Платежи» с фильтром; форма (rhf+zod): название, сумма с маской ru-RU, валюта (сегменты), дата (календарь), периодичность (listbox), комментарий, живая подсказка о напоминании (за 3 дня / сразу / срок прошёл); прекращение через ConfirmDialog (destructive, «история сохранится»); компонент Select переименован в Listbox (гейт lint_native_select) · F-06 · e2e 2 passed · —
- 2026-10-24 00:02 · SOLO · B-09 · Итоги по валютам: всегда RUB/USD/EUR, Decimal строкой, интервал (по умолчанию текущий месяц), as_of (оплачено/просрочено на дату — задел под X-04), include_deleted; агрегаты одним SQL с FILTER · B-09 · 6 passed · —
- 2026-10-24 00:06 · SOLO · F-08 · Сводка: переключатель месяца, ведущий блок «Осталось оплатить N платежей / из них просрочены» с суммами к оплате по валютам и прогрессом, три карточки RUB/USD/EUR (всего/оплачено/к оплате/просрочено, полоса), блоки «Просрочено» и «Ближайшие 7 дней» с быстрой отметкой оплаты; stagger-появление, AnimatedNumber (motion animate, prefers-reduced-motion) · F-08 · визуальная проверка · —
- 2026-10-24 00:06 · SOLO · F-09 · lib/format.ts: Intl.NumberFormat ru-RU currency, dd.MM.yyyy, relativeDue (сегодня/завтра/через N дней/N дней назад), Intl.PluralRules ru; lib/money-input.ts — маска суммы · F-09 · визуально на скриншотах · —
- 2026-10-24 00:08 · SOLO · B-10 · Users CRUD (admin only): список/по id/создание (всегда role=user)/изменение (логин, имя, пароль → revoke сессий)/мягкое удаление (revoke сессий); системный админ неизменяем (403); аудит user.created/updated/deleted · B-10 · 155 passed · —
- 2026-10-24 00:11 · SOLO · F-07 · Экран «Пользователи» (admin): таблица (имя, логин, роль, создан), системный админ с замком и без действий, диалог создания/изменения (rhf+zod, 409 → ошибка у поля логина, смена пароля с подсказкой о завершении сессий), удаление через ConfirmDialog. Баг: гонка редиректа после входа (user попадал на / вместо /payments) — пойман e2e, исправлен · F-07 · e2e 11 passed · —
- 2026-10-24 00:16 · SOLO · B-11 · Worker: APScheduler (tick каждые 60 с, опрос очереди каждые 5 с, max_instances=1), конвейер claim FOR UPDATE SKIP LOCKED → перепроверка (оплачен/прекращён/срок прошёл/канал не настроен → cancelled) → send → sent | failed + backoff 30 с·2^n (≤ 1 ч), ≤ REMINDER_MAX_ATTEMPTS; ConsoleNotifier (лог), TelegramNotifier (aiogram, HTML); бот /start и /chatid (long polling, работает и без chat id); graceful shutdown · B-11 · 173 passed · —
- 2026-10-24 00:21 · SOLO · B-12 · Seed (идемпотентный, при старте если SEED_DEMO_DATA=true и платежей нет; `python -m app.seed`): пользователи user/user12345 (Иван Петров), anna/anna12345; 6 платежей относительно «сегодня»: Аренда офиса 85 000 RUB (через 2 дня), Сервер Hetzner 49.90 USD (просрочен 10 дней), Подписка Figma 15 EUR (прошлый период оплачен с опозданием), Домен 1 990 RUB yearly, Google Workspace 36 USD (срок сегодня), Бухгалтерия 25 000 RUB; история оплат с именами. Фикс: счётчик постановки через RETURNING · B-12 · 174 passed · —
- 2026-10-24 00:22 · SOLO · B-13 · OpenAPI финал: описание API (авторизация через cookie/Bearer, роли, форматы дат/денег/ошибок), описания тегов на русском, servers, contact, описания всех операций, коды ошибок у каждой операции (единый ErrorResponse), примеры полей; api-design-reviewer прогнан · B-13 · линтер 90.7, 0 errors · ADR-018 (snake_case контракта, нерелевантные эвристики скоркарда)
- 2026-10-24 00:26 · SOLO · Q-01 · Приёмочные тесты: по файлу на AC-2…AC-12, AC-14 (Given/When/Then из SPEC), общий RecordingNotifier вместо Telegram; AC-2 перебирает все операции из OpenAPI. Тест AC-5 сначала упал из-за ошибки в самом тесте (дата оплаты в будущем → 422 — верное поведение сервера) · Q-01 · 208 passed · —
- 2026-10-24 00:29 · SOLO · Q-02 · E2E демо-сценария со с.15 (e2e/demo.spec.ts), самодостаточный: user создаётся через API, если его нет; факт напоминания проверяется по reminder_sent_at · Q-02 · 12 passed · реальный Telegram — Q-03 (ESC-1)
- 2026-10-24 00:34 · SOLO · Q-04 · Адверсариальное ревью (3 персоны) прав/сессий/напоминаний. High: подмена X-Forwarded-For обходила rate-limit входа и подделывала IP аудита → nginx перезаписывает заголовок. Medium: таймаут отправки Telegram 15 с. Low: FOR UPDATE при удалении, предупреждение о дефолтных секретах в production. Открытых critical/high нет · Q-04 · smoke OK, 209 passed · —
- 2026-10-24 00:40 · SOLO · Q-05 · AC-13 и AC-1 подтверждены; README написан (быстрый старт PowerShell/bash, Telegram, роли, правила, API, env, тесты, ограничения) · Q-05 · 12 e2e + smoke на чистом клоне · холодная сборка у жюри — ориентир 2–4 мин
- 2026-10-24 00:42 · SOLO · ship-gate · CRITICAL 0; HIGH 1 (нет error boundary маршрутов) → исправлено RouteErrorPage; secrets/debug/CORS/console.log/TODO чисто; npm audit 0, pip-audit 0 · — · tsc/oxlint/build OK · бэкапы/rollback/мониторинг — вне рамок
- 2026-10-24 00:42 · SOLO · M2 · **M2 достигнут**: §8 — AC-1…AC-15 и FR-26 ✅ (16/16). Доказательства: `docker compose run --rm backend pytest -q` → 209 passed (покрытие 95%, домен 100%), Playwright 12 passed на стеке из чистого клона, smoke OK, adversarial-review (High XFF исправлен), ship-gate CLEAR. Открыто: Q-03 [!] (ESC-1, живой Telegram). Дальше: бонусы X-01…X-10 по порядку · — · — · —
- 2026-10-24 00:45 · SOLO · X-01 · Кнопка «Оплачено» в Telegram: подписанный callback, проверка чата, идемпотентность, редактирование сообщения, аудит · — · 216 passed; воркер стартует без токена · [!] живой клик ждёт ESC-1
- 2026-10-24 00:48 · SOLO · X-02 · Журнал аудита: GET /api/v1/audit-log (admin; category auth/payments/occurrences/users, action, q по автору/IP, даты, limit/offset, entity_label — «Аренда офиса, срок 26.10.2026»), экран «Журнал» в сайдбаре админа: категории, поиск, человекочитаемые описания (вход, неудачный вход, платёж добавлен/прекращён, оплата в т.ч. кнопкой Telegram, отмена, исправление даты, пользователи) · X-02 · 4 api + 1 e2e · —
- 2026-10-24 00:51 · SOLO · X-03 · Календарь оплат (/calendar, все роли): месячная сетка с понедельника, у дня до 3 платежей с точкой статуса (оплаченные зачёркнуты), на телефоне — только точки, легенда; клик по дню → список периодов с действиями (отметить/исправить/снять); сегодня выделено; анимированная смена месяца (AnimatePresence, reduced-motion → только opacity); aria-label дня «24 октября: 3 платежа, оплачено 1». Данные — существующий GET /payment-occurrences?due_from&due_to (отдельный /calendar не понадобился) · X-03 · e2e 2 passed · —
- 2026-10-24 00:53 · SOLO · X-04 · Итоги на дату: в сводку добавлены аддитивные поля due/count_due («должно быть оплачено к as_of»); на сводке карточка «Итоги на дату» — таблица RUB/USD/EUR (должно быть оплачено / оплачено / просрочено, количества) с 1 января по выбранную дату, выбор даты календарём · X-04 · 7 passed + e2e · —
- 2026-10-24 01:01 · SOLO · X-05 · UX/UI-полировка по гейтам: календарь — корректная ARIA (group + aria-pressed вместо неполной grid), контраст дней соседних месяцев; шапка — сплошной фон (фокус «Открыть меню» 2.54:1 → OK); различимые нейтральные (sunken #e8eaed, контраст ≥ 4.86:1); тактильный отклик кнопок (scale 0.98, отключается при reduced motion); ранее: скелетоны, тосты с «Отменить», «/» для поиска, stagger, AnimatedNumber · X-05 · гейты зелёные · —
- 2026-10-24 01:15 · SOLO · X-06 · Webhook: WEBHOOK_URL (+ WEBHOOK_SECRET) → POST JSON с X-Signature: sha256=HMAC(body), отдельный канал в том же конвейере (UNIQUE, ретраи, backoff). Баг найден живой проверкой: воркер без нотифаера канала отменял чужие напоминания → теперь забирает только свои каналы (red-green тест) · X-06 · 228 passed + живой приём · —
- 2026-10-24 01:17 · SOLO · X-07 · Email: SMTP_* + EMAIL_TO (несколько через запятую), отдельный канал в конвейере (smtplib в потоке, STARTTLS+логин при SMTP_USER); mailpit в profiles [extras] (UI :8025); .env.example с подсказкой для демо · X-07 · 231 passed + живые письма · —
- 2026-10-24 02:21 · SOLO · X-08 · Чек к оплате: receipt_url в PATCH (только http/https), POST/GET/DELETE /payment-occurrences/{id}/receipt (PDF/PNG/JPG ≤ 5 МБ, тип по сигнатуре, имя файла в томе — uuid, inline + nosniff, аудит receipt_uploaded/deleted/link_changed), том uploads в compose; UI — кнопка «Чек» у периода (подсвечена, если прикреплён): ссылка, загрузка/замена/удаление файла · X-08 · 246 passed + e2e · у жюри том создаётся с владельцем app из образа
- 2026-10-24 02:29 · SOLO · X-09 · Бюджет: таблица budgets (год + месяц|NULL=год + валюта, уникальный индекс с coalesce), GET /budgets/overview (бюджет vs сумма периодов со сроком в месяце/году vs оплачено, по RUB/USD/EUR), PUT /budgets (admin, upsert/удаление, аудит); на сводке карточка «Бюджет» с прогрессом и превышением, диалог правки для админа · X-09 · pytest + e2e · —
- 2026-10-24 02:37 · SOLO · X-10 · Напоминание о просрочке (kind=overdue): раз в день до оплаты, ≤ OVERDUE_REMINDER_MAX (3, 0 — выкл.), во всех каналах (Telegram с кнопкой «Оплачено», лог, webhook event payment.overdue, email); уникальный ключ расширен remind_on (миграция 0004 с бэкфиллом) · X-10 · 261 passed + живой лог · ADR-019
- 2026-10-24 02:37 · SOLO · M3 · **M3 достигнут (с оговоркой)**: бонусы X-02…X-10 готовы и проверены, X-01 — код и тесты, живой клик ждёт ESC-1. M2 не сломан: `pytest` → 261 passed, Playwright → 18 passed, smoke OK, AC-1…AC-15 по-прежнему ✅. Дальше: D-01…D-06 (README бонусов, DEMO.md, финальные ревью, чистый прогон) · — · — · —
- 2026-10-24 02:38 · SOLO · D-01 · README: быстрый старт за 4 команды для PowerShell и bash, логины, демо-данные, подключение Telegram (+ кнопка «Оплачено»), разделы UI (Сводка, Платежи, Календарь, Регулярные, Пользователи, Журнал), таблица бонусов с путями в UI, правила (периоды, просрочка, напоминания, удаление), API (+ бонусные эндпоинты), архитектура, переменные окружения, тесты, ограничения · D-01 · — · —
- 2026-10-24 02:38 · SOLO · D-02 · docs/DEMO.md: подготовка, показ по минутам (шаги 1–7 слайда 15 + бонусы + надёжность), что говорить, CLOCK_OVERRIDE для «следующего периода», запасной план (Telegram недоступен → лог воркера, reminder_sent_at, порт, сброс данных) · D-02 · — · —
- 2026-10-24 02:42 · SOLO · D-03 · Финальные проверки: секреты, зависимости, ship-gate, адверсариальный проход по бонусам. High: лавина overdue-напоминаний для платежей задним числом → окно OVERDUE_REMINDER_WINDOW_DAYS=30 · D-03 · 262 passed · ADR-019 дополнен
- 2026-10-24 02:47 · SOLO · D-04 · Чистый прогон по README и полный демо-сценарий (e2e) на свежем клоне; время запуска записано · D-04 · smoke + 18 e2e + 262 pytest · `-p` только для изоляции тома от рабочей копии
- 2026-10-24 02:47 · SOLO · M4 · **M4 (freeze) достигнут с одной оговоркой**: README прогнан с нуля на чистом клоне (D-04), демо-сценарий отрепетирован e2e, ship-gate CLEAR, D-03 закрыт. Оговорка — живой Telegram (ESC-1) · — · — · —
- 2026-10-24 02:47 · SOLO · D-06 · **Итоговый отчёт.** Сделано: все обязательные требования (AC-1…AC-15, FR-1…FR-28) с доказательствами — 262 backend-теста (домен 100%, приёмка по файлу на AC), 18 Playwright-сценариев, smoke, чистый клон; бонусы B2–B10 готовы и проверены вживую где возможно (webhook-приёмник, письма в mailpit, лог просрочки); B1 (кнопка «Оплачено») — код и тесты без сети. Не сделано: живая проверка Telegram и кнопки (нет токена — ESC-1); ролик D-05 (опционально). Ограничения: один Telegram-чат; доставка at-least-once (максимум один дубль при падении между отправкой и фиксацией); лимит входа в памяти процесса; гейты XIAS keyboard/target-size/responsive не запускались (нужен Google Chrome) — адаптив проверен своим скриптом 320–1280px. Найдено и исправлено ревью: подмена X-Forwarded-For (High), лавина overdue-напоминаний (High), гонка редиректа по роли, отмена чужих каналов воркером, a11y календаря · v1.0.0 · — · —
- 2026-10-24 08:50 · SOLO · DEPLOY · Деплой на VPS aeza: оверлей `deploy/compose.https.yml` + `deploy/Caddyfile` (Let's Encrypt для DOMAIN, /api напрямую в backend с реальным X-Forwarded-For, web без публичного порта); базовый compose и запуск по README не тронуты · — · `compose config` (web ports: None, caddy 80/443) + `caddy validate` → Valid configuration · не баг-фикс, но вне кода приложения — freeze M4 не нарушает
- 2026-10-24 09:05 · SOLO · FIX-UI · Мобильная Сводка: в строках «Просрочено»/«Ближайшие 7 дней» бейдж статуса наезжал на «Отметить оплату», название обрезалось до «Google …». Бейдж и действия вынесены в отдельный ряд на всю ширину с flex-wrap (как в Календаре) · — · браузер 360px, шрифт 100% и 140%: пересечений 0, выхода за край 0, ширина названия ≥167px; `docker compose up --build` (сборка web) ок
- 2026-10-24 12:00 · SOLO · P-01 · Фаза 5 (ADR-020). E2E вынесены на стенд compose.e2e.yml (:8081, свои тома, без Telegram/SMTP/webhook) — демо-база на :8080 больше не засоряется «E2E Хостинг …»; reset_demo возвращает демо-набор за секунды · P-01 · test_reset_demo 2 passed · ADR-020
- 2026-10-24 12:40 · SOLO · P-02, P-03 · GET-списки больше не масштабируются по числу платежей: материализация — один SELECT с GROUP BY и один INSERT при нехватке, без COMMIT в установившемся режиме; ближайшие периоды списка — DISTINCT ON · P-02 · test_query_budget red→green, 272 passed · ADR-021
- 2026-10-24 13:20 · SOLO · P-05 · Бизнес-логика отметки оплаты и чеков вынесена из роутера в сервисы; баг: сбой транзакции при замене/удалении чека стирал прежний файл (запись ссылалась на несуществующий) и оставлял сироту — теперь файл удаляется только после COMMIT · P-05 · red→green, 281 passed · —
- 2026-10-24 13:25 · SOLO · P-06 · Доставка напоминаний не блокирует event loop воркера (там же long polling бота): запросы к БД через asyncio.to_thread · P-06 · red→green · —
- 2026-10-24 14:10 · SOLO · P-04, P-07, P-12 · Редактирование платежа в UI через меню действий; vitest с первыми 11 тестами; правило «скоро срок» на клиенте берёт порог из настроек · P-07 · npm run test 11 passed, tsc чисто · ADR-022
- 2026-10-24 15:30 · SOLO · P-08…P-11 · Сводка без расхождений и дублей, страница «Отчёты», календарь с суммами и значками статусов, плотный мобильный список · P-08 · Playwright на стенде e2e → 18 passed; pytest 281 passed; vitest 12 passed; smoke OK; build и oxlint чисто · —
- 2026-10-24 15:35 · SOLO · Фаза 5 · **Итог**: P-01…P-12 закрыты. Контракт FR-25 не изменён (добавлен PATCH /recurring-payments/{id}). Демо-база на :8080 не трогалась; вернуть её к демо-набору — app.scripts.reset_demo · — · — · ADR-020…022
- 2026-10-24 16:10 · SOLO · FIX-UI-2 · Переключатель месяца (Календарь, Сводка, Отчёты): «Сегодня» появлялась справа от стрелок и сдвигала их, клик по стрелке попадал мимо. Кнопка перенесена влево и занимает место всегда (в текущем месяце невидима и вне Tab); календарь использует общий MonthSwitcher · — · браузер: x стрелок 354/538 одинаковы в текущем месяце и после двух переходов; tsc и oxlint чисто · —
- 2026-10-24 16:30 · SOLO · FIX-UI-3 · Таблицы («Регулярные», «Платежи»): во время появления строк (fadeUp, y: 6) справа мелькала вертикальная полоса прокрутки и колонки сдвигались. Причина: overflow-x:auto у обёртки делает overflow-y:auto. Обёртка Table — overflow-y-hidden · — · браузер: до — переполнение 6px и overflowY=auto, после — ширина полосы 0 на всех кадрах анимации, overflowY=hidden · —
- 2026-10-24 13:22 · SOLO · FIX-TG · Бот на VPS молчал: DNS сервера отдаёт для api.telegram.org 149.154.166.110, до него нет TCP (curl -4 → timeout), в контейнере urllib → Network is unreachable; 149.154.167.220 из контейнера — TLS ok. В `deploy/compose.https.yml` воркеру добавлен extra_hosts api.telegram.org → ${TELEGRAM_API_IP:-149.154.167.220}; локальный запуск по README не тронут · — · `compose config` → extra_hosts api.telegram.org=149.154.167.220; живая проверка на сервере — за человеком · попутно: падение задачи polling не логируется (runner.py)

- 2026-10-24 17:20 · SOLO · P-13 · Бот стал упрощённой панелью: сводка, ближайшие сроки, просрочки, карточка периода с «Оплачено»/«Отменить оплату», итоги месяца, платежи, переходы на сайт. Итоги по валютам вынесены из роутера в services/summary.py (общие для REST и бота, OpenAPI не изменился). Доступ к меню — командный чат и личка его участников (get_chat_member, кеш 5 мин). Новая настройка PUBLIC_URL · P-13 · 306 passed · ADR-023
- 2026-10-24 17:50 · SOLO · P-14 · Интерфейс переведён в айдентику Aéza: токены (структура прежняя, меняются только значения и пара новых: text-on-destructive, brand-*), Exo 2 + Inter, логотип из клавиш «i k», активный раздел — чёрная клавиша с голубой иконкой, переключатели — «нажатая клавиша», экран входа — чёрная панель с фирменным паттерном. Белый на #4CC6F1 = 1.97:1, поэтому кнопка — чёрный текст, ссылки и фокус — #0B6F94 · P-14 · e2e 18 passed, vitest 12 passed, build чисто · ADR-024
- 2026-10-24 14:53 · SOLO · P-15 · Логотип «Клавиша IK» вместо клавиш «i k»: одна клавиша Aéza с I и голубой галочкой-K, название строчными Exo 2 Bold как в подписи из `brand/`; цвета только через токены, в тёмной теме клавиша светлая. Иконки сайта и манифест в `frontend/public`, комплект (варианты, подписи, аватарка бота 640/512, презентация, правила) в `brand/` · P-15 · e2e 18 passed, vitest 12 passed, build чисто · ADR-025
- 2026-10-24 15:30 · SOLO · P-16 · Просрочка перенесена из карточки на сводке в боковую панель подстрокой под «Платежами», чтобы её было видно на любой странице; блок нельзя свернуть. Раскрытие и сдвиг пунктов ниже только через transform/opacity (LayoutGroup + layout="position", ADR-013). Новые просрочки ловятся опросом раз в минуту (срок истекает в полночь) и подсвечиваются; первая загрузка без подсветки. Контент шире (96rem), сайдбар 17.5rem · P-16 · e2e 18 passed, vitest 12 passed, build чисто
- 2026-10-24 16:10 · SOLO · P-17 · По отзыву: просрочка не должна быть открыта сразу — теперь она выезжает из-под «Платежей» через 2 с после входа (раскрытие запоминается до перезагрузки в переменной модуля, чтобы мобильное меню не ждало снова), новые просрочки по-прежнему въезжают сбоку с подсветкой. Добавлен вход страницы при смене раздела (ключ по pathname). «E2E Хостинг» на скриншоте пользователя — данные изолированного стенда :8081, основная БД чистая · P-17 · e2e 18 passed, vitest 12 passed, build чисто
- 2026-10-24 16:40 · SOLO · P-18 · По отзыву: паттерн на входе обрывался (SVG-полоса со `slice` срезала верх, линии начинались в воздухе), форма была прижата к левому краю широкой колонки. Паттерн пересобран из рамок, привязанных к краям, концы всегда за краем; добавлен в основание сайдбара и в угол карточки сводки (не на телефоне), новый токен `brand-pattern-line`; форма входа по центру колонки · P-18 · e2e 18 passed, vitest 12 passed, build чисто · ADR-026
- 2026-10-24 17:10 · SOLO · P-19 · Гайдбук Aéza добавлен в `docs/` (ссылка в CLAUDE.md). Сверка показала, что паттерн P-18 расходится со стр. 22: там вертикали прямые на всю высоту и поворачивает одна акцентная линия. Панель входа пересобрана по образцу, текст сдвинут правее линий; в сайдбаре оставлены три горизонтали и одна линия с поворотом; угол на карточке сводки убран, такой композиции в гайдбуке нет · P-19 · e2e не подтверждён (общий стенд, см. P-19), vitest 12 passed, build чисто · ADR-026
- 2026-10-24 16:22 · SOLO · P-20 · Живые иконки: у kyssltd.ru иконка в кнопке подпрыгивает по hover (keyframe на пружине linear()). Взят тот же приём, но жест подбирается по смыслу иконки через её класс `lucide-*`, без правок в местах использования; хозяин жеста — класс `icon-play` в базовых компонентах. Запуск через data-атрибут из одного обработчика на документ, чтобы жест срабатывал и на тап, и на повторный клик, а не только на hover. Токены `--ease-spring`, `--duration-play`, `--icon-travel`. Первые прогоны e2e падали из-за общего стенда с параллельной сессией; на своём свежем стенде 18/18 · P-20 · e2e 18 passed, vitest 12 passed, build чисто
- 2026-10-24 16:37 · SOLO · P-21 · По отзыву на P-20: одноразовый жест выглядел оборванным, если нажать сразу после наведения (жест от наведения не доигрывал, нажатие запускало его заново). Жест стал удерживаемой позой на CSS transition: переход прерывается из любой точки и возвращается пружиной, JS-триггер больше не нужен. Логотип `select-none`. Звук клавиши синтезирован, а не взят файлом: нет лицензий и лишних запросов, AudioContext создаётся при первом нажатии (политика автозапуска браузеров) · P-21 · e2e 18 passed, vitest 12 passed, build чисто
- 2026-10-24 17:22 · SOLO · FIX-TG-2 · TELEGRAM_CHAT_ID — список чатов: напоминания в каждый чат, «Оплачено» из любого, меню в личке для участников любой группы из списка, личные id из списка — без проверки членства; частичный сбой доставки не вызывает ретрай (без дублей), пишется предупреждением · FIX-TG-2 · red: 19 failed → green: 40 passed (config, notifiers, bot, pay button); полный `pytest -q` → 317 passed · ADR-027
- 2026-10-24 17:22 · SOLO · P-22 · По отзыву на P-21: в навигации поза была у иконки, а плитка стояла на месте и при нажатии не реагировала. Поза перенесена на плитку целиком, нажатие продавливает её, как клавишу. E2E и сборка :8080 прошли на рабочей копии, где параллельная сессия держала незакоммиченные правки фронтенда (отчёты, журнал) · P-22 · e2e 18 passed, vitest 12 passed, build чисто
- 2026-10-24 17:45 · SOLO · P-23 · По отзыву «журнал и отчёты выглядят чужеродно»: журнал был сырой админ-таблицей (каждая строка повторяла плашку и фразу с тем же смыслом, моноширинный IP), отчёты стеной текста «…, бюджет не задан» и голой таблицей. Оба экрана переведены на приёмы сводки и навигации, без новых токенов и компонентов библиотеки. Первый прогон e2e 17/18: asof.spec искал старую таблицу, обновлён · P-23 · e2e 18 passed, vitest 12 passed, build чисто
- 2026-10-24 18:05 · SOLO · P-24 · По скриншоту пользователя: строки журнала были по 64 px с временем у дальнего края, а записи бюджета показывались кодом `budget.set`. Строка на широком экране стала однострочной записью лога, автор перенесён к времени, чтобы глаз не прыгал через пустую середину; подписаны все действия, которые пишет бэкенд · P-24 · e2e 18 passed, vitest 12 passed, build чисто
- 2026-10-24 18:20 · SOLO · P-25 · По отзыву на P-22: поворот и уменьшение плитки не читались как клавиша. Наведение показывает клавишу под углом (наклон перспективой + поднятый колпачок над боковиной), нажатие опускает колпачок до упора с тенью прогиба. Боковина сделана отдельным слоем с opacity, а не анимацией box-shadow, чтобы остаться в рамках ADR-013. Гейт lint_hardcodes на Windows падал на чтении cp1251 — запускается с PYTHONUTF8=1 · P-25 · e2e 18 passed, vitest 12 passed, build чисто
- 2026-10-24 18:50 · SOLO · P-26 · По отзыву «полоски в углу грустные, единственный такой элемент»: на стр. 22 паттерн всегда на плитке, у полосы её не было. Прототип с вариантами, выбраны шапка-плитка и плитка месяца; в светлой теме чёрные плитки выглядели чужеродно, сделаны светлыми. В плитке месяца только количества, без сумм: валюты не складываются. Первый прогон e2e 0/18 (ERR_EMPTY_RESPONSE на :8081): стенд уже был поднят параллельной сессией, повторный на свежем стенде 18/18 · P-26 · e2e 18 passed, vitest 12 passed, build чисто
- 2026-10-24 19:00 · SOLO · P-27 · По просьбе: эффект клавиши из P-25 у знака IK, но только при нажатии. Обработчики звука перенесены с SVG на основание, чтобы :active держал всю клавишу вместе с боковиной. E2E на общем стенде :8081 мешали друг другу с параллельной сессией (стенд снимался посреди прогона, ERR_CONNECTION_REFUSED), поэтому прогон на своём проекте compose и порту 8091: первый 17/18 (причина падения потеряна — папку test-results перезаписал чужой прогон), повторный с отдельной папкой результатов 18/18 · P-27 · e2e 18 passed, vitest 12 passed, build чисто
- 2026-10-24 19:30 · SOLO · P-28 · По фото клавиатуры пользователя: клавиша из P-25 была плиткой над плоской подложкой и не читалась как кейкап. У кейкапа под углом площадка меньше основания, боковины сужаются кверху, передняя стенка самая заметная, поэтому силуэт нарисован SVG, а не составлен из прямоугольников (у clip-path нет скруглений). Юбка выходит за плитку 28 px (до 36 px), ряд навигации 40 px её вмещает · P-28 · e2e 18 passed, vitest 12 passed, build чисто
- 2026-10-24 20:10 · SOLO · P-29 · По отзыву: кнопки с иконками должны быть кейкапами, а плитка навигации выходила за строку. Юбка из SVG годится только для фиксированного квадрата; для кнопок любой ширины стенки нарисованы рамкой элемента с постоянной шириной (без сдвига раскладки), цвет рамки в покое прозрачный. Наклон ослаблен: на широкой кнопке сильная перспектива скашивала буквы · P-29 · e2e 19/20 (падение в чужом незакоммиченном тесте шапки, от кейкапа не зависит), vitest 12 passed, build чисто
- 2026-10-24 20:30 · SOLO · FIX-P26 · По скриншоту пользователя: на телефоне дата в переключателе месяца шапки ложилась на вертикали паттерна. Колонка текста на узкой плитке около 280 px, переключатель шире; действия на узкой плитке вынесены под неё сеткой и container query, без второго рендера и без слежения за размером в JS. Номер FIX, потому что P-27…P-29 заняла параллельная сессия · FIX-P26 · e2e 20 passed, vitest 12 passed, build чисто
- 2026-10-24 20:40 · SOLO · P-30 · По скриншоту: «Добавить платёж» осталась плоской, потому что у неё не было иконки, а кейкап по P-29 только у кнопок с иконкой. Добавлена иконка по образцу «Добавить пользователя»; доступное имя кнопки не изменилось (иконка aria-hidden), селекторы e2e прежние · P-30 · e2e 20 passed, vitest 12 passed, build чисто
- 2026-10-24 20:55 · SOLO · P-31 · По просьбе: кейкап у всех кнопок, а не только с иконкой. Условие по иконке снято целиком: плитка навигации и ссылка просрочки и так с иконкой, а у кнопок фиксированной высоты рамка стенок не меняет раскладку по вертикали (ширина текстовых кнопок выросла на 2-4 px, шапки разделов проверены header.spec) · P-31 · e2e 20 passed, vitest 12 passed, build чисто
- 2026-10-25 · SOLO · D-07 · Сверка README с кодом. Исправлено: «один Telegram-чат» в ограничениях (после FIX-TG-2 чатов несколько), просрочки на сводке (с P-16 они в боковой панели), 281 → 317 тестов, 18 → 20 прогонов e2e (14 сценариев), бот на схеме архитектуры, `/health` в таблице API, в таблицу переменных добавлены APP_ENV, DOMAIN, TELEGRAM_API_IP, GENERATION_HORIZON_DAYS, DATABASE_URL, MAILPIT_PORT. Фраза «проверено axe на всех экранах» заменена честной: axe прогонялся до редизайна Aéza, после него не повторялся. pytest не перезапускался (Docker не был запущен) · D-07 · playwright --list 20 tests
- 2026-10-25 · SOLO · P-32 · По скриншоту пользователя: «сделай платежи карточками». Таблица и мобильный список заменены одной сеткой карточек, поэтому разметка больше не дублируется под два экрана. Что ведёт: сумма (Exo 2, 2xl) и плитка срока, окрашенная по срочности; статус по-прежнему иконка плюс текст. Цветной полосы сбоку нет (доктрина), просрочка — рамка целиком · P-32 · e2e 20 passed, vitest 12 passed, build чисто

## 10. Эскалации и блокеры

Формат:
```
### ESC-N: <заголовок>  (задача <ID>, статус: open|resolved)
Вопрос: …  Варианты: A) … B) …  Рекомендация: …  Что блокируется: …
```
### ESC-1: Токен Telegram-бота и chat id для живой проверки  (задача Q-03, статус: open)
Вопрос: нужен `TELEGRAM_BOT_TOKEN` (BotFather → /newbot) и id чата, куда бот добавлен (`/chatid` в чате после запуска).
Варианты: A) человек кладёт оба значения в `.env` (не коммитится) и делает `docker compose up -d`; агент проверяет AC-6/AC-7 вживую
и снимает скриншот. B) сдаём без живой проверки: конвейер покрыт тестами с фейковым нотифаером, console-канал проверен вживую.
Рекомендация: A — 5 минут работы человека, а живое сообщение в Telegram — пункт 3 демо-сценария (с.15).
Что блокируется: только Q-03 и X-01 (кнопка «Оплачено»); остальное продолжается.

## 11. `.env.example` (эталон — создать в B-03)

```dotenv
# --- App ---
APP_ENV=development              # development | production
APP_TIMEZONE=Europe/Moscow       # единый часовой пояс (FR-3)
SECRET_KEY=change-me-to-random-64-chars
WEB_PORT=8080
COOKIE_SECURE=false
SESSION_TTL_HOURS=168
SEED_DEMO_DATA=true
# CLOCK_OVERRIDE=2026-11-24      # только не-production: «сегодня» для демо/тестов

# --- Admin (FR-12) ---
ADMIN_LOGIN=admin
ADMIN_PASSWORD=admin12345

# --- Database ---
POSTGRES_DB=invoice_keeper
POSTGRES_USER=invoice_keeper
POSTGRES_PASSWORD=invoice_keeper
DATABASE_URL=postgresql+psycopg://invoice_keeper:invoice_keeper@db:5432/invoice_keeper

# --- Reminders ---
REMINDER_DAYS_BEFORE=3
REMINDER_CHECK_INTERVAL_SECONDS=60
PENDING_POLL_SECONDS=5
GENERATION_HORIZON_DAYS=35
REMINDER_MAX_ATTEMPTS=5

# --- Telegram (пусто = напоминания пишутся в лог воркера) ---
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# --- Бонусы (необязательно) ---
WEBHOOK_URL=
WEBHOOK_SECRET=
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=invoice-keeper@example.com
EMAIL_TO=
```
