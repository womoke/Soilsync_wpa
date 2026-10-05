-- Migration 026: Officer Field Collection & Farm Attributes
-- Enables officer-only coordinate capture, soil collection provenance, farm size/crop metadata, and incomplete lifecycle tracking.

BEGIN;

ALTER TABLE farms
    ADD COLUMN IF NOT EXISTS size_acres NUMERIC(8, 2),
    ADD COLUMN IF NOT EXISTS crops TEXT,
    ADD COLUMN IF NOT EXISTS coordinates_captured_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS coordinates_captured_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS soil_data_collected BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE soil_readings
    ADD COLUMN IF NOT EXISTS officer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS visit_id UUID REFERENCES officer_visits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_farms_coordinates_captured_by ON farms (coordinates_captured_by);
CREATE INDEX IF NOT EXISTS idx_soil_readings_visit_id ON soil_readings (visit_id);
CREATE INDEX IF NOT EXISTS idx_soil_readings_officer_user_id ON soil_readings (officer_user_id);

COMMIT;
