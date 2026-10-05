import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
let supabaseClient: SupabaseClient | null | undefined

export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient !== undefined) {
    return supabaseClient
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    supabaseClient = null
    return null
  }

  supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: false,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  })
  return supabaseClient
}

export function _resetSupabaseClientForTest(): void {
  supabaseClient = undefined
}

