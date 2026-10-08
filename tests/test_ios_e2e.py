"""Guard against native test tooling touching real data or hiding test failures."""

import json
import os
from pathlib import Path
import sys

import httpx
import pytest

from expenses.cli import ios_e2e


def test_native_backend_is_isolated_and_stops_after_a_failed_journey(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    developer_database = tmp_path / "developer.db"
    developer_database.write_bytes(b"untouched developer database")
    monkeypatch.setenv("EXPENSES_DATABASE_URL", f"sqlite:///{developer_database}")
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(tmp_path / "developer-data"))
    monkeypatch.setenv("EXPENSES_AUTH_SETUP_TOKEN", "developer-setup-token")
    monkeypatch.setenv("EXPENSES_LLM_ENABLED", "true")

    with httpx.Client(trust_env=False, timeout=5) as client:
        with pytest.raises(RuntimeError, match="journey failed"):
            with ios_e2e.backend(tmp_path / "test-data", tmp_path / "artifacts") as url:
                status = (
                    client.get(f"{url}/api/mobile/status").raise_for_status().json()
                )
                assert status["setup_required"] is True
                assert status["setup_token_required"] is False
                assert status["llm_enabled"] is False
                response = client.post(
                    f"{url}/api/mobile/auth/setup",
                    json={
                        "username": "native-test",
                        "password": "test-password-123",
                        "device_id": "native-fixture",
                        "device_name": "Native fixture",
                    },
                ).raise_for_status()
                assert response.json()["authenticated"] is True
                status = (
                    client.get(f"{url}/api/mobile/status").raise_for_status().json()
                )
                assert status["setup_required"] is False
                assert status["signup_allowed"] is True
                raise RuntimeError("journey failed")
        with pytest.raises(httpx.TransportError):
            client.get(f"{url}/api/mobile/status")

    assert developer_database.read_bytes() == b"untouched developer database"
    assert not (tmp_path / "developer-data").exists()


def test_failed_simulator_boot_deletes_only_the_owned_device(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    deleted = []

    def simctl(*args, **_kwargs):
        if args[:2] == ("list", "runtimes"):
            return json.dumps(
                {
                    "runtimes": [
                        {
                            "identifier": "com.apple.CoreSimulator.SimRuntime.iOS-26-0",
                            "version": "26.0",
                            "name": "iOS 26.0",
                            "isAvailable": True,
                        }
                    ]
                }
            )
        if args[:2] == ("list", "devicetypes"):
            return json.dumps(
                {"devicetypes": [{"name": "iPhone 17 Pro", "identifier": "iphone"}]}
            )
        if args[0] == "create":
            return "owned-simulator-uuid"
        if args[0] == "boot":
            raise RuntimeError("simulator unavailable")
        if args[0] in {"shutdown", "delete"}:
            deleted.append(args)
        return ""

    monkeypatch.setattr(ios_e2e, "_simctl", simctl)
    with pytest.raises(RuntimeError, match="simulator unavailable"):
        with ios_e2e.simulator():
            pytest.fail("An unbooted simulator must not be used")
    assert deleted == [
        ("shutdown", "owned-simulator-uuid"),
        ("delete", "owned-simulator-uuid"),
    ]


def test_native_runner_propagates_xcode_failure_and_retains_log(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    xcodebuild = tmp_path / "xcodebuild"
    xcodebuild.write_text(
        f"#!{sys.executable}\n"
        "import os, sys\n"
        "assert os.environ['TEST_RUNNER_EXPENSES_UI_TEST_BACKEND_URL'] "
        "== 'http://localhost:12345'\n"
        "assert os.environ['TEST_RUNNER_EXPENSES_UI_TEST_FRESH_BACKEND_URL'] "
        "== 'http://localhost:12346'\n"
        "print('A native journey failed')\n"
        "sys.exit(65)\n"
    )
    xcodebuild.chmod(0o755)
    monkeypatch.setenv("PATH", f"{tmp_path}{os.pathsep}{os.environ['PATH']}")

    assert (
        ios_e2e.run_tests(
            "owned-uuid",
            "http://localhost:12345",
            "http://localhost:12346",
            tmp_path,
            tmp_path,
        )
        == 65
    )
    assert "A native journey failed" in (tmp_path / "xcodebuild.log").read_text()
    assert "A native journey failed" in capsys.readouterr().out
