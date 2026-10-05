import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ArrowRight, LockKeyhole, Sprout } from 'lucide-react'
import { activateAccountInvitation, linkAuthenticatedAccount, type AppRole } from './api/auth'
import { validatePasswordPolicy } from './lib/passwordPolicy'
import { getSupabaseClient } from './lib/supabase'
import { SoilSyncLoading } from './SoilSyncLoading'

interface AuthEntryProps {
  onAuthenticated: (destination: string) => void
}

type AuthMode = 'sign-in' | 'register' | 'reset-request' | 'update-password'

interface AuthCallbackTokens {
  accessToken: string
  refreshToken: string
}

function readAuthCallbackTokens(): AuthCallbackTokens | null {
  if (window.location.pathname.toLowerCase() !== '/reset-password') return null
  const callbackParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const accessToken = callbackParams.get('access_token')
  const refreshToken = callbackParams.get('refresh_token')
  return accessToken && refreshToken ? { accessToken, refreshToken } : null
}

function hasInvitationCallback(): boolean {
  const url = new URL(window.location.href)
  const callbackParams = new URLSearchParams(url.hash.replace(/^#/, ''))
  return (
    url.searchParams.get('invite') === '1' ||
    url.searchParams.get('type') === 'invite' ||
    callbackParams.get('type') === 'invite'
  )
}

function hasClaimActivationCallback(): boolean {
  const url = new URL(window.location.href)
  if (
    url.pathname.toLowerCase() !== '/reset-password' ||
    url.searchParams.get('claim') !== '1'
  ) {
    return false
  }
  const callbackParams = new URLSearchParams(url.hash.replace(/^#/, ''))
  return (
    (callbackParams.get('type') === 'recovery' && callbackParams.has('access_token')) ||
    url.searchParams.has('code')
  )
}

const destinationByRole: Record<AppRole, string> = {
  farmer: '/farmer',
  extension_officer: '/officer',
  agrodealer: '/dealer',
  agronomist: '/agronomist',
  admin: '/admin',
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.'
}

function getDisplayName(session: Session): string | undefined {
  const value: unknown = session.user.user_metadata?.display_name
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export default function AuthEntry({ onAuthenticated }: AuthEntryProps) {
  const supabase = getSupabaseClient()
  const onAuthenticatedRef = useRef(onAuthenticated)
  const authCallbackTokens = useRef(readAuthCallbackTokens())
  const [mode, setMode] = useState<AuthMode>(() =>
    window.location.pathname.toLowerCase() === '/reset-password' ||
      hasInvitationCallback() ||
      hasClaimActivationCallback()
      ? 'update-password'
      : 'sign-in',
  )
  const [isInvitationActivation, setIsInvitationActivation] = useState(
    () => hasInvitationCallback() || hasClaimActivationCallback(),
  )
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [consentAccepted, setConsentAccepted] = useState(false)
  const [isWorking, setIsWorking] = useState(false)
  const [isResolvingAccount, setIsResolvingAccount] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const clearFormInputs = useCallback(() => {
    setDisplayName('')
    setEmail('')
    setPassword('')
    setConsentAccepted(false)
  }, [])

  useEffect(() => {
    onAuthenticatedRef.current = onAuthenticated
  }, [onAuthenticated])

  const finishSignIn = useCallback(
    async (
      session: Session,
      name?: string,
      canNavigate: () => boolean = () => true,
    ) => {
      setIsResolvingAccount(true)
      try {
        clearFormInputs()
        const profile = await linkAuthenticatedAccount(session.access_token, name)
        if (canNavigate()) onAuthenticatedRef.current(destinationByRole[profile.role])
      } catch (linkError) {
        try {
          const signOutResult = await supabase?.auth.signOut({ scope: 'local' })
          if (signOutResult?.error) throw signOutResult.error
        } catch (signOutError) {
          throw new Error(
            `${getErrorMessage(linkError)} Sign-out failed: ${getErrorMessage(signOutError)}`,
            { cause: signOutError },
          )
        }
        throw linkError
      } finally {
        setIsResolvingAccount(false)
      }
    },
    [clearFormInputs, supabase],
  )

  useEffect(() => {
    if (!supabase) return
    let active = true
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setMode('update-password')
    })

    void (async () => {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession()
        if (!active) return
        if (sessionError && !authCallbackTokens.current) throw sessionError
        let session = data.session
        if (!session && authCallbackTokens.current) {
          const { data: restoredSession, error: restoreError } = await supabase.auth.setSession({
            access_token: authCallbackTokens.current.accessToken,
            refresh_token: authCallbackTokens.current.refreshToken,
          })
          if (restoreError) throw restoreError
          session = restoredSession.session
          if (session) {
            authCallbackTokens.current = null
            window.history.replaceState(
              {},
              '',
              `${window.location.pathname}${window.location.search}`,
            )
          }
        }
        if (
          !session ||
          window.location.pathname.toLowerCase() === '/reset-password' ||
          isInvitationActivation
        ) return
        await finishSignIn(session, getDisplayName(session), () => active)
      } catch (sessionError: unknown) {
        if (active) setError(getErrorMessage(sessionError))
      }
    })()

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [supabase, finishSignIn, isInvitationActivation])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) {
      setError('Account access is not configured. Contact your administrator.')
      return
    }
    setIsWorking(true)
    setError('')
    setMessage('')
    try {
      if (mode === 'reset-request') {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: new URL('/reset-password', window.location.origin).toString(),
        })
        if (resetError) throw resetError
        setMessage('If an account exists for that email, a password reset link has been sent.')
      } else if (mode === 'update-password') {
        const { data: sessionData, error: currentSessionError } = await supabase.auth.getSession()
        if (currentSessionError) throw currentSessionError
        if (!sessionData.session) {
          throw new Error(
            'This password setup link has no active authentication session. Request a new invitation and open its link in the same browser.',
          )
        }
        const userRoles = (sessionData?.session?.user?.user_metadata?.roles as string[] | undefined) || []
        const isAdmin = userRoles.includes('admin')
        const validation = validatePasswordPolicy(password, isAdmin ? 'admin' : undefined)
        if (!validation.isValid) {
          throw new Error(validation.errors[0])
        }
        const { data, error: updateError } = await supabase.auth.updateUser({ password })
        if (updateError) throw updateError
        if (!data.user) throw new Error('Password update completed without a user profile.')
        const { data: refreshedSessionData, error: sessionError } = await supabase.auth.getSession()
        if (sessionError) throw sessionError
        if (isInvitationActivation && refreshedSessionData.session) {
          await activateAccountInvitation(refreshedSessionData.session.access_token)
          setIsInvitationActivation(false)
        }
        if (!refreshedSessionData.session) {
          clearFormInputs()
          setMode('sign-in')
          setMessage('Password updated. Sign in with your new password.')
        } else {
          await finishSignIn(refreshedSessionData.session, getDisplayName(refreshedSessionData.session))
        }
      } else if (mode === 'register') {
        if (!consentAccepted) {
          throw new Error('You must acknowledge the Data Protection Notice to create an account.')
        }
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: displayName.trim() } },
        })
        if (signUpError) throw signUpError
        if (data.session) {
          await finishSignIn(data.session, displayName.trim())
        } else {
          clearFormInputs()
          setMessage('Account created. Sign in to continue.')
        }
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (signInError) {
          throw new Error('Email or password is incorrect.')
        }
        if (!data.session) throw new Error('Sign-in completed without an authenticated session.')
        await finishSignIn(data.session, getDisplayName(data.session))
      }
    } catch (authError) {
      setError(getErrorMessage(authError))
    } finally {
      setIsWorking(false)
    }
  }

  if (isResolvingAccount) {
    return (
      <main className="auth-entry" id="overview">
        <SoilSyncLoading label="Opening your secure workspace…" />
      </main>
    )
  }

  return (
    <main className="auth-entry" id="overview">
      <div className="auth-entry-brand" aria-label="SoilSync AI">
        <span className="brand-mark">
          <Sprout size={21} />
        </span>
        <span className="brand-name">
          Soil<span>Sync</span> <span className="brand-ai">AI</span>
        </span>
      </div>
      <section className="auth-entry-card" aria-labelledby="auth-entry-title">
        <div className="panel-kicker">
          <LockKeyhole size={16} /> SECURE ACCOUNT ACCESS
        </div>
        <h1 id="auth-entry-title">
          {mode === 'sign-in'
            ? 'Welcome back'
            : mode === 'register'
              ? 'Create your SoilSync AI account'
              : mode === 'reset-request'
                ? 'Reset your password'
                : 'Choose a new password'}
        </h1>
        <p className="auth-entry-intro">
          {mode === 'reset-request'
            ? 'Enter your account email and we will send instructions to reset your password.'
            : mode === 'update-password'
              ? isInvitationActivation
                ? 'Choose your own password to activate your administrator-provisioned account.'
                : 'Enter a new password for your SoilSync AI account.'
              : 'Sign in with your email and password. Your approved account profile determines your workspace.'}
        </p>
        {!supabase && (
          <p className="account-notice account-notice-error" role="alert">
            Account access is not configured. Contact your administrator.
          </p>
        )}
        <form className="account-form" onSubmit={submit}>
          {mode === 'register' && (
            <label className="account-field">
              <span>Full name</span>
              <input
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                required
              />
            </label>
          )}
          {mode !== 'update-password' && (
            <label className="account-field">
              <span>Email address</span>
              <input
                type="email"
                autoComplete="off"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
          )}
          {mode !== 'reset-request' && (
            <label className="account-field">
              <span>{mode === 'update-password' ? 'New password' : 'Password'}</span>
              <input
                type="password"
                autoComplete={mode === 'sign-in' ? 'off' : 'new-password'}
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
          )}
          {mode === 'register' && (
            <label
              className="account-checkbox-field"
              style={{
                display: 'flex',
                gap: '8px',
                alignItems: 'flex-start',
                margin: '12px 0 6px',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={consentAccepted}
                onChange={(event) => setConsentAccepted(event.target.checked)}
                required
                style={{ marginTop: '3px' }}
              />
              <span style={{ fontSize: '13px', lineHeight: '1.4' }}>
                I acknowledge the Kenya Data Protection Notice and consent to agricultural record
                processing.
              </span>
            </label>
          )}
          {mode === 'register' && (
            <p className="auth-entry-note">
              New self-registered accounts start with farmer access. Staff, dealer, and admin access
              must be assigned by an administrator.
            </p>
          )}
          <button
            className="primary-button auth-entry-submit"
            type="submit"
            disabled={isWorking || !supabase}
          >
            {isWorking
              ? mode === 'sign-in'
                ? 'Signing in…'
                : mode === 'register'
                  ? 'Creating account…'
                  : mode === 'reset-request'
                    ? 'Sending reset link…'
                    : 'Updating password…'
              : mode === 'sign-in'
                ? 'Sign in'
                : mode === 'register'
                  ? 'Create account'
                  : mode === 'reset-request'
                    ? 'Send reset link'
                    : 'Update password'}
            <ArrowRight size={16} />
          </button>
        </form>
        {message && (
          <p className="account-notice" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="account-notice account-notice-error" role="alert">
            {error}
          </p>
        )}
        {mode === 'sign-in' && (
          <button
            className="text-button auth-entry-forgot"
            type="button"
            onClick={() => {
              clearFormInputs()
              setMode('reset-request')
              setError('')
              setMessage('')
            }}
          >
            Forgot password?
          </button>
        )}
        {(mode === 'sign-in' || mode === 'register') && (
          <p className="account-switch-mode">
            {mode === 'sign-in' ? 'New to SoilSync AI?' : 'Already have an account?'}{' '}
            <button
              className="text-button"
              type="button"
              onClick={() => {
                clearFormInputs()
                setMode((current) => (current === 'sign-in' ? 'register' : 'sign-in'))
                setError('')
                setMessage('')
              }}
            >
              {mode === 'sign-in' ? 'Create account' : 'Sign in'}
            </button>
          </p>
        )}
        {(mode === 'reset-request' || mode === 'update-password') && (
          <p className="account-switch-mode">
            Remembered your password?{' '}
            <button
              className="text-button"
              type="button"
              onClick={() => {
                clearFormInputs()
                setMode('sign-in')
                setError('')
                setMessage('')
              }}
            >
              Back to sign in
            </button>
          </p>
        )}
      </section>
    </main>
  )
}
