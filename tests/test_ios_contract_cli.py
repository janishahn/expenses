import json
from pathlib import Path

from expenses.cli.export_ios_fixtures import export_ios_fixtures
from expenses.cli.export_openapi import export_openapi
from expenses.schemas import (
    DashboardResponseOut,
    MobileAuthIdentityOut,
    MobileStatusOut,
    TransactionsResponseOut,
)


def test_export_openapi_writes_mobile_contract_schema(tmp_path) -> None:
    output_path = tmp_path / "openapi.json"

    written_path = export_openapi(output_path)

    assert written_path == output_path
    payload = json.loads(output_path.read_text())
    assert "/api/mobile/status" in payload["paths"]
    assert "/api/mobile/auth/login" in payload["paths"]
    assert "/api/dashboard" in payload["paths"]
    assert "/api/transactions" in payload["paths"]
    assert "MobileAuthIdentityOut" in payload["components"]["schemas"]
    assert "DashboardResponseOut" in payload["components"]["schemas"]
    assert "DashboardCategoryBudgetSummaryOut" in payload["components"]["schemas"]
    assert "TransactionsResponseOut" in payload["components"]["schemas"]
    assert "TransactionDetailOut" in payload["components"]["schemas"]
    report_options = payload["components"]["schemas"]["ReportOptions"]["properties"]
    assert "tag_ids" in report_options
    assert "excluded_tag_ids" in report_options


def test_checked_in_openapi_contract_is_fresh(tmp_path) -> None:
    output_path = tmp_path / "openapi.json"
    export_openapi(output_path)
    checked_in_path = (
        Path(__file__).resolve().parents[1]
        / "ios"
        / "ExpensesApp"
        / "Contract"
        / "openapi.json"
    )

    assert json.loads(output_path.read_text()) == json.loads(
        checked_in_path.read_text()
    )


def test_export_ios_fixtures_match_api_contracts(tmp_path) -> None:
    output_dir = tmp_path / "fixtures"

    written_dir = export_ios_fixtures(output_dir)

    assert written_dir == output_dir
    contracts = {
        "mobile_status.json": MobileStatusOut,
        "mobile_auth_identity.json": MobileAuthIdentityOut,
        "dashboard.json": DashboardResponseOut,
        "transactions.json": TransactionsResponseOut,
    }
    for filename, model in contracts.items():
        model.model_validate_json((output_dir / filename).read_text(), strict=True)

    identity = MobileAuthIdentityOut.model_validate_json(
        (output_dir / "mobile_auth_identity.json").read_text()
    )
    assert identity.authenticated
    assert identity.token
    assert identity.user is not None
    assert identity.session is not None
    assert identity.session.expires_at > identity.session.created_at

    dashboard = DashboardResponseOut.model_validate_json(
        (output_dir / "dashboard.json").read_text()
    )
    transactions = TransactionsResponseOut.model_validate_json(
        (output_dir / "transactions.json").read_text()
    )
    assert transactions.items
    assert dashboard.recent == transactions.items
    assert dashboard.category_budget_summary is not None

    # Error responses have no shared Pydantic model; keep their wire contract
    # explicit without pinning the curated example's wording or request ID.
    api_error = json.loads((output_dir / "api_error.json").read_text())
    assert isinstance(api_error["detail"], str) and api_error["detail"]
    assert isinstance(api_error["request_id"], str) and api_error["request_id"]
    assert 400 <= api_error["status_code"] < 600
