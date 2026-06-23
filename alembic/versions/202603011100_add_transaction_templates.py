"""add transaction templates

Revision ID: 202603011100
Revises: 202603011000
Create Date: 2026-03-01 11:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "202603011100"
down_revision = "202603011000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "transaction_templates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column(
            "type", sa.Enum("income", "expense", name="transactiontype"), nullable=False
        ),
        sa.Column("category_id", sa.Integer(), nullable=False),
        sa.Column("default_amount_cents", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("tags_json", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "default_amount_cents IS NULL OR default_amount_cents >= 0",
            name="ck_template_amount_nonnegative",
        ),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_template_user_name"),
    )
    op.create_index(
        "ix_template_user_sort",
        "transaction_templates",
        ["user_id", "sort_order", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_template_user_sort", table_name="transaction_templates")
    op.drop_table("transaction_templates")
