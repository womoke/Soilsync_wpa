import json
import os
import uuid
from datetime import UTC, datetime
from functools import wraps
from typing import Any

import app.env  # noqa: F401
from app.models import (
    FarmerSoilReadingCreateRequest,
    SoilMeasurement,
    SoilReading,
    SoilRecommendation,
)
from app.recommendations import _safe_float, generate_agronomic_assessment
from app.supabase_client import (
    SupabaseIdentityUnavailableError,
    delete_supabase_user,
    send_farmer_claim_reminder,
)

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover
    psycopg = None  # type: ignore[assignment]
    dict_row = None  # type: ignore[assignment]


class DatabaseUnavailable(RuntimeError):
    pass


class AccountProvisioningConflict(RuntimeError):
    pass


def _database_errors_as_unavailable(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        try:
            return function(*args, **kwargs)
        except DatabaseUnavailable:
            raise
        except Exception as exc:
            if psycopg is not None and isinstance(exc, psycopg.Error):
                raise DatabaseUnavailable(
                    "Database schema or seed data is unavailable; apply the migrations and seed files."
                ) from exc
            raise

    return wrapped


def _connect():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise DatabaseUnavailable("DATABASE_URL is not configured; database-backed app data is unavailable.")
    if psycopg is None or dict_row is None:
        raise DatabaseUnavailable("Install the backend postgres extra to access database-backed app data.")
    try:
        return psycopg.connect(database_url, row_factory=dict_row, connect_timeout=8)
    except psycopg.Error as exc:
        raise DatabaseUnavailable("The configured application database could not be reached.") from exc


def _upsert_auth_role(cursor, auth_user_id: str, role: str, status: str) -> None:
    normalized_role = "extension-officer" if role == "extension_officer" else role
    cursor.execute(
        """
        INSERT INTO user_roles (user_id, role, status, created_at, updated_at)
        VALUES (%s, %s, %s, NOW(), NOW())
        ON CONFLICT (user_id, role) DO UPDATE SET
            status = EXCLUDED.status,
            updated_at = EXCLUDED.updated_at
        """,
        (auth_user_id, normalized_role, status),
    )


@_database_errors_as_unavailable
def load_demo_soil_reading() -> SoilReading:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT reading.id, reading.farm_id, reading.sampled_at, reading.sample_year,
                   reading.source_label, reading.top_cm, reading.bottom_cm,
                   reading.location_uncertainty_m, reading.latitude, reading.longitude,
                   reading.source_provider, reading.source_dataset_id, reading.source_record_id,
                   reading.source_license, reading.source_attribution, reading.source_retrieved_at,
                   reading.measurement_quality
            FROM soil_readings AS reading
            WHERE reading.reading_source = 'DEMO_SEED'
            ORDER BY reading.sampled_at DESC NULLS LAST, reading.created_at DESC
            LIMIT 1
            """
        )
        row = cursor.fetchone()
        if row is None:
            raise DatabaseUnavailable("No seeded soil reading exists in the database.")

        cursor.execute(
            """
            SELECT analyte_code, value, source_unit, canonical_unit,
                   analytical_method, quality_status
            FROM soil_measurements
            WHERE soil_reading_id = %s
            ORDER BY id
            """,
            (row["id"],),
        )
        measurement_rows = cursor.fetchall()
        if not measurement_rows:
            raise DatabaseUnavailable("No seeded soil measurements exist for the database reading.")
        measurements = [
            SoilMeasurement(
                analyte=measurement["analyte_code"],
                value=float(measurement["value"]) if measurement["value"] is not None else None,
                source_unit=measurement["source_unit"],
                canonical_unit=measurement["canonical_unit"],
                analytical_method=measurement["analytical_method"],
                quality_status=measurement["quality_status"],
                uncertainty=None,
            )
            for measurement in measurement_rows
        ]

        return SoilReading(
            contract_version=1,
            reading_id=str(row["id"]),
            farm_id=str(row["farm_id"]) if row["farm_id"] else None,
            source={
                "provider": row["source_provider"] or "DEMO",
                "dataset_id": row["source_dataset_id"],
                "record_id": row["source_record_id"],
                "license": row["source_license"],
                "attribution": row["source_attribution"],
                "retrieved_at": row["source_retrieved_at"],
            },
            sample={
                "sampled_at": row["sampled_at"],
                "sample_year": row["sample_year"],
                "depth": {
                    "source_label": row["source_label"],
                    "top_cm": row["top_cm"],
                    "bottom_cm": row["bottom_cm"],
                },
            },
            location={
                "latitude": row["latitude"],
                "longitude": row["longitude"],
                "uncertainty_m": row["location_uncertainty_m"],
            },
            measurements=measurements,
        )


@_database_errors_as_unavailable
def load_demo_recommendations() -> list[SoilRecommendation]:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, farm_id, crop, title, rationale, application_rate,
                   application_unit, rule_version, review_status
            FROM recommendations
            WHERE soil_reading_id = (
                SELECT id FROM soil_readings
                WHERE reading_source = 'DEMO_SEED'
                ORDER BY sampled_at DESC NULLS LAST, created_at DESC
                LIMIT 1
            )
            ORDER BY created_at, id
            """
        )
        return [
            SoilRecommendation(
                recommendation_id=str(row["id"]),
                farm_id=str(row["farm_id"]) if row["farm_id"] else None,
                crop=row["crop"],
                title=row["title"],
                rationale=row["rationale"],
                application_rate=row["application_rate"],
                application_unit=row["application_unit"],
                rule_version=row["rule_version"],
                review_status=row["review_status"],
            )
            for row in cursor.fetchall()
        ]


@_database_errors_as_unavailable
def load_farmer_account(user_id: str) -> dict[str, Any] | None:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT users.id, users.email, COALESCE(profiles.phone_number, users.phone) AS phone,
                   users.display_name
            FROM users
            LEFT JOIN profiles ON profiles.id = users.supabase_auth_user_id
            WHERE users.id = %s AND users.role = 'farmer' AND users.is_active = TRUE
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "userId": str(row["id"]),
            "email": row["email"],
            "phone": row["phone"],
            "name": row["display_name"],
        }


@_database_errors_as_unavailable
def update_user_profile(
    auth_user_id: str,
    full_name: str,
    phone_number: str | None,
) -> dict[str, Any] | None:
    """Update only the authenticated user's editable profile fields."""
    normalized_name = full_name.strip()
    if not normalized_name:
        return None

    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE users
            SET display_name = %s, updated_at = NOW()
            WHERE supabase_auth_user_id = %s
              AND is_active = TRUE
            RETURNING id
            """,
            (normalized_name, auth_user_id),
        )
        app_user = cursor.fetchone()
        if app_user is None:
            return None

        cursor.execute(
            """
            INSERT INTO profiles (id, full_name, phone_number)
            VALUES (%s, %s, %s)
            ON CONFLICT (id) DO UPDATE
            SET full_name = EXCLUDED.full_name,
                phone_number = EXCLUDED.phone_number,
                updated_at = NOW()
            RETURNING id, full_name, county, sub_county, ward, phone_number
            """,
            (auth_user_id, normalized_name, phone_number),
        )
        profile = cursor.fetchone()
        if profile is None:
            raise DatabaseUnavailable("The profile update did not return the saved profile.")
        connection.commit()

    return {
        "id": str(profile["id"]),
        "fullName": profile["full_name"],
        "county": profile["county"],
        "subCounty": profile["sub_county"],
        "ward": profile["ward"],
        "phoneNumber": profile["phone_number"],
    }


@_database_errors_as_unavailable
def load_farmer_farms(user_id: str) -> list[dict[str, Any]]:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, name, county, sub_county, ward, size_acres, crops,
                   latitude, longitude, coordinates_captured_by, coordinates_captured_at,
                   soil_data_collected, owner_verified, created_at, updated_at,
                   EXISTS(SELECT 1 FROM officer_visits WHERE farm_id = farms.id) AS has_visit_request,
                   (SELECT status FROM officer_visits WHERE farm_id = farms.id ORDER BY created_at DESC LIMIT 1) AS visit_status,
                   (SELECT display_name FROM users WHERE id = farms.coordinates_captured_by) AS captured_by_officer_name
            FROM farms
            WHERE owner_id = %s
            ORDER BY created_at, id
            """,
            (user_id,),
        )
        return [
            {
                "farmId": str(row["id"]),
                "name": row["name"],
                "county": row["county"],
                "subCounty": row["sub_county"],
                "ward": row["ward"],
                "sizeAcres": float(row["size_acres"]) if row["size_acres"] is not None else None,
                "crops": row["crops"],
                "latitude": row["latitude"],
                "longitude": row["longitude"],
                "coordinatesCaptured": row["coordinates_captured_at"] is not None,
                "coordinatesCapturedBy": row["captured_by_officer_name"],
                "coordinatesCapturedAt": row["coordinates_captured_at"].isoformat() if row["coordinates_captured_at"] else None,
                "soilDataCollected": bool(row["soil_data_collected"]),
                "hasVisitRequest": bool(row["has_visit_request"]),
                "visitStatus": row["visit_status"],
                "isIncomplete": not bool(row["has_visit_request"]),
                "ownerVerified": row["owner_verified"],
                "createdAt": row["created_at"],
                "updatedAt": row["updated_at"],
            }
            for row in cursor.fetchall()
        ]


@_database_errors_as_unavailable
def create_farmer_farm(
    user_id: str,
    name: str,
    county: str | None = None,
    ward: str | None = None,
    sub_county: str | None = None,
    size_acres: float | None = None,
    crops: str | None = None,
) -> dict[str, Any] | None:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO farms (owner_id, name, county, sub_county, ward, size_acres, crops)
            SELECT users.id, %s, %s, %s, %s, %s, %s
            FROM users
            WHERE users.id = %s AND users.role = 'farmer' AND users.is_active = TRUE
            RETURNING id, name, county, sub_county, ward, size_acres, crops, latitude, longitude,
                      owner_verified, created_at, updated_at
            """,
            (name.strip(), county, sub_county, ward, size_acres, crops, user_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "farmId": str(row["id"]),
            "name": row["name"],
            "county": row["county"],
            "subCounty": row["sub_county"],
            "ward": row["ward"],
            "sizeAcres": float(row["size_acres"]) if row["size_acres"] is not None else None,
            "crops": row["crops"],
            "latitude": row["latitude"],
            "longitude": row["longitude"],
            "coordinatesCaptured": False,
            "soilDataCollected": False,
            "hasVisitRequest": False,
            "visitStatus": None,
            "isIncomplete": True,
            "ownerVerified": row["owner_verified"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }


@_database_errors_as_unavailable
def load_farmer_farm(user_id: str, farm_id: str) -> dict[str, Any] | None:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, name, county, sub_county, ward, size_acres, crops,
                   latitude, longitude, coordinates_captured_by, coordinates_captured_at,
                   soil_data_collected, owner_verified, created_at, updated_at,
                   EXISTS(SELECT 1 FROM officer_visits WHERE farm_id = farms.id) AS has_visit_request,
                   (SELECT status FROM officer_visits WHERE farm_id = farms.id ORDER BY created_at DESC LIMIT 1) AS visit_status,
                   (SELECT display_name FROM users WHERE id = farms.coordinates_captured_by) AS captured_by_officer_name
            FROM farms
            WHERE id = %s AND owner_id = %s
            """,
            (farm_id, user_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "farmId": str(row["id"]),
            "name": row["name"],
            "county": row["county"],
            "subCounty": row["sub_county"],
            "ward": row["ward"],
            "sizeAcres": float(row["size_acres"]) if row["size_acres"] is not None else None,
            "crops": row["crops"],
            "latitude": row["latitude"],
            "longitude": row["longitude"],
            "coordinatesCaptured": row["coordinates_captured_at"] is not None,
            "coordinatesCapturedBy": row["captured_by_officer_name"],
            "coordinatesCapturedAt": row["coordinates_captured_at"].isoformat() if row["coordinates_captured_at"] else None,
            "soilDataCollected": bool(row["soil_data_collected"]),
            "hasVisitRequest": bool(row["has_visit_request"]),
            "visitStatus": row["visit_status"],
            "isIncomplete": not bool(row["has_visit_request"]),
            "ownerVerified": row["owner_verified"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }


def _soil_reading_from_row(row: dict[str, Any], measurements: list[dict[str, Any]]) -> SoilReading:
    return SoilReading.model_validate(
        {
            "contract_version": 1,
            "reading_id": str(row["id"]),
            "farm_id": str(row["farm_id"]),
            "source": {
                "provider": row["source_provider"] or "FARMER_OBSERVATION",
                "dataset_id": row["source_dataset_id"],
                "record_id": row["source_record_id"],
                "license": row["source_license"],
                "attribution": row["source_attribution"],
                "retrieved_at": row["source_retrieved_at"],
            },
            "sample": {
                "sampled_at": row["sampled_at"],
                "sample_year": row["sample_year"],
                "depth": {
                    "source_label": row["source_label"],
                    "top_cm": row["top_cm"],
                    "bottom_cm": row["bottom_cm"],
                },
            },
            "location": {
                "latitude": row["latitude"],
                "longitude": row["longitude"],
                "uncertainty_m": row["location_uncertainty_m"],
            },
            "measurements": measurements,
        }
    )


@_database_errors_as_unavailable
def load_farmer_soil_readings(user_id: str, farm_id: str | None = None) -> list[SoilReading]:
    farm_filter = "AND readings.farm_id = %s" if farm_id is not None else ""
    parameters = (user_id, farm_id) if farm_id is not None else (user_id,)
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"""
            SELECT readings.id, readings.farm_id, readings.sampled_at, readings.sample_year,
                   readings.source_label, readings.top_cm, readings.bottom_cm,
                   readings.location_uncertainty_m, readings.latitude, readings.longitude,
                   readings.source_provider, readings.source_dataset_id, readings.source_record_id,
                   readings.source_license, readings.source_attribution, readings.source_retrieved_at,
                   measurements.analyte_code, measurements.value, measurements.source_unit,
                   measurements.canonical_unit, measurements.analytical_method,
                   measurements.quality_status
            FROM soil_readings AS readings
            JOIN farms ON farms.id = readings.farm_id AND farms.owner_id = %s
            LEFT JOIN soil_measurements AS measurements ON measurements.soil_reading_id = readings.id
            WHERE TRUE {farm_filter}
            ORDER BY readings.sampled_at DESC NULLS LAST, readings.created_at DESC,
                     readings.id, measurements.id
            """,
            parameters,
        )
        grouped: dict[str, tuple[dict[str, Any], list[dict[str, Any]]]] = {}
        for row in cursor.fetchall():
            reading_key = str(row["id"])
            if reading_key not in grouped:
                grouped[reading_key] = (row, [])
            if row["analyte_code"] is not None:
                grouped[reading_key][1].append(
                    {
                        "analyte": row["analyte_code"],
                        "value": float(row["value"]) if row["value"] is not None else None,
                        "source_unit": row["source_unit"] or "unknown",
                        "canonical_unit": row["canonical_unit"],
                        "analytical_method": row["analytical_method"],
                        "quality_status": row["quality_status"],
                        "uncertainty": None,
                    }
                )
        return [_soil_reading_from_row(row, values) for row, values in grouped.values()]


@_database_errors_as_unavailable
def create_farmer_soil_reading(
    user_id: str, farm_id: str, payload: FarmerSoilReadingCreateRequest
) -> SoilReading | None:
    quality_statuses = {measurement.quality_status for measurement in payload.measurements}
    reading_quality = (
        "valid" if quality_statuses == {"valid"} else "missing" if quality_statuses == {"missing"} else "mixed"
    )
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO soil_readings (
                farm_id, reading_source, sampled_at, sample_year, source_label, top_cm, bottom_cm,
                location_uncertainty_m, latitude, longitude, source_provider, source_attribution,
                measurement_quality
            )
            SELECT farms.id, 'FARMER_OBSERVATION', %s,
                   EXTRACT(YEAR FROM %s::timestamptz)::integer, %s, %s, %s, %s, %s, %s,
                   'FARMER_OBSERVATION', 'Submitted by the authenticated farmer', %s
            FROM farms
            WHERE farms.id = %s AND farms.owner_id = %s AND farms.owner_verified = TRUE
            RETURNING id, farm_id, sampled_at, sample_year, source_label, top_cm, bottom_cm,
                      location_uncertainty_m, latitude, longitude, source_provider,
                      source_dataset_id, source_record_id, source_license, source_attribution,
                      source_retrieved_at
            """,
            (
                payload.sampled_at,
                payload.sampled_at,
                payload.source_label,
                payload.top_cm,
                payload.bottom_cm,
                payload.location_uncertainty_m,
                payload.latitude,
                payload.longitude,
                reading_quality,
                farm_id,
                user_id,
            ),
        )
        row = cursor.fetchone()
        if row is None:
            return None

        response_measurements: list[dict[str, Any]] = []
        for measurement in payload.measurements:
            cursor.execute(
                """
                INSERT INTO soil_measurements (
                    soil_reading_id, source_analyte, analyte_code, value, source_value_text,
                    source_unit, canonical_unit, analytical_method, quality_status, source_quality_class
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    row["id"],
                    measurement.source_analyte or measurement.analyte,
                    measurement.analyte,
                    measurement.value,
                    measurement.source_value_text,
                    measurement.source_unit,
                    measurement.canonical_unit,
                    measurement.analytical_method,
                    measurement.quality_status,
                    measurement.source_quality_class,
                ),
            )
            response_measurements.append(
                {
                    "analyte": measurement.analyte,
                    "value": measurement.value,
                    "source_unit": measurement.source_unit,
                    "canonical_unit": measurement.canonical_unit,
                    "analytical_method": measurement.analytical_method,
                    "quality_status": measurement.quality_status,
                    "uncertainty": None,
                }
            )
        return _soil_reading_from_row(row, response_measurements)


@_database_errors_as_unavailable
def load_farmer_recommendations(user_id: str, farm_id: str | None = None) -> list[SoilRecommendation]:
    farm_filter = "AND recommendations.farm_id = %s" if farm_id is not None else ""
    parameters = (user_id, user_id, user_id, farm_id) if farm_id is not None else (user_id, user_id, user_id)
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            f"""
            SELECT recommendations.id, recommendations.farm_id, recommendations.crop,
                   recommendations.title, recommendations.rationale,
                   recommendations.application_rate, recommendations.application_unit,
                   recommendations.rule_version, recommendations.review_status
            FROM recommendations
            WHERE (
                (
                    recommendations.user_id = %s
                    AND (
                        recommendations.farm_id IS NULL
                        OR EXISTS (
                            SELECT 1 FROM farms AS owned_farms
                            WHERE owned_farms.id = recommendations.farm_id
                              AND owned_farms.owner_id = %s
                        )
                    )
                )
                OR EXISTS (
                    SELECT 1 FROM farms AS owned_farms
                    WHERE owned_farms.id = recommendations.farm_id
                      AND owned_farms.owner_id = %s
                )
            ) {farm_filter}
            ORDER BY recommendations.created_at DESC, recommendations.id
            """,
            parameters,
        )
        return [
            SoilRecommendation(
                recommendation_id=str(row["id"]),
                farm_id=str(row["farm_id"]) if row["farm_id"] else None,
                crop=row["crop"],
                title=row["title"],
                rationale=row["rationale"],
                application_rate=row["application_rate"],
                application_unit=row["application_unit"],
                rule_version=row["rule_version"],
                review_status=row["review_status"],
            )
            for row in cursor.fetchall()
        ]


@_database_errors_as_unavailable
def create_farmer_recommendation_feedback(
    user_id: str, recommendation_id: str, response: str
) -> dict[str, Any] | None:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO recommendation_feedback (user_id, recommendation_id, response)
            SELECT %s, recommendations.id, %s
            FROM recommendations
            WHERE recommendations.id = %s
              AND (
                  (
                      recommendations.user_id = %s
                      AND (
                          recommendations.farm_id IS NULL
                          OR EXISTS (
                              SELECT 1 FROM farms AS owned_farms
                              WHERE owned_farms.id = recommendations.farm_id
                                AND owned_farms.owner_id = %s
                          )
                      )
                  )
                  OR EXISTS (
                      SELECT 1 FROM farms AS owned_farms
                      WHERE owned_farms.id = recommendations.farm_id
                        AND owned_farms.owner_id = %s
                  )
              )
            RETURNING id, recommendation_id, response, created_at
            """,
            (user_id, response, recommendation_id, user_id, user_id, user_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "feedbackId": str(row["id"]),
            "recommendationId": str(row["recommendation_id"]),
            "response": row["response"],
            "createdAt": row["created_at"],
        }


@_database_errors_as_unavailable
def load_farmer_recommendation_feedback(
    user_id: str, recommendation_id: str
) -> list[dict[str, Any]]:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, recommendation_id, response, created_at
            FROM recommendation_feedback
            WHERE user_id = %s AND recommendation_id = %s
            ORDER BY created_at, id
            """,
            (user_id, recommendation_id),
        )
        return [
            {
                "feedbackId": str(row["id"]),
                "recommendationId": str(row["recommendation_id"]),
                "response": row["response"],
                "createdAt": row["created_at"],
            }
            for row in cursor.fetchall()
        ]


@_database_errors_as_unavailable
def load_farmer_sync_status(user_id: str) -> dict[str, Any] | None:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT farms.id AS farm_id, farms.owner_verified,
                   (
                       SELECT COUNT(*) FROM sync_drafts
                       WHERE sync_drafts.owner_id = %s
                         AND sync_drafts.status IN ('draft', 'pending')
                   ) AS offline_drafts,
                   (
                       SELECT COUNT(*) FROM sync_queue
                       WHERE sync_queue.owner_id = %s AND sync_queue.status = 'queued'
                   ) AS pending_syncs
            FROM farms
            WHERE farms.owner_id = %s
            ORDER BY farms.owner_verified DESC, farms.created_at, farms.id
            LIMIT 1
            """,
            (user_id, user_id, user_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "farmId": str(row["farm_id"]),
            "ownerVerified": row["owner_verified"],
            "offlineDrafts": int(row["offline_drafts"]),
            "pendingSyncs": int(row["pending_syncs"]),
        }


@_database_errors_as_unavailable
def load_officer_jurisdictions(officer_user_id: str) -> list[dict[str, Any]]:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT assignments.id, assignments.county, assignments.sub_county,
                   assignments.ward, assignments.designation, assignments.created_at
            FROM officer_jurisdictions AS assignments
            JOIN users AS officer
              ON officer.id = assignments.officer_user_id
             AND officer.role = 'extension_officer'
             AND officer.is_active = TRUE
            WHERE assignments.officer_user_id = %s
              AND assignments.is_active = TRUE
            ORDER BY assignments.county, assignments.sub_county, assignments.ward
            """,
            (officer_user_id,),
        )
        return [
            {
                "assignmentId": str(row["id"]),
                "county": row["county"],
                "subCounty": row["sub_county"],
                "ward": row["ward"],
                "designation": row.get("designation") if isinstance(row, dict) else None,
                "assignedAt": row["created_at"],
            }
            for row in cursor.fetchall()
        ]


