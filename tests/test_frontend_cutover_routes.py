from fastapi.routing import APIRoute

import expenses_web.app as main


def _registered_route_paths() -> set[str]:
    paths: set[str] = set()
    pending = list(main.app.router.routes)
    while pending:
        route = pending.pop()
        if isinstance(route, APIRoute):
            paths.add(route.path)
        else:
            nested_router = getattr(route, "original_router", route)
            pending.extend(getattr(nested_router, "routes", ()))
    return paths


def test_legacy_routes_are_not_registered() -> None:
    paths = _registered_route_paths()
    assert "/api/dashboard" in paths
    assert "/api/transactions" in paths
    assert "/api/reports/pdf" in paths
    assert "/api/templates" in paths
    assert "/api/admin/system-health" in paths
    assert "/api/digest" in paths
    assert "/api/insights/flow" in paths
    assert "/api/budgets/burndown" in paths
    assert "/api/forecast" in paths
    assert "/api/forecast/scenario" in paths

    assert "/transactions" not in paths
    assert "/reports/builder" not in paths
    assert "/reports/pdf" not in paths
    assert "/api/reports/data" not in paths
    assert "/components/kpis" not in paths
    assert "/admin" not in paths


def test_spa_fallback_serves_index_for_non_api_routes() -> None:
    response = main.frontend_entry("transactions")
    assert response.status_code in {200, 503}

    detail_response = main.frontend_entry("transactions/123")
    assert detail_response.status_code in {200, 503}

    edit_response = main.frontend_entry("transactions/123/edit")
    assert edit_response.status_code in {200, 503}

    templates_response = main.frontend_entry("templates")
    assert templates_response.status_code in {200, 503}


def test_legacy_post_routes_are_removed() -> None:
    paths = _registered_route_paths()
    assert "/reports/pdf" not in paths
    assert "/api/reports/data" not in paths
