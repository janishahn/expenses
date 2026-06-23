import sqlite3
import time
from datetime import date, datetime
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

import expenses_web.app as app_main
from expenses_web.core.config import get_settings
from expenses_web.db.session import Base


def _credentials(username: str, password: str) -> dict[str, str]:
    return {"username": username, "password": password}


def _session_headers(raw_token: str) -> dict[str, str]:
    cookie_name = get_settings().auth_session_cookie_name
    return {"Cookie": f"{cookie_name}={raw_token}"}


def _csrf_headers(client: TestClient) -> dict[str, str]:
    response = client.get("/api/csrf")
    assert response.status_code == 200
    return {"X-CSRF-Token": response.json()["token"]}


def _csrf_headers_for_token(client: TestClient, raw_token: str) -> dict[str, str]:
    headers = _session_headers(raw_token)
    response = client.get("/api/csrf", headers=headers)
    assert response.status_code == 200
    return {**headers, "X-CSRF-Token": response.json()["token"]}


def _setup_bootstrap(client: TestClient) -> str:
    response = client.post(
        "/api/auth/setup", json=_credentials("bootstrap", "bootstrap-pass")
    )
    assert response.status_code == 200
    cookie_name = get_settings().auth_session_cookie_name
    raw_token = client.cookies.get(cookie_name)
    assert raw_token
    return raw_token


def _signup(client: TestClient, username: str, password: str) -> None:
    response = client.post("/api/auth/signup", json=_credentials(username, password))
    assert response.status_code == 200


def _login(client: TestClient, username: str, password: str) -> str:
    response = client.post("/api/auth/login", json=_credentials(username, password))
    assert response.status_code == 200
    cookie_name = get_settings().auth_session_cookie_name
    raw_token = client.cookies.get(cookie_name)
    assert raw_token
    return raw_token


def _elevate(client: TestClient, raw_token: str, password: str) -> dict[str, object]:
    response = client.post(
        "/api/auth/admin-elevation",
        headers=_csrf_headers_for_token(client, raw_token),
        json={"password": password},
    )
    return {
        "status_code": response.status_code,
        "payload": response.json(),
    }


def _create_category(client: TestClient, headers: dict[str, str], name: str) -> int:
    response = client.post(
        "/api/categories",
        headers=headers,
        json={"name": name, "type": "expense", "order": 0},
    )
    assert response.status_code == 200
    return int(response.json()["id"])


def _create_transaction(
    client: TestClient,
    headers: dict[str, str],
    *,
    category_id: int,
    title: str,
    amount_cents: int,
) -> int:
    occurred_at = datetime.combine(date.today(), datetime.min.time()).replace(hour=12)
    response = client.post(
        "/api/transactions",
        headers=headers,
        json={
            "date": date.today().isoformat(),
            "occurred_at": occurred_at.isoformat(),
            "type": "expense",
            "amount_cents": amount_cents,
            "category_id": category_id,
            "title": title,
            "description": "",
            "tags": [],
            "is_reimbursement": False,
        },
    )
    assert response.status_code == 200
    return int(response.json()["id"])


def _create_recurring_rule(
    client: TestClient,
    headers: dict[str, str],
    *,
    category_id: int,
    name: str,
    next_occurrence: date,
) -> None:
    response = client.post(
        "/api/recurring",
        headers=headers,
        json={
            "name": name,
            "type": "expense",
            "currency_code": "EUR",
            "amount_cents": 1234,
            "category_id": category_id,
            "anchor_date": next_occurrence.isoformat(),
            "interval_unit": "month",
            "interval_count": 1,
            "next_occurrence": next_occurrence.isoformat(),
            "end_date": None,
            "auto_post": True,
            "skip_weekends": False,
            "month_day_policy": "snap_to_end",
        },
    )
    assert response.status_code == 200


