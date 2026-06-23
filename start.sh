#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

export PATH="$HOME/.local/bin:$PATH"
export EXPENSES_ENV="${EXPENSES_ENV:-Production}"

exec uv run --no-dev uvicorn expenses_web.app:app \
  --host 0.0.0.0 \
  --port "${EXPENSES_HTTP_PORT:-8000}" \
  --proxy-headers \
  --forwarded-allow-ips 127.0.0.1
