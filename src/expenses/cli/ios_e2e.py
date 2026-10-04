"""Run native UI journeys against an isolated backend and disposable simulator."""

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from uuid import uuid4

import httpx

REPO_ROOT = Path(__file__).resolve().parents[3]
PROJECT = REPO_ROOT / "ios" / "ExpensesApp" / "ExpensesApp.xcodeproj"


def _stop_process(process: subprocess.Popen) -> None:
    """Stop only the process group this command started, including child tools."""
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=10)


def _backend_environment(data_dir: Path, artifacts: Path) -> dict[str, str]:
    # Neither a developer's .env nor deployment settings may redirect tests to
    # their database, receipts, secrets, or inference provider.
    env = {k: v for k, v in os.environ.items() if not k.startswith("EXPENSES_")}
    env.update(
        PYTHON_DOTENV_DISABLED="1",
        EXPENSES_ENV="test",
        EXPENSES_DATA_DIR=str(data_dir),
        EXPENSES_DATABASE_URL=f"sqlite:///{data_dir / 'expenses.db'}",
        EXPENSES_RECEIPTS_DIR=str(data_dir / "receipts"),
        EXPENSES_LOG_DIR=str(artifacts / "server-logs"),
        EXPENSES_AUTH_SIGNUP_ENABLED="true",
        EXPENSES_AUTH_PASSWORD_HASH_ITERATIONS="1000",
        EXPENSES_LLM_ENABLED="false",
        EXPENSES_LLM_BASE_URL="http://127.0.0.1:1/v1",
        EXPENSES_LLM_API_KEY="unused",
    )
    return env


@contextmanager
def backend(data_dir: Path, artifacts: Path):
    """Start the real API; UI tests create isolated users through public APIs."""
    data_dir.mkdir(parents=True, exist_ok=True)
    artifacts.mkdir(parents=True, exist_ok=True)
    env = _backend_environment(data_dir, artifacts)
    with (artifacts / "backend.log").open("w") as log:
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=REPO_ROOT,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            check=True,
            timeout=120,
        )
        # Reserve and hand off the actual listening socket, never a probed port.
        with socket.create_server(("127.0.0.1", 0)) as listener:
            url = f"http://localhost:{listener.getsockname()[1]}"
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-c",
                    "import uvicorn; uvicorn.run('expenses.app:app', "
                    f"fd={listener.fileno()}, access_log=False)",
                ],
                cwd=REPO_ROOT,
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
                pass_fds=(listener.fileno(),),
                start_new_session=True,
            )
        try:
            deadline = time.monotonic() + 90
            with httpx.Client(trust_env=False, timeout=1) as client:
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise RuntimeError("Native E2E backend exited during startup.")
                    try:
                        if client.get(f"{url}/api/mobile/status").status_code == 200:
                            break
                    except httpx.HTTPError:
                        pass
                    time.sleep(0.15)
                else:
                    raise RuntimeError(
                        "Native E2E backend did not become ready in 90s."
                    )
            yield url
        finally:
            _stop_process(process)


def _simctl(*args: str, check: bool = True) -> str:
    completed = subprocess.run(
        ["xcrun", "simctl", *args],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=check,
        timeout=180,
    )
    return completed.stdout.strip()


@contextmanager
def simulator():
    runtimes = json.loads(_simctl("list", "runtimes", "--json"))["runtimes"]
    available = [
        runtime
        for runtime in runtimes
        if runtime.get("isAvailable")
        and runtime["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-")
        and runtime["version"].split(".")[0] == "26"
    ]
    if not available:
        raise RuntimeError("Install an iOS 26 Simulator runtime in Xcode Settings.")
    runtime = max(
        available,
        key=lambda entry: tuple(int(part) for part in entry["version"].split(".")),
    )
    types = json.loads(_simctl("list", "devicetypes", "--json"))["devicetypes"]
    device = next((item for item in types if item["name"] == "iPhone 17 Pro"), None)
    if device is None:
        device = next((item for item in types if item["name"] == "iPhone 16 Pro"), None)
    if device is None:
        raise RuntimeError(
            "Xcode must include the iPhone 17 Pro or 16 Pro device type."
        )
    udid = _simctl(
        "create",
        f"Expenses E2E {uuid4().hex[:8]}",
        device["identifier"],
        runtime["identifier"],
    )
    try:
        print(f"Booting disposable {device['name']} ({runtime['name']})", flush=True)
        _simctl("boot", udid)
        _simctl("bootstatus", udid, "-b")
        yield udid
    finally:
        # Never shut down or erase a simulator belonging to a developer or job.
        try:
            _simctl("shutdown", udid, check=False)
        finally:
            _simctl("delete", udid)


