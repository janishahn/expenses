from datetime import date, datetime

from fastapi.testclient import TestClient

import expenses.app as app_main
from expenses.db.models import BalanceAnchor, Category, Transaction, TransactionType


def _credentials(username: str, password: str) -> dict[str, str]:
    return {"username": username, "password": password}


def _csrf_headers(client: TestClient) -> dict[str, str]:
    response = client.get("/api/csrf")
    assert response.status_code == 200
    return {"X-CSRF-Token": response.json()["token"]}


def _create_ingest_token(client: TestClient) -> str:
    response = client.post(
        "/api/settings/ingest-token",
        headers=_csrf_headers(client),
    )
    assert response.status_code == 200
    return str(response.json()["token"])


def _setup_bootstrap(client: TestClient) -> None:
    response = client.post(
        "/api/auth/setup",
        json=_credentials("bootstrap", "bootstrap-pass"),
    )
    assert response.status_code == 200


def _login(client: TestClient, username: str, password: str) -> None:
    response = client.post("/api/auth/login", json=_credentials(username, password))
    assert response.status_code == 200


def _signup(client: TestClient, username: str, password: str) -> None:
    response = client.post("/api/auth/signup", json=_credentials(username, password))
    assert response.status_code == 200


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


def _seed_legacy_user_one_data(client: TestClient) -> tuple[int, int, int]:
    override_get_db = app_main.app.dependency_overrides[app_main.get_db]
    db_gen = override_get_db()
    db = next(db_gen)
    try:
        legacy_category = Category(
            user_id=1,
            name="Legacy groceries",
            type=TransactionType.expense,
            order=0,
        )
        db.add(legacy_category)
        db.flush()

        legacy_transaction = Transaction(
            user_id=1,
            date=date(2026, 1, 3),
            occurred_at=datetime(2026, 1, 3, 8, 15),
            type=TransactionType.expense,
            is_reimbursement=False,
            amount_cents=4_250,
            category_id=legacy_category.id,
            title="legacy grocery receipt",
            description="seeded legacy row",
        )
        legacy_anchor = BalanceAnchor(
            user_id=1,
            as_of_at=datetime(2026, 1, 1, 9, 0),
            balance_cents=12_345,
            note="legacy anchor",
        )

        db.add_all([legacy_transaction, legacy_anchor])
        db.commit()
        db.refresh(legacy_category)
        db.refresh(legacy_transaction)
        db.refresh(legacy_anchor)
        return (
            int(legacy_category.id),
            int(legacy_transaction.id),
            int(legacy_anchor.id),
        )
    finally:
        try:
            next(db_gen)
        except StopIteration:
            pass


def test_bootstrap_user_claims_legacy_user_one_data_after_setup(
    anonymous_api_client: TestClient,
) -> None:
    legacy_category_id, legacy_txn_id, legacy_anchor_id = _seed_legacy_user_one_data(
        anonymous_api_client
    )

    status_before = anonymous_api_client.get("/api/auth/bootstrap-status")
    assert status_before.status_code == 200
    assert status_before.json()["setup_required"] is True

    _setup_bootstrap(anonymous_api_client)

    transactions = anonymous_api_client.get("/api/transactions?period=all")
    assert transactions.status_code == 200
    transaction_items = transactions.json()["items"]
    transaction_ids = {item["id"] for item in transaction_items}
    assert legacy_txn_id in transaction_ids
    assert any(item["title"] == "legacy grocery receipt" for item in transaction_items)

    categories = anonymous_api_client.get("/api/categories?period=all")
    assert categories.status_code == 200
    category_items = categories.json()["categories"]
    assert any(item["id"] == legacy_category_id for item in category_items)
    assert any(item["name"] == "Legacy groceries" for item in category_items)

    settings = anonymous_api_client.get("/api/settings")
    assert settings.status_code == 200
    settings_payload = settings.json()
    assert settings_payload["current_balance"] == 8_095
    anchor_ids = {anchor["id"] for anchor in settings_payload["balance_anchors"]}
    assert legacy_anchor_id in anchor_ids


