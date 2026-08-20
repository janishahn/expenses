from __future__ import annotations

import signal
from pathlib import Path
from typing import TypedDict, cast

import pytest

from expenses.cli import dev


class PopenCall(TypedDict):
    command: list[str]
    kwargs: dict[str, object]


def test_select_backend_port_uses_first_available(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen_ports: list[int] = []

    def fake_is_port_available(_host: str, port: int) -> bool:
        seen_ports.append(port)
        return port == 8002

    monkeypatch.setattr(dev, "_is_port_available", fake_is_port_available)

    selected = dev._select_backend_port("127.0.0.1", 8000, scan_limit=5)

    assert selected == 8002
    assert seen_ports == [8000, 8001, 8002]


def test_select_backend_port_raises_when_no_port_available() -> None:
    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(dev, "_is_port_available", lambda _host, _port: False)
        with pytest.raises(RuntimeError, match="Could not find a free backend port"):
            dev._select_backend_port("127.0.0.1", 8000, scan_limit=1)


def test_main_aligns_backend_bind_and_frontend_proxy_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    popen_calls: list[PopenCall] = []
    migration_calls: list[tuple[Path, bool]] = []

    class FakeProcess:
        def __init__(self, poll_results: list[int | None], pid: int) -> None:
            self._poll_results = list(poll_results)
            self._last_poll: int | None = None
            self.pid = pid
            self.stdout: list[str] = []

        def poll(self) -> int | None:
            if self._poll_results:
                self._last_poll = self._poll_results.pop(0)
            return self._last_poll

    backend_process = FakeProcess([None], pid=1001)
    frontend_process = FakeProcess([0], pid=1002)

    def fake_popen(command: list[str], **kwargs: object) -> FakeProcess:
        popen_calls.append({"command": command, "kwargs": kwargs})
        if len(popen_calls) == 1:
            return backend_process
        return frontend_process

    class FakeThread:
        def __init__(self, **_kwargs: object) -> None:
            pass

        def start(self) -> None:
            pass

        def join(self, timeout: float | None = None) -> None:
            _ = timeout

    original_signal_handlers = {
        signal.SIGINT: signal.getsignal(signal.SIGINT),
        signal.SIGTERM: signal.getsignal(signal.SIGTERM),
    }

    monkeypatch.setattr(dev, "_preflight_db", lambda: True)
    monkeypatch.setattr(dev, "_select_backend_port", lambda *_args, **_kwargs: 8012)
    monkeypatch.setattr(
        dev,
        "upgrade_head",
        lambda root_dir, *, quiet=False: migration_calls.append((root_dir, quiet)),
    )
    monkeypatch.setattr(dev.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(dev, "_stop_process", lambda _process: None)
    monkeypatch.setattr(dev.threading, "Thread", FakeThread)
    monkeypatch.setattr(dev.time, "sleep", lambda _seconds: None)
    monkeypatch.setenv("VITE_API_PROXY_TARGET", "http://127.0.0.1:8000")

    exit_code = dev.main([])

    assert exit_code == 0
    assert len(popen_calls) == 2
    assert migration_calls == [(Path(__file__).resolve().parents[1], True)]

    backend_call = popen_calls[0]
    frontend_call = popen_calls[1]

    backend_cmd = backend_call["command"]
    assert backend_cmd[backend_cmd.index("--host") + 1] == dev.DEV_BACKEND_HOST
    assert backend_cmd[backend_cmd.index("--port") + 1] == "8012"

    frontend_cmd = frontend_call["command"]
    assert frontend_cmd[frontend_cmd.index("--host") + 1] == dev.DEV_FRONTEND_HOST
    assert frontend_cmd[frontend_cmd.index("--port") + 1] == str(dev.DEV_FRONTEND_PORT)

    frontend_env = cast(dict[str, str], frontend_call["kwargs"]["env"])
    assert frontend_env["VITE_API_PROXY_TARGET"] == "http://127.0.0.1:8012"
    assert frontend_call["kwargs"]["cwd"] == Path(__file__).resolve().parents[1] / "ui"

    assert signal.getsignal(signal.SIGINT) == original_signal_handlers[signal.SIGINT]
    assert signal.getsignal(signal.SIGTERM) == original_signal_handlers[signal.SIGTERM]


def test_tailnet_port_selection_skips_existing_serve_ports(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(dev, "_used_tailnet_ports", lambda: {443, 8443, 8444})

    assert dev._select_tailnet_port(None) == 8445

    with pytest.raises(RuntimeError, match="already configured"):
        dev._select_tailnet_port(8444)


def test_main_tailnet_mode_uses_loopback_and_cleans_up(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    popen_calls: list[PopenCall] = []
    selected_hosts: list[tuple[str, int]] = []
    serve_calls: list[tuple[str, int, int | None]] = []
    written_states: list[dev.TailnetState] = []

    class FakeProcess:
        def __init__(self, poll_results: list[int | None], pid: int) -> None:
            self._poll_results = list(poll_results)
            self._last_poll: int | None = None
            self.pid = pid
            self.stdout: list[str] = []

        def poll(self) -> int | None:
            if self._poll_results:
                self._last_poll = self._poll_results.pop(0)
            return self._last_poll

    backend_process = FakeProcess([None], pid=2001)
    frontend_process = FakeProcess([0], pid=2002)

    def fake_popen(command: list[str], **kwargs: object) -> FakeProcess:
        popen_calls.append({"command": command, "kwargs": kwargs})
        return backend_process if len(popen_calls) == 1 else frontend_process

    class FakeThread:
        def __init__(self, **_kwargs: object) -> None:
            pass

        def start(self) -> None:
            pass

        def join(self, timeout: float | None = None) -> None:
            _ = timeout

    def fake_select_port(host: str, start_port: int, **_kwargs: object) -> int:
        selected_hosts.append((host, start_port))
        return 8012 if start_port == dev.DEV_BACKEND_START_PORT else 5174

    monkeypatch.setattr(dev, "_read_tailnet_state", lambda _path: None)
    monkeypatch.setattr(dev, "_process_started_at", lambda _pid: "process-start")
    monkeypatch.setattr(dev, "_tailnet_dns_name", lambda: "host.example.ts.net")
    monkeypatch.setattr(dev, "_select_tailnet_port", lambda _port: 8445)
    monkeypatch.setattr(dev, "_preflight_db", lambda: True)
    monkeypatch.setattr(dev, "upgrade_head", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(dev, "_select_backend_port", fake_select_port)
    monkeypatch.setattr(dev.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(dev, "_stop_process", lambda _process: None)
    monkeypatch.setattr(dev.threading, "Thread", FakeThread)
    monkeypatch.setattr(dev, "_wait_for_port", lambda *_args: True)
    monkeypatch.setattr(
        dev,
        "_enable_tailnet_serve",
        lambda port, frontend_port: serve_calls.append(("enable", port, frontend_port)),
    )
    monkeypatch.setattr(
        dev,
        "_disable_tailnet_serve",
        lambda port: serve_calls.append(("disable", port, None)) or True,
    )
    monkeypatch.setattr(
        dev,
        "_write_tailnet_state",
        lambda _path, state: written_states.append(state),
    )
    monkeypatch.setattr(dev, "_remove_owned_state", lambda *_args: None)
    monkeypatch.setattr(dev.time, "sleep", lambda _seconds: None)

    exit_code = dev.main(["--tailnet"])

    assert exit_code == 0
    assert selected_hosts == [
        (dev.DEV_BACKEND_HOST, dev.DEV_BACKEND_START_PORT),
        (dev.DEV_TAILNET_FRONTEND_HOST, dev.DEV_FRONTEND_PORT),
    ]
    frontend_call = popen_calls[1]
    frontend_cmd = frontend_call["command"]
    assert frontend_cmd[frontend_cmd.index("--host") + 1] == "127.0.0.1"
    assert frontend_cmd[frontend_cmd.index("--port") + 1] == "5174"
    frontend_env = cast(dict[str, str], frontend_call["kwargs"]["env"])
    assert (
        frontend_env["__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS"] == "host.example.ts.net"
    )
    assert serve_calls == [("enable", 8445, 5174), ("disable", 8445, None)]
    assert written_states == [
        {
            "pid": dev.os.getpid(),
            "port": 8445,
            "started_at": "process-start",
            "url": "https://host.example.ts.net:8445/",
        }
    ]


def test_detached_launch_records_command_and_reports_url(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    state_path = tmp_path / "dev.json"
    log_path = tmp_path / "dev.log"
    popen_calls: list[PopenCall] = []
    reads = iter(
        [
            None,
            dev.TailnetState(
                pid=3100,
                port=8443,
                started_at="process-start",
                url="https://host.example.ts.net:8443/",
            ),
        ]
    )

    class FakeProcess:
        pid = 3100

        def poll(self) -> None:
            return None

        def terminate(self) -> None:
            raise AssertionError("successful launch should not be terminated")

    def fake_popen(command: list[str], **kwargs: object) -> FakeProcess:
        popen_calls.append({"command": command, "kwargs": kwargs})
        return FakeProcess()

    monkeypatch.setattr(dev, "_runtime_paths", lambda _root: (state_path, log_path))
    monkeypatch.setattr(dev, "_read_tailnet_state", lambda _path: next(reads))
    monkeypatch.setattr(dev.subprocess, "Popen", fake_popen)

    args = dev._parse_args(["--tailnet", "--detach", "--tailnet-port", "8443"])

    assert dev._launch_detached(args, tmp_path) == 0
    assert popen_calls[0]["command"][-2:] == ["--tailnet-port", "8443"]
    assert popen_calls[0]["kwargs"]["start_new_session"] is True


def test_stop_removes_stale_tailnet_mapping(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    state_path = tmp_path / "dev.json"
    state_path.write_text(
        '{"pid": 4100, "port": 8447, "started_at": "old-process", '
        '"url": "https://host.example.ts.net:8447/"}',
        encoding="utf-8",
    )
    disabled_ports: list[int] = []

    monkeypatch.setattr(dev, "_runtime_paths", lambda _root: (state_path, tmp_path))
    monkeypatch.setattr(dev, "_state_process_is_running", lambda _state: False)
    monkeypatch.setattr(
        dev,
        "_disable_tailnet_serve",
        lambda port: disabled_ports.append(port) or True,
    )

    assert dev._stop_tailnet_dev(tmp_path) == 0
    assert disabled_ports == [8447]
    assert not state_path.exists()
