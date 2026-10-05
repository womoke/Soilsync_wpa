-- Migration 019: authorize dealer-profile administration through active user_roles.

BEGIN;

DROP POLICY IF EXISTS agrodealer_profiles_select_own ON public.agrodealer_profiles;
CREATE POLICY agrodealer_profiles_select_own ON public.agrodealer_profiles
    FOR SELECT
    USING (
        user_id IN (
            SELECT id FROM public.users
            WHERE supabase_auth_user_id = auth.uid()
        )
        OR is_demo = TRUE
        OR public.is_admin()
    );

COMMIT;
