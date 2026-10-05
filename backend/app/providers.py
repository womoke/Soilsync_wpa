from __future__ import annotations

import json
import re
from functools import lru_cache
from typing import Any, Literal
from urllib.error import URLError
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET

from .models import ContractModel

ProviderStatusValue = Literal["ready", "pending_approval", "not_configured", "not_connected"]
ProviderMode = Literal["DEMO_ONLY", "LIVE"]
SOILGRIDS_WCS_BASE_URL = "https://maps.isric.org/mapserv?map=/map/phh2o.map"
SOILGRIDS_APPROVED_COVERAGES = {
    "phh2o_0-5cm_Q0.5",
    "soc_0-5cm_Q0.5",
    "nitrogen_0-5cm_Q0.5",
}
WOSIS_GRAPHQL_URL = "https://graphql.isric.org/wosis/graphql"
WOSIS_ELIGIBLE_LICENSES = {
    "CC-BY",
    "CC BY",
    "CC-BY-4.0",
    "CC BY 4.0",
    "CC BY 4.0 International",
}


def parse_soilgrids_capabilities(xml_text: str) -> list[str]:
    root = ET.fromstring(xml_text)
    coverage_ids: list[str] = []

    for node in root.iter():
        tag = node.tag.rsplit("}", 1)[-1]
        if tag == "CoverageId":
            value = (node.text or "").strip()
            if value:
                coverage_ids.append(value)

    return coverage_ids


def filter_approved_soilgrids_coverages(coverage_ids: list[str]) -> list[str]:
    return [coverage_id for coverage_id in coverage_ids if coverage_id in SOILGRIDS_APPROVED_COVERAGES]


def get_approved_soilgrids_coverages(xml_text: str) -> list[str]:
    return filter_approved_soilgrids_coverages(parse_soilgrids_capabilities(xml_text))


def build_soilgrids_get_capabilities_url() -> str:
    return f"{SOILGRIDS_WCS_BASE_URL}&service=WCS&version=2.0.1&request=GetCapabilities"


def build_wosis_query(limit: int = 20) -> str:
    return f"""
    query {{
      soilProfiles(first: {limit}) {{
        id
        license
        profileName
        location {{ lat lon }}
        dataset {{ name }}
      }}
    }}
    """.strip()


def normalize_license_value(value: str | None) -> str:
    if value is None:
        return ""
    return re.sub(r"[^A-Za-z0-9]+", " ", value).strip().lower()


def filter_eligible_wosis_records(payload: dict[str, Any]) -> list[dict[str, Any]]:
    records = payload.get("data", {}).get("soilProfiles") or payload.get("data", {}).get("profiles") or []
    eligible: list[dict[str, Any]] = []

    for record in records:
        if not isinstance(record, dict):
            continue
        license_text = normalize_license_value(str(record.get("license") or ""))
        if ("cc by" in license_text or "cc-by" in license_text) and "nc" not in license_text and "nd" not in license_text:
            eligible.append(record)

    return eligible


