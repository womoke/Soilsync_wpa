BEGIN;

ALTER TABLE public.soil_readings
    ADD COLUMN IF NOT EXISTS source_reading_id UUID
        REFERENCES public.soil_readings(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_soil_readings_source_reading_id
    ON public.soil_readings(source_reading_id)
    WHERE source_reading_id IS NOT NULL;

ALTER TABLE public.soil_estimate_requests
    ADD COLUMN IF NOT EXISTS consent_record_id UUID
        REFERENCES public.officer_location_consent_records(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS estimate_reading_id UUID UNIQUE
        REFERENCES public.soil_readings(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.soil_readings.source_reading_id IS
    'Original measured reading associated with this separate modeled-estimate snapshot.';
COMMENT ON COLUMN public.soil_estimate_requests.consent_record_id IS
    'Explicit third-party coordinate-sharing consent required before an iSDA request is made.';
COMMENT ON COLUMN public.soil_estimate_requests.estimate_reading_id IS
    'Immutable reading-level iSDA snapshot created from this request; absent on failed requests.';

COMMIT;
