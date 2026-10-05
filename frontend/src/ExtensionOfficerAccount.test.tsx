import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ExtensionOfficerAccount from './ExtensionOfficerAccount'
import * as officerApi from './api/officer'

const { getClient } = vi.hoisted(() => ({ getClient: vi.fn().mockReturnValue(null) }))
vi.mock('./lib/supabase', () => ({ getSupabaseClient: getClient }))

vi.mock('./api/officer', () => ({
  getOfficerJurisdictions: vi.fn(),
  getOfficerFarmerRoster: vi.fn(),
  getOfficerVisits: vi.fn(),
  getOfficerVisitPool: vi.fn(),
  claimOfficerVisit: vi.fn(),
  releaseOfficerVisit: vi.fn(),
  scheduleOfficerVisit: vi.fn(),
  updateOfficerVisit: vi.fn(),
  getOfficerAlerts: vi.fn(),
  createOfficerAlert: vi.fn(),
  triageOfficerAlert: vi.fn(),
  getOfficerWardSummaries: vi.fn(),
  fetchUnclaimedFarmers: vi.fn(),
  registerUnclaimedFarmer: vi.fn(),
  exportOfficerReport: vi.fn(),
  recordOfficerFieldCollection: vi.fn(),
  getUnverifiedAssessments: vi.fn(),
  claimAssessment: vi.fn(),
  releaseAssessment: vi.fn(),
  editAssessment: vi.fn(),
  publishAssessment: vi.fn(),
}))

const mockJurisdictions: officerApi.OfficerJurisdiction[] = [
  {
    assignmentId: 'assign-1',
    county: 'Nyeri',
    subCounty: 'Mukurweini',
    ward: 'Rugi',
    assignedAt: '2026-09-01T08:00:00Z',
  },
]

const mockRoster: officerApi.OfficerFarmerRosterItem[] = [
  {
    farmerId: 'farmer-1',
    name: 'Wanjiku Farmer',
    farmId: 'farm-1',
    farmName: 'Rugi Green Farm',
    county: 'Nyeri',
    subCounty: 'Mukurweini',
    ward: 'Rugi',
    readingCount: 5,
  },
]

const mockVisits: officerApi.OfficerVisitItem[] = [
  {
    visitId: 'visit-1',
    officerUserId: 'officer-1',
    farmerId: 'farmer-1',
    farmerName: 'Wanjiku Farmer',
    farmId: 'farm-1',
    farmName: 'Rugi Green Farm',
    plannedDate: '2026-10-15T10:00:00Z',
    status: 'scheduled',
    notes: 'Soil acidity followup',
    createdAt: '2026-10-01T08:00:00Z',
    updatedAt: '2026-10-01T08:00:00Z',
  },
]

const mockAlerts: officerApi.OfficerAlertItem[] = [
  {
    alertId: 'alert-1',
    officerUserId: 'officer-1',
    farmerId: 'farmer-1',
    farmerName: 'Wanjiku Farmer',
    farmId: 'farm-1',
    farmName: 'Rugi Green Farm',
    source: 'Soil Test',
    severity: 'critical',
    status: 'open',
    title: 'Severe Acidity Detected',
    summary: 'pH 4.8 requires agricultural lime.',
    notes: 'Farmer notified',
    resolutionNotes: null,
    resolvedAt: null,
    createdAt: '2026-10-01T08:00:00Z',
    updatedAt: '2026-10-01T08:00:00Z',
  },
]

const mockWardSummaries: officerApi.OfficerWardSummaryItem[] = [
  {
    county: 'Nyeri',
    subCounty: 'Mukurweini',
    ward: 'Rugi',
    farmerCount: 12,
    farmCount: 15,
    readingCount: 28,
    sampleCount: 140,
    aggregationLimits:
      'Ward-level aggregate. Small cohorts (<3 samples) protected to prevent re-identification.',
    dataFreshness: '2026-09-30T10:00:00Z',
  },
]

