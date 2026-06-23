from fastapi.testclient import TestClient


def _create_category(
    client: TestClient,
    headers: dict[str, str],
    name: str,
    txn_type: str,
    icon: str | None = "currency-circle-dollar",
) -> int:
    response = client.post(
        "/api/categories",
        headers=headers,
        json={"name": name, "type": txn_type, "icon": icon, "order": 0},
    )
    assert response.status_code == 200
    return int(response.json()["id"])


def test_create_category_with_icon_success(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    response = api_client.post(
        "/api/categories",
        headers=csrf_headers,
        json={
            "name": "Salary",
            "type": "income",
            "icon": "briefcase",
            "order": 1,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["name"] == "Salary"
    assert payload["type"] == "income"
    assert payload["icon"] == "briefcase"
    assert payload["order"] == 1


def test_update_category_success(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(api_client, csrf_headers, "Food", "expense")

    response = api_client.put(
        f"/api/categories/{category_id}",
        headers=csrf_headers,
        json={"name": "Groceries", "icon": "shopping-cart", "order": 12},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == category_id
    assert payload["name"] == "Groceries"
    assert payload["icon"] == "shopping-cart"
    assert payload["order"] == 12
    assert payload["type"] == "expense"


def test_update_category_icon_can_be_cleared(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(
        api_client,
        csrf_headers,
        "Food",
        "expense",
        icon="shopping-cart",
    )

    response = api_client.put(
        f"/api/categories/{category_id}",
        headers=csrf_headers,
        json={"name": "Food", "icon": None, "order": 0},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == category_id
    assert payload["icon"] is None


def test_update_category_duplicate_name_fails(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    _create_category(api_client, csrf_headers, "Food", "expense")
    second_id = _create_category(api_client, csrf_headers, "Travel", "expense")

    response = api_client.put(
        f"/api/categories/{second_id}",
        headers=csrf_headers,
        json={"name": "Food", "icon": "airplane", "order": 3},
    )
    assert response.status_code == 400
    assert "already exists" in response.text


def test_update_category_not_found(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    response = api_client.put(
        "/api/categories/99999",
        headers=csrf_headers,
        json={"name": "Anything", "icon": "airplane", "order": 0},
    )
    assert response.status_code == 404
    assert "Category not found" in response.text


def test_create_category_icon_too_long_fails_validation(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    response = api_client.post(
        "/api/categories",
        headers=csrf_headers,
        json={
            "name": "Income",
            "type": "income",
            "icon": "a" * 51,
            "order": 0,
        },
    )
    assert response.status_code == 422


def test_update_category_icon_too_long_fails_validation(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    category_id = _create_category(api_client, csrf_headers, "Food", "expense")

    response = api_client.put(
        f"/api/categories/{category_id}",
        headers=csrf_headers,
        json={"name": "Food", "icon": "a" * 51, "order": 0},
    )
    assert response.status_code == 422


def test_create_category_whitespace_name_rejected(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    response = api_client.post(
        "/api/categories",
        headers=csrf_headers,
        json={"name": "   ", "type": "expense", "icon": None, "order": 0},
    )
    assert response.status_code == 422
    assert "Category name cannot be blank" in response.text


def test_create_category_trimmed_duplicate_fails_with_400(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    first_response = api_client.post(
        "/api/categories",
        headers=csrf_headers,
        json={"name": "Food", "type": "expense", "icon": None, "order": 0},
    )
    assert first_response.status_code == 200

    duplicate_response = api_client.post(
        "/api/categories",
        headers=csrf_headers,
        json={"name": "Food   ", "type": "expense", "icon": None, "order": 0},
    )
    assert duplicate_response.status_code == 400
    assert "already exists" in duplicate_response.text