def test_user_owned_routes_require_authentication_without_fallback(
    anonymous_api_client: TestClient,
) -> None:
    transactions_before_setup = anonymous_api_client.get("/api/transactions?period=all")
    assert transactions_before_setup.status_code == 401

    _setup_bootstrap(anonymous_api_client)
    anonymous_api_client.cookies.clear()

    categories_without_session = anonymous_api_client.get("/api/categories?period=all")
    assert categories_without_session.status_code == 401

    create_without_session = anonymous_api_client.post(
        "/api/categories",
        headers=_csrf_headers(anonymous_api_client),
        json={"name": "Should fail", "type": "expense", "order": 0},
    )
    assert create_without_session.status_code == 401


def test_second_user_writes_are_isolated_and_foreign_lookups_fail(
    anonymous_api_client: TestClient,
) -> None:
    _setup_bootstrap(anonymous_api_client)

    bootstrap_headers = _csrf_headers(anonymous_api_client)
    bootstrap_category_id = _create_category(
        anonymous_api_client, bootstrap_headers, "Bootstrap category"
    )
    bootstrap_txn_id = _create_transaction(
        anonymous_api_client,
        bootstrap_headers,
        category_id=bootstrap_category_id,
        title="Bootstrap txn",
        amount_cents=101,
    )

    anonymous_api_client.cookies.clear()
    _signup(anonymous_api_client, "member", "member-pass")
    _login(anonymous_api_client, "member", "member-pass")

    member_headers = _csrf_headers(anonymous_api_client)
    member_category_id = _create_category(
        anonymous_api_client, member_headers, "Member category"
    )
    member_txn_id = _create_transaction(
        anonymous_api_client,
        member_headers,
        category_id=member_category_id,
        title="Member txn",
        amount_cents=202,
    )

    member_transactions = anonymous_api_client.get("/api/transactions?period=all")
    assert member_transactions.status_code == 200
    member_ids = {item["id"] for item in member_transactions.json()["items"]}
    assert member_txn_id in member_ids
    assert bootstrap_txn_id not in member_ids

    foreign_lookup = anonymous_api_client.get(f"/api/transactions/{bootstrap_txn_id}")
    assert foreign_lookup.status_code == 404

    foreign_mutation = anonymous_api_client.put(
        f"/api/transactions/{bootstrap_txn_id}",
        headers=member_headers,
        json={
            "date": date.today().isoformat(),
            "occurred_at": datetime.combine(date.today(), datetime.min.time())
            .replace(hour=13)
            .isoformat(),
            "type": "expense",
            "amount_cents": 999,
            "category_id": member_category_id,
            "title": "cross-user attempt",
            "description": "",
            "tags": [],
            "is_reimbursement": False,
        },
    )
    assert foreign_mutation.status_code in {400, 404}

    foreign_category_write = anonymous_api_client.post(
        "/api/transactions",
        headers=member_headers,
        json={
            "date": date.today().isoformat(),
            "occurred_at": datetime.combine(date.today(), datetime.min.time())
            .replace(hour=14)
            .isoformat(),
            "type": "expense",
            "amount_cents": 303,
            "category_id": bootstrap_category_id,
            "title": "foreign category write",
            "description": "",
            "tags": [],
            "is_reimbursement": False,
        },
    )
    assert foreign_category_write.status_code == 400

    anonymous_api_client.cookies.clear()
    _login(anonymous_api_client, "bootstrap", "bootstrap-pass")
    bootstrap_transactions = anonymous_api_client.get("/api/transactions?period=all")
    assert bootstrap_transactions.status_code == 200
    bootstrap_ids = {item["id"] for item in bootstrap_transactions.json()["items"]}
    assert bootstrap_txn_id in bootstrap_ids
    assert member_txn_id not in bootstrap_ids