const mockVisitPool: officerApi.OfficerVisitItem[] = [
  {
    visitId: 'pool-visit-1',
    officerUserId: null,
    farmerId: 'farmer-pool-1',
    farmerName: 'Kariuki Farmer',
    farmerPhone: '+254712345678',
    farmId: 'farm-pool-1',
    farmName: 'Highland Farm',
    county: 'Nyeri',
    subCounty: 'Mukurweini',
    ward: 'Rugi',
    plannedDate: null,
    status: 'requested',
    notes: 'Need soil test before planting season',
    createdAt: '2026-10-02T08:00:00Z',
    updatedAt: '2026-10-02T08:00:00Z',
  },
]

const confirmGpsConsent = () => {
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: /I confirm the farmer has explicitly consented to recording exact GPS/i,
    }),
  )
  fireEvent.change(screen.getByPlaceholderText(/Farmer verbally agreed/i), {
    target: { value: 'Farmer verbally agreed to capture exact GPS for this visit.' },
  })
}

const mockAssessments: officerApi.UnverifiedAssessmentItem[] = [
  {
    assessmentId: 'assess-1',
    farmId: 'farm-1',
    farmName: 'Rugi Green Farm',
    farmerName: 'Wanjiku Farmer',
    readingId: 'reading-1',
    crop: 'maize',
    county: 'Nyeri',
    status: 'unverified',
    reviewStage: 'review_requested',
    claimingAgronomistId: null,
    engineVersion: 'kalro-v1',
    engineBaseline: {
      engineVersion: 'kalro-v1',
      crop: 'maize',
      farmAcreage: 2.5,
      regionalZone: 'Central Highlands',
      diagnoses: [
        {
          analyte: 'soil_ph',
          value: 5.2,
          targetRange: '5.8 - 6.5',
          status: 'warning',
          interpretation: 'Soil is moderately acidic. Apply agricultural lime.',
        },
      ],
      prescriptions: [
        {
          category: 'Liming',
          productType: 'Agricultural Lime',
          ratePerHa: '2.0 t/ha',
          ratePerAcre: '0.8 t/acre',
          totalFarmPrescription: '4.0 tonnes (80 bags of 50kg)',
          applicationTiming: 'Broadcast 30 days before planting',
        },
      ],
      commercialInputs: [
        {
          category: 'Liming',
          commercialFormulation: 'Agricultural Lime (Fine Ground)',
          purpose: 'Correct soil acidity',
          totalBagsNeeded: 80,
          bagUnit: '50kg bags',
        },
      ],
      splitSchedule: [
        {
          stage: 'Land Preparation',
          action: 'Apply lime uniformly',
        },
      ],
      aiAdvisoryNotes: [
        'Central Highlands highland soils have high phosphate fixation. Ensure basal DAP is banded.',
      ],
      disclaimer: 'KALRO agronomic engine recommendation.',
    },
    officerEdits: [],
    agronomistEdits: [],
    createdAt: '2026-10-01T09:00:00Z',
  },
]

