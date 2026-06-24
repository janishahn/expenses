from datetime import date, datetime

from fastapi.testclient import TestClient
from sqlalchemy import text

import expenses.app as app_main
from expenses.core.config import get_settings


def _create_category(
    client: TestClient, headers: dict[str, str], name: str, txn_type: str
) -> int:
    response = client.post(
        "/api/categories",
        headers=headers,
        json={"name": name, "type": txn_type, "order": 0},
    )
    assert response.status_code == 200
    return int(response.json()["id"])


def _create_transaction(
    client: TestClient,
    headers: dict[str, str],
    *,
    txn_date: date,
    txn_type: str,
    amount_cents: int,
    category_id: int | None,
    title: str,
    tags: list[str],
    description: str | None = None,
    is_reimbursement: bool = False,
) -> int:
    occurred_at = datetime.combine(txn_date, datetime.min.time()).replace(hour=12)
    payload: dict[str, object] = {
        "date": txn_date.isoformat(),
        "occurred_at": occurred_at.isoformat(),
        "type": txn_type,
        "amount_cents": amount_cents,
        "category_id": category_id,
        "title": title,
        "description": description,
        "tags": tags,
        "is_reimbursement": is_reimbursement,
    }
    response = client.post("/api/transactions", headers=headers, json=payload)
    assert response.status_code == 200
    return int(response.json()["id"])


def _elevate_admin(client: TestClient, headers: dict[str, str]) -> None:
    response = client.post(
        "/api/auth/admin-elevation",
        headers=headers,
        json={"password": "pw-12345"},
    )
    assert response.status_code == 200


