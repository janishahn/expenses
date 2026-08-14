from fastapi.testclient import TestClient


def test_tag_fields_persist_and_auto_attach_period_supports_preserve_and_clear(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    create_response = api_client.post(
        "/api/tags",
        headers=csrf_headers,
        json={
            "name": "Travel",
            "color": "#112233",
            "is_hidden_from_budget": False,
            "auto_attach_period": {
                "start": "2026-08-10",
                "end": "2026-08-17",
            },
        },
    )
    assert create_response.status_code == 200
    tag = create_response.json()
    tag_id = int(tag["id"])
    assert tag["color"] == "#112233"
    assert tag["auto_attach_period"] == {
        "start": "2026-08-10",
        "end": "2026-08-17",
    }

    update_response = api_client.put(
        f"/api/tags/{tag_id}",
        headers=csrf_headers,
        json={
            "name": "Travel",
            "color": "#abcdef",
            "is_hidden_from_budget": True,
        },
    )
    assert update_response.status_code == 200
    assert update_response.json()["color"] == "#abcdef"
    assert update_response.json()["auto_attach_period"] == {
        "start": "2026-08-10",
        "end": "2026-08-17",
    }

    list_response = api_client.get("/api/tags?period=all")
    assert list_response.status_code == 200
    list_match = next(
        row for row in list_response.json()["tags"] if int(row["id"]) == tag_id
    )
    assert list_match["color"] == "#abcdef"
    assert list_match["auto_attach_period"] == {
        "start": "2026-08-10",
        "end": "2026-08-17",
    }

    detail_response = api_client.get(f"/api/tags/{tag_id}?period=all")
    assert detail_response.status_code == 200
    assert detail_response.json()["tag"]["color"] == "#abcdef"
    assert detail_response.json()["tag"]["auto_attach_period"] == {
        "start": "2026-08-10",
        "end": "2026-08-17",
    }

    clear_response = api_client.put(
        f"/api/tags/{tag_id}",
        headers=csrf_headers,
        json={
            "name": "Travel",
            "color": "#abcdef",
            "is_hidden_from_budget": True,
            "auto_attach_period": None,
        },
    )
    assert clear_response.status_code == 200
    assert clear_response.json()["auto_attach_period"] is None

    invalid_response = api_client.put(
        f"/api/tags/{tag_id}",
        headers=csrf_headers,
        json={
            "name": "Travel",
            "color": "#abcdef",
            "is_hidden_from_budget": True,
            "auto_attach_period": {
                "start": "2026-08-18",
                "end": "2026-08-17",
            },
        },
    )
    assert invalid_response.status_code == 422
