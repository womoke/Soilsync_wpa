BEGIN;

CREATE TABLE IF NOT EXISTS public.agrodealer_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
    business_name TEXT NOT NULL,
    county TEXT,
    sub_county TEXT,
    ward TEXT,
    location GEOGRAPHY(Point, 4326),
    location_status TEXT NOT NULL DEFAULT 'unverified'
        CHECK (location_status IN ('unverified', 'verified', 'unavailable')),
    location_permission_status TEXT NOT NULL DEFAULT 'not_requested'
        CHECK (location_permission_status IN ('not_requested', 'granted', 'denied')),
    is_demo BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (location_status <> 'verified' OR location IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.dealer_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_id UUID NOT NULL REFERENCES public.agrodealer_profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('fertilizer', 'seeds', 'manure', 'tools')),
    description TEXT,
    stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    stock_unit TEXT NOT NULL,
    stock_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    unit_price NUMERIC(12, 2) CHECK (unit_price IS NULL OR unit_price >= 0),
    currency TEXT NOT NULL DEFAULT 'KES' CHECK (currency ~ '^[A-Z]{3}$'),
    is_listed BOOLEAN NOT NULL DEFAULT TRUE,
    orderable BOOLEAN NOT NULL DEFAULT FALSE,
    is_demo BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agrodealer_profiles_location
    ON public.agrodealer_profiles USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_dealer_products_dealer_category
    ON public.dealer_products(dealer_id, category, is_listed);

DROP TRIGGER IF EXISTS set_agrodealer_profiles_updated_at ON public.agrodealer_profiles;
CREATE TRIGGER set_agrodealer_profiles_updated_at
BEFORE UPDATE ON public.agrodealer_profiles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_dealer_products_updated_at ON public.dealer_products;
CREATE TRIGGER set_dealer_products_updated_at
BEFORE UPDATE ON public.dealer_products
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

ALTER TABLE public.agrodealer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealer_products ENABLE ROW LEVEL SECURITY;

COMMIT;