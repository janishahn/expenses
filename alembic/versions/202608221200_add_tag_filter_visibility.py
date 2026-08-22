"""add tag filter visibility

Revision ID: 202608221200
Revises: 202608141000
Create Date: 2026-08-22 12:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "202608221200"
down_revision = "202608141000"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("tags") as batch_op:
        batch_op.add_column(
            sa.Column(
                "is_hidden_from_filters",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("tags") as batch_op:
        batch_op.drop_column("is_hidden_from_filters")
