import pytest
from fastapi.testclient import TestClient

from expenses_web.core.config import get_settings


@pytest.fixture()
def api_client(anonymous_api_client: TestClient) -> TestClient:
    return anonymous_api_client


def _credentials(username: str, password: str) -> dict[str, str]:
    return {"username": username, "password": password}


def _csrf_headers(api_client: TestClient) -> dict[str, str]:
    response = api_client.get("/api/csrf")
    assert response.status_code == 200
    return {"X-CSRF-Token": response.json()["token"]}


def test_bootstrap_status_reports_setup_required_and_blocks_login_signup(
    api_client: TestClient,
) -> None:
    response = api_client.get("/api/auth/bootstrap-status")
    assert response.status_code == 200
    assert response.json() == {
        "setup_required": True,
        "setup_allowed": True,
        "signup_allowed": False,
        "authenticated": False,
        "user": None,
    }

    login = api_client.post("/api/auth/login", json=_credentials("admin", "pw"))
    assert login.status_code == 409
    assert "set-cookie" not in login.headers

    signup = api_client.post("/api/auth/signup", json=_credentials("member", "pw"))
    assert signup.status_code == 409
    assert "set-cookie" not in signup.headers

    me = api_client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json() == {"authenticated": False, "user": None}


def test_setup_creates_bootstrap_admin_user_one_and_is_one_time(
    api_client: TestClient,
) -> None:
    setup = api_client.post(
        "/api/auth/setup", json=_credentials("bootstrap", "pw-12345")
    )
    assert setup.status_code == 200
    assert setup.json() == {
        "authenticated": True,
        "user": {"id": 1, "username": "bootstrap", "is_admin": True},
    }

    cookie_name = get_settings().auth_session_cookie_name
    set_cookie = setup.headers.get("set-cookie", "")
    assert f"{cookie_name}=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "SameSite=lax" in set_cookie
    assert "Max-Age=" in set_cookie

    me = api_client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json() == {
        "authenticated": True,
        "user": {"id": 1, "username": "bootstrap", "is_admin": True},
    }

    status_after_setup = api_client.get("/api/auth/bootstrap-status")
    assert status_after_setup.status_code == 200
    assert status_after_setup.json() == {
        "setup_required": False,
        "setup_allowed": False,
        "signup_allowed": True,
        "authenticated": True,
        "user": {"id": 1, "username": "bootstrap", "is_admin": True},
    }

    api_client.cookies.clear()
    setup_again = api_client.post(
        "/api/auth/setup", json=_credentials("second", "pw-67890")
    )
    assert setup_again.status_code == 409
    assert "set-cookie" not in setup_again.headers

    me_without_session = api_client.get("/api/auth/me")
    assert me_without_session.status_code == 200
    assert me_without_session.json() == {"authenticated": False, "user": None}


def test_setup_rejects_invalid_payload_without_partial_bootstrap(
    api_client: TestClient,
) -> None:
    invalid = api_client.post("/api/auth/setup", json=_credentials("", "pw-12345"))
    assert invalid.status_code == 422

    status_after_invalid = api_client.get("/api/auth/bootstrap-status")
    assert status_after_invalid.status_code == 200
    assert status_after_invalid.json()["setup_required"] is True


def test_signup_login_duplicate_and_authenticated_signup_denial(
    api_client: TestClient,
) -> None:
    setup = api_client.post(
        "/api/auth/setup", json=_credentials("bootstrap", "pw-12345")
    )
    assert setup.status_code == 200
    api_client.cookies.clear()

    signup = api_client.post(
        "/api/auth/signup", json=_credentials("member", "member-pw")
    )
    assert signup.status_code == 200
    payload = signup.json()
    assert payload == {
        "created": True,
        "user": {
            "username": "member",
            "is_admin": False,
            "id": 2,
        },
    }
    assert "set-cookie" not in signup.headers

    duplicate = api_client.post(
        "/api/auth/signup", json=_credentials("member", "other-pw")
    )
    assert duplicate.status_code == 409
    assert "set-cookie" not in duplicate.headers

    bad_login = api_client.post("/api/auth/login", json=_credentials("member", "wrong"))
    assert bad_login.status_code == 401
    assert "set-cookie" not in bad_login.headers

    unknown_login = api_client.post(
        "/api/auth/login", json=_credentials("missing", "member-pw")
    )
    assert unknown_login.status_code == 401
    assert "set-cookie" not in unknown_login.headers

    login = api_client.post("/api/auth/login", json=_credentials("member", "member-pw"))
    assert login.status_code == 200
    assert login.json() == {
        "authenticated": True,
        "user": {"id": 2, "username": "member", "is_admin": False},
    }

    member_me = api_client.get("/api/auth/me")
    assert member_me.status_code == 200
    assert member_me.json() == {
        "authenticated": True,
        "user": {"id": 2, "username": "member", "is_admin": False},
    }

    denied_signup = api_client.post(
        "/api/auth/signup", json=_credentials("third", "third-pw")
    )
    assert denied_signup.status_code == 403

    me_after_denied_signup = api_client.get("/api/auth/me")
    assert me_after_denied_signup.status_code == 200
    assert me_after_denied_signup.json() == {
        "authenticated": True,
        "user": {"id": 2, "username": "member", "is_admin": False},
    }


