BEGIN;

-- =============================================================================
-- Migration 014: Admin Workflow Support, Settings, and Account Lifecycles
-- =============================================================================

-- 1. Extend public.users with approval and suspension lifecycle tracking
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved'
        CHECK (approval_status IN ('pending', 'approved', 'rejected', 'suspended')),
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS revocation_reason TEXT,
    ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS suspended_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_approval_status
    ON public.users(approval_status, is_active);

-- 2. Time-limited support access (Break-Glass Protocol)
-- Allows authorized admin staff to access specific sensitive records
-- for customer support or debugging with strict time limits and comprehensive audit logs.
CREATE TABLE IF NOT EXISTS public.support_access_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('farm', 'reading', 'farmer_profile', 'agrodealer_order')),
    target_id TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (char_length(reason) >= 10),
    duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 240),
    expires_at TIMESTAMPTZ NOT NULL,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    revocation_reason TEXT,
    access_count INTEGER NOT NULL DEFAULT 0 CHECK (access_count >= 0),
    last_accessed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_access_admin_active
    ON public.support_access_grants(admin_user_id, expires_at, is_revoked);
CREATE INDEX IF NOT EXISTS idx_support_access_target
    ON public.support_access_grants(target_type, target_id);

ALTER TABLE public.support_access_grants ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.support_access_grants IS
    'Scoped, time-limited break-glass grants for inspecting sensitive records. Every grant and access is logged in admin_audit_log.';

-- RLS: Only admins with support_access permission can view or create support access grants
DROP POLICY IF EXISTS support_access_grants_admin_select ON public.support_access_grants;
CREATE POLICY support_access_grants_admin_select ON public.support_access_grants
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.admin_permissions AS ap
            JOIN public.users AS u ON u.id = ap.admin_user_id
            WHERE u.supabase_auth_user_id = auth.uid()
              AND ap.permission = 'support_access'
              AND ap.is_active = TRUE
        )
    );

DROP POLICY IF EXISTS support_access_grants_admin_insert ON public.support_access_grants;
CREATE POLICY support_access_grants_admin_insert ON public.support_access_grants
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.admin_permissions AS ap
            JOIN public.users AS u ON u.id = ap.admin_user_id
            WHERE u.supabase_auth_user_id = auth.uid()
              AND ap.permission = 'support_access'
              AND ap.is_active = TRUE
        )
    );

DROP POLICY IF EXISTS support_access_grants_admin_update ON public.support_access_grants;
CREATE POLICY support_access_grants_admin_update ON public.support_access_grants
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.admin_permissions AS ap
            JOIN public.users AS u ON u.id = ap.admin_user_id
            WHERE u.supabase_auth_user_id = auth.uid()
              AND ap.permission = 'support_access'
              AND ap.is_active = TRUE
        )
    );

-- 3. System Configuration and Settings
-- Stores validated system-wide configuration parameters with change history and audit logging.
CREATE TABLE IF NOT EXISTS public.system_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    value JSONB NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('security', 'sync', 'recommendations', 'notifications', 'general')),
    description TEXT NOT NULL,
    is_readonly BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_settings_category
    ON public.system_settings(category);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_system_settings_updated_at
BEFORE UPDATE ON public.system_settings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE public.system_settings IS
    'Validated configuration and system settings; updates require manage_settings permission and are auditable.';

-- RLS: Admins can view settings; only admins with manage_settings can update
DROP POLICY IF EXISTS system_settings_admin_select ON public.system_settings;
CREATE POLICY system_settings_admin_select ON public.system_settings
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.users AS u
            WHERE u.supabase_auth_user_id = auth.uid()
              AND u.role = 'admin'
              AND u.is_active = TRUE
        )
    );

DROP POLICY IF EXISTS system_settings_admin_update ON public.system_settings;
CREATE POLICY system_settings_admin_update ON public.system_settings
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM public.admin_permissions AS ap
            JOIN public.users AS u ON u.id = ap.admin_user_id
            WHERE u.supabase_auth_user_id = auth.uid()
              AND ap.permission = 'manage_settings'
              AND ap.is_active = TRUE
        )
    );

-- Seed initial standard system settings
INSERT INTO public.system_settings (key, value, category, description, is_readonly)
VALUES
    (
        'security.support_access_max_duration_minutes',
        '120'::JSONB,
        'security',
        'Maximum allowed duration in minutes for time-limited support access grants.',
        FALSE
    ),
    (
        'security.session_idle_timeout_minutes',
        '60'::JSONB,
        'security',
        'Client session idle timeout threshold in minutes.',
        FALSE
    ),
    (
        'sync.max_batch_size',
        '50'::JSONB,
        'sync',
        'Maximum number of soil reading drafts processed per sync batch.',
        FALSE
    ),
    (
        'sync.retry_interval_seconds',
        '300'::JSONB,
        'sync',
        'Delay in seconds before automatic retry of failed background syncs.',
        FALSE
    ),
    (
        'recommendations.strict_confidence_threshold',
        '0.70'::JSONB,
        'recommendations',
        'Minimum confidence score required for automated fertilizer recommendation suggestions.',
        FALSE
    ),
    (
        'notifications.sms_gateway_enabled',
        'false'::JSONB,
        'notifications',
        'Feature flag enabling outbound SMS notifications for high-priority weather/pest alerts.',
        FALSE
    ),
    (
        'general.maintenance_mode',
        'false'::JSONB,
        'general',
        'Global system maintenance flag; when enabled, non-admin mutations are paused.',
        FALSE
    )
ON CONFLICT (key) DO NOTHING;

COMMIT;
