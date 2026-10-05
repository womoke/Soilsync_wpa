"""Security Verification & Comprehensive Test Suite (Step 9).

Validates complete security posture against privilege escalation, token tampering,
role bypass, jurisdiction boundary violations, and fail-closed error handling.
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.dependencies import (
    AuthenticatedUser,
    extract_bearer_token,
    get_current_user,
    require_admin,
    require_dealer,
    require_farmer,
    require_officer,
    require_role,
    validate_admin_password,
)
from app.supabase_client import (
    InvalidSupabaseIdentityError,
    SupabaseIdentityUnavailableError,
    SupabaseProfileConflictError,
)


class DummyRequest:
    def __init__(self, headers: dict[str, str] | None = None):
        self.headers = headers or {}


@pytest.fixture(autouse=True)
def mock_active_user_roles(monkeypatch):
    monkeypatch.setattr(
        "app.dependencies.get_supabase_user_roles",
        lambda _subject: [{"role": "farmer", "status": "active"}],
    )


# ==============================================================================
# 1. Bearer Token Extraction & Format Validation
# ==============================================================================

def test_extract_bearer_token_missing_header():
    """Missing Authorization header must fail closed with 401."""
    with pytest.raises(HTTPException) as exc:
        extract_bearer_token(None)
    assert exc.value.status_code == 401
    assert "Authorization header is required" in exc.value.detail


def test_extract_bearer_token_malformed_formats():
    """Malformed Authorization headers must be rejected."""
    malformed = [
        "Basic dXNlcjpwYXNz",
        "Token xyz123",
        "Bearer",
        "Bearer   ",
        "RandomTextWithoutPrefix",
    ]
    for bad_header in malformed:
        with pytest.raises(HTTPException) as exc:
            extract_bearer_token(bad_header)
        assert exc.value.status_code == 401


def test_extract_bearer_token_valid():
    """Valid Bearer tokens are properly parsed and trimmed."""
    token = extract_bearer_token("Bearer valid-jwt-token-string")
    assert token == "valid-jwt-token-string"

    token_padded = extract_bearer_token("   Bearer    padded-token-123   ")
    assert token_padded == "padded-token-123"


# ==============================================================================
# 2. Token Verification & Profile Resolution (Fail-Closed)
# ==============================================================================

def test_get_current_user_invalid_or_expired_token(monkeypatch):
    """Expired or forged Supabase tokens fail closed with 401."""
    def mock_verify_invalid(token: str):
        raise InvalidSupabaseIdentityError("Signature has expired")

    monkeypatch.setattr("app.dependencies.get_verified_supabase_user", mock_verify_invalid)

    req = DummyRequest()
    with pytest.raises(HTTPException) as exc:
        get_current_user(req, authorization="Bearer forged-or-expired-token")
    assert exc.value.status_code == 401
    assert "invalid or expired" in exc.value.detail


def test_get_current_user_upstream_auth_outage(monkeypatch):
    """When auth provider is unreachable, fail closed with 503."""
    def mock_verify_outage(token: str):
        raise SupabaseIdentityUnavailableError("Auth network timeout")

    monkeypatch.setattr("app.dependencies.get_verified_supabase_user", mock_verify_outage)

    req = DummyRequest()
    with pytest.raises(HTTPException) as exc:
        get_current_user(req, authorization="Bearer some-token")
    assert exc.value.status_code == 503


def test_get_current_user_unlinked_profile(monkeypatch):
    """Authenticated Supabase user without an active DB profile is rejected with 401."""
    monkeypatch.setattr(
        "app.dependencies.get_verified_supabase_user",
        lambda token: SimpleNamespace(id="unlinked-user-uuid"),
    )
    monkeypatch.setattr("app.dependencies.get_linked_supabase_profile", lambda uid: None)

    req = DummyRequest()
    with pytest.raises(HTTPException) as exc:
        get_current_user(req, authorization="Bearer valid-token")
    assert exc.value.status_code == 401
    assert "No active app profile is linked" in exc.value.detail


def test_get_current_user_inactive_account(monkeypatch):
    """Deactivated accounts are rejected with 401."""
    monkeypatch.setattr(
        "app.dependencies.get_verified_supabase_user",
        lambda token: SimpleNamespace(id="inactive-user-uuid"),
    )
    monkeypatch.setattr(
        "app.dependencies.get_linked_supabase_profile",
        lambda uid: {"id": "app-uid-1", "is_active": False, "role": "farmer"},
    )

    req = DummyRequest()
    with pytest.raises(HTTPException) as exc:
        get_current_user(req, authorization="Bearer valid-token")
    assert exc.value.status_code == 401
    assert "No active app profile is linked" in exc.value.detail


def test_get_current_user_suspended_account(monkeypatch):
    """Suspended accounts are strictly blocked with 403 Forbidden."""
    monkeypatch.setattr(
        "app.dependencies.get_verified_supabase_user",
        lambda token: SimpleNamespace(id="suspended-user-uuid"),
    )
    monkeypatch.setattr(
        "app.dependencies.get_linked_supabase_profile",
        lambda uid: {
            "id": "app-uid-suspended",
            "is_active": True,
            "role": "farmer",
            "approval_status": "suspended",
        },
    )

    req = DummyRequest()
    with pytest.raises(HTTPException) as exc:
        get_current_user(req, authorization="Bearer valid-token")
    assert exc.value.status_code == 403
    assert "account has been suspended" in exc.value.detail


def test_get_current_user_profile_conflict(monkeypatch):
    """Conflicting multi-profile records raise 409 Conflict."""
    monkeypatch.setattr(
        "app.dependencies.get_verified_supabase_user",
        lambda token: SimpleNamespace(id="conflict-user-uuid"),
    )

    def mock_conflict(uid):
        raise SupabaseProfileConflictError("Multiple profiles linked")

    monkeypatch.setattr("app.dependencies.get_linked_supabase_profile", mock_conflict)

    req = DummyRequest()
    with pytest.raises(HTTPException) as exc:
        get_current_user(req, authorization="Bearer valid-token")
    assert exc.value.status_code == 409


# ==============================================================================
# 3. Role-Based Access Control & Privilege Escalation Defenses
# ==============================================================================

def test_require_role_matching():
    """User possessing the required role passes without exception."""
    farmer = AuthenticatedUser(
        auth_id="auth-1",
        app_user_id="app-1",
        email="farmer@test.ke",
        role="farmer",
        is_active=True,
        approval_status="approved",
    )
    result = require_role("farmer")(user=farmer)
    assert result.app_user_id == "app-1"


def test_privilege_escalation_farmer_attempting_admin():
    """Farmer attempting to access admin route receives 403 Forbidden."""
    farmer = AuthenticatedUser(
        auth_id="auth-1",
        app_user_id="app-1",
        email="farmer@test.ke",
        role="farmer",
        is_active=True,
        approval_status="approved",
    )
    with pytest.raises(HTTPException) as exc:
        require_admin(user=farmer)
    assert exc.value.status_code == 403
    assert "not available to this role" in exc.value.detail


def test_privilege_escalation_officer_attempting_admin():
    """Extension officer attempting to access admin route receives 403 Forbidden."""
    officer = AuthenticatedUser(
        auth_id="auth-2",
        app_user_id="app-2",
        email="officer@agriculture.go.ke",
        role="extension_officer",
        is_active=True,
        approval_status="approved",
    )
    with pytest.raises(HTTPException) as exc:
        require_admin(user=officer)
    assert exc.value.status_code == 403


def test_privilege_escalation_agrodealer_attempting_officer():
    """Agrodealer attempting to access extension officer portal receives 403 Forbidden."""
    dealer = AuthenticatedUser(
        auth_id="auth-3",
        app_user_id="app-3",
        email="dealer@farmvet.ke",
        role="agrodealer",
        is_active=True,
        approval_status="approved",
    )
    with pytest.raises(HTTPException) as exc:
        require_officer(user=dealer)
    assert exc.value.status_code == 403


def test_agrodealer_pending_approval_blocked():
    """Agrodealer awaiting admin approval cannot perform dealer catalog operations."""
    pending_dealer = AuthenticatedUser(
        auth_id="auth-4",
        app_user_id="app-4",
        email="applicant@shop.ke",
        role="agrodealer",
        is_active=True,
        approval_status="pending",
    )
    with pytest.raises(HTTPException) as exc:
        require_dealer(user=pending_dealer)
    assert exc.value.status_code == 403
    assert "awaiting approval" in exc.value.detail


def test_approved_agrodealer_permitted():
    """Approved agrodealer can perform dealer operations."""
    approved_dealer = AuthenticatedUser(
        auth_id="auth-5",
        app_user_id="app-5",
        email="approved@shop.ke",
        role="agrodealer",
        is_active=True,
        approval_status="approved",
    )
    res = require_dealer(user=approved_dealer)
    assert res.approval_status == "approved"


def test_require_farmer_permitted_and_rejections():
    """Farmer role dependency allows farmers and rejects other roles."""
    farmer = AuthenticatedUser(
        auth_id="auth-6",
        app_user_id="app-6",
        email="farmer@shamba.ke",
        role="farmer",
        is_active=True,
        approval_status="approved",
    )
    res = require_farmer(user=farmer)
    assert res.role == "farmer"

    officer = AuthenticatedUser(
        auth_id="auth-7",
        app_user_id="app-7",
        email="officer@gov.ke",
        role="extension_officer",
        is_active=True,
        approval_status="approved",
    )
    with pytest.raises(HTTPException) as exc:
        require_farmer(user=officer)
    assert exc.value.status_code == 403


# ==============================================================================
# 4. Admin Hardening: Elevated Password Complexity Policy
# ==============================================================================

def test_admin_password_policy_comprehensive():
    """Admin passwords require >=12 chars, upper, lower, number, special char."""
    # Valid complex passwords
    validate_admin_password("SoilSync!2026Admin")
    validate_admin_password("Complex@P@ssw0rd#99")

    # Invalid: length < 12
    with pytest.raises(HTTPException) as exc:
        validate_admin_password("Short@123")
    assert exc.value.status_code == 422
    assert "at least 12 characters" in exc.value.detail

    # Invalid: no uppercase
    with pytest.raises(HTTPException) as exc:
        validate_admin_password("soilsync!2026admin")
    assert exc.value.status_code == 422
    assert "uppercase letter" in exc.value.detail

    # Invalid: no lowercase
    with pytest.raises(HTTPException) as exc:
        validate_admin_password("SOILSYNC!2026ADMIN")
    assert exc.value.status_code == 422
    assert "lowercase letter" in exc.value.detail

    # Invalid: no number
    with pytest.raises(HTTPException) as exc:
        validate_admin_password("SoilSync!AdminSpecial")
    assert exc.value.status_code == 422
    assert "number" in exc.value.detail

    # Invalid: no symbol
    with pytest.raises(HTTPException) as exc:
        validate_admin_password("SoilSync2026AdminX")
    assert exc.value.status_code == 422
    assert "symbol or special character" in exc.value.detail


# ==============================================================================
# 5. HTTP Endpoint Authorization & Privilege Escalation Defenses
# ==============================================================================

def test_http_unauthenticated_requests_fail_closed():
    """All role-scoped protected API endpoints reject unauthenticated requests with 401."""
    from app.main import app
    client = TestClient(app)

    # Farmer endpoint
    resp_farmer = client.get("/api/v1/farms")
    assert resp_farmer.status_code == 401

    # Officer endpoint
    resp_officer = client.get("/api/v1/officer/farmers")
    assert resp_officer.status_code == 401

    # Admin endpoint
    resp_admin = client.get("/api/v1/admin/users")
    assert resp_admin.status_code == 401

    # Agrodealer endpoint
    resp_dealer = client.get("/api/v1/agrodealer/me/catalog")
    assert resp_dealer.status_code == 401


def test_http_privilege_escalation_farmer_attempting_admin_or_officer(monkeypatch):
    """Farmer credentials cannot access admin or officer routes."""
    from app import main
    client = TestClient(main.app)

    farmer_subject = "farmer-auth-uuid-001"
    farmer_id = "farmer-app-uid-001"

    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=farmer_subject),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda subject: {
            "id": farmer_id,
            "role": "farmer",
            "is_active": True,
            "approval_status": "approved",
        } if subject == farmer_subject else None,
    )

    auth_header = {"Authorization": "Bearer valid-farmer-token"}

    # Attempt to list admin users -> 403
    resp_admin_users = client.get("/api/v1/admin/users", headers=auth_header)
    assert resp_admin_users.status_code == 403

    # Attempt to invite an officer -> 403
    resp_invite = client.post(
        "/api/v1/admin/officers/invite",
        headers=auth_header,
        json={
            "email": "rogue.officer@example.com",
            "county": "Nakuru",
            "designation": "county",
        },
    )
    assert resp_invite.status_code == 403

    # Attempt to view officer roster -> 403
    resp_officer_roster = client.get("/api/v1/officer/farmers", headers=auth_header)
    assert resp_officer_roster.status_code == 403


def test_http_privilege_escalation_dealer_attempting_admin_or_farmer(monkeypatch):
    """Agrodealer credentials cannot access admin or farmer routes."""
    from app import main
    client = TestClient(main.app)

    dealer_subject = "dealer-auth-uuid-001"
    dealer_id = "dealer-app-uid-001"

    monkeypatch.setattr(
        main,
        "get_verified_supabase_user",
        lambda token: SimpleNamespace(id=dealer_subject),
    )
    monkeypatch.setattr(
        main,
        "get_linked_supabase_profile",
        lambda subject: {
            "id": dealer_id,
            "role": "agrodealer",
            "is_active": True,
            "approval_status": "approved",
        } if subject == dealer_subject else None,
    )

    auth_header = {"Authorization": "Bearer valid-dealer-token"}

    # Attempt admin user management -> 403
    resp = client.get("/api/v1/admin/overview", headers=auth_header)
    assert resp.status_code == 403

    # Attempt farmer farm access -> 403
    resp_farms = client.get("/api/v1/farms", headers=auth_header)
    assert resp_farms.status_code == 403
