from datetime import UTC
from types import SimpleNamespace
from typing import Any, Self

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(autouse=True)
def mock_role_table_from_linked_legacy_profiles(monkeypatch) -> None:
    import app.main as main_module

    def get_roles(subject: str) -> list[dict[str, str]]:
        profile = main_module.get_linked_supabase_profile(subject)
        if profile is None:
            return []
        role = profile.get("role")
        if role == "extension_officer":
            role = "extension-officer"
        status = "suspended" if profile.get("is_active") is not True else "active"
        if role == "agrodealer" and profile.get("approval_status", "approved") != "approved":
            status = "pending"
        return [{"role": role, "status": status}] if isinstance(role, str) else []

    monkeypatch.setattr(main_module, "get_supabase_user_roles", get_roles)


def get_route_globals(path: str) -> dict[str, Any]:
    endpoint = next(
        route.endpoint for route in app.routes if getattr(route, "path", None) == path
    )
    return endpoint.__globals__


def create_test_sync_session(monkeypatch, role: str = "farmer") -> str:
    from app.supabase_client import InvalidSupabaseIdentityError

    farmer_id = "test-farmer-000001"
    subject = "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff10"
    draft_id = "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff11"
    queue_id = "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff12"
    route_globals = get_route_globals("/api/v1/farms/sync-status")
    drafts: dict[str, dict[str, Any]] = {}
    queued: set[str] = set()

    def verify_token(token: str) -> SimpleNamespace:
        if token != "test-access-token":
            raise InvalidSupabaseIdentityError("invalid")
        return SimpleNamespace(id=subject)

    def get_sync_status(requested_user: str) -> dict[str, Any] | None:
        if requested_user != farmer_id:
            return None
        return {
            "farmId": "farm-000001",
            "ownerVerified": True,
            "offlineDrafts": sum(
                draft["status"] in {"draft", "pending"} for draft in drafts.values()
            ),
            "pendingSyncs": len(queued),
        }

    def create_draft(
        requested_user: str,
        draft_type: str,
        payload: dict[str, Any],
        version: int | None,
        _client_draft_id: str | None = None,
    ) -> dict[str, Any] | None:
        if requested_user != farmer_id:
            return None
        draft = {
            "draftId": draft_id,
            "farmId": "farm-000001",
            "draftType": draft_type,
            "version": version,
            "payload": payload,
            "status": "draft",
            "createdAt": "2026-10-02T00:00:00Z",
        }
        drafts[draft_id] = draft
        return draft

    def queue_draft(
        requested_user: str, requested_draft: str, _payload: dict[str, Any]
    ) -> dict[str, Any]:
        if requested_user != farmer_id or requested_draft not in drafts:
            return {"status": "not_found"}
        if requested_draft in queued:
            return {"status": "conflict"}
        queued.add(requested_draft)
        drafts[requested_draft]["status"] = "pending"
        return {
            "status": "queued",
            "queueId": queue_id,
            "draftId": requested_draft,
            "farmId": "farm-000001",
            "createdAt": "2026-10-02T00:00:00Z",
        }

    monkeypatch.setitem(route_globals, "get_verified_supabase_user", verify_token)
    monkeypatch.setitem(
        route_globals,
        "get_linked_supabase_profile",
        lambda auth_subject: {"id": farmer_id, "role": role, "is_active": True}
        if auth_subject == subject
        else None,
    )
    monkeypatch.setitem(route_globals, "load_farmer_sync_status", get_sync_status)
    monkeypatch.setitem(route_globals, "create_farmer_sync_draft", create_draft)
    monkeypatch.setitem(route_globals, "queue_farmer_sync_draft", queue_draft)
    return "test-access-token"


client = TestClient(app)


def test_health_check() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_versioned_backend_health_and_config_are_exposed() -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["service"] == "SoilSync API"
    assert payload["apiVersion"] == "v1"
    config_response = client.get("/api/v1/config")
    assert config_response.status_code == 200
    config = config_response.json()
    assert config["appName"] == "SoilSync AI"
    assert config["environment"] in {"local", "development", "production"}
    assert config["demoMode"] is True


def test_versioned_preview_endpoint_validates_request_payloads() -> None:
    response = client.post(
        "/api/v1/soil-readings/preview",
        json={
            "readingId": "demo",
            "farmId": "farm-123",
            "measurements": [
                {"analyte": "soil_ph", "value": "not-a-number", "sourceUnit": "pH"},
            ],
        },
    )

    assert response.status_code == 422
    assert "detail" in response.json()


def test_demo_reading_is_loaded_from_database_repository(monkeypatch) -> None:
    import app.main as main_module
    from app.models import SoilReading

    database_reading = SoilReading(
        contract_version=1,
        reading_id="database-reading-test",
        farm_id=None,
        source={
            "provider": "DEMO",
            "dataset_id": None,
            "record_id": None,
            "license": None,
            "attribution": None,
            "retrieved_at": None,
        },
        sample={
            "sampled_at": None,
            "sample_year": None,
            "depth": {"source_label": None, "top_cm": None, "bottom_cm": None},
        },
        location={"latitude": None, "longitude": None, "uncertainty_m": None},
        measurements=[],
    )
    monkeypatch.setattr(main_module, "load_demo_soil_reading", lambda: database_reading)
    response = client.get("/api/v1/demo/soil-reading")

    assert response.status_code == 200
    payload = response.json()
    assert payload["contractVersion"] == 1
    assert payload["source"]["provider"] == "DEMO"
    assert payload["readingId"] == "database-reading-test"


def test_demo_recommendations_are_loaded_from_database_repository(monkeypatch) -> None:
    import app.main as main_module

    monkeypatch.setattr(main_module, "load_demo_recommendations", list)
    response = client.get("/api/v1/demo/recommendations")

    assert response.status_code == 200
    assert response.json() == []


def test_dashboard_data_is_loaded_from_database_repository(monkeypatch) -> None:
    import app.main as main_module

    seeded_data = {
        "users": [], "alerts": [], "farmVisits": [], "inventory": [],
        "summaryCards": [], "actionQueue": [], "recentItems": [],
    }
    monkeypatch.setattr(main_module, "load_dashboard_data", lambda _role: seeded_data)
    response = client.get("/api/v1/demo/dashboard/seed-data", params={"role": "admin"})

    assert response.status_code == 200
    assert response.json() == seeded_data


def test_agrodealer_catalog_is_loaded_from_database_repository(monkeypatch) -> None:
    import app.main as main_module

    catalog = {
        "dealer": {
            "businessName": "Mwangi Agro", "county": "Makueni", "subCounty": None,
            "ward": "Makueni", "locationVerified": False, "hasCoordinates": False,
            "demo": True,
        },
        "products": [],
    }
    monkeypatch.setattr(main_module, "load_agrodealer_catalog", lambda: catalog)
    response = client.get("/api/v1/demo/agrodealer/catalog")

    assert response.status_code == 200
    assert response.json() == catalog


def test_dealer_catalog_is_private_to_authenticated_dealer(monkeypatch) -> None:
    auth_subject = "74f9f7e6-8065-4e76-a0d4-0ca4c56d72a8"
    dealer_user_id = "app-dealer-000001"
    current_role = {"value": "farmer"}
    route_globals = get_route_globals("/api/v1/agrodealer/me/catalog")
    monkeypatch.setitem(
        route_globals,
        "get_verified_request_user",
        lambda _request: ("verified-token", SimpleNamespace(id=auth_subject)),
    )
    monkeypatch.setitem(
        route_globals,
        "get_linked_supabase_profile",
        lambda subject: {"id": dealer_user_id, "role": current_role["value"], "is_active": True}
        if subject == auth_subject
        else None,
    )
    private_catalog = {
        "dealer": {"id": "dealer-1", "businessName": "Private Dealer", "demo": False},
        "products": [{"id": "private-product", "name": "Private stock", "demo": False}],
    }
    requested_users: list[str] = []

    def load_private_catalog(requested_user: str) -> dict[str, object] | None:
        requested_users.append(requested_user)
        return private_catalog if requested_user == dealer_user_id else None

    monkeypatch.setitem(route_globals, "load_authenticated_agrodealer_catalog", load_private_catalog)

    denied = client.get("/api/v1/agrodealer/me/catalog")
    assert denied.status_code == 403

    current_role["value"] = "agrodealer"
    response = client.get("/api/v1/agrodealer/me/catalog", params={"dealerId": "forged-dealer"})
    retired_public_path = client.get("/api/v1/agrodealer/catalog")

    assert response.status_code == 200
    assert response.json() == private_catalog
    assert requested_users == [dealer_user_id]
    assert retired_public_path.status_code == 404


def test_database_backed_screen_endpoints_fail_closed_without_database_data(monkeypatch) -> None:
    from app.database import DatabaseUnavailable

    def unavailable(*_args: object) -> None:
        raise DatabaseUnavailable("database unavailable")

    route_globals = next(
        route.endpoint.__globals__
        for route in client.app.routes
        if getattr(route, "path", None) == "/api/v1/demo/dashboard/seed-data"
    )
    monkeypatch.setitem(route_globals, "load_dashboard_data", unavailable)
    monkeypatch.setitem(route_globals, "load_demo_soil_reading", unavailable)
    monkeypatch.setitem(route_globals, "load_demo_recommendations", unavailable)
    monkeypatch.setitem(route_globals, "load_agrodealer_catalog", unavailable)

    responses = [
        client.get("/api/v1/demo/dashboard/seed-data", params={"role": "admin"}),
        client.get("/api/v1/demo/soil-reading"),
        client.get("/api/v1/demo/recommendations"),
        client.get("/api/v1/demo/agrodealer/catalog"),
    ]

    assert [response.status_code for response in responses] == [503, 503, 503, 503]


def test_role_query_dashboard_is_explicitly_demo_only() -> None:
    demo_response = client.get("/api/v1/demo/dashboard/seed-data", params={"role": "admin"})
    production_response = client.get("/api/v1/dashboard/seed-data", params={"role": "admin"})

    assert production_response.status_code == 404
    assert demo_response.status_code in {200, 503}


def test_project_dataset_reference_benchmarks_are_cached() -> None:
    from app.recommendations import _generate_real_data_benchmarks

    _generate_real_data_benchmarks.cache_clear()
    first_result = _generate_real_data_benchmarks()
    second_result = _generate_real_data_benchmarks()

    assert second_result == first_result
    assert _generate_real_data_benchmarks.cache_info().hits == 1
    _generate_real_data_benchmarks.cache_clear()


