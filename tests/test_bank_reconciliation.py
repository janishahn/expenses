from fastapi.testclient import TestClient

from expenses.core.config import get_settings
from expenses.services.bank_reconciliation import parse_commerzbank_csv


def _csv_bytes(rows: list[str]) -> bytes:
    header = (
        "Buchungstag;Wertstellung;Buchungstext;Auftraggeber / Begünstigter;"
        "Betrag;Währung;Verwendungszweck"
    )
    return (header + "\n" + "\n".join(rows) + "\n").encode("cp1252")


def _upload_csv(
    api_client: TestClient,
    csrf_headers: dict[str, str],
    content: bytes,
    *,
    endpoint: str = "commit",
    account_label: str = "StartKonto",
):
    return api_client.post(
        f"/api/reconciliation/commerzbank-csv/{endpoint}",
        data={"account_label": account_label},
        files={"file": ("commerzbank.csv", content, "text/csv")},
        headers=csrf_headers,
    )


def _create_transaction(
    api_client: TestClient,
    csrf_headers: dict[str, str],
    *,
    date: str,
    amount_cents: int,
    title: str,
    txn_type: str = "expense",
) -> int:
    response = api_client.post(
        "/api/transactions",
        json={
            "date": date,
            "occurred_at": f"{date}T12:00:00",
            "type": txn_type,
            "amount_cents": amount_cents,
            "title": title,
        },
        headers=csrf_headers,
    )
    assert response.status_code == 200
    return int(response.json()["id"])


def test_parse_commerzbank_csv_handles_german_dates_amounts_and_cp1252() -> None:
    rows, errors = parse_commerzbank_csv(
        _csv_bytes(
            [
                "05.05.2026;05.05.2026;Kartenzahlung;REWE Markt GmbH;"
                "-111,78;EUR;Berlin Einkauf + Bargeld"
            ]
        ),
        account_label="StartKonto",
    )

    assert errors == []
    assert len(rows) == 1
    row = rows[0]
    assert row.booking_date.isoformat() == "2026-05-05"
    assert row.value_date is not None
    assert row.value_date.isoformat() == "2026-05-05"
    assert row.amount_cents == -11_178
    assert row.payee == "REWE Markt GmbH"
    assert "Bargeld" in row.raw_description


def test_parse_commerzbank_csv_enforces_row_limit() -> None:
    rows, errors = parse_commerzbank_csv(
        _csv_bytes(
            [
                "05.05.2026;05.05.2026;Kartenzahlung;REWE;-111,78;EUR;",
                "06.05.2026;06.05.2026;Online-Zahlung;Amazon;-9,99;EUR;",
            ]
        ),
        account_label="StartKonto",
        max_rows=1,
    )

    assert len(rows) == 1
    assert errors == ["CSV row limit exceeded (max 1)"]


