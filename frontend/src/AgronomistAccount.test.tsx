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
  auth: { session: { access_token: 'agronomist-token' } },
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
  crop: 'maize',
  engineVersion: 'test-engine',
  engineBaseline: {
    engineVersion: 'test-engine',
    crop: 'maize',
    farmAcreage: 1,
    regionalZone: 'Central Highlands',
    diagnoses: [],
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
  mocks.auth.session = { access_token: 'agronomist-token' }
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
  })

  it('preserves a review note when saving fails', async () => {
    mocks.getUnverifiedAssessments.mockResolvedValue([
      { ...unclaimedAssessment, claimingAgronomistId: 'app-user-1', reviewStage: 'claimed' },
    ])
    mocks.editAssessment.mockRejectedValue(new Error('Review service unavailable.'))

    render(<AgronomistAccount onBackToDemo={vi.fn()} />)

    const notesField = await screen.findByLabelText('Add a collaborative review note')
    fireEvent.change(notesField, { target: { value: 'Check the phosphorus interpretation.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save review note' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Review service unavailable.')
    expect(notesField).toHaveValue('Check the phosphorus interpretation.')
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
      expect(mocks.publishAssessment).toHaveBeenCalledWith(
        'agronomist-token',
        'assessment-1',
        { licenseNumber: 'KAAA-AGR-4091', finalNotes: undefined },
      )
    })
  })
})
