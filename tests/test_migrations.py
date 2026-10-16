import sqlite3
from datetime import datetime
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config

from expenses.core.config import get_settings


def test_auto_categorization_migration_preserves_ledger_and_starts_opted_out(
    monkeypatch, tmp_path: Path
) -> None:
    db_path = tmp_path / "migration.db"
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("EXPENSES_DATABASE_URL", f"sqlite:///{db_path}")
    get_settings.cache_clear()
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "202610031200")
    with sqlite3.connect(db_path) as conn:
        conn.execute("""
            INSERT INTO users (id, username, password_hash, is_admin, created_at, updated_at)
            VALUES (1, 'test', 'unused', 0, '2026-10-01', '2026-10-01')
        """)
        conn.execute("""
            INSERT INTO categories (id, user_id, name, type, "order", created_at, updated_at)
            VALUES (1, 1, 'Bakery', 'expense', 0, '2026-10-01', '2026-10-01')
        """)
        conn.execute("""
            INSERT INTO transactions (id, user_id, date, occurred_at, type,
                is_reimbursement, amount_cents, category_id, title, created_at, updated_at)
            VALUES (1, 1, '2026-10-01', '2026-10-01 12:00:00', 'expense',
                0, 550, 1, 'Corner bakery', '2026-10-01', '2026-10-01')
        """)
    command.upgrade(cfg, "head")
    command.upgrade(cfg, "head")
    with sqlite3.connect(db_path) as conn:
        assert conn.execute(
            "SELECT category_id, amount_cents, auto_category_confidence FROM transactions"
        ).fetchone() == (1, 550, None)
        assert conn.execute(
            "SELECT COUNT(*) FROM auto_categorization_preferences"
        ).fetchone() == (0,)
        conn.execute("INSERT INTO auto_categorization_preferences (user_id) VALUES (1)")
        assert conn.execute(
            "SELECT enabled, threshold, training_status FROM auto_categorization_preferences"
        ).fetchone() == (0, 0.8, "untrained")
    command.downgrade(cfg, "202610031200")
    with sqlite3.connect(db_path) as conn:
        assert conn.execute(
            "SELECT category_id, amount_cents FROM transactions"
        ).fetchone() == (1, 550)
    get_settings.cache_clear()


def test_tag_auto_attach_migration_preserves_tags_and_enforces_complete_periods(
    monkeypatch, tmp_path: Path
) -> None:
    db_path = tmp_path / "migration.db"
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("EXPENSES_DATABASE_URL", f"sqlite:///{db_path}")
    get_settings.cache_clear()

    cfg = Config("alembic.ini")
    command.upgrade(cfg, "202606281700")

    now = datetime(2026, 8, 14, 12, 0, 0).isoformat(sep=" ")
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO tags (
                id, user_id, name, color, is_hidden_from_budget, archived_at,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (1, 1, "Vacation", None, 0, None, now, now),
        )
        conn.commit()

    command.upgrade(cfg, "head")

    with sqlite3.connect(db_path) as conn:
        columns = conn.execute("PRAGMA table_info('tags')").fetchall()
        row = conn.execute(
            "SELECT name, auto_attach_start_date, auto_attach_end_date FROM tags"
        ).fetchone()
        assert "auto_attach_start_date" in [column[1] for column in columns]
        assert "auto_attach_end_date" in [column[1] for column in columns]
        assert row == ("Vacation", None, None)
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "UPDATE tags SET auto_attach_start_date = ? WHERE id = 1",
                ("2026-08-14",),
            )

    get_settings.cache_clear()


def test_tag_filter_visibility_migration_defaults_existing_tags_to_visible(
    monkeypatch, tmp_path: Path
) -> None:
    db_path = tmp_path / "migration.db"
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("EXPENSES_DATABASE_URL", f"sqlite:///{db_path}")
    get_settings.cache_clear()

    cfg = Config("alembic.ini")
    command.upgrade(cfg, "202608141000")

    now = datetime(2026, 8, 22, 12, 0, 0).isoformat(sep=" ")
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO tags (
                id, user_id, name, color, is_hidden_from_budget, archived_at,
                auto_attach_start_date, auto_attach_end_date, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (1, 1, "Vacation", None, 0, None, None, None, now, now),
        )
        conn.commit()

    command.upgrade(cfg, "head")

    with sqlite3.connect(db_path) as conn:
        columns = conn.execute("PRAGMA table_info('tags')").fetchall()
        row = conn.execute(
            "SELECT name, is_hidden_from_filters FROM tags WHERE id = 1"
        ).fetchone()
        filter_column = next(
            column for column in columns if column[1] == "is_hidden_from_filters"
        )
        assert filter_column[3] == 1
        assert row == ("Vacation", 0)

    get_settings.cache_clear()


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
        "assistant_chat_days",
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


