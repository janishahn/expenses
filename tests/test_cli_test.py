import sys
from types import SimpleNamespace
from unittest.mock import patch

from expenses.cli.test import fast_tests, full_tests

FAST_CHECKS = {
    ("ruff", "check", "."),
    (sys.executable, "-m", "pytest", "-n", "auto"),
    ("npm", "run", "lint"),
    ("npm", "run", "build"),
}
BROWSER_SUITE = ("npm", "run", "test:e2e")


def test_fast_tests_runs_all_checks_without_browser_suite() -> None:
    with patch("expenses.cli.test.subprocess.run") as run:
        run.return_value = SimpleNamespace(returncode=0, stdout="", stderr="")

        assert fast_tests() == 0

    assert {
        tuple(invocation.args[0]) for invocation in run.call_args_list
    } == FAST_CHECKS


def test_full_tests_adds_single_browser_suite_invocation() -> None:
    with patch("expenses.cli.test.subprocess.run") as run:
        run.return_value = SimpleNamespace(returncode=0, stdout="", stderr="")

        assert full_tests() == 0

    commands = [tuple(invocation.args[0]) for invocation in run.call_args_list]
    assert set(commands) == FAST_CHECKS | {BROWSER_SUITE}
    assert commands.count(BROWSER_SUITE) == 1
    assert commands[-1] == BROWSER_SUITE


def test_failing_check_fails_the_gate_and_skips_browser_suite() -> None:
    def fake_run(command, **_):
        failed = command[:3] == [sys.executable, "-m", "pytest"]
        return SimpleNamespace(returncode=7 if failed else 0, stdout="", stderr="")

    with patch("expenses.cli.test.subprocess.run", side_effect=fake_run) as run:
        assert full_tests() == 7

    commands = {tuple(invocation.args[0]) for invocation in run.call_args_list}
    assert commands == FAST_CHECKS
