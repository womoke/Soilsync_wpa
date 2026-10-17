from math import isclose

import pytest

from app.soil.normalize import PLAUSIBILITY_BOUNDS, normalize_measurement


@pytest.mark.parametrize(
    ("analyte", "value", "source_unit", "expected", "canonical_unit"),
    [
        ("soil_ph", 5.8, "pH", 5.8, "pH"),
        ("total_nitrogen", 12, "g/kg", 1.2, "%"),
        ("organic_carbon", 8.5, "g/kg", 0.85, "%"),
        ("olsen_phosphorus", 18, "mg/kg", 18, "mg/kg"),
        ("exchangeable_potassium", 0.34, "cmol/kg", 0.34, "cmol/kg"),
        ("exchangeable_potassium", 0.34, "meq/100 g", 0.34, "cmol/kg"),
        ("exchangeable_potassium", 391, "mg/kg", 1, "cmol/kg"),
        ("extractable_phosphorus", 24, "mg/kg", 24, "mg/kg"),
        ("extractable_potassium", 31, "mg/kg", 31, "mg/kg"),
    ],
)
def test_normalize_supported_units(
    analyte: str,
    value: float,
    source_unit: str,
    expected: float,
    canonical_unit: str,
) -> None:
    result = normalize_measurement(
        analyte=analyte,
        value=value,
        source_unit=source_unit,
        quality_status="valid",
    )

    assert result.quality_status == "valid"
    assert isclose(result.value or 0, expected)
    assert result.canonical_unit == canonical_unit
    assert result.source_value_text == str(value)
    assert result.source_unit == source_unit
    assert result.normalization_error is None


@pytest.mark.parametrize(
    ("analyte", "value", "source_unit"),
    [
        ("soil_ph", 5.8, "mg/kg"),
        ("total_nitrogen", 12, "mg/kg"),
        ("organic_carbon", 8.5, "ppm"),
        ("olsen_phosphorus", 18, "ppm"),
        ("exchangeable_potassium", 0.34, "%"),
        ("extractable_phosphorus", 24, "ppm"),
        ("extractable_potassium", 31, "cmol/kg"),
    ],
)
def test_unknown_or_method_mismatched_units_are_invalid(
    analyte: str,
    value: float,
    source_unit: str,
) -> None:
    result = normalize_measurement(
        analyte=analyte,
        value=value,
        source_unit=source_unit,
        quality_status="valid",
    )

    assert result.value is None
    assert result.quality_status == "invalid_source_value"
    assert result.source_value_text == str(value)
    assert result.normalization_error is not None


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity", "not numeric"])
def test_non_finite_or_non_numeric_values_are_invalid(value: str) -> None:
    result = normalize_measurement(
        analyte="soil_ph",
        value=value,
        source_unit="pH",
        quality_status="valid",
    )

    assert result.value is None
    assert result.quality_status == "invalid_source_value"
    assert result.source_value_text == value


def test_missing_measurement_status_is_preserved() -> None:
    result = normalize_measurement(
        analyte="total_nitrogen",
        value=None,
        source_unit="%",
        quality_status="missing",
    )

    assert result.value is None
    assert result.quality_status == "missing"
    assert result.normalization_error is None


def test_missing_measurement_with_numeric_value_is_invalid() -> None:
    result = normalize_measurement(
        analyte="total_nitrogen",
        value=1.2,
        source_unit="%",
        quality_status="missing",
    )

    assert result.value is None
    assert result.quality_status == "invalid_source_value"
    assert result.normalization_error == "A missing measurement cannot contain a numeric value."


def test_explicit_invalid_source_value_keeps_error_explanation() -> None:
    result = normalize_measurement(
        analyte="total_nitrogen",
        value=None,
        source_unit="%",
        quality_status="invalid_source_value",
        source_value_text="trace",
    )

    assert result.value is None
    assert result.source_value_text == "trace"
    assert result.normalization_error == "Invalid source measurements cannot be normalized."


def test_plausibility_limits_remain_unverified_until_expert_signoff() -> None:
    assert set(PLAUSIBILITY_BOUNDS) == {
        "soil_ph",
        "total_nitrogen",
        "organic_carbon",
        "olsen_phosphorus",
        "exchangeable_potassium",
        "extractable_phosphorus",
        "extractable_potassium",
    }
    assert all(
        bound["status"] == "UNVERIFIED"
        and bound["minimum"] is None
        and bound["maximum"] is None
        for bound in PLAUSIBILITY_BOUNDS.values()
    )
