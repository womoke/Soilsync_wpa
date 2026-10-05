-- Migration 017: align legacy role/profile records to Supabase Auth UUIDs.
-- user_roles is the authorization source; public.users remains a compatibility record.

BEGIN;

INSERT INTO public.user_roles (
    user_id,
    role,
    status,
    approved_by,
    approved_at,
    created_at,
    updated_at
)
SELECT
    users.supabase_auth_user_id,
    CASE user_roles.role
        WHEN 'extension_officer' THEN 'extension-officer'
        ELSE user_roles.role
    END,
    CASE
        WHEN users.is_active IS NOT TRUE THEN 'suspended'
        WHEN user_roles.role = 'agrodealer'
            AND COALESCE(agrodealer_profiles.verification_state, 'pending') <> 'verified'
            THEN 'pending'
        ELSE user_roles.status
    END,
    user_roles.approved_by,
    user_roles.approved_at,
    user_roles.created_at,
    NOW()
FROM public.user_roles
JOIN public.users ON public.users.id = public.user_roles.user_id
LEFT JOIN public.agrodealer_profiles
    ON public.agrodealer_profiles.user_id = public.users.id
WHERE public.users.supabase_auth_user_id IS NOT NULL
ON CONFLICT (user_id, role) DO UPDATE SET
    status = CASE
        WHEN EXCLUDED.status = 'suspended' THEN 'suspended'
        WHEN public.user_roles.status = 'suspended' THEN 'suspended'
        ELSE EXCLUDED.status
    END,
    approved_by = COALESCE(EXCLUDED.approved_by, public.user_roles.approved_by),
    approved_at = COALESCE(EXCLUDED.approved_at, public.user_roles.approved_at),
    updated_at = NOW();

DELETE FROM public.user_roles
USING public.users
WHERE public.user_roles.user_id = public.users.id
  AND public.users.supabase_auth_user_id IS NOT NULL
  AND public.users.supabase_auth_user_id <> public.users.id;

INSERT INTO public.user_roles (user_id, role, status, created_at, updated_at)
SELECT
    users.supabase_auth_user_id,
    CASE users.role
        WHEN 'extension_officer' THEN 'extension-officer'
        ELSE users.role
    END,
    CASE
        WHEN users.is_active IS NOT TRUE THEN 'suspended'
        WHEN users.role = 'agrodealer'
            AND COALESCE(agrodealer_profiles.verification_state, 'pending') <> 'verified'
            THEN 'pending'
        ELSE 'active'
    END,
    COALESCE(users.created_at, NOW()),
    NOW()
FROM public.users
LEFT JOIN public.agrodealer_profiles
    ON public.agrodealer_profiles.user_id = public.users.id
WHERE users.supabase_auth_user_id IS NOT NULL
  AND users.role IN ('farmer', 'extension_officer', 'agrodealer', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;

UPDATE public.user_roles
SET status = 'suspended',
    updated_at = NOW()
FROM public.users
WHERE public.users.supabase_auth_user_id = public.user_roles.user_id
  AND public.users.is_active IS NOT TRUE;

UPDATE public.profiles AS auth_profile
SET full_name = COALESCE(auth_profile.full_name, legacy_profile.full_name),
    county = COALESCE(auth_profile.county, legacy_profile.county),
    sub_county = COALESCE(auth_profile.sub_county, legacy_profile.sub_county),
    ward = COALESCE(auth_profile.ward, legacy_profile.ward),
    phone_number = COALESCE(auth_profile.phone_number, legacy_profile.phone_number),
    updated_at = NOW()
FROM public.users
JOIN public.profiles AS legacy_profile ON legacy_profile.id = public.users.id
WHERE auth_profile.id = public.users.supabase_auth_user_id
  AND public.users.supabase_auth_user_id IS NOT NULL
  AND public.users.supabase_auth_user_id <> public.users.id;

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_full_name TEXT;
    v_profile_rows INTEGER;
BEGIN
    v_full_name := COALESCE(
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'display_name'
    );

    INSERT INTO public.profiles (id, full_name, created_at, updated_at)
    VALUES (NEW.id, v_full_name, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS v_profile_rows = ROW_COUNT;

    INSERT INTO public.user_roles (user_id, role, status, created_at, updated_at)
    VALUES (NEW.id, 'farmer', 'active', NOW(), NOW())
    ON CONFLICT (user_id, role) DO NOTHING;

    IF v_profile_rows > 0 THEN
        INSERT INTO public.audit_log (actor_id, action, target_type, target_id, details)
        VALUES (
            NEW.id,
            'user_signed_up',
            'user',
            NEW.id::TEXT,
            jsonb_build_object('assigned_role', 'farmer', 'status', 'active')
        );
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_auth_user() IS
    'Creates an Auth-UUID profile and farmer role. Legacy app-profile linking waits for verified sign-in.';

DROP TRIGGER IF EXISTS soilsync_on_auth_user_verified_insert ON auth.users;
CREATE TRIGGER soilsync_on_auth_user_verified_insert
AFTER INSERT ON auth.users
FOR EACH ROW
WHEN (NEW.email_confirmed_at IS NOT NULL OR NEW.phone_confirmed_at IS NOT NULL)
EXECUTE FUNCTION public.handle_new_auth_user();

DROP TRIGGER IF EXISTS soilsync_on_auth_user_verified_update ON auth.users;
CREATE TRIGGER soilsync_on_auth_user_verified_update
AFTER UPDATE OF email_confirmed_at, phone_confirmed_at ON auth.users
FOR EACH ROW
WHEN (
    (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
    OR (OLD.phone_confirmed_at IS NULL AND NEW.phone_confirmed_at IS NOT NULL)
)
EXECUTE FUNCTION public.handle_new_auth_user();

CREATE OR REPLACE FUNCTION public.is_active_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT public.has_active_role(auth.uid(), 'admin');
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT public.has_active_role(auth.uid(), 'admin');
$$;

REVOKE ALL ON FUNCTION public.is_active_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_admin() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

COMMIT;
