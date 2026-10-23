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
- [ ] **B-02** (BACK) Модели §1.1 + Alembic-миграция `0001_initial`. Enum-ы, CHECK, UNIQUE как в схеме.
  DoD: `alembic upgrade head` на чистой БД, `alembic downgrade base` без ошибок.
- [ ] **B-03** (BACK) `docker-compose.yml`: `db` (postgres:16-alpine, healthcheck, volume `pgdata`), `backend` (entrypoint: wait db → `alembic upgrade head` → sync admin → seed если `SEED_DEMO_DATA=true` и БД пуста → uvicorn), `worker`, `web`; `mailpit` в `profiles: [extras]`. `.env.example` (см. §11).
  DoD: `docker compose up -d --build` → все сервисы `healthy`.
- [ ] **B-04** (BACK) **Контракт-first:** Pydantic-схемы и пустые роутеры ВСЕХ эндпоинтов FR-25 (возвращают `501`), `app/scripts/export_openapi.py` → `docs/openapi.yml`. Тест `test_openapi_up_to_date` падает, если файл устарел.
  DoD: `docs/openapi.yml` закоммичен; FRONT может генерировать типы. **Сообщить FRONT в журнале.**
- [ ] **F-01** (FRONT) `frontend/`: Vite + React 19 + TS strict + Tailwind v4 + shadcn/ui init, роутинг, TanStack Query, `openapi-typescript` → `src/api/schema.d.ts`, `openapi-fetch` клиент с `credentials: "include"`. Dockerfile (node build → nginx), `nginx.conf` (SPA fallback + proxy `/api` → `backend:8000`).
  DoD: `npm run build` без ошибок; `http://localhost:8080` открывает заглушку через compose.
- [ ] **F-02** (FRONT) Визуальная система: `design-doctrine` + `apply-aesthetic` → токены (CSS variables), светлая/тёмная тема, типографика (Inter/Manrope с кириллицей), `src/lib/motion.ts` (пресеты: `fadeUp`, `stagger`, `spring {stiffness: 380, damping: 30}`; `useReducedMotion`). Записать выбранное направление в `DECISIONS.md`.
  DoD: страница-витрина `/_ui` (только dev) со всеми базовыми компонентами в 8 состояниях; `gate` зелёный по контрасту.

## 5. Фаза 2 — Обязательная функциональность (→ M2)

### Backend
- [ ] **B-05** Auth: argon2, sessions, cookie+bearer, `login/me/logout`, `current_user`, `require_admin`, sync админа из `.env`, rate-limit логина, аудит `auth.login.success/failed`, `auth.logout`.
  Тесты: AC-2, AC-4 (часть), неверный пароль → 401, logout → старый токен 401.
- [ ] **B-06** Домен `schedule.py`/`status.py` + **unit-тесты сначала** (`tdd-guide`): 31.01→28.02/29.02→31.03, 30.11→30.12…, weekly/quarterly/yearly, високосный год, просрочка на границе (due_date, due_date+1), paid_late, оплата в день срока.
  DoD: ≥ 25 параметризованных кейсов зелёные.
- [ ] **B-07** Recurring payments: `GET` (все авторизованные), `POST`/`DELETE` (admin, soft delete), при создании — `ensure_occurrences` + постановка `pending`-напоминания, аудит.
  Тесты: AC-3 (user → 403), AC-14 (после DELETE нет новых периодов и напоминаний, история видна).
- [ ] **B-08** Occurrences: список с фильтрами/сортировкой/пагинацией, `GET by id`, `PATCH` по правилам §1.5, вычисляемые поля, `paid_by_label`, аудит.
  Тесты: AC-9, AC-10, AC-11, EC-4, EC-5; пользователь может PATCH (не 403).
- [ ] **B-09** Summary по валютам (всегда 3 валюты, Decimal-суммы, фильтр периода, `as_of`).
  Тест: AC-12 на сид-данных.
