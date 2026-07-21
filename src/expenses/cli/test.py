import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


def _run_tests(include_e2e: bool) -> int:
    root_dir = Path(__file__).resolve().parents[3]
    env = dict(**os.environ)
    src_dir = root_dir / "src"
    python_path = env.get("PYTHONPATH", "")
    if python_path:
        env["PYTHONPATH"] = f"{src_dir}{os.pathsep}{python_path}"
    else:
        env["PYTHONPATH"] = str(src_dir)

    checks = [
        ("ruff", ["ruff", "check", "."], root_dir),
        ("pytest", [sys.executable, "-m", "pytest", "-n", "auto"], root_dir),
        ("frontend lint", ["npm", "run", "lint"], root_dir / "ui"),
        ("frontend build", ["npm", "run", "build"], root_dir / "ui"),
    ]

    def run_check(command: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True)

    exit_code = 0
    with ThreadPoolExecutor(max_workers=len(checks)) as executor:
        futures = [
            (name, executor.submit(run_check, command, cwd))
            for name, command, cwd in checks
        ]
        for name, future in futures:
            result = future.result()
            print(f"=== {name} (exit {result.returncode})", flush=True)
            if result.stdout:
                print(result.stdout, end="", flush=True)
            if result.stderr:
                print(result.stderr, end="", file=sys.stderr, flush=True)
            if exit_code == 0 and result.returncode != 0:
                exit_code = result.returncode
    if exit_code != 0:
        return exit_code

    if include_e2e:
        result = subprocess.run(
            ["npm", "run", "test:e2e"], cwd=root_dir / "ui", env=env
        )
        return result.returncode
    return 0


def fast_tests() -> int:
    return _run_tests(include_e2e=False)


def full_tests() -> int:
    return _run_tests(include_e2e=True)


if __name__ == "__main__":
    raise SystemExit(fast_tests())
