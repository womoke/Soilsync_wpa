BEGIN;

CREATE TABLE IF NOT EXISTS public.account_invitations (
    auth_user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('extension-officer', 'agrodealer')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'cancelled')),
    invited_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at TIMESTAMPTZ
);

ALTER TABLE public.account_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_invitations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.account_invitations TO service_role;

COMMENT ON TABLE public.account_invitations IS
    'Admin-provisioned extension-officer and agrodealer accounts; invitations stay pending until the recipient sets a password.';

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

    IF EXISTS (
        SELECT 1
        FROM public.account_invitations AS invitation
        WHERE invitation.auth_user_id = NEW.id
          AND invitation.status IN ('pending', 'active')
    ) THEN
        IF v_profile_rows > 0 THEN
            INSERT INTO public.audit_log (actor_id, action, target_type, target_id, details)
            VALUES (
                NEW.id,
                'invited_user_profile_created',
                'user',
                NEW.id::TEXT,
                jsonb_build_object('assigned_role', 'admin_provisioned')
            );
        END IF;
        RETURN NEW;
    END IF;

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
    'Creates a farmer role for self-registrations; admin-provisioned staff/dealer invitations do not receive farmer access.';

COMMIT;
