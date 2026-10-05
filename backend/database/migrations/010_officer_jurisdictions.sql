BEGIN;

ALTER TABLE public.farms
    ADD COLUMN IF NOT EXISTS sub_county TEXT;

CREATE TABLE IF NOT EXISTS public.officer_jurisdictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    officer_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    county TEXT,
    sub_county TEXT,
    ward TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    assigned_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (county IS NOT NULL OR sub_county IS NOT NULL OR ward IS NOT NULL),
    CHECK (sub_county IS NULL OR county IS NOT NULL),
    CHECK (ward IS NULL OR sub_county IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_officer_jurisdictions_scope_unique
    ON public.officer_jurisdictions (
        officer_user_id,
        COALESCE(county, ''),
        COALESCE(sub_county, ''),
        COALESCE(ward, '')
    );
CREATE INDEX IF NOT EXISTS idx_officer_jurisdictions_active
    ON public.officer_jurisdictions(officer_user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_farms_sub_county
    ON public.farms(county, sub_county, ward);

ALTER TABLE public.officer_jurisdictions ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_officer_jurisdictions_updated_at
BEFORE UPDATE ON public.officer_jurisdictions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE public.officer_jurisdictions IS
    'Server-managed extension-officer scopes; officer roster queries must match every non-null assignment dimension.';
COMMENT ON COLUMN public.farms.sub_county IS
    'Administrative sub-county used for jurisdiction matching; do not infer from county or ward labels.';

COMMIT;