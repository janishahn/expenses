from fastapi.testclient import TestClient


def test_tag_color_is_persisted_across_create_update_and_reads(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    create_response = api_client.post(
        "/api/tags",
        headers=csrf_headers,
        json={
            "name": "Travel",
            "color": "#112233",
            "is_hidden_from_budget": False,
        },
    )
    assert create_response.status_code == 200
    tag = create_response.json()
    tag_id = int(tag["id"])
    assert tag["color"] == "#112233"

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

    list_response = api_client.get("/api/tags?period=all")
    assert list_response.status_code == 200
    list_match = next(
        row for row in list_response.json()["tags"] if int(row["id"]) == tag_id
    )
    assert list_match["color"] == "#abcdef"

    detail_response = api_client.get(f"/api/tags/{tag_id}?period=all")
    assert detail_response.status_code == 200
    assert detail_response.json()["tag"]["color"] == "#abcdef"
