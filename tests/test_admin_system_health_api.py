from fastapi.testclient import TestClient


def _elevate_admin(client: TestClient, csrf_headers: dict[str, str]) -> None:
    response = client.post(
        "/api/auth/admin-elevation",
        headers=csrf_headers,
        json={"password": "pw-12345"},
    )
    assert response.status_code == 200


def test_admin_system_health_endpoint(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    _elevate_admin(api_client, csrf_headers)
    response = api_client.get("/api/admin/system-health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] in {"healthy", "warm", "critical"}
    assert payload["cpu_load_percent"] >= 0
    assert payload["ram_total_bytes"] >= payload["ram_used_bytes"]
    assert payload["disk_total_bytes"] >= payload["disk_used_bytes"]
    assert payload["disk_total_bytes"] >= payload["disk_free_bytes"]


def test_admin_system_health_validation_override_cookie_flow(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    _elevate_admin(api_client, csrf_headers)
    initial_status_response = api_client.get(
        "/api/admin/system-health/validation-override"
    )
    assert initial_status_response.status_code == 200
    assert initial_status_response.json() == {"profile": None}

    set_response = api_client.post(
        "/api/admin/system-health/validation-override",
        headers=csrf_headers,
        json={"profile": "critical"},
    )
    assert set_response.status_code == 200
    assert set_response.json() == {"profile": "critical"}

    status_response = api_client.get("/api/admin/system-health/validation-override")
    assert status_response.status_code == 200
    assert status_response.json() == {"profile": "critical"}

    payload = api_client.get("/api/admin/system-health").json()
    assert payload["status"] == "critical"
    assert payload["disk_total_bytes"] == 10_000_000_000
    assert payload["disk_free_bytes"] == 800_000_000
    assert payload["disk_used_bytes"] == 9_200_000_000

    clear_response = api_client.delete(
        "/api/admin/system-health/validation-override",
        headers=csrf_headers,
    )
    assert clear_response.status_code == 200
    assert clear_response.json() == {"profile": None}
    status_response = api_client.get("/api/admin/system-health/validation-override")
    assert status_response.status_code == 200
    assert status_response.json() == {"profile": None}


def test_admin_system_health_validation_override_rejects_invalid_profile(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    _elevate_admin(api_client, csrf_headers)
    response = api_client.post(
        "/api/admin/system-health/validation-override",
        headers=csrf_headers,
        json={"profile": "invalid"},
    )
    assert response.status_code == 400
    assert (
        response.json()["detail"] == "Invalid profile. Use healthy, warm, or critical."
    )
