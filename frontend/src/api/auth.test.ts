import { afterEach, describe, expect, it, vi } from 'vitest'
import { linkAuthenticatedAccount } from './auth'

describe('linkAuthenticatedAccount', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('links a verified session and returns the server-assigned role', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'linked',
        appUserId: 'user-123',
        identityProvider: 'supabase',
        role: 'extension_officer',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(linkAuthenticatedAccount('verified-access-token')).resolves.toEqual({
      status: 'linked',
      appUserId: 'user-123',
      identityProvider: 'supabase',
      role: 'extension_officer',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/link',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer verified-access-token',
          'Content-Type': 'application/json',
        },
        body: '{}',
      }),
    )
  })

  it('sends the optional display name for profile linking', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'linked',
        appUserId: 'user-123',
        identityProvider: 'supabase',
        role: 'farmer',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await linkAuthenticatedAccount('verified-access-token', 'Amina')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/auth/link',
      expect.objectContaining({ body: JSON.stringify({ displayName: 'Amina' }) }),
    )
  })

  it('accepts the agronomist role assigned by the server', async () => {
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

    await expect(linkAuthenticatedAccount('verified-access-token')).resolves.toMatchObject({
      appUserId: 'agronomist-123',
      role: 'agronomist',
    })
  })

  it('surfaces server authorization errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ detail: 'An approved app profile is required.' }),
      }),
    )

    await expect(linkAuthenticatedAccount('verified-access-token')).rejects.toThrow(
      'An approved app profile is required.',
    )
  })

  it('rejects malformed profile responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'linked', role: 'superuser' }),
      }),
    )

    await expect(linkAuthenticatedAccount('verified-access-token')).rejects.toThrow(
      'Account verification returned an invalid profile.',
    )
  })
})
