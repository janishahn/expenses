from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import TypedDict

from expenses.cli.migrations import upgrade_head
from expenses.cli.mock_db import db_is_empty, db_path_from_url

BACKEND_PREFIX = "\033[36m[backend]\033[0m"
FRONTEND_PREFIX = "\033[35m[frontend]\033[0m"
DEV_BACKEND_HOST = "127.0.0.1"
DEV_BACKEND_START_PORT = 8000
DEV_BACKEND_PORT_SCAN_LIMIT = 100
DEV_FRONTEND_HOST = "0.0.0.0"
DEV_TAILNET_FRONTEND_HOST = "127.0.0.1"
DEV_FRONTEND_PORT = 5173
DEV_TAILNET_HTTPS_PORT = 8443
DEV_TAILNET_PORT_SCAN_LIMIT = 100
DEV_START_TIMEOUT_SECONDS = 15


class TailnetState(TypedDict):
    pid: int
    port: int
    started_at: str
    url: str


def _preflight_db() -> bool:
    """Check for a usable DB. If missing/empty, offer to seed mock data.

    Returns True if startup should proceed, False if it should abort.
    """
    data_dir = Path(os.getenv("EXPENSES_DATA_DIR", "./data")).resolve()
    url = os.getenv("EXPENSES_DATABASE_URL", f"sqlite:///{data_dir}/expenses.db")
    db_path = db_path_from_url(url)
    if db_path is None or not db_is_empty(db_path):
        return True

    print(
        "\033[33mNo local database found (or empty).\033[0m"
        " A database is required to run the app.\n"
    )
    try:
        answer = input("Create mock DB with sample data now? [Y/n] ").strip().lower()
    except EOFError:
        answer = "y"

    if answer not in ("", "y", "yes"):
        print(
            "\nStartup aborted. To continue, run one of:\n"
            "  uv run mock-db             – create DB with sample data\n"
            "  uv run migrations          – create empty DB schema only"
        )
        return False

    from expenses.cli.mock_db import seed

    rc = seed(yes=True)
    if rc != 0:
        print("Failed to create mock DB. Aborting.", file=sys.stderr)
        return False
    print()
    return True


def _stop_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return

    pgid = os.getpgid(process.pid)
    os.killpg(pgid, signal.SIGTERM)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(pgid, signal.SIGKILL)
        process.wait(timeout=5)


def _stream_output(
    process: subprocess.Popen[str], prefix: str, lock: threading.Lock
) -> None:
    if process.stdout is None:
        return
    for line in process.stdout:
        with lock:
            print(f"{prefix} {line.rstrip()}", flush=True)


def _is_port_available(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
        except OSError:
            return False
    return True


def _select_backend_port(
    host: str, start_port: int, scan_limit: int = DEV_BACKEND_PORT_SCAN_LIMIT
) -> int:
    for port in range(start_port, start_port + scan_limit):
        if _is_port_available(host, port):
            return port
    raise RuntimeError(
        f"Could not find a free backend port on {host} in range "
        f"{start_port}-{start_port + scan_limit - 1}."
    )


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the Expenses development servers."
    )
    parser.add_argument(
        "--tailnet",
        action="store_true",
        help="share the dev app privately over HTTPS with Tailscale Serve",
    )
    parser.add_argument(
        "--tailnet-port",
        type=int,
        help="preferred Tailnet HTTPS port (defaults to the first free port from 8443)",
    )
    parser.add_argument(
        "--detach",
        action="store_true",
        help="run the Tailnet dev app in the background",
    )
    parser.add_argument(
        "--stop",
        action="store_true",
        help="stop the Tailnet dev app started from this checkout",
    )
    parser.add_argument(
        "--_detached-child", action="store_true", help=argparse.SUPPRESS
    )
    args = parser.parse_args(argv)

    if args.detach and not args.tailnet:
        parser.error("--detach requires --tailnet")
    if args.tailnet_port is not None and not args.tailnet:
        parser.error("--tailnet-port requires --tailnet")
    if args.detach and args.stop:
        parser.error("--detach and --stop cannot be used together")
    if args.tailnet_port is not None and not 1 <= args.tailnet_port <= 65535:
        parser.error("--tailnet-port must be between 1 and 65535")

    return args


def _runtime_paths(root_dir: Path) -> tuple[Path, Path]:
    digest = hashlib.sha256(str(root_dir).encode()).hexdigest()[:12]
    runtime_dir = Path(os.getenv("XDG_RUNTIME_DIR", tempfile.gettempdir()))
    return (
        runtime_dir / f"expenses-dev-{digest}.json",
        runtime_dir / f"expenses-dev-{digest}.log",
    )