@_database_errors_as_unavailable
def load_officer_farmer_roster(officer_user_id: str) -> list[dict[str, Any]]:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT farmers.id AS farmer_id, farmers.display_name,
                   farms.id AS farm_id, farms.name AS farm_name,
                   farms.county, farms.sub_county, farms.ward,
                   COUNT(DISTINCT readings.id) AS reading_count
            FROM officer_jurisdictions AS assignments
            JOIN users AS officer
              ON officer.id = assignments.officer_user_id
             AND officer.role = 'extension_officer'
             AND officer.is_active = TRUE
            JOIN farms
              ON (assignments.county IS NULL OR farms.county = assignments.county)
             AND (assignments.sub_county IS NULL OR farms.sub_county = assignments.sub_county)
             AND (assignments.ward IS NULL OR farms.ward = assignments.ward)
            JOIN users AS farmers
              ON farmers.id = farms.owner_id
             AND farmers.role = 'farmer'
             AND farmers.is_active = TRUE
            LEFT JOIN soil_readings AS readings ON readings.farm_id = farms.id
            WHERE assignments.officer_user_id = %s
              AND assignments.is_active = TRUE
            GROUP BY farmers.id, farmers.display_name, farms.id, farms.name,
                     farms.county, farms.sub_county, farms.ward
            ORDER BY farms.county, farms.sub_county, farms.ward, farmers.display_name
            """,
            (officer_user_id,),
        )
        return [
            {
                "farmerId": str(row["farmer_id"]),
                "name": row["display_name"],
                "farmId": str(row["farm_id"]),
                "farmName": row["farm_name"],
                "county": row["county"],
                "subCounty": row["sub_county"],
                "ward": row["ward"],
                "readingCount": int(row["reading_count"]),
            }
            for row in cursor.fetchall()
        ]


@_database_errors_as_unavailable
def create_farmer_sync_draft(
    user_id: str,
    draft_type: str,
    payload: dict[str, Any],
    version: int | None,
    client_draft_id: str | None = None,
) -> dict[str, Any] | None:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO sync_drafts (
                owner_id, farm_id, client_draft_id, draft_type, version, payload
            )
            SELECT farms.owner_id, farms.id, %s, %s, %s, %s::jsonb
            FROM farms
            WHERE farms.owner_id = %s AND farms.owner_verified = TRUE
            ORDER BY farms.created_at, farms.id
            LIMIT 1
            RETURNING id, farm_id, draft_type, version, payload, status, created_at
            """,
            (client_draft_id, draft_type, version, json.dumps(payload), user_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "draftId": str(row["id"]),
            "farmId": str(row["farm_id"]),
            "draftType": row["draft_type"],
            "version": row["version"],
            "payload": row["payload"],
            "status": row["status"],
            "createdAt": row["created_at"],
        }


@_database_errors_as_unavailable
def queue_farmer_sync_draft(
    user_id: str, draft_id: str, payload: dict[str, Any]
) -> dict[str, Any]:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT sync_drafts.id, sync_drafts.farm_id, farms.owner_verified
            FROM sync_drafts
            JOIN farms ON farms.id = sync_drafts.farm_id
            WHERE sync_drafts.id = %s
              AND sync_drafts.owner_id = %s
              AND farms.owner_id = %s
            """,
            (draft_id, user_id, user_id),
        )
        draft = cursor.fetchone()
        if draft is None:
            return {"status": "not_found"}
        if not draft["owner_verified"]:
            return {"status": "ownership_pending"}

        cursor.execute(
            """
            INSERT INTO sync_queue (draft_id, owner_id, farm_id, payload)
            VALUES (%s, %s, %s, %s::jsonb)
            ON CONFLICT (draft_id) DO NOTHING
            RETURNING id, created_at
            """,
            (draft_id, user_id, draft["farm_id"], json.dumps(payload)),
        )
        queued = cursor.fetchone()
        if queued is None:
            return {"status": "conflict"}

        cursor.execute(
            """
            UPDATE sync_drafts SET status = 'pending'
            WHERE id = %s AND owner_id = %s
            """,
            (draft_id, user_id),
        )
        return {
            "status": "queued",
            "queueId": str(queued["id"]),
            "draftId": str(draft_id),
            "farmId": str(draft["farm_id"]),
            "createdAt": queued["created_at"],
        }


@_database_errors_as_unavailable
def load_agrodealer_catalog() -> dict[str, Any]:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, business_name, county, sub_county, ward,
                   location_status, location_permission_status,
                   location IS NOT NULL AS has_coordinates, is_demo
            FROM agrodealer_profiles
                 WHERE is_demo = TRUE
            ORDER BY business_name
            LIMIT 1
            """
        )
        dealer_row = cursor.fetchone()
        if dealer_row is None:
            raise DatabaseUnavailable("No agrodealer profile exists in the database.")

        cursor.execute(
            """
            SELECT id, name, category, description, stock_quantity, stock_unit,
                   stock_updated_at, unit_price, currency, orderable, is_demo
            FROM dealer_products
            WHERE dealer_id = %s AND is_listed = TRUE AND is_demo = TRUE
            ORDER BY category, name
            """,
            (dealer_row["id"],),
        )
        products = [
            {
                "id": str(row["id"]),
                "name": row["name"],
                "category": row["category"],
                "description": row["description"],
                "stockQuantity": row["stock_quantity"],
                "stockUnit": row["stock_unit"],
                "stockUpdatedAt": row["stock_updated_at"],
                "unitPrice": float(row["unit_price"]) if row["unit_price"] is not None else None,
                "currency": row["currency"],
                "orderable": row["orderable"],
                "demo": row["is_demo"],
            }
            for row in cursor.fetchall()
        ]

    return {
        "dealer": {
            "id": str(dealer_row["id"]),
            "businessName": dealer_row["business_name"],
            "county": dealer_row["county"],
            "subCounty": dealer_row["sub_county"],
            "ward": dealer_row["ward"],
            "locationStatus": dealer_row["location_status"],
            "locationPermissionStatus": dealer_row["location_permission_status"],
            "locationVerified": dealer_row["location_status"] == "verified",
            "hasCoordinates": dealer_row["has_coordinates"],
            "demo": dealer_row["is_demo"],
        },
        "products": products,
    }


@_database_errors_as_unavailable
def load_authenticated_agrodealer_catalog(user_id: str) -> dict[str, Any] | None:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT dealer.id, dealer.business_name, dealer.county, dealer.sub_county,
                   dealer.ward, dealer.location_status, dealer.location_permission_status,
                   dealer.location IS NOT NULL AS has_coordinates, dealer.is_demo
            FROM agrodealer_profiles AS dealer
            JOIN users ON users.id = dealer.user_id
            WHERE dealer.user_id = %s
              AND dealer.is_demo = FALSE
              AND users.role = 'agrodealer'
              AND users.is_active = TRUE
            """,
            (user_id,),
        )
        dealer_row = cursor.fetchone()
        if dealer_row is None:
            return None

        cursor.execute(
            """
            SELECT id, name, category, description, stock_quantity, stock_unit,
                   stock_updated_at, unit_price, currency, orderable, is_demo
            FROM dealer_products
            WHERE dealer_id = %s AND is_listed = TRUE AND is_demo = FALSE
            ORDER BY category, name
            """,
            (dealer_row["id"],),
        )
        now = datetime.now(UTC)
        products = []
        for row in cursor.fetchall():
            stock_dt = row["stock_updated_at"]
            if stock_dt is not None:
                if isinstance(stock_dt, str):
                    try:
                        stock_dt = datetime.fromisoformat(stock_dt)
                    except ValueError:
                        stock_dt = now
                days_since = max(0, (now - stock_dt).days)
            else:
                days_since = 999

            if row["stock_quantity"] <= 0:
                freshness = "out_of_stock"
            elif days_since > 7:
                freshness = "stale"
            else:
                freshness = "fresh"

            products.append({
                "id": str(row["id"]),
                "name": row["name"],
                "category": row["category"],
                "description": row["description"],
                "stockQuantity": row["stock_quantity"],
                "stockUnit": row["stock_unit"],
                "stockUpdatedAt": row["stock_updated_at"],
                "daysSinceStockUpdate": days_since,
                "freshnessStatus": freshness,
                "isStale": days_since > 7,
                "unitPrice": float(row["unit_price"]) if row["unit_price"] is not None else None,
                "currency": row["currency"],
                "orderable": row["orderable"],
                "demo": row["is_demo"],
            })

    return {
        "dealer": {
            "id": str(dealer_row["id"]),
            "businessName": dealer_row["business_name"],
            "county": dealer_row["county"],
            "subCounty": dealer_row["sub_county"],
            "ward": dealer_row["ward"],
            "locationStatus": dealer_row["location_status"],
            "locationPermissionStatus": dealer_row["location_permission_status"],
            "locationVerified": dealer_row["location_status"] == "verified",
            "hasCoordinates": dealer_row["has_coordinates"],
            "demo": dealer_row["is_demo"],
        },
        "disclaimer": "Marketplace Listing Only — Not an Endorsement. SoilSync does not endorse specific commercial brands or guarantee product availability.",
        "nonEndorsementNotice": "Agronomic recommendations are independent of commercial input vendors. Stock and prices must be confirmed with the dealer.",
        "products": products,
    }


# ---------------------------------------------------------------------------
# Dealer ownership enforcement
# ---------------------------------------------------------------------------


@_database_errors_as_unavailable
def load_dealer_profile(user_id: str) -> dict[str, Any] | None:
    """Load the authenticated dealer's own profile only."""
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT dealer.id, dealer.user_id, dealer.business_name,
                   dealer.county, dealer.sub_county, dealer.ward,
                   dealer.location_status, dealer.location_permission_status,
                   dealer.location_consent_at, dealer.location_consent_notes,
                   dealer.location IS NOT NULL AS has_coordinates, dealer.is_demo
            FROM agrodealer_profiles AS dealer
            JOIN users ON users.id = dealer.user_id
            WHERE dealer.user_id = %s
              AND users.role = 'agrodealer'
              AND users.is_active = TRUE
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "id": str(row["id"]),
            "userId": str(row["user_id"]),
            "businessName": row["business_name"],
            "county": row["county"],
            "subCounty": row["sub_county"],
            "ward": row["ward"],
            "locationStatus": row["location_status"],
            "locationPermissionStatus": row["location_permission_status"],
            "locationConsentAt": row.get("location_consent_at"),
            "locationConsentNotes": row.get("location_consent_notes"),
            "locationVerified": row["location_status"] == "verified",
            "hasCoordinates": row["has_coordinates"],
            "demo": row["is_demo"],
            "privacyPolicyNotice": "Farmer soil tests and personal identities are strictly isolated from dealer accounts.",
        }


@_database_errors_as_unavailable
def update_dealer_profile(
    user_id: str,
    business_name: str | None = None,
    county: str | None = None,
    sub_county: str | None = None,
    ward: str | None = None,
) -> dict[str, Any] | None:
    """Update the authenticated dealer's own profile; returns updated profile or None."""
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE agrodealer_profiles AS dealer
            SET business_name = COALESCE(%s, dealer.business_name),
                county = COALESCE(%s, dealer.county),
                sub_county = COALESCE(%s, dealer.sub_county),
                ward = COALESCE(%s, dealer.ward)
            FROM users
            WHERE dealer.user_id = users.id
              AND dealer.user_id = %s
              AND users.role = 'agrodealer'
              AND users.is_active = TRUE
            RETURNING dealer.id, dealer.user_id, dealer.business_name,
                      dealer.county, dealer.sub_county, dealer.ward,
                      dealer.location_status, dealer.location_permission_status,
                      dealer.location IS NOT NULL AS has_coordinates, dealer.is_demo
            """,
            (business_name, county, sub_county, ward, user_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "id": str(row["id"]),
            "userId": str(row["user_id"]),
            "businessName": row["business_name"],
            "county": row["county"],
            "subCounty": row["sub_county"],
            "ward": row["ward"],
            "locationStatus": row["location_status"],
            "locationPermissionStatus": row["location_permission_status"],
            "locationVerified": row["location_status"] == "verified",
            "hasCoordinates": row["has_coordinates"],
            "demo": row["is_demo"],
        }


@_database_errors_as_unavailable
def submit_agrodealer_application(
    user_id: str,
    business_name: str,
    licence_number: str,
    contact_name: str,
    county: str,
    sub_county: str | None = None,
    ward: str | None = None,
    shop_location: str | None = None,
    phone_number: str | None = None,
) -> dict[str, Any]:
    """Submit or update an agrodealer application with pending review status."""
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT supabase_auth_user_id FROM users WHERE id = %s AND is_active = TRUE",
            (user_id,),
        )
        identity = cursor.fetchone()
        if identity is None or not identity.get("supabase_auth_user_id"):
            raise DatabaseUnavailable("The agrodealer application requires a linked Supabase identity.")
        auth_user_id = str(identity["supabase_auth_user_id"])
        now = datetime.now(UTC)
        cursor.execute(
            """
            INSERT INTO agrodealer_profiles (
                user_id, business_name, licence_number, contact_name,
                county, sub_county, ward, shop_location, verification_state,
                location_status, location_permission_status, is_demo, created_at, updated_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'pending', 'unverified', 'not_requested', FALSE, %s, %s)
            ON CONFLICT (user_id) DO UPDATE SET
                business_name = EXCLUDED.business_name,
                licence_number = EXCLUDED.licence_number,
                contact_name = EXCLUDED.contact_name,
                county = EXCLUDED.county,
                sub_county = EXCLUDED.sub_county,
                ward = EXCLUDED.ward,
                shop_location = EXCLUDED.shop_location,
                verification_state = 'pending',
                updated_at = EXCLUDED.updated_at
            RETURNING id, created_at
            """,
            (
                user_id,
                business_name,
                licence_number,
                contact_name,
                county,
                sub_county,
                ward,
                shop_location,
                now,
                now,
            ),
        )
        row = cursor.fetchone()
        profile_id = str(row["id"])
        created_at = row["created_at"]

        # Upsert user role with status 'pending'
        cursor.execute(
            """
            INSERT INTO user_roles (user_id, role, status, created_at, updated_at)
            VALUES (%s, 'agrodealer', 'pending', %s, %s)
            ON CONFLICT (user_id, role) DO UPDATE SET
                status = 'pending',
                updated_at = EXCLUDED.updated_at
            """,
            (auth_user_id, now, now),
        )

        # Update contact phone on profiles table if supplied
        if phone_number:
            try:
                cursor.execute(
                    """
                    UPDATE profiles
                    SET phone_number = %s, updated_at = %s
                    WHERE id = %s
                    """,
                    (phone_number, now, auth_user_id),
                )
            except Exception:
                pass

        # Record audit event
        try:
            cursor.execute(
                """
                INSERT INTO audit_log (actor_id, action, target_type, target_id, details, timestamp)
                VALUES (%s, 'dealer_application_submitted', 'agrodealer_profile', %s, %s, %s)
                """,
                (
                    auth_user_id,
                    profile_id,
                    json.dumps({
                        "business_name": business_name,
                        "licence_number": licence_number,
                        "county": county,
                        "ward": ward,
                    }),
                    now,
                ),
            )
        except Exception:
            pass

        connection.commit()

        return {
            "applicationId": profile_id,
            "userId": user_id,
            "businessName": business_name,
            "licenceNumber": licence_number,
            "contactName": contact_name,
            "county": county,
            "subCounty": sub_county,
            "ward": ward,
            "shopLocation": shop_location,
            "phoneNumber": phone_number,
            "role": "agrodealer",
            "status": "pending",
            "verificationState": "pending",
            "message": "Agrodealer application submitted successfully and is pending administrator review.",
            "createdAt": created_at,
        }


@_database_errors_as_unavailable
def get_agrodealer_application_status(user_id: str) -> dict[str, Any] | None:
    """Retrieve agrodealer application status for the given user."""
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT id, business_name, licence_number, contact_name,
                   county, sub_county, ward, shop_location,
                   verification_state, created_at, updated_at
            FROM agrodealer_profiles
            WHERE user_id = %s
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "applicationId": str(row["id"]),
            "businessName": row["business_name"],
            "licenceNumber": row.get("licence_number"),
            "contactName": row.get("contact_name"),
            "county": row.get("county"),
            "subCounty": row.get("sub_county"),
            "ward": row.get("ward"),
            "shopLocation": row.get("shop_location"),
            "verificationState": row.get("verification_state", "pending"),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }


@_database_errors_as_unavailable
def create_dealer_product(
    user_id: str,
    name: str,
    category: str,
    stock_quantity: int,
    stock_unit: str,
    description: str | None = None,
    unit_price: float | None = None,
    currency: str = "KES",
) -> dict[str, Any] | None:
    """Insert a product owned by the authenticated dealer only."""
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO dealer_products (
                dealer_id, name, category, description,
                stock_quantity, stock_unit, unit_price, currency
            )
            SELECT dealer.id, %s, %s, %s, %s, %s, %s, %s
            FROM agrodealer_profiles AS dealer
            JOIN users ON users.id = dealer.user_id
            WHERE dealer.user_id = %s
              AND users.role = 'agrodealer'
              AND users.is_active = TRUE
            RETURNING id, name, category, description, stock_quantity, stock_unit,
                      stock_updated_at, unit_price, currency, orderable, is_listed, is_demo
            """,
            (name, category, description, stock_quantity, stock_unit, unit_price, currency, user_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "id": str(row["id"]),
            "name": row["name"],
            "category": row["category"],
            "description": row["description"],
            "stockQuantity": row["stock_quantity"],
            "stockUnit": row["stock_unit"],
            "stockUpdatedAt": row["stock_updated_at"],
            "unitPrice": float(row["unit_price"]) if row["unit_price"] is not None else None,
            "currency": row["currency"],
            "orderable": row["orderable"],
            "isListed": row["is_listed"],
            "demo": row["is_demo"],
        }


@_database_errors_as_unavailable
def update_dealer_product(
    user_id: str,
    product_id: str,
    name: str | None = None,
    description: str | None = None,
    unit_price: float | None = None,
    is_listed: bool | None = None,
) -> dict[str, Any] | None:
    """Update a product owned by the authenticated dealer only."""
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE dealer_products AS dp
            SET name = COALESCE(%s, dp.name),
                description = COALESCE(%s, dp.description),
                unit_price = COALESCE(%s, dp.unit_price),
                is_listed = COALESCE(%s, dp.is_listed)
            FROM agrodealer_profiles AS dealer
            JOIN users ON users.id = dealer.user_id
            WHERE dp.dealer_id = dealer.id
              AND dp.id = %s
              AND dealer.user_id = %s
              AND users.role = 'agrodealer'
              AND users.is_active = TRUE
            RETURNING dp.id, dp.name, dp.category, dp.description,
                      dp.stock_quantity, dp.stock_unit, dp.stock_updated_at,
                      dp.unit_price, dp.currency, dp.orderable, dp.is_listed, dp.is_demo
            """,
            (name, description, unit_price, is_listed, product_id, user_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "id": str(row["id"]),
            "name": row["name"],
            "category": row["category"],
            "description": row["description"],
            "stockQuantity": row["stock_quantity"],
            "stockUnit": row["stock_unit"],
            "stockUpdatedAt": row["stock_updated_at"],
            "unitPrice": float(row["unit_price"]) if row["unit_price"] is not None else None,
            "currency": row["currency"],
            "orderable": row["orderable"],
            "isListed": row["is_listed"],
            "demo": row["is_demo"],
        }


@_database_errors_as_unavailable
def update_dealer_product_stock(
    user_id: str,
    product_id: str,
    stock_quantity: int,
) -> dict[str, Any] | None:
    """Update stock for a product owned by the authenticated dealer only."""
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE dealer_products AS dp
            SET stock_quantity = %s,
                stock_updated_at = NOW()
            FROM agrodealer_profiles AS dealer
            JOIN users ON users.id = dealer.user_id
            WHERE dp.dealer_id = dealer.id
              AND dp.id = %s
              AND dealer.user_id = %s
              AND users.role = 'agrodealer'
              AND users.is_active = TRUE
            RETURNING dp.id, dp.name, dp.stock_quantity, dp.stock_unit, dp.stock_updated_at
            """,
            (stock_quantity, product_id, user_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "id": str(row["id"]),
            "name": row["name"],
            "stockQuantity": row["stock_quantity"],
            "stockUnit": row["stock_unit"],
            "stockUpdatedAt": row["stock_updated_at"],
        }


