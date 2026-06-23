import contextvars
import hashlib
import json
import logging
import os
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from logging.handlers import QueueHandler, QueueListener, RotatingFileHandler
from pathlib import Path
from queue import SimpleQueue
from threading import Lock
from types import TracebackType
from typing import Iterator

from fastapi import Request

from expenses_web.core.config import Settings

_DEFAULT_SKIP_FIELDS = {
    "args",
    "asctime",
    "created",
    "exc_info",
    "exc_text",
    "filename",
    "funcName",
    "levelname",
    "levelno",
    "lineno",
    "module",
    "msecs",
    "message",
    "msg",
    "name",
    "pathname",
    "process",
    "processName",
    "relativeCreated",
    "stack_info",
    "thread",
    "threadName",
}
_RESERVED_EXTRA_KEYS = set(logging.makeLogRecord({}).__dict__) | {"message", "asctime"}
_QUEUE_LISTENER: QueueListener | None = None
_QUEUE_HANDLER: QueueHandler | None = None
_SETUP_LOCK = Lock()
_REQUEST_ID = contextvars.ContextVar("request_id", default=None)
_REQUEST_METHOD = contextvars.ContextVar("request_method", default=None)
_REQUEST_PATH = contextvars.ContextVar("request_path", default=None)
_REQUEST_ROUTE = contextvars.ContextVar("request_route", default=None)
_REQUEST_CLIENT_IP = contextvars.ContextVar("request_client_ip", default=None)
ExcInfoType = (
    bool
    | BaseException
    | tuple[type[BaseException], BaseException, TracebackType | None]
)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def log_event(
    logger: logging.Logger,
    level: int,
    event: str,
    exc_info: ExcInfoType = False,
    **fields: object,
) -> None:
    extra = {"event": event}
    for key, value in fields.items():
        normalized_key = f"log_{key}" if key in _RESERVED_EXTRA_KEYS else key
        extra[normalized_key] = value
    logger.log(level, event, exc_info=exc_info, extra=extra)


class RequestContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if not getattr(record, "request_id", None):
            record.request_id = _REQUEST_ID.get()
        if not getattr(record, "method", None):
            record.method = _REQUEST_METHOD.get()
        if not getattr(record, "path", None):
            record.path = _REQUEST_PATH.get()
        if not getattr(record, "route", None):
            record.route = _REQUEST_ROUTE.get()
        if not getattr(record, "client_ip", None):
            record.client_ip = _REQUEST_CLIENT_IP.get()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "event": getattr(record, "event", record.getMessage()),
        }
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        for key, value in record.__dict__.items():
            if key in _DEFAULT_SKIP_FIELDS or key.startswith("_"):
                continue
            if value is None:
                continue
            if key == "event":
                continue
            entry[key] = value
        if "message" not in entry and record.getMessage() != entry["event"]:
            entry["message"] = record.getMessage()
        return json.dumps(entry, ensure_ascii=True, default=str)


class ConsoleFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        event = getattr(record, "event", record.getMessage())
        parts = [record.levelname, event]
        request_id = getattr(record, "request_id", None)
        if request_id:
            parts.append(f"request_id={request_id}")
        status_code = getattr(record, "status_code", None)
        if status_code is not None:
            parts.append(f"status={status_code}")
        path = getattr(record, "path", None)
        if path:
            parts.append(f"path={path}")
        return " ".join(parts)


def _log_file_path(settings: Settings) -> Path:
    settings.log_dir.mkdir(parents=True, exist_ok=True)
    return settings.log_dir / "app.jsonl"


def list_log_files(settings: Settings) -> list[Path]:
    log_file = _log_file_path(settings)
    candidates = [
        path
        for path in log_file.parent.glob(f"{log_file.name}*")
        if path.is_file() and path.name.startswith(log_file.name)
    ]
    return sorted(
        candidates,
        key=lambda path: (path.stat().st_mtime, path.name),
        reverse=True,
    )