def test_provider_status_is_exposed_without_claiming_real_data_access() -> None:
    response = client.get("/api/v1/demo/provider-status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "DEMO_ONLY"
    assert any(item["name"] == "PROJECT_SOIL_DATASET" for item in payload["providers"])
    assert any(item["status"] == "pending_approval" for item in payload["providers"])


def test_provider_registry_has_expected_future_status_values() -> None:
    from app.providers import get_provider_status_summary

    summary = get_provider_status_summary()

    assert summary.mode == "DEMO_ONLY"
    assert {item.name for item in summary.providers} == {
        "PROJECT_SOIL_DATASET",
        "ISRIC_WOSIS",
        "ISRIC_SOILGRIDS",
        "SUPABASE",
    }
    assert all(item.ready is False for item in summary.providers)


def test_soilgrids_wcs_capabilities_parse_approved_coverage_ids() -> None:
    from app.providers import parse_soilgrids_capabilities

    xml = '''
    <wcs:Capabilities xmlns:wcs="http://www.opengis.net/wcs/2.0" xmlns:ows="http://www.opengis.net/ows/2.0">
      <wcs:Contents>
        <wcs:CoverageSummary>
          <wcs:CoverageId>phh2o_0-5cm_Q0.5</wcs:CoverageId>
        </wcs:CoverageSummary>
        <wcs:CoverageSummary>
          <wcs:CoverageId>soc_0-5cm_Q0.5</wcs:CoverageId>
        </wcs:CoverageSummary>
      </wcs:Contents>
    </wcs:Capabilities>
    '''

    assert parse_soilgrids_capabilities(xml) == ["phh2o_0-5cm_Q0.5", "soc_0-5cm_Q0.5"]


def test_soilgrids_provider_summary_reports_approved_capabilities(monkeypatch) -> None:
    from app import providers

    def fake_fetch() -> list[str]:
        return ["phh2o_0-5cm_Q0.5", "soc_0-5cm_Q0.5", "unsupported_layer"]

    monkeypatch.setattr(providers, "fetch_soilgrids_capabilities", fake_fetch)

    response = client.get("/api/v1/providers/soilgrids/summary")

    assert response.status_code == 200
    payload = response.json()
    assert payload["provider"] == "ISRIC_SOILGRIDS"
    assert payload["status"] == "pending_approval"
    assert payload["estimated"] is True
    assert payload["availableCoverageIds"] == ["phh2o_0-5cm_Q0.5", "soc_0-5cm_Q0.5"]


def test_soilgrids_point_lookup_validates_approved_coverage_and_bounded_bbox(monkeypatch) -> None:
    from app import providers

    def fake_fetch_coverage(coverage_id: str, bbox: tuple[float, float, float, float], **_: object) -> dict[str, object]:
        return {
            "coverageId": coverage_id,
            "statusCode": 200,
            "estimated": True,
            "bbox": list(bbox),
            "contentType": "image/tiff",
        }

    monkeypatch.setattr(providers, "fetch_soilgrids_coverage", fake_fetch_coverage)

    response = client.get(
        "/api/v1/providers/soilgrids/coverage",
        params={"coverageId": "phh2o_0-5cm_Q0.5", "latitude": "-1.5", "longitude": "36.7"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["coverageId"] == "phh2o_0-5cm_Q0.5"
    assert payload["estimated"] is True
    assert payload["statusCode"] == 200
    assert payload["bbox"][0] < payload["bbox"][2]

    invalid = client.get(
        "/api/v1/providers/soilgrids/coverage",
        params={"coverageId": "unsupported_layer", "latitude": "-1.5", "longitude": "36.7"},
    )
    assert invalid.status_code == 400


def test_wosis_graphql_response_filters_eligible_records() -> None:
    from app.providers import filter_eligible_wosis_records

    payload = {
        "data": {
            "soilProfiles": [
                {"id": "profile-1", "license": "CC-BY-4.0"},
                {"id": "profile-2", "license": "CC-BY-NC"},
                {"id": "profile-3", "license": "unknown"},
            ]
        }
    }

    records = filter_eligible_wosis_records(payload)
    assert [item["id"] for item in records] == ["profile-1"]


def test_sync_api_has_no_shared_runtime_state_registry() -> None:
    route_globals = get_route_globals("/api/v1/farms/sync-status")

    assert "SYNC_DRAFTS" not in route_globals
    assert "SYNC_QUEUE" not in route_globals


def test_unverified_registration_and_login_fail_closed() -> None:
    register_response = client.post(
        "/api/v1/auth/register",
        json={"name": "Ada", "phone": "+254700000001", "farmName": "Ada's Farm"},
    )
    assert register_response.status_code == 501

    login_response = client.post(
        "/api/v1/auth/login",
        json={"phone": "+254700000001", "otp": "123456"},
    )
    assert login_response.status_code == 501

    protected_gets = (
        "/api/v1/farms/me",
        "/api/v1/farms",
        "/api/v1/farms/farm-demo/ownership",
        "/api/v1/farms/farm-demo/readings",
        "/api/v1/farms/farm-demo/recommendations",
        "/api/v1/farms/sync-status",
    )
    for path in protected_gets:
        assert client.get(path).status_code == 401

    protected_posts = (
        ("/api/v1/farms", {"name": "Ada's Farm"}),
        ("/api/v1/farms/farm-demo/readings", {"measurements": [{"analyte": "soil_ph", "value": 5.4, "sourceUnit": "pH", "qualityStatus": "valid"}]}),
        ("/api/v1/recommendations/recommendation-demo/feedback", {"response": "viewed"}),
        ("/api/v1/farms/sync-drafts", {}),
        (
            "/api/v1/farms/sync-submit",
            {"draftId": "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff11", "payload": {}},
        ),
    )
    for path, payload in protected_posts:
        assert client.post(path, json=payload).status_code == 401

    route_globals = get_route_globals("/api/v1/farms/sync-status")
    assert "SYNC_DRAFTS" not in route_globals
    assert "SYNC_QUEUE" not in route_globals


def test_logout_verifies_and_revokes_current_supabase_session(monkeypatch) -> None:
    from app.supabase_client import InvalidSupabaseIdentityError

    logout_endpoint = next(
        route.endpoint for route in app.routes if getattr(route, "path", None) == "/api/v1/auth/logout"
    )
    route_globals = logout_endpoint.__globals__
    auth_user = SimpleNamespace(id="4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff10")
    revoked_tokens: list[str] = []

    def verify_token(token: str) -> SimpleNamespace:
        if token != "valid-token":
            raise InvalidSupabaseIdentityError("invalid")
        return auth_user

    monkeypatch.setitem(route_globals, "get_verified_supabase_user", verify_token)
    monkeypatch.setitem(route_globals, "revoke_supabase_session", revoked_tokens.append)

    invalid_response = client.post("/api/v1/auth/logout", headers={"Authorization": "Bearer expired-token"})
    assert invalid_response.status_code == 401

    response = client.post("/api/v1/auth/logout", headers={"Authorization": "Bearer valid-token"})
    assert response.status_code == 200
    assert response.json()["status"] == "logged_out"
    assert revoked_tokens == ["valid-token"]


def test_non_farmer_supabase_role_cannot_access_farmer_endpoints(monkeypatch) -> None:
    access_token = create_test_sync_session(monkeypatch, role="admin")

    response = client.get(
        "/api/v1/farms/sync-status",
        headers={"Authorization": f"Bearer {access_token}"},
    )

    assert response.status_code == 403


def test_officer_routes_require_server_role_and_use_assigned_data(monkeypatch) -> None:
    auth_subject = "74f9f7e6-8065-4e76-a0d4-0ca4c56d72a8"
    officer_user_id = "app-officer-000001"
    route_globals = get_route_globals("/api/v1/officer/farmers")
    monkeypatch.setitem(
        route_globals,
        "get_verified_request_user",
        lambda _request: ("verified-token", SimpleNamespace(id=auth_subject)),
    )
    current_role = {"value": "farmer"}
    monkeypatch.setitem(
        route_globals,
        "get_linked_supabase_profile",
        lambda subject: {"id": officer_user_id, "role": current_role["value"], "is_active": True}
        if subject == auth_subject
        else None,
    )
    assignments = [{
        "assignmentId": "assignment-1",
        "county": "Makueni",
        "subCounty": "Kibwezi East",
        "ward": "Kiboko",
        "assignedAt": "2026-10-02T00:00:00Z",
    }]
    roster = [{
        "farmerId": "farmer-1",
        "name": "Amina",
        "farmId": "farm-1",
        "farmName": "Kiboko Farm",
        "county": "Makueni",
        "subCounty": "Kibwezi East",
        "ward": "Kiboko",
        "readingCount": 2,
    }]
    scoped_users: list[str] = []

    def load_assignments(requested_officer: str) -> list[dict[str, object]]:
        scoped_users.append(requested_officer)
        return assignments

    def load_roster(requested_officer: str) -> list[dict[str, object]]:
        scoped_users.append(requested_officer)
        return roster

    monkeypatch.setitem(route_globals, "load_officer_jurisdictions", load_assignments)
    monkeypatch.setitem(route_globals, "load_officer_farmer_roster", load_roster)

    denied = client.get("/api/v1/officer/farmers")
    assert denied.status_code == 403

    current_role["value"] = "extension_officer"
    jurisdiction_response = client.get("/api/v1/officer/jurisdictions", params={"role": "admin"})
    roster_response = client.get("/api/v1/officer/farmers", params={"role": "admin"})
    assert jurisdiction_response.status_code == 200
    assert jurisdiction_response.json() == assignments
    assert roster_response.status_code == 200
    assert roster_response.json() == roster
    assert scoped_users == [officer_user_id, officer_user_id]


def test_auth_link_requires_verified_bearer_and_does_not_accept_client_role(monkeypatch) -> None:
    from app.supabase_client import InvalidSupabaseIdentityError

    auth_user = SimpleNamespace(id="4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff10")
    link_calls: list[tuple[object, str | None]] = []

    def verify_token(token: str) -> object:
        if token != "verified-token":
            raise InvalidSupabaseIdentityError("invalid")
        return auth_user

    def link_profile(user: object, display_name: str | None) -> dict[str, object]:
        link_calls.append((user, display_name))
        return {"id": "app-user-1", "role": "farmer", "is_active": True}

    link_endpoint = next(
        route.endpoint for route in app.routes if getattr(route, "path", None) == "/api/v1/auth/link"
    )
    monkeypatch.setitem(link_endpoint.__globals__, "get_verified_supabase_user", verify_token)
    monkeypatch.setitem(link_endpoint.__globals__, "link_supabase_user_profile", link_profile)
    monkeypatch.setitem(
        link_endpoint.__globals__,
        "get_supabase_user_roles",
        lambda _subject: [{"role": "farmer", "status": "active"}],
    )
    monkeypatch.setitem(link_endpoint.__globals__, "persist_runtime_state", lambda: None)

    missing_token = client.post("/api/v1/auth/link", json={})
    assert missing_token.status_code == 401

    invalid_token = client.post(
        "/api/v1/auth/link",
        headers={"Authorization": "Bearer invalid-token"},
        json={},
    )
    assert invalid_token.status_code == 401

    response = client.post(
        "/api/v1/auth/link",
        headers={"Authorization": "Bearer verified-token"},
        json={"displayName": "Ada", "role": "admin"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "status": "linked",
        "appUserId": "app-user-1",
        "identityProvider": "supabase",
        "role": "farmer",
    }
    assert link_calls == [(auth_user, "Ada")]


def test_auth_link_rejects_inactive_and_pending_dealer_profiles(monkeypatch) -> None:
    auth_user = SimpleNamespace(id="4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff10")
    profiles = iter(
        [
            {"id": "inactive-user", "role": "farmer", "is_active": False},
            {
                "id": "pending-dealer",
                "role": "agrodealer",
                "is_active": True,
                "approval_status": "pending",
            },
        ]
    )
    link_endpoint = next(
        route.endpoint for route in app.routes if getattr(route, "path", None) == "/api/v1/auth/link"
    )
    monkeypatch.setitem(
        link_endpoint.__globals__,
        "get_verified_supabase_user",
        lambda _token: auth_user,
    )
    monkeypatch.setitem(
        link_endpoint.__globals__,
        "link_supabase_user_profile",
        lambda _user, _name: next(profiles),
    )
    monkeypatch.setitem(
        link_endpoint.__globals__,
        "get_supabase_user_roles",
        lambda _subject: [{"role": "agrodealer", "status": "pending"}],
    )
    monkeypatch.setitem(link_endpoint.__globals__, "persist_runtime_state", lambda: None)

    inactive_response = client.post(
        "/api/v1/auth/link",
        headers={"Authorization": "Bearer verified-token"},
        json={},
    )
    pending_dealer_response = client.post(
        "/api/v1/auth/link",
        headers={"Authorization": "Bearer verified-token"},
        json={},
    )

    assert inactive_response.status_code == 403
    assert inactive_response.json()["detail"] == "This account is inactive. Contact an administrator."
    assert pending_dealer_response.status_code == 403
    assert pending_dealer_response.json()["detail"] == "This agrodealer account is awaiting approval."


def test_api_role_authorization_uses_user_roles_not_legacy_role(monkeypatch) -> None:
    import app.main as main_module

    auth_subject = "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff10"
    monkeypatch.setattr(
        main_module,
        "get_verified_request_user",
        lambda _request: ("token", SimpleNamespace(id=auth_subject)),
    )
    monkeypatch.setattr(
        main_module,
        "get_linked_supabase_profile",
        lambda _subject: {"id": "app-user", "role": "admin", "is_active": True},
    )
    current_roles = [{"role": "admin", "status": "suspended"}]
    monkeypatch.setattr(
        main_module,
        "get_supabase_user_roles",
        lambda _subject: current_roles,
    )

    with pytest.raises(HTTPException) as denied:
        main_module.require_role(SimpleNamespace(), "admin")
    assert denied.value.status_code == 403

    current_roles[:] = [
        {"role": "farmer", "status": "active"},
        {"role": "admin", "status": "active"},
    ]
    assert main_module.require_role(SimpleNamespace(), "admin") == "app-user"


def test_dealer_api_authorization_rejects_pending_profile(monkeypatch) -> None:
    from app import main

    monkeypatch.setattr(
        main,
        "get_verified_request_user",
        lambda _request: ("verified-token", SimpleNamespace(id="auth-dealer")),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda _subject: {
            "id": "dealer-user",
            "role": "agrodealer",
            "is_active": True,
            "approval_status": "pending",
        },
    )

    with pytest.raises(HTTPException) as error:
        main.require_dealer_session(SimpleNamespace())

    assert error.value.status_code == 403
    assert error.value.detail == "This agrodealer account is awaiting approval."


def test_supabase_identity_link_creates_farmer_only_from_verified_phone(monkeypatch) -> None:
    from app import supabase_client

    monkeypatch.setattr(supabase_client, "_sync_linked_user_roles", lambda *_args: None)
    monkeypatch.setattr(supabase_client, "_sync_linked_supabase_profile", lambda *_args: None)

    class FakeQuery:
        def __init__(self, rows: list[dict[str, object]]) -> None:
            self.rows = rows
            self.filters: dict[str, object] = {}
            self.operation = "select"
            self.payload: dict[str, object] = {}

        def select(self, _columns: str) -> "FakeQuery":
            return self

        def eq(self, column: str, value: object) -> "FakeQuery":
            self.filters[column] = value
            return self

        def limit(self, _count: int) -> "FakeQuery":
            return self

        def update(self, payload: dict[str, object]) -> "FakeQuery":
            self.operation = "update"
            self.payload = payload
            return self

        def insert(self, payload: dict[str, object]) -> "FakeQuery":
            self.operation = "insert"
            self.payload = payload
            return self

        def execute(self) -> SimpleNamespace:
            if self.operation == "insert":
                inserted = {**self.payload, "id": "app-user-1"}
                self.rows.append(inserted)
                return SimpleNamespace(data=[inserted])

            matching = [
                row
                for row in self.rows
                if all(row.get(key) == value for key, value in self.filters.items())
            ]
            if self.operation == "update":
                for row in matching:
                    row.update(self.payload)
            return SimpleNamespace(data=matching[:2])

    class FakeClient:
        def __init__(self) -> None:
            self.users: list[dict[str, object]] = []

        def table(self, _name: str) -> FakeQuery:
            return FakeQuery(self.users)

    fake_client = FakeClient()
    monkeypatch.setattr(supabase_client, "create_supabase_server_client", lambda: fake_client)
    auth_user = SimpleNamespace(
        id="4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff10",
        phone="+254700000001",
        phone_confirmed_at="2026-10-01T00:00:00Z",
        email=None,
        email_confirmed_at=None,
    )

    profile = supabase_client.link_supabase_user_profile(auth_user, "Ada")

    assert profile["id"] == "app-user-1"
    assert profile["supabase_auth_user_id"] == auth_user.id
    assert profile["phone"] == auth_user.phone
    assert profile["role"] == "farmer"
    assert fake_client.users == [profile]


def test_supabase_identity_link_allows_verified_email_self_registration_as_farmer(monkeypatch) -> None:
    from app import supabase_client

    monkeypatch.setattr(supabase_client, "_sync_linked_user_roles", lambda *_args: None)
    monkeypatch.setattr(supabase_client, "_sync_linked_supabase_profile", lambda *_args: None)

    class FakeQuery:
        def __init__(self) -> None:
            self.payload: dict[str, object] | None = None

        def select(self, _columns: str) -> "FakeQuery":
            return self

        def eq(self, _column: str, _value: object) -> "FakeQuery":
            return self

        def limit(self, _count: int) -> "FakeQuery":
            return self

        def insert(self, payload: dict[str, object]) -> "FakeQuery":
            self.payload = payload
            return self

        def execute(self) -> SimpleNamespace:
            if self.payload is None:
                return SimpleNamespace(data=[])
            return SimpleNamespace(data=[{**self.payload, "id": "app-user-email"}])

    class FakeClient:
        def table(self, _name: str) -> FakeQuery:
            return FakeQuery()

    monkeypatch.setattr(supabase_client, "create_supabase_server_client", FakeClient)
    auth_user = SimpleNamespace(
        id="4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff10",
        phone=None,
        phone_confirmed_at=None,
        email="farmer@example.test",
        email_confirmed_at="2026-10-01T00:00:00Z",
    )

    profile = supabase_client.link_supabase_user_profile(auth_user, "Amina Njeri")

    assert profile["email"] == auth_user.email
    assert profile["phone"] is None
    assert profile["display_name"] == "Amina Njeri"
    assert profile["role"] == "farmer"


def test_supabase_identity_link_preserves_invited_role_by_verified_email(monkeypatch) -> None:
    from app import supabase_client

    monkeypatch.setattr(supabase_client, "_sync_linked_user_roles", lambda *_args: None)
    monkeypatch.setattr(supabase_client, "_sync_linked_supabase_profile", lambda *_args: None)

    invited_profile = {
        "id": "app-admin-1",
        "role": "admin",
        "email": "admin@example.test",
        "phone": None,
        "supabase_auth_user_id": None,
    }

    class FakeQuery:
        def __init__(self, rows: list[dict[str, object]]) -> None:
            self.rows = rows
            self.filters: dict[str, object] = {}
            self.payload: dict[str, object] = {}

        def select(self, _columns: str) -> "FakeQuery":
            return self

        def eq(self, column: str, value: object) -> "FakeQuery":
            self.filters[column] = value
            return self

        def limit(self, _count: int) -> "FakeQuery":
            return self

        def update(self, payload: dict[str, object]) -> "FakeQuery":
            self.payload = payload
            return self

        def execute(self) -> SimpleNamespace:
            matching = [
                row
                for row in self.rows
                if all(row.get(key) == value for key, value in self.filters.items())
            ]
            for row in matching:
                row.update(self.payload)
            return SimpleNamespace(data=matching[:2])

    class FakeClient:
        def table(self, _name: str) -> FakeQuery:
            return FakeQuery([invited_profile])

    monkeypatch.setattr(supabase_client, "create_supabase_server_client", FakeClient)
    auth_user = SimpleNamespace(
        id="4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff10",
        phone=None,
        phone_confirmed_at=None,
        email="admin@example.test",
        email_confirmed_at="2026-10-01T00:00:00Z",
    )

    profile = supabase_client.link_supabase_user_profile(auth_user)

    assert profile["role"] == "admin"
    assert profile["supabase_auth_user_id"] == auth_user.id


def test_legacy_user_roles_are_moved_to_auth_uuid_and_normalized() -> None:
    from app.supabase_client import _sync_linked_user_roles

    role_rows: list[dict[str, str]] = [
        {
            "user_id": "app-user",
            "role": "extension_officer",
            "status": "pending",
        }
    ]

    class RoleQuery:
        def __init__(self) -> None:
            self.filters: dict[str, str] = {}
            self.payload: dict[str, str] = {}
            self.operation = "select"

        def select(self, _columns: str) -> "RoleQuery":
            return self

        def eq(self, column: str, value: str) -> "RoleQuery":
            self.filters[column] = value
            return self

        def upsert(self, payload: dict[str, str], on_conflict: str) -> "RoleQuery":
            assert on_conflict == "user_id,role"
            self.payload = payload
            self.operation = "upsert"
            return self

        def delete(self) -> "RoleQuery":
            self.operation = "delete"
            return self

        def update(self, payload: dict[str, str]) -> "RoleQuery":
            self.payload = payload
            self.operation = "update"
            return self

        def execute(self) -> SimpleNamespace:
            matching = [
                row
                for row in role_rows
                if all(row.get(key) == value for key, value in self.filters.items())
            ]
            if self.operation == "upsert":
                existing = next(
                    (
                        row
                        for row in role_rows
                        if row["user_id"] == self.payload["user_id"]
                        and row["role"] == self.payload["role"]
                    ),
                    None,
                )
                if existing:
                    existing.update(self.payload)
                else:
                    role_rows.append(self.payload.copy())
            elif self.operation == "delete":
                role_rows[:] = [row for row in role_rows if row not in matching]
            elif self.operation == "update":
                for row in matching:
                    row.update(self.payload)
            return SimpleNamespace(data=matching)

    class RoleClient:
        def table(self, _table: str) -> RoleQuery:
            return RoleQuery()

    _sync_linked_user_roles(
        RoleClient(),
        {
            "id": "app-user",
            "role": "extension_officer",
            "is_active": True,
            "approval_status": "approved",
        },
        "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff10",
    )

    assert role_rows == [
        {
            "user_id": "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff10",
            "role": "extension-officer",
            "status": "pending",
        }
    ]


def test_supabase_token_verification_rejects_unconfirmed_identity(monkeypatch) -> None:
    from app import supabase_client
    from app.supabase_client import InvalidSupabaseIdentityError

    auth_user = SimpleNamespace(
        id="4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff10",
        email_confirmed_at=None,
        phone_confirmed_at=None,
    )
    monkeypatch.setattr(
        supabase_client,
        "create_supabase_public_client",
        lambda: SimpleNamespace(
            auth=SimpleNamespace(
                get_user=lambda _token: SimpleNamespace(user=auth_user),
            )
        ),
    )

    with pytest.raises(InvalidSupabaseIdentityError, match="verified email address or phone"):
        supabase_client.get_verified_supabase_user("unconfirmed-token")


def test_phase_2_3_sync_drafts_and_conflicts_are_tracked(monkeypatch) -> None:
    access_token = create_test_sync_session(monkeypatch)
    headers = {"Authorization": f"Bearer {access_token}"}

    expired_token_response = client.get(
        "/api/v1/farms/sync-status",
        headers={"Authorization": "Bearer expired-token"},
    )
    assert expired_token_response.status_code == 401

    legacy_session_response = client.get(
        "/api/v1/farms/sync-status",
        headers={"X-Session-ID": access_token},
    )
    assert legacy_session_response.status_code == 401

    draft_response = client.post(
        "/api/v1/farms/sync-drafts",
        headers=headers,
        json={
            "draftType": "soil-reading",
            "payload": {"readingId": "reading-002", "farmId": "farm-000002"},
            "version": 1,
        },
    )
    assert draft_response.status_code == 201
    draft_payload = draft_response.json()
    assert draft_payload["status"] == "draft_created"
    assert draft_payload["draftId"] == "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff11"

    sync_status = client.get(
        "/api/v1/farms/sync-status",
        headers=headers,
    )
    assert sync_status.status_code == 200
    status_payload = sync_status.json()
    assert status_payload["offlineDrafts"] == 1
    assert status_payload["pendingSyncs"] == 0

    submit_response = client.post(
        "/api/v1/farms/sync-submit",
        headers=headers,
        json={
            "draftId": draft_payload["draftId"],
            "payload": {"readingId": "reading-002", "farmId": "farm-000002"},
        },
    )
    assert submit_response.status_code == 200
    assert submit_response.json()["status"] == "queued"

    duplicate_response = client.post(
        "/api/v1/farms/sync-submit",
        headers=headers,
        json={
            "draftId": draft_payload["draftId"],
            "payload": {"readingId": "reading-002", "farmId": "farm-000002"},
        },
    )
    assert duplicate_response.status_code == 409
    assert duplicate_response.json()["status"] == "conflict"


def test_farmer_cannot_submit_another_accounts_sync_draft(monkeypatch) -> None:
    access_token = create_test_sync_session(monkeypatch)
    owner_headers = {"Authorization": f"Bearer {access_token}"}
    draft_response = client.post(
        "/api/v1/farms/sync-drafts",
        headers=owner_headers,
        json={"draftType": "soil-reading", "payload": {}, "version": 1},
    )
    draft_id = draft_response.json()["draftId"]

    other_farmer_id = "test-farmer-000003"
    other_subject = "74f9f7e6-8065-4e76-a0d4-0ca4c56d72a8"
    route_globals = get_route_globals("/api/v1/farms/sync-status")
    monkeypatch.setitem(
        route_globals,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=other_subject) if token == "other-access-token" else None,
    )
    monkeypatch.setitem(
        route_globals,
        "get_linked_supabase_profile",
        lambda subject: {"id": other_farmer_id, "role": "farmer", "is_active": True}
        if subject == other_subject
        else None,
    )

    response = client.post(
        "/api/v1/farms/sync-submit",
        headers={"Authorization": "Bearer other-access-token"},
        json={"draftId": draft_id, "payload": {}},
    )

    assert response.status_code == 404


def test_farmer_data_routes_bind_every_operation_to_verified_profile(monkeypatch) -> None:
    from app.models import SoilReading, SoilRecommendation

    user_id = "app-user-000001"
    farm_id = "farm-000001"
    recommendation_id = "recommendation-000001"
    route_globals = get_route_globals("/api/v1/farms")
    monkeypatch.setitem(route_globals, "require_session", lambda _request: user_id)
    monkeypatch.setitem(
        route_globals,
        "load_farmer_account",
        lambda requested_user: {"userId": requested_user, "name": "Ada", "phone": "+254700000001"}
        if requested_user == user_id
        else None,
    )

    farm = {
        "farmId": farm_id,
        "name": "Ada's Farm",
        "county": "Makueni",
        "ward": "Kathonzweni",
        "latitude": None,
        "longitude": None,
        "ownerVerified": True,
        "createdAt": "2026-10-01T00:00:00Z",
        "updatedAt": "2026-10-01T00:00:00Z",
    }
    created_farms: list[tuple[object, ...]] = []
    monkeypatch.setitem(route_globals, "load_farmer_farms", lambda requested_user: [farm] if requested_user == user_id else [])
    monkeypatch.setitem(
        route_globals,
        "create_farmer_farm",
        lambda *args: created_farms.append(args) or farm,
    )

    farms_response = client.get("/api/v1/farms", headers={"Authorization": "Bearer test-token"})
    profile_response = client.get("/api/v1/farms/me", headers={"Authorization": "Bearer test-token"})
    create_farm_response = client.post(
        "/api/v1/farms",
        headers={"Authorization": "Bearer test-token"},
        json={"name": "Ada's Farm", "county": "Makueni", "ward": "Kathonzweni"},
    )
    assert farms_response.status_code == 200
    assert farms_response.json()[0]["farmId"] == farm_id
    assert profile_response.status_code == 200
    assert profile_response.json()["farmerId"] == user_id
    assert profile_response.json()["farmId"] == farm_id
    assert create_farm_response.status_code == 201
    assert created_farms == [(user_id, "Ada's Farm", "Makueni", "Kathonzweni")]

    reading = SoilReading.model_validate(
        {
            "contractVersion": 1,
            "readingId": "reading-000001",
            "farmId": farm_id,
            "source": {"provider": "FARMER_OBSERVATION", "datasetId": None, "recordId": None,
                       "license": None, "attribution": "Farmer supplied", "retrievedAt": None},
            "sample": {"sampledAt": None, "sampleYear": None, "depth": {"sourceLabel": None,
                       "topCm": None, "bottomCm": None}},
            "location": {"latitude": None, "longitude": None, "uncertaintyM": None},
            "measurements": [{"analyte": "soil_ph", "value": 5.4, "sourceUnit": "pH",
                              "canonicalUnit": None, "analyticalMethod": None,
                              "qualityStatus": "valid", "uncertainty": None}],
        }
    )
    reading_calls: list[tuple[object, ...]] = []
    monkeypatch.setitem(route_globals, "load_farmer_farm", lambda requested_user, requested_farm: farm if (requested_user, requested_farm) == (user_id, farm_id) else None)
    monkeypatch.setitem(route_globals, "load_farmer_soil_readings", lambda requested_user, requested_farm: [reading] if (requested_user, requested_farm) == (user_id, farm_id) else [])
    monkeypatch.setitem(route_globals, "create_farmer_soil_reading", lambda *args: reading_calls.append(args) or reading)
    readings_response = client.get(
        f"/api/v1/farms/{farm_id}/readings", headers={"Authorization": "Bearer test-token"}
    )
    create_reading_response = client.post(
        f"/api/v1/farms/{farm_id}/readings",
        headers={"Authorization": "Bearer test-token"},
        json={"measurements": [{"analyte": "soil_ph", "value": 5.4, "sourceUnit": "pH", "qualityStatus": "valid"}]},
    )
    assert readings_response.status_code == 200
    assert readings_response.json()[0]["readingId"] == "reading-000001"
    assert create_reading_response.status_code == 201
    assert reading_calls[0][0:2] == (user_id, farm_id)

    recommendation = SoilRecommendation(
        recommendation_id=recommendation_id,
        farm_id=farm_id,
        crop="maize",
        title="Review soil results",
        rationale="Demo rule awaiting agronomic review.",
        application_rate=None,
        application_unit=None,
        rule_version="test",
        review_status="pending_review",
    )
    recommendation_calls: list[tuple[object, ...]] = []
    feedback_calls: list[tuple[object, ...]] = []
    monkeypatch.setitem(route_globals, "load_farmer_recommendations", lambda *args: recommendation_calls.append(args) or [recommendation])
    monkeypatch.setitem(route_globals, "create_farmer_recommendation_feedback", lambda *args: feedback_calls.append(args) or {"feedbackId": "feedback-1", "recommendationId": recommendation_id, "response": args[2], "createdAt": "2026-10-01T00:00:00Z"})
    monkeypatch.setitem(route_globals, "load_farmer_recommendation_feedback", lambda requested_user, requested_recommendation: [{"feedbackId": "feedback-1", "recommendationId": requested_recommendation, "response": "viewed", "createdAt": "2026-10-01T00:00:00Z"}] if requested_user == user_id else [])
    recommendations_response = client.get(
        f"/api/v1/farms/{farm_id}/recommendations", headers={"Authorization": "Bearer test-token"}
    )
    feedback_response = client.post(
        f"/api/v1/recommendations/{recommendation_id}/feedback",
        headers={"Authorization": "Bearer test-token"},
        json={"response": "not-followed"},
    )
    feedback_history_response = client.get(
        f"/api/v1/recommendations/{recommendation_id}/feedback",
        headers={"Authorization": "Bearer test-token"},
    )
    assert recommendations_response.status_code == 200
    assert recommendation_calls == [(user_id, farm_id)]
    assert feedback_response.status_code == 201
    assert feedback_calls == [(user_id, recommendation_id, "not-followed")]
    assert feedback_history_response.status_code == 200


def test_farmer_reading_mutations_require_owned_approved_farm(monkeypatch) -> None:
    user_id = "app-user-000001"
    route_globals = get_route_globals("/api/v1/farms/{farm_id}/readings")
    monkeypatch.setitem(route_globals, "require_session", lambda _request: user_id)
    create_calls: list[tuple[object, ...]] = []
    monkeypatch.setitem(route_globals, "create_farmer_soil_reading", lambda *args: create_calls.append(args))
    farm_by_id = {
        "farm-owned": {"farmId": "farm-owned", "ownerVerified": True},
        "farm-pending": {"farmId": "farm-pending", "ownerVerified": False},
    }
    monkeypatch.setitem(route_globals, "load_farmer_farm", lambda _user, farm_id: farm_by_id.get(farm_id))
    reading_payload = {"measurements": [{"analyte": "soil_ph", "value": 5.4, "sourceUnit": "pH", "qualityStatus": "valid"}]}

    foreign_response = client.post(
        "/api/v1/farms/foreign-farm/readings",
        headers={"Authorization": "Bearer test-token"},
        json=reading_payload,
    )
    pending_response = client.post(
        "/api/v1/farms/farm-pending/readings",
        headers={"Authorization": "Bearer test-token"},
        json=reading_payload,
    )

    assert foreign_response.status_code == 404
    assert pending_response.status_code == 409
    assert create_calls == []


def test_farmer_repository_sql_scopes_records_to_owner(monkeypatch) -> None:
    from app import database
    from app.models import FarmerSoilReadingCreateRequest

    class RecordingCursor:
        def __init__(self) -> None:
            self.calls: list[tuple[str, tuple[object, ...] | None]] = []

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def execute(self, query: str, parameters: tuple[object, ...] | None = None) -> None:
            self.calls.append((query, parameters))

        def fetchone(self) -> None:
            return None

        def fetchall(self) -> list[dict[str, object]]:
            return []

    class RecordingConnection:
        def __init__(self, cursor: RecordingCursor) -> None:
            self.recording_cursor = cursor

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def cursor(self) -> RecordingCursor:
            return self.recording_cursor

    recording_cursor = RecordingCursor()
    monkeypatch.setattr(database, "_connect", lambda: RecordingConnection(recording_cursor))
    user_id = "app-user-000001"
    farm_id = "farm-000001"
    recommendation_id = "recommendation-000001"

    database.load_farmer_account(user_id)
    database.load_farmer_farms(user_id)
    database.create_farmer_farm(user_id, "Farm", None, None)
    database.load_farmer_farm(user_id, farm_id)
    database.load_farmer_soil_readings(user_id, farm_id)
    database.create_farmer_soil_reading(
        user_id,
        farm_id,
        FarmerSoilReadingCreateRequest.model_validate(
            {"measurements": [{"analyte": "soil_ph", "value": 5.4, "source_unit": "pH", "quality_status": "valid"}]}
        ),
    )
    database.load_farmer_recommendations(user_id, farm_id)
    database.create_farmer_recommendation_feedback(user_id, recommendation_id, "viewed")
    database.load_farmer_recommendation_feedback(user_id, recommendation_id)

    normalized_calls = [(" ".join(query.lower().split()), parameters) for query, parameters in recording_cursor.calls]
    assert "where id = %s and role = 'farmer' and is_active = true" in normalized_calls[0][0]
    assert normalized_calls[0][1] == (user_id,)
    assert "where owner_id = %s" in normalized_calls[1][0]
    assert normalized_calls[1][1] == (user_id,)
    assert "where users.id = %s and users.role = 'farmer' and users.is_active = true" in normalized_calls[2][0]
    assert normalized_calls[2][1][-1] == user_id
    assert "where id = %s and owner_id = %s" in normalized_calls[3][0]
    assert normalized_calls[3][1] == (farm_id, user_id)
    assert "farms.owner_id = %s" in normalized_calls[4][0]
    assert normalized_calls[4][1] == (user_id, farm_id)
    assert "where farms.id = %s and farms.owner_id = %s" in normalized_calls[5][0]
    assert normalized_calls[5][1][-2:] == (farm_id, user_id)
    assert "owned_farms.owner_id = %s" in normalized_calls[6][0]
    assert normalized_calls[6][1] == (user_id, user_id, user_id, farm_id)
    assert "owned_farms.owner_id = %s" in normalized_calls[7][0]
    assert normalized_calls[7][1] == (user_id, "viewed", recommendation_id, user_id, user_id, user_id)
    assert "where user_id = %s and recommendation_id = %s" in normalized_calls[8][0]
    assert normalized_calls[8][1] == (user_id, recommendation_id)


def test_farmer_repository_persists_measurements_and_feedback(monkeypatch) -> None:
    from app import database
    from app.models import FarmerSoilReadingCreateRequest

    reading_row = {
        "id": "reading-000001",
        "farm_id": "farm-000001",
        "sampled_at": None,
        "sample_year": None,
        "source_label": "0-20 cm",
        "top_cm": 0,
        "bottom_cm": 20,
        "location_uncertainty_m": None,
        "latitude": None,
        "longitude": None,
        "source_provider": "FARMER_OBSERVATION",
        "source_dataset_id": None,
        "source_record_id": None,
        "source_license": None,
        "source_attribution": "Submitted by the authenticated farmer",
        "source_retrieved_at": None,
    }
    feedback_row = {
        "id": "feedback-000001",
        "recommendation_id": "recommendation-000001",
        "response": "viewed",
        "created_at": "2026-10-02T00:00:00Z",
    }

    class WriteCursor:
        def __init__(self) -> None:
            self.calls: list[tuple[str, tuple[object, ...] | None]] = []

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def execute(self, query: str, parameters: tuple[object, ...] | None = None) -> None:
            self.calls.append((query, parameters))

        def fetchone(self) -> dict[str, object] | None:
            query = self.calls[-1][0].strip().lower()
            if query.startswith("insert into soil_readings"):
                return reading_row
            if query.startswith("insert into recommendation_feedback"):
                return feedback_row
            return None

    class WriteConnection:
        def __init__(self, cursor: WriteCursor) -> None:
            self.write_cursor = cursor

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def cursor(self) -> WriteCursor:
            return self.write_cursor

    write_cursor = WriteCursor()
    monkeypatch.setattr(database, "_connect", lambda: WriteConnection(write_cursor))
    payload = FarmerSoilReadingCreateRequest.model_validate(
        {
            "sourceLabel": "0-20 cm",
            "topCm": 0,
            "bottomCm": 20,
            "measurements": [
                {"analyte": "soil_ph", "value": 5.4, "sourceUnit": "pH", "qualityStatus": "valid"},
                {"analyte": "total_nitrogen", "value": None, "sourceValueText": "trace",
                 "sourceUnit": "%", "qualityStatus": "invalid_source_value"},
            ],
        }
    )

    reading = database.create_farmer_soil_reading("app-user-000001", "farm-000001", payload)
    feedback = database.create_farmer_recommendation_feedback(
        "app-user-000001", "recommendation-000001", "viewed"
    )

    assert reading is not None
    assert reading.reading_id == "reading-000001"
    assert [measurement.quality_status for measurement in reading.measurements] == [
        "valid",
        "invalid_source_value",
    ]
    assert [call[0].strip().lower().split("(")[0].strip() for call in write_cursor.calls].count("insert into soil_measurements") == 2
    invalid_measurement_call = next(
        params
        for query, params in write_cursor.calls
        if query.strip().lower().startswith("insert into soil_measurements")
        and params
        and params[2] == "total_nitrogen"
    )
    assert invalid_measurement_call[4] == "trace"
    assert feedback == {
        "feedbackId": "feedback-000001",
        "recommendationId": "recommendation-000001",
        "response": "viewed",
        "createdAt": "2026-10-02T00:00:00Z",
    }


def test_sync_repository_scopes_drafts_and_queues_by_owner(monkeypatch) -> None:
    from app import database

    user_id = "app-user-000001"
    other_user_id = "app-user-000002"
    farm_id = "farm-000001"
    draft_id = "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff11"
    queue_id = "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff12"
    draft_row = {
        "id": draft_id,
        "farm_id": farm_id,
        "draft_type": "soil-reading",
        "version": 1,
        "payload": {"readingId": "reading-1"},
        "status": "draft",
        "created_at": "2026-10-02T00:00:00Z",
    }
    queue_row = {"id": queue_id, "created_at": "2026-10-02T00:01:00Z"}

    class RecordingCursor:
        def __init__(self) -> None:
            self.calls: list[tuple[str, tuple[object, ...] | None]] = []
            self.queue_insert_count = 0

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def execute(self, query: str, parameters: tuple[object, ...] | None = None) -> None:
            self.calls.append((query, parameters))

        def fetchone(self) -> dict[str, object] | None:
            query, parameters = self.calls[-1]
            normalized = " ".join(query.lower().split())
            if "from farms" in normalized and "offline_drafts" in normalized:
                return {"farm_id": farm_id, "owner_verified": True, "offline_drafts": 1, "pending_syncs": 0}
            if normalized.startswith("insert into sync_drafts"):
                return draft_row
            if "from sync_drafts" in normalized and "join farms" in normalized:
                if parameters and parameters[1] == user_id and parameters[2] == user_id:
                    return {"id": draft_id, "farm_id": farm_id, "owner_verified": True}
                return None
            if normalized.startswith("insert into sync_queue"):
                self.queue_insert_count += 1
                return queue_row if self.queue_insert_count == 1 else None
            return None

    class RecordingConnection:
        def __init__(self, cursor: RecordingCursor) -> None:
            self.recording_cursor = cursor

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def cursor(self) -> RecordingCursor:
            return self.recording_cursor

    recording_cursor = RecordingCursor()
    monkeypatch.setattr(database, "_connect", lambda: RecordingConnection(recording_cursor))

    status = database.load_farmer_sync_status(user_id)
    draft = database.create_farmer_sync_draft(
        user_id, "soil-reading", {"readingId": "reading-1"}, 1
    )
    queued = database.queue_farmer_sync_draft(user_id, draft_id, {"readingId": "reading-1"})
    duplicate = database.queue_farmer_sync_draft(user_id, draft_id, {"readingId": "reading-1"})
    foreign = database.queue_farmer_sync_draft(other_user_id, draft_id, {})

    assert status is not None and status["farmId"] == farm_id
    assert draft is not None and draft["draftId"] == draft_id
    assert queued["status"] == "queued" and queued["queueId"] == queue_id
    assert duplicate["status"] == "conflict"
    assert foreign["status"] == "not_found"
    calls = [(" ".join(query.lower().split()), parameters) for query, parameters in recording_cursor.calls]
    assert "where farms.owner_id = %s" in calls[0][0]
    assert calls[0][1] == (user_id, user_id, user_id)
    assert "farms.owner_id = %s" in calls[1][0] and calls[1][1][-1] == user_id
    assert "sync_drafts.owner_id = %s" in calls[2][0]
    assert calls[2][1] == (draft_id, user_id, user_id)
    assert "on conflict (draft_id) do nothing" in calls[3][0]
    assert calls[3][1][:3] == (draft_id, user_id, farm_id)
    assert "sync_drafts.owner_id = %s" in calls[7][0]
    assert calls[7][1] == (draft_id, other_user_id, other_user_id)


def test_officer_repository_scopes_roster_to_active_assignments(monkeypatch) -> None:
    from app import database

    officer_user_id = "app-officer-000001"
    assignments = [{
        "id": "assignment-1",
        "county": "Makueni",
        "sub_county": "Kibwezi East",
        "ward": "Kiboko",
        "created_at": "2026-10-02T00:00:00Z",
    }]
    farmer = {
        "farmer_id": "farmer-1",
        "display_name": "Amina",
        "farm_id": "farm-1",
        "farm_name": "Kiboko Farm",
        "county": "Makueni",
        "sub_county": "Kibwezi East",
        "ward": "Kiboko",
        "reading_count": 2,
    }

    class RecordingCursor:
        def __init__(self) -> None:
            self.calls: list[tuple[str, tuple[object, ...] | None]] = []

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def execute(self, query: str, parameters: tuple[object, ...] | None = None) -> None:
            self.calls.append((query, parameters))

        def fetchall(self) -> list[dict[str, object]]:
            query = " ".join(self.calls[-1][0].lower().split())
            return [farmer] if "join farms" in query else assignments

    class RecordingConnection:
        def __init__(self, cursor: RecordingCursor) -> None:
            self.recording_cursor = cursor

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def cursor(self) -> RecordingCursor:
            return self.recording_cursor

    recording_cursor = RecordingCursor()
    monkeypatch.setattr(database, "_connect", lambda: RecordingConnection(recording_cursor))

    actual_assignments = database.load_officer_jurisdictions(officer_user_id)
    roster = database.load_officer_farmer_roster(officer_user_id)

    assert actual_assignments[0]["county"] == "Makueni"
    assert roster[0]["farmerId"] == "farmer-1"
    assignment_query, assignment_params = recording_cursor.calls[0]
    roster_query, roster_params = recording_cursor.calls[1]
    normalized_roster_query = " ".join(roster_query.lower().split())
    assert "officer.role = 'extension_officer'" in assignment_query.lower()
    assert "assignments.officer_user_id = %s" in assignment_query.lower()
    assert "assignments.is_active = true" in assignment_query.lower()
    assert "assignments.county is null or farms.county = assignments.county" in normalized_roster_query
    assert "assignments.sub_county is null or farms.sub_county = assignments.sub_county" in normalized_roster_query
    assert "assignments.ward is null or farms.ward = assignments.ward" in normalized_roster_query
    assert "farmers.role = 'farmer'" in normalized_roster_query
    assert "farmers.email" not in normalized_roster_query
    assert "farmers.phone" not in normalized_roster_query
    assert assignment_params == roster_params == (officer_user_id,)


def test_authenticated_dealer_catalog_query_binds_user_and_hides_demo_rows(monkeypatch) -> None:
    from app import database

    dealer_row = {
        "id": "dealer-1",
        "business_name": "Private Dealer",
        "county": "Makueni",
        "sub_county": None,
        "ward": "Kiboko",
        "location_status": "unverified",
        "location_permission_status": "not_requested",
        "has_coordinates": False,
        "is_demo": False,
    }
    product_row = {
        "id": "product-1",
        "name": "Private stock",
        "category": "fertilizer",
        "description": None,
        "stock_quantity": 4,
        "stock_unit": "bags",
        "stock_updated_at": "2026-10-02T00:00:00Z",
        "unit_price": None,
        "currency": "KES",
        "orderable": False,
        "is_demo": False,
    }

    class RecordingCursor:
        def __init__(self) -> None:
            self.calls: list[tuple[str, tuple[object, ...] | None]] = []

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def execute(self, query: str, parameters: tuple[object, ...] | None = None) -> None:
            self.calls.append((query, parameters))

        def fetchone(self) -> dict[str, object]:
            return dealer_row

        def fetchall(self) -> list[dict[str, object]]:
            return [product_row]

    class RecordingConnection:
        def __init__(self, cursor: RecordingCursor) -> None:
            self.recording_cursor = cursor

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def cursor(self) -> RecordingCursor:
            return self.recording_cursor

    recording_cursor = RecordingCursor()
    monkeypatch.setattr(database, "_connect", lambda: RecordingConnection(recording_cursor))
    user_id = "app-dealer-000001"

    catalog = database.load_authenticated_agrodealer_catalog(user_id)

    assert catalog is not None
    assert catalog["dealer"]["id"] == "dealer-1"
    assert catalog["products"][0]["demo"] is False
    queries = [(" ".join(query.lower().split()), parameters) for query, parameters in recording_cursor.calls]
    assert "dealer.user_id = %s" in queries[0][0]
    assert "users.role = 'agrodealer'" in queries[0][0]
    assert "dealer.is_demo = false" in queries[0][0]
    assert queries[0][1] == (user_id,)
    assert "dealer_id = %s and is_listed = true and is_demo = false" in queries[1][0]
    assert queries[1][1] == (dealer_row["id"],)


def test_database_migration_and_seed_files_exist() -> None:
    from pathlib import Path

    migration_path = Path(__file__).resolve().parents[1] / "database" / "migrations" / "001_init_schema.sql"
    dashboard_migration_path = (
        Path(__file__).resolve().parents[1]
        / "database"
        / "migrations"
        / "004_demo_dashboard_records.sql"
    )
    agrodealer_migration_path = (
        Path(__file__).resolve().parents[1]
        / "database"
        / "migrations"
        / "005_agrodealer_catalog.sql"
    )
    identity_migration_path = (
        Path(__file__).resolve().parents[1]
        / "database"
        / "migrations"
        / "006_supabase_auth_identity.sql"
    )
    feedback_migration_path = (
        Path(__file__).resolve().parents[1]
        / "database"
        / "migrations"
        / "007_farmer_recommendation_feedback.sql"
    )
    farm_ownership_migration_path = (
        Path(__file__).resolve().parents[1]
        / "database"
        / "migrations"
        / "008_farm_ownership_review.sql"
    )
    sync_migration_path = (
        Path(__file__).resolve().parents[1]
        / "database"
        / "migrations"
        / "009_farmer_sync_records.sql"
    )
    officer_migration_path = (
        Path(__file__).resolve().parents[1]
        / "database"
        / "migrations"
        / "010_officer_jurisdictions.sql"
    )
    seed_path = Path(__file__).resolve().parents[1] / "database" / "seed" / "dev_seed.sql"
    dashboard_seed_path = (
        Path(__file__).resolve().parents[1]
        / "database"
        / "seed"
        / "demo_dashboard_seed.sql"
    )
    agrodealer_seed_path = (
        Path(__file__).resolve().parents[1]
        / "database"
        / "seed"
        / "agrodealer_catalog_seed.sql"
    )

    assert migration_path.exists()
    assert dashboard_migration_path.exists()
    assert agrodealer_migration_path.exists()
    assert identity_migration_path.exists()
    assert feedback_migration_path.exists()
    assert farm_ownership_migration_path.exists()
    assert sync_migration_path.exists()
    assert officer_migration_path.exists()
    assert seed_path.exists()
    assert dashboard_seed_path.exists()
    assert agrodealer_seed_path.exists()

    migration_content = migration_path.read_text(encoding="utf-8")
    seed_content = seed_path.read_text(encoding="utf-8")

    assert "CREATE TABLE IF NOT EXISTS USERS" in migration_content.upper()
    assert "INSERT INTO USERS" in seed_content.upper()
    assert "DEMO_DASHBOARD_RECORDS" in dashboard_migration_path.read_text(encoding="utf-8").upper()
    assert "SUMMARY_CARD" in dashboard_seed_path.read_text(encoding="utf-8").upper()
    assert "INSERT INTO SOIL_MEASUREMENTS" in seed_content.upper()
    assert "AGRODEALER_PROFILES" in agrodealer_migration_path.read_text(encoding="utf-8").upper()
    assert "DEALER_PRODUCTS" in agrodealer_seed_path.read_text(encoding="utf-8").upper()
    identity_migration = " ".join(identity_migration_path.read_text(encoding="utf-8").upper().split())
    assert "ADD COLUMN IF NOT EXISTS SUPABASE_AUTH_USER_ID UUID UNIQUE" in identity_migration
    feedback_migration = feedback_migration_path.read_text(encoding="utf-8").upper()
    assert "ENABLE ROW LEVEL SECURITY" in feedback_migration
    assert "'VIEWED', 'FOLLOWED', 'MODIFIED', 'NOT-FOLLOWED'" in feedback_migration
    assert "OWNER_VERIFIED BOOLEAN NOT NULL DEFAULT FALSE" in farm_ownership_migration_path.read_text(encoding="utf-8").upper()
    sync_migration = sync_migration_path.read_text(encoding="utf-8").upper()
    assert "SYNC_DRAFTS" in sync_migration and "SYNC_QUEUE" in sync_migration
    assert "ENABLE ROW LEVEL SECURITY" in sync_migration
    assert "DRAFT_ID UUID NOT NULL UNIQUE" in sync_migration
    officer_migration = officer_migration_path.read_text(encoding="utf-8").upper()
    assert "OFFICER_JURISDICTIONS" in officer_migration
    assert "ENABLE ROW LEVEL SECURITY" in officer_migration
    assert "SUB_COUNTY IS NULL OR COUNTY IS NOT NULL" in officer_migration


def test_dataset_migration_preserves_measurement_provenance_without_pii() -> None:
    from pathlib import Path

    backend_path = Path(__file__).resolve().parents[1]
    migration_path = (
        backend_path / "database" / "migrations" / "002_dataset_measurements.sql"
    )
    content = migration_path.read_text(encoding="utf-8").lower()
    snapshot = (backend_path / "app" / "database_schema.sql").read_text(encoding="utf-8").lower()

    assert "create table if not exists source_datasets" in content
    assert "create table if not exists source_import_batches" in content
    assert "alter column farm_id drop not null" in content
    assert "create table if not exists soil_measurements" in content
    assert "source_value_text" in content
    assert "source_quality_class" in content
    assert "source_latitude" in content
    assert "final_latitude" in content
    assert "add column source_dataset_ref_id uuid" in content
    assert "source_provenance(source_dataset_ref_id, record_id)" in content
    assert "using gist(location)" in content
    assert "farmers_name" not in content
    assert "telephone_no" not in content
    assert "create table if not exists soil_measurements" in snapshot
    assert "source_recommendation_text" in snapshot
    assert "farm_id uuid references farms(id) on delete set null" in snapshot


def test_rls_migration_enables_default_deny_for_application_tables() -> None:
    from pathlib import Path

    migration_path = (
        Path(__file__).resolve().parents[1] / "database" / "migrations" / "003_enable_rls.sql"
    )
    content = migration_path.read_text(encoding="utf-8").lower()

    for table_name in [
        "users",
        "farms",
        "soil_readings",
        "source_provenance",
        "recommendations",
        "source_datasets",
        "source_import_batches",
        "soil_measurements",
    ]:
        assert f"alter table public.{table_name} enable row level security" in content
    assert "create policy" not in content


def test_dataset_loader_maps_only_soil_fields_and_preserves_invalid_analytes() -> None:
    from decimal import Decimal
    from uuid import uuid4

    from app.dataset_loader import (
        MEASUREMENT_INSERT,
        PROVENANCE_INSERT,
        READING_INSERT,
        map_source_row,
        parse_depth_bounds,
    )

    row = {
        "id": "sample-1",
        "year": "2024",
        "soil_depth_cm": "0-15",
        "soil_pH": "5.8",
        "soil_pH_Class": "slight acid",
        "total_Nitrogen_percent_": "below detection",
        "total_Nitrogen_percent_Class": "low",
        "latitude": "-1.2",
        "longitude": "36.8",
        "final_Latitude": "-1.3",
        "final_Longitude": "36.9",
        "farmers_Name": "Private Person",
        "telephone_No": "0712345678",
        "county": "Nyeri",
    }

    mapped = map_source_row(row, uuid4(), uuid4())

    assert mapped is not None
    provenance, reading, measurements, invalid_count = mapped
    assert invalid_count == 1
    assert len(provenance) == PROVENANCE_INSERT.count("%s")
    assert len(reading) == READING_INSERT.count("%s")
    assert len(measurements[0]) == MEASUREMENT_INSERT.count("%s")
    assert reading[2:6] == (2024, "0-15", 0.0, 15.0)
    assert reading[6:8] == (-1.3, 36.9)
    assert reading[20:24] == (-1.2, 36.8, -1.3, 36.9)
    assert reading[27] == "final"
    assert reading[28] == "mixed"
    assert "Private Person" not in repr((provenance, reading, measurements))
    assert "0712345678" not in repr((provenance, reading, measurements))

    by_source_field = {measurement[1]: measurement for measurement in measurements}
    assert by_source_field["soil_pH"][3] == Decimal("5.8")
    assert by_source_field["soil_pH"][6] == "valid"
    assert by_source_field["total_Nitrogen_percent_"][3] is None
    assert by_source_field["total_Nitrogen_percent_"][4] == "below detection"
    assert by_source_field["total_Nitrogen_percent_"][6] == "invalid_source_value"
    assert parse_depth_bounds("top") == (None, None)


def test_csv_ingestion_summary_normalizes_and_reconciles_rows(tmp_path) -> None:
    from app.ingestion import normalize_county_label, normalize_depth_label, summarize_csv_import

    csv_path = tmp_path / "sample.csv"
    csv_path.write_text(
        "id,county,soil_depth_cm,soil_pH,total_Nitrogen_percent_,crop,year\n"
        "1,Nyeri,top,6.2,0.12,maize,2024\n"
        "2,  KERUGOYA  ,sub,NOT_A_NUMBER,0.08,maize,2024\n"
        "3,,0-15,5.8,0.11,,2024\n",
        encoding="utf-8",
    )

    summary = summarize_csv_import(csv_path)

    assert normalize_county_label("  KERUGOYA  ") == "kerugoya"
    assert normalize_depth_label("Top") == "top"
    assert summary["rows_read"] == 3
    assert summary["rows_accepted"] == 1
    assert summary["rows_rejected"] == 2
    assert summary["invalid_numeric_tokens"] == 1
    assert summary["missing_counties"] == 1


def test_database_schema_includes_core_phase_two_tables() -> None:
    from pathlib import Path

    schema_path = Path(__file__).resolve().parents[1] / "app" / "database_schema.sql"
    content = schema_path.read_text(encoding="utf-8")

    for expected in [
        "CREATE TABLE IF NOT EXISTS USERS",
        "CREATE TABLE IF NOT EXISTS FARMS",
        "CREATE TABLE IF NOT EXISTS SOIL_READINGS",
        "CREATE TABLE IF NOT EXISTS RECOMMENDATIONS",
        "CREATE TABLE IF NOT EXISTS SOURCE_PROVENANCE",
    ]:
        assert expected in content.upper()


def test_authorization_rls_and_audit_migration_exists() -> None:
    from pathlib import Path

    migration_path = (
        Path(__file__).resolve().parents[1]
        / "database"
        / "migrations"
        / "011_authorization_rls_audit.sql"
    )
    assert migration_path.exists()
    content = migration_path.read_text(encoding="utf-8").upper()

    assert "ADMIN_PERMISSIONS" in content
    assert "ADMIN_AUDIT_LOG" in content
    assert "USERS_SELECT_OWN" in content
    assert "FARMS_SELECT_OWNER" in content
    assert "SOIL_READINGS_SELECT_OWNER" in content
    assert "ENABLE ROW LEVEL SECURITY" in content


def test_dealer_endpoints_require_dealer_role_and_enforce_ownership(monkeypatch) -> None:
    from app import main

    test_client = TestClient(main.app)

    # 1. Non-dealer (farmer) access is denied (403)
    farmer_subject = "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff10"
    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=farmer_subject),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda subject: {
            "id": "app-user-farmer-1",
            "role": "farmer",
            "is_active": True,
        } if subject == farmer_subject else None,
    )
    response = test_client.get(
        "/api/v1/agrodealer/me/profile",
        headers={"Authorization": "Bearer valid-farmer-token"},
    )
    assert response.status_code == 403

    # 2. Authenticated dealer loads their own profile
    dealer_user_id = "app-user-dealer-1"
    dealer_subject = "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff20"
    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=dealer_subject),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda subject: {
            "id": dealer_user_id,
            "role": "agrodealer",
            "is_active": True,
        } if subject == dealer_subject else None,
    )

    mock_profile = {
        "id": "dealer-prof-1",
        "businessName": "Agro Vet Central",
        "county": "Nyeri",
        "subCounty": "Tetu",
        "ward": "Dedan Kimathi",
        "isVerified": True,
    }
    monkeypatch.setattr(
        main,
        "load_dealer_profile",
        lambda uid: mock_profile if uid == dealer_user_id else None,
    )

    resp = test_client.get(
        "/api/v1/agrodealer/me/profile",
        headers={"Authorization": "Bearer valid-dealer-token"},
    )
    assert resp.status_code == 200
    assert resp.json()["businessName"] == "Agro Vet Central"

    # 3. Dealer updates their own profile
    updated_profile = {**mock_profile, "businessName": "Agro Vet Central Updated"}
    monkeypatch.setattr(
        main,
        "update_dealer_profile",
        lambda uid, **kwargs: updated_profile if uid == dealer_user_id else None,
    )
    resp = test_client.patch(
        "/api/v1/agrodealer/me/profile",
        headers={"Authorization": "Bearer valid-dealer-token"},
        json={"businessName": "Agro Vet Central Updated"},
    )
    assert resp.status_code == 200
    assert resp.json()["businessName"] == "Agro Vet Central Updated"

    # 4. Dealer product creation & stock update
    monkeypatch.setattr(
        main,
        "create_dealer_product",
        lambda uid, **kwargs: {
            "id": "prod-1",
            "dealerId": "dealer-prof-1",
            "productName": "NPK 17:17:17",
            "inStock": True,
            "stockQuantity": 50,
        },
    )
    resp = test_client.post(
        "/api/v1/agrodealer/me/products",
        headers={"Authorization": "Bearer valid-dealer-token"},
        json={
            "name": "NPK 17:17:17",
            "category": "fertilizer",
            "unitPrice": 3500.0,
            "stockUnit": "50kg bag",
            "stockQuantity": 50,
        },
    )
    assert resp.status_code == 201
    assert resp.json()["productName"] == "NPK 17:17:17"

    # 5. Dealer stock update
    monkeypatch.setattr(
        main,
        "update_dealer_product_stock",
        lambda uid, product_id, stock_quantity: {
            "id": product_id,
            "dealerId": "dealer-prof-1",
            "stockQuantity": stock_quantity,
        } if uid == dealer_user_id and product_id == "prod-1" else None,
    )
    resp = test_client.put(
        "/api/v1/agrodealer/me/products/prod-1/stock",
        headers={"Authorization": "Bearer valid-dealer-token"},
        json={"stockQuantity": 0},
    )
    assert resp.status_code == 200
    assert resp.json()["stockQuantity"] == 0


