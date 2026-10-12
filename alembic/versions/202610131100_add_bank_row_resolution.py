"""Record how each bank statement row was resolved."""

from alembic import op
import sqlalchemy as sa

revision = "202610131100"
down_revision = "202610131000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("bank_statement_rows", sa.Column("resolution", sa.String(20)))
    op.add_column("bank_statement_rows", sa.Column("resolved_at", sa.DateTime()))
    op.add_column("bank_statement_rows", sa.Column("ignore_reason", sa.String(200)))
    # Rows created from a statement before this migration cannot be told apart
    # from matched ones, so they backfill as "matched".
    op.execute(
        "UPDATE bank_statement_rows SET resolution = 'ignored', "
        "resolved_at = reviewed_at WHERE reviewed_at IS NOT NULL"
    )
    op.execute(
        "UPDATE bank_statement_rows SET resolution = 'matched', "
        "resolved_at = updated_at "
        "WHERE resolution IS NULL AND matched_transaction_id IS NOT NULL"
    )
    op.create_index(
        "ix_bank_statement_rows_user_resolution",
        "bank_statement_rows",
        ["user_id", "resolution", "resolved_at"],
    )
    op.create_index(
        "ix_bank_statement_rows_matched_transaction",
        "bank_statement_rows",
        ["matched_transaction_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_bank_statement_rows_matched_transaction", table_name="bank_statement_rows"
    )
    op.drop_index(
        "ix_bank_statement_rows_user_resolution", table_name="bank_statement_rows"
    )
    op.drop_column("bank_statement_rows", "ignore_reason")
    op.drop_column("bank_statement_rows", "resolved_at")
    op.drop_column("bank_statement_rows", "resolution")
