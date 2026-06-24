from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from starlette.requests import Request

from expenses.auth.dependencies import (
    require_admin_capable_user,
    require_current_user,
    require_elevated_admin,
    resolve_auth_context,
)
from expenses.auth.mobile_sessions import (
    elevate_mobile_auth_session,
    issue_mobile_auth_session,
    lookup_mobile_auth_session,
    revoke_mobile_auth_session,
)
from expenses.auth.security import hash_password, verify_password
from expenses.auth.sessions import (
    elevate_auth_session,
    issue_auth_session,
    lookup_auth_session,
    revoke_auth_session,
)
from expenses.core.config import get_settings
from expenses.db.models import User
from expenses.db.session import Base


@pytest.fixture(autouse=True)
def _auth_settings_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("EXPENSES_ENV", "test")
    monkeypatch.setenv("EXPENSES_AUTH_PASSWORD_HASH_ITERATIONS", "1000")
    monkeypatch.setenv("EXPENSES_AUTH_SESSION_MAX_AGE_SECONDS", "60")
    monkeypatch.setenv("EXPENSES_AUTH_ADMIN_ELEVATION_TTL_SECONDS", "120")
    monkeypatch.setenv("EXPENSES_AUTH_SESSION_COOKIE_NAME", "expenses_auth_session")
    get_settings.cache_clear()
    try:
        yield
    finally:
        get_settings.cache_clear()


@pytest.fixture()
def db_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def _request_with_cookie(cookie_name: str, cookie_value: str | None) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if cookie_value is not None:
        headers.append((b"cookie", f"{cookie_name}={cookie_value}".encode("latin-1")))
    scope = {
        "type": "http",
        "headers": headers,
        "method": "GET",
        "path": "/",
        "query_string": b"",
    }
    return Request(scope)


def _request_with_bearer(token: str | None, cookie: str | None = None) -> Request:
    headers: list[tuple[bytes, bytes]] = []
    if token is not None:
        headers.append((b"authorization", f"Bearer {token}".encode("latin-1")))
    if cookie is not None:
        headers.append((b"cookie", f"expenses_auth_session={cookie}".encode("latin-1")))
    scope = {
        "type": "http",
        "headers": headers,
        "method": "GET",
        "path": "/",
        "query_string": b"",
    }
    return Request(scope)


def test_auth_password_hashing_verifies_expected_password() -> None:
    encoded = hash_password("correct horse battery staple")

    assert encoded != "correct horse battery staple"
    assert verify_password("correct horse battery staple", encoded)
    assert not verify_password("wrong", encoded)
    assert not verify_password("wrong", "not-a-valid-hash")


def test_auth_session_issue_lookup_and_revoke(db_session: Session) -> None:
    now = datetime(2026, 4, 12, 10, 0, 0)
    user = User(
        username="bootstrap",
        password_hash=hash_password("pw-123456"),
        is_admin=True,
    )
    db_session.add(user)
    db_session.flush()

    issued = issue_auth_session(db_session, user, now=now)

    assert issued.raw_token
    assert issued.auth_session.token_hash
    assert issued.auth_session.token_hash != issued.raw_token

    looked_up = lookup_auth_session(db_session, issued.raw_token, now=now)
    assert looked_up is not None
    assert looked_up.id == issued.auth_session.id

    expired_lookup = lookup_auth_session(
        db_session,
        issued.raw_token,
        now=now + timedelta(seconds=61),
    )
    assert expired_lookup is None

    revoke_auth_session(
        db_session, issued.auth_session, revoked_at=now + timedelta(seconds=1)
    )
    db_session.flush()

    revoked_lookup = lookup_auth_session(
        db_session,
        issued.raw_token,
        now=now + timedelta(seconds=2),
    )
    assert revoked_lookup is None