def test_logout_revokes_session_and_replayed_cookie_fails(
    api_client: TestClient,
) -> None:
    setup = api_client.post(
        "/api/auth/setup", json=_credentials("bootstrap", "pw-12345")
    )
    assert setup.status_code == 200

    cookie_name = get_settings().auth_session_cookie_name
    raw_token = api_client.cookies.get(cookie_name)
    assert raw_token

    logout = api_client.post("/api/auth/logout", headers=_csrf_headers(api_client))
    assert logout.status_code == 200
    assert logout.json() == {"authenticated": False}

    logout_cookie = logout.headers.get("set-cookie", "")
    assert f"{cookie_name}=" in logout_cookie
    assert "Max-Age=0" in logout_cookie

    me_after_logout = api_client.get("/api/auth/me")
    assert me_after_logout.status_code == 200
    assert me_after_logout.json() == {"authenticated": False, "user": None}

    api_client.cookies.set(cookie_name, raw_token)
    replay_me = api_client.get("/api/auth/me")
    assert replay_me.status_code == 200
    assert replay_me.json() == {"authenticated": False, "user": None}


def test_authenticated_mutation_rejects_missing_bogus_and_wrong_session_csrf(
    api_client: TestClient,
) -> None:
    setup = api_client.post(
        "/api/auth/setup", json=_credentials("bootstrap", "pw-12345")
    )
    assert setup.status_code == 200

    bootstrap_csrf_headers = _csrf_headers(api_client)

    missing_csrf = api_client.post("/api/auth/logout")
    assert missing_csrf.status_code == 400

    still_authenticated = api_client.get("/api/auth/me")
    assert still_authenticated.status_code == 200
    assert still_authenticated.json() == {
        "authenticated": True,
        "user": {"id": 1, "username": "bootstrap", "is_admin": True},
    }

    bogus_csrf = api_client.post(
        "/api/auth/logout",
        headers={"X-CSRF-Token": "bogus"},
    )
    assert bogus_csrf.status_code == 400

    logout_bootstrap = api_client.post(
        "/api/auth/logout", headers=bootstrap_csrf_headers
    )
    assert logout_bootstrap.status_code == 200

    signup = api_client.post(
        "/api/auth/signup", json=_credentials("member", "member-pw")
    )
    assert signup.status_code == 200

    login_member = api_client.post(
        "/api/auth/login", json=_credentials("member", "member-pw")
    )
    assert login_member.status_code == 200

    wrong_session_csrf = api_client.post(
        "/api/auth/logout", headers=bootstrap_csrf_headers
    )
    assert wrong_session_csrf.status_code == 400

    member_me = api_client.get("/api/auth/me")
    assert member_me.status_code == 200
    assert member_me.json() == {
        "authenticated": True,
        "user": {"id": 2, "username": "member", "is_admin": False},
    }

    member_logout = api_client.post(
        "/api/auth/logout", headers=_csrf_headers(api_client)
    )
    assert member_logout.status_code == 200


def test_csrf_tokens_are_invalidated_across_login_and_logout_transitions(
    api_client: TestClient,
) -> None:
    setup = api_client.post(
        "/api/auth/setup", json=_credentials("bootstrap", "pw-12345")
    )
    assert setup.status_code == 200

    api_client.cookies.clear()
    anonymous_csrf_headers = _csrf_headers(api_client)

    login_bootstrap = api_client.post(
        "/api/auth/login",
        json=_credentials("bootstrap", "pw-12345"),
    )
    assert login_bootstrap.status_code == 200

    pre_login_token_rejected = api_client.post(
        "/api/auth/logout",
        headers=anonymous_csrf_headers,
    )
    assert pre_login_token_rejected.status_code == 400

    session_one_csrf_headers = _csrf_headers(api_client)
    logout_one = api_client.post("/api/auth/logout", headers=session_one_csrf_headers)
    assert logout_one.status_code == 200

    login_again = api_client.post(
        "/api/auth/login", json=_credentials("bootstrap", "pw-12345")
    )
    assert login_again.status_code == 200

    stale_post_logout_token = api_client.post(
        "/api/auth/logout",
        headers=session_one_csrf_headers,
    )
    assert stale_post_logout_token.status_code == 400

    fresh_logout = api_client.post(
        "/api/auth/logout", headers=_csrf_headers(api_client)
    )
    assert fresh_logout.status_code == 200