def test_officer_readings_scoped_to_assigned_jurisdiction(monkeypatch) -> None:
    from app import main
    from app.models import SoilReading

    test_client = TestClient(main.app)

    # Extension officer authentication
    officer_user_id = "app-user-officer-1"
    officer_subject = "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff30"
    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=officer_subject),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda subject: {
            "id": officer_user_id,
            "role": "extension_officer",
            "is_active": True,
        } if subject == officer_subject else None,
    )

    # Mock load_officer_farm_readings
    mock_reading = SoilReading.model_validate(
        {
            "contractVersion": 1,
            "readingId": "reading-1",
            "farmId": "farm-nyeri-1",
            "source": {
                "provider": "DEMO",
                "datasetId": "live-db",
                "recordId": "reading-1",
                "license": None,
                "attribution": "Database reading",
                "retrievedAt": None,
            },
            "sample": {
                "sampledAt": None,
                "sampleYear": 2026,
                "depth": {"sourceLabel": "0-20cm", "topCm": 0.0, "bottomCm": 20.0},
            },
            "location": {"latitude": -0.42, "longitude": 36.95, "uncertaintyM": None},
            "measurements": [
                {
                    "analyte": "soil_ph",
                    "value": 6.2,
                    "sourceUnit": "pH",
                    "canonicalUnit": None,
                    "analyticalMethod": None,
                    "qualityStatus": "valid",
                    "uncertainty": None,
                }
            ],
        }
    )
    monkeypatch.setattr(
        main,
        "load_officer_farm_readings",
        lambda uid, farm_id: [mock_reading] if farm_id == "farm-nyeri-1" else [],
    )

    # Valid farm inside assigned jurisdiction
    resp = test_client.get(
        "/api/v1/officer/farms/farm-nyeri-1/readings",
        headers={"Authorization": "Bearer valid-officer-token"},
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["farmId"] == "farm-nyeri-1"

    # Farm with no readings in jurisdiction
    resp = test_client.get(
        "/api/v1/officer/farms/farm-outside-jurisdiction/readings",
        headers={"Authorization": "Bearer valid-officer-token"},
    )
    assert resp.status_code == 200
    assert resp.json() == []


def test_admin_least_privilege_operations_and_audit_logging(monkeypatch) -> None:
    from app import main

    test_client = TestClient(main.app)
    admin_user_id = "app-user-admin-1"
    admin_subject = "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff40"
    officer_subject = "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff30"

    # 1. Non-admin cannot access admin endpoints (403)
    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=officer_subject),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda subject: {
            "id": "app-user-officer-1",
            "role": "extension_officer",
            "is_active": True,
        } if subject == officer_subject else None,
    )
    resp = test_client.get(
        "/api/v1/admin/users",
        headers={"Authorization": "Bearer officer-token"},
    )
    assert resp.status_code == 403

    # 2. Authenticated Admin session
    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=admin_subject),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda subject: {
            "id": admin_user_id,
            "role": "admin",
            "is_active": True,
        } if subject == admin_subject else None,
    )

    # Admin list users
    monkeypatch.setattr(
        main,
        "admin_list_users",
        lambda uid: [
            {"id": "u1", "role": "farmer", "isActive": True, "fullName": "Farmer John"}
        ],
    )
    resp = test_client.get(
        "/api/v1/admin/users",
        headers={"Authorization": "Bearer admin-token"},
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    # Admin update user role
    monkeypatch.setattr(
        main,
        "admin_update_user_role",
        lambda admin_uid, target_uid, new_role: {
            "id": target_uid,
            "role": new_role,
            "fullName": "Farmer John",
        },
    )
    monkeypatch.setattr(
        main,
        "create_admin_audit_entry",
        lambda **kwargs: None,
    )
    resp = test_client.patch(
        "/api/v1/admin/users/u1/role",
        headers={"Authorization": "Bearer admin-token"},
        json={"role": "extension_officer"},
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "extension_officer"

    # Admin assign officer jurisdiction
    monkeypatch.setattr(
        main,
        "admin_manage_officer_assignment",
        lambda admin_user_id, officer_user_id, county, sub_county, ward, is_active: {
            "assignmentId": "asgn-1",
            "officerId": officer_user_id,
            "county": county,
            "subCounty": sub_county,
            "ward": ward,
            "isActive": is_active,
        },
    )
    resp = test_client.post(
        "/api/v1/admin/officer-assignments",
        headers={"Authorization": "Bearer admin-token"},
        json={
            "officerUserId": "u1",
            "county": "Nyeri",
            "subCounty": "Tetu",
            "ward": "Dedan Kimathi",
            "isActive": True,
        },
    )
    assert resp.status_code == 201
    assert resp.json()["assignmentId"] == "asgn-1"

    # Admin view audit log
    monkeypatch.setattr(
        main,
        "load_admin_audit_log",
        lambda uid, limit: [
            {
                "id": "audit-1",
                "adminUserId": admin_user_id,
                "action": "update_user_role",
                "targetResourceType": "users",
                "targetResourceId": "u1",
                "details": {"oldRole": "farmer", "newRole": "officer"},
            }
        ],
    )
    resp = test_client.get(
        "/api/v1/admin/audit-log",
        headers={"Authorization": "Bearer admin-token"},
    )
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["action"] == "update_user_role"


def test_cross_role_access_denials(monkeypatch) -> None:
    from app import main

    test_client = TestClient(main.app)

    # A farmer attempting dealer and admin endpoints
    farmer_subject = "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff10"
    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=farmer_subject),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda subject: {
            "id": "farmer-1",
            "role": "farmer",
            "is_active": True,
        } if subject == farmer_subject else None,
    )
    assert test_client.get("/api/v1/agrodealer/me/profile", headers={"Authorization": "Bearer t"}).status_code == 403
    assert test_client.get("/api/v1/admin/users", headers={"Authorization": "Bearer t"}).status_code == 403

    # A dealer attempting farmer and admin endpoints
    dealer_subject = "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff20"
    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=dealer_subject),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda subject: {
            "id": "dealer-1",
            "role": "agrodealer",
            "is_active": True,
        } if subject == dealer_subject else None,
    )
    assert test_client.get("/api/v1/farms", headers={"Authorization": "Bearer t"}).status_code == 403
    assert test_client.get("/api/v1/admin/audit-log", headers={"Authorization": "Bearer t"}).status_code == 403


