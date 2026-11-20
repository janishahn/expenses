"""Caps the size of request bodies before any route reads or parses them."""

import re
from collections.abc import Callable

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from expenses.core.config import Settings, get_settings

# Well above the largest JSON body the apps send (bulk edits of selected rows).
DEFAULT_MAX_BODY_BYTES = 1024 * 1024
# Room for the multipart boundaries, part headers, and small form fields of an upload.
MULTIPART_OVERHEAD_BYTES = 64 * 1024
TOO_LARGE_DETAIL = "Request body is too large"

# Upload routes accept their advertised file limit; each route checks the file exactly.
UPLOAD_LIMITS: tuple[tuple[re.Pattern[str], Callable[[Settings], int]], ...] = (
    (
        re.compile(r"/api/import/csv/(preview|commit)"),
        lambda settings: settings.csv_import_max_bytes,
    ),
    (
        re.compile(r"/api/reconciliation/commerzbank-csv/(preview|commit)"),
        lambda settings: settings.bank_csv_import_max_bytes,
    ),
    (
        re.compile(r"/api/import/sqlite/preview"),
        lambda settings: settings.sqlite_import_max_bytes,
    ),
    (
        re.compile(r"/api/transactions/\d+/attachments"),
        lambda settings: settings.receipt_max_bytes,
    ),
)


def max_body_bytes(path: str) -> int:
    for pattern, file_limit in UPLOAD_LIMITS:
        if pattern.fullmatch(path):
            return file_limit(get_settings()) + MULTIPART_OVERHEAD_BYTES
    return DEFAULT_MAX_BODY_BYTES


class BodySizeLimitMiddleware:
    """Answers 413 for a declared Content-Length over the route's cap, and stops a
    body without one once it streams past the cap."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = max_body_bytes(scope["path"])
        for name, value in scope["headers"]:
            if name == b"content-length" and value.isdigit() and int(value) > limit:
                response = JSONResponse({"detail": TOO_LARGE_DETAIL}, status_code=413)
                await response(scope, receive, send)
                return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # FastAPI re-raises an HTTPException from body parsing as is.
                    raise HTTPException(status_code=413, detail=TOO_LARGE_DETAIL)
            return message

        await self.app(scope, limited_receive, send)
