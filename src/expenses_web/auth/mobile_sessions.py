from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from expenses_web.auth.security import (
    generate_mobile_session_token,
    hash_mobile_session_token,
)
from expenses_web.core.config import get_settings
from expenses_web.db.models import MobileAuthSession, User


@dataclass(frozen=True)
class IssuedMobileAuthSession:
    raw_token: str
    mobile_session: MobileAuthSession


def issue_mobile_auth_session(
    db: Session,
    user: User,
    *,
    device_id: str,
    device_name: str,
    now: datetime | None = None,
) -> IssuedMobileAuthSession:
    issued_at = now or datetime.utcnow()
    raw_token = generate_mobile_session_token()
    expires_at = issued_at + timedelta(
        seconds=get_settings().mobile_session_max_age_seconds
    )
    mobile_session = db.scalars(
        select(MobileAuthSession).where(
            MobileAuthSession.user_id == user.id,
            MobileAuthSession.device_id == device_id,
        )
    ).first()
    if mobile_session is None:
        mobile_session = MobileAuthSession(
            user_id=user.id,
            token_hash=hash_mobile_session_token(raw_token),
            device_id=device_id,
            device_name=device_name,
            expires_at=expires_at,
            last_used_at=issued_at,
        )
        db.add(mobile_session)
    else:
        mobile_session.token_hash = hash_mobile_session_token(raw_token)
        mobile_session.device_name = device_name
        mobile_session.expires_at = expires_at
        mobile_session.last_used_at = issued_at
        mobile_session.revoked_at = None
        mobile_session.elevated_until = None
        db.add(mobile_session)
    db.flush()
    return IssuedMobileAuthSession(raw_token=raw_token, mobile_session=mobile_session)


def lookup_mobile_auth_session(
    db: Session,
    raw_token: str,
    *,
    now: datetime | None = None,
) -> MobileAuthSession | None:
    if not raw_token:
        return None

    checked_at = now or datetime.utcnow()
    token_hash = hash_mobile_session_token(raw_token)
    stmt = select(MobileAuthSession).where(
        MobileAuthSession.token_hash == token_hash,
        MobileAuthSession.revoked_at.is_(None),
        MobileAuthSession.expires_at > checked_at,
    )
    return db.scalars(stmt).first()


def revoke_mobile_auth_session(
    db: Session,
    mobile_session: MobileAuthSession,
    *,
    revoked_at: datetime | None = None,
) -> None:
    if mobile_session.revoked_at is not None:
        return
    mobile_session.revoked_at = revoked_at or datetime.utcnow()
    db.add(mobile_session)


def touch_mobile_auth_session(
    mobile_session: MobileAuthSession, now: datetime | None = None
) -> None:
    mobile_session.last_used_at = now or datetime.utcnow()


def elevate_mobile_auth_session(
    mobile_session: MobileAuthSession,
    *,
    now: datetime | None = None,
    ttl_seconds: int | None = None,
) -> None:
    elevated_at = now or datetime.utcnow()
    ttl = ttl_seconds or get_settings().auth_admin_elevation_ttl_seconds
    mobile_session.elevated_until = elevated_at + timedelta(seconds=ttl)


def is_mobile_auth_session_elevated(
    mobile_session: MobileAuthSession,
    *,
    now: datetime | None = None,
) -> bool:
    if mobile_session.elevated_until is None:
        return False
    checked_at = now or datetime.utcnow()
    return mobile_session.elevated_until > checked_at
