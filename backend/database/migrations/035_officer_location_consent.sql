BEGIN;

CREATE TABLE IF NOT EXISTS public.officer_location_consent_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farm_id UUID NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
    visit_id UUID NOT NULL REFERENCES public.officer_visits(id) ON DELETE CASCADE,
    farmer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    officer_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    consent_scopes TEXT[] NOT NULL,
    wording_version TEXT NOT NULL,
    consent_notes TEXT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        CARDINALITY(consent_scopes) > 0
        AND consent_scopes <@ ARRAY[
            'store_exact_coordinates',
            'send_coordinates_to_third_party_soil_service'
        ]::TEXT[]
    ),
    CHECK (length(btrim(wording_version)) > 0),
    CHECK (length(btrim(consent_notes)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_officer_location_consent_visit_recorded
    ON public.officer_location_consent_records(visit_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_officer_location_consent_farm_recorded
    ON public.officer_location_consent_records(farm_id, recorded_at DESC);

ALTER TABLE public.officer_location_consent_records ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.officer_location_consent_records IS
    'Auditable farmer location-consent attestations. Consent for third-party soil services must be separately and explicitly recorded.';
COMMENT ON COLUMN public.officer_location_consent_records.consent_scopes IS
    'Explicit scopes granted by the farmer; current field collection records storage only.';
COMMENT ON COLUMN public.officer_location_consent_records.wording_version IS
    'Server-selected identifier for the consent text shown when consent was captured.';

COMMIT;
