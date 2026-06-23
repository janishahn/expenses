import json
import os
import time
from pathlib import Path

from fastapi.testclient import TestClient

from expenses_web.core.app_logging import build_log_query, query_logs
from expenses_web.core.config import get_settings


def _elevate_admin(api_client: TestClient) -> None:
    csrf_response = api_client.get("/api/csrf")
    assert csrf_response.status_code == 200
    elevate = api_client.post(
        "/api/auth/admin-elevation",
        headers={"X-CSRF-Token": csrf_response.json()["token"]},
        json={"password": "pw-12345"},
    )
    assert elevate.status_code == 200


def _ingest_headers(api_client: TestClient) -> dict[str, str]:
    csrf_response = api_client.get("/api/csrf")
    assert csrf_response.status_code == 200
    create_token = api_client.post(
        "/api/settings/ingest-token",
        headers={"X-CSRF-Token": csrf_response.json()["token"]},
    )
    assert create_token.status_code == 200
    return {"Authorization": f"Bearer {create_token.json()['token']}"}


def _wait_for_log_entries(
    api_client: TestClient, *, event: str, request_id: str | None = None
) -> list[dict[str, object]]:
    deadline = time.monotonic() + 2.0
    while time.monotonic() < deadline:
        params = {"event": event, "limit": 20}
        if request_id:
            params["request_id"] = request_id
        response = api_client.get("/api/admin/logs", params=params)
        assert response.status_code == 200
        entries = response.json()["entries"]
        if entries:
            return entries
        time.sleep(0.05)
    return []


def test_ingest_validation_failure_logs_payload_and_request_id(
    api_client: TestClient,
) -> None:
    _elevate_admin(api_client)
    response = api_client.post(
        "/api/ingest",
        headers=_ingest_headers(api_client),
        json={"amount_cents": "oops"},
    )
    assert response.status_code == 422
    request_id = response.headers.get("X-Request-ID")
    assert request_id

    entries = _wait_for_log_entries(
        api_client,
        event="request_validation_failed",
        request_id=request_id,
    )
    assert entries
    entry = entries[0]
    assert entry["path"] == "/api/ingest"
    assert entry["request_id"] == request_id
    assert "amount_cents" in str(entry["raw_body"])
    assert entry["raw_body_bytes"] > 0
    assert entry["validation_errors"]


def test_ingest_success_logs_resolution_details(api_client: TestClient) -> None:
    _elevate_admin(api_client)
    response = api_client.post(
        "/api/ingest",
        headers=_ingest_headers(api_client),
        json={"amount_cents": 1299, "title": "Netflix March"},
    )
    assert response.status_code == 201
    request_id = response.headers.get("X-Request-ID")
    assert request_id

    entries = _wait_for_log_entries(
        api_client,
        event="ingest_request_succeeded",
        request_id=request_id,
    )
    assert entries
    entry = entries[0]
    assert entry["transaction_id"] == response.json()["id"]
    assert entry["category_resolution"] == "uncategorized"
    assert entry["final_category"] == "Uncategorized"
    assert entry["rules_matched"] == 0
    assert entry["rules_applied"] == 0
    assert "Netflix March" in str(entry["raw_body"])


def test_admin_logs_endpoint_paginates(api_client: TestClient) -> None:
    _elevate_admin(api_client)
    ingest_headers = _ingest_headers(api_client)
    first = api_client.post(
        "/api/ingest",
        headers=ingest_headers,
        json={"amount_cents": 500, "title": "Coffee"},
    )
    second = api_client.post(
        "/api/ingest",
        headers=ingest_headers,
        json={"amount_cents": 700, "title": "Lunch"},
    )
    assert first.status_code == 201
    assert second.status_code == 201

    time.sleep(0.1)
    page_one = api_client.get(
        "/api/admin/logs",
        params={"event": "ingest_request_succeeded", "limit": 1},
    )
    assert page_one.status_code == 200
    first_page_payload = page_one.json()
    assert len(first_page_payload["entries"]) == 1
    assert first_page_payload["next_cursor"] is not None

    page_two = api_client.get(
        "/api/admin/logs",
        params={
            "event": "ingest_request_succeeded",
            "limit": 1,
            "cursor": first_page_payload["next_cursor"],
        },
    )
    assert page_two.status_code == 200
    second_page_payload = page_two.json()
    assert len(second_page_payload["entries"]) == 1
    assert (
        first_page_payload["entries"][0]["transaction_id"]
        != second_page_payload["entries"][0]["transaction_id"]
    )