def _create_legacy_sqlite(path: Path) -> Path:
    con = sqlite3.connect(path)
    try:
        con.execute(
            "create table categories (id integer primary key, name text not null, type text not null)"
        )
        con.execute(
            "create table transactions (id integer primary key, amount text not null, category text not null, description text not null, transaction_date text not null, transaction_type text not null)"
        )
        con.execute(
            "create table recurring_transactions (id integer primary key, amount text not null, category text not null, description text not null, start_date text not null, recurrence_type text not null, interval integer not null, transaction_type text not null, last_processed_date text)"
        )
        con.execute(
            "insert into transactions (amount, category, description, transaction_date, transaction_type) values (?, ?, ?, ?, ?)",
            (
                "42.50",
                "Legacy Food",
                "legacy imported txn",
                "2025-01-03 08:15:00",
                "expense",
            ),
        )
        con.commit()
    finally:
        con.close()
    return path


def _wait_for_admin_log_entries(
    client: TestClient, raw_token: str, *, event: str
) -> list[dict[str, object]]:
    deadline = time.monotonic() + 2.0
    while time.monotonic() < deadline:
        response = client.get(
            "/api/admin/logs",
            headers=_session_headers(raw_token),
            params={"event": event},
        )
        assert response.status_code == 200
        entries = response.json()["entries"]
        if entries:
            return entries
        time.sleep(0.05)
    return []


def test_true_admin_routes_require_auth_admin_and_elevation(
    anonymous_api_client: TestClient,
) -> None:
    bootstrap_token = _setup_bootstrap(anonymous_api_client)

    anonymous_api_client.cookies.clear()
    unauthenticated_admin = anonymous_api_client.get("/api/admin/info")
    assert unauthenticated_admin.status_code == 401

    unauthenticated_elevation = anonymous_api_client.post(
        "/api/auth/admin-elevation",
        headers=_csrf_headers(anonymous_api_client),
        json={"password": "bootstrap-pass"},
    )
    assert unauthenticated_elevation.status_code == 401

    _signup(anonymous_api_client, "member", "member-pass")
    member_token = _login(anonymous_api_client, "member", "member-pass")

    member_admin_info = anonymous_api_client.get(
        "/api/admin/info", headers=_session_headers(member_token)
    )
    assert member_admin_info.status_code == 403

    member_elevation = _elevate(anonymous_api_client, member_token, "member-pass")
    assert member_elevation["status_code"] == 403

    admin_info_before_elevation = anonymous_api_client.get(
        "/api/admin/info", headers=_session_headers(bootstrap_token)
    )
    assert admin_info_before_elevation.status_code == 403

    wrong_password = _elevate(anonymous_api_client, bootstrap_token, "wrong-pass")
    assert wrong_password["status_code"] == 401

    elevated = _elevate(anonymous_api_client, bootstrap_token, "bootstrap-pass")
    assert elevated["status_code"] == 200
    assert elevated["payload"]["elevated"] is True

    admin_info_after_elevation = anonymous_api_client.get(
        "/api/admin/info", headers=_session_headers(bootstrap_token)
    )
    assert admin_info_after_elevation.status_code == 200
    payload = admin_info_after_elevation.json()
    assert "current_balance" not in payload
    assert "balance_anchors" not in payload

    for path in (
        "/api/admin/logs",
        "/api/admin/system-health",
        "/api/admin/system-health/validation-override",
        "/api/admin/download-db",
        "/api/admin/export-csv",
    ):
        response = anonymous_api_client.get(
            path, headers=_session_headers(bootstrap_token)
        )
        if path == "/api/admin/download-db":
            assert response.status_code in {200, 404}
        else:
            assert response.status_code == 200


