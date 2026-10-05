BEGIN;

INSERT INTO agrodealer_profiles (
    id,
    user_id,
    business_name,
    county,
    ward,
    location_status,
    location_permission_status,
    is_demo
)
VALUES (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '88888888-8888-4888-8888-888888888888',
    'Mwangi Agro',
    'Makueni',
    'Makueni',
    'unverified',
    'not_requested',
    TRUE
)
ON CONFLICT (user_id) DO UPDATE SET
    business_name = EXCLUDED.business_name,
    county = EXCLUDED.county,
    ward = EXCLUDED.ward,
    location_status = EXCLUDED.location_status,
    location_permission_status = EXCLUDED.location_permission_status,
    is_demo = EXCLUDED.is_demo;

DELETE FROM demo_dashboard_records
WHERE record_type = 'inventory' AND audience_role = 'agrodealer';

INSERT INTO dealer_products (
    id,
    dealer_id,
    name,
    category,
    description,
    stock_quantity,
    stock_unit,
    stock_updated_at,
    unit_price,
    currency,
    is_listed,
    orderable,
    is_demo
)
VALUES
    ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Starter blend', 'fertilizer', 'Synthetic QA catalog record.', 42, 'bags', NOW() - INTERVAL '1 day', NULL, 'KES', TRUE, FALSE, TRUE),
    ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Hybrid maize seed', 'seeds', 'Synthetic QA catalog record.', 18, 'packs', NOW() - INTERVAL '2 days', NULL, 'KES', TRUE, FALSE, TRUE),
    ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Compost mix', 'manure', 'Synthetic QA catalog record.', 11, 'bags', NOW() - INTERVAL '3 days', NULL, 'KES', TRUE, FALSE, TRUE),
    ('cccccccc-cccc-4ccc-8ccc-ccccccccccc4', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Soil testing spade', 'tools', 'Synthetic QA catalog record.', 3, 'units', NOW() - INTERVAL '1 day', NULL, 'KES', TRUE, FALSE, TRUE)
ON CONFLICT (id) DO UPDATE SET
    dealer_id = EXCLUDED.dealer_id,
    name = EXCLUDED.name,
    category = EXCLUDED.category,
    description = EXCLUDED.description,
    stock_quantity = EXCLUDED.stock_quantity,
    stock_unit = EXCLUDED.stock_unit,
    stock_updated_at = EXCLUDED.stock_updated_at,
    unit_price = EXCLUDED.unit_price,
    currency = EXCLUDED.currency,
    is_listed = EXCLUDED.is_listed,
    orderable = EXCLUDED.orderable,
    is_demo = EXCLUDED.is_demo;

UPDATE demo_dashboard_records
SET payload = jsonb_set(
    jsonb_set(payload, '{value}', '"4"'::JSONB),
    '{detail}',
    '"4 seeded demo products"'::JSONB
), updated_at = NOW()
WHERE id = 'dealer-card-products';

COMMIT;