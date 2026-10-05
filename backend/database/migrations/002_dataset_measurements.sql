BEGIN;

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

ALTER TABLE soil_readings
    ALTER COLUMN farm_id DROP NOT NULL,
    ADD COLUMN dataset_id UUID REFERENCES source_datasets(id) ON DELETE RESTRICT,
    ADD COLUMN import_batch_id UUID REFERENCES source_import_batches(id) ON DELETE SET NULL,
    ADD COLUMN provenance_id UUID REFERENCES source_provenance(id) ON DELETE RESTRICT,
    ADD COLUMN county TEXT,
    ADD COLUMN constituency TEXT,
    ADD COLUMN ward TEXT,
    ADD COLUMN village TEXT,
    ADD COLUMN source_lab_number TEXT,
    ADD COLUMN source_lab_year TEXT,
    ADD COLUMN source_latitude DOUBLE PRECISION,
    ADD COLUMN source_longitude DOUBLE PRECISION,
    ADD COLUMN final_latitude DOUBLE PRECISION,
    ADD COLUMN final_longitude DOUBLE PRECISION,
    ADD COLUMN gps_tagged_from TEXT,
    ADD COLUMN source_crop_text TEXT,
    ADD COLUMN source_recommendation_text TEXT,
    ADD COLUMN coordinate_source TEXT,
    ADD COLUMN location GEOGRAPHY(Point, 4326);

ALTER TABLE source_provenance
    ADD COLUMN source_dataset_ref_id UUID REFERENCES source_datasets(id) ON DELETE RESTRICT;

ALTER TABLE soil_readings
    ADD CONSTRAINT soil_readings_import_requires_dataset
        CHECK (import_batch_id IS NULL OR dataset_id IS NOT NULL) NOT VALID,
    ADD CONSTRAINT soil_readings_dataset_requires_provenance
        CHECK (dataset_id IS NULL OR provenance_id IS NOT NULL) NOT VALID,
    ADD CONSTRAINT soil_readings_coordinate_pair
        CHECK ((latitude IS NULL) = (longitude IS NULL)) NOT VALID,
    ADD CONSTRAINT soil_readings_latitude_range
        CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90) NOT VALID,
    ADD CONSTRAINT soil_readings_longitude_range
        CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180) NOT VALID,
    ADD CONSTRAINT soil_readings_source_coordinate_pair
        CHECK ((source_latitude IS NULL) = (source_longitude IS NULL)) NOT VALID,
    ADD CONSTRAINT soil_readings_final_coordinate_pair
        CHECK ((final_latitude IS NULL) = (final_longitude IS NULL)) NOT VALID,
    ADD CONSTRAINT soil_readings_source_latitude_range
        CHECK (source_latitude IS NULL OR source_latitude BETWEEN -90 AND 90) NOT VALID,
    ADD CONSTRAINT soil_readings_source_longitude_range
        CHECK (source_longitude IS NULL OR source_longitude BETWEEN -180 AND 180) NOT VALID,
    ADD CONSTRAINT soil_readings_final_latitude_range
        CHECK (final_latitude IS NULL OR final_latitude BETWEEN -90 AND 90) NOT VALID,
    ADD CONSTRAINT soil_readings_final_longitude_range
        CHECK (final_longitude IS NULL OR final_longitude BETWEEN -180 AND 180) NOT VALID,
    ADD CONSTRAINT soil_readings_depth_range
        CHECK (top_cm IS NULL OR bottom_cm IS NULL OR top_cm <= bottom_cm) NOT VALID;

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

CREATE TRIGGER set_soil_reading_location
BEFORE INSERT OR UPDATE OF latitude, longitude ON soil_readings
FOR EACH ROW
EXECUTE FUNCTION set_soil_reading_location();

CREATE TRIGGER set_source_datasets_updated_at
BEFORE UPDATE ON source_datasets
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN soil_readings.source_recommendation_text IS
    'Historical source advice for provenance only; not an observed treatment outcome or training label.';
COMMENT ON COLUMN soil_readings.farm_id IS
    'Nullable because imported soil records may not identify an individual farm.';
COMMENT ON TABLE soil_measurements IS
    'One row per analyte; preserves source units/classes and measurement-level quality.';

COMMIT;