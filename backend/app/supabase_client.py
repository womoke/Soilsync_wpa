import os
from typing import Any
from uuid import UUID

import app.env  # noqa: F401

try:
    from supabase import Client, create_client
except ImportError:  # pragma: no cover
    Client = Any  # type: ignore[misc, assignment]

    def create_client(*args: Any, **kwargs: Any) -> Any:
        raise ImportError("Install the 'supabase' Python package to use the Supabase client.")


def get_supabase_url() -> str:
    url = os.getenv("SUPABASE_URL")
    if not url:
        raise RuntimeError("SUPABASE_URL is not configured.")
    return url


def get_supabase_anon_key() -> str:
    key = os.getenv("SUPABASE_ANON_KEY")
    if not key:
        raise RuntimeError("SUPABASE_ANON_KEY is not configured.")
    return key


def get_supabase_service_role_key() -> str:
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is not configured.")
    return key


def create_supabase_server_client() -> Client:
    """Create the server-side Supabase client for future production integration.

    This is intentionally isolated from the current synthetic demo and will be used
    once data rights and agronomic review are complete.
    """
    return create_client(get_supabase_url(), get_supabase_service_role_key())


def create_supabase_public_client() -> Client:
    return create_client(get_supabase_url(), get_supabase_anon_key())


class InvalidSupabaseIdentityError(ValueError):
    pass


class SupabaseIdentityUnavailableError(RuntimeError):
    pass


class SupabaseProfileConflictError(RuntimeError):
    pass


class SupabaseInvitationConflictError(RuntimeError):
    pass


class SupabaseInvitationRequiredError(PermissionError):
    pass


def get_admin_invite_redirect_url() -> str:
    return os.getenv(
        "AUTH_INVITE_REDIRECT_URL",
        "https://soilsync-wpa.vercel.app/reset-password?invite=1",
    ).strip()


def get_verified_supabase_user(access_token: str) -> Any:
    try:
        response = create_supabase_public_client().auth.get_user(access_token)
    except Exception as exc:
        status = getattr(exc, "status", None) or getattr(exc, "status_code", None)
        if status in (400, 401, 403, "400", "401", "403"):
            raise InvalidSupabaseIdentityError("Supabase access token is invalid or expired.") from exc
        raise SupabaseIdentityUnavailableError("Supabase identity verification is unavailable.") from exc

    user = getattr(response, "user", None)
    if user is None or not getattr(user, "id", None):
        raise InvalidSupabaseIdentityError("Supabase access token did not resolve to a user.")
    verification_fields_present = hasattr(user, "email_confirmed_at") or hasattr(
        user, "phone_confirmed_at"
    )
    if verification_fields_present and not (
        getattr(user, "email_confirmed_at", None)
        or getattr(user, "phone_confirmed_at", None)
    ):
        raise InvalidSupabaseIdentityError("A verified email address or phone number is required.")
    try:
        UUID(str(user.id))
    except ValueError as exc:
        raise InvalidSupabaseIdentityError("Supabase user subject is not a valid UUID.") from exc
    return user


def _profile_rows(response: Any) -> list[dict[str, Any]]:
    data = getattr(response, "data", None)
    if isinstance(data, dict):
        return [data]
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    return []


def _find_profiles(client: Client, column: str, value: str) -> list[dict[str, Any]]:
    response = (
        client.table("users")
        .select(
            "id, role, email, phone, display_name, is_active, approval_status, "
            "supabase_auth_user_id"
        )
        .eq(column, value)
        .limit(2)
        .execute()
    )
    return _profile_rows(response)


def get_linked_supabase_profile(subject: str) -> dict[str, Any] | None:
    normalized_subject = str(UUID(subject))
    try:
        profiles = _find_profiles(
            create_supabase_server_client(), "supabase_auth_user_id", normalized_subject
        )
    except Exception as exc:
        raise SupabaseIdentityUnavailableError("Supabase profile lookup is unavailable.") from exc
    if len(profiles) > 1:
        raise SupabaseProfileConflictError("Multiple app profiles are linked to this identity.")
    return profiles[0] if profiles else None


def get_supabase_user_roles(subject: str) -> list[dict[str, str]]:
    normalized_subject = str(UUID(subject))
    try:
        response = (
            create_supabase_server_client()
            .table("user_roles")
            .select("role, status")
            .eq("user_id", normalized_subject)
            .execute()
        )
    except Exception as exc:
        raise SupabaseIdentityUnavailableError("Supabase role lookup is unavailable.") from exc

    roles: list[dict[str, str]] = []
    for row in _profile_rows(response):
        role = row.get("role")
        status = row.get("status")
        if not isinstance(role, str) or not isinstance(status, str):
            raise SupabaseIdentityUnavailableError("Supabase returned an invalid role assignment.")
        roles.append({"role": role, "status": status})
    return roles


