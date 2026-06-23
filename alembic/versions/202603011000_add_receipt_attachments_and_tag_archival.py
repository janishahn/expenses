"""add receipt attachments and tag archival

Revision ID: 202603011000
Revises: 202602280900
Create Date: 2026-03-01 10:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "202603011000"
down_revision = "202602280900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("tags") as batch_op:
        batch_op.add_column(sa.Column("archived_at", sa.DateTime(), nullable=True))
    op.create_index(
        "ix_tags_user_archived_at",
        "tags",
        ["user_id", "archived_at"],
        unique=False,
    )

    op.create_table(
        "receipt_attachments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("transaction_id", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(length=255), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256_hex", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "size_bytes > 0", name="ck_receipt_attachment_size_positive"
        ),
        sa.ForeignKeyConstraint(
            ["transaction_id"],
            ["transactions.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_key", name="uq_receipt_attachment_storage_key"),
    )
    op.create_index(
        "ix_receipt_attachment_user_txn",
        "receipt_attachments",
        ["user_id", "transaction_id"],
        unique=False,
    )
    op.create_index(
        "ix_receipt_attachment_user_created",
        "receipt_attachments",
        ["user_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_receipt_attachment_user_created", table_name="receipt_attachments"
    )
    op.drop_index("ix_receipt_attachment_user_txn", table_name="receipt_attachments")
    op.drop_table("receipt_attachments")

    op.drop_index("ix_tags_user_archived_at", table_name="tags")
    with op.batch_alter_table("tags") as batch_op:
        batch_op.drop_column("archived_at")
