"""CLI script to provision or repair a superadmin account in production.

The script enforces the hardened admin password policy, creates the Supabase auth
user when needed, upserts the admin role, and grants the default least-privilege
admin permissions the app requires for account management and audit access.

Usage:
    python create_initial_admin.py --email ops@soilsync.ai --name "Operations Admin"
"""

import argparse
import getpass
import os
import sys
from typing import Any, Iterable

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from app.dependencies import validate_admin_password
from app.supabase_client import create_supabase_server_client

DEFAULT_ADMIN_PERMISSIONS = (
    "view_audit_log",
    "manage_accounts",
    "manage_roles",
    "manage_officer_assignments",
    "manage_dealer_approvals",
    "support_access",
    "manage_settings",
)


def default_admin_permissions() -> list[str]:
    return list(DEFAULT_ADMIN_PERMISSIONS)


def _response_rows(response: object) -> list[dict[str, Any]]:
    rows = getattr(response, "data", None)
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def _find_auth_user(supabase: object, email: str) -> object | None:
    page = 1
    while True:
        response = supabase.auth.admin.list_users(page=page, per_page=100)
        users = getattr(response, "users", []) or []
        for user in users:
            if str(getattr(user, "email", "")).casefold() == email.casefold():
                return user
        if len(users) < 100:
            return None
        page += 1


def _find_app_user(supabase: object, auth_user_id: str, email: str) -> dict[str, Any] | None:
    response = (
        supabase.table("users")
        .select("id, supabase_auth_user_id")
        .eq("supabase_auth_user_id", auth_user_id)
        .limit(2)
        .execute()
    )
    rows = _response_rows(response)
    if not rows:
        response = (
            supabase.table("users")
            .select("id, supabase_auth_user_id")
            .eq("email", email)
            .limit(2)
            .execute()
        )
        rows = _response_rows(response)
    if len(rows) > 1:
        raise RuntimeError("Multiple app profiles match the administrator identity.")
    return rows[0] if rows else None


def upsert_admin_permissions(supabase: object, admin_user_id: str, permissions: Iterable[str] | None = None) -> list[str]:
    values = []
    selected_permissions = list(permissions) if permissions is not None else default_admin_permissions()
    for permission in selected_permissions:
        values.append({
            "admin_user_id": admin_user_id,
            "permission": permission,
            "granted_by": admin_user_id,
            "is_active": True,
            "expires_at": None,
        })

    if not values:
        return []

    supabase.table("admin_permissions").upsert(
        values,
        on_conflict="admin_user_id,permission",
    ).execute()
    return selected_permissions


def provision_admin(supabase: object, email: str, name: str, password: str) -> tuple[str, str, list[str]]:
    auth_user = _find_auth_user(supabase, email)
    if auth_user is None:
        response = supabase.auth.admin.create_user({
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"full_name": name},
        })
        auth_user = getattr(response, "user", None)
        if auth_user is None or not getattr(auth_user, "id", None):
            raise RuntimeError("Supabase did not return a usable Auth user.")

    auth_user_id = str(auth_user.id)
    app_user = _find_app_user(supabase, auth_user_id, email)
    if app_user is not None:
        linked_auth_user_id = app_user.get("supabase_auth_user_id")
        if linked_auth_user_id and str(linked_auth_user_id) != auth_user_id:
            raise RuntimeError("The administrator email is linked to a different Auth identity.")
        app_user_id = str(app_user["id"])
        supabase.table("users").update({
            "supabase_auth_user_id": auth_user_id,
            "display_name": name,
            "role": "admin",
            "is_active": True,
        }).eq("id", app_user_id).execute()
    else:
        response = supabase.table("users").insert({
            "email": email,
            "display_name": name,
            "role": "admin",
            "is_active": True,
            "supabase_auth_user_id": auth_user_id,
        }).execute()
        rows = _response_rows(response)
        if not rows or not rows[0].get("id"):
            raise RuntimeError("Supabase did not return a usable app profile.")
        app_user_id = str(rows[0]["id"])

    supabase.table("user_roles").upsert({
        "user_id": auth_user_id,
        "role": "admin",
        "status": "active",
    }, on_conflict="user_id,role").execute()

    granted_permissions = upsert_admin_permissions(supabase, app_user_id)
    return auth_user_id, app_user_id, granted_permissions


def main():
    parser = argparse.ArgumentParser(description="Create or repair the initial superadmin account.")
    parser.add_argument("--email", required=True, help="Administrator email address")
    parser.add_argument("--name", default="Super Administrator", help="Administrator display name")

    args = parser.parse_args()

    password = getpass.getpass("Enter strong administrator password (min 12 chars, upper, lower, num, symbol): ")
    confirm = getpass.getpass("Confirm administrator password: ")
    if password != confirm:
        print("Error: Passwords do not match.", file=sys.stderr)
        sys.exit(1)

    try:
        validate_admin_password(password)
    except Exception as exc:
        print(f"Password Policy Rejection: {exc.detail if hasattr(exc, 'detail') else exc}", file=sys.stderr)
        sys.exit(1)

    print(f"Provisioning superadmin '{args.email}'...")

    try:
        supabase = create_supabase_server_client()
        auth_user_id, app_user_id, granted_permissions = provision_admin(
            supabase, args.email, args.name, password
        )
        if not granted_permissions:
            raise RuntimeError("No administrative permissions were granted for this account.")

        print(f"Successfully provisioned superadmin account: {args.email}")
        print(f"Auth user UUID: {auth_user_id}")
        print(f"App user UUID: {app_user_id}")
        print("Role: admin (active)")
        print("Permissions:", ", ".join(granted_permissions))
    except Exception as exc:
        print(f"Admin provisioning failed: {exc}", file=sys.stderr)
        print("Note: Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are configured in environment.")
        sys.exit(1)


if __name__ == "__main__":
    main()
