# syntax=docker/dockerfile:1
# Контекст сборки — корень репозитория (нужен docs/openapi.yml для теста контракта).
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS build
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv UV_PYTHON_DOWNLOADS=never
WORKDIR /srv/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-install-project

FROM python:3.12-slim-bookworm AS runtime
ENV PATH="/opt/venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN groupadd --system app && useradd --system --gid app --home /srv app
COPY --from=build /opt/venv /opt/venv
WORKDIR /srv/backend
COPY docs/openapi.yml /srv/docs/openapi.yml
COPY backend/ ./
RUN sed -i 's/\r$//' entrypoint.sh && chmod +x entrypoint.sh && mkdir -p /srv/uploads && chown -R app:app /srv
USER app
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=4).status == 200 else 1)"
ENTRYPOINT ["./entrypoint.sh"]
CMD ["serve"]