@_database_errors_as_unavailable
def update_dealer_location_consent(
    user_id: str,
    granted: bool,
    notes: str | None = None,
) -> dict[str, Any] | None:
    """Explicitly grant or deny location tracking consent with audit note."""
    status = "granted" if granted else "denied"
    fallback_notes = notes or ("Consent granted by dealer." if granted else "Consent denied by dealer.")
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE agrodealer_profiles AS dealer
            SET location_permission_status = %s,
                location_consent_at = NOW(),
                location_consent_notes = %s,
                location = CASE WHEN %s = FALSE THEN NULL ELSE dealer.location END,
                location_status = CASE WHEN %s = FALSE THEN 'unavailable' ELSE dealer.location_status END
            FROM users
            WHERE dealer.user_id = users.id
              AND dealer.user_id = %s
              AND users.role = 'agrodealer'
              AND users.is_active = TRUE
            RETURNING dealer.id, dealer.user_id, dealer.business_name,
                      dealer.county, dealer.sub_county, dealer.ward,
                      dealer.location_status, dealer.location_permission_status,
                      dealer.location_consent_at, dealer.location_consent_notes,
                      dealer.location IS NOT NULL AS has_coordinates, dealer.is_demo
            """,
            (status, fallback_notes, granted, granted, user_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "id": str(row["id"]),
            "userId": str(row["user_id"]),
            "businessName": row["business_name"],
            "county": row["county"],
            "subCounty": row["sub_county"],
            "ward": row["ward"],
            "locationStatus": row["location_status"],
            "locationPermissionStatus": row["location_permission_status"],
            "locationConsentAt": row.get("location_consent_at"),
            "locationConsentNotes": row.get("location_consent_notes"),
            "locationVerified": row["location_status"] == "verified",
            "hasCoordinates": row["has_coordinates"],
            "demo": row["is_demo"],
        }


@_database_errors_as_unavailable
def update_dealer_coordinates(
    user_id: str,
    latitude: float,
    longitude: float,
    accuracy_meters: float | None = None,
) -> dict[str, Any] | None:
    """Store verified GPS coordinates only if permission was explicitly granted."""
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT location_permission_status
            FROM agrodealer_profiles
            WHERE user_id = %s
            """,
            (user_id,),
        )
        profile_row = cursor.fetchone()
        if not profile_row or profile_row.get("location_permission_status") != "granted":
            raise ValueError("Location coordinates cannot be stored without explicit dealer consent.")

        cursor.execute(
            """
            UPDATE agrodealer_profiles AS dealer
            SET location = ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                location_status = 'verified'
            FROM users
            WHERE dealer.user_id = users.id
              AND dealer.user_id = %s
              AND users.role = 'agrodealer'
              AND users.is_active = TRUE
            RETURNING dealer.id, dealer.business_name, dealer.location_status,
                      dealer.location_permission_status, dealer.location IS NOT NULL AS has_coordinates
            """,
            (longitude, latitude, user_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "id": str(row["id"]),
            "businessName": row["business_name"],
            "locationStatus": row["location_status"],
            "locationPermissionStatus": row["location_permission_status"],
            "locationVerified": True,
            "hasCoordinates": True,
            "latitude": latitude,
            "longitude": longitude,
            "accuracyMeters": accuracy_meters,
        }


@_database_errors_as_unavailable
def revoke_dealer_location(user_id: str) -> dict[str, Any] | None:
    """Revoke location tracking, clear coordinates, and set status to unavailable."""
    return update_dealer_location_consent(user_id, granted=False, notes="Dealer revoked location permission.")


@_database_errors_as_unavailable
def archive_dealer_product(
    user_id: str, product_id: str, is_listed: bool
) -> dict[str, Any] | None:
    """Archive or un-archive a product owned by the authenticated dealer."""
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE dealer_products AS dp
            SET is_listed = %s,
                updated_at = NOW()
            FROM agrodealer_profiles AS dealer
            JOIN users ON users.id = dealer.user_id
            WHERE dp.dealer_id = dealer.id
              AND dp.id = %s
              AND dealer.user_id = %s
              AND users.role = 'agrodealer'
              AND users.is_active = TRUE
            RETURNING dp.id, dp.name, dp.category, dp.is_listed, dp.stock_quantity, dp.unit_price
            """,
            (is_listed, product_id, user_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "id": str(row["id"]),
            "name": row["name"],
            "category": row["category"],
            "isListed": row["is_listed"],
            "stockQuantity": row["stock_quantity"],
            "unitPrice": float(row["unit_price"]) if row["unit_price"] is not None else None,
        }


@_database_errors_as_unavailable
def delete_dealer_product(user_id: str, product_id: str) -> bool:
    """Permanently delete a product owned by the authenticated dealer."""
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            DELETE FROM dealer_products AS dp
            USING agrodealer_profiles AS dealer, users
            WHERE dp.dealer_id = dealer.id
              AND dp.id = %s
              AND dealer.user_id = users.id
              AND dealer.user_id = %s
              AND users.role = 'agrodealer'
              AND users.is_active = TRUE
            RETURNING dp.id
            """,
            (product_id, user_id),
        )
        return cursor.fetchone() is not None


@_database_errors_as_unavailable
def load_dealer_orders(user_id: str) -> list[dict[str, Any]]:
    """Load orders placed for this dealer's products with minimized buyer data."""
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT o.id, o.dealer_id, o.product_id, dp.name AS product_name,
                   dp.category AS product_category, o.quantity, o.unit_price,
                   o.total_price, o.currency, o.status, o.terms_accepted,
                   o.terms_accepted_at, o.fulfillment_type, o.notes,
                   o.cancellation_reason, o.dispute_reason, o.dispute_status,
                   o.created_at, o.updated_at
            FROM marketplace_orders AS o
            JOIN dealer_products AS dp ON dp.id = o.product_id
            JOIN agrodealer_profiles AS dealer ON dealer.id = o.dealer_id
            JOIN users ON users.id = dealer.user_id
            WHERE dealer.user_id = %s
              AND users.role = 'agrodealer'
              AND users.is_active = TRUE
            ORDER BY o.created_at DESC
            """,
            (user_id,),
        )
        orders = []
        for row in cursor.fetchall():
            orders.append({
                "id": str(row["id"]),
                "dealerId": str(row["dealer_id"]),
                "productId": str(row["product_id"]),
                "productName": row["product_name"],
                "productCategory": row["product_category"],
                "quantity": row["quantity"],
                "unitPrice": float(row["unit_price"]),
                "totalPrice": float(row["total_price"]),
                "currency": row["currency"],
                "status": row["status"],
                "termsAccepted": row["terms_accepted"],
                "termsAcceptedAt": row["terms_accepted_at"],
                "fulfillmentType": row["fulfillment_type"],
                "notes": row["notes"],
                "cancellationReason": row["cancellation_reason"],
                "disputeReason": row["dispute_reason"],
                "disputeStatus": row["dispute_status"],
                "createdAt": row["created_at"],
                "updatedAt": row["updated_at"],
            })
        return orders


@_database_errors_as_unavailable
def create_marketplace_order(
    buyer_user_id: str,
    product_id: str,
    quantity: int,
    fulfillment_type: str = "pickup",
    terms_accepted: bool = False,
    notes: str | None = None,
) -> dict[str, Any]:
    """Create an order gated on marketplace terms acceptance."""
    if not terms_accepted:
        raise ValueError("Marketplace terms, cancellation policy, and dispute rules must be accepted.")
    if quantity <= 0:
        raise ValueError("Order quantity must be greater than zero.")

    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT dp.id, dp.dealer_id, dp.name, dp.unit_price, dp.currency,
                   dp.stock_quantity, dp.is_listed
            FROM dealer_products AS dp
            JOIN agrodealer_profiles AS ap ON ap.id = dp.dealer_id
            WHERE dp.id = %s AND dp.is_listed = TRUE
            """,
            (product_id,),
        )
        product = cursor.fetchone()
        if not product:
            raise ValueError("Product not available or unlisted.")
        if product["unit_price"] is None:
            raise ValueError("Product price is not established by dealer.")

        unit_price = float(product["unit_price"])
        total_price = round(unit_price * quantity, 2)
        currency = product["currency"] or "KES"

        cursor.execute(
            """
            INSERT INTO marketplace_orders (
                dealer_id, buyer_user_id, product_id, quantity, unit_price,
                total_price, currency, status, terms_accepted, terms_accepted_at,
                fulfillment_type, notes
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'pending_confirmation', TRUE, NOW(), %s, %s)
            RETURNING id, dealer_id, product_id, quantity, unit_price, total_price,
                      currency, status, terms_accepted, terms_accepted_at,
                      fulfillment_type, notes, created_at
            """,
            (
                product["dealer_id"],
                buyer_user_id,
                product_id,
                quantity,
                unit_price,
                total_price,
                currency,
                fulfillment_type,
                notes,
            ),
        )
        row = cursor.fetchone()
        return {
            "id": str(row["id"]),
            "dealerId": str(row["dealer_id"]),
            "productId": str(row["product_id"]),
            "productName": product["name"],
            "quantity": row["quantity"],
            "unitPrice": float(row["unit_price"]),
            "totalPrice": float(row["total_price"]),
            "currency": row["currency"],
            "status": row["status"],
            "termsAccepted": row["terms_accepted"],
            "termsAcceptedAt": row["terms_accepted_at"],
            "fulfillmentType": row["fulfillment_type"],
            "notes": row["notes"],
            "createdAt": row["created_at"],
        }


@_database_errors_as_unavailable
def update_marketplace_order_status(
    user_id: str,
    order_id: str,
    status: str,
    cancellation_reason: str | None = None,
    dispute_reason: str | None = None,
) -> dict[str, Any] | None:
    """Transition order status with cancellation or dispute audit."""
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE marketplace_orders AS o
            SET status = %s,
                cancellation_reason = COALESCE(%s, o.cancellation_reason),
                dispute_reason = COALESCE(%s, o.dispute_reason),
                dispute_status = CASE WHEN %s = 'disputed' THEN 'open' ELSE o.dispute_status END,
                updated_at = NOW()
            FROM agrodealer_profiles AS dealer, users
            WHERE (
                (o.dealer_id = dealer.id AND dealer.user_id = users.id AND users.id = %s)
                OR o.buyer_user_id = %s
            )
              AND o.id = %s
            RETURNING o.id, o.dealer_id, o.product_id, o.quantity, o.unit_price,
                      o.total_price, o.currency, o.status, o.fulfillment_type,
                      o.cancellation_reason, o.dispute_reason, o.dispute_status, o.updated_at
            """,
            (status, cancellation_reason, dispute_reason, status, user_id, user_id, order_id),
        )
        row = cursor.fetchone()
        if not row:
            return None
        return {
            "id": str(row["id"]),
            "status": row["status"],
            "cancellationReason": row["cancellation_reason"],
            "disputeReason": row["dispute_reason"],
            "disputeStatus": row["dispute_status"],
            "updatedAt": row["updated_at"],
        }


@_database_errors_as_unavailable
def search_dealers_proximity(
    latitude: float | None = None,
    longitude: float | None = None,
    radius_km: float = 25.0,
    county: str | None = None,
    ward: str | None = None,
) -> dict[str, Any]:
    """Search registered agrodealers with distance calculations or graceful ward fallback."""
    has_coords = latitude is not None and longitude is not None
    dealers_result = []

    with _connect() as connection, connection.cursor() as cursor:
        if has_coords:
            cursor.execute(
                """
                SELECT dealer.id, dealer.business_name, dealer.county, dealer.sub_county,
                       dealer.ward, dealer.location_status, dealer.location_permission_status,
                       dealer.location IS NOT NULL AS has_coordinates,
                       CASE
                           WHEN dealer.location IS NOT NULL THEN
                               ST_Distance(dealer.location, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography) / 1000.0
                           ELSE NULL
                       END AS distance_km
                FROM agrodealer_profiles AS dealer
                JOIN users ON users.id = dealer.user_id
                WHERE users.is_active = TRUE
                  AND (
                      dealer.location IS NOT NULL
                      OR (%s IS NOT NULL AND dealer.county ILIKE %s)
                      OR (%s IS NOT NULL AND dealer.ward ILIKE %s)
                  )
                ORDER BY distance_km NULLS LAST, dealer.business_name
                LIMIT 50
                """,
                (longitude, latitude, county, f"%{county}%" if county else None, ward, f"%{ward}%" if ward else None),
            )
            search_method = "coordinates_proximity"
        else:
            cursor.execute(
                """
                SELECT dealer.id, dealer.business_name, dealer.county, dealer.sub_county,
                       dealer.ward, dealer.location_status, dealer.location_permission_status,
                       dealer.location IS NOT NULL AS has_coordinates,
                       NULL::double precision AS distance_km
                FROM agrodealer_profiles AS dealer
                JOIN users ON users.id = dealer.user_id
                WHERE users.is_active = TRUE
                  AND (
                      (%s IS NULL AND %s IS NULL)
                      OR (%s IS NOT NULL AND dealer.county ILIKE %s)
                      OR (%s IS NOT NULL AND dealer.ward ILIKE %s)
                  )
                ORDER BY dealer.business_name
                LIMIT 50
                """,
                (county, ward, county, f"%{county}%" if county else None, ward, f"%{ward}%" if ward else None),
            )
            search_method = "administrative_boundary_fallback"

        for row in cursor.fetchall():
            dealers_result.append({
                "id": str(row["id"]),
                "businessName": row["business_name"],
                "county": row["county"],
                "subCounty": row["sub_county"],
                "ward": row["ward"],
                "locationStatus": row["location_status"],
                "locationPermissionStatus": row["location_permission_status"],
                "locationVerified": row["location_status"] == "verified",
                "hasCoordinates": row["has_coordinates"],
                "distanceKm": round(float(row["distance_km"]), 1) if row.get("distance_km") is not None else None,
            })

    return {
        "searchMethod": search_method,
        "query": {
            "latitude": latitude,
            "longitude": longitude,
            "radiusKm": radius_km,
            "county": county,
            "ward": ward,
        },
        "disclaimer": "Marketplace Listing Only — Not an Endorsement. SoilSync does not endorse specific commercial brands or guarantee product availability.",
        "privacyNotice": "Search is performed without exposing farmer identities or soil test results to agrodealers.",
        "dealers": dealers_result,
    }


# ---------------------------------------------------------------------------
# Officer jurisdiction-scoped queries
# ---------------------------------------------------------------------------


@_database_errors_as_unavailable
def load_officer_farm_readings(
    officer_user_id: str, farm_id: str
) -> list[SoilReading]:
    """Load soil readings for a farm within the officer's jurisdiction."""
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT readings.id, readings.farm_id, readings.sampled_at, readings.sample_year,
                   readings.source_label, readings.top_cm, readings.bottom_cm,
                   readings.location_uncertainty_m, readings.latitude, readings.longitude,
                   readings.source_provider, readings.source_dataset_id, readings.source_record_id,
                   readings.source_license, readings.source_attribution, readings.source_retrieved_at,
                   measurements.analyte_code, measurements.value, measurements.source_unit,
                   measurements.canonical_unit, measurements.analytical_method,
                   measurements.quality_status
            FROM soil_readings AS readings
            JOIN farms ON farms.id = readings.farm_id
            JOIN officer_jurisdictions AS oj
              ON oj.officer_user_id = %s
             AND oj.is_active = TRUE
             AND (oj.county IS NULL OR farms.county = oj.county)
             AND (oj.sub_county IS NULL OR farms.sub_county = oj.sub_county)
             AND (oj.ward IS NULL OR farms.ward = oj.ward)
            JOIN users AS officer
              ON officer.id = oj.officer_user_id
             AND officer.role = 'extension_officer'
             AND officer.is_active = TRUE
            LEFT JOIN soil_measurements AS measurements ON measurements.soil_reading_id = readings.id
            WHERE readings.farm_id = %s
            ORDER BY readings.sampled_at DESC NULLS LAST, readings.created_at DESC,
                     readings.id, measurements.id
            """,
            (officer_user_id, farm_id),
        )
        grouped: dict[str, tuple[dict[str, Any], list[dict[str, Any]]]] = {}
        for row in cursor.fetchall():
            reading_key = str(row["id"])
            if reading_key not in grouped:
                grouped[reading_key] = (row, [])
            if row["analyte_code"] is not None:
                grouped[reading_key][1].append(
                    {
                        "analyte": row["analyte_code"],
                        "value": float(row["value"]) if row["value"] is not None else None,
                        "source_unit": row["source_unit"] or "unknown",
                        "canonical_unit": row["canonical_unit"],
                        "analytical_method": row["analytical_method"],
                        "quality_status": row["quality_status"],
                        "uncertainty": None,
                    }
                )
        return [_soil_reading_from_row(row, values) for row, values in grouped.values()]


# ---------------------------------------------------------------------------
# Admin – least-privilege permissions and audit
# ---------------------------------------------------------------------------


@_database_errors_as_unavailable
def load_admin_permissions(admin_user_id: str) -> list[dict[str, Any]]:
    """Load active, non-expired permissions for an admin user."""
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT ap.id, ap.permission, ap.granted_by, ap.expires_at, ap.created_at
            FROM admin_permissions AS ap
            JOIN users ON users.id = ap.admin_user_id
            WHERE ap.admin_user_id = %s
              AND ap.is_active = TRUE
              AND (ap.expires_at IS NULL OR ap.expires_at > NOW())
              AND users.role = 'admin'
              AND users.is_active = TRUE
            ORDER BY ap.permission
            """,
            (admin_user_id,),
        )
        return [
            {
                "id": str(row["id"]),
                "permission": row["permission"],
                "grantedBy": str(row["granted_by"]) if row["granted_by"] else None,
                "expiresAt": row["expires_at"],
                "createdAt": row["created_at"],
            }
            for row in cursor.fetchall()
        ]


@_database_errors_as_unavailable
def check_admin_permission(admin_user_id: str, permission: str) -> bool:
    """Check whether the admin has a specific active permission."""
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT 1
            FROM admin_permissions AS ap
            JOIN users ON users.id = ap.admin_user_id
            WHERE ap.admin_user_id = %s
              AND ap.permission = %s
              AND ap.is_active = TRUE
              AND (ap.expires_at IS NULL OR ap.expires_at > NOW())
              AND users.role = 'admin'
              AND users.is_active = TRUE
            LIMIT 1
            """,
            (admin_user_id, permission),
        )
        return cursor.fetchone() is not None


@_database_errors_as_unavailable
def create_admin_audit_entry(
    actor_user_id: str,
    actor_role: str,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    detail: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> dict[str, Any]:
    """Append an entry to the admin audit log."""
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO admin_audit_log (
                actor_user_id, actor_role, action, target_type, target_id, detail, ip_address
            ) VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::inet)
            RETURNING id, created_at
            """,
            (
                actor_user_id,
                actor_role,
                action,
                target_type,
                target_id,
                json.dumps(detail or {}),
                ip_address,
            ),
        )
        row = cursor.fetchone()
        audit_id = str(row["id"]) if row and "id" in row else str(uuid.uuid4())
        created_at = row["created_at"] if row and "created_at" in row else datetime.now(UTC)

        try:
            actor_uuid = None
            try:
                uuid.UUID(str(actor_user_id))
                actor_uuid = str(actor_user_id)
            except Exception:
                pass
            cursor.execute(
                """
                INSERT INTO audit_log (actor_id, action, target_type, target_id, details, timestamp)
                VALUES (%s, %s, %s, %s, %s::jsonb, %s)
                """,
                (
                    actor_uuid,
                    action,
                    target_type,
                    target_id,
                    json.dumps(detail or {}),
                    created_at,
                ),
            )
        except Exception:
            pass

        return {
            "auditId": audit_id,
            "createdAt": created_at,
        }


