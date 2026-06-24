import os
import secrets
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(override=False)


class Settings:
    def __init__(
        self,
        database_url: str,
        environment: str,
        timezone: str,
        csrf_secret: str,
        csrf_secret_source: str,
        fx_markup_bps: int,
        fx_timeout_secs: float,
        fx_fallback_rate: float,
        data_dir: Path,
        receipts_dir: Path,
        receipt_max_bytes: int,
        receipt_thumbnail_max_pixels: int,
        log_dir: Path,
        log_level_file: str,
        log_level_stdout: str,
        log_max_bytes: int,
        log_backup_count: int,
        log_capture_max_bytes: int,
        auth_session_cookie_name: str,
        auth_session_max_age_seconds: int,
        mobile_session_max_age_seconds: int,
        auth_password_hash_iterations: int,
        auth_admin_elevation_ttl_seconds: int,
        auth_signup_enabled: bool,
        auth_setup_token: str | None,
        auth_throttle_max_failures: int,
        auth_throttle_window_seconds: int,
        auth_throttle_lockout_seconds: int,
        auth_throttle_max_keys: int,
        trusted_proxy_ips: set[str],
        csv_import_max_bytes: int,
        csv_import_max_rows: int,
        bank_csv_import_max_bytes: int,
        bank_csv_import_max_rows: int,
        sqlite_import_max_bytes: int,
        sqlite_import_dir: Path,
        rule_regex_timeout_seconds: float,
        rule_regex_max_length: int,
        report_max_days: int,
        report_max_transactions: int,
        llm_enabled: bool,
        llm_provider: str,
        llm_base_url: str | None,
        llm_model: str,
        llm_api_key: str,
    ) -> None:
        self.database_url = database_url
        self.environment = environment
        self.timezone = timezone
        self.csrf_secret = csrf_secret
        self.csrf_secret_source = csrf_secret_source
        self.fx_markup_bps = fx_markup_bps
        self.fx_timeout_secs = fx_timeout_secs
        self.fx_fallback_rate = fx_fallback_rate
        self.data_dir = data_dir
        self.receipts_dir = receipts_dir
        self.receipt_max_bytes = receipt_max_bytes
        self.receipt_thumbnail_max_pixels = receipt_thumbnail_max_pixels
        self.log_dir = log_dir
        self.log_level_file = log_level_file
        self.log_level_stdout = log_level_stdout
        self.log_max_bytes = log_max_bytes
        self.log_backup_count = log_backup_count
        self.log_capture_max_bytes = log_capture_max_bytes
        self.auth_session_cookie_name = auth_session_cookie_name
        self.auth_session_max_age_seconds = auth_session_max_age_seconds
        self.mobile_session_max_age_seconds = mobile_session_max_age_seconds
        self.auth_password_hash_iterations = auth_password_hash_iterations
        self.auth_admin_elevation_ttl_seconds = auth_admin_elevation_ttl_seconds
        self.auth_signup_enabled = auth_signup_enabled
        self.auth_setup_token = auth_setup_token
        self.auth_throttle_max_failures = auth_throttle_max_failures
        self.auth_throttle_window_seconds = auth_throttle_window_seconds
        self.auth_throttle_lockout_seconds = auth_throttle_lockout_seconds
        self.auth_throttle_max_keys = auth_throttle_max_keys
        self.trusted_proxy_ips = trusted_proxy_ips
        self.csv_import_max_bytes = csv_import_max_bytes
        self.csv_import_max_rows = csv_import_max_rows
        self.bank_csv_import_max_bytes = bank_csv_import_max_bytes
        self.bank_csv_import_max_rows = bank_csv_import_max_rows
        self.sqlite_import_max_bytes = sqlite_import_max_bytes
        self.sqlite_import_dir = sqlite_import_dir
        self.rule_regex_timeout_seconds = rule_regex_timeout_seconds
        self.rule_regex_max_length = rule_regex_max_length
        self.report_max_days = report_max_days
        self.report_max_transactions = report_max_transactions
        self.llm_enabled = llm_enabled
        self.llm_provider = llm_provider
        self.llm_base_url = llm_base_url
        self.llm_model = llm_model
        self.llm_api_key = llm_api_key


def _ensure_data_dir() -> Path:
    root = Path(os.getenv("EXPENSES_DATA_DIR", "./data")).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _configured_value(name: str) -> str | None:
    value = os.getenv(name)
    if value is None:
        return None
    value = value.strip()
    return value or None


def _env_list(name: str) -> set[str]:
    value = os.getenv(name, "")
    return {part.strip() for part in value.split(",") if part.strip()}


def _read_or_create_secret_file(path: Path) -> str:
    if path.exists():
        secret = path.read_text(encoding="utf-8").strip()
        if not secret:
            raise ValueError(f"{path} is empty")
        return secret

    path.parent.mkdir(parents=True, exist_ok=True)
    secret = secrets.token_urlsafe(32)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        secret = path.read_text(encoding="utf-8").strip()
        if not secret:
            raise ValueError(f"{path} is empty") from None
        return secret
    with os.fdopen(fd, "w", encoding="utf-8") as file:
        file.write(f"{secret}\n")
    return secret