def test_bulk_preview_and_apply_are_user_scoped(
    anonymous_api_client: TestClient,
) -> None:
    _setup_bootstrap(anonymous_api_client)

    bootstrap_headers = _csrf_headers(anonymous_api_client)
    bootstrap_category_id = _create_category(
        anonymous_api_client, bootstrap_headers, "Bootstrap bulk category"
    )
    bootstrap_txn_id = _create_transaction(
        anonymous_api_client,
        bootstrap_headers,
        category_id=bootstrap_category_id,
        title="Bootstrap bulk txn",
        amount_cents=111,
    )

    anonymous_api_client.cookies.clear()
    _signup(anonymous_api_client, "member", "member-pass")
    _login(anonymous_api_client, "member", "member-pass")

    member_headers = _csrf_headers(anonymous_api_client)
    member_from_category_id = _create_category(
        anonymous_api_client, member_headers, "Member from"
    )
    member_to_category_id = _create_category(
        anonymous_api_client, member_headers, "Member to"
    )
    member_txn_id = _create_transaction(
        anonymous_api_client,
        member_headers,
        category_id=member_from_category_id,
        title="Member bulk txn",
        amount_cents=222,
    )

    preview_response = anonymous_api_client.post(
        "/api/transactions/bulk/preview",
        headers=member_headers,
        json={
            "selection": {
                "mode": "query",
                "query": {"period": "all", "q": ""},
                "transaction_ids": [],
            },
            "operation": {"set_category_id": member_to_category_id},
        },
    )
    assert preview_response.status_code == 200
    preview_payload = preview_response.json()
    assert preview_payload["resolved_count"] == 1
    assert preview_payload["sample_ids"] == [member_txn_id]

    foreign_category_apply = anonymous_api_client.post(
        "/api/transactions/bulk/apply",
        headers=member_headers,
        json={
            "selection": {
                "mode": "query",
                "query": {"period": "all", "q": ""},
                "transaction_ids": [],
            },
            "operation": {"set_category_id": bootstrap_category_id},
        },
    )
    assert foreign_category_apply.status_code == 400

    valid_apply = anonymous_api_client.post(
        "/api/transactions/bulk/apply",
        headers=member_headers,
        json={
            "selection": {
                "mode": "query",
                "query": {"period": "all", "q": ""},
                "transaction_ids": [],
            },
            "operation": {"set_category_id": member_to_category_id},
        },
    )
    assert valid_apply.status_code == 200
    assert valid_apply.json()["sample_ids"] == [member_txn_id]
    assert valid_apply.json()["changes"]["category_changed"] == 1

    member_txn = anonymous_api_client.get(f"/api/transactions/{member_txn_id}")
    assert member_txn.status_code == 200
    assert member_txn.json()["category_id"] == member_to_category_id

    anonymous_api_client.cookies.clear()
    _login(anonymous_api_client, "bootstrap", "bootstrap-pass")
    bootstrap_txn = anonymous_api_client.get(f"/api/transactions/{bootstrap_txn_id}")
    assert bootstrap_txn.status_code == 200
    assert bootstrap_txn.json()["category_id"] == bootstrap_category_id


def test_rule_preview_rejects_foreign_category_and_tag_ids(
    anonymous_api_client: TestClient,
) -> None:
    _setup_bootstrap(anonymous_api_client)

    anonymous_api_client.cookies.clear()
    _signup(anonymous_api_client, "member", "member-pass")
    _login(anonymous_api_client, "member", "member-pass")

    member_headers = _csrf_headers(anonymous_api_client)
    member_category_id = _create_category(
        anonymous_api_client, member_headers, "Member private category"
    )
    member_tag_response = anonymous_api_client.post(
        "/api/tags",
        headers=member_headers,
        json={"name": "member-private-tag", "is_hidden_from_budget": False},
    )
    assert member_tag_response.status_code == 200
    member_tag_id = int(member_tag_response.json()["id"])

    anonymous_api_client.cookies.clear()
    _login(anonymous_api_client, "bootstrap", "bootstrap-pass")
    bootstrap_headers = _csrf_headers(anonymous_api_client)

    foreign_category_preview = anonymous_api_client.post(
        "/api/rules/preview",
        headers=bootstrap_headers,
        json={
            "name": "Foreign category preview",
            "enabled": True,
            "priority": 100,
            "match_type": "contains",
            "match_value": "coffee",
            "transaction_type": "expense",
            "min_amount_cents": None,
            "max_amount_cents": None,
            "set_category_id": member_category_id,
            "add_tags": [],
            "budget_exclude_tag_id": None,
        },
    )
    assert foreign_category_preview.status_code == 400
    assert foreign_category_preview.json()["detail"] == "Category not found"

    foreign_tag_preview = anonymous_api_client.post(
        "/api/rules/preview",
        headers=bootstrap_headers,
        json={
            "name": "Foreign tag preview",
            "enabled": True,
            "priority": 100,
            "match_type": "contains",
            "match_value": "coffee",
            "transaction_type": "expense",
            "min_amount_cents": None,
            "max_amount_cents": None,
            "set_category_id": None,
            "add_tags": [],
            "budget_exclude_tag_id": member_tag_id,
        },
    )
    assert foreign_tag_preview.status_code == 400
    assert foreign_tag_preview.json()["detail"] == "Tag not found"


