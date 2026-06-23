"""add mobile auth sessions

Revision ID: 202605171200
Revises: 202605061200
Create Date: 2026-05-17 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op


revision = "202605171200"
down_revision = "202605061200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mobile_auth_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("device_id", sa.String(length=120), nullable=False),
        sa.Column("device_name", sa.String(length=120), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("elevated_until", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_mobile_auth_sessions_token_hash"),
        sa.UniqueConstraint(
            "user_id", "device_id", name="uq_mobile_auth_sessions_user_device"
        ),
    )
    op.create_index(
        "ix_mobile_auth_sessions_user",
        "mobile_auth_sessions",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_mobile_auth_sessions_user_active",
        "mobile_auth_sessions",
        ["user_id", "revoked_at", "expires_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_mobile_auth_sessions_user_active", table_name="mobile_auth_sessions"
    )
    op.drop_index("ix_mobile_auth_sessions_user", table_name="mobile_auth_sessions")
    op.drop_table("mobile_auth_sessions")
