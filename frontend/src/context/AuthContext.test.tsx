import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AuthProvider, useAuth } from './AuthContext'
import * as supabaseLib from '../lib/supabase'

describe('AuthContext', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('throws an error if useAuth is accessed outside AuthProvider', () => {
    expect(() => renderHook(() => useAuth())).toThrow(
      'useAuth must be used within an AuthProvider',
    )
  })

  it('initializes in unauthenticated state when no session is returned', async () => {
    const mockSupabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
        signInWithPassword: vi.fn(),
        signUp: vi.fn(),
        signOut: vi.fn(),
      },
      from: vi.fn(),
    }
    vi.spyOn(supabaseLib, 'getSupabaseClient').mockReturnValue(mockSupabase as any)

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    )

    const { result } = renderHook(() => useAuth(), { wrapper })

    expect(result.current.isLoading).toBe(true)

    // Wait for getSession to resolve
    await act(async () => {})

    expect(result.current.isLoading).toBe(false)
    expect(result.current.session).toBeNull()
    expect(result.current.user).toBeNull()
    expect(result.current.activeRoles).toEqual([])
  })

  it('does not overwrite a sign-in event with a stale initial signed-out session', async () => {
    let resolveInitialSession!: (value: {
      data: { session: null }
      error: null
    }) => void
    const initialSession = new Promise<{ data: { session: null }; error: null }>((resolve) => {
      resolveInitialSession = resolve
    })
    const user = { id: 'usr-123', email: 'farmer@soilsync.ai' }
    const session = { access_token: 'fresh-token', user } as Session
    let notifyAuthStateChange:
      | ((event: string, nextSession: Session | null) => void)
      | undefined
    const profileQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'usr-123',
          full_name: 'Amina Kimani',
          county: null,
          sub_county: null,
          ward: null,
          phone_number: null,
        },
        error: null,
      }),
    }
    profileQuery.select.mockReturnValue(profileQuery)
    profileQuery.eq.mockReturnValue(profileQuery)
    const rolesQuery = {
      select: vi.fn(),
      eq: vi.fn().mockResolvedValue({
        data: [{ role: 'farmer', status: 'active', approved_at: null }],
        error: null,
      }),
    }
    rolesQuery.select.mockReturnValue(rolesQuery)
    const mockSupabase = {
      auth: {
        getSession: vi.fn().mockReturnValue(initialSession),
        onAuthStateChange: vi.fn((callback) => {
          notifyAuthStateChange = callback
          return { data: { subscription: { unsubscribe: vi.fn() } } }
        }),
      },
      from: vi.fn((table: string) => (table === 'profiles' ? profileQuery : rolesQuery)),
    }
    vi.spyOn(supabaseLib, 'getSupabaseClient').mockReturnValue(mockSupabase as any)

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    )
    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => {
      notifyAuthStateChange?.('SIGNED_IN', session)
      await Promise.resolve()
      resolveInitialSession({ data: { session: null }, error: null })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.session?.access_token).toBe('fresh-token')
    expect(result.current.user?.id).toBe('usr-123')
    expect(result.current.activeRoles).toEqual(['farmer'])
  })

  it('signs in successfully with email and password and loads active roles', async () => {
    const mockUser = {
      id: 'usr-123',
      email: 'farmer@soilsync.ai',
      email_confirmed_at: '2026-10-01T00:00:00Z',
    }
    const mockSession = {
      access_token: 'valid-jwt',
      user: mockUser,
    }

    const mockSupabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { session: mockSession, user: mockUser },
          error: null,
        }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'usr-123',
                full_name: 'Amina Kimani',
                county: 'Nakuru',
                sub_county: 'Njoro',
                ward: 'Mau Narok',
                phone_number: '+254712345678',
              },
            }),
          }
        }
        if (table === 'user_roles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              data: [
                { role: 'farmer', status: 'active', approved_at: null },
                { role: 'agrodealer', status: 'pending', approved_at: null },
              ],
            }),
          }
        }
        return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({ data: [] }) }
      }),
    }
    vi.spyOn(supabaseLib, 'getSupabaseClient').mockReturnValue(mockSupabase as any)

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    )

    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => {})

    let signInResult: { error: Error | null } | undefined
    await act(async () => {
      signInResult = await result.current.signInWithPassword('farmer@soilsync.ai', 'SecretP@ssword123')
    })

    expect(signInResult).toEqual({ error: null })
    expect(result.current.user?.id).toBe('usr-123')
    expect(result.current.activeRoles).toEqual(['farmer'])
    expect(result.current.allRoles).toHaveLength(2)
    expect(result.current.profile?.fullName).toBe('Amina Kimani')
  })

  it('fails closed when role lookup fails instead of granting the farmer role', async () => {
    const mockUser = {
      id: 'usr-123',
      email: 'farmer@soilsync.ai',
      email_confirmed_at: '2026-10-01T00:00:00Z',
    }
    const mockSupabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { user: mockUser } },
          error: null,
        }),
        onAuthStateChange: vi.fn().mockReturnValue({
          data: { subscription: { unsubscribe: vi.fn() } },
        }),
      },
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: null,
            error: new Error('role service unavailable'),
          }),
        }
      }),
    }
    vi.spyOn(supabaseLib, 'getSupabaseClient').mockReturnValue(mockSupabase as any)

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    )
    const { result } = renderHook(() => useAuth(), { wrapper })

    await act(async () => {})

    expect(result.current.activeRoles).toEqual([])
    expect(result.current.allRoles).toEqual([])
    expect(result.current.error).toContain('Could not load account access details')
  })

  it('masks specific authentication failures with generic error message', async () => {
    const mockSupabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { session: null, user: null },
          error: { message: 'Invalid login credentials' },
        }),
      },
      from: vi.fn(),
    }
    vi.spyOn(supabaseLib, 'getSupabaseClient').mockReturnValue(mockSupabase as any)

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    )

    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => {})

    let signInResult: { error: Error | null } | undefined
    await act(async () => {
      signInResult = await result.current.signInWithPassword('unknown@user.com', 'wrongpassword')
    })

    expect(signInResult?.error?.message).toBe('Email or password is incorrect.')
    expect(result.current.error).toBe('Email or password is incorrect.')
  })

  it('enforces password minimum length of 8 chars on signup', async () => {
    const mockSupabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
        onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
        signUp: vi.fn(),
      },
      from: vi.fn(),
    }
    vi.spyOn(supabaseLib, 'getSupabaseClient').mockReturnValue(mockSupabase as any)

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    )

    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => {})

    let signUpResult: { error: Error | null } | undefined
    await act(async () => {
      signUpResult = await result.current.signUpWithPassword('new@farmer.ke', 'short')
    })

    expect(signUpResult?.error?.message).toBe('Password must be at least 8 characters long.')
    expect(mockSupabase.auth.signUp).not.toHaveBeenCalled()
  })

  it('signs out and purges state and session', async () => {
    const mockUser = { id: 'usr-1', email: 'user@soilsync.ai' }
    const mockSupabase = {
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: { user: mockUser } }, error: null }),
        onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
      }),
    }
    vi.spyOn(supabaseLib, 'getSupabaseClient').mockReturnValue(mockSupabase as any)

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthProvider>{children}</AuthProvider>
    )

    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => {})

    await act(async () => {
      await result.current.signOut()
    })

    expect(mockSupabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(result.current.user).toBeNull()
    expect(result.current.activeRoles).toEqual([])
    expect(result.current.profile).toBeNull()
  })
})
