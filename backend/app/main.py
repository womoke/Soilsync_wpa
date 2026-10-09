import os
import secrets
from typing import Any

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse

import app.env  # noqa: F401
from app import providers
from app.database import (
    AccountDeletionConflict,
    AccountProvisioningConflict,
    DatabaseUnavailable,
    access_sensitive_record_under_grant,
    activate_account_invitation,
    admin_approve_agronomist,
    admin_approve_user,
    admin_delete_user,
    admin_invite_agrodealer,
    admin_invite_agronomist,
    admin_invite_officer,
    admin_list_users,
    admin_manage_officer_assignment,
    admin_revoke_user,
    admin_toggle_user_active,
    admin_update_user_role,
    archive_dealer_product,
    cancel_account_invitation,
    check_admin_permission,
    claim_agronomic_assessment,
    claim_officer_visit,
    create_admin_audit_entry,
    create_dealer_product,
    create_farmer_farm,
    create_farmer_recommendation_feedback,
    create_farmer_soil_reading,
    create_farmer_sync_draft,
    create_farmer_visit_request,
    create_marketplace_order,
    create_officer_alert,
    create_officer_visit,
    create_support_access_grant,
    delete_dealer_product,
    edit_agronomic_assessment,
    export_officer_report,
    get_agrodealer_application_status,
    load_admin_audit_log,
    load_admin_operational_health,
    load_admin_permissions,
    load_admin_system_overview,
    load_agrodealer_catalog,
    load_authenticated_agrodealer_catalog,
    load_dashboard_data,
    load_dealer_orders,
    load_dealer_profile,
    load_demo_recommendations,
    load_demo_soil_reading,
    load_farm_verified_report,
    load_farmer_account,
    load_farmer_farm,
    load_farmer_farms,
    load_farmer_recommendation_feedback,
    load_farmer_recommendations,
    load_farmer_soil_readings,
    load_farmer_sync_status,
    load_officer_alerts,
    load_officer_farm_readings,
    load_officer_farmer_roster,
    load_officer_jurisdictions,
    load_officer_unclaimed_farmers,
    load_officer_visit_pool,
    load_officer_visits,
    load_officer_ward_summaries,
    load_support_access_grants,
    load_system_settings,
    load_unverified_assessments,
    officer_register_unclaimed_farmer,
    process_unclaimed_farmer_cleanup,
    process_unclaimed_farmer_reminders,
    publish_verified_assessment,
    queue_farmer_sync_draft,
    record_officer_field_collection,
    release_agronomic_assessment,
    release_officer_visit,
    resend_account_invitation,
    revoke_dealer_location,
    revoke_support_access_grant,
    search_dealers_proximity,
    update_dealer_coordinates,
    update_dealer_location_consent,
    update_dealer_product,
    update_dealer_product_stock,
    update_dealer_profile,
    update_marketplace_order_status,
    update_officer_alert,
    update_officer_visit,
    update_system_setting,
    update_user_profile,
)
from app.models import (
    AdminAgrodealerInviteRequest,
    AdminAgrodealerInviteResponse,
    AdminAgronomistApprovalRequest,
    AdminAgronomistInviteRequest,
    AdminAgronomistInviteResponse,
    AdminOfficerAssignmentRequest,
    AdminOfficerInviteRequest,
    AdminOfficerInviteResponse,
    AdminRoleUpdateRequest,
    AdminSettingUpdateRequest,
    AdminSupportGrantRequest,
    AdminSupportRevokeRequest,
    AdminUserActiveRequest,
    AdminUserApproveRequest,
    AdminUserDeleteRequest,
    AdminUserRevokeRequest,
    AgrodealerApplicationRequest,
    AgrodealerApplicationResponse,
    AssessmentEditRequest,
    AssessmentPublishRequest,
    DealerCoordinatesUpdateRequest,
    DealerLocationConsentRequest,
    DealerProductArchiveRequest,
    DealerProductCreateRequest,
    DealerProductUpdateRequest,
    DealerProfileUpdateRequest,
    DealerStockUpdateRequest,
    FarmerFarmCreateRequest,
    FarmerSoilReadingCreateRequest,
    InvitationActionResponse,
    MarketplaceOrderCreateRequest,
    MarketplaceOrderStatusUpdateRequest,
    OfficerAlert,
    OfficerAlertCreateRequest,
    OfficerAlertUpdateRequest,
    OfficerFieldCollectionRequest,
    OfficerRegisterFarmerRequest,
    OfficerRegisterFarmerResponse,
    OfficerReportExportRequest,
    OfficerReportExportResponse,
    OfficerVisit,
    OfficerVisitCreateRequest,
    OfficerVisitUpdateRequest,
    OfficerWardSummary,
    RecommendationFeedbackRequest,
    SoilReading,
    SoilReadingPreviewRequest,
    SoilRecommendation,
    SyncDraftCreateRequest,
    SyncDraftSubmitRequest,
    UnclaimedCleanupBatchResponse,
    UnclaimedFarmerAccountResponse,
    UnclaimedReminderBatchResponse,
    UserProfileResponse,
    UserProfileUpdateRequest,
)
from app.providers import get_provider_status_summary
from app.supabase_client import (
    InvalidSupabaseIdentityError,
    SupabaseIdentityUnavailableError,
    SupabaseInvitationConflictError,
    SupabaseInvitationRequiredError,
    SupabaseProfileConflictError,
    delete_supabase_user,
    get_linked_supabase_profile,
    get_supabase_user_roles,
    get_verified_supabase_user,
    invite_user_by_email,
    link_supabase_user_profile,
    revoke_supabase_session,
)


def get_bearer_token(request: Request) -> str:
    authorization = request.headers.get("Authorization", "")
    scheme, separator, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not separator or not token.strip():
        raise HTTPException(status_code=401, detail="A verified Supabase bearer token is required.")
    return token.strip()


def get_verified_request_user(request: Request) -> tuple[str, object]:
    access_token = get_bearer_token(request)
    try:
        auth_user = get_verified_supabase_user(access_token)
    except InvalidSupabaseIdentityError as exc:
        raise HTTPException(status_code=401, detail="Supabase session is invalid or expired.") from exc
    except SupabaseIdentityUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return access_token, auth_user


def require_role(request: Request, required_role: str) -> str:
    _, auth_user = get_verified_request_user(request)
    try:
        profile = get_linked_supabase_profile(str(auth_user.id))
        role_rows = get_supabase_user_roles(str(auth_user.id))
    except SupabaseProfileConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SupabaseIdentityUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if profile is None or profile.get("is_active") is not True:
        raise HTTPException(status_code=401, detail="No active app profile is linked to this session.")
    normalized_role = "extension-officer" if required_role == "extension_officer" else required_role
    role_status = {
        ("extension-officer" if row["role"] == "extension_officer" else row["role"]): row["status"]
        for row in role_rows
    }
    if role_status.get(normalized_role) != "active":
        if normalized_role == "agrodealer" and role_status.get(normalized_role) == "pending":
            raise HTTPException(status_code=403, detail="This agrodealer account is awaiting approval.")
        if normalized_role == "agronomist" and role_status.get(normalized_role) == "pending":
            raise HTTPException(status_code=403, detail="This agronomist account is awaiting approval.")
        if normalized_role == "farmer" and role_status.get(normalized_role) == "unclaimed":
            raise HTTPException(status_code=403, detail="This farmer account is unclaimed. Please follow the email claim link to activate your account.")
        raise HTTPException(status_code=403, detail="This operation is not available to this role.")
    return str(profile["id"])


def require_session(request: Request) -> str:
    return require_role(request, "farmer")


def require_officer_session(request: Request) -> str:
    return require_role(request, "extension_officer")


def require_dealer_session(request: Request) -> str:
    return require_role(request, "agrodealer")


def require_admin_session(request: Request) -> str:
    return require_role(request, "admin")


def require_unclaimed_lifecycle_job_access(request: Request) -> None:
    expected_token = os.getenv("UNCLAIMED_LIFECYCLE_JOB_TOKEN", "").strip()
    provided_token = request.headers.get("X-SoilSync-Job-Token", "")
    if expected_token and provided_token and secrets.compare_digest(
        provided_token, expected_token
    ):
        return
    require_admin_session(request)


def require_agronomist_session(request: Request) -> str:
    return require_role(request, "agronomist")