def setup_logging(settings: Settings) -> None:
    global _QUEUE_HANDLER, _QUEUE_LISTENER

    with _SETUP_LOCK:
        if _QUEUE_LISTENER is not None:
            return

        queue: SimpleQueue[logging.LogRecord] = SimpleQueue()
        queue_handler = QueueHandler(queue)
        queue_handler.setLevel(logging.DEBUG)
        queue_handler.addFilter(RequestContextFilter())

        root_logger = logging.getLogger()
        for handler in list(root_logger.handlers):
            root_logger.removeHandler(handler)
            handler.close()
        root_logger.setLevel(logging.DEBUG)
        root_logger.addHandler(queue_handler)

        file_handler = RotatingFileHandler(
            _log_file_path(settings),
            maxBytes=settings.log_max_bytes,
            backupCount=settings.log_backup_count,
            encoding="utf-8",
        )
        file_handler.setLevel(getattr(logging, settings.log_level_file.upper()))
        file_handler.setFormatter(JsonFormatter())

        stdout_handler = logging.StreamHandler(sys.stdout)
        stdout_handler.setLevel(getattr(logging, settings.log_level_stdout.upper()))
        stdout_handler.setFormatter(ConsoleFormatter())

        listener = QueueListener(
            queue,
            file_handler,
            stdout_handler,
            respect_handler_level=True,
        )
        listener.start()
        _QUEUE_HANDLER = queue_handler
        _QUEUE_LISTENER = listener

        logging.captureWarnings(True)
        logging.getLogger("uvicorn.access").handlers.clear()
        logging.getLogger("uvicorn.access").propagate = False
        logging.getLogger("uvicorn.access").disabled = True
        for logger_name in ("uvicorn", "uvicorn.error", "apscheduler"):
            logger = logging.getLogger(logger_name)
            logger.handlers.clear()
            logger.propagate = True


def shutdown_logging() -> None:
    global _QUEUE_HANDLER, _QUEUE_LISTENER

    with _SETUP_LOCK:
        if _QUEUE_LISTENER is None:
            return
        _QUEUE_LISTENER.stop()
        root_logger = logging.getLogger()
        if _QUEUE_HANDLER is not None:
            root_logger.removeHandler(_QUEUE_HANDLER)
        _QUEUE_HANDLER = None
        _QUEUE_LISTENER = None


def set_request_context(
    *,
    request_id: str,
    method: str,
    path: str,
    route: str,
    client_ip: str | None,
) -> dict[str, contextvars.Token[str | None]]:
    return {
        "request_id": _REQUEST_ID.set(request_id),
        "method": _REQUEST_METHOD.set(method),
        "path": _REQUEST_PATH.set(path),
        "route": _REQUEST_ROUTE.set(route),
        "client_ip": _REQUEST_CLIENT_IP.set(client_ip),
    }


def reset_request_context(tokens: dict[str, contextvars.Token[str | None]]) -> None:
    _REQUEST_ID.reset(tokens["request_id"])
    _REQUEST_METHOD.reset(tokens["method"])
    _REQUEST_PATH.reset(tokens["path"])
    _REQUEST_ROUTE.reset(tokens["route"])
    _REQUEST_CLIENT_IP.reset(tokens["client_ip"])


def current_request_id() -> str | None:
    return _REQUEST_ID.get()


def request_client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for", "").strip()
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    if request.client is None:
        return None
    return request.client.host


def request_route_path(request: Request) -> str:
    route = request.scope.get("route")
    return getattr(route, "path", request.url.path)


def should_capture_request_body(request: Request) -> bool:
    if request.method.upper() != "POST":
        return False
    if request.url.path != "/api/ingest":
        return False
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip()
    return content_type in {"application/json", "text/plain", ""}


async def read_captured_request_body(
    request: Request, settings: Settings
) -> dict[str, str | int | bool] | None:
    if not should_capture_request_body(request):
        return None
    body = await request.body()
    body_sha256 = hashlib.sha256(body).hexdigest()
    truncated = len(body) > settings.log_capture_max_bytes
    clipped = body[: settings.log_capture_max_bytes]
    return {
        "request_content_type": request.headers.get("content-type", ""),
        "raw_body": clipped.decode("utf-8", errors="replace"),
        "raw_body_bytes": len(body),
        "raw_body_truncated": truncated,
        "request_body_sha256": body_sha256,
    }


@dataclass(frozen=True)
class LogQuery:
    limit: int
    offset: int
    level: str | None = None
    event: str | None = None
    request_id: str | None = None
    path: str | None = None
    status_code: int | None = None
    error_only: bool = False
    since: datetime | None = None
    q: str | None = None


