CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    supabase_auth_user_id UUID UNIQUE,
    email TEXT UNIQUE,
    phone TEXT UNIQUE,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'farmer',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
        demo_status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS farms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    county TEXT,
    sub_county TEXT,
    ward TEXT,
    size_acres NUMERIC(8, 2),
    crops TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    geom GEOGRAPHY(Point, 4326),
    coordinates_captured_by UUID REFERENCES users(id) ON DELETE SET NULL,
    coordinates_captured_at TIMESTAMPTZ,
    soil_data_collected BOOLEAN NOT NULL DEFAULT FALSE,
    owner_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS source_datasets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    version_label TEXT,
    source_file_name TEXT,
    license_identifier TEXT,
    attribution TEXT,
    prototype_use_basis TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO source_datasets (
    dataset_key,
    display_name,
    provider_name,
    source_file_name,
    prototype_use_basis
)
VALUES (
    'PROJECT_SOIL_DATASET',
    'Project-provided soil dataset',
    'PROJECT_SOIL_DATASET',
    'soil_data_all.csv',
    'Prototype use assumed by project owner; production restrictions are not represented here.'
)
ON CONFLICT (dataset_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS source_import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id UUID NOT NULL REFERENCES source_datasets(id) ON DELETE RESTRICT,
    source_file_name TEXT NOT NULL,
    file_sha256 TEXT NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
    status TEXT NOT NULL DEFAULT 'started'
        CHECK (status IN ('started', 'completed', 'completed_with_rejections', 'failed')),
    rows_read INTEGER NOT NULL DEFAULT 0 CHECK (rows_read >= 0),
    rows_imported INTEGER NOT NULL DEFAULT 0 CHECK (rows_imported >= 0),
    rows_rejected INTEGER NOT NULL DEFAULT 0 CHECK (rows_rejected >= 0),
    errors_by_reason JSONB NOT NULL DEFAULT '{}'::JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    UNIQUE (dataset_id, file_sha256),
    CHECK (rows_imported + rows_rejected <= rows_read)
);

