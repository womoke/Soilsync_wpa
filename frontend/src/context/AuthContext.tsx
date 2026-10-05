import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FC,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { updateOwnProfile } from '../api/profile'
import { getSupabaseClient } from '../lib/supabase'

export type AppUserRole = 'farmer' | 'extension-officer' | 'agrodealer' | 'agronomist' | 'admin'

export interface UserRoleRecord {
  role: AppUserRole
  status: 'pending' | 'active' | 'suspended'
  approvedAt?: string | null
}

export interface UserProfile {
  id: string
  fullName: string | null
  county: string | null
  subCounty: string | null
  ward: string | null
  phoneNumber: string | null
}

export interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: UserProfile | null
  activeRoles: AppUserRole[]
  allRoles: UserRoleRecord[]
  isLoading: boolean
  isInitializing: boolean
  error: string | null
  signInWithPassword: (email: string, password: string) => Promise<{ error: Error | null }>
  signUpWithPassword: (
    email: string,
    password: string,
    fullName?: string,
  ) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
  refreshSession: () => Promise<void>
  refreshRoles: () => Promise<void>
  updateProfile: (fullName: string, phoneNumber: string | null) => Promise<{ error: Error | null }>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export const AuthProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const supabase = getSupabaseClient()
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [allRoles, setAllRoles] = useState<UserRoleRecord[]>([])
  const [activeRoles, setActiveRoles] = useState<AppUserRole[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(supabase))
  const [isInitializing, setIsInitializing] = useState<boolean>(Boolean(supabase))
  const [error, setError] = useState<string | null>(null)
  const userDataLoadId = useRef(0)

  const clearUserData = useCallback(() => {
    userDataLoadId.current += 1
    setProfile(null)
    setAllRoles([])
    setActiveRoles([])
  }, [])

  const clearPersistedAuthState = useCallback(() => {
    try {
      for (const storage of [window.localStorage, window.sessionStorage]) {
        for (const key of Array.from({ length: storage.length }, (_, index) => storage.key(index))) {
          if (key && (key.startsWith('sb-') || key.includes('supabase'))) {
            storage.removeItem(key)
          }
        }
      }
    } catch {
      // Storage may be inaccessible in restricted contexts; fail closed without breaking logout.
    }
  }, [])

  const loadUserData = useCallback(
    async (currentUser: User) => {
      if (!supabase) return 'failed' as const
      const loadId = ++userDataLoadId.current
      setError(null)
      setProfile(null)
      setAllRoles([])
      setActiveRoles([])

      try {
        const [profileResult, rolesResult] = await Promise.all([
          supabase
            .from('profiles')
            .select('id, full_name, county, sub_county, ward, phone_number')
            .eq('id', currentUser.id)
            .maybeSingle(),
          supabase
            .from('user_roles')
            .select('role, status, approved_at')
            .eq('user_id', currentUser.id),
        ])

        if (profileResult.error) throw profileResult.error
        if (rolesResult.error) throw rolesResult.error
        if (!Array.isArray(rolesResult.data)) {
          throw new Error('The account roles response was invalid.')
        }
        if (loadId !== userDataLoadId.current) return 'stale' as const

        const roleNames: AppUserRole[] = [
          'farmer',
          'extension-officer',
          'agrodealer',
          'agronomist',
          'admin',
        ]
        const statuses: UserRoleRecord['status'][] = ['pending', 'active', 'suspended']
        const roles: UserRoleRecord[] = rolesResult.data.map((row) => {
          if (
            !roleNames.includes(row.role as AppUserRole) ||
            !statuses.includes(row.status as UserRoleRecord['status'])
          ) {
            throw new Error('The account returned an unsupported role assignment.')
          }
          return {
            role: row.role as AppUserRole,
            status: row.status as UserRoleRecord['status'],
            approvedAt: row.approved_at,
          }
        })

        const profileData = profileResult.data
        setProfile(
          profileData
            ? {
              id: profileData.id,
              fullName: profileData.full_name,
              county: profileData.county,
              subCounty: profileData.sub_county,
              ward: profileData.ward,
              phoneNumber: profileData.phone_number,
            }
            : null,
        )
        setAllRoles(roles)
        setActiveRoles(roles.filter((role) => role.status === 'active').map((role) => role.role))
        return 'loaded' as const
      } catch (err) {
        if (loadId !== userDataLoadId.current) return 'stale' as const
        clearUserData()
        setError(
          err instanceof Error
            ? `Could not load account access details: ${err.message}`
            : 'Could not load account access details. Please retry.',
        )
        return 'failed' as const
      }
    },
    [supabase, clearUserData],
  )

  const refreshSession = useCallback(async () => {
    if (!supabase) return
    setIsLoading(true)
    setError(null)
    try {
      const {
        data: { session: freshSession },
        error: sessionError,
      } = await supabase.auth.getSession()
      if (sessionError) throw sessionError

      setSession(freshSession)
      setUser(freshSession?.user ?? null)
      if (freshSession?.user) {
        await loadUserData(freshSession.user)
      } else {
        clearUserData()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Session refresh failed.')
    } finally {
      setIsLoading(false)
    }
  }, [supabase, loadUserData, clearUserData])

  const refreshRoles = useCallback(async () => {
    if (user) {
      setIsLoading(true)
      const result = await loadUserData(user)
      if (result !== 'stale') setIsLoading(false)
    }
  }, [user, loadUserData])

  const updateProfile = useCallback(
    async (fullName: string, phoneNumber: string | null) => {
      if (!session?.access_token) {
        return { error: new Error('Sign in to update your profile.') }
      }
      try {
        const updatedProfile = await updateOwnProfile(session.access_token, {
          full_name: fullName,
          phone_number: phoneNumber,
        })
        setProfile({
          id: updatedProfile.id,
          fullName: updatedProfile.fullName,
          county: updatedProfile.county,
          subCounty: updatedProfile.subCounty,
          ward: updatedProfile.ward,
          phoneNumber: updatedProfile.phoneNumber,
        })
        return { error: null }
      } catch (err) {
        return {
          error: err instanceof Error ? err : new Error('Profile update failed.'),
        }
      }
    },
    [session],
  )

  useEffect(() => {
    let mounted = true
    let receivedAuthStateChange = false

    if (!supabase) {
      return
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return
      receivedAuthStateChange = true
      setSession(newSession)
      setUser(newSession?.user ?? null)

      if (newSession?.user) {
        setIsLoading(true)
        queueMicrotask(() => {
          if (!mounted) return
          void loadUserData(newSession.user).then((result) => {
            if (mounted && result !== 'stale') {
              setIsLoading(false)
              setIsInitializing(false)
            }
          })
        })
      } else {
        clearUserData()
        setError(null)
        setIsLoading(false)
        setIsInitializing(false)
      }
    })

    // A sign-in event can arrive while getSession is resolving. Never let that
    // older snapshot overwrite the newer auth state.
    void supabase.auth
      .getSession()
      .then(({ data: { session: initialSession }, error: initialError }) => {
        if (!mounted || receivedAuthStateChange) return
        if (initialError) {
          setError(initialError.message)
          setIsLoading(false)
          setIsInitializing(false)
          return
        }

        setSession(initialSession)
        setUser(initialSession?.user ?? null)
        if (initialSession?.user) {
          void loadUserData(initialSession.user).then((result) => {
            if (mounted && result !== 'stale') {
              setIsLoading(false)
              setIsInitializing(false)
            }
          })
        } else {
          clearUserData()
          setIsLoading(false)
          setIsInitializing(false)
        }
      })
      .catch((sessionError: unknown) => {
        if (!mounted || receivedAuthStateChange) return
        setError(sessionError instanceof Error ? sessionError.message : 'Session retrieval failed.')
        setIsLoading(false)
        setIsInitializing(false)
      })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [supabase, loadUserData, clearUserData])

  const signInWithPassword = async (email: string, password: string) => {
    if (!supabase) {
      return { error: new Error('Supabase Auth is not configured.') }
    }
    setError(null)
    setIsLoading(true)
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (signInError) {
        // Generic error message to prevent enumeration (Section 4.2)
        throw new Error('Email or password is incorrect.')
      }
      setSession(data.session)
      setUser(data.user)
      if (data.user) {
        await loadUserData(data.user)
      }
      return { error: null }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed.'
      setError(message)
      return { error: err instanceof Error ? err : new Error(message) }
    } finally {
      setIsLoading(false)
    }
  }

  const signUpWithPassword = async (email: string, password: string, fullName?: string) => {
    if (!supabase) {
      return {
        error: new Error('Supabase Auth is not configured.'),
      }
    }
    setError(null)
    setIsLoading(true)
    try {
      // Passwords must be at least 8 characters
      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters long.')
      }

      // No role field in signup (Section 4.1 Principle 3)
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: fullName ? { full_name: fullName.trim() } : undefined,
        },
      })

      if (signUpError) {
        throw signUpError
      }

      setSession(data.session)
      setUser(data.user)
      return { error: null }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign up failed.'
      setError(message)
      return {
        error: err instanceof Error ? err : new Error(message),
      }
    } finally {
      setIsLoading(false)
    }
  }

  const signOut = async () => {
    if (supabase) {
      await supabase.auth.signOut({ scope: 'local' })
    }
    setSession(null)
    setUser(null)
    clearUserData()
    setError(null)
    clearPersistedAuthState()
  }

  const value: AuthContextValue = {
    session,
    user,
    profile,
    activeRoles,
    allRoles,
    isLoading,
    isInitializing,
    error,
    signInWithPassword,
    signUpWithPassword,
    signOut,
    refreshSession,
    refreshRoles,
    updateProfile,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