def test_officer_visits_workflow_and_jurisdiction(monkeypatch) -> None:
    from datetime import datetime

    from app import main

    test_client = TestClient(main.app)
    officer_user_id = "app-user-officer-1"
    officer_subject = "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff30"

    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=officer_subject),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda subject: {
            "id": officer_user_id,
            "role": "extension_officer",
            "is_active": True,
        } if subject == officer_subject else None,
    )

    # 1. GET /api/v1/officer/visits
    sample_visit = {
        "visitId": "visit-1",
        "officerUserId": officer_user_id,
        "farmerId": "farmer-nyeri-1",
        "farmerName": "Wanjiku Farmer",
        "farmId": "farm-nyeri-1",
        "farmName": "Rugi Green Farm",
        "plannedDate": datetime.now(UTC),
        "status": "scheduled",
        "notes": "Initial soil check",
        "createdAt": datetime.now(UTC),
        "updatedAt": datetime.now(UTC),
    }
    monkeypatch.setattr(main, "load_officer_visits", lambda oid: [sample_visit] if oid == officer_user_id else [])

    resp = test_client.get("/api/v1/officer/visits", headers={"Authorization": "Bearer valid-token"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["visitId"] == "visit-1"
    assert data[0]["farmerName"] == "Wanjiku Farmer"

    # 2. POST /api/v1/officer/visits (in jurisdiction -> 201)
    def mock_create_visit(officer_user_id, farmer_id, farm_id, planned_date, status, notes):
        if farmer_id == "farmer-nyeri-1":
            return {
                "visitId": "visit-2",
                "officerUserId": officer_user_id,
                "farmerId": farmer_id,
                "farmerName": "Wanjiku Farmer",
                "farmId": farm_id,
                "farmName": "Rugi Green Farm",
                "plannedDate": planned_date,
                "status": status,
                "notes": notes,
                "createdAt": datetime.now(UTC),
                "updatedAt": datetime.now(UTC),
            }
        return None  # outside jurisdiction

    monkeypatch.setattr(main, "create_officer_visit", mock_create_visit)

    create_payload = {
        "farmerId": "farmer-nyeri-1",
        "farmId": "farm-nyeri-1",
        "plannedDate": "2026-10-15T09:00:00Z",
        "status": "scheduled",
        "notes": "Followup on lime application",
    }
    create_resp = test_client.post(
        "/api/v1/officer/visits",
        headers={"Authorization": "Bearer valid-token"},
        json=create_payload,
    )
    assert create_resp.status_code == 201
    assert create_resp.json()["visitId"] == "visit-2"

    # 3. POST /api/v1/officer/visits (out of jurisdiction -> 403)
    out_of_area_payload = {
        "farmerId": "farmer-kisumu-99",
        "plannedDate": "2026-10-16T10:00:00Z",
    }
    denied_resp = test_client.post(
        "/api/v1/officer/visits",
        headers={"Authorization": "Bearer valid-token"},
        json=out_of_area_payload,
    )
    assert denied_resp.status_code == 403
    assert "jurisdiction" in denied_resp.json()["detail"].lower()

    # 4. PATCH /api/v1/officer/visits/{visit_id}
    def mock_update_visit(officer_user_id, visit_id, planned_date, status, notes):
        if visit_id == "visit-2":
            return {
                "visitId": "visit-2",
                "officerUserId": officer_user_id,
                "farmerId": "farmer-nyeri-1",
                "farmerName": "Wanjiku Farmer",
                "farmId": "farm-nyeri-1",
                "farmName": "Rugi Green Farm",
                "plannedDate": datetime.now(UTC),
                "status": status or "in_progress",
                "notes": notes or "Updated notes",
                "createdAt": datetime.now(UTC),
                "updatedAt": datetime.now(UTC),
            }
        return None

    monkeypatch.setattr(main, "update_officer_visit", mock_update_visit)
    patch_resp = test_client.patch(
        "/api/v1/officer/visits/visit-2",
        headers={"Authorization": "Bearer valid-token"},
        json={"status": "completed", "notes": "Completed farm visit, pH measured at 6.2"},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["status"] == "completed"

    # 5. Non-existent or unauthorized visit PATCH -> 404
    patch_denied = test_client.patch(
        "/api/v1/officer/visits/unknown-visit",
        headers={"Authorization": "Bearer valid-token"},
        json={"status": "cancelled"},
    )
    assert patch_denied.status_code == 404


def test_officer_visit_pool_claiming_and_releasing(monkeypatch) -> None:
    from datetime import datetime

    from app import main

    test_client = TestClient(main.app)
    officer_user_id = "app-user-officer-pool-1"
    officer_subject = "7e9e9b0d-52a3-4a5f-a08c-0b8b75aaff99"

    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=officer_subject) if token == "valid-token" else None,
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda subject: {
            "id": officer_user_id,
            "role": "extension_officer",
            "is_active": True,
        }
        if subject == officer_subject
        else None,
    )

    unclaimed_visit = {
        "visitId": "visit-pool-1",
        "officerUserId": None,
        "farmerId": "farmer-tetu-1",
        "farmerName": "Kamau Nyeri",
        "farmerPhone": "+254711223344",
        "farmId": "farm-tetu-1",
        "farmName": "Aguthi Highlands",
        "county": "Nyeri",
        "subCounty": "Tetu",
        "ward": "Aguthi-Gaaki",
        "plannedDate": None,
        "status": "requested",
        "notes": "Urgent soil testing needed",
        "createdAt": datetime.now(UTC),
        "updatedAt": datetime.now(UTC),
    }

    # 1. GET /api/v1/officer/visit-pool
    monkeypatch.setattr(main, "load_officer_visit_pool", lambda oid: [unclaimed_visit] if oid == officer_user_id else [])

    resp = test_client.get("/api/v1/officer/visit-pool", headers={"Authorization": "Bearer valid-token"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["visitId"] == "visit-pool-1"
    assert data[0]["status"] == "requested"
    assert data[0]["officerUserId"] is None
    assert data[0]["county"] == "Nyeri"

    # 2. POST /api/v1/officer/visits/{visit_id}/claim - Success
    claimed_visit = dict(unclaimed_visit)
    claimed_visit["status"] = "claimed"
    claimed_visit["officerUserId"] = officer_user_id

    def mock_claim_visit(oid, vid):
        if vid == "visit-pool-1" and oid == officer_user_id:
            return claimed_visit
        return None  # already claimed or outside jurisdiction

    monkeypatch.setattr(main, "claim_officer_visit", mock_claim_visit)

    claim_resp = test_client.post(
        "/api/v1/officer/visits/visit-pool-1/claim",
        headers={"Authorization": "Bearer valid-token"},
    )
    assert claim_resp.status_code == 200
    assert claim_resp.json()["status"] == "claimed"
    assert claim_resp.json()["officerUserId"] == officer_user_id

    # 3. POST /api/v1/officer/visits/{visit_id}/claim - Conflict (409) when already claimed
    conflict_resp = test_client.post(
        "/api/v1/officer/visits/already-claimed-visit/claim",
        headers={"Authorization": "Bearer valid-token"},
    )
    assert conflict_resp.status_code == 409
    assert "already been claimed" in conflict_resp.json()["detail"].lower()

    # 4. POST /api/v1/officer/visits/{visit_id}/release - Success
    released_visit = dict(unclaimed_visit)
    released_visit["status"] = "requested"
    released_visit["officerUserId"] = None

    def mock_release_visit(oid, vid):
        if vid == "visit-pool-1" and oid == officer_user_id:
            return released_visit
        return None

    monkeypatch.setattr(main, "release_officer_visit", mock_release_visit)

    release_resp = test_client.post(
        "/api/v1/officer/visits/visit-pool-1/release",
        headers={"Authorization": "Bearer valid-token"},
    )
    assert release_resp.status_code == 200
    assert release_resp.json()["status"] == "requested"
    assert release_resp.json()["officerUserId"] is None

    # 5. POST /api/v1/officer/visits/{visit_id}/release - 404 when not owned or not releasable
    release_fail = test_client.post(
        "/api/v1/officer/visits/nonexistent-visit/release",
        headers={"Authorization": "Bearer valid-token"},
    )
    assert release_fail.status_code == 404


def test_officer_field_collection_workflow(monkeypatch) -> None:
    from app import main

    test_client = TestClient(main.app)
    officer_user_id = "app-user-officer-pool-1"
    officer_subject = "7e9e9b0d-52a3-4a5f-a08c-0b8b75aaff99"

    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=officer_subject) if token == "valid-token" else None,
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda subject: {
            "id": officer_user_id,
            "role": "extension_officer",
            "is_active": True,
        }
        if subject == officer_subject
        else None,
    )

    def mock_field_collection(
        officer_user_id,
        visit_id,
        latitude,
        longitude,
        location_uncertainty_m,
        top_cm,
        bottom_cm,
        measurements,
        sampled_at,
        notes,
        mark_completed,
    ):
        if visit_id == "visit-claimed-1":
            return {
                "visitId": visit_id,
                "farmId": "farm-1",
                "readingId": "reading-new-1",
                "latitude": latitude,
                "longitude": longitude,
                "status": "completed" if mark_completed else "in_progress",
                "soilDataCollected": True,
                "message": "Field data and GPS coordinates recorded successfully.",
            }
        return None

    monkeypatch.setattr(main, "record_officer_field_collection", mock_field_collection)

    payload = {
        "latitude": -0.4215,
        "longitude": 36.9512,
        "location_uncertainty_m": 4.5,
        "top_cm": 0,
        "bottom_cm": 20,
        "measurements": [
            {
                "analyte": "soil_ph",
                "value": 5.8,
                "source_unit": "pH",
                "quality_status": "valid",
            },
            {
                "analyte": "organic_carbon",
                "value": 2.1,
                "source_unit": "%",
                "quality_status": "valid",
            },
        ],
        "notes": "Healthy red loam topsoil; sampled after light morning rain.",
        "mark_completed": True,
    }

    # 1. Success on claimed visit
    resp = test_client.post(
        "/api/v1/officer/visits/visit-claimed-1/field-collection",
        headers={"Authorization": "Bearer valid-token"},
        json=payload,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["visitId"] == "visit-claimed-1"
    assert data["soilDataCollected"] is True
    assert data["status"] == "completed"
    assert data["latitude"] == -0.4215

    # 2. Denied on unowned or unapproved visit -> 403
    denied = test_client.post(
        "/api/v1/officer/visits/visit-unowned/field-collection",
        headers={"Authorization": "Bearer valid-token"},
        json=payload,
    )
    assert denied.status_code == 403


def test_officer_alerts_workflow_and_triage(monkeypatch) -> None:
    from datetime import datetime

    from app import main

    test_client = TestClient(main.app)
    officer_user_id = "app-user-officer-1"
    officer_subject = "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff30"

    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=officer_subject),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda subject: {
            "id": officer_user_id,
            "role": "extension_officer",
            "is_active": True,
        } if subject == officer_subject else None,
    )

    sample_alert = {
        "alertId": "alert-1",
        "officerUserId": officer_user_id,
        "farmerId": "farmer-nyeri-1",
        "farmerName": "Wanjiku Farmer",
        "farmId": "farm-nyeri-1",
        "farmName": "Rugi Green Farm",
        "source": "Soil Health Test",
        "severity": "critical",
        "status": "open",
        "title": "Severe Soil Acidity Detected",
        "summary": "pH 4.8 requires agricultural lime intervention.",
        "notes": "Farmer notified.",
        "resolutionNotes": None,
        "resolvedAt": None,
        "createdAt": datetime.now(UTC),
        "updatedAt": datetime.now(UTC),
    }

    monkeypatch.setattr(main, "load_officer_alerts", lambda oid: [sample_alert] if oid == officer_user_id else [])

    # 1. GET /api/v1/officer/alerts
    resp = test_client.get("/api/v1/officer/alerts", headers={"Authorization": "Bearer valid-token"})
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["alertId"] == "alert-1"
    assert resp.json()[0]["severity"] == "critical"

    # 2. POST /api/v1/officer/alerts (in jurisdiction)
    def mock_create_alert(officer_user_id, farmer_id, farm_id, title, summary, source, severity, notes):
        if farmer_id == "farmer-nyeri-1":
            return {
                "alertId": "alert-2",
                "officerUserId": officer_user_id,
                "farmerId": farmer_id,
                "farmerName": "Wanjiku Farmer",
                "farmId": farm_id,
                "farmName": "Rugi Green Farm",
                "source": source,
                "severity": severity,
                "status": "open",
                "title": title,
                "summary": summary,
                "notes": notes,
                "resolutionNotes": None,
                "resolvedAt": None,
                "createdAt": datetime.now(UTC),
                "updatedAt": datetime.now(UTC),
            }
        return None

    monkeypatch.setattr(main, "create_officer_alert", mock_create_alert)

    alert_payload = {
        "farmerId": "farmer-nyeri-1",
        "farmId": "farm-nyeri-1",
        "title": "Low Phosphorus Alert",
        "summary": "Olsen P is below critical threshold 15 mg/kg.",
        "source": "Lab Ingestion",
        "severity": "warning",
        "notes": "Recommend rock phosphate or DAP at planting.",
    }
    create_resp = test_client.post(
        "/api/v1/officer/alerts",
        headers={"Authorization": "Bearer valid-token"},
        json=alert_payload,
    )
    assert create_resp.status_code == 201
    assert create_resp.json()["alertId"] == "alert-2"

    # Out of jurisdiction -> 403
    denied_alert = test_client.post(
        "/api/v1/officer/alerts",
        headers={"Authorization": "Bearer valid-token"},
        json={"farmerId": "farmer-outside-1", "title": "Test", "source": "Manual", "severity": "info"},
    )
    assert denied_alert.status_code == 403

    # 3. PATCH /api/v1/officer/alerts/{alert_id} triage
    def mock_update_alert(officer_user_id, alert_id, severity, status, notes, resolution_notes):
        if alert_id == "alert-1":
            return {
                "alertId": "alert-1",
                "officerUserId": officer_user_id,
                "farmerId": "farmer-nyeri-1",
                "farmerName": "Wanjiku Farmer",
                "farmId": "farm-nyeri-1",
                "farmName": "Rugi Green Farm",
                "source": "Soil Health Test",
                "severity": severity or "critical",
                "status": status or "resolved",
                "title": "Severe Soil Acidity Detected",
                "summary": "pH 4.8 requires agricultural lime intervention.",
                "notes": notes,
                "resolutionNotes": resolution_notes,
                "resolvedAt": datetime.now(UTC) if status == "resolved" else None,
                "createdAt": datetime.now(UTC),
                "updatedAt": datetime.now(UTC),
            }
        return None

    monkeypatch.setattr(main, "update_officer_alert", mock_update_alert)

    triage_resp = test_client.patch(
        "/api/v1/officer/alerts/alert-1",
        headers={"Authorization": "Bearer valid-token"},
        json={
            "status": "resolved",
            "resolutionNotes": "Delivered 200kg lime; applied and incorporated into topsoil.",
        },
    )
    assert triage_resp.status_code == 200
    assert triage_resp.json()["status"] == "resolved"
    assert triage_resp.json()["resolutionNotes"] is not None


