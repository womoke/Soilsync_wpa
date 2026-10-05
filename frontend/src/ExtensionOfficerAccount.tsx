import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Activity,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Download,
  Clock,
  FileCheck,
  FileText,
  LogOut,
  Mail,
  MapPin,
  Plus,
  RefreshCw,
  Send,
  Shield,
  ShieldCheck,
  Sparkles,
  Undo2,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react'
import { linkAuthenticatedAccount } from './api/auth'
import { KENYA_COUNTIES } from './data/kenyaLocations'
import { getSupabaseClient } from './lib/supabase'
import {
  claimAssessment,
  claimOfficerVisit,
  createOfficerAlert,
  editAssessment,
  exportOfficerReport,
  fetchUnclaimedFarmers,
  getOfficerAlerts,
  getOfficerFarmerRoster,
  getOfficerJurisdictions,
  getOfficerVisitPool,
  getOfficerVisits,
  getOfficerWardSummaries,
  getUnverifiedAssessments,
  publishAssessment,
  recordOfficerFieldCollection,
  registerUnclaimedFarmer,
  releaseAssessment,
  releaseOfficerVisit,
  scheduleOfficerVisit,
  triageOfficerAlert,
  updateOfficerVisit,
  type OfficerAlertItem,
  type OfficerExportResponse,
  type OfficerFarmerRosterItem,
  type OfficerJurisdiction,
  type OfficerVisitItem,
  type OfficerWardSummaryItem,
  type UnclaimedFarmerItem,
  type UnverifiedAssessmentItem,
} from './api/officer'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.'
}