def _sync_linked_supabase_profile(
    client: Client, app_profile: dict[str, Any], auth_subject: str
) -> None:
    app_user_id = str(app_profile["id"])
    try:
        auth_profiles = _profile_rows(
            client.table("profiles")
            .select("full_name, county, sub_county, ward, phone_number")
            .eq("id", auth_subject)
            .execute()
        )
        legacy_profiles = (
            _profile_rows(
                client.table("profiles")
                .select("full_name, county, sub_county, ward, phone_number")
                .eq("id", app_user_id)
                .execute()
            )
            if app_user_id != auth_subject
            else []
        )
        auth_profile = auth_profiles[0] if auth_profiles else {}
        legacy_profile = legacy_profiles[0] if legacy_profiles else {}
        profile_data = {
            "id": auth_subject,
            "full_name": (
                auth_profile.get("full_name")
                or legacy_profile.get("full_name")
                or app_profile.get("display_name")
            ),
            "county": auth_profile.get("county") or legacy_profile.get("county"),
            "sub_county": auth_profile.get("sub_county") or legacy_profile.get("sub_county"),
            "ward": auth_profile.get("ward") or legacy_profile.get("ward"),
            "phone_number": auth_profile.get("phone_number") or legacy_profile.get("phone_number"),
        }
        client.table("profiles").upsert(profile_data, on_conflict="id").execute()
    except Exception as exc:
        raise SupabaseIdentityUnavailableError("Supabase profile synchronization failed.") from exc


def _sync_linked_user_roles(
    client: Client, profile: dict[str, Any], auth_subject: str
) -> None:
    app_user_id = str(profile["id"])
    try:
        auth_rows = _profile_rows(
            client.table("user_roles")
            .select("role, status")
            .eq("user_id", auth_subject)
            .execute()
        )
        app_rows = (
            _profile_rows(
                client.table("user_roles")
                .select("role, status")
                .eq("user_id", app_user_id)
                .execute()
            )
            if app_user_id != auth_subject
            else []
        )

        for row in app_rows:
            role = row.get("role")
            if role == "extension_officer":
                role = "extension-officer"
            status = row.get("status")
            if role not in {"farmer", "extension-officer", "agrodealer", "admin", "agronomist"}:
                raise SupabaseIdentityUnavailableError(
                    "The linked profile has an unsupported role assignment."
                )
            if status not in {"pending", "active", "suspended", "unclaimed"}:
                raise SupabaseIdentityUnavailableError(
                    "The linked profile has an unsupported role status."
                )
            client.table("user_roles").upsert(
                {"user_id": auth_subject, "role": role, "status": status},
                on_conflict="user_id,role",
            ).execute()

        known_roles = {
            "extension-officer" if row.get("role") == "extension_officer" else row.get("role")
            for row in (*auth_rows, *app_rows)
            if isinstance(row.get("role"), str)
        }
        legacy_role = profile.get("role")
        if legacy_role == "extension_officer":
            legacy_role = "extension-officer"
        if legacy_role in {"farmer", "extension-officer", "agrodealer", "admin", "agronomist"}:
            if legacy_role not in known_roles:
                is_active = profile.get("is_active") is True
                approval_status = str(profile.get("approval_status", "approved")).lower()
                status = (
                    "suspended"
                    if not is_active or approval_status == "suspended"
                    else "pending"
                    if legacy_role in {"agrodealer", "agronomist"} and approval_status != "approved"
                    else "active"
                )
                client.table("user_roles").upsert(
                    {"user_id": auth_subject, "role": legacy_role, "status": status},
                    on_conflict="user_id,role",
                ).execute()

        if app_rows and app_user_id != auth_subject:
            client.table("user_roles").delete().eq("user_id", app_user_id).execute()
        if profile.get("is_active") is not True:
            client.table("user_roles").update({"status": "suspended"}).eq(
                "user_id", auth_subject
            ).execute()
    except SupabaseIdentityUnavailableError:
        raise
    except Exception as exc:
        raise SupabaseIdentityUnavailableError("Supabase role synchronization failed.") from exc


def revoke_supabase_session(access_token: str) -> None:
    try:
        create_supabase_server_client().auth.admin.sign_out(access_token, scope="local")
    except Exception as exc:
        raise SupabaseIdentityUnavailableError("Supabase session revocation is unavailable.") from exc


