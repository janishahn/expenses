from dataclasses import dataclass
from datetime import datetime

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from expenses.auth.mobile_sessions import (
    is_mobile_auth_session_elevated,
    lookup_mobile_auth_session,
    touch_mobile_auth_session,
)
from expenses.auth.sessions import is_auth_session_elevated, lookup_auth_session
from expenses.core.config import get_settings
from expenses.db.models import AuthSession, MobileAuthSession, User


@dataclass(frozen=True)
class AuthContext:
    user: User | None
    auth_session: AuthSession | None
    mobile_session: MobileAuthSession | None
    checked_at: datetime

    @property
    def is_authenticated(self) -> bool:
        return self.user is not None and (
            self.auth_session is not None or self.mobile_session is not None
        )

    @property
    def is_admin_capable(self) -> bool:
        return bool(self.user and self.user.is_admin)

    @property
    def is_elevated(self) -> bool:
        if self.auth_session is not None:
            return is_auth_session_elevated(self.auth_session, now=self.checked_at)
        if self.mobile_session is not None:
            return is_mobile_auth_session_elevated(
                self.mobile_session, now=self.checked_at
            )
        return False


def _parse_bearer_token(request: Request) -> str | None:
    auth_header = request.headers.get("authorization", "")
    scheme, _, token = auth_header.partition(" ")
    if scheme.lower() != "bearer":
        return None
    token = token.strip()
    return token or None


def resolve_auth_context(
    request: Request,
    db: Session,
    *,
    now: datetime | None = None,
) -> AuthContext:
    checked_at = now or datetime.utcnow()
    cookie_name = get_settings().auth_session_cookie_name
    raw_token = request.cookies.get(cookie_name)
    bearer_token = _parse_bearer_token(request)

    if raw_token and bearer_token:
        raise HTTPException(status_code=400, detail="Mixed auth is not supported")

    if bearer_token:
        mobile_session = lookup_mobile_auth_session(db, bearer_token, now=checked_at)
        if mobile_session is None or mobile_session.user is None:
            return AuthContext(
                user=None,
                auth_session=None,
                mobile_session=None,
                checked_at=checked_at,
            )
        return AuthContext(
            user=mobile_session.user,
            auth_session=None,
            mobile_session=mobile_session,
            checked_at=checked_at,
        )

    if not raw_token:
        return AuthContext(
            user=None,
            auth_session=None,
            mobile_session=None,
            checked_at=checked_at,
        )

    auth_session = lookup_auth_session(db, raw_token, now=checked_at)
    if auth_session is None or auth_session.user is None:
        return AuthContext(
            user=None,
            auth_session=None,
            mobile_session=None,
            checked_at=checked_at,
        )

    return AuthContext(
        user=auth_session.user,
        auth_session=auth_session,
        mobile_session=None,
        checked_at=checked_at,
    )


def _touch_mobile_session(context: AuthContext, db: Session) -> None:
    if context.mobile_session is None:
        return
    touch_mobile_auth_session(context.mobile_session, now=context.checked_at)
    db.commit()


def require_current_session(
    request: Request,
    db: Session,
    *,
    now: datetime | None = None,
) -> AuthSession:
    context = resolve_auth_context(request, db, now=now)
    if context.auth_session is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return context.auth_session


def require_current_user(
    request: Request,
    db: Session,
    *,
    now: datetime | None = None,
) -> User:
    context = resolve_auth_context(request, db, now=now)
    if context.user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    _touch_mobile_session(context, db)
    return context.user


def require_admin_capable_user(
    request: Request,
    db: Session,
    *,
    now: datetime | None = None,
) -> User:
    context = resolve_auth_context(request, db, now=now)
    if context.user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    _touch_mobile_session(context, db)
    if not context.user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return context.user


def require_elevated_admin(
    request: Request,
    db: Session,
    *,
    now: datetime | None = None,
) -> AuthContext:
    context = resolve_auth_context(request, db, now=now)
    if context.user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    _touch_mobile_session(context, db)
    if not context.user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    if not context.is_elevated:
        raise HTTPException(status_code=403, detail="Admin elevation required")
    return context