def test_transactions_reimbursements_and_deleted_lifecycle(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    expense_category_id = _create_category(api_client, csrf_headers, "Food", "expense")
    income_category_id = _create_category(api_client, csrf_headers, "Salary", "income")

    expense_txn_id = _create_transaction(
        api_client,
        csrf_headers,
        txn_date=date.today(),
        txn_type="expense",
        amount_cents=2_500,
        category_id=expense_category_id,
        title="Lunch API flow",
        description="**Office** lunch with client",
        tags=["Office", "office"],
    )
    income_txn_id = _create_transaction(
        api_client,
        csrf_headers,
        txn_date=date.today(),
        txn_type="income",
        amount_cents=1_500,
        category_id=income_category_id,
        title="Lunch reimbursement",
        tags=[],
        is_reimbursement=True,
    )

    response = api_client.get(
        f"/api/reimbursements/{income_txn_id}/expense-search?q=Lunch"
    )
    assert response.status_code == 200
    results = response.json()["results"]
    assert any(row["expense"]["id"] == expense_txn_id for row in results)

    response = api_client.post(
        f"/api/reimbursements/{income_txn_id}/allocations",
        headers=csrf_headers,
        json={"expense_transaction_id": expense_txn_id, "amount_cents": 1_000},
    )
    assert response.status_code == 200
    allocation_id = int(response.json()["allocation_id"])

    response = api_client.get(f"/api/transactions/{expense_txn_id}/reimbursements")
    assert response.status_code == 200
    assert response.json()["mode"] == "expense"
    assert response.json()["reimbursed_total_cents"] == 1_000

    response = api_client.put(
        f"/api/transactions/{expense_txn_id}",
        headers=csrf_headers,
        json={
            "date": date.today().isoformat(),
            "occurred_at": datetime.combine(date.today(), datetime.min.time())
            .replace(hour=13)
            .isoformat(),
            "type": "expense",
            "amount_cents": 3_000,
            "category_id": expense_category_id,
            "title": "Lunch API flow updated",
            "description": "- reimbursable\n- receipt uploaded",
            "tags": ["Office"],
        },
    )
    assert response.status_code == 200

    response = api_client.get(f"/api/transactions/{expense_txn_id}")
    assert response.status_code == 200
    txn = response.json()
    assert txn["amount_cents"] == 3_000
    assert txn["title"] == "Lunch API flow updated"
    assert txn["description"] == "- reimbursable\n- receipt uploaded"
    assert txn["tags"] == ["Office"]

    response = api_client.delete(
        f"/api/reimbursements/allocations/{allocation_id}", headers=csrf_headers
    )
    assert response.status_code == 200

    response = api_client.delete(
        f"/api/transactions/{expense_txn_id}", headers=csrf_headers
    )
    assert response.status_code == 200
    response = api_client.get("/api/transactions/deleted")
    assert response.status_code == 200
    assert any(item["id"] == expense_txn_id for item in response.json()["transactions"])

    response = api_client.post(
        f"/api/transactions/{expense_txn_id}/restore", headers=csrf_headers
    )
    assert response.status_code == 200

    response = api_client.delete(
        f"/api/transactions/{expense_txn_id}", headers=csrf_headers
    )
    assert response.status_code == 200
    response = api_client.delete(
        f"/api/transactions/{expense_txn_id}/permanent", headers=csrf_headers
    )
    assert response.status_code == 200

    response = api_client.get("/api/transactions/deleted")
    assert response.status_code == 200
    assert all(item["id"] != expense_txn_id for item in response.json()["transactions"])


def test_tags_rules_and_recurring_api_flows(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    uncategorized_id = _create_category(
        api_client, csrf_headers, "Uncategorized", "expense"
    )
    subscriptions_id = _create_category(
        api_client, csrf_headers, "Subscriptions", "expense"
    )

    response = api_client.post(
        "/api/tags",
        headers=csrf_headers,
        json={"name": "Travel", "is_hidden_from_budget": True},
    )
    assert response.status_code == 200
    tag_id = int(response.json()["id"])

    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=date.today(),
        txn_type="expense",
        amount_cents=500,
        category_id=uncategorized_id,
        title="Trip planning",
        tags=["Travel"],
    )

    response = api_client.get(f"/api/tags/{tag_id}?period=all")
    assert response.status_code == 200
    detail = response.json()
    assert detail["tag"]["name"] == "Travel"
    assert detail["transactions"]

    response = api_client.put(
        f"/api/tags/{tag_id}",
        headers=csrf_headers,
        json={"name": "Work Travel", "is_hidden_from_budget": False},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Work Travel"

    # Create transaction without category - rules should apply
    _create_transaction(
        api_client,
        csrf_headers,
        txn_date=date.today(),
        txn_type="expense",
        amount_cents=1_299,
        category_id=None,
        title="Netflix seed",
        tags=[],
    )
    response = api_client.post(
        "/api/rules/preview",
        headers=csrf_headers,
        json={
            "name": "Netflix -> Subscriptions",
            "enabled": True,
            "priority": 100,
            "match_type": "contains",
            "match_value": "netflix",
            "transaction_type": "expense",
            "min_amount_cents": None,
            "max_amount_cents": None,
            "set_category_id": subscriptions_id,
            "add_tags": ["Streaming"],
            "budget_exclude_tag_id": None,
        },
    )
    assert response.status_code == 200
    assert response.json()["matches_count"] >= 1

    response = api_client.post(
        "/api/rules",
        headers=csrf_headers,
        json={
            "name": "Netflix -> Subscriptions",
            "enabled": True,
            "priority": 100,
            "match_type": "contains",
            "match_value": "netflix",
            "transaction_type": "expense",
            "min_amount_cents": None,
            "max_amount_cents": None,
            "set_category_id": subscriptions_id,
            "add_tags": ["Streaming"],
            "budget_exclude_tag_id": None,
        },
    )
    assert response.status_code == 200
    rule_id = int(response.json()["id"])

    # Create transaction without category - rules should apply
    txn_id = _create_transaction(
        api_client,
        csrf_headers,
        txn_date=date.today(),
        txn_type="expense",
        amount_cents=1_499,
        category_id=None,
        title="Netflix February",
        tags=[],
    )
    response = api_client.get(f"/api/transactions/{txn_id}")
    assert response.status_code == 200
    txn = response.json()
    assert txn["category_id"] == subscriptions_id
    assert "Streaming" in txn["tags"]

    response = api_client.post(
        f"/api/rules/{rule_id}/toggle",
        headers=csrf_headers,
        json={"enabled": False},
    )
    assert response.status_code == 200

    # Create transaction without category - but rule is disabled, so stays uncategorized
    txn_disabled_id = _create_transaction(
        api_client,
        csrf_headers,
        txn_date=date.today(),
        txn_type="expense",
        amount_cents=1_899,
        category_id=None,
        title="Netflix disabled rule",
        tags=[],
    )
    response = api_client.get(f"/api/transactions/{txn_disabled_id}")
    assert response.status_code == 200
    assert response.json()["category_id"] == uncategorized_id

    response = api_client.delete(f"/api/rules/{rule_id}", headers=csrf_headers)
    assert response.status_code == 200

    response = api_client.post(
        "/api/recurring/preview",
        json={
            "start_date": date.today().isoformat(),
            "interval_unit": "month",
            "interval_count": 1,
            "month_day_policy": "snap_to_end",
            "skip_weekends": False,
        },
    )
    assert response.status_code == 200
    assert len(response.json()["occurrences"]) >= 2

    response = api_client.post(
        "/api/recurring",
        headers=csrf_headers,
        json={
            "name": "Rent",
            "type": "expense",
            "currency_code": "EUR",
            "amount_cents": 95_000,
            "category_id": subscriptions_id,
            "anchor_date": date.today().isoformat(),
            "interval_unit": "month",
            "interval_count": 1,
            "next_occurrence": date.today().isoformat(),
            "end_date": None,
            "auto_post": True,
            "skip_weekends": False,
            "month_day_policy": "snap_to_end",
        },
    )
    assert response.status_code == 200
    recurring_id = int(response.json()["id"])

    response = api_client.get(f"/api/recurring/{recurring_id}/occurrences")
    assert response.status_code == 200
    assert response.json()["rule"]["id"] == recurring_id

    response = api_client.post(
        f"/api/recurring/{recurring_id}/toggle",
        headers=csrf_headers,
        json={"auto_post": False},
    )
    assert response.status_code == 200

    response = api_client.delete(f"/api/recurring/{recurring_id}", headers=csrf_headers)
    assert response.status_code == 200

    response = api_client.delete(f"/api/tags/{tag_id}", headers=csrf_headers)
    assert response.status_code == 200


def test_budgets_admin_and_import_api_flows(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    _elevate_admin(api_client, csrf_headers)
    groceries_id = _create_category(api_client, csrf_headers, "Groceries", "expense")

    response = api_client.post(
        "/api/budgets/templates",
        headers=csrf_headers,
        json={
            "frequency": "monthly",
            "category_id": groceries_id,
            "amount_cents": 10_000,
            "starts_on": "2025-01-01",
            "ends_on": None,
        },
    )
    assert response.status_code == 200
    template_id = int(response.json()["id"])

    response = api_client.post(
        "/api/budgets/overrides",
        headers=csrf_headers,
        json={
            "year": 2025,
            "month": 1,
            "category_id": groceries_id,
            "amount_cents": 12_000,
        },
    )
    assert response.status_code == 200
    override_id = int(response.json()["id"])

    response = api_client.get("/api/budgets?view=month&month=2025-01")
    assert response.status_code == 200
    budget_rows = response.json()["budgets"]
    assert any(
        row["scope_category_id"] == groceries_id and row["amount_cents"] == 12_000
        for row in budget_rows
    )

    response = api_client.delete(
        f"/api/budgets/overrides/{override_id}", headers=csrf_headers
    )
    assert response.status_code == 200
    response = api_client.delete(
        f"/api/budgets/templates/{template_id}", headers=csrf_headers
    )
    assert response.status_code == 200

    txn_id = _create_transaction(
        api_client,
        csrf_headers,
        txn_date=date.today(),
        txn_type="expense",
        amount_cents=2_000,
        category_id=groceries_id,
        title="Delete me",
        tags=["Needs purge"],
    )
    response = api_client.delete(f"/api/transactions/{txn_id}", headers=csrf_headers)
    assert response.status_code == 200
    response = api_client.get("/api/transactions/deleted")
    assert response.status_code == 200
    assert any(item["id"] == txn_id for item in response.json()["transactions"])

    response = api_client.post(
        "/api/admin/purge-deleted",
        headers=csrf_headers,
        json={"days": -1},
    )
    assert response.status_code == 422

    override = app_main.app.dependency_overrides[app_main.get_db]
    db_iterator = override()
    db = next(db_iterator)
    try:
        db.execute(
            text("UPDATE transactions SET deleted_at = :deleted_at WHERE id = :id"),
            {"deleted_at": datetime(2000, 1, 1), "id": txn_id},
        )
        db.commit()
    finally:
        db_iterator.close()

    response = api_client.post(
        "/api/admin/purge-deleted",
        headers=csrf_headers,
        json={"days": 1},
    )
    assert response.status_code == 200
    assert response.json()["count"] == 1

    response = api_client.get("/api/transactions/deleted")
    assert response.status_code == 200
    assert all(item["id"] != txn_id for item in response.json()["transactions"])

    response = api_client.post("/api/admin/rebuild-rollups", headers=csrf_headers)
    assert response.status_code == 200

    response = api_client.post(
        "/api/recurring",
        headers=csrf_headers,
        json={
            "name": "Admin catch-up test",
            "type": "expense",
            "currency_code": "EUR",
            "amount_cents": 2_500,
            "category_id": groceries_id,
            "anchor_date": date.today().isoformat(),
            "interval_unit": "month",
            "interval_count": 1,
            "next_occurrence": date.today().isoformat(),
            "end_date": None,
            "auto_post": True,
            "skip_weekends": False,
            "month_day_policy": "snap_to_end",
        },
    )
    assert response.status_code == 200

    response = api_client.post(
        "/api/admin/recurring-catch-up",
        headers=csrf_headers,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["updated"] is True
    assert payload["advanced_rules"] >= 1
    assert payload["overdue_rules"] == 0

    response = api_client.post(
        "/api/admin/recurring-catch-up",
        headers=csrf_headers,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["updated"] is False
    assert payload["advanced_rules"] == 0
    assert payload["overdue_rules"] == 0

    response = api_client.post(
        "/api/settings/balance-anchors",
        headers=csrf_headers,
        json={
            "as_of_at": datetime.now().replace(microsecond=0).isoformat(),
            "balance_cents": 123_45,
            "note": "Initial checkpoint",
        },
    )
    assert response.status_code == 200
    anchor_id = int(response.json()["id"])

    response = api_client.put(
        f"/api/settings/balance-anchors/{anchor_id}",
        headers=csrf_headers,
        json={
            "as_of_at": datetime.now().replace(microsecond=0).isoformat(),
            "balance_cents": 222_22,
            "note": "Updated checkpoint",
        },
    )
    assert response.status_code == 200

    response = api_client.get("/api/settings")
    assert response.status_code == 200
    assert any(
        anchor["id"] == anchor_id for anchor in response.json()["balance_anchors"]
    )

    response = api_client.delete(
        f"/api/settings/balance-anchors/{anchor_id}", headers=csrf_headers
    )
    assert response.status_code == 200

    csv_content = (
        "Date,Type,IsReimbursement,Amount,Category,Title\n"
        f"{date.today().isoformat()},expense,0,10.00,Groceries,Imported row\n"
    )
    response = api_client.post(
        "/api/import/csv/preview",
        headers=csrf_headers,
        files={"file": ("import.csv", csv_content, "text/csv")},
    )
    assert response.status_code == 200
    assert response.json()["rows"]
    assert response.json()["errors"] == []

    response = api_client.post(
        "/api/import/csv/commit",
        headers=csrf_headers,
        files={"file": ("import.csv", csv_content, "text/csv")},
    )
    assert response.status_code == 200
    assert response.json()["imported_count"] == 1

    missing_title_csv = (
        "Date,Type,IsReimbursement,Amount,Category,Title\n"
        f"{date.today().isoformat()},expense,0,10.00,Groceries,\n"
    )
    response = api_client.post(
        "/api/import/csv/preview",
        headers=csrf_headers,
        files={"file": ("missing-title.csv", missing_title_csv, "text/csv")},
    )
    assert response.status_code == 200
    assert response.json()["rows"] == []
    assert response.json()["errors"] == ["Row 1: Title is required"]

    response = api_client.post(
        "/api/import/csv/commit",
        headers=csrf_headers,
        files={"file": ("missing-title.csv", missing_title_csv, "text/csv")},
    )
    assert response.status_code == 400
    assert "Title is required" in response.text

    response = api_client.post(
        "/api/import/sqlite/preview",
        headers=csrf_headers,
        files={"file": ("legacy.txt", b"not-a-db", "text/plain")},
    )
    assert response.status_code == 400
    assert "Please upload a .db file" in response.text


def test_csv_import_rejects_oversized_upload(
    api_client: TestClient, csrf_headers: dict[str, str], monkeypatch
) -> None:
    monkeypatch.setenv("EXPENSES_CSV_IMPORT_MAX_BYTES", "10")
    get_settings.cache_clear()

    response = api_client.post(
        "/api/import/csv/preview",
        headers=csrf_headers,
        files={
            "file": (
                "import.csv",
                "Date,Type,IsReimbursement,Amount,Category,Title\n",
                "text/csv",
            )
        },
    )

    assert response.status_code == 413


def test_report_pdf_rejects_oversized_date_range(
    api_client: TestClient, csrf_headers: dict[str, str], monkeypatch
) -> None:
    monkeypatch.setenv("EXPENSES_REPORT_MAX_DAYS", "1")
    get_settings.cache_clear()

    response = api_client.post(
        "/api/reports/pdf",
        headers=csrf_headers,
        json={
            "start": date.today().isoformat(),
            "end": date.fromordinal(date.today().toordinal() + 1).isoformat(),
            "sections": ["summary"],
        },
    )

    assert response.status_code == 400


def test_report_pdf_rejects_oversized_transaction_count(
    api_client: TestClient, csrf_headers: dict[str, str], monkeypatch
) -> None:
    monkeypatch.setenv("EXPENSES_REPORT_MAX_TRANSACTIONS", "1")
    get_settings.cache_clear()
    category_id = _create_category(api_client, csrf_headers, "Reports", "expense")
    for title in ("one", "two"):
        _create_transaction(
            api_client,
            csrf_headers,
            txn_date=date.today(),
            txn_type="expense",
            amount_cents=100,
            category_id=category_id,
            title=title,
            tags=[],
        )

    response = api_client.post(
        "/api/reports/pdf",
        headers=csrf_headers,
        json={
            "start": date.today().isoformat(),
            "end": date.today().isoformat(),
            "sections": ["summary"],
        },
    )

    assert response.status_code == 400


def test_bulk_edit_advanced_search_and_uncategorized_inbox(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    uncategorized_id = _create_category(
        api_client, csrf_headers, "Uncategorized", "expense"
    )
    groceries_id = _create_category(api_client, csrf_headers, "Groceries", "expense")
    transport_id = _create_category(api_client, csrf_headers, "Transport", "expense")

    txn_with_receipt = _create_transaction(
        api_client,
        csrf_headers,
        txn_date=date.today(),
        txn_type="expense",
        amount_cents=1_250,
        category_id=uncategorized_id,
        title="Lunch with receipt",
        tags=["Work"],
    )
    txn_without_receipt = _create_transaction(
        api_client,
        csrf_headers,
        txn_date=date.today(),
        txn_type="expense",
        amount_cents=500,
        category_id=uncategorized_id,
        title="Coffee without receipt",
        tags=[],
    )
    transport_txn_id = _create_transaction(
        api_client,
        csrf_headers,
        txn_date=date.today(),
        txn_type="expense",
        amount_cents=3_000,
        category_id=transport_id,
        title="Taxi fare",
        tags=[],
    )

    response = api_client.post(
        f"/api/transactions/{txn_with_receipt}/attachments",
        headers=csrf_headers,
        files={"file": ("receipt.pdf", b"%PDF-1.4 test receipt", "application/pdf")},
    )
    assert response.status_code == 200

    response = api_client.get("/api/transactions?period=all&q=has:receipt")
    assert response.status_code == 200
    receipt_result_ids = {int(item["id"]) for item in response.json()["items"]}
    assert txn_with_receipt in receipt_result_ids
    assert txn_without_receipt not in receipt_result_ids

    response = api_client.get("/api/transactions/export.csv?period=all")
    assert response.status_code == 200
    assert "text/csv" in response.headers.get("content-type", "")

    response = api_client.get("/api/transactions/uncategorized?period=all")
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 2
    assert {int(item["id"]) for item in payload["items"]} == {
        txn_with_receipt,
        txn_without_receipt,
    }
    assert payload["definition"]["matched_category_ids"] == [uncategorized_id]

    bulk_payload = {
        "selection": {
            "mode": "query",
            "query": {
                "period": "all",
                "start": None,
                "end": None,
                "type": "expense",
                "category": None,
                "matched_category_ids": payload["definition"]["matched_category_ids"],
                "tag": None,
                "q": None,
            },
        },
        "operation": {
            "set_category_id": groceries_id,
            "tag_patch": None,
            "lifecycle": "none",
        },
    }
    response = api_client.post(
        "/api/transactions/bulk/preview",
        headers=csrf_headers,
        json=bulk_payload,
    )
    assert response.status_code == 200
    assert set(response.json()["sample_ids"]) == {txn_with_receipt, txn_without_receipt}
    assert response.json()["changes"]["category_changed"] == 2

    response = api_client.post(
        "/api/transactions/bulk/apply",
        headers=csrf_headers,
        json=bulk_payload,
    )
    assert response.status_code == 200
    assert set(response.json()["sample_ids"]) == {txn_with_receipt, txn_without_receipt}
    assert response.json()["changes"]["category_changed"] == 2

    response = api_client.get("/api/transactions/uncategorized?period=all")
    assert response.status_code == 200
    assert response.json()["total"] == 0

    response = api_client.get(f"/api/transactions/{txn_with_receipt}")
    assert response.status_code == 200
    assert response.json()["category_id"] == groceries_id

    response = api_client.get(f"/api/transactions/{txn_without_receipt}")
    assert response.status_code == 200
    assert response.json()["category_id"] == groceries_id

    response = api_client.get(f"/api/transactions/{transport_txn_id}")
    assert response.status_code == 200
    assert response.json()["category_id"] == transport_id


def test_category_and_tag_merge_endpoints(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    source_category_id = _create_category(
        api_client, csrf_headers, "Dining Legacy", "expense"
    )
    target_category_id = _create_category(api_client, csrf_headers, "Dining", "expense")
    response = api_client.post(
        "/api/tags",
        headers=csrf_headers,
        json={"name": "LegacyTag", "is_hidden_from_budget": False},
    )
    assert response.status_code == 200
    source_tag_id = int(response.json()["id"])

    response = api_client.post(
        "/api/tags",
        headers=csrf_headers,
        json={"name": "ModernTag", "is_hidden_from_budget": False},
    )
    assert response.status_code == 200
    target_tag_id = int(response.json()["id"])

    txn_id = _create_transaction(
        api_client,
        csrf_headers,
        txn_date=date.today(),
        txn_type="expense",
        amount_cents=2_100,
        category_id=source_category_id,
        title="Merge testcase",
        tags=["LegacyTag"],
    )

    response = api_client.post(
        "/api/rules",
        headers=csrf_headers,
        json={
            "name": "Merge references rule",
            "enabled": True,
            "priority": 100,
            "match_type": "contains",
            "match_value": "merge",
            "transaction_type": "expense",
            "min_amount_cents": None,
            "max_amount_cents": None,
            "set_category_id": source_category_id,
            "add_tags": ["LegacyTag", "Other", "LegacyTag"],
            "budget_exclude_tag_id": source_tag_id,
        },
    )
    assert response.status_code == 200
    rule_id = int(response.json()["id"])

    response = api_client.post(
        "/api/tags/merge/preview",
        headers=csrf_headers,
        json={"source_tag_id": source_tag_id, "target_tag_id": target_tag_id},
    )
    assert response.status_code == 200
    assert response.json()["counts"]["transaction_links"] >= 1

    response = api_client.post(
        "/api/tags/merge",
        headers=csrf_headers,
        json={"source_tag_id": source_tag_id, "target_tag_id": target_tag_id},
    )
    assert response.status_code == 200

    response = api_client.get(f"/api/transactions/{txn_id}")
    assert response.status_code == 200
    assert "ModernTag" in response.json()["tags"]
    assert "LegacyTag" not in response.json()["tags"]

    response = api_client.get("/api/rules")
    assert response.status_code == 200
    rule = next(item for item in response.json()["rules"] if item["id"] == rule_id)
    assert rule["budget_exclude_tag_id"] == target_tag_id
    assert "ModernTag" in rule["add_tags"]
    assert "LegacyTag" not in rule["add_tags"]

    response = api_client.post(
        "/api/categories/merge/preview",
        headers=csrf_headers,
        json={
            "source_category_id": source_category_id,
            "target_category_id": target_category_id,
        },
    )
    assert response.status_code == 200
    assert response.json()["counts"]["transactions"] >= 1
    assert response.json()["counts"]["rules_set_category"] >= 1

    response = api_client.post(
        "/api/categories/merge",
        headers=csrf_headers,
        json={
            "source_category_id": source_category_id,
            "target_category_id": target_category_id,
        },
    )
    assert response.status_code == 200
    assert response.json()["counts"]["transactions"] >= 1

    response = api_client.get(f"/api/transactions/{txn_id}")
    assert response.status_code == 200
    assert response.json()["category_id"] == target_category_id

    response = api_client.get("/api/rules")
    assert response.status_code == 200
    rule = next(item for item in response.json()["rules"] if item["id"] == rule_id)
    assert rule["set_category_id"] == target_category_id

    response = api_client.get("/api/categories?period=all")
    assert response.status_code == 200
    source_category = next(
        item
        for item in response.json()["categories"]
        if item["id"] == source_category_id
    )
    assert source_category["archived_at"] is not None


def test_category_merge_rejects_overlapping_budget_scopes(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    source_category_id = _create_category(
        api_client, csrf_headers, "Merge Source Budget", "expense"
    )
    target_category_id = _create_category(
        api_client, csrf_headers, "Merge Target Budget", "expense"
    )

    response = api_client.post(
        "/api/budgets/templates",
        headers=csrf_headers,
        json={
            "frequency": "monthly",
            "category_id": source_category_id,
            "amount_cents": 8_000,
            "starts_on": "2025-01-01",
            "ends_on": None,
        },
    )
    assert response.status_code == 200
    response = api_client.post(
        "/api/budgets/templates",
        headers=csrf_headers,
        json={
            "frequency": "monthly",
            "category_id": target_category_id,
            "amount_cents": 9_000,
            "starts_on": "2025-01-01",
            "ends_on": None,
        },
    )
    assert response.status_code == 200

    response = api_client.post(
        "/api/budgets/overrides",
        headers=csrf_headers,
        json={
            "year": 2025,
            "month": 1,
            "category_id": source_category_id,
            "amount_cents": 11_000,
        },
    )
    assert response.status_code == 200
    response = api_client.post(
        "/api/budgets/overrides",
        headers=csrf_headers,
        json={
            "year": 2025,
            "month": 1,
            "category_id": target_category_id,
            "amount_cents": 12_000,
        },
    )
    assert response.status_code == 200

    response = api_client.post(
        "/api/categories/merge",
        headers=csrf_headers,
        json={
            "source_category_id": source_category_id,
            "target_category_id": target_category_id,
        },
    )
    assert response.status_code == 400
    assert "overlapping budget scopes" in response.json()["detail"]


def test_receipt_attachment_endpoints_and_permanent_delete_cleanup(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(api_client, csrf_headers, "Bills", "expense")
    txn_id = _create_transaction(
        api_client,
        csrf_headers,
        txn_date=date.today(),
        txn_type="expense",
        amount_cents=4_200,
        category_id=category_id,
        title="Utility bill",
        tags=[],
    )

    response = api_client.post(
        f"/api/transactions/{txn_id}/attachments",
        headers=csrf_headers,
        files={"file": ("bill.pdf", b"%PDF-1.4 first bill", "application/pdf")},
    )
    assert response.status_code == 200
    first_attachment_id = int(response.json()["id"])

    response = api_client.get(f"/api/transactions/{txn_id}/attachments")
    assert response.status_code == 200
    assert len(response.json()["attachments"]) == 1

    response = api_client.get(f"/api/attachments/{first_attachment_id}/download")
    assert response.status_code == 200
    assert response.content == b"%PDF-1.4 first bill"

    response = api_client.delete(
        f"/api/attachments/{first_attachment_id}",
        headers=csrf_headers,
    )
    assert response.status_code == 200

    response = api_client.get(f"/api/transactions/{txn_id}/attachments")
    assert response.status_code == 200
    assert response.json()["attachments"] == []

    response = api_client.post(
        f"/api/transactions/{txn_id}/attachments",
        headers=csrf_headers,
        files={"file": ("bill2.pdf", b"%PDF-1.4 second bill", "application/pdf")},
    )
    assert response.status_code == 200
    second_attachment_id = int(response.json()["id"])

    response = api_client.delete(f"/api/transactions/{txn_id}", headers=csrf_headers)
    assert response.status_code == 200

    response = api_client.delete(
        f"/api/transactions/{txn_id}/permanent", headers=csrf_headers
    )
    assert response.status_code == 200
    assert response.json()["attachments_count"] == 1
    assert response.json()["deleted_count"] == 1

    response = api_client.get(f"/api/attachments/{second_attachment_id}/download")
    assert response.status_code == 404