def _read_tailnet_state(path: Path) -> TailnetState | None:
    if not path.exists():
        return None
    raw = json.loads(path.read_text(encoding="utf-8"))
    return TailnetState(
        pid=int(raw["pid"]),
        port=int(raw["port"]),
        started_at=str(raw["started_at"]),
        url=str(raw["url"]),
    )


def _write_tailnet_state(path: Path, state: TailnetState) -> None:
    temporary_path = path.with_suffix(".tmp")
    temporary_path.write_text(json.dumps(state), encoding="utf-8")
    temporary_path.replace(path)


def _process_started_at(pid: int) -> str | None:
    result = subprocess.run(
        ["ps", "-p", str(pid), "-o", "lstart="],
        capture_output=True,
        text=True,
        check=False,
    )
    started_at = result.stdout.strip()
    return started_at if result.returncode == 0 and started_at else None


def _state_process_is_running(state: TailnetState) -> bool:
    return _process_started_at(state["pid"]) == state["started_at"]


def _run_tailscale(command: list[str]) -> str:
    if shutil.which("tailscale") is None:
        raise RuntimeError("tailscale is not installed or is not on PATH.")
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(detail or f"{' '.join(command)} failed.")
    return result.stdout


def _tailnet_dns_name() -> str:
    raw = _run_tailscale(["tailscale", "status", "--json"])
    status = json.loads(raw)
    dns_name = str(status["Self"]["DNSName"]).rstrip(".")
    if not dns_name:
        raise RuntimeError("Tailscale did not report a MagicDNS name for this host.")
    return dns_name


def _used_tailnet_ports() -> set[int]:
    raw = _run_tailscale(["tailscale", "serve", "status", "--json"])
    status = json.loads(raw)
    return {int(port) for port in status.get("TCP", {})}


def _select_tailnet_port(preferred_port: int | None) -> int:
    used_ports = _used_tailnet_ports()
    if preferred_port is not None:
        if preferred_port in used_ports:
            raise RuntimeError(
                f"Tailscale Serve port {preferred_port} is already configured."
            )
        return preferred_port

    for port in range(
        DEV_TAILNET_HTTPS_PORT,
        DEV_TAILNET_HTTPS_PORT + DEV_TAILNET_PORT_SCAN_LIMIT,
    ):
        if port not in used_ports:
            return port
    raise RuntimeError("Could not find a free Tailscale Serve HTTPS port.")


def _tailnet_url(dns_name: str, port: int) -> str:
    suffix = "" if port == 443 else f":{port}"
    return f"https://{dns_name}{suffix}/"


def _enable_tailnet_serve(port: int, frontend_port: int) -> None:
    _run_tailscale(
        [
            "tailscale",
            "serve",
            "--bg",
            "--yes",
            f"--https={port}",
            f"http://127.0.0.1:{frontend_port}",
        ]
    )


def _disable_tailnet_serve(port: int) -> bool:
    try:
        _run_tailscale(["tailscale", "serve", "--yes", f"--https={port}", "off"])
    except RuntimeError as exc:
        print(f"Could not remove Tailscale Serve port {port}: {exc}", file=sys.stderr)
        return False
    return True


def _wait_for_port(
    host: str, port: int, processes: tuple[subprocess.Popen[str], ...]
) -> bool:
    deadline = time.monotonic() + DEV_START_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if any(process.poll() is not None for process in processes):
            return False
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.2)
            if sock.connect_ex((host, port)) == 0:
                return True
        time.sleep(0.1)
    return False


def _remove_owned_state(path: Path, pid: int) -> None:
    state = _read_tailnet_state(path)
    if state is not None and state["pid"] == pid:
        path.unlink(missing_ok=True)


def _stop_tailnet_dev(root_dir: Path) -> int:
    state_path, _ = _runtime_paths(root_dir)
    state = _read_tailnet_state(state_path)
    if state is None:
        print("No Tailnet dev server is recorded for this checkout.")
        return 0

    pid = state["pid"]
    was_running = _state_process_is_running(state)
    if was_running:
        os.kill(pid, signal.SIGTERM)
        deadline = time.monotonic() + DEV_START_TIMEOUT_SECONDS
        while (
            _state_process_is_running(state)
            and state_path.exists()
            and time.monotonic() < deadline
        ):
            time.sleep(0.1)
        if _state_process_is_running(state) and state_path.exists():
            print(f"Dev server process {pid} did not stop.", file=sys.stderr)
            return 1
        if not state_path.exists():
            print(f"Stopped Tailnet dev server at {state['url']}")
            return 0

    success = _disable_tailnet_serve(state["port"])
    state_path.unlink(missing_ok=True)
    if success:
        print(f"Stopped Tailnet dev server at {state['url']}")
        return 0
    return 1


