from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from expenses.db.models import CurrencyCode, FxQuoteCache
from expenses.db.session import Base
from expenses.infra.fx_rates import (
    FxQuote,
    FxRateService,
)


def _session() -> Session:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return Session(engine)


def test_fx_service_uses_exact_cached_quote_without_fetch(monkeypatch):
    with _session() as session:
        session.add(
            FxQuoteCache(
                base_currency_code=CurrencyCode.usd,
                quote_currency_code=CurrencyCode.eur,
                lookup_date=date(2026, 2, 2),
                effective_date=date(2026, 2, 2),
                rate_micros=845_000,
                provider="ecb",
                fetched_at=datetime(2026, 2, 2, 10, 0, 0),
            )
        )
        session.commit()

        def fail_fetch(*args, **kwargs):
            raise AssertionError("live fetch should not run for exact cache hits")

        monkeypatch.setattr(
            "expenses.infra.fx_rates._fetch_ecb_usd_eur_quotes",
            fail_fetch,
        )

        amount_eur_cents, quote = FxRateService(session).convert_usd_cents_to_eur_cents(
            10_000,
            date(2026, 2, 2),
        )

        assert amount_eur_cents == 8_450
        assert quote.provider == "ecb"
        assert quote.source == "cache_exact"


def test_fx_service_uses_stale_cached_quote_when_live_fetch_fails(monkeypatch):
    with _session() as session:
        session.add(
            FxQuoteCache(
                base_currency_code=CurrencyCode.usd,
                quote_currency_code=CurrencyCode.eur,
                lookup_date=date(2026, 2, 1),
                effective_date=date(2026, 1, 31),
                rate_micros=900_000,
                provider="ecb",
                fetched_at=datetime(2026, 2, 1, 10, 0, 0),
            )
        )
        session.commit()

        def fail_fetch(*args, **kwargs):
            raise RuntimeError("ECB unavailable")

        monkeypatch.setattr(
            "expenses.infra.fx_rates._fetch_ecb_usd_eur_quotes",
            fail_fetch,
        )

        amount_eur_cents, quote = FxRateService(session).convert_usd_cents_to_eur_cents(
            10_000,
            date(2026, 2, 2),
            allow_stale_cache=True,
        )

        assert amount_eur_cents == 9_000
        assert quote.source == "cache_stale"
        assert quote.rate_date == date(2026, 1, 31)


def test_fx_service_clamps_future_dates_to_today(monkeypatch):
    with _session() as session:
        service = FxRateService(session)
        today = date(2026, 3, 25)

        def fake_today(self):
            return today

        def fake_quote(self, lookup_date: date, quote: FxQuote) -> FxQuote:
            return quote

        def fake_fetch(start_date: date, end_date: date, *, timeout: float):
            assert end_date == today
            fetched_at = datetime(2026, 3, 25, 12, 0, 0)
            return {
                today: FxQuote(
                    provider="ecb",
                    base="USD",
                    quote="EUR",
                    rate=Decimal("0.86415"),
                    rate_date=today,
                    fetched_at=fetched_at,
                    source="live",
                )
            }

        monkeypatch.setattr(
            "expenses.infra.fx_rates.FxRateService._local_today",
            fake_today,
        )
        monkeypatch.setattr(
            "expenses.infra.fx_rates.FxRateService._store_quote",
            fake_quote,
        )
        monkeypatch.setattr(
            "expenses.infra.fx_rates._fetch_ecb_usd_eur_quotes",
            fake_fetch,
        )

        quote = service.usd_to_eur_quote_for_date(date(2026, 4, 30))

        assert quote.rate == Decimal("0.86415")
        assert quote.rate_date == today


def test_fx_service_persists_live_quotes_for_future_requests(monkeypatch):
    with _session() as session:
        fetched_at = datetime(2026, 3, 25, 12, 0, 0)

        def fake_fetch(start_date: date, end_date: date, *, timeout: float):
            return {
                date(2026, 3, 25): FxQuote(
                    provider="ecb",
                    base="USD",
                    quote="EUR",
                    rate=Decimal("0.86415"),
                    rate_date=date(2026, 3, 25),
                    fetched_at=fetched_at,
                    source="live",
                )
            }

        monkeypatch.setattr(
            "expenses.infra.fx_rates._fetch_ecb_usd_eur_quotes",
            fake_fetch,
        )

        amount_eur_cents, first_quote = FxRateService(
            session
        ).convert_usd_cents_to_eur_cents(
            10_000,
            date(2026, 3, 25),
        )

        assert amount_eur_cents == 8_642
        assert first_quote.source == "live"

        def fail_fetch(*args, **kwargs):
            raise AssertionError("second lookup should hit the persisted cache")

        monkeypatch.setattr(
            "expenses.infra.fx_rates._fetch_ecb_usd_eur_quotes",
            fail_fetch,
        )

        amount_eur_cents, cached_quote = FxRateService(
            session
        ).convert_usd_cents_to_eur_cents(
            10_000,
            date(2026, 3, 25),
        )

        assert amount_eur_cents == 8_642
        assert cached_quote.source == "cache_exact"


