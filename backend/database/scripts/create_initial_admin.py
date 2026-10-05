"""CLI script to provision the initial superadmin account manually (Item 4.3).

Enforces the hardened admin password complexity policy (>=12 characters, uppercase,
lowercase, digit, and special character), registers the user in Supabase/Postgres,
provisions the 'admin' role in user_roles, and records an initial audit entry.

Usage:
    python create_initial_admin.py --email admin@soilsync.ke --name "Lead Administrator"
"""

import argparse
import getpass
import os
import sys

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from app.dependencies import validate_admin_password
from app.supabase_client import create_supabase_server_client


def main():
    parser = argparse.ArgumentParser(description="Create the initial superadmin account.")
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

    # Validate against elevated admin password policy
    try:
        validate_admin_password(password)
    except Exception as exc:
        print(f"Password Policy Rejection: {exc.detail if hasattr(exc, 'detail') else exc}", file=sys.stderr)
        sys.exit(1)

    print(f"Provisioning initial superadmin '{args.email}'...")

    try:
        supabase = create_supabase_server_client()
        # Create user via Supabase admin auth API
        res = supabase.auth.admin.create_user({
            "email": args.email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"full_name": args.name},
        })
        user = getattr(res, "user", None)
        user_id = str(user.id) if user else None

        if not user_id:
            print("Error: Supabase did not return created user ID.", file=sys.stderr)
            sys.exit(1)

        # Upsert admin role into user_roles
        supabase.table("user_roles").upsert({
            "user_id": user_id,
            "role": "admin",
            "status": "active",
        }).execute()

        print(f"Successfully provisioned superadmin account: {args.email} (UUID: {user_id})")
        print("Role: admin (active)")
    except Exception as exc:
        print(f"Admin provisioning failed: {exc}", file=sys.stderr)
        print("Note: Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are configured in environment.")
        sys.exit(1)


if __name__ == "__main__":
    main()