def _csrf_secret(data_dir: Path) -> tuple[str, str]:
    secret = _configured_value("EXPENSES_CSRF_SECRET")
    if secret is not None:
        return secret, "env"

    configured_path = _configured_value("EXPENSES_CSRF_SECRET_FILE")
    if configured_path is not None:
        return _read_or_create_secret_file(Path(configured_path).expanduser()), (
            "configured_file"
        )

    return _read_or_create_secret_file(data_dir / "secrets" / "csrf_secret"), (
        "generated_file"
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    data_dir = _ensure_data_dir()
    default_db = data_dir / "expenses.db"
    database_url = os.getenv("EXPENSES_DATABASE_URL", f"sqlite:///{default_db}")
    environment = os.getenv("EXPENSES_ENV", "Local")
    timezone = os.getenv("EXPENSES_TIMEZONE", "Europe/Berlin")
    csrf_secret, csrf_secret_source = _csrf_secret(data_dir)
    fx_markup_bps = int(os.getenv("EXPENSES_FX_MARKUP_BPS", "0"))
    fx_timeout_secs = float(os.getenv("EXPENSES_FX_TIMEOUT_SECS", "5"))
    fx_fallback_rate = float(os.getenv("EXPENSES_FX_FALLBACK_RATE", "0.92"))
    receipts_dir = Path(
        os.getenv("EXPENSES_RECEIPTS_DIR", str(data_dir / "receipts"))
    ).resolve()
    receipts_dir.mkdir(parents=True, exist_ok=True)
    receipt_max_bytes = int(os.getenv("EXPENSES_RECEIPT_MAX_BYTES", "10485760"))
    receipt_thumbnail_max_pixels = int(
        os.getenv("EXPENSES_RECEIPT_THUMBNAIL_MAX_PIXELS", "20000000")
    )
    log_dir = Path(
        os.getenv("EXPENSES_LOG_DIR", str(data_dir.parent / "logs"))
    ).resolve()
    log_dir.mkdir(parents=True, exist_ok=True)
    log_level_file = os.getenv("EXPENSES_LOG_LEVEL_FILE", "INFO")
    log_level_stdout = os.getenv("EXPENSES_LOG_LEVEL_STDOUT", "WARNING")
    log_max_bytes = int(os.getenv("EXPENSES_LOG_MAX_BYTES", "10485760"))
    log_backup_count = int(os.getenv("EXPENSES_LOG_BACKUP_COUNT", "10"))
    log_capture_max_bytes = int(os.getenv("EXPENSES_LOG_CAPTURE_MAX_BYTES", "65536"))
    auth_session_cookie_name = os.getenv(
        "EXPENSES_AUTH_SESSION_COOKIE_NAME", "expenses_auth_session"
    )
    auth_session_max_age_seconds = int(
        os.getenv("EXPENSES_AUTH_SESSION_MAX_AGE_SECONDS", "2592000")
    )
    mobile_session_max_age_seconds = int(
        os.getenv("EXPENSES_MOBILE_SESSION_MAX_AGE_SECONDS", "7776000")
    )
    auth_password_hash_iterations = int(
        os.getenv("EXPENSES_AUTH_PASSWORD_HASH_ITERATIONS", "600000")
    )
    if (
        auth_password_hash_iterations < 100_000
        and environment.strip().lower() != "test"
    ):
        raise ValueError(
            "EXPENSES_AUTH_PASSWORD_HASH_ITERATIONS must be at least 100000 "
            "outside EXPENSES_ENV=test"
        )
    auth_admin_elevation_ttl_seconds = int(
        os.getenv("EXPENSES_AUTH_ADMIN_ELEVATION_TTL_SECONDS", "900")
    )
    auth_signup_enabled = _env_flag("EXPENSES_AUTH_SIGNUP_ENABLED", True)
    auth_setup_token = _configured_value("EXPENSES_AUTH_SETUP_TOKEN")
    auth_throttle_max_failures = int(
        os.getenv("EXPENSES_AUTH_THROTTLE_MAX_FAILURES", "5")
    )
    auth_throttle_window_seconds = int(
        os.getenv("EXPENSES_AUTH_THROTTLE_WINDOW_SECONDS", "300")
    )
    auth_throttle_lockout_seconds = int(
        os.getenv("EXPENSES_AUTH_THROTTLE_LOCKOUT_SECONDS", "60")
    )
    auth_throttle_max_keys = int(os.getenv("EXPENSES_AUTH_THROTTLE_MAX_KEYS", "4096"))
    trusted_proxy_ips = _env_list("EXPENSES_TRUSTED_PROXY_IPS")
    csv_import_max_bytes = int(os.getenv("EXPENSES_CSV_IMPORT_MAX_BYTES", "5242880"))
    csv_import_max_rows = int(os.getenv("EXPENSES_CSV_IMPORT_MAX_ROWS", "5000"))
    bank_csv_import_max_bytes = int(
        os.getenv("EXPENSES_BANK_CSV_IMPORT_MAX_BYTES", "5242880")
    )
    bank_csv_import_max_rows = int(
        os.getenv("EXPENSES_BANK_CSV_IMPORT_MAX_ROWS", "5000")
    )
    sqlite_import_max_bytes = int(
        os.getenv("EXPENSES_SQLITE_IMPORT_MAX_BYTES", str(25 * 1024 * 1024))
    )
    sqlite_import_dir = Path(
        os.getenv("EXPENSES_SQLITE_IMPORT_DIR", str(data_dir / "imports"))
    ).resolve()
    sqlite_import_dir.mkdir(parents=True, exist_ok=True)
    rule_regex_timeout_seconds = float(
        os.getenv("EXPENSES_RULE_REGEX_TIMEOUT_SECONDS", "0.05")
    )
    rule_regex_max_length = int(os.getenv("EXPENSES_RULE_REGEX_MAX_LENGTH", "200"))
    report_max_days = int(os.getenv("EXPENSES_REPORT_MAX_DAYS", "366"))
    report_max_transactions = int(os.getenv("EXPENSES_REPORT_MAX_TRANSACTIONS", "5000"))
    llm_enabled = _env_flag("EXPENSES_LLM_ENABLED", False)
    llm_provider = os.getenv("EXPENSES_LLM_PROVIDER", "homelab").strip().lower()
    if llm_provider not in {"homelab", "openrouter"}:
        raise ValueError("EXPENSES_LLM_PROVIDER must be 'homelab' or 'openrouter'")
    if llm_provider == "openrouter":
        llm_base_url = (
            os.getenv("EXPENSES_LLM_BASE_URL", "https://openrouter.ai/api/v1").strip()
            or None
        )
        llm_model = (
            os.getenv("EXPENSES_LLM_MODEL", "deepseek/deepseek-v4-flash").strip()
            or "deepseek/deepseek-v4-flash"
        )
        llm_api_key = (
            os.getenv("EXPENSES_LLM_API_KEY") or os.getenv("OPENROUTER_API_KEY") or ""
        ).strip()
    else:
        llm_base_url = os.getenv("EXPENSES_LLM_BASE_URL")
        if llm_base_url is not None:
            llm_base_url = llm_base_url.strip() or None
        llm_model = os.getenv("EXPENSES_LLM_MODEL", "qwen").strip() or "qwen"
        llm_api_key = os.getenv("EXPENSES_LLM_API_KEY", "not-needed").strip()

    return Settings(
        database_url=database_url,
        environment=environment,
        timezone=timezone,
        csrf_secret=csrf_secret,
        csrf_secret_source=csrf_secret_source,
        fx_markup_bps=fx_markup_bps,
        fx_timeout_secs=fx_timeout_secs,
        fx_fallback_rate=fx_fallback_rate,
        data_dir=data_dir,
        receipts_dir=receipts_dir,
        receipt_max_bytes=receipt_max_bytes,
        receipt_thumbnail_max_pixels=receipt_thumbnail_max_pixels,
        log_dir=log_dir,
        log_level_file=log_level_file,
        log_level_stdout=log_level_stdout,
        log_max_bytes=log_max_bytes,
        log_backup_count=log_backup_count,
        log_capture_max_bytes=log_capture_max_bytes,
        auth_session_cookie_name=auth_session_cookie_name,
        auth_session_max_age_seconds=auth_session_max_age_seconds,
        mobile_session_max_age_seconds=mobile_session_max_age_seconds,
        auth_password_hash_iterations=auth_password_hash_iterations,
        auth_admin_elevation_ttl_seconds=auth_admin_elevation_ttl_seconds,
        auth_signup_enabled=auth_signup_enabled,
        auth_setup_token=auth_setup_token,
        auth_throttle_max_failures=auth_throttle_max_failures,
        auth_throttle_window_seconds=auth_throttle_window_seconds,
        auth_throttle_lockout_seconds=auth_throttle_lockout_seconds,
        auth_throttle_max_keys=auth_throttle_max_keys,
        trusted_proxy_ips=trusted_proxy_ips,
        csv_import_max_bytes=csv_import_max_bytes,
        csv_import_max_rows=csv_import_max_rows,
        bank_csv_import_max_bytes=bank_csv_import_max_bytes,
        bank_csv_import_max_rows=bank_csv_import_max_rows,
        sqlite_import_max_bytes=sqlite_import_max_bytes,
        sqlite_import_dir=sqlite_import_dir,
        rule_regex_timeout_seconds=rule_regex_timeout_seconds,
        rule_regex_max_length=rule_regex_max_length,
        report_max_days=report_max_days,
        report_max_transactions=report_max_transactions,
        llm_enabled=llm_enabled,
        llm_provider=llm_provider,
        llm_base_url=llm_base_url,
        llm_model=llm_model,
        llm_api_key=llm_api_key,
    )