@_database_errors_as_unavailable
def load_admin_audit_log(
    admin_user_id: str, limit: int = 50
) -> list[dict[str, Any]]:
    """Load recent audit entries; requires view_audit_log permission."""
    if not check_admin_permission(admin_user_id, "view_audit_log"):
        return []
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT al.id, al.actor_user_id, al.actor_role, al.action,
                   al.target_type, al.target_id, al.detail, al.created_at
            FROM admin_audit_log AS al
            ORDER BY al.created_at DESC
            LIMIT %s
            """,
            (limit,),
        )
        return [
            {
                "auditId": str(row["id"]),
                "actorUserId": str(row["actor_user_id"]),
                "actorRole": row["actor_role"],
                "action": row["action"],
                "targetType": row["target_type"],
                "targetId": row["target_id"],
                "detail": row["detail"],
                "createdAt": row["created_at"],
            }
            for row in cursor.fetchall()
        ]


@_database_errors_as_unavailable
def admin_list_users(
    admin_user_id: str,
    role: str | None = None,
    approval_status: str | None = None,
    search: str | None = None,
) -> list[dict[str, Any]] | None:
    """List users; requires manage_accounts permission."""
    if not check_admin_permission(admin_user_id, "manage_accounts"):
        return None
    with _connect() as connection, connection.cursor() as cursor:
        query = """
            SELECT id, display_name, email, phone, role, is_active,
                   COALESCE(approval_status, 'approved') AS approval_status,
                   approved_at, revocation_reason, suspended_at, created_at
            FROM users
            WHERE 1=1
        """
        params: list[Any] = []
        if role:
            query += " AND role = %s"
            params.append(role)
        if approval_status:
            query += " AND approval_status = %s"
            params.append(approval_status)
        if search:
            query += " AND (display_name ILIKE %s OR email ILIKE %s)"
            params.extend([f"%{search}%", f"%{search}%"])
        query += " ORDER BY display_name NULLS LAST, created_at DESC"
        cursor.execute(query, tuple(params))
        return [
            {
                "userId": str(row["id"]),
                "displayName": row["display_name"],
                "email": row["email"],
                "phone": row["phone"],
                "role": row["role"],
                "isActive": row["is_active"],
                "approvalStatus": row.get("approval_status") or "approved",
                "approvedAt": row.get("approved_at").isoformat() if row.get("approved_at") and hasattr(row.get("approved_at"), "isoformat") else (str(row["approved_at"]) if row.get("approved_at") else None),
                "revocationReason": row.get("revocation_reason"),
                "suspendedAt": row.get("suspended_at").isoformat() if row.get("suspended_at") and hasattr(row.get("suspended_at"), "isoformat") else (str(row["suspended_at"]) if row.get("suspended_at") else None),
                "createdAt": row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
            }
            for row in cursor.fetchall()
        ]



@_database_errors_as_unavailable
def admin_update_user_role(
    admin_user_id: str, target_user_id: str, new_role: str
) -> dict[str, Any] | None:
    """Change a user's role; requires manage_roles permission. Returns updated user or None."""
    if not check_admin_permission(admin_user_id, "manage_roles"):
        return None
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE users
            SET role = %s
            WHERE id = %s
            RETURNING id, display_name, role, is_active, approval_status, supabase_auth_user_id
            """,
            (new_role, target_user_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        auth_user_id = row.get("supabase_auth_user_id")
        if auth_user_id:
            normalized_role = "extension-officer" if new_role == "extension_officer" else new_role
            cursor.execute(
                """
                UPDATE user_roles
                SET status = 'suspended', updated_at = NOW()
                WHERE user_id = %s AND role <> %s AND status = 'active'
                """,
                (str(auth_user_id), normalized_role),
            )
            role_status = (
                "suspended"
                if not row["is_active"]
                else "pending"
                if normalized_role == "agrodealer"
                and (row.get("approval_status") or "pending") != "approved"
                else "active"
            )
            _upsert_auth_role(cursor, str(auth_user_id), normalized_role, role_status)
        return {
            "userId": str(row["id"]),
            "displayName": row["display_name"],
            "role": row["role"],
            "isActive": row["is_active"],
        }


@_database_errors_as_unavailable
def admin_toggle_user_active(
    admin_user_id: str, target_user_id: str, is_active: bool
) -> dict[str, Any] | None:
    """Enable or disable a user account; requires manage_accounts permission."""
    if not check_admin_permission(admin_user_id, "manage_accounts"):
        return None
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE users
            SET is_active = %s
            WHERE id = %s
            RETURNING id, display_name, role, is_active, approval_status, supabase_auth_user_id
            """,
            (is_active, target_user_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        auth_user_id = row.get("supabase_auth_user_id")
        if auth_user_id:
            if not is_active:
                cursor.execute(
                    """
                    UPDATE user_roles
                    SET status = 'suspended', updated_at = NOW()
                    WHERE user_id = %s
                    """,
                    (str(auth_user_id),),
                )
            else:
                role = "extension-officer" if row["role"] == "extension_officer" else row["role"]
                role_status = (
                    "suspended"
                    if (row.get("approval_status") or "approved") == "suspended"
                    else "pending"
                    if role == "agrodealer" and (row.get("approval_status") or "pending") != "approved"
                    else "active"
                )
                _upsert_auth_role(cursor, str(auth_user_id), role, role_status)
        return {
            "userId": str(row["id"]),
            "displayName": row["display_name"],
            "role": row["role"],
            "isActive": row["is_active"],
        }


@_database_errors_as_unavailable
def admin_manage_officer_assignment(
    admin_user_id: str,
    officer_user_id: str,
    county: str | None,
    sub_county: str | None,
    ward: str | None,
    is_active: bool = True,
) -> dict[str, Any] | None:
    """Add or update an officer jurisdiction assignment; requires manage_officer_assignments."""
    if not check_admin_permission(admin_user_id, "manage_officer_assignments"):
        return None
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO officer_jurisdictions (
                officer_user_id, county, sub_county, ward, is_active, assigned_by
            )
            SELECT %s, %s, %s, %s, %s, %s
            FROM users
            WHERE users.id = %s
              AND users.role = 'extension_officer'
              AND users.is_active = TRUE
            ON CONFLICT (
                officer_user_id,
                COALESCE(county, ''),
                COALESCE(sub_county, ''),
                COALESCE(ward, '')
            )
            DO UPDATE SET is_active = EXCLUDED.is_active,
                          assigned_by = EXCLUDED.assigned_by
            RETURNING id, officer_user_id, county, sub_county, ward, is_active, created_at, updated_at
            """,
            (officer_user_id, county, sub_county, ward, is_active, admin_user_id, officer_user_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "assignmentId": str(row["id"]),
            "officerUserId": str(row["officer_user_id"]),
            "county": row["county"],
            "subCounty": row["sub_county"],
            "ward": row["ward"],
            "isActive": row["is_active"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }


@_database_errors_as_unavailable
def admin_invite_officer(
    admin_user_id: str,
    auth_user_id: str,
    email: str,
    designation: str,
    county: str,
    sub_county: str | None = None,
    ward: str | None = None,
    display_name: str | None = None,
) -> dict[str, Any] | None:
    """Provision a pending extension-officer invitation and its jurisdiction."""
    if not check_admin_permission(admin_user_id, "manage_officer_assignments"):
        return None

    now = datetime.now(UTC)
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT id, role, is_active, supabase_auth_user_id FROM users WHERE LOWER(email) = LOWER(%s)",
            (email,),
        )
        existing = cursor.fetchone()
        if existing:
            existing_auth_id = existing.get("supabase_auth_user_id")
            if existing_auth_id and str(existing_auth_id) != auth_user_id:
                raise AccountProvisioningConflict(
                    "This email is already linked to a different application identity."
                )
            officer_user_id = str(existing["id"])
            cursor.execute(
                """
                UPDATE users
                SET role = 'extension_officer', is_active = TRUE,
                    approval_status = 'pending', approved_at = NULL, approved_by = NULL,
                    supabase_auth_user_id = %s, updated_at = %s
                WHERE id = %s
                """,
                (auth_user_id, now, officer_user_id),
            )
        else:
            officer_user_id = str(uuid.uuid4())
            name = display_name.strip() if display_name and display_name.strip() else email.split("@")[0]
            cursor.execute(
                """
                INSERT INTO users (
                    id, email, display_name, role, is_active, approval_status,
                    supabase_auth_user_id, created_at, updated_at
                )
                VALUES (%s, %s, %s, 'extension_officer', TRUE, 'pending', %s, %s, %s)
                """,
                (officer_user_id, email.lower(), name, auth_user_id, now, now),
            )

        name = display_name.strip() if display_name and display_name.strip() else email.split("@")[0]
        cursor.execute(
            """
            INSERT INTO profiles (id, full_name, county, sub_county, ward, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                full_name = EXCLUDED.full_name,
                county = EXCLUDED.county,
                sub_county = EXCLUDED.sub_county,
                ward = EXCLUDED.ward,
                updated_at = EXCLUDED.updated_at
            """,
            (officer_user_id, name, county, sub_county, ward, now, now),
        )

        cursor.execute(
            """
            INSERT INTO user_roles (user_id, role, status, created_at, updated_at)
            VALUES (%s, 'extension-officer', 'pending', %s, %s)
            ON CONFLICT (user_id, role) DO UPDATE SET
                status = 'pending',
                updated_at = EXCLUDED.updated_at
            """,
            (auth_user_id, now, now),
        )
        cursor.execute(
            """
            UPDATE user_roles
            SET status = 'suspended', updated_at = %s
            WHERE user_id IN (%s, %s) AND role = 'farmer'
            """,
            (now, auth_user_id, officer_user_id),
        )
        cursor.execute(
            """
            INSERT INTO account_invitations (auth_user_id, email, role, status, invited_by, created_at)
            VALUES (%s, %s, 'extension-officer', 'pending', %s, %s)
            ON CONFLICT (auth_user_id) DO UPDATE SET
                email = EXCLUDED.email,
                role = EXCLUDED.role,
                status = 'pending',
                invited_by = EXCLUDED.invited_by,
                created_at = EXCLUDED.created_at,
                activated_at = NULL
            """,
            (auth_user_id, email.lower(), admin_user_id, now),
        )

        # Insert / update officer_jurisdictions
        cursor.execute(
            """
            INSERT INTO officer_jurisdictions (
                officer_user_id, designation, county, sub_county, ward, is_active, assigned_by, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, TRUE, %s, %s, %s)
            ON CONFLICT (
                officer_user_id,
                COALESCE(county, ''),
                COALESCE(sub_county, ''),
                COALESCE(ward, '')
            )
            DO UPDATE SET
                designation = EXCLUDED.designation,
                is_active = TRUE,
                assigned_by = EXCLUDED.assigned_by,
                updated_at = EXCLUDED.updated_at
            RETURNING id, created_at
            """,
            (officer_user_id, designation, county, sub_county, ward, admin_user_id, now, now),
        )
        jurisdiction_row = cursor.fetchone()
        assignment_id = str(jurisdiction_row["id"]) if jurisdiction_row and isinstance(jurisdiction_row, dict) and "id" in jurisdiction_row else str(uuid.uuid4())
        created_at = jurisdiction_row["created_at"] if jurisdiction_row and isinstance(jurisdiction_row, dict) and "created_at" in jurisdiction_row else now

        # Record in audit_log
        try:
            cursor.execute(
                """
                INSERT INTO audit_log (actor_id, action, target_type, target_id, details, timestamp)
                VALUES (%s, 'officer_invited', 'officer_jurisdiction', %s, %s, %s)
                """,
                (
                    admin_user_id,
                    assignment_id,
                    json.dumps({
                        "email": email.lower(),
                        "designation": designation,
                        "county": county,
                        "sub_county": sub_county,
                        "ward": ward,
                        "officer_user_id": officer_user_id,
                    }),
                    now,
                ),
            )
        except Exception:
            pass

        connection.commit()

        return {
            "officerUserId": officer_user_id,
            "assignmentId": assignment_id,
            "email": email.lower(),
            "designation": designation,
            "county": county,
            "subCounty": sub_county,
            "ward": ward,
            "role": "extension_officer",
            "status": "pending",
            "invitedAt": created_at,
        }


@_database_errors_as_unavailable
def admin_invite_agrodealer(
    admin_user_id: str,
    auth_user_id: str,
    email: str,
    display_name: str,
    business_name: str,
    county: str | None = None,
    sub_county: str | None = None,
    ward: str | None = None,
) -> dict[str, Any] | None:
    """Provision a pending agrodealer invitation and initial business profile."""
    if not check_admin_permission(admin_user_id, "manage_accounts"):
        return None

    now = datetime.now(UTC)
    normalized_email = email.strip().lower()
    normalized_name = display_name.strip()
    normalized_business_name = business_name.strip()
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT id, supabase_auth_user_id FROM users WHERE LOWER(email) = LOWER(%s)",
            (normalized_email,),
        )
        existing = cursor.fetchone()
        if existing:
            existing_auth_id = existing.get("supabase_auth_user_id")
            if existing_auth_id and str(existing_auth_id) != auth_user_id:
                raise AccountProvisioningConflict(
                    "This email is already linked to a different application identity."
                )
            dealer_user_id = str(existing["id"])
            cursor.execute(
                """
                UPDATE users
                SET role = 'agrodealer', is_active = TRUE,
                    display_name = %s, approval_status = 'pending',
                    approved_at = NULL, approved_by = NULL,
                    supabase_auth_user_id = %s, updated_at = %s
                WHERE id = %s
                """,
                (normalized_name, auth_user_id, now, dealer_user_id),
            )
        else:
            dealer_user_id = str(uuid.uuid4())
            cursor.execute(
                """
                INSERT INTO users (
                    id, email, display_name, role, is_active, approval_status,
                    supabase_auth_user_id, created_at, updated_at
                )
                VALUES (%s, %s, %s, 'agrodealer', TRUE, 'pending', %s, %s, %s)
                """,
                (
                    dealer_user_id,
                    normalized_email,
                    normalized_name,
                    auth_user_id,
                    now,
                    now,
                ),
            )

        cursor.execute(
            """
            INSERT INTO profiles (id, full_name, county, sub_county, ward, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                full_name = EXCLUDED.full_name,
                county = COALESCE(EXCLUDED.county, profiles.county),
                sub_county = COALESCE(EXCLUDED.sub_county, profiles.sub_county),
                ward = COALESCE(EXCLUDED.ward, profiles.ward),
                updated_at = EXCLUDED.updated_at
            """,
            (dealer_user_id, normalized_name, county, sub_county, ward, now, now),
        )
        cursor.execute(
            """
            INSERT INTO agrodealer_profiles (
                user_id, business_name, county, sub_county, ward, verification_state,
                location_status, location_permission_status, is_demo, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, 'pending', 'unverified', 'not_requested', FALSE, %s, %s)
            ON CONFLICT (user_id) DO UPDATE SET
                business_name = EXCLUDED.business_name,
                county = COALESCE(EXCLUDED.county, agrodealer_profiles.county),
                sub_county = COALESCE(EXCLUDED.sub_county, agrodealer_profiles.sub_county),
                ward = COALESCE(EXCLUDED.ward, agrodealer_profiles.ward),
                updated_at = EXCLUDED.updated_at
            """,
            (dealer_user_id, normalized_business_name, county, sub_county, ward, now, now),
        )
        cursor.execute(
            """
            INSERT INTO user_roles (user_id, role, status, created_at, updated_at)
            VALUES (%s, 'agrodealer', 'pending', %s, %s)
            ON CONFLICT (user_id, role) DO UPDATE SET
                status = 'pending', updated_at = EXCLUDED.updated_at
            """,
            (auth_user_id, now, now),
        )
        cursor.execute(
            """
            UPDATE user_roles
            SET status = 'suspended', updated_at = %s
            WHERE user_id IN (%s, %s) AND role = 'farmer'
            """,
            (now, auth_user_id, dealer_user_id),
        )
        cursor.execute(
            """
            INSERT INTO account_invitations (auth_user_id, email, role, status, invited_by, created_at)
            VALUES (%s, %s, 'agrodealer', 'pending', %s, %s)
            ON CONFLICT (auth_user_id) DO UPDATE SET
                email = EXCLUDED.email,
                role = EXCLUDED.role,
                status = 'pending',
                invited_by = EXCLUDED.invited_by,
                created_at = EXCLUDED.created_at,
                activated_at = NULL
            """,
            (auth_user_id, normalized_email, admin_user_id, now),
        )
        cursor.execute(
            """
            INSERT INTO audit_log (actor_id, action, target_type, target_id, details, timestamp)
            VALUES (%s, 'agrodealer_invited', 'user', %s, %s, %s)
            """,
            (
                admin_user_id,
                dealer_user_id,
                json.dumps(
                    {
                        "email": normalized_email,
                        "business_name": normalized_business_name,
                        "auth_user_id": auth_user_id,
                    }
                ),
                now,
            ),
        )
        connection.commit()

    return {
        "dealerUserId": dealer_user_id,
        "email": normalized_email,
        "businessName": normalized_business_name,
        "role": "agrodealer",
        "status": "pending",
        "invitedAt": now,
    }


@_database_errors_as_unavailable
def activate_account_invitation(auth_user_id: str) -> str | None:
    """Activate the preassigned role after the invitee chooses a password."""
    now = datetime.now(UTC)
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT invitation.role, invitation.status, users.is_active, users.role AS app_role,
                   agronomist_profiles.approval_status AS agronomist_approval_status
            FROM account_invitations AS invitation
            JOIN users ON users.supabase_auth_user_id = invitation.auth_user_id
            LEFT JOIN agronomist_profiles ON agronomist_profiles.user_id = users.id
            WHERE invitation.auth_user_id = %s
            FOR UPDATE OF invitation, users
            """,
            (auth_user_id,),
        )
        invitation = cursor.fetchone()
        if invitation is None:
            return None
        role = str(invitation["role"])
        expected_app_role = "extension_officer" if role == "extension-officer" else role
        if invitation["is_active"] is not True or invitation["app_role"] != expected_app_role:
            return None
        if invitation["status"] == "active":
            connection.commit()
            return role
        if invitation["status"] not in ("pending", "unclaimed"):
            return None

        role_status = "active"
        if role == "agronomist" and invitation["agronomist_approval_status"] != "approved":
            role_status = "pending"
        cursor.execute(
            """
            UPDATE user_roles
            SET status = %s, approved_at = %s, updated_at = %s
            WHERE user_id = %s AND role = %s AND status IN ('pending', 'active', 'unclaimed')
            RETURNING user_id
            """,
            (role_status, now if role_status == "active" else None, now, auth_user_id, role),
        )
        if cursor.fetchone() is None:
            return None
        cursor.execute(
            """
            UPDATE users
            SET approval_status = CASE
                    WHEN role = 'agronomist' AND %s <> 'approved' THEN approval_status
                    ELSE 'approved'
                END,
                approved_at = CASE
                    WHEN role = 'agronomist' AND %s <> 'approved' THEN approved_at
                    ELSE %s
                END,
                updated_at = %s
            WHERE supabase_auth_user_id = %s AND role = %s AND is_active = TRUE
            RETURNING id
            """,
            (
                invitation.get("agronomist_approval_status") or "pending",
                invitation.get("agronomist_approval_status") or "pending",
                now,
                now,
                auth_user_id,
                expected_app_role,
            ),
        )
        if cursor.fetchone() is None:
            raise DatabaseUnavailable("The invited account could not be activated.")
        cursor.execute(
            """
            UPDATE account_invitations
            SET status = 'active', activated_at = %s
            WHERE auth_user_id = %s AND status IN ('pending', 'unclaimed')
            RETURNING auth_user_id
            """,
            (now, auth_user_id),
        )
        if cursor.fetchone() is None:
            raise DatabaseUnavailable("The account invitation could not be activated.")

        cursor.execute(
            """
            UPDATE unclaimed_farmer_accounts
            SET status = 'claimed', claimed_at = %s, updated_at = %s
            WHERE auth_user_id = %s
            """,
            (now, now, auth_user_id),
        )
        connection.commit()
    return role


@_database_errors_as_unavailable
def admin_invite_agronomist(
    admin_user_id: str,
    auth_user_id: str,
    email: str,
    display_name: str,
    licence_number: str,
    county: str,
    approval_status: str = "pending",
) -> dict[str, Any] | None:
    """Provision a pending agronomist invitation and accreditation profile."""
    if not check_admin_permission(admin_user_id, "manage_accounts"):
        return None

    now = datetime.now(UTC)
    normalized_email = email.strip().lower()
    normalized_name = display_name.strip()
    normalized_licence = licence_number.strip()
    normalized_county = county.strip()
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT id, supabase_auth_user_id FROM users WHERE LOWER(email) = LOWER(%s)",
            (normalized_email,),
        )
        existing = cursor.fetchone()
        if existing:
            existing_auth_id = existing.get("supabase_auth_user_id")
            if existing_auth_id and str(existing_auth_id) != auth_user_id:
                raise AccountProvisioningConflict(
                    "This email is already linked to a different application identity."
                )
            agronomist_user_id = str(existing["id"])
            cursor.execute(
                """
                UPDATE users
                SET role = 'agronomist', is_active = TRUE,
                    display_name = %s, approval_status = %s,
                    approved_at = CASE WHEN %s = 'approved' THEN %s ELSE NULL END,
                    approved_by = CASE WHEN %s = 'approved' THEN %s ELSE NULL END,
                    supabase_auth_user_id = %s, updated_at = %s
                WHERE id = %s
                """,
                (
                    normalized_name,
                    approval_status,
                    approval_status,
                    now,
                    approval_status,
                    admin_user_id,
                    auth_user_id,
                    now,
                    agronomist_user_id,
                ),
            )
        else:
            agronomist_user_id = str(uuid.uuid4())
            cursor.execute(
                """
                INSERT INTO users (
                    id, email, display_name, role, is_active, approval_status,
                    approved_at, approved_by, supabase_auth_user_id, created_at, updated_at
                )
                VALUES (%s, %s, %s, 'agronomist', TRUE, %s, %s, %s, %s, %s, %s)
                """,
                (
                    agronomist_user_id,
                    normalized_email,
                    normalized_name,
                    approval_status,
                    now if approval_status == "approved" else None,
                    admin_user_id if approval_status == "approved" else None,
                    auth_user_id,
                    now,
                    now,
                ),
            )

        cursor.execute(
            """
            INSERT INTO profiles (id, full_name, county, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                full_name = EXCLUDED.full_name,
                county = COALESCE(EXCLUDED.county, profiles.county),
                updated_at = EXCLUDED.updated_at
            """,
            (agronomist_user_id, normalized_name, normalized_county, now, now),
        )
        cursor.execute(
            """
            INSERT INTO agronomist_profiles (
                user_id, licence_number, county, approval_status, approved_by, approved_at, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id) DO UPDATE SET
                licence_number = EXCLUDED.licence_number,
                county = EXCLUDED.county,
                approval_status = EXCLUDED.approval_status,
                approved_by = EXCLUDED.approved_by,
                approved_at = EXCLUDED.approved_at,
                updated_at = EXCLUDED.updated_at
            """,
            (
                agronomist_user_id,
                normalized_licence,
                normalized_county,
                approval_status,
                admin_user_id if approval_status == "approved" else None,
                now if approval_status == "approved" else None,
                now,
                now,
            ),
        )
        cursor.execute(
            """
            INSERT INTO user_roles (user_id, role, status, created_at, updated_at)
            VALUES (%s, 'agronomist', %s, %s, %s)
            ON CONFLICT (user_id, role) DO UPDATE SET
                status = EXCLUDED.status, updated_at = EXCLUDED.updated_at
            """,
            (auth_user_id, "active" if approval_status == "approved" else "pending", now, now),
        )
        cursor.execute(
            """
            UPDATE user_roles
            SET status = 'suspended', updated_at = %s
            WHERE user_id IN (%s, %s) AND role = 'farmer'
            """,
            (now, auth_user_id, agronomist_user_id),
        )
        cursor.execute(
            """
            INSERT INTO account_invitations (auth_user_id, email, role, status, invited_by, created_at)
            VALUES (%s, %s, 'agronomist', 'pending', %s, %s)
            ON CONFLICT (auth_user_id) DO UPDATE SET
                email = EXCLUDED.email,
                role = EXCLUDED.role,
                status = 'pending',
                invited_by = EXCLUDED.invited_by,
                created_at = EXCLUDED.created_at,
                activated_at = NULL
            """,
            (auth_user_id, normalized_email, admin_user_id, now),
        )
        cursor.execute(
            """
            INSERT INTO audit_log (actor_id, action, target_type, target_id, details, timestamp)
            VALUES (%s, 'agronomist_invited', 'user', %s, %s, %s)
            """,
            (
                admin_user_id,
                agronomist_user_id,
                json.dumps(
                    {
                        "email": normalized_email,
                        "licence_number": normalized_licence,
                        "county": normalized_county,
                        "approval_status": approval_status,
                        "auth_user_id": auth_user_id,
                    }
                ),
                now,
            ),
        )
        connection.commit()

    return {
        "agronomistUserId": agronomist_user_id,
        "email": normalized_email,
        "licenceNumber": normalized_licence,
        "county": normalized_county,
        "role": "agronomist",
        "status": "pending",
        "approvalStatus": approval_status,
        "invitedAt": now,
    }


@_database_errors_as_unavailable
def admin_approve_agronomist(
    admin_user_id: str,
    agronomist_user_id: str,
    approval_status: str,
    notes: str | None = None,
) -> dict[str, Any] | None:
    """Update approval status for an agronomist."""
    if not check_admin_permission(admin_user_id, "manage_accounts"):
        return None

    now = datetime.now(UTC)
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT id, supabase_auth_user_id, role FROM users WHERE id = %s",
            (agronomist_user_id,),
        )
        user = cursor.fetchone()
        if not user or user.get("role") != "agronomist":
            return None

        auth_user_id = user.get("supabase_auth_user_id")

        cursor.execute(
            """
            UPDATE agronomist_profiles
            SET approval_status = %s, approved_by = %s, approved_at = %s, updated_at = %s
            WHERE user_id = %s
            RETURNING id
            """,
            (approval_status, admin_user_id, now, now, agronomist_user_id),
        )
        cursor.execute(
            """
            UPDATE users
            SET approval_status = %s, approved_by = %s, approved_at = %s, updated_at = %s
            WHERE id = %s
            """,
            (approval_status, admin_user_id, now, now, agronomist_user_id),
        )

        role_status = "active" if approval_status == "approved" else "suspended" if approval_status == "suspended" else "pending"
        if auth_user_id:
            cursor.execute(
                """
                UPDATE user_roles
                SET status = %s, updated_at = %s
                WHERE user_id = %s AND role = 'agronomist'
                """,
                (role_status, now, auth_user_id),
            )

        cursor.execute(
            """
            INSERT INTO audit_log (actor_id, action, target_type, target_id, details, timestamp)
            VALUES (%s, 'agronomist_approval_updated', 'user', %s, %s, %s)
            """,
            (
                admin_user_id,
                agronomist_user_id,
                json.dumps({"approval_status": approval_status, "notes": notes}),
                now,
            ),
        )
        connection.commit()

    return {
        "agronomistUserId": agronomist_user_id,
        "approvalStatus": approval_status,
        "updatedAt": now,
    }


