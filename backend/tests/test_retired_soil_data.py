from pathlib import Path
from typing import Any, Self

import pytest

from app import database


class MockCursor:
    def __init__(
        self,
        first_row: dict[str, Any] | None = None,
        first_rows: list[dict[str, Any]] | None = None,
        rows: list[dict[str, Any]] | None = None,
    ) -> None:
        self.queries: list[str] = []
        self.parameters: list[tuple[Any, ...] | None] = []
        self.first_rows = first_rows or ([first_row] if first_row is not None else [])
        self.rows = rows or []

    def __enter__(self) -> Self:
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        return None

    def execute(self, query: str, params: tuple[Any, ...] | None = None) -> None:
        self.queries.append(" ".join(query.lower().split()))
        self.parameters.append(params)

    def fetchone(self) -> dict[str, Any] | None:
        return self.first_rows.pop(0) if self.first_rows else None

    def fetchall(self) -> list[dict[str, Any]]:
        return self.rows


class MockConnection:
    def __init__(self, cursor: MockCursor) -> None:
        self.mock_cursor = cursor

    def __enter__(self) -> Self:
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        return None

    def cursor(self) -> MockCursor:
        return self.mock_cursor


def test_ward_summaries_suppress_cohorts_below_three_farmers(monkeypatch) -> None:
    cursor = MockCursor()
    monkeypatch.setattr(database, "_connect", lambda: MockConnection(cursor))

    assert database.load_officer_ward_summaries("officer-1") == []

    query = cursor.queries[0]
    assert "readings.excluded_at is null" in query
    assert "readings.reading_source in" in query
    assert "readings.source_provider in" in query
    assert "valid_measurements.quality_status = 'valid'" in query
    assert "measurements.quality_status = 'valid'" in query
    assert "having count(distinct case" in query
    assert "end) >= 3" in query


def test_officer_exports_only_include_valid_measured_readings(monkeypatch) -> None:
    cursor = MockCursor(
        first_rows=[{"authorized": True}, {"farmer_count": 3}],
        rows=[
            {
                "reading_id": "reading-1",
                "farm_name": "Farm A",
                "county": "Nyeri",
                "sub_county": "Subcounty",
                "ward": "Ward",
                "sample_year": 2026,
                "sampled_at": None,
                "top_cm": 0,
                "bottom_cm": 20,
                "source_provider": "OFFICER_FIELD_COLLECTION",
                "analyte_code": "soil_ph",
                "value": 5.8,
                "source_unit": "pH",
                "quality_status": "valid",
            }
        ],
    )
    monkeypatch.setattr(database, "_connect", lambda: MockConnection(cursor))

    result = database.export_officer_report("officer-1", None, None, None)

    assert result is not None
    assert len(cursor.queries) == 3
    cohort_query = cursor.queries[1]
    query = cursor.queries[2]
    assert "count(distinct farms.owner_id)" in cohort_query
    assert "measurements.quality_status = 'valid'" in cohort_query
    assert "readings.excluded_at is null" in query
    assert "readings.source_provider in" in query
    assert "valid_measurements.quality_status = 'valid'" in query
    assert "measurements.quality_status = 'valid'" in query
    assert "farmers.display_name" not in query
    assert "farmerName" not in result["allowlistedFields"]
    assert "farmerName" not in result["records"][0]
    assert "three distinct farmers" in result["privacyDisclaimer"]


def test_officer_exports_suppress_scopes_with_fewer_than_three_farmers(monkeypatch) -> None:
    cursor = MockCursor(first_rows=[{"authorized": True}, {"farmer_count": 2}])
    monkeypatch.setattr(database, "_connect", lambda: MockConnection(cursor))

    assert database.export_officer_report("officer-1", "Nyeri", None, None) is None
    assert len(cursor.queries) == 2
    assert "count(distinct farms.owner_id)" in cursor.queries[1]


def test_farmer_recommendation_loaders_exclude_retired_readings(monkeypatch) -> None:
    cursor = MockCursor()
    monkeypatch.setattr(database, "_connect", lambda: MockConnection(cursor))

    assert database.load_farmer_recommendations("farmer-1", "farm-1") == []
    recommendation_query = cursor.queries[0]
    assert "recommendations.farm_id = %s" in recommendation_query
    assert "recommendation_readings.excluded_at is null" in recommendation_query
    assert "recommendation_readings.source_provider" in recommendation_query
    assert cursor.parameters[0] == ("farmer-1", "farmer-1", "farmer-1", "farm-1")

    cursor = MockCursor()
    monkeypatch.setattr(database, "_connect", lambda: MockConnection(cursor))
    assert database.create_farmer_recommendation_feedback(
        "farmer-1", "recommendation-1", "helpful"
    ) is None
    assert "recommendation_readings.excluded_at is null" in cursor.queries[0]

    cursor = MockCursor()
    monkeypatch.setattr(database, "_connect", lambda: MockConnection(cursor))
    assert database.load_farmer_recommendation_feedback(
        "farmer-1", "recommendation-1"
    ) == []
    assert "recommendation_readings.excluded_at is null" in cursor.queries[0]


