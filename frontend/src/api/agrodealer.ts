export type DealerCategory = 'fertilizer' | 'seeds' | 'manure' | 'tools'

export type AgrodealerProfile = {
  id: string
  userId?: string
  businessName: string
  county: string | null
  subCounty: string | null
  ward: string | null
  locationStatus: 'unverified' | 'verified' | 'unavailable'
  locationPermissionStatus: 'not_requested' | 'granted' | 'denied'
  locationConsentAt?: string | null
  locationConsentNotes?: string | null
  locationVerified: boolean
  hasCoordinates: boolean
  latitude?: number | null
  longitude?: number | null
  demo: boolean
  privacyPolicyNotice?: string
}

export type DealerProduct = {
  id: string
  name: string
  category: DealerCategory
  description: string | null
  stockQuantity: number
  stockUnit: string
  stockUpdatedAt: string
  daysSinceStockUpdate?: number
  freshnessStatus?: 'fresh' | 'stale' | 'out_of_stock'
  isStale?: boolean
  unitPrice: number | null
  currency: string
  orderable: boolean
  isListed?: boolean
  demo: boolean
}

export type AgrodealerCatalog = {
  dealer: AgrodealerProfile
  products: DealerProduct[]
  disclaimer?: string
  nonEndorsementNotice?: string
}

export type MarketplaceOrder = {
  id: string
  dealerId: string
  productId: string
  productName: string
  productCategory?: string
  quantity: number
  unitPrice: number
  totalPrice: number
  currency: string
  status: 'draft' | 'pending_confirmation' | 'confirmed' | 'fulfilled' | 'cancelled' | 'disputed'
  termsAccepted: boolean
  termsAcceptedAt?: string | null
  fulfillmentType: 'pickup' | 'delivery'
  notes: string | null
  cancellationReason: string | null
  disputeReason: string | null
  disputeStatus: string | null
  createdAt: string
  updatedAt: string
}

export type DealerProximitySearchResult = {
  searchMethod: string
  query: {
    latitude?: number | null
    longitude?: number | null
    radiusKm: number
    county?: string | null
    ward?: string | null
  }
  disclaimer: string
  privacyNotice: string
  dealers: Array<{
    id: string
    businessName: string
    county: string | null
    subCounty: string | null
    ward: string | null
    locationStatus: string
    locationPermissionStatus: string
    locationVerified: boolean
    hasCoordinates: boolean
    distanceKm: number | null
  }>
}

const categories: DealerCategory[] = ['fertilizer', 'seeds', 'manure', 'tools']
const locationStatuses: AgrodealerProfile['locationStatus'][] = [
  'unverified',
  'verified',
  'unavailable',
]
const permissionStatuses: AgrodealerProfile['locationPermissionStatus'][] = [
  'not_requested',
  'granted',
  'denied',
]

function isDealerProfile(value: unknown): value is AgrodealerProfile {
  if (!value || typeof value !== 'object') return false
  const dealer = value as Partial<AgrodealerProfile>
  return (
    typeof dealer.id === 'string' &&
    typeof dealer.businessName === 'string' &&
    (typeof dealer.county === 'string' || dealer.county === null) &&
    (typeof dealer.subCounty === 'string' || dealer.subCounty === null) &&
    (typeof dealer.ward === 'string' || dealer.ward === null) &&
    locationStatuses.includes(dealer.locationStatus as AgrodealerProfile['locationStatus']) &&
    permissionStatuses.includes(
      dealer.locationPermissionStatus as AgrodealerProfile['locationPermissionStatus'],
    ) &&
    typeof dealer.locationVerified === 'boolean' &&
    typeof dealer.hasCoordinates === 'boolean' &&
    typeof dealer.demo === 'boolean'
  )
}

function isDealerProduct(value: unknown): value is DealerProduct {
  if (!value || typeof value !== 'object') return false
  const product = value as Partial<DealerProduct>
  return (
    typeof product.id === 'string' &&
    typeof product.name === 'string' &&
    categories.includes(product.category as DealerCategory) &&
    (typeof product.description === 'string' || product.description === null) &&
    typeof product.stockQuantity === 'number' &&
    product.stockQuantity >= 0 &&
    typeof product.stockUnit === 'string' &&
    typeof product.stockUpdatedAt === 'string' &&
    (typeof product.unitPrice === 'number' || product.unitPrice === null) &&
    typeof product.currency === 'string' &&
    typeof product.orderable === 'boolean' &&
    typeof product.demo === 'boolean'
  )
}