def test_mobile_auth_session_issue_lookup_elevate_and_revoke(
    db_session: Session,
) -> None:
    now = datetime(2026, 5, 17, 10, 0, 0)
    user = User(
        username="bootstrap",
        password_hash=hash_password("pw-123456"),
        is_admin=True,
    )
    db_session.add(user)
    db_session.flush()

    issued = issue_mobile_auth_session(
        db_session,
        user,
        device_id="iphone-1",
        device_name="Test iPhone",
        now=now,
    )

    assert issued.raw_token
    assert issued.mobile_session.token_hash
    assert issued.mobile_session.token_hash != issued.raw_token
    assert issued.mobile_session.device_name == "Test iPhone"

    looked_up = lookup_mobile_auth_session(db_session, issued.raw_token, now=now)
    assert looked_up is not None
    assert looked_up.id == issued.mobile_session.id

    expired_lookup = lookup_mobile_auth_session(
        db_session,
        issued.raw_token,
        now=now + timedelta(seconds=get_settings().mobile_session_max_age_seconds + 1),
    )
    assert expired_lookup is None

    elevate_mobile_auth_session(issued.mobile_session, now=now)
    db_session.flush()
    elevated_context = require_elevated_admin(
        _request_with_bearer(issued.raw_token),
        db_session,
        now=now + timedelta(seconds=1),
    )
    assert elevated_context.mobile_session is not None
    assert elevated_context.is_elevated

    revoke_mobile_auth_session(
        db_session, issued.mobile_session, revoked_at=now + timedelta(seconds=2)
    )
    db_session.flush()

    revoked_lookup = lookup_mobile_auth_session(
        db_session,
        issued.raw_token,
        now=now + timedelta(seconds=3),
    )
    assert revoked_lookup is None


def test_auth_dependencies_resolve_user_session_admin_and_elevation(
    db_session: Session,
) -> None:
    now = datetime(2026, 4, 12, 11, 0, 0)

    admin_user = User(
        username="admin",
        password_hash=hash_password("admin-password"),
        is_admin=True,
    )
    member_user = User(
        username="member",
        password_hash=hash_password("member-password"),
        is_admin=False,
    )
    db_session.add_all([admin_user, member_user])
    db_session.flush()

    admin_issued = issue_auth_session(db_session, admin_user, now=now)
    member_issued = issue_auth_session(db_session, member_user, now=now)

    cookie_name = get_settings().auth_session_cookie_name
    admin_request = _request_with_cookie(cookie_name, admin_issued.raw_token)
    member_request = _request_with_cookie(cookie_name, member_issued.raw_token)
    anonymous_request = _request_with_cookie(cookie_name, None)

    admin_context = resolve_auth_context(
        admin_request,
        db_session,
        now=now + timedelta(seconds=1),
    )
    assert admin_context.user is not None
    assert admin_context.auth_session is not None
    assert admin_context.user.id == admin_user.id
    assert admin_context.is_admin_capable
    assert not admin_context.is_elevated

    with pytest.raises(HTTPException) as not_elevated_error:
        require_elevated_admin(
            admin_request, db_session, now=now + timedelta(seconds=1)
        )
    assert not_elevated_error.value.status_code == 403

    elevate_auth_session(admin_issued.auth_session, now=now)
    db_session.flush()

    elevated_context = require_elevated_admin(
        admin_request,
        db_session,
        now=now + timedelta(seconds=2),
    )
    assert elevated_context.user is not None
    assert elevated_context.user.id == admin_user.id
    assert elevated_context.is_elevated

    member_context = resolve_auth_context(member_request, db_session, now=now)
    assert member_context.user is not None
    assert member_context.user.id == member_user.id
    assert not member_context.is_admin_capable

    with pytest.raises(HTTPException) as member_admin_error:
        require_admin_capable_user(member_request, db_session, now=now)
    assert member_admin_error.value.status_code == 403

    with pytest.raises(HTTPException) as anonymous_error:
        require_current_user(anonymous_request, db_session, now=now)
    assert anonymous_error.value.status_code == 401


def test_auth_dependencies_resolve_mobile_bearer_and_reject_mixed_auth(
    db_session: Session,
) -> None:
    now = datetime(2026, 5, 17, 11, 0, 0)
    user = User(
        username="admin",
        password_hash=hash_password("admin-password"),
        is_admin=True,
    )
    db_session.add(user)
    db_session.flush()

    cookie_issued = issue_auth_session(db_session, user, now=now)
    mobile_issued = issue_mobile_auth_session(
        db_session,
        user,
        device_id="iphone-1",
        device_name="Test iPhone",
        now=now,
    )

    mobile_request = _request_with_bearer(mobile_issued.raw_token)
    mobile_context = resolve_auth_context(
        mobile_request, db_session, now=now + timedelta(seconds=1)
    )
    assert mobile_context.user is not None
    assert mobile_context.mobile_session is not None
    assert mobile_context.auth_session is None
    assert mobile_context.user.id == user.id

    mixed_request = _request_with_bearer(
        mobile_issued.raw_token, cookie=cookie_issued.raw_token
    )
    with pytest.raises(HTTPException) as mixed_error:
        resolve_auth_context(mixed_request, db_session, now=now)
    assert mixed_error.value.status_code == 400
