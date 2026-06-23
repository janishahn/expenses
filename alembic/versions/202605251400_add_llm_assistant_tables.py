"""add llm assistant tables

Revision ID: 202605251400
Revises: 202605171200
Create Date: 2026-05-25 14:00:00.000000

"""

import sqlalchemy as sa
from alembic import op


revision = "202605251400"
down_revision = "202605171200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "llm_jobs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("feature", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("prompt_version", sa.String(length=80), nullable=False),
        sa.Column("model", sa.String(length=80), nullable=False),
        sa.Column("input_hash", sa.String(length=64), nullable=False),
        sa.Column("entity_type", sa.String(length=40), nullable=True),
        sa.Column("entity_id", sa.Integer(), nullable=True),
        sa.Column("input_json", sa.Text(), nullable=True),
        sa.Column("output_json", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("usage_input_tokens", sa.Integer(), nullable=True),
        sa.Column("usage_output_tokens", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_llm_jobs_user_feature_created",
        "llm_jobs",
        ["user_id", "feature", "created_at"],
    )
    op.create_index(
        "ix_llm_jobs_user_status",
        "llm_jobs",
        ["user_id", "status", "created_at"],
    )

    op.create_table(
        "transaction_llm_suggestions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("transaction_id", sa.Integer(), nullable=False),
        sa.Column("job_id", sa.Integer(), nullable=True),
        sa.Column("fingerprint_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=True),
        sa.Column("clean_title", sa.String(length=200), nullable=True),
        sa.Column("tags_json", sa.Text(), nullable=False),
        sa.Column("confidence_bps", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"]),
        sa.ForeignKeyConstraint(["job_id"], ["llm_jobs.id"]),
        sa.ForeignKeyConstraint(
            ["transaction_id"], ["transactions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "transaction_id",
            "fingerprint_hash",
            name="uq_transaction_llm_suggestions_txn_fingerprint",
        ),
    )
    op.create_index(
        "ix_transaction_llm_suggestions_user_txn_status",
        "transaction_llm_suggestions",
        ["user_id", "transaction_id", "status"],
    )

    op.create_table(
        "rule_llm_suggestions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("job_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("match_type", sa.String(length=20), nullable=False),
        sa.Column("match_value", sa.String(length=200), nullable=False),
        sa.Column("transaction_type", sa.String(length=20), nullable=True),
        sa.Column("min_amount_cents", sa.Integer(), nullable=True),
        sa.Column("max_amount_cents", sa.Integer(), nullable=True),
        sa.Column("set_category_id", sa.Integer(), nullable=True),
        sa.Column("add_tags_json", sa.Text(), nullable=False),
        sa.Column("confidence_bps", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("evidence_transaction_ids_json", sa.Text(), nullable=False),
        sa.Column("preview_matches_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["llm_jobs.id"]),
        sa.ForeignKeyConstraint(["set_category_id"], ["categories.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_rule_llm_suggestions_user_status",
        "rule_llm_suggestions",
        ["user_id", "status", "id"],
    )

    op.create_table(
        "transaction_classification_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("transaction_id", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=20), nullable=False),
        sa.Column("source", sa.String(length=40), nullable=False),
        sa.Column("before_category_id", sa.Integer(), nullable=True),
        sa.Column("after_category_id", sa.Integer(), nullable=True),
        sa.Column("before_title", sa.Text(), nullable=True),
        sa.Column("after_title", sa.Text(), nullable=True),
        sa.Column("before_tags_json", sa.Text(), nullable=False),
        sa.Column("after_tags_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["transaction_id"], ["transactions.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_transaction_classification_events_user_txn_created",
        "transaction_classification_events",
        ["user_id", "transaction_id", "created_at"],
    )
    op.create_index(
        "ix_transaction_classification_events_user_source_created",
        "transaction_classification_events",
        ["user_id", "source", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_transaction_classification_events_user_source_created",
        table_name="transaction_classification_events",
    )
    op.drop_index(
        "ix_transaction_classification_events_user_txn_created",
        table_name="transaction_classification_events",
    )
    op.drop_table("transaction_classification_events")
    op.drop_index(
        "ix_rule_llm_suggestions_user_status", table_name="rule_llm_suggestions"
    )
    op.drop_table("rule_llm_suggestions")
    op.drop_index(
        "ix_transaction_llm_suggestions_user_txn_status",
        table_name="transaction_llm_suggestions",
    )
    op.drop_table("transaction_llm_suggestions")
    op.drop_index("ix_llm_jobs_user_status", table_name="llm_jobs")
    op.drop_index("ix_llm_jobs_user_feature_created", table_name="llm_jobs")
    op.drop_table("llm_jobs")