def test_settings_balance_anchors_are_available_to_non_admin_and_user_scoped(
    anonymous_api_client: TestClient,
) -> None:
    _setup_bootstrap(anonymous_api_client)

    bootstrap_headers = _csrf_headers(anonymous_api_client)
    bootstrap_create = anonymous_api_client.post(
        "/api/settings/balance-anchors",
        headers=bootstrap_headers,
        json={
            "as_of_at": "2026-01-01T10:00:00",
            "balance_cents": 120_00,
            "note": "bootstrap",
        },
    )
    assert bootstrap_create.status_code == 200
    bootstrap_anchor_id = int(bootstrap_create.json()["id"])

    bootstrap_settings = anonymous_api_client.get("/api/settings")
    assert bootstrap_settings.status_code == 200
    bootstrap_payload = bootstrap_settings.json()
    assert bootstrap_payload["current_balance"] == 120_00
    assert [anchor["id"] for anchor in bootstrap_payload["balance_anchors"]] == [
        bootstrap_anchor_id
    ]

    anonymous_api_client.cookies.clear()
    _signup(anonymous_api_client, "member", "member-pass")
    _login(anonymous_api_client, "member", "member-pass")

    me_response = anonymous_api_client.get("/api/auth/me")
    assert me_response.status_code == 200
    assert me_response.json()["user"]["is_admin"] is False

    member_headers = _csrf_headers(anonymous_api_client)
    member_settings = anonymous_api_client.get("/api/settings")
    assert member_settings.status_code == 200
    member_payload = member_settings.json()
    assert member_payload["current_balance"] == 0
    assert member_payload["balance_anchors"] == []

    foreign_update = anonymous_api_client.put(
        f"/api/settings/balance-anchors/{bootstrap_anchor_id}",
        headers=member_headers,
        json={
            "as_of_at": "2026-01-01T10:00:00",
            "balance_cents": 9900,
            "note": "cross-user",
        },
    )
    assert foreign_update.status_code == 404

    member_create = anonymous_api_client.post(
        "/api/settings/balance-anchors",
        headers=member_headers,
        json={
            "as_of_at": "2026-01-02T11:00:00",
            "balance_cents": 4500,
            "note": "member",
        },
    )
    assert member_create.status_code == 200
    member_anchor_id = int(member_create.json()["id"])

    member_settings_after = anonymous_api_client.get("/api/settings")
    assert member_settings_after.status_code == 200
    member_anchor_ids = {
        anchor["id"] for anchor in member_settings_after.json()["balance_anchors"]
    }
    assert member_anchor_ids == {member_anchor_id}

    anonymous_api_client.cookies.clear()
    _login(anonymous_api_client, "bootstrap", "bootstrap-pass")
    bootstrap_settings_after = anonymous_api_client.get("/api/settings")
    assert bootstrap_settings_after.status_code == 200
    bootstrap_anchor_ids = {
        anchor["id"] for anchor in bootstrap_settings_after.json()["balance_anchors"]
    }
    assert bootstrap_anchor_ids == {bootstrap_anchor_id}


