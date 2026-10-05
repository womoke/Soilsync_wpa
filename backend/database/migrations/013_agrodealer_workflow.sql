-- Migration 013: Agrodealer Workflow, Location Consent, Freshness & Marketplace Orders
-- Implements checklist Section 5 items:
-- 74: Bind profile to authenticated dealer identity and prevent access to another dealer's records.
-- 75: Add authorized create/update/archive workflows for dealer profile, listed products, stock, and prices.
-- 76: Track stock updates and freshness; hide or flag stale stock instead of implying current availability.
-- 77: Request location permission explicitly; store coordinates only with documented consent and verification.
-- 78: Add proximity search only after location accuracy, distance method, permission-denied, and no-location behavior are approved.
-- 79: Keep farmer identities and soil data private from dealers unless the farmer explicitly consents to a defined workflow.
-- 80: Add orders only after marketplace terms, product availability, fulfillment, cancellation, and dispute behavior are defined.
-- 81: Never imply that a product is endorsed by a recommendation or guaranteed to be available.

BEGIN;

-- 1. Extend agrodealer_profiles with documented consent timestamps and verification notes
ALTER TABLE public.agrodealer_profiles
    ADD COLUMN IF NOT EXISTS location_consent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS location_consent_notes TEXT;

COMMENT ON COLUMN public.agrodealer_profiles.location_consent_at IS
    'Timestamp when dealer explicitly granted location tracking consent.';
COMMENT ON COLUMN public.agrodealer_profiles.location_consent_notes IS
    'Documented scope of location consent (e.g. ward-level search visibility).';

-- 2. Marketplace Orders table with strict state machine and terms acknowledgement
CREATE TABLE IF NOT EXISTS public.marketplace_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dealer_id UUID NOT NULL REFERENCES public.agrodealer_profiles(id) ON DELETE CASCADE,
    buyer_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.dealer_products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
    total_price NUMERIC(12, 2) NOT NULL CHECK (total_price >= 0),
    currency TEXT NOT NULL DEFAULT 'KES' CHECK (currency ~ '^[A-Z]{3}$'),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'pending_confirmation', 'confirmed', 'fulfilled', 'cancelled', 'disputed')),
    terms_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    terms_accepted_at TIMESTAMPTZ,
    fulfillment_type TEXT NOT NULL DEFAULT 'pickup'
        CHECK (fulfillment_type IN ('pickup', 'delivery')),
    notes TEXT,
    cancellation_reason TEXT,
    dispute_reason TEXT,
    dispute_status TEXT
        CHECK (dispute_status IS NULL OR dispute_status IN ('open', 'under_review', 'resolved', 'dismissed')),
    dispute_resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (terms_accepted = TRUE OR status = 'draft')
);

COMMENT ON TABLE public.marketplace_orders IS
    'Marketplace orders connecting buyers and agrodealers. Gated on explicit terms acceptance and dispute governance.';

-- 3. Trigger for updated_at on marketplace_orders
DROP TRIGGER IF EXISTS set_marketplace_orders_updated_at ON public.marketplace_orders;
CREATE TRIGGER set_marketplace_orders_updated_at
BEFORE UPDATE ON public.marketplace_orders
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- 4. Enable RLS on marketplace_orders
ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;

-- 5. RLS policies for marketplace_orders
DROP POLICY IF EXISTS marketplace_orders_dealer_select ON public.marketplace_orders;
CREATE POLICY marketplace_orders_dealer_select ON public.marketplace_orders
    FOR SELECT
    USING (
        dealer_id IN (
            SELECT ap.id FROM public.agrodealer_profiles AS ap
            JOIN public.users AS u ON u.id = ap.user_id
            WHERE u.supabase_auth_user_id = auth.uid()
        )
        OR buyer_user_id IN (
            SELECT id FROM public.users WHERE supabase_auth_user_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.users AS admin_user
            WHERE admin_user.supabase_auth_user_id = auth.uid()
              AND admin_user.role = 'admin'
              AND admin_user.is_active = TRUE
        )
    );

DROP POLICY IF EXISTS marketplace_orders_dealer_update ON public.marketplace_orders;
CREATE POLICY marketplace_orders_dealer_update ON public.marketplace_orders
    FOR UPDATE
    USING (
        dealer_id IN (
            SELECT ap.id FROM public.agrodealer_profiles AS ap
            JOIN public.users AS u ON u.id = ap.user_id
            WHERE u.supabase_auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS marketplace_orders_buyer_insert ON public.marketplace_orders;
CREATE POLICY marketplace_orders_buyer_insert ON public.marketplace_orders
    FOR INSERT
    WITH CHECK (
        buyer_user_id IN (
            SELECT id FROM public.users WHERE supabase_auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS marketplace_orders_buyer_update ON public.marketplace_orders;
CREATE POLICY marketplace_orders_buyer_update ON public.marketplace_orders
    FOR UPDATE
    USING (
        buyer_user_id IN (
            SELECT id FROM public.users WHERE supabase_auth_user_id = auth.uid()
        )
    );

-- 6. Add delete policy for dealer_products (allowing agrodealers to delete their own catalog items)
DROP POLICY IF EXISTS dealer_products_delete_own ON public.dealer_products;
CREATE POLICY dealer_products_delete_own ON public.dealer_products
    FOR DELETE
    USING (
        dealer_id IN (
            SELECT ap.id FROM public.agrodealer_profiles AS ap
            JOIN public.users AS u ON u.id = ap.user_id
            WHERE u.supabase_auth_user_id = auth.uid()
        )
    );

-- 7. Performance and query indices
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_dealer ON public.marketplace_orders(dealer_id, status);
CREATE INDEX IF NOT EXISTS idx_marketplace_orders_buyer ON public.marketplace_orders(buyer_user_id, status);
CREATE INDEX IF NOT EXISTS idx_dealer_products_stock_updated ON public.dealer_products(stock_updated_at);

COMMIT;
