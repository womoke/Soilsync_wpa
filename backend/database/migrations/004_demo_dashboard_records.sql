BEGIN;

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS demo_status TEXT NOT NULL DEFAULT 'active';

UPDATE public.soil_readings
SET source_provider = 'DEMO'
WHERE reading_source = 'DEMO_SEED'
    AND source_provider = 'LOCAL_SEED';

CREATE TABLE IF NOT EXISTS public.demo_dashboard_records (
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

ALTER TABLE public.demo_dashboard_records ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_demo_dashboard_records_role_type_order
    ON public.demo_dashboard_records(audience_role, record_type, display_order);

COMMIT;