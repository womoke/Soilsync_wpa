BEGIN;

ALTER TABLE public.soil_readings
    ADD COLUMN IF NOT EXISTS source_dataset_version TEXT;

ALTER TABLE public.soil_measurements
    ADD COLUMN IF NOT EXISTS uncertainty_lower NUMERIC(18, 8),
    ADD COLUMN IF NOT EXISTS uncertainty_upper NUMERIC(18, 8),
    ADD COLUMN IF NOT EXISTS interval_level NUMERIC(8, 5),
    ADD COLUMN IF NOT EXISTS depth_layer TEXT,
    ADD COLUMN IF NOT EXISTS depth_top_cm DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS depth_bottom_cm DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS transformations JSONB NOT NULL DEFAULT '[]'::JSONB,
    ADD COLUMN IF NOT EXISTS normalization_error TEXT;

ALTER TABLE public.soil_measurements
    ADD CONSTRAINT soil_measurements_uncertainty_range
        CHECK (
            uncertainty_lower IS NULL
            OR uncertainty_upper IS NULL
            OR uncertainty_lower <= uncertainty_upper
        ),
    ADD CONSTRAINT soil_measurements_depth_range
        CHECK (depth_top_cm IS NULL OR depth_bottom_cm IS NULL OR depth_top_cm <= depth_bottom_cm),
    ADD CONSTRAINT soil_measurements_transformations_array
        CHECK (jsonb_typeof(transformations) = 'array');

CREATE TABLE IF NOT EXISTS public.soil_estimate_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reading_id UUID NOT NULL REFERENCES public.soil_readings(id) ON DELETE CASCADE,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'ok', 'failed')),
    http_status INTEGER CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
    rounded_latitude DOUBLE PRECISION,
    rounded_longitude DOUBLE PRECISION,
    layers_requested JSONB NOT NULL DEFAULT '[]'::JSONB,
    error_text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (rounded_latitude IS NULL OR rounded_latitude BETWEEN -90 AND 90),
    CHECK (rounded_longitude IS NULL OR rounded_longitude BETWEEN -180 AND 180),
    CHECK ((rounded_latitude IS NULL) = (rounded_longitude IS NULL)),
    CHECK (jsonb_typeof(layers_requested) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_soil_estimate_requests_reading_requested
    ON public.soil_estimate_requests(reading_id, requested_at DESC);

ALTER TABLE public.soil_estimate_requests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.soil_estimate_requests IS
    'Audit log for per-reading modeled soil estimate requests; never store credentials or raw coordinates.';
COMMENT ON COLUMN public.soil_readings.source_dataset_version IS
    'Dataset version captured with this reading snapshot, independent of later registry changes.';
COMMENT ON COLUMN public.soil_measurements.source_value_text IS
    'Original source value text before normalization; paired with source_unit.';
COMMENT ON COLUMN public.soil_measurements.transformations IS
    'Ordered, machine-readable transformations applied to the source measurement.';

COMMIT;
