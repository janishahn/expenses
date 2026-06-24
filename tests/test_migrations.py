import sqlite3
from datetime import datetime
from pathlib import Path

from alembic import command
from alembic.config import Config

from expenses.core.config import get_settings


def test_transaction_title_migration_backfills_legacy_null_and_blank_notes(
    monkeypatch, tmp_path: Path
) -> None:
    db_path = tmp_path / "migration.db"
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("EXPENSES_DATABASE_URL", f"sqlite:///{db_path}")
    get_settings.cache_clear()

    cfg = Config("alembic.ini")
    command.upgrade(cfg, "202603011120")

    now = datetime(2026, 3, 8, 12, 0, 0).isoformat(sep=" ")
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO categories (
                id, user_id, name, type, color, icon, "order", archived_at,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (1, 1, "Groceries", "expense", None, None, 0, None, now, now),
        )
        conn.execute(
            """
            INSERT INTO transactions (
                id, user_id, date, occurred_at, type, is_reimbursement,
                amount_cents, source_currency_code, source_amount_cents,
                fx_rate_micros, fx_rate_date, fx_provider, fx_fetched_at,
                category_id, note, deleted_at, origin_rule_id, occurrence_date,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                1,
                1,
                "2026-03-08",
                now,
                "expense",
                0,
                1_250,
                None,
                None,
                None,
                None,
                None,
                None,
                1,
                None,
                None,
                None,
                None,
                now,
                now,
            ),
        )
        conn.execute(
            """
            INSERT INTO transactions (
                id, user_id, date, occurred_at, type, is_reimbursement,
                amount_cents, source_currency_code, source_amount_cents,
                fx_rate_micros, fx_rate_date, fx_provider, fx_fetched_at,
                category_id, note, deleted_at, origin_rule_id, occurrence_date,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                2,
                1,
                "2026-03-09",
                now,
                "expense",
                0,
                2_500,
                None,
                None,
                None,
                None,
                None,
                None,
                1,
                "   ",
                None,
                None,
                None,
                now,
                now,
            ),
        )
        conn.commit()

    command.upgrade(cfg, "head")

    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            "SELECT id, title, description FROM transactions ORDER BY id"
        ).fetchall()

    assert rows == [
        (1, "Untitled transaction", None),
        (2, "Untitled transaction", None),
    ]
    get_settings.cache_clear()


def test_transaction_location_migration_adds_nullable_columns(
    monkeypatch, tmp_path: Path
) -> None:
    db_path = tmp_path / "migration.db"
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("EXPENSES_DATABASE_URL", f"sqlite:///{db_path}")
    get_settings.cache_clear()

    cfg = Config("alembic.ini")
    command.upgrade(cfg, "202603081100")

    now = datetime(2026, 3, 20, 12, 0, 0).isoformat(sep=" ")
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO categories (
                id, user_id, name, type, color, icon, "order", archived_at,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (1, 1, "Food", "expense", None, None, 0, None, now, now),
        )
        conn.execute(
            """
            INSERT INTO transactions (
                id, user_id, date, occurred_at, type, is_reimbursement,
                amount_cents, source_currency_code, source_amount_cents,
                fx_rate_micros, fx_rate_date, fx_provider, fx_fetched_at,
                category_id, title, description, deleted_at, origin_rule_id,
                occurrence_date, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                1,
                1,
                "2026-03-20",
                now,
                "expense",
                0,
                1_800,
                None,
                None,
                None,
                None,
                None,
                None,
                1,
                "Groceries",
                None,
                None,
                None,
                None,
                now,
                now,
            ),
        )
        conn.commit()

    command.upgrade(cfg, "head")

    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            "SELECT id, latitude, longitude FROM transactions ORDER BY id"
        ).fetchall()

    assert rows == [(1, None, None)]
    get_settings.cache_clear()


def test_fx_quotes_cache_migration_adds_table(monkeypatch, tmp_path: Path) -> None:
    db_path = tmp_path / "migration.db"
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("EXPENSES_DATABASE_URL", f"sqlite:///{db_path}")
    get_settings.cache_clear()

    cfg = Config("alembic.ini")
    command.upgrade(cfg, "202603201100")
    command.upgrade(cfg, "head")

    with sqlite3.connect(db_path) as conn:
        columns = conn.execute("PRAGMA table_info('fx_quotes')").fetchall()
        indexes = conn.execute("PRAGMA index_list('fx_quotes')").fetchall()

    column_names = [row[1] for row in columns]
    assert column_names == [
        "id",
        "base_currency_code",
        "quote_currency_code",
        "lookup_date",
        "effective_date",
        "rate_micros",
        "provider",
        "fetched_at",
    ]
    assert any(row[1] == "ix_fx_quotes_pair_lookup_date" for row in indexes)
    get_settings.cache_clear()


def test_auth_tables_migration_adds_users_and_auth_sessions(
    monkeypatch, tmp_path: Path
) -> None:
    db_path = tmp_path / "migration.db"
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("EXPENSES_DATABASE_URL", f"sqlite:///{db_path}")
    get_settings.cache_clear()

    cfg = Config("alembic.ini")
    command.upgrade(cfg, "202603251200")
    command.upgrade(cfg, "head")

    with sqlite3.connect(db_path) as conn:
        user_columns = conn.execute("PRAGMA table_info('users')").fetchall()
        session_columns = conn.execute("PRAGMA table_info('auth_sessions')").fetchall()
        session_indexes = conn.execute("PRAGMA index_list('auth_sessions')").fetchall()

    assert [row[1] for row in user_columns] == [
        "id",
        "username",
        "password_hash",
        "is_admin",
        "created_at",
        "updated_at",
    ]
    assert [row[1] for row in session_columns] == [
        "id",
        "user_id",
        "token_hash",
        "csrf_secret",
        "expires_at",
        "revoked_at",
        "elevated_until",
        "created_at",
        "updated_at",
    ]
    session_index_names = {row[1] for row in session_indexes}
    assert "ix_auth_sessions_user" in session_index_names
    assert "ix_auth_sessions_user_active" in session_index_names
    get_settings.cache_clear()


def test_mobile_auth_sessions_migration_adds_device_session_table(
    monkeypatch, tmp_path: Path
) -> None:
    db_path = tmp_path / "migration.db"
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("EXPENSES_DATABASE_URL", f"sqlite:///{db_path}")
    get_settings.cache_clear()

    cfg = Config("alembic.ini")
    command.upgrade(cfg, "202605061200")
    command.upgrade(cfg, "head")

    with sqlite3.connect(db_path) as conn:
        columns = conn.execute("PRAGMA table_info('mobile_auth_sessions')").fetchall()
        indexes = conn.execute("PRAGMA index_list('mobile_auth_sessions')").fetchall()

    assert [row[1] for row in columns] == [
        "id",
        "user_id",
        "token_hash",
        "device_id",
        "device_name",
        "expires_at",
        "last_used_at",
        "revoked_at",
        "elevated_until",
        "created_at",
        "updated_at",
    ]
    index_names = {row[1] for row in indexes}
    assert "ix_mobile_auth_sessions_user" in index_names
    assert "ix_mobile_auth_sessions_user_active" in index_names
    get_settings.cache_clear()
