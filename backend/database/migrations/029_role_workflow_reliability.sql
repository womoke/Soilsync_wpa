BEGIN;

ALTER TABLE public.users
    DROP CONSTRAINT IF EXISTS users_approval_status_check;

ALTER TABLE public.users
    ADD CONSTRAINT users_approval_status_check
    CHECK (approval_status IN ('pending', 'approved', 'rejected', 'suspended', 'unclaimed'));

CREATE TEMP TABLE requested_visit_deduplication ON COMMIT DROP AS
SELECT id,
       FIRST_VALUE(id) OVER (
           PARTITION BY farm_id
           ORDER BY created_at, id
       ) AS retained_id,
       ROW_NUMBER() OVER (
           PARTITION BY farm_id
           ORDER BY created_at, id
       ) AS duplicate_number
FROM public.officer_visits
WHERE status = 'requested'
  AND farm_id IS NOT NULL;

UPDATE public.soil_readings AS reading
SET visit_id = duplicate.retained_id
FROM requested_visit_deduplication AS duplicate
WHERE reading.visit_id = duplicate.id
  AND duplicate.duplicate_number > 1;

UPDATE public.agronomic_assessments AS assessment
SET visit_id = duplicate.retained_id
FROM requested_visit_deduplication AS duplicate
WHERE assessment.visit_id = duplicate.id
  AND duplicate.duplicate_number > 1;

DELETE FROM public.officer_visits AS visit
USING requested_visit_deduplication AS duplicate
WHERE visit.id = duplicate.id
  AND duplicate.duplicate_number > 1;

DROP INDEX IF EXISTS public.idx_officer_visits_pool;

CREATE UNIQUE INDEX idx_officer_visits_pool
    ON public.officer_visits(farm_id)
    WHERE status = 'requested';

UPDATE public.users AS app_user
SET approval_status = agronomist.approval_status,
    approved_by = agronomist.approved_by,
    approved_at = agronomist.approved_at
FROM public.agronomist_profiles AS agronomist
WHERE app_user.id = agronomist.user_id
  AND app_user.role = 'agronomist';

UPDATE public.user_roles AS role
SET status = CASE
        WHEN agronomist.approval_status = 'suspended' THEN 'suspended'
        WHEN invitation.status = 'active'
             AND agronomist.approval_status = 'approved' THEN 'active'
        ELSE 'pending'
    END,
    approved_at = CASE
        WHEN invitation.status = 'active'
             AND agronomist.approval_status = 'approved' THEN agronomist.approved_at
        ELSE NULL
    END,
    updated_at = NOW()
FROM public.users AS app_user
JOIN public.agronomist_profiles AS agronomist
  ON agronomist.user_id = app_user.id
LEFT JOIN public.account_invitations AS invitation
  ON invitation.auth_user_id = app_user.supabase_auth_user_id
WHERE role.user_id = app_user.supabase_auth_user_id
  AND role.role = 'agronomist';

CREATE TABLE public.unclaimed_auth_cleanup_queue (
    auth_user_id UUID PRIMARY KEY,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_attempt_at TIMESTAMPTZ,
    last_error TEXT
);

ALTER TABLE public.unclaimed_auth_cleanup_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.unclaimed_auth_cleanup_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.unclaimed_auth_cleanup_queue TO service_role;

COMMIT;
