import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path

from expenses.api.routes import APP_VERSION
from expenses.core.config import get_settings


DEFAULT_OUTPUT_DIR = Path("ios/ExpensesApp/Fixtures")


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def export_ios_fixtures(output_dir: Path = DEFAULT_OUTPUT_DIR) -> Path:
    settings = get_settings()
    output_dir.mkdir(parents=True, exist_ok=True)

    _write_json(
        output_dir / "mobile_status.json",
        {
            "app": "expenses",
            "version": APP_VERSION,
            "setup_required": False,
            "timezone": settings.timezone,
            "receipt_max_bytes": settings.receipt_max_bytes,
        },
    )

    created_at = datetime(2026, 5, 17, 12, 0, 0)
    expires_at = created_at + timedelta(seconds=settings.mobile_session_max_age_seconds)
    _write_json(
        output_dir / "mobile_auth_identity.json",
        {
            "authenticated": True,
            "token": "fixture-mobile-token",
            "user": {"id": 1, "username": "bootstrap", "is_admin": True},
            "session": {
                "id": 1,
                "device_id": "fixture-device-id",
                "device_name": "iPhone Simulator",
                "created_at": created_at.isoformat(),
                "last_used_at": created_at.isoformat(),
                "expires_at": expires_at.isoformat(),
                "revoked_at": None,
                "elevated_until": None,
            },
        },
    )

    _write_json(
        output_dir / "api_error.json",
        {
            "detail": "Authentication required",
            "request_id": "fixture-request-id",
            "status_code": 401,
        },
    )

    transaction = {
        "id": 101,
        "date": "2026-05-17",
        "occurred_at": "2026-05-17T12:30:00",
        "type": "expense",
        "amount_cents": 1299,
        "net_amount_cents": 1299,
        "reimbursed_total_cents": 0,
        "is_reimbursement": False,
        "category": {
            "id": 10,
            "name": "Groceries",
            "type": "expense",
            "icon": "shopping-cart",
        },
        "title": "Weekly groceries",
        "description": "Market receipt attached.",
        "latitude": None,
        "longitude": None,
        "tags": [{"id": 7, "name": "Home"}],
        "has_attachments": True,
    }
    dashboard = {
        "period": {"slug": "this_month", "start": "2026-05-01", "end": "2026-05-31"},
        "filters": {"type": None},
        "kpis": {"income": 320000, "expenses": 84550, "balance": 235450},
        "sparklines": {
            "income": "0,320000",
            "expenses": "1200,84550",
            "balance": "0,235450",
        },
        "deltas": {"income": 0, "expenses": -12400, "balance": 12400},
        "donut": {
            "has_any_transactions": True,
            "mode": "both",
            "expense_breakdown": [
                {"name": "Groceries", "amount_cents": 34200, "percent": 40.45}
            ],
            "income_breakdown": [
                {"name": "Salary", "amount_cents": 320000, "percent": 100.0}
            ],
        },
        "recent": [transaction],
        "categories": [
            {"id": 10, "name": "Groceries", "type": "expense", "icon": "shopping-cart"}
        ],
        "tags": [{"id": 7, "name": "Home"}],
        "durable_purchases": None,
        "budget_pace": {
            "velocity_ratio": 0.82,
            "projected_cents": 178000,
            "budget_cents": 220000,
            "sparkline": "0.61,0.66,0.7,0.75,0.78,0.8,0.82",
        },
        "category_budget_pulse": [
            {
                "scope_category_id": 10,
                "scope_label": "Groceries",
                "amount_cents": 45000,
                "spent_cents": 34200,
                "remaining_cents": 10800,
                "velocity_ratio": 0.91,
            }
        ],
    }
    _write_json(output_dir / "dashboard.json", dashboard)
    _write_json(
        output_dir / "transactions.json",
        {
            "items": [transaction],
            "page": 1,
            "limit": 50,
            "has_more": False,
            "period": {"slug": "all", "start": "1970-01-01", "end": "2026-05-17"},
            "filters": {
                "type": None,
                "category_id": None,
                "tag_id": None,
                "query": None,
            },
            "search": {"raw_q": "", "applied_tokens": [], "free_terms": []},
            "categories": dashboard["categories"],
            "tags": dashboard["tags"],
        },
    )

    return output_dir


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export curated JSON fixtures for native iOS previews and tests."
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Output directory, default: {DEFAULT_OUTPUT_DIR}",
    )
    args = parser.parse_args()

    output_dir = export_ios_fixtures(args.output_dir)
    print(f"Wrote iOS fixtures to {output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
