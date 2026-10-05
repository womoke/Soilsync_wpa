from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class ContractModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )


SoilDataProvider = Literal[
    "PROJECT_SOIL_DATASET",
    "ISRIC_WOSIS",
    "ISRIC_SOILGRIDS",
    "FARMER_OBSERVATION",
    "OFFICER_FIELD_COLLECTION",
    "DEMO",
]
SoilAnalyte = Literal[
    "soil_ph",
    "total_nitrogen",
    "organic_carbon",
    "olsen_phosphorus",
    "exchangeable_potassium",
]
SoilMeasurementQuality = Literal[
    "valid",
    "missing",
    "invalid_source_value",
    "unsupported_depth_or_method",
    "estimated",
    "sample",
]


class SoilLocation(ContractModel):
    latitude: float | None
    longitude: float | None
    uncertainty_m: float | None


class SoilDepth(ContractModel):
    source_label: str | None
    top_cm: float | None
    bottom_cm: float | None


class SoilSample(ContractModel):
    sampled_at: datetime | None
    sample_year: int | None
    depth: SoilDepth


class SoilSource(ContractModel):
    provider: SoilDataProvider
    dataset_id: str | None
    record_id: str | None
    license: str | None
    attribution: str | None
    retrieved_at: datetime | None


class MeasurementUncertainty(ContractModel):
    interval_level: float
    lower: float | None
    upper: float | None


class SoilMeasurement(ContractModel):
    analyte: SoilAnalyte
    value: float | None
    source_unit: str
    canonical_unit: str | None
    analytical_method: str | None
    quality_status: SoilMeasurementQuality
    uncertainty: MeasurementUncertainty | None


class SoilReading(ContractModel):
    contract_version: Literal[1]
    reading_id: str
    farm_id: str | None
    source: SoilSource
    sample: SoilSample
    location: SoilLocation
    measurements: list[SoilMeasurement]


class SoilRecommendation(ContractModel):
    recommendation_id: str
    farm_id: str | None
    crop: str | None
    title: str
    rationale: str
    application_rate: float | None
    application_unit: str | None
    rule_version: str | None
    review_status: Literal["pending_review", "approved"]


class SoilReadingPreviewMeasurement(ContractModel):
    analyte: SoilAnalyte
    value: float | None
    source_unit: str = "unknown"
    canonical_unit: str | None = None
    analytical_method: str | None = None
    quality_status: SoilMeasurementQuality = "sample"


class SoilReadingPreviewRequest(ContractModel):
    reading_id: str
    farm_id: str | None = None
    source: SoilSource | None = None
    sample: SoilSample | None = None
    location: SoilLocation | None = None
    measurements: list[SoilReadingPreviewMeasurement]


class FarmerFarmCreateRequest(ContractModel):
    name: str = Field(min_length=1, max_length=200)
    county: str | None = Field(default=None, max_length=120)
    sub_county: str | None = Field(default=None, max_length=120)
    ward: str | None = Field(default=None, max_length=120)
    size_acres: float | None = Field(default=None, ge=0)
    crops: str | None = Field(default=None, max_length=300)


