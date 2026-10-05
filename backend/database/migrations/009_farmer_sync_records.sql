BEGIN;

CREATE TABLE IF NOT EXISTS public.sync_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    farm_id UUID NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
    client_draft_id UUID,
    draft_type TEXT NOT NULL,
    version INTEGER,
    payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'pending', 'conflict', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_id, client_draft_id)
);

CREATE TABLE IF NOT EXISTS public.sync_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_id UUID NOT NULL UNIQUE REFERENCES public.sync_drafts(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    farm_id UUID NOT NULL REFERENCES public.farms(id) ON DELETE CASCADE,
    payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_drafts_owner_status
    ON public.sync_drafts(owner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_queue_owner_status
    ON public.sync_queue(owner_id, status, created_at DESC);

ALTER TABLE public.sync_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_queue ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_sync_drafts_updated_at
BEFORE UPDATE ON public.sync_drafts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_sync_queue_updated_at
BEFORE UPDATE ON public.sync_queue
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE public.sync_drafts IS
    'Farmer drafts are private to owner_id and farm_id; service writes enforce both in SQL.';
COMMENT ON TABLE public.sync_queue IS
    'A draft can be queued at most once; service writes enforce verified ownership and farm approval.';

COMMIT;