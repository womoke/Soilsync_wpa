import { afterEach, describe, expect, it, vi } from 'vitest'
import { getFarmVerifiedReport } from './farmer'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getFarmVerifiedReport', () => {
  it('treats a missing report as an expected empty result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: vi.fn().mockResolvedValue({ detail: 'No verified soil report is available.' }),
      }),
    )

    await expect(getFarmVerifiedReport('token', 'farm-1')).resolves.toBeNull()
  })

  it('surfaces server failures instead of hiding them as an absent report', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({ detail: 'Database error' }),
      }),
    )

    await expect(getFarmVerifiedReport('token', 'farm-1')).rejects.toThrow('Database error')
  })
})
