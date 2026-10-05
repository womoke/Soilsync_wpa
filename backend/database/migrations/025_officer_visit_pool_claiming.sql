-- Migration 025: Extension Officer Visit Pool & Atomic Farm Claiming
BEGIN;

-- Allow visits in the pool to be unassigned (officer_user_id NULL) and planned_date NULL until scheduled
ALTER TABLE public.officer_visits
    ALTER COLUMN officer_user_id DROP NOT NULL,
    ALTER COLUMN planned_date DROP NOT NULL;

-- Expand status check constraint to support pool workflow: requested -> claimed -> scheduled -> in_progress -> completed / cancelled
ALTER TABLE public.officer_visits
    DROP CONSTRAINT IF EXISTS officer_visits_status_check;

ALTER TABLE public.officer_visits
    ADD CONSTRAINT officer_visits_status_check
    CHECK (status IN ('requested', 'claimed', 'scheduled', 'in_progress', 'completed', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_officer_visits_pool
    ON public.officer_visits(farm_id, status)
    WHERE status = 'requested';

COMMIT;