- [ ] **B-10** Users CRUD (admin only), запрет на системного админа, soft delete + revoke сессий.
  Тесты: AC-3, AC-4, EC-8, EC-12, уникальность логина → 409.
- [ ] **B-11** Worker: `python -m app.worker` — APScheduler (tick + быстрый pending-poll), notifiers (`telegram` через aiogram, `console`), конвейер §1.3, ретраи с backoff, graceful shutdown. Бот: `/start`, `/chatid`.
  Тесты (без сети, notifier-фейк): AC-6 (два тика → одна отправка), AC-7, AC-8, AC-14, EC-6 (ошибка → failed → ретрай → sent, без дублей).
- [ ] **B-12** Seed (`app/seed.py`, идемпотентный; запускается при старте если `SEED_DEMO_DATA=true` и нет платежей): пользователь `user`/`user12345`;
  платежи относительно «сегодня»: «Аренда офиса» 85 000 RUB (срок через 2 дня → напоминание при старте), «Сервер Hetzner» 49.90 USD (срок 10 дней назад, не оплачен → просрочка),
  «Подписка Figma» 15.00 EUR (оплачена в прошлом периоде с опозданием, текущий — в будущем), «Домен invoice-keeper.ru» 1 990 RUB yearly; история за 2–3 прошлых периода с оплатами.
  DoD: после `docker compose up` в панели видны все статусы: оплачено, оплачено с опозданием, скоро, просрочено.
- [ ] **B-13** OpenAPI финал: описания, примеры, теги на русском, security schemes (cookie + bearer), коды ошибок у каждой операции; `docs/openapi.yml` обновлён; `api-design-reviewer` прогнан, замечания закрыты.

### Frontend
- [ ] **F-03** Логин: форма (rhf+zod), ошибки по `ux-writing`, редирект по роли; guard маршрутов (нет сессии → `/login`), обработка 401 глобально (сброс кэша → `/login`), выход.
- [ ] **F-04** Shell: сайдбар (Сводка, Платежи, Регулярные [admin], Пользователи [admin], Календарь, Журнал [admin]), шапка с пользователем и ролью, переключатель темы, мобильное меню.
- [ ] **F-05** **Платежи (главный экран, FR-24):** таблица периодов — название, сумма, валюта, срок, статус-бейдж, дата оплаты, просрочка («просрочен на 3 дн.», «оплачен с опозданием на 2 дн.»); фильтры (статус, просрочка, валюта, период), сортировка, пагинация; быстрые вкладки «К оплате / Просрочено / Оплачено / Все».
  Действие «Отметить оплату» → popover с датой (по умолчанию сегодня, будущие даты заблокированы) → оптимистичное обновление; «Отменить оплату»; «Исправить дату». Мобильная версия — карточки.
  DoD: доступно и admin, и user; empty/loading/error состояния; e2e шаги 4–6 демо.
- [ ] **F-06** **Регулярные платежи (admin):** список (активные/архив), форма создания (название, сумма с маской, валюта, дата ближайшей оплаты, периодичность), подсказка «напоминание придёт за 3 дня / сразу, если срок ближе», удаление с подтверждением и пояснением «история сохранится».
- [ ] **F-07** **Пользователи (admin):** таблица, создание, редактирование (логин, имя, пароль), удаление; системный админ — с замком и без действий.
- [ ] **F-08** **Сводка (dashboard):** три карточки валют (всего / оплачено / к оплате / просрочено) за выбранный месяц, блок «Ближайшие 7 дней», блок «Просрочено» — `data-dashboard`, анимации появления (stagger) и плавная смена чисел.
- [ ] **F-09** Форматирование: `Intl.NumberFormat('ru-RU', {style:'currency'})` для RUB/USD/EUR, даты `dd.MM.yyyy`, относительные «через 3 дня», «сегодня».

