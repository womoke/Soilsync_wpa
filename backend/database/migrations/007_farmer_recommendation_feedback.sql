BEGIN;

CREATE TABLE IF NOT EXISTS public.recommendation_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    recommendation_id UUID NOT NULL REFERENCES public.recommendations(id) ON DELETE CASCADE,
    response TEXT NOT NULL CHECK (response IN ('viewed', 'followed', 'modified', 'not-followed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recommendation_feedback_user_created
    ON public.recommendation_feedback(user_id, created_at DESC);

ALTER TABLE public.recommendation_feedback ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.recommendation_feedback IS
    'Append-only farmer feedback events; server writes must verify ownership of the linked recommendation.';

COMMIT;