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
            "is_hidden_from_filters": True,
        },
    )
    assert update_response.status_code == 200
    assert update_response.json()["color"] == "#abcdef"
    assert update_response.json()["is_hidden_from_filters"] is True
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
    assert list_match["is_hidden_from_filters"] is True
    assert list_match["auto_attach_period"] == {
        "start": "2026-08-10",
        "end": "2026-08-17",
    }

    detail_response = api_client.get(f"/api/tags/{tag_id}?period=all")
    assert detail_response.status_code == 200
    assert detail_response.json()["tag"]["color"] == "#abcdef"
    assert detail_response.json()["tag"]["is_hidden_from_filters"] is True
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


def test_tag_archive_restore_and_filter_visibility_are_independent(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    archived_response = api_client.post(
        "/api/tags",
        headers=csrf_headers,
        json={
            "name": "Past vacation",
            "is_hidden_from_budget": False,
            "is_hidden_from_filters": False,
        },
    )
    hidden_response = api_client.post(
        "/api/tags",
        headers=csrf_headers,
        json={
            "name": "Private scope",
            "is_hidden_from_budget": False,
            "is_hidden_from_filters": True,
        },
    )
    assert archived_response.status_code == 200
    assert hidden_response.status_code == 200
    archived_id = int(archived_response.json()["id"])
    hidden_id = int(hidden_response.json()["id"])

    archive_response = api_client.post(
        f"/api/tags/{archived_id}/archive", headers=csrf_headers
    )
    assert archive_response.status_code == 200

    default_tags = api_client.get("/api/tags?period=all").json()["tags"]
    assert archived_id not in {int(tag["id"]) for tag in default_tags}
    assert hidden_id in {int(tag["id"]) for tag in default_tags}

    all_tags = api_client.get("/api/tags?period=all&include_archived=true").json()[
        "tags"
    ]
    archived_tag = next(tag for tag in all_tags if int(tag["id"]) == archived_id)
    assert archived_tag["archived_at"] is not None
    assert archived_tag["is_hidden_from_filters"] is False

    filter_paths = ["/api/dashboard", "/api/transactions", "/api/insights"]
    for path in filter_paths:
        tags = api_client.get(f"{path}?period=all").json()["tags"]
        ids = {int(tag["id"]) for tag in tags}
        assert archived_id in ids
        assert hidden_id not in ids
        assert (
            next(tag for tag in tags if int(tag["id"]) == archived_id)["archived_at"]
            is not None
        )

        selected_tags = api_client.get(f"{path}?period=all&tags={hidden_id}").json()[
            "tags"
        ]
        assert hidden_id in {int(tag["id"]) for tag in selected_tags}
        excluded_tags = api_client.get(
            f"{path}?period=all&exclude_tags={hidden_id}"
        ).json()["tags"]
        assert hidden_id in {int(tag["id"]) for tag in excluded_tags}

    duplicate_response = api_client.post(
        "/api/tags",
        headers=csrf_headers,
        json={"name": "Past vacation", "is_hidden_from_budget": False},
    )
    assert duplicate_response.status_code == 400
    assert "restore it instead" in duplicate_response.json()["detail"]

    edit_response = api_client.put(
        f"/api/tags/{archived_id}",
        headers=csrf_headers,
        json={
            "name": "Past vacation edited",
            "is_hidden_from_budget": False,
            "is_hidden_from_filters": True,
        },
    )
    assert edit_response.status_code == 200
    assert edit_response.json()["archived_at"] is not None

    preserve_response = api_client.put(
        f"/api/tags/{archived_id}",
        headers=csrf_headers,
        json={
            "name": "Past vacation edited again",
            "is_hidden_from_budget": False,
        },
    )
    assert preserve_response.status_code == 200
    assert preserve_response.json()["is_hidden_from_filters"] is True

    restore_response = api_client.post(
        f"/api/tags/{archived_id}/restore", headers=csrf_headers
    )
    assert restore_response.status_code == 200
    restored = api_client.get("/api/tags?period=all").json()["tags"]
    assert archived_id in {int(tag["id"]) for tag in restored}

    assert (
        api_client.post("/api/tags/999999/archive", headers=csrf_headers).status_code
        == 404
    )
    assert (
        api_client.post("/api/tags/999999/restore", headers=csrf_headers).status_code
        == 404
    )


def test_tag_options_list_names_without_totals(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    kept = api_client.post("/api/tags", headers=csrf_headers, json={"name": "Trip"})
    archived = api_client.post("/api/tags", headers=csrf_headers, json={"name": "Old"})
    api_client.post(f"/api/tags/{archived.json()['id']}/archive", headers=csrf_headers)

    active = api_client.get("/api/tags/options").json()["tags"]
    everything = api_client.get("/api/tags/options?include_archived=true").json()[
        "tags"
    ]

    assert [(tag["id"], tag["name"]) for tag in active] == [(kept.json()["id"], "Trip")]
    assert "usage_count" not in active[0]
    assert {tag["name"] for tag in everything} == {"Trip", "Old"}


def test_tag_merge_refuses_different_budget_settings(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    excluded = api_client.post(
        "/api/tags",
        headers=csrf_headers,
        json={"name": "Work expense", "is_hidden_from_budget": True},
    ).json()["id"]
    counted = api_client.post(
        "/api/tags", headers=csrf_headers, json={"name": "Work"}
    ).json()["id"]

    for path in ("/api/tags/merge/preview", "/api/tags/merge"):
        response = api_client.post(
            path,
            headers=csrf_headers,
            json={"source_tag_id": excluded, "target_tag_id": counted},
        )
        assert (response.status_code, response.json()["detail"]) == (
            400,
            "Cannot merge tags with different budget settings: Work expense is "
            "excluded from budgets and Work is not. Change Exclude from budgets on "
            "one of them first.",
        )
    tags = api_client.get("/api/tags/options").json()["tags"]
    assert {tag["name"] for tag in tags} == {"Work expense", "Work"}


def test_transactions_take_existing_non_ascii_and_refuse_archived_tags(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    def create(tags: list[str]):
        return api_client.post(
            "/api/transactions",
            headers=csrf_headers,
            json={
                "date": "2026-03-01",
                "occurred_at": "2026-03-01T12:00:00",
                "type": "expense",
                "amount_cents": 290,
                "title": "Ticket",
                "tags": tags,
            },
        )

    first = create(["ÖPNV"])
    second = create(["ÖPNV"])
    assert first.status_code == 200
    assert second.status_code == 200, second.text
    tags = api_client.get("/api/tags").json()["tags"]
    assert [tag["name"] for tag in tags] == ["ÖPNV"]

    api_client.post(f"/api/tags/{tags[0]['id']}/archive", headers=csrf_headers)
    refused = create(["öpnv"])
    assert refused.status_code == 400
    assert "archived" in refused.json()["detail"]

    bulk = api_client.post(
        "/api/transactions/bulk/apply",
        headers=csrf_headers,
        json={
            "selection": {"mode": "ids", "transaction_ids": [first.json()["id"]]},
            "operation": {"tag_patch": {"mode": "add", "tags": ["ÖPNV"]}},
        },
    )
    assert bulk.status_code == 400


def test_renaming_deleting_or_merging_a_tag_moves_its_transactions_versions(
    api_client: TestClient, csrf_headers: dict[str, str]
) -> None:
    target = api_client.post(
        "/api/tags", headers=csrf_headers, json={"name": "Target"}
    ).json()["id"]

    def tagged(name: str) -> tuple[str, int]:
        response = api_client.post(
            "/api/transactions",
            headers=csrf_headers,
            json={
                "date": "2026-03-01",
                "occurred_at": "2026-03-01T12:00:00",
                "type": "expense",
                "amount_cents": 290,
                "title": "Ticket",
                "tags": [name],
            },
        )
        assert response.status_code == 200
        tag_id = next(
            tag["id"]
            for tag in api_client.get("/api/tags").json()["tags"]
            if tag["name"] == name
        )
        return f"/api/transactions/{response.json()['id']}", tag_id

    def version(url: str) -> str:
        return api_client.get(url).json()["updated_at"]

    renamed, tag_id = tagged("Business")
    before = version(renamed)
    response = api_client.put(
        f"/api/tags/{tag_id}",
        headers=csrf_headers,
        json={"name": "Work", "is_hidden_from_budget": False},
    )
    assert response.status_code == 200
    assert version(renamed) != before

    deleted, tag_id = tagged("Gone")
    before = version(deleted)
    response = api_client.delete(f"/api/tags/{tag_id}", headers=csrf_headers)
    assert response.status_code == 200
    assert version(deleted) != before

    merged, tag_id = tagged("Source")
    before = version(merged)
    response = api_client.post(
        "/api/tags/merge",
        headers=csrf_headers,
        json={"source_tag_id": tag_id, "target_tag_id": target},
    )
    assert response.status_code == 200
    assert version(merged) != before
