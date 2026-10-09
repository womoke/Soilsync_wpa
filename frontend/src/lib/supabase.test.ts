import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({})),
}))

describe('getSupabaseClient', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.example.test')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-test-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('persists the PKCE verifier so email callbacks can establish a session', async () => {
    const { createClient } = await import('@supabase/supabase-js')
    const { getSupabaseClient } = await import('./supabase')

    getSupabaseClient()

    expect(createClient).toHaveBeenCalledWith(
      'https://project.example.test',
      'public-test-key',
      expect.objectContaining({
        auth: expect.objectContaining({
          flowType: 'pkce',
          persistSession: true,
          detectSessionInUrl: true,
        }),
      }),
    )
  })
})