@dataclass(frozen=True)
class LogQueryResult:
    entries: list[dict[str, object]]
    next_cursor: str | None


def _matches_query(entry: dict[str, object], query: LogQuery) -> bool:
    level = str(entry.get("level", "")).upper()
    if query.level and str(entry.get("level", "")).upper() != query.level.upper():
        return False
    if query.event and str(entry.get("event", "")) != query.event:
        return False
    if query.request_id and str(entry.get("request_id", "")) != query.request_id:
        return False
    if query.path and str(entry.get("path", "")) != query.path:
        return False
    status_code = entry.get("status_code")
    if status_code is not None and not isinstance(status_code, int):
        return False
    if query.status_code is not None and status_code != query.status_code:
        return False
    if (
        query.error_only
        and level not in {"ERROR", "CRITICAL"}
        and (status_code is None or status_code < 500)
    ):
        return False
    if query.since is not None:
        timestamp = entry.get("timestamp")
        if not isinstance(timestamp, str):
            return False
        try:
            entry_dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        except ValueError:
            return False
        if entry_dt < query.since:
            return False
    if query.q:
        haystack = json.dumps(entry, ensure_ascii=True).lower()
        if query.q.lower() not in haystack:
            return False
    return True


def _iter_log_lines_reverse(path: Path) -> Iterator[str]:
    with path.open("rb") as handle:
        handle.seek(0, os.SEEK_END)
        position = handle.tell()
        buffer = b""
        while position > 0:
            chunk_size = min(8192, position)
            position -= chunk_size
            handle.seek(position)
            buffer = handle.read(chunk_size) + buffer
            lines = buffer.split(b"\n")
            buffer = lines[0]
            for line in reversed(lines[1:]):
                yield line.rstrip(b"\r").decode("utf-8", errors="replace")
        if buffer:
            yield buffer.rstrip(b"\r").decode("utf-8", errors="replace")


def query_logs(settings: Settings, query: LogQuery) -> LogQueryResult:
    entries: list[dict[str, object]] = []
    matched_offset = 0
    has_more = False
    for path in list_log_files(settings):
        try:
            for line in _iter_log_lines_reverse(path):
                if not line.strip():
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(entry, dict) or not _matches_query(entry, query):
                    continue
                if matched_offset < query.offset:
                    matched_offset += 1
                    continue
                if len(entries) >= query.limit:
                    has_more = True
                    break
                entries.append(entry)
        except OSError:
            continue
        if has_more:
            break
    next_cursor = str(query.offset + query.limit) if has_more else None
    return LogQueryResult(entries=entries, next_cursor=next_cursor)


def log_file_info(settings: Settings) -> dict[str, str | int | None]:
    log_file = _log_file_path(settings)
    if log_file.exists():
        stat = log_file.stat()
        modified_at = datetime.fromtimestamp(stat.st_mtime, UTC).isoformat()
        size_bytes = stat.st_size
    else:
        modified_at = None
        size_bytes = 0
    return {
        "path": str(log_file),
        "size_bytes": size_bytes,
        "modified_at": modified_at,
        "retained_files": len(list_log_files(settings)),
    }


def build_log_query(
    *,
    limit: int,
    cursor: str | None,
    level: str | None,
    event: str | None,
    request_id: str | None,
    path: str | None,
    status_code: int | None,
    error_only: bool,
    since: str | None,
    q: str | None,
) -> LogQuery:
    try:
        offset = int(cursor or "0")
    except ValueError as exc:
        raise ValueError("Invalid cursor") from exc
    if offset < 0:
        raise ValueError("Invalid cursor")
    if limit < 1 or limit > 200:
        raise ValueError("limit must be between 1 and 200")
    since_dt = None
    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("Invalid since value") from exc
        if since_dt.tzinfo is None:
            since_dt = since_dt.replace(tzinfo=UTC)
        else:
            since_dt = since_dt.astimezone(UTC)
    return LogQuery(
        limit=limit,
        offset=offset,
        level=level,
        event=event,
        request_id=request_id,
        path=path,
        status_code=status_code,
        error_only=error_only,
        since=since_dt,
        q=q.strip() or None if q else None,
    )


def environment_label(settings: Settings | None = None) -> str:
    if settings is None:
        from expenses_web.core.config import get_settings

        settings = get_settings()
    return settings.environment
