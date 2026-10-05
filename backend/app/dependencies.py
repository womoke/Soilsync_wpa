from dataclasses import dataclass, field
from typing import Any

from fastapi import Header, HTTPException, Request

from .supabase_client import (
    InvalidSupabaseIdentityError,
    SupabaseIdentityUnavailableError,
    SupabaseProfileConflictError,
    get_linked_supabase_profile,
    get_supabase_user_roles,
    get_verified_supabase_user,
)


@dataclass
class AuthenticatedUser:
    """Authenticated user context carrying verified identity, profile, and roles."""

    auth_id: str
    app_user_id: str
    email: str | None
    role: str
    is_active: bool
    approval_status: str
    jurisdictions: list[dict[str, Any]] = field(default_factory=list)
    active_roles: list[str] | None = None


def extract_bearer_token(authorization: str | None) -> str:
    """Extract and validate bearer token from Authorization header."""
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="Authorization header is required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    parts = authorization.strip().split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail="Authorization header must be Bearer <token>.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = parts[1].strip()
    if not token:
        raise HTTPException(
            status_code=401,
            detail="Bearer token cannot be empty.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return token


def get_current_user(
    request: Request,
    authorization: str | None = Header(default=None),
) -> AuthenticatedUser:
    """Extract, verify, and resolve authenticated user from Supabase session."""
    token = extract_bearer_token(authorization)
    try:
        auth_user = get_verified_supabase_user(token)
    except InvalidSupabaseIdentityError as exc:
        raise HTTPException(status_code=401, detail="Supabase session is invalid or expired.") from exc
    except SupabaseIdentityUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    subject = str(getattr(auth_user, "id", ""))
    try:
        profile = get_linked_supabase_profile(subject)
        role_rows = get_supabase_user_roles(subject)
    except SupabaseProfileConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SupabaseIdentityUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if profile is None or profile.get("is_active") is not True:
        raise HTTPException(
            status_code=401,
            detail="No active app profile is linked to this session.",
        )

    # Check suspended status
    approval_status = str(profile.get("approval_status", "approved")).lower()
    if approval_status == "suspended":
        raise HTTPException(
            status_code=403,
            detail="This account has been suspended. Contact an administrator.",
        )

    active_roles = [
        "extension-officer" if row["role"] == "extension_officer" else row["role"]
        for row in role_rows
        if row["status"] == "active"
    ]
    primary_role = next(
        (
            role
            for role in ("admin", "extension-officer", "agrodealer", "farmer")
            if role in active_roles
        ),
        "",
    )
    return AuthenticatedUser(
        auth_id=subject,
        app_user_id=str(profile["id"]),
        email=profile.get("email"),
        role=primary_role,
        is_active=bool(profile.get("is_active", True)),
        approval_status=approval_status,
        active_roles=active_roles,
    )


def require_role(required_role: str):
    """Dependency factory checking that the user possesses an active role."""

    def role_dependency(user: AuthenticatedUser = None, request: Request = None) -> AuthenticatedUser:
        if user is None:
            # Fallback for manual invocation with request
            user = get_current_user(request)

        req_role_norm = required_role.replace("_", "-")
        active_roles = user.active_roles
        user_roles = (
            {role.replace("_", "-") for role in active_roles}
            if active_roles is not None
            else {user.role.replace("_", "-")}
        )

        if req_role_norm not in user_roles:
            raise HTTPException(
                status_code=403,
                detail="This operation is not available to this role.",
            )

        if req_role_norm == "agrodealer" and user.approval_status != "approved":
            raise HTTPException(
                status_code=403,
                detail="This agrodealer account is awaiting approval.",
            )

        return user

    return role_dependency


def require_admin(user: AuthenticatedUser = None, request: Request = None) -> AuthenticatedUser:
    """Dependency enforcing that the caller is an active, approved administrator."""
    return require_role("admin")(user=user, request=request)


def require_officer(user: AuthenticatedUser = None, request: Request = None) -> AuthenticatedUser:
    """Dependency enforcing that the caller is an active extension officer."""
    return require_role("extension-officer")(user=user, request=request)


def require_dealer(user: AuthenticatedUser = None, request: Request = None) -> AuthenticatedUser:
    """Dependency enforcing that the caller is an approved agrodealer."""
    return require_role("agrodealer")(user=user, request=request)


def require_farmer(user: AuthenticatedUser = None, request: Request = None) -> AuthenticatedUser:
    """Dependency enforcing that the caller is an active farmer."""
    return require_role("farmer")(user=user, request=request)


def validate_admin_password(password: str) -> None:
    """Enforce elevated password complexity requirements for administrator accounts."""
    if len(password) < 12:
        raise HTTPException(
            status_code=422,
            detail="Admin password must be at least 12 characters long.",
        )
    if not any(c.isupper() for c in password):
        raise HTTPException(
            status_code=422,
            detail="Admin password must contain at least one uppercase letter (A-Z).",
        )
    if not any(c.islower() for c in password):
        raise HTTPException(
            status_code=422,
            detail="Admin password must contain at least one lowercase letter (a-z).",
        )
    if not any(c.isdigit() for c in password):
        raise HTTPException(
            status_code=422,
            detail="Admin password must contain at least one number (0-9).",
        )
    if not any(c in "!@#$%^&*(),.?\":{}|<>_-=+~`" for c in password):
        raise HTTPException(
            status_code=422,
            detail="Admin password must contain at least one symbol or special character.",
        )
