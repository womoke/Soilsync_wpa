import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FarmerAccount from './FarmerAccount'
import type { FarmerProfile } from './api/farmer'
import type { SoilReading, SoilRecommendation } from './types/soil'

const { getClient } = vi.hoisted(() => ({ getClient: vi.fn() }))
vi.mock('./lib/supabase', () => ({ getSupabaseClient: getClient }))

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
  }
}

function testSession() {
  return {
    access_token: 'verified-access-token',
    refresh_token: 'private-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 1_800_000_000,
    user: { id: 'auth-user-1', phone: '+254700000001' },
  }
}

function farmerProfile() {
  return {
    farmerId: 'app-user-1',
    name: 'Amina Njeri',
    phone: '+254700000001',
    farmId: 'farm-1',
    farmName: 'Kiboko Farm',
    ownerVerified: true,
    farms: [
      {
        farmId: 'farm-1',
        name: 'Kiboko Farm',
        county: 'Makueni',
        ward: 'Kiboko',
        latitude: null,
        longitude: null,
        ownerVerified: true,
        createdAt: '2026-10-02T00:00:00Z',
        updatedAt: '2026-10-02T00:00:00Z',
      },
    ],
  }
}

function farmerRecommendation() {
  return {
    recommendationId: 'recommendation-1',
    farmId: 'farm-1',
    crop: 'maize',
    title: 'Review soil results',
    rationale: 'This record is waiting for agronomic review.',
    applicationRate: null,
    applicationUnit: null,
    ruleVersion: 'review-v1',
    reviewStatus: 'pending_review',
  }
}

function farmerReading() {
  return {
    contractVersion: 1,
    readingId: 'reading-1',
    farmId: 'farm-1',
    source: {
      provider: 'FARMER_OBSERVATION',
      datasetId: null,
      recordId: null,
      license: null,
      attribution: 'Submitted by the authenticated farmer',
      retrievedAt: null,
    },
    sample: {
      sampledAt: '2026-10-02T00:00:00Z',
      sampleYear: 2026,
      depth: { sourceLabel: 'Farmer supplied', topCm: null, bottomCm: null },
    },
    location: { latitude: null, longitude: null, uncertaintyM: null },
    measurements: [
      {
        analyte: 'soil_ph',
        value: 5.8,
        sourceUnit: 'pH',
        canonicalUnit: null,
        analyticalMethod: null,
        qualityStatus: 'valid',
        uncertainty: null,
      },
    ],
  }
}

