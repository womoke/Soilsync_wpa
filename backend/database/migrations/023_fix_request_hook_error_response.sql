-- Migration 023: include required PostgREST detail fields for custom errors.

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
            DETAIL = json_build_object(
                'status', 404,
                'headers', json_build_object()
            )::TEXT;
    END IF;
END;
$$;

NOTIFY pgrst, 'reload config';

COMMIT;
