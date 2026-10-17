from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from app import database
from app.services.isda_client import (
    THIRD_PARTY_SOIL_CONSENT_SCOPE,
    normalize_soil_estimate,
    parse_soil_property_response,
)

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "isda" / "soilproperty_contract_example.json"


class FakeCursor:
    def __init__(self, responses: list[dict[str, Any] | None]) -> None:
        self.responses = responses
        self.calls: list[tuple[str, tuple[Any, ...] | None]] = []

    def __enter__(self) -> FakeCursor:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def execute(self, query: str, parameters: tuple[Any, ...] | None = None) -> None:
        self.calls.append((query, parameters))

    def fetchone(self) -> dict[str, Any] | None:
        return self.responses.pop(0)


class FakeConnection:
    def __init__(self, cursor: FakeCursor) -> None:
        self._cursor = cursor

    def __enter__(self) -> FakeConnection:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def cursor(self) -> FakeCursor:
        return self._cursor


def _normalized_estimate():
    payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    return normalize_soil_estimate(
        parse_soil_property_response(payload, "nitrogen_total")
    )


def test_create_request_requires_matching_explicit_third_party_consent(monkeypatch) -> None:
    cursor = FakeCursor([{"id": "request-1"}])
    monkeypatch.setattr(database, "_connect", lambda: FakeConnection(cursor))

    request_id = database.create_isda_estimate_request(
        "reading-1",
        "consent-1",
        rounded_latitude=-1.2,
        rounded_longitude=36.8,
        layers_requested=["nitrogen_total"],
    )

    assert request_id == "request-1"
    query, parameters = cursor.calls[0]
    assert "consent.consent_scopes @> ARRAY[%s]::TEXT[]" in query
    assert "consent.visit_id = readings.visit_id" in query
    assert "consent.farmer_id = farms.owner_id" in query
    assert parameters is not None
    assert parameters[0:2] == (-1.2, 36.8)
    assert json.loads(parameters[2]) == ["nitrogen_total"]
    assert parameters[4] == THIRD_PARTY_SOIL_CONSENT_SCOPE


def test_create_request_returns_none_when_consent_does_not_authorize(monkeypatch) -> None:
    cursor = FakeCursor([None])
    monkeypatch.setattr(database, "_connect", lambda: FakeConnection(cursor))

    assert (
        database.create_isda_estimate_request(
            "reading-1",
            "storage-only-consent",
            rounded_latitude=-1.2,
            rounded_longitude=36.8,
            layers_requested=["nitrogen_total"],
        )
        is None
    )


@pytest.mark.parametrize(
    ("latitude", "longitude", "layers"),
    [
        (90.0, 36.8, ["nitrogen_total"]),
        (-1.2, 180.0, ["nitrogen_total"]),
        (-1.2, 36.8, ["unknown_property"]),
        (-1.2, 36.8, ["nitrogen_total", "nitrogen_total"]),
    ],
)
def test_create_request_rejects_invalid_coordinates_or_layers(
    monkeypatch, latitude: float, longitude: float, layers: list[str]
) -> None:
    monkeypatch.setattr(
        database,
        "_connect",
        lambda: pytest.fail("Invalid request input must be rejected before database access."),
    )

    with pytest.raises(ValueError):
        database.create_isda_estimate_request(
            "reading-1",
            "consent-1",
            rounded_latitude=latitude,
            rounded_longitude=longitude,
            layers_requested=layers,
        )


def test_complete_request_persists_a_separate_estimate_snapshot(monkeypatch) -> None:
    request_row = {
        "reading_id": "measured-reading",
        "status": "pending",
        "rounded_latitude": -1.2,
        "rounded_longitude": 36.8,
        "layers_requested": ["nitrogen_total"],
        "consent_record_id": "consent-1",
        "farm_id": "farm-1",
        "officer_user_id": "officer-1",
        "visit_id": "visit-1",
        "sampled_at": datetime(2025, 1, 2, tzinfo=UTC),
        "sample_year": 2025,
        "top_cm": 0,
        "bottom_cm": 20,
        "location_uncertainty_m": 8,
        "excluded_at": None,
        "consent_scopes": [THIRD_PARTY_SOIL_CONSENT_SCOPE],
    }
    cursor = FakeCursor(
        [
            request_row,
            {"id": "estimate-reading"},
            {"id": "request-1"},
        ]
    )
    monkeypatch.setattr(database, "_connect", lambda: FakeConnection(cursor))

    result = database.complete_isda_estimate_request(
        "request-1",
        [_normalized_estimate()],
        dataset_id="isda-soil-v2",
        dataset_version="2025-01",
        license_identifier="CC-BY-4.0",
        attribution="iSDAsoil attribution, verified for this release",
        retrieved_at=datetime(2025, 1, 3, tzinfo=UTC),
    )

    assert result == {
        "requestId": "request-1",
        "readingId": "estimate-reading",
        "status": "ok",
    }
    insert_reading_sql, reading_parameters = cursor.calls[1]
    assert "'ISDA_SOIL_ESTIMATE'" in insert_reading_sql
    assert "'ISDA_SOIL'" in insert_reading_sql
    assert "source_reading_id" in insert_reading_sql
    assert reading_parameters is not None
    assert reading_parameters[-1] == "measured-reading"
    measurement_sql, measurement_parameters = cursor.calls[2]
    assert "INSERT INTO soil_measurements" in measurement_sql
    assert measurement_parameters is not None
    assert measurement_parameters[1:3] == ("nitrogen_total", "total_nitrogen")
    assert measurement_parameters[7] == "estimated"
    assert json.loads(measurement_parameters[14]) == [
        "unit_conversion:g/kg->%",
        "depth_layer:0-20",
    ]
    update_sql, update_parameters = cursor.calls[3]
    assert "estimate_reading_id = %s" in update_sql
    assert update_parameters == (200, "estimate-reading", "request-1")


def test_complete_request_requires_verified_source_metadata_before_database_access(monkeypatch) -> None:
    monkeypatch.setattr(
        database,
        "_connect",
        lambda: pytest.fail("Missing provenance must be rejected before database access."),
    )

    with pytest.raises(ValueError, match="license, and attribution"):
        database.complete_isda_estimate_request(
            "request-1",
            [_normalized_estimate()],
            dataset_id="isda-soil-v2",
            dataset_version="2025-01",
            license_identifier=" ",
            attribution="attribution",
            retrieved_at=datetime(2025, 1, 3, tzinfo=UTC),
        )


def test_failure_request_stores_only_a_bounded_error_code(monkeypatch) -> None:
    cursor = FakeCursor([{"id": "request-1"}])
    monkeypatch.setattr(database, "_connect", lambda: FakeConnection(cursor))

    assert database.fail_isda_estimate_request(
        "request-1",
        "provider_unavailable",
        http_status=503,
    )
    assert cursor.calls[0][1] == (503, "provider_unavailable", "request-1")

    with pytest.raises(ValueError, match="Unsupported iSDA failure code"):
        database.fail_isda_estimate_request("request-1", "password=secret")


def test_isda_snapshot_migration_links_consent_and_estimate_reading() -> None:
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "database"
        / "migrations"
        / "037_isda_snapshot_persistence.sql"
    )
    migration = migration_path.read_text(encoding="utf-8").lower()

    assert "source_reading_id uuid" in migration
    assert "consent_record_id uuid" in migration
    assert "estimate_reading_id uuid unique" in migration
    assert "on delete restrict" in migration
    assert "on delete set null" in migration
