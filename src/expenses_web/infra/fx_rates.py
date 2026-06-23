import csv
import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from io import StringIO
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session, sessionmaker

from expenses_web.core.app_logging import get_logger, log_event
from expenses_web.core.config import get_settings
from expenses_web.db.models import CurrencyCode, FxQuoteCache

logger = get_logger("expenses_web.fx")
_ECB_PROVIDER = "ecb"
_USD = CurrencyCode.usd
_EUR = CurrencyCode.eur


@dataclass(frozen=True)
class FxQuote:
    provider: str
    base: str
    quote: str
    rate: Decimal
    rate_date: date
    fetched_at: datetime
    source: str


class FxRateService:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.settings = get_settings()

    def resolve_usd_to_eur_quotes(
        self,
        on_dates: list[date] | set[date] | tuple[date, ...],
        *,
        allow_stale_cache: bool = False,
        allow_static_fallback: bool = False,
    ) -> dict[date, FxQuote]:
        requested_dates = sorted(set(on_dates))
        if not requested_dates:
            return {}

        today = self._local_today()
        lookup_by_requested = {
            on_date: on_date if on_date <= today else today
            for on_date in requested_dates
        }
        lookup_dates = sorted(set(lookup_by_requested.values()))
        quotes_by_lookup = self._exact_cached_quotes(lookup_dates)
        missing_lookup_dates = [d for d in lookup_dates if d not in quotes_by_lookup]

        if missing_lookup_dates:
            try:
                live_quotes = _fetch_ecb_usd_eur_quotes(
                    min(missing_lookup_dates) - timedelta(days=7),
                    max(missing_lookup_dates),
                    timeout=self.settings.fx_timeout_secs,
                )
            except RuntimeError:
                if not allow_stale_cache and not allow_static_fallback:
                    raise
                live_quotes = {}
            for lookup_date in missing_lookup_dates:
                live_quote = self._latest_live_quote_for_lookup_date(
                    live_quotes, lookup_date
                )
                if live_quote is None:
                    continue
                quotes_by_lookup[lookup_date] = self._store_quote(
                    lookup_date, live_quote
                )

        unresolved_lookup_dates = [
            lookup_date
            for lookup_date in lookup_dates
            if lookup_date not in quotes_by_lookup
        ]
        if unresolved_lookup_dates and allow_stale_cache:
            for lookup_date in unresolved_lookup_dates:
                stale_quote = self._latest_stale_cached_quote(lookup_date)
                if stale_quote is None:
                    continue
                quotes_by_lookup[lookup_date] = stale_quote

        unresolved_lookup_dates = [
            lookup_date
            for lookup_date in lookup_dates
            if lookup_date not in quotes_by_lookup
        ]
        if unresolved_lookup_dates and allow_static_fallback:
            for lookup_date in unresolved_lookup_dates:
                quotes_by_lookup[lookup_date] = self._static_fallback_quote(lookup_date)

        unresolved_lookup_dates = [
            lookup_date
            for lookup_date in lookup_dates
            if lookup_date not in quotes_by_lookup
        ]
        if unresolved_lookup_dates:
            raise RuntimeError(
                f"Failed to resolve FX quote for {unresolved_lookup_dates[0].isoformat()}"
            )

        return {
            requested_date: quotes_by_lookup[lookup_by_requested[requested_date]]
            for requested_date in requested_dates
        }

    def usd_to_eur_quote_for_date(
        self,
        on_date: date,
        *,
        allow_stale_cache: bool = False,
        allow_static_fallback: bool = False,
    ) -> FxQuote:
        return self.resolve_usd_to_eur_quotes(
            [on_date],
            allow_stale_cache=allow_stale_cache,
            allow_static_fallback=allow_static_fallback,
        )[on_date]

    def convert_usd_cents_to_eur_cents(
        self,
        usd_cents: int,
        on_date: date,
        *,
        allow_stale_cache: bool = False,
        allow_static_fallback: bool = False,
    ) -> tuple[int, FxQuote]:
        quote = self.usd_to_eur_quote_for_date(
            on_date,
            allow_stale_cache=allow_stale_cache,
            allow_static_fallback=allow_static_fallback,
        )
        eur_cents_decimal = (Decimal(usd_cents) * quote.rate).quantize(
            Decimal("1"),
            rounding=ROUND_HALF_UP,
        )
        return int(eur_cents_decimal), quote

    @staticmethod
    def rate_to_micros(rate: Decimal) -> int:
        return int(
            (rate * Decimal("1000000")).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        )

    def _local_today(self) -> date:
        return datetime.now(ZoneInfo(self.settings.timezone)).date()

    def _apply_markup(self, rate: Decimal) -> Decimal:
        markup_bps = self.settings.fx_markup_bps
        if not markup_bps:
            return rate
        factor = Decimal("1") - (Decimal(markup_bps) / Decimal("10000"))
        return rate * factor

    def _quote_from_row(self, row: FxQuoteCache, *, source: str) -> FxQuote:
        rate = Decimal(row.rate_micros) / Decimal("1000000")
        return FxQuote(
            provider=row.provider,
            base=_USD.value,
            quote=_EUR.value,
            rate=self._apply_markup(rate),
            rate_date=row.effective_date,
            fetched_at=row.fetched_at,
            source=source,
        )

    def _exact_cached_quotes(self, lookup_dates: list[date]) -> dict[date, FxQuote]:
        rows = self.session.scalars(
            select(FxQuoteCache).where(
                FxQuoteCache.base_currency_code == _USD,
                FxQuoteCache.quote_currency_code == _EUR,
                FxQuoteCache.lookup_date.in_(lookup_dates),
            )
        ).all()
        out: dict[date, FxQuote] = {}
        for row in rows:
            out[row.lookup_date] = self._quote_from_row(row, source="cache_exact")
        return out

    def _store_quote(self, lookup_date: date, quote: FxQuote) -> FxQuote:
        rate_micros = self.rate_to_micros(quote.rate)
        cache_session = sessionmaker(
            bind=self.session.get_bind(),
            autoflush=False,
            expire_on_commit=False,
        )()
        try:
            values = {
                "base_currency_code": _USD,
                "quote_currency_code": _EUR,
                "lookup_date": lookup_date,
                "effective_date": quote.rate_date,
                "rate_micros": rate_micros,
                "provider": quote.provider,
                "fetched_at": quote.fetched_at,
            }
            bind = cache_session.get_bind()
            if bind.dialect.name == "postgresql":
                stmt = postgresql_insert(FxQuoteCache).values(**values)
            else:
                stmt = sqlite_insert(FxQuoteCache).values(**values)
            cache_session.execute(
                stmt.on_conflict_do_update(
                    index_elements=[
                        FxQuoteCache.base_currency_code,
                        FxQuoteCache.quote_currency_code,
                        FxQuoteCache.lookup_date,
                    ],
                    set_={
                        "effective_date": quote.rate_date,
                        "rate_micros": rate_micros,
                        "provider": quote.provider,
                        "fetched_at": quote.fetched_at,
                    },
                )
            )
            cache_session.commit()
        finally:
            cache_session.close()
        return FxQuote(
            provider=quote.provider,
            base=_USD.value,
            quote=_EUR.value,
            rate=self._apply_markup(quote.rate),
            rate_date=quote.rate_date,
            fetched_at=quote.fetched_at,
            source="live",
        )

    def _latest_live_quote_for_lookup_date(
        self, live_quotes: dict[date, FxQuote], lookup_date: date
    ) -> FxQuote | None:
        eligible_dates = [
            rate_date for rate_date in live_quotes if rate_date <= lookup_date
        ]
        if not eligible_dates:
            return None
        return live_quotes[max(eligible_dates)]

    def _latest_stale_cached_quote(self, lookup_date: date) -> FxQuote | None:
        min_lookup_date = lookup_date - timedelta(days=7)
        row = self.session.scalar(
            select(FxQuoteCache)
            .where(
                FxQuoteCache.base_currency_code == _USD,
                FxQuoteCache.quote_currency_code == _EUR,
                FxQuoteCache.lookup_date <= lookup_date,
                FxQuoteCache.lookup_date >= min_lookup_date,
            )
            .order_by(FxQuoteCache.lookup_date.desc())
            .limit(1)
        )
        if row is None:
            return None
        quote = self._quote_from_row(row, source="cache_stale")
        log_event(
            logger,
            logging.WARNING,
            "fx_quote_stale_cache_used",
            provider=quote.provider,
            lookup_date=lookup_date.isoformat(),
            effective_date=quote.rate_date.isoformat(),
            fetched_at=quote.fetched_at.isoformat(),
        )
        return quote

    def _static_fallback_quote(self, lookup_date: date) -> FxQuote:
        fetched_at = datetime.now(timezone.utc)
        quote = FxQuote(
            provider="fallback",
            base=_USD.value,
            quote=_EUR.value,
            rate=Decimal(str(self.settings.fx_fallback_rate)),
            rate_date=lookup_date,
            fetched_at=fetched_at,
            source="static_fallback",
        )
        log_event(
            logger,
            logging.WARNING,
            "fx_quote_static_fallback_used",
            provider=quote.provider,
            lookup_date=lookup_date.isoformat(),
            effective_date=quote.rate_date.isoformat(),
            fallback_rate=str(quote.rate),
        )
        return quote