def invite_user_by_email(email: str) -> dict[str, Any]:
    try:
        client = create_supabase_server_client()
        response = client.auth.admin.invite_user_by_email(
            email,
            options={"redirect_to": get_admin_invite_redirect_url()},
        )
        user = getattr(response, "user", None)
        if user is None or not getattr(user, "id", None):
            raise SupabaseIdentityUnavailableError(
                "Supabase accepted the invitation request without returning a user."
            )
        return {"id": str(user.id)}
    except SupabaseIdentityUnavailableError:
        raise
    except Exception as exc:
        code = getattr(exc, "code", None)
        status = getattr(exc, "status", None)
        if code in {"email_exists", "user_already_exists"} or status == 422:
            raise SupabaseInvitationConflictError(
                "An account already exists for this email address. Ask the user to sign in or use account recovery."
            ) from exc
        raise SupabaseIdentityUnavailableError(
            "The Supabase invitation email could not be sent."
        ) from exc


def send_farmer_claim_reminder(email: str) -> None:
    redirect_to = os.getenv("FARMER_CLAIM_REDIRECT_URL", "").strip()
    if not redirect_to:
        raise SupabaseIdentityUnavailableError(
            "FARMER_CLAIM_REDIRECT_URL is not configured."
        )

    try:
        create_supabase_server_client().auth.reset_password_for_email(
            email,
            options={"redirect_to": redirect_to},
        )
    except Exception as exc:
        raise SupabaseIdentityUnavailableError(
            "The Supabase claim reminder email could not be sent."
        ) from exc


def delete_supabase_user(auth_user_id: str) -> None:
    try:
        create_supabase_server_client().auth.admin.delete_user(auth_user_id)
    except Exception as exc:
        code = getattr(exc, "code", None)
        status = getattr(exc, "status", None)
        if code in {"user_not_found", "not_found"} or status == 404:
            return
        raise SupabaseIdentityUnavailableError(
            "The invitation could not be rolled back in Supabase Auth."
        ) from exc


def link_supabase_user_profile(auth_user: Any, display_name: str | None = None) -> dict[str, Any]:
    subject = str(UUID(str(auth_user.id)))
    verified_phone = getattr(auth_user, "phone", None) if getattr(auth_user, "phone_confirmed_at", None) else None
    verified_email = getattr(auth_user, "email", None) if getattr(auth_user, "email_confirmed_at", None) else None
    if not verified_phone and not verified_email:
        raise InvalidSupabaseIdentityError("A verified phone number or email address is required.")

    client = create_supabase_server_client()
    subject_matches = _find_profiles(client, "supabase_auth_user_id", subject)
    if len(subject_matches) > 1:
        raise SupabaseProfileConflictError("Multiple app profiles are linked to this identity.")
    if subject_matches:
        profile = subject_matches[0]
        _sync_linked_supabase_profile(client, profile, subject)
        _sync_linked_user_roles(client, profile, subject)
        return profile

    matched_profiles: dict[str, dict[str, Any]] = {}
    for column, value in (("phone", verified_phone), ("email", verified_email)):
        if not value:
            continue
        matches = _find_profiles(client, column, value)
        if len(matches) > 1:
            raise SupabaseProfileConflictError("Verified contact matches multiple app profiles.")
        if matches:
            matched_profiles[str(matches[0]["id"])] = matches[0]

    if len(matched_profiles) > 1:
        raise SupabaseProfileConflictError("Verified contacts resolve to different app profiles.")
    if matched_profiles:
        profile = next(iter(matched_profiles.values()))
        linked_subject = profile.get("supabase_auth_user_id")
        if linked_subject and str(linked_subject) != subject:
            raise SupabaseProfileConflictError("App profile is already linked to another identity.")
        if not linked_subject:
            client.table("users").update({"supabase_auth_user_id": subject}).eq("id", profile["id"]).execute()
            profile = {**profile, "supabase_auth_user_id": subject}
        _sync_linked_supabase_profile(client, profile, subject)
        _sync_linked_user_roles(client, profile, subject)
        return profile

    profile_data = {
        "supabase_auth_user_id": subject,
        "email": verified_email,
        "phone": verified_phone,
        "display_name": display_name.strip() if display_name and display_name.strip() else None,
        "role": "farmer",
    }
    created_profiles = _profile_rows(client.table("users").insert(profile_data).execute())
    if not created_profiles:
        raise SupabaseIdentityUnavailableError("Supabase did not return the linked app profile.")
    profile = created_profiles[0]
    _sync_linked_supabase_profile(client, profile, subject)
    _sync_linked_user_roles(client, profile, subject)
    return profile
