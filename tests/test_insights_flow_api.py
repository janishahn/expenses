from datetime import date, datetime

from fastapi.testclient import TestClient


def _create_category(
    client: TestClient, headers: dict[str, str], name: str, txn_type: str
) -> int:
    response = client.post(
        "/api/categories",
        headers=headers,
        json={"name": name, "type": txn_type, "order": 0},
    )
    assert response.status_code == 200
    return int(response.json()["id"])


def _create_transaction(
    client: TestClient,
    headers: dict[str, str],
    *,
    txn_type: str,
    amount_cents: int,
    category_id: int,
    title: str,
) -> int:
    txn_date = date.today()
    occurred_at = datetime.combine(txn_date, datetime.min.time()).replace(hour=12)
    response = client.post(
        "/api/transactions",
        headers=headers,
        json={
            "date": txn_date.isoformat(),
            "occurred_at": occurred_at.isoformat(),
            "type": txn_type,
            "amount_cents": amount_cents,
            "category_id": category_id,
            "title": title,
            "tags": [],
        },
    )
    assert response.status_code == 200
    return int(response.json()["id"])


def test_insights_flow_returns_nodes_and_links(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    salary_id = _create_category(api_client, csrf_headers, "Salary", "income")
    freelance_id = _create_category(api_client, csrf_headers, "Freelance", "income")
    rent_id = _create_category(api_client, csrf_headers, "Housing", "expense")
    groceries_id = _create_category(api_client, csrf_headers, "Groceries", "expense")

    _create_transaction(
        api_client,
        csrf_headers,
        txn_type="income",
        amount_cents=300_000,
        category_id=salary_id,
        title="Salary",
    )
    _create_transaction(
        api_client,
        csrf_headers,
        txn_type="income",
        amount_cents=100_000,
        category_id=freelance_id,
        title="Freelance",
    )
    _create_transaction(
        api_client,
        csrf_headers,
        txn_type="expense",
        amount_cents=120_000,
        category_id=rent_id,
        title="Rent",
    )
    _create_transaction(
        api_client,
        csrf_headers,
        txn_type="expense",
        amount_cents=60_000,
        category_id=groceries_id,
        title="Groceries",
    )

    response = api_client.get("/api/insights/flow?period=this_month")
    assert response.status_code == 200
    payload = response.json()

    assert payload["nodes"]
    assert payload["links"]

    node_amounts = {node["id"]: int(node["amount_cents"]) for node in payload["nodes"]}
    outgoing: dict[str, int] = {}
    incoming: dict[str, int] = {}
    for link in payload["links"]:
        outgoing[link["from"]] = outgoing.get(link["from"], 0) + int(
            link["amount_cents"]
        )
        incoming[link["to"]] = incoming.get(link["to"], 0) + int(link["amount_cents"])

    for node in payload["nodes"]:
        node_id = node["id"]
        node_type = node["type"]
        amount = node_amounts[node_id]
        if node_type in {"income", "deficit"}:
            assert outgoing.get(node_id, 0) == amount
        if node_type in {"expense", "savings"}:
            assert incoming.get(node_id, 0) == amount


def test_insights_flow_adds_deficit_source_when_income_missing(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    groceries_id = _create_category(api_client, csrf_headers, "Groceries", "expense")
    _create_transaction(
        api_client,
        csrf_headers,
        txn_type="expense",
        amount_cents=5_000,
        category_id=groceries_id,
        title="Only expenses",
    )

    response = api_client.get("/api/insights/flow?period=this_month")
    assert response.status_code == 200
    payload = response.json()
    assert payload["nodes"]
    deficit = next(node for node in payload["nodes"] if node["type"] == "deficit")
    expense = next(node for node in payload["nodes"] if node["type"] == "expense")
    assert int(deficit["amount_cents"]) == int(expense["amount_cents"])
    assert any(
        link["from"] == deficit["id"] and link["to"] == expense["id"]
        for link in payload["links"]
    )


def test_insights_flow_respects_type_filter(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    income_id = _create_category(api_client, csrf_headers, "Salary", "income")
    expense_id = _create_category(api_client, csrf_headers, "Rent", "expense")
    _create_transaction(
        api_client,
        csrf_headers,
        txn_type="income",
        amount_cents=200_000,
        category_id=income_id,
        title="Income",
    )
    _create_transaction(
        api_client,
        csrf_headers,
        txn_type="expense",
        amount_cents=80_000,
        category_id=expense_id,
        title="Expense",
    )

    income_response = api_client.get("/api/insights/flow?period=this_month&type=income")
    assert income_response.status_code == 200
    income_payload = income_response.json()
    assert all(node["type"] != "expense" for node in income_payload["nodes"])
    assert any(node["type"] == "savings" for node in income_payload["nodes"])

    expense_response = api_client.get(
        "/api/insights/flow?period=this_month&type=expense"
    )
    assert expense_response.status_code == 200
    expense_payload = expense_response.json()
    assert all(node["type"] != "income" for node in expense_payload["nodes"])
    assert any(node["type"] == "deficit" for node in expense_payload["nodes"])
