import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgrodealerApplication } from './AgrodealerApplication'
import * as AuthContextModule from './context/AuthContext'
import * as AgrodealerApiModule from './api/agrodealer'

describe('AgrodealerApplication Component', () => {
  const mockApply = vi.fn()
  const mockRefreshRoles = vi.fn().mockResolvedValue(undefined)
  const mockSuccess = vi.fn()
  const mockCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      session: { access_token: 'valid-dealer-jwt' } as any,
      user: { id: 'user-dealer-1' } as any,
      profile: null,
      activeRoles: ['farmer'],
      allRoles: [{ role: 'farmer', status: 'active' }],
      isLoading: false,
      isInitializing: false,
      error: null,
      signInWithPassword: vi.fn(),
      signUpWithPassword: vi.fn(),
      signOut: vi.fn(),
      refreshSession: vi.fn(),
      refreshRoles: mockRefreshRoles,
      updateProfile: vi.fn().mockResolvedValue({ error: null }),
    })

    vi.spyOn(AgrodealerApiModule, 'applyForAgrodealer').mockImplementation(mockApply)
  })

  it('renders application form fields and Kenyan counties dropdown', () => {
    render(<AgrodealerApplication onSuccess={mockSuccess} onCancel={mockCancel} />)

    expect(
      screen.getByRole('heading', { name: 'Register Your Agrodealer Business' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/Business name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Licence \/ Registration number/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Contact person name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^County/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Shop location/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Business phone number/i)).toBeInTheDocument()
  })

  it('validates +254 phone number format when provided', async () => {
    render(<AgrodealerApplication onSuccess={mockSuccess} onCancel={mockCancel} />)

    fireEvent.change(screen.getByLabelText(/Business name/i), {
      target: { value: 'Nakuru Inputs' },
    })
    fireEvent.change(screen.getByLabelText(/Licence \/ Registration number/i), {
      target: { value: 'AFA/2026/123' },
    })
    fireEvent.change(screen.getByLabelText(/Contact person name/i), {
      target: { value: 'John Kamau' },
    })
    fireEvent.change(screen.getByLabelText(/Business phone number/i), {
      target: { value: '0712345678' },
    })
    fireEvent.click(screen.getByRole('checkbox'))

    fireEvent.submit(screen.getByRole('button', { name: /Submit Application/i }).closest('form')!)

    expect(
      await screen.findByText('Phone number must be in +254 format (e.g. +254712345678).'),
    ).toBeInTheDocument()
    expect(mockApply).not.toHaveBeenCalled()
  })

  it('submits application successfully and calls onSuccess', async () => {
    mockApply.mockResolvedValueOnce({
      applicationId: 'app-1',
      userId: 'user-dealer-1',
      businessName: 'Nakuru Inputs',
      licenceNumber: 'AFA/2026/123',
      contactName: 'John Kamau',
      county: 'Nakuru',
      role: 'agrodealer',
      status: 'pending',
      verificationState: 'pending',
      message: 'Agrodealer application submitted successfully and is pending administrator review.',
      createdAt: '2026-10-03T00:00:00Z',
    })

    render(<AgrodealerApplication onSuccess={mockSuccess} onCancel={mockCancel} />)

    fireEvent.change(screen.getByLabelText(/Business name/i), {
      target: { value: 'Nakuru Inputs' },
    })
    fireEvent.change(screen.getByLabelText(/Licence \/ Registration number/i), {
      target: { value: 'AFA/2026/123' },
    })
    fireEvent.change(screen.getByLabelText(/Contact person name/i), {
      target: { value: 'John Kamau' },
    })
    fireEvent.change(screen.getByLabelText(/Sub-County/i), { target: { value: 'Njoro' } })
    fireEvent.change(screen.getByLabelText(/Ward/i), { target: { value: 'Mau Narok' } })
    fireEvent.change(screen.getByLabelText(/Business phone number/i), {
      target: { value: '+254712345678' },
    })
    fireEvent.click(screen.getByRole('checkbox'))

    fireEvent.submit(screen.getByRole('button', { name: /Submit Application/i }).closest('form')!)

    await waitFor(() => {
      expect(mockApply).toHaveBeenCalledWith(
        'valid-dealer-jwt',
        expect.objectContaining({
          businessName: 'Nakuru Inputs',
          licenceNumber: 'AFA/2026/123',
          contactName: 'John Kamau',
          county: 'Nakuru',
          subCounty: 'Njoro',
          ward: 'Mau Narok',
          phoneNumber: '+254712345678',
        }),
      )
      expect(mockRefreshRoles).toHaveBeenCalledTimes(1)
      expect(mockSuccess).toHaveBeenCalledTimes(1)
    })
  })

  it('handles submission errors gracefully', async () => {
    mockApply.mockRejectedValueOnce(new Error('A licence with this number is already registered.'))

    render(<AgrodealerApplication onSuccess={mockSuccess} onCancel={mockCancel} />)

    fireEvent.change(screen.getByLabelText(/Business name/i), {
      target: { value: 'Nakuru Inputs' },
    })
    fireEvent.change(screen.getByLabelText(/Licence \/ Registration number/i), {
      target: { value: 'AFA/2026/123' },
    })
    fireEvent.change(screen.getByLabelText(/Contact person name/i), {
      target: { value: 'John Kamau' },
    })
    fireEvent.click(screen.getByRole('checkbox'))

    fireEvent.submit(screen.getByRole('button', { name: /Submit Application/i }).closest('form')!)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A licence with this number is already registered.',
    )
    expect(mockSuccess).not.toHaveBeenCalled()
  })
})