def test_admin_export_csv_is_instance_level_for_elevated_admin(
    anonymous_api_client: TestClient,
) -> None:
    bootstrap_token = _setup_bootstrap(anonymous_api_client)
    bootstrap_headers = _csrf_headers_for_token(anonymous_api_client, bootstrap_token)

    bootstrap_category_id = _create_category(
        anonymous_api_client, bootstrap_headers, "Bootstrap export"
    )
    _create_transaction(
        anonymous_api_client,
        bootstrap_headers,
        category_id=bootstrap_category_id,
        title="bootstrap-admin-export-only",
        amount_cents=100,
    )

    anonymous_api_client.cookies.clear()
    _signup(anonymous_api_client, "member", "member-pass")
    _login(anonymous_api_client, "member", "member-pass")
    member_headers = _csrf_headers(anonymous_api_client)
    member_category_id = _create_category(
        anonymous_api_client, member_headers, "Member export"
    )
    _create_transaction(
        anonymous_api_client,
        member_headers,
        category_id=member_category_id,
        title="member-admin-export-only",
        amount_cents=200,
    )

    member_export = anonymous_api_client.get("/api/export/csv")
    assert member_export.status_code == 200
    assert "member-admin-export-only" in member_export.text
    assert "bootstrap-admin-export-only" not in member_export.text

    anonymous_api_client.cookies.clear()
    before_elevation = anonymous_api_client.get(
        "/api/admin/export-csv",
        headers=_session_headers(bootstrap_token),
    )
    assert before_elevation.status_code == 403

    elevated = _elevate(anonymous_api_client, bootstrap_token, "bootstrap-pass")
    assert elevated["status_code"] == 200

    admin_export = anonymous_api_client.get(
        "/api/admin/export-csv",
        headers=_session_headers(bootstrap_token),
    )
    assert admin_export.status_code == 200
    assert "bootstrap-admin-export-only" in admin_export.text
    assert "member-admin-export-only" in admin_export.text


def test_admin_purge_deleted_is_instance_level_for_elevated_admin(
    anonymous_api_client: TestClient,
) -> None:
    bootstrap_token = _setup_bootstrap(anonymous_api_client)
    bootstrap_headers = _csrf_headers_for_token(anonymous_api_client, bootstrap_token)

    bootstrap_category_id = _create_category(
        anonymous_api_client, bootstrap_headers, "Bootstrap deleted"
    )
    bootstrap_txn_id = _create_transaction(
        anonymous_api_client,
        bootstrap_headers,
        category_id=bootstrap_category_id,
        title="bootstrap-deleted-only",
        amount_cents=100,
    )
    bootstrap_delete = anonymous_api_client.delete(
        f"/api/transactions/{bootstrap_txn_id}",
        headers=bootstrap_headers,
    )
    assert bootstrap_delete.status_code == 200

    anonymous_api_client.cookies.clear()
    _signup(anonymous_api_client, "member", "member-pass")
    _login(anonymous_api_client, "member", "member-pass")
    member_headers = _csrf_headers(anonymous_api_client)
    member_category_id = _create_category(
        anonymous_api_client, member_headers, "Member deleted"
    )
    member_txn_id = _create_transaction(
        anonymous_api_client,
        member_headers,
        category_id=member_category_id,
        title="member-deleted-only",
        amount_cents=200,
    )
    member_delete = anonymous_api_client.delete(
        f"/api/transactions/{member_txn_id}",
        headers=member_headers,
    )
    assert member_delete.status_code == 200

    anonymous_api_client.cookies.clear()
    elevated = _elevate(anonymous_api_client, bootstrap_token, "bootstrap-pass")
    assert elevated["status_code"] == 200

    invalid_purge = anonymous_api_client.post(
        "/api/admin/purge-deleted",
        headers=_csrf_headers_for_token(anonymous_api_client, bootstrap_token),
        json={"days": -1},
    )
    assert invalid_purge.status_code == 422

    override = app_main.app.dependency_overrides[app_main.get_db]
    db_iterator = override()
    db = next(db_iterator)
    try:
        db.execute(
            text(
                "UPDATE transactions "
                "SET deleted_at = :deleted_at "
                "WHERE id IN (:bootstrap_txn_id, :member_txn_id)"
            ),
            {
                "deleted_at": datetime(2000, 1, 1),
                "bootstrap_txn_id": bootstrap_txn_id,
                "member_txn_id": member_txn_id,
            },
        )
        db.commit()
    finally:
        db_iterator.close()

    purge = anonymous_api_client.post(
        "/api/admin/purge-deleted",
        headers=_csrf_headers_for_token(anonymous_api_client, bootstrap_token),
        json={"days": 1},
    )
    assert purge.status_code == 200
    assert purge.json()["count"] == 2

    bootstrap_deleted = anonymous_api_client.get(
        "/api/transactions/deleted",
        headers=_session_headers(bootstrap_token),
    )
    assert bootstrap_deleted.status_code == 200
    assert bootstrap_deleted.json()["transactions"] == []

    anonymous_api_client.cookies.clear()
    _login(anonymous_api_client, "member", "member-pass")
    member_deleted = anonymous_api_client.get("/api/transactions/deleted")
    assert member_deleted.status_code == 200
    assert member_deleted.json()["transactions"] == []


