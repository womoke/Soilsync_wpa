BEGIN;

REVOKE UPDATE ON TABLE public.profiles FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.profiles IS
    'User profiles keyed by Supabase Auth user ID. Editable contact fields are changed through the authenticated backend; location fields remain server-managed.';

COMMIT;
