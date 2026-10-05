BEGIN;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.soil_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_provenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.soil_measurements ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.users IS
    'Row-level security enabled. Add ownership policies before authenticated client access.';
COMMENT ON TABLE public.farms IS
    'Row-level security enabled. Add ownership and jurisdiction policies before client access.';
COMMENT ON TABLE public.soil_readings IS
    'Row-level security enabled. Add ownership policies before client access.';
COMMENT ON TABLE public.source_provenance IS
    'Row-level security enabled. Keep provenance server-side unless a reviewed policy permits access.';
COMMENT ON TABLE public.recommendations IS
    'Row-level security enabled. Add ownership policies before client access.';
COMMENT ON TABLE public.source_datasets IS
    'Row-level security enabled. Keep dataset registry server-side unless a reviewed policy permits access.';
COMMENT ON TABLE public.source_import_batches IS
    'Row-level security enabled. Import audit records are server-side only.';
COMMENT ON TABLE public.soil_measurements IS
    'Row-level security enabled. Add ownership policies before client access.';

COMMIT;