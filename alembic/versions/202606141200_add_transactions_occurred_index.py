"""add partial index on transactions (user_id, occurred_at)

Revision ID: 202606141200
Revises: 202605251400
Create Date: 2026-06-14 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op


revision = "202606141200"
down_revision = "202605251400"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_transactions_user_occurred",
        "transactions",
        ["user_id", "occurred_at"],
        unique=False,
        sqlite_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_transactions_user_occurred", table_name="transactions")
