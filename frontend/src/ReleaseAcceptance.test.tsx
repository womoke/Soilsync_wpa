import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AgrodealerAccount from './AgrodealerAccount'
import ExtensionOfficerAccount from './ExtensionOfficerAccount'
import AdminAccount from './AdminAccount'

function mockFetchResponse(payload: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(JSON.stringify(payload)),
  })
}

describe('Section 8: Release Acceptance - State Resilience & Error Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Empty States Coverage (Item 108)', () => {
    it('AgrodealerAccount renders empty catalog state when dealer has no products', async () => {
      globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/v1/agrodealer/me/profile')) {
          return mockFetchResponse({
            id: 'dealer-empty',
            businessName: 'Empty Agro Supplies',
            county: 'Nyeri',
            ward: 'Dedan Kimathi',
            locationStatus: 'verified',
            locationPermissionStatus: 'granted',
            hasCoordinates: false,
          })
        }
        if (url.includes('/api/v1/agrodealer/me/catalog')) {
          return mockFetchResponse({
            dealer: {
              id: 'dealer-empty',
              businessName: 'Empty Agro Supplies',
              county: 'Nyeri',
              ward: 'Dedan Kimathi',
            },
            products: [],
          })
        }
        if (url.includes('/api/v1/agrodealer/me/orders')) {
          return mockFetchResponse([])
        }
        return mockFetchResponse({})
      }) as unknown as typeof fetch

      render(<AgrodealerAccount onBackToDemo={vi.fn()} />)

      const tokenInput = screen.getByPlaceholderText(/Or paste Bearer token directly/i)
      fireEvent.change(tokenInput, { target: { value: 'dealer-token' } })
      fireEvent.click(screen.getByRole('button', { name: 'Use Token' }))

      expect(await screen.findByText('Empty Agro Supplies')).toBeInTheDocument()
      expect(
        screen.getByText(
          /No products listed yet\. Click "Add Product" to create your first listing\./i,
        ),
      ).toBeInTheDocument()
    })

    it('ExtensionOfficerAccount renders zero counts when roster and alerts are empty', async () => {
      globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/v1/officer/jurisdictions')) {
          return mockFetchResponse([
            {
              assignmentId: 'asgn-1',
              county: 'Nyeri',
              subCounty: 'Tetu',
              ward: 'Dedan Kimathi',
              assignedAt: '2026-10-01T00:00:00Z',
            },
          ])
        }
        if (url.includes('/api/v1/officer/farmers')) return mockFetchResponse([])
        if (url.includes('/api/v1/officer/visit-pool')) return mockFetchResponse([])
        if (url.includes('/api/v1/officer/visits')) return mockFetchResponse([])
        if (url.includes('/api/v1/officer/alerts')) return mockFetchResponse([])
        if (url.includes('/api/v1/officer/ward-summaries')) return mockFetchResponse([])
        return mockFetchResponse({})
      }) as unknown as typeof fetch

      render(<ExtensionOfficerAccount onBackToDemo={vi.fn()} />)

      const tokenInput = screen.getByPlaceholderText('valid-officer-token')
      fireEvent.change(tokenInput, { target: { value: 'officer-token' } })
      fireEvent.click(screen.getByRole('button', { name: 'Use Officer Token' }))

      expect(
        await screen.findByText(/Nyeri County • Tetu • Dedan Kimathi Ward/i),
      ).toBeInTheDocument()
      // Zero counts rendered for empty collections
      expect(screen.getByText('In active assigned jurisdictions')).toBeInTheDocument()
      expect(screen.getByText('0 total visits recorded')).toBeInTheDocument()
    })
  })

  describe('Unavailable & Network Error States (HTTP 503) (Item 108)', () => {
    it('AgrodealerAccount reports HTTP 503 database service unavailable error', async () => {
      globalThis.fetch = vi.fn().mockImplementation(() => {
        return mockFetchResponse({ detail: 'Database pool unavailable' }, 503)
      }) as unknown as typeof fetch

      render(<AgrodealerAccount onBackToDemo={vi.fn()} />)

      const tokenInput = screen.getByPlaceholderText(/Or paste Bearer token directly/i)
      fireEvent.change(tokenInput, { target: { value: 'dealer-token' } })
      fireEvent.click(screen.getByRole('button', { name: 'Use Token' }))

      await waitFor(() => {
        expect(screen.getByText(/Failed to load dealer profile \(HTTP 503\)/i)).toBeInTheDocument()
      })
    })

    it('AdminAccount surfaces network dropped exceptions gracefully', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network connection dropped'))

      render(<AdminAccount onBackToDemo={vi.fn()} />)

      const tokenInput = screen.getByPlaceholderText(/Paste Bearer token here/i)
      fireEvent.change(tokenInput, { target: { value: 'admin-token' } })
      fireEvent.click(screen.getByRole('button', { name: 'Set Token' }))

      await waitFor(() => {
        expect(screen.getByText('Network connection dropped')).toBeInTheDocument()
      })
    })
  })

  describe('Stale & Freshness States (14d+) (Item 108)', () => {
    it('AgrodealerAccount flags inventory unverified for 14 days or more as stale', async () => {
      const staleTimestamp = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()
      globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/v1/agrodealer/me/profile')) {
          return mockFetchResponse({
            id: 'dealer-stale',
            businessName: 'Highland Agrovets',
            county: 'Nyeri',
            ward: 'Dedan Kimathi',
          })
        }
        if (url.includes('/api/v1/agrodealer/me/catalog')) {
          return mockFetchResponse({
            dealer: { id: 'dealer-stale', businessName: 'Highland Agrovets' },
            products: [
              {
                id: 'prod-stale',
                name: 'Unverified Stock Bag',
                category: 'fertilizer',
                stockQuantity: 15,
                stockUnit: '50kg bag',
                stockUpdatedAt: staleTimestamp,
                daysSinceStockUpdate: 15,
                freshnessStatus: 'stale',
                isStale: true,
                unitPrice: 3200,
                currency: 'KES',
                orderable: false,
                isListed: true,
                demo: false,
              },
            ],
          })
        }
        if (url.includes('/api/v1/agrodealer/me/orders')) return mockFetchResponse([])
        return mockFetchResponse({})
      }) as unknown as typeof fetch

      render(<AgrodealerAccount onBackToDemo={vi.fn()} />)

      const tokenInput = screen.getByPlaceholderText(/Or paste Bearer token directly/i)
      fireEvent.change(tokenInput, { target: { value: 'dealer-token' } })
      fireEvent.click(screen.getByRole('button', { name: 'Use Token' }))

      expect(await screen.findByText('Highland Agrovets')).toBeInTheDocument()
      expect(screen.getByText('Unverified Stock Bag')).toBeInTheDocument()
      expect(screen.getByText(/Stale \(Updated 15d ago\)/i)).toBeInTheDocument()
    })
  })

  describe('Permission Denied States (HTTP 403) (Item 108)', () => {
    it('ExtensionOfficerAccount displays error when an action is rejected with HTTP 403 Forbidden', async () => {
      globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/jurisdictions')) {
          return mockFetchResponse(
            { detail: 'Access forbidden: user is not an active extension officer' },
            403,
          )
        }
        return mockFetchResponse({ detail: 'Forbidden' }, 403)
      }) as unknown as typeof fetch

      render(<ExtensionOfficerAccount onBackToDemo={vi.fn()} />)

      const tokenInput = screen.getByPlaceholderText('valid-officer-token')
      fireEvent.change(tokenInput, { target: { value: 'unauthorized-token' } })
      fireEvent.click(screen.getByRole('button', { name: 'Use Officer Token' }))

      await waitFor(() => {
        expect(
          screen.getByText('Access forbidden: user is not an active extension officer'),
        ).toBeInTheDocument()
      })
    })

    it('AdminAccount displays error when non-admin accesses privileged endpoints (HTTP 403)', async () => {
      globalThis.fetch = vi.fn().mockImplementation(() => {
        return mockFetchResponse({ detail: 'Admin privileges required' }, 403)
      }) as unknown as typeof fetch

      render(<AdminAccount onBackToDemo={vi.fn()} />)

      const tokenInput = screen.getByPlaceholderText(/Paste Bearer token here/i)
      fireEvent.change(tokenInput, { target: { value: 'farmer-token-for-admin' } })
      fireEvent.click(screen.getByRole('button', { name: 'Set Token' }))

      await waitFor(() => {
        expect(screen.getByText(/Failed to load system overview \(HTTP 403\)/i)).toBeInTheDocument()
      })
    })
  })
})
