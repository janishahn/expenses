FROM node:20-bookworm-slim AS ui-build

WORKDIR /app/ui
COPY ui/package.json ui/package-lock.json ./
RUN npm ci
COPY ui ./
RUN npm run build

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS runtime

ARG OCI_IMAGE_SOURCE="https://github.com/janishahn/expenses"

LABEL org.opencontainers.image.title="expenses" \
    org.opencontainers.image.description="A lightweight self-hosted expense tracker" \
    org.opencontainers.image.source="${OCI_IMAGE_SOURCE}" \
    org.opencontainers.image.licenses="PolyForm-Noncommercial-1.0.0"

ENV EXPENSES_DATA_DIR=/data \
    EXPENSES_FORWARDED_ALLOW_IPS=127.0.0.1 \
    EXPENSES_LOG_DIR=/data/logs \
    EXPENSES_LOG_LEVEL_STDOUT=INFO \
    PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        fonts-dejavu-core \
        libcairo2 \
        libgdk-pixbuf-2.0-0 \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml uv.lock README.md ./
COPY alembic.ini ./alembic.ini
COPY alembic ./alembic
COPY src ./src
RUN uv sync --frozen --no-dev

COPY --from=ui-build /app/ui/dist ./ui/dist

RUN useradd --create-home --home-dir /home/expenses --shell /usr/sbin/nologin expenses \
    && mkdir -p /data \
    && chown -R expenses:expenses /app /data

USER expenses
VOLUME ["/data"]
EXPOSE 8000

CMD ["sh", "-c", "migrations && exec uvicorn expenses.app:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips \"${EXPENSES_FORWARDED_ALLOW_IPS}\""]
