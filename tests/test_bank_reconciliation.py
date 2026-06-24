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
    _create_transaction(
        api_client,
        csrf_headers,
        date="2026-05-04",
        amount_cents=1_200,
        title="Cafe one",
    )
    _create_transaction(
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
