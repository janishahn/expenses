from pathlib import Path
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from expenses_web.api import routes
from expenses_web.core.app_logging import (
    current_request_id,
    get_logger,
    log_event,
    read_captured_request_body,
    request_client_ip,
    request_route_path,
    reset_request_context,
    set_request_context,
    setup_logging,
    shutdown_logging,
)
from expenses_web.core.config import get_settings
from expenses_web.recurrence.scheduling import SchedulerManager

app = FastAPI(title="Expense Tracker")
app.add_middleware(GZipMiddleware, minimum_size=1024)
PROJECT_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIST_DIR = PROJECT_ROOT / "ui" / "dist"
FRONTEND_ASSETS_DIR = FRONTEND_DIST_DIR / "assets"
FRONTEND_INDEX_PATH = FRONTEND_DIST_DIR / "index.html"


class ImmutableStaticFiles(StaticFiles):
    """Serve Vite's content-hashed assets with a long-lived immutable cache."""

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


app.mount(
    "/assets",
    ImmutableStaticFiles(directory=FRONTEND_ASSETS_DIR, check_dir=False),
    name="frontend-assets",
)

scheduler_manager = SchedulerManager()
app_logger = get_logger("expenses_web.app")


@app.on_event("startup")
def startup_event() -> None:
    settings = get_settings()
    setup_logging(settings)
    log_event(
        app_logger, 20, "app_startup", environment=routes.environment_label(settings)
    )
    log_event(
        app_logger,
        20,
        "csrf_secret_configured",
        csrf_secret_source=settings.csrf_secret_source,
    )
    scheduler_manager.start()


@app.on_event("shutdown")
def shutdown_event() -> None:
    scheduler_manager.stop()
    log_event(app_logger, 20, "app_shutdown")
    shutdown_logging()


app.include_router(routes.router)
get_db = routes.get_db
_SENSITIVE_VALIDATION_FIELDS = {
    "authorization",
    "cookie",
    "csrf",
    "password",
    "secret",
    "setup_token",
    "token",
}


def _frontend_index_response() -> Response:
    if not FRONTEND_INDEX_PATH.exists():
        return Response(
            "Frontend build not found. Build it with `cd ui && npm run build`.",
            media_type="text/plain",
            status_code=503,
        )
    return FileResponse(FRONTEND_INDEX_PATH, headers={"Cache-Control": "no-cache"})


def _redact_validation_errors(errors: object) -> object:
    if isinstance(errors, list):
        return [_redact_validation_errors(item) for item in errors]
    if not isinstance(errors, dict):
        return errors

    redacted = dict(errors)
    loc = [str(part).lower() for part in redacted.get("loc", [])]
    sensitive = any(
        marker in part for part in loc for marker in _SENSITIVE_VALIDATION_FIELDS
    )
    if "input" in redacted and (sensitive or loc):
        redacted["input"] = "[REDACTED]"
    if "ctx" in redacted:
        redacted["ctx"] = _redact_validation_errors(redacted["ctx"])
    return redacted


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or uuid4().hex
    route = request_route_path(request)
    client_ip = request_client_ip(request)
    tokens = set_request_context(
        request_id=request_id,
        method=request.method,
        path=request.url.path,
        route=route,
        client_ip=client_ip,
    )
    start = perf_counter()
    response: Response | None = None
    try:
        response = await call_next(request)
    finally:
        duration_ms = round((perf_counter() - start) * 1000, 2)
        status_code = response.status_code if response is not None else 500
        if request.url.path.startswith("/api/"):
            level = 10
            if status_code >= 500:
                level = 40
            elif status_code >= 400:
                level = 30
            elif request.method.upper() != "GET":
                level = 20
            log_event(
                app_logger,
                level,
                "request_completed",
                method=request.method,
                path=request.url.path,
                route=route,
                status_code=status_code,
                duration_ms=duration_ms,
                client_ip=client_ip,
            )
        reset_request_context(tokens)
    if response is None:
        response = JSONResponse(
            status_code=500, content={"detail": "Internal Server Error"}
        )
    response.headers["X-Request-ID"] = request_id
    return response


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    request_id = request.headers.get("x-request-id") or current_request_id()
    if request_id and not current_request_id():
        tokens = set_request_context(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            route=request_route_path(request),
            client_ip=request_client_ip(request),
        )
    else:
        tokens = None
    payload_fields = await read_captured_request_body(request, get_settings())
    validation_errors = jsonable_encoder(exc.errors())
    logged_validation_errors = _redact_validation_errors(validation_errors)
    log_event(
        app_logger,
        30,
        "request_validation_failed",
        method=request.method,
        path=request.url.path,
        route=request_route_path(request),
        status_code=422,
        validation_errors=logged_validation_errors,
        **(payload_fields or {}),
    )
    if tokens is not None:
        reset_request_context(tokens)
    response = JSONResponse(status_code=422, content={"detail": validation_errors})
    if request_id:
        response.headers["X-Request-ID"] = request_id
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    log_event(
        app_logger,
        40,
        "request_unhandled_exception",
        method=request.method,
        path=request.url.path,
        route=request_route_path(request),
        status_code=500,
        exception_type=exc.__class__.__name__,
        exc_info=(
            type(exc),
            exc,
            exc.__traceback__,
        ),
    )
    response = JSONResponse(
        status_code=500, content={"detail": "Internal Server Error"}
    )
    request_id = current_request_id()
    if request_id:
        response.headers["X-Request-ID"] = request_id
    return response


@app.get("/", include_in_schema=False)
@app.get("/{frontend_path:path}", include_in_schema=False)
def frontend_entry(frontend_path: str = "") -> Response:
    if frontend_path.startswith("api/") or frontend_path.startswith("assets/"):
        raise HTTPException(status_code=404)
    return _frontend_index_response()


def main() -> None:
    import uvicorn

    uvicorn.run("expenses_web.app:app", host="0.0.0.0", port=8000, reload=False)


if __name__ == "__main__":
    main()
