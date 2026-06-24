from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import expenses.app as app_main
from expenses.core.config import get_settings
from expenses.db.session import Base


@pytest.fixture()
def anonymous_api_client(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    data_dir = tmp_path / "expenses_data"
    receipts_dir = data_dir / "receipts"
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(data_dir))
    monkeypatch.setenv("EXPENSES_RECEIPTS_DIR", str(receipts_dir))
    monkeypatch.setenv("EXPENSES_AUTH_SIGNUP_ENABLED", "true")
    get_settings.cache_clear()

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session_local = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        session = session_local()
        try:
            session.execute(text("PRAGMA foreign_keys=ON"))
            yield session
        finally:
            session.close()

    monkeypatch.setattr(app_main.scheduler_manager, "start", lambda: None)
    monkeypatch.setattr(app_main.scheduler_manager, "stop", lambda: None)
    app_main.app.dependency_overrides[app_main.get_db] = override_get_db

    try:
        with TestClient(app_main.app) as client:
            yield client
    finally:
        app_main.app.dependency_overrides.clear()
        get_settings.cache_clear()


@pytest.fixture()
def api_client(anonymous_api_client: TestClient) -> TestClient:
    setup_response = anonymous_api_client.post(
        "/api/auth/setup",
        json={"username": "bootstrap", "password": "pw-12345"},
    )
    assert setup_response.status_code == 200
    return anonymous_api_client


@pytest.fixture()
def csrf_headers(api_client: TestClient) -> dict[str, str]:
    response = api_client.get("/api/csrf")
    assert response.status_code == 200
    token = response.json()["token"]
    return {"X-CSRF-Token": token}
