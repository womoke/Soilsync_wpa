#!/usr/bin/env python3
"""Read-only inventory of retired-source readings and downstream exposure."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

RETIRED_PROVIDERS = (
    "PROJECT_SOIL_DATASET",
    "ISRIC_WOSIS",
    "ISRIC_SOILGRIDS",
)
PROVIDER_SQL = ", ".join(f"'{provider}'" for provider in RETIRED_PROVIDERS)
AFFECTED_READING_SQL = f"""
    readings.reading_source = 'DEMO_SEED'
    OR readings.source_provider = 'DEMO'
    OR readings.reading_source IN ({PROVIDER_SQL})
    OR readings.source_provider IN ({PROVIDER_SQL})
    OR readings.source_dataset_id IN ({PROVIDER_SQL})
    OR EXISTS (
        SELECT 1
        FROM source_datasets AS datasets
        WHERE datasets.id = readings.dataset_id
          AND (
              datasets.dataset_key IN ({PROVIDER_SQL})
              OR datasets.provider_name IN ({PROVIDER_SQL})
          )
    )
    OR EXISTS (
        SELECT 1
        FROM source_import_batches AS batches
        JOIN source_datasets AS batch_datasets ON batch_datasets.id = batches.dataset_id
        WHERE batches.id = readings.import_batch_id
          AND (
              batch_datasets.dataset_key IN ({PROVIDER_SQL})
              OR batch_datasets.provider_name IN ({PROVIDER_SQL})
          )
    )
    OR EXISTS (
        SELECT 1
        FROM source_provenance AS provenance
        LEFT JOIN source_datasets AS provenance_datasets
          ON provenance_datasets.id = provenance.source_dataset_ref_id
        WHERE (
            provenance.id = readings.provenance_id
            OR (
                provenance.record_id = readings.source_record_id
                AND (
                    provenance.source_dataset_ref_id = readings.dataset_id
                    OR (
                        readings.source_dataset_id IS NOT NULL
                        AND provenance.dataset_id = readings.source_dataset_id
                    )
                )
            )
        )
          AND (
              provenance.provider_name IN ({PROVIDER_SQL})
              OR provenance.dataset_id IN ({PROVIDER_SQL})
              OR provenance_datasets.dataset_key IN ({PROVIDER_SQL})
              OR provenance_datasets.provider_name IN ({PROVIDER_SQL})
          )
    )
"""
PROJECT_DATASET_CLEANUP_SQL = """
    WITH project_dataset AS (
        SELECT id FROM source_datasets WHERE dataset_key = 'PROJECT_SOIL_DATASET'
    ),
    project_readings AS (
        SELECT readings.id
        FROM soil_readings AS readings
        WHERE readings.dataset_id IN (SELECT id FROM project_dataset)
           OR readings.source_dataset_id = 'PROJECT_SOIL_DATASET'
           OR readings.source_provider = 'PROJECT_SOIL_DATASET'
           OR readings.reading_source = 'PROJECT_SOIL_DATASET'
    ),
    project_provenance AS (
        SELECT provenance.id
        FROM source_provenance AS provenance
        WHERE provenance.source_dataset_ref_id IN (SELECT id FROM project_dataset)
           OR provenance.dataset_id = 'PROJECT_SOIL_DATASET'
           OR provenance.provider_name = 'PROJECT_SOIL_DATASET'
    ),
    project_recommendations AS (
        SELECT recommendations.id
        FROM recommendations
        WHERE recommendations.soil_reading_id IN (
            SELECT id FROM project_readings
        )
    )
    SELECT 'soil_readings' AS table_name, COUNT(*) AS rows_affected
    FROM project_readings
    UNION ALL
    SELECT 'soil_measurements', COUNT(*)
    FROM soil_measurements AS measurements
    WHERE measurements.soil_reading_id IN (SELECT id FROM project_readings)
    UNION ALL
    SELECT 'agronomic_assessments', COUNT(*)
    FROM agronomic_assessments AS assessments
    WHERE assessments.soil_reading_id IN (SELECT id FROM project_readings)
    UNION ALL
    SELECT 'recommendations', COUNT(*) FROM project_recommendations
    UNION ALL
    SELECT 'recommendation_feedback', COUNT(*)
    FROM recommendation_feedback AS feedback
    WHERE feedback.recommendation_id IN (SELECT id FROM project_recommendations)
    UNION ALL
    SELECT 'readings_blocking_provenance_delete', COUNT(*)
    FROM soil_readings AS readings
    WHERE readings.provenance_id IN (SELECT id FROM project_provenance)
      AND readings.id NOT IN (SELECT id FROM project_readings)
    UNION ALL
    SELECT 'source_provenance', COUNT(*)
    FROM project_provenance
    UNION ALL
    SELECT 'source_import_batches', COUNT(*)
    FROM source_import_batches AS batches
    WHERE batches.dataset_id IN (SELECT id FROM project_dataset)
    UNION ALL
    SELECT 'source_datasets_to_rename', COUNT(*) FROM project_dataset
