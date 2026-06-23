"""add durable purchases

Revision ID: 202603011110
Revises: 202603011100
Create Date: 2026-03-01 11:10:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "202603011110"
down_revision = "202603011100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "durable_purchases",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("transaction_id", sa.Integer(), nullable=False),
        sa.Column("expected_lifespan_days", sa.Integer(), nullable=False),
        sa.Column("acquired_on", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "expected_lifespan_days > 0", name="ck_durable_lifespan_positive"
        ),
        sa.ForeignKeyConstraint(
            ["transaction_id"], ["transactions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("transaction_id", name="uq_durable_purchase_transaction"),
    )
    op.create_index(
        "ix_durable_purchase_user",
        "durable_purchases",
        ["user_id", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_durable_purchase_user", table_name="durable_purchases")
    op.drop_table("durable_purchases")
