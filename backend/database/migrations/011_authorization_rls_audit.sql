BEGIN;

-- =============================================================================
-- 1. Admin permissions – least-privilege grants per admin user
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.admin_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    permission TEXT NOT NULL CHECK (
        permission IN (
            'manage_accounts',
            'manage_roles',
            'manage_officer_assignments',
            'manage_dealer_approvals',
            'view_audit_log',
            'support_access',
            'manage_settings'
        )
    ),
    granted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (admin_user_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_admin_permissions_active
    ON public.admin_permissions(admin_user_id, is_active)
    WHERE is_active = TRUE;

ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_admin_permissions_updated_at
BEFORE UPDATE ON public.admin_permissions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE public.admin_permissions IS
    'Least-privilege admin grants; each admin receives only specific permissions, never blanket access.';

-- =============================================================================
-- 2. Admin audit log – every privileged action is recorded
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    detail JSONB NOT NULL DEFAULT '{}'::JSONB,
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor
    ON public.admin_audit_log(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action
    ON public.admin_audit_log(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target
    ON public.admin_audit_log(target_type, target_id, created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.admin_audit_log IS
    'Append-only audit trail for privileged admin actions; never stores secrets or unnecessary PII.';

-- =============================================================================
-- 3. RLS policies – server-side ownership and role enforcement
--    These policies ensure that even if a Supabase client bypasses the API,
--    RLS will enforce the same access boundaries.
-- =============================================================================

-- ------- Helper: current authenticated Supabase user ID -------------------
-- auth.uid() returns the Supabase Auth user UUID from the JWT.
-- We need to map that to our app user ID for ownership checks.

-- ------- users table policies ---------------------------------------------
-- Users can read their own profile; admins can read all.
DROP POLICY IF EXISTS users_select_own ON public.users;
CREATE POLICY users_select_own ON public.users
    FOR SELECT
    USING (
        supabase_auth_user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.users AS admin_user
            WHERE admin_user.supabase_auth_user_id = auth.uid()
              AND admin_user.role = 'admin'
              AND admin_user.is_active = TRUE
        )
    );

-- Users can update only their own profile (display_name only via app).
DROP POLICY IF EXISTS users_update_own ON public.users;
CREATE POLICY users_update_own ON public.users
    FOR UPDATE
    USING (supabase_auth_user_id = auth.uid())
    WITH CHECK (supabase_auth_user_id = auth.uid());

-- ------- farms table policies ---------------------------------------------
DROP POLICY IF EXISTS farms_select_owner ON public.farms;
CREATE POLICY farms_select_owner ON public.farms
    FOR SELECT
    USING (
        -- Farm owner
        owner_id IN (
            SELECT id FROM public.users
            WHERE supabase_auth_user_id = auth.uid()
        )
        -- Officers with jurisdiction match
        OR EXISTS (
            SELECT 1 FROM public.officer_jurisdictions AS oj
            JOIN public.users AS officer ON officer.id = oj.officer_user_id
            WHERE officer.supabase_auth_user_id = auth.uid()
              AND officer.role = 'extension_officer'
              AND officer.is_active = TRUE
              AND oj.is_active = TRUE
              AND (oj.county IS NULL OR farms.county = oj.county)
              AND (oj.sub_county IS NULL OR farms.sub_county = oj.sub_county)
              AND (oj.ward IS NULL OR farms.ward = oj.ward)
        )
        -- Admin
        OR EXISTS (
            SELECT 1 FROM public.users AS admin_user
            WHERE admin_user.supabase_auth_user_id = auth.uid()
              AND admin_user.role = 'admin'
              AND admin_user.is_active = TRUE
        )
    );

DROP POLICY IF EXISTS farms_insert_owner ON public.farms;
CREATE POLICY farms_insert_owner ON public.farms
    FOR INSERT
    WITH CHECK (
        owner_id IN (
            SELECT id FROM public.users
            WHERE supabase_auth_user_id = auth.uid()
              AND role = 'farmer'
              AND is_active = TRUE
        )
    );

DROP POLICY IF EXISTS farms_update_owner ON public.farms;
CREATE POLICY farms_update_owner ON public.farms
    FOR UPDATE
    USING (
        owner_id IN (
            SELECT id FROM public.users
            WHERE supabase_auth_user_id = auth.uid()
        )
    )
    WITH CHECK (
        owner_id IN (
            SELECT id FROM public.users
            WHERE supabase_auth_user_id = auth.uid()
        )
    );

-- ------- soil_readings policies -------------------------------------------
DROP POLICY IF EXISTS soil_readings_select_owner ON public.soil_readings;
CREATE POLICY soil_readings_select_owner ON public.soil_readings
    FOR SELECT
    USING (
        farm_id IN (
            SELECT f.id FROM public.farms AS f
            JOIN public.users AS u ON u.id = f.owner_id
            WHERE u.supabase_auth_user_id = auth.uid()
        )
        OR farm_id IN (
            SELECT f.id FROM public.farms AS f
            JOIN public.officer_jurisdictions AS oj
              ON (oj.county IS NULL OR f.county = oj.county)
             AND (oj.sub_county IS NULL OR f.sub_county = oj.sub_county)
             AND (oj.ward IS NULL OR f.ward = oj.ward)
            JOIN public.users AS officer ON officer.id = oj.officer_user_id
            WHERE officer.supabase_auth_user_id = auth.uid()
              AND officer.role = 'extension_officer'
              AND officer.is_active = TRUE
              AND oj.is_active = TRUE
        )
    );

DROP POLICY IF EXISTS soil_readings_insert_owner ON public.soil_readings;
CREATE POLICY soil_readings_insert_owner ON public.soil_readings
    FOR INSERT
    WITH CHECK (
        farm_id IN (
            SELECT f.id FROM public.farms AS f
            JOIN public.users AS u ON u.id = f.owner_id
            WHERE u.supabase_auth_user_id = auth.uid()
              AND u.role = 'farmer'
              AND f.owner_verified = TRUE
        )
    );

-- ------- soil_measurements policies (follow reading ownership) -----------
DROP POLICY IF EXISTS soil_measurements_select_owner ON public.soil_measurements;
CREATE POLICY soil_measurements_select_owner ON public.soil_measurements
    FOR SELECT
    USING (
        soil_reading_id IN (
            SELECT sr.id FROM public.soil_readings AS sr
            JOIN public.farms AS f ON f.id = sr.farm_id
            JOIN public.users AS u ON u.id = f.owner_id
            WHERE u.supabase_auth_user_id = auth.uid()
        )
    );

-- ------- recommendations policies ----------------------------------------
DROP POLICY IF EXISTS recommendations_select_owner ON public.recommendations;
CREATE POLICY recommendations_select_owner ON public.recommendations
    FOR SELECT
    USING (
        user_id IN (
            SELECT id FROM public.users WHERE supabase_auth_user_id = auth.uid()
        )
        OR farm_id IN (
            SELECT f.id FROM public.farms AS f
            JOIN public.users AS u ON u.id = f.owner_id
            WHERE u.supabase_auth_user_id = auth.uid()
        )
    );

-- ------- recommendation_feedback policies --------------------------------
DROP POLICY IF EXISTS recommendation_feedback_select_own ON public.recommendation_feedback;
CREATE POLICY recommendation_feedback_select_own ON public.recommendation_feedback
    FOR SELECT
    USING (
        user_id IN (
            SELECT id FROM public.users WHERE supabase_auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS recommendation_feedback_insert_own ON public.recommendation_feedback;
CREATE POLICY recommendation_feedback_insert_own ON public.recommendation_feedback
    FOR INSERT
    WITH CHECK (
        user_id IN (
            SELECT id FROM public.users WHERE supabase_auth_user_id = auth.uid()
        )
    );

-- ------- sync_drafts policies --------------------------------------------
DROP POLICY IF EXISTS sync_drafts_select_own ON public.sync_drafts;
CREATE POLICY sync_drafts_select_own ON public.sync_drafts
    FOR SELECT
    USING (
        owner_id IN (
            SELECT id FROM public.users WHERE supabase_auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS sync_drafts_insert_own ON public.sync_drafts;
CREATE POLICY sync_drafts_insert_own ON public.sync_drafts
    FOR INSERT
    WITH CHECK (
        owner_id IN (
            SELECT id FROM public.users WHERE supabase_auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS sync_drafts_update_own ON public.sync_drafts;
CREATE POLICY sync_drafts_update_own ON public.sync_drafts
    FOR UPDATE
    USING (
        owner_id IN (
            SELECT id FROM public.users WHERE supabase_auth_user_id = auth.uid()
        )
    );

-- ------- sync_queue policies ---------------------------------------------
DROP POLICY IF EXISTS sync_queue_select_own ON public.sync_queue;
CREATE POLICY sync_queue_select_own ON public.sync_queue
    FOR SELECT
    USING (
        owner_id IN (
            SELECT id FROM public.users WHERE supabase_auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS sync_queue_insert_own ON public.sync_queue;
CREATE POLICY sync_queue_insert_own ON public.sync_queue
    FOR INSERT
    WITH CHECK (
        owner_id IN (
            SELECT id FROM public.users WHERE supabase_auth_user_id = auth.uid()
        )
    );

-- ------- officer_jurisdictions policies ----------------------------------
DROP POLICY IF EXISTS officer_jurisdictions_select_own ON public.officer_jurisdictions;
CREATE POLICY officer_jurisdictions_select_own ON public.officer_jurisdictions
    FOR SELECT
    USING (
        officer_user_id IN (
            SELECT id FROM public.users WHERE supabase_auth_user_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.users AS admin_user
            WHERE admin_user.supabase_auth_user_id = auth.uid()
              AND admin_user.role = 'admin'
              AND admin_user.is_active = TRUE
        )
    );

-- ------- agrodealer_profiles policies ------------------------------------
DROP POLICY IF EXISTS agrodealer_profiles_select_own ON public.agrodealer_profiles;
CREATE POLICY agrodealer_profiles_select_own ON public.agrodealer_profiles
    FOR SELECT
    USING (
        user_id IN (
            SELECT id FROM public.users WHERE supabase_auth_user_id = auth.uid()
        )
        OR is_demo = TRUE
        OR EXISTS (
            SELECT 1 FROM public.users AS admin_user
            WHERE admin_user.supabase_auth_user_id = auth.uid()
              AND admin_user.role = 'admin'
              AND admin_user.is_active = TRUE
        )
    );

DROP POLICY IF EXISTS agrodealer_profiles_update_own ON public.agrodealer_profiles;
CREATE POLICY agrodealer_profiles_update_own ON public.agrodealer_profiles
    FOR UPDATE
    USING (
        user_id IN (
            SELECT id FROM public.users WHERE supabase_auth_user_id = auth.uid()
        )
    )
    WITH CHECK (
        user_id IN (
            SELECT id FROM public.users WHERE supabase_auth_user_id = auth.uid()
        )
    );

-- ------- dealer_products policies ----------------------------------------
DROP POLICY IF EXISTS dealer_products_select_own ON public.dealer_products;
CREATE POLICY dealer_products_select_own ON public.dealer_products
    FOR SELECT
    USING (
        dealer_id IN (
            SELECT ap.id FROM public.agrodealer_profiles AS ap
            JOIN public.users AS u ON u.id = ap.user_id
            WHERE u.supabase_auth_user_id = auth.uid()
        )
        OR is_demo = TRUE
    );

DROP POLICY IF EXISTS dealer_products_insert_own ON public.dealer_products;
CREATE POLICY dealer_products_insert_own ON public.dealer_products
    FOR INSERT
    WITH CHECK (
        dealer_id IN (
            SELECT ap.id FROM public.agrodealer_profiles AS ap
            JOIN public.users AS u ON u.id = ap.user_id
            WHERE u.supabase_auth_user_id = auth.uid()
              AND u.role = 'agrodealer'
              AND u.is_active = TRUE
        )
    );

DROP POLICY IF EXISTS dealer_products_update_own ON public.dealer_products;
CREATE POLICY dealer_products_update_own ON public.dealer_products
    FOR UPDATE
    USING (
        dealer_id IN (
            SELECT ap.id FROM public.agrodealer_profiles AS ap
            JOIN public.users AS u ON u.id = ap.user_id
            WHERE u.supabase_auth_user_id = auth.uid()
        )
    )
    WITH CHECK (
        dealer_id IN (
            SELECT ap.id FROM public.agrodealer_profiles AS ap
            JOIN public.users AS u ON u.id = ap.user_id
            WHERE u.supabase_auth_user_id = auth.uid()
        )
    );

-- ------- admin_permissions policies (admin-only) -------------------------
DROP POLICY IF EXISTS admin_permissions_select ON public.admin_permissions;
CREATE POLICY admin_permissions_select ON public.admin_permissions
    FOR SELECT
    USING (
        admin_user_id IN (
            SELECT id FROM public.users WHERE supabase_auth_user_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.users AS admin_user
            WHERE admin_user.supabase_auth_user_id = auth.uid()
              AND admin_user.role = 'admin'
              AND admin_user.is_active = TRUE
        )
    );

-- ------- admin_audit_log policies (admin with view_audit_log) ------------
DROP POLICY IF EXISTS admin_audit_log_select ON public.admin_audit_log;
CREATE POLICY admin_audit_log_select ON public.admin_audit_log
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.admin_permissions AS ap
            JOIN public.users AS u ON u.id = ap.admin_user_id
            WHERE u.supabase_auth_user_id = auth.uid()
              AND u.role = 'admin'
              AND u.is_active = TRUE
              AND ap.permission = 'view_audit_log'
              AND ap.is_active = TRUE
              AND (ap.expires_at IS NULL OR ap.expires_at > NOW())
        )
    );

-- admin_audit_log is append-only from server; no client INSERT policy.

-- ------- source_provenance policies (server-side only) -------------------
DROP POLICY IF EXISTS source_provenance_deny_all ON public.source_provenance;
CREATE POLICY source_provenance_deny_all ON public.source_provenance
    FOR SELECT
    USING (FALSE);

-- ------- source_datasets policies (server-side only) ---------------------
DROP POLICY IF EXISTS source_datasets_deny_all ON public.source_datasets;
CREATE POLICY source_datasets_deny_all ON public.source_datasets
    FOR SELECT
    USING (FALSE);

-- ------- source_import_batches policies (server-side only) ---------------
DROP POLICY IF EXISTS source_import_batches_deny_all ON public.source_import_batches;
CREATE POLICY source_import_batches_deny_all ON public.source_import_batches
    FOR SELECT
    USING (FALSE);

-- ------- demo_dashboard_records policies (read-only for demos) -----------
DROP POLICY IF EXISTS demo_dashboard_records_select ON public.demo_dashboard_records;
CREATE POLICY demo_dashboard_records_select ON public.demo_dashboard_records
    FOR SELECT
    USING (TRUE);

COMMIT;
