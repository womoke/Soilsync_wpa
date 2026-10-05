-- Migration 021: block direct Data API access to the PostGIS system table.
-- The table is owned by supabase_admin, so its grants cannot be changed here.

BEGIN;

CREATE OR REPLACE FUNCTION soilsync_meta.deny_spatial_ref_sys_api()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, soilsync_meta
AS $$
DECLARE
    request_path TEXT;
BEGIN
    request_path := current_setting('request.path', TRUE);

    IF 'spatial_ref_sys' = ANY (
        string_to_array(trim(both '/' FROM COALESCE(request_path, '')), '/')
    ) THEN
        RAISE SQLSTATE 'PGRST'
            USING MESSAGE = json_build_object(
                'code', 'PGRST',
                'message', 'Not Found',
                'details', 'This endpoint is not available.',
                'hint', NULL
            )::TEXT,
            DETAIL = json_build_object('status', 404)::TEXT;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION soilsync_meta.deny_spatial_ref_sys_api() FROM PUBLIC;
GRANT USAGE ON SCHEMA soilsync_meta TO authenticator;
GRANT EXECUTE ON FUNCTION soilsync_meta.deny_spatial_ref_sys_api() TO authenticator;

ALTER ROLE authenticator
    SET pgrst.db_pre_request = 'soilsync_meta.deny_spatial_ref_sys_api';

NOTIFY pgrst, 'reload config';

COMMIT;
