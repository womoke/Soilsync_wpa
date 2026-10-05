import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UnverifiedAssessmentItem } from './api/officer'
import AgronomistAccount from './AgronomistAccount'

const mocks = vi.hoisted(() => ({
  claimAssessment: vi.fn(),
  editAssessment: vi.fn(),
  getUnverifiedAssessments: vi.fn(),
  publishAssessment: vi.fn(),
  releaseAssessment: vi.fn(),
  auth: { session: { access_token: 'agronomist-token', user: { id: 'app-user-1' } } },
}))

vi.mock('./api/officer', () => ({
  claimAssessment: mocks.claimAssessment,
  editAssessment: mocks.editAssessment,
  getUnverifiedAssessments: mocks.getUnverifiedAssessments,
  publishAssessment: mocks.publishAssessment,
  releaseAssessment: mocks.releaseAssessment,
}))

vi.mock('./context/AuthContext', () => ({
  useAuth: () => mocks.auth,
}))

const unclaimedAssessment: UnverifiedAssessmentItem = {
  assessmentId: 'assessment-1',
  farmId: 'farm-1',
  farmName: 'Rugi Green Farm',
  farmerName: 'Amina Njeri',
  readingId: 'reading-1',
  claimingAgronomistId: null,
  status: 'unverified',
  reviewStage: 'review_requested',
  county: 'Nakuru',
  subCounty: 'Njoro',
  ward: 'Mau Narok',
  officerName: 'Field Officer',
  sampledAt: '2026-10-01T08:30:00Z',
  latitude: -0.303,
  longitude: 36.08,
  locationUncertaintyM: 8.5,
  createdAt: '2026-10-01T09:00:00Z',
  crop: 'maize',
  engineVersion: 'test-engine',
  engineBaseline: {
    engineVersion: 'test-engine',
    crop: 'maize',
    farmAcreage: 1,
    regionalZone: 'Central Highlands',
    diagnoses: [
      {
        analyte: 'soil_ph',
        value: 5.2,
        targetRange: '5.8 - 6.5',
        status: 'warning',
        interpretation: 'Apply lime before planting.',
      },
    ],
    prescriptions: [],
    commercialInputs: [],
    splitSchedule: [],
    aiAdvisoryNotes: [],
    disclaimer: 'Test assessment',
  },
  officerEdits: [],
  agronomistEdits: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.session = { access_token: 'agronomist-token', user: { id: 'app-user-1' } }
  mocks.getUnverifiedAssessments.mockResolvedValue([unclaimedAssessment])
  mocks.claimAssessment.mockResolvedValue({ message: 'Assessment claimed.' })
  mocks.editAssessment.mockResolvedValue({ message: 'Review note saved.' })
  mocks.publishAssessment.mockResolvedValue({ message: 'Report published.' })
  mocks.releaseAssessment.mockResolvedValue({ message: 'Assessment released.' })
})

describe('AgronomistAccount', () => {
  it('loads the review pool and claims an eligible assessment', async () => {
    render(<AgronomistAccount onBackToDemo={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Rugi Green Farm' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Claim assessment' }))

    await waitFor(() => {
      expect(mocks.claimAssessment).toHaveBeenCalledWith('agronomist-token', 'assessment-1')
    })
    expect(screen.getByText(/Field Officer/)).toBeInTheDocument()
    expect(screen.getByText(/Mau Narok/)).toBeInTheDocument()
    expect(screen.getByText(/Ready to claim/)).toBeInTheDocument()
  })

  it('keeps loaded assessments visible while refreshing the review pool', async () => {
    render(<AgronomistAccount onBackToDemo={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: 'Rugi Green Farm' })).toBeInTheDocument()

    mocks.getUnverifiedAssessments.mockImplementationOnce(() => new Promise(() => {}))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(screen.getByRole('heading', { name: 'Rugi Green Farm' })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: 'Loading assessment review pool…' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled()
  })

  it('does not expose edit controls for an assessment claimed by another agronomist', async () => {
    mocks.getUnverifiedAssessments.mockResolvedValue([
      {
        ...unclaimedAssessment,
        claimingAgronomistId: 'another-agronomist',
        reviewStage: 'claimed',
      },
    ])

    render(<AgronomistAccount onBackToDemo={vi.fn()} />)

    expect(await screen.findByText('In another review')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Claim assessment/i })).toBeNull()
    expect(screen.queryByLabelText('Reviewed interpretation: soil ph')).toBeNull()
    expect(screen.queryByRole('button', { name: /Publish verified report/i })).toBeNull()
  })

  it('preserves a review note when saving fails', async () => {
    mocks.getUnverifiedAssessments.mockResolvedValue([
      { ...unclaimedAssessment, claimingAgronomistId: 'app-user-1', reviewStage: 'claimed' },
    ])
    mocks.editAssessment.mockRejectedValue(new Error('Review service unavailable.'))

    render(<AgronomistAccount onBackToDemo={vi.fn()} />)

    const notesField = await screen.findByLabelText(
      'Review note (optional when report fields are changed)',
    )
    fireEvent.change(notesField, { target: { value: 'Check the phosphorus interpretation.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save report changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Review service unavailable.')
    expect(notesField).toHaveValue('Check the phosphorus interpretation.')
  })

  it('saves a claimed assessment report interpretation as an audited adjustment', async () => {
    mocks.getUnverifiedAssessments.mockResolvedValue([
      { ...unclaimedAssessment, claimingAgronomistId: 'app-user-1', reviewStage: 'claimed' },
    ])

    render(<AgronomistAccount onBackToDemo={vi.fn()} />)

    const interpretation = await screen.findByLabelText('Reviewed interpretation: soil ph')
    fireEvent.change(interpretation, {
      target: { value: 'Apply lime based on the current soil test and retest before planting.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save report changes (1)' }))

    await waitFor(() => {
      expect(mocks.editAssessment).toHaveBeenCalledWith(
        'agronomist-token',
        'assessment-1',
        'Updated the agronomic report content.',
        [
          {
            section: 'diagnosis',
            target: 'soil_ph',
            field: 'interpretation',
            value: 'Apply lime based on the current soil test and retest before planting.',
          },
        ],
      )
    })
  })

  it('publishes a claimed assessment with the agronomist accreditation number', async () => {
    mocks.getUnverifiedAssessments.mockResolvedValue([
      { ...unclaimedAssessment, claimingAgronomistId: 'app-user-1', reviewStage: 'claimed' },
    ])

    render(<AgronomistAccount onBackToDemo={vi.fn()} />)

    const licenseField = await screen.findByLabelText('Licence / accreditation number')
    fireEvent.change(licenseField, { target: { value: 'KAAA-AGR-4091' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish verified report' }))

    await waitFor(() => {
      expect(mocks.publishAssessment).toHaveBeenCalledWith('agronomist-token', 'assessment-1', {
        licenseNumber: 'KAAA-AGR-4091',
        finalNotes: undefined,
      })
    })
  })
})