def run_tests(
    udid: str, url: str, fresh_url: str, work_dir: Path, artifacts: Path
) -> int:
    env = os.environ.copy()
    # Xcode relays TEST_RUNNER_* to the XCTest runner without the prefix.
    env["TEST_RUNNER_EXPENSES_UI_TEST_BACKEND_URL"] = url
    env["TEST_RUNNER_EXPENSES_UI_TEST_FRESH_BACKEND_URL"] = fresh_url
    command = [
        "xcodebuild",
        "test",
        "-project",
        str(PROJECT),
        "-scheme",
        "ExpensesApp",
        "-configuration",
        "Debug",
        "-destination",
        f"platform=iOS Simulator,id={udid}",
        "-derivedDataPath",
        str(work_dir / "DerivedData"),
        "-resultBundlePath",
        str(artifacts / "Results.xcresult"),
        "-parallel-testing-enabled",
        "NO",
        "-maximum-concurrent-test-simulator-destinations",
        "1",
        # Keep Xcode's signing/entitlement generation for Keychain access while
        # using the simulator's certificate-free ad-hoc identity, not a team.
        "CODE_SIGNING_ALLOWED=YES",
        "CODE_SIGN_IDENTITY=-",
        "DEVELOPMENT_TEAM=",
    ]
    print(
        f"Running native journeys. Build/test log: {artifacts / 'xcodebuild.log'}",
        flush=True,
    )
    with (artifacts / "xcodebuild.log").open("w") as log:
        process = subprocess.Popen(
            command,
            cwd=REPO_ROOT,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            return process.wait(timeout=2700)
        finally:
            _stop_process(process)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args(argv)
    if sys.platform != "darwin" or any(
        shutil.which(tool) is None for tool in ("xcrun", "xcodebuild")
    ):
        parser.error(
            "ios-e2e requires macOS with Xcode and an iOS 26 Simulator runtime."
        )

    run_id = (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid4().hex[:8]
    )
    artifacts = REPO_ROOT / "test-results" / "ios" / run_id
    artifacts.mkdir(parents=True)
    print(f"Native E2E artifacts: {artifacts}", flush=True)

    def interrupted(_signum, _frame):
        raise KeyboardInterrupt

    previous_sigterm = signal.signal(signal.SIGTERM, interrupted)
    try:
        with tempfile.TemporaryDirectory(prefix="expenses-ios-e2e-") as temporary:
            work_dir = Path(temporary)
            with (
                backend(work_dir / "data", artifacts) as url,
                backend(
                    work_dir / "fresh-data", artifacts / "fresh-backend"
                ) as fresh_url,
                simulator() as udid,
            ):
                return run_tests(udid, url, fresh_url, work_dir, artifacts)
    except KeyboardInterrupt:
        print(
            "Native E2E interrupted; owned test resources were cleaned up.",
            file=sys.stderr,
        )
        return 130
    except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
        print(f"Native E2E failed: {exc}\nLogs: {artifacts}", file=sys.stderr)
        if isinstance(exc, subprocess.CalledProcessError) and exc.stderr:
            print(exc.stderr, file=sys.stderr)
        return 1
    finally:
        signal.signal(signal.SIGTERM, previous_sigterm)


if __name__ == "__main__":
    raise SystemExit(main())
