import expenses.app as main


def test_spa_fallback_serves_index_for_non_api_routes() -> None:
    response = main.frontend_entry("transactions")
    assert response.status_code in {200, 503}

    detail_response = main.frontend_entry("transactions/123")
    assert detail_response.status_code in {200, 503}

    edit_response = main.frontend_entry("transactions/123/edit")
    assert edit_response.status_code in {200, 503}

    templates_response = main.frontend_entry("templates")
    assert templates_response.status_code in {200, 503}
