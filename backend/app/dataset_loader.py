from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CSV_PATH = ROOT / "soil_data_all.csv"
DATASET_KEY = "PROJECT_SOIL_DATASET"
PROVIDER_NAME = "PROJECT_SOIL_DATASET"
BATCH_SIZE = 500

ANALYTE_FIELDS: dict[str, tuple[str, str | None]] = {
    "soil_pH": ("soil_ph", "pH"),
    "exch_Acidity_me_percent_": ("exchangeable_acidity", "meq%"),
    "total_Nitrogen_percent_": ("total_nitrogen", "%"),
    "total_Org_Carbon_percent_": ("organic_carbon", "%"),
    "phosphorus_Olsen_ppm": ("olsen_phosphorus", "ppm"),
    "potassium_meq_percent_": ("exchangeable_potassium", "meq%"),
    "calcium_meq_percent_": ("exchangeable_calcium", "meq%"),
    "magnesium_meq_percent_": ("exchangeable_magnesium", "meq%"),
    "manganese_meq_percent_": ("manganese", "meq%"),
    "copper_ppm": ("copper", "ppm"),
    "iron_ppm": ("iron", "ppm"),
    "zinc_ppm": ("zinc", "ppm"),
    "sodium_meq_percent_": ("sodium", "meq%"),
    "electr_Conductivity_mS_per_cm": ("electrical_conductivity", "mS/cm"),
    "alluminium_ppm": ("aluminium", "ppm"),
    "available_Nitrogen": ("available_nitrogen", None),
    "boron_ppm": ("boron", "ppm"),
    "cadmiun_ppm": ("cadmium", "ppm"),
    "cobalt_ppm": ("cobalt", "ppm"),
    "gallium_ppm": ("gallium", "ppm"),
    "silver_ppm": ("silver", "ppm"),
    "lead_ppm": ("lead", "ppm"),
    "chromium_ppm": ("chromium", "ppm"),
    "sulphur_ppm": ("sulphur", "ppm"),
}

_NUMBER_PATTERN = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$")
_DEPTH_PATTERN = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(?:cm)?\s*$", re.IGNORECASE)

PROVENANCE_INSERT = """
    INSERT INTO source_provenance (
        id, provider_name, dataset_id, record_id, source_dataset_ref_id
    ) VALUES (%s, %s, %s, %s, %s)
"""

READING_INSERT = """
    INSERT INTO soil_readings (
        id, farm_id, reading_source, sample_year, source_label, top_cm, bottom_cm,
        latitude, longitude, source_provider, source_dataset_id, source_record_id,
        dataset_id, import_batch_id, provenance_id, county, constituency, ward, village,
        source_lab_number, source_lab_year, source_latitude, source_longitude,
        final_latitude, final_longitude, gps_tagged_from, source_crop_text,
        source_recommendation_text, coordinate_source, measurement_quality
    ) VALUES (
        %s, NULL, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
    )
"""

MEASUREMENT_INSERT = """
    INSERT INTO soil_measurements (
        soil_reading_id, source_analyte, analyte_code, value, source_value_text,
        source_unit, canonical_unit, analytical_method, quality_status, source_quality_class
    ) VALUES (%s, %s, %s, %s, %s, %s, NULL, NULL, %s, %s)
"""


def clean_text(value: str | None) -> str | None:
    text = (value or "").strip()
    return text or None


def parse_decimal(value: str | None) -> Decimal | None:
    text = clean_text(value)
    if text is None or not _NUMBER_PATTERN.fullmatch(text):
        return None
    try:
        parsed = Decimal(text)
    except InvalidOperation:
        return None
    return parsed if parsed.is_finite() else None


def parse_depth_bounds(value: str | None) -> tuple[float | None, float | None]:
    text = clean_text(value)
    if text is None:
        return None, None
    match = _DEPTH_PATTERN.fullmatch(text)
    if match is None:
        return None, None
    top_cm, bottom_cm = map(float, match.groups())
    if top_cm > bottom_cm:
        return None, None
    return top_cm, bottom_cm


def parse_coordinate_pair(row: dict[str, str], latitude_key: str, longitude_key: str) -> tuple[float | None, float | None]:
    latitude = parse_decimal(row.get(latitude_key))
    longitude = parse_decimal(row.get(longitude_key))
    if latitude is None or longitude is None:
        return None, None
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return None, None
    return float(latitude), float(longitude)


def map_measurements(row: dict[str, str], reading_id: UUID) -> tuple[list[tuple[Any, ...]], int]:
    measurements: list[tuple[Any, ...]] = []
    invalid_count = 0

    for source_field, (analyte_code, source_unit) in ANALYTE_FIELDS.items():
        source_value_text = clean_text(row.get(source_field))
        source_quality_class = clean_text(row.get(f"{source_field}_Class"))
        if source_value_text is None and source_quality_class is None:
            continue

        value = parse_decimal(source_value_text)
        if source_value_text is None:
            quality_status = "missing"
        elif value is None:
            quality_status = "invalid_source_value"
            invalid_count += 1
        else:
            quality_status = "valid"

        measurements.append(
            (
                reading_id,
                source_field,
                analyte_code,
                value,
                source_value_text,
                source_unit,
                quality_status,
                source_quality_class,
            )
        )

    return measurements, invalid_count


