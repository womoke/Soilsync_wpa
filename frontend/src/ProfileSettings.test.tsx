import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProfileSettings from './ProfileSettings'

const { updateProfile, resetPasswordForEmail } = vi.hoisted(() => ({
  updateProfile: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}))

vi.mock('./context/AuthContext', () => ({
  useAuth: () => ({
    session: { access_token: 'valid-token' },
    user: { email: 'amina@example.test' },
    profile: {
      id: 'auth-user-1',
      fullName: 'Amina Kimani',
      county: 'Nakuru',
      subCounty: 'Naivasha',
      ward: 'Ward 1',
      phoneNumber: null,
    },
    allRoles: [{ role: 'farmer', status: 'active' }],
    updateProfile,
  }),
}))

vi.mock('./lib/supabase', () => ({
  getSupabaseClient: () => ({
    auth: { resetPasswordForEmail },
  }),
}))

describe('ProfileSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateProfile.mockResolvedValue({ error: null })
    resetPasswordForEmail.mockResolvedValue({ error: null })
  })

  it('saves editable fields while clearly showing identity and jurisdiction as read-only', async () => {
    render(<ProfileSettings onClose={vi.fn()} />)

    expect(screen.getByText('amina@example.test')).toBeInTheDocument()
    expect(screen.getByText('farmer (active)')).toBeInTheDocument()
    expect(screen.getByText('Ward 1, Naivasha, Nakuru')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Full name'), {
      target: { value: 'Amina Wanjiku' },
    })
    fireEvent.change(screen.getByLabelText(/Contact phone/), {
      target: { value: '+254712345678' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() =>
      expect(updateProfile).toHaveBeenCalledWith('Amina Wanjiku', '+254712345678'),
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Your profile was updated.')
  })

  it('sends a non-enumerating password reset link to the signed-in account email', async () => {
    render(<ProfileSettings onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Send password reset link' }))

    await waitFor(() =>
      expect(resetPasswordForEmail).toHaveBeenCalledWith('amina@example.test', {
        redirectTo: `${window.location.origin}/reset-password`,
      }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'If this account can receive email, password reset instructions have been sent.',
    )
  })

  it('shows save failures without reporting success', async () => {
    updateProfile.mockResolvedValue({ error: new Error('Profile service unavailable.') })
    render(<ProfileSettings onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Profile service unavailable.')
    expect(screen.queryByText('Your profile was updated.')).not.toBeInTheDocument()
  })
})
