import json
from unittest.mock import MagicMock, patch

from expenses.cli.forecast_backtest import main


def test_forecast_backtest_prints_machine_readable_metrics(monkeypatch, capsys) -> None:
    result = {
        "months_evaluated": 8,
        "model_mae_cents": 25_000,
        "baseline_mae_cents": 40_000,
        "interval_coverage_bps": 7_500,
    }
    session = MagicMock()
    session_local = MagicMock()
    session_local.return_value.__enter__.return_value = session
    service = MagicMock()
    service.backtest.return_value = result
    monkeypatch.setattr("sys.argv", ["forecast-backtest", "--json"])

    with (
        patch(
            "expenses.cli.forecast_backtest.SessionLocal",
            session_local,
        ),
        patch(
            "expenses.cli.forecast_backtest.ForecastService",
            return_value=service,
        ) as forecast_service,
    ):
        assert main() == 0

    assert json.loads(capsys.readouterr().out) == result
    forecast_service.assert_called_once_with(session, user_id=1)
