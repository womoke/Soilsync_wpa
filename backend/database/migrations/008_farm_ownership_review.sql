BEGIN;

ALTER TABLE public.farms
    ADD COLUMN IF NOT EXISTS owner_verified BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.farms.owner_verified IS
    'Set only after the farm ownership review; farmer reading mutations require this approval.';

COMMIT;