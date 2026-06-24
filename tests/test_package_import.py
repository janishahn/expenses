import importlib


def test_expenses_package_imports_app() -> None:
    module = importlib.import_module("expenses.app")

    assert module.app is not None
