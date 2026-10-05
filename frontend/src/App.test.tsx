import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

function demoReadingResponse() {
  return {
    contractVersion: 1,
    readingId: 'demo-reading-test',
    farmId: null,
    source: {
      provider: 'DEMO',
      datasetId: 'synthetic-test',
      recordId: 'demo-reading-test',
      license: null,
      attribution: 'Synthetic illustrative values.',
      retrievedAt: '2026-10-01T00:00:00Z',
    },
    sample: {
      sampledAt: '2026-09-30T00:00:00Z',
      sampleYear: 2026,
      depth: { sourceLabel: '0-20 cm', topCm: 0, bottomCm: 20 },
    },
    location: { latitude: null, longitude: null, uncertaintyM: null },
    measurements: [
      ['soil_ph', 6.2, 'pH'],
      ['total_nitrogen', 0.08, '%'],
      ['olsen_phosphorus', 18, 'ppm'],
      ['exchangeable_potassium', 0.34, 'meq%'],
      ['organic_carbon', 1.7, '%'],
    ].map(([analyte, value, sourceUnit]) => ({
      analyte,
      value,
      sourceUnit,
      canonicalUnit: null,
      analyticalMethod: null,
      qualityStatus: 'sample',
      uncertainty: null,
    })),
  }
}

function demoRecommendationsResponse() {
  return [
    {
      recommendationId: 'demo-rec-1',
      farmId: null,
      crop: 'maize',
      title: 'Nitrogen management review',
      rationale:
        'The demo reading is below a project-dataset reference benchmark for total nitrogen.',
      applicationRate: 40,
      applicationUnit: 'kg/ha',
      ruleVersion: 'prototype-v1',
      reviewStatus: 'pending_review',
    },
    {
      recommendationId: 'demo-rec-2',
      farmId: null,
      crop: 'maize',
      title: 'Organic matter improvement',
      rationale: 'Organic carbon is below a project-dataset reference benchmark.',
      applicationRate: 2,
      applicationUnit: 't/ha',
      ruleVersion: 'prototype-v1',
      reviewStatus: 'pending_review',
    },
  ]
}

function dashboardSeedResponse() {
  return {
    users: [
      {
        id: 'user-farmer-01',
        name: 'Amina Njeri',
        role: 'farmer',
        email: 'amina.njeri@example.com',
        ward: 'Kiboko',
        farmName: 'Kiboko Valley Farm',
        status: 'active',
      },
      {
        id: 'user-farmer-02',
        name: 'John Wambua',
        role: 'farmer',
        email: 'john.wambua@example.com',
        ward: 'Yatta',
        farmName: 'Upper Yatta Plot',
        status: 'draft',
      },
      {
        id: 'user-officer-01',
        name: 'Daniel Otieno',
        role: 'extension-officer',
        email: 'daniel.otieno@example.com',
        ward: 'Kiboko',
        status: 'review',
      },
    ],
    alerts: [
      {
        id: 'alert-001',
        title: 'pH review required',
        owner: 'Amina Njeri',
        category: 'soil',
        severity: 'high',
        summary: 'Field sample suggests pH drift in the south-west quadrant and needs validation.',
      },
      {
        id: 'alert-003',
        title: 'Farmer sync backlog',
        owner: 'Daniel Otieno',
        category: 'ops',
        severity: 'medium',
        summary: 'Three farmer submissions are waiting for ward approval and sync review.',
      },
    ],
    farmVisits: [
      { farmer: 'Amina Njeri', date: '2026-10-02', outcome: 'Sample review', status: 'Open' },
      { farmer: 'John Wambua', date: '2026-10-03', outcome: 'Draft sync', status: 'Pending' },
    ],
    summaryCards: [{ label: 'Assigned farmers', value: '2', detail: '1 requiring review' }],
    actionQueue: [{ title: 'Review soil reading', note: '', status: '' }],
    recentItems: [
      { title: 'Kiboko Valley field review', note: 'Needs pH validation', status: 'Open' },
    ],
  }
}

function agrodealerCatalogResponse() {
  return {
    dealer: {
      id: 'dealer-profile-demo',
      businessName: 'Mwangi Agro',
      county: 'Makueni',
      subCounty: null,
      ward: 'Makueni',
      locationStatus: 'unverified',
      locationPermissionStatus: 'not_requested',
      locationVerified: false,
      hasCoordinates: false,
      demo: true,
    },
    products: [
      {
        id: 'product-fertilizer',
        name: 'Starter blend',
        description: 'Synthetic QA product record.',
        category: 'fertilizer',
        stockQuantity: 42,
        stockUnit: 'bags',
        stockUpdatedAt: '2026-10-01T00:00:00Z',
        unitPrice: null,
        currency: 'KES',
        orderable: false,
        demo: true,
      },
    ],
  }
}

