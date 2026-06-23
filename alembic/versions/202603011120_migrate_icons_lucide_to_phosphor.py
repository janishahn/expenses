"""Migrate category icon keys from lucide to phosphor naming.

Revision ID: 202603011120
Revises: 202603011110
Create Date: 2026-03-01 11:20:00
"""

from alembic import op
from sqlalchemy import text

revision = "202603011120"
down_revision = "202603011110"
branch_labels = None
depends_on = None

ICON_RENAME_MAP = {
    "home": "house",
    "music": "music-notes",
    "zap": "lightning",
    "plane": "airplane",
    "utensils": "fork-knife",
    "shirt": "t-shirt",
    "dumbbell": "barbell",
    "film": "film-strip",
    "gamepad-2": "game-controller",
    "wifi": "wifi-high",
    "smartphone": "device-mobile",
    "banknote": "money",
    "trending-up": "trend-up",
    "building": "buildings",
    "fuel": "gas-pump",
    "circle-dollar-sign": "currency-circle-dollar",
    "menu": "list",
}


def upgrade() -> None:
    bind = op.get_bind()
    update_stmt = text("UPDATE categories SET icon = :new WHERE icon = :old")
    for old_key, new_key in ICON_RENAME_MAP.items():
        bind.execute(update_stmt, {"old": old_key, "new": new_key})


def downgrade() -> None:
    bind = op.get_bind()
    update_stmt = text("UPDATE categories SET icon = :old WHERE icon = :new")
    for old_key, new_key in ICON_RENAME_MAP.items():
        bind.execute(update_stmt, {"old": old_key, "new": new_key})