@lru_cache(maxsize=32)
def fetch_wosis_records(limit: int = 20) -> list[dict[str, Any]]:
    body = json.dumps({"query": build_wosis_query(limit=limit)}).encode("utf-8")
    request = Request(
        WOSIS_GRAPHQL_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "SoilSync/0.2.0",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
    except (OSError, TimeoutError, URLError, json.JSONDecodeError):
        return []

    return filter_eligible_wosis_records(payload)


def get_wosis_provider_summary() -> dict[str, object]:
    try:
        eligible_records = fetch_wosis_records(limit=20)
    except (OSError, TimeoutError, URLError, json.JSONDecodeError):
        eligible_records = []

    return {
        "provider": "ISRIC_WOSIS",
        "status": "pending_approval",
        "ready": False,
        "estimated": False,
        "eligibleRecords": [record.get("id") for record in eligible_records if isinstance(record, dict)],
        "note": "Reachability confirmed; license validation and eligible-profile filtering remain pending approval.",
    }


def build_soilgrids_get_coverage_url(
    coverage_id: str,
    bbox: tuple[float, float, float, float],
    width: int = 256,
    height: int = 256,
    crs: str = "EPSG:4326",
    output_format: str = "image/tiff",
) -> str:
    min_x, min_y, max_x, max_y = bbox
    return (
        f"{SOILGRIDS_WCS_BASE_URL}&service=WCS&version=2.0.1&request=GetCoverage"
        f"&coverageId={coverage_id}&subset=Long({min_x},{max_x})&subset=Lat({min_y},{max_y})"
        f"&format={output_format}&outputCrs={crs}&width={width}&height={height}"
    )


@lru_cache(maxsize=32)
def fetch_soilgrids_capabilities() -> list[str]:
    request = Request(
        build_soilgrids_get_capabilities_url(),
        headers={"User-Agent": "SoilSync/0.2.0"},
    )
    with urlopen(request, timeout=30) as response:
        xml_text = response.read().decode("utf-8", errors="replace")

    return get_approved_soilgrids_coverages(xml_text)


def validate_soilgrids_coverage_id(coverage_id: str) -> str:
    normalized = (coverage_id or "").strip()
    if normalized not in SOILGRIDS_APPROVED_COVERAGES:
        raise ValueError(f"Coverage {coverage_id!r} is not approved for use in the current SoilGrids provider configuration.")
    return normalized


def build_soilgrids_bbox_for_point(latitude: float, longitude: float, radius_deg: float = 0.01) -> tuple[float, float, float, float]:
    if not -90 <= latitude <= 90:
        raise ValueError("Latitude must be between -90 and 90 degrees.")
    if not -180 <= longitude <= 180:
        raise ValueError("Longitude must be between -180 and 180 degrees.")

    min_x = max(-180.0, longitude - radius_deg)
    max_x = min(180.0, longitude + radius_deg)
    min_y = max(-90.0, latitude - radius_deg)
    max_y = min(90.0, latitude + radius_deg)
    return (min_x, min_y, max_x, max_y)


def fetch_soilgrids_coverage(
    coverage_id: str,
    bbox: tuple[float, float, float, float],
    *,
    width: int = 32,
    height: int = 32,
    crs: str = "EPSG:4326",
    output_format: str = "image/tiff",
) -> dict[str, object]:
    validated_coverage_id = validate_soilgrids_coverage_id(coverage_id)
    request = Request(
        build_soilgrids_get_coverage_url(validated_coverage_id, bbox, width=width, height=height, crs=crs, output_format=output_format),
        headers={"User-Agent": "SoilSync/0.2.0"},
    )
    with urlopen(request, timeout=30) as response:
        payload = response.read()
        content_type = response.headers.get_content_type()
        status_code = response.status

    return {
        "coverageId": validated_coverage_id,
        "statusCode": status_code,
        "estimated": True,
        "bbox": list(bbox),
        "contentType": content_type,
        "bytes": len(payload),
    }


def get_soilgrids_provider_summary() -> dict[str, object]:
    try:
        available_coverages = filter_approved_soilgrids_coverages(fetch_soilgrids_capabilities())
    except (OSError, TimeoutError, URLError, ET.ParseError):
        available_coverages = []

    return {
        "provider": "ISRIC_SOILGRIDS",
        "status": "pending_approval",
        "ready": False,
        "estimated": True,
        "availableCoverageIds": available_coverages,
        "note": "WCS access is validated but provider terms and depth compatibility remain under review.",
    }


class ProviderStatusRecord(ContractModel):
    name: str
    status: ProviderStatusValue
    ready: bool
    note: str | None = None


class ProviderStatusSummary(ContractModel):
    mode: ProviderMode
    providers: list[ProviderStatusRecord]


def get_provider_status_summary(mode: ProviderMode = "DEMO_ONLY") -> ProviderStatusSummary:
    return ProviderStatusSummary(
        mode=mode,
        providers=[
            ProviderStatusRecord(
                name="PROJECT_SOIL_DATASET",
                status="not_connected",
                ready=False,
                note="Prototype use is assumed by the project owner; demo recommendations use local aggregate benchmarks, while provider ingestion remains disconnected pending quality and agronomic review.",
            ),
            ProviderStatusRecord(
                name="ISRIC_WOSIS",
                status="pending_approval",
                ready=False,
                note="Reachability confirmed; record-level licensing and eligible-data checks remain pending.",
            ),
            ProviderStatusRecord(
                name="ISRIC_SOILGRIDS",
                status="pending_approval",
                ready=False,
                note="WCS access is validated but provider terms and depth compatibility remain under review.",
            ),
            ProviderStatusRecord(
                name="SUPABASE",
                status="not_configured",
                ready=False,
                note="Future backend persistence and auth layer; not configured for the demo PWA.",
            ),
        ],
    )
