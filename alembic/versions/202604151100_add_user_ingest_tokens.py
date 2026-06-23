"""add user ingest tokens

Revision ID: 202604151100
Revises: 202604121000
Create Date: 2026-04-15 11:00:00.000000

"""

import sqlalchemy as sa
from alembic import op


revision = "202604151100"
down_revision = "202604121000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_ingest_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("token_hint", sa.String(length=16), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_user_ingest_tokens_token_hash"),
        sa.UniqueConstraint("user_id", name="uq_user_ingest_tokens_user_id"),
    )
    op.create_index(
        "ix_user_ingest_tokens_user", "user_ingest_tokens", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_user_ingest_tokens_user", table_name="user_ingest_tokens")
    op.drop_table("user_ingest_tokens")