CREATE TABLE IF NOT EXISTS soil_readings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farm_id UUID REFERENCES farms(id) ON DELETE SET NULL,
    officer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    visit_id UUID REFERENCES officer_visits(id) ON DELETE SET NULL,
    reading_source TEXT NOT NULL DEFAULT 'FARMER_OBSERVATION',
    sampled_at TIMESTAMPTZ,
    sample_year INT,
    source_label TEXT,
    top_cm DOUBLE PRECISION,
    bottom_cm DOUBLE PRECISION,
    location_uncertainty_m DOUBLE PRECISION,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    source_provider TEXT,
    source_dataset_id TEXT,
    source_record_id TEXT,
    source_license TEXT,
    source_attribution TEXT,
    source_retrieved_at TIMESTAMPTZ,
    dataset_id UUID REFERENCES source_datasets(id) ON DELETE RESTRICT,
    import_batch_id UUID REFERENCES source_import_batches(id) ON DELETE SET NULL,
    provenance_id UUID,
    county TEXT,
    constituency TEXT,
    ward TEXT,
    village TEXT,
    source_lab_number TEXT,
    source_lab_year TEXT,
    source_latitude DOUBLE PRECISION,
    source_longitude DOUBLE PRECISION,
    final_latitude DOUBLE PRECISION,
    final_longitude DOUBLE PRECISION,
    gps_tagged_from TEXT,
    source_crop_text TEXT,
    source_recommendation_text TEXT,
    coordinate_source TEXT,
    location GEOGRAPHY(Point, 4326),
    soil_ph DOUBLE PRECISION,
    total_nitrogen DOUBLE PRECISION,
    organic_carbon DOUBLE PRECISION,
    olsen_phosphorus DOUBLE PRECISION,
    exchangeable_potassium DOUBLE PRECISION,
    measurement_quality TEXT NOT NULL DEFAULT 'sample',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS source_provenance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_name TEXT NOT NULL,
    dataset_id TEXT,
    record_id TEXT,
    license TEXT,
    attribution TEXT,
    retrieved_at TIMESTAMPTZ,
    source_dataset_ref_id UUID REFERENCES source_datasets(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE soil_readings
    ADD CONSTRAINT soil_readings_provenance_fk
        FOREIGN KEY (provenance_id) REFERENCES source_provenance(id) ON DELETE RESTRICT,
    ADD CONSTRAINT soil_readings_import_requires_dataset
        CHECK (import_batch_id IS NULL OR dataset_id IS NOT NULL),
    ADD CONSTRAINT soil_readings_dataset_requires_provenance
        CHECK (dataset_id IS NULL OR provenance_id IS NOT NULL),
    ADD CONSTRAINT soil_readings_coordinate_pair
        CHECK ((latitude IS NULL) = (longitude IS NULL)),
    ADD CONSTRAINT soil_readings_latitude_range
        CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    ADD CONSTRAINT soil_readings_longitude_range
        CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
    ADD CONSTRAINT soil_readings_source_coordinate_pair
        CHECK ((source_latitude IS NULL) = (source_longitude IS NULL)),
    ADD CONSTRAINT soil_readings_final_coordinate_pair
        CHECK ((final_latitude IS NULL) = (final_longitude IS NULL)),
    ADD CONSTRAINT soil_readings_source_latitude_range
        CHECK (source_latitude IS NULL OR source_latitude BETWEEN -90 AND 90),
    ADD CONSTRAINT soil_readings_source_longitude_range
        CHECK (source_longitude IS NULL OR source_longitude BETWEEN -180 AND 180),
    ADD CONSTRAINT soil_readings_final_latitude_range
        CHECK (final_latitude IS NULL OR final_latitude BETWEEN -90 AND 90),
    ADD CONSTRAINT soil_readings_final_longitude_range
        CHECK (final_longitude IS NULL OR final_longitude BETWEEN -180 AND 180),
    ADD CONSTRAINT soil_readings_depth_range
        CHECK (top_cm IS NULL OR bottom_cm IS NULL OR top_cm <= bottom_cm);

CREATE TABLE IF NOT EXISTS soil_measurements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    soil_reading_id UUID NOT NULL REFERENCES soil_readings(id) ON DELETE CASCADE,
    source_analyte TEXT NOT NULL,
    analyte_code TEXT NOT NULL,
    value NUMERIC(18, 8),
    source_value_text TEXT,
    source_unit TEXT,
    canonical_unit TEXT,
    analytical_method TEXT,
    quality_status TEXT NOT NULL DEFAULT 'valid'
        CHECK (
            quality_status IN (
                'valid',
                'missing',
                'invalid_source_value',
                'unsupported_depth_or_method',
                'estimated',
                'sample'
            )
        ),
    source_quality_class TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (soil_reading_id, source_analyte),
    CHECK (quality_status <> 'valid' OR value IS NOT NULL),
    CHECK (
        quality_status <> 'invalid_source_value'
        OR (value IS NULL AND source_value_text IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    soil_reading_id UUID REFERENCES soil_readings(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    farm_id UUID REFERENCES farms(id) ON DELETE CASCADE,
    crop TEXT,
    title TEXT NOT NULL,
    rationale TEXT NOT NULL,
    application_rate DOUBLE PRECISION,
    application_unit TEXT,
    rule_version TEXT,
    review_status TEXT NOT NULL DEFAULT 'pending_review',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recommendation_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recommendation_id UUID NOT NULL REFERENCES recommendations(id) ON DELETE CASCADE,
    response TEXT NOT NULL CHECK (response IN ('viewed', 'followed', 'modified', 'not-followed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    client_draft_id UUID,
    draft_type TEXT NOT NULL,
    version INTEGER,
    payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'pending', 'conflict', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_id, client_draft_id)
);

CREATE TABLE IF NOT EXISTS sync_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_id UUID NOT NULL UNIQUE REFERENCES sync_drafts(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS officer_jurisdictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    officer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    county TEXT,
    sub_county TEXT,
    ward TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (county IS NOT NULL OR sub_county IS NOT NULL OR ward IS NOT NULL),
    CHECK (sub_county IS NULL OR county IS NOT NULL),
    CHECK (ward IS NULL OR sub_county IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS demo_dashboard_records (
    id TEXT PRIMARY KEY,
    record_type TEXT NOT NULL CHECK (
        record_type IN ('alert', 'visit', 'inventory', 'summary_card', 'action', 'activity')
    ),
    audience_role TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agrodealer_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    business_name TEXT NOT NULL,
    county TEXT,
    sub_county TEXT,
    ward TEXT,
    location GEOGRAPHY(Point, 4326),
    location_status TEXT NOT NULL DEFAULT 'unverified'
        CHECK (location_status IN ('unverified', 'verified', 'unavailable')),
    location_permission_status TEXT NOT NULL DEFAULT 'not_requested'
        CHECK (location_permission_status IN ('not_requested', 'granted', 'denied')),
    location_consent_at TIMESTAMPTZ,
    location_consent_notes TEXT,
    is_demo BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (location_status <> 'verified' OR location IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS dealer_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_id UUID NOT NULL REFERENCES agrodealer_profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('fertilizer', 'seeds', 'manure', 'tools')),
    description TEXT,
    stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    stock_unit TEXT NOT NULL,
    stock_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unit_price NUMERIC(12, 2) CHECK (unit_price IS NULL OR unit_price >= 0),
    currency TEXT NOT NULL DEFAULT 'KES' CHECK (currency ~ '^[A-Z]{3}$'),
    is_listed BOOLEAN NOT NULL DEFAULT TRUE,
    orderable BOOLEAN NOT NULL DEFAULT FALSE,
    is_demo BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketplace_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_id UUID NOT NULL REFERENCES agrodealer_profiles(id) ON DELETE CASCADE,
    buyer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES dealer_products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
    total_price NUMERIC(12, 2) NOT NULL CHECK (total_price >= 0),
    currency TEXT NOT NULL DEFAULT 'KES' CHECK (currency ~ '^[A-Z]{3}$'),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'pending_confirmation', 'confirmed', 'fulfilled', 'cancelled', 'disputed')),
    terms_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    terms_accepted_at TIMESTAMPTZ,
    fulfillment_type TEXT NOT NULL DEFAULT 'pickup'
        CHECK (fulfillment_type IN ('pickup', 'delivery')),
    notes TEXT,
    cancellation_reason TEXT,
    dispute_reason TEXT,
    dispute_status TEXT
        CHECK (dispute_status IS NULL OR dispute_status IN ('open', 'under_review', 'resolved', 'dismissed')),
    dispute_resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (terms_accepted = TRUE OR status = 'draft')
);

CREATE INDEX IF NOT EXISTS idx_farms_owner_id ON farms(owner_id);
CREATE INDEX IF NOT EXISTS idx_farms_county ON farms(county);
CREATE INDEX IF NOT EXISTS idx_soil_readings_farm_id ON soil_readings(farm_id);
CREATE INDEX IF NOT EXISTS idx_soil_readings_sampled_at ON soil_readings(sampled_at);
CREATE INDEX IF NOT EXISTS idx_source_import_batches_dataset_started
    ON source_import_batches(dataset_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_soil_readings_dataset_record
    ON soil_readings(dataset_id, source_record_id);
CREATE INDEX IF NOT EXISTS idx_soil_readings_import_batch
    ON soil_readings(import_batch_id);
CREATE INDEX IF NOT EXISTS idx_soil_readings_county_year
    ON soil_readings(county, sample_year);
CREATE INDEX IF NOT EXISTS idx_soil_readings_location_gist
    ON soil_readings USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_soil_measurements_analyte
    ON soil_measurements(analyte_code, soil_reading_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_provenance_dataset_record
    ON source_provenance(source_dataset_ref_id, record_id)
    WHERE source_dataset_ref_id IS NOT NULL AND record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recommendations_soil_reading_id ON recommendations(soil_reading_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_review_status ON recommendations(review_status);
CREATE INDEX IF NOT EXISTS idx_recommendation_feedback_user_created
    ON recommendation_feedback(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_drafts_owner_status
    ON sync_drafts(owner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_queue_owner_status
    ON sync_queue(owner_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_officer_jurisdictions_scope_unique
    ON officer_jurisdictions (
        officer_user_id,
        COALESCE(county, ''),
        COALESCE(sub_county, ''),
        COALESCE(ward, '')
    );
CREATE INDEX IF NOT EXISTS idx_officer_jurisdictions_active
    ON officer_jurisdictions(officer_user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_farms_sub_county
    ON farms(county, sub_county, ward);
CREATE INDEX IF NOT EXISTS idx_demo_dashboard_records_role_type_order
    ON demo_dashboard_records(audience_role, record_type, display_order);
CREATE INDEX IF NOT EXISTS idx_agrodealer_profiles_location
    ON agrodealer_profiles USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_dealer_products_dealer_category
    ON dealer_products(dealer_id, category, is_listed);
ALTER TABLE demo_dashboard_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE agrodealer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE officer_jurisdictions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission TEXT NOT NULL CHECK (
        permission IN (
            'manage_accounts',
            'manage_roles',
            'manage_officer_assignments',
            'manage_dealer_approvals',
            'view_audit_log',
            'support_access',
            'manage_settings'
        )
    ),
    granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (admin_user_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_admin_permissions_active
    ON admin_permissions(admin_user_id, is_active)
    WHERE is_active = TRUE;

ALTER TABLE admin_permissions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    detail JSONB NOT NULL DEFAULT '{}'::JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor
    ON admin_audit_log(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action
    ON admin_audit_log(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target
    ON admin_audit_log(target_type, target_id, created_at DESC);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_soil_reading_location()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
        NEW.location := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::GEOGRAPHY;
    ELSE
        NEW.location := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_farms_updated_at
BEFORE UPDATE ON farms
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_soil_readings_updated_at
BEFORE UPDATE ON soil_readings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_soil_reading_location
BEFORE INSERT OR UPDATE OF latitude, longitude ON soil_readings
FOR EACH ROW
EXECUTE FUNCTION set_soil_reading_location();

CREATE TRIGGER set_source_datasets_updated_at
BEFORE UPDATE ON source_datasets
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_recommendations_updated_at
BEFORE UPDATE ON recommendations
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_sync_drafts_updated_at
BEFORE UPDATE ON sync_drafts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_sync_queue_updated_at
BEFORE UPDATE ON sync_queue
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_officer_jurisdictions_updated_at
BEFORE UPDATE ON officer_jurisdictions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_agrodealer_profiles_updated_at
BEFORE UPDATE ON agrodealer_profiles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_dealer_products_updated_at
BEFORE UPDATE ON dealer_products
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN soil_readings.source_recommendation_text IS
    'Historical source advice for provenance only; not an observed treatment outcome or training label.';
COMMENT ON COLUMN soil_readings.farm_id IS
    'Nullable because imported soil records may not identify an individual farm.';
COMMENT ON TABLE soil_measurements IS
    'One row per analyte; preserves source units/classes and measurement-level quality.';

CREATE TABLE IF NOT EXISTS officer_visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    officer_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    farmer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    farm_id UUID REFERENCES farms(id) ON DELETE SET NULL,
    planned_date TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'claimed', 'scheduled', 'in_progress', 'completed', 'cancelled')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS officer_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    officer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    farmer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    farm_id UUID REFERENCES farms(id) ON DELETE SET NULL,
    source TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info'
        CHECK (severity IN ('info', 'warning', 'critical')),
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'acknowledged', 'resolved')),
    title TEXT NOT NULL,
    summary TEXT,
    notes TEXT,
    resolution_notes TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_officer_visits_updated_at
BEFORE UPDATE ON officer_visits
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_officer_alerts_updated_at
BEFORE UPDATE ON officer_alerts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS marketplace_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_id UUID NOT NULL REFERENCES agrodealer_profiles(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES dealer_products(id) ON DELETE CASCADE,
    farmer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
    total_price NUMERIC(10, 2) NOT NULL CHECK (total_price >= 0),
    status TEXT NOT NULL DEFAULT 'placed'
        CHECK (status IN ('placed', 'confirmed', 'fulfilled', 'cancelled', 'disputed')),
    terms_accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fulfillment_notes TEXT,
    cancellation_reason TEXT,
    cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
    cancelled_at TIMESTAMPTZ,
    dispute_reason TEXT,
    dispute_escalated_to_ward TEXT,
    dispute_resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_marketplace_orders_updated_at
BEFORE UPDATE ON marketplace_orders
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Support Access Grants (Break-Glass Protocol)
CREATE TABLE IF NOT EXISTS support_access_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('farm', 'reading', 'farmer_profile', 'agrodealer_order')),
    target_id TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (char_length(reason) >= 10),
    duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 240),
    expires_at TIMESTAMPTZ NOT NULL,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES users(id) ON DELETE SET NULL,
    revocation_reason TEXT,
    access_count INTEGER NOT NULL DEFAULT 0 CHECK (access_count >= 0),
    last_accessed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- System Settings
CREATE TABLE IF NOT EXISTS system_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    value JSONB NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('security', 'sync', 'recommendations', 'notifications', 'general')),
    description TEXT NOT NULL,
    is_readonly BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_system_settings_updated_at
BEFORE UPDATE ON system_settings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Agronomic Assessments & Review Workflow (Migration 027)
CREATE TABLE IF NOT EXISTS agronomic_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    soil_reading_id UUID NOT NULL REFERENCES soil_readings(id) ON DELETE CASCADE,
    visit_id UUID REFERENCES officer_visits(id) ON DELETE SET NULL,
    officer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    claiming_agronomist_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'verified', 'flagged')),
    review_stage TEXT NOT NULL DEFAULT 'generated' CHECK (review_stage IN ('generated', 'review_requested', 'claimed', 'under_review', 'published')),
    county TEXT NOT NULL,
    sub_county TEXT,
    ward TEXT,
    crop TEXT NOT NULL DEFAULT 'maize',
    engine_version TEXT NOT NULL DEFAULT 'kalro-rules-v2.1',
    engine_baseline JSONB NOT NULL DEFAULT '{}'::jsonb,
    officer_edits JSONB NOT NULL DEFAULT '[]'::jsonb,
    agronomist_edits JSONB NOT NULL DEFAULT '[]'::jsonb,
    verified_report JSONB,
    claimed_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    published_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessments_farm_id ON agronomic_assessments(farm_id);
CREATE INDEX IF NOT EXISTS idx_assessments_reading_id ON agronomic_assessments(soil_reading_id);
CREATE INDEX IF NOT EXISTS idx_assessments_status_county ON agronomic_assessments(status, county);
CREATE INDEX IF NOT EXISTS idx_assessments_claiming_agronomist ON agronomic_assessments(claiming_agronomist_id);
CREATE INDEX IF NOT EXISTS idx_assessments_officer_user ON agronomic_assessments(officer_user_id);


