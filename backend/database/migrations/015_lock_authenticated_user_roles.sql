BEGIN;

CREATE OR REPLACE FUNCTION public.is_active_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users AS admin_user
        WHERE admin_user.supabase_auth_user_id = auth.uid()
          AND admin_user.role = 'admin'
          AND admin_user.is_active = TRUE
    );
$$;

REVOKE ALL ON FUNCTION public.is_active_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_admin() TO authenticated;

DROP POLICY IF EXISTS users_select_own ON public.users;
CREATE POLICY users_select_own ON public.users
    FOR SELECT
    USING (
        supabase_auth_user_id = auth.uid()
        OR public.is_active_admin()
    );

DROP POLICY IF EXISTS users_update_own ON public.users;
CREATE POLICY users_update_own ON public.users
    FOR UPDATE
    USING (supabase_auth_user_id = auth.uid())
    WITH CHECK (supabase_auth_user_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON TABLE public.users FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.users TO authenticated;
GRANT UPDATE (display_name) ON TABLE public.users TO authenticated;

COMMENT ON COLUMN public.users.role IS
    'Server-managed authorization role. Authenticated clients cannot insert or update this column.';

COMMIT;