function successfulDemoFetch() {
  return vi.fn(async (input) => {
    const url = typeof input === 'string' ? input : input.url

    if (url === '/api/v1/demo/agrodealer/catalog') {
      return {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(agrodealerCatalogResponse()),
      }
    }

    if (url.startsWith('/api/v1/demo/dashboard/seed-data')) {
      return {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(dashboardSeedResponse()),
      }
    }

    if (url === '/api/v1/demo/soil-reading') {
      return {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(demoReadingResponse()),
      }
    }

    if (url === '/api/v1/demo/recommendations') {
      return {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(demoRecommendationsResponse()),
      }
    }

    return {
      ok: false,
      status: 404,
      json: vi.fn().mockResolvedValue({}),
    }
  })
}

const { getClient } = vi.hoisted(() => ({ getClient: vi.fn() }))
vi.mock('./lib/supabase', () => ({ getSupabaseClient: getClient }))

beforeEach(() => {
  window.history.replaceState(null, '', '/workshop')
  vi.stubGlobal('fetch', successfulDemoFetch())
  getClient.mockReturnValue({
    auth: {
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
      verifyOtp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  })
})

describe('farmer overview prototype', () => {
  it('shows only the branded loading screen until initial session restoration completes', async () => {
    window.history.replaceState(null, '', '/welcome')
    let resolveSession!: (value: {
      data: { session: null }
      error: null
    }) => void
    getClient.mockReturnValue({
      auth: {
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
        getSession: vi.fn(
          () =>
            new Promise((resolve) => {
              resolveSession = resolve
            }),
        ),
      },
    })

    render(<App />)

    expect(screen.getByRole('status', { name: 'Loading SoilSync AI…' })).toBeInTheDocument()
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Welcome back' })).not.toBeInTheDocument()

    await waitFor(() => expect(resolveSession).toBeDefined())
    await act(async () => resolveSession({ data: { session: null }, error: null }))

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
  })

  it('exposes a manifest for the installable PWA shell', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ name: 'SoilSync AI', icons: [{ src: '/icons.svg' }] }),
      }),
    )

    const response = await fetch('/manifest.webmanifest')
    expect(response.ok).toBe(true)

    const manifest = await response.json()
    expect(manifest.name).toBe('SoilSync AI')
    expect(Array.isArray(manifest.icons)).toBe(true)
  })

  it('loads database records and shows stored guidance', async () => {
    render(<App />)

    expect(await screen.findAllByText('DATABASE')).not.toHaveLength(0)
    expect(screen.getByText('Measurements entered')).toBeInTheDocument()
    expect(await screen.findByText('Nitrogen management review')).toBeInTheDocument()
    expect(screen.getAllByText('Review pending').length).toBeGreaterThan(0)
  })

  it('shows sample provenance, depth, and measurement quality from the record', async () => {
    render(<App />)

    expect(await screen.findByText('Synthetic illustrative values.')).toBeInTheDocument()
    expect(screen.getByText('0-20 cm')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'QUALITY' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('table', { name: 'Soil readings' })).getAllByText('sample'),
    ).toHaveLength(5)
  })

  it('does not show fabricated screen data when the API is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('API unavailable')))
    render(<App />)

    expect(await screen.findByText(/Database unavailable/)).toBeInTheDocument()
    expect(screen.getByText('Farm profile unavailable')).toBeInTheDocument()
    expect(screen.getAllByText('Not entered').length).toBeGreaterThan(0)
    expect(screen.getByText('UNAVAILABLE')).toBeInTheDocument()
  })

  it('starts on shared email sign-in and registration instead of role selection', async () => {
    window.history.replaceState(null, '', '/welcome')
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Select user workflow' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email address')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(screen.getByLabelText('Full name')).toBeInTheDocument()
  })

  it('keeps admins on password reset until they submit their new password', async () => {
    window.history.replaceState(null, '', '/reset-password?invite=1')
    const session = {
      access_token: 'recovery-access-token',
      user: {
        id: 'admin-auth-user',
        user_metadata: { display_name: 'System Administrator' },
      },
    }
    getClient.mockReturnValue({
      auth: {
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
        getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
      },
      from: (table: string) => {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: () =>
            Promise.resolve({
              data: {
                id: 'admin-auth-user',
                full_name: 'System Administrator',
                county: null,
                sub_county: null,
                ward: null,
                phone_number: null,
              },
              error: null,
            }),
          then: (resolve: (value: unknown) => void) =>
            resolve({
              data:
                table === 'user_roles'
                  ? [{ role: 'admin', status: 'active', approved_at: null }]
                  : [],
              error: null,
            }),
        }
        return query
      },
    })

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'System Admin Workspace' })).not.toBeInTheDocument(),
    )
    expect(window.location.pathname).toBe('/reset-password')
    window.history.replaceState(null, '', '/workshop')
  })

  it('opens the farmer sign-in view directly on the farmer route', async () => {
    window.history.replaceState(null, '', '/farmer')
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email address')).toBeInTheDocument()
    expect(screen.queryByText('Nitrogen management review')).not.toBeInTheDocument()
  })

  it('highlights the selected in-app navigation destination', async () => {
    render(<App />)

    const navigation = await screen.findByRole('navigation')
    const farmLink = within(navigation).getByRole('link', { name: 'My farm' })

    fireEvent.click(farmLink)
    await waitFor(() => expect(farmLink).toHaveAttribute('aria-current', 'page'))

    window.history.replaceState(null, '', '/')
  })

  it('allows an incomplete local reading preview without saving it', async () => {
    render(<App />)
    await screen.findAllByText('DATABASE')

    fireEvent.click(screen.getByRole('button', { name: 'Add a reading' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Soil pH (pH)' }), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview values' }))

    expect(screen.getAllByText('LOCAL PREVIEW')).toHaveLength(2)
    expect(screen.getByText('Not entered')).toBeInTheDocument()
    expect(
      screen.getByText('Reading preview updated. Values are temporary and were not saved.'),
    ).toBeInTheDocument()
  })

  it('does not persist a local preview over database values after reload', async () => {
    const { unmount } = render(<App />)
    await screen.findAllByText('DATABASE')

    fireEvent.click(screen.getByRole('button', { name: 'Add a reading' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Soil pH (pH)' }), {
      target: { value: '5.4' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview values' }))

    expect(screen.getAllByText(/5\.4/).length).toBeGreaterThan(0)
    unmount()

    render(<App />)

    expect(await screen.findAllByText('DATABASE')).not.toHaveLength(0)
    expect(screen.queryByText('LOCAL PREVIEW')).not.toBeInTheDocument()
    expect(within(screen.getByLabelText('Recent readings')).getByText(/6\.2/)).toBeInTheDocument()
  })

  it('tracks recent local preview readings', async () => {
    render(<App />)
    await screen.findAllByText('DATABASE')

    fireEvent.click(screen.getByRole('button', { name: 'Add a reading' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Soil pH (pH)' }), {
      target: { value: '5.4' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview values' }))

    expect(screen.getByText('Recent readings')).toBeInTheDocument()
    expect(within(screen.getByLabelText('Recent readings')).getByText(/6\.2/)).toBeInTheDocument()
    expect(screen.getAllByText(/5\.4/).length).toBeGreaterThan(0)
  })

  it('keeps provider and API diagnostics out of the farmer workspace', async () => {
    render(<App />)
    await screen.findAllByText('DATABASE')

    expect(screen.queryByText('Provider readiness')).not.toBeInTheDocument()
    expect(screen.queryByText('Local demo API')).not.toBeInTheDocument()
    expect(screen.queryByText('Data connection')).not.toBeInTheDocument()
    expect(screen.queryByText('PROJECT_SOIL_DATASET')).not.toBeInTheDocument()
    expect(screen.queryByText('pending_approval')).not.toBeInTheDocument()
  })

  it('tracks recommendation feedback actions for the farmer', async () => {
    render(<App />)
    await screen.findByText('Nitrogen management review')

    fireEvent.click(screen.getAllByRole('button', { name: 'Followed' })[0])

    expect(screen.getAllByRole('button', { name: 'Followed' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Crop: maize').length).toBeGreaterThan(0)
    expect(screen.getByText('Feedback selected for review.')).toBeInTheDocument()
  })

  it('shows an extension-officer ward dashboard with farmer roster and alerts', async () => {
    const fetchMock = successfulDemoFetch()
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Extension officer' }))

    expect(screen.getByText('Farmer roster')).toBeInTheDocument()
    expect((await screen.findAllByText('Amina Njeri')).length).toBeGreaterThan(0)
    expect(screen.getByText('Open alerts')).toBeInTheDocument()
    expect((await screen.findAllByText('pH review required')).length).toBeGreaterThan(0)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('role=extension-officer'),
      expect.any(Object),
    )
  })

  it('loads the dealer profile and non-orderable catalog from database records', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Agrodealer' }))

    expect(await screen.findByText('Product catalog')).toBeInTheDocument()
    expect(screen.getByText('Mwangi Agro')).toBeInTheDocument()
    expect(screen.getByText('Starter blend')).toBeInTheDocument()
    expect(screen.getByText('Location unverified')).toBeInTheDocument()
    expect(screen.getByText('Not available for ordering')).toBeInTheDocument()
  })

  it('loads admin accounts from the database-backed users table', async () => {
    render(<App />)

    fireEvent.click(await screen.findByRole('button', { name: 'Admin' }))

    expect(await screen.findByText('System accounts')).toBeInTheDocument()
    expect(screen.getByText('amina.njeri@example.com')).toBeInTheDocument()
  })

  it('switches theme without hiding generated recommendation cards', async () => {
    render(<App />)
    await screen.findAllByText('DATABASE')
    expect(await screen.findByText('Nitrogen management review')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }))

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(screen.getByText('Nitrogen management review')).toBeInTheDocument()
  })
})
