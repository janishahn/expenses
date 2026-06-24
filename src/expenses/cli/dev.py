import os
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

from expenses.cli.migrations import upgrade_head
from expenses.cli.mock_db import db_is_empty, db_path_from_url

BACKEND_PREFIX = "\033[36m[backend]\033[0m"
FRONTEND_PREFIX = "\033[35m[frontend]\033[0m"
DEV_BACKEND_HOST = "127.0.0.1"
DEV_BACKEND_START_PORT = 8000
DEV_BACKEND_PORT_SCAN_LIMIT = 100
DEV_FRONTEND_HOST = "0.0.0.0"
DEV_FRONTEND_PORT = 5173


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


def main() -> int:
    if not _preflight_db():
        return 1

    root_dir = Path(__file__).resolve().parents[3]
    print("Applying database migrations...")
    upgrade_head(root_dir, quiet=True)
    print("Database migrations are up to date.")
    ui_dir = root_dir / "ui"
    try:
        backend_port = _select_backend_port(DEV_BACKEND_HOST, DEV_BACKEND_START_PORT)
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
        DEV_FRONTEND_HOST,
        "--port",
        str(DEV_FRONTEND_PORT),
    ]

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
    finally:
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


if __name__ == "__main__":
    raise SystemExit(main())
