import logging
import json
import hashlib
import os
import re
import secrets
import sqlite3
import shutil
import tempfile
import time
import tomllib
import urllib.parse
from collections.abc import Callable
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from threading import Lock
from typing import Literal, Optional
from zoneinfo import ZoneInfo

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Request,
    Response,
    UploadFile,
)
from fastapi.responses import (
    FileResponse,
    StreamingResponse,
)
from sqlalchemy import case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload
from starlette.background import BackgroundTask

from expenses.auth import (
    elevate_auth_session,
    elevate_mobile_auth_session,
    get_user_ingest_token,
    hash_password,
    issue_auth_session,
    issue_mobile_auth_session,
    issue_user_ingest_token,
    lookup_user_ingest_token,
    require_current_user,
    require_elevated_admin,
    resolve_auth_context,
    revoke_auth_session_by_token,
    revoke_mobile_auth_session,
    revoke_user_ingest_token,
    touch_mobile_auth_session,
    touch_user_ingest_token,
    verify_password,
)
from expenses.ai.client import LLMDisabledError
from expenses.ai.schemas import (
    RuleSuggestionOut,
    TransactionSuggestionOut,
)
from expenses.ai.service import LLMAssistantService
from expenses.ai.spending_chat import (
    SpendingChatError,
    SpendingChatRequest,
    SpendingChatService,
    validate_spending_chat_message_history,
)
from expenses.core.app_logging import (
    build_log_query,
    environment_label,
    get_logger,
    log_event,
    log_file_info,
    query_logs,
    read_captured_request_body,
)
from expenses.core.config import get_settings
from expenses.core.csrf import generate_csrf_token, validate_csrf_token
from expenses.core.safe_regex import RegexRejected, safe_regex_search
from expenses.db.session import SessionLocal
from expenses.exporters import PortableExportError, PortableExportService
from expenses.importers.legacy_sqlite import LegacySQLiteImportService
from expenses.db.models import (
    Category,
    LLMJob,
    MobileAuthSession,
    RecurringRule,
    Tag,
    Transaction,
    TransactionType,
    User,
    UserIngestToken,
    transaction_tags,
)
from expenses.core.periods import Period, resolve_period
from expenses.recurrence.engine import calculate_next_date, local_today
from expenses.schemas import (
    AdminElevationOut,
    AllocationIDOut,
    BalanceAnchorIn,
    AdminElevationIn,
    AdminInfoOut,
    AdminLogsResponseOut,
    AdminPurgeDeletedIn,
    AdminPurgeDeletedOut,
    AdminRebuildRollupsOut,
    AdminRecurringCatchUpOut,
    AdminSystemHealthOut,
    AIUsageSummaryOut,
    AuthCredentialsIn,
    BankReconciliationResponseOut,
    BankRowActionResponseOut,
    BankStatementImportResponseOut,
    BankStatementPreviewResponseOut,
    BulkEditRequestIn,
    BulkEditResponseOut,
    BudgetOverrideIn,
    BudgetOverrideOut,
    BudgetBurndownResponseOut,
    BudgetTemplateIn,
    BudgetTemplateMutationOut,
    BudgetsResponseOut,
    CategoryMergeIn,
    CategoryMergeResponseOut,
    CategoryIn,
    CategoryOut,
    CategoriesResponseOut,
    CategoryUpdateIn,
    DashboardResponseOut,
    DeletedTransactionsResponseOut,
    DigestResponseOut,
    DurablePurchasesResponseOut,
    DurablePurchaseIn,
    ForecastResponseOut,
    ForecastScenarioIn,
    ForecastScenarioResponseOut,
    IdOut,
    IngestTransactionIn,
    IngestTransactionOut,
    InsightsFlowResponseOut,
    InsightsResponseOut,
    CSVCommitResponseOut,
    CSVPreviewResponseOut,
    LegacySqliteCommitIn,
    LegacySqliteCommitOut,
    LegacySqlitePreviewResponseOut,
    MobileAuthCredentialsIn,
    MobileAuthIdentityOut,
    MobileSessionsResponseOut,
    MobileSessionOut,
    MobileStatusOut,
    PermanentDeleteTransactionOut,
    RecurringPreviewIn,
    RecurringPreviewOut,
    RecurringRuleIn,
    RecurringOccurrencesResponseOut,
    RecurringResponseOut,
    RecurringToggleIn,
    ReceiptAttachmentOut,
    ReceiptAttachmentsResponseOut,
    ReimbursementAllocationIn,
    ReimbursementExpenseSearchResponseOut,
    TransactionReimbursementsResponseOut,
    ReportOptions,
    RuleIn,
    RulePreviewOut,
    RulesResponseOut,
    RuleToggleIn,
    StatusOut,
    SettingsResponseOut,
    IngestTokenCreateResponseOut,
    TemplateReorderIn,
    TagIn,
    TagMergeIn,
    TagMergeResponseOut,
    TagMutationOut,
    TagsResponseOut,
    TransactionIn,
    TransactionDetailOut,
    TransactionsResponseOut,
    TransactionTemplateOut,
    TemplatesResponseOut,
    TransactionTemplateIn,
    UncategorizedTransactionsResponseOut,
)
from expenses.services import (
    BalanceAnchorService,
    BudgetService,
    CSVService,
    CategoryService,
    DigestService,
    DurablePurchaseService,
    ForecastService,
    IngestCategoryAmbiguous,
    IngestCategoryNotFound,
    IngestService,
    InsightsService,
    MetricsService,
    ReceiptAttachmentService,
    ReimbursementService,
    RecurringRuleService,
    RuleService,
    TagService,
    TransactionTemplateService,
    TransactionFilters,
    TransactionService,
    ReportService,
    rebuild_monthly_rollups,
)
from expenses.services.bank_reconciliation import BankReconciliationService
from expenses.reports.pdf_renderer import render_report_html

router = APIRouter()
PROJECT_ROOT = Path(__file__).resolve().parents[3]
logger = get_logger("expenses.api")


def get_spending_chat_session_factory() -> Callable[[], Session]:
    return SessionLocal


def get_spending_chat_service_class() -> type[SpendingChatService]:
    return SpendingChatService


def _load_app_version() -> str:
    try:
        with open(PROJECT_ROOT / "pyproject.toml", "rb") as f:
            data = tomllib.load(f)
        return str(data.get("project", {}).get("version", "unknown"))
    except (FileNotFoundError, OSError, tomllib.TOMLDecodeError):
        return "unknown"


APP_VERSION = _load_app_version()
ADMIN_SYSTEM_HEALTH_OVERRIDE_COOKIE = "expenses_admin_system_health_override"
ADMIN_SYSTEM_HEALTH_VALIDATION_PROFILES: dict[str, dict[str, float | int | None]] = {
    "healthy": {
        "cpu_temp_celsius": 55.1,
        "cpu_load_percent": 20.2,
        "ram_used_bytes": 2_000_000_000,
        "ram_total_bytes": 4_000_000_000,
        "disk_total_bytes": 10_000_000_000,
        "disk_free_bytes": 3_200_000_000,
    },
    "warm": {
        "cpu_temp_celsius": 64.4,
        "cpu_load_percent": 72.1,
        "ram_used_bytes": 2_600_000_000,
        "ram_total_bytes": 4_000_000_000,
        "disk_total_bytes": 10_000_000_000,
        "disk_free_bytes": 1_600_000_000,
    },
    "critical": {
        "cpu_temp_celsius": 55.1,
        "cpu_load_percent": 20.2,
        "ram_used_bytes": 2_000_000_000,
        "ram_total_bytes": 4_000_000_000,
        "disk_total_bytes": 10_000_000_000,
        "disk_free_bytes": 800_000_000,
    },
}
_AUTH_FAILURES: dict[tuple[str, str, str], list[float]] = {}
_AUTH_FAILURE_LOCK = Lock()
_SQLITE_IMPORT_TOKEN_RE = re.compile(r"^[A-Za-z0-9-]+_[0-9a-f]{32}$")


def _direct_client_host(request: Request) -> str:
    if request.client is None:
        return "unknown"
    return request.client.host


def _auth_throttle_key(
    request: Request, purpose: str, username: str
) -> tuple[str, str, str]:
    return (_direct_client_host(request), purpose, username.strip().lower())


def _check_auth_throttle(
    request: Request, purpose: str, username: str
) -> tuple[str, str, str]:
    settings = get_settings()
    key = _auth_throttle_key(request, purpose, username)
    if settings.auth_throttle_max_failures <= 0:
        return key
    now = time.monotonic()
    window_start = now - settings.auth_throttle_window_seconds
    with _AUTH_FAILURE_LOCK:
        failures = [at for at in _AUTH_FAILURES.get(key, []) if at >= window_start]
        if len(failures) >= settings.auth_throttle_max_failures:
            retry_after_seconds = (
                failures[-1] + settings.auth_throttle_lockout_seconds - now
            )
            if retry_after_seconds > 0:
                _AUTH_FAILURES[key] = failures
                raise HTTPException(
                    status_code=429,
                    detail="Too many failed attempts; retry later",
                    headers={"Retry-After": str(max(1, int(retry_after_seconds)))},
                )
            failures = []
        _AUTH_FAILURES[key] = failures
    return key


def _record_auth_failure(key: tuple[str, str, str]) -> None:
    settings = get_settings()
    if settings.auth_throttle_max_failures <= 0:
        return
    now = time.monotonic()
    window_start = now - settings.auth_throttle_window_seconds
    with _AUTH_FAILURE_LOCK:
        failures = [at for at in _AUTH_FAILURES.get(key, []) if at >= window_start]
        failures.append(now)
        _AUTH_FAILURES[key] = failures
        max_keys = max(1, settings.auth_throttle_max_keys)
        if len(_AUTH_FAILURES) > max_keys:
            stale_keys = [
                failure_key
                for failure_key, failure_times in _AUTH_FAILURES.items()
                if not any(at >= window_start for at in failure_times)
            ]
            for stale_key in stale_keys:
                _AUTH_FAILURES.pop(stale_key, None)
            if len(_AUTH_FAILURES) > max_keys:
                oldest_keys = sorted(
                    _AUTH_FAILURES,
                    key=lambda failure_key: max(_AUTH_FAILURES[failure_key]),
                )
                for stale_key in oldest_keys[: len(_AUTH_FAILURES) - max_keys]:
                    _AUTH_FAILURES.pop(stale_key, None)


def _clear_auth_failures(key: tuple[str, str, str]) -> None:
    with _AUTH_FAILURE_LOCK:
        _AUTH_FAILURES.pop(key, None)


def _admin_system_health_override_profile(request: Request) -> str | None:
    profile = request.cookies.get(ADMIN_SYSTEM_HEALTH_OVERRIDE_COOKIE)
    if profile not in ADMIN_SYSTEM_HEALTH_VALIDATION_PROFILES:
        return None
    return profile


def _serialize_admin_system_health_override(
    profile: str, db_size_bytes: int, receipts_size_bytes: int
) -> dict[str, float | int | str | None]:
    fixture = ADMIN_SYSTEM_HEALTH_VALIDATION_PROFILES[profile]
    disk_total_bytes = int(fixture["disk_total_bytes"])
    disk_free_bytes = int(fixture["disk_free_bytes"])
    return {
        "cpu_temp_celsius": fixture["cpu_temp_celsius"],
        "cpu_load_percent": fixture["cpu_load_percent"],
        "ram_used_bytes": int(fixture["ram_used_bytes"]),
        "ram_total_bytes": int(fixture["ram_total_bytes"]),
        "disk_used_bytes": max(0, disk_total_bytes - disk_free_bytes),
        "disk_total_bytes": disk_total_bytes,
        "disk_free_bytes": disk_free_bytes,
        "db_size_bytes": int(db_size_bytes),
        "receipts_size_bytes": int(receipts_size_bytes),
        "status": profile,
    }


def _require_csrf(request: Request, db: Session) -> None:
    context = resolve_auth_context(request, db)
    if context.mobile_session is not None:
        return

    token = request.headers.get("X-CSRF-Token", "")
    auth_session = context.auth_session

    if auth_session is None:
        is_valid = validate_csrf_token(token)
    else:
        is_valid = validate_csrf_token(
            token,
            session_id=auth_session.id,
            session_csrf_secret=auth_session.csrf_secret,
        )

    if not is_valid:
        raise HTTPException(status_code=400, detail="Invalid CSRF token")


def _set_admin_system_health_override_cookie(response: Response, profile: str) -> None:
    response.set_cookie(
        key=ADMIN_SYSTEM_HEALTH_OVERRIDE_COOKIE,
        value=profile,
        httponly=True,
        samesite="lax",
        path="/",
    )


def _clear_admin_system_health_override_cookie(response: Response) -> None:
    response.delete_cookie(
        key=ADMIN_SYSTEM_HEALTH_OVERRIDE_COOKIE,
        httponly=True,
        samesite="lax",
        path="/",
    )


def _is_bootstrap_required(db: Session) -> bool:
    user_count = db.scalar(select(func.count(User.id))) or 0
    return user_count == 0


def _serialize_auth_user(user: User) -> dict[str, object]:
    return {
        "id": user.id,
        "username": user.username,
        "is_admin": user.is_admin,
    }


def _serialize_auth_identity(request: Request, db: Session) -> dict[str, object]:
    context = resolve_auth_context(request, db)
    if context.user is None:
        return {"authenticated": False, "user": None}
    return {
        "authenticated": True,
        "user": _serialize_auth_user(context.user),
    }


def _serialize_mobile_session(session) -> MobileSessionOut:
    return MobileSessionOut.model_validate(session)


def _serialize_mobile_identity(
    request: Request, db: Session, *, token: str | None = None
) -> MobileAuthIdentityOut:
    context = resolve_auth_context(request, db)
    if context.user is None or context.mobile_session is None:
        return MobileAuthIdentityOut(authenticated=False)
    return MobileAuthIdentityOut(
        authenticated=True,
        user=_serialize_auth_user(context.user),
        token=token,
        session=_serialize_mobile_session(context.mobile_session),
    )


def _serialize_issued_mobile_identity(user, issued) -> MobileAuthIdentityOut:
    return MobileAuthIdentityOut(
        authenticated=True,
        user=_serialize_auth_user(user),
        token=issued.raw_token,
        session=_serialize_mobile_session(issued.mobile_session),
    )


def _require_mobile_auth_context(request: Request, db: Session):
    context = resolve_auth_context(request, db)
    if context.user is None or context.mobile_session is None:
        raise HTTPException(
            status_code=401,
            detail="Mobile authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    touch_mobile_auth_session(context.mobile_session, now=context.checked_at)
    return context


def _require_current_user_id(request: Request, db: Session) -> int:
    return require_current_user(request, db).id


def _require_elevated_admin_context(request: Request, db: Session):
    return require_elevated_admin(request, db)


def _auth_context_session_key(context) -> str:
    if context.auth_session is not None:
        return str(context.auth_session.id)
    if context.mobile_session is not None:
        return f"mobile-{context.mobile_session.id}"
    raise HTTPException(status_code=401, detail="Authentication required")


def _require_setup_token_if_configured(request: Request) -> None:
    expected = get_settings().auth_setup_token
    if expected is None:
        return
    supplied = request.headers.get("X-Setup-Token", "")
    if not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=403, detail="Invalid setup token")


def _require_creation_password_strength(password: str) -> None:
    if len(password) < 8:
        raise HTTPException(
            status_code=422,
            detail="Password must be at least 8 characters long",
        )


async def _read_upload_limited(
    file: UploadFile, *, max_bytes: int, detail: str
) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(status_code=413, detail=detail)
        chunks.append(chunk)
    return b"".join(chunks)


def _legacy_sqlite_import_path(token: str) -> Path:
    if not _SQLITE_IMPORT_TOKEN_RE.fullmatch(token):
        raise HTTPException(status_code=400, detail="Invalid import token")
    base = get_settings().sqlite_import_dir
    path = (base / f"legacy_{token}.db").resolve()
    if base != path.parent:
        raise HTTPException(status_code=400, detail="Invalid import token")
    return path


def _report_transaction_count(options: ReportOptions, db: Session, user_id: int) -> int:
    stmt = select(func.count(Transaction.id)).where(
        Transaction.user_id == user_id,
        Transaction.deleted_at.is_(None),
        Transaction.date.between(options.start, options.end),
    )
    if options.transaction_type is not None:
        stmt = stmt.where(Transaction.type == options.transaction_type)
    if options.category_ids:
        stmt = stmt.where(Transaction.category_id.in_(options.category_ids))
    return int(db.execute(stmt).scalar_one() or 0)


def _validate_report_bounds(options: ReportOptions, db: Session, user_id: int) -> None:
    settings = get_settings()
    if options.end < options.start:
        raise HTTPException(
            status_code=400, detail="Report end date is before start date"
        )
    days = (options.end - options.start).days + 1
    if days > settings.report_max_days:
        raise HTTPException(
            status_code=400,
            detail=f"Report date range is too large (max {settings.report_max_days} days)",
        )
    count = _report_transaction_count(options, db, user_id)
    if count > settings.report_max_transactions:
        raise HTTPException(
            status_code=400,
            detail=(
                "Report transaction range is too large "
                f"(max {settings.report_max_transactions} transactions)"
            ),
        )


