from __future__ import annotations

from pathlib import Path

import pytest

from expenses.cli import dev


def test_tailnet_port_selection_skips_existing_serve_ports(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(dev, "_used_tailnet_ports", lambda: {443, 8443, 8444})

    assert dev._select_tailnet_port(None) == 8445

    with pytest.raises(RuntimeError, match="already configured"):
        dev._select_tailnet_port(8444)


def test_stop_removes_stale_tailnet_mapping(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    state_path = tmp_path / "dev.json"
    state_path.write_text(
        '{"pid": 4100, "port": 8447, "started_at": "old-process", '
        '"url": "https://host.example.ts.net:8447/", '
        '"target": "http://127.0.0.1:5173"}',
        encoding="utf-8",
    )
    disabled_ports: list[int] = []

    monkeypatch.setattr(dev, "_runtime_paths", lambda _root: (state_path, tmp_path))
    monkeypatch.setattr(dev, "_state_process_is_running", lambda _state: False)
    monkeypatch.setattr(
        dev, "_tailnet_serve_target", lambda _port: "http://127.0.0.1:5173"
    )
    monkeypatch.setattr(
        dev,
        "_disable_tailnet_serve",
        lambda port: disabled_ports.append(port) or True,
    )

    assert dev._stop_tailnet_dev(tmp_path) == 0
    assert disabled_ports == [8447]
    assert not state_path.exists()


def test_stop_retains_state_when_tailnet_cleanup_fails(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    state_path = tmp_path / "dev.json"
    state_path.write_text(
        '{"pid": 4100, "port": 8447, "started_at": "old-process", '
        '"url": "https://host.example.ts.net:8447/", '
        '"target": "http://127.0.0.1:5173"}',
        encoding="utf-8",
    )
    monkeypatch.setattr(dev, "_runtime_paths", lambda _root: (state_path, tmp_path))
    monkeypatch.setattr(dev, "_state_process_is_running", lambda _state: False)
    monkeypatch.setattr(
        dev, "_tailnet_serve_target", lambda _port: "http://127.0.0.1:5173"
    )
    monkeypatch.setattr(dev, "_disable_tailnet_serve", lambda _port: False)

    assert dev._stop_tailnet_dev(tmp_path) == 1
    assert state_path.exists()


def test_cleanup_refuses_to_remove_a_repurposed_tailnet_mapping(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = dev.TailnetState(
        pid=4100,
        port=8447,
        started_at="old-process",
        url="https://host.example.ts.net:8447/",
        target="http://127.0.0.1:5173",
    )
    monkeypatch.setattr(
        dev, "_tailnet_serve_target", lambda _port: "http://127.0.0.1:9000"
    )
    monkeypatch.setattr(
        dev,
        "_disable_tailnet_serve",
        lambda _port: pytest.fail("a repurposed mapping must not be removed"),
    )

    assert dev._disable_owned_tailnet_serve(state) is False


def test_tailnet_serve_target_reads_the_device_proxy_mapping(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        dev,
        "_run_tailscale",
        lambda _command: (
            '{"TCP":{"8443":{"HTTPS":true}},'
            '"Web":{"host.example.ts.net:8443":{"Handlers":'
            '{"/":{"Proxy":"http://127.0.0.1:5173"}}}}}'
        ),
    )

    assert dev._tailnet_serve_target(8443) == "http://127.0.0.1:5173"


def test_runtime_files_are_private_and_logs_rotate(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("XDG_RUNTIME_DIR", str(tmp_path))
    state_path, log_path = dev._runtime_paths(tmp_path / "checkout")
    dev._write_tailnet_state(
        state_path,
        dev.TailnetState(
            pid=1,
            port=8443,
            started_at="now",
            url="https://host.example.ts.net:8443/",
            target="http://127.0.0.1:5173",
        ),
    )
    monkeypatch.setattr(dev, "DEV_LOG_MAX_BYTES", 12)
    log = dev._BoundedLog(log_path)
    log.write("first line\n")
    log.write("second line\n")
    log.flush()
    log.file.close()

    assert state_path.parent.stat().st_mode & 0o777 == 0o700
    assert state_path.stat().st_mode & 0o777 == 0o600
    assert log_path.stat().st_mode & 0o777 == 0o600
    assert log_path.with_suffix(".log.1").exists()
