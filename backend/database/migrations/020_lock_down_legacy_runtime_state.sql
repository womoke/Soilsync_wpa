-- Migration 020: remove direct client access to legacy shared runtime state.

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_runtime_state (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_runtime_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_runtime_state FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_runtime_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.app_runtime_state TO service_role;

-- PostGIS reference metadata remains readable, but clients cannot alter it.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLE public.spatial_ref_sys
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.spatial_ref_sys TO anon, authenticated;

COMMIT;
