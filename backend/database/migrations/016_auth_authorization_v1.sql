-- Migration 016: Auth & Authorization Logic v1.0 (MVP)
-- Implements single identity system, user_roles with status lifecycle, profiles table,
-- agrodealer verification fields, officer designation scoping, append-only audit_log,
-- automatic farmer profile trigger on confirmation, and fail-closed RLS policies.

BEGIN;

-- =============================================================================
-- 1. Profiles Table (1:1 with auth.users)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY,
    full_name TEXT,
    county TEXT,
    sub_county TEXT,
    ward TEXT,
    phone_number TEXT CHECK (phone_number IS NULL OR phone_number ~ '^\+254\d{9}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.profiles IS
    'User profiles keyed by Supabase Auth user ID. Holds demographic and contact attributes without credentials.';
COMMENT ON COLUMN public.profiles.phone_number IS
    'Optional contact phone in Kenya +254 format. Not used as primary identity in MVP.';

-- Add updated_at trigger on profiles
DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 2. User Roles Table (Role lifecycle: pending, active, suspended)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('farmer', 'extension-officer', 'agrodealer', 'admin')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended')),
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_lookup
    ON public.user_roles(user_id, role, status);

COMMENT ON TABLE public.user_roles IS
    'Data-backed role assignments. The client never chooses its role; privileged roles remain closed.';
COMMENT ON COLUMN public.user_roles.status IS
    'Status lifecycle: pending (no privileges), active (granted privileges), suspended (blocked).';

-- Add updated_at trigger on user_roles
DROP TRIGGER IF EXISTS set_user_roles_updated_at ON public.user_roles;
CREATE TRIGGER set_user_roles_updated_at
BEFORE UPDATE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 3. Extension Officer Jurisdictions Enhancements
-- =============================================================================

ALTER TABLE public.officer_jurisdictions
    ADD COLUMN IF NOT EXISTS designation TEXT CHECK (designation IS NULL OR designation IN ('county', 'subcounty', 'ward'));

COMMENT ON COLUMN public.officer_jurisdictions.designation IS
    'Officer assignment scope level: county, subcounty, or ward.';

-- =============================================================================
-- 4. Agrodealer Profiles Enhancements (Application & Verification)
-- =============================================================================

ALTER TABLE public.agrodealer_profiles
    ADD COLUMN IF NOT EXISTS licence_number TEXT,
    ADD COLUMN IF NOT EXISTS contact_name TEXT,
    ADD COLUMN IF NOT EXISTS shop_location TEXT,
    ADD COLUMN IF NOT EXISTS verification_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (verification_state IN ('pending', 'verified', 'rejected'));

COMMENT ON COLUMN public.agrodealer_profiles.verification_state IS
    'Admin verification status of agrodealer application and trade licence.';

-- =============================================================================
-- 5. Append-Only Audit Log
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    details JSONB NOT NULL DEFAULT '{}'::JSONB,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp
    ON public.audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor
    ON public.audit_log(actor_id, timestamp DESC);

COMMENT ON TABLE public.audit_log IS
    'Immutable, append-only security and administrative audit log.';

-- Enforce append-only on audit_log (prevent UPDATE and DELETE)
CREATE OR REPLACE FUNCTION public.prevent_audit_log_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Audit log records are immutable and cannot be updated or deleted.';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_audit_log_update ON public.audit_log;
CREATE TRIGGER trg_prevent_audit_log_update
BEFORE UPDATE OR DELETE ON public.audit_log
FOR EACH ROW
EXECUTE FUNCTION public.prevent_audit_log_modification();

-- =============================================================================
-- 6. Helper Functions for Roles and Privileges
-- =============================================================================

CREATE OR REPLACE FUNCTION public.has_active_role(p_user_id UUID, p_role TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = p_user_id
          AND role = p_role
          AND status = 'active'
    );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT public.has_active_role(auth.uid(), 'admin')
        OR public.is_active_admin();
$$;

REVOKE ALL ON FUNCTION public.has_active_role(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_active_role(UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- =============================================================================
-- 7. Trigger: Auto-Provision Profile & Active Farmer Role on Sign-Up
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_full_name TEXT;
BEGIN
    -- Extract full name from raw metadata if provided
    v_full_name := NEW.raw_user_meta_data->>'full_name';

    -- 1. Create base profile
    INSERT INTO public.profiles (id, full_name, created_at, updated_at)
    VALUES (NEW.id, v_full_name, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;

    -- 2. Assign active farmer role (public signup creates farmer ONLY)
    INSERT INTO public.user_roles (user_id, role, status, created_at, updated_at)
    VALUES (NEW.id, 'farmer', 'active', NOW(), NOW())
    ON CONFLICT (user_id, role) DO NOTHING;

    -- 3. Synchronize with legacy public.users row if applicable
    INSERT INTO public.users (email, display_name, role, is_active, supabase_auth_user_id)
    VALUES (NEW.email, COALESCE(v_full_name, split_part(NEW.email, '@', 1)), 'farmer', TRUE, NEW.id)
    ON CONFLICT (supabase_auth_user_id) DO NOTHING;

    -- 4. Record audit entry
    INSERT INTO public.audit_log (actor_id, action, target_type, target_id, details)
    VALUES (
        NEW.id,
        'user_signed_up',
        'user',
        NEW.id::TEXT,
        jsonb_build_object('email', NEW.email, 'assigned_role', 'farmer', 'status', 'active')
    );

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_auth_user() IS
    'Trigger invoked upon auth.users creation. Establishes profile, assigns active farmer role, and records audit log.';

-- =============================================================================
-- 8. Fail-Closed Row Level Security (RLS) Policies
-- =============================================================================

-- Enable RLS on profiles, user_roles, audit_log
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- 8.1 PROFILES POLICIES
DROP POLICY IF EXISTS profiles_select_own_or_admin ON public.profiles;
CREATE POLICY profiles_select_own_or_admin ON public.profiles
    FOR SELECT
    USING (
        id = auth.uid()
        OR public.is_admin()
        OR (
            -- Extension officer can view farmer profiles in their jurisdiction
            public.has_active_role(auth.uid(), 'extension-officer')
            AND EXISTS (
                SELECT 1
                FROM public.officer_jurisdictions oj
                JOIN public.users u_officer ON u_officer.id = oj.officer_user_id
                WHERE u_officer.supabase_auth_user_id = auth.uid()
                  AND oj.is_active = TRUE
                  AND (oj.county IS NULL OR oj.county = profiles.county)
                  AND (oj.sub_county IS NULL OR oj.sub_county = profiles.sub_county)
                  AND (oj.ward IS NULL OR oj.ward = profiles.ward)
            )
        )
    );

DROP POLICY IF EXISTS profiles_update_own_or_admin ON public.profiles;
CREATE POLICY profiles_update_own_or_admin ON public.profiles
    FOR UPDATE
    USING (id = auth.uid() OR public.is_admin())
    WITH CHECK (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles
    FOR INSERT
    WITH CHECK (id = auth.uid() OR public.is_admin());

-- 8.2 USER ROLES POLICIES (Client can only read own; only admin can write)
DROP POLICY IF EXISTS user_roles_select_own_or_admin ON public.user_roles;
CREATE POLICY user_roles_select_own_or_admin ON public.user_roles
    FOR SELECT
    USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS user_roles_admin_manage ON public.user_roles;
CREATE POLICY user_roles_admin_manage ON public.user_roles
    FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- 8.3 AUDIT LOG POLICIES (Read-only for admins; insert allowed for system/auth)
DROP POLICY IF EXISTS audit_log_select_admin ON public.audit_log;
CREATE POLICY audit_log_select_admin ON public.audit_log
    FOR SELECT
    USING (public.is_admin());

DROP POLICY IF EXISTS audit_log_insert_authenticated ON public.audit_log;
CREATE POLICY audit_log_insert_authenticated ON public.audit_log
    FOR INSERT
    WITH CHECK (actor_id = auth.uid() OR public.is_admin());

-- =============================================================================
-- 9. Permissions Grants
-- =============================================================================

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;

REVOKE ALL ON TABLE public.user_roles FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.user_roles TO authenticated;
GRANT ALL ON TABLE public.user_roles TO service_role;

REVOKE ALL ON TABLE public.audit_log FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.audit_log TO authenticated;
GRANT ALL ON TABLE public.audit_log TO service_role;

COMMIT;
