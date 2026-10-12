"""Add opt-in local categorization settings, model storage and provenance."""

from alembic import op
import sqlalchemy as sa

revision = "202610111200"
down_revision = "202610031200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "auto_categorization_preferences",
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("threshold", sa.Float(), nullable=False, server_default="0.8"),
        sa.Column(
            "training_status", sa.String(20), nullable=False, server_default="untrained"
        ),
        sa.Column("checked_at", sa.DateTime()),
        sa.Column("trained_at", sa.DateTime()),
        sa.Column("training_fingerprint", sa.String(64)),
        sa.Column("model_json", sa.Text()),
        sa.CheckConstraint("threshold >= 0 AND threshold <= 1"),
    )
    # A nullable column preserves existing categories without backfilling the ledger.
    op.add_column("transactions", sa.Column("auto_category_confidence", sa.Float()))


def downgrade() -> None:
    op.drop_column("transactions", "auto_category_confidence")
    op.drop_table("auto_categorization_preferences")