def test_fx_service_store_quote_upserts_existing_lookup_date():
    with _session() as session:
        service = FxRateService(session)

        first_quote = FxQuote(
            provider="ecb",
            base="USD",
            quote="EUR",
            rate=Decimal("0.86415"),
            rate_date=date(2026, 3, 24),
            fetched_at=datetime(2026, 3, 25, 12, 0, 0),
            source="live",
        )
        second_quote = FxQuote(
            provider="ecb",
            base="USD",
            quote="EUR",
            rate=Decimal("0.86555"),
            rate_date=date(2026, 3, 25),
            fetched_at=datetime(2026, 3, 25, 12, 5, 0),
            source="live",
        )

        service._store_quote(date(2026, 3, 25), first_quote)
        service._store_quote(date(2026, 3, 25), second_quote)

        rows = session.query(FxQuoteCache).all()

        assert len(rows) == 1
        assert rows[0].effective_date == date(2026, 3, 25)
        assert rows[0].rate_micros == 865_550
        assert rows[0].fetched_at == datetime(2026, 3, 25, 12, 5, 0)


def test_usd_rule_catch_up_posts_every_occurrence_with_uncached_rates(
    monkeypatch, tmp_path
):
    import time
    from datetime import timedelta

    from sqlalchemy import event, func, select
    from sqlalchemy.orm import sessionmaker

    from expenses.db.models import (
        Category,
        IntervalUnit,
        MonthDayPolicy,
        RecurringRule,
        Transaction,
        TransactionType,
    )
    from expenses.db.session import _enable_sqlite_pragmas
    from expenses.recurrence.engine import RecurringEngine

    def fake_fetch(start_date, end_date, *, timeout):
        out = {}
        day = start_date
        while day <= end_date:
            out[day] = FxQuote(
                "ecb", "USD", "EUR", Decimal("0.9"), day, datetime(2026, 1, 1), "live"
            )
            day += timedelta(days=1)
        return out

    monkeypatch.setattr("expenses.infra.fx_rates._fetch_ecb_usd_eur_quotes", fake_fetch)

    # File-backed SQLite with the app's pragmas, as in production.
    engine = create_engine(
        f"sqlite:///{tmp_path / 'expenses.db'}",
        connect_args={"check_same_thread": False},
    )
    event.listen(engine, "connect", _enable_sqlite_pragmas)
    Base.metadata.create_all(engine)
    session_local = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with session_local() as session:
        category = Category(
            user_id=1, name="Subs", type=TransactionType.expense, color="#fff"
        )
        session.add(category)
        session.flush()
        # An earlier-due EUR rule makes the run hold the write lock first.
        for name, currency, start in [
            ("EUR rent", CurrencyCode.eur, date(2026, 6, 1)),
            ("USD sub", CurrencyCode.usd, date(2026, 7, 1)),
        ]:
            session.add(
                RecurringRule(
                    user_id=1,
                    name=name,
                    type=TransactionType.expense,
                    currency_code=currency,
                    amount_cents=1000,
                    category_id=category.id,
                    anchor_date=start,
                    interval_unit=IntervalUnit.month,
                    interval_count=1,
                    next_occurrence=start,
                    auto_post=True,
                    month_day_policy=MonthDayPolicy.snap_to_end,
                )
            )
        session.commit()

    started = time.monotonic()
    with session_local() as session:
        RecurringEngine(session).post_due_rules(today=date(2026, 11, 19))
        session.commit()
    elapsed = time.monotonic() - started

    with session_local() as session:
        usd_posts = session.scalars(
            select(Transaction.amount_cents).where(
                Transaction.source_currency_code == CurrencyCode.usd
            )
        ).all()
        cached = session.scalar(select(func.count(FxQuoteCache.id)))
    assert usd_posts == [900] * 5
    assert cached == 5
    # No wait for the database lock (busy_timeout is 5 s).
    assert elapsed < 4
