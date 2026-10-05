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
from typing import Iterable

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


def _find_existing_user_id(supabase: object, email: str) -> str | None:
    try:
        response = supabase.table("users").select("id").eq("email", email).limit(1).execute()
        rows = getattr(response, "data", None) or []
        if rows and rows[0].get("id"):
            return str(rows[0]["id"])
    except Exception:
        pass

    try:
        response = supabase.auth.admin.list_users()
        for user in getattr(response, "users", []) or []:
            if getattr(user, "email", None) == email:
                return str(user.id)
    except Exception:
        pass

    return None


def upsert_admin_permissions(supabase: object, admin_user_id: str, permissions: Iterable[str] | None = None) -> list[str]:
    values = []
    selected_permissions = list(permissions) if permissions is not None else default_admin_permissions()
    for permission in selected_permissions:
        values.append({
            "admin_user_id": admin_user_id,
            "permission": permission,
            "is_active": True,
            "expires_at": None,
        })

    if not values:
        return []

    response = supabase.table("admin_permissions").upsert(
        values,
        on_conflict="admin_user_id,permission",
    ).execute()
    rows = getattr(response, "data", []) or []
    return [str(row["permission"]) for row in rows if isinstance(row, dict) and row.get("permission")]


def main():
    parser = argparse.ArgumentParser(description="Create or repair the initial superadmin account.")
    parser.add_argument("--email", required=True, help="Administrator email address")
    parser.add_argument("--name", default="Super Administrator", help="Administrator display name")
    parser.add_argument("--password", help="Strong unique password (prompts securely if omitted)")

    args = parser.parse_args()

    password = args.password
    if not password:
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

    print(f"Provisioning initial superadmin '{args.email}'...")

    try:
        supabase = create_supabase_server_client()

        user_id = _find_existing_user_id(supabase, args.email)
        if user_id is None:
            res = supabase.auth.admin.create_user({
                "email": args.email,
                "password": password,
                "email_confirm": True,
                "user_metadata": {"full_name": args.name},
            })
            user = getattr(res, "user", None)
            user_id = str(user.id) if user else None

        if not user_id:
            print("Error: Supabase did not return a usable user ID.", file=sys.stderr)
            sys.exit(1)

        supabase.table("user_roles").upsert({
            "user_id": user_id,
            "role": "admin",
            "status": "active",
        }, on_conflict="user_id,role").execute()

        granted_permissions = upsert_admin_permissions(supabase, user_id)
        if not granted_permissions:
            raise RuntimeError("No administrative permissions were granted for this account.")

        print(f"Successfully provisioned superadmin account: {args.email} (UUID: {user_id})")
        print("Role: admin (active)")
        print("Permissions:", ", ".join(granted_permissions))
    except Exception as exc:
        print(f"Admin provisioning failed: {exc}", file=sys.stderr)
        print("Note: Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are configured in environment.")
        sys.exit(1)


if __name__ == "__main__":
    main()
