import { startTransition, useEffect, useState, type FormEvent } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  LogOut,
  MapPin,
  Plus,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
  X,
} from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import {
  createFarmerFarm,
  getFarmerProfile,
  getFarmerReadings,
  getFarmerRecommendations,
  getFarmerSyncStatus,
  getFarmVerifiedReport,
  getRecommendationFeedback,
  linkFarmerAccount,
  requestFarmerFieldVisit,
  saveRecommendationFeedback,
  submitFarmerSyncDraft,
  type FarmerFarm,
  type FarmerProfile,
  type FarmSyncStatus,
  type RecommendationFeedback,
  type VerifiedSoilReport,
} from './api/farmer'
import { KENYA_COUNTIES, getSubCounties, getWards } from './data/kenyaLocations'
import { getSupabaseClient } from './lib/supabase'
import { SoilSyncLoading } from './SoilSyncLoading'
import type { SoilReading, SoilRecommendation } from './types/soil'

type FeedbackResponse = RecommendationFeedback['response']

interface LocalDraft {
  draftId: string
  clientDraftId: string
  farmId: string
  draftType: string
  payload: Record<string, unknown>
  status: 'draft' | 'queued' | 'conflict'
  version: number
  createdAt: string
}

const feedbackOptions: Array<{ response: FeedbackResponse; label: string }> = [
  { response: 'viewed', label: 'Viewed' },
  { response: 'followed', label: 'Followed' },
  { response: 'modified', label: 'Modified' },
  { response: 'not-followed', label: 'Not followed' },
]

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Date not supplied'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function displayMeasurement(value: number | null, unit: string, quality?: string): string {
  if (quality === 'missing') return 'Missing'
  if (quality === 'invalid_source_value') return 'Invalid'
  if (quality === 'unsupported_depth_or_method') return 'Unsupported'
  return value === null
    ? 'Not recorded'
    : `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })} ${unit}`
}

