BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'farmer',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS farms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    county TEXT,
    ward TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    geom GEOGRAPHY(Point, 4326),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS soil_readings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

CREATE INDEX IF NOT EXISTS idx_farms_owner_id ON farms(owner_id);
CREATE INDEX IF NOT EXISTS idx_farms_county ON farms(county);
CREATE INDEX IF NOT EXISTS idx_soil_readings_farm_id ON soil_readings(farm_id);
CREATE INDEX IF NOT EXISTS idx_soil_readings_sampled_at ON soil_readings(sampled_at);
CREATE INDEX IF NOT EXISTS idx_recommendations_soil_reading_id ON recommendations(soil_reading_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_review_status ON recommendations(review_status);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
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

CREATE TRIGGER set_recommendations_updated_at
BEFORE UPDATE ON recommendations
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;
