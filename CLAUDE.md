# CLAUDE.md — Invoice Keeper (хакатон РнД, осень 2026)

Сервис напоминаний о регулярных платежах: веб-панель + REST API + Telegram-бот. Жюри запускает решение **строго по README**.

## Документы (читать в этом порядке)
1. `docs/PLAN.md` — **план и единственный отчёт о прогрессе.** Протокол отчётности — §0. Обновлять после каждой задачи.
2. `docs/SPEC.md` — требования с ID (`FR-*`, `NFR-*`, `AC-*`, `EC-*`, `OS-*`).
3. `docs/DECISIONS.md` — архитектурные решения (`ADR-*`). Отступление от плана = новый ADR.
4. `docs/case.pdf` — исходное ТЗ (источник истины при противоречиях).
5. `docs/aeza-guidebook-2026.pdf` — гайдбук Aéza 2026, источник фирменного стиля (ADR-024…026). **Читать перед любой UI-работой.**
   Страницы: 6–13 логотип (знак Aéza в продукте не используем, только конструкцию клавиши — ADR-025), 15–16 цвета,
   18–19 шрифты (Exo 2 основной, Inter дополнительный), 21 иконки (сплошная заливка на скруглённых плитках), 22 паттерн.

## Непреложные правила
- **Сначала обязательное, потом бонусы.** Ни одной задачи из Фазы 3 до чекпойнта M2 (все `AC` зелёные).
- **Не ломать контракт.** Пути и поля API из SPEC §FR-25 фиксированы. После изменения схем — `export_openapi` и коммит `docs/openapi.yml`.
- **Права — только на сервере.** Каждый эндпоинт явно объявляет `current_user` или `require_admin`. Новый эндпоинт без теста на 401/403 не мержится.
- **Даты — `date`, «сегодня» — только через `Clock`.** Никаких `date.today()` / `datetime.now()` в коде вне `core/clock.py`.
- **Деньги — `Decimal`.** Никаких float. В JSON — строка.
- **Напоминания идемпотентны через БД** (`UNIQUE` в `reminders`), не через флаги в памяти.
- **Секреты только в `.env`** (не коммитится). `.env.example` — без реальных значений. Не читать и не выводить `.env` в логи.
- **Доказательства вместо утверждений.** Задача `[x]` только с выводом теста/команды в журнале PLAN.
- **Баг → сначала падающий тест** (`red-green-proof`), потом фикс.
- **UI — на русском**, без эмодзи в интерфейсе (доктрина XIAS), с `prefers-reduced-motion`. Эмодзи допустимы только в сообщениях Telegram.
- Коммиты маленькие, Conventional Commits с ID задачи: `feat(B-07): soft delete recurring payments`.

## Стек
Backend: Python 3.12, FastAPI, SQLAlchemy 2 (sync) + psycopg 3, Alembic, Pydantic v2, uv, argon2-cffi, APScheduler, aiogram 3.
DB: PostgreSQL 16. Frontend: React 19, Vite, TS strict, Tailwind v4, shadcn/ui, TanStack Query, React Router, react-hook-form + zod, motion (`motion/react`), date-fns, openapi-fetch.
Инфра: docker compose (`db`, `backend`, `worker`, `web`=nginx, `mailpit` в profile `extras`).

## Команды
```bash
cp .env.example .env                       # PowerShell: Copy-Item .env.example .env
docker compose up -d --build               # всё приложение → http://localhost:8080, Swagger → /api/v1/docs
docker compose logs -f backend worker
docker compose run --rm backend pytest -q  # тесты бэкенда (тестовая БД создаётся фикстурой)
docker compose run --rm backend python -m app.scripts.export_openapi   # → docs/openapi.yml
docker compose run --rm backend alembic revision --autogenerate -m "..."
docker compose run --rm backend python -m app.seed
cd frontend && npm run gen:api && npm run dev     # dev-сервер с proxy на :8000
cd frontend && npm run test && npm run test:e2e   # vitest + playwright
```

## Окружение
- Хост разработчика — **Windows** (`D:\hack`), Docker Desktop. `.gitattributes` форсирует LF; shell-скрипты для контейнеров — только LF.
- Пути в командах — относительные; README даёт команды и для PowerShell, и для bash.
- Telegram: токен и chat id кладёт человек в `.env`. Без токена воркер пишет напоминания в лог (`console`-notifier).

## Скиллы (вызывай явно, карта по шагам — PLAN §2)
- Всегда: `karpathy-coder`; при незнакомом API — `zero-hallucination-coder`, для Motion — MCP `motion` / `/motion`.
- Backend: `senior-backend`, `tdd-guide`, `api-design-reviewer`, `api-test-suite-builder`, `senior-security`, `docker-development`, `env-secrets-manager`.
- Frontend: `ux-ui-agent-skills:design-doctrine` (перед любой UI-работой), `apply-aesthetic`, `design-screen`, `data-dashboard`, `ux-writing`, `gate`, `critique`, `design-review`; `frontend-design`, `senior-frontend`, `motion-dev-animations`, `a11y-audit`.
- QA/ревью: `pw` (playwright-pro), `webapp-testing`, `red-green-proof`, `adversarial-reviewer`, `code-reviewer`, `self-eval`, `ship-gate`.
- Длинная сессия: `handoff-engineering` + актуальный журнал в PLAN §9.

## Параллельная работа двух агентов
- `BACK` владеет `backend/`, `docker-compose.yml`, `.env.example`, `docs/openapi.yml`. `FRONT` владеет `frontend/`. README — `BACK`, раздел UI — `FRONT`.
- Рабочие копии: `D:\hack` (ветка `main`, BACK) и `D:\hack-front` (`git worktree add ../hack-front -b front`, FRONT). FRONT регулярно делает `git merge main`; в `main` вливает после зелёного `npm run build` и e2e.
- В `PLAN.md` каждый правит **только свои строки задач** и **дописывает** в журнал (не переписывает чужие записи). Конфликты в PLAN решаются объединением обоих вариантов.
