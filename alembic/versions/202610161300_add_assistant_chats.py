"""Store Assistant chats and their turns on the server."""

from alembic import op
import sqlalchemy as sa

revision = "202610161300"
down_revision = "202610161200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "assistant_chats",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index(
        "ix_assistant_chats_user_updated",
        "assistant_chats",
        ["user_id", "updated_at"],
    )
    op.create_table(
        "assistant_turns",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "chat_id",
            sa.String(32),
            sa.ForeignKey("assistant_chats.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("user_text", sa.Text(), nullable=False),
        sa.Column("items_json", sa.Text(), nullable=False),
        sa.Column("messages_json", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("chat_id", "seq"),
    )
    op.create_table(
        "assistant_actions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("chat_id", sa.String(32), nullable=False),
        sa.Column("tool_call_id", sa.String(100), nullable=False),
        sa.Column("kind", sa.String(40), nullable=False),
        sa.Column("summary", sa.String(200), nullable=False),
        sa.Column("plan_json", sa.Text(), nullable=False),
        sa.Column("undo_json", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("decided_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("chat_id", "tool_call_id"),
    )
    op.create_index(
        "ix_assistant_actions_user_created",
        "assistant_actions",
        ["user_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_assistant_actions_user_created", table_name="assistant_actions")
    op.drop_table("assistant_actions")
    op.drop_table("assistant_turns")
    op.drop_index("ix_assistant_chats_user_updated", table_name="assistant_chats")
    op.drop_table("assistant_chats")