def test_admin_download_db_returns_sqlite_snapshot_with_wal_content(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    data_dir = tmp_path / "expenses_data"
    receipts_dir = data_dir / "receipts"
    db_path = data_dir / "expenses.db"
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(data_dir))
    monkeypatch.setenv("EXPENSES_RECEIPTS_DIR", str(receipts_dir))
    monkeypatch.setenv("EXPENSES_DATABASE_URL", f"sqlite:///{db_path}")
    get_settings.cache_clear()

    data_dir.mkdir(parents=True, exist_ok=True)
    receipts_dir.mkdir(parents=True, exist_ok=True)

    engine = create_engine(
        f"sqlite+pysqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    session_local = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    with sqlite3.connect(db_path) as conn:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.commit()

    def override_get_db():
        session = session_local()
        try:
            session.execute(text("PRAGMA foreign_keys=ON"))
            yield session
        finally:
            session.close()

    monkeypatch.setattr(app_main.scheduler_manager, "start", lambda: None)
    monkeypatch.setattr(app_main.scheduler_manager, "stop", lambda: None)
    app_main.app.dependency_overrides[app_main.get_db] = override_get_db

    try:
        with TestClient(app_main.app) as client:
            bootstrap_token = _setup_bootstrap(client)
            elevated = _elevate(client, bootstrap_token, "bootstrap-pass")
            assert elevated["status_code"] == 200

            probe_conn = sqlite3.connect(db_path)
            try:
                probe_conn.execute("PRAGMA journal_mode=WAL;")
                probe_conn.execute(
                    "create table backup_probe (id integer primary key, value text not null)"
                )
                probe_conn.execute(
                    "insert into backup_probe (value) values (?)",
                    ("still-in-wal",),
                )
                probe_conn.commit()

                download = client.get(
                    "/api/admin/download-db",
                    headers=_session_headers(bootstrap_token),
                )
                assert download.status_code == 200

                snapshot_path = tmp_path / "downloaded-backup.db"
                snapshot_path.write_bytes(download.content)

                with sqlite3.connect(snapshot_path) as snapshot:
                    rows = snapshot.execute(
                        "select value from backup_probe order by id"
                    ).fetchall()
                assert rows == [("still-in-wal",)]
            finally:
                probe_conn.close()
    finally:
        app_main.app.dependency_overrides.clear()
        engine.dispose()
        get_settings.cache_clear()


def test_admin_prefixed_balance_anchor_routes_are_hard_blocked(
    anonymous_api_client: TestClient,
) -> None:
    bootstrap_token = _setup_bootstrap(anonymous_api_client)
    bootstrap_headers = _csrf_headers_for_token(anonymous_api_client, bootstrap_token)

    created = anonymous_api_client.post(
        "/api/settings/balance-anchors",
        headers=bootstrap_headers,
        json={
            "as_of_at": "2026-01-01T10:00:00",
            "balance_cents": 12345,
            "note": "bootstrap",
        },
    )
    assert created.status_code == 200
    anchor_id = int(created.json()["id"])

    anonymous_api_client.cookies.clear()
    _signup(anonymous_api_client, "member", "member-pass")
    _login(anonymous_api_client, "member", "member-pass")
    member_headers = _csrf_headers(anonymous_api_client)

    member_create = anonymous_api_client.post(
        "/api/admin/balance-anchors",
        headers=member_headers,
        json={
            "as_of_at": "2026-01-02T11:00:00",
            "balance_cents": 54321,
            "note": "member",
        },
    )
    assert member_create.status_code == 404

    member_update = anonymous_api_client.put(
        f"/api/admin/balance-anchors/{anchor_id}",
        headers=member_headers,
        json={
            "as_of_at": "2026-01-01T10:00:00",
            "balance_cents": 999,
            "note": "member-update",
        },
    )
    assert member_update.status_code == 404

    member_delete = anonymous_api_client.delete(
        f"/api/admin/balance-anchors/{anchor_id}",
        headers=member_headers,
    )
    assert member_delete.status_code == 404

    anonymous_api_client.cookies.clear()
    elevated = _elevate(anonymous_api_client, bootstrap_token, "bootstrap-pass")
    assert elevated["status_code"] == 200
    elevated_bootstrap_headers = _csrf_headers_for_token(
        anonymous_api_client, bootstrap_token
    )

    admin_create = anonymous_api_client.post(
        "/api/admin/balance-anchors",
        headers=elevated_bootstrap_headers,
        json={
            "as_of_at": "2026-01-03T12:00:00",
            "balance_cents": 100,
            "note": "admin",
        },
    )
    assert admin_create.status_code == 404

    admin_update = anonymous_api_client.put(
        f"/api/admin/balance-anchors/{anchor_id}",
        headers=elevated_bootstrap_headers,
        json={
            "as_of_at": "2026-01-01T10:00:00",
            "balance_cents": 100,
            "note": "admin-update",
        },
    )
    assert admin_update.status_code == 404

    admin_delete = anonymous_api_client.delete(
        f"/api/admin/balance-anchors/{anchor_id}",
        headers=elevated_bootstrap_headers,
    )
    assert admin_delete.status_code == 404


def test_admin_elevation_is_session_local_expires_and_is_cleared_by_logout(
    anonymous_api_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EXPENSES_AUTH_ADMIN_ELEVATION_TTL_SECONDS", "1")
    get_settings.cache_clear()

    token_a = _setup_bootstrap(anonymous_api_client)

    anonymous_api_client.cookies.clear()
    token_b = _login(anonymous_api_client, "bootstrap", "bootstrap-pass")
    anonymous_api_client.cookies.clear()

    elevated = _elevate(anonymous_api_client, token_a, "bootstrap-pass")
    assert elevated["status_code"] == 200

    elevated_session_ok = anonymous_api_client.get(
        "/api/admin/info", headers=_session_headers(token_a)
    )
    assert elevated_session_ok.status_code == 200

    separate_session_denied = anonymous_api_client.get(
        "/api/admin/info", headers=_session_headers(token_b)
    )
    assert separate_session_denied.status_code == 403

    time.sleep(1.2)
    expired = anonymous_api_client.get(
        "/api/admin/info", headers=_session_headers(token_a)
    )
    assert expired.status_code == 403

    ordinary_route_after_expiry = anonymous_api_client.get(
        "/api/transactions?period=all",
        headers=_session_headers(token_a),
    )
    assert ordinary_route_after_expiry.status_code == 200

    re_elevated = _elevate(anonymous_api_client, token_a, "bootstrap-pass")
    assert re_elevated["status_code"] == 200

    logout = anonymous_api_client.post(
        "/api/auth/logout",
        headers=_csrf_headers_for_token(anonymous_api_client, token_a),
    )
    assert logout.status_code == 200

    replay_denied = anonymous_api_client.get(
        "/api/admin/info", headers=_session_headers(token_a)
    )
    assert replay_denied.status_code == 401

    get_settings.cache_clear()


def test_denied_admin_operations_have_no_side_effects(
    anonymous_api_client: TestClient,
) -> None:
    _setup_bootstrap(anonymous_api_client)
    csrf_headers = _csrf_headers(anonymous_api_client)

    category_id = _create_category(
        anonymous_api_client, csrf_headers, "Catch-up category"
    )
    _create_recurring_rule(
        anonymous_api_client,
        csrf_headers,
        category_id=category_id,
        name="Denied catch-up rule",
        next_occurrence=date.today(),
    )

    before = anonymous_api_client.get("/api/transactions?period=all")
    assert before.status_code == 200
    before_titles = {item["title"] for item in before.json()["items"]}

    denied_catch_up = anonymous_api_client.post(
        "/api/admin/recurring-catch-up",
        headers=csrf_headers,
    )
    assert denied_catch_up.status_code == 403

    denied_purge = anonymous_api_client.post(
        "/api/admin/purge-deleted",
        headers=csrf_headers,
        json={"days": 30},
    )
    assert denied_purge.status_code == 403

    denied_rebuild = anonymous_api_client.post(
        "/api/admin/rebuild-rollups",
        headers=csrf_headers,
    )
    assert denied_rebuild.status_code == 403

    denied_sqlite_preview = anonymous_api_client.post(
        "/api/import/sqlite/preview",
        headers=csrf_headers,
        files={"file": ("legacy.db", b"sqlite-data", "application/octet-stream")},
    )
    assert denied_sqlite_preview.status_code == 403

    denied_sqlite_commit = anonymous_api_client.post(
        "/api/import/sqlite/commit",
        headers=csrf_headers,
        json={
            "token": "missing",
            "mapping_targets": [],
            "options": {
                "import_recurring_rules": False,
                "recurring_auto_post": False,
                "link_recurring_transactions": False,
                "preserve_time_in_title": False,
            },
        },
    )
    assert denied_sqlite_commit.status_code == 403

    after = anonymous_api_client.get("/api/transactions?period=all")
    assert after.status_code == 200
    after_titles = {item["title"] for item in after.json()["items"]}
    assert "Denied catch-up rule" not in after_titles
    assert before_titles == after_titles


def test_sqlite_import_commits_to_elevated_callers_account_only(
    anonymous_api_client: TestClient,
    tmp_path: Path,
) -> None:
    _setup_bootstrap(anonymous_api_client)

    anonymous_api_client.cookies.clear()
    _signup(anonymous_api_client, "member", "member-pass")
    member_token = _login(anonymous_api_client, "member", "member-pass")

    anonymous_api_client.cookies.clear()
    bootstrap_token = _login(anonymous_api_client, "bootstrap", "bootstrap-pass")

    elevated = _elevate(anonymous_api_client, bootstrap_token, "bootstrap-pass")
    assert elevated["status_code"] == 200

    legacy_db = _create_legacy_sqlite(tmp_path / "legacy.db")
    preview = anonymous_api_client.post(
        "/api/import/sqlite/preview",
        headers=_csrf_headers_for_token(anonymous_api_client, bootstrap_token),
        files={
            "file": ("legacy.db", legacy_db.read_bytes(), "application/octet-stream")
        },
    )
    assert preview.status_code == 200

    mapping_targets = [
        {
            "legacy_type": row["legacy_type"],
            "legacy_category": row["legacy_category"],
            "target": "create",
            "existing_category_id": None,
        }
        for row in preview.json()["preview"]["mapping_rows"]
    ]

    commit = anonymous_api_client.post(
        "/api/import/sqlite/commit",
        headers=_csrf_headers_for_token(anonymous_api_client, bootstrap_token),
        json={
            "token": preview.json()["token"],
            "mapping_targets": mapping_targets,
            "options": {
                "import_recurring_rules": True,
                "recurring_auto_post": False,
                "link_recurring_transactions": True,
                "preserve_time_in_title": False,
            },
        },
    )
    assert commit.status_code == 200
    assert commit.json()["result"]["inserted_transactions"] == 1

    bootstrap_transactions = anonymous_api_client.get(
        "/api/transactions?period=all",
        headers=_session_headers(bootstrap_token),
    )
    assert bootstrap_transactions.status_code == 200
    bootstrap_titles = {
        item["title"] for item in bootstrap_transactions.json()["items"]
    }
    assert "legacy imported txn" in bootstrap_titles

    member_transactions = anonymous_api_client.get(
        "/api/transactions?period=all",
        headers=_session_headers(member_token),
    )
    assert member_transactions.status_code == 200
    member_titles = {item["title"] for item in member_transactions.json()["items"]}
    assert "legacy imported txn" not in member_titles


def test_sqlite_preview_token_is_not_exposed_through_admin_logs(
    anonymous_api_client: TestClient,
    tmp_path: Path,
) -> None:
    bootstrap_token = _setup_bootstrap(anonymous_api_client)

    elevated = _elevate(anonymous_api_client, bootstrap_token, "bootstrap-pass")
    assert elevated["status_code"] == 200

    legacy_db = _create_legacy_sqlite(tmp_path / "legacy.db")
    preview = anonymous_api_client.post(
        "/api/import/sqlite/preview",
        headers=_csrf_headers_for_token(anonymous_api_client, bootstrap_token),
        files={
            "file": ("legacy.db", legacy_db.read_bytes(), "application/octet-stream")
        },
    )
    assert preview.status_code == 200
    import_token = preview.json()["token"]

    entries = _wait_for_admin_log_entries(
        anonymous_api_client,
        bootstrap_token,
        event="legacy_sqlite_preview_completed",
    )
    assert entries
    assert all("token" not in entry for entry in entries)
    assert all(import_token not in str(entry) for entry in entries)


def test_sqlite_import_commit_rejects_cross_session_preview_token_replay(
    anonymous_api_client: TestClient,
    tmp_path: Path,
) -> None:
    token_a = _setup_bootstrap(anonymous_api_client)

    anonymous_api_client.cookies.clear()
    token_b = _login(anonymous_api_client, "bootstrap", "bootstrap-pass")
    anonymous_api_client.cookies.clear()

    elevated_a = _elevate(anonymous_api_client, token_a, "bootstrap-pass")
    assert elevated_a["status_code"] == 200
    elevated_b = _elevate(anonymous_api_client, token_b, "bootstrap-pass")
    assert elevated_b["status_code"] == 200

    legacy_db = _create_legacy_sqlite(tmp_path / "legacy-cross-session.db")
    preview = anonymous_api_client.post(
        "/api/import/sqlite/preview",
        headers=_csrf_headers_for_token(anonymous_api_client, token_a),
        files={
            "file": (
                "legacy-cross-session.db",
                legacy_db.read_bytes(),
                "application/octet-stream",
            )
        },
    )
    assert preview.status_code == 200

    preview_payload = preview.json()
    mapping_targets = [
        {
            "legacy_type": row["legacy_type"],
            "legacy_category": row["legacy_category"],
            "target": "create",
            "existing_category_id": None,
        }
        for row in preview_payload["preview"]["mapping_rows"]
    ]

    cross_session_commit = anonymous_api_client.post(
        "/api/import/sqlite/commit",
        headers=_csrf_headers_for_token(anonymous_api_client, token_b),
        json={
            "token": preview_payload["token"],
            "mapping_targets": mapping_targets,
            "options": {
                "import_recurring_rules": True,
                "recurring_auto_post": False,
                "link_recurring_transactions": True,
                "preserve_time_in_title": False,
            },
        },
    )
    assert cross_session_commit.status_code == 403

    owner_commit = anonymous_api_client.post(
        "/api/import/sqlite/commit",
        headers=_csrf_headers_for_token(anonymous_api_client, token_a),
        json={
            "token": preview_payload["token"],
            "mapping_targets": mapping_targets,
            "options": {
                "import_recurring_rules": True,
                "recurring_auto_post": False,
                "link_recurring_transactions": True,
                "preserve_time_in_title": False,
            },
        },
    )
    assert owner_commit.status_code == 200
    assert owner_commit.json()["result"]["inserted_transactions"] == 1


def test_elevated_rebuild_rollups_runs_for_multiple_users(
    anonymous_api_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _setup_bootstrap(anonymous_api_client)

    anonymous_api_client.cookies.clear()
    _signup(anonymous_api_client, "member", "member-pass")
    anonymous_api_client.cookies.clear()
    bootstrap_token = _login(anonymous_api_client, "bootstrap", "bootstrap-pass")

    elevated = _elevate(anonymous_api_client, bootstrap_token, "bootstrap-pass")
    assert elevated["status_code"] == 200

    rebuilt_user_ids: list[int] = []

    def _record_rebuild(session, user_id):
        rebuilt_user_ids.append(user_id)

    monkeypatch.setattr(
        "expenses_web.api.routes.rebuild_monthly_rollups", _record_rebuild
    )

    rebuild = anonymous_api_client.post(
        "/api/admin/rebuild-rollups",
        headers=_csrf_headers_for_token(anonymous_api_client, bootstrap_token),
    )
    assert rebuild.status_code == 200
    assert set(rebuilt_user_ids) == {1, 2}