def _parse_ingest_bearer_token(request: Request) -> str | None:
    auth_header = request.headers.get("authorization", "")
    scheme, _, token = auth_header.partition(" ")
    if scheme.lower() != "bearer":
        return None
    token = token.strip()
    if not token:
        return None
    return token


def _require_ingest_token(request: Request, db: Session) -> UserIngestToken:
    raw_token = _parse_ingest_bearer_token(request)
    if raw_token is None:
        raise HTTPException(
            status_code=401,
            detail="Missing ingest bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    ingest_token = lookup_user_ingest_token(db, raw_token)
    if ingest_token is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid ingest bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return ingest_token


def _request_is_https(request: Request) -> bool:
    if request.url.scheme == "https":
        return True
    forwarded_proto = request.headers.get("x-forwarded-proto")
    if (
        forwarded_proto
        and _direct_client_host(request) in get_settings().trusted_proxy_ips
    ):
        return forwarded_proto.split(",", 1)[0].strip().lower() == "https"
    return False


def _set_auth_session_cookie(
    response: Response,
    request: Request,
    raw_token: str,
) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.auth_session_cookie_name,
        value=raw_token,
        max_age=settings.auth_session_max_age_seconds,
        httponly=True,
        samesite="lax",
        secure=_request_is_https(request),
        path="/",
    )


def _clear_auth_session_cookie(response: Response, request: Request) -> None:
    response.delete_cookie(
        key=get_settings().auth_session_cookie_name,
        httponly=True,
        samesite="lax",
        secure=_request_is_https(request),
        path="/",
    )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def require_llm_enabled() -> None:
    if not get_settings().llm_enabled:
        raise HTTPException(status_code=503, detail="LLM features are disabled")


