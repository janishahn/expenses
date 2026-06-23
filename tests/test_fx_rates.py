from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from expenses_web.db.models import CurrencyCode, FxQuoteCache
from expenses_web.db.session import Base
from expenses_web.infra.fx_rates import (
    FxQuote,
    FxRateService,
    _fetch_ecb_usd_eur_quotes,
)


class _DummyResponse:
    def __init__(self, payload: str) -> None:
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self) -> bytes:
        return self._payload.encode("utf-8")


def _session() -> Session:
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return Session(engine)


def test_fx_fetch_sets_explicit_user_agent(monkeypatch):
    captured: dict[str, object] = {}

    def fake_urlopen(req, timeout):
        captured["user_agent"] = req.get_header("User-agent")
        captured["accept"] = req.get_header("Accept")
        captured["timeout"] = timeout
        return _DummyResponse("TIME_PERIOD,OBS_VALUE\n2026-02-02,2.0\n")

    monkeypatch.setattr("expenses_web.infra.fx_rates.urlopen", fake_urlopen)

    quotes = _fetch_ecb_usd_eur_quotes(
        date(2026, 2, 2),
        date(2026, 2, 2),
        timeout=5.0,
    )

    assert captured["user_agent"] == "expenses-web/0.1 (+https://local)"
    assert captured["accept"] == "text/csv"
    assert captured["timeout"] == 5.0
    quote = quotes[date(2026, 2, 2)]
    assert quote.provider == "ecb"
    assert quote.rate == Decimal("0.5")
    assert quote.rate_date == date(2026, 2, 2)


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
            "expenses_web.infra.fx_rates._fetch_ecb_usd_eur_quotes",
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
            "expenses_web.infra.fx_rates._fetch_ecb_usd_eur_quotes",
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
            "expenses_web.infra.fx_rates.FxRateService._local_today",
            fake_today,
        )
        monkeypatch.setattr(
            "expenses_web.infra.fx_rates.FxRateService._store_quote",
            fake_quote,
        )
        monkeypatch.setattr(
            "expenses_web.infra.fx_rates._fetch_ecb_usd_eur_quotes",
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
            "expenses_web.infra.fx_rates._fetch_ecb_usd_eur_quotes",
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
            "expenses_web.infra.fx_rates._fetch_ecb_usd_eur_quotes",
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
