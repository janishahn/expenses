from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from rapidfuzz import fuzz

from expenses.core.config import get_settings


def _create_engine() -> Engine:
    settings = get_settings()
    connect_args: dict[str, object] = {}
    if settings.database_url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
    eng = create_engine(settings.database_url, connect_args=connect_args)
    if settings.database_url.startswith("sqlite"):
        event.listen(eng, "connect", _enable_sqlite_pragmas)
    return eng


def _enable_sqlite_pragmas(dbapi_conn, _record):
    dbapi_conn.create_function(
        "expenses_fuzzy_text_match",
        3,
        _fuzzy_text_match,
        deterministic=True,
    )
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL;")
    cursor.execute("PRAGMA foreign_keys=ON;")
    cursor.execute("PRAGMA synchronous=NORMAL;")
    cursor.execute("PRAGMA busy_timeout=5000;")
    cursor.execute("PRAGMA cache_size=-16384;")
    cursor.execute("PRAGMA mmap_size=268435456;")
    cursor.execute("PRAGMA temp_store=MEMORY;")
    cursor.close()


def _fuzzy_text_match(query: str, title: str | None, description: str | None) -> int:
    normalized_query = " ".join(query.casefold().split())
    normalized_title = " ".join((title or "").casefold().split())
    normalized_description = " ".join((description or "").casefold().split())
    if not normalized_query:
        return 1
    if (
        normalized_query in normalized_title
        or normalized_query in normalized_description
    ):
        return 1
    if len(normalized_query) < 3:
        return 0
    return int(
        (
            len(normalized_title) >= len(normalized_query)
            and fuzz.partial_ratio(normalized_query, normalized_title) >= 80
        )
        or (
            len(normalized_description) >= len(normalized_query)
            and fuzz.partial_ratio(normalized_query, normalized_description) >= 80
        )
    )


engine = _create_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


@contextmanager
def session_scope() -> Iterator[Session]:
    session: Session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
