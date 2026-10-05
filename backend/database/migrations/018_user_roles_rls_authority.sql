-- Migration 018: make active user_roles authoritative in role-sensitive RLS.
-- public.users remains the legacy application profile and identity mapping.

BEGIN;

DROP POLICY IF EXISTS users_select_own ON public.users;
CREATE POLICY users_select_own ON public.users
    FOR SELECT
    USING (
        supabase_auth_user_id = auth.uid()
        OR public.is_admin()
    );

DROP POLICY IF EXISTS farms_select_owner ON public.farms;
CREATE POLICY farms_select_owner ON public.farms
    FOR SELECT
    USING (
        owner_id IN (
            SELECT id FROM public.users
            WHERE supabase_auth_user_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1
            FROM public.officer_jurisdictions AS oj
            JOIN public.users AS officer ON officer.id = oj.officer_user_id
            WHERE officer.supabase_auth_user_id = auth.uid()
              AND public.has_active_role(auth.uid(), 'extension-officer')
              AND oj.is_active = TRUE
              AND (oj.county IS NULL OR farms.county = oj.county)
              AND (oj.sub_county IS NULL OR farms.sub_county = oj.sub_county)
              AND (oj.ward IS NULL OR farms.ward = oj.ward)
        )
        OR public.is_admin()
    );

DROP POLICY IF EXISTS farms_insert_owner ON public.farms;
CREATE POLICY farms_insert_owner ON public.farms
    FOR INSERT
    WITH CHECK (
        owner_id IN (
            SELECT id FROM public.users
            WHERE supabase_auth_user_id = auth.uid()
        )
        AND public.has_active_role(auth.uid(), 'farmer')
    );

DROP POLICY IF EXISTS soil_readings_select_owner ON public.soil_readings;
CREATE POLICY soil_readings_select_owner ON public.soil_readings
    FOR SELECT
    USING (
        farm_id IN (
            SELECT f.id
            FROM public.farms AS f
            JOIN public.users AS u ON u.id = f.owner_id
            WHERE u.supabase_auth_user_id = auth.uid()
        )
        OR farm_id IN (
            SELECT f.id
            FROM public.farms AS f
            JOIN public.officer_jurisdictions AS oj
              ON (oj.county IS NULL OR f.county = oj.county)
             AND (oj.sub_county IS NULL OR f.sub_county = oj.sub_county)
             AND (oj.ward IS NULL OR f.ward = oj.ward)
            JOIN public.users AS officer ON officer.id = oj.officer_user_id
            WHERE officer.supabase_auth_user_id = auth.uid()
              AND public.has_active_role(auth.uid(), 'extension-officer')
              AND oj.is_active = TRUE
        )
    );

DROP POLICY IF EXISTS soil_readings_insert_owner ON public.soil_readings;
CREATE POLICY soil_readings_insert_owner ON public.soil_readings
    FOR INSERT
    WITH CHECK (
        farm_id IN (
            SELECT f.id
            FROM public.farms AS f
            JOIN public.users AS u ON u.id = f.owner_id
            WHERE u.supabase_auth_user_id = auth.uid()
              AND public.has_active_role(auth.uid(), 'farmer')
              AND f.owner_verified = TRUE
        )
    );

DROP POLICY IF EXISTS dealer_products_insert_own ON public.dealer_products;
CREATE POLICY dealer_products_insert_own ON public.dealer_products
    FOR INSERT
    WITH CHECK (
        dealer_id IN (
            SELECT ap.id
            FROM public.agrodealer_profiles AS ap
            JOIN public.users AS u ON u.id = ap.user_id
            WHERE u.supabase_auth_user_id = auth.uid()
              AND public.has_active_role(auth.uid(), 'agrodealer')
        )
    );

DROP POLICY IF EXISTS officer_jurisdictions_select_own ON public.officer_jurisdictions;
CREATE POLICY officer_jurisdictions_select_own ON public.officer_jurisdictions
    FOR SELECT
    USING (
        officer_user_id IN (
            SELECT id FROM public.users
            WHERE supabase_auth_user_id = auth.uid()
        )
        OR public.is_admin()
    );

DROP POLICY IF EXISTS admin_permissions_select ON public.admin_permissions;
CREATE POLICY admin_permissions_select ON public.admin_permissions
    FOR SELECT
    USING (
        admin_user_id IN (
            SELECT id FROM public.users
            WHERE supabase_auth_user_id = auth.uid()
        )
        OR public.is_admin()
    );

DROP POLICY IF EXISTS admin_audit_log_select ON public.admin_audit_log;
CREATE POLICY admin_audit_log_select ON public.admin_audit_log
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.admin_permissions AS ap
            JOIN public.users AS u ON u.id = ap.admin_user_id
            WHERE u.supabase_auth_user_id = auth.uid()
              AND public.has_active_role(auth.uid(), 'admin')
              AND ap.permission = 'view_audit_log'
              AND ap.is_active = TRUE
              AND (ap.expires_at IS NULL OR ap.expires_at > NOW())
        )
    );

