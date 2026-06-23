"""add category icon

Revision ID: 202602280900
Revises: 202512181200
Create Date: 2026-02-28 09:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "202602280900"
down_revision = "202512181200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("categories") as batch_op:
        batch_op.add_column(sa.Column("icon", sa.String(50), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("categories") as batch_op:
        batch_op.drop_column("icon")
