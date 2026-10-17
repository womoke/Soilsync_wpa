BEGIN;

ALTER TABLE public.soil_readings
    ADD COLUMN IF NOT EXISTS excluded_reason TEXT,
    ADD COLUMN IF NOT EXISTS excluded_at TIMESTAMPTZ;

WITH retired_readings AS (
    SELECT readings.id,
           CASE
               WHEN readings.reading_source = 'DEMO_SEED'
                   OR readings.source_provider = 'DEMO'
                   THEN 'DEMO'
               WHEN readings.reading_source IN (
                   'PROJECT_SOIL_DATASET',
                   'ISRIC_WOSIS',
                   'ISRIC_SOILGRIDS'
               )
                   THEN readings.reading_source
               WHEN readings.source_provider IN (
                   'PROJECT_SOIL_DATASET',
                   'ISRIC_WOSIS',
                   'ISRIC_SOILGRIDS'
               )
                   THEN readings.source_provider
               WHEN datasets.provider_name IN (
                   'PROJECT_SOIL_DATASET',
                   'ISRIC_WOSIS',
                   'ISRIC_SOILGRIDS'
               )
                   THEN datasets.provider_name
               WHEN datasets.dataset_key IN (
                   'PROJECT_SOIL_DATASET',
                   'ISRIC_WOSIS',
                   'ISRIC_SOILGRIDS'
               )
                   THEN datasets.dataset_key
               WHEN batch_datasets.provider_name IN (
                   'PROJECT_SOIL_DATASET',
                   'ISRIC_WOSIS',
                   'ISRIC_SOILGRIDS'
               )
                   THEN batch_datasets.provider_name
               WHEN batch_datasets.dataset_key IN (
                   'PROJECT_SOIL_DATASET',
                   'ISRIC_WOSIS',
                   'ISRIC_SOILGRIDS'
               )
                   THEN batch_datasets.dataset_key
               WHEN provenance.provider_name IN (
                   'PROJECT_SOIL_DATASET',
                   'ISRIC_WOSIS',
                   'ISRIC_SOILGRIDS'
               )
                   THEN provenance.provider_name
               WHEN provenance.dataset_id IN (
                   'PROJECT_SOIL_DATASET',
                   'ISRIC_WOSIS',
                   'ISRIC_SOILGRIDS'
               )
                   THEN provenance.dataset_id
               WHEN provenance_datasets.provider_name IN (
                   'PROJECT_SOIL_DATASET',
                   'ISRIC_WOSIS',
                   'ISRIC_SOILGRIDS'
               )
                   THEN provenance_datasets.provider_name
               WHEN provenance_datasets.dataset_key IN (
                   'PROJECT_SOIL_DATASET',
                   'ISRIC_WOSIS',
                   'ISRIC_SOILGRIDS'
               )
                   THEN provenance_datasets.dataset_key
               WHEN readings.source_dataset_id IN (
                   'PROJECT_SOIL_DATASET',
                   'ISRIC_WOSIS',
                   'ISRIC_SOILGRIDS'
               )
                   THEN readings.source_dataset_id
               ELSE 'RETIRED_SOURCE_METADATA'
           END AS retired_provider
    FROM public.soil_readings AS readings
    LEFT JOIN public.source_datasets AS datasets
      ON datasets.id = readings.dataset_id
    LEFT JOIN public.source_import_batches AS batches
      ON batches.id = readings.import_batch_id
    LEFT JOIN public.source_datasets AS batch_datasets
      ON batch_datasets.id = batches.dataset_id
    LEFT JOIN public.source_provenance AS provenance
      ON provenance.id = readings.provenance_id
    LEFT JOIN public.source_datasets AS provenance_datasets
      ON provenance_datasets.id = provenance.source_dataset_ref_id
    WHERE readings.reading_source = 'DEMO_SEED'
       OR readings.reading_source IN (
           'PROJECT_SOIL_DATASET',
           'ISRIC_WOSIS',
           'ISRIC_SOILGRIDS'
       )
       OR readings.source_provider IN (
           'PROJECT_SOIL_DATASET',
           'ISRIC_WOSIS',
           'ISRIC_SOILGRIDS',
           'DEMO'
       )
       OR readings.source_dataset_id IN (
           'PROJECT_SOIL_DATASET',
           'ISRIC_WOSIS',
           'ISRIC_SOILGRIDS'
       )
       OR datasets.dataset_key IN (
           'PROJECT_SOIL_DATASET',
           'ISRIC_WOSIS',
           'ISRIC_SOILGRIDS'
       )
       OR datasets.provider_name IN (
           'PROJECT_SOIL_DATASET',
           'ISRIC_WOSIS',
           'ISRIC_SOILGRIDS'
       )
       OR batch_datasets.dataset_key IN (
           'PROJECT_SOIL_DATASET',
           'ISRIC_WOSIS',
           'ISRIC_SOILGRIDS'
       )
       OR batch_datasets.provider_name IN (
           'PROJECT_SOIL_DATASET',
           'ISRIC_WOSIS',
           'ISRIC_SOILGRIDS'
       )
       OR provenance.provider_name IN (
           'PROJECT_SOIL_DATASET',
           'ISRIC_WOSIS',
           'ISRIC_SOILGRIDS'
       )
       OR provenance.dataset_id IN (
           'PROJECT_SOIL_DATASET',
           'ISRIC_WOSIS',
           'ISRIC_SOILGRIDS'
       )
       OR provenance_datasets.dataset_key IN (
           'PROJECT_SOIL_DATASET',
           'ISRIC_WOSIS',
           'ISRIC_SOILGRIDS'
       )
       OR provenance_datasets.provider_name IN (
           'PROJECT_SOIL_DATASET',
           'ISRIC_WOSIS',
           'ISRIC_SOILGRIDS'
       )
       OR EXISTS (
           SELECT 1
           FROM public.source_provenance AS record_provenance
           LEFT JOIN public.source_datasets AS record_datasets
             ON record_datasets.id = record_provenance.source_dataset_ref_id
           WHERE record_provenance.record_id = readings.source_record_id
             AND (
                 record_provenance.source_dataset_ref_id = readings.dataset_id
                 OR (
                     readings.source_dataset_id IS NOT NULL
                     AND record_provenance.dataset_id = readings.source_dataset_id
                 )
             )
             AND (
                 record_provenance.provider_name IN (
                     'PROJECT_SOIL_DATASET',
                     'ISRIC_WOSIS',
                     'ISRIC_SOILGRIDS'
                 )
                 OR record_provenance.dataset_id IN (
                     'PROJECT_SOIL_DATASET',
                     'ISRIC_WOSIS',
                     'ISRIC_SOILGRIDS'
                 )
                 OR record_datasets.dataset_key IN (
                     'PROJECT_SOIL_DATASET',
                     'ISRIC_WOSIS',
                     'ISRIC_SOILGRIDS'
                 )
                 OR record_datasets.provider_name IN (
                     'PROJECT_SOIL_DATASET',
                     'ISRIC_WOSIS',
                     'ISRIC_SOILGRIDS'
                 )
             )
       )
)
UPDATE public.soil_readings AS readings
SET excluded_reason = 'retired_or_demo_source:' || retired_readings.retired_provider,
    excluded_at = COALESCE(readings.excluded_at, NOW()),
    updated_at = NOW()
FROM retired_readings
WHERE readings.id = retired_readings.id
  AND readings.excluded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_soil_readings_excluded_at
    ON public.soil_readings(excluded_at)
    WHERE excluded_at IS NOT NULL;

COMMENT ON COLUMN public.soil_readings.excluded_reason IS
    'Reason the reading is excluded from assessments and farmer/officer data views.';
COMMENT ON COLUMN public.soil_readings.excluded_at IS
    'Timestamp at which the reading was quarantined from operational use.';

COMMIT;
