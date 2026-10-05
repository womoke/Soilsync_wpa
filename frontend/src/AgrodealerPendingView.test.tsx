import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgrodealerPendingView } from './AgrodealerPendingView'
import * as AuthContextModule from './context/AuthContext'
import * as AgrodealerApiModule from './api/agrodealer'

describe('AgrodealerPendingView Component', () => {
  const mockBackToHome = vi.fn()
  const mockRefreshRoles = vi.fn().mockResolvedValue(undefined)
  const mockGetStatus = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      session: { access_token: 'valid-jwt' } as any,
      user: { id: 'user-dealer-pending' } as any,
      profile: null,
      activeRoles: ['farmer'],
      allRoles: [
        { role: 'farmer', status: 'active' },
        { role: 'agrodealer', status: 'pending' },
      ],
      isLoading: false,
      error: null,
      signInWithPassword: vi.fn(),
      signUpWithPassword: vi.fn(),
      signOut: vi.fn(),
      refreshSession: vi.fn(),
      refreshRoles: mockRefreshRoles,
      updateProfile: vi.fn().mockResolvedValue({ error: null }),
    })

    vi.spyOn(AgrodealerApiModule, 'getAgrodealerApplicationStatus').mockImplementation(
      mockGetStatus,
    )
  })

  it('renders pending review status badge and explanation', async () => {
    mockGetStatus.mockResolvedValueOnce({
      hasApplication: true,
      application: {
        applicationId: 'app-123',
        userId: 'user-dealer-pending',
        businessName: 'Mau Agrovet Supplies',
        licenceNumber: 'AFA-2026-999',
        contactName: 'Peter Mwangi',
        county: 'Nakuru',
        ward: 'Mau Narok',
        role: 'agrodealer',
        status: 'pending',
        verificationState: 'pending',
        message: 'Pending administrator review',
        createdAt: '2026-10-03T00:00:00Z',
      },
    })

    render(<AgrodealerPendingView onBackToHome={mockBackToHome} />)

    expect(
      screen.getByRole('heading', { name: 'Dealer Application Pending Approval' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Application Under Review')).toBeInTheDocument()
    expect(screen.getByText(/Catalog and Orders Locked/i)).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Mau Agrovet Supplies')).toBeInTheDocument()
      expect(screen.getByText('AFA-2026-999')).toBeInTheDocument()
      expect(screen.getByText('Peter Mwangi')).toBeInTheDocument()
    })
  })

  it('triggers onBackToHome when Return to Farmer Workspace button is clicked', () => {
    mockGetStatus.mockResolvedValueOnce({ hasApplication: false, application: null })

    render(<AgrodealerPendingView onBackToHome={mockBackToHome} />)

    const returnBtn = screen.getByRole('button', { name: /Return to Farmer Workspace/i })
    fireEvent.click(returnBtn)

    expect(mockBackToHome).toHaveBeenCalledTimes(1)
  })

  it('refreshes status when Check Status button is clicked', async () => {
    mockGetStatus.mockResolvedValue({ hasApplication: false, application: null })

    render(<AgrodealerPendingView onBackToHome={mockBackToHome} />)

    const refreshBtn = await screen.findByRole('button', { name: /Check Status/i })
    fireEvent.click(refreshBtn)

    await waitFor(() => {
      expect(mockRefreshRoles).toHaveBeenCalled()
    })
  })
})
