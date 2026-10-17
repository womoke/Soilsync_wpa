BEGIN;

DO $$
DECLARE
    retired_dataset_id UUID;
BEGIN
    SELECT id
    INTO retired_dataset_id
    FROM source_datasets
    WHERE dataset_key = 'PROJECT_SOIL_DATASET'
    FOR UPDATE;

    IF retired_dataset_id IS NULL THEN
        RETURN;
    END IF;

    DELETE FROM soil_readings
    WHERE dataset_id = retired_dataset_id
       OR source_dataset_id = 'PROJECT_SOIL_DATASET'
       OR source_provider = 'PROJECT_SOIL_DATASET'
       OR reading_source = 'PROJECT_SOIL_DATASET';

    DELETE FROM source_provenance
    WHERE source_dataset_ref_id = retired_dataset_id
       OR dataset_id = 'PROJECT_SOIL_DATASET'
       OR provider_name = 'PROJECT_SOIL_DATASET';

    DELETE FROM source_import_batches
    WHERE dataset_id = retired_dataset_id;

    UPDATE source_datasets
    SET dataset_key = 'RETIRED_PROJECT_SOIL_DATASET',
        display_name = 'Retired project dataset (rights unconfirmed)',
        provider_name = 'RETIRED_PROJECT_SOIL_DATASET',
        source_file_name = NULL,
        prototype_use_basis = 'Retired by migration 032 because rights were not confirmed; imported records removed.'
    WHERE id = retired_dataset_id;
END;
$$;

COMMIT;