def _launch_detached(args: argparse.Namespace, root_dir: Path) -> int:
    state_path, log_path = _runtime_paths(root_dir)
    state = _read_tailnet_state(state_path)
    if state is not None and _state_process_is_running(state):
        print(f"Tailnet dev server is already running at {state['url']}")
        return 0
    if state is not None:
        _disable_tailnet_serve(state["port"])
        state_path.unlink(missing_ok=True)

    command = [
        sys.executable,
        "-m",
        "expenses.cli.dev",
        "--tailnet",
        "--_detached-child",
    ]
    if args.tailnet_port is not None:
        command.extend(["--tailnet-port", str(args.tailnet_port)])

    env = os.environ.copy()
    src_dir = root_dir / "src"
    python_path = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = (
        f"{src_dir}{os.pathsep}{python_path}" if python_path else str(src_dir)
    )
    with log_path.open("a", encoding="utf-8") as log_file:
        process = subprocess.Popen(
            command,
            cwd=root_dir,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )

    deadline = time.monotonic() + DEV_START_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if process.poll() is not None:
            print(
                f"Tailnet dev server failed to start. See {log_path}",
                file=sys.stderr,
            )
            return 1
        state = _read_tailnet_state(state_path)
        if state is not None and state["pid"] == process.pid:
            print(f"Tailnet dev server running at {state['url']}")
            print(f"Logs: {log_path}")
            print("Stop it with: uv run dev --tailnet --stop")
            return 0
        time.sleep(0.1)

    process.terminate()
    print(f"Timed out starting Tailnet dev server. See {log_path}", file=sys.stderr)
    return 1