def map_source_row(
    row: dict[str, str], dataset_id: UUID, import_batch_id: UUID
) -> tuple[tuple[Any, ...], tuple[Any, ...], list[tuple[Any, ...]], int] | None:
    source_record_id = clean_text(row.get("id"))
    if source_record_id is None:
        return None

    reading_id = uuid4()
    provenance_id = uuid4()
    top_cm, bottom_cm = parse_depth_bounds(row.get("soil_depth_cm"))
    source_latitude, source_longitude = parse_coordinate_pair(row, "latitude", "longitude")
    final_latitude, final_longitude = parse_coordinate_pair(
        row, "final_Latitude", "final_Longitude"
    )

    if final_latitude is not None:
        latitude, longitude, coordinate_source = final_latitude, final_longitude, "final"
    elif source_latitude is not None:
        latitude, longitude, coordinate_source = source_latitude, source_longitude, "source"
    else:
        latitude, longitude, coordinate_source = None, None, None

    sample_year_value = parse_decimal(row.get("year"))
    sample_year = int(sample_year_value) if sample_year_value is not None else None
    measurements, invalid_count = map_measurements(row, reading_id)
    valid_measurements = sum(measurement[6] == "valid" for measurement in measurements)
    if valid_measurements == 0:
        record_quality = "missing"
    elif valid_measurements < len(measurements):
        record_quality = "mixed"
    else:
        record_quality = "valid"

    provenance = (
        provenance_id,
        PROVIDER_NAME,
        DATASET_KEY,
        source_record_id,
        dataset_id,
    )
    reading = (
        reading_id,
        "PROJECT_SOIL_DATASET",
        sample_year,
        clean_text(row.get("soil_depth_cm")),
        top_cm,
        bottom_cm,
        latitude,
        longitude,
        PROVIDER_NAME,
        DATASET_KEY,
        source_record_id,
        dataset_id,
        import_batch_id,
        provenance_id,
        clean_text(row.get("county")),
        clean_text(row.get("constituency")),
        clean_text(row.get("ward")),
        clean_text(row.get("village")),
        clean_text(row.get("lab_No")),
        clean_text(row.get("lab_No_Year")),
        source_latitude,
        source_longitude,
        final_latitude,
        final_longitude,
        clean_text(row.get("gps_tagged_from")),
        clean_text(row.get("crop")),
        clean_text(row.get("fertilizer_Recommendation")),
        coordinate_source,
        record_quality,
    )
    return provenance, reading, measurements, invalid_count


def sha256_file(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def inspect_csv(path: Path) -> dict[str, int]:
    rows_read = 0
    rows_accepted = 0
    rows_rejected = 0
    invalid_measurements = 0
    measurements_found = 0
    seen_record_ids: set[str] = set()
    errors: Counter[str] = Counter()

    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or "id" not in reader.fieldnames:
            raise ValueError("CSV must contain an 'id' column.")

        for row in reader:
            rows_read += 1
            source_record_id = clean_text(row.get("id"))
            if source_record_id is None:
                rows_rejected += 1
                errors["missing_record_id"] += 1
                continue
            if source_record_id in seen_record_ids:
                rows_rejected += 1
                errors["duplicate_record_id"] += 1
                continue
            seen_record_ids.add(source_record_id)

            mapped, invalid_count = map_measurements(row, uuid4())
            rows_accepted += 1
            measurements_found += len(mapped)
            invalid_measurements += invalid_count
            if invalid_count:
                errors["invalid_measurement_value"] += invalid_count

    return {
        "rows_read": rows_read,
        "rows_accepted": rows_accepted,
        "rows_rejected": rows_rejected,
        "measurements_found": measurements_found,
        "invalid_measurements": invalid_measurements,
        **{f"error_{name}": count for name, count in sorted(errors.items())},
    }


def import_csv(path: Path, database_url: str, batch_size: int = BATCH_SIZE) -> dict[str, int | str]:
    del path, database_url, batch_size
    raise RuntimeError(
        "Importing PROJECT_SOIL_DATASET is disabled because this source is retired."
    )

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Audit the retired project soil dataset without importing it."
    )
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV_PATH)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Deprecated; writes are disabled because the source is retired.",
    )
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    args = parser.parse_args()

    if args.batch_size < 1:
        parser.error("--batch-size must be greater than zero")
    if args.apply:
        parser.error(
            "Importing PROJECT_SOIL_DATASET is disabled because this source is retired."
        )
    else:
        result = inspect_csv(args.csv)
        result["mode"] = "dry_run"

    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()