import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AuthEntry from './AuthEntry'

const { getClient } = vi.hoisted(() => ({ getClient: vi.fn() }))
vi.mock('./lib/supabase', () => ({ getSupabaseClient: getClient }))

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  getClient.mockReturnValue({
    auth: {
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signInWithPassword: vi.fn().mockResolvedValue({
        data: {
          session: {
            access_token: 'access-token',
            user: { user_metadata: { display_name: 'Amina Njeri' } },
          },
        },
        error: null,
      }),
      signUp: vi.fn().mockResolvedValue({
        data: { session: null },
        error: null,
      }),
    },
  })
})

describe('AuthEntry', () => {
  it('links a signed-in user and routes using the server-assigned role', async () => {
    const onAuthenticated = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'linked',
          appUserId: 'user-123',
          identityProvider: 'supabase',
          role: 'extension_officer',
        }),
      }),
    )
    render(<AuthEntry onAuthenticated={onAuthenticated} />)

    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'officer@example.test' },
    })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secure-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith('/officer'))
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/auth/link',
      expect.objectContaining({ body: JSON.stringify({ displayName: 'Amina Njeri' }) }),
    )
  })

  it('routes an agronomist to the dedicated review workspace', async () => {
    const onAuthenticated = vi.fn()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'linked',
          appUserId: 'agronomist-123',
          identityProvider: 'supabase',
          role: 'agronomist',
        }),
      }),
    )
    render(<AuthEntry onAuthenticated={onAuthenticated} />)

    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'agronomist@example.test' },
    })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secure-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith('/agronomist'))
  })

  it('creates an account and prompts the user to sign in when Supabase returns no session', async () => {
    render(<AuthEntry onAuthenticated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Amina Njeri' } })
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'amina@example.test' },
    })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secure-password' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Account created. Sign in to continue.',
    )
  })

  it('rejects registration if privacy consent checkbox is not accepted', async () => {
    render(<AuthEntry onAuthenticated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Amina Njeri' } })
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'amina@example.test' },
    })
    fireEvent.submit(screen.getByRole('button', { name: 'Create account' }).closest('form')!)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You must acknowledge the Data Protection Notice',
    )
  })

  it('masks sign-in failures with a generic error message', async () => {
    getClient.mockReturnValue({
      auth: {
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { session: null },
          error: { message: 'Invalid credentials' },
        }),
      },
    })

    render(<AuthEntry onAuthenticated={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'unknown@user.com' },
    })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'any-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.')
  })

  it('sends a password reset link with a non-enumerating confirmation', async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null })
    getClient.mockReturnValue({
      auth: {
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        resetPasswordForEmail,
      },
    })
    render(<AuthEntry onAuthenticated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'amina@example.test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'If an account exists for that email',
    )
    expect(resetPasswordForEmail).toHaveBeenCalledWith('amina@example.test', {
      redirectTo: `${window.location.origin}/reset-password`,
    })
  })

  it('updates the password after recovery and routes by the stored role', async () => {
    window.history.replaceState(null, '', '/reset-password')
    const session = {
      access_token: 'access-token',
      user: { user_metadata: { display_name: 'Amina Njeri' } },
    }
    const onAuthenticated = vi.fn()
    getClient.mockReturnValue({
      auth: {
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
        getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
        updateUser: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-user' } }, error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'linked',
          appUserId: 'user-123',
          identityProvider: 'supabase',
          role: 'farmer',
        }),
      }),
    )

    render(<AuthEntry onAuthenticated={onAuthenticated} />)
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'replacement-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith('/farmer'))
    window.history.replaceState(null, '', '/')
  })

  it('claims an officer-registered farmer after setting a password from a reminder link', async () => {
    window.history.replaceState(
      null,
      '',
      '/reset-password?claim=1#access_token=claim-token&type=recovery',
    )
    const session = {
      access_token: 'claim-token',
      user: { user_metadata: { display_name: 'Amina Njeri' } },
    }
    const onAuthenticated = vi.fn()
    getClient.mockReturnValue({
      auth: {
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
        getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
        updateUser: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-user' } }, error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = input.toString()
        if (url.includes('/auth/invitations/activate')) {
          return Promise.resolve({ ok: true, json: async () => ({ status: 'active' }) })
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'linked',
            appUserId: 'farmer-123',
            identityProvider: 'supabase',
            role: 'farmer',
          }),
        })
      }),
    )

    render(<AuthEntry onAuthenticated={onAuthenticated} />)
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'replacement-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith('/farmer'))
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/v1/auth/invitations/activate',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/v1/auth/link', expect.any(Object))
    window.history.replaceState(null, '', '/')
  })

  it('activates an invited account after setting its first password', async () => {
    window.history.replaceState(null, '', '/#access_token=invite-token&type=invite')
    const session = {
      access_token: 'invite-token',
      user: { user_metadata: { display_name: 'Sarah Officer' } },
    }
    const onAuthenticated = vi.fn()
    getClient.mockReturnValue({
      auth: {
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
        getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
        updateUser: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-user' } }, error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const url = input.toString()
        if (url.includes('/auth/invitations/activate')) {
          return Promise.resolve({ ok: true, json: async () => ({ status: 'active' }) })
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            status: 'linked',
            appUserId: 'user-123',
            identityProvider: 'supabase',
            role: 'extension_officer',
          }),
        })
      }),
    )

    render(<AuthEntry onAuthenticated={onAuthenticated} />)
    expect(
      await screen.findByText(/Choose your own password to activate your administrator-provisioned account/i),
    ).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'replacement-password' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith('/officer'))
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/v1/auth/invitations/activate',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer invite-token' },
      }),
    )
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/v1/auth/link', expect.any(Object))
    window.history.replaceState(null, '', '/')
  })
})
