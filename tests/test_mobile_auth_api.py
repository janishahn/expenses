from fastapi.testclient import TestClient
from sqlalchemy import text

import expenses_web.app as app_main
from expenses_web.core.config import get_settings


def _mobile_credentials(
    username: str,
    password: str,
    *,
    device_id: str = "iphone-1",
    device_name: str = "Test iPhone",
) -> dict[str, str]:
    return {
        "username": username,
        "password": password,
        "device_id": device_id,
        "device_name": device_name,
    }


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _csrf_headers(api_client: TestClient) -> dict[str, str]:
    response = api_client.get("/api/csrf")
    assert response.status_code == 200
    return {"X-CSRF-Token": response.json()["token"]}


def test_mobile_status_reports_public_capabilities(
    anonymous_api_client: TestClient,
) -> None:
    response = anonymous_api_client.get("/api/mobile/status")

    assert response.status_code == 200
    assert response.json() == {
        "app": "expenses-web",
        "version": "0.1.0",
        "setup_required": True,
        "timezone": "Europe/Berlin",
        "receipt_max_bytes": 10485760,
    }


def test_mobile_setup_issues_device_token_without_web_cookie(
    anonymous_api_client: TestClient,
) -> None:
    setup = anonymous_api_client.post(
        "/api/mobile/auth/setup",
        json=_mobile_credentials("bootstrap", "pw-12345"),
    )

    assert setup.status_code == 200
    payload = setup.json()
    assert payload["authenticated"] is True
    assert payload["user"] == {"id": 1, "username": "bootstrap", "is_admin": True}
    assert payload["token"]
    assert payload["session"]["device_id"] == "iphone-1"
    assert payload["session"]["device_name"] == "Test iPhone"
    assert "set-cookie" not in setup.headers

    me = anonymous_api_client.get(
        "/api/mobile/auth/me", headers=_bearer(payload["token"])
    )
    assert me.status_code == 200
    assert me.json()["user"] == {
        "id": 1,
        "username": "bootstrap",
        "is_admin": True,
    }


def test_mobile_login_rotates_existing_device_token_and_logout_revokes_it(
    anonymous_api_client: TestClient,
) -> None:
    setup = anonymous_api_client.post(
        "/api/mobile/auth/setup",
        json=_mobile_credentials("bootstrap", "pw-12345"),
    )
    assert setup.status_code == 200
    first_token = setup.json()["token"]

    login = anonymous_api_client.post(
        "/api/mobile/auth/login",
        json=_mobile_credentials("bootstrap", "pw-12345"),
    )
    assert login.status_code == 200
    second_token = login.json()["token"]
    assert second_token != first_token
    assert login.json()["session"]["id"] == setup.json()["session"]["id"]

    replay = anonymous_api_client.get(
        "/api/mobile/auth/me", headers=_bearer(first_token)
    )
    assert replay.status_code == 401

    current = anonymous_api_client.get(
        "/api/mobile/auth/me", headers=_bearer(second_token)
    )
    assert current.status_code == 200

    logout = anonymous_api_client.post(
        "/api/mobile/auth/logout", headers=_bearer(second_token)
    )
    assert logout.status_code == 200
    assert logout.json() == {"authenticated": False}

    after_logout = anonymous_api_client.get(
        "/api/mobile/auth/me", headers=_bearer(second_token)
    )
    assert after_logout.status_code == 401


def test_mobile_bearer_can_use_existing_domain_endpoints_without_csrf(
    anonymous_api_client: TestClient,
) -> None:
    setup = anonymous_api_client.post(
        "/api/mobile/auth/setup",
        json=_mobile_credentials("bootstrap", "pw-12345"),
    )
    token = setup.json()["token"]

    create = anonymous_api_client.post(
        "/api/categories",
        headers=_bearer(token),
        json={"name": "Groceries", "type": "expense", "icon": "receipt", "order": 0},
    )
    assert create.status_code == 200
    assert create.json()["name"] == "Groceries"

    categories = anonymous_api_client.get("/api/categories", headers=_bearer(token))
    assert categories.status_code == 200
    assert [category["name"] for category in categories.json()["categories"]] == [
        "Groceries"
    ]


def test_mobile_domain_endpoint_updates_session_last_used_at(
    anonymous_api_client: TestClient,
) -> None:
    setup = anonymous_api_client.post(
        "/api/mobile/auth/setup",
        json=_mobile_credentials("bootstrap", "pw-12345"),
    )
    assert setup.status_code == 200
    token = setup.json()["token"]
    session_id = setup.json()["session"]["id"]

    override = app_main.app.dependency_overrides[app_main.get_db]
    db_iterator = override()
    db = next(db_iterator)
    try:
        db.execute(
            text(
                "UPDATE mobile_auth_sessions "
                "SET last_used_at = '2000-01-01 00:00:00' "
                "WHERE id = :session_id"
            ),
            {"session_id": session_id},
        )
        db.commit()
    finally:
        db_iterator.close()

    dashboard = anonymous_api_client.get("/api/dashboard", headers=_bearer(token))
    assert dashboard.status_code == 200

    db_iterator = override()
    db = next(db_iterator)
    try:
        last_used_at = db.execute(
            text(
                "SELECT last_used_at FROM mobile_auth_sessions WHERE id = :session_id"
            ),
            {"session_id": session_id},
        ).scalar_one()
    finally:
        db_iterator.close()
    assert str(last_used_at) != "2000-01-01 00:00:00"


