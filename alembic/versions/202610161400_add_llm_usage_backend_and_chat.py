"""Record each AI run's backend name and Assistant chat.

Runs before this revision did not store their backend's name, so they take its
kind, the most specific name known for them. OpenRouter credits are US dollars,
so their costs join the other costs in usd, and Assistant turns that older
versions marked failed with stream_cancelled become stopped. The downgrade keeps
both.
"""

from alembic import op
import sqlalchemy as sa

revision = "202610161400"
down_revision = "202610161300"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("llm_jobs", sa.Column("backend", sa.String(32)))
    op.add_column("llm_jobs", sa.Column("chat_id", sa.String(32)))
    op.execute("UPDATE llm_jobs SET backend = llm_provider")
    op.execute(
        "UPDATE llm_jobs SET usage_cost_unit = 'usd' "
        "WHERE usage_cost_unit = 'openrouter_credits'"
    )
    op.execute(
        "UPDATE llm_jobs SET status = 'stopped' WHERE error = 'stream_cancelled'"
    )
    op.create_index("ix_llm_jobs_created", "llm_jobs", ["created_at"])
    op.create_index("ix_llm_jobs_chat", "llm_jobs", ["chat_id"])


def downgrade() -> None:
    op.drop_index("ix_llm_jobs_chat", table_name="llm_jobs")
    op.drop_index("ix_llm_jobs_created", table_name="llm_jobs")
    op.drop_column("llm_jobs", "chat_id")
    op.drop_column("llm_jobs", "backend")
