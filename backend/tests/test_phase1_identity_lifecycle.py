import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

ADMIN_SUBJECT = "99999999-9999-4999-a999-999999999999"
OFFICER_SUBJECT = "88888888-8888-4888-a888-888888888888"
FARMER_SUBJECT = "77777777-7777-4777-a777-777777777777"
AGRONOMIST_SUBJECT = "66666666-6666-4666-a666-666666666666"


def auth_headers(token: str = "valid-token") -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def mock_supabase_auth(monkeypatch):
    import app.main as main_module

    users = {
        "admin-token": SimpleNamespace(
            id=ADMIN_SUBJECT,
            email="admin@soilsync.ai",
            email_confirmed_at="2026-10-04T00:00:00Z",
        ),
        "officer-token": SimpleNamespace(
            id=OFFICER_SUBJECT,
            email="officer@soilsync.ai",
            email_confirmed_at="2026-10-04T00:00:00Z",
        ),
        "farmer-token": SimpleNamespace(
            id=FARMER_SUBJECT,
            email="farmer@example.com",
            email_confirmed_at="2026-10-04T00:00:00Z",
        ),
        "agronomist-token": SimpleNamespace(
            id=AGRONOMIST_SUBJECT,
            email="agronomist@soilsync.ai",
            email_confirmed_at="2026-10-04T00:00:00Z",
        ),
    }

    def mock_get_user(token: str):
        if token in users:
            return users[token]
        return SimpleNamespace(
            id=str(uuid.uuid4()),
            email="other@example.com",
            email_confirmed_at="2026-10-04T00:00:00Z",
        )

    monkeypatch.setattr(main_module, "get_verified_supabase_user", mock_get_user)
    return users


def test_admin_invitation_uses_password_setup_redirect(monkeypatch):
    from app import supabase_client

    calls: list[tuple[str, dict[str, str]]] = []
    monkeypatch.setenv(
        "AUTH_INVITE_REDIRECT_URL",
        "https://soilsync-wpa.vercel.app/reset-password?invite=1",
    )
    monkeypatch.setattr(
        supabase_client,
        "create_supabase_server_client",
        lambda: SimpleNamespace(
            auth=SimpleNamespace(
                admin=SimpleNamespace(
                    invite_user_by_email=lambda email, options: (
                        calls.append((email, options))
                        or SimpleNamespace(user=SimpleNamespace(id="auth-user-1"))
                    )
                )
            )
        ),
    )

    result = supabase_client.invite_user_by_email("new-admin@example.com")

    assert result == {"id": "auth-user-1"}
    assert calls == [
        (
            "new-admin@example.com",
            {"redirect_to": "https://soilsync-wpa.vercel.app/reset-password?invite=1"},
        )
    ]