def _run_dev(args: argparse.Namespace, root_dir: Path) -> int:
    state_path, _ = _runtime_paths(root_dir)
    tailnet_port: int | None = None
    tailnet_url: str | None = None
    tailnet_enabled = False
    if args.tailnet:
        state = _read_tailnet_state(state_path)
        if state is not None and _state_process_is_running(state):
            print(f"Tailnet dev server is already running at {state['url']}")
            return 1
        if state is not None:
            _disable_tailnet_serve(state["port"])
            state_path.unlink(missing_ok=True)
        try:
            dns_name = _tailnet_dns_name()
            tailnet_port = _select_tailnet_port(args.tailnet_port)
        except (RuntimeError, json.JSONDecodeError, KeyError) as exc:
            print(f"Could not prepare Tailscale Serve: {exc}", file=sys.stderr)
            return 1
        tailnet_url = _tailnet_url(dns_name, tailnet_port)

    if not _preflight_db():
        return 1

    print("Applying database migrations...")
    upgrade_head(root_dir, quiet=True)
    print("Database migrations are up to date.")
    ui_dir = root_dir / "ui"
    frontend_host = DEV_TAILNET_FRONTEND_HOST if args.tailnet else DEV_FRONTEND_HOST
    try:
        backend_port = _select_backend_port(DEV_BACKEND_HOST, DEV_BACKEND_START_PORT)
        frontend_port = (
            _select_backend_port(frontend_host, DEV_FRONTEND_PORT)
            if args.tailnet
            else DEV_FRONTEND_PORT
        )
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    backend_url = f"http://{DEV_BACKEND_HOST}:{backend_port}"

    backend_cmd = [
        sys.executable,
        "-u",
        "-m",
        "uvicorn",
        "expenses.app:app",
        "--reload",
        "--host",
        DEV_BACKEND_HOST,
        "--port",
        str(backend_port),
    ]
    frontend_cmd = [
        "npm",
        "run",
        "dev",
        "--",
        "--host",
        frontend_host,
        "--port",
        str(frontend_port),
    ]
    if args.tailnet:
        frontend_cmd.append("--strictPort")

    backend: subprocess.Popen[str] | None = None
    frontend: subprocess.Popen[str] | None = None
    backend_stream_thread: threading.Thread | None = None
    frontend_stream_thread: threading.Thread | None = None
    stop_requested = threading.Event()
    print_lock = threading.Lock()
    previous_sigint = signal.getsignal(signal.SIGINT)
    previous_sigterm = signal.getsignal(signal.SIGTERM)
    backend_env = os.environ.copy()
    frontend_env = os.environ.copy()
    frontend_env["VITE_API_PROXY_TARGET"] = backend_url
    if args.tailnet:
        frontend_env["__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS"] = dns_name
    src_dir = root_dir / "src"
    python_path = backend_env.get("PYTHONPATH", "")
    if python_path:
        backend_env["PYTHONPATH"] = f"{src_dir}{os.pathsep}{python_path}"
    else:
        backend_env["PYTHONPATH"] = str(src_dir)
    if sys.platform == "darwin" and Path("/opt/homebrew/lib").exists():
        current = backend_env.get("DYLD_FALLBACK_LIBRARY_PATH", "")
        if current:
            parts = [p for p in current.split(":") if p]
            if "/opt/homebrew/lib" not in parts:
                backend_env["DYLD_FALLBACK_LIBRARY_PATH"] = (
                    "/opt/homebrew/lib:" + current
                )
        else:
            home_lib = str(Path.home() / "lib")
            backend_env["DYLD_FALLBACK_LIBRARY_PATH"] = (
                f"{home_lib}:/opt/homebrew/lib:/usr/local/lib:/usr/lib"
            )

    try:
        backend = subprocess.Popen(
            backend_cmd,
            cwd=root_dir,
            env=backend_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            start_new_session=True,
        )
    except FileNotFoundError:
        print("Could not start backend: uvicorn is not available.", file=sys.stderr)
        return 1

    try:
        frontend = subprocess.Popen(
            frontend_cmd,
            cwd=ui_dir,
            env=frontend_env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            start_new_session=True,
        )
    except FileNotFoundError:
        _stop_process(backend)
        print("Could not start frontend: npm is not available.", file=sys.stderr)
        return 1

    def handle_signal(signum: int, _frame: object) -> None:
        if stop_requested.is_set():
            return
        stop_requested.set()
        print(f"\nReceived signal {signum}. Stopping dev servers...")

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    backend_stream_thread = threading.Thread(
        target=_stream_output,
        args=(backend, BACKEND_PREFIX, print_lock),
        daemon=True,
    )
    frontend_stream_thread = threading.Thread(
        target=_stream_output,
        args=(frontend, FRONTEND_PREFIX, print_lock),
        daemon=True,
    )
    backend_stream_thread.start()
    frontend_stream_thread.start()

    exit_code = 0
    try:
        if args.tailnet:
            if not _wait_for_port(frontend_host, frontend_port, (backend, frontend)):
                raise RuntimeError("The frontend did not become ready in time.")
            assert tailnet_port is not None
            assert tailnet_url is not None
            _enable_tailnet_serve(tailnet_port, frontend_port)
            tailnet_enabled = True
            started_at = _process_started_at(os.getpid())
            if started_at is None:
                raise RuntimeError("Could not record the dev server process identity.")
            _write_tailnet_state(
                state_path,
                TailnetState(
                    pid=os.getpid(),
                    port=tailnet_port,
                    started_at=started_at,
                    url=tailnet_url,
                ),
            )
            print(f"\nTailnet URL: {tailnet_url}")
            print("Press Ctrl+C to stop the servers and remove this Tailnet URL.\n")

        while True:
            backend_rc = backend.poll()
            frontend_rc = frontend.poll()

            if stop_requested.is_set():
                break

            if backend_rc is not None:
                print(f"Backend exited with code {backend_rc}. Stopping frontend...")
                exit_code = backend_rc
                break

            if frontend_rc is not None:
                print(f"Frontend exited with code {frontend_rc}. Stopping backend...")
                exit_code = frontend_rc
                break

            time.sleep(0.3)
    except RuntimeError as exc:
        print(f"Could not start Tailnet sharing: {exc}", file=sys.stderr)
        exit_code = 1
    finally:
        tailnet_cleanup_succeeded = True
        if tailnet_enabled and tailnet_port is not None:
            tailnet_cleanup_succeeded = _disable_tailnet_serve(tailnet_port)
            if not tailnet_cleanup_succeeded:
                exit_code = 1
        if tailnet_cleanup_succeeded:
            _remove_owned_state(state_path, os.getpid())

        if frontend is not None:
            _stop_process(frontend)
        if backend is not None:
            _stop_process(backend)

        if frontend_stream_thread is not None:
            frontend_stream_thread.join(timeout=2)
        if backend_stream_thread is not None:
            backend_stream_thread.join(timeout=2)

        signal.signal(signal.SIGINT, previous_sigint)
        signal.signal(signal.SIGTERM, previous_sigterm)

    return exit_code


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(sys.argv[1:] if argv is None else argv)
    root_dir = Path(__file__).resolve().parents[3]
    if args.stop:
        return _stop_tailnet_dev(root_dir)
    if args.detach and not args._detached_child:
        return _launch_detached(args, root_dir)
    return _run_dev(args, root_dir)


if __name__ == "__main__":
    raise SystemExit(main())
