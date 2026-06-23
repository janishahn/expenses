from __future__ import annotations

import signal
from pathlib import Path
from typing import TypedDict, cast

import pytest

from expenses_web.cli import dev


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

    exit_code = dev.main()

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
