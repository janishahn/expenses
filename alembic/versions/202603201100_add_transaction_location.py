"""add transaction capture location

Revision ID: 202603201100
Revises: 202603081100
Create Date: 2026-03-20 11:00:00.000000

"""

import sqlalchemy as sa
from alembic import op


revision = "202603201100"
down_revision = "202603081100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("transactions") as batch_op:
        batch_op.add_column(sa.Column("latitude", sa.Numeric(9, 6), nullable=True))
        batch_op.add_column(sa.Column("longitude", sa.Numeric(9, 6), nullable=True))
        batch_op.create_check_constraint(
            "ck_transactions_location_pair",
            "(latitude IS NULL AND longitude IS NULL) "
            "OR (latitude IS NOT NULL AND longitude IS NOT NULL)",
        )
        batch_op.create_check_constraint(
            "ck_transactions_latitude_range",
            "latitude IS NULL OR (latitude >= -90 AND latitude <= 90)",
        )
        batch_op.create_check_constraint(
            "ck_transactions_longitude_range",
            "longitude IS NULL OR (longitude >= -180 AND longitude <= 180)",
        )


def downgrade() -> None:
    with op.batch_alter_table("transactions") as batch_op:
        batch_op.drop_constraint("ck_transactions_longitude_range", type_="check")
        batch_op.drop_constraint("ck_transactions_latitude_range", type_="check")
        batch_op.drop_constraint("ck_transactions_location_pair", type_="check")
        batch_op.drop_column("longitude")
        batch_op.drop_column("latitude")