DROP POLICY IF EXISTS officer_visits_select ON public.officer_visits;
CREATE POLICY officer_visits_select ON public.officer_visits
    FOR SELECT
    USING (
        (
            officer_user_id IN (
                SELECT id FROM public.users
                WHERE supabase_auth_user_id = auth.uid()
            )
            AND public.has_active_role(auth.uid(), 'extension-officer')
        )
        OR EXISTS (
            SELECT 1
            FROM public.farms AS f
            JOIN public.officer_jurisdictions AS oj
              ON (oj.county IS NULL OR f.county = oj.county)
             AND (oj.sub_county IS NULL OR f.sub_county = oj.sub_county)
             AND (oj.ward IS NULL OR f.ward = oj.ward)
            JOIN public.users AS officer ON officer.id = oj.officer_user_id
            WHERE officer.supabase_auth_user_id = auth.uid()
              AND public.has_active_role(auth.uid(), 'extension-officer')
              AND oj.is_active = TRUE
              AND (f.owner_id = officer_visits.farmer_id OR f.id = officer_visits.farm_id)
        )
    );

DROP POLICY IF EXISTS officer_visits_insert ON public.officer_visits;
CREATE POLICY officer_visits_insert ON public.officer_visits
    FOR INSERT
    WITH CHECK (
        officer_user_id IN (
            SELECT id FROM public.users
            WHERE supabase_auth_user_id = auth.uid()
        )
        AND public.has_active_role(auth.uid(), 'extension-officer')
        AND EXISTS (
            SELECT 1
            FROM public.farms AS f
            JOIN public.officer_jurisdictions AS oj
              ON (oj.county IS NULL OR f.county = oj.county)
             AND (oj.sub_county IS NULL OR f.sub_county = oj.sub_county)
             AND (oj.ward IS NULL OR f.ward = oj.ward)
            JOIN public.users AS officer ON officer.id = oj.officer_user_id
            WHERE officer.supabase_auth_user_id = auth.uid()
              AND public.has_active_role(auth.uid(), 'extension-officer')
              AND oj.is_active = TRUE
              AND (f.owner_id = officer_visits.farmer_id OR f.id = officer_visits.farm_id)
        )
    );

DROP POLICY IF EXISTS officer_visits_update ON public.officer_visits;
CREATE POLICY officer_visits_update ON public.officer_visits
    FOR UPDATE
    USING (
        officer_user_id IN (
            SELECT id FROM public.users
            WHERE supabase_auth_user_id = auth.uid()
        )
        AND public.has_active_role(auth.uid(), 'extension-officer')
    )
    WITH CHECK (
        officer_user_id IN (
            SELECT id FROM public.users
            WHERE supabase_auth_user_id = auth.uid()
        )
        AND public.has_active_role(auth.uid(), 'extension-officer')
    );

DROP POLICY IF EXISTS officer_alerts_select ON public.officer_alerts;
CREATE POLICY officer_alerts_select ON public.officer_alerts
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.farms AS f
            JOIN public.officer_jurisdictions AS oj
              ON (oj.county IS NULL OR f.county = oj.county)
             AND (oj.sub_county IS NULL OR f.sub_county = oj.sub_county)
             AND (oj.ward IS NULL OR f.ward = oj.ward)
            JOIN public.users AS officer ON officer.id = oj.officer_user_id
            WHERE officer.supabase_auth_user_id = auth.uid()
              AND public.has_active_role(auth.uid(), 'extension-officer')
              AND oj.is_active = TRUE
              AND (f.owner_id = officer_alerts.farmer_id OR f.id = officer_alerts.farm_id)
        )
    );

DROP POLICY IF EXISTS officer_alerts_update ON public.officer_alerts;
CREATE POLICY officer_alerts_update ON public.officer_alerts
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1
            FROM public.farms AS f
            JOIN public.officer_jurisdictions AS oj
              ON (oj.county IS NULL OR f.county = oj.county)
             AND (oj.sub_county IS NULL OR f.sub_county = oj.sub_county)
             AND (oj.ward IS NULL OR f.ward = oj.ward)
            JOIN public.users AS officer ON officer.id = oj.officer_user_id
            WHERE officer.supabase_auth_user_id = auth.uid()
              AND public.has_active_role(auth.uid(), 'extension-officer')
              AND oj.is_active = TRUE
              AND (f.owner_id = officer_alerts.farmer_id OR f.id = officer_alerts.farm_id)
        )
    );

DROP POLICY IF EXISTS marketplace_orders_dealer_select ON public.marketplace_orders;
CREATE POLICY marketplace_orders_dealer_select ON public.marketplace_orders
    FOR SELECT
    USING (
        dealer_id IN (
            SELECT ap.id
            FROM public.agrodealer_profiles AS ap
            JOIN public.users AS u ON u.id = ap.user_id
            WHERE u.supabase_auth_user_id = auth.uid()
              AND public.has_active_role(auth.uid(), 'agrodealer')
        )
        OR buyer_user_id IN (
            SELECT id FROM public.users
            WHERE supabase_auth_user_id = auth.uid()
        )
        OR public.is_admin()
    );

DROP POLICY IF EXISTS system_settings_admin_select ON public.system_settings;
CREATE POLICY system_settings_admin_select ON public.system_settings
    FOR SELECT
    USING (public.is_admin());

COMMIT;
