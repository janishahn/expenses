import sys
from types import SimpleNamespace
from unittest.mock import patch

from expenses.cli.test import full_tests

FAST_CHECKS = {
    ("ruff", "check", "."),
    (sys.executable, "-m", "pytest", "-n", "auto"),
    ("npm", "run", "lint"),
    ("npm", "run", "build"),
}


def test_failing_check_fails_the_gate_and_skips_browser_suite() -> None:
    def fake_run(command, **_):
        failed = command[:3] == [sys.executable, "-m", "pytest"]
        return SimpleNamespace(returncode=7 if failed else 0, stdout="", stderr="")

    with patch("expenses.cli.test.subprocess.run", side_effect=fake_run) as run:
        assert full_tests() == 7

    commands = {tuple(invocation.args[0]) for invocation in run.call_args_list}
    assert commands == FAST_CHECKS
