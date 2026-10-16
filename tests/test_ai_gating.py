import pytest
from fastapi.testclient import TestClient

from expenses.core.config import get_settings

FEATURE_GET_ENDPOINTS = {
    "/api/ai/rules/suggestions": "Rule suggestions",
    "/api/ai/transaction-suggestions": "Categorization suggestions",
}

FEATURE_POST_ENDPOINTS = {
    "/api/ai/rules/mine": "Rule suggestions",
    "/api/ai/rules/suggestions/1/accept": "Rule suggestions",
    "/api/ai/rules/suggestions/1/reject": "Rule suggestions",
    "/api/ai/transactions/1/triage": "Categorization suggestions",
    "/api/ai/transaction-suggestions/1/accept": "Categorization suggestions",
    "/api/ai/transaction-suggestions/1/reject": "Categorization suggestions",
    "/api/assistant/messages/stream": "Assistant",
}


def _configure_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EXPENSES_AI_BACKENDS", "local")
    monkeypatch.setenv("EXPENSES_AI_LOCAL_KIND", "openai-compatible")
    monkeypatch.setenv("EXPENSES_AI_LOCAL_BASE_URL", "http://llm.local/v1")
    get_settings.cache_clear()


def _elevate(client: TestClient, csrf_headers: dict[str, str]) -> None:
    response = client.post(
        "/api/auth/admin-elevation", headers=csrf_headers, json={"password": "pw-12345"}
    )
    assert response.status_code == 200


def _enable(
    client: TestClient, csrf_headers: dict[str, str], *features: str
) -> dict[str, object]:
    response = client.put(
        "/api/admin/ai/settings",
        headers=csrf_headers,
        json={
            "features": {
                feature: {"enabled": True, "backend": "local", "model": "qwen"}
                for feature in features
            }
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_status_lists_only_enabled_features(
    api_client: TestClient,
    csrf_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert api_client.get("/api/auth/bootstrap-status").json()["ai_features"] == []
    assert api_client.get("/api/mobile/status").json()["ai_features"] == []

    _configure_backend(monkeypatch)
    _elevate(api_client, csrf_headers)
    _enable(api_client, csrf_headers, "spending_chat")

    assert api_client.get("/api/auth/bootstrap-status").json()["ai_features"] == [
        "spending_chat"
    ]
    assert api_client.get("/api/mobile/status").json()["ai_features"] == [
        "spending_chat"
    ]


def test_feature_turns_off_when_its_backend_is_removed(
    api_client: TestClient,
    csrf_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_backend(monkeypatch)
    _elevate(api_client, csrf_headers)
    _enable(api_client, csrf_headers, "spending_chat")

    monkeypatch.delenv("EXPENSES_AI_BACKENDS")
    get_settings.cache_clear()

    assert api_client.get("/api/auth/bootstrap-status").json()["ai_features"] == []


def test_admin_settings_require_a_backend_and_model_to_enable(
    api_client: TestClient,
    csrf_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure_backend(monkeypatch)
    _elevate(api_client, csrf_headers)

    missing_backend = api_client.put(
        "/api/admin/ai/settings",
        headers=csrf_headers,
        json={"features": {"rule_mining": {"enabled": True, "model": "qwen"}}},
    )
    assert missing_backend.status_code == 422
    assert missing_backend.json()["detail"] == "Choose a backend for Rule suggestions."

    missing_model = api_client.put(
        "/api/admin/ai/settings",
        headers=csrf_headers,
        json={"features": {"rule_mining": {"enabled": True, "backend": "local"}}},
    )
    assert missing_model.status_code == 422

    settings = _enable(api_client, csrf_headers, "rule_mining")
    assert settings["backends"] == [{"name": "local", "kind": "openai-compatible"}]
    rule_mining = next(f for f in settings["features"] if f["id"] == "rule_mining")
    assert rule_mining == {
        "id": "rule_mining",
        "name": "Rule suggestions",
        "enabled": True,
        "backend": "local",
        "model": "qwen",
        "thinking": "auto",
    }


def test_admin_ai_settings_require_elevation(api_client: TestClient) -> None:
    assert api_client.get("/api/admin/ai/settings").status_code == 403
    assert api_client.get("/api/admin/ai/usage").status_code == 403
    assert api_client.get("/api/admin/ai/usage/chats/abc").status_code == 403


@pytest.mark.parametrize("path", FEATURE_GET_ENDPOINTS)
def test_feature_get_endpoints_blocked_when_feature_off(
    api_client: TestClient, path: str
) -> None:
    response = api_client.get(path)
    assert response.status_code == 503
    assert response.json()["detail"] == (
        f"{FEATURE_GET_ENDPOINTS[path]} is turned off on this server"
    )


@pytest.mark.parametrize("path", FEATURE_POST_ENDPOINTS)
def test_feature_post_endpoints_blocked_when_feature_off(
    api_client: TestClient, csrf_headers: dict[str, str], path: str
) -> None:
    response = api_client.post(
        path,
        headers=csrf_headers,
        json={"messages": [{"role": "user", "content": "hi"}], "query": "groceries"},
    )
    assert response.status_code == 503
    assert response.json()["detail"] == (
        f"{FEATURE_POST_ENDPOINTS[path]} is turned off on this server"
    )


@pytest.mark.parametrize("path", FEATURE_GET_ENDPOINTS)
def test_feature_get_endpoints_available_when_feature_on(
    api_client: TestClient,
    csrf_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    path: str,
) -> None:
    _configure_backend(monkeypatch)
    _elevate(api_client, csrf_headers)
    _enable(api_client, csrf_headers, "rule_mining", "transaction_triage")
    assert api_client.get(path).status_code == 200
