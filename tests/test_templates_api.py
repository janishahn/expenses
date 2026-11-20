import json

from fastapi.testclient import TestClient

from expenses.db.models import RuleLLMSuggestion


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


def test_templates_and_pending_suggestions_follow_tag_changes(
    api_client: TestClient, csrf_headers: dict[str, str], db_session
) -> None:
    food_id = _create_category(api_client, csrf_headers, "Food", "expense")
    tag_ids = {
        name: api_client.post(
            "/api/tags", headers=csrf_headers, json={"name": name}
        ).json()["id"]
        for name in ["Vacation", "Oldtag", "Src", "Dst"]
    }
    response = api_client.post(
        "/api/templates",
        headers=csrf_headers,
        json={
            "name": "Trip lunch",
            "type": "expense",
            "category_id": food_id,
            "default_amount_cents": 1_200,
            "title": "Lunch",
            "tags": ["Vacation", "Oldtag", "Src", "Dst"],
        },
    )
    assert response.status_code == 200
    suggestions = [
        RuleLLMSuggestion(
            user_id=1,
            name=name,
            match_type="contains",
            match_value=name,
            add_tags_json=json.dumps([name]),
            reason="Corrections",
        )
        for name in ["Vacation", "Oldtag"]
    ]
    db_session.add_all(suggestions)
    db_session.commit()

    response = api_client.put(
        f"/api/tags/{tag_ids['Vacation']}",
        headers=csrf_headers,
        json={"name": "Holidays"},
    )
    assert response.status_code == 200
    response = api_client.delete(f"/api/tags/{tag_ids['Oldtag']}", headers=csrf_headers)
    assert response.status_code == 200
    response = api_client.post(
        "/api/tags/merge",
        headers=csrf_headers,
        json={"source_tag_id": tag_ids["Src"], "target_tag_id": tag_ids["Dst"]},
    )
    assert response.status_code == 200

    templates = api_client.get("/api/templates").json()["templates"]
    assert templates[0]["tags"] == ["Holidays", "Dst"]
    db_session.expire_all()
    renamed, deleted = (db_session.get(RuleLLMSuggestion, s.id) for s in suggestions)
    assert (json.loads(renamed.add_tags_json), renamed.status) == (
        ["Holidays"],
        "pending",
    )
    # Without the deleted tag the suggestion has nothing left to do.
    assert (json.loads(deleted.add_tags_json), deleted.status) == ([], "stale")


def test_template_amount_is_bounded(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    food_id = _create_category(api_client, csrf_headers, "Food", "expense")

    def create(amount_cents: int):
        return api_client.post(
            "/api/templates",
            headers=csrf_headers,
            json={
                "name": "Big",
                "type": "expense",
                "category_id": food_id,
                "default_amount_cents": amount_cents,
            },
        )

    assert create(10**19).status_code == 422
    assert create(1_000_000_000_000).status_code == 200
