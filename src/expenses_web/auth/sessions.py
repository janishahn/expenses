from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from expenses_web.auth.security import (
    generate_session_csrf_secret,
    generate_session_token,
    hash_session_token,
)
from expenses_web.core.config import get_settings
from expenses_web.db.models import AuthSession, User


@dataclass(frozen=True)
class IssuedAuthSession:
    raw_token: str
    auth_session: AuthSession


def issue_auth_session(
    db: Session,
    user: User,
    *,
    now: datetime | None = None,
) -> IssuedAuthSession:
    issued_at = now or datetime.utcnow()
    raw_token = generate_session_token()
    auth_session = AuthSession(
        user_id=user.id,
        token_hash=hash_session_token(raw_token),
        csrf_secret=generate_session_csrf_secret(),
        expires_at=issued_at
        + timedelta(seconds=get_settings().auth_session_max_age_seconds),
    )
    db.add(auth_session)
    db.flush()
    return IssuedAuthSession(raw_token=raw_token, auth_session=auth_session)


def lookup_auth_session(
    db: Session,
    raw_token: str,
    *,
    now: datetime | None = None,
) -> AuthSession | None:
    if not raw_token:
        return None

    checked_at = now or datetime.utcnow()
    token_hash = hash_session_token(raw_token)
    stmt = select(AuthSession).where(
        AuthSession.token_hash == token_hash,
        AuthSession.revoked_at.is_(None),
        AuthSession.expires_at > checked_at,
    )
    return db.scalars(stmt).first()


def revoke_auth_session(
    db: Session,
    auth_session: AuthSession,
    *,
    revoked_at: datetime | None = None,
) -> None:
    if auth_session.revoked_at is not None:
        return
    auth_session.revoked_at = revoked_at or datetime.utcnow()
    db.add(auth_session)


def revoke_auth_session_by_token(
    db: Session,
    raw_token: str,
    *,
    revoked_at: datetime | None = None,
) -> bool:
    auth_session = lookup_auth_session(db, raw_token, now=revoked_at)
    if auth_session is None:
        return False
    revoke_auth_session(db, auth_session, revoked_at=revoked_at)
    return True


def elevate_auth_session(
    auth_session: AuthSession,
    *,
    now: datetime | None = None,
    ttl_seconds: int | None = None,
) -> None:
    elevated_at = now or datetime.utcnow()
    ttl = ttl_seconds or get_settings().auth_admin_elevation_ttl_seconds
    auth_session.elevated_until = elevated_at + timedelta(seconds=ttl)


def clear_auth_session_elevation(auth_session: AuthSession) -> None:
    auth_session.elevated_until = None


def is_auth_session_elevated(
    auth_session: AuthSession,
    *,
    now: datetime | None = None,
) -> bool:
    if auth_session.elevated_until is None:
        return False
    checked_at = now or datetime.utcnow()
    return auth_session.elevated_until > checked_at
