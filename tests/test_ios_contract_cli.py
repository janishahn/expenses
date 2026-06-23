import json

from expenses_web.cli.export_ios_fixtures import export_ios_fixtures
from expenses_web.cli.export_openapi import export_openapi


def test_export_openapi_writes_mobile_contract_schema(tmp_path) -> None:
    output_path = tmp_path / "openapi.json"

    written_path = export_openapi(output_path)

    assert written_path == output_path
    payload = json.loads(output_path.read_text())
    assert payload["info"]["title"] == "Expense Tracker"
    assert "/api/mobile/status" in payload["paths"]
    assert "/api/mobile/auth/login" in payload["paths"]
    assert "/api/dashboard" in payload["paths"]
    assert "/api/transactions" in payload["paths"]
    assert "MobileAuthIdentityOut" in payload["components"]["schemas"]
    assert "DashboardResponseOut" in payload["components"]["schemas"]
    assert "TransactionsResponseOut" in payload["components"]["schemas"]
    assert "TransactionDetailOut" in payload["components"]["schemas"]


def test_export_ios_fixtures_writes_curated_foundation_snapshots(tmp_path) -> None:
    output_dir = tmp_path / "fixtures"

    written_dir = export_ios_fixtures(output_dir)

    assert written_dir == output_dir
    status = json.loads((output_dir / "mobile_status.json").read_text())
    identity = json.loads((output_dir / "mobile_auth_identity.json").read_text())
    api_error = json.loads((output_dir / "api_error.json").read_text())
    dashboard = json.loads((output_dir / "dashboard.json").read_text())
    transactions = json.loads((output_dir / "transactions.json").read_text())

    assert status["app"] == "expenses-web"
    assert status["timezone"] == "Europe/Berlin"
    assert identity["authenticated"] is True
    assert identity["session"]["device_name"] == "iPhone Simulator"
    assert api_error["request_id"] == "fixture-request-id"
    assert dashboard["kpis"]["balance"] == 235450
    assert transactions["items"][0]["title"] == "Weekly groceries"