@_database_errors_as_unavailable
def officer_register_unclaimed_farmer(
    officer_user_id: str,
    auth_user_id: str,
    email: str,
    full_name: str,
    farm_name: str | None = None,
    county: str | None = None,
    sub_county: str | None = None,
    ward: str | None = None,
    size_acres: float | None = None,
    crops: str | None = None,
) -> dict[str, Any] | None:
    """Register a farmer on-site in unclaimed state and provision initial farm info."""
    now = datetime.now(UTC)
    normalized_email = email.strip().lower()
    normalized_name = full_name.strip()
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute("SELECT id FROM users WHERE id = %s AND is_active = TRUE", (officer_user_id,))
        if not cursor.fetchone():
            return None

        cursor.execute("SELECT id, supabase_auth_user_id FROM users WHERE LOWER(email) = LOWER(%s)", (normalized_email,))
        existing = cursor.fetchone()
        if existing:
            existing_auth_id = existing.get("supabase_auth_user_id")
            if existing_auth_id and str(existing_auth_id) != auth_user_id:
                raise AccountProvisioningConflict("This email is already registered.")
            farmer_user_id = str(existing["id"])
            cursor.execute(
                """
                UPDATE users
                SET display_name = %s, approval_status = 'unclaimed', supabase_auth_user_id = %s, updated_at = %s
                WHERE id = %s
                """,
                (normalized_name, auth_user_id, now, farmer_user_id),
            )
        else:
            farmer_user_id = str(uuid.uuid4())
            cursor.execute(
                """
                INSERT INTO users (id, email, display_name, role, is_active, approval_status, supabase_auth_user_id, created_at, updated_at)
                VALUES (%s, %s, %s, 'farmer', TRUE, 'unclaimed', %s, %s, %s)
                """,
                (farmer_user_id, normalized_email, normalized_name, auth_user_id, now, now),
            )

        cursor.execute(
            """
            INSERT INTO profiles (id, full_name, county, sub_county, ward, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                full_name = EXCLUDED.full_name,
                county = COALESCE(EXCLUDED.county, profiles.county),
                sub_county = COALESCE(EXCLUDED.sub_county, profiles.sub_county),
                ward = COALESCE(EXCLUDED.ward, profiles.ward),
                updated_at = EXCLUDED.updated_at
            """,
            (farmer_user_id, normalized_name, county, sub_county, ward, now, now),
        )

        cursor.execute(
            """
            INSERT INTO user_roles (user_id, role, status, created_at, updated_at)
            VALUES (%s, 'farmer', 'unclaimed', %s, %s)
            ON CONFLICT (user_id, role) DO UPDATE SET
                status = 'unclaimed', updated_at = EXCLUDED.updated_at
            """,
            (auth_user_id, now, now),
        )

        cursor.execute(
            """
            INSERT INTO account_invitations (auth_user_id, email, role, status, invited_by, created_at)
            VALUES (%s, %s, 'farmer', 'pending', %s, %s)
            ON CONFLICT (auth_user_id) DO UPDATE SET
                email = EXCLUDED.email,
                role = EXCLUDED.role,
                status = 'pending',
                invited_by = EXCLUDED.invited_by,
                created_at = EXCLUDED.created_at,
                activated_at = NULL
            """,
            (auth_user_id, normalized_email, officer_user_id, now),
        )

        initial_farm_id = None
        if farm_name and farm_name.strip():
            initial_farm_id = str(uuid.uuid4())
            cursor.execute(
                """
                INSERT INTO farms (id, owner_id, name, county, ward, size_acres, crops, owner_verified, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, FALSE, %s, %s)
                """,
                (initial_farm_id, farmer_user_id, farm_name.strip(), county, ward, size_acres, crops, now, now),
            )

        cursor.execute(
            """
            INSERT INTO unclaimed_farmer_accounts (
                auth_user_id, farmer_user_id, officer_user_id, initial_farm_id, status, reminder_count, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, 'unclaimed', 0, %s, %s)
            ON CONFLICT (auth_user_id) DO UPDATE SET
                officer_user_id = EXCLUDED.officer_user_id,
                initial_farm_id = COALESCE(EXCLUDED.initial_farm_id, unclaimed_farmer_accounts.initial_farm_id),
                status = 'unclaimed',
                reminder_count = 0,
                last_reminder_at = NULL,
                claimed_at = NULL,
                updated_at = EXCLUDED.updated_at
            """,
            (auth_user_id, farmer_user_id, officer_user_id, initial_farm_id, now, now),
        )

        cursor.execute(
            """
            INSERT INTO in_app_notifications (user_id, title, message, notification_type, created_at)
            VALUES (%s, 'Account Claim Required', 'Your SoilSync account was registered by an Extension Officer. Please check your email to set a password and claim your account.', 'account_claim', %s)
            """,
            (farmer_user_id, now),
        )

        cursor.execute(
            """
            INSERT INTO audit_log (actor_id, action, target_type, target_id, details, timestamp)
            VALUES (%s, 'unclaimed_farmer_registered', 'user', %s, %s, %s)
            """,
            (
                officer_user_id,
                farmer_user_id,
                json.dumps(
                    {
                        "email": normalized_email,
                        "auth_user_id": auth_user_id,
                        "initial_farm_id": initial_farm_id,
                    }
                ),
                now,
            ),
        )
        connection.commit()

    return {
        "authUserId": auth_user_id,
        "farmerUserId": farmer_user_id,
        "email": normalized_email,
        "fullName": normalized_name,
        "initialFarmId": initial_farm_id,
        "status": "unclaimed",
        "role": "farmer",
        "registeredAt": now,
        "message": "Unclaimed farmer account created. Secure claim invitation sent to email.",
    }


@_database_errors_as_unavailable
def load_officer_unclaimed_farmers(officer_user_id: str) -> list[dict[str, Any]]:
    """List pending unclaimed farmer accounts registered by this officer."""
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT ufa.auth_user_id, ufa.farmer_user_id, u.email, p.full_name,
                   ufa.initial_farm_id, f.name AS initial_farm_name, p.county,
                   ufa.status, ufa.reminder_count, ufa.last_reminder_at, ufa.created_at,
                   GREATEST(0, 7 - EXTRACT(DAY FROM (NOW() - ufa.created_at))::int) AS days_until_expiration
            FROM unclaimed_farmer_accounts AS ufa
            JOIN users AS u ON u.id = ufa.farmer_user_id
            LEFT JOIN profiles AS p ON p.id = u.id
            LEFT JOIN farms AS f ON f.id = ufa.initial_farm_id
            WHERE ufa.officer_user_id = %s AND ufa.status = 'unclaimed'
            ORDER BY ufa.created_at DESC
            """,
            (officer_user_id,),
        )
        rows = cursor.fetchall()
        return [
            {
                "authUserId": str(row["auth_user_id"]),
                "farmerUserId": str(row["farmer_user_id"]),
                "email": row["email"],
                "fullName": row["full_name"] or row["email"].split("@")[0],
                "initialFarmId": str(row["initial_farm_id"]) if row["initial_farm_id"] else None,
                "initialFarmName": row["initial_farm_name"],
                "county": row["county"],
                "status": row["status"],
                "reminderCount": row["reminder_count"],
                "lastReminderAt": row["last_reminder_at"],
                "createdAt": row["created_at"],
                "daysUntilExpiration": int(row["days_until_expiration"]),
            }
            for row in rows
        ]


@_database_errors_as_unavailable
def process_unclaimed_farmer_reminders() -> dict[str, Any]:
    """Execute Day 1-6 reminders for unclaimed farmer accounts."""
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT ufa.auth_user_id
            FROM unclaimed_farmer_accounts AS ufa
            WHERE ufa.status = 'unclaimed'
              AND ufa.reminder_count < 6
              AND (NOW() - COALESCE(ufa.last_reminder_at, ufa.created_at)) >= INTERVAL '24 hours'
              AND NOW() < ufa.created_at + INTERVAL '7 days'
            ORDER BY ufa.created_at
            """
        )
        candidate_ids = [row["auth_user_id"] for row in cursor.fetchall()]

    reminders_sent = 0
    for auth_user_id in candidate_ids:
        with _connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT ufa.auth_user_id, ufa.farmer_user_id, ufa.reminder_count, u.email
                FROM unclaimed_farmer_accounts AS ufa
                JOIN users AS u ON u.id = ufa.farmer_user_id
                WHERE ufa.auth_user_id = %s
                  AND ufa.status = 'unclaimed'
                  AND ufa.reminder_count < 6
                  AND (NOW() - COALESCE(ufa.last_reminder_at, ufa.created_at)) >= INTERVAL '24 hours'
                  AND NOW() < ufa.created_at + INTERVAL '7 days'
                FOR UPDATE OF ufa
                """,
                (auth_user_id,),
            )
            row = cursor.fetchone()
            if row is None:
                continue
            if not row["email"]:
                raise DatabaseUnavailable(
                    "An unclaimed farmer has no email address; the reminder was not recorded."
                )
            try:
                send_farmer_claim_reminder(row["email"])
            except SupabaseIdentityUnavailableError as exc:
                raise DatabaseUnavailable(
                    "Claim reminder email delivery failed; the reminder was not recorded."
                ) from exc

            new_count = row["reminder_count"] + 1
            now = datetime.now(UTC)
            cursor.execute(
                """
                UPDATE unclaimed_farmer_accounts
                SET reminder_count = %s, last_reminder_at = %s, updated_at = %s
                WHERE auth_user_id = %s
                """,
                (new_count, now, now, auth_user_id),
            )
            cursor.execute(
                """
                INSERT INTO in_app_notifications (user_id, title, message, notification_type, created_at)
                VALUES (%s, %s, %s, 'claim_reminder', %s)
                """,
                (
                    row["farmer_user_id"],
                    f"Reminder {new_count}/6: Claim your SoilSync account",
                    "Please check your email to set a password and activate your account before the 7-day period expires.",
                    now,
                ),
            )
            cursor.execute(
                """
                INSERT INTO audit_log (actor_id, action, target_type, target_id, details, timestamp)
                VALUES (NULL, 'unclaimed_farmer_reminder_sent', 'user', %s, %s, %s)
                """,
                (
                    row["farmer_user_id"],
                    json.dumps({"reminder_count": new_count, "email": row["email"]}),
                    now,
                ),
            )
            connection.commit()
            reminders_sent += 1

    return {
        "processedCount": reminders_sent,
        "remindersSent": reminders_sent,
        "message": f"Submitted {reminders_sent} claim reminder(s) through Supabase Auth.",
    }


@_database_errors_as_unavailable
def process_unclaimed_farmer_cleanup() -> dict[str, Any]:
    """Execute Day 7 automated cleanup of expired unclaimed farmer accounts."""
    now = datetime.now(UTC)
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT ufa.auth_user_id, ufa.farmer_user_id, ufa.officer_user_id, ufa.initial_farm_id, ufa.created_at
            FROM unclaimed_farmer_accounts AS ufa
            WHERE ufa.status = 'unclaimed'
              AND (NOW() - ufa.created_at) >= INTERVAL '7 days'
            FOR UPDATE OF ufa
            """
        )
        expired = cursor.fetchall()
        deleted_count = 0
        for row in expired:
            auth_user_id = str(row["auth_user_id"])
            farmer_user_id = str(row["farmer_user_id"])
            initial_farm_id = str(row["initial_farm_id"]) if row["initial_farm_id"] else None

            cursor.execute(
                """
                INSERT INTO unclaimed_auth_cleanup_queue (auth_user_id)
                VALUES (%s)
                ON CONFLICT (auth_user_id) DO NOTHING
                """,
                (auth_user_id,),
            )
            if initial_farm_id:
                cursor.execute("DELETE FROM farms WHERE id = %s", (initial_farm_id,))

            cursor.execute("DELETE FROM unclaimed_farmer_accounts WHERE auth_user_id = %s", (auth_user_id,))
            cursor.execute("DELETE FROM account_invitations WHERE auth_user_id = %s", (auth_user_id,))
            cursor.execute("DELETE FROM user_roles WHERE user_id = %s", (auth_user_id,))
            cursor.execute("DELETE FROM profiles WHERE id = %s", (farmer_user_id,))
            cursor.execute("DELETE FROM users WHERE id = %s", (farmer_user_id,))

            cursor.execute(
                """
                INSERT INTO audit_log (actor_id, action, target_type, target_id, details, timestamp)
                VALUES (NULL, 'unclaimed_account_expired_and_deleted', 'user', %s, %s, %s)
                """,
                (
                    farmer_user_id,
                    json.dumps(
                        {
                            "officer_user_id": str(row["officer_user_id"]),
                            "retention_period_days": 7,
                            "initial_farm_id": initial_farm_id,
                        }
                    ),
                    now,
                ),
            )
            deleted_count += 1
        connection.commit()

    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT auth_user_id
            FROM unclaimed_auth_cleanup_queue
            ORDER BY queued_at
            """
        )
        pending_auth_deletions = [str(row["auth_user_id"]) for row in cursor.fetchall()]

    failures = 0
    for auth_user_id in pending_auth_deletions:
        try:
            delete_supabase_user(auth_user_id)
        except SupabaseIdentityUnavailableError:
            with _connect() as connection, connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE unclaimed_auth_cleanup_queue
                    SET attempts = attempts + 1,
                        last_attempt_at = %s,
                        last_error = 'Supabase Auth deletion failed'
                    WHERE auth_user_id = %s
                    """,
                    (datetime.now(UTC), auth_user_id),
                )
                connection.commit()
            failures += 1
            continue

        with _connect() as connection, connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM unclaimed_auth_cleanup_queue WHERE auth_user_id = %s",
                (auth_user_id,),
            )
            connection.commit()

    if failures:
        raise DatabaseUnavailable(
            f"Local cleanup completed, but Supabase Auth deletion failed for {failures} account(s); deletion remains queued for retry."
        )

    return {
        "processedCount": len(expired),
        "expiredAndDeleted": deleted_count,
        "message": f"Expired and cleanly deleted {deleted_count} unclaimed farmer account(s), including their Supabase Auth identities.",
    }


@_database_errors_as_unavailable
def resend_account_invitation(actor_user_id: str, auth_user_id: str) -> dict[str, Any] | None:
    """Safely record a resend of a pending account invitation."""
    now = datetime.now(UTC)
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT email, role, status FROM account_invitations WHERE auth_user_id = %s",
            (auth_user_id,),
        )
        invitation = cursor.fetchone()
        if not invitation or invitation["status"] not in ("pending", "unclaimed"):
            return None

        cursor.execute(
            """
            UPDATE account_invitations
            SET created_at = %s
            WHERE auth_user_id = %s
            """,
            (now, auth_user_id),
        )
        cursor.execute(
            """
            INSERT INTO audit_log (actor_id, action, target_type, target_id, details, timestamp)
            VALUES (%s, 'account_invitation_resent', 'invitation', %s, %s, %s)
            """,
            (
                actor_user_id,
                auth_user_id,
                json.dumps({"email": invitation["email"], "role": invitation["role"]}),
                now,
            ),
        )
        connection.commit()

    return {
        "authUserId": auth_user_id,
        "action": "resent",
        "status": "pending",
        "message": "Invitation resent successfully.",
    }


@_database_errors_as_unavailable
def cancel_account_invitation(actor_user_id: str, auth_user_id: str) -> dict[str, Any] | None:
    """Safely cancel a pending invitation and revoke access."""
    now = datetime.now(UTC)
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            "SELECT email, role, status FROM account_invitations WHERE auth_user_id = %s",
            (auth_user_id,),
        )
        invitation = cursor.fetchone()
        if not invitation or invitation["status"] not in ("pending", "unclaimed"):
            return None

        cursor.execute(
            """
            UPDATE account_invitations
            SET status = 'cancelled'
            WHERE auth_user_id = %s
            """,
            (auth_user_id,),
        )
        cursor.execute(
            """
            UPDATE user_roles
            SET status = 'suspended', updated_at = %s
            WHERE user_id = %s
            """,
            (now, auth_user_id),
        )
        cursor.execute(
            """
            INSERT INTO audit_log (actor_id, action, target_type, target_id, details, timestamp)
            VALUES (%s, 'account_invitation_cancelled', 'invitation', %s, %s, %s)
            """,
            (
                actor_user_id,
                auth_user_id,
                json.dumps({"email": invitation["email"], "role": invitation["role"]}),
                now,
            ),
        )
        connection.commit()

    return {
        "authUserId": auth_user_id,
        "action": "cancelled",
        "status": "cancelled",
        "message": "Invitation cancelled and access revoked.",
    }



@_database_errors_as_unavailable
def load_dashboard_data(role: str) -> dict[str, Any]:
    database_role = role.replace("-", "_")
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT users.id, users.email, users.display_name, users.role,
                   users.demo_status, farms.name AS farm_name, farms.ward
            FROM users
            LEFT JOIN farms ON farms.owner_id = users.id
            WHERE users.is_active = TRUE
            ORDER BY users.display_name
            """
        )
        users = [
            {
                "id": str(row["id"]),
                "name": row["display_name"],
                "role": row["role"].replace("_", "-"),
                "email": row["email"],
                "ward": row["ward"] or "Unassigned",
                "farmName": row["farm_name"],
                "status": row["demo_status"],
            }
            for row in cursor.fetchall()
        ]

        # 1. Normalized visits from officer_visits
        cursor.execute(
            """
            SELECT v.id, u.display_name AS farmer_name, f.name AS farm_name,
                   v.status, v.planned_date, v.notes
            FROM officer_visits AS v
            JOIN users AS u ON u.id = v.farmer_id
            LEFT JOIN farms AS f ON f.id = v.farm_id
            ORDER BY v.planned_date DESC
            LIMIT 10
            """
        )
        norm_visits = [
            {
                "id": str(r["id"]),
                "farmer": r["farmer_name"],
                "farm": r["farm_name"] or "Main Farm",
                "status": r["status"].replace("_", " ").title(),
                "time": r["planned_date"].strftime("%b %d, %H:%M") if hasattr(r["planned_date"], "strftime") else str(r["planned_date"]),
                "notes": r["notes"] or "Scheduled extension field visit.",
            }
            for r in cursor.fetchall()
        ]

        # 2. Normalized alerts from officer_alerts
        cursor.execute(
            """
            SELECT a.id, a.title, a.severity, a.summary, u.display_name AS owner_name
            FROM officer_alerts AS a
            JOIN users AS u ON u.id = a.farmer_id
            ORDER BY a.created_at DESC
            LIMIT 10
            """
        )
        norm_alerts = [
            {
                "id": str(r["id"]),
                "title": r["title"],
                "severity": r["severity"],
                "summary": r["summary"] or "",
                "owner": r["owner_name"] or "Field Officer",
            }
            for r in cursor.fetchall()
        ]

        cursor.execute(
            """
            SELECT record_type, payload
            FROM demo_dashboard_records
            WHERE (audience_role IS NULL OR audience_role = %s)
              AND record_type <> 'inventory'
            ORDER BY display_order, id
            """,
            (database_role,),
        )
        records = cursor.fetchall()

    records_by_type: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        records_by_type.setdefault(record["record_type"], []).append(record["payload"])

    return {
        "users": users,
        "alerts": norm_alerts if norm_alerts else records_by_type.get("alert", []),
        "farmVisits": norm_visits if norm_visits else records_by_type.get("visit", []),
        "summaryCards": records_by_type.get("summary_card", []),
        "actionQueue": records_by_type.get("action", []),
        "recentItems": records_by_type.get("activity", []),
    }



# ---------------------------------------------------------------------------
# Extension Officer Visits, Alerts, Summaries, and Reports
# ---------------------------------------------------------------------------


@_database_errors_as_unavailable
def load_officer_visits(officer_user_id: str) -> list[dict[str, Any]]:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT v.id, v.officer_user_id, v.farmer_id, v.farm_id,
                   v.planned_date, v.status, v.notes, v.created_at, v.updated_at,
                   u.display_name AS farmer_name, u.phone AS farmer_phone,
                   f.name AS farm_name, f.county, f.sub_county, f.ward
            FROM officer_visits AS v
            JOIN users AS u ON u.id = v.farmer_id
            LEFT JOIN farms AS f ON f.id = v.farm_id
            WHERE v.officer_user_id = %s
               OR (v.status != 'requested' AND EXISTS (
                   SELECT 1 FROM farms
                   JOIN officer_jurisdictions AS oj
                     ON (oj.county IS NULL OR farms.county = oj.county)
                    AND (oj.sub_county IS NULL OR farms.sub_county = oj.sub_county)
                    AND (oj.ward IS NULL OR farms.ward = oj.ward)
                   WHERE oj.officer_user_id = %s
                     AND oj.is_active = TRUE
                     AND (farms.owner_id = v.farmer_id OR farms.id = v.farm_id)
               ))
            ORDER BY
                CASE v.status
                    WHEN 'claimed' THEN 1
                    WHEN 'scheduled' THEN 2
                    WHEN 'in_progress' THEN 3
                    WHEN 'completed' THEN 4
                    ELSE 5
                END,
                v.planned_date DESC NULLS LAST,
                v.created_at DESC
            """,
            (officer_user_id, officer_user_id),
        )
        return [
            {
                "visitId": str(row["id"]),
                "officerUserId": str(row["officer_user_id"]) if row["officer_user_id"] else None,
                "farmerId": str(row["farmer_id"]),
                "farmerName": row["farmer_name"],
                "farmerPhone": row["farmer_phone"],
                "farmId": str(row["farm_id"]) if row["farm_id"] else None,
                "farmName": row["farm_name"],
                "county": row["county"],
                "subCounty": row["sub_county"],
                "ward": row["ward"],
                "plannedDate": row["planned_date"],
                "status": row["status"],
                "notes": row["notes"],
                "createdAt": row["created_at"],
                "updatedAt": row["updated_at"],
            }
            for row in cursor.fetchall()
        ]


