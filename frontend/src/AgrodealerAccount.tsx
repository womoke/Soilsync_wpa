import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Archive,
  LogOut,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShoppingBag,
  Store,
  Tag,
  Trash2,
} from 'lucide-react'
import { linkAuthenticatedAccount } from './api/auth'
import { getSupabaseClient } from './lib/supabase'
import {
  archiveDealerProduct,
  createDealerProduct,
  deleteDealerProduct,
  getAuthenticatedDealerCatalog,
  getAuthenticatedDealerProfile,
  getDealerOrders,
  revokeDealerLocation,
  searchDealersProximity,
  updateDealerCoordinates,
  updateDealerLocationConsent,
  updateDealerOrderStatus,
  updateDealerProductStock,
  type AgrodealerProfile,
  type DealerCategory,
  type DealerProduct,
  type DealerProximitySearchResult,
  type MarketplaceOrder,
} from './api/agrodealer'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.'
}

export default function AgrodealerAccount({ onBackToDemo }: { onBackToDemo: () => void }) {
  const supabase = getSupabaseClient()
  const [session, setSession] = useState<Session | null>(null)
  const [sessionRoleVerified, setSessionRoleVerified] = useState(false)
  const [manualToken, setManualToken] = useState('')
  const [activeToken, setActiveToken] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isWorking, setIsWorking] = useState(false)
  const [isLoadingData, setIsLoadingData] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  // Active Tab
  const [activeTab, setActiveTab] = useState<'inventory' | 'location' | 'orders' | 'proximity'>(
    'inventory',
  )

  // Dealer Data
  const [profile, setProfile] = useState<AgrodealerProfile | null>(null)
  const [products, setProducts] = useState<DealerProduct[]>([])
  const [orders, setOrders] = useState<MarketplaceOrder[]>([])
  const [searchResult, setSearchResult] = useState<DealerProximitySearchResult | null>(null)

  // Forms / Modals
  const [showAddProductModal, setShowAddProductModal] = useState(false)
  const [newProductName, setNewProductName] = useState('')
  const [newProductCategory, setNewProductCategory] = useState<DealerCategory>('fertilizer')
  const [newProductDescription, setNewProductDescription] = useState('')
  const [newProductStock, setNewProductStock] = useState('50')
  const [newProductUnit, setNewProductUnit] = useState('50kg bag')
  const [newProductPrice, setNewProductPrice] = useState('3200')

  // Stock Quick Update Modal
  const [stockEditingProductId, setStockEditingProductId] = useState<string | null>(null)
  const [stockEditQty, setStockEditQty] = useState('0')

  // Location Consent & Coordinates
  const [consentNotes, setConsentNotes] = useState(
    'Dealer authorized ward-level GPS for nearby farmer routing.',
  )
  const [inputLat, setInputLat] = useState('-0.4215')
  const [inputLng, setInputLng] = useState('36.9512')
  const [inputAccuracy, setInputAccuracy] = useState('10')

  // Order Cancellation / Dispute Modal
  const [selectedOrder, setSelectedOrder] = useState<MarketplaceOrder | null>(null)
  const [orderActionType, setOrderActionType] = useState<'cancel' | 'dispute' | null>(null)
  const [orderActionReason, setOrderActionReason] = useState('')

  // Proximity Search Simulator State
  const [simLat, setSimLat] = useState('-0.42')
  const [simLng, setSimLng] = useState('36.95')
  const [simRadius, setSimRadius] = useState('25')
  const [simCounty, setSimCounty] = useState('Nyeri')
  const [simWard, setSimWard] = useState('Dedan Kimathi')

  const effectiveToken = (sessionRoleVerified ? session?.access_token : null) || activeToken

  useEffect(() => {
    let isMounted = true
    if (!supabase) return

    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (!isMounted) return
      if (data.session) setSession(data.session)
      setSessionRoleVerified(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: unknown, nextSession: Session | null) => {
      if (!isMounted) return
      setSession(nextSession)
      setSessionRoleVerified(false)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [supabase])

  useEffect(() => {
    if (!supabase || !session) return
    let active = true

    void linkAuthenticatedAccount(session.access_token)
      .then((profile) => {
        if (profile.role !== 'agrodealer') {
          throw new Error(
            `This account has the ${profile.role.replaceAll('_', ' ')} role, not the agrodealer role.`,
          )
        }
        if (active) setSessionRoleVerified(true)
      })
      .catch((verificationError: unknown) => {
        if (!active) return
        setSession(null)
        setSessionRoleVerified(false)
        setError(getErrorMessage(verificationError))
        void supabase.auth
          .signOut()
          .then(({ error: signOutError }) => {
            if (signOutError) {
              setError(
                `${getErrorMessage(verificationError)} Sign-out failed: ${getErrorMessage(signOutError)}`,
              )
            }
          })
          .catch((signOutError: unknown) => {
            setError(
              `${getErrorMessage(verificationError)} Sign-out failed: ${getErrorMessage(signOutError)}`,
            )
          })
      })

    return () => {
      active = false
    }
  }, [session, supabase])

  const loadDealerData = useCallback(async (tokenToUse: string) => {
    if (!tokenToUse) return
    setIsLoadingData(true)
    setError('')

    try {
      const [profData, catalogData, ordersData] = await Promise.all([
        getAuthenticatedDealerProfile(tokenToUse),
        getAuthenticatedDealerCatalog(tokenToUse),
        getDealerOrders(tokenToUse).catch(() => [] as MarketplaceOrder[]),
      ])

      setProfile(profData)
      setProducts(catalogData.products)
      setOrders(ordersData)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsLoadingData(false)
    }
  }, [])

  useEffect(() => {
    if (!effectiveToken) return
    void Promise.resolve().then(() => loadDealerData(effectiveToken))
  }, [effectiveToken, loadDealerData])

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    if (!supabase) {
      setError('Supabase Auth is not configured in this environment.')
      return
    }
    setIsWorking(true)
    setError('')
    setMessage('')
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (signInError) throw signInError
      setMessage('Signed in successfully.')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  async function handleSignOut() {
    try {
      if (supabase) {
        const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
        if (signOutError) throw signOutError
      }
    } catch (signOutError) {
      setError(getErrorMessage(signOutError))
      return
    }
    setSession(null)
    setActiveToken('')
    setManualToken('')
    setProfile(null)
    setProducts([])
    setOrders([])
    setMessage('Signed out of dealer portal.')
    onBackToDemo()
  }

  function handleUseManualToken(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = manualToken.trim()
    if (!trimmed) {
      setError('Please provide a valid bearer token.')
      return
    }
    setActiveToken(trimmed)
    setMessage('Manual token set for session.')
  }

  // Inventory Handlers
  async function handleCreateProduct(e: React.FormEvent) {
    e.preventDefault()
    if (!effectiveToken) return
    setIsWorking(true)
    setError('')
    try {
      const parsedStock = parseInt(newProductStock, 10) || 0
      const parsedPrice = parseFloat(newProductPrice) || null
      await createDealerProduct(effectiveToken, {
        name: newProductName.trim(),
        category: newProductCategory,
        description: newProductDescription.trim() || null,
        stock_quantity: parsedStock,
        stock_unit: newProductUnit.trim(),
        unit_price: parsedPrice,
        currency: 'KES',
      })
      setMessage(`Added product "${newProductName}".`)
      setShowAddProductModal(false)
      setNewProductName('')
      setNewProductDescription('')
      await loadDealerData(effectiveToken)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  async function handleQuickStockUpdate(e: React.FormEvent) {
    e.preventDefault()
    if (!effectiveToken || !stockEditingProductId) return
    setIsWorking(true)
    setError('')
    try {
      const qty = parseInt(stockEditQty, 10) || 0
      await updateDealerProductStock(effectiveToken, stockEditingProductId, qty)
      setMessage('Stock level and verification timestamp updated.')
      setStockEditingProductId(null)
      await loadDealerData(effectiveToken)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  async function handleArchiveToggle(product: DealerProduct) {
    if (!effectiveToken) return
    setIsWorking(true)
    setError('')
    try {
      const targetListed = !(product.isListed ?? true)
      await archiveDealerProduct(effectiveToken, product.id, targetListed)
      setMessage(`Product "${product.name}" ${targetListed ? 'restored to catalog' : 'archived'}.`)
      await loadDealerData(effectiveToken)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  async function handleDeleteProduct(productId: string, productName: string) {
    if (!effectiveToken) return
    if (!window.confirm(`Permanently delete "${productName}" from your inventory?`)) return
    setIsWorking(true)
    setError('')
    try {
      await deleteDealerProduct(effectiveToken, productId)
      setMessage(`Deleted "${productName}".`)
      await loadDealerData(effectiveToken)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  // Location Handlers
  async function handleGrantConsent(granted: boolean) {
    if (!effectiveToken) return
    setIsWorking(true)
    setError('')
    try {
      const updated = await updateDealerLocationConsent(effectiveToken, granted, consentNotes)
      setProfile(updated)
      setMessage(granted ? 'Location tracking consent documented.' : 'Location consent refused.')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  async function handleSaveCoordinates() {
    if (!effectiveToken) return
    setIsWorking(true)
    setError('')
    try {
      const lat = parseFloat(inputLat)
      const lng = parseFloat(inputLng)
      const acc = parseFloat(inputAccuracy) || undefined
      const updated = await updateDealerCoordinates(effectiveToken, lat, lng, acc)
      setProfile(updated)
      setMessage('Shop GPS coordinates stored and verified.')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  async function handleRevokeLocation() {
    if (!effectiveToken) return
    if (!window.confirm('Revoke location tracking? Coordinates will be removed immediately.'))
      return
    setIsWorking(true)
    setError('')
    try {
      const updated = await revokeDealerLocation(effectiveToken)
      setProfile(updated)
      setMessage('Location tracking revoked. Coordinates deleted.')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  // Orders Handlers
  async function handleUpdateOrderStatus(orderId: string, status: 'confirmed' | 'fulfilled') {
    if (!effectiveToken) return
    setIsWorking(true)
    setError('')
    try {
      await updateDealerOrderStatus(effectiveToken, orderId, { status })
      setMessage(`Order status changed to ${status}.`)
      await loadDealerData(effectiveToken)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  async function handleCancelOrDisputeSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!effectiveToken || !selectedOrder || !orderActionType) return
    setIsWorking(true)
    setError('')
    try {
      if (orderActionType === 'cancel') {
        await updateDealerOrderStatus(effectiveToken, selectedOrder.id, {
          status: 'cancelled',
          cancellation_reason: orderActionReason.trim() || 'Cancelled by agrodealer',
        })
        setMessage('Order cancelled with documented reason.')
      } else {
        await updateDealerOrderStatus(effectiveToken, selectedOrder.id, {
          status: 'disputed',
          dispute_reason:
            orderActionReason.trim() || 'Dispute escalated to ward agricultural mediation',
        })
        setMessage('Order flagged as disputed and escalated to mediation.')
      }
      setSelectedOrder(null)
      setOrderActionType(null)
      setOrderActionReason('')
      await loadDealerData(effectiveToken)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  // Proximity Search Simulation
  async function handleRunProximitySimulation() {
    setIsWorking(true)
    setError('')
    try {
      const lat = simLat.trim() ? parseFloat(simLat) : undefined
      const lng = simLng.trim() ? parseFloat(simLng) : undefined
      const rad = parseFloat(simRadius) || 25
      const res = await searchDealersProximity({
        latitude: lat,
        longitude: lng,
        radiusKm: rad,
        county: simCounty.trim() || undefined,
        ward: simWard.trim() || undefined,
      })
      setSearchResult(res)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  const freshCount = products.filter(
    (p) => (p.daysSinceStockUpdate ?? 0) <= 7 && p.stockQuantity > 0,
  ).length
  const staleCount = products.filter(
    (p) => (p.daysSinceStockUpdate ?? 0) > 7 && p.stockQuantity > 0,
  ).length
  const outOfStockCount = products.filter((p) => p.stockQuantity <= 0).length

  return (
    <div
      className="farmer-account-page"
      style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}
    >
      {/* Header Bar */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.5rem',
          paddingBottom: '1rem',
          borderBottom: '1px solid var(--line-light, #e2e8f0)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '10px',
              background: '#047857',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Store size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <h1 style={{ fontSize: '1.4rem', margin: 0, fontWeight: 700 }}>Agrodealer Portal</h1>
              <span
                style={{
                  fontSize: '0.75rem',
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: '#d1fae5',
                  color: '#065f46',
                  fontWeight: 600,
                }}
              >
                VERIFIED INPUT NETWORK
              </span>
            </div>
            <p style={{ margin: '2px 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
              Inventory Management, Stock Freshness Tracking, & Marketplace Governance
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {effectiveToken && (
            <button
              onClick={() => void loadDealerData(effectiveToken)}
              disabled={isLoadingData}
              className="btn btn-outline"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
            >
              <RefreshCw size={14} className={isLoadingData ? 'animate-spin' : ''} />
              {isLoadingData ? 'Refreshing...' : 'Refresh'}
            </button>
          )}
          {effectiveToken && (
            <button
              onClick={handleSignOut}
              className="btn btn-outline"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
            >
              <LogOut size={14} />
              Sign Out
            </button>
          )}
          {!effectiveToken && (
            <button
              onClick={onBackToDemo}
              className="btn btn-outline"
              style={{ fontSize: '0.85rem' }}
            >
              Back to sign in
            </button>
          )}
        </div>
      </header>

      {/* Notifications */}
      {error && (
        <div
          role="alert"
          style={{
            padding: '0.75rem 1rem',
            background: '#fee2e2',
            color: '#991b1b',
            borderRadius: '8px',
            marginBottom: '1rem',
            fontSize: '0.9rem',
          }}
        >
          {error}
        </div>
      )}
      {message && (
        <div
          role="status"
          style={{
            padding: '0.75rem 1rem',
            background: '#dcfce7',
            color: '#166534',
            borderRadius: '8px',
            marginBottom: '1rem',
            fontSize: '0.9rem',
          }}
        >
          {message}
        </div>
      )}

      {/* Core Privacy & Non-Endorsement Disclaimers */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <div
          style={{
            padding: '1rem',
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            display: 'flex',
            gap: '0.75rem',
          }}
        >
          <ShieldAlert size={24} style={{ color: '#0284c7', flexShrink: 0 }} />
          <div style={{ fontSize: '0.85rem', color: '#334155' }}>
            <strong style={{ display: 'block', color: '#0f172a', marginBottom: '2px' }}>
              Non-Endorsement Policy (Section 5.81)
            </strong>
            SoilSync AI agronomical recommendations are strictly objective and analyte-based. Listing
            products in this catalog does not imply official endorsement or guarantee availability.
            Physical stock and prices must always be confirmed with the dealer.
          </div>
        </div>

        <div
          style={{
            padding: '1rem',
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            display: 'flex',
            gap: '0.75rem',
          }}
        >
          <Shield size={24} style={{ color: '#16a34a', flexShrink: 0 }} />
          <div style={{ fontSize: '0.85rem', color: '#334155' }}>
            <strong style={{ display: 'block', color: '#0f172a', marginBottom: '2px' }}>
              Farmer Privacy Shield (Section 5.79)
            </strong>
            Commercial dealers have zero access to farmer personal identifiers (names, national IDs,
            phone numbers) or raw soil reading coordinates. All demand visibility is anonymized at
            the administrative ward level.
          </div>
        </div>
      </section>

      {/* Session / Authentication Block */}
      {!effectiveToken && (
        <section
          style={{
            padding: '1.5rem',
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            marginBottom: '1.5rem',
          }}
        >
          <h2 style={{ fontSize: '1.1rem', marginTop: 0, marginBottom: '0.5rem' }}>
            Sign In to Agrodealer Workspace
          </h2>
          <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
            Log in with your agrodealer credentials or provide a test Bearer token to manage
            products and orders.
          </p>

          <form
            onSubmit={handleSignIn}
            style={{
              display: 'flex',
              gap: '0.75rem',
              flexWrap: 'wrap',
              alignItems: 'center',
              marginBottom: '1rem',
            }}
          >
            <input
              type="email"
              placeholder="dealer@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              style={{
                minWidth: '220px',
                padding: '0.5rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
              }}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              style={{
                minWidth: '180px',
                padding: '0.5rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
              }}
            />
            <button
              type="submit"
              disabled={isWorking}
              className="btn btn-primary"
              style={{ padding: '0.5rem 1rem' }}
            >
              {isWorking ? 'Signing In...' : 'Sign In'}
            </button>
          </form>

          {import.meta.env.MODE === 'test' && (
            <form
              onSubmit={handleUseManualToken}
              style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}
            >
              <input
                type="text"
                placeholder="Or paste Bearer token directly"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: '240px',
                  padding: '0.5rem',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                }}
              />
              <button type="submit" className="btn btn-outline" style={{ padding: '0.5rem 1rem' }}>
                Use Token
              </button>
            </form>
          )}
        </section>
      )}

      {/* Main Dealer Dashboard (When Authenticated) */}
      {effectiveToken && (
        <>
          {/* Profile Overview Card */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              padding: '1.25rem',
              marginBottom: '1.5rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '1rem',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <h2 style={{ fontSize: '1.25rem', margin: 0 }}>
                  {profile?.businessName || 'Mwangi Agro Supplies'}
                </h2>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    background: profile?.locationVerified ? '#dcfce7' : '#fef3c7',
                    color: profile?.locationVerified ? '#15803d' : '#b45309',
                  }}
                >
                  {profile?.locationVerified ? 'Location Verified' : 'Location Unverified'}
                </span>
              </div>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                <MapPin
                  size={14}
                  style={{ display: 'inline', verticalAlign: '-2px', marginRight: '4px' }}
                />
                {[profile?.ward, profile?.subCounty, profile?.county].filter(Boolean).join(', ') ||
                  'Nyeri County'}
              </p>
            </div>

            <div style={{ display: 'flex', gap: '1rem', textAlign: 'center' }}>
              <div style={{ padding: '0.5rem 1rem', background: '#f8fafc', borderRadius: '8px' }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>
                  {products.length}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Listed Products</div>
              </div>
              <div style={{ padding: '0.5rem 1rem', background: '#ecfdf5', borderRadius: '8px' }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#047857' }}>
                  {freshCount}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#047857' }}>Fresh Stock</div>
              </div>
              <div style={{ padding: '0.5rem 1rem', background: '#fffbeb', borderRadius: '8px' }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#b45309' }}>
                  {staleCount}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#b45309' }}>Stale (&gt;7d)</div>
              </div>
              <div style={{ padding: '0.5rem 1rem', background: '#fef2f2', borderRadius: '8px' }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#b91c1c' }}>
                  {outOfStockCount}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#b91c1c' }}>Out of Stock</div>
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              borderBottom: '2px solid #e2e8f0',
              marginBottom: '1.5rem',
            }}
          >
            <button
              onClick={() => setActiveTab('inventory')}
              style={{
                padding: '0.6rem 1.2rem',
                border: 'none',
                background: 'none',
                fontWeight: activeTab === 'inventory' ? 700 : 500,
                color: activeTab === 'inventory' ? '#047857' : '#64748b',
                borderBottom: activeTab === 'inventory' ? '2px solid #047857' : 'none',
                marginBottom: '-2px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <Package size={16} />
              Inventory & Freshness
            </button>
            <button
              onClick={() => setActiveTab('location')}
              style={{
                padding: '0.6rem 1.2rem',
                border: 'none',
                background: 'none',
                fontWeight: activeTab === 'location' ? 700 : 500,
                color: activeTab === 'location' ? '#047857' : '#64748b',
                borderBottom: activeTab === 'location' ? '2px solid #047857' : 'none',
                marginBottom: '-2px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <MapPin size={16} />
              Location & Consent
            </button>
            <button
              onClick={() => setActiveTab('orders')}
              style={{
                padding: '0.6rem 1.2rem',
                border: 'none',
                background: 'none',
                fontWeight: activeTab === 'orders' ? 700 : 500,
                color: activeTab === 'orders' ? '#047857' : '#64748b',
                borderBottom: activeTab === 'orders' ? '2px solid #047857' : 'none',
                marginBottom: '-2px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <ShoppingBag size={16} />
              Orders & Disputes ({orders.length})
            </button>
            <button
              onClick={() => setActiveTab('proximity')}
              style={{
                padding: '0.6rem 1.2rem',
                border: 'none',
                background: 'none',
                fontWeight: activeTab === 'proximity' ? 700 : 500,
                color: activeTab === 'proximity' ? '#047857' : '#64748b',
                borderBottom: activeTab === 'proximity' ? '2px solid #047857' : 'none',
                marginBottom: '-2px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <Tag size={16} />
              Proximity Search Preview
            </button>
          </div>

          {/* TAB 1: INVENTORY & STOCK FRESHNESS */}
          {activeTab === 'inventory' && (
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '1rem',
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Product Catalog</h3>
                  <p style={{ margin: '2px 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                    Fresh stock indicates verification within 7 days. Stale items require
                    confirmation.
                  </p>
                </div>
                <button
                  onClick={() => setShowAddProductModal(true)}
                  className="btn btn-primary"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    fontSize: '0.85rem',
                  }}
                >
                  <Plus size={16} />
                  Add Product
                </button>
              </div>

              {products.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '3rem',
                    background: '#f8fafc',
                    borderRadius: '8px',
                  }}
                >
                  <Package size={40} style={{ color: '#94a3b8', margin: '0 auto 0.5rem auto' }} />
                  <p style={{ color: '#64748b' }}>
                    No products listed yet. Click "Add Product" to create your first listing.
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: '1rem',
                  }}
                >
                  {products.map((product) => {
                    const daysSince = product.daysSinceStockUpdate ?? 0
                    const isStale = daysSince > 7
                    const isOutOfStock = product.stockQuantity <= 0

                    return (
                      <div
                        key={product.id}
                        style={{
                          background: '#ffffff',
                          border: isStale ? '1px solid #fcd34d' : '1px solid #e2e8f0',
                          borderRadius: '8px',
                          padding: '1rem',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                        }}
                      >
                        <div>
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'flex-start',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '0.75rem',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                background: '#f1f5f9',
                                color: '#475569',
                                textTransform: 'uppercase',
                                fontWeight: 600,
                              }}
                            >
                              {product.category}
                            </span>
                            <span
                              style={{
                                fontSize: '0.75rem',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontWeight: 600,
                                background: isOutOfStock
                                  ? '#fee2e2'
                                  : isStale
                                    ? '#fef3c7'
                                    : '#dcfce7',
                                color: isOutOfStock ? '#991b1b' : isStale ? '#92400e' : '#166534',
                              }}
                            >
                              {isOutOfStock
                                ? 'Out of Stock'
                                : isStale
                                  ? `Stale (Updated ${daysSince}d ago)`
                                  : 'Fresh'}
                            </span>
                          </div>

                          <h4 style={{ margin: '0.5rem 0 0.25rem 0', fontSize: '1rem' }}>
                            {product.name}
                          </h4>
                          {product.description && (
                            <p
                              style={{
                                margin: '0 0 0.5rem 0',
                                fontSize: '0.8rem',
                                color: '#64748b',
                              }}
                            >
                              {product.description}
                            </p>
                          )}

                          <div style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                color: '#475569',
                              }}
                            >
                              <span>Stock:</span>
                              <strong>
                                {product.stockQuantity} {product.stockUnit}
                              </strong>
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                color: '#475569',
                              }}
                            >
                              <span>Price:</span>
                              <strong>
                                {product.unitPrice != null
                                  ? `${product.unitPrice.toFixed(2)} ${product.currency}`
                                  : 'Unset'}
                              </strong>
                            </div>
                          </div>
                        </div>

                        <div
                          style={{
                            marginTop: '1rem',
                            paddingTop: '0.75rem',
                            borderTop: '1px solid #f1f5f9',
                            display: 'flex',
                            gap: '0.5rem',
                            flexWrap: 'wrap',
                          }}
                        >
                          <button
                            onClick={() => {
                              setStockEditingProductId(product.id)
                              setStockEditQty(product.stockQuantity.toString())
                            }}
                            className="btn btn-outline"
                            style={{ flex: 1, fontSize: '0.75rem', padding: '0.35rem 0.5rem' }}
                          >
                            Update Stock
                          </button>
                          <button
                            onClick={() => void handleArchiveToggle(product)}
                            className="btn btn-outline"
                            title={product.isListed ? 'Archive product' : 'Restore product'}
                            style={{ fontSize: '0.75rem', padding: '0.35rem 0.5rem' }}
                          >
                            <Archive size={14} />
                          </button>
                          <button
                            onClick={() => void handleDeleteProduct(product.id, product.name)}
                            className="btn btn-outline"
                            title="Delete permanently"
                            style={{
                              fontSize: '0.75rem',
                              padding: '0.35rem 0.5rem',
                              color: '#b91c1c',
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: LOCATION & CONSENT */}
          {activeTab === 'location' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: '1.5rem',
              }}
            >
              <div
                style={{
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '1.25rem',
                }}
              >
                <h3 style={{ marginTop: 0, fontSize: '1.1rem' }}>
                  Location Consent Governance (Section 5.77)
                </h3>
                <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
                  SoilSync AI only captures and publishes GPS coordinates with documented, explicit
                  consent from the dealer.
                </p>

                <div
                  style={{
                    marginBottom: '1rem',
                    padding: '0.75rem',
                    background: '#f8fafc',
                    borderRadius: '6px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '0.85rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: '4px',
                    }}
                  >
                    <span>Permission Status:</span>
                    <strong>{profile?.locationPermissionStatus || 'not_requested'}</strong>
                  </div>
                  <div
                    style={{
                      fontSize: '0.85rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: '4px',
                    }}
                  >
                    <span>Consent Recorded:</span>
                    <span>
                      {profile?.locationConsentAt
                        ? new Date(profile.locationConsentAt).toLocaleDateString()
                        : 'None'}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: '0.85rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>Verification:</span>
                    <span>{profile?.locationVerified ? 'Verified' : 'Unverified'}</span>
                  </div>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      marginBottom: '4px',
                    }}
                  >
                    Consent Documentation Notes:
                  </label>
                  <textarea
                    rows={3}
                    value={consentNotes}
                    onChange={(e) => setConsentNotes(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => void handleGrantConsent(true)}
                    disabled={isWorking}
                    className="btn btn-primary"
                    style={{ flex: 1, fontSize: '0.85rem' }}
                  >
                    Grant Consent
                  </button>
                  <button
                    onClick={() => void handleGrantConsent(false)}
                    disabled={isWorking}
                    className="btn btn-outline"
                    style={{ flex: 1, fontSize: '0.85rem' }}
                  >
                    Refuse Consent
                  </button>
                </div>
              </div>

              <div
                style={{
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '1.25rem',
                }}
              >
                <h3 style={{ marginTop: 0, fontSize: '1.1rem' }}>Shop GPS Coordinates</h3>
                <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
                  Coordinates can only be saved if consent has been explicitly granted above.
                </p>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '0.75rem',
                    marginBottom: '1rem',
                  }}
                >
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        marginBottom: '2px',
                      }}
                    >
                      Latitude:
                    </label>
                    <input
                      type="text"
                      value={inputLat}
                      onChange={(e) => setInputLat(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.45rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                      }}
                    />
                  </div>
                  <div>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        marginBottom: '2px',
                      }}
                    >
                      Longitude:
                    </label>
                    <input
                      type="text"
                      value={inputLng}
                      onChange={(e) => setInputLng(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.45rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                      }}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      marginBottom: '2px',
                    }}
                  >
                    Accuracy (meters):
                  </label>
                  <input
                    type="number"
                    value={inputAccuracy}
                    onChange={(e) => setInputAccuracy(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.45rem',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => void handleSaveCoordinates()}
                    disabled={isWorking}
                    className="btn btn-primary"
                    style={{ flex: 1, fontSize: '0.85rem' }}
                  >
                    Save Coordinates
                  </button>
                  <button
                    onClick={() => void handleRevokeLocation()}
                    disabled={isWorking || !profile?.hasCoordinates}
                    className="btn btn-outline"
                    style={{ fontSize: '0.85rem', color: '#b91c1c' }}
                  >
                    Revoke & Clear
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: ORDERS & DISPUTE GOVERNANCE */}
          {activeTab === 'orders' && (
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '1rem',
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
                    Marketplace Orders (Section 5.80)
                  </h3>
                  <p style={{ margin: '2px 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                    Orders with terms acceptance, fulfillment tracking, and documented dispute
                    resolution.
                  </p>
                </div>
              </div>

              {orders.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '3rem',
                    background: '#f8fafc',
                    borderRadius: '8px',
                  }}
                >
                  <ShoppingBag
                    size={40}
                    style={{ color: '#94a3b8', margin: '0 auto 0.5rem auto' }}
                  />
                  <p style={{ color: '#64748b' }}>No customer orders placed yet.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {orders.map((order) => (
                    <div
                      key={order.id}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        padding: '1rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '1rem',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <strong style={{ fontSize: '1rem' }}>{order.productName}</strong>
                          <span
                            style={{
                              fontSize: '0.75rem',
                              padding: '2px 8px',
                              borderRadius: '12px',
                              fontWeight: 600,
                              background:
                                order.status === 'confirmed'
                                  ? '#dcfce7'
                                  : order.status === 'fulfilled'
                                    ? '#e0e7ff'
                                    : order.status === 'cancelled'
                                      ? '#fee2e2'
                                      : order.status === 'disputed'
                                        ? '#fef3c7'
                                        : '#f1f5f9',
                              color:
                                order.status === 'confirmed'
                                  ? '#15803d'
                                  : order.status === 'fulfilled'
                                    ? '#3730a3'
                                    : order.status === 'cancelled'
                                      ? '#991b1b'
                                      : order.status === 'disputed'
                                        ? '#92400e'
                                        : '#475569',
                            }}
                          >
                            {order.status.toUpperCase()}
                          </span>
                        </div>
                        <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                          Qty: {order.quantity} · Total: {order.totalPrice.toFixed(2)}{' '}
                          {order.currency} · Fulfillment: {order.fulfillmentType}
                        </p>
                        {order.cancellationReason && (
                          <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#991b1b' }}>
                            Cancellation Reason: {order.cancellationReason}
                          </p>
                        )}
                        {order.disputeReason && (
                          <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#92400e' }}>
                            Dispute: {order.disputeReason} ({order.disputeStatus})
                          </p>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {order.status === 'pending_confirmation' && (
                          <button
                            onClick={() => void handleUpdateOrderStatus(order.id, 'confirmed')}
                            className="btn btn-primary"
                            style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                          >
                            Confirm Order
                          </button>
                        )}
                        {order.status === 'confirmed' && (
                          <button
                            onClick={() => void handleUpdateOrderStatus(order.id, 'fulfilled')}
                            className="btn btn-primary"
                            style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                          >
                            Mark Fulfilled
                          </button>
                        )}
                        {order.status !== 'cancelled' && order.status !== 'fulfilled' && (
                          <button
                            onClick={() => {
                              setSelectedOrder(order)
                              setOrderActionType('cancel')
                              setOrderActionReason('')
                            }}
                            className="btn btn-outline"
                            style={{
                              fontSize: '0.8rem',
                              padding: '0.35rem 0.75rem',
                              color: '#b91c1c',
                            }}
                          >
                            Cancel
                          </button>
                        )}
                        {order.status !== 'disputed' && (
                          <button
                            onClick={() => {
                              setSelectedOrder(order)
                              setOrderActionType('dispute')
                              setOrderActionReason('')
                            }}
                            className="btn btn-outline"
                            style={{
                              fontSize: '0.8rem',
                              padding: '0.35rem 0.75rem',
                              color: '#92400e',
                            }}
                          >
                            Mediation / Dispute
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: PROXIMITY SEARCH SIMULATION */}
          {activeTab === 'proximity' && (
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '1.25rem',
              }}
            >
              <h3 style={{ marginTop: 0, fontSize: '1.1rem' }}>
                Customer Proximity & Ward-Fallback Simulator (Section 5.78)
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
                Test how farmers discover agrodealers in their locality. If GPS is unavailable or
                permission is denied, the system falls back to administrative ward and county
                matching.
              </p>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: '0.75rem',
                  marginBottom: '1rem',
                }}
              >
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600 }}>
                    Farmer Lat:
                  </label>
                  <input
                    type="text"
                    value={simLat}
                    onChange={(e) => setSimLat(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.4rem',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600 }}>
                    Farmer Lng:
                  </label>
                  <input
                    type="text"
                    value={simLng}
                    onChange={(e) => setSimLng(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.4rem',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600 }}>
                    Radius (km):
                  </label>
                  <input
                    type="number"
                    value={simRadius}
                    onChange={(e) => setSimRadius(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.4rem',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600 }}>
                    County:
                  </label>
                  <input
                    type="text"
                    value={simCounty}
                    onChange={(e) => setSimCounty(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.4rem',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600 }}>
                    Ward:
                  </label>
                  <input
                    type="text"
                    value={simWard}
                    onChange={(e) => setSimWard(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.4rem',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                    }}
                  />
                </div>
              </div>

              <button
                onClick={() => void handleRunProximitySimulation()}
                disabled={isWorking}
                className="btn btn-primary"
                style={{ marginBottom: '1.5rem', fontSize: '0.85rem' }}
              >
                Run Search Simulation
              </button>

              {searchResult && (
                <div
                  style={{
                    padding: '1rem',
                    background: '#f8fafc',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: '0.5rem',
                    }}
                  >
                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                      Method: {searchResult.searchMethod}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      {searchResult.dealers.length} dealer(s) found
                    </span>
                  </div>
                  <p style={{ margin: '0 0 1rem 0', fontSize: '0.8rem', color: '#64748b' }}>
                    {searchResult.privacyNotice}
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {searchResult.dealers.map((d) => (
                      <div
                        key={d.id}
                        style={{
                          background: '#ffffff',
                          padding: '0.75rem',
                          borderRadius: '6px',
                          border: '1px solid #e2e8f0',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div>
                          <strong>{d.businessName}</strong>
                          <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                            {[d.ward, d.subCounty, d.county].filter(Boolean).join(', ')}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span
                            style={{
                              fontSize: '0.85rem',
                              fontWeight: 700,
                              color: d.distanceKm != null ? '#047857' : '#64748b',
                            }}
                          >
                            {d.distanceKm != null
                              ? `${d.distanceKm} km away`
                              : 'Ward Fallback (Exact distance unset)'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Quick Stock Edit Modal */}
          {stockEditingProductId && (
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
              }}
            >
              <div
                style={{
                  background: '#ffffff',
                  borderRadius: '10px',
                  padding: '1.5rem',
                  maxWidth: '400px',
                  width: '90%',
                  boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
                }}
              >
                <h3 style={{ marginTop: 0, fontSize: '1.1rem' }}>Update Stock Level</h3>
                <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
                  Updating stock refreshes the verification timestamp, keeping your listing active
                  and fresh for farmers.
                </p>

                <form onSubmit={handleQuickStockUpdate}>
                  <div style={{ marginBottom: '1rem' }}>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        marginBottom: '4px',
                      }}
                    >
                      Current Units in Stock:
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={stockEditQty}
                      onChange={(e) => setStockEditQty(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={() => setStockEditingProductId(null)}
                      className="btn btn-outline"
                    >
                      Cancel
                    </button>
                    <button type="submit" disabled={isWorking} className="btn btn-primary">
                      Save & Verify Stock
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Add Product Modal */}
          {showAddProductModal && (
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
              }}
            >
              <div
                style={{
                  background: '#ffffff',
                  borderRadius: '10px',
                  padding: '1.5rem',
                  maxWidth: '480px',
                  width: '90%',
                  boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
                }}
              >
                <h3 style={{ marginTop: 0, fontSize: '1.1rem' }}>Add Product to Catalog</h3>
                <form onSubmit={handleCreateProduct}>
                  <div style={{ marginBottom: '0.75rem' }}>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        marginBottom: '2px',
                      }}
                    >
                      Product Name:
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. NPK 17:17:17"
                      value={newProductName}
                      onChange={(e) => setNewProductName(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.45rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                      }}
                    />
                  </div>

                  <div style={{ marginBottom: '0.75rem' }}>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        marginBottom: '2px',
                      }}
                    >
                      Category:
                    </label>
                    <select
                      value={newProductCategory}
                      onChange={(e) => setNewProductCategory(e.target.value as DealerCategory)}
                      style={{
                        width: '100%',
                        padding: '0.45rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                      }}
                    >
                      <option value="fertilizer">Fertilizer</option>
                      <option value="seeds">Seeds</option>
                      <option value="manure">Manure</option>
                      <option value="tools">Tools</option>
                    </select>
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: '0.75rem',
                      marginBottom: '0.75rem',
                    }}
                  >
                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          marginBottom: '2px',
                        }}
                      >
                        Stock Quantity:
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={newProductStock}
                        onChange={(e) => setNewProductStock(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.45rem',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                        }}
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          marginBottom: '2px',
                        }}
                      >
                        Stock Unit:
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. 50kg bag"
                        value={newProductUnit}
                        onChange={(e) => setNewProductUnit(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.45rem',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ marginBottom: '0.75rem' }}>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        marginBottom: '2px',
                      }}
                    >
                      Price (KES):
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="e.g. 3500.00"
                      value={newProductPrice}
                      onChange={(e) => setNewProductPrice(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.45rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                      }}
                    />
                  </div>

                  <div style={{ marginBottom: '1rem' }}>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        marginBottom: '2px',
                      }}
                    >
                      Description:
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Product specifications, brand, dosage instructions"
                      value={newProductDescription}
                      onChange={(e) => setNewProductDescription(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.45rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={() => setShowAddProductModal(false)}
                      className="btn btn-outline"
                    >
                      Cancel
                    </button>
                    <button type="submit" disabled={isWorking} className="btn btn-primary">
                      Add to Catalog
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Cancellation / Dispute Modal */}
          {selectedOrder && orderActionType && (
            <div
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
              }}
            >
              <div
                style={{
                  background: '#ffffff',
                  borderRadius: '10px',
                  padding: '1.5rem',
                  maxWidth: '440px',
                  width: '90%',
                  boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
                }}
              >
                <h3 style={{ marginTop: 0, fontSize: '1.1rem' }}>
                  {orderActionType === 'cancel' ? 'Cancel Order' : 'Escalate Dispute'}
                </h3>
                <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
                  {orderActionType === 'cancel'
                    ? 'Orders can be cancelled prior to dispatch. Provide a reason for the record.'
                    : 'Disputes are escalated to the local ward agricultural mediation desk.'}
                </p>

                <form onSubmit={handleCancelOrDisputeSubmit}>
                  <div style={{ marginBottom: '1rem' }}>
                    <label
                      style={{
                        display: 'block',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        marginBottom: '4px',
                      }}
                    >
                      Reason / Statement:
                    </label>
                    <textarea
                      rows={3}
                      required
                      placeholder="Explain the reason for cancellation or dispute"
                      value={orderActionReason}
                      onChange={(e) => setOrderActionReason(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedOrder(null)
                        setOrderActionType(null)
                      }}
                      className="btn btn-outline"
                    >
                      Close
                    </button>
                    <button
                      type="submit"
                      disabled={isWorking}
                      className={
                        orderActionType === 'cancel' ? 'btn btn-outline' : 'btn btn-primary'
                      }
                      style={{ color: orderActionType === 'cancel' ? '#b91c1c' : undefined }}
                    >
                      {orderActionType === 'cancel' ? 'Confirm Cancellation' : 'Submit Dispute'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