@pytest.mark.parametrize(
    ("loader", "arguments"),
    [
        (database.load_farmer_soil_readings, ("farmer-1", "farm-1")),
        (database.load_officer_farm_readings, ("officer-1", "farm-1")),
    ],
)
def test_soil_reading_loaders_return_snapshot_provenance_and_uncertainty(
    monkeypatch, loader, arguments: tuple[str, str]
) -> None:
    row = {
        "id": "reading-1",
        "farm_id": "farm-1",
        "sampled_at": None,
        "sample_year": 2026,
        "source_label": "0-20 cm",
        "top_cm": 0,
        "bottom_cm": 20,
        "location_uncertainty_m": 10,
        "latitude": -1.0,
        "longitude": 36.0,
        "source_provider": "ISDA_SOIL",
        "source_dataset_id": "isdasoil-v2",
        "source_dataset_version": "2",
        "source_record_id": None,
        "source_license": "CC-BY-4.0",
        "source_attribution": "iSDAsoil",
        "source_retrieved_at": None,
        "analyte_code": "soil_ph",
        "value": 5.8,
        "source_unit": "pH",
        "canonical_unit": "pH",
        "analytical_method": None,
        "quality_status": "estimated",
        "source_value_text": "5.8",
        "uncertainty_lower": 5.4,
        "uncertainty_upper": 6.1,
        "interval_level": 90,
        "depth_layer": "0-20",
        "depth_top_cm": 0,
        "depth_bottom_cm": 20,
        "transformations": ["depth_layer:0-20"],
        "normalization_error": None,
    }
    cursor = MockCursor(rows=[row])
    monkeypatch.setattr(database, "_connect", lambda: MockConnection(cursor))

    [reading] = loader(*arguments)

    assert reading.contract_version == 2
    assert reading.source.dataset_version == "2"
    measurement = reading.measurements[0]
    assert measurement.quality_status == "estimated"
    assert measurement.source_value_text == "5.8"
    assert measurement.uncertainty is not None
    assert measurement.uncertainty.interval_level == 90
    assert measurement.uncertainty.lower == 5.4
    assert measurement.uncertainty.upper == 6.1
    assert measurement.depth_layer == "0-20"
    assert measurement.transformations == ["depth_layer:0-20"]


def test_quarantine_migration_marks_retired_and_demo_data_without_deleting() -> None:
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "database"
        / "migrations"
        / "033_quarantine_retired_soil_readings.sql"
    )
    migration = migration_path.read_text(encoding="utf-8").lower()

    assert "add column if not exists excluded_reason" in migration
    assert "add column if not exists excluded_at" in migration
    assert "readings.reading_source = 'demo_seed'" in migration
    assert "readings.source_provider in" in migration
    assert "record_provenance.source_dataset_ref_id = readings.dataset_id" in migration
    assert "update public.soil_readings" in migration
    assert "delete from public.soil_readings" not in migration


def test_development_demo_seed_is_inserted_as_excluded() -> None:
    seed_path = (
        Path(__file__).resolve().parents[1]
        / "database"
        / "seed"
        / "dev_seed.sql"
    )
    seed = seed_path.read_text(encoding="utf-8").lower()

    assert "excluded_reason" in seed
    assert "'demo_seed_quarantined'" in seed
    assert "excluded_at" in seed


def test_estimate_snapshot_migration_adds_versioned_contract_fields_and_rls() -> None:
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "database"
        / "migrations"
        / "034_soil_estimate_snapshots_and_measurement_quality.sql"
    )
    migration = migration_path.read_text(encoding="utf-8").lower()

    for column in (
        "source_dataset_version",
        "uncertainty_lower",
        "uncertainty_upper",
        "interval_level",
        "depth_layer",
        "depth_top_cm",
        "depth_bottom_cm",
        "transformations",
        "normalization_error",
    ):
        assert column in migration
    assert "create table if not exists public.soil_estimate_requests" in migration
    assert "status in ('pending', 'ok', 'failed')" in migration
    assert "rounded_latitude" in migration
    assert "layers_requested jsonb" in migration
    assert "error_text text" in migration
    assert "enable row level security" in migration
    assert "commit;" in migration


def test_officer_location_consent_migration_records_scopes_and_audit_metadata() -> None:
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "database"
        / "migrations"
        / "035_officer_location_consent.sql"
    )
    migration = migration_path.read_text(encoding="utf-8").lower()

    for required in (
        "farm_id",
        "visit_id",
        "farmer_id",
        "officer_user_id",
        "consent_scopes text[]",
        "wording_version",
        "consent_notes",
        "recorded_at",
        "store_exact_coordinates",
        "send_coordinates_to_third_party_soil_service",
        "enable row level security",
    ):
        assert required in migration
    assert "commit;" in migration

    schema_path = Path(__file__).resolve().parents[1] / "app" / "database_schema.sql"
    schema = schema_path.read_text(encoding="utf-8").lower()
    assert "create table if not exists officer_location_consent_records" in schema
    assert "consent_scopes text[] not null" in schema
    assert "alter table officer_location_consent_records enable row level security" in schema


def test_read_only_audit_includes_cascade_counts_for_migration_032() -> None:
    audit_path = Path(__file__).resolve().parents[2] / "scripts" / "audit_retired_soil_data.py"
    audit_source = audit_path.read_text(encoding="utf-8").lower()

    for table_name in (
        "soil_readings",
        "soil_measurements",
        "agronomic_assessments",
        "recommendations",
        "recommendation_feedback",
        "source_provenance",
        "source_import_batches",
        "source_datasets_to_rename",
        "readings_blocking_provenance_delete",
    ):
        assert f"'{table_name}'" in audit_source
