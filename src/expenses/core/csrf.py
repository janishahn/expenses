import time

from itsdangerous import BadSignature, URLSafeSerializer

from expenses.core.config import get_settings


def _serializer() -> URLSafeSerializer:
    settings = get_settings()
    return URLSafeSerializer(settings.csrf_secret, salt="csrf-token")


def generate_csrf_token(
    *,
    session_id: int | None = None,
    session_csrf_secret: str | None = None,
    max_age_hours: int = 2,
) -> str:
    if session_id is None:
        session_csrf_secret = None
    elif not session_csrf_secret:
        raise ValueError("Session CSRF secret is required for session-bound tokens")

    serializer = _serializer()
    timestamp = int(time.time())
    expiry = timestamp + (max_age_hours * 3600)

    token_data = {
        "sid": session_id,
        "ss": session_csrf_secret,
        "ts": timestamp,
        "exp": expiry,
    }

    return serializer.dumps(token_data)


def validate_csrf_token(
    token: str,
    *,
    session_id: int | None = None,
    session_csrf_secret: str | None = None,
    max_age_hours: int = 2,
) -> bool:
    serializer = _serializer()
    try:
        data = serializer.loads(token, max_age=max_age_hours * 3600)
    except BadSignature:
        return False

    current_time = int(time.time())
    expiry_time = data.get("exp", 0)
    if current_time > expiry_time:
        return False

    token_session_id = data.get("sid")
    token_session_secret = data.get("ss")

    if session_id is None:
        return token_session_id is None and token_session_secret is None

    if not session_csrf_secret:
        return False

    return (
        token_session_id == session_id and token_session_secret == session_csrf_secret
    )