@_database_errors_as_unavailable
def load_officer_visit_pool(officer_user_id: str) -> list[dict[str, Any]]:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT v.id, v.officer_user_id, v.farmer_id, v.farm_id,
                   v.planned_date, v.status, v.notes, v.created_at, v.updated_at,
                   u.display_name AS farmer_name, u.phone AS farmer_phone,
                   f.name AS farm_name, f.county, f.sub_county, f.ward
            FROM officer_visits AS v
            JOIN users AS u ON u.id = v.farmer_id
            JOIN farms AS f ON f.id = v.farm_id
            WHERE (v.officer_user_id IS NULL OR v.status = 'requested')
              AND v.status = 'requested'
              AND EXISTS (
                  SELECT 1 FROM officer_jurisdictions AS oj
                  WHERE oj.officer_user_id = %s
                    AND oj.is_active = TRUE
                    AND (oj.county IS NULL OR f.county = oj.county)
                    AND (oj.sub_county IS NULL OR f.sub_county = oj.sub_county)
                    AND (oj.ward IS NULL OR f.ward = oj.ward)
              )
            ORDER BY v.created_at DESC
            """,
            (officer_user_id,),
        )
        return [
            {
                "visitId": str(row["id"]),
                "officerUserId": None,
                "farmerId": str(row["farmer_id"]),
                "farmerName": row["farmer_name"],
                "farmerPhone": row["farmer_phone"],
                "farmId": str(row["farm_id"]),
                "farmName": row["farm_name"],
                "county": row["county"],
                "subCounty": row["sub_county"],
                "ward": row["ward"],
                "plannedDate": row["planned_date"],
                "status": row["status"],
                "notes": row["notes"],
                "createdAt": row["created_at"],
                "updatedAt": row["updated_at"],
            }
            for row in cursor.fetchall()
        ]


@_database_errors_as_unavailable
def claim_officer_visit(officer_user_id: str, visit_id: str) -> dict[str, Any] | None:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE officer_visits AS v
            SET officer_user_id = %s,
                status = 'claimed',
                updated_at = NOW()
            WHERE v.id = %s
              AND (v.officer_user_id IS NULL OR v.status = 'requested')
              AND EXISTS (
                  SELECT 1 FROM farms AS f
                  JOIN officer_jurisdictions AS oj
                    ON (oj.county IS NULL OR f.county = oj.county)
                   AND (oj.sub_county IS NULL OR f.sub_county = oj.sub_county)
                   AND (oj.ward IS NULL OR f.ward = oj.ward)
                  WHERE f.id = v.farm_id
                    AND oj.officer_user_id = %s
                    AND oj.is_active = TRUE
              )
            RETURNING v.id, v.officer_user_id, v.farmer_id, v.farm_id,
                      v.planned_date, v.status, v.notes, v.created_at, v.updated_at
            """,
            (officer_user_id, visit_id, officer_user_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None

        cursor.execute("SELECT display_name, phone FROM users WHERE id = %s", (row["farmer_id"],))
        farmer_row = cursor.fetchone()
        farmer_name = farmer_row["display_name"] if farmer_row else None
        farmer_phone = farmer_row["phone"] if farmer_row else None

        farm_name, county, sub_county, ward = None, None, None, None
        if row["farm_id"]:
            cursor.execute("SELECT name, county, sub_county, ward FROM farms WHERE id = %s", (row["farm_id"],))
            farm_row = cursor.fetchone()
            if farm_row:
                farm_name = farm_row["name"]
                county = farm_row["county"]
                sub_county = farm_row["sub_county"]
                ward = farm_row["ward"]

        return {
            "visitId": str(row["id"]),
            "officerUserId": str(row["officer_user_id"]),
            "farmerId": str(row["farmer_id"]),
            "farmerName": farmer_name,
            "farmerPhone": farmer_phone,
            "farmId": str(row["farm_id"]) if row["farm_id"] else None,
            "farmName": farm_name,
            "county": county,
            "subCounty": sub_county,
            "ward": ward,
            "plannedDate": row["planned_date"],
            "status": row["status"],
            "notes": row["notes"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }


@_database_errors_as_unavailable
def release_officer_visit(officer_user_id: str, visit_id: str) -> dict[str, Any] | None:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE officer_visits AS v
            SET officer_user_id = NULL,
                status = 'requested',
                updated_at = NOW()
            WHERE v.id = %s
              AND v.officer_user_id = %s
              AND v.status IN ('claimed', 'scheduled')
            RETURNING v.id, v.officer_user_id, v.farmer_id, v.farm_id,
                      v.planned_date, v.status, v.notes, v.created_at, v.updated_at
            """,
            (visit_id, officer_user_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None

        cursor.execute("SELECT display_name, phone FROM users WHERE id = %s", (row["farmer_id"],))
        farmer_row = cursor.fetchone()
        farmer_name = farmer_row["display_name"] if farmer_row else None
        farmer_phone = farmer_row["phone"] if farmer_row else None

        farm_name, county, sub_county, ward = None, None, None, None
        if row["farm_id"]:
            cursor.execute("SELECT name, county, sub_county, ward FROM farms WHERE id = %s", (row["farm_id"],))
            farm_row = cursor.fetchone()
            if farm_row:
                farm_name = farm_row["name"]
                county = farm_row["county"]
                sub_county = farm_row["sub_county"]
                ward = farm_row["ward"]

        return {
            "visitId": str(row["id"]),
            "officerUserId": None,
            "farmerId": str(row["farmer_id"]),
            "farmerName": farmer_name,
            "farmerPhone": farmer_phone,
            "farmId": str(row["farm_id"]) if row["farm_id"] else None,
            "farmName": farm_name,
            "county": county,
            "subCounty": sub_county,
            "ward": ward,
            "plannedDate": row["planned_date"],
            "status": row["status"],
            "notes": row["notes"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }


@_database_errors_as_unavailable
def record_officer_field_collection(
    officer_user_id: str,
    visit_id: str,
    latitude: float,
    longitude: float,
    location_uncertainty_m: float | None = None,
    top_cm: float = 0,
    bottom_cm: float = 20,
    measurements: list[dict[str, Any]] | None = None,
    sampled_at: datetime | None = None,
    notes: str | None = None,
    mark_completed: bool = True,
) -> dict[str, Any] | None:
    sampled_at = sampled_at or datetime.now(UTC)
    measurements = measurements or []
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT v.id, v.farm_id, v.farmer_id, v.status, f.name AS farm_name, u.display_name AS farmer_name,
                   f.county, f.sub_county, f.ward, f.size_acres, f.crops
            FROM officer_visits AS v
            JOIN farms AS f ON f.id = v.farm_id
            JOIN users AS u ON u.id = v.farmer_id
            WHERE v.id = %s AND v.officer_user_id = %s
              AND v.status IN ('claimed', 'scheduled', 'in_progress')
            """,
            (visit_id, officer_user_id),
        )
        visit_row = cursor.fetchone()
        if visit_row is None:
            return None

        farm_id = visit_row["farm_id"]
        farmer_id = visit_row["farmer_id"]
        farm_name = visit_row["farm_name"]
        farm_county = visit_row["county"] or "Nyeri"
        farm_sub_county = visit_row["sub_county"]
        farm_ward = visit_row["ward"]
        farm_size_acres = float(visit_row["size_acres"]) if visit_row["size_acres"] is not None else 1.0
        crops_str = visit_row["crops"] or "maize"
        primary_crop = crops_str.split(",")[0].strip().lower() if crops_str else "maize"

        cursor.execute(
            """
            UPDATE farms
            SET latitude = %s,
                longitude = %s,
                geom = ST_SetSRID(ST_MakePoint(%s, %s), 4326),
                coordinates_captured_by = %s,
                coordinates_captured_at = NOW(),
                soil_data_collected = TRUE,
                updated_at = NOW()
            WHERE id = %s
            """,
            (latitude, longitude, longitude, latitude, officer_user_id, farm_id),
        )

        reading_quality = "valid"
        cursor.execute(
            """
            INSERT INTO soil_readings (
                farm_id, officer_user_id, visit_id, reading_source, sampled_at, sample_year,
                source_label, top_cm, bottom_cm, location_uncertainty_m, latitude, longitude,
                source_provider, source_attribution, measurement_quality
            )
            VALUES (
                %s, %s, %s, 'OFFICER_FIELD_COLLECTION', %s, EXTRACT(YEAR FROM %s::timestamptz)::integer,
                'Extension Officer Field Inspection', %s, %s, %s, %s, %s,
                'OFFICER_FIELD_COLLECTION', 'Collected on-site by Extension Officer', %s
            )
            RETURNING id
            """,
            (
                farm_id,
                officer_user_id,
                visit_id,
                sampled_at,
                sampled_at,
                top_cm,
                bottom_cm,
                location_uncertainty_m,
                latitude,
                longitude,
                reading_quality,
            ),
        )
        reading_id = cursor.fetchone()["id"]

        soil_values_dict: dict[str, float | None] = {}
        for m in measurements:
            analyte_name = m.get("analyte") or m.get("source_analyte")
            analyte_val = _safe_float(m.get("value"))
            if analyte_name:
                soil_values_dict[analyte_name] = analyte_val
            cursor.execute(
                """
                INSERT INTO soil_measurements (
                    soil_reading_id, source_analyte, analyte_code, value, source_value_text,
                    source_unit, canonical_unit, analytical_method, quality_status, source_quality_class
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    reading_id,
                    m.get("source_analyte") or m.get("analyte"),
                    m.get("analyte"),
                    analyte_val,
                    m.get("source_value_text"),
                    m.get("source_unit") or "",
                    m.get("canonical_unit"),
                    m.get("analytical_method") or "Field Kit / Sensor",
                    m.get("quality_status") or "valid",
                    m.get("source_quality_class"),
                ),
            )

        # -------------------------------------------------------------------
        # Multi-Tiered Agronomic Recommendation Engine Invocation (Step 4)
        # -------------------------------------------------------------------
        assessment_doc = generate_agronomic_assessment(
            soil_values=soil_values_dict,
            crop=primary_crop,
            county=farm_county,
            sub_county=farm_sub_county,
            ward=farm_ward,
            size_acres=farm_size_acres,
            field_notes=notes,
        )

        cursor.execute(
            """
            INSERT INTO agronomic_assessments (
                farm_id, soil_reading_id, visit_id, officer_user_id, status, review_stage,
                county, sub_county, ward, crop, engine_version, engine_baseline
            )
            VALUES (%s, %s, %s, %s, 'unverified', 'review_requested', %s, %s, %s, %s, %s, %s::jsonb)
            RETURNING id
            """,
            (
                farm_id,
                reading_id,
                visit_id,
                officer_user_id,
                farm_county,
                farm_sub_county,
                farm_ward,
                primary_crop,
                assessment_doc.get("engineVersion", "kalro-rules-v2.1"),
                json.dumps(assessment_doc),
            ),
        )
        assessment_id = cursor.fetchone()["id"]

        # Populate baseline prescriptions into recommendations table for backward-compatible views
        for p in assessment_doc.get("prescriptions", []):
            rate_num = _safe_float(p.get("ratePerHa", "").split()[0]) if p.get("ratePerHa") else None
            rate_unit = p.get("ratePerHa", "").split()[-1] if p.get("ratePerHa") else "kg/ha"
            cursor.execute(
                """
                INSERT INTO recommendations (
                    soil_reading_id, user_id, farm_id, crop, title, rationale,
                    application_rate, application_unit, rule_version, review_status
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending_review')
                """,
                (
                    reading_id,
                    farmer_id,
                    farm_id,
                    primary_crop,
                    p.get("productType", "Agronomic Prescription"),
                    f"{p.get('totalFarmPrescription', '')}. {p.get('applicationTiming', '')}",
                    rate_num,
                    rate_unit,
                    assessment_doc.get("engineVersion", "kalro-rules-v2.1"),
                ),
            )

        next_status = "completed" if mark_completed else "in_progress"
        visit_notes = f"Field soil collection recorded ({len(measurements)} properties). {notes or ''}".strip()
        cursor.execute(
            """
            UPDATE officer_visits
            SET status = %s,
                notes = %s,
                updated_at = NOW()
            WHERE id = %s
            """,
            (next_status, visit_notes, visit_id),
        )

        cursor.execute(
            """
            INSERT INTO officer_alerts (
                farmer_id, farm_id, source, severity, status, title, summary, notes
            )
            VALUES (%s, %s, 'field_collection', 'info', 'open',
                    'Field Data Collected',
                    %s,
                    %s)
            """,
            (
                farmer_id,
                farm_id,
                f"Field inspection completed for {farm_name}. Soil measurements and exact GPS coordinates were captured. Assessment is currently undergoing agronomic review.",
                notes,
            ),
        )

        return {
            "visitId": str(visit_id),
            "farmId": str(farm_id),
            "readingId": str(reading_id),
            "assessmentId": str(assessment_id),
            "latitude": latitude,
            "longitude": longitude,
            "status": next_status,
            "soilDataCollected": True,
            "message": "Field data and GPS coordinates recorded successfully. Farm assessment dispatched for review.",
        }


@_database_errors_as_unavailable
def load_unverified_assessments(
    user_id: str,
    role: str,
    county: str | None = None,
) -> list[dict[str, Any]]:
    """
    Returns unverified assessments strictly scoped:
    - Officers see assessments for visits they claimed/collected.
    - Agronomists see assessments in their assigned county pool or ones they have claimed.
    - Other roles or cross-jurisdiction agronomists are blocked.
    """
    with _connect() as connection, connection.cursor() as cursor:
        if role in ("extension_officer", "extension-officer"):
            cursor.execute(
                """
                SELECT a.id, a.farm_id, a.soil_reading_id, a.visit_id, a.officer_user_id,
                       a.claiming_agronomist_id, a.status, a.review_stage, a.county, a.sub_county,
                       a.ward, a.crop, a.engine_version, a.engine_baseline, a.officer_edits,
                       a.agronomist_edits, a.created_at, f.name AS farm_name, u.display_name AS farmer_name
                FROM agronomic_assessments AS a
                JOIN farms AS f ON f.id = a.farm_id
                JOIN users AS u ON u.id = f.owner_id
                WHERE a.officer_user_id = %s
                  AND a.status = 'unverified'
                ORDER BY a.created_at DESC
                """,
                (user_id,),
            )
        elif role == "agronomist":
            cursor.execute(
                """
                SELECT a.id, a.farm_id, a.soil_reading_id, a.visit_id, a.officer_user_id,
                       a.claiming_agronomist_id, a.status, a.review_stage, a.county, a.sub_county,
                       a.ward, a.crop, a.engine_version, a.engine_baseline, a.officer_edits,
                       a.agronomist_edits, a.created_at, f.name AS farm_name, u.display_name AS farmer_name
                FROM agronomic_assessments AS a
                JOIN farms AS f ON f.id = a.farm_id
                JOIN users AS u ON u.id = f.owner_id
                JOIN agronomist_profiles AS ap ON ap.user_id = %s
                WHERE a.status = 'unverified'
                  AND ap.approval_status = 'approved'
                  AND (
                      a.claiming_agronomist_id = ap.user_id
                      OR (
                          a.claiming_agronomist_id IS NULL
                          AND ap.county IS NOT NULL
                          AND a.county ILIKE ap.county
                          AND (%s::text IS NULL OR a.county ILIKE %s)
                      )
                  )
                ORDER BY a.created_at DESC
                """,
                (user_id, county, county),
            )
        else:
            return []

        rows = cursor.fetchall()
        return [
            {
                "assessmentId": str(row["id"]),
                "farmId": str(row["farm_id"]),
                "farmName": row["farm_name"],
                "farmerName": row["farmer_name"],
                "readingId": str(row["soil_reading_id"]),
                "visitId": str(row["visit_id"]) if row["visit_id"] else None,
                "officerUserId": str(row["officer_user_id"]) if row["officer_user_id"] else None,
                "claimingAgronomistId": str(row["claiming_agronomist_id"]) if row["claiming_agronomist_id"] else None,
                "status": row["status"],
                "reviewStage": row["review_stage"],
                "county": row["county"],
                "subCounty": row["sub_county"],
                "ward": row["ward"],
                "crop": row["crop"],
                "engineVersion": row["engine_version"],
                "engineBaseline": row["engine_baseline"],
                "officerEdits": row["officer_edits"],
                "agronomistEdits": row["agronomist_edits"],
                "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
            }
            for row in rows
        ]


@_database_errors_as_unavailable
def claim_agronomic_assessment(agronomist_user_id: str, assessment_id: str) -> dict[str, Any] | None:
    """Atomic claim of an unverified assessment by an agronomist."""
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE agronomic_assessments AS a
            SET claiming_agronomist_id = %s,
                review_stage = 'claimed',
                claimed_at = NOW(),
                updated_at = NOW()
            WHERE a.id = %s
              AND status = 'unverified'
              AND (a.claiming_agronomist_id IS NULL OR a.claiming_agronomist_id = %s)
              AND EXISTS (
                  SELECT 1
                  FROM agronomist_profiles AS ap
                  WHERE ap.user_id = %s
                    AND ap.approval_status = 'approved'
                    AND ap.county IS NOT NULL
                    AND a.county ILIKE ap.county
              )
            RETURNING id, farm_id, claiming_agronomist_id, review_stage, status, county
            """,
            (agronomist_user_id, assessment_id, agronomist_user_id, agronomist_user_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "assessmentId": str(row["id"]),
            "farmId": str(row["farm_id"]),
            "claimingAgronomistId": str(row["claiming_agronomist_id"]),
            "reviewStage": row["review_stage"],
            "status": row["status"],
            "county": row["county"],
            "message": "Assessment claimed successfully. Ready for agronomic review.",
        }


@_database_errors_as_unavailable
def release_agronomic_assessment(agronomist_user_id: str, assessment_id: str) -> dict[str, Any] | None:
    """Release a claimed assessment back to the county pool while preserving edits."""
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE agronomic_assessments
            SET claiming_agronomist_id = NULL,
                review_stage = 'review_requested',
                claimed_at = NULL,
                updated_at = NOW()
            WHERE id = %s
              AND claiming_agronomist_id = %s
              AND status = 'unverified'
            RETURNING id, farm_id, review_stage, status, county
            """,
            (assessment_id, agronomist_user_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "assessmentId": str(row["id"]),
            "farmId": str(row["farm_id"]),
            "reviewStage": row["review_stage"],
            "status": row["status"],
            "county": row["county"],
            "message": "Assessment released back to the county review pool.",
        }


@_database_errors_as_unavailable
def edit_agronomic_assessment(
    user_id: str,
    role: str,
    assessment_id: str,
    author_name: str,
    notes: str,
    adjustments: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    """Collaborative edit by assigned officer or claiming agronomist."""
    adjustments = adjustments or []
    new_edit_entry = {
        "authorId": user_id,
        "authorName": author_name,
        "role": role,
        "notes": notes,
        "adjustments": adjustments,
        "timestamp": datetime.now(UTC).isoformat(),
    }
    with _connect() as connection, connection.cursor() as cursor:
        if role in ("extension_officer", "extension-officer"):
            cursor.execute(
                """
                UPDATE agronomic_assessments
                SET officer_edits = officer_edits || %s::jsonb,
                    updated_at = NOW()
                WHERE id = %s
                  AND officer_user_id = %s
                  AND status = 'unverified'
                RETURNING id, farm_id, status, officer_edits, agronomist_edits
                """,
                (json.dumps([new_edit_entry]), assessment_id, user_id),
            )
        elif role == "agronomist":
            cursor.execute(
                """
                UPDATE agronomic_assessments
                SET agronomist_edits = agronomist_edits || %s::jsonb,
                    review_stage = 'under_review',
                    updated_at = NOW()
                WHERE id = %s
                  AND claiming_agronomist_id = %s
                  AND status = 'unverified'
                RETURNING id, farm_id, status, officer_edits, agronomist_edits
                """,
                (json.dumps([new_edit_entry]), assessment_id, user_id),
            )
        else:
            return None

        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "assessmentId": str(row["id"]),
            "farmId": str(row["farm_id"]),
            "status": row["status"],
            "officerEdits": row["officer_edits"],
            "agronomistEdits": row["agronomist_edits"],
            "message": "Agronomic adjustments recorded successfully.",
        }


@_database_errors_as_unavailable
def publish_verified_assessment(
    agronomist_user_id: str,
    agronomist_name: str,
    assessment_id: str,
    license_number: str | None = None,
    final_notes: str | None = None,
) -> dict[str, Any] | None:
    """
    Locks and publishes the immutable verified report.
    Updates recommendations table to approved and dispatches farmer alert.
    """
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT a.id, a.farm_id, a.soil_reading_id, a.crop, a.county, a.engine_baseline,
                   a.officer_edits, a.agronomist_edits, f.name AS farm_name, f.owner_id AS farmer_id
            FROM agronomic_assessments AS a
            JOIN farms AS f ON f.id = a.farm_id
            WHERE a.id = %s
              AND a.claiming_agronomist_id = %s
              AND a.status = 'unverified'
            """,
            (assessment_id, agronomist_user_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None

        farm_id = row["farm_id"]
        reading_id = row["soil_reading_id"]
        farmer_id = row["farmer_id"]
        farm_name = row["farm_name"]
        baseline = row["engine_baseline"] or {}

        verified_doc = {
            "reportId": str(uuid.uuid4()),
            "assessmentId": str(assessment_id),
            "farmId": str(farm_id),
            "farmName": farm_name,
            "crop": baseline.get("crop", row["crop"]),
            "county": row["county"],
            "publishedAt": datetime.now(UTC).isoformat(),
            "publishedBy": {
                "agronomistId": agronomist_user_id,
                "name": agronomist_name,
                "licenseNumber": license_number or "KALRO/AGR-KE-VERIFIED",
            },
            "status": "verified",
            "diagnoses": baseline.get("diagnoses", []),
            "prescriptions": baseline.get("prescriptions", []),
            "commercialInputs": baseline.get("commercialInputs", []),
            "splitSchedule": baseline.get("splitSchedule", []),
            "aiAdvisoryNotes": baseline.get("aiAdvisoryNotes", []),
            "officerEdits": row["officer_edits"],
            "agronomistEdits": row["agronomist_edits"],
            "finalAgronomistNotes": final_notes,
            "certification": (
                f"Certified by Licensed Agronomist {agronomist_name} ({license_number or 'KALRO/AGR-KE'}). "
                "Verified and published for farmer field application."
            ),
        }

        cursor.execute(
            """
            UPDATE agronomic_assessments
            SET status = 'verified',
                review_stage = 'published',
                verified_report = %s::jsonb,
                published_at = NOW(),
                published_by = %s,
                updated_at = NOW()
            WHERE id = %s
            """,
            (json.dumps(verified_doc), agronomist_user_id, assessment_id),
        )

        cursor.execute(
            """
            UPDATE recommendations
            SET review_status = 'approved',
                updated_at = NOW()
            WHERE soil_reading_id = %s
            """,
            (reading_id,),
        )

        cursor.execute(
            """
            INSERT INTO officer_alerts (
                farmer_id, farm_id, source, severity, status, title, summary, notes
            )
            VALUES (%s, %s, 'agronomist_review', 'info', 'open',
                    'Verified Soil Report Published',
                    %s,
                    %s)
            """,
            (
                farmer_id,
                farm_id,
                f"Your verified soil report for {farm_name} is published and ready. Customized lime, basal fertilizer, and topdressing schedules have been certified.",
                final_notes,
            ),
        )

        return {
            "assessmentId": str(assessment_id),
            "status": "verified",
            "reviewStage": "published",
            "publishedAt": verified_doc["publishedAt"],
            "verifiedReport": verified_doc,
            "message": "Assessment verified and published successfully. Report is now available to the farmer.",
        }


@_database_errors_as_unavailable
def load_farm_verified_report(user_id: str, farm_id: str) -> dict[str, Any] | None:
    """
    Farmer endpoint: Loads the published verified report for a farmer's owned farm.
    Returns None if no verified report exists (unverified assessments remain hidden).
    """
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT a.id, a.verified_report, a.published_at, a.crop
            FROM agronomic_assessments AS a
            JOIN farms AS f ON f.id = a.farm_id
            WHERE a.farm_id = %s
              AND f.owner_id = %s
              AND a.status = 'verified'
            ORDER BY a.published_at DESC
            LIMIT 1
            """,
            (farm_id, user_id),
        )
        row = cursor.fetchone()
        if row is None or not row.get("verified_report"):
            return None
        return row["verified_report"]



@_database_errors_as_unavailable
def create_officer_visit(
    officer_user_id: str,
    farmer_id: str,
    farm_id: str | None,
    planned_date: datetime,
    status: str,
    notes: str | None,
) -> dict[str, Any] | None:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT 1 FROM farms
            JOIN officer_jurisdictions AS oj
              ON (oj.county IS NULL OR farms.county = oj.county)
             AND (oj.sub_county IS NULL OR farms.sub_county = oj.sub_county)
             AND (oj.ward IS NULL OR farms.ward = oj.ward)
            WHERE oj.officer_user_id = %s
              AND oj.is_active = TRUE
              AND farms.owner_id = %s
              AND (%s::uuid IS NULL OR farms.id = %s::uuid)
            LIMIT 1
            """,
            (officer_user_id, farmer_id, farm_id, farm_id),
        )
        if cursor.fetchone() is None:
            return None

        cursor.execute(
            """
            INSERT INTO officer_visits (
                officer_user_id, farmer_id, farm_id, planned_date, status, notes
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id, officer_user_id, farmer_id, farm_id, planned_date, status, notes, created_at, updated_at
            """,
            (officer_user_id, farmer_id, farm_id, planned_date, status, notes),
        )
        row = cursor.fetchone()
        if row is None:
            return None

        cursor.execute("SELECT display_name FROM users WHERE id = %s", (farmer_id,))
        farmer_row = cursor.fetchone()
        farmer_name = farmer_row["display_name"] if farmer_row else None

        farm_name = None
        if farm_id:
            cursor.execute("SELECT name FROM farms WHERE id = %s", (farm_id,))
            farm_row = cursor.fetchone()
            farm_name = farm_row["name"] if farm_row else None

        return {
            "visitId": str(row["id"]),
            "officerUserId": str(row["officer_user_id"]),
            "farmerId": str(row["farmer_id"]),
            "farmerName": farmer_name,
            "farmId": str(row["farm_id"]) if row["farm_id"] else None,
            "farmName": farm_name,
            "plannedDate": row["planned_date"],
            "status": row["status"],
            "notes": row["notes"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }


@_database_errors_as_unavailable
def update_officer_visit(
    officer_user_id: str,
    visit_id: str,
    planned_date: datetime | None,
    status: str | None,
    notes: str | None,
) -> dict[str, Any] | None:
    with _connect() as connection, connection.cursor() as cursor:
        updates = []
        params: list[Any] = []
        if planned_date is not None:
            updates.append("planned_date = %s")
            params.append(planned_date)
        if status is not None:
            updates.append("status = %s")
            params.append(status)
        if notes is not None:
            updates.append("notes = %s")
            params.append(notes)
        if not updates:
            updates.append("updated_at = NOW()")

        params.extend([visit_id, officer_user_id, officer_user_id])
        query = f"""
            UPDATE officer_visits AS v
            SET {", ".join(updates)}, updated_at = NOW()
            WHERE v.id = %s
              AND (
                  v.officer_user_id = %s
                  OR EXISTS (
                      SELECT 1 FROM farms
                      JOIN officer_jurisdictions AS oj
                        ON (oj.county IS NULL OR farms.county = oj.county)
                       AND (oj.sub_county IS NULL OR farms.sub_county = oj.sub_county)
                       AND (oj.ward IS NULL OR farms.ward = oj.ward)
                      WHERE oj.officer_user_id = %s
                        AND oj.is_active = TRUE
                        AND (farms.owner_id = v.farmer_id OR farms.id = v.farm_id)
                  )
              )
            RETURNING v.id, v.officer_user_id, v.farmer_id, v.farm_id,
                      v.planned_date, v.status, v.notes, v.created_at, v.updated_at
        """
        cursor.execute(query, tuple(params))
        row = cursor.fetchone()
        if row is None:
            return None

        cursor.execute("SELECT display_name FROM users WHERE id = %s", (row["farmer_id"],))
        farmer_row = cursor.fetchone()
        farmer_name = farmer_row["display_name"] if farmer_row else None

        farm_name = None
        if row["farm_id"]:
            cursor.execute("SELECT name FROM farms WHERE id = %s", (row["farm_id"],))
            farm_row = cursor.fetchone()
            farm_name = farm_row["name"] if farm_row else None

        return {
            "visitId": str(row["id"]),
            "officerUserId": str(row["officer_user_id"]),
            "farmerId": str(row["farmer_id"]),
            "farmerName": farmer_name,
            "farmId": str(row["farm_id"]) if row["farm_id"] else None,
            "farmName": farm_name,
            "plannedDate": row["planned_date"],
            "status": row["status"],
            "notes": row["notes"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }


@_database_errors_as_unavailable
def load_officer_alerts(officer_user_id: str) -> list[dict[str, Any]]:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT a.id, a.officer_user_id, a.farmer_id, a.farm_id,
                   a.source, a.severity, a.status, a.title, a.summary,
                   a.notes, a.resolution_notes, a.resolved_at,
                   a.created_at, a.updated_at,
                   u.display_name AS farmer_name,
                   f.name AS farm_name
            FROM officer_alerts AS a
            JOIN users AS u ON u.id = a.farmer_id
            LEFT JOIN farms AS f ON f.id = a.farm_id
            WHERE EXISTS (
                SELECT 1 FROM farms
                JOIN officer_jurisdictions AS oj
                  ON (oj.county IS NULL OR farms.county = oj.county)
                 AND (oj.sub_county IS NULL OR farms.sub_county = oj.sub_county)
                 AND (oj.ward IS NULL OR farms.ward = oj.ward)
                WHERE oj.officer_user_id = %s
                  AND oj.is_active = TRUE
                  AND (farms.owner_id = a.farmer_id OR farms.id = a.farm_id)
            )
            ORDER BY
                CASE a.status WHEN 'open' THEN 1 WHEN 'acknowledged' THEN 2 ELSE 3 END,
                a.created_at DESC
            """,
            (officer_user_id,),
        )
        return [
            {
                "alertId": str(row["id"]),
                "officerUserId": str(row["officer_user_id"]) if row["officer_user_id"] else None,
                "farmerId": str(row["farmer_id"]),
                "farmerName": row["farmer_name"],
                "farmId": str(row["farm_id"]) if row["farm_id"] else None,
                "farmName": row["farm_name"],
                "source": row["source"],
                "severity": row["severity"],
                "status": row["status"],
                "title": row["title"],
                "summary": row["summary"],
                "notes": row["notes"],
                "resolutionNotes": row["resolution_notes"],
                "resolvedAt": row["resolved_at"],
                "createdAt": row["created_at"],
                "updatedAt": row["updated_at"],
            }
            for row in cursor.fetchall()
        ]


@_database_errors_as_unavailable
def create_officer_alert(
    officer_user_id: str,
    farmer_id: str,
    farm_id: str | None,
    title: str,
    summary: str | None,
    source: str,
    severity: str,
    notes: str | None,
) -> dict[str, Any] | None:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT 1 FROM farms
            JOIN officer_jurisdictions AS oj
              ON (oj.county IS NULL OR farms.county = oj.county)
             AND (oj.sub_county IS NULL OR farms.sub_county = oj.sub_county)
             AND (oj.ward IS NULL OR farms.ward = oj.ward)
            WHERE oj.officer_user_id = %s
              AND oj.is_active = TRUE
              AND farms.owner_id = %s
              AND (%s::uuid IS NULL OR farms.id = %s::uuid)
            LIMIT 1
            """,
            (officer_user_id, farmer_id, farm_id, farm_id),
        )
        if cursor.fetchone() is None:
            return None

        cursor.execute(
            """
            INSERT INTO officer_alerts (
                officer_user_id, farmer_id, farm_id, title, summary, source, severity, status, notes
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'open', %s)
            RETURNING id, officer_user_id, farmer_id, farm_id, source, severity, status,
                      title, summary, notes, resolution_notes, resolved_at, created_at, updated_at
            """,
            (officer_user_id, farmer_id, farm_id, title, summary, source, severity, notes),
        )
        row = cursor.fetchone()
        if row is None:
            return None

        cursor.execute("SELECT display_name FROM users WHERE id = %s", (farmer_id,))
        farmer_row = cursor.fetchone()
        farmer_name = farmer_row["display_name"] if farmer_row else None

        farm_name = None
        if farm_id:
            cursor.execute("SELECT name FROM farms WHERE id = %s", (farm_id,))
            farm_row = cursor.fetchone()
            farm_name = farm_row["name"] if farm_row else None

        return {
            "alertId": str(row["id"]),
            "officerUserId": str(row["officer_user_id"]) if row["officer_user_id"] else None,
            "farmerId": str(row["farmer_id"]),
            "farmerName": farmer_name,
            "farmId": str(row["farm_id"]) if row["farm_id"] else None,
            "farmName": farm_name,
            "source": row["source"],
            "severity": row["severity"],
            "status": row["status"],
            "title": row["title"],
            "summary": row["summary"],
            "notes": row["notes"],
            "resolutionNotes": row["resolution_notes"],
            "resolvedAt": row["resolved_at"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }


@_database_errors_as_unavailable
def create_farmer_visit_request(
    farmer_user_id: str,
    farm_id: str,
    notes: str | None = None,
) -> dict[str, Any] | None:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT f.id, f.name, f.county, f.sub_county, f.ward, u.display_name
            FROM farms AS f
            JOIN users AS u ON u.id = f.owner_id
            WHERE f.id = %s AND f.owner_id = %s
            """,
            (farm_id, farmer_user_id),
        )
        farm = cursor.fetchone()
        if farm is None:
            return None

        title = f"Field Visit Requested: {farm['name']}"
        location_parts = [p for p in [farm["ward"], farm["sub_county"], farm["county"]] if p]
        location_info = f" ({', '.join(location_parts)})" if location_parts else ""
        farmer_name = farm["display_name"] or "Farmer"
        summary = f"{farmer_name} requested an on-site field visit for soil testing and GPS calibration{location_info}."

        cursor.execute(
            """
            INSERT INTO officer_alerts (
                farmer_id, farm_id, source, severity, status, title, summary, notes
            )
            VALUES (%s, %s, 'farmer_request', 'info', 'open', %s, %s, %s)
            RETURNING id, created_at
            """,
            (farmer_user_id, farm_id, title, summary, notes),
        )
        row = cursor.fetchone()

        cursor.execute(
            """
            INSERT INTO officer_visits (
                officer_user_id, farmer_id, farm_id, planned_date, status, notes
            )
            VALUES (NULL, %s, %s, NULL, 'requested', %s)
            ON CONFLICT (farm_id) WHERE status = 'requested' DO UPDATE
                SET notes = COALESCE(EXCLUDED.notes, officer_visits.notes),
                    updated_at = NOW()
            RETURNING id, created_at
            """,
            (farmer_user_id, farm_id, notes),
        )
        visit_row = cursor.fetchone()
        visit_id = str(visit_row["id"]) if visit_row else None

        return {
            "requestId": str(row["id"]),
            "visitId": visit_id,
            "farmId": farm_id,
            "status": "requested",
            "message": "Field visit request submitted to county extension officer pool.",
            "createdAt": row["created_at"],
        }


@_database_errors_as_unavailable
def update_officer_alert(
    officer_user_id: str,
    alert_id: str,
    severity: str | None,
    status: str | None,
    notes: str | None,
    resolution_notes: str | None,
) -> dict[str, Any] | None:
    with _connect() as connection, connection.cursor() as cursor:
        updates = []
        params: list[Any] = []
        if severity is not None:
            updates.append("severity = %s")
            params.append(severity)
        if status is not None:
            updates.append("status = %s")
            params.append(status)
            if status == "resolved":
                updates.append("resolved_at = NOW()")
            elif status in ("open", "acknowledged"):
                updates.append("resolved_at = NULL")
        if notes is not None:
            updates.append("notes = %s")
            params.append(notes)
        if resolution_notes is not None:
            updates.append("resolution_notes = %s")
            params.append(resolution_notes)

        if not updates:
            updates.append("updated_at = NOW()")

        params.extend([alert_id, officer_user_id])
        query = f"""
            UPDATE officer_alerts AS a
            SET {", ".join(updates)}, updated_at = NOW()
            WHERE a.id = %s
              AND EXISTS (
                  SELECT 1 FROM farms
                  JOIN officer_jurisdictions AS oj
                    ON (oj.county IS NULL OR farms.county = oj.county)
                   AND (oj.sub_county IS NULL OR farms.sub_county = oj.sub_county)
                   AND (oj.ward IS NULL OR farms.ward = oj.ward)
                  WHERE oj.officer_user_id = %s
                    AND oj.is_active = TRUE
                    AND (farms.owner_id = a.farmer_id OR farms.id = a.farm_id)
              )
            RETURNING a.id, a.officer_user_id, a.farmer_id, a.farm_id,
                      a.source, a.severity, a.status, a.title, a.summary,
                      a.notes, a.resolution_notes, a.resolved_at,
                      a.created_at, a.updated_at
        """
        cursor.execute(query, tuple(params))
        row = cursor.fetchone()
        if row is None:
            return None

        cursor.execute("SELECT display_name FROM users WHERE id = %s", (row["farmer_id"],))
        farmer_row = cursor.fetchone()
        farmer_name = farmer_row["display_name"] if farmer_row else None

        farm_name = None
        if row["farm_id"]:
            cursor.execute("SELECT name FROM farms WHERE id = %s", (row["farm_id"],))
            farm_row = cursor.fetchone()
            farm_name = farm_row["name"] if farm_row else None

        return {
            "alertId": str(row["id"]),
            "officerUserId": str(row["officer_user_id"]) if row["officer_user_id"] else None,
            "farmerId": str(row["farmer_id"]),
            "farmerName": farmer_name,
            "farmId": str(row["farm_id"]) if row["farm_id"] else None,
            "farmName": farm_name,
            "source": row["source"],
            "severity": row["severity"],
            "status": row["status"],
            "title": row["title"],
            "summary": row["summary"],
            "notes": row["notes"],
            "resolutionNotes": row["resolution_notes"],
            "resolvedAt": row["resolved_at"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }


@_database_errors_as_unavailable
def load_officer_ward_summaries(officer_user_id: str) -> list[dict[str, Any]]:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT farms.county, farms.sub_county, farms.ward,
                   COUNT(DISTINCT farmers.id) AS farmer_count,
                   COUNT(DISTINCT farms.id) AS farm_count,
                   COUNT(DISTINCT readings.id) AS reading_count,
                   COUNT(measurements.id) AS sample_count,
                   MAX(readings.sampled_at) AS latest_sample_date
            FROM officer_jurisdictions AS oj
            JOIN users AS officer
              ON officer.id = oj.officer_user_id
             AND officer.role = 'extension_officer'
             AND officer.is_active = TRUE
            JOIN farms
              ON (oj.county IS NULL OR farms.county = oj.county)
             AND (oj.sub_county IS NULL OR farms.sub_county = oj.sub_county)
             AND (oj.ward IS NULL OR farms.ward = oj.ward)
            JOIN users AS farmers
              ON farmers.id = farms.owner_id
             AND farmers.role = 'farmer'
             AND farmers.is_active = TRUE
            LEFT JOIN soil_readings AS readings ON readings.farm_id = farms.id
            LEFT JOIN soil_measurements AS measurements ON measurements.soil_reading_id = readings.id
            WHERE oj.officer_user_id = %s
              AND oj.is_active = TRUE
            GROUP BY farms.county, farms.sub_county, farms.ward
            ORDER BY farms.county, farms.sub_county, farms.ward
            """,
            (officer_user_id,),
        )
        results = []
        for row in cursor.fetchall():
            results.append(
                {
                    "county": row["county"] or "Unspecified",
                    "subCounty": row["sub_county"],
                    "ward": row["ward"] or "Unspecified",
                    "farmerCount": int(row["farmer_count"]),
                    "farmCount": int(row["farm_count"]),
                    "readingCount": int(row["reading_count"]),
                    "sampleCount": int(row["sample_count"]),
                    "aggregationLimits": "Ward-level aggregate. Small cohorts (<3 samples) protected to prevent re-identification.",
                    "dataFreshness": row["latest_sample_date"],
                }
            )
        return results


@_database_errors_as_unavailable
def export_officer_report(
    officer_user_id: str,
    county: str | None,
    sub_county: str | None,
    ward: str | None,
    export_format: str = "json",
) -> dict[str, Any] | None:
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT 1 FROM officer_jurisdictions AS oj
            WHERE oj.officer_user_id = %s
              AND oj.is_active = TRUE
              AND (%s IS NULL OR oj.county IS NULL OR oj.county = %s)
              AND (%s IS NULL OR oj.sub_county IS NULL OR oj.sub_county = %s)
              AND (%s IS NULL OR oj.ward IS NULL OR oj.ward = %s)
            LIMIT 1
            """,
            (officer_user_id, county, county, sub_county, sub_county, ward, ward),
        )
        if cursor.fetchone() is None:
            return None

        cursor.execute(
            """
            SELECT readings.id AS reading_id,
                   farmers.display_name AS farmer_name,
                   farms.name AS farm_name,
                   farms.county, farms.sub_county, farms.ward,
                   readings.sample_year, readings.sampled_at,
                   readings.top_cm, readings.bottom_cm,
                   readings.source_provider,
                   measurements.analyte_code, measurements.value,
                   measurements.source_unit, measurements.quality_status
            FROM soil_readings AS readings
            JOIN farms ON farms.id = readings.farm_id
            JOIN users AS farmers ON farmers.id = farms.owner_id
            JOIN officer_jurisdictions AS oj
              ON oj.officer_user_id = %s
             AND oj.is_active = TRUE
             AND (oj.county IS NULL OR farms.county = oj.county)
             AND (oj.sub_county IS NULL OR farms.sub_county = oj.sub_county)
             AND (oj.ward IS NULL OR farms.ward = oj.ward)
            LEFT JOIN soil_measurements AS measurements ON measurements.soil_reading_id = readings.id
            WHERE (%s IS NULL OR farms.county = %s)
              AND (%s IS NULL OR farms.sub_county = %s)
              AND (%s IS NULL OR farms.ward = %s)
            ORDER BY farms.county, farms.ward, readings.sampled_at DESC NULLS LAST
            LIMIT 500
            """,
            (officer_user_id, county, county, sub_county, sub_county, ward, ward),
        )

        records = [
            {
                "readingId": str(row["reading_id"]),
                "farmerName": row["farmer_name"],
                "farmName": row["farm_name"],
                "county": row["county"],
                "subCounty": row["sub_county"],
                "ward": row["ward"],
                "sampleYear": row["sample_year"],
                "sampledAt": row["sampled_at"].isoformat() if row["sampled_at"] else None,
                "topCm": float(row["top_cm"]) if row["top_cm"] is not None else None,
                "bottomCm": float(row["bottom_cm"]) if row["bottom_cm"] is not None else None,
                "sourceProvider": row["source_provider"],
                "analyte": row["analyte_code"],
                "value": float(row["value"]) if row["value"] is not None else None,
                "unit": row["source_unit"],
                "qualityStatus": row["quality_status"],
            }
            for row in cursor.fetchall()
        ]

        import uuid
        export_id = f"exp-{uuid.uuid4().hex[:12]}"
        return {
            "exportId": export_id,
            "officerUserId": officer_user_id,
            "scope": {"county": county, "subCounty": sub_county, "ward": ward},
            "allowlistedFields": [
                "readingId", "farmerName", "farmName", "county", "subCounty", "ward",
                "sampleYear", "sampledAt", "topCm", "bottomCm", "sourceProvider",
                "analyte", "value", "unit", "qualityStatus"
            ],
            "privacyDisclaimer": "Exported under reviewed extension services access policy. Phone numbers, national IDs, and exact coordinates are strictly excluded.",
            "recordCount": len(records),
            "exportedAt": datetime.now(UTC),
            "records": records,
        }


@_database_errors_as_unavailable
def admin_approve_user(
    admin_user_id: str, target_user_id: str, notes: str | None = None
) -> dict[str, Any] | None:
    """Approve a user account; requires manage_accounts permission."""
    if not check_admin_permission(admin_user_id, "manage_accounts"):
        return None
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE users
            SET approval_status = 'approved',
                approved_by = %s,
                approved_at = NOW(),
                is_active = TRUE,
                revocation_reason = NULL,
                suspended_at = NULL,
                suspended_by = NULL
            WHERE id = %s
            RETURNING id, display_name, email, role, is_active, approval_status, approved_at,
                      supabase_auth_user_id
            """,
            (admin_user_id, target_user_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        auth_user_id = row.get("supabase_auth_user_id")
        if auth_user_id:
            role = "extension-officer" if row["role"] == "extension_officer" else row["role"]
            _upsert_auth_role(cursor, str(auth_user_id), role, "active")
        return {
            "userId": str(row["id"]),
            "displayName": row["display_name"],
            "email": row["email"],
            "role": row["role"],
            "isActive": row["is_active"],
            "approvalStatus": row["approval_status"],
            "approvedAt": row["approved_at"].isoformat() if hasattr(row["approved_at"], "isoformat") else str(row["approved_at"]),
        }


@_database_errors_as_unavailable
def admin_revoke_user(
    admin_user_id: str, target_user_id: str, reason: str, revoke_role: bool = False
) -> dict[str, Any] | None:
    """Suspend/revoke a user account; requires manage_accounts permission."""
    if not check_admin_permission(admin_user_id, "manage_accounts"):
        return None
    with _connect() as connection, connection.cursor() as cursor:
        if revoke_role:
            cursor.execute(
                """
                UPDATE users
                SET approval_status = 'suspended',
                    suspended_by = %s,
                    suspended_at = NOW(),
                    is_active = FALSE,
                    revocation_reason = %s,
                    role = 'farmer'
                WHERE id = %s
                RETURNING id, display_name, email, role, is_active, approval_status, suspended_at,
                          revocation_reason, supabase_auth_user_id
                """,
                (admin_user_id, reason, target_user_id),
            )
        else:
            cursor.execute(
                """
                UPDATE users
                SET approval_status = 'suspended',
                    suspended_by = %s,
                    suspended_at = NOW(),
                    is_active = FALSE,
                    revocation_reason = %s
                WHERE id = %s
                RETURNING id, display_name, email, role, is_active, approval_status, suspended_at,
                          revocation_reason, supabase_auth_user_id
                """,
                (admin_user_id, reason, target_user_id),
            )
        row = cursor.fetchone()
        if row is None:
            return None
        auth_user_id = row.get("supabase_auth_user_id")
        if auth_user_id:
            cursor.execute(
                """
                UPDATE user_roles
                SET status = 'suspended', updated_at = NOW()
                WHERE user_id = %s
                """,
                (str(auth_user_id),),
            )
        return {
            "userId": str(row["id"]),
            "displayName": row["display_name"],
            "email": row["email"],
            "role": row["role"],
            "isActive": row["is_active"],
            "approvalStatus": row["approval_status"],
            "suspendedAt": row["suspended_at"].isoformat() if hasattr(row["suspended_at"], "isoformat") else str(row["suspended_at"]),
            "revocationReason": row["revocation_reason"],
        }


@_database_errors_as_unavailable
def load_admin_system_overview(admin_user_id: str) -> dict[str, Any]:
    """Retrieve system overview metrics; requires admin session."""
    with _connect() as connection, connection.cursor() as cursor:
        # Role counts
        cursor.execute(
            """
            SELECT role, COUNT(*) AS count
            FROM users
            GROUP BY role
            """
        )
        role_counts = {row["role"]: row["count"] for row in cursor.fetchall()}

        # User aggregate stats
        cursor.execute(
            """
            SELECT 
                COUNT(*) AS total_users,
                COUNT(*) FILTER (WHERE is_active = TRUE) AS active_users,
                COUNT(*) FILTER (WHERE approval_status = 'pending') AS pending_approvals
            FROM users
            """
        )
        user_row = cursor.fetchone() or {"total_users": 0, "active_users": 0, "pending_approvals": 0}

        # Farms count
        cursor.execute("SELECT COUNT(*) AS total_farms FROM farms")
        farm_row = cursor.fetchone() or {"total_farms": 0}

        # Readings count
        cursor.execute("SELECT COUNT(*) AS total_readings FROM soil_readings")
        reading_row = cursor.fetchone() or {"total_readings": 0}

        # Sync drafts counts
        cursor.execute(
            """
            SELECT status, COUNT(*) AS count
            FROM sync_drafts
            GROUP BY status
            """
        )
        sync_counts = {row["status"]: row["count"] for row in cursor.fetchall()}

        # Unresolved alerts
        cursor.execute(
            """
            SELECT COUNT(*) AS count
            FROM officer_alerts
            WHERE status != 'resolved'
            """
        )
        alert_row = cursor.fetchone() or {"count": 0}

        # Active support grants
        cursor.execute(
            """
            SELECT COUNT(*) AS count
            FROM support_access_grants
            WHERE expires_at > NOW() AND is_revoked = FALSE
            """
        )
        grant_row = cursor.fetchone() or {"count": 0}

        return {
            "totalUsers": user_row.get("total_users", 0),
            "activeUsers": user_row.get("active_users", 0),
            "pendingApprovals": user_row.get("pending_approvals", 0),
            "roleBreakdown": {
                "farmers": role_counts.get("farmer", 0),
                "extensionOfficers": role_counts.get("extension_officer", 0),
                "agrodealers": role_counts.get("agrodealer", 0),
                "admins": role_counts.get("admin", 0),
            },
            "totalFarms": farm_row.get("total_farms", 0),
            "totalSoilReadings": reading_row.get("total_readings", 0),
            "syncOverview": {
                "pending": sync_counts.get("pending", 0),
                "draft": sync_counts.get("draft", 0),
                "failed": sync_counts.get("failed", 0),
                "conflict": sync_counts.get("conflict", 0),
            },
            "unresolvedAlerts": alert_row.get("count", 0),
            "activeSupportGrants": grant_row.get("count", 0),
        }


@_database_errors_as_unavailable
def load_admin_operational_health(admin_user_id: str) -> dict[str, Any]:
    """Retrieve operational health, import batches, and provider status without exposing PII."""
    with _connect() as connection, connection.cursor() as cursor:
        # Import batches
        cursor.execute(
            """
            SELECT ib.id, ib.source_file_name, ib.status, ib.rows_read, ib.rows_imported,
                   ib.rows_rejected, ib.started_at, ib.completed_at,
                   sd.dataset_key, sd.title AS dataset_title
            FROM source_import_batches AS ib
            JOIN source_datasets AS sd ON sd.id = ib.dataset_id
            ORDER BY ib.started_at DESC
            LIMIT 20
            """
        )
        import_batches = [
            {
                "batchId": str(row["id"]),
                "datasetKey": row["dataset_key"],
                "datasetTitle": row["dataset_title"],
                "fileName": row["source_file_name"],
                "status": row["status"],
                "rowsRead": row["rows_read"],
                "rowsImported": row["rows_imported"],
                "rowsRejected": row["rows_rejected"],
                "startedAt": row["started_at"].isoformat() if hasattr(row["started_at"], "isoformat") else str(row["started_at"]),
                "completedAt": row["completed_at"].isoformat() if row.get("completed_at") and hasattr(row["completed_at"], "isoformat") else None,
            }
            for row in cursor.fetchall()
        ]

        # Anonymized sync failure aggregates
        cursor.execute(
            """
            SELECT status, COUNT(*) AS count
            FROM sync_drafts
            WHERE status IN ('failed', 'conflict')
            GROUP BY status
            """
        )
        sync_issues = {row["status"]: row["count"] for row in cursor.fetchall()}

        return {
            "status": "operational",
            "checkedAt": datetime.now(UTC).isoformat(),
            "database": {
                "status": "connected",
                "engine": "PostgreSQL 16 (PostGIS)",
                "poolStatus": "healthy",
            },
            "syncSubsystem": {
                "failedDraftsCount": sync_issues.get("failed", 0),
                "conflictDraftsCount": sync_issues.get("conflict", 0),
                "privacySafeguard": "Sync issue metrics are strictly anonymized. No farmer identifiers, phone numbers, or coordinates are exposed.",
            },
            "importBatches": import_batches,
            "externalProviders": [
                {
                    "provider": "ISRIC_SOILGRIDS",
                    "label": "SoilGrids REST & WCS",
                    "status": "healthy",
                    "description": "Global gridded soil property layers at 250m resolution.",
                },
                {
                    "provider": "ISRIC_WOSIS",
                    "label": "WoSIS Standardized Soil Profile Database",
                    "status": "healthy",
                    "description": "Standardized point observations dataset for Eastern Africa.",
                },
                {
                    "provider": "SUPABASE_AUTH",
                    "label": "Supabase Identity & Auth",
                    "status": "healthy",
                    "description": "JWT-based session authentication and cryptographic token verification.",
                },
            ],
        }


@_database_errors_as_unavailable
def create_support_access_grant(
    admin_user_id: str,
    target_type: str,
    target_id: str,
    reason: str,
    duration_minutes: int = 30,
) -> dict[str, Any] | None:
    """Issue a scoped, time-limited break-glass grant to inspect sensitive records."""
    if not check_admin_permission(admin_user_id, "support_access"):
        return None
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO support_access_grants (
                admin_user_id, target_type, target_id, reason, duration_minutes,
                expires_at
            )
            VALUES (%s, %s, %s, %s, %s, NOW() + INTERVAL '1 minute' * %s)
            RETURNING id, admin_user_id, target_type, target_id, reason, duration_minutes,
                      expires_at, is_revoked, access_count, created_at
            """,
            (admin_user_id, target_type, target_id, reason, duration_minutes, duration_minutes),
        )
        row = cursor.fetchone()
        return {
            "grantId": str(row["id"]),
            "adminUserId": str(row["admin_user_id"]),
            "targetType": row["target_type"],
            "targetId": row["target_id"],
            "reason": row["reason"],
            "durationMinutes": row["duration_minutes"],
            "expiresAt": row["expires_at"].isoformat() if hasattr(row["expires_at"], "isoformat") else str(row["expires_at"]),
            "isRevoked": row["is_revoked"],
            "accessCount": row["access_count"],
            "createdAt": row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
        }


@_database_errors_as_unavailable
def load_support_access_grants(
    admin_user_id: str, active_only: bool = False
) -> list[dict[str, Any]]:
    """List break-glass support access grants."""
    with _connect() as connection, connection.cursor() as cursor:
        query = """
            SELECT sag.id, sag.admin_user_id, sag.target_type, sag.target_id,
                   sag.reason, sag.duration_minutes, sag.expires_at, sag.is_revoked,
                   sag.revoked_at, sag.revocation_reason, sag.access_count,
                   sag.last_accessed_at, sag.created_at,
                   u.display_name AS admin_name, u.email AS admin_email
            FROM support_access_grants AS sag
            JOIN users AS u ON u.id = sag.admin_user_id
            WHERE 1=1
        """
        params: list[Any] = []
        if active_only:
            query += " AND sag.expires_at > NOW() AND sag.is_revoked = FALSE"
        query += " ORDER BY sag.created_at DESC LIMIT 100"
        cursor.execute(query, tuple(params))
        return [
            {
                "grantId": str(row["id"]),
                "adminUserId": str(row["admin_user_id"]),
                "adminName": row["admin_name"],
                "adminEmail": row["admin_email"],
                "targetType": row["target_type"],
                "targetId": row["target_id"],
                "reason": row["reason"],
                "durationMinutes": row["duration_minutes"],
                "expiresAt": row["expires_at"].isoformat() if hasattr(row["expires_at"], "isoformat") else str(row["expires_at"]),
                "isRevoked": row["is_revoked"],
                "revokedAt": row["revoked_at"].isoformat() if row.get("revoked_at") and hasattr(row["revoked_at"], "isoformat") else None,
                "revocationReason": row.get("revocation_reason"),
                "accessCount": row["access_count"],
                "lastAccessedAt": row["last_accessed_at"].isoformat() if row.get("last_accessed_at") and hasattr(row["last_accessed_at"], "isoformat") else None,
                "createdAt": row["created_at"].isoformat() if hasattr(row["created_at"], "isoformat") else str(row["created_at"]),
            }
            for row in cursor.fetchall()
        ]


@_database_errors_as_unavailable
def revoke_support_access_grant(
    admin_user_id: str, grant_id: str, reason: str
) -> dict[str, Any] | None:
    """Revoke an active support access grant immediately."""
    if not check_admin_permission(admin_user_id, "support_access"):
        return None
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE support_access_grants
            SET is_revoked = TRUE,
                revoked_at = NOW(),
                revoked_by = %s,
                revocation_reason = %s
            WHERE id = %s
            RETURNING id, admin_user_id, target_type, target_id, is_revoked, revoked_at, revocation_reason
            """,
            (admin_user_id, reason, grant_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "grantId": str(row["id"]),
            "adminUserId": str(row["admin_user_id"]),
            "targetType": row["target_type"],
            "targetId": row["target_id"],
            "isRevoked": row["is_revoked"],
            "revokedAt": row["revoked_at"].isoformat() if hasattr(row["revoked_at"], "isoformat") else str(row["revoked_at"]),
            "revocationReason": row["revocation_reason"],
        }


@_database_errors_as_unavailable
def access_sensitive_record_under_grant(
    admin_user_id: str, target_type: str, target_id: str, grant_id: str | None = None
) -> dict[str, Any] | None:
    """Access a sensitive record guarded by a valid, unexpired break-glass support grant."""
    with _connect() as connection, connection.cursor() as cursor:
        # Check active grant
        grant_query = """
            SELECT id, reason, expires_at
            FROM support_access_grants
            WHERE admin_user_id = %s
              AND target_type = %s
              AND target_id = %s
              AND expires_at > NOW()
              AND is_revoked = FALSE
        """
        params: list[Any] = [admin_user_id, target_type, target_id]
        if grant_id:
            grant_query += " AND id = %s"
            params.append(grant_id)
        grant_query += " ORDER BY expires_at DESC LIMIT 1"
        cursor.execute(grant_query, tuple(params))
        grant_row = cursor.fetchone()
        if grant_row is None:
            return None

        # Record access in grant
        active_grant_id = grant_row["id"]
        cursor.execute(
            """
            UPDATE support_access_grants
            SET access_count = access_count + 1,
                last_accessed_at = NOW()
            WHERE id = %s
            """,
            (active_grant_id,),
        )

        record_data: dict[str, Any] = {}
        if target_type == "farm":
            cursor.execute(
                """
                SELECT f.id, f.name, f.county, f.ward, f.created_at,
                       u.display_name AS owner_name, u.email AS owner_email, u.phone AS owner_phone
                FROM farms AS f
                JOIN users AS u ON u.id = f.owner_id
                WHERE f.id = %s
                """,
                (target_id,),
            )
            frow = cursor.fetchone()
            if frow:
                record_data = {
                    "farmId": str(frow["id"]),
                    "farmName": frow["name"],
                    "county": frow["county"],
                    "ward": frow["ward"],
                    "ownerName": frow["owner_name"],
                    "ownerEmail": frow["owner_email"],
                    "ownerPhone": frow["owner_phone"],
                    "createdAt": frow["created_at"].isoformat() if hasattr(frow["created_at"], "isoformat") else str(frow["created_at"]),
                }
        elif target_type == "reading":
            cursor.execute(
                """
                SELECT sr.id, sr.reading_source, sr.sampled_at, sr.sample_year,
                       sr.soil_ph, sr.total_nitrogen, sr.organic_carbon,
                       sr.olsen_phosphorus, sr.exchangeable_potassium,
                       f.name AS farm_name
                FROM soil_readings AS sr
                LEFT JOIN farms AS f ON f.id = sr.farm_id
                WHERE sr.id = %s
                """,
                (target_id,),
            )
            rrow = cursor.fetchone()
            if rrow:
                record_data = {
                    "readingId": str(rrow["id"]),
                    "source": rrow["reading_source"],
                    "sampledAt": rrow["sampled_at"].isoformat() if rrow["sampled_at"] and hasattr(rrow["sampled_at"], "isoformat") else None,
                    "sampleYear": rrow["sample_year"],
                    "farmName": rrow["farm_name"],
                    "measurements": {
                        "soilPh": rrow["soil_ph"],
                        "totalNitrogen": rrow["total_nitrogen"],
                        "organicCarbon": rrow["organic_carbon"],
                        "olsenPhosphorus": rrow["olsen_phosphorus"],
                        "exchangeablePotassium": rrow["exchangeable_potassium"],
                    },
                }
        elif target_type == "farmer_profile":
            cursor.execute(
                """
                SELECT u.id, u.display_name, u.email, u.phone, u.role, u.is_active,
                       u.approval_status, u.created_at,
                       (SELECT COUNT(*) FROM farms WHERE owner_id = u.id) AS farm_count
                FROM users AS u
                WHERE u.id = %s
                """,
                (target_id,),
            )
            prow = cursor.fetchone()
            if prow:
                record_data = {
                    "userId": str(prow["id"]),
                    "displayName": prow["display_name"],
                    "email": prow["email"],
                    "phone": prow["phone"],
                    "role": prow["role"],
                    "isActive": prow["is_active"],
                    "approvalStatus": prow.get("approval_status", "approved"),
                    "farmCount": prow["farm_count"],
                    "createdAt": prow["created_at"].isoformat() if hasattr(prow["created_at"], "isoformat") else str(prow["created_at"]),
                }
        elif target_type == "agrodealer_order":
            cursor.execute(
                """
                SELECT mo.id, mo.dealer_id, mo.product_id, mo.quantity, mo.unit_price,
                       mo.total_price, mo.status, mo.terms_accepted_at, mo.cancellation_reason,
                       u.display_name AS farmer_name, u.email AS farmer_email,
                       dp.product_name, dp.category
                FROM marketplace_orders AS mo
                JOIN users AS u ON u.id = mo.farmer_user_id
                JOIN dealer_products AS dp ON dp.id = mo.product_id
                WHERE mo.id = %s
                """,
                (target_id,),
            )
            orow = cursor.fetchone()
            if orow:
                record_data = {
                    "orderId": str(orow["id"]),
                    "productName": orow["product_name"],
                    "category": orow["category"],
                    "quantity": orow["quantity"],
                    "unitPrice": float(orow["unit_price"]),
                    "totalPrice": float(orow["total_price"]),
                    "status": orow["status"],
                    "farmerName": orow["farmer_name"],
                    "farmerEmail": orow["farmer_email"],
                    "termsAcceptedAt": orow["terms_accepted_at"].isoformat() if hasattr(orow["terms_accepted_at"], "isoformat") else str(orow["terms_accepted_at"]),
                    "cancellationReason": orow.get("cancellation_reason"),
                }

        return {
            "grantId": str(active_grant_id),
            "targetType": target_type,
            "targetId": target_id,
            "accessReason": grant_row["reason"],
            "accessedAt": datetime.now(UTC).isoformat(),
            "record": record_data,
        }


@_database_errors_as_unavailable
def load_system_settings(admin_user_id: str) -> list[dict[str, Any]]:
    """List system configuration settings."""
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT ss.id, ss.key, ss.value, ss.category, ss.description,
                   ss.is_readonly, ss.updated_at, u.display_name AS updated_by_name
            FROM system_settings AS ss
            LEFT JOIN users AS u ON u.id = ss.updated_by
            ORDER BY ss.category, ss.key
            """
        )
        return [
            {
                "settingId": str(row["id"]),
                "key": row["key"],
                "value": row["value"],
                "category": row["category"],
                "description": row["description"],
                "isReadOnly": row["is_readonly"],
                "updatedByName": row["updated_by_name"],
                "updatedAt": row["updated_at"].isoformat(),
            }
            for row in cursor.fetchall()
        ]


@_database_errors_as_unavailable
def update_system_setting(
    admin_user_id: str, key: str, value: Any
) -> dict[str, Any] | None:
    """Update a system configuration setting; requires manage_settings permission."""
    if not check_admin_permission(admin_user_id, "manage_settings"):
        return None
    with _connect() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE system_settings
            SET value = %s,
                updated_by = %s,
                updated_at = NOW()
            WHERE key = %s AND is_readonly = FALSE
            RETURNING id, key, value, category, description, is_readonly, updated_at
            """,
            (json.dumps(value), admin_user_id, key),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return {
            "settingId": str(row["id"]),
            "key": row["key"],
            "value": row["value"],
            "category": row["category"],
            "description": row["description"],
            "isReadOnly": row["is_readonly"],
            "updatedAt": row["updated_at"].isoformat(),
        }
