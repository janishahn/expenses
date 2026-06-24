from pathlib import Path

from alembic import command as alembic_command
from alembic.config import Config

from expenses.core.config import get_settings


def upgrade_head(root_dir: Path | None = None, *, quiet: bool = False) -> None:
    resolved_root_dir = root_dir or Path(__file__).resolve().parents[3]
    config = Config(str(resolved_root_dir / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", get_settings().database_url)
    if quiet:
        config.attributes["configure_logger"] = False
    alembic_command.upgrade(config, "head")


def main() -> int:
    print("Applying database migrations...")
    upgrade_head(quiet=True)
    print("Database migrations are up to date.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