def test_officer_ward_summaries_calculation(monkeypatch) -> None:
    from datetime import datetime

    from app import main

    test_client = TestClient(main.app)
    officer_user_id = "app-user-officer-1"
    officer_subject = "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff30"

    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=officer_subject),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda subject: {
            "id": officer_user_id,
            "role": "extension_officer",
            "is_active": True,
        } if subject == officer_subject else None,
    )

    sample_summary = [
        {
            "county": "Nyeri",
            "subCounty": "Mukurweini",
            "ward": "Rugi",
            "farmerCount": 12,
            "farmCount": 15,
            "readingCount": 28,
            "sampleCount": 140,
            "aggregationLimits": "Ward-level aggregate. Small cohorts (<3 samples) protected to prevent re-identification.",
            "dataFreshness": datetime.now(UTC),
        }
    ]
    monkeypatch.setattr(main, "load_officer_ward_summaries", lambda oid: sample_summary if oid == officer_user_id else [])

    resp = test_client.get("/api/v1/officer/ward-summaries", headers={"Authorization": "Bearer valid-token"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["ward"] == "Rugi"
    assert data[0]["farmerCount"] == 12
    assert "re-identification" in data[0]["aggregationLimits"]


def test_officer_report_export_gating_and_allowlist(monkeypatch) -> None:
    from datetime import datetime

    from app import main

    test_client = TestClient(main.app)
    officer_user_id = "app-user-officer-1"
    officer_subject = "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff30"

    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=officer_subject),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda subject: {
            "id": officer_user_id,
            "role": "extension_officer",
            "is_active": True,
        } if subject == officer_subject else None,
    )

    def mock_export_report(officer_user_id, county, sub_county, ward, export_format):
        if county == "Nyeri" and (ward is None or ward == "Rugi"):
            return {
                "exportId": "exp-123456",
                "officerUserId": officer_user_id,
                "scope": {"county": county, "subCounty": sub_county, "ward": ward},
                "allowlistedFields": [
                    "readingId", "farmerName", "farmName", "county", "subCounty", "ward",
                    "sampleYear", "sampledAt", "topCm", "bottomCm", "sourceProvider",
                    "analyte", "value", "unit", "qualityStatus"
                ],
                "privacyDisclaimer": "Exported under reviewed extension services access policy. Phone numbers, national IDs, and exact coordinates are strictly excluded.",
                "recordCount": 1,
                "exportedAt": datetime.now(UTC),
                "records": [
                    {
                        "readingId": "read-001",
                        "farmerName": "Wanjiku Farmer",
                        "farmName": "Rugi Green Farm",
                        "county": "Nyeri",
                        "subCounty": "Mukurweini",
                        "ward": "Rugi",
                        "sampleYear": 2026,
                        "sampledAt": "2026-09-15T00:00:00Z",
                        "topCm": 0.0,
                        "bottomCm": 20.0,
                        "sourceProvider": "PROJECT_SOIL_DATASET",
                        "analyte": "soil_ph",
                        "value": 5.4,
                        "unit": "pH",
                        "qualityStatus": "valid",
                    }
                ],
            }
        return None

    monkeypatch.setattr(main, "export_officer_report", mock_export_report)

    # 1. Successful export for assigned county
    export_resp = test_client.post(
        "/api/v1/officer/reports/export",
        headers={"Authorization": "Bearer valid-token"},
        json={"county": "Nyeri", "ward": "Rugi", "format": "json"},
    )
    assert export_resp.status_code == 200
    export_data = export_resp.json()
    assert export_data["exportId"] == "exp-123456"
    assert "phone" not in export_data["allowlistedFields"]
    assert "latitude" not in export_data["allowlistedFields"]
    assert "longitude" not in export_data["allowlistedFields"]
    assert len(export_data["records"]) == 1
    assert export_data["records"][0]["analyte"] == "soil_ph"

    # 2. Out-of-jurisdiction export -> 403 Forbidden
    denied_export = test_client.post(
        "/api/v1/officer/reports/export",
        headers={"Authorization": "Bearer valid-token"},
        json={"county": "Nakuru", "format": "json"},
    )
    assert denied_export.status_code == 403


