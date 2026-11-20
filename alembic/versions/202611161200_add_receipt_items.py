"""Read receipt images into line items.

Attachments uploaded before this revision stay unread until read on request.
"""

import sqlalchemy as sa

from alembic import op

revision = "202611161200"
down_revision = "202610281200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("receipt_attachments") as batch_op:
        batch_op.add_column(sa.Column("items_status", sa.String(12)))
        batch_op.add_column(sa.Column("items_error", sa.Text()))
    op.create_table(
        "receipt_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "attachment_id",
            sa.Integer(),
            sa.ForeignKey("receipt_attachments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("product", sa.String(80), nullable=False),
        sa.Column(
            "product_named_by_user",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("quantity", sa.Numeric(10, 3)),
        sa.Column("unit", sa.String(10)),
        sa.Column("unit_price_cents", sa.Integer()),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "kind in ('item', 'discount', 'deposit')", name="ck_receipt_item_kind"
        ),
    )
    op.create_index("ix_receipt_items_attachment", "receipt_items", ["attachment_id"])
    op.create_index(
        "ix_receipt_items_user_product", "receipt_items", ["user_id", "product"]
    )
    op.create_index(
        "ix_receipt_items_user_label", "receipt_items", ["user_id", "label"]
    )


def downgrade() -> None:
    op.drop_table("receipt_items")
    with op.batch_alter_table("receipt_attachments") as batch_op:
        batch_op.drop_column("items_error")
        batch_op.drop_column("items_status")