def test_user_csv_export_and_import_preview_commit_are_user_scoped(
    anonymous_api_client: TestClient,
) -> None:
    _setup_bootstrap(anonymous_api_client)

    bootstrap_headers = _csrf_headers(anonymous_api_client)
    bootstrap_category_id = _create_category(
        anonymous_api_client,
        bootstrap_headers,
        "Bootstrap groceries",
    )
    _create_transaction(
        anonymous_api_client,
        bootstrap_headers,
        category_id=bootstrap_category_id,
        title="bootstrap-only-export",
        amount_cents=111,
    )

    bootstrap_export = anonymous_api_client.get("/api/export/csv")
    assert bootstrap_export.status_code == 200
    assert "bootstrap-only-export" in bootstrap_export.text

    anonymous_api_client.cookies.clear()
    _signup(anonymous_api_client, "member", "member-pass")
    _login(anonymous_api_client, "member", "member-pass")

    member_headers = _csrf_headers(anonymous_api_client)
    member_category_id = _create_category(
        anonymous_api_client,
        member_headers,
        "Member utilities",
    )
    _create_transaction(
        anonymous_api_client,
        member_headers,
        category_id=member_category_id,
        title="member-only-export",
        amount_cents=222,
    )

    member_export = anonymous_api_client.get("/api/export/csv")
    assert member_export.status_code == 200
    assert "member-only-export" in member_export.text
    assert "bootstrap-only-export" not in member_export.text

    csv_content = (
        "Date,Type,IsReimbursement,Amount,Category,Title,Description\n"
        "2026-01-03,expense,0,9.99,Bootstrap groceries,member-imported,desc\n"
    )
    preview_before_category = anonymous_api_client.post(
        "/api/import/csv/preview",
        headers=member_headers,
        files={"file": ("import.csv", csv_content, "text/csv")},
    )
    assert preview_before_category.status_code == 200
    assert any(
        "Missing category 'Bootstrap groceries'" in error
        for error in preview_before_category.json()["errors"]
    )

    _create_category(anonymous_api_client, member_headers, "Bootstrap groceries")

    preview_after_category = anonymous_api_client.post(
        "/api/import/csv/preview",
        headers=member_headers,
        files={"file": ("import.csv", csv_content, "text/csv")},
    )
    assert preview_after_category.status_code == 200
    assert preview_after_category.json()["errors"] == []

    commit_response = anonymous_api_client.post(
        "/api/import/csv/commit",
        headers=member_headers,
        files={"file": ("import.csv", csv_content, "text/csv")},
    )
    assert commit_response.status_code == 200
    assert commit_response.json()["imported_count"] == 1

    member_transactions = anonymous_api_client.get("/api/transactions?period=all")
    assert member_transactions.status_code == 200
    member_titles = {item["title"] for item in member_transactions.json()["items"]}
    assert "member-imported" in member_titles

    anonymous_api_client.cookies.clear()
    _login(anonymous_api_client, "bootstrap", "bootstrap-pass")
    bootstrap_transactions = anonymous_api_client.get("/api/transactions?period=all")
    assert bootstrap_transactions.status_code == 200
    bootstrap_titles = {
        item["title"] for item in bootstrap_transactions.json()["items"]
    }
    assert "member-imported" not in bootstrap_titles


def test_user_ingest_token_create_rotate_revoke_flow(
    anonymous_api_client: TestClient,
) -> None:
    _setup_bootstrap(anonymous_api_client)

    first_token = _create_ingest_token(anonymous_api_client)

    settings_before = anonymous_api_client.get("/api/settings")
    assert settings_before.status_code == 200
    ingest_token_before = settings_before.json()["ingest_token"]
    assert ingest_token_before is not None
    assert ingest_token_before["token_hint"]
    assert ingest_token_before["last_used_at"] is None
    assert "token" not in ingest_token_before

    second_token = _create_ingest_token(anonymous_api_client)
    assert second_token != first_token

    old_token_response = anonymous_api_client.post(
        "/api/ingest",
        headers={"Authorization": f"Bearer {first_token}"},
        json={"amount_cents": 310, "title": "stale-token"},
    )
    assert old_token_response.status_code == 401

    ingest_ok = anonymous_api_client.post(
        "/api/ingest",
        headers={"Authorization": f"Bearer {second_token}"},
        json={"amount_cents": 510, "title": "fresh-token"},
    )
    assert ingest_ok.status_code == 201

    settings_after_ingest = anonymous_api_client.get("/api/settings")
    assert settings_after_ingest.status_code == 200
    assert settings_after_ingest.json()["ingest_token"]["last_used_at"] is not None

    revoke = anonymous_api_client.delete(
        "/api/settings/ingest-token",
        headers=_csrf_headers(anonymous_api_client),
    )
    assert revoke.status_code == 200

    ingest_after_revoke = anonymous_api_client.post(
        "/api/ingest",
        headers={"Authorization": f"Bearer {second_token}"},
        json={"amount_cents": 710, "title": "revoked-token"},
    )
    assert ingest_after_revoke.status_code == 401


