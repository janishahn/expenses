"""add bank statement reconciliation

Revision ID: 202605061200
Revises: 202604151100
Create Date: 2026-05-06 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op


revision = "202605061200"
down_revision = "202604151100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bank_statement_rows",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=40), nullable=False),
        sa.Column("account_label", sa.String(length=120), nullable=False),
        sa.Column("booking_date", sa.Date(), nullable=False),
        sa.Column("value_date", sa.Date(), nullable=True),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("payee", sa.Text(), nullable=True),
        sa.Column("booking_text", sa.Text(), nullable=True),
        sa.Column("purpose", sa.Text(), nullable=True),
        sa.Column("raw_description", sa.Text(), nullable=False),
        sa.Column("import_hash", sa.String(length=64), nullable=False),
        sa.Column("matched_transaction_id", sa.Integer(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["matched_transaction_id"], ["transactions.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id",
            "source",
            "import_hash",
            name="uq_bank_statement_rows_user_source_hash",
        ),
    )
    op.create_index(
        "ix_bank_statement_rows_user_booking",
        "bank_statement_rows",
        ["user_id", "booking_date", "id"],
        unique=False,
    )
    op.create_index(
        "ix_bank_statement_rows_user_status",
        "bank_statement_rows",
        ["user_id", "reviewed_at", "matched_transaction_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_bank_statement_rows_user_status", table_name="bank_statement_rows"
    )
    op.drop_index(
        "ix_bank_statement_rows_user_booking", table_name="bank_statement_rows"
    )
    op.drop_table("bank_statement_rows")
