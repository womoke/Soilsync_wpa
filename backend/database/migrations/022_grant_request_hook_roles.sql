-- Migration 022: allow PostgREST request roles to invoke the private guard.

BEGIN;

GRANT USAGE ON SCHEMA soilsync_meta TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION soilsync_meta.deny_spatial_ref_sys_api()
    TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload config';

COMMIT;
