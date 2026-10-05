BEGIN;

UPDATE users
SET email = 'amina.njeri@example.com',
    display_name = 'Amina Njeri',
    role = 'farmer',
    demo_status = 'active'
WHERE id = '11111111-1111-4111-8111-111111111111';

UPDATE users
SET email = 'daniel.otieno@example.com',
    display_name = 'Daniel Otieno',
    role = 'extension_officer',
    demo_status = 'review'
WHERE id = '22222222-2222-4222-8222-222222222222';

INSERT INTO users (id, email, display_name, role, is_active, demo_status)
VALUES
    ('77777777-7777-4777-8777-777777777777', 'john.wambua@example.com', 'John Wambua', 'farmer', TRUE, 'draft'),
    ('88888888-8888-4888-8888-888888888888', 'sales@mwangiagro.example.com', 'Mwangi Agro', 'agrodealer', TRUE, 'active'),
    ('99999999-9999-4999-8999-999999999999', 'ops@example.com', 'Operations Admin', 'admin', TRUE, 'monitoring')
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    role = EXCLUDED.role,
    is_active = EXCLUDED.is_active,
    demo_status = EXCLUDED.demo_status;

UPDATE farms
SET name = 'Kiboko Valley Farm', county = 'Machakos', ward = 'Kiboko'
WHERE id = '33333333-3333-4333-8333-333333333333';

INSERT INTO farms (id, owner_id, name, county, ward)
VALUES (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '77777777-7777-4777-8777-777777777777',
    'Upper Yatta Plot',
    'Machakos',
    'Yatta'
)
ON CONFLICT (id) DO UPDATE SET
    owner_id = EXCLUDED.owner_id,
    name = EXCLUDED.name,
    county = EXCLUDED.county,
    ward = EXCLUDED.ward;