def test_officer_workflow_migration_012_exists() -> None:
    from pathlib import Path
    migration_path = (
        Path(__file__).resolve().parent.parent
        / "database"
        / "migrations"
        / "012_officer_workflow.sql"
    )
    assert migration_path.exists()
    content = migration_path.read_text(encoding="utf-8").upper()
    assert "OFFICER_VISITS" in content
    assert "OFFICER_ALERTS" in content
    assert "ENABLE ROW LEVEL SECURITY" in content
    assert "SET_OFFICER_VISITS_UPDATED_AT" in content


def test_agrodealer_location_consent_and_verification(monkeypatch) -> None:
    from app import main

    test_client = TestClient(main.app)
    dealer_subject = "dealer-sub-001"
    dealer_id = "dealer-user-001"

    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=dealer_subject),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda sub: {"id": dealer_id, "role": "agrodealer", "is_active": True}
        if sub == dealer_subject else None,
    )

    # 1. Update location consent
    monkeypatch.setattr(
        main,
        "update_dealer_location_consent",
        lambda uid, granted, notes: {
            "id": "prof-1",
            "userId": uid,
            "businessName": "Mwangi Agro Supplies",
            "locationPermissionStatus": "granted" if granted else "denied",
            "locationConsentNotes": notes,
            "locationStatus": "verified" if granted else "unavailable",
            "hasCoordinates": granted,
        },
    )

    consent_resp = test_client.post(
        "/api/v1/agrodealer/me/location/consent",
        headers={"Authorization": "Bearer token"},
        json={"consentGranted": True, "consentNotes": "Authorized ward level GPS for customer routing"},
    )
    assert consent_resp.status_code == 200
    assert consent_resp.json()["locationPermissionStatus"] == "granted"

    # 2. Coordinate update validation
    def mock_update_coords(uid, latitude, longitude, accuracy_meters=None):
        if latitude < -10:
            raise ValueError("Coordinates outside allowable bounds.")
        return {
            "id": "prof-1",
            "businessName": "Mwangi Agro Supplies",
            "locationStatus": "verified",
            "locationVerified": True,
            "hasCoordinates": True,
            "latitude": latitude,
            "longitude": longitude,
        }

    monkeypatch.setattr(main, "update_dealer_coordinates", mock_update_coords)

    coord_resp = test_client.post(
        "/api/v1/agrodealer/me/location/coordinates",
        headers={"Authorization": "Bearer token"},
        json={"latitude": -0.42, "longitude": 36.95, "accuracyMeters": 10.0},
    )
    assert coord_resp.status_code == 200
    assert coord_resp.json()["locationVerified"] is True

    # 3. Location revocation
    monkeypatch.setattr(
        main,
        "revoke_dealer_location",
        lambda uid: {
            "id": "prof-1",
            "userId": uid,
            "businessName": "Mwangi Agro Supplies",
            "locationPermissionStatus": "denied",
            "locationStatus": "unavailable",
            "hasCoordinates": False,
        },
    )

    revoke_resp = test_client.post(
        "/api/v1/agrodealer/me/location/revoke",
        headers={"Authorization": "Bearer token"},
    )
    assert revoke_resp.status_code == 200
    assert revoke_resp.json()["locationPermissionStatus"] == "denied"
    assert revoke_resp.json()["hasCoordinates"] is False


def test_agrodealer_product_archive_and_delete(monkeypatch) -> None:
    from app import main

    test_client = TestClient(main.app)
    dealer_subject = "dealer-sub-002"
    dealer_id = "dealer-user-002"

    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=dealer_subject),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda sub: {"id": dealer_id, "role": "agrodealer", "is_active": True}
        if sub == dealer_subject else None,
    )

    # Archive product
    monkeypatch.setattr(
        main,
        "archive_dealer_product",
        lambda uid, product_id, is_listed: {
            "id": product_id,
            "name": "NPK 23:23:0",
            "isListed": is_listed,
        } if uid == dealer_id else None,
    )

    archive_resp = test_client.post(
        "/api/v1/agrodealer/me/products/prod-123/archive",
        headers={"Authorization": "Bearer token"},
        json={"isListed": False},
    )
    assert archive_resp.status_code == 200
    assert archive_resp.json()["isListed"] is False

    # Delete product
    monkeypatch.setattr(
        main,
        "delete_dealer_product",
        lambda uid, product_id: bool(uid == dealer_id and product_id == "prod-123"),
    )

    del_resp = test_client.delete(
        "/api/v1/agrodealer/me/products/prod-123",
        headers={"Authorization": "Bearer token"},
    )
    assert del_resp.status_code == 200
    assert del_resp.json()["status"] == "deleted"


def test_marketplace_orders_gated_on_terms_and_lifecycle(monkeypatch) -> None:
    from app import main

    test_client = TestClient(main.app)
    buyer_subject = "buyer-sub-001"
    buyer_id = "buyer-user-001"
    dealer_subject = "dealer-sub-003"
    dealer_id = "dealer-user-003"

    user_profiles = {
        buyer_subject: {"id": buyer_id, "role": "farmer", "is_active": True},
        dealer_subject: {"id": dealer_id, "role": "agrodealer", "is_active": True},
    }

    current_subject = {"val": buyer_subject}
    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=current_subject["val"]),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda sub: user_profiles.get(sub),
    )

    # 1. Order without terms -> rejected 400
    order_payload = {
        "productId": "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff20",
        "quantity": 2,
        "fulfillmentType": "pickup",
        "termsAccepted": False,
    }
    fail_resp = test_client.post(
        "/api/v1/marketplace/orders",
        headers={"Authorization": "Bearer buyer-token"},
        json=order_payload,
    )
    assert fail_resp.status_code == 400

    # 2. Order with terms -> accepted 201
    monkeypatch.setattr(
        main,
        "create_marketplace_order",
        lambda buyer_user_id, product_id, quantity, fulfillment_type, terms_accepted, notes: {
            "id": "order-001",
            "dealerId": "dealer-prof-003",
            "productId": product_id,
            "productName": "Can 26% N",
            "quantity": quantity,
            "unitPrice": 3200.0,
            "totalPrice": 6400.0,
            "currency": "KES",
            "status": "pending_confirmation",
            "termsAccepted": True,
            "fulfillmentType": fulfillment_type,
        },
    )

    success_resp = test_client.post(
        "/api/v1/marketplace/orders",
        headers={"Authorization": "Bearer buyer-token"},
        json={**order_payload, "termsAccepted": True},
    )
    assert success_resp.status_code == 201
    assert success_resp.json()["totalPrice"] == 6400.0
    assert success_resp.json()["status"] == "pending_confirmation"

    # 3. Dealer lists orders
    current_subject["val"] = dealer_subject
    monkeypatch.setattr(
        main,
        "load_dealer_orders",
        lambda uid: [
            {
                "id": "order-001",
                "dealerId": "dealer-prof-003",
                "productId": "4e9e9b0d-52a3-4a5f-a08c-0b8b75aaff20",
                "productName": "Can 26% N",
                "quantity": 2,
                "unitPrice": 3200.0,
                "totalPrice": 6400.0,
                "currency": "KES",
                "status": "pending_confirmation",
                "termsAccepted": True,
                "fulfillmentType": "pickup",
            }
        ] if uid == dealer_id else [],
    )

    dealer_orders_resp = test_client.get(
        "/api/v1/agrodealer/me/orders",
        headers={"Authorization": "Bearer dealer-token"},
    )
    assert dealer_orders_resp.status_code == 200
    assert len(dealer_orders_resp.json()) == 1

    # 4. Status update to confirmed, cancelled, or disputed
    monkeypatch.setattr(
        main,
        "update_marketplace_order_status",
        lambda user_id, order_id, status, cancellation_reason=None, dispute_reason=None: {
            "id": order_id,
            "status": status,
            "cancellationReason": cancellation_reason,
            "disputeReason": dispute_reason,
        },
    )

    patch_resp = test_client.patch(
        "/api/v1/agrodealer/me/orders/order-001",
        headers={"Authorization": "Bearer dealer-token"},
        json={"status": "confirmed"},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["status"] == "confirmed"


def test_agrodealer_proximity_search(monkeypatch) -> None:
    from app import main

    test_client = TestClient(main.app)

    monkeypatch.setattr(
        main,
        "search_dealers_proximity",
        lambda latitude, longitude, radius_km, county, ward: {
            "searchMethod": "coordinates_proximity" if latitude else "administrative_boundary_fallback",
            "disclaimer": "Marketplace Listing Only — Not an Endorsement. SoilSync does not endorse specific commercial brands or guarantee product availability.",
            "privacyNotice": "Search is performed without exposing farmer identities or soil test results to agrodealers.",
            "dealers": [
                {
                    "id": "dealer-1",
                    "businessName": "Tetu Agrovet",
                    "county": "Nyeri",
                    "subCounty": "Tetu",
                    "ward": "Dedan Kimathi",
                    "distanceKm": 4.2 if latitude else None,
                    "locationVerified": True,
                }
            ],
        },
    )

    # 1. Coordinate search
    resp = test_client.get("/api/v1/agrodealer/search?latitude=-0.42&longitude=36.95&radiusKm=15")
    assert resp.status_code == 200
    data = resp.json()
    assert data["searchMethod"] == "coordinates_proximity"
    assert "Not an Endorsement" in data["disclaimer"]
    assert "without exposing farmer identities" in data["privacyNotice"]
    assert data["dealers"][0]["distanceKm"] == 4.2

    # 2. Administrative fallback
    resp_fallback = test_client.get("/api/v1/agrodealer/search?county=Nyeri&ward=Dedan%20Kimathi")
    assert resp_fallback.status_code == 200
    assert resp_fallback.json()["searchMethod"] == "administrative_boundary_fallback"
    assert resp_fallback.json()["dealers"][0]["distanceKm"] is None


def test_cross_role_access_denials_for_agrodealer(monkeypatch) -> None:
    from app import main

    test_client = TestClient(main.app)
    dealer_subject = "dealer-sub-004"
    dealer_id = "dealer-user-004"

    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=dealer_subject),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda sub: {"id": dealer_id, "role": "agrodealer", "is_active": True}
        if sub == dealer_subject else None,
    )

    # Dealer cannot access farmer farms or sync status
    assert test_client.get("/api/v1/farms", headers={"Authorization": "Bearer t"}).status_code == 403
    assert test_client.get("/api/v1/farms/sync-status", headers={"Authorization": "Bearer t"}).status_code == 403

    # Dealer cannot access officer visits or alerts
    assert test_client.get("/api/v1/officer/visits", headers={"Authorization": "Bearer t"}).status_code == 403
    assert test_client.get("/api/v1/officer/alerts", headers={"Authorization": "Bearer t"}).status_code == 403


def test_agrodealer_workflow_migration_013_exists() -> None:
    from pathlib import Path
    migration_path = (
        Path(__file__).resolve().parent.parent
        / "database"
        / "migrations"
        / "013_agrodealer_workflow.sql"
    )
    assert migration_path.exists()
    content = migration_path.read_text(encoding="utf-8").upper()
    assert "LOCATION_CONSENT_AT" in content
    assert "MARKETPLACE_ORDERS" in content
    assert "ENABLE ROW LEVEL SECURITY" in content


def test_admin_system_overview_metrics(monkeypatch) -> None:
    from app import main

    test_client = TestClient(main.app)
    admin_subject = "admin-sub-overview"
    admin_id = "admin-user-overview"

    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=admin_subject),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda sub: {"id": admin_id, "role": "admin", "is_active": True}
        if sub == admin_subject else None,
    )
    monkeypatch.setattr(
        main,
        "load_admin_system_overview",
        lambda aid: {
            "totalUsers": 42,
            "activeUsers": 38,
            "pendingApprovals": 3,
            "roleBreakdown": {
                "farmers": 28,
                "extensionOfficers": 6,
                "agrodealers": 6,
                "admins": 2,
            },
            "totalFarms": 35,
            "totalSoilReadings": 120,
            "syncOverview": {"pending": 2, "draft": 5, "failed": 1, "conflict": 0},
            "unresolvedAlerts": 4,
            "activeSupportGrants": 1,
        },
    )

    resp = test_client.get(
        "/api/v1/admin/overview",
        headers={"Authorization": "Bearer admin-token"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["totalUsers"] == 42
    assert data["roleBreakdown"]["farmers"] == 28
    assert data["roleBreakdown"]["agrodealers"] == 6
    assert data["syncOverview"]["pending"] == 2


def test_admin_account_approval_and_revocation_flows(monkeypatch) -> None:
    from app import main

    test_client = TestClient(main.app)
    admin_subject = "admin-sub-approval"
    admin_id = "admin-user-approval"

    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=admin_subject),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda sub: {"id": admin_id, "role": "admin", "is_active": True}
        if sub == admin_subject else None,
    )

    audit_entries = []
    monkeypatch.setattr(
        main,
        "create_admin_audit_entry",
        lambda **kwargs: audit_entries.append(kwargs),
    )

    # 1. Approval flow
    monkeypatch.setattr(
        main,
        "admin_approve_user",
        lambda aid, uid, notes=None: {
            "userId": uid,
            "displayName": "Officer Sarah",
            "email": "sarah@extension.go.ke",
            "role": "extension_officer",
            "isActive": True,
            "approvalStatus": "approved",
            "approvedAt": "2026-10-02T12:00:00Z",
        },
    )

    resp_approve = test_client.post(
        "/api/v1/admin/users/officer-123/approve",
        headers={"Authorization": "Bearer admin-token"},
        json={"notes": "Verified credentials with Ministry of Agriculture."},
    )
    assert resp_approve.status_code == 200
    assert resp_approve.json()["approvalStatus"] == "approved"
    assert any(e["action"] == "approve_user" for e in audit_entries)

    # 2. Revocation flow with mandatory reason
    monkeypatch.setattr(
        main,
        "admin_revoke_user",
        lambda aid, uid, reason, revoke_role=False: {
            "userId": uid,
            "displayName": "De-registered Dealer",
            "email": "rogue@agrovet.test",
            "role": "farmer" if revoke_role else "agrodealer",
            "isActive": False,
            "approvalStatus": "suspended",
            "suspendedAt": "2026-10-02T12:05:00Z",
            "revocationReason": reason,
        },
    )

    resp_revoke = test_client.post(
        "/api/v1/admin/users/dealer-999/revoke",
        headers={"Authorization": "Bearer admin-token"},
        json={"reason": "Expired pesticide license and unverified stock.", "revokeRole": True},
    )
    assert resp_revoke.status_code == 200
    assert resp_revoke.json()["approvalStatus"] == "suspended"
    assert resp_revoke.json()["isActive"] is False
    assert any(e["action"] == "revoke_user" for e in audit_entries)


