"""Add per-user AI preferences and temporary ChatGPT pairing sessions."""

from alembic import op
import sqlalchemy as sa

revision = "202610031200"
down_revision = "202608221200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_feature_preferences",
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("feature", sa.String(40), primary_key=True),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("model", sa.String(200), nullable=False),
        sa.Column("reasoning_effort", sa.String(20), nullable=False),
    )
    op.create_table(
        "chatgpt_pairings",
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("secret_hash", sa.String(64), unique=True, nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("encrypted_flow", sa.Text()),
    )


def downgrade() -> None:
    op.drop_table("chatgpt_pairings")
    op.drop_table("ai_feature_preferences")
