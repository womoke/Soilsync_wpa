import { afterEach, describe, expect, it, vi } from 'vitest'
import { updateOwnProfile } from './profile'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('updateOwnProfile', () => {
  it('sends the editable name and phone to the authenticated profile endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: 'auth-user-1',
        fullName: 'Amina Kimani',
        county: 'Nakuru',
        subCounty: 'Naivasha',
        ward: 'Ward 1',
        phoneNumber: '+254712345678',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await updateOwnProfile('valid-token', {
      full_name: 'Amina Kimani',
      phone_number: '+254712345678',
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/profile/me', {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer valid-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        full_name: 'Amina Kimani',
        phone_number: '+254712345678',
      }),
    })
    expect(result.fullName).toBe('Amina Kimani')
    expect(result.county).toBe('Nakuru')
  })

  it('surfaces backend validation errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: vi.fn().mockResolvedValue({ detail: 'Invalid profile fields.' }),
      }),
    )

    await expect(
      updateOwnProfile('valid-token', { full_name: 'Amina', phone_number: null }),
    ).rejects.toThrow('Invalid profile fields.')
  })
})