def test_admin_operational_health_privacy_safeguards(monkeypatch) -> None:
    from app import main

    test_client = TestClient(main.app)
    admin_subject = "admin-sub-health"
    admin_id = "admin-user-health"

    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=admin_subject),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda sub: {"id": admin_id, "role": "admin", "is_active": True}
        if sub == admin_subject else None,
    )
    monkeypatch.setattr(
        main,
        "load_admin_operational_health",
        lambda aid: {
            "status": "operational",
            "checkedAt": "2026-10-02T12:00:00Z",
            "database": {
                "status": "connected",
                "engine": "PostgreSQL 16 (PostGIS)",
                "poolStatus": "healthy",
            },
            "syncSubsystem": {
                "failedDraftsCount": 2,
                "conflictDraftsCount": 1,
                "privacySafeguard": "Sync issue metrics are strictly anonymized. No farmer identifiers, phone numbers, or coordinates are exposed.",
            },
            "importBatches": [
                {
                    "batchId": "b-001",
                    "datasetKey": "isric_wosis_2024",
                    "datasetTitle": "WoSIS Kenya Soil Profiles",
                    "fileName": "wosis_kenya_latest.parquet",
                    "status": "completed",
                    "rowsRead": 1200,
                    "rowsImported": 1180,
                    "rowsRejected": 20,
                    "startedAt": "2026-10-01T04:00:00Z",
                    "completedAt": "2026-10-01T04:12:00Z",
                }
            ],
            "externalProviders": [
                {
                    "provider": "ISRIC_SOILGRIDS",
                    "label": "SoilGrids REST & WCS",
                    "status": "healthy",
                    "description": "Global gridded soil property layers at 250m resolution.",
                },
                {
                    "provider": "ISRIC_WOSIS",
                    "label": "WoSIS Standardized Soil Profile Database",
                    "status": "healthy",
                    "description": "Standardized point observations dataset for Eastern Africa.",
                },
                {
                    "provider": "SUPABASE_AUTH",
                    "label": "Supabase Identity & Auth",
                    "status": "healthy",
                    "description": "JWT-based session authentication and cryptographic token verification.",
                },
            ],
        },
    )

    resp = test_client.get(
        "/api/v1/admin/operational-health",
        headers={"Authorization": "Bearer admin-token"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "operational"
    assert data["database"]["status"] == "connected"
    assert len(data["externalProviders"]) == 3

    # Verify strict privacy safeguards: no phone, personal email, or GPS coordinates in payload
    raw_text = resp.text.lower()
    assert "@gmail.com" not in raw_text
    assert "+254" not in raw_text
    assert "latitude" not in raw_text
    assert "longitude" not in raw_text


def test_admin_time_limited_support_access_break_glass(monkeypatch) -> None:
    from app import main

    test_client = TestClient(main.app)
    admin_subject = "admin-sub-support"
    admin_id = "admin-user-support"

    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=admin_subject),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda sub: {"id": admin_id, "role": "admin", "is_active": True}
        if sub == admin_subject else None,
    )

    audit_entries = []
    monkeypatch.setattr(
        main,
        "create_admin_audit_entry",
        lambda **kwargs: audit_entries.append(kwargs),
    )

    # 1. Grant support access
    monkeypatch.setattr(
        main,
        "create_support_access_grant",
        lambda admin_user_id, target_type, target_id, reason, duration_minutes: {
            "grantId": "grant-abc-123",
            "adminUserId": admin_user_id,
            "targetType": target_type,
            "targetId": target_id,
            "reason": reason,
            "durationMinutes": duration_minutes,
            "expiresAt": "2026-10-02T13:30:00Z",
            "isRevoked": False,
            "accessCount": 0,
            "createdAt": "2026-10-02T12:30:00Z",
        },
    )

    resp_grant = test_client.post(
        "/api/v1/admin/support-access/grants",
        headers={"Authorization": "Bearer admin-token"},
        json={
            "targetType": "farm",
            "targetId": "farm-target-001",
            "reason": "Farmer reported sync conflict on soil pH readings during support call.",
            "durationMinutes": 60,
        },
    )
    assert resp_grant.status_code == 201
    assert resp_grant.json()["grantId"] == "grant-abc-123"
    assert any(e["action"] == "grant_support_access" for e in audit_entries)

    # 2. Access sensitive record under active grant
    monkeypatch.setattr(
        main,
        "access_sensitive_record_under_grant",
        lambda admin_user_id, target_type, target_id, grant_id=None: {
            "grantId": "grant-abc-123",
            "targetType": target_type,
            "targetId": target_id,
            "accessReason": "Farmer reported sync conflict",
            "accessedAt": "2026-10-02T12:35:00Z",
            "record": {
                "farmId": target_id,
                "farmName": "Highland Tea Farm",
                "county": "Nyeri",
                "ward": "Tetu",
                "ownerName": "John Kimani",
                "ownerEmail": "john@farmer.test",
            },
        },
    )

    resp_access = test_client.get(
        "/api/v1/admin/support-access/records/farm/farm-target-001?grant_id=grant-abc-123",
        headers={"Authorization": "Bearer admin-token"},
    )
    assert resp_access.status_code == 200
    assert resp_access.json()["record"]["farmName"] == "Highland Tea Farm"
    assert any(e["action"] == "access_sensitive_record" for e in audit_entries)

    # 3. Access without valid grant -> 403
    monkeypatch.setattr(
        main,
        "access_sensitive_record_under_grant",
        lambda admin_user_id, target_type, target_id, grant_id=None: None,
    )
    resp_unauthorized = test_client.get(
        "/api/v1/admin/support-access/records/farm/unauthorized-farm",
        headers={"Authorization": "Bearer admin-token"},
    )
    assert resp_unauthorized.status_code == 403

    # 4. Revoke grant
    monkeypatch.setattr(
        main,
        "revoke_support_access_grant",
        lambda admin_user_id, grant_id, reason: {
            "grantId": grant_id,
            "adminUserId": admin_user_id,
            "targetType": "farm",
            "targetId": "farm-target-001",
            "isRevoked": True,
            "revokedAt": "2026-10-02T12:40:00Z",
            "revocationReason": reason,
        },
    )

    resp_revoke = test_client.post(
        "/api/v1/admin/support-access/grants/grant-abc-123/revoke",
        headers={"Authorization": "Bearer admin-token"},
        json={"revocationReason": "Support investigation completed successfully."},
    )
    assert resp_revoke.status_code == 200
    assert resp_revoke.json()["isRevoked"] is True
    assert any(e["action"] == "revoke_support_access" for e in audit_entries)


def test_admin_system_settings_validation_and_audit(monkeypatch) -> None:
    from app import main

    test_client = TestClient(main.app)
    admin_subject = "admin-sub-settings"
    admin_id = "admin-user-settings"

    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=admin_subject),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda sub: {"id": admin_id, "role": "admin", "is_active": True}
        if sub == admin_subject else None,
    )

    audit_entries = []
    monkeypatch.setattr(
        main,
        "create_admin_audit_entry",
        lambda **kwargs: audit_entries.append(kwargs),
    )

    # 1. Load settings
    monkeypatch.setattr(
        main,
        "load_system_settings",
        lambda aid: [
            {
                "settingId": "s-1",
                "key": "sync.max_batch_size",
                "value": 50,
                "category": "sync",
                "description": "Max batch size for draft syncing",
                "isReadOnly": False,
                "updatedByName": "Admin Lead",
                "updatedAt": "2026-10-01T10:00:00Z",
            }
        ],
    )

    resp_settings = test_client.get(
        "/api/v1/admin/settings",
        headers={"Authorization": "Bearer admin-token"},
    )
    assert resp_settings.status_code == 200
    assert len(resp_settings.json()) == 1
    assert resp_settings.json()[0]["key"] == "sync.max_batch_size"

    # 2. Update setting
    monkeypatch.setattr(
        main,
        "update_system_setting",
        lambda admin_user_id, key, value: {
            "settingId": "s-1",
            "key": key,
            "value": value,
            "category": "sync",
            "description": "Max batch size for draft syncing",
            "isReadOnly": False,
            "updatedAt": "2026-10-02T13:00:00Z",
        },
    )

    resp_update = test_client.put(
        "/api/v1/admin/settings/sync.max_batch_size",
        headers={"Authorization": "Bearer admin-token"},
        json={"value": 100, "changeReason": "Increase throughput for peak planting season."},
    )
    assert resp_update.status_code == 200
    assert resp_update.json()["value"] == 100
    assert any(e["action"] == "update_system_setting" for e in audit_entries)


def test_admin_workflow_migration_014_exists() -> None:
    from pathlib import Path
    migration_path = (
        Path(__file__).resolve().parent.parent
        / "database"
        / "migrations"
        / "014_admin_workflow.sql"
    )
    assert migration_path.exists()
    content = migration_path.read_text(encoding="utf-8").upper()
    assert "SUPPORT_ACCESS_GRANTS" in content
    assert "SYSTEM_SETTINGS" in content
    assert "APPROVAL_STATUS" in content
    assert "ENABLE ROW LEVEL SECURITY" in content


def test_auth_authorization_v1_migration_016_exists() -> None:
    from pathlib import Path
    migration_path = (
        Path(__file__).resolve().parent.parent
        / "database"
        / "migrations"
        / "016_auth_authorization_v1.sql"
    )
    assert migration_path.exists()
    content = migration_path.read_text(encoding="utf-8").upper()
    assert "CREATE TABLE IF NOT EXISTS PUBLIC.PROFILES" in content
    assert "CREATE TABLE IF NOT EXISTS PUBLIC.USER_ROLES" in content
    assert "CREATE TABLE IF NOT EXISTS PUBLIC.AUDIT_LOG" in content
    assert "IMMUTABLE AND CANNOT BE UPDATED OR DELETED" in content
    assert "HANDLE_NEW_AUTH_USER" in content
    assert "PROFILES_SELECT_OWN_OR_ADMIN" in content
    assert "USER_ROLES_ADMIN_MANAGE" in content


def test_dependencies_extract_bearer_token() -> None:
    import pytest
    from fastapi import HTTPException

    from app.dependencies import extract_bearer_token

    with pytest.raises(HTTPException) as exc_info:
        extract_bearer_token(None)
    assert exc_info.value.status_code == 401

    with pytest.raises(HTTPException) as exc_info:
        extract_bearer_token("Basic 12345")
    assert exc_info.value.status_code == 401

    token = extract_bearer_token("Bearer my-secret-jwt")
    assert token == "my-secret-jwt"


def test_dependencies_require_role_matching_and_rejections() -> None:
    import pytest
    from fastapi import HTTPException

    from app.dependencies import AuthenticatedUser, require_admin, require_role

    farmer = AuthenticatedUser(
        auth_id="sub-1",
        app_user_id="user-1",
        email="farmer@example.com",
        role="farmer",
        is_active=True,
        approval_status="approved",
    )

    # Farmer allowed for farmer
    assert require_role("farmer")(user=farmer) == farmer

    # Farmer rejected for officer
    with pytest.raises(HTTPException) as exc_info:
        require_role("extension-officer")(user=farmer)
    assert exc_info.value.status_code == 403

    # Officer normalized role check
    officer = AuthenticatedUser(
        auth_id="sub-2",
        app_user_id="user-2",
        email="officer@example.com",
        role="extension_officer",
        is_active=True,
        approval_status="approved",
    )
    assert require_role("extension-officer")(user=officer) == officer

    # Pending dealer rejected
    pending_dealer = AuthenticatedUser(
        auth_id="sub-3",
        app_user_id="user-3",
        email="pending@dealer.com",
        role="agrodealer",
        is_active=True,
        approval_status="pending",
    )
    with pytest.raises(HTTPException) as exc_info:
        require_role("agrodealer")(user=pending_dealer)
    assert exc_info.value.status_code == 403
    assert "awaiting approval" in exc_info.value.detail

    # Admin check
    admin = AuthenticatedUser(
        auth_id="sub-4",
        app_user_id="user-4",
        email="admin@example.com",
        role="admin",
        is_active=True,
        approval_status="approved",
    )
    assert require_admin(user=admin) == admin


def test_agrodealer_apply_unauthenticated_rejected() -> None:
    response = client.post(
        "/api/v1/dealer/apply",
        json={
            "businessName": "Mau Agro Supplies",
            "licenceNumber": "AFA-2026-0099",
            "contactName": "Peter Mwangi",
            "county": "Nakuru",
            "subCounty": "Njoro",
            "ward": "Mau Narok",
            "phoneNumber": "+254712345678",
        },
    )
    assert response.status_code == 401


def test_agrodealer_apply_requires_admin_invitation(monkeypatch) -> None:
    route_globals = next(
        route.endpoint.__globals__
        for route in client.app.routes
        if getattr(route, "path", None) == "/api/v1/dealer/apply"
    )

    class MockUser:
        id = "mock-user-uuid"

    monkeypatch.setitem(route_globals, "get_verified_request_user", lambda req: ("mock-token", MockUser()))

    response = client.post(
        "/api/v1/dealer/apply",
        headers={"Authorization": "Bearer mock-token"},
        json={
            "businessName": "Mau Agro Supplies",
            "licenceNumber": "AFA-2026-0099",
            "contactName": "Peter Mwangi",
            "county": "Nakuru",
            "subCounty": "Njoro",
            "ward": "Mau Narok",
            "phoneNumber": "+254712345678",
        },
    )
    assert response.status_code == 403
    assert "created by administrators" in response.json()["detail"]