def _fetch_ecb_usd_eur_quotes(
    start_date: date, end_date: date, *, timeout: float
) -> dict[date, FxQuote]:
    params = urlencode(
        {
            "startPeriod": start_date.isoformat(),
            "endPeriod": end_date.isoformat(),
            "format": "csvdata",
        }
    )
    url = f"https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?{params}"
    req = Request(
        url,
        headers={
            "Accept": "text/csv",
            "User-Agent": "expenses-web/0.1 (+https://local)",
        },
    )
    fetched_at = datetime.now(timezone.utc)
    started_at = datetime.now(timezone.utc)

    try:
        with urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
        reader = csv.DictReader(StringIO(body))
        out: dict[date, FxQuote] = {}
        for row in reader:
            if not row:
                continue
            effective_date = date.fromisoformat(row["TIME_PERIOD"])
            usd_per_eur = Decimal(str(row["OBS_VALUE"]))
            eur_per_usd = Decimal("1") / usd_per_eur
            out[effective_date] = FxQuote(
                provider=_ECB_PROVIDER,
                base=_USD.value,
                quote=_EUR.value,
                rate=eur_per_usd,
                rate_date=effective_date,
                fetched_at=fetched_at,
                source="live",
            )
    except (
        URLError,
        TimeoutError,
        csv.Error,
        KeyError,
        InvalidOperation,
        UnicodeDecodeError,
        ValueError,
    ) as exc:
        log_event(
            logger,
            logging.WARNING,
            "fx_quote_fetch_failed",
            provider=_ECB_PROVIDER,
            base=_USD.value,
            quote=_EUR.value,
            start_date=start_date.isoformat(),
            end_date=end_date.isoformat(),
            timeout_secs=timeout,
            reason=exc.__class__.__name__,
        )
        raise RuntimeError(
            f"Failed to fetch FX rates from ECB for {start_date}..{end_date}"
        ) from exc

    duration_secs = (datetime.now(timezone.utc) - started_at).total_seconds()
    log_event(
        logger,
        logging.INFO,
        "fx_quote_fetched",
        provider=_ECB_PROVIDER,
        base=_USD.value,
        quote=_EUR.value,
        start_date=start_date.isoformat(),
        end_date=end_date.isoformat(),
        quote_count=len(out),
        duration_secs=round(duration_secs, 3),
    )
    return out
