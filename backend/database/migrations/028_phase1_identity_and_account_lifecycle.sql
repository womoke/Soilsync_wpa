-- Migration 028: Phase 1 - Identity, Agronomist Role, and Unclaimed Farmer Lifecycle
BEGIN;

-- 1. Extend user_roles constraints for 'agronomist' role and 'unclaimed' status
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_role_check
    CHECK (role IN ('farmer', 'extension-officer', 'agrodealer', 'admin', 'agronomist'));

ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_status_check;
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_status_check
    CHECK (status IN ('pending', 'active', 'suspended', 'unclaimed'));

-- 2. Extend account_invitations role check for 'agronomist' and 'farmer'
ALTER TABLE public.account_invitations DROP CONSTRAINT IF EXISTS account_invitations_role_check;
ALTER TABLE public.account_invitations ADD CONSTRAINT account_invitations_role_check
    CHECK (role IN ('extension-officer', 'agrodealer', 'agronomist', 'farmer'));

-- 3. Create agronomist_profiles table
CREATE TABLE IF NOT EXISTS public.agronomist_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    licence_number TEXT,
    county TEXT,
    approval_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (approval_status IN ('pending', 'approved', 'rejected', 'suspended')),
    approved_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_agronomist_profiles_status
    ON public.agronomist_profiles(approval_status, county);

ALTER TABLE public.agronomist_profiles ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.agronomist_profiles TO service_role;
GRANT SELECT ON TABLE public.agronomist_profiles TO authenticated;

-- 4. Create unclaimed_farmer_accounts table
CREATE TABLE IF NOT EXISTS public.unclaimed_farmer_accounts (
    auth_user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    farmer_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    officer_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    initial_farm_id UUID REFERENCES public.farms(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'unclaimed'
        CHECK (status IN ('unclaimed', 'claimed', 'expired_deleted')),
    reminder_count INT NOT NULL DEFAULT 0 CHECK (reminder_count BETWEEN 0 AND 6),
    last_reminder_at TIMESTAMPTZ,
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unclaimed_farmer_status
    ON public.unclaimed_farmer_accounts(status, created_at);
CREATE INDEX IF NOT EXISTS idx_unclaimed_farmer_officer
    ON public.unclaimed_farmer_accounts(officer_user_id);

ALTER TABLE public.unclaimed_farmer_accounts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.unclaimed_farmer_accounts TO service_role;
GRANT SELECT ON TABLE public.unclaimed_farmer_accounts TO authenticated;

-- 5. In-app notifications table for durable notification and reminder tracking
CREATE TABLE IF NOT EXISTS public.in_app_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    notification_type TEXT NOT NULL DEFAULT 'general',
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_in_app_notifications_user
    ON public.in_app_notifications(user_id, is_read, created_at);

ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.in_app_notifications TO service_role;
GRANT SELECT, UPDATE ON TABLE public.in_app_notifications TO authenticated;

-- 6. Update handle_new_auth_user() to support agronomist and unclaimed farmer
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_full_name TEXT;
    v_profile_rows INTEGER;
    v_invitation RECORD;
BEGIN
    v_full_name := COALESCE(
        NEW.raw_user_meta_data->>'full_name',
        NEW.raw_user_meta_data->>'display_name'
    );

    INSERT INTO public.profiles (id, full_name, created_at, updated_at)
    VALUES (NEW.id, v_full_name, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS v_profile_rows = ROW_COUNT;

    SELECT * INTO v_invitation
    FROM public.account_invitations AS invitation
    WHERE invitation.auth_user_id = NEW.id
      AND invitation.status IN ('pending', 'active')
    LIMIT 1;

    IF FOUND THEN
        IF v_invitation.role = 'farmer' THEN
            -- Officer-registered farmer: status is unclaimed until claimed
            INSERT INTO public.user_roles (user_id, role, status, created_at, updated_at)
            VALUES (NEW.id, 'farmer', 'unclaimed', NOW(), NOW())
            ON CONFLICT (user_id, role) DO UPDATE SET status = 'unclaimed';
        ELSE
            -- Officer, Dealer, Agronomist: provisioned role, not farmer
            INSERT INTO public.user_roles (user_id, role, status, created_at, updated_at)
            VALUES (NEW.id, v_invitation.role, 'pending', NOW(), NOW())
            ON CONFLICT (user_id, role) DO NOTHING;
        END IF;

        IF v_profile_rows > 0 THEN
            INSERT INTO public.audit_log (actor_id, action, target_type, target_id, details)
            VALUES (
                NEW.id,
                'invited_user_profile_created',
                'user',
                NEW.id::TEXT,
                jsonb_build_object('assigned_role', v_invitation.role)
            );
        END IF;
        RETURN NEW;
    END IF;

    -- Self-registration defaults to active farmer
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

COMMIT;