def test_agrodealer_application_status_authenticated(monkeypatch) -> None:
    route_globals = next(
        route.endpoint.__globals__
        for route in client.app.routes
        if getattr(route, "path", None) == "/api/v1/dealer/application-status"
    )

    class MockUser:
        id = "mock-user-uuid"

    monkeypatch.setitem(route_globals, "get_verified_request_user", lambda req: ("mock-token", MockUser()))
    monkeypatch.setitem(
        route_globals,
        "get_agrodealer_application_status",
        lambda user_id: {
            "applicationId": "app-uuid-123",
            "businessName": "Mau Agro Supplies",
            "licenceNumber": "AFA-2026-0099",
            "contactName": "Peter Mwangi",
            "county": "Nakuru",
            "subCounty": "Njoro",
            "ward": "Mau Narok",
            "shopLocation": "Mau Narok Center",
            "verificationState": "pending",
            "createdAt": "2026-10-03T00:00:00Z",
            "updatedAt": "2026-10-03T00:00:00Z",
        },
    )

    response = client.get(
        "/api/v1/dealer/application-status",
        headers={"Authorization": "Bearer mock-token"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["hasApplication"] is True
    assert data["application"]["verificationState"] == "pending"


def test_admin_invite_extension_officer_endpoint(monkeypatch) -> None:
    from app import main
    client = TestClient(app)
    
    # 1. Unauthenticated request rejected
    res_unauth = client.post(
        "/api/v1/admin/officers/invite",
        json={
            "email": "officer1@example.com",
            "designation": "ward",
            "county": "Nakuru",
            "subCounty": "Njoro",
            "ward": "Mau Narok",
        },
    )
    assert res_unauth.status_code == 401

    # 2. Authenticated as admin
    monkeypatch.setattr(
        main,
        "require_admin_session",
        lambda req: "admin-user-001",
    )
    
    invited_record = {
        "officerUserId": "officer-new-123",
        "assignmentId": "asgn-new-456",
        "email": "officer1@example.com",
        "designation": "ward",
        "county": "Nakuru",
        "subCounty": "Njoro",
        "ward": "Mau Narok",
        "role": "extension_officer",
        "status": "pending",
        "invitedAt": "2026-10-03T00:00:00Z",
    }
    
    monkeypatch.setattr(
        main,
        "admin_invite_officer",
        lambda **kwargs: invited_record,
    )
    monkeypatch.setattr(main, "check_admin_permission", lambda *_args: True)
    monkeypatch.setattr(main, "invite_user_by_email", lambda _email: {"id": "auth-user-001"})
    monkeypatch.setattr(main, "delete_supabase_user", lambda _auth_user_id: None)
    monkeypatch.setattr(
        main,
        "create_admin_audit_entry",
        lambda **kwargs: None,
    )

    res = client.post(
        "/api/v1/admin/officers/invite",
        json={
            "email": "officer1@example.com",
            "designation": "ward",
            "county": "Nakuru",
            "subCounty": "Njoro",
            "ward": "Mau Narok",
            "displayName": "Officer Sarah",
        },
    )
    assert res.status_code == 201
    data = res.json()
    assert data["officerUserId"] == "officer-new-123"
    assert data["designation"] == "ward"
    assert data["county"] == "Nakuru"
    assert data["subCounty"] == "Njoro"
    assert data["ward"] == "Mau Narok"
    assert data["role"] == "extension_officer"
    assert data["status"] == "pending"
    assert data["invitedAt"] == "2026-10-03T00:00:00Z"

    # 3. Validation failure: designation 'ward' missing ward
    res_invalid = client.post(
        "/api/v1/admin/officers/invite",
        json={
            "email": "officer2@example.com",
            "designation": "ward",
            "county": "Nakuru",
        },
    )
    assert res_invalid.status_code == 422


def test_admin_invite_agrodealer_endpoint(monkeypatch) -> None:
    from app import main

    client = TestClient(app)
    monkeypatch.setattr(main, "require_admin_session", lambda _request: "admin-user-001")
    monkeypatch.setattr(main, "check_admin_permission", lambda *_args: True)
    monkeypatch.setattr(main, "invite_user_by_email", lambda _email: {"id": "auth-dealer-001"})
    monkeypatch.setattr(main, "delete_supabase_user", lambda _auth_user_id: None)
    monkeypatch.setattr(
        main,
        "admin_invite_agrodealer",
        lambda **kwargs: {
            "dealerUserId": "dealer-user-001",
            "email": kwargs["email"].lower(),
            "businessName": kwargs["business_name"],
            "role": "agrodealer",
            "status": "pending",
            "invitedAt": "2026-10-03T00:00:00Z",
        },
    )
    monkeypatch.setattr(main, "create_admin_audit_entry", lambda **_kwargs: None)

    response = client.post(
        "/api/v1/admin/agrodealer/invite",
        json={
            "email": "dealer@example.com",
            "displayName": "Mary Dealer",
            "businessName": "Green Valley Agrovet",
            "county": "Nakuru",
            "subCounty": "Njoro",
        },
    )
    assert response.status_code == 201
    assert response.json() == {
        "dealerUserId": "dealer-user-001",
        "email": "dealer@example.com",
        "businessName": "Green Valley Agrovet",
        "role": "agrodealer",
        "status": "pending",
        "invitedAt": "2026-10-03T00:00:00Z",
    }

    invalid = client.post(
        "/api/v1/admin/agrodealer/invite",
        json={
            "email": "dealer@example.com",
            "displayName": "Mary Dealer",
            "businessName": "Green Valley Agrovet",
            "ward": "Mau Narok",
        },
    )
    assert invalid.status_code == 422


def test_activate_admin_invitation_endpoint(monkeypatch) -> None:
    from app import main

    client = TestClient(app)
    monkeypatch.setattr(
        main,
        "get_verified_request_user",
        lambda _request: ("valid-token", type("AuthUser", (), {"id": "auth-user-001"})()),
    )
    activated_users: list[str] = []
    monkeypatch.setattr(
        main,
        "activate_account_invitation",
        lambda auth_user_id: activated_users.append(auth_user_id) or "extension-officer",
    )

    response = client.post(
        "/api/v1/auth/invitations/activate",
        headers={"Authorization": "Bearer valid-token"},
    )
    assert response.status_code == 200
    assert response.json() == {"status": "active", "role": "extension-officer"}
    assert activated_users == ["auth-user-001"]


def test_admin_invite_officer_database(monkeypatch) -> None:
    from typing import Self

    from app import database

    class MockCursor:
        def __init__(self) -> None:
            self.calls: list[tuple[str, tuple[object, ...] | None]] = []

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def execute(self, query: str, params: tuple[object, ...] | None = None) -> None:
            self.calls.append((query, params))

        def fetchone(self) -> dict[str, object] | None:
            query = " ".join(self.calls[-1][0].lower().split())
            if "select 1 from admin_permissions" in query:
                return {"1": 1}
            if "select id, role, is_active from users" in query:
                return None  # new user
            if "insert into officer_jurisdictions" in query:
                return {"id": "jurisdiction-uuid-1", "created_at": "2026-10-03T00:00:00Z"}
            return None

        def fetchall(self) -> list[dict[str, object]]:
            return []

    class MockConnection:
        def __init__(self, cursor: MockCursor) -> None:
            self.c = cursor

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def cursor(self) -> MockCursor:
            return self.c

        def commit(self) -> None:
            pass

    mock_cursor = MockCursor()
    monkeypatch.setattr(database, "_connect", lambda: MockConnection(mock_cursor))
    monkeypatch.setattr(database, "check_admin_permission", lambda uid, perm: True)

    res = database.admin_invite_officer(
        admin_user_id="admin-uid-1",
        auth_user_id="auth-user-001",
        email="officer.mary@example.com",
        designation="subcounty",
        county="Nakuru",
        sub_county="Njoro",
        ward=None,
        display_name="Mary Wambui",
    )
    assert res is not None
    assert res["email"] == "officer.mary@example.com"
    assert res["designation"] == "subcounty"
    assert res["county"] == "Nakuru"
    assert res["subCounty"] == "Njoro"
    assert res["ward"] is None
    assert res["role"] == "extension_officer"
    assert res["status"] == "pending"

    queries = [" ".join(call[0].lower().split()) for call in mock_cursor.calls]
    assert any("insert into users" in q for q in queries)
    assert any("insert into user_roles" in q for q in queries)
    assert any("insert into officer_jurisdictions" in q for q in queries)
    assert any("insert into audit_log" in q for q in queries)
    assert any("insert into account_invitations" in q for q in queries)
    assert any("status = 'pending'" in q for q in queries)

    # Permission denied case
    monkeypatch.setattr(database, "check_admin_permission", lambda uid, perm: False)
    denied = database.admin_invite_officer(
        admin_user_id="unauthorized-admin",
        auth_user_id="auth-user-002",
        email="test@example.com",
        designation="county",
        county="Nakuru",
    )
    assert denied is None


def test_admin_invite_agrodealer_database(monkeypatch) -> None:
    from typing import Self

    from app import database

    class MockCursor:
        def __init__(self) -> None:
            self.calls: list[tuple[str, tuple[object, ...] | None]] = []

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def execute(self, query: str, params: tuple[object, ...] | None = None) -> None:
            self.calls.append((query, params))

        def fetchone(self) -> dict[str, object] | None:
            return None

    class MockConnection:
        def __init__(self, cursor: MockCursor) -> None:
            self.c = cursor

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def cursor(self) -> MockCursor:
            return self.c

        def commit(self) -> None:
            pass

    mock_cursor = MockCursor()
    monkeypatch.setattr(database, "_connect", lambda: MockConnection(mock_cursor))
    monkeypatch.setattr(database, "check_admin_permission", lambda _uid, _permission: True)

    result = database.admin_invite_agrodealer(
        admin_user_id="admin-uid-1",
        auth_user_id="auth-dealer-001",
        email="Dealer@Example.com",
        display_name="Mary Dealer",
        business_name="Green Valley Agrovet",
        county="Nakuru",
        sub_county="Njoro",
        ward="Mau Narok",
    )
    assert result is not None
    assert result["email"] == "dealer@example.com"
    assert result["businessName"] == "Green Valley Agrovet"
    assert result["role"] == "agrodealer"
    assert result["status"] == "pending"

    queries = [" ".join(call[0].lower().split()) for call in mock_cursor.calls]
    assert any("insert into agrodealer_profiles" in query for query in queries)
    assert any("insert into account_invitations" in query for query in queries)
    assert any("insert into user_roles" in query for query in queries)
    assert any("insert into audit_log" in query for query in queries)


def test_activate_account_invitation_database(monkeypatch) -> None:
    from typing import Self

    from app import database

    class MockCursor:
        def __init__(self) -> None:
            self.calls: list[tuple[str, tuple[object, ...] | None]] = []

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def execute(self, query: str, params: tuple[object, ...] | None = None) -> None:
            self.calls.append((query, params))

        def fetchone(self) -> dict[str, object] | None:
            query = self.calls[-1][0].lower()
            if "from account_invitations" in query:
                return {
                    "role": "extension-officer",
                    "status": "pending",
                    "is_active": True,
                    "app_role": "extension_officer",
                }
            if "update user_roles" in query:
                return {"user_id": "auth-user-001"}
            if "update users" in query:
                return {"id": "legacy-user-001"}
            if "update account_invitations" in query:
                return {"auth_user_id": "auth-user-001"}
            return None

    class MockConnection:
        def __init__(self, cursor: MockCursor) -> None:
            self.c = cursor

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def cursor(self) -> MockCursor:
            return self.c

        def commit(self) -> None:
            pass

    mock_cursor = MockCursor()
    monkeypatch.setattr(database, "_connect", lambda: MockConnection(mock_cursor))

    role = database.activate_account_invitation("auth-user-001")
    assert role == "extension-officer"
    queries = [" ".join(call[0].lower().split()) for call in mock_cursor.calls]
    assert any("update account_invitations" in query for query in queries)
    assert any("update user_roles" in query for query in queries)
    assert any("update users" in query for query in queries)


def test_activate_account_invitation_does_not_restore_suspended_user(monkeypatch) -> None:
    from typing import Self

    from app import database

    class MockCursor:
        calls: list[str] = []

        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def execute(self, query: str, _params: tuple[object, ...] | None = None) -> None:
            self.calls.append(query)

        def fetchone(self) -> dict[str, object]:
            return {
                "role": "agrodealer",
                "status": "pending",
                "is_active": False,
                "app_role": "agrodealer",
            }

    class MockConnection:
        def __enter__(self) -> Self:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

        def cursor(self) -> MockCursor:
            return MockCursor()

        def commit(self) -> None:
            pass

    MockCursor.calls = []
    monkeypatch.setattr(database, "_connect", lambda: MockConnection())

    result = database.activate_account_invitation("suspended-auth-user")
    assert result is None
    assert len(MockCursor.calls) == 1
    assert "for update of invitation, users" in " ".join(MockCursor.calls[0].lower().split())


def test_validate_admin_password_policy() -> None:
    from fastapi import HTTPException

    from app.dependencies import validate_admin_password

    # Valid password: >= 12 chars, upper, lower, number, special char
    validate_admin_password("AdminSecure!2026")

    # Too short (< 12 chars)
    with pytest.raises(HTTPException) as exc:
        validate_admin_password("Short!1")
    assert exc.value.status_code == 422
    assert "at least 12 characters" in exc.value.detail

    # Missing uppercase
    with pytest.raises(HTTPException) as exc:
        validate_admin_password("admin!secure123")
    assert exc.value.status_code == 422
    assert "uppercase" in exc.value.detail

    # Missing lowercase
    with pytest.raises(HTTPException) as exc:
        validate_admin_password("ADMIN!SECURE123")
    assert exc.value.status_code == 422
    assert "lowercase" in exc.value.detail

    # Missing digit
    with pytest.raises(HTTPException) as exc:
        validate_admin_password("Admin!SecureSpecial")
    assert exc.value.status_code == 422
    assert "number" in exc.value.detail

    # Missing special character
    with pytest.raises(HTTPException) as exc:
        validate_admin_password("AdminSecure2026")
    assert exc.value.status_code == 422
    assert "special character" in exc.value.detail


def test_admin_audit_entry_dual_logging(monkeypatch) -> None:
    from app import database

    class MockCursor:
        def __init__(self):
            self.calls = []

        def execute(self, query: str, params: tuple | None = None) -> None:
            self.calls.append((query, params))

        def fetchone(self):
            from datetime import UTC, datetime
            return {"id": "audit-log-id-1", "created_at": datetime.now(UTC)}

        def close(self) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            pass

    class MockConnection:
        def __init__(self, c: MockCursor):
            self.c = c

        def cursor(self) -> MockCursor:
            return self.c

        def commit(self) -> None:
            pass

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            pass

    mock_cursor = MockCursor()
    monkeypatch.setattr(database, "_connect", lambda: MockConnection(mock_cursor))

    res = database.create_admin_audit_entry(
        actor_user_id="admin-123",
        action="update_setting",
        target_type="setting",
        target_id="sync_retry_limit",
        detail={"old": 3, "new": 5},
        actor_role="admin",
    )
    assert res is not None
    assert res["auditId"] == "audit-log-id-1"
    assert res["createdAt"] is not None

    queries = [" ".join(call[0].lower().split()) for call in mock_cursor.calls]
    # Check writing to admin_audit_log
    assert any("insert into admin_audit_log" in q for q in queries)
    # Check dual-writing to public.audit_log
    assert any("insert into audit_log" in q for q in queries)


def test_kalro_recommendation_engine_comprehensive() -> None:
    """Verifies KALRO agronomic recommendation engine calculations across crops and soil levels."""
    from app.recommendations import generate_agronomic_assessment

    # 1. Acidic Maize Farm in Nyeri (Central Highlands Volcanic Nitisols)
    maize_soil = {
        "soil_ph": 4.9,
        "total_nitrogen": 0.09,
        "olsen_phosphorus": 8.5,
        "exchangeable_potassium": 0.18,
        "organic_carbon": 1.1,
    }
    assessment = generate_agronomic_assessment(
        soil_values=maize_soil,
        crop="maize",
        county="Nyeri",
        sub_county="Mukurweini",
        ward="Rugi",
        size_acres=2.5,
        field_notes="Maize stunting observed across block A.",
    )

    assert assessment["engineVersion"] == "kalro-rules-v2.1"
    assert assessment["crop"] == "Maize (Zea mays)"
    assert assessment["farmAcreage"] == 2.5
    assert "Central Highlands" in assessment["regionalZone"]

    # Verify pH diagnosis and Liming prescription
    diagnoses = {d["analyte"]: d for d in assessment["diagnoses"]}
    assert diagnoses["soil_ph"]["status"] == "critical_deficiency"

    categories = {p["category"]: p for p in assessment["prescriptions"]}
    assert "liming" in categories
    assert "t/ha" in categories["liming"]["ratePerHa"]
    assert "bags" in categories["liming"]["totalFarmPrescription"]

    # Verify Basal DAP & Top-dressing CAN
    assert "basal_fertilizer" in categories
    assert "topdressing" in categories
    assert "soil_rehabilitation" in categories

    # Verify commercial fertilizer matches
    commercial_cats = [c["category"] for c in assessment["commercialInputs"]]
    assert "Soil Amendment" in commercial_cats
    assert "Basal Planting Fertilizer" in commercial_cats
    assert "Top-Dressing Fertilizer" in commercial_cats

    # Verify AI advisory and split schedules
    assert len(assessment["splitSchedule"]) >= 2
    assert len(assessment["aiAdvisoryNotes"]) >= 2
    assert any("Acidity Alert" in note for note in assessment["aiAdvisoryNotes"])

    # 2. Tea Crop Test (Acidophilic - pH 4.8 is optimal for tea)
    tea_assessment = generate_agronomic_assessment(
        soil_values={"soil_ph": 4.8, "olsen_phosphorus": 20.0},
        crop="tea",
        county="Kericho",
        size_acres=5.0,
    )
    tea_ph_diag = next(d for d in tea_assessment["diagnoses"] if d["analyte"] == "soil_ph")
    assert tea_ph_diag["status"] == "optimal"  # Tea thrives in pH 4.5 - 5.5, no lime prescribed
    tea_presc_cats = [p["category"] for p in tea_assessment["prescriptions"]]
    assert "liming" not in tea_presc_cats


def test_assessment_review_and_publication_workflow(monkeypatch) -> None:
    """Verifies end-to-end unverified assessment access, agronomist claim, edit, and verified publication."""
    from app import main

    test_client = TestClient(main.app)
    agronomist_id = "agronomist-uuid-1"
    agronomist_subject = "bbaabb01-52a3-4a5f-a08c-0b8b75aaff01"
    farmer_id = "farmer-uuid-1"
    farmer_subject = "ccaabb02-52a3-4a5f-a08c-0b8b75aaff02"

    def mock_user(token: str):
        if token == "agronomist-token":
            return SimpleNamespace(id=agronomist_subject)
        if token == "farmer-token":
            return SimpleNamespace(id=farmer_subject)
        return None

    def mock_profile(subject: str):
        if subject == agronomist_subject:
            return {"id": agronomist_id, "role": "agronomist", "display_name": "Dr. Sarah Agronomist", "is_active": True}
        if subject == farmer_subject:
            return {"id": farmer_id, "role": "farmer", "display_name": "Peter Farmer", "is_active": True}
        return None

    def mock_roles(subject: str):
        if subject == agronomist_subject:
            return [{"role": "agronomist", "status": "active"}]
        if subject == farmer_subject:
            return [{"role": "farmer", "status": "active"}]
        return []

    monkeypatch.setattr(main, "get_verified_supabase_user", mock_user)
    monkeypatch.setattr(main, "get_linked_supabase_profile", mock_profile)
    monkeypatch.setattr(main, "get_supabase_user_roles", mock_roles)

    # 1. Unverified Assessment List for Agronomist
    mock_assessment = {
        "assessmentId": "assess-1",
        "farmId": "farm-1",
        "farmName": "Green Ridge",
        "farmerName": "Peter Farmer",
        "status": "unverified",
        "reviewStage": "review_requested",
        "county": "Nyeri",
        "crop": "maize",
        "engineVersion": "kalro-rules-v2.1",
        "engineBaseline": {"prescriptions": [{"ratePerHa": "150 kg/ha"}]},
        "officerEdits": [],
        "agronomistEdits": [],
        "createdAt": "2026-10-03T12:00:00Z",
    }
    monkeypatch.setattr(main, "load_unverified_assessments", lambda user_id, role, county=None: [mock_assessment])

    res = test_client.get("/api/v1/assessments/unverified", headers={"Authorization": "Bearer agronomist-token"})
    assert res.status_code == 200
    assert len(res.json()) == 1
    assert res.json()[0]["assessmentId"] == "assess-1"

    # 2. Farmer cannot access unverified assessment report -> 404
    monkeypatch.setattr(main, "load_farm_verified_report", lambda user_id, farm_id: None)
    farmer_denied = test_client.get(
        "/api/v1/farms/farm-1/reports/verified",
        headers={"Authorization": "Bearer farmer-token"},
    )
    assert farmer_denied.status_code == 404

    # 3. Agronomist Claims Assessment Atomically
    monkeypatch.setattr(
        main,
        "claim_agronomic_assessment",
        lambda agronomist_user_id, assessment_id: {
            "assessmentId": assessment_id,
            "claimingAgronomistId": agronomist_user_id,
            "status": "unverified",
            "reviewStage": "claimed",
        },
    )
    claim_res = test_client.post(
        "/api/v1/assessments/assess-1/claim",
        headers={"Authorization": "Bearer agronomist-token"},
    )
    assert claim_res.status_code == 200
    assert claim_res.json()["reviewStage"] == "claimed"

    # 4. Agronomist Edits Assessment with Notes
    monkeypatch.setattr(
        main,
        "edit_agronomic_assessment",
        lambda user_id, role, assessment_id, author_name, notes, adjustments: {
            "assessmentId": assessment_id,
            "status": "unverified",
            "agronomistEdits": [{"authorName": author_name, "notes": notes}],
        },
    )
    edit_res = test_client.post(
        "/api/v1/assessments/assess-1/edit",
        headers={"Authorization": "Bearer agronomist-token"},
        json={"notes": "Adjusted lime prescription down by 10% due to recent compost addition."},
    )
    assert edit_res.status_code == 200
    assert len(edit_res.json()["agronomistEdits"]) == 1

    # 5. Agronomist Publishes Verified Report
    verified_doc = {
        "reportId": "report-verified-101",
        "assessmentId": "assess-1",
        "farmId": "farm-1",
        "status": "verified",
        "publishedAt": "2026-10-03T15:00:00Z",
        "certification": "Certified by Dr. Sarah Agronomist (KALRO/AGR-2026).",
        "prescriptions": [{"category": "liming", "ratePerHa": "1.8 t/ha"}],
    }
    monkeypatch.setattr(
        main,
        "publish_verified_assessment",
        lambda agronomist_user_id, agronomist_name, assessment_id, license_number, final_notes: {
            "assessmentId": assessment_id,
            "status": "verified",
            "reviewStage": "published",
            "verifiedReport": verified_doc,
        },
    )
    pub_res = test_client.post(
        "/api/v1/assessments/assess-1/publish",
        headers={"Authorization": "Bearer agronomist-token"},
        json={"license_number": "KALRO/AGR-2026", "final_notes": "Prescription approved for farmer application."},
    )
    assert pub_res.status_code == 200
    assert pub_res.json()["status"] == "verified"

    # 6. Now Farmer Can Retrieve the Published Verified Report
    monkeypatch.setattr(main, "load_farm_verified_report", lambda user_id, farm_id: verified_doc)
    report_res = test_client.get(
        "/api/v1/farms/farm-1/reports/verified",
        headers={"Authorization": "Bearer farmer-token"},
    )
    assert report_res.status_code == 200
    assert report_res.json()["reportId"] == "report-verified-101"
    assert report_res.json()["status"] == "verified"