### Проверка M2
- [ ] **Q-01** (ANY) `tests/acceptance/test_ac_XX_*.py` — по файлу на каждый AC-2…AC-14, на реальной Postgres; `pytest -q` зелёный.
- [ ] **Q-02** (FRONT) Playwright `e2e/demo.spec.ts` = сценарий со с.15: войти admin → добавить платёж со сроком через 1 день → (проверить `reminders` через API/лог console-notifier) → войти user → отметить оплату → показать просроченный → исправить дату → просрочка исчезла → показать следующий период с отдельным статусом.
- [ ] **Q-03** (BACK) Реальный Telegram: создать бота, добавить в группу, `/chatid`, прописать в `.env`, проверить AC-6/AC-7 вживую; скриншот в `docs/screenshots/`.
- [ ] **Q-04** (ANY) `adversarial-reviewer` + `senior-security` по authz: попытки обойти права через API (IDOR, смена роли, PATCH чужих полей). Найденное → `red-green-proof`.
- [ ] **Q-05** (ANY) AC-13: `docker compose down && docker compose up -d` → данные на месте. AC-1: свежий клон в другую папку, строго по README.
  DoD M2: §8 — все AC зелёные; запись «M2 достигнут» в журнале.

## 6. Фаза 3 — Бонусы (→ M3). Порядок = ценность/трудоёмкость. Каждый — отдельный коммит, M2-тесты зелёные.

- [ ] **X-01** (BACK) **Кнопка «Оплачено» в Telegram** (FR-B1): callback `pay:<id>:<hmac>` (HMAC от `SECRET_KEY`, защита от подделки), только из `TELEGRAM_CHAT_ID`; отметка `paid_at=today`, `paid_by_label="Telegram @user"`, сообщение редактируется «✅ Оплачено @user 23.10.2026», повторный клик — ответ «уже оплачено». Аудит.
- [ ] **X-02** (BACK+FRONT) **Журнал аудита** (FR-B2): `GET /api/v1/audit-log` (admin, фильтры), экран «Журнал» — кто, что, когда, IP; логин/логаут/неудачные входы/создание/удаление/оплата/отмена/смена даты.
- [ ] **X-03** (FRONT; BACK — `GET /api/v1/calendar?month=YYYY-MM`) **Календарь оплат** (FR-B3): месячная сетка, точки-статусы по валютам, клик по дню → список периодов с действиями; layout-анимация смены месяца.
- [ ] **X-04** (BACK+FRONT) **Итоги на дату** (FR-B4): `as_of` в summary — «сколько должно было быть оплачено к дате X / оплачено / просрочено», date-picker на сводке.
- [ ] **X-05** (FRONT) **UX/UI полировка** (FR-B5): `design-review` (6 измерений, Nielsen) → исправить top-10; `critique`; `a11y-audit` WCAG 2.2 AA; микро-анимации через `/motion` (hover/tap кнопок, появление строк, бейджи статусов, toast), skeleton-загрузка, горячие клавиши (`/` поиск), `prefers-reduced-motion`. Гейт `ux-ui-agent-skills:gate` зелёный.
- [ ] **X-06** (BACK) **Webhook** (FR-B6): `WEBHOOK_URL` + `WEBHOOK_SECRET` → POST JSON при напоминании, подпись `X-Signature: sha256=…`; тот же конвейер `reminders` (channel=webhook).
- [ ] **X-07** (BACK) **Email через SMTP** (FR-B7): `SMTP_*`, канал email в конвейере; mailpit в `profiles: [extras]` для демо (`http://localhost:8025`).
- [ ] **X-08** (BACK+FRONT) **Чек или ссылка к оплате** (FR-B8): `receipt_url` (валидация URL) и загрузка файла (pdf/png/jpg ≤ 5 МБ) в volume `uploads`, `GET` с авторизацией; иконка-скрепка в таблице.
- [ ] **X-09** (BACK+FRONT) **Бюджет** (FR-B9): `budgets(year, month NULL, currency, amount)`, план vs факт по валютам на сводке, прогресс-бар.
- [ ] **X-10** (BACK) **Напоминание о просрочке** (kind=`overdue`, раз в день не более 1 / до оплаты, в пределах `OVERDUE_REMINDER_MAX`) — «другие каналы/поведение» (FR-B10).

