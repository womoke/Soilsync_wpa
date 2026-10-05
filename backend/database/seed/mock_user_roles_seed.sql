BEGIN;

INSERT INTO users (id, email, display_name, role, is_active)
VALUES
    ('11111111-1111-4111-8111-111111111111', 'farmer.amina@example.com', 'Amina Njeri', 'farmer', TRUE),
    ('22222222-2222-4222-8222-222222222222', 'officer.daniel@example.com', 'Daniel Otieno', 'extension_officer', TRUE),
    ('33333333-3333-4333-8333-333333333333', 'dealer.mwangi@example.com', 'Mwangi Agro', 'agrodealer', TRUE),
    ('44444444-4444-4444-8444-444444444444', 'admin.ops@example.com', 'Operations Admin', 'admin', TRUE)
ON CONFLICT (email) DO NOTHING;

INSERT INTO farms (id, owner_id, name, county, ward, latitude, longitude, created_at, updated_at)
VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'Kiboko Valley Farm', 'Makueni', 'Kiboko', -1.454, 37.331, NOW(), NOW()),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'Upper Yatta Plot', 'Machakos', 'Yatta', -1.022, 37.201, NOW(), NOW()),
    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '22222222-2222-4222-8222-222222222222', 'Extension Demo Field', 'Kiambu', 'Githunguri', -1.112, 36.780, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO soil_readings (
    id, farm_id, reading_source, sampled_at, sample_year, source_label, top_cm, bottom_cm,
    location_uncertainty_m, latitude, longitude, source_provider, source_dataset_id, source_record_id,
    source_license, source_attribution, source_retrieved_at, soil_ph, total_nitrogen,
    organic_carbon, olsen_phosphorus, exchangeable_potassium, measurement_quality, created_at, updated_at
)
VALUES
    (
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'FARMER_OBSERVATION', NOW() - INTERVAL '2 days', 2026,
        'demo-farm-01', 0, 15, 10, -1.454, 37.331, 'DEMO', 'mock-demo-set', 'soil-reading-01', 'demo', 'Mock demo record for QA', NOW(), 6.1, 0.092,
        1.8, 21.0, 0.35, 'sample', NOW(), NOW()
    ),
    (
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'FARMER_OBSERVATION', NOW() - INTERVAL '10 days', 2026,
        'demo-farm-02', 0, 20, 12, -1.022, 37.201, 'DEMO', 'mock-demo-set', 'soil-reading-02', 'demo', 'Mock demo record for QA', NOW(), 5.7, 0.071,
        1.4, 14.0, 0.28, 'sample', NOW(), NOW()
    )
ON CONFLICT (id) DO NOTHING;

INSERT INTO recommendations (
    id, soil_reading_id, user_id, farm_id, crop, title, rationale,
    application_rate, application_unit, rule_version, review_status, created_at, updated_at
)
VALUES
    (
        'ffffffff-ffff-4fff-8fff-ffffffffffff', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', '11111111-1111-4111-8111-111111111111',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'maize', 'Nitrogen review', 'Prototype nitrogen guidance for test review.', 40.0,
        'kg/ha', 'prototype-v1', 'pending_review', NOW(), NOW()
    ),
    (
        '12121212-1212-4121-8121-121212121212', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '11111111-1111-4111-8111-111111111111',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'maize', 'Organic matter uplift', 'Prototype organic carbon review for demonstration.', 2.0,
        't/ha', 'prototype-v1', 'pending_review', NOW(), NOW()
    )
ON CONFLICT (id) DO NOTHING;

COMMIT;
