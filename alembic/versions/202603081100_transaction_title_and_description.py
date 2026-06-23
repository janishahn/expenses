"""rename transaction note to title and add description

Revision ID: 202603081100
Revises: 202603011120
Create Date: 2026-03-08 11:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


revision = "202603081100"
down_revision = "202603011120"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("transactions") as batch_op:
        batch_op.alter_column("note", new_column_name="title")
        batch_op.add_column(sa.Column("description", sa.Text(), nullable=True))
    op.execute(
        "UPDATE transactions "
        "SET title = 'Untitled transaction' "
        "WHERE title IS NULL OR trim(title) = ''"
    )

    with op.batch_alter_table("transaction_templates") as batch_op:
        batch_op.alter_column("note", new_column_name="title")


def downgrade() -> None:
    with op.batch_alter_table("transaction_templates") as batch_op:
        batch_op.alter_column("title", new_column_name="note")

    with op.batch_alter_table("transactions") as batch_op:
        batch_op.drop_column("description")
        batch_op.alter_column("title", new_column_name="note")
