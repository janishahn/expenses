import argparse
import json

from expenses.db.session import SessionLocal
from expenses.services import ForecastService


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

    print(f"Months evaluated: {result['months_evaluated']}")
    print(f"Model MAE: {result['model_mae_cents']}")
    print(f"Three-month baseline MAE: {result['baseline_mae_cents']}")
    print(f"80% interval coverage (bps): {result['interval_coverage_bps']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
