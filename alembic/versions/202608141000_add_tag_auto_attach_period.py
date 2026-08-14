"""add tag auto-attach period

Revision ID: 202608141000
Revises: 202606281700
Create Date: 2026-08-14 10:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "202608141000"
down_revision = "202606281700"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("tags") as batch_op:
        batch_op.add_column(
            sa.Column("auto_attach_start_date", sa.Date(), nullable=True)
        )
        batch_op.add_column(sa.Column("auto_attach_end_date", sa.Date(), nullable=True))
        batch_op.create_check_constraint(
            "ck_tag_auto_attach_period",
            "(auto_attach_start_date IS NULL AND auto_attach_end_date IS NULL) OR "
            "(auto_attach_start_date IS NOT NULL AND auto_attach_end_date IS NOT NULL "
            "AND auto_attach_start_date <= auto_attach_end_date)",
        )


def downgrade() -> None:
    with op.batch_alter_table("tags") as batch_op:
        batch_op.drop_constraint("ck_tag_auto_attach_period", type_="check")
        batch_op.drop_column("auto_attach_end_date")
        batch_op.drop_column("auto_attach_start_date")