def test_web_cookie_mutations_still_require_csrf(
    anonymous_api_client: TestClient,
) -> None:
    setup = anonymous_api_client.post(
        "/api/auth/setup", json={"username": "bootstrap", "password": "pw-12345"}
    )
    assert setup.status_code == 200

    missing_csrf = anonymous_api_client.post(
        "/api/categories",
        json={"name": "Groceries", "type": "expense", "icon": "receipt", "order": 0},
    )
    assert missing_csrf.status_code == 400

    with_csrf = anonymous_api_client.post(
        "/api/categories",
        headers=_csrf_headers(anonymous_api_client),
        json={"name": "Groceries", "type": "expense", "icon": "receipt", "order": 0},
    )
    assert with_csrf.status_code == 200


def test_mixed_cookie_and_mobile_bearer_auth_is_rejected(
    anonymous_api_client: TestClient,
) -> None:
    web_setup = anonymous_api_client.post(
        "/api/auth/setup", json={"username": "bootstrap", "password": "pw-12345"}
    )
    assert web_setup.status_code == 200
    cookie_name = get_settings().auth_session_cookie_name
    web_cookie = anonymous_api_client.cookies.get(cookie_name)
    assert web_cookie

    anonymous_api_client.cookies.clear()
    mobile_login = anonymous_api_client.post(
        "/api/mobile/auth/login",
        json=_mobile_credentials("bootstrap", "pw-12345"),
    )
    token = mobile_login.json()["token"]

    mixed = anonymous_api_client.get(
        "/api/categories",
        headers={**_bearer(token), "Cookie": f"{cookie_name}={web_cookie}"},
    )
    assert mixed.status_code == 400
    assert mixed.json()["detail"] == "Mixed auth is not supported"


def test_mobile_auth_preserves_user_isolation(
    anonymous_api_client: TestClient,
) -> None:
    setup = anonymous_api_client.post(
        "/api/mobile/auth/setup",
        json=_mobile_credentials("bootstrap", "pw-12345", device_id="admin-phone"),
    )
    admin_token = setup.json()["token"]

    create_admin_category = anonymous_api_client.post(
        "/api/categories",
        headers=_bearer(admin_token),
        json={"name": "Private", "type": "expense", "icon": "lock", "order": 0},
    )
    assert create_admin_category.status_code == 200

    signup = anonymous_api_client.post(
        "/api/mobile/auth/signup",
        json=_mobile_credentials(
            "member",
            "member-pw",
            device_id="member-phone",
            device_name="Member iPhone",
        ),
    )
    assert signup.status_code == 200
    member_token = signup.json()["token"]

    member_categories = anonymous_api_client.get(
        "/api/categories", headers=_bearer(member_token)
    )
    assert member_categories.status_code == 200
    assert member_categories.json()["categories"] == []


def test_mobile_admin_elevation_unlocks_existing_admin_endpoint(
    anonymous_api_client: TestClient,
) -> None:
    setup = anonymous_api_client.post(
        "/api/mobile/auth/setup",
        json=_mobile_credentials("bootstrap", "pw-12345"),
    )
    token = setup.json()["token"]

    locked = anonymous_api_client.get("/api/admin/info", headers=_bearer(token))
    assert locked.status_code == 403
    assert locked.json()["detail"] == "Admin elevation required"

    elevation = anonymous_api_client.post(
        "/api/mobile/auth/admin-elevation",
        headers=_bearer(token),
        json={"password": "pw-12345"},
    )
    assert elevation.status_code == 200
    assert elevation.json()["elevated"] is True
    assert elevation.json()["elevated_until"]

    unlocked = anonymous_api_client.get("/api/admin/info", headers=_bearer(token))
    assert unlocked.status_code == 200
    assert unlocked.json()["app_version"] == "0.1.0"


def test_mobile_sessions_can_be_listed_and_revoked_by_owner(
    anonymous_api_client: TestClient,
) -> None:
    setup = anonymous_api_client.post(
        "/api/mobile/auth/setup",
        json=_mobile_credentials("bootstrap", "pw-12345"),
    )
    token = setup.json()["token"]
    session_id = setup.json()["session"]["id"]

    sessions = anonymous_api_client.get(
        "/api/mobile/auth/sessions", headers=_bearer(token)
    )
    assert sessions.status_code == 200
    assert [session["id"] for session in sessions.json()["sessions"]] == [session_id]

    revoke = anonymous_api_client.delete(
        f"/api/mobile/auth/sessions/{session_id}", headers=_bearer(token)
    )
    assert revoke.status_code == 200
    assert revoke.json() == {"status": "ok"}

    after_revoke = anonymous_api_client.get(
        "/api/mobile/auth/me", headers=_bearer(token)
    )
    assert after_revoke.status_code == 401
