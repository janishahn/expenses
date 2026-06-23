from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from expenses_web.cli import migrations


def test_upgrade_head_uses_current_database_url_and_quiet_logging(
    monkeypatch,
    tmp_path: Path,
) -> None:
    captured: dict[str, object] = {}
    (tmp_path / "alembic.ini").write_text("[alembic]\n", encoding="utf-8")

    monkeypatch.setattr(
        migrations,
        "get_settings",
        lambda: SimpleNamespace(database_url="sqlite:////tmp/expenses-test.db"),
    )

    def fake_upgrade(config, revision: str) -> None:
        captured["config"] = config
        captured["revision"] = revision

    monkeypatch.setattr(migrations.alembic_command, "upgrade", fake_upgrade)

    migrations.upgrade_head(tmp_path, quiet=True)

    config = captured["config"]
    assert captured["revision"] == "head"
    assert config.config_file_name == str(tmp_path / "alembic.ini")
    assert config.get_main_option("sqlalchemy.url") == "sqlite:////tmp/expenses-test.db"
    assert config.attributes["configure_logger"] is False


def test_main_runs_quiet_upgrade_and_prints_concise_status(
    monkeypatch,
    capsys,
) -> None:
    calls: list[bool] = []

    monkeypatch.setattr(
        migrations,
        "upgrade_head",
        lambda root_dir=None, *, quiet=False: calls.append(quiet),
    )

    exit_code = migrations.main()

    captured = capsys.readouterr()
    assert exit_code == 0
    assert calls == [True]
    assert captured.out.splitlines() == [
        "Applying database migrations...",
        "Database migrations are up to date.",
    ]
