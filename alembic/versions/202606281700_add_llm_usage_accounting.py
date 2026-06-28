"""add llm usage accounting

Revision ID: 202606281700
Revises: 202606141200
Create Date: 2026-06-28 17:00:00.000000

"""

import sqlalchemy as sa
from alembic import op


revision = "202606281700"
down_revision = "202606141200"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("llm_jobs", sa.Column("usage_total_tokens", sa.Integer()))
    op.add_column("llm_jobs", sa.Column("usage_cached_input_tokens", sa.Integer()))
    op.add_column("llm_jobs", sa.Column("usage_cache_write_tokens", sa.Integer()))
    op.add_column("llm_jobs", sa.Column("usage_reasoning_tokens", sa.Integer()))
    op.add_column("llm_jobs", sa.Column("usage_request_count", sa.Integer()))
    op.add_column("llm_jobs", sa.Column("usage_tool_call_count", sa.Integer()))
    op.add_column("llm_jobs", sa.Column("usage_cost_decimal", sa.String(length=80)))
    op.add_column("llm_jobs", sa.Column("usage_cost_unit", sa.String(length=40)))
    op.add_column("llm_jobs", sa.Column("llm_provider", sa.String(length=40)))
    op.add_column("llm_jobs", sa.Column("provider_name", sa.String(length=80)))
    op.add_column("llm_jobs", sa.Column("provider_model", sa.String(length=120)))
    op.add_column("llm_jobs", sa.Column("provider_response_id", sa.String(length=160)))
    op.add_column("llm_jobs", sa.Column("provider_request_id", sa.String(length=160)))
    op.add_column("llm_jobs", sa.Column("provider_usage_json", sa.Text()))


def downgrade() -> None:
    op.drop_column("llm_jobs", "provider_usage_json")
    op.drop_column("llm_jobs", "provider_request_id")
    op.drop_column("llm_jobs", "provider_response_id")
    op.drop_column("llm_jobs", "provider_model")
    op.drop_column("llm_jobs", "provider_name")
    op.drop_column("llm_jobs", "llm_provider")
    op.drop_column("llm_jobs", "usage_cost_unit")
    op.drop_column("llm_jobs", "usage_cost_decimal")
    op.drop_column("llm_jobs", "usage_tool_call_count")
    op.drop_column("llm_jobs", "usage_request_count")
    op.drop_column("llm_jobs", "usage_reasoning_tokens")
    op.drop_column("llm_jobs", "usage_cache_write_tokens")
    op.drop_column("llm_jobs", "usage_cached_input_tokens")
    op.drop_column("llm_jobs", "usage_total_tokens")