@router.get("/api/auth/bootstrap-status")
def api_auth_bootstrap_status(
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    setup_required = _is_bootstrap_required(db)
    settings = get_settings()
    return {
        "setup_required": setup_required,
        "setup_allowed": setup_required,
        "setup_token_required": setup_required
        and settings.auth_setup_token is not None,
        "signup_allowed": not setup_required and settings.auth_signup_enabled,
        "llm_enabled": settings.llm_enabled,
        **_serialize_auth_identity(request, db),
    }


@router.post("/api/auth/setup")
def api_auth_setup(
    data: AuthCredentialsIn,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    _require_setup_token_if_configured(request)
    if not _is_bootstrap_required(db):
        raise HTTPException(status_code=409, detail="Setup already completed")
    _require_creation_password_strength(data.password)

    user = User(
        id=1,
        username=data.username,
        password_hash=hash_password(data.password),
        is_admin=True,
    )
    try:
        db.add(user)
        db.flush()
        issued = issue_auth_session(db, user)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username already exists") from exc

    _set_auth_session_cookie(response, request, issued.raw_token)
    return {
        "authenticated": True,
        "user": _serialize_auth_user(user),
    }


@router.post("/api/auth/signup")
def api_auth_signup(
    data: AuthCredentialsIn,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    if _is_bootstrap_required(db):
        raise HTTPException(status_code=409, detail="Setup required")
    if not get_settings().auth_signup_enabled:
        raise HTTPException(status_code=403, detail="Signup is disabled")
    if resolve_auth_context(request, db).user is not None:
        raise HTTPException(status_code=403, detail="Logout required before signup")
    _require_creation_password_strength(data.password)

    user = User(
        username=data.username,
        password_hash=hash_password(data.password),
        is_admin=False,
    )
    try:
        db.add(user)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username already exists") from exc

    return {
        "created": True,
        "user": _serialize_auth_user(user),
    }


@router.post("/api/auth/login")
def api_auth_login(
    data: AuthCredentialsIn,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    if _is_bootstrap_required(db):
        raise HTTPException(status_code=409, detail="Setup required")

    throttle_key = _check_auth_throttle(request, "web-login", data.username)
    user = db.scalar(select(User).where(User.username == data.username))
    if user is None or not verify_password(data.password, user.password_hash):
        _record_auth_failure(throttle_key)
        raise HTTPException(status_code=401, detail="Invalid username or password")
    _clear_auth_failures(throttle_key)

    issued = issue_auth_session(db, user)
    db.commit()
    _set_auth_session_cookie(response, request, issued.raw_token)
    return {
        "authenticated": True,
        "user": _serialize_auth_user(user),
    }


@router.post("/api/auth/logout")
def api_auth_logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    _require_csrf(request, db)
    raw_token = request.cookies.get(get_settings().auth_session_cookie_name)
    if raw_token:
        revoke_auth_session_by_token(db, raw_token)
    db.commit()
    _clear_auth_session_cookie(response, request)
    return {"authenticated": False}


@router.post("/api/auth/admin-elevation")
def api_auth_admin_elevation(
    data: AdminElevationIn,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    _require_csrf(request, db)
    context = resolve_auth_context(request, db)
    if context.user is None or context.auth_session is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    if not context.user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    throttle_key = _check_auth_throttle(
        request, "web-admin-elevation", context.user.username
    )
    if not verify_password(data.password, context.user.password_hash):
        _record_auth_failure(throttle_key)
        raise HTTPException(status_code=401, detail="Invalid password")
    _clear_auth_failures(throttle_key)

    elevate_auth_session(context.auth_session, now=context.checked_at)
    db.commit()
    return {
        "elevated": True,
        "elevated_until": (
            context.auth_session.elevated_until.isoformat()
            if context.auth_session.elevated_until
            else None
        ),
    }


@router.get("/api/auth/me")
def api_auth_me(
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return _serialize_auth_identity(request, db)


@router.get("/api/mobile/status", response_model=MobileStatusOut)
def api_mobile_status(db: Session = Depends(get_db)) -> MobileStatusOut:
    settings = get_settings()
    setup_required = _is_bootstrap_required(db)
    return MobileStatusOut(
        app="expenses",
        version=APP_VERSION,
        setup_required=setup_required,
        setup_token_required=setup_required and settings.auth_setup_token is not None,
        signup_allowed=not setup_required and settings.auth_signup_enabled,
        timezone=settings.timezone,
        receipt_max_bytes=settings.receipt_max_bytes,
        llm_enabled=settings.llm_enabled,
    )


@router.post("/api/mobile/auth/setup", response_model=MobileAuthIdentityOut)
def api_mobile_auth_setup(
    data: MobileAuthCredentialsIn,
    request: Request,
    db: Session = Depends(get_db),
) -> MobileAuthIdentityOut:
    _require_setup_token_if_configured(request)
    if not _is_bootstrap_required(db):
        raise HTTPException(status_code=409, detail="Setup already completed")
    _require_creation_password_strength(data.password)

    user = User(
        id=1,
        username=data.username,
        password_hash=hash_password(data.password),
        is_admin=True,
    )
    try:
        db.add(user)
        db.flush()
        issued = issue_mobile_auth_session(
            db,
            user,
            device_id=data.device_id,
            device_name=data.device_name,
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username already exists") from exc

    return _serialize_issued_mobile_identity(user, issued)


@router.post("/api/mobile/auth/signup", response_model=MobileAuthIdentityOut)
def api_mobile_auth_signup(
    data: MobileAuthCredentialsIn,
    request: Request,
    db: Session = Depends(get_db),
) -> MobileAuthIdentityOut:
    if _is_bootstrap_required(db):
        raise HTTPException(status_code=409, detail="Setup required")
    if not get_settings().auth_signup_enabled:
        raise HTTPException(status_code=403, detail="Signup is disabled")
    if resolve_auth_context(request, db).user is not None:
        raise HTTPException(status_code=403, detail="Logout required before signup")
    _require_creation_password_strength(data.password)

    user = User(
        username=data.username,
        password_hash=hash_password(data.password),
        is_admin=False,
    )
    try:
        db.add(user)
        db.flush()
        issued = issue_mobile_auth_session(
            db,
            user,
            device_id=data.device_id,
            device_name=data.device_name,
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username already exists") from exc

    return _serialize_issued_mobile_identity(user, issued)


@router.post("/api/mobile/auth/login", response_model=MobileAuthIdentityOut)
def api_mobile_auth_login(
    data: MobileAuthCredentialsIn,
    request: Request,
    db: Session = Depends(get_db),
) -> MobileAuthIdentityOut:
    if _is_bootstrap_required(db):
        raise HTTPException(status_code=409, detail="Setup required")

    throttle_key = _check_auth_throttle(request, "mobile-login", data.username)
    user = db.scalar(select(User).where(User.username == data.username))
    if user is None or not verify_password(data.password, user.password_hash):
        _record_auth_failure(throttle_key)
        raise HTTPException(status_code=401, detail="Invalid username or password")
    _clear_auth_failures(throttle_key)

    issued = issue_mobile_auth_session(
        db,
        user,
        device_id=data.device_id,
        device_name=data.device_name,
    )
    db.commit()
    return _serialize_issued_mobile_identity(user, issued)


@router.post("/api/mobile/auth/logout")
def api_mobile_auth_logout(
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    context = _require_mobile_auth_context(request, db)
    revoke_mobile_auth_session(db, context.mobile_session)
    db.commit()
    return {"authenticated": False}


@router.get("/api/mobile/auth/me", response_model=MobileAuthIdentityOut)
def api_mobile_auth_me(
    request: Request,
    db: Session = Depends(get_db),
) -> MobileAuthIdentityOut:
    context = _require_mobile_auth_context(request, db)
    db.commit()
    return MobileAuthIdentityOut(
        authenticated=True,
        user=_serialize_auth_user(context.user),
        session=_serialize_mobile_session(context.mobile_session),
    )


@router.post(
    "/api/mobile/auth/admin-elevation",
    response_model=AdminElevationOut,
)
def api_mobile_auth_admin_elevation(
    data: AdminElevationIn,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    context = _require_mobile_auth_context(request, db)
    if not context.user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    throttle_key = _check_auth_throttle(
        request, "mobile-admin-elevation", context.user.username
    )
    if not verify_password(data.password, context.user.password_hash):
        _record_auth_failure(throttle_key)
        raise HTTPException(status_code=401, detail="Invalid password")
    _clear_auth_failures(throttle_key)

    elevate_mobile_auth_session(context.mobile_session, now=context.checked_at)
    db.commit()
    return {
        "elevated": True,
        "elevated_until": (
            context.mobile_session.elevated_until.isoformat()
            if context.mobile_session.elevated_until
            else None
        ),
    }


@router.get("/api/mobile/auth/sessions", response_model=MobileSessionsResponseOut)
def api_mobile_auth_sessions(
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, list[MobileSessionOut]]:
    context = _require_mobile_auth_context(request, db)
    sessions = db.scalars(
        select(MobileAuthSession)
        .where(MobileAuthSession.user_id == context.user.id)
        .order_by(MobileAuthSession.created_at.desc())
    ).all()
    db.commit()
    return {"sessions": [_serialize_mobile_session(session) for session in sessions]}


@router.delete("/api/mobile/auth/sessions/{session_id}", response_model=StatusOut)
def api_revoke_mobile_auth_session(
    session_id: int,
    request: Request,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    context = _require_mobile_auth_context(request, db)
    mobile_session = db.scalar(
        select(MobileAuthSession).where(
            MobileAuthSession.id == session_id,
            MobileAuthSession.user_id == context.user.id,
        )
    )
    if mobile_session is None:
        raise HTTPException(status_code=404, detail="Mobile session not found")
    revoke_mobile_auth_session(db, mobile_session)
    db.commit()
    return {"status": "ok"}


def period_from_request(request: Request) -> Period:
    period_slug = request.query_params.get("period")
    start = request.query_params.get("start")
    end = request.query_params.get("end")
    try:
        return resolve_period(period_slug, start, end)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def filters_from_request(request: Request) -> TransactionFilters:
    type_param = request.query_params.get("type")
    category_param = request.query_params.get("category")
    query = request.query_params.get("q")
    txn_type = None
    if type_param:
        try:
            txn_type = TransactionType(type_param)
        except ValueError:
            txn_type = None
    category_id = None
    if category_param:
        try:
            category_id = int(category_param)
        except ValueError:
            category_id = None

    tag_param = request.query_params.get("tag")
    tag_id = None
    if tag_param:
        try:
            tag_id = int(tag_param)
        except ValueError:
            tag_id = None

    return TransactionFilters(
        type=txn_type,
        category_id=category_id,
        query=query,
        tag_id=tag_id,
    )


def _serialize_attachment(attachment) -> dict[str, object]:
    return {
        "id": attachment.id,
        "transaction_id": attachment.transaction_id,
        "original_filename": attachment.original_filename,
        "mime_type": attachment.mime_type,
        "size_bytes": attachment.size_bytes,
        "sha256_hex": attachment.sha256_hex,
        "created_at": attachment.created_at.isoformat(),
    }


def _serialize_balance_anchor(anchor) -> dict[str, object]:
    return {
        "id": anchor.id,
        "as_of_at": anchor.as_of_at.isoformat() if anchor.as_of_at else None,
        "balance_cents": anchor.balance_cents,
        "note": anchor.note,
    }


def _serialize_ingest_token_metadata(
    ingest_token: UserIngestToken,
) -> dict[str, str | None]:
    return {
        "token_hint": ingest_token.token_hint,
        "created_at": ingest_token.created_at.isoformat(),
        "updated_at": ingest_token.updated_at.isoformat(),
        "last_used_at": ingest_token.last_used_at.isoformat()
        if ingest_token.last_used_at
        else None,
    }


def _user_settings_payload(db: Session, user_id: int) -> dict[str, object]:
    settings = get_settings()
    balance_service = BalanceAnchorService(db, user_id=user_id)
    balance_anchors = balance_service.list_all()
    current_balance = balance_service.balance_as_of(
        datetime.now(ZoneInfo(settings.timezone)).replace(tzinfo=None)
    )
    ingest_token = get_user_ingest_token(db, user_id)
    return {
        "current_balance": current_balance,
        "balance_anchors": [
            _serialize_balance_anchor(anchor) for anchor in balance_anchors
        ],
        "ingest_token": _serialize_ingest_token_metadata(ingest_token)
        if ingest_token
        else None,
    }


def _csv_export_response(
    db: Session,
    *,
    transactions: list[Transaction],
    actor_user_id: int,
    log_event_name: str,
) -> StreamingResponse:
    csv_text = CSVService(db, user_id=actor_user_id).export(transactions)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"expenses_export_{timestamp}.csv"
    log_event(
        logger,
        logging.INFO,
        log_event_name,
        filename=filename,
        transactions_count=len(transactions),
    )
    return StreamingResponse(
        iter([csv_text]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _rebuild_rollups_for_all_users(db: Session) -> int:
    user_ids = [int(row.id) for row in db.execute(select(User.id)).all()]
    for user_id in user_ids:
        rebuild_monthly_rollups(db, user_id=user_id)
    return len(user_ids)


def _purge_deleted_for_all_users(db: Session, cutoff_date: datetime) -> tuple[int, int]:
    user_ids = [int(row.id) for row in db.execute(select(User.id)).all()]
    deleted_count = 0
    deleted_attachments = 0
    for user_id in user_ids:
        count, attachments = TransactionService(
            db, user_id=user_id
        ).purge_deleted_before(cutoff_date)
        deleted_count += count
        deleted_attachments += attachments
    return deleted_count, deleted_attachments


def _occurred_at_iso(value: datetime | None) -> str | None:
    """Serialize an occurred_at as a timezone-aware ISO string.

    occurred_at is stored as a naive datetime in the configured local zone. Emitting
    it without an offset is ambiguous: clients that assume UTC (the native iOS app)
    render it shifted by the local offset. Attaching the configured zone makes the
    wall-clock unambiguous while staying correct across DST.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=ZoneInfo(get_settings().timezone))
    return value.isoformat()


def _serialize_transaction_item(txn: Transaction) -> dict[str, object]:
    return {
        "id": txn.id,
        "date": txn.date.isoformat(),
        "occurred_at": _occurred_at_iso(txn.occurred_at),
        "type": txn.type.value,
        "amount_cents": txn.amount_cents,
        "net_amount_cents": txn.net_amount_cents,
        "reimbursed_total_cents": txn.reimbursed_total_cents,
        "is_reimbursement": txn.is_reimbursement,
        "category": (
            {
                "id": txn.category.id,
                "name": txn.category.name,
                "type": txn.category.type.value,
                "icon": txn.category.icon,
            }
            if txn.category
            else None
        ),
        "title": txn.title,
        "description": txn.description,
        "latitude": float(txn.latitude) if txn.latitude is not None else None,
        "longitude": float(txn.longitude) if txn.longitude is not None else None,
        "tags": [{"id": tag.id, "name": tag.name} for tag in txn.tags],
        "has_attachments": bool(txn.attachments),
    }


def _serialize_template_item(template) -> dict[str, object]:
    tags = json.loads(template.tags_json) if template.tags_json else []
    return {
        "id": template.id,
        "name": template.name,
        "type": template.type.value,
        "category_id": template.category_id,
        "category": (
            {
                "id": template.category.id,
                "name": template.category.name,
                "type": template.category.type.value,
                "icon": template.category.icon,
            }
            if template.category
            else None
        ),
        "default_amount_cents": template.default_amount_cents,
        "title": template.title,
        "tags": tags,
        "sort_order": template.sort_order,
    }


def _db_path_from_url(url: str) -> Path | None:
    for prefix in ("sqlite+pysqlite:///", "sqlite:///"):
        if url.startswith(prefix):
            return Path(url[len(prefix) :]).resolve()
    return None


def _filters_from_bulk_query(
    period_slug: str | None,
    start: str | None,
    end: str | None,
    txn_type: TransactionType | None,
    category_id: int | None,
    matched_category_ids: list[int] | None,
    tag_id: int | None,
    query: str | None,
) -> tuple[Period, TransactionFilters]:
    try:
        period = resolve_period(period_slug, start, end)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return period, TransactionFilters(
        type=txn_type,
        category_id=category_id,
        matched_category_ids=matched_category_ids,
        query=query,
        tag_id=tag_id,
    )


def _resolve_bulk_transactions(
    payload: BulkEditRequestIn, db: Session, user_id: int
) -> tuple[list[Transaction], int]:
    max_items = 1000
    txn_service = TransactionService(db, user_id=user_id)
    lifecycle = payload.operation.lifecycle
    include_deleted = lifecycle == "restore"

    if payload.selection.mode == "ids":
        requested_ids = [int(i) for i in payload.selection.transaction_ids]
        if len(requested_ids) > max_items:
            raise HTTPException(status_code=400, detail=f"Maximum {max_items} ids")
        stmt = (
            select(Transaction)
            .options(
                joinedload(Transaction.category),
                joinedload(Transaction.tags),
                joinedload(Transaction.attachments),
            )
            .where(
                Transaction.user_id == user_id,
                Transaction.id.in_(requested_ids),
            )
        )
        if include_deleted:
            stmt = stmt.where(Transaction.deleted_at.isnot(None))
        else:
            stmt = stmt.where(Transaction.deleted_at.is_(None))
        transactions = db.scalars(stmt).unique().all()
        return transactions, len(requested_ids) - len(transactions)

    query = payload.selection.query
    if query is None:
        raise HTTPException(
            status_code=400, detail="Query required for query selection mode"
        )
    period, filters = _filters_from_bulk_query(
        query.period,
        query.start.isoformat() if query.start else None,
        query.end.isoformat() if query.end else None,
        query.type,
        query.category,
        query.matched_category_ids,
        query.tag,
        query.q,
    )
    if include_deleted:
        rows = txn_service.list_deleted_for_period(period, filters, limit=max_items + 1)
    else:
        rows = txn_service.list_for_period(period, filters, limit=max_items + 1)
    if len(rows) > max_items:
        raise HTTPException(
            status_code=400,
            detail=f"Selection exceeds maximum of {max_items} transactions",
        )
    return rows, 0


@router.get("/api/csrf")
def api_csrf(request: Request, db: Session = Depends(get_db)) -> dict[str, str]:
    auth_session = resolve_auth_context(request, db).auth_session
    if auth_session is None:
        return {"token": generate_csrf_token()}
    return {
        "token": generate_csrf_token(
            session_id=auth_session.id,
            session_csrf_secret=auth_session.csrf_secret,
        )
    }


@router.post("/api/recurring/preview", response_model=RecurringPreviewOut)
async def preview_recurring_occurrences(data: RecurringPreviewIn):
    occurrences = [data.start_date]
    current_date = data.start_date

    for _ in range(3):
        try:
            next_date = calculate_next_date(data, current_date)
            occurrences.append(next_date)
            current_date = next_date
        except (ValueError, OverflowError):
            break

    return {"occurrences": occurrences}


@router.post("/api/ingest", response_model=IngestTransactionOut, status_code=201)
async def api_ingest(
    data: IngestTransactionIn, request: Request, db: Session = Depends(get_db)
):
    ingest_token = _require_ingest_token(request, db)
    user_id = ingest_token.user_id
    payload_fields = await read_captured_request_body(request, get_settings())
    try:
        touch_user_ingest_token(ingest_token)
        result = IngestService(db, user_id=user_id).ingest_expense(data)
    except IngestCategoryNotFound as exc:
        log_event(
            logger,
            logging.WARNING,
            "ingest_request_rejected",
            reason="category_not_found",
            **(payload_fields or {}),
        )
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except IngestCategoryAmbiguous as exc:
        log_event(
            logger,
            logging.WARNING,
            "ingest_request_rejected",
            reason="category_ambiguous",
            **(payload_fields or {}),
        )
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        log_event(
            logger,
            logging.WARNING,
            "ingest_request_rejected",
            reason="invalid_payload",
            **(payload_fields or {}),
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    txn = result.transaction
    ingest_fields = {
        key: value
        for key, value in dict(txn._ingest_log_fields).items()
        if key != "category_input"
    }
    log_event(
        logger,
        logging.INFO,
        "ingest_request_succeeded",
        transaction_id=txn.id,
        **ingest_fields,
        **(payload_fields or {}),
    )
    return IngestTransactionOut(
        id=txn.id,
        date=txn.date,
        occurred_at=txn.occurred_at,
        type="expense",
        amount_cents=txn.amount_cents,
        category=txn.category.name,
        title=txn.title or "",
        latitude=float(txn.latitude) if txn.latitude is not None else None,
        longitude=float(txn.longitude) if txn.longitude is not None else None,
        location_status=result.location_status,
    )


@router.get("/api/kpis")
def api_kpis(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    period = period_from_request(request)
    metrics = MetricsService(db, user_id=user_id).kpis(period)
    return metrics


@router.get("/api/category-breakdown")
def api_category_breakdown(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    period = period_from_request(request)
    if request.query_params.get("view") == "monthly":
        return {
            "months": InsightsService(db, user_id=user_id).monthly_category_bands(
                end=period.end, months_back=6
            )
        }
    data = MetricsService(db, user_id=user_id).category_breakdown(period)
    return data


@router.get("/api/categories", response_model=CategoriesResponseOut)
def api_categories(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    period = period_from_request(request)
    category_service = CategoryService(db, user_id=user_id)
    categories = category_service.list_all(include_archived=True)
    usage_stmt = (
        select(Transaction.category_id, func.count().label("usage"))
        .where(
            Transaction.user_id == category_service.user_id,
            Transaction.deleted_at.is_(None),
        )
        .group_by(Transaction.category_id)
    )
    if period.slug == "all":
        usage_stmt = usage_stmt.where(Transaction.date >= period.start)
    else:
        usage_stmt = usage_stmt.where(
            Transaction.date.between(period.start, period.end)
        )
    usage_rows = db.execute(usage_stmt).all()
    usage_map = {row.category_id: int(row.usage or 0) for row in usage_rows}
    return {
        "period": {
            "slug": period.slug,
            "start": period.start.isoformat(),
            "end": period.end.isoformat(),
        },
        "categories": [
            {
                "id": category.id,
                "name": category.name,
                "type": category.type.value,
                "icon": category.icon,
                "order": category.order,
                "archived_at": (
                    category.archived_at.isoformat() if category.archived_at else None
                ),
                "usage_count": int(usage_map.get(category.id, 0)),
            }
            for category in categories
        ],
    }


@router.post("/api/categories", response_model=CategoryOut)
def api_create_category(
    data: CategoryIn, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        category = CategoryService(db, user_id=user_id).create(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "id": category.id,
        "name": category.name,
        "type": category.type.value,
        "icon": category.icon,
        "order": category.order,
        "archived_at": category.archived_at.isoformat()
        if category.archived_at
        else None,
    }


@router.put("/api/categories/{category_id}", response_model=CategoryOut)
def api_update_category(
    category_id: int,
    data: CategoryUpdateIn,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        category = CategoryService(db, user_id=user_id).update(category_id, data)
    except ValueError as exc:
        status_code = 404 if str(exc) == "Category not found" else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    return {
        "id": category.id,
        "name": category.name,
        "type": category.type.value,
        "icon": category.icon,
        "order": category.order,
        "archived_at": category.archived_at.isoformat()
        if category.archived_at
        else None,
    }


@router.post("/api/categories/{category_id}/archive", response_model=StatusOut)
def api_archive_category(
    category_id: int, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        CategoryService(db, user_id=user_id).archive(category_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok"}


@router.post("/api/categories/{category_id}/restore", response_model=StatusOut)
def api_restore_category(
    category_id: int, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        CategoryService(db, user_id=user_id).restore(category_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok"}


@router.post("/api/categories/merge/preview", response_model=CategoryMergeResponseOut)
def api_category_merge_preview(
    data: CategoryMergeIn, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        counts = CategoryService(db, user_id=user_id).merge_preview(
            data.source_category_id, data.target_category_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"counts": counts}


@router.post("/api/categories/merge", response_model=CategoryMergeResponseOut)
def api_category_merge(
    data: CategoryMergeIn, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        counts = CategoryService(db, user_id=user_id).merge(
            data.source_category_id, data.target_category_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"counts": counts}


@router.get("/api/tags", response_model=TagsResponseOut)
def api_tags(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    period = period_from_request(request)
    tag_service = TagService(db, user_id=user_id)
    tags = tag_service.list_all()
    usage_stmt = (
        select(transaction_tags.c.tag_id, func.count().label("usage"))
        .select_from(transaction_tags)
        .join(Transaction, Transaction.id == transaction_tags.c.transaction_id)
        .where(
            Transaction.user_id == tag_service.user_id,
            Transaction.deleted_at.is_(None),
        )
        .group_by(transaction_tags.c.tag_id)
    )
    if period.slug == "all":
        usage_stmt = usage_stmt.where(Transaction.date >= period.start)
    else:
        usage_stmt = usage_stmt.where(
            Transaction.date.between(period.start, period.end)
        )
    usage_rows = db.execute(usage_stmt).all()
    usage_map = {row.tag_id: int(row.usage or 0) for row in usage_rows}
    return {
        "period": {
            "slug": period.slug,
            "start": period.start.isoformat(),
            "end": period.end.isoformat(),
        },
        "tags": [
            {
                "id": tag.id,
                "name": tag.name,
                "color": tag.color,
                "is_hidden_from_budget": tag.is_hidden_from_budget,
                "usage_count": int(usage_map.get(tag.id, 0)),
            }
            for tag in tags
        ],
    }


@router.post("/api/tags", response_model=TagMutationOut)
def api_create_tag(data: TagIn, request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        tag = TagService(db, user_id=user_id).create(
            data.name, data.is_hidden_from_budget, data.color
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "id": tag.id,
        "name": tag.name,
        "color": tag.color,
        "is_hidden_from_budget": tag.is_hidden_from_budget,
    }


@router.get("/api/tags/{tag_id}")
def api_tag_detail(tag_id: int, request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    tag = db.get(Tag, tag_id)
    if not tag or tag.user_id != user_id:
        raise HTTPException(status_code=404, detail="Tag not found")

    period = period_from_request(request)
    metrics_service = MetricsService(db, user_id=user_id)
    txn_service = TransactionService(db, user_id=user_id)
    kpis = metrics_service.kpis(period, tag_ids=[tag_id])
    sparklines = metrics_service.kpi_sparklines(period, tag_ids=[tag_id])
    expense_breakdown = metrics_service.category_breakdown(
        period, TransactionType.expense, tag_ids=[tag_id]
    )
    income_breakdown = metrics_service.category_breakdown(
        period, TransactionType.income, tag_ids=[tag_id]
    )
    has_any = kpis["income"] > 0 or kpis["expenses"] > 0
    filters = TransactionFilters(tag_id=tag_id)
    transactions = txn_service.list_for_period(period, filters, limit=50)

    return {
        "tag": {
            "id": tag.id,
            "name": tag.name,
            "color": tag.color,
            "is_hidden_from_budget": tag.is_hidden_from_budget,
        },
        "period": {
            "slug": period.slug,
            "start": period.start.isoformat(),
            "end": period.end.isoformat(),
        },
        "kpis": kpis,
        "sparklines": sparklines,
        "donut": {
            "mode": "both",
            "expense_breakdown": expense_breakdown,
            "income_breakdown": income_breakdown,
            "has_any_transactions": has_any,
        },
        "transactions": [
            {
                "id": txn.id,
                "date": txn.date.isoformat(),
                "occurred_at": _occurred_at_iso(txn.occurred_at),
                "type": txn.type.value,
                "amount_cents": txn.amount_cents,
                "net_amount_cents": txn.net_amount_cents,
                "reimbursed_total_cents": txn.reimbursed_total_cents,
                "is_reimbursement": txn.is_reimbursement,
                "category": (
                    {
                        "id": txn.category.id,
                        "name": txn.category.name,
                        "type": txn.category.type.value,
                        "icon": txn.category.icon,
                    }
                    if txn.category
                    else None
                ),
                "title": txn.title,
                "description": txn.description,
                "tags": [{"id": t.id, "name": t.name} for t in txn.tags],
            }
            for txn in transactions
        ],
    }


@router.put("/api/tags/{tag_id}", response_model=TagMutationOut)
def api_update_tag(
    tag_id: int, data: TagIn, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        tag = TagService(db, user_id=user_id).update(
            tag_id, data.name, data.is_hidden_from_budget, data.color
        )
    except ValueError as exc:
        status = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status, detail=str(exc)) from exc
    return {
        "id": tag.id,
        "name": tag.name,
        "color": tag.color,
        "is_hidden_from_budget": tag.is_hidden_from_budget,
    }


@router.delete("/api/tags/{tag_id}", response_model=StatusOut)
def api_delete_tag(tag_id: int, request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        TagService(db, user_id=user_id).delete(tag_id)
    except ValueError as exc:
        status = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status, detail=str(exc)) from exc
    return {"status": "ok"}


@router.post("/api/tags/merge/preview", response_model=TagMergeResponseOut)
def api_tag_merge_preview(
    data: TagMergeIn, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        counts = TagService(db, user_id=user_id).merge_preview(
            data.source_tag_id, data.target_tag_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"counts": counts}


@router.post("/api/tags/merge", response_model=TagMergeResponseOut)
def api_tag_merge(data: TagMergeIn, request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        counts = TagService(db, user_id=user_id).merge(
            data.source_tag_id, data.target_tag_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"counts": counts}


@router.get("/api/templates", response_model=TemplatesResponseOut)
def api_templates(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    templates = TransactionTemplateService(db, user_id=user_id).list_all()
    return {"templates": [_serialize_template_item(template) for template in templates]}


@router.post("/api/templates", response_model=TransactionTemplateOut)
def api_create_template(
    data: TransactionTemplateIn, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        template = TransactionTemplateService(db, user_id=user_id).create(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _serialize_template_item(template)


@router.put("/api/templates/{template_id}", response_model=TransactionTemplateOut)
def api_update_template(
    template_id: int,
    data: TransactionTemplateIn,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        template = TransactionTemplateService(db, user_id=user_id).update(
            template_id, data
        )
    except ValueError as exc:
        status = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=status, detail=str(exc)) from exc
    return _serialize_template_item(template)


@router.delete("/api/templates/{template_id}", response_model=StatusOut)
def api_delete_template(
    template_id: int, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        TransactionTemplateService(db, user_id=user_id).delete(template_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok"}


@router.post("/api/templates/reorder", response_model=StatusOut)
def api_reorder_templates(
    data: TemplateReorderIn, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        TransactionTemplateService(db, user_id=user_id).reorder(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok"}


@router.get("/api/budgets", response_model=BudgetsResponseOut)
def api_budgets(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    today = date.today()
    view = (request.query_params.get("view") or "month").strip().lower()
    if view not in {"month", "templates", "year"}:
        view = "month"

    ym = request.query_params.get("month")
    if ym:
        try:
            year_str, month_str = ym.split("-", 1)
            year = int(year_str)
            month = int(month_str)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="Invalid month format") from exc
        if month < 1 or month > 12:
            raise HTTPException(status_code=400, detail="Invalid month value")
    else:
        year = today.year
        month = today.month

    svc = BudgetService(db, user_id=user_id)
    month_value = f"{year:04d}-{month:02d}"

    effective_budgets = []
    progress_map: dict[Optional[int], dict[str, int]] = {}
    if view == "month":
        effective_budgets = svc.effective_budgets_for_month(year, month)
        progress_map = svc.progress_for_month(year, month)

    templates = []
    if view == "templates":
        templates = svc.list_templates()

    year_value = int(request.query_params.get("year") or today.year)
    yearly_budgets = []
    yearly_spent_map: dict[Optional[int], int] = {}
    if view == "year":
        yearly_budgets = svc.yearly_budgets_for_year(year_value)
        yearly_spent_map = svc.spent_by_category_for_year(year_value)

    categories = CategoryService(db, user_id=user_id).list_all()

    return {
        "view": view,
        "year": year,
        "month": month,
        "month_value": month_value,
        "budgets": [
            {
                "scope_category_id": row.scope_category_id,
                "scope_label": row.scope_label,
                "amount_cents": row.amount_cents,
                "source": row.source,
                "source_id": row.source_id,
            }
            for row in effective_budgets
        ],
        "progress": [
            {
                "scope_category_id": scope_id,
                "spent_cents": values.get("spent_cents", 0),
                "remaining_cents": values.get("remaining_cents", 0),
                "velocity_ratio": values.get("velocity_ratio", 0.0),
                "daily_remaining_cents": values.get("daily_remaining_cents", 0),
                "projected_total_cents": values.get("projected_total_cents", 0),
                "days_elapsed": values.get("days_elapsed", 0),
                "days_remaining": values.get("days_remaining", 0),
            }
            for scope_id, values in progress_map.items()
        ],
        "categories": [
            {
                "id": category.id,
                "name": category.name,
                "type": category.type.value,
                "icon": category.icon,
                "archived_at": (
                    category.archived_at.isoformat() if category.archived_at else None
                ),
            }
            for category in categories
        ],
        "templates": [
            {
                "id": tmpl.id,
                "frequency": tmpl.frequency.value,
                "category": (
                    {
                        "id": tmpl.category.id,
                        "name": tmpl.category.name,
                        "icon": tmpl.category.icon,
                    }
                    if tmpl.category
                    else None
                ),
                "amount_cents": tmpl.amount_cents,
                "starts_on": tmpl.starts_on.isoformat(),
                "ends_on": tmpl.ends_on.isoformat() if tmpl.ends_on else None,
            }
            for tmpl in templates
        ],
        "year_value": year_value,
        "yearly_budgets": [
            {
                "scope_category_id": row.scope_category_id,
                "scope_label": row.scope_label,
                "amount_cents": row.amount_cents,
                "source": row.source,
                "source_id": row.source_id,
            }
            for row in yearly_budgets
        ],
        "yearly_spent": [
            {"scope_category_id": scope_id, "spent_cents": spent}
            for scope_id, spent in yearly_spent_map.items()
        ],
        "default_month_template_start": f"{today.year:04d}-{today.month:02d}-01",
        "default_year_template_start": f"{today.year:04d}-01-01",
    }


@router.get("/api/budgets/burndown", response_model=BudgetBurndownResponseOut)
def api_budget_burndown(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    today = date.today()
    month_param = (request.query_params.get("month") or "").strip()
    if month_param:
        try:
            year_str, month_str = month_param.split("-", 1)
            year = int(year_str)
            month = int(month_str)
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="Invalid month format") from exc
        if month < 1 or month > 12:
            raise HTTPException(status_code=400, detail="Invalid month value")
    else:
        year = today.year
        month = today.month

    scope_param = (request.query_params.get("scope") or "overall").strip()
    if scope_param == "overall":
        scope_category_id = None
    else:
        try:
            scope_category_id = int(scope_param)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid scope value") from exc

    compare_param = (request.query_params.get("compare_month") or "").strip()
    compare_year: int | None = None
    compare_month: int | None = None
    if compare_param:
        try:
            compare_year_str, compare_month_str = compare_param.split("-", 1)
            compare_year = int(compare_year_str)
            compare_month = int(compare_month_str)
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=400, detail="Invalid compare_month format"
            ) from exc
        if compare_month < 1 or compare_month > 12:
            raise HTTPException(status_code=400, detail="Invalid compare_month value")

    return BudgetService(db, user_id=user_id).burndown_for_month(
        year,
        month,
        scope_category_id=scope_category_id,
        compare_year=compare_year,
        compare_month=compare_month,
    )


@router.post("/api/budgets/overrides", response_model=BudgetOverrideOut)
def api_upsert_budget_override(
    data: BudgetOverrideIn, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        override = BudgetService(db, user_id=user_id).upsert_override(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "id": override.id,
        "year": override.year,
        "month": override.month,
        "category_id": override.category_id,
        "amount_cents": override.amount_cents,
    }


@router.delete("/api/budgets/overrides/{override_id}", response_model=StatusOut)
def api_delete_budget_override(
    override_id: int, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        BudgetService(db, user_id=user_id).delete_override(override_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok"}


@router.post("/api/budgets/templates", response_model=BudgetTemplateMutationOut)
def api_upsert_budget_template(
    data: BudgetTemplateIn, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        tmpl = BudgetService(db, user_id=user_id).upsert_template(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "id": tmpl.id,
        "frequency": tmpl.frequency.value,
        "category_id": tmpl.category_id,
        "amount_cents": tmpl.amount_cents,
        "starts_on": tmpl.starts_on.isoformat(),
        "ends_on": tmpl.ends_on.isoformat() if tmpl.ends_on else None,
    }


@router.delete("/api/budgets/templates/{template_id}", response_model=StatusOut)
def api_delete_budget_template(
    template_id: int, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        BudgetService(db, user_id=user_id).delete_template(template_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok"}


@router.get("/api/recurring", response_model=RecurringResponseOut)
def api_recurring_rules(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    service = RecurringRuleService(db, user_id=user_id)
    overview_rules, stats = service.overview()
    categories = CategoryService(db, user_id=user_id).list_all()
    return {
        "rules": [
            {
                "id": item.rule.id,
                "name": item.rule.name,
                "type": item.rule.type.value,
                "currency_code": item.rule.currency_code.value,
                "amount_cents": item.rule.amount_cents,
                "monthly_equivalent_cents": item.monthly_equivalent_cents,
                "category_id": item.rule.category_id,
                "category": (
                    {
                        "id": item.rule.category.id,
                        "name": item.rule.category.name,
                        "type": item.rule.category.type.value,
                        "icon": item.rule.category.icon,
                    }
                    if item.rule.category
                    else None
                ),
                "anchor_date": item.rule.anchor_date.isoformat(),
                "interval_unit": item.rule.interval_unit.value,
                "interval_count": item.rule.interval_count,
                "next_occurrence": item.rule.next_occurrence.isoformat(),
                "end_date": (
                    item.rule.end_date.isoformat() if item.rule.end_date else None
                ),
                "auto_post": item.rule.auto_post,
                "skip_weekends": item.rule.skip_weekends,
                "month_day_policy": item.rule.month_day_policy.value,
            }
            for item in overview_rules
        ],
        "stats": stats,
        "categories": [
            {
                "id": category.id,
                "name": category.name,
                "type": category.type.value,
                "icon": category.icon,
            }
            for category in categories
        ],
    }


@router.post("/api/recurring", response_model=IdOut)
def api_create_recurring_rule(
    data: RecurringRuleIn, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        rule = RecurringRuleService(db, user_id=user_id).create(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": rule.id}


@router.put("/api/recurring/{rule_id}", response_model=IdOut)
def api_update_recurring_rule(
    rule_id: int, data: RecurringRuleIn, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        rule = RecurringRuleService(db, user_id=user_id).update(rule_id, data)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"id": rule.id}


@router.post("/api/recurring/{rule_id}/toggle", response_model=StatusOut)
def api_toggle_recurring_rule(
    rule_id: int,
    data: RecurringToggleIn,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        RecurringRuleService(db, user_id=user_id).toggle_auto_post(
            rule_id, data.auto_post
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok"}


@router.delete("/api/recurring/{rule_id}", response_model=StatusOut)
def api_delete_recurring_rule(
    rule_id: int, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        RecurringRuleService(db, user_id=user_id).delete(rule_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok"}


@router.get(
    "/api/recurring/{rule_id}/occurrences",
    response_model=RecurringOccurrencesResponseOut,
)
def api_recurring_occurrences(
    request: Request, rule_id: int, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    service = RecurringRuleService(db, user_id=user_id)
    try:
        rule = service.get(rule_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    stmt = (
        select(Transaction)
        .options(joinedload(Transaction.category))
        .where(
            Transaction.user_id == service.user_id,
            Transaction.origin_rule_id == rule_id,
            Transaction.deleted_at.is_(None),
        )
        .order_by(Transaction.occurrence_date.desc())
    )
    occurrences = db.scalars(stmt).all()

    return {
        "rule": {
            "id": rule.id,
            "name": rule.name,
            "type": rule.type.value,
            "currency_code": rule.currency_code.value,
            "amount_cents": rule.amount_cents,
            "category": (
                {
                    "id": rule.category.id,
                    "name": rule.category.name,
                    "type": rule.category.type.value,
                    "icon": rule.category.icon,
                }
                if rule.category
                else None
            ),
            "interval_unit": rule.interval_unit.value,
            "interval_count": rule.interval_count,
            "anchor_date": rule.anchor_date.isoformat(),
            "next_occurrence": rule.next_occurrence.isoformat(),
            "end_date": rule.end_date.isoformat() if rule.end_date else None,
            "auto_post": rule.auto_post,
        },
        "occurrences": [
            {
                "id": txn.id,
                "occurrence_date": (
                    txn.occurrence_date.isoformat() if txn.occurrence_date else None
                ),
                "amount_cents": txn.amount_cents,
                "category": (
                    {
                        "id": txn.category.id,
                        "name": txn.category.name,
                        "icon": txn.category.icon,
                    }
                    if txn.category
                    else None
                ),
                "title": txn.title,
                "created_at": txn.created_at.isoformat() if txn.created_at else None,
            }
            for txn in occurrences
        ],
    }


@router.get("/api/rules", response_model=RulesResponseOut)
def api_rules(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    rules = RuleService(db, user_id=user_id).list_all()
    categories = CategoryService(db, user_id=user_id).list_all()
    tags = TagService(db, user_id=user_id).list_all()
    return {
        "rules": [
            {
                "id": rule.id,
                "name": rule.name,
                "enabled": rule.enabled,
                "priority": rule.priority,
                "match_type": rule.match_type.value,
                "match_value": rule.match_value,
                "transaction_type": rule.transaction_type.value
                if rule.transaction_type
                else None,
                "min_amount_cents": rule.min_amount_cents,
                "max_amount_cents": rule.max_amount_cents,
                "set_category_id": rule.set_category_id,
                "set_category": (
                    {
                        "id": rule.set_category.id,
                        "name": rule.set_category.name,
                        "type": rule.set_category.type.value,
                        "icon": rule.set_category.icon,
                    }
                    if rule.set_category
                    else None
                ),
                "add_tags": json.loads(rule.add_tags_json)
                if rule.add_tags_json
                else [],
                "budget_exclude_tag_id": rule.budget_exclude_tag_id,
                "budget_exclude_tag": (
                    {
                        "id": rule.budget_exclude_tag.id,
                        "name": rule.budget_exclude_tag.name,
                    }
                    if rule.budget_exclude_tag
                    else None
                ),
            }
            for rule in rules
        ],
        "categories": [
            {
                "id": category.id,
                "name": category.name,
                "type": category.type.value,
                "icon": category.icon,
            }
            for category in categories
        ],
        "tags": [
            {
                "id": tag.id,
                "name": tag.name,
                "is_hidden_from_budget": tag.is_hidden_from_budget,
            }
            for tag in tags
        ],
    }


@router.post("/api/rules", response_model=IdOut)
def api_create_rule(data: RuleIn, request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        rule = RuleService(db, user_id=user_id).create(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": rule.id}


@router.put("/api/rules/{rule_id}", response_model=IdOut)
def api_update_rule(
    rule_id: int, data: RuleIn, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        rule = RuleService(db, user_id=user_id).update(rule_id, data)
    except ValueError as exc:
        status_code = 404 if str(exc).endswith("not found") else 400
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
    return {"id": rule.id}


@router.post("/api/rules/{rule_id}/toggle", response_model=StatusOut)
def api_toggle_rule(
    rule_id: int,
    data: RuleToggleIn,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        RuleService(db, user_id=user_id).toggle(rule_id, data.enabled)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok"}


@router.delete("/api/rules/{rule_id}", response_model=StatusOut)
def api_delete_rule(rule_id: int, request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        RuleService(db, user_id=user_id).delete(rule_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok"}


@router.post("/api/rules/preview", response_model=RulePreviewOut)
def api_preview_rule(data: RuleIn, request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)

    recent = TransactionService(db, user_id=user_id).recent(limit=200)
    set_category = None
    if data.set_category_id is not None:
        set_category = db.get(Category, data.set_category_id)
        if not set_category or set_category.user_id != user_id:
            raise HTTPException(status_code=400, detail="Category not found")
        if data.transaction_type and set_category.type != data.transaction_type:
            raise HTTPException(status_code=400, detail="Category type mismatch")

    exclude_tag = None
    if data.budget_exclude_tag_id is not None:
        exclude_tag = db.get(Tag, data.budget_exclude_tag_id)
        if not exclude_tag or exclude_tag.user_id != user_id:
            raise HTTPException(status_code=400, detail="Tag not found")

    def matches(txn: Transaction) -> bool:
        if data.transaction_type and txn.type != data.transaction_type:
            return False
        if (
            data.min_amount_cents is not None
            and txn.amount_cents < data.min_amount_cents
        ):
            return False
        if (
            data.max_amount_cents is not None
            and txn.amount_cents > data.max_amount_cents
        ):
            return False
        title = (txn.title or "").strip()
        if not data.match_value:
            return False
        title_lower = title.lower()
        match_value_lower = data.match_value.lower()
        if data.match_type.value == "contains":
            return match_value_lower in title_lower
        if data.match_type.value == "equals":
            return title_lower == match_value_lower
        if data.match_type.value == "starts_with":
            return title_lower.startswith(match_value_lower)
        if data.match_type.value == "regex":
            try:
                return safe_regex_search(data.match_value, title)
            except RegexRejected:
                return False
        return False

    matches_count = 0
    sample: list[dict[str, object]] = []
    added_tags = set(data.add_tags)
    if exclude_tag:
        added_tags.add(exclude_tag.name)

    for txn in recent:
        if not matches(txn):
            continue
        matches_count += 1
        if len(sample) >= 10:
            continue
        before_category = txn.category.name if txn.category else "Uncategorized"
        after_category = before_category
        if set_category and set_category.type == txn.type:
            after_category = set_category.name
        sample.append(
            {
                "id": txn.id,
                "title": txn.title,
                "amount_cents": txn.amount_cents,
                "type": txn.type.value,
                "before_category": before_category,
                "after_category": after_category,
                "add_tags": sorted(added_tags),
            }
        )

    return {"matches_count": matches_count, "sample": sample}


@router.get(
    "/api/ai/rules/suggestions",
    response_model=list[RuleSuggestionOut],
    dependencies=[Depends(require_llm_enabled)],
)
def api_ai_rule_suggestions(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    return LLMAssistantService(db, user_id=user_id).pending_rule_suggestions()


@router.post(
    "/api/ai/rules/mine",
    response_model=list[RuleSuggestionOut],
    dependencies=[Depends(require_llm_enabled)],
)
async def api_ai_mine_rules(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    since_raw = request.query_params.get("since")
    since = None
    if since_raw:
        try:
            since = date.fromisoformat(since_raw)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid since date") from exc
    try:
        await LLMAssistantService(db, user_id=user_id).mine_rule_suggestions(
            since=since
        )
    except LLMDisabledError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return LLMAssistantService(db, user_id=user_id).pending_rule_suggestions()


@router.post(
    "/api/ai/rules/suggestions/{suggestion_id}/accept",
    response_model=IdOut,
    dependencies=[Depends(require_llm_enabled)],
)
def api_ai_accept_rule_suggestion(
    suggestion_id: int, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        rule_id = LLMAssistantService(db, user_id=user_id).accept_rule_suggestion(
            suggestion_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": rule_id}


@router.post(
    "/api/ai/rules/suggestions/{suggestion_id}/reject",
    response_model=IdOut,
    dependencies=[Depends(require_llm_enabled)],
)
def api_ai_reject_rule_suggestion(
    suggestion_id: int, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        rejected_id = LLMAssistantService(db, user_id=user_id).reject_rule_suggestion(
            suggestion_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": rejected_id}


@router.get("/api/admin/info", response_model=AdminInfoOut)
def api_admin_info(request: Request, db: Session = Depends(get_db)):
    _require_elevated_admin_context(request, db)
    settings = get_settings()
    db_path = (
        _db_path_from_url(settings.database_url) or Path("data/expenses.db").resolve()
    )
    db_size_bytes = db_path.stat().st_size if db_path.exists() else 0
    db_modified = (
        datetime.fromtimestamp(db_path.stat().st_mtime) if db_path.exists() else None
    )
    log_info = log_file_info(settings)
    users_count = int(db.scalar(select(func.count(User.id))) or 0)
    return {
        "app_version": APP_VERSION,
        "environment": environment_label(),
        "db_path": str(db_path),
        "db_size_mb": round(db_size_bytes / (1024 * 1024), 2) if db_size_bytes else 0,
        "db_modified": db_modified.isoformat() if db_modified else None,
        "log_path": log_info["path"],
        "log_size_mb": round(log_info["size_bytes"] / (1024 * 1024), 2)
        if log_info["size_bytes"]
        else 0,
        "log_modified": log_info["modified_at"],
        "log_retained_files": log_info["retained_files"],
        "users_count": users_count,
    }


@router.get("/api/admin/logs", response_model=AdminLogsResponseOut)
def api_admin_logs(
    request: Request,
    db: Session = Depends(get_db),
    limit: int = 50,
    cursor: str | None = None,
    level: str | None = None,
    event: str | None = None,
    request_id: str | None = None,
    path: str | None = None,
    status_code: int | None = None,
    error_only: bool = False,
    since: str | None = None,
    q: str | None = None,
):
    _require_elevated_admin_context(request, db)
    try:
        query = build_log_query(
            limit=limit,
            cursor=cursor,
            level=level,
            event=event,
            request_id=request_id,
            path=path,
            status_code=status_code,
            error_only=error_only,
            since=since,
            q=q,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    result = query_logs(get_settings(), query)
    return {"entries": result.entries, "next_cursor": result.next_cursor}


@router.get("/api/admin/system-health", response_model=AdminSystemHealthOut)
def api_admin_system_health(request: Request, db: Session = Depends(get_db)):
    _require_elevated_admin_context(request, db)
    try:
        import psutil
    except ImportError:
        psutil = None

    settings = get_settings()
    data_dir = Path(os.getenv("EXPENSES_DATA_DIR", "./data")).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    disk = shutil.disk_usage(data_dir)

    cpu_temp_celsius: float | None = None
    thermal_path = Path("/sys/class/thermal/thermal_zone0/temp")
    if thermal_path.exists():
        raw = thermal_path.read_text(encoding="utf-8").strip()
        if raw:
            try:
                cpu_temp_celsius = int(raw) / 1000.0
            except ValueError:
                cpu_temp_celsius = None

    if psutil is not None:
        cpu_load_percent = float(psutil.cpu_percent(interval=0.1))
        ram = psutil.virtual_memory()
        ram_used_bytes = int(ram.used)
        ram_total_bytes = int(ram.total)
    else:
        cpu_count = os.cpu_count() or 1
        load1 = os.getloadavg()[0] if hasattr(os, "getloadavg") else 0.0
        cpu_load_percent = float(min(100.0, max(0.0, load1 / cpu_count * 100)))
        if hasattr(os, "sysconf"):
            try:
                page_size = int(os.sysconf("SC_PAGE_SIZE"))
                total_pages = int(os.sysconf("SC_PHYS_PAGES"))
                available_pages = int(os.sysconf("SC_AVPHYS_PAGES"))
                ram_total_bytes = page_size * total_pages
                ram_used_bytes = max(0, ram_total_bytes - page_size * available_pages)
            except (ValueError, OSError):
                ram_total_bytes = 0
                ram_used_bytes = 0
        else:
            ram_total_bytes = 0
            ram_used_bytes = 0

    db_path = (
        _db_path_from_url(settings.database_url) or Path("data/expenses.db").resolve()
    )
    db_size_bytes = db_path.stat().st_size if db_path.exists() else 0

    receipts_size_bytes = 0
    if settings.receipts_dir.exists():
        receipts_size_bytes = sum(
            path.stat().st_size
            for path in settings.receipts_dir.rglob("*")
            if path.is_file()
        )

    validation_profile = _admin_system_health_override_profile(request)
    if validation_profile is not None:
        return _serialize_admin_system_health_override(
            validation_profile, db_size_bytes, receipts_size_bytes
        )

    free_ratio = disk.free / disk.total if disk.total else 0
    status = "healthy"
    if free_ratio < 0.1 or (cpu_temp_celsius is not None and cpu_temp_celsius > 80):
        status = "critical"
    elif free_ratio < 0.2 or (cpu_temp_celsius is not None and cpu_temp_celsius > 70):
        status = "warm"

    return {
        "cpu_temp_celsius": cpu_temp_celsius,
        "cpu_load_percent": cpu_load_percent,
        "ram_used_bytes": ram_used_bytes,
        "ram_total_bytes": ram_total_bytes,
        "disk_used_bytes": int(disk.used),
        "disk_total_bytes": int(disk.total),
        "disk_free_bytes": int(disk.free),
        "db_size_bytes": int(db_size_bytes),
        "receipts_size_bytes": int(receipts_size_bytes),
        "status": status,
    }


@router.get("/api/admin/system-health/validation-override")
def api_admin_system_health_validation_override_status(
    request: Request,
    db: Session = Depends(get_db),
):
    _require_elevated_admin_context(request, db)
    return {"profile": _admin_system_health_override_profile(request)}


@router.post("/api/admin/system-health/validation-override")
def api_set_admin_system_health_validation_override(
    data: dict[str, str],
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    _require_elevated_admin_context(request, db)
    _require_csrf(request, db)
    profile = str(data.get("profile", "")).lower()
    if profile not in ADMIN_SYSTEM_HEALTH_VALIDATION_PROFILES:
        raise HTTPException(
            status_code=400,
            detail="Invalid profile. Use healthy, warm, or critical.",
        )
    _set_admin_system_health_override_cookie(response, profile)
    return {"profile": profile}


@router.delete("/api/admin/system-health/validation-override")
def api_clear_admin_system_health_validation_override(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    _require_elevated_admin_context(request, db)
    _require_csrf(request, db)
    _clear_admin_system_health_override_cookie(response)
    return {"profile": None}


@router.get("/api/admin/download-db", response_class=StreamingResponse)
def api_admin_download_db(
    request: Request,
    db: Session = Depends(get_db),
) -> Response:
    _require_elevated_admin_context(request, db)
    settings = get_settings()
    db_path = (
        _db_path_from_url(settings.database_url) or Path("data/expenses.db").resolve()
    )
    if not db_path.exists():
        raise HTTPException(status_code=404, detail="Database not found")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"expenses_backup_{timestamp}.db"
    log_event(
        logger,
        logging.INFO,
        "admin_database_backup_downloaded",
        filename=filename,
        size_bytes=db_path.stat().st_size,
    )

    if settings.database_url.startswith("sqlite"):
        with tempfile.NamedTemporaryFile(
            prefix="expenses_backup_",
            suffix=".db",
            delete=False,
        ) as snapshot_file:
            snapshot_path = Path(snapshot_file.name)

        backup_complete = False
        source: sqlite3.Connection | None = None
        destination: sqlite3.Connection | None = None
        try:
            source = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            destination = sqlite3.connect(snapshot_path)
            source.backup(destination)
            backup_complete = True
        finally:
            if destination is not None:
                destination.close()
            if source is not None:
                source.close()
            if not backup_complete:
                snapshot_path.unlink(missing_ok=True)

        return FileResponse(
            snapshot_path,
            media_type="application/octet-stream",
            filename=filename,
            background=BackgroundTask(snapshot_path.unlink, missing_ok=True),
        )

    def iter_file(path: Path, chunk_size: int = 1024 * 1024):
        with open(path, "rb") as f:
            while True:
                chunk = f.read(chunk_size)
                if not chunk:
                    break
                yield chunk

    return StreamingResponse(
        iter_file(db_path),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/api/export/csv")
def api_export_user_csv(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    transactions = TransactionService(db, user_id=user_id).recent(limit=10000)
    return _csv_export_response(
        db,
        transactions=transactions,
        actor_user_id=user_id,
        log_event_name="user_csv_export_downloaded",
    )


@router.get("/api/export/portable.zip", response_class=FileResponse)
def api_export_user_portable_zip(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"expenses_portable_export_{timestamp}.zip"
    with tempfile.NamedTemporaryFile(
        prefix="expenses_portable_export_",
        suffix=".zip",
        delete=False,
    ) as export_file:
        export_path = Path(export_file.name)

    try:
        manifest = PortableExportService(db, user_id=user_id).write_zip(
            export_path,
            app_version=APP_VERSION,
        )
    except PortableExportError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    datasets = manifest["datasets"]
    dataset_counts = {
        name: metadata["row_count"] for name, metadata in datasets.items()
    }
    attachments = manifest["attachments"]
    log_event(
        logger,
        logging.INFO,
        "user_portable_export_downloaded",
        filename=filename,
        size_bytes=export_path.stat().st_size,
        dataset_counts=dataset_counts,
        attachment_count=attachments["included_count"],
    )
    return FileResponse(
        export_path,
        media_type="application/zip",
        filename=filename,
        background=BackgroundTask(export_path.unlink, missing_ok=True),
    )


@router.get("/api/admin/export-csv")
def api_admin_export_all_transactions(request: Request, db: Session = Depends(get_db)):
    _require_elevated_admin_context(request, db)
    actor_user_id = _require_current_user_id(request, db)
    transactions = (
        db.scalars(
            select(Transaction)
            .options(joinedload(Transaction.category), joinedload(Transaction.tags))
            .where(Transaction.deleted_at.is_(None))
            .order_by(Transaction.occurred_at.desc(), Transaction.id.desc())
            .limit(10000)
        )
        .unique()
        .all()
    )
    return _csv_export_response(
        db,
        transactions=transactions,
        actor_user_id=actor_user_id,
        log_event_name="admin_csv_export_downloaded",
    )


@router.get("/api/settings", response_model=SettingsResponseOut)
def api_settings(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    return _user_settings_payload(db, user_id)


@router.post(
    "/api/settings/ingest-token",
    response_model=IngestTokenCreateResponseOut,
)
def api_create_or_rotate_user_ingest_token(
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    issued = issue_user_ingest_token(db, user_id)
    db.commit()
    return {
        "token": issued.raw_token,
        "ingest_token": _serialize_ingest_token_metadata(issued.ingest_token),
    }


@router.delete("/api/settings/ingest-token", response_model=StatusOut)
def api_delete_user_ingest_token(
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    revoke_user_ingest_token(db, user_id)
    db.commit()
    return {"status": "ok"}


@router.post("/api/settings/balance-anchors", response_model=IdOut)
def api_create_user_balance_anchor(
    data: BalanceAnchorIn, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    anchor = BalanceAnchorService(db, user_id=user_id).create(data)
    return {"id": anchor.id}


@router.put("/api/settings/balance-anchors/{anchor_id}", response_model=IdOut)
def api_update_user_balance_anchor(
    anchor_id: int,
    data: BalanceAnchorIn,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        anchor = BalanceAnchorService(db, user_id=user_id).update(anchor_id, data)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"id": anchor.id}


@router.delete("/api/settings/balance-anchors/{anchor_id}", response_model=StatusOut)
def api_delete_user_balance_anchor(
    anchor_id: int, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        BalanceAnchorService(db, user_id=user_id).delete(anchor_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok"}


@router.post("/api/admin/balance-anchors")
@router.put("/api/admin/balance-anchors/{anchor_id}")
@router.delete("/api/admin/balance-anchors/{anchor_id}")
def api_admin_balance_anchors_removed(anchor_id: int | None = None):
    raise HTTPException(
        status_code=404,
        detail="Admin balance anchors were removed. Use /api/settings/balance-anchors.",
    )


@router.post("/api/admin/purge-deleted", response_model=AdminPurgeDeletedOut)
def api_purge_deleted(
    data: AdminPurgeDeletedIn, request: Request, db: Session = Depends(get_db)
):
    _require_elevated_admin_context(request, db)
    _require_csrf(request, db)
    days = data.days
    cutoff_date = datetime.utcnow() - timedelta(days=days)
    deleted_count, deleted_attachments = _purge_deleted_for_all_users(db, cutoff_date)
    log_event(
        logger,
        logging.INFO,
        "admin_purge_deleted_completed",
        days=days,
        deleted_transactions=deleted_count,
        deleted_attachments=deleted_attachments,
    )
    return {
        "status": "ok",
        "count": deleted_count,
        "attachments_count": deleted_attachments,
    }


@router.post("/api/admin/rebuild-rollups", response_model=AdminRebuildRollupsOut)
def api_rebuild_rollups(request: Request, db: Session = Depends(get_db)):
    _require_elevated_admin_context(request, db)
    _require_csrf(request, db)
    rebuilt_users = _rebuild_rollups_for_all_users(db)
    log_event(
        logger,
        logging.INFO,
        "admin_rebuild_rollups_completed",
        rebuilt_users=rebuilt_users,
    )
    return {"status": "ok", "rebuilt_users": rebuilt_users}


@router.post(
    "/api/admin/recurring-catch-up",
    response_model=AdminRecurringCatchUpOut,
)
def api_admin_recurring_catch_up(request: Request, db: Session = Depends(get_db)):
    _require_elevated_admin_context(request, db)
    _require_csrf(request, db)

    service = RecurringRuleService(db)
    advanced_rules = service.catch_up_all()
    db.commit()

    overdue_rules = int(
        db.scalar(
            select(func.count(RecurringRule.id)).where(
                RecurringRule.auto_post.is_(True),
                RecurringRule.next_occurrence <= local_today(),
            )
        )
        or 0
    )
    log_event(
        logger,
        logging.INFO,
        "admin_recurring_catch_up_completed",
        advanced_rules=advanced_rules,
        overdue_rules=overdue_rules,
        updated=advanced_rules > 0,
    )
    return {
        "status": "ok",
        "advanced_rules": advanced_rules,
        "overdue_rules": overdue_rules,
        "updated": advanced_rules > 0,
    }


@router.post("/api/import/csv/preview", response_model=CSVPreviewResponseOut)
async def api_import_csv_preview(
    request: Request, file: UploadFile = File(...), db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)

    settings = get_settings()
    try:
        content_bytes = await _read_upload_limited(
            file,
            max_bytes=settings.csv_import_max_bytes,
            detail=f"CSV file too large (max {settings.csv_import_max_bytes} bytes)",
        )
        content = content_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        log_event(
            logger,
            logging.WARNING,
            "csv_import_preview_failed",
            filename=file.filename,
            reason="invalid_utf8",
        )
        raise HTTPException(status_code=400, detail="Invalid UTF-8 CSV file") from exc

    rows, errors = CSVService(db, user_id=user_id).preview(
        content, max_rows=settings.csv_import_max_rows
    )
    log_event(
        logger,
        logging.INFO,
        "csv_import_preview_completed",
        filename=file.filename,
        rows_count=len(rows),
        errors_count=len(errors),
        csv_sha256=hashlib.sha256(content_bytes).hexdigest(),
        csv_bytes=len(content_bytes),
    )
    return {
        "rows": [
            {
                "date": row["date"].isoformat(),
                "type": row["type"],
                "is_reimbursement": row["is_reimbursement"],
                "amount_cents": row["amount_cents"],
                "category": row["category"],
                "title": row["title"],
                "description": row["description"],
                "category_id": row["category_id"],
            }
            for row in rows
        ],
        "errors": errors,
    }


@router.post("/api/import/csv/commit", response_model=CSVCommitResponseOut)
async def api_import_csv_commit(
    request: Request, file: UploadFile = File(...), db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)

    settings = get_settings()
    try:
        content_bytes = await _read_upload_limited(
            file,
            max_bytes=settings.csv_import_max_bytes,
            detail=f"CSV file too large (max {settings.csv_import_max_bytes} bytes)",
        )
        content = content_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        log_event(
            logger,
            logging.WARNING,
            "csv_import_commit_failed",
            filename=file.filename,
            reason="invalid_utf8",
        )
        raise HTTPException(status_code=400, detail="Invalid UTF-8 CSV file") from exc

    try:
        count = CSVService(db, user_id=user_id).commit(
            content, max_rows=settings.csv_import_max_rows
        )
    except ValueError as exc:
        log_event(
            logger,
            logging.WARNING,
            "csv_import_commit_failed",
            filename=file.filename,
            reason=str(exc),
            csv_sha256=hashlib.sha256(content_bytes).hexdigest(),
            csv_bytes=len(content_bytes),
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    log_event(
        logger,
        logging.INFO,
        "csv_import_commit_completed",
        filename=file.filename,
        imported_count=count,
        csv_sha256=hashlib.sha256(content_bytes).hexdigest(),
        csv_bytes=len(content_bytes),
    )
    return {"imported_count": count}


@router.get("/api/reconciliation", response_model=BankReconciliationResponseOut)
def api_bank_reconciliation(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    return BankReconciliationService(db, user_id=user_id).reconciliation()


@router.post(
    "/api/reconciliation/commerzbank-csv/preview",
    response_model=BankStatementPreviewResponseOut,
)
async def api_preview_commerzbank_csv_reconciliation(
    request: Request,
    account_label: str = Form("Commerzbank"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    settings = get_settings()
    content = await _read_upload_limited(
        file,
        max_bytes=settings.bank_csv_import_max_bytes,
        detail=f"CSV file too large (max {settings.bank_csv_import_max_bytes} bytes)",
    )
    service = BankReconciliationService(db, user_id=user_id)
    preview = service.preview_commerzbank_csv(
        content, account_label=account_label, max_rows=settings.bank_csv_import_max_rows
    )
    log_event(
        logger,
        logging.INFO,
        "bank_reconciliation_preview_completed",
        filename=file.filename,
        rows_count=len(preview["rows"]),
        errors_count=len(preview["errors"]),
        duplicate_count=preview["duplicate_count"],
        csv_sha256=hashlib.sha256(content).hexdigest(),
    )
    return preview


@router.post(
    "/api/reconciliation/commerzbank-csv/commit",
    response_model=BankStatementImportResponseOut,
)
async def api_commit_commerzbank_csv_reconciliation(
    request: Request,
    account_label: str = Form("Commerzbank"),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    settings = get_settings()
    content = await _read_upload_limited(
        file,
        max_bytes=settings.bank_csv_import_max_bytes,
        detail=f"CSV file too large (max {settings.bank_csv_import_max_bytes} bytes)",
    )
    service = BankReconciliationService(db, user_id=user_id)
    try:
        result = service.import_commerzbank_csv(
            content,
            account_label=account_label,
            max_rows=settings.bank_csv_import_max_rows,
        )
    except ValueError as exc:
        log_event(
            logger,
            logging.WARNING,
            "bank_reconciliation_import_failed",
            filename=file.filename,
            reason=str(exc),
            csv_sha256=hashlib.sha256(content).hexdigest(),
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    log_event(
        logger,
        logging.INFO,
        "bank_reconciliation_import_completed",
        filename=file.filename,
        imported_count=result["imported_count"],
        duplicate_count=result["duplicate_count"],
        csv_sha256=hashlib.sha256(content).hexdigest(),
    )
    return result


@router.post(
    "/api/reconciliation/bank-rows/{row_id:int}/accept-suggestion",
    response_model=BankRowActionResponseOut,
)
def api_accept_bank_row_suggestion(
    row_id: int, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        BankReconciliationService(db, user_id=user_id).accept_suggestion(row_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok"}


@router.post(
    "/api/reconciliation/bank-rows/{row_id:int}/review",
    response_model=BankRowActionResponseOut,
)
def api_review_bank_row(row_id: int, request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        BankReconciliationService(db, user_id=user_id).mark_reviewed(row_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok"}


@router.post(
    "/api/reconciliation/bank-rows/{row_id:int}/reopen",
    response_model=BankRowActionResponseOut,
)
def api_reopen_bank_row(row_id: int, request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        BankReconciliationService(db, user_id=user_id).reopen(row_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok"}


@router.post(
    "/api/reconciliation/bank-rows/{row_id:int}/create-transaction",
    response_model=BankRowActionResponseOut,
)
def api_create_transaction_from_bank_row(
    row_id: int, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        transaction_id = BankReconciliationService(
            db, user_id=user_id
        ).create_transaction(row_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok", "transaction_id": transaction_id}


@router.post(
    "/api/import/sqlite/preview",
    response_model=LegacySqlitePreviewResponseOut,
)
async def api_import_sqlite_preview(
    request: Request, file: UploadFile = File(...), db: Session = Depends(get_db)
):
    admin_context = _require_elevated_admin_context(request, db)
    user_id = admin_context.user.id
    session_key = _auth_context_session_key(admin_context)
    _require_csrf(request, db)

    if not file.filename or not file.filename.endswith(".db"):
        raise HTTPException(status_code=400, detail="Please upload a .db file")

    settings = get_settings()
    content = await _read_upload_limited(
        file,
        max_bytes=settings.sqlite_import_max_bytes,
        detail=f"DB file too large (max {settings.sqlite_import_max_bytes} bytes)",
    )
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    import_token = f"{session_key}_{secrets.token_hex(16)}"
    legacy_path = _legacy_sqlite_import_path(import_token)
    legacy_path.write_bytes(content)

    try:
        preview = LegacySQLiteImportService(db, user_id=user_id).preview(legacy_path)
    except ValueError as exc:
        legacy_path.unlink(missing_ok=True)
        log_event(
            logger,
            logging.WARNING,
            "legacy_sqlite_preview_failed",
            filename=file.filename,
            size_bytes=len(content),
            sqlite_sha256=hashlib.sha256(content).hexdigest(),
            reason=str(exc),
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    categories = CategoryService(db, user_id=user_id).list_all()
    log_event(
        logger,
        logging.INFO,
        "legacy_sqlite_preview_completed",
        filename=file.filename,
        size_bytes=len(content),
        sqlite_sha256=hashlib.sha256(content).hexdigest(),
        transactions_count=preview.transactions_count,
        recurring_count=preview.recurring_count,
        warnings_count=len(preview.warnings),
    )
    return {
        "token": import_token,
        "preview": {
            "transactions_count": preview.transactions_count,
            "recurring_count": preview.recurring_count,
            "min_transaction_date": preview.min_transaction_date.isoformat()
            if preview.min_transaction_date
            else None,
            "max_transaction_date": preview.max_transaction_date.isoformat()
            if preview.max_transaction_date
            else None,
            "non_midnight_transaction_times": preview.non_midnight_transaction_times,
            "warnings": preview.warnings,
            "mapping_rows": [
                {
                    "idx": row.idx,
                    "legacy_type": row.legacy_type.value,
                    "legacy_category": row.legacy_category,
                    "transaction_count": row.transaction_count,
                    "suggested_category_id": row.suggested_category_id,
                    "suggested_category_name": row.suggested_category_name,
                }
                for row in preview.mapping_rows
            ],
            "recurring_rows": [
                {
                    "description": row.description,
                    "legacy_type": row.legacy_type.value,
                    "legacy_category": row.legacy_category,
                    "amount_cents": row.amount_cents,
                    "start_date": row.start_date.isoformat(),
                    "recurrence_type": row.recurrence_type,
                    "interval": row.interval,
                    "last_processed_date": row.last_processed_date.isoformat()
                    if row.last_processed_date
                    else None,
                    "computed_next_occurrence": row.computed_next_occurrence.isoformat()
                    if row.computed_next_occurrence
                    else None,
                }
                for row in preview.recurring_rows
            ],
        },
        "categories": [
            {
                "id": category.id,
                "name": category.name,
                "type": category.type.value,
                "icon": category.icon,
            }
            for category in categories
        ],
    }


@router.post("/api/import/sqlite/commit", response_model=LegacySqliteCommitOut)
async def api_import_sqlite_commit(
    data: LegacySqliteCommitIn, request: Request, db: Session = Depends(get_db)
):
    admin_context = _require_elevated_admin_context(request, db)
    user_id = admin_context.user.id
    session_key = _auth_context_session_key(admin_context)
    _require_csrf(request, db)

    legacy_path = _legacy_sqlite_import_path(data.token)
    token_owner_session, _, _ = data.token.partition("_")
    if token_owner_session != session_key:
        raise HTTPException(
            status_code=403,
            detail="Import preview belongs to a different elevated session.",
        )

    if not legacy_path.exists():
        raise HTTPException(
            status_code=400, detail="Import file not found; please re-upload."
        )

    mapping_targets: dict[tuple[TransactionType, str], str] = {}
    for item in data.mapping_targets:
        legacy_category = item.legacy_category.strip()
        if not legacy_category:
            raise HTTPException(status_code=400, detail="Missing legacy category")
        if item.target == "discard":
            target = "discard"
        elif item.target == "existing":
            if item.existing_category_id is None:
                raise HTTPException(
                    status_code=400, detail="Missing existing_category_id"
                )
            target = f"existing:{item.existing_category_id}"
        else:
            target = "create"
        mapping_targets[(item.legacy_type, legacy_category)] = target

    try:
        result = LegacySQLiteImportService(db, user_id=user_id).commit(
            legacy_path,
            mapping_targets=mapping_targets,
            import_recurring_rules=data.options.import_recurring_rules,
            recurring_auto_post=data.options.recurring_auto_post,
            link_recurring_transactions=data.options.link_recurring_transactions,
            preserve_time_in_title=data.options.preserve_time_in_title,
        )
    except ValueError as exc:
        log_event(
            logger,
            logging.WARNING,
            "legacy_sqlite_commit_failed",
            reason=str(exc),
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        legacy_path.unlink(missing_ok=True)

    log_event(
        logger,
        logging.INFO,
        "legacy_sqlite_commit_completed",
        **result,
    )
    return {"result": result}


@router.get("/api/transactions/deleted", response_model=DeletedTransactionsResponseOut)
def api_deleted_transactions(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    txn_service = TransactionService(db, user_id=user_id)
    transactions = txn_service.deleted(limit=200)
    return {
        "transactions": [
            {
                "id": txn.id,
                "date": txn.date.isoformat(),
                "type": txn.type.value,
                "amount_cents": txn.amount_cents,
                "category": (
                    {
                        "id": txn.category.id,
                        "name": txn.category.name,
                        "icon": txn.category.icon,
                    }
                    if txn.category
                    else None
                ),
                "title": txn.title,
                "description": txn.description,
                "deleted_at": txn.deleted_at.isoformat() if txn.deleted_at else None,
            }
            for txn in transactions
        ]
    }


@router.post("/api/transactions/{transaction_id:int}/restore", response_model=StatusOut)
def api_restore_transaction(
    transaction_id: int, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        TransactionService(db, user_id=user_id).restore(transaction_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok"}


@router.delete(
    "/api/transactions/{transaction_id:int}/permanent",
    response_model=PermanentDeleteTransactionOut,
)
def api_permanent_delete_transaction(
    transaction_id: int, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        deleted_count, deleted_attachments = TransactionService(
            db, user_id=user_id
        ).permanent_delete(transaction_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=404, detail="Deleted transaction not found"
        ) from exc
    return {
        "status": "ok",
        "attachments_count": deleted_attachments,
        "deleted_count": deleted_count,
    }


@router.get(
    "/api/transactions/{transaction_id:int}", response_model=TransactionDetailOut
)
def api_get_transaction(
    request: Request, transaction_id: int, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    try:
        txn = TransactionService(db, user_id=user_id).get(transaction_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    durable = DurablePurchaseService(db, user_id=user_id).for_transaction(txn.id)
    return {
        "id": txn.id,
        "date": txn.date.isoformat(),
        "occurred_at": _occurred_at_iso(txn.occurred_at),
        "type": txn.type.value,
        "amount_cents": txn.amount_cents,
        "category_id": txn.category_id,
        "category": (
            {
                "id": txn.category.id,
                "name": txn.category.name,
                "type": txn.category.type.value,
                "icon": txn.category.icon,
            }
            if txn.category
            else None
        ),
        "title": txn.title,
        "description": txn.description,
        "latitude": float(txn.latitude) if txn.latitude is not None else None,
        "longitude": float(txn.longitude) if txn.longitude is not None else None,
        "is_reimbursement": txn.is_reimbursement,
        "tags": sorted(tag.name for tag in (txn.tags or [])),
        "durable_purchase": (
            {
                "expected_lifespan_days": durable.expected_lifespan_days,
                "acquired_on": durable.acquired_on.isoformat(),
            }
            if durable
            else None
        ),
        "attachments": [_serialize_attachment(a) for a in txn.attachments],
    }


@router.post("/api/transactions/{transaction_id:int}/durable")
def api_upsert_durable_purchase(
    transaction_id: int,
    data: DurablePurchaseIn,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        durable = DurablePurchaseService(db, user_id=user_id).upsert(
            transaction_id, data
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "transaction_id": durable.transaction_id,
        "expected_lifespan_days": durable.expected_lifespan_days,
        "acquired_on": durable.acquired_on.isoformat(),
    }


@router.delete("/api/transactions/{transaction_id:int}/durable")
def api_delete_durable_purchase(
    transaction_id: int, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    DurablePurchaseService(db, user_id=user_id).delete(transaction_id)
    return {"status": "ok"}


@router.get(
    "/api/transactions/{transaction_id:int}/attachments",
    response_model=ReceiptAttachmentsResponseOut,
)
def api_list_transaction_attachments(
    request: Request, transaction_id: int, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    try:
        TransactionService(db, user_id=user_id).get(transaction_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    attachments = ReceiptAttachmentService(db, user_id=user_id).list_for_transaction(
        transaction_id
    )
    return {"attachments": [_serialize_attachment(a) for a in attachments]}


@router.post(
    "/api/transactions/{transaction_id:int}/attachments",
    response_model=ReceiptAttachmentOut,
)
async def api_upload_transaction_attachment(
    transaction_id: int,
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        TransactionService(db, user_id=user_id).get(transaction_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    service = ReceiptAttachmentService(db, user_id=user_id)
    current_count = service.count_for_transaction(transaction_id)
    if current_count >= service.MAX_ATTACHMENTS_PER_TRANSACTION:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Maximum {service.MAX_ATTACHMENTS_PER_TRANSACTION} attachments per transaction"
            ),
        )

    original_filename = (file.filename or "").strip()
    if not original_filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    mime_type = (file.content_type or "").lower()
    if mime_type not in service.ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported attachment type")

    storage_key = service.generate_storage_key(transaction_id, original_filename)
    full_path = service.path_for_storage_key(storage_key)
    full_path.parent.mkdir(parents=True, exist_ok=True)

    max_bytes = get_settings().receipt_max_bytes
    size_bytes = 0
    digest = hashlib.sha256()
    try:
        with open(full_path, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size_bytes += len(chunk)
                if size_bytes > max_bytes:
                    full_path.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=400,
                        detail=f"Attachment exceeds max size of {max_bytes} bytes",
                    )
                digest.update(chunk)
                out.write(chunk)
    finally:
        await file.close()

    if size_bytes == 0:
        full_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Attachment is empty")

    attachment = service.create_metadata(
        transaction_id=transaction_id,
        storage_key=storage_key,
        original_filename=original_filename,
        mime_type=mime_type,
        size_bytes=size_bytes,
        sha256_hex=digest.hexdigest(),
    )
    return ReceiptAttachmentOut(
        id=attachment.id,
        transaction_id=attachment.transaction_id,
        original_filename=attachment.original_filename,
        mime_type=attachment.mime_type,
        size_bytes=attachment.size_bytes,
        sha256_hex=attachment.sha256_hex,
        created_at=attachment.created_at,
    )


@router.get("/api/attachments/{attachment_id}/download")
def api_download_attachment(
    request: Request, attachment_id: int, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    service = ReceiptAttachmentService(db, user_id=user_id)
    try:
        attachment = service.get(attachment_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    path = service.path_for_storage_key(attachment.storage_key)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Attachment file not found")

    etag = f'"{attachment.sha256_hex}"'
    cache_control = "private, max-age=86400"
    if request.headers.get("if-none-match") == etag:
        return Response(
            status_code=304,
            headers={"ETag": etag, "Cache-Control": cache_control},
        )

    safe_name = attachment.original_filename.replace('"', "_")
    encoded_name = urllib.parse.quote(attachment.original_filename)
    return FileResponse(
        path,
        media_type=attachment.mime_type,
        headers={
            "ETag": etag,
            "Cache-Control": cache_control,
            "Content-Disposition": (
                f"inline; filename=\"{safe_name}\"; filename*=UTF-8''{encoded_name}"
            ),
        },
    )


@router.get("/api/attachments/{attachment_id}/thumbnail")
def api_attachment_thumbnail(
    request: Request, attachment_id: int, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    service = ReceiptAttachmentService(db, user_id=user_id)
    try:
        attachment = service.get(attachment_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        thumb_path = service.ensure_thumbnail(attachment)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if thumb_path is None:
        raise HTTPException(status_code=404, detail="No thumbnail available")

    etag = f'"{attachment.sha256_hex}-thumb"'
    cache_control = "private, max-age=86400"
    if request.headers.get("if-none-match") == etag:
        return Response(
            status_code=304,
            headers={"ETag": etag, "Cache-Control": cache_control},
        )
    return FileResponse(
        thumb_path,
        media_type="image/webp",
        headers={"ETag": etag, "Cache-Control": cache_control},
    )


@router.delete("/api/attachments/{attachment_id}", response_model=StatusOut)
def api_delete_attachment(
    attachment_id: int, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    service = ReceiptAttachmentService(db, user_id=user_id)
    try:
        service.delete(attachment_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok"}


@router.get(
    "/api/transactions/{transaction_id:int}/reimbursements",
    response_model=TransactionReimbursementsResponseOut,
)
def api_transaction_reimbursements(
    request: Request, transaction_id: int, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    try:
        txn = TransactionService(db, user_id=user_id).get(transaction_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    reimbursements = ReimbursementService(db, user_id=user_id)
    if txn.type == TransactionType.income:
        allocated_total = (
            reimbursements.allocated_total_for_reimbursement(txn.id)
            if txn.is_reimbursement
            else 0
        )
        remaining_to_allocate = (
            max(0, txn.amount_cents - allocated_total) if txn.is_reimbursement else 0
        )
        allocations = (
            reimbursements.allocations_for_reimbursement(txn.id)
            if txn.is_reimbursement
            else []
        )
        return {
            "mode": "income",
            "is_reimbursement": txn.is_reimbursement,
            "allocated_total_cents": allocated_total,
            "remaining_to_allocate_cents": remaining_to_allocate,
            "allocations_out": [
                {
                    "allocation_id": alloc.id,
                    "amount_cents": alloc.amount_cents,
                    "expense_transaction": {
                        "id": alloc.expense_transaction.id,
                        "date": alloc.expense_transaction.date.isoformat(),
                        "title": alloc.expense_transaction.title,
                        "deleted_at": alloc.expense_transaction.deleted_at.isoformat()
                        if alloc.expense_transaction.deleted_at
                        else None,
                        "category": (
                            {
                                "id": alloc.expense_transaction.category.id,
                                "name": alloc.expense_transaction.category.name,
                                "type": alloc.expense_transaction.category.type.value,
                            }
                            if alloc.expense_transaction.category
                            else None
                        ),
                    },
                }
                for alloc in allocations
            ],
        }

    reimbursed_total = reimbursements.reimbursed_total_for_expense(txn.id)
    net_cost = max(0, txn.amount_cents - reimbursed_total)
    allocations_in = reimbursements.allocations_for_expense(txn.id)
    return {
        "mode": "expense",
        "reimbursed_total_cents": reimbursed_total,
        "net_cost_cents": net_cost,
        "allocations_in": [
            {
                "allocation_id": alloc.id,
                "amount_cents": alloc.amount_cents,
                "reimbursement_transaction": {
                    "id": alloc.reimbursement_transaction.id,
                    "date": alloc.reimbursement_transaction.date.isoformat(),
                    "title": alloc.reimbursement_transaction.title,
                    "deleted_at": alloc.reimbursement_transaction.deleted_at.isoformat()
                    if alloc.reimbursement_transaction.deleted_at
                    else None,
                    "category": (
                        {
                            "id": alloc.reimbursement_transaction.category.id,
                            "name": alloc.reimbursement_transaction.category.name,
                            "type": alloc.reimbursement_transaction.category.type.value,
                        }
                        if alloc.reimbursement_transaction.category
                        else None
                    ),
                },
            }
            for alloc in allocations_in
        ],
    }


@router.get(
    "/api/reimbursements/{reimbursement_id}/expense-search",
    response_model=ReimbursementExpenseSearchResponseOut,
)
def api_reimbursement_expense_search(
    reimbursement_id: int, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    query = str(request.query_params.get("q") or "").strip()
    try:
        results = ReimbursementService(
            db, user_id=user_id
        ).search_expenses_for_reimbursement(reimbursement_id, query=query, limit=25)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "results": [
            {
                "expense": {
                    "id": row["expense"].id,
                    "date": row["expense"].date.isoformat(),
                    "amount_cents": row["expense"].amount_cents,
                    "title": row["expense"].title,
                    "category": (
                        {
                            "id": row["expense"].category.id,
                            "name": row["expense"].category.name,
                            "type": row["expense"].category.type.value,
                        }
                        if row["expense"].category
                        else None
                    ),
                },
                "reimbursed_total_cents": row["reimbursed_total_cents"],
                "remaining_unreimbursed_cents": row["remaining_unreimbursed_cents"],
                "allocated_to_this_cents": row["allocated_to_this_cents"],
                "suggested_amount_cents": row["suggested_amount_cents"],
            }
            for row in results
        ]
    }


@router.post(
    "/api/reimbursements/{reimbursement_id}/allocations",
    response_model=AllocationIDOut,
)
def api_upsert_reimbursement_allocation(
    reimbursement_id: int,
    data: ReimbursementAllocationIn,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        allocation = ReimbursementService(db, user_id=user_id).upsert_allocation(
            reimbursement_id, data.expense_transaction_id, data.amount_cents
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"allocation_id": allocation.id}


@router.delete(
    "/api/reimbursements/allocations/{allocation_id}", response_model=StatusOut
)
def api_delete_reimbursement_allocation(
    allocation_id: int, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        ReimbursementService(db, user_id=user_id).delete_allocation(allocation_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok"}


@router.put("/api/transactions/{transaction_id:int}", response_model=IdOut)
def api_update_transaction(
    transaction_id: int,
    data: TransactionIn,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        txn = TransactionService(db, user_id=user_id).update(transaction_id, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": txn.id}


@router.delete("/api/transactions/{transaction_id:int}")
def api_delete_transaction(
    transaction_id: int, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        TransactionService(db, user_id=user_id).soft_delete(transaction_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "ok"}


@router.post("/api/transactions", response_model=IdOut)
def api_create_transaction(
    data: TransactionIn, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        txn = TransactionService(db, user_id=user_id).create(data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": txn.id}


def _ai_usage_period_start(period: Literal["week", "month", "all"]) -> datetime | None:
    if period == "week":
        return datetime.utcnow() - timedelta(days=7)
    if period == "month":
        return datetime.utcnow() - timedelta(days=30)
    return None


def _decimal_scale(value: str) -> int:
    try:
        decimal = Decimal(value)
    except InvalidOperation:
        return 0
    exponent = decimal.as_tuple().exponent
    return -exponent if exponent < 0 else 0


def _format_decimal(value: Decimal, scale: int) -> str:
    if scale <= 0:
        return format(value, "f")
    return f"{value:.{scale}f}"


@router.get(
    "/api/ai/usage/summary",
    response_model=AIUsageSummaryOut,
    dependencies=[Depends(require_llm_enabled)],
)
def api_ai_usage_summary(
    request: Request,
    db: Session = Depends(get_db),
    feature: str = "spending_chat",
    period: Literal["week", "month", "all"] = "week",
):
    user_id = _require_current_user_id(request, db)
    started_at = _ai_usage_period_start(period)
    conditions = [LLMJob.user_id == user_id, LLMJob.feature == feature]
    if started_at is not None:
        conditions.append(LLMJob.created_at >= started_at)

    total_tokens_expr = func.coalesce(
        LLMJob.usage_total_tokens,
        func.coalesce(LLMJob.usage_input_tokens, 0)
        + func.coalesce(LLMJob.usage_output_tokens, 0),
    )
    summary = db.execute(
        select(
            func.count(LLMJob.id).label("total_chats"),
            func.coalesce(
                func.sum(case((LLMJob.status == "completed", 1), else_=0)), 0
            ).label("completed_chats"),
            func.coalesce(
                func.sum(
                    case(
                        (
                            (LLMJob.status == "failed")
                            & or_(
                                LLMJob.error.is_(None),
                                LLMJob.error != "stream_cancelled",
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("failed_chats"),
            func.coalesce(
                func.sum(case((LLMJob.error == "stream_cancelled", 1), else_=0)), 0
            ).label("cancelled_chats"),
            func.coalesce(func.sum(LLMJob.usage_input_tokens), 0).label("input_tokens"),
            func.coalesce(func.sum(LLMJob.usage_output_tokens), 0).label(
                "output_tokens"
            ),
            func.coalesce(func.sum(total_tokens_expr), 0).label("total_tokens"),
            func.coalesce(func.sum(LLMJob.usage_cached_input_tokens), 0).label(
                "cached_input_tokens"
            ),
            func.coalesce(func.sum(LLMJob.usage_cache_write_tokens), 0).label(
                "cache_write_tokens"
            ),
            func.coalesce(func.sum(LLMJob.usage_reasoning_tokens), 0).label(
                "reasoning_tokens"
            ),
            func.coalesce(
                func.sum(
                    case((LLMJob.status == "completed", total_tokens_expr), else_=0)
                ),
                0,
            ).label("completed_total_tokens"),
        ).where(*conditions)
    ).one()

    total_chats = int(summary.total_chats or 0)
    completed_chats = int(summary.completed_chats or 0)
    failed_chats = int(summary.failed_chats or 0)
    cancelled_chats = int(summary.cancelled_chats or 0)
    input_tokens = int(summary.input_tokens or 0)
    output_tokens = int(summary.output_tokens or 0)
    total_tokens = int(summary.total_tokens or 0)
    cost_total = Decimal("0")
    cost_scale = 0
    cost_unit: str | None = None
    cost_unit_seen = False
    mixed_cost_units = False
    costed_chats = 0
    cost_rows = db.execute(
        select(LLMJob.usage_cost_decimal, LLMJob.usage_cost_unit).where(
            *conditions, LLMJob.usage_cost_decimal.is_not(None)
        )
    ).all()
    for row in cost_rows:
        if not row.usage_cost_decimal:
            continue
        try:
            cost = Decimal(row.usage_cost_decimal)
        except InvalidOperation:
            continue
        cost_total += cost
        cost_scale = max(cost_scale, _decimal_scale(row.usage_cost_decimal))
        costed_chats += 1
        if not cost_unit_seen:
            cost_unit = row.usage_cost_unit
            cost_unit_seen = True
        elif row.usage_cost_unit != cost_unit:
            mixed_cost_units = True
    if mixed_cost_units:
        cost_unit = "mixed"

    duration_count = int(
        db.scalar(
            select(func.count(LLMJob.id)).where(
                *conditions, LLMJob.duration_ms.is_not(None)
            )
        )
        or 0
    )
    p95_duration_ms = None
    if duration_count:
        index = max(0, min(duration_count - 1, int(duration_count * 0.95 + 0.999) - 1))
        p95_duration_ms = db.scalar(
            select(LLMJob.duration_ms)
            .where(*conditions, LLMJob.duration_ms.is_not(None))
            .order_by(LLMJob.duration_ms.asc())
            .offset(index)
            .limit(1)
        )
    completed_total_tokens = int(summary.completed_total_tokens or 0)
    average_total_tokens = (
        round(completed_total_tokens / completed_chats) if completed_chats else 0
    )
    average_cost = cost_total / costed_chats if costed_chats else Decimal("0")
    average_cost_scale = min(
        max(cost_scale, _decimal_scale(format(average_cost, "f"))),
        cost_scale + 8,
    )
    return {
        "feature": feature,
        "period": period,
        "started_at": started_at,
        "total_chats": total_chats,
        "completed_chats": completed_chats,
        "failed_chats": failed_chats,
        "cancelled_chats": cancelled_chats,
        "costed_chats": costed_chats,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "cached_input_tokens": int(summary.cached_input_tokens or 0),
        "cache_write_tokens": int(summary.cache_write_tokens or 0),
        "reasoning_tokens": int(summary.reasoning_tokens or 0),
        "total_cost_decimal": _format_decimal(cost_total, cost_scale),
        "average_cost_decimal": _format_decimal(average_cost, average_cost_scale),
        "cost_unit": cost_unit,
        "average_total_tokens": average_total_tokens,
        "p95_duration_ms": p95_duration_ms,
    }


def _spending_chat_event_line(event: dict[str, object]) -> str:
    return json.dumps(event, ensure_ascii=False, default=str) + "\n"


@router.post(
    "/api/ai/spending-chat/stream",
    response_class=StreamingResponse,
    dependencies=[Depends(require_llm_enabled)],
)
async def api_ai_spending_chat_stream(
    data: SpendingChatRequest,
    request: Request,
    db: Session = Depends(get_db),
    session_factory: Callable[[], Session] = Depends(get_spending_chat_session_factory),
    service_class: type[SpendingChatService] = Depends(get_spending_chat_service_class),
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    settings = get_settings()
    if not settings.llm_enabled or not settings.llm_base_url:
        raise HTTPException(status_code=503, detail="LLM is not configured")
    try:
        validate_spending_chat_message_history(data.message_history)
    except LLMDisabledError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    async def event_stream():
        stream_db = session_factory()
        try:
            try:
                service = service_class(stream_db, user_id=user_id)
                async for event in service.stream_turn(request=data):
                    yield _spending_chat_event_line(event)
                yield _spending_chat_event_line({"type": "done"})
            except SpendingChatError as exc:
                yield _spending_chat_event_line({"type": "error", "message": str(exc)})
                yield _spending_chat_event_line({"type": "done"})
            except LLMDisabledError as exc:
                yield _spending_chat_event_line({"type": "error", "message": str(exc)})
                yield _spending_chat_event_line({"type": "done"})
        finally:
            stream_db.close()

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        # GZipMiddleware's deflate buffer withholds every NDJSON line until the
        # response closes, which makes the turn arrive all at once. Marking the
        # body as already-encoded routes it through the pass-through branch so
        # tool and text events reach the client as they are produced.
        headers={"Cache-Control": "no-cache", "Content-Encoding": "identity"},
    )


@router.get(
    "/api/ai/transaction-suggestions",
    response_model=list[TransactionSuggestionOut],
    dependencies=[Depends(require_llm_enabled)],
)
def api_ai_transaction_suggestions(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    transaction_id_raw = request.query_params.get("transaction_id")
    try:
        transaction_id = int(transaction_id_raw) if transaction_id_raw else None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid transaction_id") from exc
    return LLMAssistantService(db, user_id=user_id).pending_transaction_suggestions(
        transaction_id=transaction_id
    )


@router.post(
    "/api/ai/transactions/{transaction_id:int}/triage",
    response_model=TransactionSuggestionOut | None,
    dependencies=[Depends(require_llm_enabled)],
)
async def api_ai_triage_transaction(
    transaction_id: int, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    service = LLMAssistantService(db, user_id=user_id)
    try:
        suggestion = await service.suggest_uncategorized_transaction(transaction_id)
    except LLMDisabledError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if suggestion is None:
        return None
    return service.pending_transaction_suggestions(transaction_id=transaction_id)[0]


@router.post(
    "/api/ai/transaction-suggestions/{suggestion_id}/accept",
    response_model=IdOut,
    dependencies=[Depends(require_llm_enabled)],
)
def api_ai_accept_transaction_suggestion(
    suggestion_id: int, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        transaction_id = LLMAssistantService(
            db, user_id=user_id
        ).accept_transaction_suggestion(suggestion_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": transaction_id}


@router.post(
    "/api/ai/transaction-suggestions/{suggestion_id}/reject",
    response_model=IdOut,
    dependencies=[Depends(require_llm_enabled)],
)
def api_ai_reject_transaction_suggestion(
    suggestion_id: int, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    try:
        transaction_id = LLMAssistantService(
            db, user_id=user_id
        ).reject_transaction_suggestion(suggestion_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"id": transaction_id}


@router.post("/api/transactions/bulk/preview", response_model=BulkEditResponseOut)
def api_transactions_bulk_preview(
    payload: BulkEditRequestIn, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    transactions, skipped_count = _resolve_bulk_transactions(payload, db, user_id)
    operation = payload.operation

    counts = {
        "category_changed": 0,
        "tags_added": 0,
        "tags_removed": 0,
        "tags_replaced": 0,
        "deleted": 0,
        "restored": 0,
    }

    target_category = None
    if operation.set_category_id is not None:
        target_category = db.get(Category, operation.set_category_id)
        if not target_category or target_category.user_id != user_id:
            raise HTTPException(status_code=400, detail="Category not found")

    tag_patch = operation.tag_patch
    patch_tag_names = [
        tag.strip() for tag in (tag_patch.tags if tag_patch else []) if tag.strip()
    ]
    for txn in transactions:
        if target_category is not None:
            if txn.type != target_category.type:
                raise HTTPException(
                    status_code=400,
                    detail="Category type mismatch in selected transactions",
                )
            if txn.category_id != target_category.id:
                counts["category_changed"] += 1

        if tag_patch:
            existing_lower = {tag.name.lower() for tag in txn.tags}
            if tag_patch.mode == "add":
                counts["tags_added"] += len(
                    [
                        name
                        for name in patch_tag_names
                        if name.lower() not in existing_lower
                    ]
                )
            if tag_patch.mode == "remove":
                counts["tags_removed"] += len(
                    [name for name in patch_tag_names if name.lower() in existing_lower]
                )
            if tag_patch.mode in {"replace", "clear"}:
                next_names = (
                    {name.lower() for name in patch_tag_names}
                    if tag_patch.mode == "replace"
                    else set()
                )
                if existing_lower != next_names:
                    counts["tags_replaced"] += 1

        if operation.lifecycle == "soft_delete":
            counts["deleted"] += 1
        if operation.lifecycle == "restore":
            counts["restored"] += 1

    return {
        "resolved_count": len(transactions),
        "eligible_count": len(transactions),
        "skipped_count": skipped_count,
        "sample_ids": [txn.id for txn in transactions[:20]],
        "changes": counts,
    }


@router.post("/api/transactions/bulk/apply", response_model=BulkEditResponseOut)
def api_transactions_bulk_apply(
    payload: BulkEditRequestIn, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    transactions, skipped_count = _resolve_bulk_transactions(payload, db, user_id)
    operation = payload.operation

    counts = {
        "category_changed": 0,
        "tags_added": 0,
        "tags_removed": 0,
        "tags_replaced": 0,
        "deleted": 0,
        "restored": 0,
    }
    if not transactions:
        return {
            "resolved_count": 0,
            "eligible_count": 0,
            "skipped_count": skipped_count,
            "sample_ids": [],
            "changes": counts,
        }

    txn_service = TransactionService(db, user_id=user_id)
    if operation.lifecycle == "soft_delete":
        for txn in transactions:
            txn_service.soft_delete(txn.id)
            counts["deleted"] += 1
        return {
            "resolved_count": len(transactions),
            "eligible_count": len(transactions),
            "skipped_count": skipped_count,
            "sample_ids": [txn.id for txn in transactions[:20]],
            "changes": counts,
        }
    if operation.lifecycle == "restore":
        for txn in transactions:
            txn_service.restore(txn.id)
            counts["restored"] += 1
        return {
            "resolved_count": len(transactions),
            "eligible_count": len(transactions),
            "skipped_count": skipped_count,
            "sample_ids": [txn.id for txn in transactions[:20]],
            "changes": counts,
        }

    target_category = None
    if operation.set_category_id is not None:
        target_category = db.get(Category, operation.set_category_id)
        if not target_category or target_category.user_id != user_id:
            raise HTTPException(status_code=400, detail="Category not found")

    tag_patch = operation.tag_patch
    tag_service = TagService(db, user_id=user_id)
    patch_tags = []
    if tag_patch and tag_patch.mode in {"add", "replace"}:
        seen_tag_names: set[str] = set()
        for raw_name in tag_patch.tags:
            clean_name = raw_name.strip()
            if not clean_name:
                continue
            if clean_name.lower() in seen_tag_names:
                continue
            seen_tag_names.add(clean_name.lower())
            patch_tags.append(tag_service.get_or_create(clean_name))
    patch_tag_name_set = (
        {tag.name.lower() for tag in patch_tags}
        if tag_patch and tag_patch.mode in {"add", "replace"}
        else {
            tag.strip().lower()
            for tag in (tag_patch.tags if tag_patch else [])
            if tag.strip()
        }
    )

    for txn in transactions:
        if target_category is not None:
            if txn.type != target_category.type:
                raise HTTPException(
                    status_code=400,
                    detail="Category type mismatch in selected transactions",
                )
            if txn.category_id != target_category.id:
                txn.category_id = target_category.id
                counts["category_changed"] += 1

        if not tag_patch:
            continue
        existing_by_lower = {tag.name.lower(): tag for tag in txn.tags}
        if tag_patch.mode == "add":
            for patch_tag in patch_tags:
                if patch_tag.name.lower() in existing_by_lower:
                    continue
                txn.tags.append(patch_tag)
                counts["tags_added"] += 1
        elif tag_patch.mode == "remove":
            before_count = len(txn.tags)
            txn.tags = [
                tag for tag in txn.tags if tag.name.lower() not in patch_tag_name_set
            ]
            counts["tags_removed"] += before_count - len(txn.tags)
        elif tag_patch.mode == "replace":
            if {tag.name.lower() for tag in txn.tags} != patch_tag_name_set:
                txn.tags = patch_tags.copy()
                counts["tags_replaced"] += 1
        elif tag_patch.mode == "clear":
            if txn.tags:
                txn.tags = []
                counts["tags_replaced"] += 1

    db.commit()
    return {
        "resolved_count": len(transactions),
        "eligible_count": len(transactions),
        "skipped_count": skipped_count,
        "sample_ids": [txn.id for txn in transactions[:20]],
        "changes": counts,
    }


@router.get("/api/transactions/export.csv")
def api_export_transactions_csv(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    period = period_from_request(request)
    filters = filters_from_request(request)
    transactions = TransactionService(db, user_id=user_id).all_for_period(
        period, filters
    )
    csv_text = CSVService(db, user_id=user_id).export(transactions)
    filename = f"transactions_{period.start}_{period.end}.csv"
    return StreamingResponse(
        iter([csv_text]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/api/transactions", response_model=TransactionsResponseOut)
def api_transactions(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    period = period_from_request(request)
    filters = filters_from_request(request)
    page = int(request.query_params.get("page", "1"))
    page = max(page, 1)
    limit = int(request.query_params.get("limit", "50"))
    limit = min(max(limit, 1), 100)
    offset = (page - 1) * limit
    txn_service = TransactionService(db, user_id=user_id)
    items = txn_service.list_for_period(period, filters, limit=limit + 1, offset=offset)
    has_more = len(items) > limit
    items = items[:limit]

    categories = CategoryService(db, user_id=user_id).list_all()
    tags = TagService(db, user_id=user_id).list_all()
    return {
        "items": [_serialize_transaction_item(txn) for txn in items],
        "page": page,
        "limit": limit,
        "has_more": has_more,
        "period": {
            "slug": period.slug,
            "start": period.start.isoformat(),
            "end": period.end.isoformat(),
        },
        "filters": {
            "type": filters.type.value if filters.type else None,
            "category_id": filters.category_id,
            "tag_id": filters.tag_id,
            "query": filters.query,
        },
        "categories": [
            {
                "id": category.id,
                "name": category.name,
                "type": category.type.value,
                "icon": category.icon,
            }
            for category in categories
        ],
        "tags": [{"id": tag.id, "name": tag.name} for tag in tags],
    }


@router.get("/api/transactions/summary", include_in_schema=False)
def api_transactions_summary(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    period = period_from_request(request)
    filters = filters_from_request(request)
    return TransactionService(db, user_id=user_id).summary_for_period(period, filters)


@router.get(
    "/api/transactions/uncategorized",
    response_model=UncategorizedTransactionsResponseOut,
)
def api_uncategorized_transactions(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    period = period_from_request(request)
    filters = filters_from_request(request)
    page = int(request.query_params.get("page", "1"))
    page = max(page, 1)
    limit = int(request.query_params.get("limit", "50"))
    limit = min(max(limit, 1), 100)
    offset = (page - 1) * limit

    txn_service = TransactionService(db, user_id=user_id)
    uncategorized_ids = [
        int(row.id)
        for row in db.execute(
            select(Category.id).where(
                Category.user_id == txn_service.user_id,
                func.lower(Category.name) == "uncategorized",
            )
        )
    ]

    filters.matched_category_ids = uncategorized_ids
    items = txn_service.list_for_period(
        period,
        filters,
        limit=limit + 1,
        offset=offset,
    )
    has_more = len(items) > limit
    items = items[:limit]
    total = txn_service.count_for_period(period, filters)

    categories = CategoryService(db, user_id=user_id).list_all()
    tags = TagService(db, user_id=user_id).list_all()
    return {
        "items": [_serialize_transaction_item(txn) for txn in items],
        "page": page,
        "limit": limit,
        "has_more": has_more,
        "total": total,
        "definition": {
            "category_name": "Uncategorized",
            "matched_category_ids": uncategorized_ids,
        },
        "period": {
            "slug": period.slug,
            "start": period.start.isoformat(),
            "end": period.end.isoformat(),
        },
        "filters": {
            "type": filters.type.value if filters.type else None,
            "category_id": filters.category_id,
            "tag_id": filters.tag_id,
            "query": filters.query,
        },
        "categories": [
            {
                "id": category.id,
                "name": category.name,
                "type": category.type.value,
                "icon": category.icon,
            }
            for category in categories
        ],
        "tags": [{"id": tag.id, "name": tag.name} for tag in tags],
    }


@router.get("/api/insights", response_model=InsightsResponseOut)
def api_insights(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    period = period_from_request(request)
    filters = filters_from_request(request)
    tag_ids = [filters.tag_id] if filters.tag_id else None

    insights = InsightsService(db, user_id=user_id)
    series = insights.monthly_series(period, months_back=12, tag_ids=tag_ids)
    expense_breakdown = MetricsService(db, user_id=user_id).category_breakdown(
        period, TransactionType.expense, tag_ids=tag_ids
    )
    income_breakdown = MetricsService(db, user_id=user_id).category_breakdown(
        period, TransactionType.income, tag_ids=tag_ids
    )
    deltas = insights.expense_category_deltas(period, tag_ids=tag_ids)
    top_tags = (
        []
        if tag_ids
        else insights.top_tags(period, transaction_type=TransactionType.expense)
    )

    all_categories = CategoryService(db, user_id=user_id).list_all()
    expense_categories = [
        category
        for category in all_categories
        if category.type == TransactionType.expense
    ]
    expense_category_ids = {category.id for category in expense_categories}
    trend_category_raw = str(request.query_params.get("trend_category") or "").strip()
    trend_category_id = None
    if trend_category_raw:
        try:
            candidate_id = int(trend_category_raw)
        except ValueError:
            candidate_id = None
        if candidate_id in expense_category_ids:
            trend_category_id = candidate_id
    if trend_category_id is None and expense_categories:
        trend_category_id = expense_categories[0].id
    trend = (
        insights.category_trend(
            trend_category_id, end=period.end, months_back=12, tag_ids=tag_ids
        )
        if trend_category_id
        else []
    )

    budget_month = str(request.query_params.get("budget_month") or "")
    if not budget_month:
        budget_month = f"{period.end.year:04d}-{period.end.month:02d}"
    try:
        byear, bmonth = (int(p) for p in budget_month.split("-", 1))
    except ValueError:
        byear, bmonth = period.end.year, period.end.month
        budget_month = f"{byear:04d}-{bmonth:02d}"
    budget_service = BudgetService(db, user_id=user_id)
    budget_effective = budget_service.effective_budgets_for_month(byear, bmonth)
    budget_progress_raw = budget_service.progress_for_month(byear, bmonth)
    budget_progress = {
        str(scope_id) if scope_id is not None else "null": {
            "spent_cents": values.get("spent_cents", 0),
            "remaining_cents": values.get("remaining_cents", 0),
        }
        for scope_id, values in budget_progress_raw.items()
    }

    all_tags = TagService(db, user_id=user_id).list_all()

    return {
        "period": {
            "slug": period.slug,
            "start": period.start.isoformat(),
            "end": period.end.isoformat(),
        },
        "filters": {
            "type": filters.type.value if filters.type else None,
            "tag_id": filters.tag_id,
        },
        "tags": [{"id": t.id, "name": t.name} for t in all_tags],
        "categories": [
            {
                "id": category.id,
                "name": category.name,
                "type": category.type.value,
                "icon": category.icon,
            }
            for category in all_categories
        ],
        "series": series,
        "expense_breakdown": expense_breakdown,
        "income_breakdown": income_breakdown,
        "deltas": deltas,
        "top_tags": top_tags,
        "trend_category_id": trend_category_id,
        "trend": trend,
        "budget_month": budget_month,
        "budget_effective": budget_effective,
        "budget_progress": budget_progress,
    }


@router.get("/api/insights/flow", response_model=InsightsFlowResponseOut)
def api_insights_flow(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    period = period_from_request(request)
    filters = filters_from_request(request)
    tag_ids = [filters.tag_id] if filters.tag_id else None
    flow = InsightsService(db, user_id=user_id).flow_data(
        period, tag_ids=tag_ids, tx_type=filters.type
    )
    return {
        "period": {
            "slug": period.slug,
            "start": period.start.isoformat(),
            "end": period.end.isoformat(),
        },
        "filters": {
            "type": filters.type.value if filters.type else None,
            "tag_id": filters.tag_id,
        },
        "nodes": flow["nodes"],
        "links": flow["links"],
    }


@router.get("/api/forecast", response_model=ForecastResponseOut)
def api_forecast(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    horizon_raw = (request.query_params.get("horizon") or "6").strip()
    mode = (request.query_params.get("mode") or "full").strip().lower()
    try:
        horizon = int(horizon_raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid horizon value") from exc
    if horizon not in {3, 6, 12}:
        raise HTTPException(status_code=400, detail="Invalid horizon value")
    try:
        return ForecastService(db, user_id=user_id).forecast(horizon=horizon, mode=mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/api/forecast/scenario", response_model=ForecastScenarioResponseOut)
def api_forecast_scenario(
    data: ForecastScenarioIn, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    mode = (request.query_params.get("mode") or "full").strip().lower()
    try:
        return ForecastService(db, user_id=user_id).scenario(payload=data, mode=mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/digest", response_model=DigestResponseOut)
def api_digest(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    week_of_param = (request.query_params.get("week_of") or "").strip()
    week_of: date | None = None
    if week_of_param:
        try:
            week_of = date.fromisoformat(week_of_param)
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail="Invalid week_of value"
            ) from exc
    return DigestService(db, user_id=user_id).weekly_digest(week_of=week_of)


@router.get("/api/durable-purchases", response_model=DurablePurchasesResponseOut)
def api_durable_purchases(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    items = DurablePurchaseService(db, user_id=user_id).list_computed()
    return {"items": items}


@router.get(
    "/api/dashboard",
    response_model=DashboardResponseOut,
    response_model_exclude_none=True,
)
def api_dashboard(request: Request, db: Session = Depends(get_db)):
    user_id = _require_current_user_id(request, db)
    period = period_from_request(request)
    filters = filters_from_request(request)
    metrics_service = MetricsService(db, user_id=user_id)
    txn_service = TransactionService(db, user_id=user_id)
    categories = CategoryService(db, user_id=user_id).list_all()
    tags = TagService(db, user_id=user_id).list_all()
    has_any_transactions = txn_service.has_any()

    donut_context: dict[str, object] = {"has_any_transactions": has_any_transactions}
    if has_any_transactions:
        if filters.type == TransactionType.expense:
            donut_context.update(
                {
                    "mode": "expense-only",
                    "expense_breakdown": metrics_service.category_breakdown(
                        period, TransactionType.expense
                    ),
                }
            )
        elif filters.type == TransactionType.income:
            donut_context.update(
                {
                    "mode": "income-only",
                    "income_breakdown": metrics_service.category_breakdown(
                        period, TransactionType.income
                    ),
                }
            )
        else:
            donut_context.update(
                {
                    "mode": "both",
                    "expense_breakdown": metrics_service.category_breakdown(
                        period, TransactionType.expense
                    ),
                    "income_breakdown": metrics_service.category_breakdown(
                        period, TransactionType.income
                    ),
                }
            )
    kpis = metrics_service.kpis(period)
    sparklines = metrics_service.kpi_sparklines(period)
    deltas = None
    duration_days = (period.end - period.start).days + 1
    if period.slug != "all" and duration_days <= 370:
        prev_end = period.start - timedelta(days=1)
        prev_start = prev_end - timedelta(days=duration_days - 1)
        prev_period = Period("prev", prev_start, prev_end)
        prev = metrics_service.kpis(prev_period)
        deltas = {
            "income": kpis["income"] - prev["income"],
            "expenses": kpis["expenses"] - prev["expenses"],
            "balance": kpis["balance"] - prev["balance"],
        }
    recent = txn_service.list_for_period(period, filters, limit=10)
    durable_items = DurablePurchaseService(db, user_id=user_id).list_computed()
    active_durable = [
        item for item in durable_items if not bool(item["fully_amortized"])
    ][:10]
    budget_service = BudgetService(db, user_id=user_id)
    today = date.today()
    # Monthly budgets track the selected period's month: a completed last month
    # is evaluated as of its final day (so pace reflects actual spend, not a
    # partway projection), while this_month/all/custom stay on the current month.
    budget_as_of = period.end if period.slug == "last_month" else today
    budget_pace = budget_service.dashboard_budget_pace(today=budget_as_of)
    category_budget_overview = budget_service.dashboard_category_budget_overview(
        today=budget_as_of
    )

    payload = {
        "period": {
            "slug": period.slug,
            "start": period.start.isoformat(),
            "end": period.end.isoformat(),
        },
        "filters": {"type": filters.type.value if filters.type else None},
        "kpis": kpis,
        "sparklines": sparklines,
        "deltas": deltas,
        "donut": donut_context,
        "recent": [
            {
                "id": txn.id,
                "date": txn.date.isoformat(),
                "occurred_at": _occurred_at_iso(txn.occurred_at),
                "type": txn.type.value,
                "amount_cents": txn.amount_cents,
                "net_amount_cents": txn.net_amount_cents,
                "reimbursed_total_cents": txn.reimbursed_total_cents,
                "is_reimbursement": txn.is_reimbursement,
                "category": (
                    {
                        "id": txn.category.id,
                        "name": txn.category.name,
                        "type": txn.category.type.value,
                        "icon": txn.category.icon,
                    }
                    if txn.category
                    else None
                ),
                "title": txn.title,
                "description": txn.description,
                "tags": [{"id": tag.id, "name": tag.name} for tag in txn.tags],
            }
            for txn in recent
        ],
        "categories": [
            {
                "id": category.id,
                "name": category.name,
                "type": category.type.value,
                "icon": category.icon,
            }
            for category in categories
        ],
        "tags": [{"id": tag.id, "name": tag.name} for tag in tags],
    }
    if active_durable:
        payload["durable_purchases"] = active_durable
    if budget_pace:
        payload["budget_pace"] = budget_pace
    if category_budget_overview:
        payload["category_budget_pulse"] = category_budget_overview["items"]
        payload["category_budget_summary"] = {
            "total": category_budget_overview["total"],
            "needs_attention": category_budget_overview["needs_attention"],
            "priority": category_budget_overview["priority"],
        }
    return payload


def _generate_report_pdf_bytes(
    *, base_url: str, options: ReportOptions, db: Session, user_id: int
) -> bytes:
    try:
        from weasyprint import HTML
    except (ImportError, OSError) as exc:
        raise HTTPException(
            status_code=500,
            detail="PDF export requires WeasyPrint system dependencies; install them for your OS and retry.",
        ) from exc

    start_time = datetime.now()
    report_service = ReportService(db, user_id=user_id)
    data = report_service.gather_data(options)
    data["generated_at"] = datetime.now()
    data["app_version"] = APP_VERSION
    gather_duration = (datetime.now() - start_time).total_seconds()
    log_event(
        logger,
        logging.INFO,
        "report_data_gathered",
        period_start=options.start.isoformat(),
        period_end=options.end.isoformat(),
        sections=options.sections,
        data_gather_duration_secs=round(gather_duration, 3),
    )

    html = render_report_html(data)
    start_time = datetime.now()
    pdf_bytes = HTML(string=html, base_url=base_url).write_pdf()
    pdf_duration = (datetime.now() - start_time).total_seconds()
    log_event(
        logger,
        logging.INFO,
        "report_pdf_rendered",
        period_start=options.start.isoformat(),
        period_end=options.end.isoformat(),
        pdf_size_bytes=len(pdf_bytes),
        pdf_duration_secs=round(pdf_duration, 3),
    )
    return pdf_bytes


@router.post("/api/reports/pdf", response_class=StreamingResponse)
def api_generate_pdf_report(
    options: ReportOptions, request: Request, db: Session = Depends(get_db)
):
    user_id = _require_current_user_id(request, db)
    _require_csrf(request, db)
    _validate_report_bounds(options, db, user_id)

    try:
        pdf_bytes = _generate_report_pdf_bytes(
            base_url=str(request.base_url), options=options, db=db, user_id=user_id
        )
    except HTTPException:
        raise
    except (RuntimeError, ValueError, OSError) as exc:
        log_event(
            logger,
            logging.ERROR,
            "report_pdf_generation_failed",
            period_start=options.start.isoformat(),
            period_end=options.end.isoformat(),
            exc_info=(type(exc), exc, exc.__traceback__),
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    filename = f"expense_report_{options.start}_{options.end}.pdf"
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf_bytes)),
        },
    )