export async function getAgrodealerCatalog(signal?: AbortSignal): Promise<AgrodealerCatalog> {
  const response = await fetch('/api/v1/demo/agrodealer/catalog', { signal })
  if (!response.ok) {
    throw new Error(`SoilSync agrodealer API returned HTTP ${response.status}`)
  }

  const payload: unknown = await response.json()
  if (
    !payload ||
    typeof payload !== 'object' ||
    !isDealerProfile((payload as Partial<AgrodealerCatalog>).dealer) ||
    !Array.isArray((payload as Partial<AgrodealerCatalog>).products) ||
    !(payload as AgrodealerCatalog).products.every(isDealerProduct)
  ) {
    throw new Error('SoilSync agrodealer API returned an unsupported catalog')
  }

  return payload as AgrodealerCatalog
}

export async function getAuthenticatedDealerProfile(
  token: string,
  signal?: AbortSignal,
): Promise<AgrodealerProfile> {
  const response = await fetch('/api/v1/agrodealer/me/profile', {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
  if (!response.ok) {
    throw new Error(`Failed to load dealer profile (HTTP ${response.status})`)
  }
  return response.json()
}

export async function updateDealerProfile(
  token: string,
  payload: {
    business_name?: string
    county?: string
    sub_county?: string
    ward?: string
  },
): Promise<AgrodealerProfile> {
  const response = await fetch('/api/v1/agrodealer/me/profile', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new Error(`Failed to update dealer profile (HTTP ${response.status})`)
  }
  return response.json()
}

export async function getAuthenticatedDealerCatalog(
  token: string,
  signal?: AbortSignal,
): Promise<AgrodealerCatalog> {
  const response = await fetch('/api/v1/agrodealer/me/catalog', {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
  if (!response.ok) {
    throw new Error(`Failed to load authenticated catalog (HTTP ${response.status})`)
  }
  return response.json()
}

export async function createDealerProduct(
  token: string,
  payload: {
    name: string
    category: DealerCategory
    description?: string | null
    stock_quantity: number
    stock_unit: string
    unit_price?: number | null
    currency?: string
  },
): Promise<DealerProduct> {
  const response = await fetch('/api/v1/agrodealer/me/products', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new Error(`Failed to create product (HTTP ${response.status})`)
  }
  return response.json()
}

export async function updateDealerProduct(
  token: string,
  productId: string,
  payload: {
    name?: string
    description?: string | null
    unit_price?: number | null
    is_listed?: boolean
  },
): Promise<DealerProduct> {
  const response = await fetch(`/api/v1/agrodealer/me/products/${productId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new Error(`Failed to update product (HTTP ${response.status})`)
  }
  return response.json()
}

export async function updateDealerProductStock(
  token: string,
  productId: string,
  stockQuantity: number,
): Promise<{
  id: string
  name: string
  stockQuantity: number
  stockUnit: string
  stockUpdatedAt: string
}> {
  const response = await fetch(`/api/v1/agrodealer/me/products/${productId}/stock`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ stock_quantity: stockQuantity }),
  })
  if (!response.ok) {
    throw new Error(`Failed to update product stock (HTTP ${response.status})`)
  }
  return response.json()
}

export async function archiveDealerProduct(
  token: string,
  productId: string,
  isListed: boolean,
): Promise<{ id: string; name: string; isListed: boolean }> {
  const response = await fetch(`/api/v1/agrodealer/me/products/${productId}/archive`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ is_listed: isListed }),
  })
  if (!response.ok) {
    throw new Error(`Failed to archive product (HTTP ${response.status})`)
  }
  return response.json()
}

export async function deleteDealerProduct(
  token: string,
  productId: string,
): Promise<{ status: string; productId: string }> {
  const response = await fetch(`/api/v1/agrodealer/me/products/${productId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error(`Failed to delete product (HTTP ${response.status})`)
  }
  return response.json()
}

export async function updateDealerLocationConsent(
  token: string,
  consentGranted: boolean,
  consentNotes?: string,
): Promise<AgrodealerProfile> {
  const response = await fetch('/api/v1/agrodealer/me/location/consent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ consent_granted: consentGranted, consent_notes: consentNotes }),
  })
  if (!response.ok) {
    throw new Error(`Failed to update location consent (HTTP ${response.status})`)
  }
  return response.json()
}

export async function updateDealerCoordinates(
  token: string,
  latitude: number,
  longitude: number,
  accuracyMeters?: number,
): Promise<AgrodealerProfile> {
  const response = await fetch('/api/v1/agrodealer/me/location/coordinates', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      latitude,
      longitude,
      accuracy_meters: accuracyMeters,
    }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to update coordinates (HTTP ${response.status})`)
  }
  return response.json()
}

export async function revokeDealerLocation(token: string): Promise<AgrodealerProfile> {
  const response = await fetch('/api/v1/agrodealer/me/location/revoke', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error(`Failed to revoke location (HTTP ${response.status})`)
  }
  return response.json()
}

export async function getDealerOrders(
  token: string,
  signal?: AbortSignal,
): Promise<MarketplaceOrder[]> {
  const response = await fetch('/api/v1/agrodealer/me/orders', {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
  if (!response.ok) {
    throw new Error(`Failed to load orders (HTTP ${response.status})`)
  }
  return response.json()
}

export async function updateDealerOrderStatus(
  token: string,
  orderId: string,
  payload: {
    status: 'confirmed' | 'fulfilled' | 'cancelled' | 'disputed'
    cancellation_reason?: string
    dispute_reason?: string
  },
): Promise<MarketplaceOrder> {
  const response = await fetch(`/api/v1/agrodealer/me/orders/${orderId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    throw new Error(`Failed to update order status (HTTP ${response.status})`)
  }
  return response.json()
}

export async function searchDealersProximity(
  params: {
    latitude?: number
    longitude?: number
    radiusKm?: number
    county?: string
    ward?: string
  },
  signal?: AbortSignal,
): Promise<DealerProximitySearchResult> {
  const query = new URLSearchParams()
  if (params.latitude !== undefined) query.set('latitude', params.latitude.toString())
  if (params.longitude !== undefined) query.set('longitude', params.longitude.toString())
  if (params.radiusKm !== undefined) query.set('radiusKm', params.radiusKm.toString())
  if (params.county) query.set('county', params.county)
  if (params.ward) query.set('ward', params.ward)

  const response = await fetch(`/api/v1/agrodealer/search?${query.toString()}`, { signal })
  if (!response.ok) {
    throw new Error(`Search failed (HTTP ${response.status})`)
  }
  return response.json()
}

export interface AgrodealerApplicationPayload {
  businessName: string
  licenceNumber: string
  contactName: string
  county: string
  subCounty?: string
  ward?: string
  shopLocation?: string
  phoneNumber?: string
}

export interface AgrodealerApplicationResult {
  applicationId: string
  userId: string
  businessName: string
  licenceNumber: string
  contactName: string
  county: string
  subCounty?: string
  ward?: string
  shopLocation?: string
  phoneNumber?: string
  role: 'agrodealer'
  status: 'pending' | 'active' | 'suspended'
  verificationState: 'pending' | 'verified' | 'rejected'
  message: string
  createdAt: string
}

export async function applyForAgrodealer(
  token: string,
  payload: AgrodealerApplicationPayload,
  signal?: AbortSignal,
): Promise<AgrodealerApplicationResult> {
  const response = await fetch('/api/v1/dealer/apply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    signal,
  })
  if (!response.ok) {
    const errorBody = await response.json().catch(() => null)
    const detail = errorBody?.detail || `Application submission failed (HTTP ${response.status})`
    throw new Error(detail)
  }
  return response.json()
}

export async function getAgrodealerApplicationStatus(
  token: string,
  signal?: AbortSignal,
): Promise<{ hasApplication: boolean; application: AgrodealerApplicationResult | null }> {
  const response = await fetch('/api/v1/dealer/application-status', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal,
  })
  if (!response.ok) {
    throw new Error(`Failed to load application status (HTTP ${response.status})`)
  }
  return response.json()
}