def test_admin_info_includes_log_metadata(api_client: TestClient) -> None:
    _elevate_admin(api_client)
    api_client.get("/api/admin/info")
    time.sleep(0.1)
    response = api_client.get("/api/admin/info")
    assert response.status_code == 200
    payload = response.json()
    expected_log_dir = Path(os.environ["EXPENSES_DATA_DIR"]).resolve().parent / "logs"
    assert get_settings().log_dir == expected_log_dir
    assert Path(payload["log_path"]).parent == expected_log_dir
    assert payload["log_path"].endswith("app.jsonl")
    assert payload["log_retained_files"] >= 1


def test_admin_logs_endpoint_accepts_naive_since(api_client: TestClient) -> None:
    _elevate_admin(api_client)
    log_file = get_settings().log_dir / "app.jsonl"
    log_file.write_text(
        json.dumps(
            {
                "timestamp": "2026-03-24T12:05:00+00:00",
                "level": "INFO",
                "logger": "tests.logging",
                "event": "manual_log_entry",
            }
        )
        + "\n",
        encoding="utf-8",
    )

    response = api_client.get(
        "/api/admin/logs",
        params={"event": "manual_log_entry", "since": "2026-03-24T12:00:00"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert [entry["event"] for entry in payload["entries"]] == ["manual_log_entry"]


def test_query_logs_streams_retained_files_without_read_text(
    monkeypatch, tmp_path: Path
) -> None:
    data_dir = tmp_path / "expenses_data"
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(data_dir))
    get_settings.cache_clear()
    try:
        settings = get_settings()
        current_log = settings.log_dir / "app.jsonl"
        retained_log = settings.log_dir / "app.jsonl.1"
        retained_log.write_text(
            json.dumps(
                {
                    "timestamp": "2026-03-24T11:59:00+00:00",
                    "level": "INFO",
                    "logger": "tests.logging",
                    "event": "older_log_entry",
                }
            )
            + "\n",
            encoding="utf-8",
        )
        current_log.write_text(
            json.dumps(
                {
                    "timestamp": "2026-03-24T12:00:00+00:00",
                    "level": "INFO",
                    "logger": "tests.logging",
                    "event": "newer_log_entry",
                }
            )
            + "\n",
            encoding="utf-8",
        )
        now = time.time()
        os.utime(retained_log, (now - 10, now - 10))
        os.utime(current_log, (now, now))

        def _unexpected_read_text(*args, **kwargs):
            raise AssertionError("query_logs should not read full log files")

        monkeypatch.setattr(type(current_log), "read_text", _unexpected_read_text)

        result = query_logs(
            settings,
            build_log_query(
                limit=1,
                cursor=None,
                level=None,
                event=None,
                request_id=None,
                path=None,
                status_code=None,
                error_only=False,
                since=None,
                q=None,
            ),
        )

        assert [entry["event"] for entry in result.entries] == ["newer_log_entry"]
        assert result.next_cursor == "1"
    finally:
        get_settings.cache_clear()


def test_admin_logs_error_only_filters_error_entries(api_client: TestClient) -> None:
    _elevate_admin(api_client)
    log_file = get_settings().log_dir / "app.jsonl"
    log_file.write_text(
        "\n".join(
            [
                json.dumps(
                    {
                        "timestamp": "2026-03-24T12:00:00+00:00",
                        "level": "WARNING",
                        "logger": "tests.logging",
                        "event": "request_validation_failed",
                        "status_code": 422,
                    }
                ),
                json.dumps(
                    {
                        "timestamp": "2026-03-24T12:01:00+00:00",
                        "level": "ERROR",
                        "logger": "tests.logging",
                        "event": "request_unhandled_exception",
                        "status_code": 500,
                    }
                ),
                json.dumps(
                    {
                        "timestamp": "2026-03-24T12:02:00+00:00",
                        "level": "ERROR",
                        "logger": "tests.logging",
                        "event": "request_completed",
                        "status_code": 500,
                    }
                ),
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    response = api_client.get("/api/admin/logs", params={"error_only": "true"})

    assert response.status_code == 200
    payload = response.json()
    assert [entry["event"] for entry in payload["entries"]] == [
        "request_completed",
        "request_unhandled_exception",
    ]
