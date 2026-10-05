BEGIN;

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS supabase_auth_user_id UUID UNIQUE;

ALTER TABLE public.users
    ALTER COLUMN email DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS phone TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique
    ON public.users(phone) WHERE phone IS NOT NULL;

ALTER TABLE public.users
    ADD CONSTRAINT users_email_or_phone_required
    CHECK (email IS NOT NULL OR phone IS NOT NULL) NOT VALID;

COMMENT ON COLUMN public.users.supabase_auth_user_id IS
    'Verified Supabase Auth subject; populate only after the server validates its access token.';
COMMENT ON COLUMN public.users.phone IS
    'Verified phone contact; only copy from a Supabase Auth user after server verification.';

COMMIT;