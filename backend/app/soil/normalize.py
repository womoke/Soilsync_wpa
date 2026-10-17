from __future__ import annotations

from dataclasses import dataclass, replace
from decimal import Decimal, InvalidOperation
from typing import Any

SUPPORTED_ANALYTE_UNITS: dict[str, dict[str, tuple[str, Decimal]]] = {
    "soil_ph": {
        "ph": ("pH", Decimal("1")),
    },
    "total_nitrogen": {
        "%": ("%", Decimal("1")),
        "g/kg": ("%", Decimal("0.1")),
    },
    "organic_carbon": {
        "%": ("%", Decimal("1")),
        "g/kg": ("%", Decimal("0.1")),
    },
    "olsen_phosphorus": {
        "mg/kg": ("mg/kg", Decimal("1")),
    },
    "exchangeable_potassium": {
        "cmol/kg": ("cmol/kg", Decimal("1")),
        "meq/100g": ("cmol/kg", Decimal("1")),
        "mg/kg": ("cmol/kg", Decimal(1) / Decimal(391)),
    },
    "extractable_phosphorus": {
        "mg/kg": ("mg/kg", Decimal("1")),
    },
    "extractable_potassium": {
        "mg/kg": ("mg/kg", Decimal("1")),
    },
}

PLAUSIBILITY_BOUNDS: dict[str, dict[str, float | str | None]] = {
    analyte: {
        "minimum": None,
        "maximum": None,
        "status": "UNVERIFIED",
    }
    for analyte in SUPPORTED_ANALYTE_UNITS
}


@dataclass(frozen=True)
class NormalizedMeasurement:
    value: float | None
    source_value_text: str | None
    source_unit: str
    canonical_unit: str | None
    quality_status: str
    normalization_error: str | None
    transformations: list[str]


def _unit_key(value: str) -> str:
    return "".join(value.strip().lower().split())


def _source_text(value: Any, provided_text: str | None) -> str | None:
    if provided_text is not None:
        return provided_text
    return None if value is None else str(value)


def normalize_measurement(
    *,
    analyte: str,
    value: Any,
    source_unit: str,
    quality_status: str,
    source_value_text: str | None = None,
) -> NormalizedMeasurement:
    raw_text = _source_text(value, source_value_text)
    result = NormalizedMeasurement(
        value=None,
        source_value_text=raw_text,
        source_unit=source_unit.strip(),
        canonical_unit=None,
        quality_status=quality_status,
        normalization_error=None,
        transformations=[],
    )

    if value is None:
        if quality_status == "valid":
            return replace(
                result,
                quality_status="invalid_source_value",
                normalization_error="A valid measurement requires a numeric value.",
            )
        if quality_status == "invalid_source_value":
            return replace(
                result,
                normalization_error="Invalid source measurements cannot be normalized.",
            )
        return result

    if quality_status == "missing":
        return replace(
            result,
            quality_status="invalid_source_value",
            normalization_error="A missing measurement cannot contain a numeric value.",
        )

    try:
        numeric = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        numeric = Decimal("NaN")
    if not numeric.is_finite():
        return replace(
            result,
            quality_status="invalid_source_value",
            normalization_error="Measurement value is not a finite number.",
        )

    if quality_status == "invalid_source_value":
        return replace(
            result,
            quality_status="invalid_source_value",
            normalization_error="Invalid source measurements cannot store a numeric value.",
        )

    unit_map = SUPPORTED_ANALYTE_UNITS.get(analyte)
    unit_entry = unit_map.get(_unit_key(source_unit)) if unit_map is not None else None
    if unit_entry is None:
        return replace(
            result,
            quality_status="invalid_source_value",
            normalization_error=f"Unsupported unit {source_unit!r} for analyte {analyte!r}.",
        )

    canonical_unit, factor = unit_entry
    normalized = numeric * factor
    transformations: list[str] = []
    if factor != 1:
        transformations.append(
            f"unit_conversion:{source_unit.strip()}->{canonical_unit}"
        )
    return NormalizedMeasurement(
        value=float(normalized),
        source_value_text=raw_text,
        source_unit=source_unit.strip(),
        canonical_unit=canonical_unit,
        quality_status=quality_status,
        normalization_error=None,
        transformations=transformations,
    )