def test_ingest_tokens_are_account_scoped(
    anonymous_api_client: TestClient,
) -> None:
    _setup_bootstrap(anonymous_api_client)
    bootstrap_token = _create_ingest_token(anonymous_api_client)

    anonymous_api_client.cookies.clear()
    _signup(anonymous_api_client, "member", "member-pass")
    _login(anonymous_api_client, "member", "member-pass")
    member_token = _create_ingest_token(anonymous_api_client)

    member_ingest = anonymous_api_client.post(
        "/api/ingest",
        headers={"Authorization": f"Bearer {member_token}"},
        json={"amount_cents": 1200, "title": "member-token-entry"},
    )
    assert member_ingest.status_code == 201

    member_transactions = anonymous_api_client.get("/api/transactions?period=all")
    assert member_transactions.status_code == 200
    member_titles = {item["title"] for item in member_transactions.json()["items"]}
    assert "member-token-entry" in member_titles

    anonymous_api_client.cookies.clear()
    _login(anonymous_api_client, "bootstrap", "bootstrap-pass")

    bootstrap_transactions_before = anonymous_api_client.get(
        "/api/transactions?period=all"
    )
    assert bootstrap_transactions_before.status_code == 200
    bootstrap_titles_before = {
        item["title"] for item in bootstrap_transactions_before.json()["items"]
    }
    assert "member-token-entry" not in bootstrap_titles_before

    bootstrap_ingest = anonymous_api_client.post(
        "/api/ingest",
        headers={"Authorization": f"Bearer {bootstrap_token}"},
        json={"amount_cents": 2200, "title": "bootstrap-token-entry"},
    )
    assert bootstrap_ingest.status_code == 201

    bootstrap_transactions_after = anonymous_api_client.get(
        "/api/transactions?period=all"
    )
    assert bootstrap_transactions_after.status_code == 200
    bootstrap_titles_after = {
        item["title"] for item in bootstrap_transactions_after.json()["items"]
    }
    assert "bootstrap-token-entry" in bootstrap_titles_after
    assert "member-token-entry" not in bootstrap_titles_after


def test_report_and_attachment_downloads_are_user_scoped(
    anonymous_api_client: TestClient,
    monkeypatch,
) -> None:
    import expenses.api.routes as routes_module

    _setup_bootstrap(anonymous_api_client)

    bootstrap_headers = _csrf_headers(anonymous_api_client)
    bootstrap_category_id = _create_category(
        anonymous_api_client,
        bootstrap_headers,
        "Bootstrap attachments",
    )
    bootstrap_txn_id = _create_transaction(
        anonymous_api_client,
        bootstrap_headers,
        category_id=bootstrap_category_id,
        title="bootstrap-attachment-txn",
        amount_cents=333,
    )

    upload_response = anonymous_api_client.post(
        f"/api/transactions/{bootstrap_txn_id}/attachments",
        headers=bootstrap_headers,
        files={"file": ("bootstrap.pdf", b"%PDF-bootstrap", "application/pdf")},
    )
    assert upload_response.status_code == 200
    attachment_id = int(upload_response.json()["id"])

    own_download = anonymous_api_client.get(
        f"/api/attachments/{attachment_id}/download"
    )
    assert own_download.status_code == 200
    assert own_download.content == b"%PDF-bootstrap"

    captured_user_ids: list[int] = []

    def fake_generate_report_pdf_bytes(*, base_url, options, db, user_id):
        captured_user_ids.append(user_id)
        return f"pdf-for-{user_id}".encode("utf-8")

    monkeypatch.setattr(
        routes_module,
        "_generate_report_pdf_bytes",
        fake_generate_report_pdf_bytes,
    )

    anonymous_api_client.cookies.clear()
    _signup(anonymous_api_client, "member", "member-pass")
    _login(anonymous_api_client, "member", "member-pass")
    member_headers = _csrf_headers(anonymous_api_client)

    member_report = anonymous_api_client.post(
        "/api/reports/pdf",
        headers=member_headers,
        json={
            "start": date.today().isoformat(),
            "end": date.today().isoformat(),
            "sections": ["summary"],
        },
    )
    assert member_report.status_code == 200
    assert member_report.content == b"pdf-for-2"

    member_download_foreign = anonymous_api_client.get(
        f"/api/attachments/{attachment_id}/download"
    )
    assert member_download_foreign.status_code == 404

    anonymous_api_client.cookies.clear()
    _login(anonymous_api_client, "bootstrap", "bootstrap-pass")
    bootstrap_headers = _csrf_headers(anonymous_api_client)
    bootstrap_report = anonymous_api_client.post(
        "/api/reports/pdf",
        headers=bootstrap_headers,
        json={
            "start": date.today().isoformat(),
            "end": date.today().isoformat(),
            "sections": ["summary"],
        },
    )
    assert bootstrap_report.status_code == 200
    assert bootstrap_report.content == b"pdf-for-1"

    assert captured_user_ids == [2, 1]