## 7. Фаза 4 — Сдача и защита (→ M4)

- [ ] **D-01** README (ru): что это; требования (Docker Desktop); **быстрый старт за 3 команды** (`git clone` → `copy .env.example .env` / `cp` → `docker compose up -d --build`); адреса (панель, Swagger, mailpit); логины по умолчанию; как подключить Telegram (BotFather → добавить в группу → `/chatid` → `.env` → `docker compose up -d`); переменные окружения (таблица); архитектура (схема §1); как работает расписание и дедупликация; тесты (`docker compose run --rm backend pytest`, `npm run test:e2e`); список бонусов с путями в UI; известные ограничения. Команды для PowerShell и bash.
- [ ] **D-02** `docs/DEMO.md` — сценарий защиты по с.15 по минутам, с данными для ввода и запасным планом (если Telegram не отвечает — показать console-лог и таблицу reminders; `CLOCK_OVERRIDE` для «следующего периода»).
- [ ] **D-03** `ship-gate` + `self-eval` + `code-reviewer`; закрыть critical/high. `env-secrets-manager`: в репо нет секретов (`git grep -i token`).
- [ ] **D-04** Чистый прогон: `git clone` в новую папку → строго README → полный демо-сценарий руками. Время запуска записать в журнал.
- [ ] **D-05** (опц.) `demo-video`: 60–90 сек ролик сценария (Playwright-скриншоты + моушн), идеи — prompt-motion.com.
- [ ] **D-06** Финальный отчёт в §9: что сделано, что нет, известные ограничения; тег `v1.0.0`.

---

## 8. Трассировка требований (обновлять при закрытии задач)

| Req | Задачи | Тест(ы) | Статус |
|---|---|---|---|
| AC-1 Запуск | B-03, B-12, D-01, D-04 | ручная D-04 | ⬜ |
| AC-2 Доступ | B-05, F-03 | `test_ac_02_auth_required.py` | ⬜ |
| AC-3 Роли | B-07, B-10, F-04 | `test_ac_03_roles.py` | ⬜ |
| AC-4 Админ .env | B-05, B-10 | `test_ac_04_env_admin.py` | ⬜ |
| AC-5 Регулярность | B-06, B-07 | `test_schedule.py`, `test_ac_05_periods.py` | ⬜ |
| AC-6 Напоминание | B-11 | `test_ac_06_reminder_once.py` | ⬜ |
| AC-7 Сразу | B-07, B-11 | `test_ac_07_immediate.py` | ⬜ |
| AC-8 Оплачено — без напоминания | B-11 | `test_ac_08_paid_no_reminder.py` | ⬜ |
| AC-9 Отметка/отмена | B-08, F-05 | `test_ac_09_mark_unmark.py`, e2e | ⬜ |
| AC-10 Исправление даты | B-08, F-05 | `test_ac_10_fix_date.py`, e2e | ⬜ |
| AC-11 Просрочка | B-06, B-08 | `test_status.py`, `test_ac_11_overdue.py` | ⬜ |
| AC-12 Валюты | B-09, F-08 | `test_ac_12_summary.py` | ⬜ |
| AC-13 Сохранение | B-03 | ручная Q-05 | ⬜ |
| AC-14 Удаление | B-07, B-11 | `test_ac_14_delete.py` | ⬜ |
| AC-15 Передача | B-04, B-13, D-01 | `test_openapi_up_to_date.py`, D-04 | ⬜ |
| FR-26 Swagger | B-01, B-13 | `GET /api/v1/docs` → 200 | ⬜ |
| Бонусы B1–B10 | X-01…X-10 | см. задачи | ⬜ |

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

## 10. Эскалации и блокеры

Формат:
```
### ESC-N: <заголовок>  (задача <ID>, статус: open|resolved)
Вопрос: …  Варианты: A) … B) …  Рекомендация: …  Что блокируется: …
```
_(пока нет)_

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
