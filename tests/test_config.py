import stat

import pytest

from expenses.core.config import AIBackend, get_settings


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    get_settings.cache_clear()
    try:
        yield
    finally:
        get_settings.cache_clear()


def test_csrf_secret_prefers_env_over_files(monkeypatch: pytest.MonkeyPatch, tmp_path):
    data_dir = tmp_path / "data"
    secret_file = tmp_path / "configured-secret"
    secret_file.write_text("file-secret\n")
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(data_dir))
    monkeypatch.setenv("EXPENSES_CSRF_SECRET", "env-secret")
    monkeypatch.setenv("EXPENSES_CSRF_SECRET_FILE", str(secret_file))

    settings = get_settings()

    assert settings.csrf_secret == "env-secret"
    assert settings.csrf_secret_source == "env"
    assert not (data_dir / "secrets" / "csrf_secret").exists()


def test_csrf_secret_reads_configured_secret_file(
    monkeypatch: pytest.MonkeyPatch, tmp_path
):
    secret_file = tmp_path / "configured-secret"
    secret_file.write_text("file-secret\n")
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("EXPENSES_CSRF_SECRET_FILE", str(secret_file))

    settings = get_settings()

    assert settings.csrf_secret == "file-secret"
    assert settings.csrf_secret_source == "configured_file"


def test_csrf_secret_generates_default_secret_file_and_reuses_it(
    monkeypatch: pytest.MonkeyPatch, tmp_path
):
    data_dir = tmp_path / "data"
    secret_file = data_dir / "secrets" / "csrf_secret"
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(data_dir))

    first_settings = get_settings()
    get_settings.cache_clear()
    second_settings = get_settings()

    assert secret_file.exists()
    assert stat.S_IMODE(secret_file.stat().st_mode) == 0o600
    assert len(first_settings.csrf_secret) >= 32
    assert first_settings.csrf_secret == second_settings.csrf_secret
    assert first_settings.csrf_secret_source == "generated_file"
    assert second_settings.csrf_secret_source == "generated_file"


def test_production_rejects_too_low_password_hash_iterations(
    monkeypatch: pytest.MonkeyPatch, tmp_path
):
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("EXPENSES_ENV", "Production")
    monkeypatch.setenv("EXPENSES_AUTH_PASSWORD_HASH_ITERATIONS", "99999")

    with pytest.raises(ValueError, match="EXPENSES_AUTH_PASSWORD_HASH_ITERATIONS"):
        get_settings()


def test_test_environment_allows_low_password_hash_iterations(
    monkeypatch: pytest.MonkeyPatch, tmp_path
):
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("EXPENSES_ENV", "test")
    monkeypatch.setenv("EXPENSES_AUTH_PASSWORD_HASH_ITERATIONS", "1000")

    settings = get_settings()

    assert settings.environment == "test"
    assert settings.auth_password_hash_iterations == 1000


def test_ai_backends_are_named_and_typed(monkeypatch: pytest.MonkeyPatch, tmp_path):
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("EXPENSES_AI_BACKENDS", "local, claude")
    monkeypatch.setenv("EXPENSES_AI_LOCAL_KIND", "openai-compatible")
    monkeypatch.setenv("EXPENSES_AI_LOCAL_BASE_URL", "http://ollama:11434/v1")
    monkeypatch.setenv("EXPENSES_AI_CLAUDE_KIND", "anthropic")
    monkeypatch.setenv("EXPENSES_AI_CLAUDE_API_KEY", "sk-ant-test")

    settings = get_settings()

    assert settings.ai_backends == {
        "claude": AIBackend(
            name="claude", kind="anthropic", base_url=None, api_key="sk-ant-test"
        ),
        "local": AIBackend(
            name="local",
            kind="openai-compatible",
            base_url="http://ollama:11434/v1",
            api_key="",
        ),
    }


@pytest.mark.parametrize(
    ("env", "message"),
    [
        ({"EXPENSES_LLM_BASE_URL": "http://llm"}, "EXPENSES_LLM_BASE_URL replaced"),
        ({"EXPENSES_AI_BACKENDS": "Local"}, "must be lowercase"),
        ({"EXPENSES_AI_BACKENDS": "x"}, "EXPENSES_AI_X_KIND must be one of"),
        (
            {"EXPENSES_AI_BACKENDS": "x", "EXPENSES_AI_X_KIND": "openai-compatible"},
            "EXPENSES_AI_X_BASE_URL is required",
        ),
        (
            {"EXPENSES_AI_BACKENDS": "x", "EXPENSES_AI_X_KIND": "anthropic"},
            "EXPENSES_AI_X_API_KEY is required",
        ),
    ],
)
def test_ai_backend_config_errors(
    monkeypatch: pytest.MonkeyPatch, tmp_path, env: dict[str, str], message: str
):
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(tmp_path / "data"))
    for name, value in env.items():
        monkeypatch.setenv(name, value)

    with pytest.raises(ValueError, match=message):
        get_settings()
