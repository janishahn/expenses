"""Remember a dismissed local category suggestion per transaction."""

from alembic import op

revision = "202610131000"
down_revision = "202610111200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Alembic cannot emit an FK constraint through ALTER on SQLite, but SQLite
    # accepts an inline REFERENCES on ADD COLUMN when the default is NULL.
    op.execute(
        "ALTER TABLE transactions ADD COLUMN category_suggestion_dismissed_id "
        "INTEGER REFERENCES categories (id) ON DELETE SET NULL"
    )


def downgrade() -> None:
    # SQLite cannot drop a column that is part of a foreign key.
    with op.batch_alter_table("transactions") as batch_op:
        batch_op.drop_column("category_suggestion_dismissed_id")
