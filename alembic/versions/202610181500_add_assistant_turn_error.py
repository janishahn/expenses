"""Keep why an Assistant turn failed, so a reopened chat shows the same reason.

Turns saved before this revision have no reason; clients show a generic one.
"""

from alembic import op
import sqlalchemy as sa

revision = "202610181500"
down_revision = "202610161400"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("assistant_turns", sa.Column("error_message", sa.Text()))


def downgrade() -> None:
    op.drop_column("assistant_turns", "error_message")
