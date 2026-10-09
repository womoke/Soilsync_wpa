BEGIN;

ALTER TABLE public.unclaimed_farmer_accounts
    ALTER COLUMN officer_user_id DROP NOT NULL;
ALTER TABLE public.unclaimed_farmer_accounts
    DROP CONSTRAINT IF EXISTS unclaimed_farmer_accounts_officer_user_id_fkey;
ALTER TABLE public.unclaimed_farmer_accounts
    ADD CONSTRAINT unclaimed_farmer_accounts_officer_user_id_fkey
    FOREIGN KEY (officer_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.admin_audit_log
    ALTER COLUMN actor_user_id DROP NOT NULL;
ALTER TABLE public.admin_audit_log
    DROP CONSTRAINT IF EXISTS admin_audit_log_actor_user_id_fkey;
ALTER TABLE public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.prevent_audit_log_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    anonymizer_owner TEXT;
BEGIN
    SELECT pg_catalog.pg_get_userbyid(proowner)
    INTO anonymizer_owner
    FROM pg_catalog.pg_proc
    WHERE oid = 'public.anonymize_deleted_user_audit_history(uuid,uuid,text)'::regprocedure;

    IF TG_OP = 'UPDATE'
       AND current_setting('soilsync.audit_anonymization', TRUE) = 'on'
       AND current_user = anonymizer_owner THEN
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Audit log records are immutable and cannot be updated or deleted.';
END;
$$;

CREATE OR REPLACE FUNCTION public.anonymize_deleted_user_audit_history(
    deleted_user_id UUID,
    deleted_auth_user_id UUID,
    deleted_user_email TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
    PERFORM pg_catalog.set_config('soilsync.audit_anonymization', 'on', TRUE);

    UPDATE public.audit_log
    SET actor_id = CASE
            WHEN actor_id = deleted_user_id OR actor_id = deleted_auth_user_id THEN NULL
            ELSE actor_id
        END,
        target_id = NULL,
        details = '{"anonymized": true}'::jsonb
    WHERE actor_id = deleted_user_id
       OR actor_id = deleted_auth_user_id
       OR target_id = deleted_user_id::TEXT
       OR target_id = deleted_auth_user_id::TEXT
       OR POSITION(LOWER(deleted_user_id::TEXT) IN LOWER(details::TEXT)) > 0
       OR (
            deleted_auth_user_id IS NOT NULL
            AND POSITION(LOWER(deleted_auth_user_id::TEXT) IN LOWER(details::TEXT)) > 0
       )
       OR (
            COALESCE(deleted_user_email, '') <> ''
            AND POSITION(LOWER(deleted_user_email) IN LOWER(details::TEXT)) > 0
       );

    UPDATE public.admin_audit_log
    SET actor_user_id = CASE
            WHEN actor_user_id = deleted_user_id THEN NULL
            ELSE actor_user_id
        END,
        target_id = NULL,
        detail = '{"anonymized": true}'::jsonb,
        ip_address = CASE WHEN actor_user_id = deleted_user_id THEN NULL ELSE ip_address END
    WHERE actor_user_id = deleted_user_id
       OR target_id = deleted_user_id::TEXT
       OR target_id = deleted_auth_user_id::TEXT
       OR POSITION(LOWER(deleted_user_id::TEXT) IN LOWER(detail::TEXT)) > 0
       OR (
            deleted_auth_user_id IS NOT NULL
            AND POSITION(LOWER(deleted_auth_user_id::TEXT) IN LOWER(detail::TEXT)) > 0
       )
       OR (
            COALESCE(deleted_user_email, '') <> ''
            AND POSITION(LOWER(deleted_user_email) IN LOWER(detail::TEXT)) > 0
       );
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_deleted_user_audit_history(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.anonymize_deleted_user_audit_history(UUID, UUID, TEXT)
    TO postgres, service_role;

COMMIT;