def test_reconciliation_suggests_card_payment_with_bank_posting_delay(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    transaction_id = _create_transaction(
        api_client,
        csrf_headers,
        date="2026-05-03",
        amount_cents=3_327,
        title="REWE groceries",
    )

    response = _upload_csv(
        api_client,
        csrf_headers,
        _csv_bytes(["06.05.2026;06.05.2026;Kartenzahlung;REWE;-33,27;EUR;"]),
    )
    assert response.status_code == 200
    assert response.json() == {"imported_count": 1, "duplicate_count": 0}

    response = api_client.get("/api/reconciliation")
    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["suggested_count"] == 1
    row = payload["rows"][0]
    assert row["status"] == "suggested"
    assert row["suggested_transaction"]["id"] == transaction_id
    assert row["suggested_transaction"]["date_delta_days"] == 3

    accept_response = api_client.post(
        f"/api/reconciliation/bank-rows/{row['id']}/accept-suggestion",
        headers=csrf_headers,
    )
    assert accept_response.status_code == 200
    assert accept_response.json()["transaction_id"] == transaction_id

    response = api_client.get("/api/reconciliation")
    assert response.json()["rows"][0]["status"] == "matched"


def test_reconciliation_import_deduplicates_same_commerzbank_rows(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    content = _csv_bytes(["06.05.2026;06.05.2026;Online-Zahlung;Amazon;-9,99;EUR;"])

    first = _upload_csv(api_client, csrf_headers, content)
    assert first.status_code == 200
    assert first.json() == {"imported_count": 1, "duplicate_count": 0}

    preview = _upload_csv(api_client, csrf_headers, content, endpoint="preview")
    assert preview.status_code == 200
    assert preview.json()["duplicate_count"] == 1
    assert preview.json()["rows"][0]["duplicate"] is True

    second = _upload_csv(api_client, csrf_headers, content)
    assert second.status_code == 200
    assert second.json() == {"imported_count": 0, "duplicate_count": 1}


def test_commerzbank_csv_upload_rejects_oversized_file(
    api_client: TestClient, csrf_headers: dict[str, str], monkeypatch
) -> None:
    monkeypatch.setenv("EXPENSES_BANK_CSV_IMPORT_MAX_BYTES", "10")
    get_settings.cache_clear()

    response = _upload_csv(
        api_client,
        csrf_headers,
        _csv_bytes(["06.05.2026;06.05.2026;Online-Zahlung;Amazon;-9,99;EUR;"]),
        endpoint="preview",
    )

    assert response.status_code == 413


def test_reconciliation_import_deduplicates_rows_within_same_upload(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    content = _csv_bytes(
        [
            "06.05.2026;06.05.2026;Online-Zahlung;Amazon;-9,99;EUR;",
            "06.05.2026;06.05.2026;Online-Zahlung;Amazon;-9,99;EUR;",
        ]
    )

    preview = _upload_csv(api_client, csrf_headers, content, endpoint="preview")
    assert preview.status_code == 200
    assert preview.json()["new_count"] == 1
    assert preview.json()["duplicate_count"] == 1

    response = _upload_csv(api_client, csrf_headers, content)

    assert response.status_code == 200
    assert response.json() == {"imported_count": 1, "duplicate_count": 1}


def test_missing_bank_row_can_create_uncategorized_transaction(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    response = _upload_csv(
        api_client,
        csrf_headers,
        _csv_bytes(["06.05.2026;06.05.2026;Online-Zahlung;Amazon;-13,95;EUR;"]),
    )
    assert response.status_code == 200

    reconciliation = api_client.get("/api/reconciliation").json()
    row = reconciliation["rows"][0]
    assert row["status"] == "missing"

    create_response = api_client.post(
        f"/api/reconciliation/bank-rows/{row['id']}/create-transaction",
        headers=csrf_headers,
    )
    assert create_response.status_code == 200

    reconciliation = api_client.get("/api/reconciliation").json()
    assert reconciliation["rows"][0]["status"] == "matched"

    transactions = api_client.get("/api/transactions?period=all").json()["items"]
    created = next(
        item
        for item in transactions
        if item["id"] == create_response.json()["transaction_id"]
    )
    assert created["title"] == "Amazon"
    assert created["category"]["name"] == "Uncategorized"


def test_missing_bank_row_can_create_and_match_edited_transaction(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_response = api_client.post(
        "/api/categories",
        json={"name": "Online shopping", "type": "expense", "order": 0},
        headers=csrf_headers,
    )
    assert category_response.status_code == 200
    category_id = category_response.json()["id"]

    response = _upload_csv(
        api_client,
        csrf_headers,
        _csv_bytes(
            ["06.05.2026;06.05.2026;Online-Zahlung;Amazon;-13,95;EUR;ORDER 123"]
        ),
    )
    assert response.status_code == 200
    row = api_client.get("/api/reconciliation").json()["rows"][0]

    create_response = api_client.post(
        f"/api/reconciliation/bank-rows/{row['id']}/create-transaction",
        json={
            "date": "2026-05-04",
            "category_id": category_id,
            "title": "USB-C cable",
            "description": "Travel charger cable",
        },
        headers=csrf_headers,
    )

    assert create_response.status_code == 200
    reconciliation = api_client.get("/api/reconciliation").json()
    assert reconciliation["rows"][0]["status"] == "matched"
    matched = reconciliation["rows"][0]["suggested_transaction"]
    assert matched["category"] == "Online shopping"
    assert matched["category_id"] == category_id
    transactions = api_client.get("/api/transactions?period=all").json()["items"]
    created = next(
        item
        for item in transactions
        if item["id"] == create_response.json()["transaction_id"]
    )
    assert created["date"] == "2026-05-04"
    assert created["title"] == "USB-C cable"
    assert created["description"] == "Travel charger cable"
    assert created["category"]["name"] == "Online shopping"
    assert created["amount_cents"] == 1_395

    repeated_create = api_client.post(
        f"/api/reconciliation/bank-rows/{row['id']}/create-transaction",
        json={
            "date": "2026-05-04",
            "category_id": category_id,
            "title": "Duplicate cable",
            "description": None,
        },
        headers=csrf_headers,
    )
    assert repeated_create.status_code == 409
    transactions_after_retry = api_client.get("/api/transactions?period=all").json()[
        "items"
    ]
    assert all(item["title"] != "Duplicate cable" for item in transactions_after_retry)


def test_partial_cash_withdrawal_can_be_marked_reviewed(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    _create_transaction(
        api_client,
        csrf_headers,
        date="2026-05-05",
        amount_cents=1_178,
        title="Rewe for Josie and me",
    )
    response = _upload_csv(
        api_client,
        csrf_headers,
        _csv_bytes(
            ["05.05.2026;05.05.2026;Kartenzahlung;REWE;-111,78;EUR;Einkauf + Bargeld"]
        ),
    )
    assert response.status_code == 200

    row = api_client.get("/api/reconciliation").json()["rows"][0]
    assert row["status"] == "missing"

    reviewed = api_client.post(
        f"/api/reconciliation/bank-rows/{row['id']}/review",
        headers=csrf_headers,
    )
    assert reviewed.status_code == 200
    assert (
        api_client.get("/api/reconciliation").json()["rows"][0]["status"] == "reviewed"
    )


def test_same_amount_candidates_are_ambiguous(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    first_transaction_id = _create_transaction(
        api_client,
        csrf_headers,
        date="2026-05-04",
        amount_cents=1_200,
        title="Cafe one",
    )
    second_transaction_id = _create_transaction(
        api_client,
        csrf_headers,
        date="2026-05-05",
        amount_cents=1_200,
        title="Cafe two",
    )

    response = _upload_csv(
        api_client,
        csrf_headers,
        _csv_bytes(["06.05.2026;06.05.2026;Kartenzahlung;Cafe;-12,00;EUR;"]),
    )
    assert response.status_code == 200
    row = api_client.get("/api/reconciliation").json()["rows"][0]
    assert row["status"] == "ambiguous"
    assert row["candidate_count"] == 2
    assert [candidate["id"] for candidate in row["candidates"]] == [
        second_transaction_id,
        first_transaction_id,
    ]

    match_response = api_client.post(
        f"/api/reconciliation/bank-rows/{row['id']}/match-transaction",
        json={"transaction_id": first_transaction_id},
        headers=csrf_headers,
    )

    assert match_response.status_code == 200
    matched_row = api_client.get("/api/reconciliation").json()["rows"][0]
    assert matched_row["status"] == "matched"
    assert matched_row["suggested_transaction"]["id"] == first_transaction_id

    stale_match = api_client.post(
        f"/api/reconciliation/bank-rows/{row['id']}/match-transaction",
        json={"transaction_id": second_transaction_id},
        headers=csrf_headers,
    )
    assert stale_match.status_code == 409
    unchanged_row = api_client.get("/api/reconciliation").json()["rows"][0]
    assert unchanged_row["suggested_transaction"]["id"] == first_transaction_id


def test_new_reconciliation_actions_distinguish_missing_rows_and_invalid_input(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    missing_match = api_client.post(
        "/api/reconciliation/bank-rows/999999/match-transaction",
        json={"transaction_id": 999999},
        headers=csrf_headers,
    )
    missing_create = api_client.post(
        "/api/reconciliation/bank-rows/999999/create-transaction",
        json={
            "date": "2026-05-04",
            "category_id": None,
            "title": "Missing row",
            "description": None,
        },
        headers=csrf_headers,
    )
    assert missing_match.status_code == 404
    assert missing_create.status_code == 404

    response = _upload_csv(
        api_client,
        csrf_headers,
        _csv_bytes(["06.05.2026;06.05.2026;Online-Zahlung;Amazon;-13,95;EUR;"]),
    )
    assert response.status_code == 200
    row = api_client.get("/api/reconciliation").json()["rows"][0]
    invalid_category = api_client.post(
        f"/api/reconciliation/bank-rows/{row['id']}/create-transaction",
        json={
            "date": "2026-05-04",
            "category_id": 999999,
            "title": "Invalid category",
            "description": None,
        },
        headers=csrf_headers,
    )
    assert invalid_category.status_code == 400


def test_accept_suggestion_rejects_transaction_already_matched_to_another_row(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    _create_transaction(
        api_client,
        csrf_headers,
        date="2026-05-04",
        amount_cents=1_200,
        title="Cafe one",
    )
    response = _upload_csv(
        api_client,
        csrf_headers,
        _csv_bytes(
            [
                "06.05.2026;06.05.2026;Kartenzahlung;Cafe;-12,00;EUR;",
                "07.05.2026;07.05.2026;Kartenzahlung;Cafe;-12,00;EUR;",
            ]
        ),
    )
    assert response.status_code == 200

    rows = api_client.get("/api/reconciliation").json()["rows"]
    suggested_row = next(row for row in rows if row["status"] == "suggested")
    stale_row = next(row for row in rows if row["status"] == "missing")
    accepted = api_client.post(
        f"/api/reconciliation/bank-rows/{suggested_row['id']}/accept-suggestion",
        headers=csrf_headers,
    )
    assert accepted.status_code == 200

    stale_accept = api_client.post(
        f"/api/reconciliation/bank-rows/{stale_row['id']}/accept-suggestion",
        headers=csrf_headers,
    )

    assert stale_accept.status_code == 400


def _rows(api_client: TestClient) -> dict[str, dict]:
    return {
        row["payee"] or row["raw_description"]: row
        for row in api_client.get("/api/reconciliation").json()["rows"]
    }


def _post(api_client, csrf_headers, path: str, json=None):
    return api_client.post(
        f"/api/reconciliation/bank-rows/{path}", json=json, headers=csrf_headers
    )


def test_resolution_is_recorded_for_each_outcome_without_changing_legacy_status(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    matched_txn = _create_transaction(
        api_client, csrf_headers, date="2026-05-04", amount_cents=1_200, title="Cafe"
    )
    _upload_csv(
        api_client,
        csrf_headers,
        _csv_bytes(
            [
                "06.05.2026;06.05.2026;Kartenzahlung;Cafe;-12,00;EUR;",
                "07.05.2026;07.05.2026;Online-Zahlung;Amazon;-13,95;EUR;",
                "08.05.2026;08.05.2026;Auszahlung;Cash;-50,00;EUR;",
                "09.05.2026;09.05.2026;Gutschrift;Refund;5,00;EUR;",
            ]
        ),
    )
    rows = _rows(api_client)
    assert all(
        row["resolution"] is None
        and row["resolved_at"] is None
        and row["ignore_reason"] is None
        for row in rows.values()
    )

    accepted = _post(
        api_client, csrf_headers, f"{rows['Cafe']['id']}/accept-suggestion"
    )
    created = _post(
        api_client, csrf_headers, f"{rows['Amazon']['id']}/create-transaction"
    )
    ignored = _post(
        api_client,
        csrf_headers,
        f"{rows['Cash']['id']}/ignore",
        {"reason": "  Partial withdrawal  "},
    )
    reviewed = _post(api_client, csrf_headers, f"{rows['Refund']['id']}/review")
    assert [r.status_code for r in (accepted, created, ignored, reviewed)] == [200] * 4

    response = api_client.get("/api/reconciliation").json()
    rows = {row["payee"]: row for row in response["rows"]}
    names = ("Cafe", "Amazon", "Cash", "Refund")
    assert [rows[name]["status"] for name in names] == [
        "matched",
        "matched",
        "reviewed",
        "reviewed",
    ]
    assert [rows[name]["resolution"] for name in names] == [
        "matched",
        "created",
        "ignored",
        "ignored",
    ]
    assert rows["Cash"]["ignore_reason"] == "Partial withdrawal"
    assert rows["Refund"]["ignore_reason"] is None
    assert rows["Cash"]["reviewed_at"] is not None
    assert all(row["resolved_at"] for row in rows.values())
    assert response["summary"]["reviewed_count"] == 2
    assert response["summary"]["matched_count"] == 2

    assert (
        _post(api_client, csrf_headers, f"{rows['Cash']['id']}/reopen").status_code
        == 200
    )
    cash = _rows(api_client)["Cash"]
    assert (cash["status"], cash["resolution"], cash["resolved_at"]) == (
        "missing",
        None,
        None,
    )
    assert (cash["reviewed_at"], cash["ignore_reason"]) == (None, None)
    assert api_client.get(f"/api/transactions/{matched_txn}").json()["bank_row"] == {
        "id": rows["Cafe"]["id"],
        "account_label": "StartKonto",
        "booking_date": "2026-05-06",
    }


def test_bank_row_list_filters_by_view_outcome_account_and_page(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    _upload_csv(
        api_client,
        csrf_headers,
        _csv_bytes(
            [
                "06.05.2026;06.05.2026;Karte;Cafe;-12,00;EUR;",
                "07.05.2026;07.05.2026;Karte;Amazon;-13,95;EUR;",
                "08.05.2026;08.05.2026;Karte;Cash;-50,00;EUR;",
            ]
        ),
    )
    _upload_csv(
        api_client,
        csrf_headers,
        _csv_bytes(["09.05.2026;09.05.2026;Karte;Savings;-1,00;EUR;"]),
        account_label="Other",
    )
    rows = _rows(api_client)
    _post(api_client, csrf_headers, f"{rows['Amazon']['id']}/create-transaction")
    _post(api_client, csrf_headers, f"{rows['Cash']['id']}/ignore", {"reason": None})

    open_page = api_client.get("/api/reconciliation/bank-rows").json()
    assert open_page["total"] == 2
    assert (open_page["page"], open_page["limit"]) == (1, 50)
    assert [item["payee"] for item in open_page["items"]] == ["Savings", "Cafe"]
    assert open_page["items"][1]["status"] == "missing"

    resolved = api_client.get("/api/reconciliation/bank-rows?view=resolved").json()
    assert [item["payee"] for item in resolved["items"]] == ["Cash", "Amazon"]
    only_created = api_client.get(
        "/api/reconciliation/bank-rows?view=resolved&outcome=created"
    ).json()
    assert [item["payee"] for item in only_created["items"]] == ["Amazon"]
    other_account = api_client.get("/api/reconciliation/bank-rows?account=Other").json()
    assert [item["payee"] for item in other_account["items"]] == ["Savings"]
    second_page = api_client.get("/api/reconciliation/bank-rows?limit=1&page=2").json()
    assert second_page["total"] == 2
    assert [item["payee"] for item in second_page["items"]] == ["Cafe"]
    assert api_client.get("/api/reconciliation/bank-rows?view=bad").status_code == 422
    assert (
        api_client.get("/api/reconciliation/bank-rows?outcome=bad").status_code == 422
    )

    accounts = api_client.get("/api/reconciliation/accounts").json()["accounts"]
    assert [(a["label"], a["row_count"]) for a in accounts] == [
        ("Other", 1),
        ("StartKonto", 3),
    ]
    assert all(a["last_import_at"] for a in accounts)


def test_row_matched_to_trashed_transaction_is_open_again(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    transaction_id = _create_transaction(
        api_client, csrf_headers, date="2026-05-04", amount_cents=1_200, title="Cafe"
    )
    _upload_csv(
        api_client,
        csrf_headers,
        _csv_bytes(["06.05.2026;06.05.2026;Karte;Cafe;-12,00;EUR;"]),
    )
    row_id = _rows(api_client)["Cafe"]["id"]
    _post(api_client, csrf_headers, f"{row_id}/accept-suggestion")
    assert api_client.get("/api/reconciliation/bank-rows").json()["total"] == 0

    api_client.delete(f"/api/transactions/{transaction_id}", headers=csrf_headers)

    assert _rows(api_client)["Cafe"]["status"] == "matched"  # legacy view unchanged
    open_page = api_client.get("/api/reconciliation/bank-rows").json()
    assert [(i["id"], i["status"]) for i in open_page["items"]] == [(row_id, "missing")]
    resolved_url = "/api/reconciliation/bank-rows?view=resolved"
    assert api_client.get(resolved_url).json()["total"] == 0

    purged = api_client.delete(
        f"/api/transactions/{transaction_id}/permanent", headers=csrf_headers
    )
    assert purged.status_code == 200
    open_page = api_client.get("/api/reconciliation/bank-rows").json()
    assert [(i["id"], i["status"]) for i in open_page["items"]] == [(row_id, "missing")]
    assert api_client.get(resolved_url).json()["total"] == 0
    ignored = _post(api_client, csrf_headers, f"{row_id}/ignore", {"reason": "gone"})
    assert ignored.status_code == 200
    assert api_client.get(resolved_url).json()["total"] == 1


def test_reopen_can_trash_the_transaction_created_from_the_row(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    _upload_csv(
        api_client,
        csrf_headers,
        _csv_bytes(
            [
                "06.05.2026;06.05.2026;Karte;Amazon;-13,95;EUR;",
                "07.05.2026;07.05.2026;Karte;Shop;-20,00;EUR;",
            ]
        ),
    )
    rows = _rows(api_client)
    keep = _post(api_client, csrf_headers, f"{rows['Amazon']['id']}/create-transaction")
    drop = _post(api_client, csrf_headers, f"{rows['Shop']['id']}/create-transaction")

    plain = _post(api_client, csrf_headers, f"{rows['Amazon']['id']}/reopen")
    trashing = _post(
        api_client,
        csrf_headers,
        f"{rows['Shop']['id']}/reopen",
        {"trash_created_transaction": True},
    )

    assert (plain.status_code, trashing.status_code) == (200, 200)
    trashed = api_client.get("/api/transactions/deleted").json()["transactions"]
    assert [item["id"] for item in trashed] == [drop.json()["transaction_id"]]
    kept_id = keep.json()["transaction_id"]
    assert api_client.get(f"/api/transactions/{kept_id}").status_code == 200


def test_undo_reopen_skips_a_changed_row_and_restores_a_created_row(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    _upload_csv(
        api_client,
        csrf_headers,
        _csv_bytes(["07.05.2026;07.05.2026;Karte;Shop;-20,00;EUR;"]),
    )
    row_id = _rows(api_client)["Shop"]["id"]
    first = _post(api_client, csrf_headers, f"{row_id}/create-transaction")
    first_id = first.json()["transaction_id"]
    _post(api_client, csrf_headers, f"{row_id}/reopen")
    second = _post(api_client, csrf_headers, f"{row_id}/create-transaction")
    second_id = second.json()["transaction_id"]

    # A stale Undo of the first create must not trash the second transaction.
    stale = _post(
        api_client,
        csrf_headers,
        f"{row_id}/reopen",
        {
            "trash_created_transaction": True,
            "expected_resolution": "created",
            "expected_transaction_id": first_id,
        },
    )
    assert stale.status_code == 409
    assert api_client.get(f"/api/transactions/{second_id}").status_code == 200
    assert (
        _post(
            api_client,
            csrf_headers,
            f"{row_id}/reopen",
            {"expected_resolution": "ignored"},
        ).status_code
        == 409
    )

    # Undoing a reopen that trashed the transaction restores both.
    _post(
        api_client,
        csrf_headers,
        f"{row_id}/reopen",
        {"trash_created_transaction": True, "expected_transaction_id": second_id},
    )
    api_client.post(
        "/api/transactions/deleted/restore",
        json={"ids": [second_id]},
        headers=csrf_headers,
    )
    undone = _post(
        api_client,
        csrf_headers,
        f"{row_id}/match-transaction",
        {"transaction_id": second_id, "resolution": "created"},
    )

    assert undone.status_code == 200
    assert api_client.get(f"/api/transactions/{second_id}").status_code == 200
    resolved = api_client.get("/api/reconciliation/bank-rows?view=resolved").json()
    assert [(i["id"], i["resolution"]) for i in resolved["items"]] == [
        (row_id, "created")
    ]


def test_accept_suggestions_only_accepts_rows_with_one_candidate(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    ids = {
        title: _create_transaction(
            api_client, csrf_headers, date=day, amount_cents=cents, title=title
        )
        for day, cents, title in (
            ("2026-05-04", 1_200, "Cafe"),
            ("2026-05-10", 2_000, "Shop"),
            ("2026-05-20", 3_000, "Gym A"),
            ("2026-05-20", 3_000, "Gym B"),
        )
    }
    _upload_csv(
        api_client,
        csrf_headers,
        _csv_bytes(
            [
                "06.05.2026;06.05.2026;Karte;Cafe;-12,00;EUR;",
                "07.05.2026;07.05.2026;Karte;Cafe again;-12,00;EUR;",
                "10.05.2026;10.05.2026;Karte;Shop;-20,00;EUR;",
                "20.05.2026;20.05.2026;Karte;Gym;-30,00;EUR;",
                "25.05.2026;25.05.2026;Karte;Nothing;-99,00;EUR;",
            ]
        ),
    )
    rows = _rows(api_client)
    row_ids = [row["id"] for row in rows.values()]

    response = _post(
        api_client, csrf_headers, "accept-suggestions", {"row_ids": [*row_ids, 999_999]}
    )

    # Both cafe rows suggest the same transaction; the newer row takes it.
    assert response.json() == {
        "matches": [
            {"row_id": rows["Shop"]["id"], "transaction_id": ids["Shop"]},
            {"row_id": rows["Cafe again"]["id"], "transaction_id": ids["Cafe"]},
        ]
    }
    after = _rows(api_client)
    names = ("Cafe", "Cafe again", "Shop", "Gym", "Nothing")
    assert [after[name]["status"] for name in names] == [
        "missing",
        "matched",
        "matched",
        "ambiguous",
        "missing",
    ]
    repeated = _post(
        api_client, csrf_headers, "accept-suggestions", {"row_ids": row_ids}
    )
    assert repeated.json() == {"matches": []}


def test_candidate_search_ignores_amount_and_skips_transactions_matched_elsewhere(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    ids = {
        title: _create_transaction(
            api_client, csrf_headers, date=day, amount_cents=cents, title=title
        )
        for day, cents, title in (
            ("2026-05-06", 1_500, "Cafe Luna"),
            ("2026-01-06", 900, "CAFE old"),
            ("2026-05-06", 1_200, "Cafe taken"),
            ("2026-05-06", 1_200, "Bakery"),
        )
    }
    # Income never matches a debit row.
    _create_transaction(
        api_client,
        csrf_headers,
        date="2026-05-06",
        amount_cents=7_700,
        title="Cafe refund",
        txn_type="income",
    )
    _upload_csv(
        api_client,
        csrf_headers,
        _csv_bytes(
            [
                "06.05.2026;06.05.2026;Karte;Cafe;-12,00;EUR;",
                "06.05.2026;06.05.2026;Karte;Other;-77,00;EUR;",
            ]
        ),
    )
    rows = _rows(api_client)
    first, second = rows["Cafe"]["id"], rows["Other"]["id"]
    _post(
        api_client,
        csrf_headers,
        f"{first}/match-transaction",
        {"transaction_id": ids["Cafe taken"]},
    )

    def search(row_id: int, query: str, limit: int = 20) -> list[int]:
        response = api_client.get(
            f"/api/reconciliation/bank-rows/{row_id}/candidates",
            params={"query": query, "limit": limit},
        )
        assert response.status_code == 200
        return [item["id"] for item in response.json()["items"]]

    # Nearest booking date first; the transaction matched by the other row is hidden.
    assert search(second, "cafe") == [ids["Cafe Luna"], ids["CAFE old"]]
    assert ids["Cafe taken"] in search(first, "cafe")  # own match stays listed
    assert search(second, "cafe", limit=1) == [ids["Cafe Luna"]]
    assert len(search(second, "")) == 3
    assert search(second, "100%") == []
    item = api_client.get(
        f"/api/reconciliation/bank-rows/{second}/candidates?query=luna"
    ).json()["items"][0]
    assert item["signed_amount_cents"] == -1_500
    assert item["date_delta_days"] == 0
    missing = api_client.get("/api/reconciliation/bank-rows/999999/candidates")
    assert missing.status_code == 404


def test_match_can_update_transaction_amount_to_the_bank_amount(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    keep_amount = _create_transaction(
        api_client, csrf_headers, date="2026-05-06", amount_cents=1_500, title="Cafe A"
    )
    adjust_amount = _create_transaction(
        api_client, csrf_headers, date="2026-05-06", amount_cents=1_900, title="Cafe B"
    )
    income = _create_transaction(
        api_client,
        csrf_headers,
        date="2026-05-06",
        amount_cents=1_200,
        title="Cafe C",
        txn_type="income",
    )
    dollars = _create_transaction(
        api_client, csrf_headers, date="2026-05-06", amount_cents=1_900, title="Cafe D"
    )
    _upload_csv(
        api_client,
        csrf_headers,
        _csv_bytes(
            [
                "06.05.2026;06.05.2026;Karte;One;-12,00;EUR;",
                "06.05.2026;06.05.2026;Karte;Two;-12,00;EUR;",
                "06.05.2026;06.05.2026;Karte;Three;-12,00;EUR;",
                "06.05.2026;06.05.2026;Karte;Four;-12,00;USD;",
            ]
        ),
    )
    rows = _rows(api_client)

    def match(name: str, transaction_id: int, **extra):
        return _post(
            api_client,
            csrf_headers,
            f"{rows[name]['id']}/match-transaction",
            {"transaction_id": transaction_id, **extra},
        )

    plain = match("One", keep_amount)
    updated = match("Two", adjust_amount, update_amount_to_bank=True)
    wrong_type = match("Three", income)
    wrong_type_updated = match("Three", income, update_amount_to_bank=True)
    missing = match("Three", 999_999)
    # Transaction amounts are euros, so a dollar amount cannot replace one.
    foreign = match("Four", dollars, update_amount_to_bank=True)

    statuses = [plain, updated, wrong_type, wrong_type_updated, missing, foreign]
    assert [r.status_code for r in statuses] == [200, 200, 400, 400, 400, 400]
    # The replaced amount lets the web undo the change.
    assert plain.json()["previous_amount_cents"] is None
    assert updated.json()["previous_amount_cents"] == 1_900

    def amount(transaction_id: int) -> int:
        return api_client.get(f"/api/transactions/{transaction_id}").json()[
            "amount_cents"
        ]

    assert (
        amount(keep_amount),
        amount(adjust_amount),
        amount(income),
        amount(dollars),
    ) == (1_500, 1_200, 1_200, 1_900)
    assert _rows(api_client)["Three"]["resolution"] is None


def test_create_transaction_from_row_accepts_tags_and_notes(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    tag_id = api_client.post(
        "/api/tags", headers=csrf_headers, json={"name": "Trip"}
    ).json()["id"]
    _upload_csv(
        api_client,
        csrf_headers,
        _csv_bytes(["07.05.2026;07.05.2026;Online-Zahlung;Amazon;-13,95;EUR;"]),
    )
    row_id = _rows(api_client)["Amazon"]["id"]
    body = {
        "date": "2026-05-07",
        "category_id": None,
        "title": "Books",
        "notes": "  Gift  ",
        "tag_ids": [tag_id],
    }

    unknown_tag = _post(
        api_client,
        csrf_headers,
        f"{row_id}/create-transaction",
        {**body, "tag_ids": [tag_id, 999_999]},
    )
    created = _post(api_client, csrf_headers, f"{row_id}/create-transaction", body)

    assert unknown_tag.status_code == 400
    assert created.status_code == 200
    detail = api_client.get(
        f"/api/transactions/{created.json()['transaction_id']}"
    ).json()
    assert detail["tags"] == ["Trip"]
    assert (detail["description"], detail["title"]) == ("Gift", "Books")
    assert detail["bank_row"]["id"] == row_id