describe('ExtensionOfficerAccount component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(officerApi.getOfficerJurisdictions).mockResolvedValue(mockJurisdictions)
    vi.mocked(officerApi.getOfficerFarmerRoster).mockResolvedValue(mockRoster)
    vi.mocked(officerApi.getOfficerVisits).mockResolvedValue(mockVisits)
    vi.mocked(officerApi.getOfficerVisitPool).mockResolvedValue(mockVisitPool)
    vi.mocked(officerApi.claimOfficerVisit).mockResolvedValue({
      ...mockVisitPool[0],
      status: 'claimed',
      officerUserId: 'officer-1',
    })
    vi.mocked(officerApi.releaseOfficerVisit).mockResolvedValue({
      ...mockVisits[0],
      status: 'requested',
      officerUserId: null,
    })
    vi.mocked(officerApi.getOfficerAlerts).mockResolvedValue(mockAlerts)
    vi.mocked(officerApi.getOfficerWardSummaries).mockResolvedValue(mockWardSummaries)
    vi.mocked(officerApi.getUnverifiedAssessments).mockResolvedValue(mockAssessments)
    vi.mocked(officerApi.fetchUnclaimedFarmers).mockResolvedValue([])
  })

  it('renders sign-in and dev bearer token form when unauthenticated', () => {
    render(<ExtensionOfficerAccount onBackToDemo={vi.fn()} />)

    expect(screen.getByText('Extension Officer Workspace')).toBeInTheDocument()
    expect(screen.getByText('Staff Sign-In (Email & Password)')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('officer@kilimo.go.ke')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('valid-officer-token')).toBeInTheDocument()
  })

  it('authenticates with token and loads jurisdiction-scoped records, privacy notice, roster, visits, and alerts', async () => {
    render(<ExtensionOfficerAccount onBackToDemo={vi.fn()} />)

    const tokenInput = screen.getByPlaceholderText('valid-officer-token')
    fireEvent.change(tokenInput, { target: { value: 'test-officer-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use Officer Token' }))

    // Expect privacy minimization banner
    await waitFor(() => {
      expect(screen.getByText('Officer Data Minimization Policy Enforced')).toBeInTheDocument()
    })
    expect(
      screen.getByText(
        /farmer phone numbers, national IDs, and exact GPS coordinates are excluded/i,
      ),
    ).toBeInTheDocument()

    // Expect assigned jurisdiction badge
    expect(screen.getByText(/Nyeri County • Mukurweini • Rugi Ward/)).toBeInTheDocument()

    // Expect farmer roster (may appear in multiple sections: roster and visits)
    await waitFor(() => {
      expect(screen.getAllByText('Wanjiku Farmer').length).toBeGreaterThan(0)
      expect(screen.getAllByText(/Rugi Green Farm/).length).toBeGreaterThan(0)
    })

    // Expect planned visit
    expect(screen.getByText(/Soil acidity followup/)).toBeInTheDocument()

    // Expect alert
    expect(screen.getByText('Severe Acidity Detected')).toBeInTheDocument()
    expect(screen.getByText('pH 4.8 requires agricultural lime.')).toBeInTheDocument()

    // Expect ward summary and aggregation limits
    expect(screen.getByText('Ward Summaries & Aggregation Limits')).toBeInTheDocument()
    expect(screen.getByText(/Small cohorts \(<3 samples\) protected/)).toBeInTheDocument()
  })

  it('schedules a field visit for an assigned farmer', async () => {
    vi.mocked(officerApi.scheduleOfficerVisit).mockResolvedValue({
      visitId: 'visit-2',
      officerUserId: 'officer-1',
      farmerId: 'farmer-1',
      farmerName: 'Wanjiku Farmer',
      farmId: 'farm-1',
      farmName: 'Rugi Green Farm',
      plannedDate: '2026-10-20T14:00:00Z',
      status: 'scheduled',
      notes: 'Soil test review with farmer',
      createdAt: '2026-10-02T10:00:00Z',
      updatedAt: '2026-10-02T10:00:00Z',
    })

    render(<ExtensionOfficerAccount onBackToDemo={vi.fn()} />)

    const tokenInput = screen.getByPlaceholderText('valid-officer-token')
    fireEvent.change(tokenInput, { target: { value: 'test-officer-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use Officer Token' }))

    await waitFor(() => {
      expect(screen.getAllByText('Wanjiku Farmer').length).toBeGreaterThan(0)
    })

    // Click Schedule Visit button
    const scheduleButtons = screen.getAllByRole('button', { name: /schedule visit/i })
    fireEvent.click(scheduleButtons[0])

    expect(screen.getByText('Schedule Field Visit')).toBeInTheDocument()

    const dateInput = screen.getByLabelText(/planned date & time/i)
    fireEvent.change(dateInput, { target: { value: '2026-10-20T14:00' } })

    const notesInput = screen.getByPlaceholderText(/inspect soil sampling results/i)
    fireEvent.change(notesInput, { target: { value: 'Soil test review with farmer' } })

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Schedule Visit' }))

    await waitFor(() => {
      expect(officerApi.scheduleOfficerVisit).toHaveBeenCalledWith(
        'test-officer-token',
        expect.objectContaining({
          farmerId: 'farmer-1',
          notes: 'Soil test review with farmer',
        }),
      )
    })
    expect(screen.getByText(/Soil test review with farmer/)).toBeInTheDocument()
  })

  it('triages an agronomic alert by resolving with notes', async () => {
    vi.mocked(officerApi.triageOfficerAlert).mockResolvedValue({
      ...mockAlerts[0],
      status: 'resolved',
      resolutionNotes: 'Advised 200kg agricultural lime application.',
      resolvedAt: '2026-10-02T11:00:00Z',
    })

    render(<ExtensionOfficerAccount onBackToDemo={vi.fn()} />)

    const tokenInput = screen.getByPlaceholderText('valid-officer-token')
    fireEvent.change(tokenInput, { target: { value: 'test-officer-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use Officer Token' }))

    await waitFor(() => {
      expect(screen.getByText('Severe Acidity Detected')).toBeInTheDocument()
    })

    // Click Resolve with Notes
    fireEvent.click(screen.getByRole('button', { name: 'Resolve with Notes' }))

    const resInput = screen.getByPlaceholderText(/prescribed 200 kg\/acre/i)
    fireEvent.change(resInput, {
      target: { value: 'Advised 200kg agricultural lime application.' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Resolution' }))

    await waitFor(() => {
      expect(officerApi.triageOfficerAlert).toHaveBeenCalledWith(
        'test-officer-token',
        'alert-1',
        expect.objectContaining({
          status: 'resolved',
          resolutionNotes: 'Advised 200kg agricultural lime application.',
        }),
      )
    })
    expect(screen.getByText(/Advised 200kg agricultural lime application/)).toBeInTheDocument()
  })

  it('exports an audited report with allowlisted fields and privacy disclaimer', async () => {
    vi.mocked(officerApi.exportOfficerReport).mockResolvedValue({
      exportId: 'exp-789012',
      officerUserId: 'officer-1',
      scope: { county: 'Nyeri', subCounty: 'Mukurweini', ward: 'Rugi' },
      allowlistedFields: [
        'readingId',
        'farmerName',
        'farmName',
        'county',
        'ward',
        'analyte',
        'value',
        'unit',
      ],
      privacyDisclaimer:
        'Exported under reviewed extension services access policy. Phone numbers, national IDs, and exact coordinates are strictly excluded.',
      recordCount: 15,
      exportedAt: '2026-10-02T12:00:00Z',
      records: [],
    })

    render(<ExtensionOfficerAccount onBackToDemo={vi.fn()} />)

    const tokenInput = screen.getByPlaceholderText('valid-officer-token')
    fireEvent.change(tokenInput, { target: { value: 'test-officer-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use Officer Token' }))

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /export jurisdiction report/i }),
      ).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /export jurisdiction report/i }))

    await waitFor(() => {
      expect(officerApi.exportOfficerReport).toHaveBeenCalled()
    })

    expect(screen.getByText('Export Generated: exp-789012')).toBeInTheDocument()
    expect(
      screen.getByText(/Phone numbers, national IDs, and exact coordinates are strictly excluded/),
    ).toBeInTheDocument()
  })

  it('renders County Visit Pool and allows claiming an unassigned visit request', async () => {
    render(<ExtensionOfficerAccount onBackToDemo={vi.fn()} />)

    const tokenInput = screen.getByPlaceholderText('valid-officer-token')
    fireEvent.change(tokenInput, { target: { value: 'test-officer-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use Officer Token' }))

    // Expect County Visit Pool section and pool items
    await waitFor(() => {
      expect(screen.getByText(/Unassigned Visit Requests/i)).toBeInTheDocument()
      expect(screen.getByText('Kariuki Farmer')).toBeInTheDocument()
      expect(screen.getByText(/Highland Farm/)).toBeInTheDocument()
      expect(screen.getByText(/Need soil test before planting season/)).toBeInTheDocument()
    })

    // Click Claim Visit
    const claimBtn = screen.getByRole('button', { name: /Claim Visit/i })
    fireEvent.click(claimBtn)

    await waitFor(() => {
      expect(officerApi.claimOfficerVisit).toHaveBeenCalledWith(
        'test-officer-token',
        'pool-visit-1',
      )
      expect(screen.getByText(/Visit request claimed successfully!/i)).toBeInTheDocument()
    })
  })

  it('allows releasing a visit back to the county visit pool', async () => {
    render(<ExtensionOfficerAccount onBackToDemo={vi.fn()} />)

    const tokenInput = screen.getByPlaceholderText('valid-officer-token')
    fireEvent.change(tokenInput, { target: { value: 'test-officer-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use Officer Token' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Release to Pool/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Release to Pool/i }))

    await waitFor(() => {
      expect(officerApi.releaseOfficerVisit).toHaveBeenCalledWith('test-officer-token', 'visit-1')
      expect(
        screen.getByText(/Visit released back to the unassigned county pool/i),
      ).toBeInTheDocument()
    })
  })

  it('allows recording on-site field collection and GPS coordinates', async () => {
    vi.mocked(officerApi.recordOfficerFieldCollection).mockResolvedValueOnce({
      visitId: 'visit-1',
      readingId: 'reading-1',
      latitude: 0.0512,
      longitude: 34.7521,
      status: 'completed',
      soilDataCollected: true,
      farmId: 'farm-1',
      message: 'Field collection recorded successfully and farm coordinates updated.',
    })

    render(<ExtensionOfficerAccount onBackToDemo={vi.fn()} />)

    const tokenInput = screen.getByPlaceholderText('valid-officer-token')
    fireEvent.change(tokenInput, { target: { value: 'test-officer-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use Officer Token' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Collect Field Data/i })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Collect Field Data/i }))

    expect(screen.getByText('On-Site Field Data & GPS Capture')).toBeInTheDocument()

    confirmGpsConsent()
    fireEvent.click(screen.getByRole('button', { name: /Use current location/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Location is unavailable in this browser.')

    fireEvent.change(screen.getByPlaceholderText('e.g. 0.0512'), { target: { value: '0.0512' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. 34.7521'), { target: { value: '34.7521' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. 10'), { target: { value: '8.5' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. 5.8'), { target: { value: '6.2' } })

    fireEvent.click(screen.getByRole('button', { name: /Save & Mark Complete/i }))

    await waitFor(() => {
      expect(officerApi.recordOfficerFieldCollection).toHaveBeenCalledWith(
        'test-officer-token',
        'visit-1',
        expect.objectContaining({
          latitude: 0.0512,
          longitude: 34.7521,
          markCompleted: true,
        }),
      )
      expect(
        screen.getByText(/Field collection recorded successfully and farm coordinates updated/i),
      ).toBeInTheDocument()
    })
  })

  it('automatically captures device coordinates and estimated accuracy for field collection', async () => {
    const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation')
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((success: PositionCallback) =>
          success({
            coords: {
              latitude: -0.4215,
              longitude: 36.9512,
              accuracy: 7.7,
            } as GeolocationCoordinates,
            timestamp: Date.now(),
          } as GeolocationPosition),
        ),
      },
    })

    render(<ExtensionOfficerAccount onBackToDemo={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('valid-officer-token'), {
      target: { value: 'test-officer-token' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Use Officer Token' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Collect Field Data/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /Collect Field Data/i }))
    confirmGpsConsent()
    fireEvent.click(screen.getByRole('button', { name: /Use current location/i }))

    expect(await screen.findByText(/estimated accuracy ±7\.7 m/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Latitude')).toHaveValue(-0.4215)
    expect(screen.getByLabelText('Longitude')).toHaveValue(36.9512)
    expect(screen.getByLabelText('Estimated accuracy radius (meters)')).toHaveValue(7.7)

    if (originalGeolocation) {
      Object.defineProperty(navigator, 'geolocation', originalGeolocation)
    } else {
      Reflect.deleteProperty(navigator, 'geolocation')
    }
  })

  it('explains denied location permission and leaves manual coordinates available', async () => {
    const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation')
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((_success: PositionCallback, failure?: PositionErrorCallback) =>
          failure?.({
            code: 1,
            message: 'Permission denied.',
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          } as GeolocationPositionError),
        ),
      },
    })

    render(<ExtensionOfficerAccount onBackToDemo={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('valid-officer-token'), {
      target: { value: 'test-officer-token' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Use Officer Token' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Collect Field Data/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /Collect Field Data/i }))
    confirmGpsConsent()
    fireEvent.click(screen.getByRole('button', { name: /Use current location/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Location permission was denied.')
    expect(screen.getByLabelText('Latitude')).toBeEnabled()
    expect(screen.getByLabelText('Estimated accuracy radius (meters)')).toBeEnabled()

    if (originalGeolocation) {
      Object.defineProperty(navigator, 'geolocation', originalGeolocation)
    } else {
      Reflect.deleteProperty(navigator, 'geolocation')
    }
  })

  it('warns when the automatic location fix has coarse accuracy', async () => {
    const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation')
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn((success: PositionCallback) =>
          success({
            coords: {
              latitude: -0.4215,
              longitude: 36.9512,
              accuracy: 120,
            } as GeolocationCoordinates,
            timestamp: Date.now(),
          } as GeolocationPosition),
        ),
      },
    })

    render(<ExtensionOfficerAccount onBackToDemo={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('valid-officer-token'), {
      target: { value: 'test-officer-token' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Use Officer Token' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Collect Field Data/i })).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /Collect Field Data/i }))
    confirmGpsConsent()
    fireEvent.click(screen.getByRole('button', { name: /Use current location/i }))

    expect(
      await screen.findByText(/This is a coarse location fix \(over 50 m\)/i),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Estimated accuracy radius (meters)')).toHaveValue(120)

    if (originalGeolocation) {
      Object.defineProperty(navigator, 'geolocation', originalGeolocation)
    } else {
      Reflect.deleteProperty(navigator, 'geolocation')
    }
  })

  it('allows the officer to sign out and clears the workspace', async () => {
    render(<ExtensionOfficerAccount onBackToDemo={vi.fn()} />)

    const tokenInput = screen.getByPlaceholderText('valid-officer-token')
    fireEvent.change(tokenInput, { target: { value: 'test-officer-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use Officer Token' }))

    await waitFor(() => {
      expect(screen.getByText('Extension Officer Portal')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))

    expect(screen.getByText('Extension Officer Workspace')).toBeInTheDocument()
    expect(screen.queryByText('Wanjiku Farmer')).not.toBeInTheDocument()
  })

  it('renders agronomic assessments pipeline and allows inspecting assessment details', async () => {
    vi.mocked(officerApi.claimAssessment).mockResolvedValueOnce({
      assessmentId: 'assess-1',
      claimingAgronomistId: 'agronomist-1',
      reviewStage: 'claimed',
      status: 'unverified',
      message: 'Assessment claimed for agronomist review.',
    })

    render(<ExtensionOfficerAccount onBackToDemo={vi.fn()} />)

    const tokenInput = screen.getByPlaceholderText('valid-officer-token')
    fireEvent.change(tokenInput, { target: { value: 'test-officer-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use Officer Token' }))

    await waitFor(() => {
      expect(screen.getByText(/Agronomic Assessments Pipeline/i)).toBeInTheDocument()
      expect(screen.getByText('Rugi Green Farm')).toBeInTheDocument()
      expect(screen.getByText(/Crop: maize/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /Inspect & Review/i }))

    await waitFor(() => {
      expect(screen.getByText(/KALRO ASSESSMENT PRE-REVIEW/i)).toBeInTheDocument()
      expect(screen.getByText(/1. Soil Diagnoses & Indicators/i)).toBeInTheDocument()
      expect(screen.getByText(/2. Agronomic Prescriptions/i)).toBeInTheDocument()
      expect(screen.getByText(/3. Commercial Fertilizer Bridge/i)).toBeInTheDocument()
      expect(
        screen.getByText(/AI Agronomic Advisory & Regional Insights Layer/i),
      ).toBeInTheDocument()
      expect(
        screen.getByText(/Central Highlands highland soils have high phosphate fixation/i),
      ).toBeInTheDocument()
      expect(screen.getByText('Agronomist verification required')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Claim Assessment/i })).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: /Verify & Publish Official Report/i }),
      ).not.toBeInTheDocument()
    })
    const dialog = screen.getByRole('dialog', { name: /Rugi Green Farm/i })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Inspect & Review/i })).toHaveFocus()
  })
})