"""


def _fetch_all(cursor: Any, query: str) -> list[dict[str, Any]]:
    cursor.execute(query)
    return [dict(row) for row in cursor.fetchall()]


def build_audit_report(connection: Any) -> dict[str, Any]:
    with connection.cursor() as cursor:
        project_cleanup_impact = _fetch_all(cursor, PROJECT_DATASET_CLEANUP_SQL)
        readings = _fetch_all(
            cursor,
            f"""
            SELECT DISTINCT readings.id AS reading_id,
                   readings.farm_id,
                   readings.reading_source,
                   readings.source_provider,
                   readings.source_dataset_id,
                   readings.source_record_id,
                   readings.dataset_id,
                   readings.import_batch_id,
                   datasets.dataset_key,
                   batches.status AS import_batch_status
            FROM soil_readings AS readings
            LEFT JOIN source_datasets AS datasets ON datasets.id = readings.dataset_id
            LEFT JOIN source_import_batches AS batches ON batches.id = readings.import_batch_id
            WHERE {AFFECTED_READING_SQL}
            ORDER BY readings.id
            """,
        )
        assessments = _fetch_all(
            cursor,
            f"""
            SELECT assessments.id AS assessment_id,
                   assessments.soil_reading_id AS reading_id,
                   assessments.status,
                   assessments.review_stage,
                   assessments.published_at,
                   assessments.verified_report IS NOT NULL AS has_published_report
            FROM agronomic_assessments AS assessments
            JOIN soil_readings AS readings ON readings.id = assessments.soil_reading_id
            WHERE {AFFECTED_READING_SQL}
            ORDER BY assessments.created_at, assessments.id
            """,
        )
        ward_summary_impact = _fetch_all(
            cursor,
            f"""
            SELECT COALESCE(farms.county, 'Unspecified') AS county,
                   COALESCE(farms.sub_county, 'Unspecified') AS sub_county,
                   COALESCE(farms.ward, 'Unspecified') AS ward,
                   COUNT(DISTINCT readings.id) AS affected_reading_count,
                   COUNT(measurements.id) AS affected_measurement_count
            FROM soil_readings AS readings
            LEFT JOIN farms ON farms.id = readings.farm_id
            LEFT JOIN soil_measurements AS measurements
              ON measurements.soil_reading_id = readings.id
            WHERE {AFFECTED_READING_SQL}
            GROUP BY farms.county, farms.sub_county, farms.ward
            ORDER BY farms.county, farms.sub_county, farms.ward
            """,
        )
        export_impact = _fetch_all(
            cursor,
            f"""
            SELECT COALESCE(farms.county, 'Unspecified') AS county,
                   COALESCE(farms.sub_county, 'Unspecified') AS sub_county,
                   COALESCE(farms.ward, 'Unspecified') AS ward,
                   readings.source_provider,
                   COUNT(DISTINCT readings.id) AS affected_reading_count,
                   COUNT(measurements.id) AS affected_export_record_count
            FROM soil_readings AS readings
            JOIN farms ON farms.id = readings.farm_id
            JOIN users AS farmers ON farmers.id = farms.owner_id
            LEFT JOIN soil_measurements AS measurements
              ON measurements.soil_reading_id = readings.id
            WHERE {AFFECTED_READING_SQL}
            GROUP BY farms.county, farms.sub_county, farms.ward, readings.source_provider
            ORDER BY farms.county, farms.sub_county, farms.ward, readings.source_provider
            """,
        )

    return {
        "audit": "retired_soil_data",
        "readOnly": True,
        "retiredProviders": [*RETIRED_PROVIDERS, "DEMO"],
        "projectDatasetCleanupImpact": project_cleanup_impact,
        "readings": readings,
        "assessmentsAndReports": assessments,
        "wardSummaryImpact": ward_summary_impact,
        "officerExportImpact": export_impact,
        "counts": {
            "readings": len(readings),
            "assessments": len(assessments),
            "publishedReports": sum(bool(item["has_published_report"]) for item in assessments),
            "wardGroups": len(ward_summary_impact),
            "exportGroups": len(export_impact),
        },
    }


def _load_workspace_database_url() -> None:
    if os.environ.get("DATABASE_URL"):
        return

    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "DATABASE_URL":
            os.environ["DATABASE_URL"] = value.strip().strip("\"'")
            return


def main() -> int:
    _load_workspace_database_url()
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL must be configured to run the read-only audit.", file=sys.stderr)
        return 2

    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError:
        print("Install the backend postgres extra before running the audit.", file=sys.stderr)
        return 2

    try:
        with psycopg.connect(
            database_url,
            row_factory=dict_row,
            connect_timeout=8,
        ) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SET TRANSACTION READ ONLY")
            report = build_audit_report(connection)
    except psycopg.Error as exc:
        print(f"Read-only retired-source audit failed: {exc.__class__.__name__}.", file=sys.stderr)
        return 1

    print(json.dumps(report, indent=2, sort_keys=True, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