def test_admin_invite_agronomist_success(mock_supabase_auth, monkeypatch):
    import app.main as main_module

    monkeypatch.setattr(
        main_module,
        "get_linked_supabase_profile",
        lambda sub: {"id": "admin-1", "is_active": True, "role": "admin"},
    )
    monkeypatch.setattr(
        main_module,
        "get_supabase_user_roles",
        lambda sub: [{"role": "admin", "status": "active"}],
    )
    monkeypatch.setattr(
        main_module,
        "check_admin_permission",
        lambda user_id, perm: True,
    )
    monkeypatch.setattr(
        main_module,
        "invite_user_by_email",
        lambda email: {"id": str(uuid.uuid4())},
    )
    monkeypatch.setattr(
        main_module,
        "admin_invite_agronomist",
        lambda **kwargs: {
            "agronomistUserId": "agro-001",
            "email": kwargs["email"],
            "licenceNumber": kwargs["licence_number"],
            "county": kwargs["county"],
            "role": "agronomist",
            "status": "pending",
            "approvalStatus": kwargs["approval_status"],
            "invitedAt": datetime.now(UTC),
        },
    )

    response = client.post(
        "/api/v1/admin/agronomists/invite",
        headers=auth_headers("admin-token"),
        json={
            "email": "dr.wangari@soilsync.ai",
            "displayName": "Dr. Wangari Agronomist",
            "licenceNumber": "AGR-KE-2026-0042",
            "county": "Nakuru",
            "approvalStatus": "pending",
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["role"] == "agronomist"
    assert data["status"] == "pending"
    assert data["approvalStatus"] == "pending"
    assert data["licenceNumber"] == "AGR-KE-2026-0042"
    assert data["county"] == "Nakuru"


def test_admin_approve_agronomist(mock_supabase_auth, monkeypatch):
    import app.main as main_module

    monkeypatch.setattr(
        main_module,
        "get_linked_supabase_profile",
        lambda sub: {"id": "admin-1", "is_active": True, "role": "admin"},
    )
    monkeypatch.setattr(
        main_module,
        "get_supabase_user_roles",
        lambda sub: [{"role": "admin", "status": "active"}],
    )
    monkeypatch.setattr(
        main_module,
        "check_admin_permission",
        lambda user_id, perm: True,
    )

    agronomist_id = str(uuid.uuid4())
    monkeypatch.setattr(
        main_module,
        "admin_approve_agronomist",
        lambda admin_user_id, agronomist_user_id, approval_status, notes: {
            "agronomistUserId": agronomist_user_id,
            "approvalStatus": approval_status,
            "updatedAt": datetime.now(UTC).isoformat(),
        },
    )

    response = client.patch(
        f"/api/v1/admin/agronomists/{agronomist_id}/approval",
        headers=auth_headers("admin-token"),
        json={"approvalStatus": "approved", "notes": "Verified KALRO licence accreditation"},
    )

    assert response.status_code == 200
    assert response.json()["approvalStatus"] == "approved"


def test_unapproved_agronomist_denied_access(mock_supabase_auth, monkeypatch):
    import app.main as main_module

    monkeypatch.setattr(
        main_module,
        "link_supabase_user_profile",
        lambda user, name: {"id": "agro-1", "is_active": True, "role": "agronomist"},
    )
    monkeypatch.setattr(
        main_module,
        "get_linked_supabase_profile",
        lambda sub: {"id": "agro-1", "is_active": True, "role": "agronomist"},
    )
    # Pending approval in user_roles
    monkeypatch.setattr(
        main_module,
        "get_supabase_user_roles",
        lambda sub: [{"role": "agronomist", "status": "pending"}],
    )

    # Calling auth link endpoint with pending agronomist
    response = client.post(
        "/api/v1/auth/link",
        headers=auth_headers("agronomist-token"),
        json={"displayName": "Dr. Wangari"},
    )

    assert response.status_code == 403
    assert "awaiting approval" in response.json()["detail"].lower()


def test_officer_register_unclaimed_farmer(mock_supabase_auth, monkeypatch):
    import app.main as main_module

    monkeypatch.setattr(
        main_module,
        "get_linked_supabase_profile",
        lambda sub: {"id": "officer-1", "is_active": True, "role": "extension-officer"},
    )
    monkeypatch.setattr(
        main_module,
        "get_supabase_user_roles",
        lambda sub: [{"role": "extension-officer", "status": "active"}],
    )
    monkeypatch.setattr(
        main_module,
        "invite_user_by_email",
        lambda email: {"id": str(uuid.uuid4())},
    )
    monkeypatch.setattr(
        main_module,
        "officer_register_unclaimed_farmer",
        lambda **kwargs: {
            "authUserId": kwargs["auth_user_id"],
            "farmerUserId": "farmer-user-001",
            "email": kwargs["email"],
            "fullName": kwargs["full_name"],
            "initialFarmId": "farm-001",
            "status": "unclaimed",
            "role": "farmer",
            "registeredAt": datetime.now(UTC),
            "message": "Unclaimed farmer account created. Secure claim invitation sent to email.",
        },
    )

    response = client.post(
        "/api/v1/officer/farmers/register-unclaimed",
        headers=auth_headers("officer-token"),
        json={
            "email": "kamau.farmer@example.com",
            "fullName": "Peter Kamau",
            "farmName": "Kamau Shamba Green",
            "county": "Nakuru",
            "subCounty": "Njoro",
            "ward": "Mau Narok",
            "sizeAcres": 4.5,
            "crops": "Maize, Beans",
        },
    )

    assert response.status_code == 201
    data = response.json()
    assert data["role"] == "farmer"
    assert data["status"] == "unclaimed"
    assert "claim invitation" in data["message"].lower()


def test_unclaimed_farmer_denied_authenticated_access(mock_supabase_auth, monkeypatch):
    import app.main as main_module

    monkeypatch.setattr(
        main_module,
        "get_linked_supabase_profile",
        lambda sub: {"id": "farmer-unclaimed-1", "is_active": True, "role": "farmer"},
    )
    # Unclaimed status in user_roles
    monkeypatch.setattr(
        main_module,
        "get_supabase_user_roles",
        lambda sub: [{"role": "farmer", "status": "unclaimed"}],
    )

    response = client.get(
        "/api/v1/farms/me",
        headers=auth_headers("farmer-token"),
    )

    assert response.status_code == 403
    assert "unclaimed" in response.json()["detail"].lower()


def test_officer_list_unclaimed_farmers(mock_supabase_auth, monkeypatch):
    import app.main as main_module

    monkeypatch.setattr(
        main_module,
        "get_linked_supabase_profile",
        lambda sub: {"id": "officer-1", "is_active": True, "role": "extension-officer"},
    )
    monkeypatch.setattr(
        main_module,
        "get_supabase_user_roles",
        lambda sub: [{"role": "extension-officer", "status": "active"}],
    )
    monkeypatch.setattr(
        main_module,
        "load_officer_unclaimed_farmers",
        lambda officer_id: [
            {
                "authUserId": str(uuid.uuid4()),
                "farmerUserId": str(uuid.uuid4()),
                "email": "kamau.farmer@example.com",
                "fullName": "Peter Kamau",
                "initialFarmId": str(uuid.uuid4()),
                "initialFarmName": "Kamau Shamba Green",
                "county": "Nakuru",
                "status": "unclaimed",
                "reminderCount": 2,
                "lastReminderAt": datetime.now(UTC),
                "createdAt": datetime.now(UTC),
                "daysUntilExpiration": 5,
            }
        ],
    )

    response = client.get(
        "/api/v1/officer/unclaimed-farmers",
        headers=auth_headers("officer-token"),
    )

    assert response.status_code == 200
    items = response.json()
    assert len(items) == 1
    assert items[0]["fullName"] == "Peter Kamau"
    assert items[0]["daysUntilExpiration"] == 5


def test_unclaimed_reminder_batch_job(mock_supabase_auth, monkeypatch):
    import app.main as main_module

    monkeypatch.setattr(
        main_module,
        "get_linked_supabase_profile",
        lambda sub: {"id": "admin-1", "is_active": True, "role": "admin"},
    )
    monkeypatch.setattr(
        main_module,
        "get_supabase_user_roles",
        lambda sub: [{"role": "admin", "status": "active"}],
    )
    monkeypatch.setattr(
        main_module,
        "process_unclaimed_farmer_reminders",
        lambda: {"processedCount": 3, "remindersSent": 3, "message": "Sent 3 reminder(s)"},
    )

    response = client.post(
        "/api/v1/jobs/unclaimed-reminders",
        headers=auth_headers("admin-token"),
    )

    assert response.status_code == 200
    assert response.json()["remindersSent"] == 3


def test_unclaimed_lifecycle_job_accepts_configured_job_token(monkeypatch):
    import app.main as main_module

    monkeypatch.setenv("UNCLAIMED_LIFECYCLE_JOB_TOKEN", "scheduled-job-secret")
    monkeypatch.setattr(
        main_module,
        "process_unclaimed_farmer_reminders",
        lambda: {"processedCount": 1, "remindersSent": 1, "message": "Delivered 1 reminder"},
    )

    response = client.post(
        "/api/v1/jobs/unclaimed-reminders",
        headers={"X-SoilSync-Job-Token": "scheduled-job-secret"},
    )

    assert response.status_code == 200
    assert response.json()["remindersSent"] == 1


def test_farmer_claim_reminder_uses_configured_supabase_email_redirect(monkeypatch):
    from app import supabase_client

    calls: list[tuple[str, dict[str, str]]] = []

    def reset_password_for_email(email: str, *, options: dict[str, str]) -> None:
        calls.append((email, options))

    monkeypatch.setenv(
        "FARMER_CLAIM_REDIRECT_URL",
        "https://soilsync.example/reset-password?claim=1",
    )
    monkeypatch.setattr(
        supabase_client,
        "create_supabase_server_client",
        lambda: SimpleNamespace(
            auth=SimpleNamespace(reset_password_for_email=reset_password_for_email)
        ),
    )

    supabase_client.send_farmer_claim_reminder("farmer@example.test")

    assert calls == [
        (
            "farmer@example.test",
            {"redirect_to": "https://soilsync.example/reset-password?claim=1"},
        )
    ]


@pytest.mark.parametrize("delivery_fails", [False, True])
def test_unclaimed_reminder_state_matches_email_delivery(monkeypatch, delivery_fails):
    import app.database as database_module
    from app.supabase_client import SupabaseIdentityUnavailableError

    statements: list[tuple[str, tuple[Any, ...] | None]] = []

    class FakeCursor:
        def __init__(self) -> None:
            self.rows: list[dict[str, Any]] = []
            self.row: dict[str, Any] | None = None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return None

        def execute(self, query: str, params: tuple[Any, ...] | None = None) -> None:
            statements.append((query, params))
            if "FOR UPDATE OF ufa" in query:
                self.row = {
                    "auth_user_id": "auth-user",
                    "farmer_user_id": "farmer-user",
                    "reminder_count": 0,
                    "email": "farmer@example.test",
                }
            elif "SELECT ufa.auth_user_id" in query:
                self.rows = [{"auth_user_id": "auth-user"}]

        def fetchall(self) -> list[dict[str, Any]]:
            return self.rows

        def fetchone(self) -> dict[str, Any] | None:
            return self.row

    class FakeConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return None

        def cursor(self) -> FakeCursor:
            return FakeCursor()

        def commit(self) -> None:
            pass

    monkeypatch.setattr(database_module, "_connect", FakeConnection)
    delivered_emails: list[str] = []

    def fail_delivery(email: str) -> None:
        if delivery_fails:
            raise SupabaseIdentityUnavailableError("Email service unavailable.")
        delivered_emails.append(email)

    monkeypatch.setattr(database_module, "send_farmer_claim_reminder", fail_delivery)

    if delivery_fails:
        with pytest.raises(database_module.DatabaseUnavailable, match="email delivery failed"):
            database_module.process_unclaimed_farmer_reminders()
        assert not any(
            "UPDATE unclaimed_farmer_accounts" in query for query, _ in statements
        )
        assert not any("INSERT INTO in_app_notifications" in query for query, _ in statements)
    else:
        result = database_module.process_unclaimed_farmer_reminders()
        assert result["processedCount"] == 1
        assert result["remindersSent"] == 1
        assert delivered_emails == ["farmer@example.test"]
        assert any(
            "UPDATE unclaimed_farmer_accounts" in query and params[0] == 1
            for query, params in statements
            if params is not None
        )
        assert any("INSERT INTO in_app_notifications" in query for query, _ in statements)
        assert any(
            "unclaimed_farmer_reminder_sent" in query for query, _ in statements
        )


def test_unclaimed_cleanup_batch_job(mock_supabase_auth, monkeypatch):
    import app.main as main_module

    monkeypatch.setattr(
        main_module,
        "get_linked_supabase_profile",
        lambda sub: {"id": "admin-1", "is_active": True, "role": "admin"},
    )
    monkeypatch.setattr(
        main_module,
        "get_supabase_user_roles",
        lambda sub: [{"role": "admin", "status": "active"}],
    )
    monkeypatch.setattr(
        main_module,
        "process_unclaimed_farmer_cleanup",
        lambda: {"processedCount": 1, "expiredAndDeleted": 1, "message": "Cleaned 1 account"},
    )

    response = client.post(
        "/api/v1/jobs/unclaimed-cleanup",
        headers=auth_headers("admin-token"),
    )

    assert response.status_code == 200
    assert response.json()["expiredAndDeleted"] == 1


def test_admin_resend_and_cancel_invitations(mock_supabase_auth, monkeypatch):
    import app.main as main_module

    monkeypatch.setattr(
        main_module,
        "get_linked_supabase_profile",
        lambda sub: {"id": "admin-1", "is_active": True, "role": "admin"},
    )
    monkeypatch.setattr(
        main_module,
        "get_supabase_user_roles",
        lambda sub: [{"role": "admin", "status": "active"}],
    )

    auth_id = str(uuid.uuid4())
    monkeypatch.setattr(
        main_module,
        "resend_account_invitation",
        lambda admin_id, uid: {
            "authUserId": uid,
            "action": "resent",
            "status": "pending",
            "message": "Invitation resent successfully.",
        },
    )
    monkeypatch.setattr(
        main_module,
        "cancel_account_invitation",
        lambda admin_id, uid: {
            "authUserId": uid,
            "action": "cancelled",
            "status": "cancelled",
            "message": "Invitation cancelled and access revoked.",
        },
    )

    # Resend
    resend_resp = client.post(
        f"/api/v1/admin/invitations/{auth_id}/resend",
        headers=auth_headers("admin-token"),
    )
    assert resend_resp.status_code == 200
    assert resend_resp.json()["action"] == "resent"

    # Cancel
    cancel_resp = client.post(
        f"/api/v1/admin/invitations/{auth_id}/cancel",
        headers=auth_headers("admin-token"),
    )
    assert cancel_resp.status_code == 200
    assert cancel_resp.json()["action"] == "cancelled"


def test_admin_delete_user_anonymizes_audit_and_removes_auth_and_app_data(monkeypatch):
    from app import database

    events: list[tuple[str, object]] = []

    class MockCursor:
        query = ""

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query: str, params: tuple | None = None) -> None:
            self.query = " ".join(query.lower().split())
            events.append((self.query, params))

        def fetchone(self):
            if "from users" in self.query and "for update" in self.query:
                return {
                    "id": "target-user",
                    "supabase_auth_user_id": "auth-target-user",
                    "email": "farmer@example.test",
                    "role": "farmer",
                    "is_active": True,
                }
            if "count(distinct users.id)" in self.query:
                return {"active_admin_count": 2}
            if "delete from users" in self.query:
                return {"id": "target-user"}
            return None

    class MockConnection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self):
            return MockCursor()

        def commit(self):
            events.append(("commit", None))

    monkeypatch.setattr(database, "check_admin_permission", lambda *_args: True)
    monkeypatch.setattr(database, "_connect", MockConnection)
    monkeypatch.setattr(
        database,
        "delete_supabase_user",
        lambda auth_user_id: events.append(("delete_auth", auth_user_id)),
    )

    result = database.admin_delete_user(
        "admin-user",
        "target-user",
        "FARMER@example.test",
    )

    assert result == {
        "userId": "target-user",
        "email": "farmer@example.test",
        "status": "deleted",
    }
    assert ("delete_auth", "auth-target-user") in events
    assert any(
        query.startswith("select public.anonymize_deleted_user_audit_history")
        and params == ("target-user", "auth-target-user", "farmer@example.test")
        for query, params in events
        if isinstance(query, str)
    )
    assert any(
        query.startswith("delete from users")
        for query, _params in events
        if isinstance(query, str)
    )
    assert events.index(("delete_auth", "auth-target-user")) < next(
        index
        for index, (query, _params) in enumerate(events)
        if isinstance(query, str) and query.startswith("select public.anonymize_deleted_user_audit_history")
    )


def test_admin_delete_user_protects_self_and_last_active_admin(monkeypatch):
    from app import database

    with pytest.raises(database.AccountDeletionConflict, match="own admin account"):
        database.admin_delete_user("same-admin", "same-admin", "admin@example.test")

    class MockCursor:
        query = ""

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query: str, _params: tuple | None = None) -> None:
            self.query = " ".join(query.lower().split())

        def fetchone(self):
            if "from users" in self.query and "for update" in self.query:
                return {
                    "id": "last-admin",
                    "supabase_auth_user_id": "auth-last-admin",
                    "email": "last-admin@example.test",
                    "role": "admin",
                    "is_active": True,
                }
            if "count(distinct users.id)" in self.query:
                return {"active_admin_count": 1}
            return None

    class MockConnection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self):
            return MockCursor()

        def commit(self):
            raise AssertionError("A protected last-admin deletion must not commit.")

    monkeypatch.setattr(database, "check_admin_permission", lambda *_args: True)
    monkeypatch.setattr(database, "_connect", MockConnection)

    with pytest.raises(database.AccountDeletionConflict, match="last active admin"):
        database.admin_delete_user(
            "another-admin",
            "last-admin",
            "last-admin@example.test",
        )