def require_officer_or_agronomist_session(request: Request) -> tuple[str, str, str]:
    """Returns (user_id, role, display_name) for an officer or agronomist."""
    _, auth_user = get_verified_request_user(request)
    try:
        profile = get_linked_supabase_profile(str(auth_user.id))
        role_rows = get_supabase_user_roles(str(auth_user.id))
    except SupabaseProfileConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SupabaseIdentityUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if profile is None or profile.get("is_active") is not True:
        raise HTTPException(status_code=401, detail="No active app profile is linked to this session.")

    role_status = {
        ("extension_officer" if row["role"] in ("extension_officer", "extension-officer") else row["role"]): row["status"]
        for row in role_rows
    }
    user_id = str(profile["id"])
    name = profile.get("display_name") or "Agronomic Specialist"
    if role_status.get("agronomist") == "active":
        return user_id, "agronomist", name
    if role_status.get("extension_officer") == "active":
        return user_id, "extension_officer", name
    if role_status.get("admin") == "active":
        return user_id, "admin", name
    raise HTTPException(status_code=403, detail="This operation is restricted to extension officers and agronomists.")


def require_authenticated_user(request: Request) -> str:
    _, auth_user = get_verified_request_user(request)
    try:
        profile = get_linked_supabase_profile(str(auth_user.id))
    except SupabaseProfileConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SupabaseIdentityUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if profile is None or profile.get("is_active") is not True:
        raise HTTPException(status_code=401, detail="No active app profile is linked to this session.")
    return str(profile["id"])


def get_client_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


app = FastAPI(
    title="SoilSync API",
    version="0.2.0",
    description="Local prototype API. Demo data is synthetic and does not provide agronomic advice.",
)


def get_current_environment() -> str:
    return os.getenv("APP_ENV", "local").strip() or "local"


@app.get("/")
def root() -> dict[str, object]:
    return {
        "service": "SoilSync API",
        "version": "0.2.0",
        "status": "online",
        "docsUrl": "/docs",
        "healthCheck": "/api/v1/health",
        "frontendUrl": "https://localhost:5173",
        "message": "Welcome to SoilSync API. Open the frontend UI at https://localhost:5173 or interactive documentation at /docs.",
    }


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/health")
def versioned_health_check() -> dict[str, str]:
    return {"status": "ok", "service": "SoilSync API", "apiVersion": "v1"}


@app.get("/api/v1/config")
def app_config() -> dict[str, object]:
    return {
        "appName": "SoilSync AI",
        "environment": get_current_environment(),
        "demoMode": True,
        "apiVersion": "v1",
        "features": ["farmer_overview", "soil_preview", "prototype_recommendations"],
    }


@app.get("/api/v1/demo/soil-reading", response_model=SoilReading)
def get_demo_soil_reading() -> SoilReading:
    try:
        return load_demo_soil_reading()
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/v1/demo/recommendations", response_model=list[SoilRecommendation])
def get_demo_recommendations() -> list[SoilRecommendation]:
    try:
        return load_demo_recommendations()
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/v1/demo/dashboard/seed-data")
def get_dashboard_seed_data_endpoint(role: str = Query("farmer")) -> dict[str, object]:
    try:
        return load_dashboard_data(role)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/v1/demo/agrodealer/catalog")
def get_agrodealer_catalog_endpoint() -> dict[str, object]:
    try:
        return load_agrodealer_catalog()
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/v1/agrodealer/me/catalog")
def get_authenticated_agrodealer_catalog(request: Request) -> dict[str, object]:
    dealer_user_id = require_dealer_session(request)
    try:
        catalog = load_authenticated_agrodealer_catalog(dealer_user_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if catalog is None:
        raise HTTPException(status_code=404, detail="Dealer profile not found.")
    return catalog


@app.get("/api/v1/demo/provider-status")
def get_demo_provider_status() -> dict[str, object]:
    return get_provider_status_summary().model_dump(mode="json")


@app.get("/api/v1/providers/soilgrids/summary")
def get_soilgrids_provider_status() -> dict[str, object]:
    return providers.get_soilgrids_provider_summary()


@app.get("/api/v1/providers/wosis/summary")
def get_wosis_provider_status() -> dict[str, object]:
    return providers.get_wosis_provider_summary()


@app.get("/api/v1/providers/soilgrids/coverage")
def get_soilgrids_coverage(
    latitude: float,
    longitude: float,
    coverage_id: str = Query(..., alias="coverageId"),
) -> dict[str, object]:
    try:
        approved_coverage_id = providers.validate_soilgrids_coverage_id(coverage_id)
        bbox = providers.build_soilgrids_bbox_for_point(latitude, longitude)
        return providers.fetch_soilgrids_coverage(approved_coverage_id, bbox)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="SoilGrids WCS lookup failed.") from exc


@app.post("/api/v1/auth/register")
def register_farmer() -> None:
    raise HTTPException(status_code=501, detail="Registration is pending Supabase Auth integration.")


@app.post("/api/v1/auth/link")
def link_authenticated_user(payload: dict[str, str], request: Request) -> dict[str, object]:
    access_token = get_bearer_token(request)
    try:
        auth_user = get_verified_supabase_user(access_token)
    except InvalidSupabaseIdentityError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except SupabaseIdentityUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    try:
        profile = link_supabase_user_profile(auth_user, payload.get("displayName"))
    except SupabaseInvitationRequiredError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except SupabaseProfileConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except InvalidSupabaseIdentityError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except SupabaseIdentityUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if profile.get("is_active") is not True:
        raise HTTPException(status_code=403, detail="This account is inactive. Contact an administrator.")

    try:
        role_rows = get_supabase_user_roles(str(auth_user.id))
    except SupabaseIdentityUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    active_roles = {
        "extension_officer" if row["role"] == "extension-officer" else row["role"]
        for row in role_rows
        if row["status"] == "active"
    }
    role = next(
        (
            candidate
            for candidate in ("admin", "extension_officer", "agrodealer", "agronomist", "farmer")
            if candidate in active_roles
        ),
        None,
    )
    if role is None:
        pending_dealer = any(
            row["role"] == "agrodealer" and row["status"] == "pending" for row in role_rows
        )
        if pending_dealer:
            raise HTTPException(status_code=403, detail="This agrodealer account is awaiting approval.")
        pending_agronomist = any(
            row["role"] == "agronomist" and row["status"] == "pending" for row in role_rows
        )
        if pending_agronomist:
            raise HTTPException(status_code=403, detail="This agronomist account is awaiting approval.")
        unclaimed_farmer = any(
            row["role"] == "farmer" and row["status"] == "unclaimed" for row in role_rows
        )
        if unclaimed_farmer:
            raise HTTPException(
                status_code=403,
                detail="This farmer account is unclaimed. Please follow the email claim link to activate your account.",
            )
        raise HTTPException(status_code=403, detail="This account has no active application role.")

    return {
        "status": "linked",
        "appUserId": str(profile["id"]),
        "identityProvider": "supabase",
        "role": role,
    }


@app.post("/api/v1/auth/invitations/activate")
def activate_auth_invitation(request: Request) -> dict[str, str]:
    _, auth_user = get_verified_request_user(request)
    try:
        role = activate_account_invitation(str(auth_user.id))
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if role is None:
        raise HTTPException(
            status_code=403,
            detail="No pending staff or agrodealer invitation was found for this account.",
        )
    return {"status": "active", "role": role}


@app.post("/api/v1/auth/login")
def login_farmer() -> None:
    raise HTTPException(status_code=501, detail="Login is pending Supabase Auth integration.")


@app.post("/api/v1/auth/logout")
def logout_farmer(request: Request) -> dict[str, object]:
    access_token, _ = get_verified_request_user(request)
    try:
        revoke_supabase_session(access_token)
    except SupabaseIdentityUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        "status": "logged_out",
        "message": "The current refresh session was revoked; the access token remains valid until its expiry.",
    }


