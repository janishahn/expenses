from fastapi.testclient import TestClient


def _ingest_headers(api_client: TestClient) -> dict[str, str]:
    csrf_response = api_client.get("/api/csrf")
    assert csrf_response.status_code == 200
    create_token = api_client.post(
        "/api/settings/ingest-token",
        headers={"X-CSRF-Token": csrf_response.json()["token"]},
    )
    assert create_token.status_code == 200
    return {"Authorization": f"Bearer {create_token.json()['token']}"}


def test_api_ingest_requires_valid_bearer_token(api_client: TestClient) -> None:
    missing = api_client.post(
        "/api/ingest",
        json={"amount_cents": 1299, "title": "Coffee"},
    )
    assert missing.status_code == 401

    invalid = api_client.post(
        "/api/ingest",
        headers={"Authorization": "Bearer invalid"},
        json={"amount_cents": 1299, "title": "Coffee"},
    )
    assert invalid.status_code == 401


def test_api_ingest_returns_stored_location(api_client: TestClient) -> None:
    response = api_client.post(
        "/api/ingest",
        headers=_ingest_headers(api_client),
        json={
            "amount_cents": 1299,
            "title": "Coffee",
            "date": "2026-03-20",
            "category": "Food",
            "latitude": 52.520008,
            "longitude": 13.404954,
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["latitude"] == 52.520008
    assert payload["longitude"] == 13.404954
    assert payload["location_status"] == "stored"


def test_api_transaction_reads_return_stored_location_after_ingest(
    api_client: TestClient,
) -> None:
    response = api_client.post(
        "/api/ingest",
        headers=_ingest_headers(api_client),
        json={
            "amount_cents": 1299,
            "title": "Coffee",
            "date": "2026-03-20",
            "category": "Food",
            "latitude": 52.520008,
            "longitude": 13.404954,
        },
    )

    assert response.status_code == 201
    transaction_id = int(response.json()["id"])

    response = api_client.get(f"/api/transactions/{transaction_id}")
    assert response.status_code == 200
    assert response.json()["latitude"] == 52.520008
    assert response.json()["longitude"] == 13.404954

    response = api_client.get("/api/transactions?period=all")
    assert response.status_code == 200
    item = next(
        row for row in response.json()["items"] if int(row["id"]) == transaction_id
    )
    assert item["latitude"] == 52.520008
    assert item["longitude"] == 13.404954


def test_api_ingest_ignores_partial_location(api_client: TestClient) -> None:
    response = api_client.post(
        "/api/ingest",
        headers=_ingest_headers(api_client),
        json={
            "amount_cents": 2500,
            "title": "Lunch",
            "latitude": 52.52,
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["latitude"] is None
    assert payload["longitude"] is None
    assert payload["location_status"] == "ignored_partial"


def test_api_ingest_ignores_out_of_range_complete_location(
    api_client: TestClient,
) -> None:
    response = api_client.post(
        "/api/ingest",
        headers=_ingest_headers(api_client),
        json={
            "amount_cents": 1800,
            "title": "Groceries",
            "latitude": 120.0,
            "longitude": 13.4,
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["latitude"] is None
    assert payload["longitude"] is None
    assert payload["location_status"] == "ignored_partial"


def test_api_ingest_ignores_malformed_coordinate_type(
    api_client: TestClient,
) -> None:
    response = api_client.post(
        "/api/ingest",
        headers=_ingest_headers(api_client),
        json={
            "amount_cents": 1800,
            "title": "Groceries",
            "latitude": "north",
            "longitude": 13.4,
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["latitude"] is None
    assert payload["longitude"] is None
    assert payload["location_status"] == "ignored_partial"


def test_api_ingest_accepts_numeric_coordinate_strings(api_client: TestClient) -> None:
    response = api_client.post(
        "/api/ingest",
        headers=_ingest_headers(api_client),
        json={
            "amount_cents": 1800,
            "title": "Groceries",
            "latitude": "52.520008",
            "longitude": "13.404954",
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["latitude"] == 52.520008
    assert payload["longitude"] == 13.404954
    assert payload["location_status"] == "stored"


def test_api_ingest_rejects_nested_location_object(api_client: TestClient) -> None:
    response = api_client.post(
        "/api/ingest",
        headers=_ingest_headers(api_client),
        json={
            "amount_cents": 1800,
            "title": "Groceries",
            "location": {
                "latitude": 52.5,
                "longitude": 13.4,
            },
        },
    )

    assert response.status_code == 422
