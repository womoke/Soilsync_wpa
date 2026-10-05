BEGIN;

-- =============================================================================
-- Extension Officer Visits: Database-backed visit records
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.officer_visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    officer_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    farmer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    farm_id UUID REFERENCES public.farms(id) ON DELETE SET NULL,
    planned_date TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_officer_visits_officer
    ON public.officer_visits(officer_user_id, planned_date DESC);
CREATE INDEX IF NOT EXISTS idx_officer_visits_farmer
    ON public.officer_visits(farmer_id);
CREATE INDEX IF NOT EXISTS idx_officer_visits_status
    ON public.officer_visits(status);

ALTER TABLE public.officer_visits ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_officer_visits_updated_at
BEFORE UPDATE ON public.officer_visits
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- Extension Officer Alerts: Database-backed soil and farm alerts
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.officer_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    officer_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    farmer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    farm_id UUID REFERENCES public.farms(id) ON DELETE SET NULL,
    source TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info'
        CHECK (severity IN ('info', 'warning', 'critical')),
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'acknowledged', 'resolved')),
    title TEXT NOT NULL,
    summary TEXT,
    notes TEXT,
    resolution_notes TEXT,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_officer_alerts_officer
    ON public.officer_alerts(officer_user_id, status);
CREATE INDEX IF NOT EXISTS idx_officer_alerts_farmer
    ON public.officer_alerts(farmer_id);
CREATE INDEX IF NOT EXISTS idx_officer_alerts_status_severity
    ON public.officer_alerts(status, severity);

ALTER TABLE public.officer_alerts ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_officer_alerts_updated_at
BEFORE UPDATE ON public.officer_alerts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- RLS Policies for Visits & Alerts
-- =============================================================================

-- Officers can view visits for farms in their jurisdiction or assigned to them
DROP POLICY IF EXISTS officer_visits_select ON public.officer_visits;
CREATE POLICY officer_visits_select ON public.officer_visits
    FOR SELECT
    USING (
        officer_user_id IN (
            SELECT id FROM public.users WHERE supabase_auth_user_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.farms AS f
            JOIN public.officer_jurisdictions AS oj
              ON (oj.county IS NULL OR f.county = oj.county)
             AND (oj.sub_county IS NULL OR f.sub_county = oj.sub_county)
             AND (oj.ward IS NULL OR f.ward = oj.ward)
            JOIN public.users AS officer ON officer.id = oj.officer_user_id
            WHERE officer.supabase_auth_user_id = auth.uid()
              AND officer.role = 'extension_officer'
              AND officer.is_active = TRUE
              AND oj.is_active = TRUE
              AND (f.owner_id = officer_visits.farmer_id OR f.id = officer_visits.farm_id)
        )
    );

-- Officers can insert visits for farmers in their jurisdiction
DROP POLICY IF EXISTS officer_visits_insert ON public.officer_visits;
CREATE POLICY officer_visits_insert ON public.officer_visits
    FOR INSERT
    WITH CHECK (
        officer_user_id IN (
            SELECT id FROM public.users
            WHERE supabase_auth_user_id = auth.uid()
              AND role = 'extension_officer'
              AND is_active = TRUE
        )
        AND EXISTS (
            SELECT 1 FROM public.farms AS f
            JOIN public.officer_jurisdictions AS oj
              ON (oj.county IS NULL OR f.county = oj.county)
             AND (oj.sub_county IS NULL OR f.sub_county = oj.sub_county)
             AND (oj.ward IS NULL OR f.ward = oj.ward)
            JOIN public.users AS officer ON officer.id = oj.officer_user_id
            WHERE officer.supabase_auth_user_id = auth.uid()
              AND officer.role = 'extension_officer'
              AND officer.is_active = TRUE
              AND oj.is_active = TRUE
              AND (f.owner_id = officer_visits.farmer_id OR f.id = officer_visits.farm_id)
        )
    );

-- Officers can update visits assigned to them
DROP POLICY IF EXISTS officer_visits_update ON public.officer_visits;
CREATE POLICY officer_visits_update ON public.officer_visits
    FOR UPDATE
    USING (
        officer_user_id IN (
            SELECT id FROM public.users
            WHERE supabase_auth_user_id = auth.uid()
              AND role = 'extension_officer'
              AND is_active = TRUE
        )
    )
    WITH CHECK (
        officer_user_id IN (
            SELECT id FROM public.users
            WHERE supabase_auth_user_id = auth.uid()
        )
    );

-- Officers can view alerts in their jurisdiction
DROP POLICY IF EXISTS officer_alerts_select ON public.officer_alerts;
CREATE POLICY officer_alerts_select ON public.officer_alerts
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.farms AS f
            JOIN public.officer_jurisdictions AS oj
              ON (oj.county IS NULL OR f.county = oj.county)
             AND (oj.sub_county IS NULL OR f.sub_county = oj.sub_county)
             AND (oj.ward IS NULL OR f.ward = oj.ward)
            JOIN public.users AS officer ON officer.id = oj.officer_user_id
            WHERE officer.supabase_auth_user_id = auth.uid()
              AND officer.role = 'extension_officer'
              AND officer.is_active = TRUE
              AND oj.is_active = TRUE
              AND (f.owner_id = officer_alerts.farmer_id OR f.id = officer_alerts.farm_id)
        )
    );

-- Officers can update alerts in their jurisdiction
DROP POLICY IF EXISTS officer_alerts_update ON public.officer_alerts;
CREATE POLICY officer_alerts_update ON public.officer_alerts
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.farms AS f
            JOIN public.officer_jurisdictions AS oj
              ON (oj.county IS NULL OR f.county = oj.county)
             AND (oj.sub_county IS NULL OR f.sub_county = oj.sub_county)
             AND (oj.ward IS NULL OR f.ward = oj.ward)
            JOIN public.users AS officer ON officer.id = oj.officer_user_id
            WHERE officer.supabase_auth_user_id = auth.uid()
              AND officer.role = 'extension_officer'
              AND officer.is_active = TRUE
              AND oj.is_active = TRUE
              AND (f.owner_id = officer_alerts.farmer_id OR f.id = officer_alerts.farm_id)
        )
    );

-- =============================================================================
-- Privacy Minimization Documentation
-- =============================================================================

COMMENT ON TABLE public.officer_visits IS
    'Extension officer farm visits. Scoped to assigned administrative jurisdictions. Minimized PII: excludes phone numbers and national IDs.';
COMMENT ON TABLE public.officer_alerts IS
    'Soil health and agronomic alerts for extension officers. Scoped strictly by jurisdiction; excludes exact GPS coordinates and contact PII.';

COMMIT;