class OfficerFieldCollectionRequest(ContractModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    location_uncertainty_m: float | None = Field(default=None, ge=0)
    sampled_at: datetime | None = None
    top_cm: float = Field(default=0, ge=0, le=500)
    bottom_cm: float = Field(default=20, ge=0, le=500)
    measurements: list["FarmerSoilMeasurementInput"] = Field(min_length=1)
    notes: str | None = Field(default=None, max_length=1000)
    mark_completed: bool = True


class FarmerSoilMeasurementInput(ContractModel):
    analyte: SoilAnalyte
    source_analyte: str | None = Field(default=None, max_length=120)
    value: float | None = None
    source_value_text: str | None = Field(default=None, max_length=200)
    source_unit: str = Field(min_length=1, max_length=80)
    canonical_unit: str | None = Field(default=None, max_length=80)
    analytical_method: str | None = Field(default=None, max_length=120)
    quality_status: SoilMeasurementQuality = "sample"
    source_quality_class: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def validate_quality_value(self) -> "FarmerSoilMeasurementInput":
        if self.quality_status == "valid" and self.value is None:
            raise ValueError("A valid measurement requires a numeric value.")
        if self.quality_status == "invalid_source_value" and (
            self.value is not None or self.source_value_text is None
        ):
            raise ValueError("An invalid source value requires its raw token and no numeric value.")
        return self


class FarmerSoilReadingCreateRequest(ContractModel):
    sampled_at: datetime | None = None
    source_label: str | None = Field(default=None, max_length=200)
    top_cm: float | None = Field(default=None, ge=0, le=500)
    bottom_cm: float | None = Field(default=None, ge=0, le=500)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    location_uncertainty_m: float | None = Field(default=None, ge=0)
    measurements: list[FarmerSoilMeasurementInput] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_reading(self) -> "FarmerSoilReadingCreateRequest":
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Latitude and longitude must be supplied together.")
        if self.top_cm is not None and self.bottom_cm is not None and self.top_cm > self.bottom_cm:
            raise ValueError("Sample top depth must not exceed bottom depth.")
        analytes = [measurement.analyte for measurement in self.measurements]
        if len(analytes) != len(set(analytes)):
            raise ValueError("Each analyte may be submitted only once per reading.")
        return self


class RecommendationFeedbackRequest(ContractModel):
    response: Literal["viewed", "followed", "modified", "not-followed"]


class SyncDraftCreateRequest(ContractModel):
    draft_type: str = Field(default="soil-reading", min_length=1, max_length=80)
    client_draft_id: UUID | None = None
    version: int | None = Field(default=None, ge=1)
    payload: dict[str, Any] = Field(default_factory=dict)


class SyncDraftSubmitRequest(ContractModel):
    draft_id: UUID
    payload: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Dealer request models
# ---------------------------------------------------------------------------


class DealerProfileUpdateRequest(ContractModel):
    business_name: str | None = Field(default=None, min_length=1, max_length=200)
    county: str | None = Field(default=None, max_length=120)
    sub_county: str | None = Field(default=None, max_length=120)
    ward: str | None = Field(default=None, max_length=120)


class UserProfileUpdateRequest(ContractModel):
    full_name: str = Field(min_length=1, max_length=200)
    phone_number: str | None = Field(default=None, pattern=r"^\+254\d{9}$")

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Full name cannot be blank.")
        return normalized


class UserProfileResponse(ContractModel):
    id: str
    full_name: str
    county: str | None = None
    sub_county: str | None = None
    ward: str | None = None
    phone_number: str | None = None


class DealerProductCreateRequest(ContractModel):
    name: str = Field(min_length=1, max_length=200)
    category: Literal["fertilizer", "seeds", "manure", "tools"]
    description: str | None = Field(default=None, max_length=500)
    stock_quantity: int = Field(ge=0)
    stock_unit: str = Field(min_length=1, max_length=50)
    unit_price: float | None = Field(default=None, ge=0)
    currency: str = Field(default="KES", pattern=r"^[A-Z]{3}$")


class DealerProductUpdateRequest(ContractModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    unit_price: float | None = Field(default=None, ge=0)
    is_listed: bool | None = None


class DealerStockUpdateRequest(ContractModel):
    stock_quantity: int = Field(ge=0)


class DealerLocationConsentRequest(ContractModel):
    consent_granted: bool
    consent_notes: str | None = Field(default=None, max_length=500)


class DealerCoordinatesUpdateRequest(ContractModel):
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)
    accuracy_meters: float | None = Field(default=None, ge=0)


class DealerProductArchiveRequest(ContractModel):
    is_listed: bool


class MarketplaceOrderCreateRequest(ContractModel):
    product_id: UUID
    quantity: int = Field(gt=0)
    fulfillment_type: Literal["pickup", "delivery"] = "pickup"
    terms_accepted: bool
    notes: str | None = Field(default=None, max_length=500)


class MarketplaceOrderStatusUpdateRequest(ContractModel):
    status: Literal["pending_confirmation", "confirmed", "fulfilled", "cancelled", "disputed"]
    cancellation_reason: str | None = Field(default=None, max_length=500)
    dispute_reason: str | None = Field(default=None, max_length=500)


# ---------------------------------------------------------------------------
# Admin request models
# ---------------------------------------------------------------------------


class AdminRoleUpdateRequest(ContractModel):
    role: Literal["farmer", "extension_officer", "agrodealer", "admin", "agronomist"]


class AdminAgronomistInviteRequest(ContractModel):
    email: str = Field(min_length=3, max_length=255)
    display_name: str = Field(min_length=1, max_length=200)
    licence_number: str = Field(min_length=2, max_length=100)
    county: str = Field(min_length=1, max_length=120)
    approval_status: Literal["pending", "approved"] = "pending"

    @model_validator(mode="after")
    def validate_email(self) -> "AdminAgronomistInviteRequest":
        if "@" not in self.email or "." not in self.email:
            raise ValueError("A valid email address is required.")
        return self


class AdminAgronomistInviteResponse(ContractModel):
    agronomist_user_id: str
    email: str
    licence_number: str
    county: str
    role: str = "agronomist"
    status: str = "pending"
    approval_status: str
    invited_at: datetime


class AdminAgronomistApprovalRequest(ContractModel):
    approval_status: Literal["approved", "rejected", "suspended"]
    notes: str | None = Field(default=None, max_length=500)


class OfficerRegisterFarmerRequest(ContractModel):
    email: str = Field(min_length=3, max_length=255)
    full_name: str = Field(min_length=1, max_length=200)
    farm_name: str | None = Field(default=None, max_length=200)
    county: str | None = Field(default=None, max_length=120)
    sub_county: str | None = Field(default=None, max_length=120)
    ward: str | None = Field(default=None, max_length=120)
    size_acres: float | None = Field(default=None, ge=0)
    crops: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def validate_email(self) -> "OfficerRegisterFarmerRequest":
        if "@" not in self.email or "." not in self.email:
            raise ValueError("A valid email address is required.")
        return self


class OfficerRegisterFarmerResponse(ContractModel):
    auth_user_id: str
    farmer_user_id: str
    email: str
    full_name: str
    initial_farm_id: str | None = None
    status: str = "unclaimed"
    role: str = "farmer"
    registered_at: datetime
    message: str = "Unclaimed farmer account created. Secure claim invitation sent to email."


class UnclaimedFarmerAccountResponse(ContractModel):
    auth_user_id: str
    farmer_user_id: str
    email: str
    full_name: str
    initial_farm_id: str | None = None
    initial_farm_name: str | None = None
    county: str | None = None
    status: str
    reminder_count: int
    last_reminder_at: datetime | None = None
    created_at: datetime
    days_until_expiration: int


class UnclaimedReminderBatchResponse(ContractModel):
    processed_count: int
    reminders_sent: int
    message: str


class UnclaimedCleanupBatchResponse(ContractModel):
    processed_count: int
    expired_and_deleted: int
    message: str


class InvitationActionResponse(ContractModel):
    auth_user_id: str
    action: Literal["resent", "cancelled"]
    status: str
    message: str


class AdminUserActiveRequest(ContractModel):
    is_active: bool


class AdminOfficerAssignmentRequest(ContractModel):
    officer_user_id: str = Field(min_length=1)
    county: str | None = Field(default=None, max_length=120)
    sub_county: str | None = Field(default=None, max_length=120)
    ward: str | None = Field(default=None, max_length=120)
    is_active: bool = True

    @model_validator(mode="after")
    def validate_jurisdiction(self) -> "AdminOfficerAssignmentRequest":
        if self.county is None and self.sub_county is None and self.ward is None:
            raise ValueError("At least one of county, sub_county, or ward is required.")
        if self.sub_county is not None and self.county is None:
            raise ValueError("sub_county requires county.")
        if self.ward is not None and self.sub_county is None:
            raise ValueError("ward requires sub_county.")
        return self


class AdminOfficerInviteRequest(ContractModel):
    email: str = Field(min_length=3, max_length=255)
    designation: Literal["county", "subcounty", "ward"]
    county: str = Field(min_length=1, max_length=120)
    sub_county: str | None = Field(default=None, max_length=120)
    ward: str | None = Field(default=None, max_length=120)
    display_name: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def validate_designation_and_jurisdiction(self) -> "AdminOfficerInviteRequest":
        if "@" not in self.email or "." not in self.email:
            raise ValueError("A valid email address is required.")
        if self.designation == "subcounty" and not self.sub_county:
            raise ValueError("sub_county is required when designation is 'subcounty'.")
        if self.designation == "ward" and (not self.sub_county or not self.ward):
            raise ValueError("sub_county and ward are required when designation is 'ward'.")
        return self


class AdminOfficerInviteResponse(ContractModel):
    officer_user_id: str
    assignment_id: str
    email: str
    designation: str
    county: str
    sub_county: str | None = None
    ward: str | None = None
    role: str = "extension_officer"
    status: str = "pending"
    invited_at: datetime


class AdminAgrodealerInviteRequest(ContractModel):
    email: str = Field(min_length=3, max_length=255)
    display_name: str = Field(min_length=1, max_length=200)
    business_name: str = Field(min_length=1, max_length=200)
    county: str | None = Field(default=None, max_length=120)
    sub_county: str | None = Field(default=None, max_length=120)
    ward: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def validate_email_and_location(self) -> "AdminAgrodealerInviteRequest":
        if "@" not in self.email or "." not in self.email:
            raise ValueError("A valid email address is required.")
        if self.sub_county and not self.county:
            raise ValueError("county is required when sub_county is provided.")
        if self.ward and not self.sub_county:
            raise ValueError("sub_county is required when ward is provided.")
        return self


class AdminAgrodealerInviteResponse(ContractModel):
    dealer_user_id: str
    email: str
    business_name: str
    role: str = "agrodealer"
    status: str = "pending"
    invited_at: datetime



class AdminUserApproveRequest(ContractModel):
    notes: str | None = Field(default=None, max_length=500)


class AdminUserRevokeRequest(ContractModel):
    reason: str = Field(min_length=5, max_length=500)
    revoke_role: bool = False


class AdminSupportGrantRequest(ContractModel):
    target_type: Literal["farm", "reading", "farmer_profile", "agrodealer_order"]
    target_id: str = Field(min_length=1, max_length=100)
    reason: str = Field(min_length=10, max_length=500)
    duration_minutes: int = Field(default=30, ge=5, le=240)


class AdminSupportRevokeRequest(ContractModel):
    revocation_reason: str = Field(min_length=5, max_length=500)


class AdminSettingUpdateRequest(ContractModel):
    value: Any
    change_reason: str = Field(min_length=5, max_length=500)

# ---------------------------------------------------------------------------

# Extension Officer Visit and Alert models
# ---------------------------------------------------------------------------

class OfficerVisitCreateRequest(ContractModel):
    farmer_id: str = Field(min_length=1)
    farm_id: str | None = None
    planned_date: datetime | None = None
    status: Literal["requested", "claimed", "scheduled", "in_progress", "completed", "cancelled"] = "scheduled"
    notes: str | None = None

class OfficerVisitUpdateRequest(ContractModel):
    planned_date: datetime | None = None
    status: Literal["requested", "claimed", "scheduled", "in_progress", "completed", "cancelled"] | None = None
    notes: str | None = None

class OfficerVisit(ContractModel):
    visit_id: str
    officer_user_id: str | None = None
    farmer_id: str
    farmer_name: str | None = None
    farmer_phone: str | None = None
    farm_id: str | None = None
    farm_name: str | None = None
    county: str | None = None
    sub_county: str | None = None
    ward: str | None = None
    planned_date: datetime | None = None
    status: Literal["requested", "claimed", "scheduled", "in_progress", "completed", "cancelled"]
    notes: str | None = None
    created_at: datetime
    updated_at: datetime

class OfficerAlertCreateRequest(ContractModel):
    farmer_id: str = Field(min_length=1)
    farm_id: str | None = None
    title: str = Field(min_length=1, max_length=200)
    summary: str | None = Field(default=None, max_length=500)
    source: str = Field(min_length=1, max_length=120)
    severity: Literal["info", "warning", "critical"] = "info"
    status: Literal["open", "acknowledged", "resolved"] = "open"
    notes: str | None = None

class OfficerAlertUpdateRequest(ContractModel):
    severity: Literal["info", "warning", "critical"] | None = None
    status: Literal["open", "acknowledged", "resolved"] | None = None
    notes: str | None = None
    resolution_notes: str | None = None

class OfficerAlert(ContractModel):
    alert_id: str
    officer_user_id: str | None = None
    farmer_id: str
    farmer_name: str | None = None
    farm_id: str | None = None
    farm_name: str | None = None
    source: str
    severity: Literal["info", "warning", "critical"]
    status: Literal["open", "acknowledged", "resolved"]
    title: str
    summary: str | None = None
    notes: str | None = None
    resolution_notes: str | None = None
    resolved_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

class OfficerWardSummary(ContractModel):
    county: str
    sub_county: str | None = None
    ward: str
    farmer_count: int
    farm_count: int
    reading_count: int
    sample_count: int
    aggregation_limits: str
    data_freshness: datetime | None = None

class OfficerReportExportRequest(ContractModel):
    county: str | None = None
    sub_county: str | None = None
    ward: str | None = None
    format: Literal["json", "csv"] = "json"

class OfficerReportExportResponse(ContractModel):
    export_id: str
    officer_user_id: str
    scope: dict[str, Any]
    allowlisted_fields: list[str]
    privacy_disclaimer: str
    record_count: int
    exported_at: datetime
    records: list[dict[str, Any]]


class AgrodealerApplicationRequest(ContractModel):
    business_name: str
    licence_number: str
    contact_name: str
    county: str
    sub_county: str | None = None
    ward: str | None = None
    shop_location: str | None = None
    phone_number: str | None = None


class AgrodealerApplicationResponse(ContractModel):
    application_id: str
    user_id: str
    business_name: str
    licence_number: str
    contact_name: str
    county: str
    sub_county: str | None = None
    ward: str | None = None
    shop_location: str | None = None
    phone_number: str | None = None
    role: str = "agrodealer"
    status: str = "pending"
    verification_state: str = "pending"
    message: str = "Agrodealer application submitted successfully and is pending administrator review."
    created_at: datetime


class AssessmentAdjustment(ContractModel):
    section: Literal["diagnosis", "prescription"]
    target: str = Field(min_length=1, max_length=160)
    field: Literal["interpretation", "applicationTiming", "ratePerHa", "ratePerAcre"]
    value: str = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def validate_section_field(self) -> "AssessmentAdjustment":
        if self.section == "diagnosis" and self.field != "interpretation":
            raise ValueError("Diagnosis adjustments may only update their interpretation.")
        if self.section == "prescription" and self.field == "interpretation":
            raise ValueError("Prescription adjustments may only update rates or application timing.")
        return self


class AssessmentEditRequest(ContractModel):
    notes: str = Field(min_length=2, max_length=2000)
    adjustments: list[AssessmentAdjustment] | None = None


class AssessmentPublishRequest(ContractModel):
    license_number: str | None = None
    final_notes: str | None = None

