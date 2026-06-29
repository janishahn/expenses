import pytest
from fastapi.testclient import TestClient

from expenses.core.config import get_settings

AI_GET_ENDPOINTS = [
    "/api/ai/rules/suggestions",
    "/api/ai/transaction-suggestions",
    "/api/ai/usage/summary",
]

AI_POST_ENDPOINTS = [
    "/api/ai/rules/mine",
    "/api/ai/rules/suggestions/1/accept",
    "/api/ai/rules/suggestions/1/reject",
    "/api/ai/transactions/1/triage",
    "/api/ai/transaction-suggestions/1/accept",
    "/api/ai/transaction-suggestions/1/reject",
    "/api/ai/search/translate",
    "/api/ai/spending-chat/stream",
]


def _disable_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("EXPENSES_LLM_ENABLED", raising=False)
    monkeypatch.delenv("EXPENSES_LLM_BASE_URL", raising=False)
    get_settings.cache_clear()


def _enable_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EXPENSES_LLM_ENABLED", "true")
    monkeypatch.setenv("EXPENSES_LLM_BASE_URL", "http://llm.local/v1")
    get_settings.cache_clear()


def test_bootstrap_status_exposes_llm_enabled_flag(
    api_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _disable_llm(monkeypatch)
    assert api_client.get("/api/auth/bootstrap-status").json()["llm_enabled"] is False
    _enable_llm(monkeypatch)
    assert api_client.get("/api/auth/bootstrap-status").json()["llm_enabled"] is True


def test_mobile_status_exposes_llm_enabled_flag(
    api_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _disable_llm(monkeypatch)
    assert api_client.get("/api/mobile/status").json()["llm_enabled"] is False
    _enable_llm(monkeypatch)
    assert api_client.get("/api/mobile/status").json()["llm_enabled"] is True


@pytest.mark.parametrize("path", AI_GET_ENDPOINTS)
def test_ai_get_endpoints_blocked_when_llm_disabled(
    api_client: TestClient, monkeypatch: pytest.MonkeyPatch, path: str
) -> None:
    _disable_llm(monkeypatch)
    response = api_client.get(path)
    assert response.status_code == 503
    assert response.json()["detail"] == "LLM features are disabled"


@pytest.mark.parametrize("path", AI_POST_ENDPOINTS)
def test_ai_post_endpoints_blocked_when_llm_disabled(
    api_client: TestClient,
    csrf_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    path: str,
) -> None:
    _disable_llm(monkeypatch)
    response = api_client.post(
        path,
        headers=csrf_headers,
        json={"messages": [{"role": "user", "content": "hi"}], "query": "groceries"},
    )
    assert response.status_code == 503
    assert response.json()["detail"] == "LLM features are disabled"


@pytest.mark.parametrize("path", AI_GET_ENDPOINTS)
def test_ai_read_endpoints_available_when_llm_enabled(
    api_client: TestClient, monkeypatch: pytest.MonkeyPatch, path: str
) -> None:
    _enable_llm(monkeypatch)
    assert api_client.get(path).status_code == 200