@app.get("/api/v1/farms/me")
def get_farmer_profile(request: Request) -> dict[str, object]:
    user_id = require_session(request)
    try:
        account = load_farmer_account(user_id)
        farms = load_farmer_farms(user_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if account is None:
        raise HTTPException(status_code=404, detail="Farmer profile not found.")
    primary_farm = farms[0] if farms else None
    return {
        "farmerId": account["userId"],
        "name": account["name"],
        "phone": account["phone"],
        "farmId": primary_farm["farmId"] if primary_farm else None,
        "farmName": primary_farm["name"] if primary_farm else None,
        "ownerVerified": primary_farm["ownerVerified"] if primary_farm else False,
        "farms": farms,
        "sessionValid": True,
    }


@app.patch("/api/v1/profile/me", response_model=UserProfileResponse)
def patch_user_profile(
    request: Request, payload: UserProfileUpdateRequest
) -> UserProfileResponse:
    _, auth_user = get_verified_request_user(request)
    try:
        linked_profile = get_linked_supabase_profile(str(auth_user.id))
    except SupabaseProfileConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SupabaseIdentityUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if linked_profile is None or linked_profile.get("is_active") is not True:
        raise HTTPException(status_code=401, detail="No active app profile is linked to this session.")

    try:
        updated_profile = update_user_profile(
            str(auth_user.id),
            full_name=payload.full_name,
            phone_number=payload.phone_number,
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if updated_profile is None:
        raise HTTPException(status_code=404, detail="Profile not found.")
    return UserProfileResponse(**updated_profile)


@app.get("/api/v1/farms")
def get_farmer_farms(request: Request) -> list[dict[str, object]]:
    user_id = require_session(request)
    try:
        return load_farmer_farms(user_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/v1/farms", status_code=201)
def create_farmer_farm_endpoint(
    payload: FarmerFarmCreateRequest, request: Request
) -> dict[str, object]:
    user_id = require_session(request)
    try:
        if payload.size_acres is not None or payload.crops is not None:
            farm = create_farmer_farm(
                user_id,
                payload.name,
                payload.county,
                payload.ward,
                payload.sub_county,
                payload.size_acres,
                payload.crops,
            )
        elif payload.sub_county is not None:
            farm = create_farmer_farm(
                user_id,
                payload.name,
                payload.county,
                payload.ward,
                payload.sub_county,
            )
        else:
            farm = create_farmer_farm(user_id, payload.name, payload.county, payload.ward)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if farm is None:
        raise HTTPException(status_code=404, detail="Active farmer profile not found.")
    return farm


@app.post("/api/v1/farms/{farm_id}/visit-request", status_code=201)
def request_farm_visit_endpoint(
    request: Request,
    farm_id: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, object]:
    user_id = require_session(request)
    notes = (payload or {}).get("notes") if isinstance(payload, dict) else None
    try:
        visit_req = create_farmer_visit_request(user_id, farm_id, notes=notes)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if visit_req is None:
        raise HTTPException(status_code=404, detail="Farm not found or access denied.")
    return visit_req


@app.get("/api/v1/farms/{farm_id}/ownership")
def get_farm_ownership(request: Request, farm_id: str) -> dict[str, object]:
    user_id = require_session(request)
    try:
        farm = load_farmer_farm(user_id, farm_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if farm is None:
        raise HTTPException(status_code=404, detail="Farm not found.")
    return {
        "farmId": farm["farmId"],
        "ownerFarmerId": user_id,
        "ownerVerified": farm["ownerVerified"],
        "isOwner": True,
        "sessionValid": True,
        "requiresOwnerApproval": not farm["ownerVerified"],
    }


@app.get("/api/v1/farms/{farm_id}/readings", response_model=list[SoilReading])
def get_farmer_readings(request: Request, farm_id: str) -> list[SoilReading]:
    user_id = require_session(request)
    try:
        farm = load_farmer_farm(user_id, farm_id)
        if farm is None:
            raise HTTPException(status_code=404, detail="Farm not found.")
        return load_farmer_soil_readings(user_id, farm_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/v1/farms/{farm_id}/readings", status_code=201, response_model=SoilReading)
def create_farmer_reading(
    request: Request, farm_id: str, payload: FarmerSoilReadingCreateRequest
) -> SoilReading:
    user_id = require_session(request)
    try:
        farm = load_farmer_farm(user_id, farm_id)
        if farm is None:
            raise HTTPException(status_code=404, detail="Farm not found.")
        if not farm["ownerVerified"]:
            raise HTTPException(status_code=409, detail="Farm ownership review is required before submitting readings.")
        reading = create_farmer_soil_reading(user_id, farm_id, payload)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if reading is None:
        raise HTTPException(status_code=404, detail="Farm not found.")
    return reading


@app.get("/api/v1/farms/{farm_id}/recommendations", response_model=list[SoilRecommendation])
def get_farmer_recommendations(request: Request, farm_id: str) -> list[SoilRecommendation]:
    user_id = require_session(request)
    try:
        farm = load_farmer_farm(user_id, farm_id)
        if farm is None:
            raise HTTPException(status_code=404, detail="Farm not found.")
        return load_farmer_recommendations(user_id, farm_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/v1/recommendations/{recommendation_id}/feedback", status_code=201)
def add_farmer_recommendation_feedback(
    request: Request, recommendation_id: str, payload: RecommendationFeedbackRequest
) -> dict[str, object]:
    user_id = require_session(request)
    try:
        feedback = create_farmer_recommendation_feedback(
            user_id, recommendation_id, payload.response
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if feedback is None:
        raise HTTPException(status_code=404, detail="Recommendation not found.")
    return feedback


@app.get("/api/v1/recommendations/{recommendation_id}/feedback")
def get_farmer_recommendation_feedback(
    request: Request, recommendation_id: str
) -> list[dict[str, object]]:
    user_id = require_session(request)
    try:
        return load_farmer_recommendation_feedback(user_id, recommendation_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/v1/farms/sync-status")
def get_farm_sync_status(request: Request) -> dict[str, object]:
    farmer_id = require_session(request)
    try:
        status = load_farmer_sync_status(farmer_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if status is None:
        raise HTTPException(status_code=404, detail="Farm record not found for this farmer.")
    return {
        "status": "ready" if status["ownerVerified"] else "ownership_review_pending",
        "ready": False,
        "offlineDrafts": status["offlineDrafts"],
        "pendingSyncs": status["pendingSyncs"],
        "farmId": status["farmId"],
        "ownerFarmerId": farmer_id,
        "currentStep": "farmer-registration-and-ownership-review",
        "requiresOwnerApproval": not status["ownerVerified"],
        "message": "Drafts are stored privately; transfer to external sync remains pending integration.",
    }


@app.post("/api/v1/farms/sync-drafts", status_code=201)
def create_sync_draft(request: Request, payload: SyncDraftCreateRequest) -> dict[str, object]:
    farmer_id = require_session(request)
    try:
        draft = create_farmer_sync_draft(
            farmer_id,
            payload.draft_type,
            payload.payload,
            payload.version,
            str(payload.client_draft_id) if payload.client_draft_id else None,
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if draft is None:
        try:
            farms = load_farmer_farms(farmer_id)
        except DatabaseUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        if farms:
            raise HTTPException(status_code=409, detail="Farm ownership review is required before syncing.")
        raise HTTPException(status_code=404, detail="Farm record not found for this farmer.")
    return {
        "status": "draft_created",
        "draftId": draft["draftId"],
        "draftType": draft["draftType"],
        "farmId": draft["farmId"],
        "ownerFarmerId": farmer_id,
        "version": draft["version"],
        "message": "Offline draft saved to your account.",
    }


@app.post("/api/v1/farms/sync-submit")
def submit_sync(request: Request, payload: SyncDraftSubmitRequest) -> dict[str, object]:
    farmer_id = require_session(request)
    try:
        result = queue_farmer_sync_draft(farmer_id, str(payload.draft_id), payload.payload)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if result["status"] == "not_found":
        raise HTTPException(status_code=404, detail="Draft not found.")
    if result["status"] == "ownership_pending":
        raise HTTPException(status_code=409, detail="Farm ownership review is required before syncing.")
    if result["status"] == "conflict":
        return JSONResponse(
            status_code=409,
            content={
                "status": "conflict",
                "draftId": str(payload.draft_id),
                "message": "This draft has already been queued for sync.",
            },
        )
    return {
        "status": "queued",
        "queueId": result["queueId"],
        "draftId": result["draftId"],
        "farmId": result["farmId"],
        "ownerFarmerId": farmer_id,
        "message": "Draft was added to your private sync queue.",
    }


@app.get("/api/v1/officer/jurisdictions")
def get_officer_jurisdictions(request: Request) -> list[dict[str, object]]:
    officer_user_id = require_officer_session(request)
    try:
        return load_officer_jurisdictions(officer_user_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/v1/officer/farmers")
def get_officer_farmer_roster(request: Request) -> list[dict[str, object]]:
    officer_user_id = require_officer_session(request)
    try:
        return load_officer_farmer_roster(officer_user_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/v1/officer/farms/{farm_id}/readings", response_model=list[SoilReading])
def get_officer_farm_readings(request: Request, farm_id: str) -> list[SoilReading]:
    """Soil readings for a farm within the officer's jurisdiction."""
    officer_user_id = require_officer_session(request)
    try:
        readings = load_officer_farm_readings(officer_user_id, farm_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return readings


@app.get("/api/v1/officer/visits", response_model=list[OfficerVisit])
def get_officer_visits(request: Request) -> list[dict[str, object]]:
    """List visits for farms/farmers within the officer's jurisdiction."""
    officer_user_id = require_officer_session(request)
    try:
        return load_officer_visits(officer_user_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/v1/officer/visits", response_model=OfficerVisit, status_code=201)
def schedule_officer_visit(
    request: Request, payload: OfficerVisitCreateRequest
) -> dict[str, object]:
    """Schedule a visit for a farmer/farm within the officer's jurisdiction."""
    officer_user_id = require_officer_session(request)
    try:
        visit = create_officer_visit(
            officer_user_id=officer_user_id,
            farmer_id=payload.farmer_id,
            farm_id=payload.farm_id,
            planned_date=payload.planned_date,
            status=payload.status,
            notes=payload.notes,
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if visit is None:
        raise HTTPException(
            status_code=403,
            detail="Farmer or farm is not within officer's active assigned jurisdiction.",
        )
    return visit


@app.patch("/api/v1/officer/visits/{visit_id}", response_model=OfficerVisit)
def update_officer_visit_record(
    request: Request, visit_id: str, payload: OfficerVisitUpdateRequest
) -> dict[str, object]:
    """Update visit status, date, or notes with authorization check."""
    officer_user_id = require_officer_session(request)
    try:
        visit = update_officer_visit(
            officer_user_id=officer_user_id,
            visit_id=visit_id,
            planned_date=payload.planned_date,
            status=payload.status,
            notes=payload.notes,
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if visit is None:
        raise HTTPException(
            status_code=404,
            detail="Visit not found or outside officer's assigned jurisdiction.",
        )
    return visit


@app.get("/api/v1/officer/visit-pool", response_model=list[OfficerVisit])
def get_officer_visit_pool(request: Request) -> list[dict[str, object]]:
    """List unassigned visit requests within the officer's jurisdiction."""
    officer_user_id = require_officer_session(request)
    try:
        return load_officer_visit_pool(officer_user_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/v1/officer/visits/{visit_id}/claim", response_model=OfficerVisit)
def claim_officer_visit_endpoint(request: Request, visit_id: str) -> dict[str, object]:
    """Atomically claim a visit request from the county pool."""
    officer_user_id = require_officer_session(request)
    try:
        visit = claim_officer_visit(officer_user_id, visit_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if visit is None:
        raise HTTPException(
            status_code=409,
            detail="Visit request has already been claimed by another officer or is unavailable.",
        )
    return visit


@app.post("/api/v1/officer/visits/{visit_id}/release", response_model=OfficerVisit)
def release_officer_visit_endpoint(request: Request, visit_id: str) -> dict[str, object]:
    """Release a claimed visit back to the unassigned county pool."""
    officer_user_id = require_officer_session(request)
    try:
        visit = release_officer_visit(officer_user_id, visit_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if visit is None:
        raise HTTPException(
            status_code=404,
            detail="Visit cannot be released (must be claimed/scheduled by current officer).",
        )
    return visit


@app.post("/api/v1/officer/visits/{visit_id}/field-collection", status_code=201)
def record_officer_field_collection_endpoint(
    request: Request, visit_id: str, payload: OfficerFieldCollectionRequest
) -> dict[str, object]:
    """Capture exact farm GPS coordinates and soil measurements on-site."""
    officer_user_id = require_officer_session(request)
    try:
        result = record_officer_field_collection(
            officer_user_id=officer_user_id,
            visit_id=visit_id,
            latitude=payload.latitude,
            longitude=payload.longitude,
            location_uncertainty_m=payload.location_uncertainty_m,
            top_cm=payload.top_cm,
            bottom_cm=payload.bottom_cm,
            measurements=[m.model_dump() for m in payload.measurements],
            sampled_at=payload.sampled_at,
            notes=payload.notes,
            mark_completed=payload.mark_completed,
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if result is None:
        raise HTTPException(
            status_code=403,
            detail="Cannot record field collection. Visit must be claimed by the calling officer and in an active status.",
        )
    return result


@app.get("/api/v1/assessments/unverified")
def list_unverified_assessments(request: Request, county: str | None = None) -> list[dict[str, Any]]:
    """List unverified assessments scoped to assigned officer or agronomist review pool."""
    user_id, role, _ = require_officer_or_agronomist_session(request)
    try:
        return load_unverified_assessments(user_id=user_id, role=role, county=county)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/v1/assessments/{assessment_id}/claim")
def claim_assessment_endpoint(request: Request, assessment_id: str) -> dict[str, Any]:
    """Atomic claim of an unverified assessment by an agronomist."""
    user_id = require_agronomist_session(request)
    try:
        claimed = claim_agronomic_assessment(agronomist_user_id=user_id, assessment_id=assessment_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if claimed is None:
        raise HTTPException(
            status_code=409,
            detail=(
                "Assessment cannot be claimed. It may already be claimed or verified, "
                "or it may be outside your approved county review pool."
            ),
        )
    return claimed


@app.post("/api/v1/assessments/{assessment_id}/release")
def release_assessment_endpoint(request: Request, assessment_id: str) -> dict[str, Any]:
    """Release a claimed assessment back to the county review pool."""
    user_id = require_agronomist_session(request)
    try:
        released = release_agronomic_assessment(agronomist_user_id=user_id, assessment_id=assessment_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if released is None:
        raise HTTPException(
            status_code=403,
            detail="Cannot release assessment (must be claimed by the calling agronomist).",
        )
    return released


@app.post("/api/v1/assessments/{assessment_id}/edit")
def edit_assessment_endpoint(
    request: Request, assessment_id: str, payload: AssessmentEditRequest
) -> dict[str, Any]:
    """Record collaborative agronomic notes or dosage adjustments with author audit trail."""
    user_id, role, author_name = require_officer_or_agronomist_session(request)
    try:
        edited = edit_agronomic_assessment(
            user_id=user_id,
            role=role,
            assessment_id=assessment_id,
            author_name=author_name,
            notes=payload.notes,
            adjustments=[
                adjustment.model_dump(by_alias=True)
                for adjustment in payload.adjustments or []
            ],
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if edited is None:
        raise HTTPException(
            status_code=403,
            detail="Cannot edit assessment. You must be the assigned extension officer or claiming agronomist.",
        )
    return edited


@app.post("/api/v1/assessments/{assessment_id}/publish")
def publish_assessment_endpoint(
    request: Request, assessment_id: str, payload: AssessmentPublishRequest
) -> dict[str, Any]:
    """Publish the verified, immutable soil report for the farmer."""
    user_id = require_agronomist_session(request)
    _, _, agronomist_name = require_officer_or_agronomist_session(request)
    try:
        published = publish_verified_assessment(
            agronomist_user_id=user_id,
            agronomist_name=agronomist_name,
            assessment_id=assessment_id,
            license_number=payload.license_number,
            final_notes=payload.final_notes,
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if published is None:
        raise HTTPException(
            status_code=403,
            detail="Cannot publish assessment. You must be the claiming agronomist on an unverified assessment.",
        )
    return published


@app.get("/api/v1/farms/{farm_id}/reports/verified")
def get_farm_verified_report_endpoint(request: Request, farm_id: str) -> dict[str, Any]:
    """Retrieve the published, verified agronomic report for an owned farm."""
    user_id = require_session(request)
    try:
        report = load_farm_verified_report(user_id=user_id, farm_id=farm_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if report is None:
        raise HTTPException(
            status_code=404,
            detail="No verified soil report is available for this farm yet. Assessments remain pending agronomic review.",
        )
    return report


@app.get("/api/v1/officer/alerts", response_model=list[OfficerAlert])
def get_officer_alerts(request: Request) -> list[dict[str, object]]:
    """List soil and agronomic alerts within the officer's assigned jurisdiction."""
    officer_user_id = require_officer_session(request)
    try:
        return load_officer_alerts(officer_user_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/v1/officer/alerts", response_model=OfficerAlert, status_code=201)
def create_officer_alert_record(
    request: Request, payload: OfficerAlertCreateRequest
) -> dict[str, object]:
    """Create a new alert for a farmer/farm within officer's jurisdiction."""
    officer_user_id = require_officer_session(request)
    try:
        alert = create_officer_alert(
            officer_user_id=officer_user_id,
            farmer_id=payload.farmer_id,
            farm_id=payload.farm_id,
            title=payload.title,
            summary=payload.summary,
            source=payload.source,
            severity=payload.severity,
            notes=payload.notes,
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if alert is None:
        raise HTTPException(
            status_code=403,
            detail="Farmer or farm is not within officer's active assigned jurisdiction.",
        )
    return alert


@app.patch("/api/v1/officer/alerts/{alert_id}", response_model=OfficerAlert)
def triage_officer_alert(
    request: Request, alert_id: str, payload: OfficerAlertUpdateRequest
) -> dict[str, object]:
    """Triage an alert (status, notes, severity, resolution)."""
    officer_user_id = require_officer_session(request)
    try:
        alert = update_officer_alert(
            officer_user_id=officer_user_id,
            alert_id=alert_id,
            severity=payload.severity,
            status=payload.status,
            notes=payload.notes,
            resolution_notes=payload.resolution_notes,
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if alert is None:
        raise HTTPException(
            status_code=404,
            detail="Alert not found or outside officer's assigned jurisdiction.",
        )
    return alert


@app.get("/api/v1/officer/ward-summaries", response_model=list[OfficerWardSummary])
def get_officer_ward_summaries(request: Request) -> list[dict[str, object]]:
    """Ward-level aggregated statistics with privacy thresholds."""
    officer_user_id = require_officer_session(request)
    try:
        return load_officer_ward_summaries(officer_user_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/v1/officer/reports/export", response_model=OfficerReportExportResponse)
def export_officer_data_report(
    request: Request, payload: OfficerReportExportRequest
) -> dict[str, object]:
    """Gated data report export with strict field allowlist and privacy controls."""
    officer_user_id = require_officer_session(request)
    try:
        report = export_officer_report(
            officer_user_id=officer_user_id,
            county=payload.county,
            sub_county=payload.sub_county,
            ward=payload.ward,
            export_format=payload.format,
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if report is None:
        raise HTTPException(
            status_code=403,
            detail="Requested scope is outside officer's active assigned jurisdiction or unverified.",
        )
    return report



# ---------------------------------------------------------------------------
# Dealer application & self-service endpoints
# ---------------------------------------------------------------------------


@app.post("/api/v1/dealer/apply", response_model=AgrodealerApplicationResponse)
@app.post("/api/v1/agrodealer/apply", response_model=AgrodealerApplicationResponse)
def apply_for_agrodealer(
    request: Request,
    payload: AgrodealerApplicationRequest,
) -> AgrodealerApplicationResponse:
    """Prevent public role applications; agrodealer accounts are admin-invitation only."""
    get_verified_request_user(request)
    raise HTTPException(
        status_code=403,
        detail="Agrodealer accounts are created by administrators. Contact your administrator for an invitation.",
    )


@app.get("/api/v1/dealer/application-status")
@app.get("/api/v1/agrodealer/application-status")
def get_dealer_application_status_endpoint(request: Request) -> dict[str, object]:
    """Check the status of an agrodealer application for the authenticated user."""
    _, auth_user = get_verified_request_user(request)
    user_id = str(auth_user.id)
    try:
        app_status = get_agrodealer_application_status(user_id)
        if not app_status:
            return {"hasApplication": False, "application": None}
        return {"hasApplication": True, "application": app_status}
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/v1/agrodealer/me/profile")
def get_dealer_profile(request: Request) -> dict[str, object]:
    dealer_user_id = require_dealer_session(request)
    try:
        profile = load_dealer_profile(dealer_user_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if profile is None:
        raise HTTPException(status_code=404, detail="Dealer profile not found.")
    return profile


@app.patch("/api/v1/agrodealer/me/profile")
def patch_dealer_profile(
    request: Request, payload: DealerProfileUpdateRequest
) -> dict[str, object]:
    dealer_user_id = require_dealer_session(request)
    try:
        profile = update_dealer_profile(
            dealer_user_id,
            business_name=payload.business_name,
            county=payload.county,
            sub_county=payload.sub_county,
            ward=payload.ward,
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if profile is None:
        raise HTTPException(status_code=404, detail="Dealer profile not found.")
    return profile


@app.post("/api/v1/agrodealer/me/products", status_code=201)
def create_dealer_product_endpoint(
    request: Request, payload: DealerProductCreateRequest
) -> dict[str, object]:
    dealer_user_id = require_dealer_session(request)
    try:
        product = create_dealer_product(
            dealer_user_id,
            name=payload.name,
            category=payload.category,
            stock_quantity=payload.stock_quantity,
            stock_unit=payload.stock_unit,
            description=payload.description,
            unit_price=payload.unit_price,
            currency=payload.currency,
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if product is None:
        raise HTTPException(status_code=404, detail="Dealer profile not found.")
    return product


@app.patch("/api/v1/agrodealer/me/products/{product_id}")
def patch_dealer_product(
    request: Request, product_id: str, payload: DealerProductUpdateRequest
) -> dict[str, object]:
    dealer_user_id = require_dealer_session(request)
    try:
        product = update_dealer_product(
            dealer_user_id,
            product_id=product_id,
            name=payload.name,
            description=payload.description,
            unit_price=payload.unit_price,
            is_listed=payload.is_listed,
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found.")
    return product


@app.put("/api/v1/agrodealer/me/products/{product_id}/stock")
def update_product_stock(
    request: Request, product_id: str, payload: DealerStockUpdateRequest
) -> dict[str, object]:
    dealer_user_id = require_dealer_session(request)
    try:
        result = update_dealer_product_stock(
            dealer_user_id, product_id=product_id, stock_quantity=payload.stock_quantity
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Product not found.")
    return result


@app.post("/api/v1/agrodealer/me/location/consent")
def post_dealer_location_consent(
    request: Request, payload: DealerLocationConsentRequest
) -> dict[str, object]:
    dealer_user_id = require_dealer_session(request)
    try:
        profile = update_dealer_location_consent(
            dealer_user_id, granted=payload.consent_granted, notes=payload.consent_notes
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if profile is None:
        raise HTTPException(status_code=404, detail="Dealer profile not found.")
    return profile


@app.post("/api/v1/agrodealer/me/location/coordinates")
def post_dealer_coordinates(
    request: Request, payload: DealerCoordinatesUpdateRequest
) -> dict[str, object]:
    dealer_user_id = require_dealer_session(request)
    try:
        result = update_dealer_coordinates(
            dealer_user_id,
            latitude=payload.latitude,
            longitude=payload.longitude,
            accuracy_meters=payload.accuracy_meters,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Dealer profile not found.")
    return result


@app.post("/api/v1/agrodealer/me/location/revoke")
def post_dealer_location_revoke(request: Request) -> dict[str, object]:
    dealer_user_id = require_dealer_session(request)
    try:
        profile = revoke_dealer_location(dealer_user_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if profile is None:
        raise HTTPException(status_code=404, detail="Dealer profile not found.")
    return profile


@app.post("/api/v1/agrodealer/me/products/{product_id}/archive")
def post_archive_dealer_product(
    request: Request, product_id: str, payload: DealerProductArchiveRequest
) -> dict[str, object]:
    dealer_user_id = require_dealer_session(request)
    try:
        result = archive_dealer_product(
            dealer_user_id, product_id=product_id, is_listed=payload.is_listed
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Product not found.")
    return result


@app.delete("/api/v1/agrodealer/me/products/{product_id}")
def delete_dealer_product_endpoint(request: Request, product_id: str) -> dict[str, object]:
    dealer_user_id = require_dealer_session(request)
    try:
        deleted = delete_dealer_product(dealer_user_id, product_id=product_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Product not found.")
    return {"status": "deleted", "productId": product_id}


@app.get("/api/v1/agrodealer/me/orders")
def get_dealer_orders(request: Request) -> list[dict[str, object]]:
    dealer_user_id = require_dealer_session(request)
    try:
        return load_dealer_orders(dealer_user_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.patch("/api/v1/agrodealer/me/orders/{order_id}")
def patch_dealer_order(
    request: Request, order_id: str, payload: MarketplaceOrderStatusUpdateRequest
) -> dict[str, object]:
    user_id = require_authenticated_user(request)
    try:
        updated = update_marketplace_order_status(
            user_id=user_id,
            order_id=order_id,
            status=payload.status,
            cancellation_reason=payload.cancellation_reason,
            dispute_reason=payload.dispute_reason,
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if updated is None:
        raise HTTPException(status_code=404, detail="Order not found or unauthorized.")
    return updated


@app.post("/api/v1/marketplace/orders", status_code=201)
def post_marketplace_order(
    request: Request, payload: MarketplaceOrderCreateRequest
) -> dict[str, object]:
    buyer_user_id = require_authenticated_user(request)
    try:
        return create_marketplace_order(
            buyer_user_id=buyer_user_id,
            product_id=str(payload.product_id),
            quantity=payload.quantity,
            fulfillment_type=payload.fulfillment_type,
            terms_accepted=payload.terms_accepted,
            notes=payload.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/v1/agrodealer/search")
def get_agrodealer_search(
    latitude: float | None = None,
    longitude: float | None = None,
    radiusKm: float = Query(25.0, ge=1.0, le=500.0),
    county: str | None = None,
    ward: str | None = None,
) -> dict[str, object]:
    try:
        return search_dealers_proximity(
            latitude=latitude,
            longitude=longitude,
            radius_km=radiusKm,
            county=county,
            ward=ward,
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


# ---------------------------------------------------------------------------
# Admin endpoints – least-privilege, audited
# ---------------------------------------------------------------------------


@app.get("/api/v1/admin/permissions")
def get_admin_permissions(request: Request) -> list[dict[str, object]]:
    admin_user_id = require_admin_session(request)
    try:
        return load_admin_permissions(admin_user_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/v1/admin/overview")
def get_admin_overview(request: Request) -> dict[str, object]:
    admin_user_id = require_admin_session(request)
    try:
        return load_admin_system_overview(admin_user_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/api/v1/admin/users")
def get_admin_users(
    request: Request,
    role: str | None = Query(default=None),
    approval_status: str | None = Query(default=None),
    search: str | None = Query(default=None),
) -> list[dict[str, object]]:
    admin_user_id = require_admin_session(request)
    try:
        if role or approval_status or search:
            users = admin_list_users(
                admin_user_id,
                role=role,
                approval_status=approval_status,
                search=search,
            )
        else:
            users = admin_list_users(admin_user_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if users is None:
        raise HTTPException(status_code=403, detail="manage_accounts permission is required.")
    return users



@app.post("/api/v1/admin/users/{user_id}/approve")
def post_admin_user_approve(
    request: Request, user_id: str, payload: AdminUserApproveRequest | None = None
) -> dict[str, object]:
    admin_user_id = require_admin_session(request)
    notes = payload.notes if payload else None
    try:
        result = admin_approve_user(admin_user_id, user_id, notes=notes)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=403, detail="manage_accounts permission is required or user not found.")
    try:
        create_admin_audit_entry(
            actor_user_id=admin_user_id,
            actor_role="admin",
            action="approve_user",
            target_type="user",
            target_id=user_id,
            detail={"notes": notes},
            ip_address=get_client_ip(request),
        )
    except DatabaseUnavailable:
        pass
    return result


@app.post("/api/v1/admin/users/{user_id}/revoke")
def post_admin_user_revoke(
    request: Request, user_id: str, payload: AdminUserRevokeRequest
) -> dict[str, object]:
    admin_user_id = require_admin_session(request)
    try:
        result = admin_revoke_user(
            admin_user_id, user_id, reason=payload.reason, revoke_role=payload.revoke_role
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=403, detail="manage_accounts permission is required or user not found.")
    try:
        create_admin_audit_entry(
            actor_user_id=admin_user_id,
            actor_role="admin",
            action="revoke_user",
            target_type="user",
            target_id=user_id,
            detail={"reason": payload.reason, "revoke_role": payload.revoke_role},
            ip_address=get_client_ip(request),
        )
    except DatabaseUnavailable:
        pass
    return result


@app.delete("/api/v1/admin/users/{user_id}")
def delete_admin_user(
    request: Request, user_id: str, payload: AdminUserDeleteRequest
) -> dict[str, object]:
    admin_user_id = require_admin_session(request)
    try:
        result = admin_delete_user(
            admin_user_id=admin_user_id,
            target_user_id=user_id,
            confirmation_email=payload.confirmation_email,
        )
    except AccountDeletionConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SupabaseIdentityUnavailableError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "The account was disabled, but its authentication identity could not be "
                f"deleted. Retry account deletion to finish cleanup. {exc}"
            ),
        ) from exc
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(
            status_code=403,
            detail="manage_accounts permission is required or user not found.",
        )
    return result


@app.patch("/api/v1/admin/users/{user_id}/role")
def patch_admin_user_role(
    request: Request, user_id: str, payload: AdminRoleUpdateRequest
) -> dict[str, object]:
    admin_user_id = require_admin_session(request)
    try:
        result = admin_update_user_role(admin_user_id, user_id, payload.role)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=403, detail="manage_roles permission is required or user not found.")
    try:
        create_admin_audit_entry(
            actor_user_id=admin_user_id,
            actor_role="admin",
            action="update_user_role",
            target_type="user",
            target_id=user_id,
            detail={"new_role": payload.role},
            ip_address=get_client_ip(request),
        )
    except DatabaseUnavailable:
        pass  # Audit failure must not block the operation
    return result


@app.patch("/api/v1/admin/users/{user_id}/active")
def patch_admin_user_active(
    request: Request, user_id: str, payload: AdminUserActiveRequest
) -> dict[str, object]:
    admin_user_id = require_admin_session(request)
    try:
        result = admin_toggle_user_active(admin_user_id, user_id, payload.is_active)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=403, detail="manage_accounts permission is required or user not found.")
    try:
        create_admin_audit_entry(
            actor_user_id=admin_user_id,
            actor_role="admin",
            action="toggle_user_active",
            target_type="user",
            target_id=user_id,
            detail={"is_active": payload.is_active},
            ip_address=get_client_ip(request),
        )
    except DatabaseUnavailable:
        pass
    return result


@app.post("/api/v1/admin/officer-assignments", status_code=201)
def create_officer_assignment(
    request: Request, payload: AdminOfficerAssignmentRequest
) -> dict[str, object]:
    admin_user_id = require_admin_session(request)
    try:
        result = admin_manage_officer_assignment(
            admin_user_id=admin_user_id,
            officer_user_id=payload.officer_user_id,
            county=payload.county,
            sub_county=payload.sub_county,
            ward=payload.ward,
            is_active=payload.is_active,
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(
            status_code=403,
            detail="manage_officer_assignments permission is required or officer not found.",
        )
    try:
        create_admin_audit_entry(
            actor_user_id=admin_user_id,
            actor_role="admin",
            action="manage_officer_assignment",
            target_type="officer_jurisdiction",
            target_id=result["assignmentId"],
            detail={
                "officer_user_id": payload.officer_user_id,
                "county": payload.county,
                "sub_county": payload.sub_county,
                "ward": payload.ward,
                "is_active": payload.is_active,
            },
            ip_address=get_client_ip(request),
        )
    except DatabaseUnavailable:
        pass
    return result


@app.post("/api/v1/admin/officers/invite", status_code=201, response_model=AdminOfficerInviteResponse)
def invite_officer_endpoint(
    request: Request, payload: AdminOfficerInviteRequest
) -> AdminOfficerInviteResponse:
    admin_user_id = require_admin_session(request)
    try:
        authorized = check_admin_permission(admin_user_id, "manage_officer_assignments")
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not authorized:
        raise HTTPException(
            status_code=403,
            detail="manage_officer_assignments permission is required.",
        )
    try:
        invitation = invite_user_by_email(str(payload.email))
    except SupabaseInvitationConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SupabaseIdentityUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    try:
        result = admin_invite_officer(
            admin_user_id=admin_user_id,
            auth_user_id=invitation["id"],
            email=str(payload.email),
            designation=payload.designation,
            county=payload.county,
            sub_county=payload.sub_county,
            ward=payload.ward,
            display_name=payload.display_name,
        )
    except AccountProvisioningConflict as exc:
        try:
            delete_supabase_user(invitation["id"])
        except SupabaseIdentityUnavailableError as cleanup_error:
            raise HTTPException(
                status_code=503,
                detail=f"{exc} The Supabase invitation could not be rolled back: {cleanup_error}",
            ) from cleanup_error
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except DatabaseUnavailable as exc:
        try:
            delete_supabase_user(invitation["id"])
        except SupabaseIdentityUnavailableError as cleanup_error:
            raise HTTPException(
                status_code=503,
                detail=f"{exc} The Supabase invitation could not be rolled back: {cleanup_error}",
            ) from cleanup_error
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if result is None:
        try:
            delete_supabase_user(invitation["id"])
        except SupabaseIdentityUnavailableError as cleanup_error:
            raise HTTPException(
                status_code=503,
                detail=f"Invitation provisioning was denied and the Auth invite could not be rolled back: {cleanup_error}",
            ) from cleanup_error
        raise HTTPException(
            status_code=403,
            detail="manage_officer_assignments permission is required.",
        )

    try:
        create_admin_audit_entry(
            actor_user_id=admin_user_id,
            actor_role="admin",
            action="invite_extension_officer",
            target_type="officer_jurisdiction",
            target_id=str(result.get("assignmentId", "")),
            detail={
                "email": str(payload.email),
                "designation": payload.designation,
                "county": payload.county,
                "sub_county": payload.sub_county,
                "ward": payload.ward,
                "officer_user_id": result.get("officerUserId"),
            },
            ip_address=get_client_ip(request),
        )
    except DatabaseUnavailable:
        pass
    return AdminOfficerInviteResponse(**result)


@app.post(
    "/api/v1/admin/agrodealer/invite",
    status_code=201,
    response_model=AdminAgrodealerInviteResponse,
)
def invite_agrodealer_endpoint(
    request: Request, payload: AdminAgrodealerInviteRequest
) -> AdminAgrodealerInviteResponse:
    admin_user_id = require_admin_session(request)
    try:
        authorized = check_admin_permission(admin_user_id, "manage_accounts")
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not authorized:
        raise HTTPException(status_code=403, detail="manage_accounts permission is required.")

    try:
        invitation = invite_user_by_email(str(payload.email))
    except SupabaseInvitationConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SupabaseIdentityUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    try:
        result = admin_invite_agrodealer(
            admin_user_id=admin_user_id,
            auth_user_id=invitation["id"],
            email=str(payload.email),
            display_name=payload.display_name,
            business_name=payload.business_name,
            county=payload.county,
            sub_county=payload.sub_county,
            ward=payload.ward,
        )
    except AccountProvisioningConflict as exc:
        try:
            delete_supabase_user(invitation["id"])
        except SupabaseIdentityUnavailableError as cleanup_error:
            raise HTTPException(
                status_code=503,
                detail=f"{exc} The Supabase invitation could not be rolled back: {cleanup_error}",
            ) from cleanup_error
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except DatabaseUnavailable as exc:
        try:
            delete_supabase_user(invitation["id"])
        except SupabaseIdentityUnavailableError as cleanup_error:
            raise HTTPException(
                status_code=503,
                detail=f"{exc} The Supabase invitation could not be rolled back: {cleanup_error}",
            ) from cleanup_error
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if result is None:
        try:
            delete_supabase_user(invitation["id"])
        except SupabaseIdentityUnavailableError as cleanup_error:
            raise HTTPException(
                status_code=503,
                detail=f"Invitation provisioning was denied and the Auth invite could not be rolled back: {cleanup_error}",
            ) from cleanup_error
        raise HTTPException(status_code=403, detail="manage_accounts permission is required.")

    try:
        create_admin_audit_entry(
            actor_user_id=admin_user_id,
            actor_role="admin",
            action="invite_agrodealer",
            target_type="user",
            target_id=str(result["dealerUserId"]),
            detail={
                "email": str(payload.email),
                "business_name": payload.business_name,
                "county": payload.county,
                "sub_county": payload.sub_county,
                "ward": payload.ward,
                "auth_user_id": invitation["id"],
            },
            ip_address=get_client_ip(request),
        )
    except DatabaseUnavailable:
        pass
    return AdminAgrodealerInviteResponse(**result)


@app.post(
    "/api/v1/admin/agronomists/invite",
    status_code=201,
    response_model=AdminAgronomistInviteResponse,
)
def invite_agronomist_endpoint(
    request: Request, payload: AdminAgronomistInviteRequest
) -> AdminAgronomistInviteResponse:
    admin_user_id = require_admin_session(request)
    try:
        authorized = check_admin_permission(admin_user_id, "manage_accounts")
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if not authorized:
        raise HTTPException(status_code=403, detail="manage_accounts permission is required.")

    try:
        invitation = invite_user_by_email(str(payload.email))
    except SupabaseInvitationConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SupabaseIdentityUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    try:
        result = admin_invite_agronomist(
            admin_user_id=admin_user_id,
            auth_user_id=invitation["id"],
            email=str(payload.email),
            display_name=payload.display_name,
            licence_number=payload.licence_number,
            county=payload.county,
            approval_status=payload.approval_status,
        )
    except AccountProvisioningConflict as exc:
        try:
            delete_supabase_user(invitation["id"])
        except SupabaseIdentityUnavailableError as cleanup_error:
            raise HTTPException(
                status_code=503,
                detail=f"{exc} The Supabase invitation could not be rolled back: {cleanup_error}",
            ) from cleanup_error
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except DatabaseUnavailable as exc:
        try:
            delete_supabase_user(invitation["id"])
        except SupabaseIdentityUnavailableError as cleanup_error:
            raise HTTPException(
                status_code=503,
                detail=f"{exc} The Supabase invitation could not be rolled back: {cleanup_error}",
            ) from cleanup_error
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if result is None:
        try:
            delete_supabase_user(invitation["id"])
        except SupabaseIdentityUnavailableError as cleanup_error:
            raise HTTPException(
                status_code=503,
                detail=f"Invitation provisioning was denied and the Auth invite could not be rolled back: {cleanup_error}",
            ) from cleanup_error
        raise HTTPException(status_code=403, detail="manage_accounts permission is required.")

    try:
        create_admin_audit_entry(
            actor_user_id=admin_user_id,
            actor_role="admin",
            action="invite_agronomist",
            target_type="user",
            target_id=str(result["agronomistUserId"]),
            detail={
                "email": str(payload.email),
                "licence_number": payload.licence_number,
                "county": payload.county,
                "approval_status": payload.approval_status,
                "auth_user_id": invitation["id"],
            },
            ip_address=get_client_ip(request),
        )
    except DatabaseUnavailable:
        pass
    return AdminAgronomistInviteResponse(**result)


@app.patch("/api/v1/admin/agronomists/{agronomist_id}/approval")
def approve_agronomist_endpoint(
    request: Request, agronomist_id: str, payload: AdminAgronomistApprovalRequest
) -> dict[str, object]:
    admin_user_id = require_admin_session(request)
    try:
        result = admin_approve_agronomist(
            admin_user_id=admin_user_id,
            agronomist_user_id=agronomist_id,
            approval_status=payload.approval_status,
            notes=payload.notes,
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Agronomist profile not found or permission denied.")
    return result


@app.post(
    "/api/v1/officer/farmers/register-unclaimed",
    status_code=201,
    response_model=OfficerRegisterFarmerResponse,
)
def register_unclaimed_farmer_endpoint(
    request: Request, payload: OfficerRegisterFarmerRequest
) -> OfficerRegisterFarmerResponse:
    officer_user_id = require_officer_session(request)
    try:
        invitation = invite_user_by_email(str(payload.email))
    except SupabaseInvitationConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except SupabaseIdentityUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    try:
        result = officer_register_unclaimed_farmer(
            officer_user_id=officer_user_id,
            auth_user_id=invitation["id"],
            email=str(payload.email),
            full_name=payload.full_name,
            farm_name=payload.farm_name,
            county=payload.county,
            sub_county=payload.sub_county,
            ward=payload.ward,
            size_acres=payload.size_acres,
            crops=payload.crops,
        )
    except AccountProvisioningConflict as exc:
        try:
            delete_supabase_user(invitation["id"])
        except SupabaseIdentityUnavailableError as cleanup_error:
            raise HTTPException(
                status_code=503,
                detail=f"{exc} The Supabase invitation could not be rolled back: {cleanup_error}",
            ) from cleanup_error
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except DatabaseUnavailable as exc:
        try:
            delete_supabase_user(invitation["id"])
        except SupabaseIdentityUnavailableError as cleanup_error:
            raise HTTPException(
                status_code=503,
                detail=f"{exc} The Supabase invitation could not be rolled back: {cleanup_error}",
            ) from cleanup_error
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if result is None:
        try:
            delete_supabase_user(invitation["id"])
        except SupabaseIdentityUnavailableError as cleanup_error:
            raise HTTPException(
                status_code=503,
                detail=f"Registration failed and the Auth invite could not be rolled back: {cleanup_error}",
            ) from cleanup_error
        raise HTTPException(status_code=403, detail="Officer session or jurisdiction invalid.")
    return OfficerRegisterFarmerResponse(**result)


@app.get(
    "/api/v1/officer/unclaimed-farmers",
    response_model=list[UnclaimedFarmerAccountResponse],
)
def get_officer_unclaimed_farmers_endpoint(
    request: Request,
) -> list[UnclaimedFarmerAccountResponse]:
    officer_user_id = require_officer_session(request)
    try:
        farmers = load_officer_unclaimed_farmers(officer_user_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return [UnclaimedFarmerAccountResponse(**farmer) for farmer in farmers]


@app.post(
    "/api/v1/jobs/unclaimed-reminders",
    response_model=UnclaimedReminderBatchResponse,
)
def trigger_unclaimed_reminders_job(
    request: Request,
) -> UnclaimedReminderBatchResponse:
    require_unclaimed_lifecycle_job_access(request)
    try:
        result = process_unclaimed_farmer_reminders()
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return UnclaimedReminderBatchResponse(**result)


@app.post(
    "/api/v1/jobs/unclaimed-cleanup",
    response_model=UnclaimedCleanupBatchResponse,
)
def trigger_unclaimed_cleanup_job(
    request: Request,
) -> UnclaimedCleanupBatchResponse:
    require_unclaimed_lifecycle_job_access(request)
    try:
        result = process_unclaimed_farmer_cleanup()
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return UnclaimedCleanupBatchResponse(**result)


@app.post(
    "/api/v1/admin/invitations/{auth_user_id}/resend",
    response_model=InvitationActionResponse,
)
def resend_invitation_endpoint(
    request: Request, auth_user_id: str
) -> InvitationActionResponse:
    admin_user_id = require_admin_session(request)
    try:
        result = resend_account_invitation(admin_user_id, auth_user_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Pending invitation not found.")
    return InvitationActionResponse(**result)


@app.post(
    "/api/v1/admin/invitations/{auth_user_id}/cancel",
    response_model=InvitationActionResponse,
)
def cancel_invitation_endpoint(
    request: Request, auth_user_id: str
) -> InvitationActionResponse:
    admin_user_id = require_admin_session(request)
    try:
        result = cancel_account_invitation(admin_user_id, auth_user_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=404, detail="Pending invitation not found.")
    return InvitationActionResponse(**result)


@app.get("/api/v1/admin/operational-health")
def get_admin_operational_health(request: Request) -> dict[str, object]:
    admin_user_id = require_admin_session(request)
    try:
        return load_admin_operational_health(admin_user_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/v1/admin/support-access/grants", status_code=201)
def post_support_access_grant(
    request: Request, payload: AdminSupportGrantRequest
) -> dict[str, object]:
    admin_user_id = require_admin_session(request)
    try:
        grant = create_support_access_grant(
            admin_user_id=admin_user_id,
            target_type=payload.target_type,
            target_id=payload.target_id,
            reason=payload.reason,
            duration_minutes=payload.duration_minutes,
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if grant is None:
        raise HTTPException(status_code=403, detail="support_access permission is required.")
    try:
        create_admin_audit_entry(
            actor_user_id=admin_user_id,
            actor_role="admin",
            action="grant_support_access",
            target_type=payload.target_type,
            target_id=payload.target_id,
            detail={
                "grant_id": grant["grantId"],
                "reason": payload.reason,
                "duration_minutes": payload.duration_minutes,
                "expires_at": grant["expiresAt"],
            },
            ip_address=get_client_ip(request),
        )
    except DatabaseUnavailable:
        pass
    return grant


@app.get("/api/v1/admin/support-access/grants")
def get_support_access_grants(
    request: Request, active_only: bool = Query(default=False)
) -> list[dict[str, object]]:
    admin_user_id = require_admin_session(request)
    try:
        return load_support_access_grants(admin_user_id, active_only=active_only)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/v1/admin/support-access/grants/{grant_id}/revoke")
def post_revoke_support_access_grant(
    request: Request, grant_id: str, payload: AdminSupportRevokeRequest
) -> dict[str, object]:
    admin_user_id = require_admin_session(request)
    try:
        result = revoke_support_access_grant(
            admin_user_id=admin_user_id, grant_id=grant_id, reason=payload.revocation_reason
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(status_code=403, detail="support_access permission is required or grant not found.")
    try:
        create_admin_audit_entry(
            actor_user_id=admin_user_id,
            actor_role="admin",
            action="revoke_support_access",
            target_type=result.get("targetType"),
            target_id=result.get("targetId"),
            detail={"grant_id": grant_id, "reason": payload.revocation_reason},
            ip_address=get_client_ip(request),
        )
    except DatabaseUnavailable:
        pass
    return result


@app.get("/api/v1/admin/support-access/records/{target_type}/{target_id}")
def get_sensitive_record_under_support_grant(
    request: Request,
    target_type: str,
    target_id: str,
    grant_id: str | None = Query(default=None),
) -> dict[str, object]:
    admin_user_id = require_admin_session(request)
    try:
        record_access = access_sensitive_record_under_grant(
            admin_user_id=admin_user_id,
            target_type=target_type,
            target_id=target_id,
            grant_id=grant_id,
        )
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if record_access is None:
        raise HTTPException(
            status_code=403,
            detail="Active, unexpired support access grant is required to view this sensitive record.",
        )
    try:
        create_admin_audit_entry(
            actor_user_id=admin_user_id,
            actor_role="admin",
            action="access_sensitive_record",
            target_type=target_type,
            target_id=target_id,
            detail={"grant_id": record_access["grantId"], "reason": record_access["accessReason"]},
            ip_address=get_client_ip(request),
        )
    except DatabaseUnavailable:
        pass
    return record_access


@app.get("/api/v1/admin/settings")
def get_admin_settings(request: Request) -> list[dict[str, object]]:
    admin_user_id = require_admin_session(request)
    try:
        return load_system_settings(admin_user_id)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.put("/api/v1/admin/settings/{key:path}")
def put_admin_setting(
    request: Request, key: str, payload: AdminSettingUpdateRequest
) -> dict[str, object]:
    admin_user_id = require_admin_session(request)
    try:
        result = update_system_setting(admin_user_id=admin_user_id, key=key, value=payload.value)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if result is None:
        raise HTTPException(
            status_code=403,
            detail="manage_settings permission is required or setting is read-only / not found.",
        )
    try:
        create_admin_audit_entry(
            actor_user_id=admin_user_id,
            actor_role="admin",
            action="update_system_setting",
            target_type="system_setting",
            target_id=key,
            detail={"new_value": payload.value, "change_reason": payload.change_reason},
            ip_address=get_client_ip(request),
        )
    except DatabaseUnavailable:
        pass
    return result


@app.get("/api/v1/admin/audit-log")
def get_admin_audit_log(
    request: Request, limit: int = Query(default=50, ge=1, le=200)
) -> list[dict[str, object]]:
    admin_user_id = require_admin_session(request)
    try:
        entries = load_admin_audit_log(admin_user_id, limit=limit)
    except DatabaseUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return entries



@app.post("/api/v1/soil-readings/preview", response_model=SoilReading)
def preview_soil_reading(payload: SoilReadingPreviewRequest) -> SoilReading:
    return SoilReading(
        contract_version=1,
        reading_id=payload.reading_id,
        farm_id=payload.farm_id,
        source=payload.source
        or {
            "provider": "DEMO",
            "dataset_id": "preview-request",
            "record_id": payload.reading_id,
            "license": None,
            "attribution": "Preview generated from a validated client payload.",
            "retrieved_at": None,
        },
        sample=payload.sample
        or {
            "sampled_at": None,
            "sample_year": None,
            "depth": {"source_label": "preview input", "top_cm": None, "bottom_cm": None},
        },
        location=payload.location
        or {
            "latitude": None,
            "longitude": None,
            "uncertainty_m": None,
        },
        measurements=[
            {
                "analyte": item.analyte,
                "value": item.value,
                "source_unit": item.source_unit,
                "canonical_unit": item.canonical_unit,
                "analytical_method": item.analytical_method,
                "quality_status": item.quality_status,
                "uncertainty": None,
            }
            for item in payload.measurements
        ],
    )