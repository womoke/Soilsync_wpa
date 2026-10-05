BEGIN;

INSERT INTO users (id, email, display_name, role, is_active)
VALUES
    ('11111111-1111-4111-8111-111111111111', 'demo.farmer@soilsync.local', 'Demo Farmer', 'farmer', TRUE),
    ('22222222-2222-4222-8222-222222222222', 'demo.officer@soilsync.local', 'Demo Extension Officer', 'extension_officer', TRUE)
ON CONFLICT (email) DO NOTHING;

INSERT INTO farms (id, owner_id, name, county, ward, latitude, longitude)
VALUES
    ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'Kiboko Demo Farm', 'Machakos', 'Mwala', -1.3899, 37.2913)
ON CONFLICT DO NOTHING;

INSERT INTO soil_readings (
    id,
    farm_id,
    reading_source,
    sampled_at,
    sample_year,
    source_label,
    top_cm,
    bottom_cm,
    location_uncertainty_m,
    latitude,
    longitude,
    source_provider,
    source_dataset_id,
    source_record_id,
    source_license,
    source_attribution,
    source_retrieved_at,
    soil_ph,
    total_nitrogen,
    organic_carbon,
    olsen_phosphorus,
    exchangeable_potassium,
    measurement_quality
)
VALUES (
    '44444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    'DEMO_SEED',
    NOW() - INTERVAL '2 days',
    2026,
    'Demo seeded topsoil profile',
    0,
    20,
    75,
    -1.3899,
    37.2913,
    'DEMO',
    'DEMO_SEED',
    'reading-001',
    'internal-demo-only',
    'SoilSync demo seed data',
    NOW() - INTERVAL '2 days',
    5.6,
    0.12,
    1.4,
    18.0,
    0.34,
    'sample'
)
ON CONFLICT DO NOTHING;

INSERT INTO soil_measurements (
    soil_reading_id,
    source_analyte,
    analyte_code,
    value,
    source_unit,
    canonical_unit,
    quality_status
)
VALUES
    ('44444444-4444-4444-8444-444444444444', 'soil_pH', 'soil_ph', 5.6, 'pH', 'pH', 'sample'),
    ('44444444-4444-4444-8444-444444444444', 'total_Nitrogen_percent_', 'total_nitrogen', 0.12, '%', NULL, 'sample'),
    ('44444444-4444-4444-8444-444444444444', 'phosphorus_Olsen_ppm', 'olsen_phosphorus', 18.0, 'ppm', NULL, 'sample'),
    ('44444444-4444-4444-8444-444444444444', 'potassium_meq_percent_', 'exchangeable_potassium', 0.34, 'meq%', NULL, 'sample'),
    ('44444444-4444-4444-8444-444444444444', 'total_Org_Carbon_percent_', 'organic_carbon', 1.4, '%', NULL, 'sample')
ON CONFLICT (soil_reading_id, source_analyte) DO UPDATE SET
    analyte_code = EXCLUDED.analyte_code,
    value = EXCLUDED.value,
    source_unit = EXCLUDED.source_unit,
    canonical_unit = EXCLUDED.canonical_unit,
    quality_status = EXCLUDED.quality_status;

INSERT INTO source_provenance (
    id,
    provider_name,
    dataset_id,
    record_id,
    license,
    attribution,
    retrieved_at
)
VALUES (
    '55555555-5555-4555-8555-555555555555',
    'LOCAL_SEED',
    'DEMO_SEED',
    'reading-001',
    'internal-demo-only',
    'SoilSync demo seed profile',
    NOW() - INTERVAL '2 days'
)
ON CONFLICT DO NOTHING;

INSERT INTO recommendations (
    id,
    soil_reading_id,
    user_id,
    farm_id,
    crop,
    title,
    rationale,
    application_rate,
    application_unit,
    rule_version,
    review_status
)
VALUES (
    '66666666-6666-4666-8666-666666666666',
    '44444444-4444-4444-8444-444444444444',
    '11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333',
    'maize',
    'Review nitrogen input strategy',
    'The demo soil reading shows a low-to-moderate nitrogen status. This recommendation is for review and should be validated by an agronomist before being used operationally.',
    32.0,
    'kg/ha',
    'prototype-v1',
    'pending_review'
)
ON CONFLICT DO NOTHING;

COMMIT;