function formatQualityLabel(status: string): string {
  switch (status) {
    case 'valid':
      return 'Measured'
    case 'estimated':
      return 'Estimated'
    case 'missing':
      return 'Missing'
    case 'invalid_source_value':
      return 'Invalid'
    case 'unsupported_depth_or_method':
      return 'Unsupported'
    case 'sample':
      return 'Preview sample'
    default:
      return status.replace(/_/g, ' ')
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.'
}

interface FarmerAccountProps {
  onBackToDemo: () => void
  roleVerifiedByRoute?: boolean
}

export default function FarmerAccount({
  onBackToDemo,
  roleVerifiedByRoute = false,
}: FarmerAccountProps) {
  const supabase = getSupabaseClient()
  const [session, setSession] = useState<Session | null>(null)
  const [isCheckingSession, setIsCheckingSession] = useState(() => supabase !== null)
  const [isWorking, setIsWorking] = useState(false)
  const [authMode, setAuthMode] = useState<'sign-in' | 'register'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [profile, setProfile] = useState<FarmerProfile | null>(null)
  const [selectedFarmId, setSelectedFarmId] = useState('')
  const [readings, setReadings] = useState<SoilReading[]>([])
  const [recommendations, setRecommendations] = useState<SoilRecommendation[]>([])
  const [feedbackByRecommendation, setFeedbackByRecommendation] = useState<
    Record<string, FeedbackResponse>
  >({})
  const [syncStatus, setSyncStatus] = useState<FarmSyncStatus | null>(null)
  const [localDrafts, setLocalDrafts] = useState<LocalDraft[]>([])
  const [verifiedReport, setVerifiedReport] = useState<VerifiedSoilReport | null>(null)
  const [farmName, setFarmName] = useState('')
  const [farmCounty, setFarmCounty] = useState('')
  const [farmSubCounty, setFarmSubCounty] = useState('')
  const [farmWard, setFarmWard] = useState('')
  const [farmSize, setFarmSize] = useState('')
  const [farmCrops, setFarmCrops] = useState('')
  const [showAddFarm, setShowAddFarm] = useState(false)
  const [showVisitModal, setShowVisitModal] = useState(false)
  const [visitNotes, setVisitNotes] = useState('')
  const [isSubmittingVisit, setIsSubmittingVisit] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) {
      return
    }

    let active = true
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      startTransition(() => {
        setSession(nextSession)
        if (!nextSession) {
          setEmail('')
          setPassword('')
          setConfirmPassword('')
          setProfile(null)
          setSelectedFarmId('')
          setReadings([])
          setRecommendations([])
          setFeedbackByRecommendation({})
          setSyncStatus(null)
          setLocalDrafts([])
        }
      })
    })
    void supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!active) return
        if (sessionError) setError(sessionError.message)
        setSession(data.session)
        setIsCheckingSession(false)
      })
      .catch((sessionError: unknown) => {
        if (!active) return
        setError(getErrorMessage(sessionError))
        setIsCheckingSession(false)
      })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [supabase])

  useEffect(() => {
    if (!session) {
      return
    }

    let active = true
    void (async () => {
      try {
        if (!roleVerifiedByRoute) {
          const linked = await linkFarmerAccount(session.access_token, displayName)
          if (linked.role !== 'farmer') {
            await supabase?.auth.signOut()
            throw new Error(
              'This account is not assigned the farmer role. Use its approved role workspace.',
            )
          }
        }
        const nextProfile = await getFarmerProfile(session.access_token)
        if (!active) return
        setProfile(nextProfile)
        const nextFarmId = nextProfile.farms[0]?.farmId ?? ''
        setSelectedFarmId(nextFarmId)
        if (!nextFarmId) {
          setReadings([])
          setRecommendations([])
          setFeedbackByRecommendation({})
          setSyncStatus(null)
          setVerifiedReport(null)
          return
        }
        const [readingsResult, recommendationsResult, nextSyncResult, reportResult] =
          await Promise.allSettled([
            getFarmerReadings(session.access_token, nextFarmId),
            getFarmerRecommendations(session.access_token, nextFarmId),
            getFarmerSyncStatus(session.access_token).catch(() => null),
            getFarmVerifiedReport(session.access_token, nextFarmId),
          ] as const)
        if (!active) return
        const loadErrors: string[] = []
        if (readingsResult.status === 'fulfilled') {
          setReadings(readingsResult.value)
        } else {
          loadErrors.push(`Soil readings: ${getErrorMessage(readingsResult.reason)}`)
        }
        if (recommendationsResult.status === 'fulfilled') {
          setRecommendations(recommendationsResult.value)
        } else {
          loadErrors.push(`Recommendations: ${getErrorMessage(recommendationsResult.reason)}`)
        }
        setSyncStatus(nextSyncResult.status === 'fulfilled' ? nextSyncResult.value : null)
        if (reportResult.status === 'fulfilled') {
          setVerifiedReport(reportResult.value)
        } else {
          loadErrors.push(`Verified report: ${getErrorMessage(reportResult.reason)}`)
        }
        setError(loadErrors.join(' '))
        const feedback = await Promise.all(
          (recommendationsResult.status === 'fulfilled' ? recommendationsResult.value : []).map(
            async (recommendation) => {
              const events = await getRecommendationFeedback(
                session.access_token,
                recommendation.recommendationId,
              )
              return [recommendation.recommendationId, events.at(-1)?.response] as const
            },
          ),
        )
        if (active) {
          setFeedbackByRecommendation(
            Object.fromEntries(
              feedback.filter((entry): entry is readonly [string, FeedbackResponse] =>
                Boolean(entry[1]),
              ),
            ),
          )
        }
      } catch (loadError) {
        if (active) setError(getErrorMessage(loadError))
      } finally {
        if (active) setIsWorking(false)
      }
    })()

    return () => {
      active = false
    }
  }, [session, supabase, displayName, roleVerifiedByRoute])

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setError('')
    setMessage('')
    setIsWorking(true)
    try {
      if (authMode === 'register') {
        if (password !== confirmPassword) {
          throw new Error('The passwords do not match.')
        }
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: displayName.trim() } },
        })
        if (signUpError) throw signUpError
        if (data.session) {
          setSession(data.session)
          setMessage('Account created. Loading your farmer workspace…')
        } else {
          setMessage('Account created. Sign in to continue.')
        }
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (signInError) throw signInError
        if (!data.session) throw new Error('Sign-in completed without an authenticated session.')
        setSession(data.session)
        setMessage('Signed in. Loading your farmer workspace…')
      }
    } catch (authError) {
      setError(getErrorMessage(authError))
    } finally {
      setIsWorking(false)
    }
  }

  async function signOut() {
    if (!supabase || !session) return
    setIsWorking(true)
    setError('')
    let revocationError = ''
    try {
      const response = await fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null
        revocationError = payload?.detail ?? `Server logout returned HTTP ${response.status}.`
      }
    } catch (signOutError) {
      revocationError = getErrorMessage(signOutError)
    } finally {
      let localSignOutError: string | null = null
      try {
        const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
        if (signOutError) {
          localSignOutError = getErrorMessage(signOutError)
        }
      } catch (signOutError) {
        localSignOutError = getErrorMessage(signOutError)
      }
      setSession(null)
      setEmail('')
      setPassword('')
      setConfirmPassword('')
      setProfile(null)
      setSelectedFarmId('')
      setReadings([])
      setRecommendations([])
      setFeedbackByRecommendation({})
      setSyncStatus(null)
      setLocalDrafts([])
      setVerifiedReport(null)
      setMessage(
        revocationError
          ? 'Signed out on this device; server session revocation could not be confirmed. The access token remains valid until expiry.'
          : 'Signed out. Protected account data has been cleared from this page.',
      )
      if (localSignOutError) setError(localSignOutError)
      setIsWorking(false)
      if (!localSignOutError && !revocationError) onBackToDemo()
    }
  }

  async function submitFarm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session) return
    setError('')
    setIsWorking(true)
    try {
      await createFarmerFarm(session.access_token, {
        name: farmName,
        county: farmCounty || undefined,
        subCounty: farmSubCounty || undefined,
        ward: farmWard || undefined,
        sizeAcres: farmSize ? parseFloat(farmSize) : undefined,
        crops: farmCrops || undefined,
      })
      const nextProfile = await getFarmerProfile(session.access_token)
      setProfile(nextProfile)
      setSelectedFarmId(nextProfile.farms[0]?.farmId ?? '')
      setFarmName('')
      setFarmCounty('')
      setFarmSubCounty('')
      setFarmWard('')
      setFarmSize('')
      setFarmCrops('')
      setShowAddFarm(false)
      setMessage(
        'Farm registered. In-person extension officer visit needed for baseline soil measurements and GPS calibration.',
      )
    } catch (farmError) {
      setError(getErrorMessage(farmError))
    } finally {
      setIsWorking(false)
    }
  }

  async function handleRequestVisit() {
    if (!session || !selectedFarmId) return
    setError('')
    setIsSubmittingVisit(true)
    try {
      const res = await requestFarmerFieldVisit(
        session.access_token,
        selectedFarmId,
        visitNotes || undefined,
      )
      setMessage(res.message || 'Field visit request submitted to county extension officer pool.')
      setShowVisitModal(false)
      setVisitNotes('')
      const nextProfile = await getFarmerProfile(session.access_token)
      setProfile(nextProfile)
    } catch (visitError) {
      setError(getErrorMessage(visitError))
    } finally {
      setIsSubmittingVisit(false)
    }
  }

  async function changeFarm(farmId: string) {
    if (!session) return
    setSelectedFarmId(farmId)
    setError('')
    setIsWorking(true)
    try {
      const [nextReadings, nextRecommendations, nextSync] = await Promise.all([
        getFarmerReadings(session.access_token, farmId),
        getFarmerRecommendations(session.access_token, farmId),
        getFarmerSyncStatus(session.access_token).catch(() => null),
      ])
      setReadings(nextReadings)
      setRecommendations(nextRecommendations)
      setSyncStatus(nextSync)
      const feedback = await Promise.all(
        nextRecommendations.map(async (recommendation) => {
          const events = await getRecommendationFeedback(
            session.access_token,
            recommendation.recommendationId,
          )
          return [recommendation.recommendationId, events.at(-1)?.response] as const
        }),
      )
      setFeedbackByRecommendation(
        Object.fromEntries(
          feedback.filter((entry): entry is readonly [string, FeedbackResponse] =>
            Boolean(entry[1]),
          ),
        ),
      )
    } catch (farmError) {
      setError(getErrorMessage(farmError))
    } finally {
      setIsWorking(false)
    }
  }

  async function syncDraft(draft: LocalDraft) {
    if (!session) return
    setError('')
    setIsWorking(true)
    try {
      const result = await submitFarmerSyncDraft(session.access_token, {
        draftId: draft.draftId,
        payload: draft.payload,
      })
      if (result.status === 'conflict') {
        setLocalDrafts((current) =>
          current.map((item) =>
            item.draftId === draft.draftId ? { ...item, status: 'conflict' } : item,
          ),
        )
        setMessage('Duplicate submission detected: This draft has already been queued.')
      } else if (result.status === 'queued') {
        setLocalDrafts((current) =>
          current.map((item) =>
            item.draftId === draft.draftId ? { ...item, status: 'queued' } : item,
          ),
        )
        setMessage('Draft successfully queued for sync.')
        const nextSync = await getFarmerSyncStatus(session.access_token).catch(() => null)
        if (nextSync) setSyncStatus(nextSync)
      } else if (result.status === 'ownership_pending') {
        setError('Farm ownership review is required before syncing drafts.')
      }
    } catch (syncError) {
      setError(getErrorMessage(syncError))
    } finally {
      setIsWorking(false)
    }
  }

  async function recordFeedback(recommendationId: string, response: FeedbackResponse) {
    if (!session) return
    setError('')
    try {
      await saveRecommendationFeedback(session.access_token, recommendationId, response)
      setFeedbackByRecommendation((current) => ({ ...current, [recommendationId]: response }))
      setMessage('Your feedback was saved.')
    } catch (feedbackError) {
      setError(getErrorMessage(feedbackError))
    }
  }

  if (isCheckingSession || (session && !profile && !error)) {
    return <SoilSyncLoading label="Checking secure farmer session…" />
  }

  if (!session) {
    return (
      <section className="farmer-account-view">
        <div className="account-heading">
          <div>
            <div className="eyebrow">FARMER ACCOUNT</div>
            <h1>Sign in to your farm</h1>
            <p>Sign in with your email and password to access your private farm records.</p>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={onBackToDemo}
            aria-label="Back to role directory"
          >
            <ArrowLeft size={16} /> Back to sign in
          </button>
        </div>
        {!supabase ? (
          <div className="account-notice account-notice-error" role="alert">
            Supabase Auth is not configured for this build. Contact your administrator to enable
            account access.
          </div>
        ) : (
          <div className="account-auth-layout">
            <section className="account-auth-panel" aria-labelledby="farmer-auth-title">
              <div className="panel-kicker">
                <ShieldCheck size={16} /> SECURE ACCOUNT ACCESS
              </div>
              <h2 id="farmer-auth-title">
                {authMode === 'register' ? 'Create a farmer account' : 'Sign in to your farm'}
              </h2>
              <form className="account-form" onSubmit={authenticate}>
                {authMode === 'register' && (
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
                <label className="account-field">
                  <span>Email address</span>
                  <input
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </label>
                <label className="account-field">
                  <span>Password</span>
                  <input
                    type="password"
                    autoComplete={authMode === 'sign-in' ? 'current-password' : 'new-password'}
                    minLength={8}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </label>
                {authMode === 'register' && (
                  <label className="account-field">
                    <span>Confirm password</span>
                    <input
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      required
                    />
                  </label>
                )}
                <button className="primary-button" type="submit" disabled={isWorking}>
                  {isWorking
                    ? authMode === 'sign-in'
                      ? 'Signing in…'
                      : 'Creating account…'
                    : authMode === 'sign-in'
                      ? 'Sign in'
                      : 'Create account'}
                </button>
              </form>
              <p className="account-switch-mode">
                {authMode === 'sign-in' ? 'New to SoilSync AI?' : 'Already have an account?'}{' '}
                <button
                  className="text-button"
                  type="button"
                  onClick={() => {
                    setAuthMode((current) => (current === 'sign-in' ? 'register' : 'sign-in'))
                    setPassword('')
                    setConfirmPassword('')
                    setError('')
                    setMessage('')
                  }}
                >
                  {authMode === 'sign-in' ? 'Create account' : 'Sign in'}
                </button>
              </p>
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
            </section>
            <aside className="account-auth-aside">
              <span className="account-aside-mark">
                <ShieldCheck size={22} />
              </span>
              <h2>Your account, your records</h2>
              <p>
                Farmer accounts use phone verification. Farms, readings, recommendations, and
                feedback are loaded only after your identity is verified.
              </p>
              <p>
                New farms remain read-only for soil submissions until ownership review is complete.
              </p>
            </aside>
          </div>
        )}
      </section>
    )
  }

  const selectedFarm: FarmerFarm | undefined = profile?.farms.find(
    (farm) => farm.farmId === selectedFarmId,
  )

  return (
    <section className="farmer-account-view">
      <div className="account-heading">
        <div>
          <div className="eyebrow">AUTHENTICATED FARMER WORKSPACE</div>
          <h1>{profile?.name ? `Welcome, ${profile.name}` : 'Your farm account'}</h1>
          <p>
            {profile?.phone ?? 'Verified phone account'} · Your records are scoped to this account.
          </p>
        </div>
        <div className="account-heading-actions">
          <button className="secondary-button" type="button" onClick={signOut} disabled={isWorking}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </div>

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
      {isWorking && (
        <p className="account-muted" role="status">
          Updating your account…
        </p>
      )}

      {profile && (
        <>
          <section className="account-section" id="farm" aria-labelledby="owned-farms-title">
            <div className="section-heading">
              <div>
                <div className="eyebrow">PRIVATE TO YOUR ACCOUNT</div>
                <h2 id="owned-farms-title">Your farms</h2>
              </div>
              {profile.farms.length > 1 && (
                <label className="account-farm-picker">
                  <span>Farm</span>
                  <select
                    value={selectedFarmId}
                    onChange={(event) => void changeFarm(event.target.value)}
                  >
                    {profile.farms.map((farm) => (
                      <option key={farm.farmId} value={farm.farmId}>
                        {farm.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {selectedFarm && (
              <>
                <div className="account-farm-row">
                  <div>
                    <h3>{selectedFarm.name}</h3>
                    <p>
                      {[selectedFarm.ward, selectedFarm.subCounty, selectedFarm.county]
                        .filter(Boolean)
                        .join(' · ') || 'Location not supplied'}
                    </p>
                  </div>
                  <div className="farm-status-badges">
                    <span
                      className={`account-review-state ${selectedFarm.ownerVerified ? 'is-approved' : ''}`}
                    >
                      <span className="status-dot muted" />
                      {selectedFarm.ownerVerified
                        ? 'Ownership verified'
                        : 'Ownership review pending'}
                    </span>
                    <span
                      className={`account-review-state ${
                        selectedFarm.soilDataCollected ||
                        (selectedFarm.latitude !== null && readings.length > 0)
                          ? 'is-approved'
                          : selectedFarm.hasVisitRequest
                            ? 'is-pending'
                            : 'is-incomplete'
                      }`}
                    >
                      <span className="status-dot" />
                      {selectedFarm.soilDataCollected ||
                      (selectedFarm.latitude !== null && readings.length > 0)
                        ? 'COLLECTION COMPLETE'
                        : selectedFarm.hasVisitRequest
                          ? `VISIT ${selectedFarm.visitStatus?.toUpperCase() || 'REQUESTED'}`
                          : 'INCOMPLETE — VISIT NEEDED'}
                    </span>
                  </div>
                </div>

                {selectedFarm.soilDataCollected ? (
                  <div
                    className="account-visit-banner"
                    role="region"
                    aria-label="Field collection completed"
                  >
                    <div className="visit-banner-header">
                      <div className="visit-banner-title">
                        <CheckCircle2 size={18} style={{ color: 'var(--success, #2e7d32)' }} />
                        <div>
                          <strong>Field Data Collected — Assessment Under Agronomic Review</strong>
                          <p>
                            Soil properties and GPS coordinates were recorded on-site by Extension
                            Officer{' '}
                            {selectedFarm.coordinatesCapturedBy ? (
                              <strong>{selectedFarm.coordinatesCapturedBy}</strong>
                            ) : (
                              'assigned to your county'
                            )}
                            . Your personalized soil report is currently under review by an
                            agronomist and will appear below once verified.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : selectedFarm.hasVisitRequest ? (
                  <div className="account-visit-banner" role="region" aria-label="Visit requested">
                    <div className="visit-banner-header">
                      <div className="visit-banner-title">
                        <Clock size={18} style={{ color: 'var(--primary, #1b5e20)' }} />
                        <div>
                          <strong>
                            Field Visit Active (
                            {selectedFarm.visitStatus?.toUpperCase() || 'REQUESTED'})
                          </strong>
                          <p>
                            Your request is active in the county extension officer pool. An
                            extension officer will claim and conduct on-site soil sampling and GPS
                            coordinate capture.
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="visit-banner-jurisdiction">
                      <MapPin size={14} />
                      <span>
                        County Extension Pool:{' '}
                        <strong>
                          {[selectedFarm.ward, selectedFarm.subCounty, selectedFarm.county]
                            .filter(Boolean)
                            .join(' > ') || 'National Officer Pool'}
                        </strong>
                      </span>
                    </div>
                  </div>
                ) : (
                  <div
                    className="account-visit-banner"
                    role="region"
                    aria-label="Visit required notice"
                  >
                    <div className="visit-banner-header">
                      <div className="visit-banner-title">
                        <AlertCircle size={18} className="visit-alert-icon" />
                        <div>
                          <strong>Field Visit Required (Incomplete Farm State)</strong>
                          <p>
                            Baseline soil readings and GPS coordinates have not yet been recorded by
                            an extension officer. Personalized recommendations will activate once
                            verified measurements are completed.
                          </p>
                        </div>
                      </div>
                      <button
                        className="primary-button request-visit-cta"
                        type="button"
                        onClick={() => setShowVisitModal(true)}
                        disabled={isSubmittingVisit}
                      >
                        <Calendar size={16} /> Request Field Visit
                      </button>
                    </div>
                    <div className="visit-banner-jurisdiction">
                      <MapPin size={14} />
                      <span>
                        County Extension Pool:{' '}
                        <strong>
                          {[selectedFarm.ward, selectedFarm.subCounty, selectedFarm.county]
                            .filter(Boolean)
                            .join(' > ') || 'National Officer Pool'}
                        </strong>
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}

            {(!selectedFarm || showAddFarm) && (
              <form className="account-create-farm" onSubmit={submitFarm}>
                <div className="create-farm-header">
                  <h3>{!selectedFarm ? 'Register your farm' : 'Add another farm'}</h3>
                  <p>
                    Enter your farm name and select its geographic location in Kenya. An extension
                    officer will be routed according to the selected county, sub-county, and ward.
                  </p>
                </div>
                <div className="account-form-grid">
                  <label className="account-field">
                    <span>Farm name</span>
                    <input
                      value={farmName}
                      onChange={(event) => setFarmName(event.target.value)}
                      placeholder="e.g. Green Valley Farm"
                      required
                    />
                  </label>
                  <label className="account-field">
                    <span>County</span>
                    <select
                      value={farmCounty}
                      onChange={(event) => {
                        const nextCounty = event.target.value
                        setFarmCounty(nextCounty)
                        setFarmSubCounty('')
                        setFarmWard('')
                      }}
                      required
                    >
                      <option value="">Select County (all 47)</option>
                      {KENYA_COUNTIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="account-field">
                    <span>Sub-county</span>
                    <select
                      value={farmSubCounty}
                      onChange={(event) => {
                        const nextSubCounty = event.target.value
                        setFarmSubCounty(nextSubCounty)
                        setFarmWard('')
                      }}
                      disabled={!farmCounty}
                      required
                    >
                      <option value="">
                        {farmCounty ? 'Select Sub-county' : 'Select County first'}
                      </option>
                      {farmCounty &&
                        getSubCounties(farmCounty).map((sc) => (
                          <option key={sc} value={sc}>
                            {sc}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="account-field">
                    <span>Ward</span>
                    <select
                      value={farmWard}
                      onChange={(event) => setFarmWard(event.target.value)}
                      disabled={!farmSubCounty}
                      required
                    >
                      <option value="">
                        {farmSubCounty ? 'Select Ward' : 'Select Sub-county first'}
                      </option>
                      {farmCounty &&
                        farmSubCounty &&
                        getWards(farmCounty, farmSubCounty).map((w) => (
                          <option key={w} value={w}>
                            {w}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="account-field">
                    <span>Farm size (acres)</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={farmSize}
                      onChange={(event) => setFarmSize(event.target.value)}
                      placeholder="e.g. 2.5"
                    />
                  </label>
                  <label className="account-field">
                    <span>Target crops</span>
                    <input
                      value={farmCrops}
                      onChange={(event) => setFarmCrops(event.target.value)}
                      placeholder="e.g. Maize, Beans, Potatoes"
                    />
                  </label>
                </div>
                <div className="farm-form-actions">
                  <button className="primary-button" type="submit" disabled={isWorking}>
                    <Plus size={16} /> Save farm
                  </button>
                  {selectedFarm && showAddFarm && (
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setShowAddFarm(false)}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            )}

            {selectedFarm && !showAddFarm && (
              <div className="add-farm-action-bar">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setShowAddFarm(true)}
                >
                  <Plus size={14} /> Add another farm
                </button>
              </div>
            )}

            {showVisitModal && selectedFarm && (
              <div
                className="modal-backdrop"
                role="dialog"
                aria-modal="true"
                aria-labelledby="modal-title"
              >
                <div className="modal-content">
                  <div className="modal-header">
                    <div>
                      <div className="eyebrow">FIELD VISIT DISPATCH</div>
                      <h3 id="modal-title">Request Extension Officer Visit</h3>
                    </div>
                    <button
                      type="button"
                      className="modal-close-button"
                      onClick={() => setShowVisitModal(false)}
                      aria-label="Close modal"
                    >
                      <X size={18} />
                    </button>
                  </div>
                  <div className="modal-body">
                    <p>
                      A visit request for <strong>{selectedFarm.name}</strong> will be broadcast to
                      certified agricultural extension officers in{' '}
                      <strong>
                        {[selectedFarm.ward, selectedFarm.subCounty, selectedFarm.county]
                          .filter(Boolean)
                          .join(', ') || 'your county'}
                      </strong>
                      .
                    </p>
                    <label className="account-field">
                      <span>Notes or special instructions (optional)</span>
                      <textarea
                        rows={3}
                        value={visitNotes}
                        onChange={(e) => setVisitNotes(e.target.value)}
                        placeholder="e.g. Planning maize planting in 3 weeks, need acidity check and GPS survey."
                      />
                    </label>
                  </div>
                  <div className="modal-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setShowVisitModal(false)}
                      disabled={isSubmittingVisit}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => void handleRequestVisit()}
                      disabled={isSubmittingVisit}
                    >
                      {isSubmittingVisit ? 'Submitting…' : 'Submit Request'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>

          {selectedFarm && (
            <>
              <section
                className="account-section"
                id="measurements"
                aria-labelledby="account-readings-title"
              >
                <div className="section-heading">
                  <div>
                    <div className="eyebrow">DATABASE HISTORY</div>
                    <h2 id="account-readings-title">Soil readings</h2>
                  </div>
                  <span className="sample-status">{readings.length} saved</span>
                </div>
                {!selectedFarm.ownerVerified && (
                  <div className="account-notice" role="note">
                    Farm ownership review is pending. You can view this farm, but reading
                    submissions stay disabled until approval.
                  </div>
                )}
                {readings.length === 0 ? (
                  <p className="account-empty">No readings have been saved for this farm.</p>
                ) : (
                  <div className="account-reading-list">
                    {readings.map((reading) => (
                      <article className="account-reading" key={reading.readingId}>
                        <div className="account-reading-heading">
                          <strong>
                            {formatDate(
                              reading.sample.sampledAt ??
                                (reading.sample.sampleYear
                                  ? String(reading.sample.sampleYear)
                                  : null),
                            )}
                          </strong>
                          <span>
                            {reading.sample.depth.sourceLabel ??
                              (reading.sample.depth.topCm !== null &&
                              reading.sample.depth.bottomCm !== null
                                ? `${reading.sample.depth.topCm}-${reading.sample.depth.bottomCm} cm`
                                : 'Depth not supplied')}
                          </span>
                        </div>
                        <div className="account-measurements">
                          {reading.measurements.map((measurement) => (
                            <div
                              key={`${reading.readingId}-${measurement.analyte}`}
                              className={`measurement-item quality-${measurement.qualityStatus}`}
                            >
                              <span className="measurement-label">
                                {measurement.analyte.replaceAll('_', ' ')}
                              </span>
                              <strong className="measurement-value">
                                {displayMeasurement(
                                  measurement.value,
                                  measurement.sourceUnit,
                                  measurement.qualityStatus,
                                )}
                              </strong>
                              <small
                                className={`quality-badge quality-${measurement.qualityStatus}`}
                              >
                                {formatQualityLabel(measurement.qualityStatus)}
                              </small>
                            </div>
                          ))}
                        </div>
                        <p className="account-provenance">
                          <span>Source: {reading.source.provider}</span>
                          {reading.source.attribution && (
                            <span> · {reading.source.attribution}</span>
                          )}
                          {reading.source.datasetId && (
                            <span> · Dataset: {reading.source.datasetId}</span>
                          )}
                          {reading.source.recordId && (
                            <span> · Record: {reading.source.recordId}</span>
                          )}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
                <div className="account-readings-officer-notice">
                  <ShieldCheck size={16} />
                  <span>
                    Soil measurements are collected on-site and verified by certified agricultural
                    extension officers. Once an officer completes a field visit, test results and
                    calibrated recommendations are automatically synced to this view.
                  </span>
                </div>
              </section>

              <section
                className="account-section"
                id="sync-drafts"
                aria-labelledby="account-sync-title"
              >
                <div className="section-heading">
                  <div>
                    <div className="eyebrow">OFFLINE QUEUE &amp; SYNC</div>
                    <h2 id="account-sync-title">Sync &amp; offline drafts</h2>
                  </div>
                  <div className="sync-status-badge-group">
                    <span
                      className={`sync-status-indicator ${syncStatus?.ready ? 'is-ready' : 'is-pending'}`}
                    >
                      {syncStatus?.status === 'ready'
                        ? 'Ready to sync'
                        : 'Ownership review pending'}
                    </span>
                  </div>
                </div>
                <div className="sync-metrics-grid">
                  <div className="sync-metric-card">
                    <span className="sync-metric-label">Offline Drafts</span>
                    <strong className="sync-metric-value">
                      {syncStatus?.offlineDrafts ??
                        localDrafts.filter((d) => d.status === 'draft').length}
                    </strong>
                  </div>
                  <div className="sync-metric-card">
                    <span className="sync-metric-label">Queued Syncs</span>
                    <strong className="sync-metric-value">
                      {syncStatus?.pendingSyncs ??
                        localDrafts.filter((d) => d.status === 'queued').length}
                    </strong>
                  </div>
                </div>
                {localDrafts.length === 0 ? (
                  <p className="account-empty">
                    No local drafts saved for this session. Drafts saved offline appear here for
                    queueing and duplicate conflict detection.
                  </p>
                ) : (
                  <div className="account-drafts-list">
                    {localDrafts.map((draft) => (
                      <article className="account-draft-card" key={draft.draftId}>
                        <div className="draft-card-header">
                          <div>
                            <strong>{draft.draftType.replace('-', ' ').toUpperCase()}</strong>
                            <small> · ID: {draft.clientDraftId}</small>
                          </div>
                          <span className={`draft-status-pill status-${draft.status}`}>
                            {draft.status === 'draft'
                              ? 'Draft Saved'
                              : draft.status === 'queued'
                                ? 'Sync Queued'
                                : 'Conflict: Already Queued'}
                          </span>
                        </div>
                        <p className="draft-preview">
                          {draft.payload.measurements && Array.isArray(draft.payload.measurements)
                            ? draft.payload.measurements
                                .map(
                                  (m: { analyte: string; value: number; sourceUnit: string }) =>
                                    `${m.analyte.replace('_', ' ')}: ${m.value} ${m.sourceUnit}`,
                                )
                                .join(' · ')
                            : 'Soil reading draft payload'}
                        </p>
                        <div className="draft-actions">
                          {draft.status === 'draft' && (
                            <button
                              className="primary-button draft-action-btn"
                              type="button"
                              onClick={() => void syncDraft(draft)}
                              disabled={isWorking}
                            >
                              <UploadCloud size={14} /> Queue for sync
                            </button>
                          )}
                          {draft.status === 'conflict' && (
                            <button
                              className="secondary-button draft-action-btn"
                              type="button"
                              onClick={() => void syncDraft(draft)}
                              disabled={isWorking}
                            >
                              <RefreshCw size={14} /> Retry queue
                            </button>
                          )}
                          {draft.status === 'queued' && (
                            <span className="draft-queued-label">
                              <CheckCircle2 size={14} /> In sync queue
                            </span>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>

              {/* Verified Agronomic Report Section (Step 4 V5 Spec) */}
              {verifiedReport && (
                <section
                  className="account-section verified-report-section"
                  id="verified-report"
                  style={{
                    backgroundColor: 'rgba(16, 185, 129, 0.04)',
                    border: '2px solid rgba(16, 185, 129, 0.4)',
                    borderRadius: '0.75rem',
                    padding: '1.5rem',
                    marginBottom: '2rem',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: '1rem',
                      flexWrap: 'wrap',
                      gap: '0.75rem',
                    }}
                  >
                    <div>
                      <div className="eyebrow" style={{ color: '#059669', fontWeight: 700 }}>
                        OFFICIAL KALRO-CERTIFIED AGRONOMIC REPORT
                      </div>
                      <h2 style={{ margin: '0.25rem 0' }}>
                        Verified Soil Assessment for {verifiedReport.farmName}
                      </h2>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        Target Crop: <strong>{verifiedReport.crop}</strong> • Region:{' '}
                        <strong>{verifiedReport.county}</strong> • Certified:{' '}
                        {formatDate(verifiedReport.publishedAt)}
                      </div>
                      <div
                        style={{
                          fontSize: '0.8rem',
                          color: 'var(--text-secondary)',
                          marginTop: '0.35rem',
                        }}
                      >
                        Location:{' '}
                        {[verifiedReport.subCounty, verifiedReport.ward]
                          .filter(Boolean)
                          .join(' · ') || 'County-level details only'}{' '}
                        · Collected: {formatDate(verifiedReport.sampledAt)} · Extension officer:{' '}
                        {verifiedReport.officerName || 'Not recorded'} · Assessment:{' '}
                        {formatDate(verifiedReport.assessedAt)}
                      </div>
                    </div>
                    <span
                      style={{
                        padding: '0.4rem 0.85rem',
                        backgroundColor: '#10b981',
                        color: '#ffffff',
                        fontWeight: 700,
                        fontSize: '0.8rem',
                        borderRadius: '9999px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        letterSpacing: '0.05em',
                      }}
                    >
                      <CheckCircle2 size={16} /> VERIFIED &amp; PUBLISHED
                    </span>
                  </div>

                  {/* Agronomist Sign-Off Banner */}
                  <div
                    style={{
                      padding: '0.75rem 1rem',
                      backgroundColor: 'rgba(16, 185, 129, 0.1)',
                      borderLeft: '4px solid #10b981',
                      borderRadius: '0.375rem',
                      marginBottom: '1.25rem',
                      fontSize: '0.9rem',
                    }}
                  >
                    <strong>Agronomist Certification:</strong> {verifiedReport.certification}
                    {verifiedReport.finalAgronomistNotes && (
                      <div style={{ marginTop: '0.35rem', fontStyle: 'italic' }}>
                        Special Agronomic Advice: "{verifiedReport.finalAgronomistNotes}"
                      </div>
                    )}
                  </div>

                  {/* Diagnosed Soil Health Status */}
                  <div style={{ marginBottom: '1.5rem' }}>
                    <h3 style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>
                      1. Diagnosed Soil Nutrient &amp; Health Levels
                    </h3>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                        gap: '0.75rem',
                      }}
                    >
                      {verifiedReport.diagnoses.map((d) => (
                        <div
                          key={d.analyte}
                          style={{
                            padding: '0.75rem',
                            borderRadius: '0.5rem',
                            backgroundColor: 'var(--surface-panel)',
                            border: '1px solid var(--border-color)',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: '0.35rem',
                            }}
                          >
                            <strong style={{ fontSize: '0.85rem', textTransform: 'uppercase' }}>
                              {d.analyte.replace(/_/g, ' ')}
                            </strong>
                            <span
                              style={{
                                fontSize: '0.75rem',
                                padding: '0.15rem 0.5rem',
                                borderRadius: '0.25rem',
                                backgroundColor:
                                  d.status === 'optimal'
                                    ? 'rgba(16, 185, 129, 0.15)'
                                    : 'rgba(239, 68, 68, 0.15)',
                                color: d.status === 'optimal' ? '#047857' : '#b91c1c',
                                fontWeight: 600,
                              }}
                            >
                              {d.status.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                            {d.value}{' '}
                            <small
                              style={{
                                fontSize: '0.75rem',
                                fontWeight: 400,
                                color: 'var(--text-secondary)',
                              }}
                            >
                              Target: {d.targetRange}
                            </small>
                          </div>
                          <p
                            style={{
                              fontSize: '0.8rem',
                              color: 'var(--text-secondary)',
                              margin: '0.25rem 0 0 0',
                            }}
                          >
                            {d.interpretation}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Actionable Prescriptions Scaled to Acreage */}
                  <div style={{ marginBottom: '1.5rem' }}>
                    <h3 style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>
                      2. Actionable Prescriptions (Scaled to Farm Acreage)
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {verifiedReport.prescriptions.map((p, idx) => (
                        <div
                          key={idx}
                          style={{
                            padding: '1rem',
                            borderRadius: '0.5rem',
                            backgroundColor: 'var(--surface-panel)',
                            border: '1px solid var(--border-color)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.4rem',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                            }}
                          >
                            <strong style={{ fontSize: '1rem', color: 'var(--primary-color)' }}>
                              {p.productType}
                            </strong>
                            <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#047857' }}>
                              {p.totalFarmPrescription}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            Application Rate: <strong>{p.ratePerAcre}</strong> ({p.ratePerHa})
                          </div>
                          <div style={{ fontSize: '0.85rem' }}>
                            <strong>Application Method &amp; Timing:</strong> {p.applicationTiming}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Commercial Agrodealer Formulation Matches */}
                  {verifiedReport.commercialInputs &&
                    verifiedReport.commercialInputs.length > 0 && (
                      <div style={{ marginBottom: '1.5rem' }}>
                        <h3 style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>
                          3. Commercial Fertilizer &amp; Amendment Formulations
                        </h3>
                        <div style={{ overflowX: 'auto' }}>
                          <table
                            style={{
                              width: '100%',
                              borderCollapse: 'collapse',
                              fontSize: '0.85rem',
                            }}
                          >
                            <thead>
                              <tr
                                style={{
                                  borderBottom: '2px solid var(--border-color)',
                                  textAlign: 'left',
                                }}
                              >
                                <th style={{ padding: '0.5rem' }}>Category</th>
                                <th style={{ padding: '0.5rem' }}>Commercial Input</th>
                                <th style={{ padding: '0.5rem' }}>Purpose</th>
                                <th style={{ padding: '0.5rem', textAlign: 'right' }}>
                                  Total Needed
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {verifiedReport.commercialInputs.map((c, idx) => (
                                <tr
                                  key={idx}
                                  style={{ borderBottom: '1px solid var(--border-color)' }}
                                >
                                  <td style={{ padding: '0.5rem', fontWeight: 600 }}>
                                    {c.category}
                                  </td>
                                  <td style={{ padding: '0.5rem' }}>{c.commercialFormulation}</td>
                                  <td style={{ padding: '0.5rem', color: 'var(--text-secondary)' }}>
                                    {c.purpose}
                                  </td>
                                  <td
                                    style={{
                                      padding: '0.5rem',
                                      textAlign: 'right',
                                      fontWeight: 700,
                                      color: '#047857',
                                    }}
                                  >
                                    {c.totalBagsNeeded} x {c.bagUnit}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                  {/* Split Application Timeline */}
                  {verifiedReport.splitSchedule && verifiedReport.splitSchedule.length > 0 && (
                    <div style={{ marginBottom: '1.5rem' }}>
                      <h3 style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>
                        4. Seasonal Split Application Timeline
                      </h3>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                          gap: '0.75rem',
                        }}
                      >
                        {verifiedReport.splitSchedule.map((s, idx) => (
                          <div
                            key={idx}
                            style={{
                              padding: '0.75rem',
                              borderRadius: '0.5rem',
                              backgroundColor: 'var(--surface-accent)',
                              border: '1px solid var(--border-color)',
                            }}
                          >
                            <div
                              style={{
                                fontWeight: 700,
                                fontSize: '0.85rem',
                                color: 'var(--primary-color)',
                                marginBottom: '0.25rem',
                              }}
                            >
                              {s.stage}
                            </div>
                            <div style={{ fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                              {s.action}
                            </div>
                            {s.notes && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                Note: {s.notes}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* AI Agronomic Advisory & Ecological Context */}
                  {verifiedReport.aiAdvisoryNotes && verifiedReport.aiAdvisoryNotes.length > 0 && (
                    <div>
                      <h3 style={{ fontSize: '1.05rem', marginBottom: '0.75rem' }}>
                        5. AI Agronomic Advisory &amp; Soil Rehabilitation
                      </h3>
                      <ul
                        style={{
                          paddingLeft: '1.25rem',
                          margin: 0,
                          fontSize: '0.85rem',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.35rem',
                        }}
                      >
                        {verifiedReport.aiAdvisoryNotes.map((note, idx) => (
                          <li key={idx} style={{ color: 'var(--text-primary)' }}>
                            {note}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              )}

              <section
                className="account-section"
                id="guidance"
                aria-labelledby="account-recommendations-title"
              >
                <div className="section-heading">
                  <div>
                    <div className="eyebrow">REVIEW STATUS INCLUDED</div>
                    <h2 id="account-recommendations-title">Recommendations</h2>
                  </div>
                </div>
                {recommendations.length === 0 ? (
                  <p className="account-empty">No recommendations are linked to this farm.</p>
                ) : (
                  recommendations.map((recommendation) => (
                    <article
                      className="account-recommendation"
                      key={recommendation.recommendationId}
                    >
                      <div className="account-recommendation-heading">
                        <div>
                          <h3>{recommendation.title}</h3>
                          <p>
                            <span>
                              {recommendation.crop
                                ? `Crop: ${recommendation.crop}`
                                : 'Crop not specified'}
                            </span>
                            <span> · </span>
                            <span
                              className={`review-status-badge status-${recommendation.reviewStatus}`}
                            >
                              {recommendation.reviewStatus.replace(/_/g, ' ')}
                            </span>
                          </p>
                        </div>
                        <span className="rule-version-badge">
                          {recommendation.ruleVersion
                            ? recommendation.ruleVersion.startsWith('v') ||
                              recommendation.ruleVersion.startsWith('V')
                              ? recommendation.ruleVersion
                              : `v${recommendation.ruleVersion}`
                            : 'Version unavailable'}
                        </span>
                      </div>
                      <p>{recommendation.rationale}</p>
                      <small>
                        {recommendation.applicationRate !== null && recommendation.applicationUnit
                          ? `${recommendation.applicationRate} ${recommendation.applicationUnit}`
                          : 'Application rate not set'}{' '}
                        · Guidance remains non-actionable pending agronomic approval.
                      </small>
                      <div
                        className="account-feedback"
                        aria-label={`Feedback for ${recommendation.title}`}
                      >
                        <span>
                          {feedbackByRecommendation[recommendation.recommendationId]
                            ? `Saved: ${feedbackByRecommendation[recommendation.recommendationId]!.replace('-', ' ')}`
                            : 'Record your response'}
                        </span>
                        <div className="feedback-options">
                          {feedbackOptions.map((option) => (
                            <button
                              key={option.response}
                              className={`feedback-button ${feedbackByRecommendation[recommendation.recommendationId] === option.response ? 'is-selected' : ''}`}
                              type="button"
                              aria-pressed={
                                feedbackByRecommendation[recommendation.recommendationId] ===
                                option.response
                              }
                              onClick={() =>
                                void recordFeedback(
                                  recommendation.recommendationId,
                                  option.response,
                                )
                              }
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </section>
            </>
          )}
        </>
      )}
    </section>
  )
}
