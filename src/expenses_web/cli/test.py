import os
import subprocess
import sys
from pathlib import Path


def main() -> int:
    root_dir = Path(__file__).resolve().parents[3]
    env = dict(**os.environ)
    src_dir = root_dir / "src"
    python_path = env.get("PYTHONPATH", "")
    if python_path:
        env["PYTHONPATH"] = f"{src_dir}{os.pathsep}{python_path}"
    else:
        env["PYTHONPATH"] = str(src_dir)

    commands = [
        (["ruff", "check", "."], root_dir),
        ([sys.executable, "-m", "pytest"], root_dir),
        (["npm", "run", "lint"], root_dir / "ui"),
        (["npm", "run", "test"], root_dir / "ui"),
    ]
    for command, cwd in commands:
        result = subprocess.run(command, cwd=cwd, env=env)
        if result.returncode != 0:
            return result.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
