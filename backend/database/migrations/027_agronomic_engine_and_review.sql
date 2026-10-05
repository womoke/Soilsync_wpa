-- Migration 027: Multi-Tiered Agronomic Assessments & Review Workflow
BEGIN;

CREATE TABLE IF NOT EXISTS agronomic_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    farm_id UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    soil_reading_id UUID NOT NULL REFERENCES soil_readings(id) ON DELETE CASCADE,
    visit_id UUID REFERENCES officer_visits(id) ON DELETE SET NULL,
    officer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    claiming_agronomist_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'verified', 'flagged')),
    review_stage TEXT NOT NULL DEFAULT 'generated' CHECK (review_stage IN ('generated', 'review_requested', 'claimed', 'under_review', 'published')),
    county TEXT NOT NULL,
    sub_county TEXT,
    ward TEXT,
    crop TEXT NOT NULL DEFAULT 'maize',
    engine_version TEXT NOT NULL DEFAULT 'kalro-rules-v2.1',
    engine_baseline JSONB NOT NULL DEFAULT '{}'::jsonb,
    officer_edits JSONB NOT NULL DEFAULT '[]'::jsonb,
    agronomist_edits JSONB NOT NULL DEFAULT '[]'::jsonb,
    verified_report JSONB,
    claimed_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    published_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessments_farm_id ON agronomic_assessments(farm_id);
CREATE INDEX IF NOT EXISTS idx_assessments_reading_id ON agronomic_assessments(soil_reading_id);
CREATE INDEX IF NOT EXISTS idx_assessments_status_county ON agronomic_assessments(status, county);
CREATE INDEX IF NOT EXISTS idx_assessments_claiming_agronomist ON agronomic_assessments(claiming_agronomist_id);
CREATE INDEX IF NOT EXISTS idx_assessments_officer_user ON agronomic_assessments(officer_user_id);

COMMIT;