INSERT INTO demo_dashboard_records (id, record_type, audience_role, display_order, payload)
VALUES
    ('officer-alert-ph', 'alert', 'extension_officer', 1, '{"id":"alert-001","title":"pH review required","owner":"Amina Njeri","category":"soil","severity":"high","summary":"Field sample suggests pH drift in the south-west quadrant and needs validation."}'),
    ('dealer-alert-delivery', 'alert', 'agrodealer', 2, '{"id":"alert-002","title":"Delivery window change","owner":"Mwangi Agro","category":"inventory","severity":"medium","summary":"Starter blend shipment changed route and may affect the next order window."}'),
    ('officer-alert-sync', 'alert', 'extension_officer', 3, '{"id":"alert-003","title":"Farmer sync backlog","owner":"Daniel Otieno","category":"ops","severity":"medium","summary":"Three farmer submissions are waiting for ward approval and sync review."}'),
    ('admin-alert-access', 'alert', 'admin', 4, '{"id":"alert-004","title":"Role access audit","owner":"Operations Admin","category":"access","severity":"low","summary":"Mock permissions were refreshed and no high-risk access drift was detected."}'),
    ('visit-amina', 'visit', 'extension_officer', 1, '{"farmer":"Amina Njeri","date":"2026-10-02","outcome":"Sample review","status":"Open"}'),
    ('visit-john', 'visit', 'extension_officer', 2, '{"farmer":"John Wambua","date":"2026-10-03","outcome":"Draft sync","status":"Pending"}'),
    ('visit-daniel', 'visit', 'extension_officer', 3, '{"farmer":"Daniel Otieno","date":"2026-10-04","outcome":"Field support","status":"Queued"}'),
    ('inventory-starter', 'inventory', 'agrodealer', 1, '{"item":"Starter blend","stock":"42 bags","region":"Kiboko"}'),
    ('inventory-lime', 'inventory', 'agrodealer', 2, '{"item":"Lime","stock":"18 bags","region":"Makueni"}'),
    ('inventory-organic', 'inventory', 'agrodealer', 3, '{"item":"Organic matter mix","stock":"11 bags","region":"Yatta"}'),
    ('farmer-card-sample', 'summary_card', 'farmer', 1, '{"label":"Latest sample","value":"Kiboko Valley","detail":"Last reading 2 days ago"}'),
    ('farmer-card-status', 'summary_card', 'farmer', 2, '{"label":"Soil status","value":"Needs review","detail":"pH and moisture pending check"}'),
    ('farmer-card-sync', 'summary_card', 'farmer', 3, '{"label":"Sync action","value":"Draft ready","detail":"1 offline draft queued"}'),
    ('officer-card-farmers', 'summary_card', 'extension_officer', 1, '{"label":"Assigned farmers","value":"2","detail":"1 requiring review"}'),
    ('officer-card-visits', 'summary_card', 'extension_officer', 2, '{"label":"Support visits","value":"3","detail":"3 scheduled this week"}'),
    ('officer-card-risks', 'summary_card', 'extension_officer', 3, '{"label":"Risk flags","value":"2","detail":"1 soil review required"}'),
    ('dealer-card-products', 'summary_card', 'agrodealer', 1, '{"label":"Products in stock","value":"4","detail":"4 seeded demo products"}'),
    ('dealer-card-orders', 'summary_card', 'agrodealer', 2, '{"label":"Pending orders","value":"0","detail":"No demo orders recorded"}'),
    ('dealer-card-radius', 'summary_card', 'agrodealer', 3, '{"label":"Delivery radius","value":"Not set","detail":"Coverage data not recorded"}'),
    ('admin-card-users', 'summary_card', 'admin', 1, '{"label":"Active users","value":"5","detail":"Seeded test accounts"}'),
    ('admin-card-health', 'summary_card', 'admin', 2, '{"label":"System health","value":"Stable","detail":"No critical alerts"}'),
    ('admin-card-seed', 'summary_card', 'admin', 3, '{"label":"Seed data status","value":"Ready","detail":"Database test records loaded"}'),
    ('farmer-action-reading', 'action', 'farmer', 1, '{"title":"Review local pH sample","note":"","status":""}'),
    ('farmer-action-boundary', 'action', 'farmer', 2, '{"title":"Confirm farm boundary","note":"","status":""}'),
    ('farmer-action-upload', 'action', 'farmer', 3, '{"title":"Queue next reading upload","note":"","status":""}'),
    ('officer-action-visit', 'action', 'extension_officer', 1, '{"title":"Visit Kiboko Valley block","note":"","status":""}'),
    ('officer-action-review', 'action', 'extension_officer', 2, '{"title":"Review nutrient risk for Amina Njeri","note":"","status":""}'),
    ('officer-action-test', 'action', 'extension_officer', 3, '{"title":"Confirm soil test schedule","note":"","status":""}'),
    ('dealer-action-restock', 'action', 'agrodealer', 1, '{"title":"Restock organic matter inputs","note":"","status":""}'),
    ('dealer-action-order', 'action', 'agrodealer', 2, '{"title":"Confirm multi-pack order for Wambua","note":"","status":""}'),
    ('dealer-action-delivery', 'action', 'agrodealer', 3, '{"title":"Review delivery window for Ward 2","note":"","status":""}'),
    ('admin-action-access', 'action', 'admin', 1, '{"title":"Review access logs","note":"","status":""}'),
    ('admin-action-sync', 'action', 'admin', 2, '{"title":"Validate sync queue health","note":"","status":""}'),
    ('admin-action-release', 'action', 'admin', 3, '{"title":"Approve seed-data release checklist","note":"","status":""}'),
    ('farmer-activity-reading', 'activity', 'farmer', 1, '{"title":"Soil preview saved","note":"Stored locally for review","status":"Ready"}'),
    ('farmer-activity-notes', 'activity', 'farmer', 2, '{"title":"Field notes updated","note":"Follow-up on slope edge","status":"Pending"}'),
    ('farmer-activity-recommendation', 'activity', 'farmer', 3, '{"title":"Recommendation review","note":"Prototype guidance awaiting agronomist signoff","status":"Review"}'),
    ('officer-activity-review', 'activity', 'extension_officer', 1, '{"title":"Kiboko Valley field review","note":"Needs pH validation","status":"Open"}'),
    ('officer-activity-planning', 'activity', 'extension_officer', 2, '{"title":"Ward planning notes","note":"High-priority follow-up in Ward 3","status":"Queued"}'),
    ('officer-activity-visits', 'activity', 'extension_officer', 3, '{"title":"Visits summary","note":"3 farmer visits scheduled","status":"Synced"}'),
    ('dealer-activity-delivery', 'activity', 'agrodealer', 1, '{"title":"Fertilizer delivery","note":"Last batch delivered to Makueni cluster","status":"Complete"}'),
    ('dealer-activity-stock', 'activity', 'agrodealer', 2, '{"title":"Stock check","note":"Lime and starter blend low","status":"Watch"}'),
    ('dealer-activity-route', 'activity', 'agrodealer', 3, '{"title":"Route planning","note":"Three stops planned for today","status":"Active"}'),
    ('admin-activity-system', 'activity', 'admin', 1, '{"title":"System review","note":"No failed critical jobs detected","status":"Healthy"}'),
    ('admin-activity-role', 'activity', 'admin', 2, '{"title":"Role access","note":"Farmer and officer profiles synced","status":"Verified"}'),
    ('admin-activity-seed', 'activity', 'admin', 3, '{"title":"Mock test seed","note":"Demo accounts prepared for QA","status":"Ready"}')
ON CONFLICT (id) DO UPDATE SET
    record_type = EXCLUDED.record_type,
    audience_role = EXCLUDED.audience_role,
    display_order = EXCLUDED.display_order,
    payload = EXCLUDED.payload,
    updated_at = NOW();

COMMIT;