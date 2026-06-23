import base64
import hashlib
import hmac
import secrets

from expenses_web.core.config import get_settings

_PASSWORD_HASH_ALGORITHM = "_".join(("pbkdf2", "sha256"))
_PASSWORD_SALT_BYTES = 16
_SESSION_TOKEN_BYTES = 32
_CSRF_SECRET_BYTES = 32
_INGEST_TOKEN_BYTES = 32
_MOBILE_SESSION_TOKEN_BYTES = 32


def _base64_urlsafe_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _base64_urlsafe_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def hash_password(password: str, *, iterations: int | None = None) -> str:
    if not password:
        raise ValueError("Password cannot be blank")

    rounds = iterations or get_settings().auth_password_hash_iterations
    salt = secrets.token_bytes(_PASSWORD_SALT_BYTES)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, rounds)

    return (
        f"{_PASSWORD_HASH_ALGORITHM}"
        f"${rounds}"
        f"${_base64_urlsafe_encode(salt)}"
        f"${_base64_urlsafe_encode(digest)}"
    )


def verify_password(password: str, encoded_hash: str) -> bool:
    try:
        algorithm, rounds_text, salt_encoded, digest_encoded = encoded_hash.split(
            "$", 3
        )
        if algorithm != _PASSWORD_HASH_ALGORITHM:
            return False
        rounds = int(rounds_text)
        salt = _base64_urlsafe_decode(salt_encoded)
        expected_digest = _base64_urlsafe_decode(digest_encoded)
    except (TypeError, ValueError):
        return False

    candidate_digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, rounds
    )
    return hmac.compare_digest(candidate_digest, expected_digest)


def generate_session_token() -> str:
    return secrets.token_urlsafe(_SESSION_TOKEN_BYTES)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_mobile_session_token() -> str:
    return secrets.token_urlsafe(_MOBILE_SESSION_TOKEN_BYTES)


def hash_mobile_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_ingest_token() -> str:
    return secrets.token_urlsafe(_INGEST_TOKEN_BYTES)


def hash_ingest_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_session_csrf_secret() -> str:
    return secrets.token_hex(_CSRF_SECRET_BYTES)
