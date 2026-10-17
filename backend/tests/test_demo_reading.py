from __future__ import annotations

from typing import Any, Self

from app import database


class DemoCursor:
    def __init__(self) -> None:
        self.queries: list[str] = []

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def execute(self, query: str, _parameters: tuple[Any, ...] | None = None) -> None:
        self.queries.append(" ".join(query.lower().split()))

    def fetchone(self) -> dict[str, Any]:
        return {
            "id": "quarantined-demo-reading",
            "farm_id": None,
            "sampled_at": None,
            "sample_year": 2026,
            "source_label": "Demo topsoil",
            "top_cm": 0,
            "bottom_cm": 20,
            "location_uncertainty_m": None,
            "latitude": None,
            "longitude": None,
            "source_provider": "DEMO",
            "source_dataset_id": "DEMO_SEED",
            "source_record_id": "demo-001",
            "source_dataset_version": None,
            "source_license": "internal-demo-only",
            "source_attribution": "SoilSync demo seed data",
            "source_retrieved_at": None,
            "measurement_quality": "sample",
            "excluded_reason": "retired_or_demo_source:DEMO",
            "excluded_at": "2026-10-16T00:00:00Z",
        }

    def fetchall(self) -> list[dict[str, Any]]:
        return [
            {
                "analyte_code": "soil_ph",
                "value": 5.6,
                "source_unit": "pH",
                "canonical_unit": "pH",
                "analytical_method": None,
                "quality_status": "sample",
            }
        ]


class DemoConnection:
    def __init__(self, cursor: DemoCursor) -> None:
        self.cursor_instance = cursor

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def cursor(self) -> DemoCursor:
        return self.cursor_instance


def test_demo_endpoint_can_read_quarantined_demo_seed(monkeypatch) -> None:
    cursor = DemoCursor()
    monkeypatch.setattr(database, "_connect", lambda: DemoConnection(cursor))

    reading = database.load_demo_soil_reading()

    query = cursor.queries[0]
    assert "reading.reading_source = 'demo_seed'" in query
    assert "reading.source_provider = 'demo'" in query
    assert "reading.excluded_at is null" not in query
    assert reading.contract_version == 2
    assert reading.source.provider == "DEMO"
    assert reading.measurements[0].analyte == "soil_ph"