export default function ExtensionOfficerAccount({ onBackToDemo }: { onBackToDemo: () => void }) {
  const supabase = getSupabaseClient()
  const [session, setSession] = useState<Session | null>(null)
  const [sessionRoleVerified, setSessionRoleVerified] = useState(false)
  const [manualToken, setManualToken] = useState('')
  const [activeToken, setActiveToken] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isWorking, setIsWorking] = useState(false)
  const [isLoadingData, setIsLoadingData] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  // Officer operational data
  const [jurisdictions, setJurisdictions] = useState<OfficerJurisdiction[]>([])
  const [roster, setRoster] = useState<OfficerFarmerRosterItem[]>([])
  const [visits, setVisits] = useState<OfficerVisitItem[]>([])
  const [visitPool, setVisitPool] = useState<OfficerVisitItem[]>([])
  const [alerts, setAlerts] = useState<OfficerAlertItem[]>([])
  const [wardSummaries, setWardSummaries] = useState<OfficerWardSummaryItem[]>([])
  const [assessments, setAssessments] = useState<UnverifiedAssessmentItem[]>([])

  // Unclaimed Farmers / On-Site Registration state
  const [unclaimedRoster, setUnclaimedRoster] = useState<UnclaimedFarmerItem[]>([])
  const [rosterTab, setRosterTab] = useState<'active' | 'unclaimed'>('active')
  const [showRegisterFarmerModal, setShowRegisterFarmerModal] = useState(false)
  const [registerFarmerEmail, setRegisterFarmerEmail] = useState('')
  const [registerFarmerName, setRegisterFarmerName] = useState('')
  const [registerFarmerPhone, setRegisterFarmerPhone] = useState('')
  const [registerFarmerFarmName, setRegisterFarmerFarmName] = useState('')
  const [registerFarmerCounty, setRegisterFarmerCounty] = useState('')
  const [registerFarmerSubCounty, setRegisterFarmerSubCounty] = useState('')
  const [registerFarmerWard, setRegisterFarmerWard] = useState('')
  const [registerFarmerAcres, setRegisterFarmerAcres] = useState('')
  const [registerFarmerCrops, setRegisterFarmerCrops] = useState('')
  const [isRegisteringFarmer, setIsRegisteringFarmer] = useState(false)

  // Modal / Form states
  const [isScheduleOpen, setIsScheduleOpen] = useState(false)
  const [scheduleFarmerId, setScheduleFarmerId] = useState('')
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleNotes, setScheduleNotes] = useState('')

  const [isAlertOpen, setIsAlertOpen] = useState(false)
  const [alertFarmerId, setAlertFarmerId] = useState('')
  const [alertTitle, setAlertTitle] = useState('')
  const [alertSummary, setAlertSummary] = useState('')
  const [alertSeverity, setAlertSeverity] = useState<'info' | 'warning' | 'critical'>('warning')
  const [alertNotes, setAlertNotes] = useState('')

  const [triageAlertId, setTriageAlertId] = useState<string | null>(null)
  const [resolutionNotes, setResolutionNotes] = useState('')

  // Field Data Collection modal states
  const [collectionVisit, setCollectionVisit] = useState<OfficerVisitItem | null>(null)
  const [collectionLat, setCollectionLat] = useState('-0.4215')
  const [collectionLng, setCollectionLng] = useState('36.9512')
  const [collectionUncertainty, setCollectionUncertainty] = useState('5.0')
  const [collectionPh, setCollectionPh] = useState('6.2')
  const [collectionOrganicCarbon, setCollectionOrganicCarbon] = useState('1.8')
  const [collectionNitrogen, setCollectionNitrogen] = useState('0.18')
  const [collectionPhosphorus, setCollectionPhosphorus] = useState('14.5')
  const [collectionPotassium, setCollectionPotassium] = useState('0.42')
  const [collectionTopCm, setCollectionTopCm] = useState('0')
  const [collectionBottomCm, setCollectionBottomCm] = useState('20')
  const [collectionNotes, setCollectionNotes] = useState('')

  const [exportResult, setExportResult] = useState<OfficerExportResponse | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  // Agronomic Assessment modal & review states
  const [selectedAssessment, setSelectedAssessment] = useState<UnverifiedAssessmentItem | null>(null)
  const [assessmentNotes, setAssessmentNotes] = useState('')
  const [agronomistLicense, setAgronomistLicense] = useState('')
  const [isAssessmentActionWorking, setIsAssessmentActionWorking] = useState(false)

  const token = (sessionRoleVerified ? session?.access_token : null) || activeToken

  useEffect(() => {
    if (!supabase) return
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setSessionRoleVerified(false)
    })
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessionRoleVerified(false)
    })
    return () => {
      subscription.unsubscribe()
    }
  }, [supabase])

  useEffect(() => {
    if (!supabase || !session) return
    let active = true

    void linkAuthenticatedAccount(session.access_token)
      .then((profile) => {
        if (profile.role !== 'extension_officer') {
          throw new Error(
            `This account has the ${profile.role.replaceAll('_', ' ')} role, not the extension officer role.`,
          )
        }
        if (active) setSessionRoleVerified(true)
      })
      .catch((verificationError: unknown) => {
        if (!active) return
        setSession(null)
        setSessionRoleVerified(false)
        setError(getErrorMessage(verificationError))
        void supabase.auth
          .signOut()
          .then(({ error: signOutError }) => {
            if (signOutError) {
              setError(
                `${getErrorMessage(verificationError)} Sign-out failed: ${getErrorMessage(signOutError)}`,
              )
            }
          })
          .catch((signOutError: unknown) => {
            setError(
              `${getErrorMessage(verificationError)} Sign-out failed: ${getErrorMessage(signOutError)}`,
            )
          })
      })

    return () => {
      active = false
    }
  }, [session, supabase])

  const loadData = useCallback(async (accessToken: string) => {
    setIsLoadingData(true)
    setError('')
    try {
      const [jList, rList, vList, pList, aList, wList, assList, uList] = await Promise.all([
        getOfficerJurisdictions(accessToken),
        getOfficerFarmerRoster(accessToken),
        getOfficerVisits(accessToken),
        getOfficerVisitPool(accessToken),
        getOfficerAlerts(accessToken),
        getOfficerWardSummaries(accessToken),
        getUnverifiedAssessments(accessToken).catch(() => []),
        fetchUnclaimedFarmers(accessToken).catch(() => []),
      ])
      setJurisdictions(Array.isArray(jList) ? jList : [])
      setRoster(Array.isArray(rList) ? rList : [])
      setVisits(Array.isArray(vList) ? vList : [])
      setVisitPool(Array.isArray(pList) ? pList : [])
      setAlerts(Array.isArray(aList) ? aList : [])
      setWardSummaries(Array.isArray(wList) ? wList : [])
      setAssessments(Array.isArray(assList) ? assList : [])
      setUnclaimedRoster(Array.isArray(uList) ? uList : [])
      if (rList.length > 0) {
        setScheduleFarmerId((currentFarmerId) => currentFarmerId || rList[0].farmerId)
      }
      if (rList.length > 0) {
        setAlertFarmerId((currentFarmerId) => currentFarmerId || rList[0].farmerId)
      }
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsLoadingData(false)
    }
  }, [])

  useEffect(() => {
    if (!token) return
    void Promise.resolve().then(() => loadData(token))
  }, [loadData, token])

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) {
      setError(
        'Supabase Auth is not configured. Contact your administrator to enable account access.',
      )
      return
    }
    setIsWorking(true)
    setError('')
    setMessage('')
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (signInError) throw signInError
      setSession(data.session)
      setMessage('Signed in successfully as Extension Officer.')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  const handleManualTokenSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!manualToken.trim()) return
    setActiveToken(manualToken.trim())
  }

  const handleRegisterFarmerOnSite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return
    setIsRegisteringFarmer(true)
    setError('')
    setMessage('')
    try {
      await registerUnclaimedFarmer(token, {
        email: registerFarmerEmail.trim(),
        fullName: registerFarmerName.trim(),
        farmName: registerFarmerFarmName.trim(),
        county: registerFarmerCounty.trim(),
        subCounty: registerFarmerSubCounty.trim(),
        ward: registerFarmerWard.trim(),
        sizeAcres: registerFarmerAcres ? parseFloat(registerFarmerAcres) : undefined,
        crops: registerFarmerCrops.trim() || undefined,
      })
      setMessage(
        `On-site registration complete for ${registerFarmerName}. Claim link sent; 6 daily reminders scheduled before Day 7 cascade cleanup.`,
      )
      setShowRegisterFarmerModal(false)
      setRegisterFarmerEmail('')
      setRegisterFarmerName('')
      setRegisterFarmerPhone('')
      setRegisterFarmerFarmName('')
      setRegisterFarmerCounty('')
      setRegisterFarmerSubCounty('')
      setRegisterFarmerWard('')
      setRegisterFarmerAcres('')
      setRegisterFarmerCrops('')
      await loadData(token)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsRegisteringFarmer(false)
    }
  }

  const handleScheduleVisit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !scheduleFarmerId || !scheduleDate) return
    setIsWorking(true)
    setError('')
    setMessage('')
    try {
      const selectedFarmer = roster.find((f) => f.farmerId === scheduleFarmerId)
      const newVisit = await scheduleOfficerVisit(token, {
        farmerId: scheduleFarmerId,
        farmId: selectedFarmer?.farmId,
        plannedDate: new Date(scheduleDate).toISOString(),
        status: 'scheduled',
        notes: scheduleNotes || null,
      })
      setVisits((prev) => [newVisit, ...prev])
      setIsScheduleOpen(false)
      setScheduleNotes('')
      setMessage(`Visit scheduled for ${selectedFarmer?.name ?? 'farmer'}.`)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  const handleUpdateVisitStatus = async (
    visitId: string,
    status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled',
  ) => {
    if (!token) return
    setIsWorking(true)
    try {
      const updated = await updateOfficerVisit(token, visitId, { status })
      setVisits((prev) => prev.map((v) => (v.visitId === visitId ? updated : v)))
      setMessage(`Visit updated to ${status}.`)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  const handleClaimVisit = async (visitId: string) => {
    if (!token) return
    setIsWorking(true)
    setError('')
    setMessage('')
    try {
      const claimed = await claimOfficerVisit(token, visitId)
      setVisitPool((prev) => prev.filter((p) => p.visitId !== visitId))
      setVisits((prev) => [claimed, ...prev.filter((v) => v.visitId !== visitId)])
      setMessage('Visit request claimed successfully! Added to your field calendar.')
    } catch (err) {
      setError(getErrorMessage(err))
      if (token) {
        void getOfficerVisitPool(token).then(setVisitPool).catch(() => {})
      }
    } finally {
      setIsWorking(false)
    }
  }

  const handleReleaseVisit = async (visitId: string) => {
    if (!token) return
    setIsWorking(true)
    setError('')
    setMessage('')
    try {
      const released = await releaseOfficerVisit(token, visitId)
      setVisits((prev) => prev.filter((v) => v.visitId !== visitId))
      setVisitPool((prev) => [released, ...prev.filter((p) => p.visitId !== visitId)])
      setMessage('Visit released back to the unassigned county pool.')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  const handleRecordCollection = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !collectionVisit) return
    const lat = parseFloat(collectionLat)
    const lng = parseFloat(collectionLng)
    if (isNaN(lat) || isNaN(lng)) {
      setError('Please provide valid GPS coordinates.')
      return
    }

    setIsWorking(true)
    setError('')
    setMessage('')
    try {
      const measurements = [
        { analyte: 'soil_ph', value: parseFloat(collectionPh), sourceUnit: 'pH', qualityStatus: 'valid' },
        { analyte: 'organic_carbon', value: parseFloat(collectionOrganicCarbon), sourceUnit: '%', qualityStatus: 'valid' },
        { analyte: 'total_nitrogen', value: parseFloat(collectionNitrogen), sourceUnit: '%', qualityStatus: 'valid' },
        { analyte: 'olsen_phosphorus', value: parseFloat(collectionPhosphorus), sourceUnit: 'mg/kg', qualityStatus: 'valid' },
        { analyte: 'exchangeable_potassium', value: parseFloat(collectionPotassium), sourceUnit: 'cmol/kg', qualityStatus: 'valid' },
      ].filter((m) => !isNaN(m.value))

      const res = await recordOfficerFieldCollection(token, collectionVisit.visitId, {
        latitude: lat,
        longitude: lng,
        locationUncertaintyM: parseFloat(collectionUncertainty) || 5.0,
        topCm: parseFloat(collectionTopCm) || 0,
        bottomCm: parseFloat(collectionBottomCm) || 20,
        measurements,
        notes: collectionNotes || null,
        markCompleted: true,
      })

      setVisits((prev) =>
        prev.map((v) =>
          v.visitId === collectionVisit.visitId ? { ...v, status: 'completed' as const } : v,
        ),
      )
      setCollectionVisit(null)
      if (token) {
        void getUnverifiedAssessments(token).then(setAssessments).catch(() => {})
      }
      setMessage(res.message || 'Field data and GPS coordinates recorded successfully.')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  const handleCreateAlert = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !alertFarmerId || !alertTitle) return
    setIsWorking(true)
    setError('')
    setMessage('')
    try {
      const selectedFarmer = roster.find((f) => f.farmerId === alertFarmerId)
      const newAlert = await createOfficerAlert(token, {
        farmerId: alertFarmerId,
        farmId: selectedFarmer?.farmId,
        title: alertTitle,
        summary: alertSummary || null,
        source: 'Officer Field Inspection',
        severity: alertSeverity,
        notes: alertNotes || null,
      })
      setAlerts((prev) => [newAlert, ...prev])
      setIsAlertOpen(false)
      setAlertTitle('')
      setAlertSummary('')
      setAlertNotes('')
      setMessage('Agronomic alert registered for farmer in jurisdiction.')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  const handleTriageSubmit = async (alertId: string, status: 'acknowledged' | 'resolved') => {
    if (!token) return
    setIsWorking(true)
    setError('')
    try {
      const updated = await triageOfficerAlert(token, alertId, {
        status,
        resolutionNotes: status === 'resolved' ? resolutionNotes : undefined,
      })
      setAlerts((prev) => prev.map((a) => (a.alertId === alertId ? updated : a)))
      setTriageAlertId(null)
      setResolutionNotes('')
      setMessage(`Alert marked as ${status}.`)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  const handleOpenAssessment = (item: UnverifiedAssessmentItem) => {
    setSelectedAssessment(item)
    setAssessmentNotes('')
    setAgronomistLicense('')
  }

  const handleClaimAssessment = async (assessmentId: string) => {
    if (!token) return
    setIsAssessmentActionWorking(true)
    setError('')
    setMessage('')
    try {
      const res = await claimAssessment(token, assessmentId)
      setAssessments((prev) =>
        prev.map((a) =>
          a.assessmentId === assessmentId
            ? { ...a, reviewStage: 'claimed' as const, claimingAgronomistId: res.claimingAgronomistId }
            : a,
        ),
      )
      if (selectedAssessment?.assessmentId === assessmentId) {
        setSelectedAssessment((prev) =>
          prev
            ? {
                ...prev,
                reviewStage: 'claimed' as const,
                claimingAgronomistId: res.claimingAgronomistId,
              }
            : null,
        )
      }
      setMessage(res.message || 'Assessment claimed for agronomist review.')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsAssessmentActionWorking(false)
    }
  }

  const handleReleaseAssessment = async (assessmentId: string) => {
    if (!token) return
    setIsAssessmentActionWorking(true)
    setError('')
    setMessage('')
    try {
      const res = await releaseAssessment(token, assessmentId)
      setAssessments((prev) =>
        prev.map((a) =>
          a.assessmentId === assessmentId
            ? { ...a, reviewStage: 'review_requested' as const, claimingAgronomistId: null }
            : a,
        ),
      )
      if (selectedAssessment?.assessmentId === assessmentId) {
        setSelectedAssessment((prev) =>
          prev
            ? { ...prev, reviewStage: 'review_requested' as const, claimingAgronomistId: null }
            : null,
        )
      }
      setMessage(res.message || 'Assessment released back to review pool.')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsAssessmentActionWorking(false)
    }
  }

  const handleSaveAssessmentNotes = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !selectedAssessment || !assessmentNotes.trim()) return
    setIsAssessmentActionWorking(true)
    setError('')
    setMessage('')
    try {
      const res = await editAssessment(token, selectedAssessment.assessmentId, assessmentNotes.trim())
      setAssessments((prev) =>
        prev.map((a) =>
          a.assessmentId === selectedAssessment.assessmentId
            ? {
                ...a,
                officerEdits: res.officerEdits as typeof a.officerEdits,
                agronomistEdits: res.agronomistEdits as typeof a.agronomistEdits,
              }
            : a,
        ),
      )
      setSelectedAssessment((prev) =>
        prev
          ? {
              ...prev,
              officerEdits: res.officerEdits as typeof prev.officerEdits,
              agronomistEdits: res.agronomistEdits as typeof prev.agronomistEdits,
            }
          : null,
      )
      setAssessmentNotes('')
      setMessage(res.message || 'Collaborative feedback appended to assessment.')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsAssessmentActionWorking(false)
    }
  }

  const handlePublishAssessment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !selectedAssessment) return
    setIsAssessmentActionWorking(true)
    setError('')
    setMessage('')
    try {
      const res = await publishAssessment(token, selectedAssessment.assessmentId, {
        licenseNumber: agronomistLicense.trim() || undefined,
        finalNotes: assessmentNotes.trim() || undefined,
      })
      setAssessments((prev) => prev.filter((a) => a.assessmentId !== selectedAssessment.assessmentId))
      setSelectedAssessment(null)
      setMessage(
        res.message ||
          'Assessment verified and published! The official report is now available to the farmer.',
      )
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsAssessmentActionWorking(false)
    }
  }

  const handleExport = async () => {
    if (!token) return
    setIsExporting(true)
    setError('')
    try {
      const primaryJurisdiction = jurisdictions[0]
      const result = await exportOfficerReport(token, {
        county: primaryJurisdiction?.county,
        subCounty: primaryJurisdiction?.subCounty,
        ward: primaryJurisdiction?.ward,
        format: 'json',
      })
      setExportResult(result)
      setMessage(`Report generated successfully (${result.recordCount} records).`)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsExporting(false)
    }
  }

  const handleLogout = async () => {
    try {
      if (supabase) {
        const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
        if (signOutError) throw signOutError
      }
    } catch (signOutError) {
      setError(getErrorMessage(signOutError))
      return
    }
    setSession(null)
    setManualToken('')
    setActiveToken('')
    setJurisdictions([])
    setRoster([])
    setVisits([])
    setVisitPool([])
    setAlerts([])
    setWardSummaries([])
    onBackToDemo()
  }

  // If not authenticated, render sign-in / token form
  if (!token) {
    return (
      <div className="farmer-account-shell">
        <div className="page-heading">
          <div>
            <div className="eyebrow">FIELD TEAM AUTHENTICATION</div>
            <h1>Extension Officer Workspace</h1>
            <p className="page-subtitle">
              Sign in with your verified extension officer credentials to access jurisdiction
              records.
            </p>
          </div>
          <button className="secondary-button" type="button" onClick={onBackToDemo}>
            Back to sign in
          </button>
        </div>

        {error && (
          <div className="auth-alert is-error" role="alert">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        )}

        <div className="auth-grid">
          <section className="farm-panel auth-card">
            <div className="panel-kicker">
              <ShieldCheck size={16} /> Staff Sign-In (Email & Password)
            </div>
            <form onSubmit={handleSignIn} className="auth-form">
              <label className="auth-field">
                <span>Staff email</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="officer@kilimo.go.ke"
                  required
                />
              </label>
              <label className="auth-field">
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
              </label>
              <button className="primary-button" type="submit" disabled={isWorking}>
                {isWorking ? 'Signing in…' : 'Sign in as Officer'}
              </button>
            </form>
          </section>

          {import.meta.env.MODE === 'test' && (
            <section className="farm-panel auth-card">
              <div className="panel-kicker">
                <Shield size={16} /> Development / Testing Bearer Token
              </div>
              <p className="auth-copy">
                For local testing and verification without an SMS/email gateway, enter an authorized
                extension officer bearer token.
              </p>
              <form onSubmit={handleManualTokenSubmit} className="auth-form">
                <label className="auth-field">
                  <span>Bearer Token</span>
                  <input
                    type="text"
                    value={manualToken}
                    onChange={(e) => setManualToken(e.target.value)}
                    placeholder="valid-officer-token"
                  />
                </label>
                <button className="primary-button" type="submit">
                  Use Officer Token
                </button>
              </form>
            </section>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="farmer-account-shell">
      <div className="page-heading">
        <div>
          <div className="eyebrow">AUTHENTICATED OFFICER WORKSPACE</div>
          <h1>Extension Officer Portal</h1>
          <p className="page-subtitle">
            Jurisdiction-scoped field management, farmer support, visit schedules, and agronomic
            alert triage.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            className="secondary-button"
            type="button"
            onClick={() => loadData(token)}
            disabled={isLoadingData}
          >
            <RefreshCw size={16} /> Refresh
          </button>
          <button className="secondary-button" type="button" onClick={handleLogout}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </div>

      {/* Privacy Minimization Banner */}
      <div
        className="privacy-minimization-banner"
        role="note"
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.85rem',
          padding: '1rem 1.25rem',
          backgroundColor: 'rgba(59, 130, 246, 0.08)',
          border: '1px solid rgba(59, 130, 246, 0.25)',
          borderRadius: '0.5rem',
          marginBottom: '1.5rem',
        }}
      >
        <ShieldCheck size={20} style={{ color: '#2563eb', flexShrink: 0, marginTop: '2px' }} />
        <div>
          <strong style={{ display: 'block', color: '#1e40af', marginBottom: '0.2rem' }}>
            Officer Data Minimization Policy Enforced
          </strong>
          <span style={{ fontSize: '0.875rem', color: '#1e3a8a', lineHeight: 1.5 }}>
            Access is strictly scoped to your active administrative jurisdictions. In accordance
            with Kenya Data Protection laws and project privacy safeguards, farmer phone numbers,
            national IDs, and exact GPS coordinates are excluded from this portal. Only operational
            and agronomic indicators needed for field extension are displayed.
          </span>
        </div>
      </div>

      {message && (
        <div className="auth-alert is-success" role="status">
          <CheckCircle2 size={18} />
          <span>{message}</span>
        </div>
      )}

      {error && (
        <div className="auth-alert is-error" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Jurisdiction Header Pills */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          alignItems: 'center',
          marginBottom: '1.5rem',
        }}
      >
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
          Assigned Jurisdictions:
        </span>
        {jurisdictions.map((j) => (
          <span
            key={j.assignmentId}
            className="jurisdiction-pill"
            data-testid="officer-jurisdiction-badge"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              padding: '0.35rem 0.75rem',
              borderRadius: '9999px',
              backgroundColor: 'var(--surface-accent)',
              border: '1px solid var(--border-color)',
              fontSize: '0.85rem',
              fontWeight: 500,
            }}
          >
            <MapPin size={13} />
            {j.designation ? (
              <span
                style={{
                  fontSize: '0.75rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  fontWeight: 700,
                  opacity: 0.8,
                  marginRight: '0.2rem',
                }}
              >
                [{j.designation}]
              </span>
            ) : null}
            {j.county ? `${j.county} County` : 'All Counties'}
            {j.subCounty ? ` • ${j.subCounty}` : ''}
            {j.ward ? ` • ${j.ward} Ward` : ''}
          </span>
        ))}
      </div>

      {/* Overview Metrics Cards */}
      <section
        className="overview-grid"
        aria-label="Jurisdiction summaries"
        style={{ marginBottom: '1.5rem' }}
      >
        <article className="farm-panel role-panel">
          <div className="panel-kicker">
            <Users size={16} /> Assigned Farmers
          </div>
          <div className="score-placeholder role-score">{roster.length}</div>
          <p className="role-card-note">In active assigned jurisdictions</p>
        </article>
        <article className="farm-panel role-panel">
          <div className="panel-kicker">
            <Calendar size={16} /> Planned Visits
          </div>
          <div className="score-placeholder role-score">
            {visits.filter((v) => v.status === 'scheduled').length}
          </div>
          <p className="role-card-note">{visits.length} total visits recorded</p>
        </article>
        <article className="farm-panel role-panel">
          <div className="panel-kicker">
            <AlertTriangle size={16} /> Active Alerts
          </div>
          <div className="score-placeholder role-score">
            {alerts.filter((a) => a.status !== 'resolved').length}
          </div>
          <p className="role-card-note">
            {alerts.filter((a) => a.severity === 'critical').length} critical severity
          </p>
        </article>
        <article className="farm-panel role-panel">
          <div className="panel-kicker">
            <Activity size={16} /> Ward Summaries
          </div>
          <div className="score-placeholder role-score">{wardSummaries.length}</div>
          <p className="role-card-note">Aggregated ward cohorts</p>
        </article>
        <article className="farm-panel role-panel">
          <div className="panel-kicker">
            <Sparkles size={16} /> Agronomic Pipeline
          </div>
          <div className="score-placeholder role-score">{assessments.length}</div>
          <p className="role-card-note">KALRO assessments awaiting verification</p>
        </article>
      </section>

      {/* Ward Aggregation Summaries */}
      {wardSummaries.length > 0 && (
        <article className="history-panel role-panel-block" style={{ marginBottom: '1.5rem' }}>
          <div className="section-heading">
            <div>
              <div className="eyebrow">AGGREGATE DATA</div>
              <h2>Ward Summaries & Aggregation Limits</h2>
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '1rem',
              marginTop: '0.75rem',
            }}
          >
            {wardSummaries.map((w) => (
              <div
                key={`${w.county}-${w.ward}`}
                style={{
                  padding: '1rem',
                  borderRadius: '0.5rem',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--surface-panel)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '0.5rem',
                  }}
                >
                  <strong style={{ fontSize: '1rem' }}>{w.ward} Ward</strong>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {w.county}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: '0.875rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                    marginBottom: '0.75rem',
                  }}
                >
                  <span>
                    Farmers: <strong>{w.farmerCount}</strong> • Farms:{' '}
                    <strong>{w.farmCount}</strong>
                  </span>
                  <span>
                    Readings: <strong>{w.readingCount}</strong> • Samples:{' '}
                    <strong>{w.sampleCount}</strong>
                  </span>
                </div>
                <div
                  style={{
                    fontSize: '0.75rem',
                    padding: '0.35rem 0.5rem',
                    borderRadius: '0.25rem',
                    backgroundColor: 'rgba(0,0,0,0.03)',
                    borderLeft: '3px solid #f59e0b',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {w.aggregationLimits}
                </div>
              </div>
            ))}
          </div>
        </article>
      )}

      {/* Farmer Roster Table */}
      <article className="history-panel role-panel-block" style={{ marginBottom: '1.5rem' }}>
        <div
          className="section-heading"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}
        >
          <div>
            <div className="eyebrow">JURISDICTION ROSTER</div>
            <h2>Assigned & Assisted Farmers</h2>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setShowRegisterFarmerModal(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
            >
              <UserPlus size={16} /> Register Farmer On-Site
            </button>
            <button className="primary-button" type="button" onClick={() => setIsScheduleOpen(true)}>
              <Plus size={16} /> Schedule Visit
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
          <button
            type="button"
            className={`tab-btn ${rosterTab === 'active' ? 'active' : ''}`}
            style={{
              background: rosterTab === 'active' ? 'var(--primary, #2d6a4f)' : 'transparent',
              color: rosterTab === 'active' ? '#fff' : 'inherit',
              border: 'none',
              borderRadius: '4px',
              padding: '0.35rem 0.75rem',
              fontSize: '0.85rem',
              cursor: 'pointer',
              fontWeight: 600,
            }}
            onClick={() => setRosterTab('active')}
          >
            Active Assigned Farmers ({roster.length})
          </button>
          <button
            type="button"
            className={`tab-btn ${rosterTab === 'unclaimed' ? 'active' : ''}`}
            style={{
              background: rosterTab === 'unclaimed' ? 'var(--primary, #2d6a4f)' : 'transparent',
              color: rosterTab === 'unclaimed' ? '#fff' : 'inherit',
              border: 'none',
              borderRadius: '4px',
              padding: '0.35rem 0.75rem',
              fontSize: '0.85rem',
              cursor: 'pointer',
              fontWeight: 600,
            }}
            onClick={() => setRosterTab('unclaimed')}
          >
            Unclaimed On-Site Registrations ({unclaimedRoster.length})
          </button>
        </div>

        {rosterTab === 'active' ? (
          roster.length === 0 ? (
            <p className="history-empty" style={{ marginTop: '1rem' }}>No farmers found in your assigned jurisdictions.</p>
          ) : (
            <div className="roster-list" style={{ marginTop: '1rem' }}>
              {roster.map((farmer) => (
                <div
                  key={farmer.farmerId}
                  className="roster-item"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.85rem 1rem',
                    borderBottom: '1px solid var(--border-color)',
                  }}
                >
                  <div>
                    <strong style={{ fontSize: '1rem', display: 'block' }}>{farmer.name}</strong>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      Farm: {farmer.farmName ?? 'Unnamed'} • {farmer.ward ?? 'Unknown Ward'},{' '}
                      {farmer.county ?? ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span className="draft-status-pill" style={{ fontSize: '0.8rem' }}>
                      {farmer.readingCount} readings
                    </span>
                    <button
                      className="secondary-button"
                      type="button"
                      style={{ fontSize: '0.8rem', padding: '0.25rem 0.65rem' }}
                      onClick={() => {
                        setScheduleFarmerId(farmer.farmerId)
                        setIsScheduleOpen(true)
                      }}
                    >
                      Schedule visit
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      style={{ fontSize: '0.8rem', padding: '0.25rem 0.65rem' }}
                      onClick={() => {
                        setAlertFarmerId(farmer.farmerId)
                        setIsAlertOpen(true)
                      }}
                    >
                      Log alert
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          unclaimedRoster.length === 0 ? (
            <p className="history-empty" style={{ marginTop: '1rem' }}>
              No on-site registered farmers pending account claims.
            </p>
          ) : (
            <div className="roster-list" style={{ marginTop: '1rem' }}>
              {unclaimedRoster.map((item) => {
                const daysRemaining = item.daysUntilExpiration ?? 7
                return (
                  <div
                    key={item.authUserId}
                    className="roster-item"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.85rem 1rem',
                      borderBottom: '1px solid var(--border-color)',
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: '1rem', display: 'block' }}>
                        {item.fullName || 'Unnamed Farmer'}
                      </strong>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {item.email}
                      </span>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                        Farm: <strong>{item.initialFarmName || 'Unnamed Farm'}</strong> • {item.county || 'Unassigned'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                      <span
                        className="draft-status-pill"
                        style={{
                          fontSize: '0.78rem',
                          backgroundColor: '#e0f2fe',
                          color: '#0369a1',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                        }}
                        title="Daily in-app & email reminders on Days 1-6"
                      >
                        <Mail size={12} /> {item.reminderCount} / 6 Reminders
                      </span>
                      <span
                        className="draft-status-pill"
                        style={{
                          fontSize: '0.78rem',
                          backgroundColor: daysRemaining <= 2 ? '#fee2e2' : '#fef3c7',
                          color: daysRemaining <= 2 ? '#b91c1c' : '#b45309',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                        }}
                        title="Automated cascade deletion of account and farm occurs on Day 7 if unclaimed"
                      >
                        <Clock size={12} /> Day 7 Deletion: {daysRemaining}d left
                      </span>
                      <span
                        className="draft-status-pill"
                        style={{
                          fontSize: '0.78rem',
                          backgroundColor: item.status === 'active' ? '#dcfce7' : '#f3f4f6',
                          color: item.status === 'active' ? '#15803d' : '#4b5563',
                          fontWeight: 600,
                        }}
                      >
                        {item.status === 'active' ? 'Claimed & Active' : 'Unclaimed'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}
      </article>

      {/* County Visit Pool (Unassigned Requests) Section */}
      <article className="history-panel role-panel-block" style={{ marginBottom: '1.5rem' }}>
        <div
          className="section-heading"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <div>
            <div className="eyebrow">COUNTY VISIT POOL</div>
            <h2>Unassigned Visit Requests ({visitPool.length})</h2>
          </div>
          <button
            className="secondary-button"
            type="button"
            style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
            onClick={() => {
              if (token) {
                setIsWorking(true)
                getOfficerVisitPool(token)
                  .then(setVisitPool)
                  .catch((err) => setError(getErrorMessage(err)))
                  .finally(() => setIsWorking(false))
              }
            }}
          >
            <RefreshCw size={14} /> Refresh Pool
          </button>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.25rem 0 1rem 0' }}>
          Open visit requests submitted by farmers within your assigned county/sub-county/ward. Claim a request to take ownership and schedule on-site soil sampling.
        </p>
        {visitPool.length === 0 ? (
          <p className="history-empty">
            No unassigned visit requests currently available in your jurisdiction pool.
          </p>
        ) : (
          <div
            className="visit-pool-list"
            style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
          >
            {visitPool.map((req) => (
              <div
                key={req.visitId}
                style={{
                  padding: '1rem',
                  borderRadius: '0.5rem',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--surface-panel)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      marginBottom: '0.25rem',
                    }}
                  >
                    <strong>{req.farmerName ?? 'Farmer'}</strong>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      ({req.farmName ?? 'Farm'})
                    </span>
                    <span
                      className="sync-status-indicator is-draft"
                      style={{ fontSize: '0.75rem', backgroundColor: '#fff3e0', color: '#b26a00' }}
                    >
                      Unassigned Pool
                    </span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    <span>
                      {[req.ward, req.subCounty, req.county].filter(Boolean).join(', ') || 'Jurisdiction Match'}
                    </span>
                    {req.farmerPhone && (
                      <span style={{ marginLeft: '0.5rem' }}>• Tel: {req.farmerPhone}</span>
                    )}
                    <span style={{ marginLeft: '0.5rem' }}>
                      • Requested: {new Date(req.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  {req.notes && (
                    <p
                      style={{
                        fontSize: '0.85rem',
                        margin: '0.4rem 0 0 0',
                        color: 'var(--text-primary)',
                      }}
                    >
                      Farmer notes: {req.notes}
                    </p>
                  )}
                </div>
                <div>
                  <button
                    className="primary-button"
                    type="button"
                    style={{ fontSize: '0.85rem', padding: '0.4rem 0.85rem' }}
                    onClick={() => handleClaimVisit(req.visitId)}
                    disabled={isWorking}
                  >
                    <UserCheck size={16} /> Claim Visit
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </article>

      {/* Planned Visits Section */}
      <article className="history-panel role-panel-block" style={{ marginBottom: '1.5rem' }}>
        <div
          className="section-heading"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <div>
            <div className="eyebrow">FIELD CALENDAR</div>
            <h2>Planned Visits ({visits.length})</h2>
          </div>
        </div>
        {visits.length === 0 ? (
          <p className="history-empty">
            No visits scheduled. Click "Schedule Visit" above to add one.
          </p>
        ) : (
          <div
            className="visit-list"
            style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
          >
            {visits.map((visit) => (
              <div
                key={visit.visitId}
                style={{
                  padding: '1rem',
                  borderRadius: '0.5rem',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--surface-panel)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      marginBottom: '0.25rem',
                    }}
                  >
                    <strong>{visit.farmerName ?? 'Farmer'}</strong>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      ({visit.farmName ?? 'Farm'})
                    </span>
                    <span
                      className={`sync-status-indicator ${visit.status === 'completed' ? 'is-synced' : 'is-draft'}`}
                      style={{ fontSize: '0.75rem' }}
                    >
                      {visit.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {visit.plannedDate ? (
                      <>
                        Planned: {new Date(visit.plannedDate).toLocaleDateString()}{' '}
                        {new Date(visit.plannedDate).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </>
                    ) : (
                      <span style={{ color: 'var(--warning, #e65100)', fontWeight: 500 }}>
                        Date to be scheduled
                      </span>
                    )}
                    {visit.ward || visit.subCounty || visit.county ? (
                      <span style={{ marginLeft: '0.5rem' }}>
                        • {[visit.ward, visit.subCounty, visit.county].filter(Boolean).join(', ')}
                      </span>
                    ) : null}
                    {visit.farmerPhone && (
                      <span style={{ marginLeft: '0.5rem' }}>• Tel: {visit.farmerPhone}</span>
                    )}
                  </div>
                  {visit.notes && (
                    <p
                      style={{
                        fontSize: '0.85rem',
                        margin: '0.4rem 0 0 0',
                        color: 'var(--text-primary)',
                      }}
                    >
                      Note: {visit.notes}
                    </p>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {visit.status === 'claimed' && (
                    <button
                      className="secondary-button"
                      type="button"
                      style={{ fontSize: '0.8rem', padding: '0.3rem 0.65rem' }}
                      onClick={() => {
                        const defaultDate = new Date(Date.now() + 86400000 * 2).toISOString()
                        if (!token) return
                        void updateOfficerVisit(token, visit.visitId, {
                          plannedDate: defaultDate,
                          status: 'scheduled',
                        })
                          .then((updated) => {
                            setVisits((prev) =>
                              prev.map((v) => (v.visitId === visit.visitId ? updated : v)),
                            )
                            setMessage('Visit scheduled for field inspection.')
                          })
                          .catch((err) => setError(getErrorMessage(err)))
                      }}
                    >
                      <Calendar size={14} /> Schedule Date
                    </button>
                  )}
                  {(visit.status === 'claimed' || visit.status === 'scheduled') && (
                    <button
                      className="secondary-button"
                      type="button"
                      style={{ fontSize: '0.8rem', padding: '0.3rem 0.65rem' }}
                      onClick={() => handleUpdateVisitStatus(visit.visitId, 'in_progress')}
                    >
                      In Progress
                    </button>
                  )}
                  {visit.status !== 'completed' && visit.status !== 'cancelled' && (
                    <button
                      className="primary-button"
                      type="button"
                      style={{ fontSize: '0.8rem', padding: '0.3rem 0.65rem' }}
                      onClick={() => {
                        setCollectionVisit(visit)
                        setCollectionLat('')
                        setCollectionLng('')
                        setCollectionUncertainty('5.0')
                        setCollectionPh('')
                        setCollectionOrganicCarbon('')
                        setCollectionNitrogen('')
                        setCollectionPhosphorus('')
                        setCollectionPotassium('')
                        setCollectionTopCm('0')
                        setCollectionBottomCm('20')
                        setCollectionNotes('')
                      }}
                    >
                      <MapPin size={14} /> Collect Field Data
                    </button>
                  )}
                  {visit.status !== 'completed' && (
                    <button
                      className="secondary-button"
                      type="button"
                      style={{ fontSize: '0.8rem', padding: '0.3rem 0.65rem' }}
                      onClick={() => handleUpdateVisitStatus(visit.visitId, 'completed')}
                    >
                      <CheckCircle2 size={14} /> Mark Completed
                    </button>
                  )}
                  {(visit.status === 'claimed' || visit.status === 'scheduled') && (
                    <button
                      className="secondary-button"
                      type="button"
                      title="Release back to unassigned county pool for another officer"
                      style={{ fontSize: '0.8rem', padding: '0.3rem 0.65rem', color: 'var(--warning, #e65100)' }}
                      onClick={() => handleReleaseVisit(visit.visitId)}
                    >
                      <Undo2 size={14} /> Release to Pool
                    </button>
                  )}
                  {visit.status !== 'cancelled' && visit.status !== 'completed' && (
                    <button
                      className="secondary-button"
                      type="button"
                      style={{ fontSize: '0.8rem', padding: '0.3rem 0.65rem' }}
                      onClick={() => handleUpdateVisitStatus(visit.visitId, 'cancelled')}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </article>

      {/* Alerts Triage Section */}
      <article className="history-panel role-panel-block" style={{ marginBottom: '1.5rem' }}>
        <div
          className="section-heading"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <div>
            <div className="eyebrow">AGRONOMIC TRIAGE</div>
            <h2>Soil & Crop Alerts ({alerts.length})</h2>
          </div>
          <button className="primary-button" type="button" onClick={() => setIsAlertOpen(true)}>
            <Plus size={16} /> Log Alert
          </button>
        </div>
        {alerts.length === 0 ? (
          <p className="history-empty">No alerts in your assigned jurisdiction.</p>
        ) : (
          <div
            className="alert-list"
            style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
          >
            {alerts.map((alert) => (
              <div
                key={alert.alertId}
                style={{
                  padding: '1rem',
                  borderRadius: '0.5rem',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--surface-panel)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '0.5rem',
                  }}
                >
                  <div>
                    <strong
                      style={{
                        fontSize: '1.05rem',
                        color: alert.severity === 'critical' ? '#dc2626' : 'inherit',
                      }}
                    >
                      {alert.title}
                    </strong>
                    <div
                      style={{
                        fontSize: '0.85rem',
                        color: 'var(--text-secondary)',
                        marginTop: '0.2rem',
                      }}
                    >
                      Farmer: <strong>{alert.farmerName ?? 'Farmer'}</strong> • Source:{' '}
                      {alert.source}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span
                      className={`alert-severity ${alert.severity}`}
                      style={{ fontSize: '0.75rem', textTransform: 'uppercase' }}
                    >
                      {alert.severity}
                    </span>
                    <span
                      className={`sync-status-indicator ${alert.status === 'resolved' ? 'is-synced' : 'is-draft'}`}
                      style={{ fontSize: '0.75rem' }}
                    >
                      {alert.status}
                    </span>
                  </div>
                </div>

                {alert.summary && (
                  <p
                    style={{
                      fontSize: '0.9rem',
                      margin: '0.25rem 0',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {alert.summary}
                  </p>
                )}

                {alert.notes && (
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-secondary)',
                      marginTop: '0.25rem',
                    }}
                  >
                    Observations: {alert.notes}
                  </div>
                )}

                {alert.resolutionNotes && (
                  <div
                    style={{
                      marginTop: '0.5rem',
                      padding: '0.5rem',
                      borderRadius: '0.25rem',
                      backgroundColor: 'rgba(16, 185, 129, 0.08)',
                      border: '1px solid rgba(16, 185, 129, 0.2)',
                      fontSize: '0.85rem',
                      color: '#065f46',
                    }}
                  >
                    <strong>Resolution:</strong> {alert.resolutionNotes}
                  </div>
                )}

                {/* Triage actions */}
                {alert.status !== 'resolved' && (
                  <div
                    style={{
                      marginTop: '0.75rem',
                      display: 'flex',
                      gap: '0.5rem',
                      alignItems: 'center',
                    }}
                  >
                    {alert.status === 'open' && (
                      <button
                        className="secondary-button"
                        type="button"
                        style={{ fontSize: '0.8rem', padding: '0.25rem 0.65rem' }}
                        onClick={() => handleTriageSubmit(alert.alertId, 'acknowledged')}
                      >
                        Acknowledge
                      </button>
                    )}
                    <button
                      className="primary-button"
                      type="button"
                      style={{ fontSize: '0.8rem', padding: '0.25rem 0.65rem' }}
                      onClick={() => setTriageAlertId(alert.alertId)}
                    >
                      Resolve with Notes
                    </button>
                  </div>
                )}

                {/* Resolve dialog if active */}
                {triageAlertId === alert.alertId && (
                  <div
                    style={{
                      marginTop: '0.75rem',
                      padding: '0.75rem',
                      backgroundColor: 'var(--surface-accent)',
                      borderRadius: '0.375rem',
                    }}
                  >
                    <label
                      style={{
                        display: 'block',
                        fontSize: '0.85rem',
                        marginBottom: '0.4rem',
                        fontWeight: 500,
                      }}
                    >
                      Resolution Notes (e.g. Agronomic intervention, lime dosage prescribed, farmer
                      advice given):
                    </label>
                    <textarea
                      value={resolutionNotes}
                      onChange={(e) => setResolutionNotes(e.target.value)}
                      placeholder="e.g. Prescribed 200 kg/acre agricultural lime; verified application schedule with farmer."
                      rows={2}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        borderRadius: '0.25rem',
                        border: '1px solid var(--border-color)',
                        marginBottom: '0.5rem',
                      }}
                    />
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        className="primary-button"
                        type="button"
                        style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
                        onClick={() => handleTriageSubmit(alert.alertId, 'resolved')}
                      >
                        Confirm Resolution
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
                        onClick={() => setTriageAlertId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </article>

      {/* Agronomic Assessments & Pre-Review Pipeline */}
      <article className="history-panel role-panel-block" style={{ marginBottom: '1.5rem' }}>
        <div
          className="section-heading"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <div>
            <div className="eyebrow">KALRO AGRONOMIC ENGINE & COLLABORATION</div>
            <h2>Agronomic Assessments Pipeline ({assessments.length})</h2>
            <p className="page-subtitle" style={{ margin: '0.25rem 0 0 0', fontSize: '0.875rem' }}>
              Deterministic nutrient response models awaiting collaborative extension notes and agronomist verification.
            </p>
          </div>
        </div>

        {assessments.length === 0 ? (
          <p className="history-empty">
            No unverified assessments in your assigned jurisdiction. Field collections will automatically generate KALRO assessments.
          </p>
        ) : (
          <div
            className="assessment-list"
            style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
          >
            {assessments.map((item) => (
              <div
                key={item.assessmentId}
                style={{
                  padding: '1.25rem',
                  borderRadius: '0.5rem',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--surface-panel)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: '1rem',
                }}
              >
                <div style={{ flex: '1 1 300px' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      marginBottom: '0.35rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <strong style={{ fontSize: '1.05rem' }}>{item.farmName || 'Farm Assessment'}</strong>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      ({item.farmerName || 'Farmer'})
                    </span>
                    <span
                      style={{
                        padding: '0.2rem 0.5rem',
                        borderRadius: '9999px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        backgroundColor: 'rgba(37, 99, 235, 0.12)',
                        color: '#2563eb',
                        border: '1px solid rgba(37, 99, 235, 0.25)',
                        textTransform: 'uppercase',
                      }}
                    >
                      Crop: {item.targetCrop}
                    </span>
                    <span
                      className={`sync-status-indicator ${
                        item.reviewStage === 'claimed' ? 'is-synced' : 'is-draft'
                      }`}
                      style={{ fontSize: '0.75rem' }}
                    >
                      {item.reviewStage === 'claimed' ? 'Claimed by Agronomist' : 'Awaiting Review'}
                    </span>
                  </div>

                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                    {item.county ? `Region: ${item.county} County • ` : ''}
                    Prescriptions: {item.engineBaseline?.prescriptions?.length ?? 0} items • Commercial Formulations: {item.engineBaseline?.commercialInputs?.length ?? 0}
                    {item.officerEdits?.length > 0 ? ` • ${item.officerEdits.length} Officer note(s)` : ''}
                    {item.agronomistEdits?.length > 0 ? ` • ${item.agronomistEdits.length} Agronomist note(s)` : ''}
                  </div>

                  {/* Summary Diagnoses Tags */}
                  {item.engineBaseline?.diagnoses && item.engineBaseline.diagnoses.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      {item.engineBaseline.diagnoses.slice(0, 3).map((d, idx) => (
                        <span
                          key={idx}
                          style={{
                            fontSize: '0.75rem',
                            padding: '0.15rem 0.45rem',
                            borderRadius: '0.25rem',
                            backgroundColor:
                              d.status === 'optimal'
                                ? 'rgba(22, 163, 74, 0.1)'
                                : d.status === 'critical'
                                ? 'rgba(220, 38, 38, 0.1)'
                                : 'rgba(234, 88, 12, 0.1)',
                            color:
                              d.status === 'optimal'
                                ? '#16a34a'
                                : d.status === 'critical'
                                ? '#dc2626'
                                : '#ea580c',
                            fontWeight: 500,
                          }}
                        >
                          {d.analyte.replace('_', ' ')}: {d.status}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {item.reviewStage !== 'claimed' ? (
                    <button
                      className="secondary-button"
                      type="button"
                      style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                      onClick={() => handleClaimAssessment(item.assessmentId)}
                      disabled={isAssessmentActionWorking}
                    >
                      <UserCheck size={14} /> Claim
                    </button>
                  ) : (
                    <button
                      className="secondary-button"
                      type="button"
                      style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem', color: 'var(--warning, #e65100)' }}
                      onClick={() => handleReleaseAssessment(item.assessmentId)}
                      disabled={isAssessmentActionWorking}
                    >
                      <Undo2 size={14} /> Release
                    </button>
                  )}

                  <button
                    className="primary-button"
                    type="button"
                    style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem' }}
                    onClick={() => handleOpenAssessment(item)}
                  >
                    <FileText size={14} /> Inspect & Review
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </article>

      {/* Gated Report Export Section */}
      <article className="history-panel role-panel-block" style={{ marginBottom: '2rem' }}>
        <div
          className="section-heading"
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <div>
            <div className="eyebrow">AUDITED REPORTING</div>
            <h2>Gated Report Export</h2>
            <p className="page-subtitle" style={{ margin: '0.25rem 0 0 0', fontSize: '0.875rem' }}>
              Export anonymized agronomic and soil health records for your assigned jurisdiction
              under reviewed data protection policy.
            </p>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={handleExport}
            disabled={isExporting}
          >
            <Download size={16} /> {isExporting ? 'Generating…' : 'Export Jurisdiction Report'}
          </button>
        </div>

        {exportResult && (
          <div
            style={{
              marginTop: '1rem',
              padding: '1rem',
              borderRadius: '0.5rem',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--surface-accent)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.5rem',
              }}
            >
              <strong>Export Generated: {exportResult.exportId}</strong>
              <span style={{ fontSize: '0.8rem' }}>{exportResult.recordCount} records</span>
            </div>
            <p style={{ fontSize: '0.85rem', color: '#166534', margin: '0.25rem 0' }}>
              {exportResult.privacyDisclaimer}
            </p>
            <div
              style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}
            >
              <strong>Allowlisted fields:</strong> {exportResult.allowlistedFields.join(', ')}
            </div>
          </div>
        )}
      </article>

      {/* Modal: Schedule Visit */}
      {isScheduleOpen && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            className="modal-content"
            style={{
              backgroundColor: 'var(--surface-panel)',
              padding: '1.5rem',
              borderRadius: '0.75rem',
              maxWidth: '480px',
              width: '90%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>Schedule Field Visit</h3>
            <form
              onSubmit={handleScheduleVisit}
              style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
            >
              <label className="auth-field">
                <span>Select Farmer</span>
                <select
                  value={scheduleFarmerId}
                  onChange={(e) => setScheduleFarmerId(e.target.value)}
                  required
                  style={{
                    padding: '0.5rem',
                    borderRadius: '0.25rem',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  {roster.map((f) => (
                    <option key={f.farmerId} value={f.farmerId}>
                      {f.name} ({f.farmName ?? 'Farm'}) - {f.ward}
                    </option>
                  ))}
                </select>
              </label>

              <label className="auth-field">
                <span>Planned Date & Time</span>
                <input
                  type="datetime-local"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  required
                  style={{
                    padding: '0.5rem',
                    borderRadius: '0.25rem',
                    border: '1px solid var(--border-color)',
                  }}
                />
              </label>

              <label className="auth-field">
                <span>Visit Purpose / Notes</span>
                <textarea
                  value={scheduleNotes}
                  onChange={(e) => setScheduleNotes(e.target.value)}
                  placeholder="e.g. Inspect soil sampling results and advise on acidity treatment"
                  rows={3}
                  style={{
                    padding: '0.5rem',
                    borderRadius: '0.25rem',
                    border: '1px solid var(--border-color)',
                  }}
                />
              </label>

              <div
                style={{
                  display: 'flex',
                  gap: '0.75rem',
                  justifyContent: 'flex-end',
                  marginTop: '0.5rem',
                }}
              >
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setIsScheduleOpen(false)}
                >
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={isWorking}>
                  {isWorking ? 'Scheduling…' : 'Confirm Schedule Visit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create Alert */}
      {isAlertOpen && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            className="modal-content"
            style={{
              backgroundColor: 'var(--surface-panel)',
              padding: '1.5rem',
              borderRadius: '0.75rem',
              maxWidth: '480px',
              width: '90%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>Log Agronomic Alert</h3>
            <form
              onSubmit={handleCreateAlert}
              style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
            >
              <label className="auth-field">
                <span>Select Farmer</span>
                <select
                  value={alertFarmerId}
                  onChange={(e) => setAlertFarmerId(e.target.value)}
                  required
                  style={{
                    padding: '0.5rem',
                    borderRadius: '0.25rem',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  {roster.map((f) => (
                    <option key={f.farmerId} value={f.farmerId}>
                      {f.name} ({f.farmName ?? 'Farm'}) - {f.ward}
                    </option>
                  ))}
                </select>
              </label>

              <label className="auth-field">
                <span>Alert Title</span>
                <input
                  type="text"
                  value={alertTitle}
                  onChange={(e) => setAlertTitle(e.target.value)}
                  placeholder="e.g. Critical Acidity Detected"
                  required
                  style={{
                    padding: '0.5rem',
                    borderRadius: '0.25rem',
                    border: '1px solid var(--border-color)',
                  }}
                />
              </label>

              <label className="auth-field">
                <span>Severity</span>
                <select
                  value={alertSeverity}
                  onChange={(e) =>
                    setAlertSeverity(e.target.value as 'info' | 'warning' | 'critical')
                  }
                  style={{
                    padding: '0.5rem',
                    borderRadius: '0.25rem',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="critical">Critical</option>
                </select>
              </label>

              <label className="auth-field">
                <span>Summary / Symptoms</span>
                <textarea
                  value={alertSummary}
                  onChange={(e) => setAlertSummary(e.target.value)}
                  placeholder="e.g. pH is below 5.0, crop stunting observed"
                  rows={2}
                  style={{
                    padding: '0.5rem',
                    borderRadius: '0.25rem',
                    border: '1px solid var(--border-color)',
                  }}
                />
              </label>

              <label className="auth-field">
                <span>Field Notes</span>
                <textarea
                  value={alertNotes}
                  onChange={(e) => setAlertNotes(e.target.value)}
                  placeholder="Additional field observations"
                  rows={2}
                  style={{
                    padding: '0.5rem',
                    borderRadius: '0.25rem',
                    border: '1px solid var(--border-color)',
                  }}
                />
              </label>

              <div
                style={{
                  display: 'flex',
                  gap: '0.75rem',
                  justifyContent: 'flex-end',
                  marginTop: '0.5rem',
                }}
              >
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setIsAlertOpen(false)}
                >
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={isWorking}>
                  {isWorking ? 'Logging…' : 'Log Alert'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Record Field Data Collection & GPS */}
      {collectionVisit && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            className="modal-content"
            style={{
              backgroundColor: 'var(--surface-panel)',
              padding: '1.5rem',
              borderRadius: '0.75rem',
              maxWidth: '560px',
              width: '90%',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: '0.25rem' }}>
              On-Site Field Data & GPS Capture
            </h3>
            <p
              style={{
                fontSize: '0.85rem',
                color: 'var(--text-secondary)',
                marginBottom: '1rem',
              }}
            >
              Farm: <strong>{collectionVisit.farmerName ?? 'Assigned Farmer'}</strong> • Visit:{' '}
              {collectionVisit.visitId}
            </p>

            <form
              onSubmit={handleRecordCollection}
              style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
            >
              {/* GPS Coordinates */}
              <div
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  backgroundColor: 'var(--surface-accent)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <strong
                  style={{
                    display: 'block',
                    fontSize: '0.9rem',
                    marginBottom: '0.5rem',
                    color: 'var(--primary-color)',
                  }}
                >
                  📍 Verified On-Site GPS Coordinates
                </strong>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <label className="auth-field" style={{ margin: 0 }}>
                    <span style={{ fontSize: '0.8rem' }}>Latitude</span>
                    <input
                      type="number"
                      step="any"
                      placeholder="e.g. 0.0512"
                      value={collectionLat}
                      onChange={(e) => setCollectionLat(e.target.value)}
                      required
                      style={{
                        padding: '0.4rem',
                        borderRadius: '0.25rem',
                        border: '1px solid var(--border-color)',
                      }}
                    />
                  </label>
                  <label className="auth-field" style={{ margin: 0 }}>
                    <span style={{ fontSize: '0.8rem' }}>Longitude</span>
                    <input
                      type="number"
                      step="any"
                      placeholder="e.g. 34.7521"
                      value={collectionLng}
                      onChange={(e) => setCollectionLng(e.target.value)}
                      required
                      style={{
                        padding: '0.4rem',
                        borderRadius: '0.25rem',
                        border: '1px solid var(--border-color)',
                      }}
                    />
                  </label>
                </div>
                <label className="auth-field" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                  <span style={{ fontSize: '0.8rem' }}>Accuracy / Uncertainty (meters)</span>
                  <input
                    type="number"
                    step="any"
                    placeholder="5.0"
                    value={collectionUncertainty}
                    onChange={(e) => setCollectionUncertainty(e.target.value)}
                    style={{
                      padding: '0.4rem',
                      borderRadius: '0.25rem',
                      border: '1px solid var(--border-color)',
                    }}
                  />
                </label>
              </div>

              {/* Soil Properties */}
              <div
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  backgroundColor: 'var(--surface-accent)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <strong
                  style={{
                    display: 'block',
                    fontSize: '0.9rem',
                    marginBottom: '0.5rem',
                    color: 'var(--primary-color)',
                  }}
                >
                  🧪 Soil Core & Chemical Properties
                </strong>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '0.5rem',
                    marginBottom: '0.5rem',
                  }}
                >
                  <label className="auth-field" style={{ margin: 0 }}>
                    <span style={{ fontSize: '0.8rem' }}>Top Depth (cm)</span>
                    <input
                      type="number"
                      value={collectionTopCm}
                      onChange={(e) => setCollectionTopCm(e.target.value)}
                      style={{
                        padding: '0.4rem',
                        borderRadius: '0.25rem',
                        border: '1px solid var(--border-color)',
                      }}
                    />
                  </label>
                  <label className="auth-field" style={{ margin: 0 }}>
                    <span style={{ fontSize: '0.8rem' }}>Bottom Depth (cm)</span>
                    <input
                      type="number"
                      value={collectionBottomCm}
                      onChange={(e) => setCollectionBottomCm(e.target.value)}
                      style={{
                        padding: '0.4rem',
                        borderRadius: '0.25rem',
                        border: '1px solid var(--border-color)',
                      }}
                    />
                  </label>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '0.5rem',
                  }}
                >
                  <label className="auth-field" style={{ margin: 0 }}>
                    <span style={{ fontSize: '0.8rem' }}>Soil pH</span>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="e.g. 5.8"
                      value={collectionPh}
                      onChange={(e) => setCollectionPh(e.target.value)}
                      required
                      style={{
                        padding: '0.4rem',
                        borderRadius: '0.25rem',
                        border: '1px solid var(--border-color)',
                      }}
                    />
                  </label>
                  <label className="auth-field" style={{ margin: 0 }}>
                    <span style={{ fontSize: '0.8rem' }}>Organic Carbon (%)</span>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="e.g. 1.8"
                      value={collectionOrganicCarbon}
                      onChange={(e) => setCollectionOrganicCarbon(e.target.value)}
                      style={{
                        padding: '0.4rem',
                        borderRadius: '0.25rem',
                        border: '1px solid var(--border-color)',
                      }}
                    />
                  </label>
                  <label className="auth-field" style={{ margin: 0 }}>
                    <span style={{ fontSize: '0.8rem' }}>Total Nitrogen (%)</span>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="e.g. 0.15"
                      value={collectionNitrogen}
                      onChange={(e) => setCollectionNitrogen(e.target.value)}
                      style={{
                        padding: '0.4rem',
                        borderRadius: '0.25rem',
                        border: '1px solid var(--border-color)',
                      }}
                    />
                  </label>
                  <label className="auth-field" style={{ margin: 0 }}>
                    <span style={{ fontSize: '0.8rem' }}>Olsen Phosphorus (mg/kg)</span>
                    <input
                      type="number"
                      step="0.1"
                      placeholder="e.g. 12.5"
                      value={collectionPhosphorus}
                      onChange={(e) => setCollectionPhosphorus(e.target.value)}
                      style={{
                        padding: '0.4rem',
                        borderRadius: '0.25rem',
                        border: '1px solid var(--border-color)',
                      }}
                    />
                  </label>
                  <label
                    className="auth-field"
                    style={{ margin: 0, gridColumn: 'span 2' }}
                  >
                    <span style={{ fontSize: '0.8rem' }}>Exchangeable Potassium (cmol/kg)</span>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="e.g. 0.45"
                      value={collectionPotassium}
                      onChange={(e) => setCollectionPotassium(e.target.value)}
                      style={{
                        padding: '0.4rem',
                        borderRadius: '0.25rem',
                        border: '1px solid var(--border-color)',
                      }}
                    />
                  </label>
                </div>
              </div>

              {/* Field Notes */}
              <label className="auth-field" style={{ margin: 0 }}>
                <span style={{ fontSize: '0.8rem' }}>Field Observations / Crop Notes</span>
                <textarea
                  value={collectionNotes}
                  onChange={(e) => setCollectionNotes(e.target.value)}
                  placeholder="e.g. Maize at V4 stage showing interveinal chlorosis; soil core moist red clay loam."
                  rows={2}
                  style={{
                    padding: '0.4rem',
                    borderRadius: '0.25rem',
                    border: '1px solid var(--border-color)',
                  }}
                />
              </label>

              <div
                style={{
                  display: 'flex',
                  gap: '0.75rem',
                  justifyContent: 'flex-end',
                  marginTop: '0.5rem',
                }}
              >
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setCollectionVisit(null)}
                >
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={isWorking}>
                  {isWorking ? 'Recording…' : 'Save & Mark Complete'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Inspect & Review Agronomic Assessment */}
      {selectedAssessment && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem',
          }}
        >
          <div
            className="modal-card"
            style={{
              backgroundColor: 'var(--surface-panel)',
              borderRadius: '0.75rem',
              padding: '1.5rem',
              width: '100%',
              maxWidth: '850px',
              maxHeight: '90vh',
              overflowY: 'auto',
              border: '1px solid var(--border-color)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '1rem',
                borderBottom: '1px solid var(--border-color)',
                paddingBottom: '0.75rem',
              }}
            >
              <div>
                <div className="eyebrow">KALRO ASSESSMENT PRE-REVIEW</div>
                <h3 style={{ margin: '0.2rem 0', fontSize: '1.25rem' }}>
                  {selectedAssessment.farmName || 'Farm Assessment'} — {selectedAssessment.targetCrop.toUpperCase()}
                </h3>
                <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Farmer: {selectedAssessment.farmerName || 'Farmer'} • County: {selectedAssessment.county || 'N/A'} • Stage: {selectedAssessment.reviewStage}
                </p>
              </div>
              <button
                className="secondary-button"
                type="button"
                style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}
                onClick={() => setSelectedAssessment(null)}
              >
                Close
              </button>
            </div>

            {/* Diagnoses Section */}
            <div style={{ marginBottom: '1.25rem' }}>
              <h4 style={{ fontSize: '0.95rem', marginBottom: '0.5rem', color: 'var(--primary-color)' }}>
                1. Soil Diagnoses & Indicators
              </h4>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                  gap: '0.75rem',
                }}
              >
                {selectedAssessment.engineBaseline?.diagnoses?.map((diag, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '0.75rem',
                      borderRadius: '0.375rem',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--surface-accent)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                      <strong style={{ fontSize: '0.85rem', textTransform: 'capitalize' }}>
                        {diag.analyte.replace('_', ' ')}
                      </strong>
                      <span
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          color:
                            diag.status === 'optimal'
                              ? '#16a34a'
                              : diag.status === 'critical'
                              ? '#dc2626'
                              : '#ea580c',
                        }}
                      >
                        {diag.status}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                      {diag.message}
                    </div>
                    {diag.recommendation && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--primary-color)', fontWeight: 500 }}>
                        Rec: {diag.recommendation}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Prescriptions & Commercial Inputs Table */}
            <div style={{ marginBottom: '1.25rem' }}>
              <h4 style={{ fontSize: '0.95rem', marginBottom: '0.5rem', color: 'var(--primary-color)' }}>
                2. Agronomic Prescriptions (KALRO Matrix Scaling)
              </h4>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border-color)', textAlign: 'left' }}>
                      <th style={{ padding: '0.4rem' }}>Category</th>
                      <th style={{ padding: '0.4rem' }}>Product / Element</th>
                      <th style={{ padding: '0.4rem' }}>Rate / Ha</th>
                      <th style={{ padding: '0.4rem' }}>Rate / Acre</th>
                      <th style={{ padding: '0.4rem' }}>Total Farm Prescription</th>
                      <th style={{ padding: '0.4rem' }}>Application Timing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedAssessment.engineBaseline?.prescriptions?.map((p, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '0.4rem', fontWeight: 600 }}>{p.category}</td>
                        <td style={{ padding: '0.4rem' }}>{p.productType}</td>
                        <td style={{ padding: '0.4rem' }}>{p.ratePerHa}</td>
                        <td style={{ padding: '0.4rem' }}>{p.ratePerAcre}</td>
                        <td style={{ padding: '0.4rem', fontWeight: 600, color: 'var(--primary-color)' }}>
                          {p.totalFarmPrescription}
                        </td>
                        <td style={{ padding: '0.4rem' }}>{p.applicationTiming}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Commercial Inputs & Split Schedule */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
                gap: '1rem',
                marginBottom: '1.25rem',
              }}
            >
              <div>
                <h4 style={{ fontSize: '0.95rem', marginBottom: '0.5rem', color: 'var(--primary-color)' }}>
                  3. Commercial Fertilizer Bridge
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {selectedAssessment.engineBaseline?.commercialInputs?.map((c, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '0.6rem',
                        borderRadius: '0.375rem',
                        border: '1px solid var(--border-color)',
                        backgroundColor: 'var(--surface-accent)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong style={{ fontSize: '0.85rem' }}>{c.commercialFormulation}</strong>
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#2563eb' }}>
                          {c.totalBagsNeeded} {c.bagUnit}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                        Purpose: {c.purpose}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 style={{ fontSize: '0.95rem', marginBottom: '0.5rem', color: 'var(--primary-color)' }}>
                  4. Application Split Schedule
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {selectedAssessment.engineBaseline?.splitSchedule?.map((s, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '0.6rem',
                        borderRadius: '0.375rem',
                        border: '1px solid var(--border-color)',
                        backgroundColor: 'var(--surface-accent)',
                      }}
                    >
                      <strong style={{ fontSize: '0.85rem', display: 'block' }}>{s.stage}</strong>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)' }}>{s.action}</span>
                      {s.notes && (
                        <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {s.notes}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* AI Advisory Layer */}
            {selectedAssessment.engineBaseline?.aiAdvisoryNotes &&
              selectedAssessment.engineBaseline.aiAdvisoryNotes.length > 0 && (
                <div
                  style={{
                    padding: '0.85rem',
                    borderRadius: '0.5rem',
                    border: '1px solid rgba(147, 51, 234, 0.25)',
                    backgroundColor: 'rgba(147, 51, 234, 0.05)',
                    marginBottom: '1.25rem',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      color: '#7e22ce',
                      fontWeight: 600,
                      fontSize: '0.9rem',
                      marginBottom: '0.4rem',
                    }}
                  >
                    <Sparkles size={16} /> AI Agronomic Advisory & Regional Insights Layer
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.825rem', color: 'var(--text-primary)' }}>
                    {selectedAssessment.engineBaseline.aiAdvisoryNotes.map((note, idx) => (
                      <li key={idx} style={{ marginBottom: '0.25rem' }}>
                        {note}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

            {/* Audit & Collaborative Edits History */}
            <div
              style={{
                padding: '0.85rem',
                borderRadius: '0.5rem',
                backgroundColor: 'var(--surface-accent)',
                border: '1px solid var(--border-color)',
                marginBottom: '1.25rem',
              }}
            >
              <h4 style={{ fontSize: '0.9rem', margin: '0 0 0.5rem 0', color: 'var(--text-secondary)' }}>
                Collaborative Review Thread
              </h4>
              {(!selectedAssessment.officerEdits || selectedAssessment.officerEdits.length === 0) &&
              (!selectedAssessment.agronomistEdits || selectedAssessment.agronomistEdits.length === 0) ? (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
                  No collaborative notes recorded yet. Add notes below to document field adjustments.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {[
                    ...(selectedAssessment.officerEdits || []),
                    ...(selectedAssessment.agronomistEdits || []),
                  ]
                    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
                    .map((item, idx) => (
                      <div
                        key={idx}
                        style={{
                          padding: '0.4rem 0.6rem',
                          borderRadius: '0.25rem',
                          backgroundColor: 'var(--surface-panel)',
                          fontSize: '0.8rem',
                        }}
                      >
                        <strong style={{ color: 'var(--primary-color)' }}>
                          {item.authorName} ({item.role})
                        </strong>{' '}
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          [{new Date(item.timestamp).toLocaleString()}]:
                        </span>{' '}
                        <span>{item.notes}</span>
                      </div>
                    ))}
                </div>
              )}

              {/* Form to append collaborative feedback */}
              <form onSubmit={handleSaveAssessmentNotes} style={{ marginTop: '0.75rem' }}>
                <label className="auth-field" style={{ margin: 0 }}>
                  <span style={{ fontSize: '0.8rem' }}>Add Agronomic / Field Observations & Guidance</span>
                  <textarea
                    rows={2}
                    value={assessmentNotes}
                    onChange={(e) => setAssessmentNotes(e.target.value)}
                    placeholder="e.g. Recommend split CAN application at knee-height due to high leaching risk in red loam."
                    style={{
                      padding: '0.4rem',
                      borderRadius: '0.25rem',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.85rem',
                    }}
                  />
                </label>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.4rem' }}>
                  <button
                    className="secondary-button"
                    type="submit"
                    disabled={isAssessmentActionWorking || !assessmentNotes.trim()}
                    style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
                  >
                    <Send size={14} /> Add Note
                  </button>
                </div>
              </form>
            </div>

            {/* Publication / Verification Tier */}
            <div
              style={{
                padding: '1rem',
                borderRadius: '0.5rem',
                border: '1px solid rgba(22, 163, 74, 0.3)',
                backgroundColor: 'rgba(22, 163, 74, 0.05)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <FileCheck size={18} style={{ color: '#16a34a' }} />
                <strong style={{ color: '#15803d', fontSize: '0.95rem' }}>
                  Verification & Publication Tier
                </strong>
              </div>
              <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.8rem', color: '#166534' }}>
                Publishing certifies this assessment under your agronomist accreditation and permanently releases
                the official verified soil report to the farmer workspace.
              </p>

              <form onSubmit={handlePublishAssessment}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                    gap: '0.75rem',
                    marginBottom: '0.75rem',
                  }}
                >
                  <label className="auth-field" style={{ margin: 0 }}>
                    <span style={{ fontSize: '0.8rem' }}>Agronomist License / Accreditation No.</span>
                    <input
                      type="text"
                      placeholder="e.g. KAAA-AGR-4091"
                      value={agronomistLicense}
                      onChange={(e) => setAgronomistLicense(e.target.value)}
                      style={{
                        padding: '0.4rem',
                        borderRadius: '0.25rem',
                        border: '1px solid var(--border-color)',
                        fontSize: '0.85rem',
                      }}
                    />
                  </label>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {selectedAssessment.reviewStage !== 'claimed' ? (
                      <button
                        className="secondary-button"
                        type="button"
                        style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                        onClick={() => handleClaimAssessment(selectedAssessment.assessmentId)}
                        disabled={isAssessmentActionWorking}
                      >
                        <UserCheck size={14} /> Claim Assessment
                      </button>
                    ) : (
                      <button
                        className="secondary-button"
                        type="button"
                        style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', color: 'var(--warning, #e65100)' }}
                        onClick={() => handleReleaseAssessment(selectedAssessment.assessmentId)}
                        disabled={isAssessmentActionWorking}
                      >
                        <Undo2 size={14} /> Release Claim
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setSelectedAssessment(null)}
                      style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
                    >
                      Close
                    </button>
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={isAssessmentActionWorking}
                      style={{
                        fontSize: '0.85rem',
                        padding: '0.4rem 1rem',
                        backgroundColor: '#15803d',
                        borderColor: '#15803d',
                      }}
                    >
                      <ShieldCheck size={16} /> Verify & Publish Official Report
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Register Farmer On-Site Modal */}
      {showRegisterFarmerModal && (
        <div className="auth-card-backdrop" role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div className="auth-card" style={{ maxWidth: '540px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <UserPlus size={20} color="var(--primary, #2d6a4f)" />
              <h3 style={{ margin: 0 }}>Register Farmer On-Site</h3>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Register a farmer during an on-site field encounter. The farmer receives an email claim link
              with 6 daily reminders. If unclaimed by Day 7, the account and initial farm are cascade-deleted.
            </p>

            <form onSubmit={handleRegisterFarmerOnSite}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <label htmlFor="register-farmer-email" className="auth-field" style={{ gridColumn: 'span 2' }}>
                  <span>Farmer Email Address *</span>
                  <input
                    id="register-farmer-email"
                    type="email"
                    required
                    placeholder="farmer@example.com"
                    value={registerFarmerEmail}
                    onChange={(e) => setRegisterFarmerEmail(e.target.value)}
                  />
                </label>

                <label htmlFor="register-farmer-name" className="auth-field">
                  <span>Full Name *</span>
                  <input
                    id="register-farmer-name"
                    type="text"
                    required
                    placeholder="e.g. John Kiprono"
                    value={registerFarmerName}
                    onChange={(e) => setRegisterFarmerName(e.target.value)}
                  />
                </label>

                <label htmlFor="register-farmer-phone" className="auth-field">
                  <span>Phone Number (Optional)</span>
                  <input
                    id="register-farmer-phone"
                    type="tel"
                    placeholder="+254 712 345 678"
                    value={registerFarmerPhone}
                    onChange={(e) => setRegisterFarmerPhone(e.target.value)}
                  />
                </label>

                <label htmlFor="register-farmer-farm-name" className="auth-field" style={{ gridColumn: 'span 2' }}>
                  <span>Initial Farm Name *</span>
                  <input
                    id="register-farmer-farm-name"
                    type="text"
                    required
                    placeholder="e.g. Kiprono Highlands Farm"
                    value={registerFarmerFarmName}
                    onChange={(e) => setRegisterFarmerFarmName(e.target.value)}
                  />
                </label>

                <label htmlFor="register-farmer-county" className="auth-field">
                  <span>County *</span>
                  <select
                    id="register-farmer-county"
                    required
                    value={registerFarmerCounty}
                    onChange={(e) => setRegisterFarmerCounty(e.target.value)}
                  >
                    <option value="">Select County…</option>
                    {KENYA_COUNTIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>

                <label htmlFor="register-farmer-subcounty" className="auth-field">
                  <span>Sub-County *</span>
                  <input
                    id="register-farmer-subcounty"
                    type="text"
                    required
                    placeholder="e.g. Njoro"
                    value={registerFarmerSubCounty}
                    onChange={(e) => setRegisterFarmerSubCounty(e.target.value)}
                  />
                </label>

                <label htmlFor="register-farmer-ward" className="auth-field">
                  <span>Ward *</span>
                  <input
                    id="register-farmer-ward"
                    type="text"
                    required
                    placeholder="e.g. Mau Narok"
                    value={registerFarmerWard}
                    onChange={(e) => setRegisterFarmerWard(e.target.value)}
                  />
                </label>

                <label htmlFor="register-farmer-acres" className="auth-field">
                  <span>Total Acres</span>
                  <input
                    id="register-farmer-acres"
                    type="number"
                    step="0.1"
                    min="0.1"
                    placeholder="e.g. 2.5"
                    value={registerFarmerAcres}
                    onChange={(e) => setRegisterFarmerAcres(e.target.value)}
                  />
                </label>

                <label htmlFor="register-farmer-crops" className="auth-field" style={{ gridColumn: 'span 2' }}>
                  <span>Primary Crops (Comma-separated)</span>
                  <input
                    id="register-farmer-crops"
                    type="text"
                    placeholder="e.g. Maize, Beans, Irish Potatoes"
                    value={registerFarmerCrops}
                    onChange={(e) => setRegisterFarmerCrops(e.target.value)}
                  />
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowRegisterFarmerModal(false)}
                  disabled={isRegisteringFarmer}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={
                    isRegisteringFarmer ||
                    !registerFarmerEmail.trim() ||
                    !registerFarmerName.trim() ||
                    !registerFarmerFarmName.trim() ||
                    !registerFarmerCounty.trim() ||
                    !registerFarmerSubCounty.trim() ||
                    !registerFarmerWard.trim()
                  }
                >
                  {isRegisteringFarmer ? 'Registering…' : 'Register & Send Claim Link'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
