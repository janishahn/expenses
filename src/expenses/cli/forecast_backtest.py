import argparse
import json

from expenses.db.session import SessionLocal
from expenses.services import ForecastService


def _amount(cents: int | None, samples: int) -> str:
    if cents is None:
        return "-"
    return f"{cents / 100:,.2f} ({samples})"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backtest variable cash-flow forecasting against prior months."
    )
    parser.add_argument("--user-id", type=int, default=1)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()

    with SessionLocal() as session:
        result = ForecastService(session, user_id=args.user_id).backtest()

    if args.as_json:
        print(json.dumps(result, sort_keys=True))
        return 0

    print(f"History: {result['history_months']} months")
    print(
        "Mean absolute error of the variable balance change, in EUR, "
        "with the number of tests in brackets."
    )
    rows = [
        (
            "Ahead",
            "Model",
            "12-month average",
            "Same month last year",
            "80% range coverage",
        )
    ]
    for row in result["horizons"]:
        coverage = row["range_coverage_bps"]
        rows.append(
            (
                f"{row['months']} months" if row["months"] > 1 else "1 month",
                _amount(row["model_mae_cents"], row["samples"]),
                _amount(row["average_mae_cents"], row["samples"]),
                _amount(
                    row["same_month_last_year_mae_cents"],
                    row["same_month_last_year_samples"],
                ),
                "-"
                if coverage is None
                else f"{coverage / 100:.0f}% ({row['range_samples']})",
            )
        )
    widths = [max(len(row[column]) for row in rows) for column in range(5)]
    for row in rows:
        print("  ".join(cell.ljust(width) for cell, width in zip(row, widths)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
