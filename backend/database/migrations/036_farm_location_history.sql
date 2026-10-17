BEGIN;

CREATE TABLE IF NOT EXISTS public.farm_location_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farm_id UUID NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
    visit_id UUID NOT NULL REFERENCES public.officer_visits(id) ON DELETE CASCADE,
    changed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    previous_latitude DOUBLE PRECISION NOT NULL
        CHECK (previous_latitude BETWEEN -90 AND 90),
    previous_longitude DOUBLE PRECISION NOT NULL
        CHECK (previous_longitude BETWEEN -180 AND 180),
    replacement_latitude DOUBLE PRECISION NOT NULL
        CHECK (replacement_latitude BETWEEN -90 AND 90),
    replacement_longitude DOUBLE PRECISION NOT NULL
        CHECK (replacement_longitude BETWEEN -180 AND 180),
    replaced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        previous_latitude IS DISTINCT FROM replacement_latitude
        OR previous_longitude IS DISTINCT FROM replacement_longitude
    )
);

CREATE INDEX IF NOT EXISTS idx_farm_location_history_farm_replaced
    ON public.farm_location_history(farm_id, replaced_at DESC);
CREATE INDEX IF NOT EXISTS idx_farm_location_history_visit
    ON public.farm_location_history(visit_id);

ALTER TABLE public.farm_location_history ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.farm_location_history IS
    'Restricted audit history of exact farm coordinates replaced during consented officer field collection.';
COMMENT ON COLUMN public.farm_location_history.previous_latitude IS
    'Exact latitude stored on the farm immediately before the consented replacement.';
COMMENT ON COLUMN public.farm_location_history.replacement_latitude IS
    'Exact latitude recorded in the same consented field collection that replaced the prior point.';

COMMIT;
