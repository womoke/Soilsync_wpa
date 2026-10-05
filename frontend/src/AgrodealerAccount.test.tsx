import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import AgrodealerAccount from './AgrodealerAccount'

const mockProfile = {
  id: 'dealer-prof-1',
  userId: 'dealer-user-1',
  businessName: 'Mwangi Agro Supplies',
  county: 'Nyeri',
  subCounty: 'Tetu',
  ward: 'Dedan Kimathi',
  locationStatus: 'verified',
  locationPermissionStatus: 'granted',
  locationConsentAt: '2026-09-15T10:00:00Z',
  locationConsentNotes: 'Authorized ward GPS',
  locationVerified: true,
  hasCoordinates: true,
  demo: false,
}

const mockProducts = [
  {
    id: 'prod-1',
    name: 'NPK 17:17:17 Blend',
    category: 'fertilizer',
    description: 'Balanced basal planting fertilizer',
    stockQuantity: 45,
    stockUnit: '50kg bag',
    stockUpdatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago = fresh
    daysSinceStockUpdate: 2,
    freshnessStatus: 'fresh',
    isStale: false,
    unitPrice: 3500.0,
    currency: 'KES',
    orderable: false,
    isListed: true,
    demo: false,
  },
  {
    id: 'prod-2',
    name: 'Certified Maize Seeds H614',
    category: 'seeds',
    description: 'High altitude highland hybrid seed',
    stockQuantity: 20,
    stockUnit: '2kg packet',
    stockUpdatedAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days ago = stale
    daysSinceStockUpdate: 14,
    freshnessStatus: 'stale',
    isStale: true,
    unitPrice: 580.0,
    currency: 'KES',
    orderable: false,
    isListed: true,
    demo: false,
  },
  {
    id: 'prod-3',
    name: 'Agricultural Lime',
    category: 'manure',
    description: 'Calcium carbonate for acidic soils',
    stockQuantity: 0, // out of stock
    stockUnit: '50kg bag',
    stockUpdatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    daysSinceStockUpdate: 1,
    freshnessStatus: 'out_of_stock',
    isStale: false,
    unitPrice: 1200.0,
    currency: 'KES',
    orderable: false,
    isListed: true,
    demo: false,
  },
]

const mockOrders = [
  {
    id: 'order-101',
    dealerId: 'dealer-prof-1',
    productId: 'prod-1',
    productName: 'NPK 17:17:17 Blend',
    productCategory: 'fertilizer',
    quantity: 2,
    unitPrice: 3500.0,
    totalPrice: 7000.0,
    currency: 'KES',
    status: 'pending_confirmation',
    termsAccepted: true,
    termsAcceptedAt: '2026-10-01T08:00:00Z',
    fulfillmentType: 'pickup',
    notes: 'Customer will collect on Friday',
    cancellationReason: null,
    disputeReason: null,
    disputeStatus: null,
    createdAt: '2026-10-01T08:00:00Z',
    updatedAt: '2026-10-01T08:00:00Z',
  },
]

