"""Let a durable purchase end, such as when it is sold or breaks.

Items tracked before this revision have no end date and stay in use.
"""

from alembic import op
import sqlalchemy as sa

revision = "202610281200"
down_revision = "202610181500"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("durable_purchases", sa.Column("ended_on", sa.Date()))


def downgrade() -> None:
    op.drop_column("durable_purchases", "ended_on")
