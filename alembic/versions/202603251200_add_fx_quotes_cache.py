"""add fx quotes cache

Revision ID: 202603251200
Revises: 202603201100
Create Date: 2026-03-25 12:00:00.000000

"""

import sqlalchemy as sa
from alembic import op


revision = "202603251200"
down_revision = "202603201100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    currency_enum = sa.Enum("EUR", "USD", name="currencycode", create_type=False)

    op.create_table(
        "fx_quotes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("base_currency_code", currency_enum, nullable=False),
        sa.Column("quote_currency_code", currency_enum, nullable=False),
        sa.Column("lookup_date", sa.Date(), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("rate_micros", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "base_currency_code",
            "quote_currency_code",
            "lookup_date",
            name="uq_fx_quotes_pair_lookup_date",
        ),
    )
    op.create_index(
        "ix_fx_quotes_pair_lookup_date",
        "fx_quotes",
        ["base_currency_code", "quote_currency_code", "lookup_date"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_fx_quotes_pair_lookup_date", table_name="fx_quotes")
    op.drop_table("fx_quotes")