describe('AgrodealerAccount Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    globalThis.fetch = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes('/api/v1/agrodealer/me/profile')) {
        if (options?.method === 'PATCH') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ...mockProfile, businessName: 'Updated Mwangi Agro' }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockProfile),
        })
      }

      if (url.includes('/api/v1/agrodealer/me/catalog')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              dealer: mockProfile,
              products: mockProducts,
            }),
        })
      }

      if (url.includes('/api/v1/agrodealer/me/orders')) {
        if (options?.method === 'PATCH') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ...mockOrders[0], status: 'confirmed' }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockOrders),
        })
      }

      if (url.includes('/api/v1/agrodealer/me/location/consent')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...mockProfile, locationPermissionStatus: 'granted' }),
        })
      }

      if (url.includes('/api/v1/agrodealer/me/location/coordinates')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ ...mockProfile, hasCoordinates: true, locationVerified: true }),
        })
      }

      if (url.includes('/api/v1/agrodealer/me/location/revoke')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ...mockProfile,
              locationPermissionStatus: 'denied',
              hasCoordinates: false,
            }),
        })
      }

      if (url.includes('/api/v1/agrodealer/me/products') && options?.method === 'POST') {
        if (url.includes('/archive')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ id: 'prod-1', isListed: false }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 'prod-new',
              name: 'DAP Fertilizer',
              category: 'fertilizer',
              stockQuantity: 100,
              stockUnit: '50kg bag',
              unitPrice: 4000.0,
            }),
        })
      }

      if (url.includes('/stock') && options?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: 'prod-1',
              name: 'NPK 17:17:17 Blend',
              stockQuantity: 60,
              stockUnit: '50kg bag',
              stockUpdatedAt: new Date().toISOString(),
            }),
        })
      }

      if (url.includes('/api/v1/agrodealer/search')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              searchMethod: 'coordinates_proximity',
              disclaimer: 'Marketplace Listing Only — Not an Endorsement.',
              privacyNotice: 'Search is performed without exposing farmer identities.',
              dealers: [
                {
                  id: 'dealer-prof-1',
                  businessName: 'Mwangi Agro Supplies',
                  county: 'Nyeri',
                  subCounty: 'Tetu',
                  ward: 'Dedan Kimathi',
                  locationStatus: 'verified',
                  locationPermissionStatus: 'granted',
                  locationVerified: true,
                  hasCoordinates: true,
                  distanceKm: 3.5,
                },
              ],
            }),
        })
      }

      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      })
    }) as unknown as typeof fetch
  })

  it('renders portal disclaimers: non-endorsement policy and farmer privacy shield', () => {
    render(<AgrodealerAccount onBackToDemo={vi.fn()} />)

    expect(screen.getByText('Agrodealer Portal')).toBeInTheDocument()
    expect(screen.getByText(/Non-Endorsement Policy/i)).toBeInTheDocument()
    expect(screen.getByText(/Farmer Privacy Shield/i)).toBeInTheDocument()
    expect(
      screen.getByText(/Commercial dealers have zero access to farmer personal identifiers/i),
    ).toBeInTheDocument()
  })

  it('authenticates with manual token and renders catalog with stock freshness tags', async () => {
    render(<AgrodealerAccount onBackToDemo={vi.fn()} />)

    const tokenInput = screen.getByPlaceholderText(/Or paste Bearer token directly/i)
    fireEvent.change(tokenInput, { target: { value: 'valid-test-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use Token' }))

    await waitFor(() => {
      expect(screen.getByText('Mwangi Agro Supplies')).toBeInTheDocument()
    })

    // Verify products rendered
    expect(screen.getByText('NPK 17:17:17 Blend')).toBeInTheDocument()
    expect(screen.getByText('Certified Maize Seeds H614')).toBeInTheDocument()
    expect(screen.getByText('Agricultural Lime')).toBeInTheDocument()

    // Freshness badges: Fresh, Stale (14d ago), Out of Stock
    expect(screen.getByText('Fresh')).toBeInTheDocument()
    expect(screen.getByText(/Stale \(Updated 14d ago\)/i)).toBeInTheDocument()
    expect(screen.getAllByText('Out of Stock').length).toBeGreaterThan(0)
  })

  it('opens Add Product modal and creates a new product listing', async () => {
    render(<AgrodealerAccount onBackToDemo={vi.fn()} />)

    const tokenInput = screen.getByPlaceholderText(/Or paste Bearer token directly/i)
    fireEvent.change(tokenInput, { target: { value: 'valid-test-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use Token' }))

    await waitFor(() => {
      expect(screen.getByText('Mwangi Agro Supplies')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Add Product/i }))

    expect(screen.getByText('Add Product to Catalog')).toBeInTheDocument()
    const nameInput = screen.getByPlaceholderText(/e\.g\. NPK 17:17:17/i)
    fireEvent.change(nameInput, { target: { value: 'DAP Fertilizer' } })

    fireEvent.click(screen.getByRole('button', { name: 'Add to Catalog' }))

    await waitFor(() => {
      expect(screen.getByText(/Added product "DAP Fertilizer"/i)).toBeInTheDocument()
    })
  })

  it('switches to Location tab, grants consent and revokes location', async () => {
    render(<AgrodealerAccount onBackToDemo={vi.fn()} />)

    const tokenInput = screen.getByPlaceholderText(/Or paste Bearer token directly/i)
    fireEvent.change(tokenInput, { target: { value: 'valid-test-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use Token' }))

    await waitFor(() => {
      expect(screen.getByText('Mwangi Agro Supplies')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Location & Consent/i }))

    expect(screen.getByText(/Location Consent Governance/i)).toBeInTheDocument()

    // Grant consent
    fireEvent.click(screen.getByRole('button', { name: 'Grant Consent' }))
    await waitFor(() => {
      expect(screen.getByText(/Location tracking consent documented/i)).toBeInTheDocument()
    })

    // Save Coordinates
    fireEvent.click(screen.getByRole('button', { name: 'Save Coordinates' }))
    await waitFor(() => {
      expect(screen.getByText(/Shop GPS coordinates stored and verified/i)).toBeInTheDocument()
    })

    // Revoke location
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Revoke & Clear' }))
    await waitFor(() => {
      expect(screen.getByText(/Location tracking revoked/i)).toBeInTheDocument()
    })
  })

  it('switches to Orders tab and updates order status to confirmed', async () => {
    render(<AgrodealerAccount onBackToDemo={vi.fn()} />)

    const tokenInput = screen.getByPlaceholderText(/Or paste Bearer token directly/i)
    fireEvent.change(tokenInput, { target: { value: 'valid-test-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use Token' }))

    await waitFor(() => {
      expect(screen.getByText('Mwangi Agro Supplies')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Orders & Disputes/i }))

    expect(screen.getByText(/Marketplace Orders/i)).toBeInTheDocument()
    expect(screen.getByText('PENDING_CONFIRMATION')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Order' }))

    await waitFor(() => {
      expect(screen.getByText(/Order status changed to confirmed/i)).toBeInTheDocument()
    })
  })

  it('switches to Proximity tab and runs search simulation', async () => {
    render(<AgrodealerAccount onBackToDemo={vi.fn()} />)

    const tokenInput = screen.getByPlaceholderText(/Or paste Bearer token directly/i)
    fireEvent.change(tokenInput, { target: { value: 'valid-test-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use Token' }))

    await waitFor(() => {
      expect(screen.getByText('Mwangi Agro Supplies')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Proximity Search Preview/i }))

    expect(screen.getByText(/Customer Proximity & Ward-Fallback Simulator/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Run Search Simulation' }))

    await waitFor(() => {
      expect(screen.getByText(/3\.5 km away/i)).toBeInTheDocument()
    })
  })
})
