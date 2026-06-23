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


def test_templates_crud_and_reorder(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    food_id = _create_category(api_client, csrf_headers, "Food", "expense")
    salary_id = _create_category(api_client, csrf_headers, "Salary", "income")

    response = api_client.post(
        "/api/templates",
        headers=csrf_headers,
        json={
            "name": "Morning coffee",
            "type": "expense",
            "category_id": food_id,
            "default_amount_cents": 350,
            "title": "Coffee",
            "tags": ["daily", "daily", "work"],
        },
    )
    assert response.status_code == 200
    coffee_id = int(response.json()["id"])

    response = api_client.post(
        "/api/templates",
        headers=csrf_headers,
        json={
            "name": "Salary bonus",
            "type": "income",
            "category_id": salary_id,
            "default_amount_cents": None,
            "title": "Bonus",
            "tags": ["work"],
        },
    )
    assert response.status_code == 200
    bonus_id = int(response.json()["id"])

    response = api_client.get("/api/templates")
    assert response.status_code == 200
    templates = response.json()["templates"]
    assert [row["id"] for row in templates] == [coffee_id, bonus_id]
    assert templates[0]["tags"] == ["daily", "work"]

    response = api_client.post(
        "/api/templates/reorder",
        headers=csrf_headers,
        json={"template_ids": [bonus_id, coffee_id]},
    )
    assert response.status_code == 200

    response = api_client.get("/api/templates")
    assert response.status_code == 200
    templates = response.json()["templates"]
    assert [row["id"] for row in templates] == [bonus_id, coffee_id]

    response = api_client.put(
        f"/api/templates/{coffee_id}",
        headers=csrf_headers,
        json={
            "name": "Morning coffee updated",
            "type": "expense",
            "category_id": food_id,
            "default_amount_cents": 420,
            "title": "Large coffee",
            "tags": ["daily"],
        },
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Morning coffee updated"

    response = api_client.delete(f"/api/templates/{bonus_id}", headers=csrf_headers)
    assert response.status_code == 200

    response = api_client.get("/api/templates")
    assert response.status_code == 200
    templates = response.json()["templates"]
    assert len(templates) == 1
    assert templates[0]["id"] == coffee_id