def test_bank_row_resolution_and_suggestion_dismissal_migrations_backfill_and_roll_back(
    monkeypatch, tmp_path: Path
) -> None:
    db_path = tmp_path / "migration.db"
    monkeypatch.setenv("EXPENSES_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("EXPENSES_DATABASE_URL", f"sqlite:///{db_path}")
    get_settings.cache_clear()
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "202610111200")
    with sqlite3.connect(db_path) as conn:
        conn.execute("""
            INSERT INTO users (id, username, password_hash, is_admin, created_at, updated_at)
            VALUES (1, 'test', 'unused', 0, '2026-10-01', '2026-10-01')
        """)
        conn.execute("""
            INSERT INTO categories (id, user_id, name, type, "order", created_at, updated_at)
            VALUES (1, 1, 'Bakery', 'expense', 0, '2026-10-01', '2026-10-01')
        """)
        conn.execute("""
            INSERT INTO transactions (id, user_id, date, occurred_at, type,
                is_reimbursement, amount_cents, category_id, title, created_at, updated_at)
            VALUES (1, 1, '2026-10-01', '2026-10-01 12:00:00', 'expense',
                0, 550, 1, 'Corner bakery', '2026-10-01', '2026-10-01')
        """)
        for row_id, matched, reviewed in (
            (1, 1, None),
            (2, None, "2026-10-05 09:00:00"),
            (3, None, None),
        ):
            conn.execute(
                """
                INSERT INTO bank_statement_rows (id, user_id, source, account_label,
                    booking_date, amount_cents, currency, raw_description, import_hash,
                    matched_transaction_id, reviewed_at, created_at, updated_at)
                VALUES (?, 1, 'csv', 'Main', '2026-10-01', -550, 'EUR', 'row', ?,
                    ?, ?, '2026-10-01', '2026-10-02 08:00:00')
                """,
                (row_id, f"hash{row_id}", matched, reviewed),
            )

    command.upgrade(cfg, "head")

    with sqlite3.connect(db_path) as conn:
        assert conn.execute(
            "SELECT id, resolution, resolved_at, ignore_reason "
            "FROM bank_statement_rows ORDER BY id"
        ).fetchall() == [
            (1, "matched", "2026-10-02 08:00:00", None),
            (2, "ignored", "2026-10-05 09:00:00", None),
            (3, None, None, None),
        ]
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("""
            INSERT INTO categories (id, user_id, name, type, "order", created_at, updated_at)
            VALUES (2, 1, 'Other', 'expense', 0, '2026-10-01', '2026-10-01')
        """)
        conn.execute(
            "UPDATE transactions SET category_suggestion_dismissed_id = 2 WHERE id = 1"
        )
        conn.execute("DELETE FROM categories WHERE id = 2")
        assert conn.execute(
            "SELECT category_suggestion_dismissed_id FROM transactions"
        ).fetchone() == (None,)

    command.downgrade(cfg, "202610111200")
    with sqlite3.connect(db_path) as conn:
        bank_columns = {
            row[1] for row in conn.execute("PRAGMA table_info(bank_statement_rows)")
        }
        transaction_columns = {
            row[1] for row in conn.execute("PRAGMA table_info(transactions)")
        }
        assert not {"resolution", "resolved_at", "ignore_reason"} & bank_columns
        assert "category_suggestion_dismissed_id" not in transaction_columns
        assert conn.execute("SELECT COUNT(*) FROM bank_statement_rows").fetchone() == (
            3,
        )

    command.upgrade(cfg, "head")
    get_settings.cache_clear()