describe('authenticated farmer workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        if (url === '/api/v1/auth/link')
          return jsonResponse({
            status: 'linked',
            appUserId: 'app-user-1',
            identityProvider: 'supabase',
            role: 'farmer',
          })
        if (url === '/api/v1/farms/me') return jsonResponse(farmerProfile())
        if (url === '/api/v1/farms/farm-1/readings' && method === 'GET') return jsonResponse([])
        if (url === '/api/v1/farms/farm-1/visit-request' && method === 'POST')
          return jsonResponse(
            {
              requestId: 'req-001',
              farmId: 'farm-1',
              status: 'requested',
              message: 'Field visit request submitted to county extension officer pool.',
              createdAt: '2026-10-02T00:00:00Z',
            },
            201,
          )
        if (url === '/api/v1/farms/farm-1/recommendations')
          return jsonResponse([farmerRecommendation()])
        if (url === '/api/v1/recommendations/recommendation-1/feedback' && method === 'GET')
          return jsonResponse([])
        if (url === '/api/v1/recommendations/recommendation-1/feedback' && method === 'POST') {
          const body = JSON.parse(String(init?.body)) as { response: string }
          return jsonResponse(
            {
              feedbackId: 'feedback-1',
              recommendationId: 'recommendation-1',
              response: body.response,
              createdAt: '2026-10-02T00:00:00Z',
            },
            201,
          )
        }
        if (url === '/api/v1/auth/logout') return jsonResponse({ status: 'logged_out' })
        return jsonResponse({ detail: `Unexpected request: ${method} ${url}` }, 404)
      }),
    )
  })

  it('registers with email and password, loads owned data, persists a reading and feedback, and clears on logout', async () => {
    let authStateListener:
      ((event: string, session: ReturnType<typeof testSession> | null) => void) | undefined
    const session = testSession()
    const supabase = {
      auth: {
        onAuthStateChange: vi.fn((listener: typeof authStateListener) => {
          authStateListener = listener
          return { data: { subscription: { unsubscribe: vi.fn() } } }
        }),
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        signUp: vi.fn().mockResolvedValue({ data: { session }, error: null }),
        signInWithPassword: vi.fn().mockResolvedValue({ data: { session }, error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    }
    getClient.mockReturnValue(supabase)
    render(<FarmerAccount onBackToDemo={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Create account' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Full name' }), {
      target: { value: 'Amina Njeri' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), {
      target: { value: 'amina@example.test' },
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secure-password' },
    })
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'secure-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('heading', { name: 'Welcome, Amina Njeri' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Kiboko Farm' })).toBeInTheDocument()
    expect(screen.getByText('Review soil results')).toBeInTheDocument()
    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: 'amina@example.test',
      password: 'secure-password',
      options: { data: { display_name: 'Amina Njeri' } },
    })

    expect(screen.getByText('INCOMPLETE — VISIT NEEDED')).toBeInTheDocument()
    expect(screen.getByText('Field Visit Required (Incomplete Farm State)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Request Field Visit' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Submit Request' }))
    expect(
      await screen.findByText(/Field visit request submitted to county extension officer pool/),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Not followed' }))
    expect(await screen.findByText('Saved: not followed')).toBeInTheDocument()

    const fetchMock = vi.mocked(fetch)
    const protectedRequests = fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith('/api/v1/'),
    )
    expect(protectedRequests.length).toBeGreaterThan(0)
    for (const [, init] of protectedRequests) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer verified-access-token')
    }

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign in to your farm' }),
    ).toBeInTheDocument()
    expect(supabase.auth.signOut).toHaveBeenCalledOnce()
    expect(authStateListener).toBeDefined()
  })

  it('does not register a farmer when password confirmation does not match', async () => {
    const supabase = {
      auth: {
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        signUp: vi.fn(),
        signInWithPassword: vi.fn(),
        signOut: vi.fn(),
      },
    }
    getClient.mockReturnValue(supabase)
    render(<FarmerAccount onBackToDemo={vi.fn()} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Create account' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Full name' }), {
      target: { value: 'Amina Njeri' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), {
      target: { value: 'amina@example.test' },
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secure-password' },
    })
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'different-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The passwords do not match.')
    expect(supabase.auth.signUp).not.toHaveBeenCalled()
  })

  it('shows the SoilSync loading mark while checking the farmer session', () => {
    getClient.mockReturnValue({
      auth: {
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
        getSession: vi.fn(() => new Promise(() => {})),
      },
    })
    render(<FarmerAccount onBackToDemo={vi.fn()} />)

    expect(
      screen.getByRole('status', { name: 'Checking secure farmer session…' }),
    ).toBeInTheDocument()
    expect(document.querySelector('.soilsync-loading-brand')).toBeInTheDocument()
  })

  it('skips the duplicate account-link request when the route has verified the farmer role', async () => {
    const session = testSession()
    getClient.mockReturnValue({
      auth: {
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
        getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
      },
    })
    render(<FarmerAccount onBackToDemo={vi.fn()} roleVerifiedByRoute />)

    expect(await screen.findByRole('heading', { name: 'Welcome, Amina Njeri' })).toBeInTheDocument()
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url) === '/api/v1/auth/link')).toBe(
      false,
    )
  })

  it('still shows a verified report when the readings request fails', async () => {
    const session = testSession()
    const originalFetch = vi.mocked(fetch)
    getClient.mockReturnValue({
      auth: {
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
        getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url === '/api/v1/farms/farm-1/readings') {
          return jsonResponse({ detail: 'Soil readings are temporarily unavailable.' }, 500)
        }
        if (url === '/api/v1/farms/farm-1/reports/verified') {
          return jsonResponse({
            reportId: 'report-1',
            assessmentId: 'assessment-1',
            farmId: 'farm-1',
            farmName: 'Kiboko Farm',
            crop: 'maize',
            county: 'Makueni',
            publishedAt: '2026-10-03T15:00:00Z',
            publishedBy: {
              agronomistId: 'agronomist-1',
              name: 'Dr. Test',
              licenseNumber: 'TEST-1',
            },
            status: 'verified',
            diagnoses: [],
            prescriptions: [],
            commercialInputs: [],
            splitSchedule: [],
            aiAdvisoryNotes: [],
            certification: 'Certified report',
          })
        }
        return originalFetch(input, init)
      }),
    )
    render(<FarmerAccount onBackToDemo={vi.fn()} roleVerifiedByRoute />)

    expect(
      await screen.findByRole('heading', { name: 'Verified Soil Assessment for Kiboko Farm' }),
    ).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Soil readings: Soil readings are temporarily unavailable.',
    )
  })

  it('explains missing Auth configuration and provides a path back to the role directory', async () => {
    const onBackToDemo = vi.fn()
    getClient.mockReturnValue(null)
    render(<FarmerAccount onBackToDemo={onBackToDemo} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Supabase Auth is not configured')
    fireEvent.click(screen.getByRole('button', { name: 'Back to role directory' }))
    expect(onBackToDemo).toHaveBeenCalledOnce()
  })

  it('clears local account state when server-side logout cannot be confirmed', async () => {
    const session = testSession()
    const supabase = {
      auth: {
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    }
    getClient.mockReturnValue(supabase)
    const originalFetch = vi.mocked(fetch)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === '/api/v1/auth/logout')
          return jsonResponse({ detail: 'service unavailable' }, 503)
        return originalFetch(input, init)
      }),
    )
    render(<FarmerAccount onBackToDemo={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Welcome, Amina Njeri' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign in to your farm' }),
    ).toBeInTheDocument()
    expect(
      await screen.findByText(/server session revocation could not be confirmed/),
    ).toBeInTheDocument()
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('shows only farms owned by the authenticated farmer and supports switching between multiple owned farms', async () => {
    const session = testSession()
    const multiFarmProfile: FarmerProfile = {
      farmerId: 'app-user-1',
      name: 'Amina Njeri',
      phone: '+254700000001',
      farmId: 'farm-1',
      farmName: 'Kiboko Farm',
      ownerVerified: true,
      farms: [
        {
          farmId: 'farm-1',
          name: 'Kiboko Farm',
          county: 'Makueni',
          ward: 'Kiboko',
          latitude: null,
          longitude: null,
          ownerVerified: true,
          createdAt: '2026-10-02T00:00:00Z',
          updatedAt: '2026-10-02T00:00:00Z',
        },
        {
          farmId: 'farm-2',
          name: 'Yatta South Plot',
          county: 'Machakos',
          ward: 'Yatta',
          latitude: null,
          longitude: null,
          ownerVerified: false,
          createdAt: '2026-10-02T00:00:00Z',
          updatedAt: '2026-10-02T00:00:00Z',
        },
      ],
    }

    const supabase = {
      auth: {
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    }
    getClient.mockReturnValue(supabase)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/v1/auth/link') {
          return jsonResponse({
            status: 'linked',
            appUserId: 'app-user-1',
            identityProvider: 'supabase',
            role: 'farmer',
          })
        }
        if (url === '/api/v1/farms/me') return jsonResponse(multiFarmProfile)
        if (url === '/api/v1/farms/farm-1/readings') return jsonResponse([farmerReading()])
        if (url === '/api/v1/farms/farm-1/recommendations')
          return jsonResponse([farmerRecommendation()])
        if (url === '/api/v1/farms/farm-2/readings') return jsonResponse([])
        if (url === '/api/v1/farms/farm-2/recommendations') return jsonResponse([])
        if (url === '/api/v1/recommendations/recommendation-1/feedback') return jsonResponse([])
        return jsonResponse({ detail: 'Not found' }, 404)
      }),
    )

    render(<FarmerAccount onBackToDemo={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Welcome, Amina Njeri' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Kiboko Farm' })).toBeInTheDocument()
    expect(screen.getByText('Ownership verified')).toBeInTheDocument()

    const picker = screen.getByRole('combobox', { name: 'Farm' })
    expect(picker).toBeInTheDocument()
    expect(within(picker).getByRole('option', { name: 'Kiboko Farm' })).toBeInTheDocument()
    expect(within(picker).getByRole('option', { name: 'Yatta South Plot' })).toBeInTheDocument()
    expect(within(picker).queryByRole('option', { name: 'Foreign Farm' })).not.toBeInTheDocument()

    fireEvent.change(picker, { target: { value: 'farm-2' } })
    expect(await screen.findByRole('heading', { name: 'Yatta South Plot' })).toBeInTheDocument()
    expect((await screen.findAllByText('Ownership review pending')).length).toBeGreaterThanOrEqual(
      1,
    )
  })

  it('displays reading details with analyte, value, unit, depth, quality, source, and provenance', async () => {
    const session = testSession()
    const profile = farmerProfile()
    const richReading: SoilReading = {
      contractVersion: 1,
      readingId: 'reading-detail-1',
      farmId: 'farm-1',
      source: {
        provider: 'PROJECT_SOIL_DATASET',
        datasetId: 'kenya-soil-2026',
        recordId: 'sample-9988',
        license: 'CC-BY-4.0',
        attribution: 'National Agricultural Research Dataset',
        retrievedAt: '2026-10-01T00:00:00Z',
      },
      sample: {
        sampledAt: '2026-08-15T00:00:00Z',
        sampleYear: 2026,
        depth: { sourceLabel: 'topsoil 0-15 cm', topCm: 0, bottomCm: 15 },
      },
      location: { latitude: -1.29, longitude: 36.82, uncertaintyM: 10 },
      measurements: [
        {
          analyte: 'soil_ph',
          value: 6.4,
          sourceUnit: 'pH',
          canonicalUnit: 'pH',
          analyticalMethod: '1:2.5 H2O',
          qualityStatus: 'valid',
          uncertainty: { intervalLevel: 0.95, lower: 6.3, upper: 6.5 },
        },
        {
          analyte: 'total_nitrogen',
          value: 0.18,
          sourceUnit: '%',
          canonicalUnit: '%',
          analyticalMethod: 'Kjeldahl',
          qualityStatus: 'valid',
          uncertainty: null,
        },
      ],
    }

    const supabase = {
      auth: {
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    }
    getClient.mockReturnValue(supabase)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/v1/auth/link')
          return jsonResponse({
            status: 'linked',
            appUserId: 'app-user-1',
            identityProvider: 'supabase',
            role: 'farmer',
          })
        if (url === '/api/v1/farms/me') return jsonResponse(profile)
        if (url === '/api/v1/farms/farm-1/readings') return jsonResponse([richReading])
        if (url === '/api/v1/farms/farm-1/recommendations') return jsonResponse([])
        return jsonResponse({ detail: 'Not found' }, 404)
      }),
    )

    render(<FarmerAccount onBackToDemo={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Welcome, Amina Njeri' })).toBeInTheDocument()
    expect(await screen.findByText('topsoil 0-15 cm')).toBeInTheDocument()
    expect(screen.getByText('soil ph')).toBeInTheDocument()
    expect(screen.getByText('6.4 pH')).toBeInTheDocument()
    expect(screen.getByText('total nitrogen')).toBeInTheDocument()
    expect(screen.getByText('0.18 %')).toBeInTheDocument()
    expect(screen.getAllByText('Measured').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/PROJECT_SOIL_DATASET/)).toBeInTheDocument()
    expect(screen.getByText(/National Agricultural Research Dataset/)).toBeInTheDocument()
    expect(screen.getByText(/Dataset: kenya-soil-2026/)).toBeInTheDocument()
    expect(screen.getByText(/Record: sample-9988/)).toBeInTheDocument()
  })

  it('distinguishes measured, estimated, missing, invalid, and sample preview quality statuses', async () => {
    const session = testSession()
    const profile = farmerProfile()
    const mixedQualityReading: SoilReading = {
      contractVersion: 1,
      readingId: 'reading-qual-all',
      farmId: 'farm-1',
      source: {
        provider: 'ISRIC_SOILGRIDS',
        datasetId: 'soilgrids-v2',
        recordId: 'point-1234',
        license: 'CC-BY-4.0',
        attribution: 'ISRIC World Soil Information',
        retrievedAt: '2026-10-01T00:00:00Z',
      },
      sample: {
        sampledAt: '2026-07-01T00:00:00Z',
        sampleYear: 2026,
        depth: { sourceLabel: '0-20 cm', topCm: 0, bottomCm: 20 },
      },
      location: { latitude: -1.2, longitude: 36.8, uncertaintyM: 250 },
      measurements: [
        {
          analyte: 'soil_ph',
          value: 6.1,
          sourceUnit: 'pH',
          canonicalUnit: 'pH',
          analyticalMethod: null,
          qualityStatus: 'valid',
          uncertainty: null,
        },
        {
          analyte: 'total_nitrogen',
          value: 0.12,
          sourceUnit: '%',
          canonicalUnit: '%',
          analyticalMethod: null,
          qualityStatus: 'estimated',
          uncertainty: { intervalLevel: 0.95, lower: 0.09, upper: 0.15 },
        },
        {
          analyte: 'organic_carbon',
          value: null,
          sourceUnit: '%',
          canonicalUnit: null,
          analyticalMethod: null,
          qualityStatus: 'missing',
          uncertainty: null,
        },
        {
          analyte: 'olsen_phosphorus',
          value: null,
          sourceUnit: 'ppm',
          canonicalUnit: null,
          analyticalMethod: null,
          qualityStatus: 'invalid_source_value',
          uncertainty: null,
        },
        {
          analyte: 'exchangeable_potassium',
          value: 0.45,
          sourceUnit: 'meq%',
          canonicalUnit: 'meq%',
          analyticalMethod: null,
          qualityStatus: 'sample',
          uncertainty: null,
        },
      ],
    }

    const supabase = {
      auth: {
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    }
    getClient.mockReturnValue(supabase)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/v1/auth/link')
          return jsonResponse({
            status: 'linked',
            appUserId: 'app-user-1',
            identityProvider: 'supabase',
            role: 'farmer',
          })
        if (url === '/api/v1/farms/me') return jsonResponse(profile)
        if (url === '/api/v1/farms/farm-1/readings') return jsonResponse([mixedQualityReading])
        if (url === '/api/v1/farms/farm-1/recommendations') return jsonResponse([])
        return jsonResponse({ detail: 'Not found' }, 404)
      }),
    )

    render(<FarmerAccount onBackToDemo={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Welcome, Amina Njeri' })).toBeInTheDocument()
    expect(screen.getByText('Measured')).toBeInTheDocument()
    expect(screen.getByText('6.1 pH')).toBeInTheDocument()

    expect(screen.getByText('Estimated')).toBeInTheDocument()
    expect(screen.getByText('0.12 %')).toBeInTheDocument()

    expect(screen.getAllByText('Missing').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Invalid').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Preview sample')).toBeInTheDocument()
  })

  it('shows only recommendations linked to the allowed farm with rule version and review status', async () => {
    const session = testSession()
    const profile = farmerProfile()
    const farmRecommendations: SoilRecommendation[] = [
      {
        recommendationId: 'rec-farm-1',
        farmId: 'farm-1',
        crop: 'maize',
        title: 'Targeted Nitrogen Application',
        rationale: 'Soil nitrogen levels are below optimal threshold for maize growth.',
        applicationRate: 50,
        applicationUnit: 'kg/ha',
        ruleVersion: 'v2.1.0',
        reviewStatus: 'pending_review',
      },
    ]

    const supabase = {
      auth: {
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    }
    getClient.mockReturnValue(supabase)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/v1/auth/link')
          return jsonResponse({
            status: 'linked',
            appUserId: 'app-user-1',
            identityProvider: 'supabase',
            role: 'farmer',
          })
        if (url === '/api/v1/farms/me') return jsonResponse(profile)
        if (url === '/api/v1/farms/farm-1/readings') return jsonResponse([])
        if (url === '/api/v1/farms/farm-1/recommendations') return jsonResponse(farmRecommendations)
        if (url === '/api/v1/recommendations/rec-farm-1/feedback') return jsonResponse([])
        return jsonResponse({ detail: 'Not found' }, 404)
      }),
    )

    render(<FarmerAccount onBackToDemo={vi.fn()} />)

    expect(
      await screen.findByRole('heading', { name: 'Targeted Nitrogen Application' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Crop: maize')).toBeInTheDocument()
    expect(screen.getByText('pending review')).toBeInTheDocument()
    expect(screen.getByText('v2.1.0')).toBeInTheDocument()
    expect(
      screen.getByText('Soil nitrogen levels are below optimal threshold for maize growth.'),
    ).toBeInTheDocument()
    expect(screen.getByText(/50 kg\/ha/)).toBeInTheDocument()
    expect(
      screen.getByText(/Guidance remains non-actionable pending agronomic approval/),
    ).toBeInTheDocument()
  })

  it('creates a new farm with cascading Kenyan County, Sub-county, and Ward dropdowns', async () => {
    const session = testSession()
    const emptyFarmProfile: FarmerProfile = {
      farmerId: 'app-user-1',
      name: 'Amina Njeri',
      phone: '+254700000001',
      farmId: null,
      farmName: null,
      ownerVerified: true,
      farms: [],
    }
    const createdFarm = {
      farmId: 'farm-new-1',
      name: 'Simba Hills Orchard',
      county: 'Machakos',
      subCounty: 'Yatta',
      ward: 'Ikombe',
      latitude: null,
      longitude: null,
      ownerVerified: false,
      createdAt: '2026-10-02T00:00:00Z',
      updatedAt: '2026-10-02T00:00:00Z',
    }
    const populatedProfile: FarmerProfile = {
      ...emptyFarmProfile,
      farmId: 'farm-new-1',
      farmName: 'Simba Hills Orchard',
      farms: [createdFarm],
    }

    const supabase = {
      auth: {
        onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    }
    getClient.mockReturnValue(supabase)

    let createdPayload: Record<string, unknown> | null = null
    let profileCalls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? 'GET'
        if (url === '/api/v1/auth/link')
          return jsonResponse({
            status: 'linked',
            appUserId: 'app-user-1',
            identityProvider: 'supabase',
            role: 'farmer',
          })
        if (url === '/api/v1/farms/me') {
          profileCalls++
          return jsonResponse(profileCalls > 1 ? populatedProfile : emptyFarmProfile)
        }
        if (url === '/api/v1/farms' && method === 'POST') {
          createdPayload = JSON.parse(String(init?.body)) as Record<string, unknown>
          return jsonResponse(createdFarm, 201)
        }
        if (url === '/api/v1/farms/farm-new-1/readings') return jsonResponse([])
        if (url === '/api/v1/farms/farm-new-1/recommendations') return jsonResponse([])
        return jsonResponse({ detail: 'Not found' }, 404)
      }),
    )

    render(<FarmerAccount onBackToDemo={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Register your farm' })).toBeInTheDocument()

    const countySelect = screen.getByRole('combobox', { name: 'County' })
    const subCountySelect = screen.getByRole('combobox', { name: 'Sub-county' })
    const wardSelect = screen.getByRole('combobox', { name: 'Ward' })

    expect(subCountySelect).toBeDisabled()
    expect(wardSelect).toBeDisabled()

    fireEvent.change(screen.getByRole('textbox', { name: 'Farm name' }), {
      target: { value: 'Simba Hills Orchard' },
    })
    fireEvent.change(countySelect, { target: { value: 'Machakos' } })

    expect(subCountySelect).not.toBeDisabled()
    expect(within(subCountySelect).getByRole('option', { name: 'Yatta' })).toBeInTheDocument()

    fireEvent.change(subCountySelect, { target: { value: 'Yatta' } })

    expect(wardSelect).not.toBeDisabled()
    expect(within(wardSelect).getByRole('option', { name: 'Ikombe' })).toBeInTheDocument()

    fireEvent.change(wardSelect, { target: { value: 'Ikombe' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save farm' }))

    expect(await screen.findByRole('heading', { name: 'Simba Hills Orchard' })).toBeInTheDocument()
    expect(createdPayload).toEqual({
      name: 'Simba Hills Orchard',
      county: 'Machakos',
      subCounty: 'Yatta',
      ward: 'Ikombe',
    })
    expect(screen.getByText('INCOMPLETE — VISIT NEEDED')).toBeInTheDocument()
    expect(screen.getByText(/Ikombe · Yatta · Machakos/)).toBeInTheDocument()
  })
})
