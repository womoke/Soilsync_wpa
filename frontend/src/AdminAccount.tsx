import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  Activity,
  AlertTriangle,
  Award,
  CheckCircle,
  Clock,
  Database,
  Eye,
  KeyRound,
  Lock,
  LogOut,
  RefreshCw,
  Search,
  Send,
  Server,
  Settings,
  Shield,
  ShieldAlert,
  Store,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  XCircle,
} from 'lucide-react'
import { linkAuthenticatedAccount } from './api/auth'
import { getSupabaseClient } from './lib/supabase'
import {
  approveAdminUser,
  cancelInvitation,
  getAdminAuditLog,
  getAdminOperationalHealth,
  getAdminOverview,
  getAdminPermissions,
  getAdminSettings,
  getAdminUsers,
  getSupportAccessGrants,
  grantSupportAccess,
  inviteAgrodealer,
  inviteAgronomist,
  inviteOfficer,
  resendInvitation,
  revokeAdminUser,
  revokeSupportAccess,
  toggleAdminUserActive,
  triggerUnclaimedCleanup,
  triggerUnclaimedReminders,
  updateAdminSetting,
  updateAdminUserRole,
  updateAgronomistApproval,
  viewSensitiveRecord,
  type AdminAuditEntry,
  type AdminOverview,
  type AdminPermission,
  type AdminUser,
  type OperationalHealth,
  type SensitiveRecordAccess,
  type SupportAccessGrant,
  type SystemSetting,
} from './api/admin'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The admin request could not be completed.'
}

// 15-Minute Inactivity Timeout for Admin Sessions
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000

import { KENYA_COUNTIES } from './data/kenyaLocations'

type SupportGrantTarget = 'farm' | 'reading' | 'farmer_profile' | 'agrodealer_order'

export default function AdminAccount({ onBackToDemo }: { onBackToDemo: () => void }) {
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

  // Active Tab
  const [activeTab, setActiveTab] = useState<
    'overview' | 'users' | 'health' | 'support' | 'settings' | 'audit'
  >('overview')

  // Data States
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [health, setHealth] = useState<OperationalHealth | null>(null)
  const [supportGrants, setSupportGrants] = useState<SupportAccessGrant[]>([])
  const [settings, setSettings] = useState<SystemSetting[]>([])
  const [auditLogs, setAuditLogs] = useState<AdminAuditEntry[]>([])
  const [permissions, setPermissions] = useState<AdminPermission[]>([])

  // User Filter State
  const [userRoleFilter, setUserRoleFilter] = useState<string>('')
  const [userApprovalFilter, setUserApprovalFilter] = useState<string>('')
  const [userSearchQuery, setUserSearchQuery] = useState<string>('')

  // Modals / Action States
  const [selectedUserForRevoke, setSelectedUserForRevoke] = useState<AdminUser | null>(null)
  const [revokeReason, setRevokeReason] = useState('')
  const [revokeRoleCheck, setRevokeRoleCheck] = useState(false)

  const [selectedUserForApprove, setSelectedUserForApprove] = useState<AdminUser | null>(null)
  const [approvalNotes, setApprovalNotes] = useState('')

  // Support Access Break-Glass Request Modal
  const [showGrantModal, setShowGrantModal] = useState(false)
  const [grantTargetType, setGrantTargetType] = useState<SupportGrantTarget>('farm')
  const [grantTargetId, setGrantTargetId] = useState('')
  const [grantReason, setGrantReason] = useState('')
  const [grantDurationMinutes, setGrantDurationMinutes] = useState(30)

  // Support Record Viewer Drawer/Modal
  const [viewedRecord, setViewedRecord] = useState<SensitiveRecordAccess | null>(null)
  const [isViewingRecord, setIsViewingRecord] = useState(false)

  // Revoke Support Grant Modal
  const [selectedGrantForRevoke, setSelectedGrantForRevoke] = useState<SupportAccessGrant | null>(
    null,
  )
  const [grantRevokeReason, setGrantRevokeReason] = useState('')

  // Setting Edit Modal
  const [editingSetting, setEditingSetting] = useState<SystemSetting | null>(null)
  const [settingEditValue, setSettingEditValue] = useState('')
  const [settingEditReason, setSettingEditReason] = useState('')

  // Officer Invite Modal State
  const [showInviteOfficerModal, setShowInviteOfficerModal] = useState(false)
  const [showInviteAgrodealerModal, setShowInviteAgrodealerModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteDesignation, setInviteDesignation] = useState<'county' | 'subcounty' | 'ward'>('ward')
  const [inviteCounty, setInviteCounty] = useState('')
  const [inviteSubCounty, setInviteSubCounty] = useState('')
  const [inviteWard, setInviteWard] = useState('')
  const [inviteDisplayName, setInviteDisplayName] = useState('')
  const [inviteDealerEmail, setInviteDealerEmail] = useState('')
  const [inviteDealerName, setInviteDealerName] = useState('')
  const [inviteDealerBusinessName, setInviteDealerBusinessName] = useState('')
  const [inviteDealerCounty, setInviteDealerCounty] = useState('')
  const [inviteDealerSubCounty, setInviteDealerSubCounty] = useState('')
  const [inviteDealerWard, setInviteDealerWard] = useState('')
  const [isInviting, setIsInviting] = useState(false)

  // Agronomist Invite Modal State
  const [showInviteAgronomistModal, setShowInviteAgronomistModal] = useState(false)
  const [inviteAgronomistEmail, setInviteAgronomistEmail] = useState('')
  const [inviteAgronomistName, setInviteAgronomistName] = useState('')
  const [inviteAgronomistLicence, setInviteAgronomistLicence] = useState('')
  const [inviteAgronomistCounty, setInviteAgronomistCounty] = useState('')
  const [inviteAgronomistSubCounty, setInviteAgronomistSubCounty] = useState('')
  const [inviteAgronomistWard, setInviteAgronomistWard] = useState('')
  const [inviteAgronomistStatus, setInviteAgronomistStatus] = useState<'pending' | 'approved'>('pending')

  // Unclaimed Lifecycle Batch Job State
  const [isProcessingBatch, setIsProcessingBatch] = useState(false)

  // Re-Authentication State for Sensitive Actions
  const [pendingSensitiveAction, setPendingSensitiveAction] = useState<{
    title: string
    action: () => Promise<void>
  } | null>(null)
  const [reauthPassword, setReauthPassword] = useState('')
  const [reauthError, setReauthError] = useState('')
  const [isReauthenticating, setIsReauthenticating] = useState(false)

  const effectiveToken = (sessionRoleVerified ? session?.access_token : null) || activeToken

  useEffect(() => {
    if (!effectiveToken) return

    let timer: ReturnType<typeof setTimeout>

    const resetTimer = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        setActiveToken('')
        setSession(null)
        setSessionRoleVerified(false)
        setMessage('Admin session timed out after 15 minutes of inactivity.')
        if (supabase) {
          void supabase.auth.signOut({ scope: 'local' })
        }
      }, INACTIVITY_TIMEOUT_MS)
    }

    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach((event) => window.addEventListener(event, resetTimer, { passive: true }))

    resetTimer()

    return () => {
      clearTimeout(timer)
      events.forEach((event) => window.removeEventListener(event, resetTimer))
    }
  }, [effectiveToken, supabase])

  const executeWithReauth = async (
    title: string,
    actionFn: () => Promise<void>,
  ) => {
    if (session) {
      setPendingSensitiveAction({
        title,
        action: actionFn,
      })
      setReauthPassword('')
      setReauthError('')
    } else {
      await actionFn()
    }
  }

  const handleReauthSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!reauthPassword.trim()) {
      setReauthError('Administrator password is required.')
      return
    }
    setIsReauthenticating(true)
    setReauthError('')
    try {
      if (supabase && session?.user?.email) {
        const authClient = supabase.auth as unknown as {
          reauthenticate?: () => Promise<{ error?: unknown }>
        }
        if (typeof authClient.reauthenticate === 'function') {
          const { error: reauthErr } = await authClient.reauthenticate()
          if (reauthErr) throw reauthErr
        } else {
          const { error: signInErr } = await supabase.auth.signInWithPassword({
            email: session.user.email,
            password: reauthPassword,
          })
          if (signInErr) throw new Error('Administrative re-authentication failed: Invalid password.')
        }
      }
      const target = pendingSensitiveAction
      setPendingSensitiveAction(null)
      setReauthPassword('')
      if (target) {
        await target.action()
      }
    } catch (err) {
      setReauthError(getErrorMessage(err))
    } finally {
      setIsReauthenticating(false)
    }
  }

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      setSession(data.session)
      setSessionRoleVerified(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: string, currentSession: Session | null) => {
      setSession(currentSession)
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
        if (profile.role !== 'admin') {
          throw new Error(
            `This account has the ${profile.role.replaceAll('_', ' ')} role, not the admin role.`,
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

  // Refresh active tab data
  const refreshData = useCallback(async () => {
    if (!effectiveToken) return
    setIsLoadingData(true)
    setError('')
    try {
      if (activeTab === 'overview') {
        const [ov, perms] = await Promise.all([
          getAdminOverview(effectiveToken),
          getAdminPermissions(effectiveToken).catch(() => []),
        ])
        setOverview(ov)
        setPermissions(perms)
      } else if (activeTab === 'users') {
        const uList = await getAdminUsers(effectiveToken, {
          role: userRoleFilter || undefined,
          approvalStatus: userApprovalFilter || undefined,
          search: userSearchQuery || undefined,
        })
        setUsers(uList)
      } else if (activeTab === 'health') {
        const hData = await getAdminOperationalHealth(effectiveToken)
        setHealth(hData)
      } else if (activeTab === 'support') {
        const grants = await getSupportAccessGrants(effectiveToken)
        setSupportGrants(grants)
      } else if (activeTab === 'settings') {
        const sData = await getAdminSettings(effectiveToken)
        setSettings(sData)
      } else if (activeTab === 'audit') {
        const logs = await getAdminAuditLog(effectiveToken, 100)
        setAuditLogs(logs)
      }
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsLoadingData(false)
    }
  }, [activeTab, effectiveToken, userApprovalFilter, userRoleFilter, userSearchQuery])

  useEffect(() => {
    if (!effectiveToken) return
    void Promise.resolve().then(refreshData)
  }, [effectiveToken, refreshData])

  const [currentTime, setCurrentTime] = useState(0)

  useEffect(() => {
    const updateCurrentTime = () => setCurrentTime(Date.now())
    const initialUpdate = window.setTimeout(updateCurrentTime, 0)
    const clockInterval = window.setInterval(updateCurrentTime, 60_000)
    return () => {
      window.clearTimeout(initialUpdate)
      window.clearInterval(clockInterval)
    }
  }, [])

  // Login handler
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
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
      setMessage('Successfully authenticated as system administrator.')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  // Manual token submission (for test environments)
  const handleManualTokenSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!manualToken.trim()) return
    setActiveToken(manualToken.trim())
    setMessage('Active administrative session token registered.')
  }

  // Sign out
  const handleSignOut = async () => {
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
    setActiveToken('')
    setMessage('Signed out of admin console.')
    onBackToDemo()
  }

  // Approve User
  const handleApproveUser = async () => {
    if (!selectedUserForApprove || !effectiveToken) return
    setIsWorking(true)
    setError('')
    try {
      if (selectedUserForApprove.role === 'agronomist') {
        try {
          await updateAgronomistApproval(
            selectedUserForApprove.userId,
            'approved',
            approvalNotes || undefined,
            effectiveToken,
          )
        } catch {
          // If profile approval is already handled, fall through to user approval
        }
      }
      const updated = await approveAdminUser(
        effectiveToken,
        selectedUserForApprove.userId,
        approvalNotes,
      )
      setUsers((prev) => prev.map((u) => (u.userId === updated.userId ? updated : u)))
      setSelectedUserForApprove(null)
      setApprovalNotes('')
      setMessage(`Account ${updated.email} approved successfully.`)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  // Revoke User
  const handleRevokeUser = async () => {
    if (!selectedUserForRevoke || !effectiveToken || !revokeReason.trim()) return
    setIsWorking(true)
    setError('')
    try {
      const updated = await revokeAdminUser(
        effectiveToken,
        selectedUserForRevoke.userId,
        revokeReason.trim(),
        revokeRoleCheck,
      )
      setUsers((prev) => prev.map((u) => (u.userId === updated.userId ? updated : u)))
      setSelectedUserForRevoke(null)
      setRevokeReason('')
      setRevokeRoleCheck(false)
      setMessage(`Account ${updated.email} has been suspended with logged justification.`)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  // Update Role
  const handleRoleChange = async (userId: string, newRole: string) => {
    if (!effectiveToken) return
    setIsWorking(true)
    setError('')
    try {
      const updated = await updateAdminUserRole(effectiveToken, userId, newRole)
      setUsers((prev) => prev.map((u) => (u.userId === updated.userId ? updated : u)))
      setMessage(`User role updated to ${newRole}.`)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  // Toggle Active
  const handleToggleActive = async (userId: string, currentActive: boolean) => {
    if (!effectiveToken) return
    setIsWorking(true)
    setError('')
    try {
      const updated = await toggleAdminUserActive(effectiveToken, userId, !currentActive)
      setUsers((prev) => prev.map((u) => (u.userId === updated.userId ? updated : u)))
      setMessage(`User status updated to ${!currentActive ? 'active' : 'inactive'}.`)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  // Invite Extension Officer
  const handleInviteOfficer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!effectiveToken) return
    setIsInviting(true)
    setError('')
    try {
      await inviteOfficer(
        {
          email: inviteEmail.trim(),
          designation: inviteDesignation,
          county: inviteCounty.trim(),
          sub_county: inviteSubCounty.trim() || null,
          ward: inviteWard.trim() || null,
          display_name: inviteDisplayName.trim() || null,
        },
        effectiveToken,
      )
      setMessage(`Invitation sent to ${inviteEmail}. Their officer role activates after password setup.`)
      setShowInviteOfficerModal(false)
      setInviteEmail('')
      setInviteDisplayName('')
      setInviteCounty('')
      setInviteSubCounty('')
      setInviteWard('')
      await refreshData()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsInviting(false)
    }
  }

  const handleInviteAgrodealer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!effectiveToken) return
    setIsInviting(true)
    setError('')
    try {
      await inviteAgrodealer(
        {
          email: inviteDealerEmail.trim(),
          display_name: inviteDealerName.trim(),
          business_name: inviteDealerBusinessName.trim(),
          county: inviteDealerCounty.trim() || null,
          sub_county: inviteDealerSubCounty.trim() || null,
          ward: inviteDealerWard.trim() || null,
        },
        effectiveToken,
      )
      setMessage(
        `Invitation sent to ${inviteDealerEmail}. Their dealer role activates after password setup.`,
      )
      setShowInviteAgrodealerModal(false)
      setInviteDealerEmail('')
      setInviteDealerName('')
      setInviteDealerBusinessName('')
      setInviteDealerCounty('')
      setInviteDealerSubCounty('')
      setInviteDealerWard('')
      await refreshData()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsInviting(false)
    }
  }

  // Invite Agronomist
  const handleInviteAgronomist = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!effectiveToken) return
    setIsInviting(true)
    setError('')
    try {
      await inviteAgronomist(
        {
          email: inviteAgronomistEmail.trim(),
          display_name: inviteAgronomistName.trim(),
          licence_number: inviteAgronomistLicence.trim(),
          county: inviteAgronomistCounty.trim() || undefined,
          approval_status: inviteAgronomistStatus,
        },
        effectiveToken,
      )
      setMessage(
        `Invitation sent to ${inviteAgronomistEmail}. Status: ${inviteAgronomistStatus}. Setup link generated.`,
      )
      setShowInviteAgronomistModal(false)
      setInviteAgronomistEmail('')
      setInviteAgronomistName('')
      setInviteAgronomistLicence('')
      setInviteAgronomistCounty('')
      setInviteAgronomistSubCounty('')
      setInviteAgronomistWard('')
      setInviteAgronomistStatus('pending')
      await refreshData()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsInviting(false)
    }
  }

  // Resend Pending Invitation
  const handleResendInvitation = async (userId: string, userEmail: string) => {
    if (!effectiveToken) return
    setIsWorking(true)
    setError('')
    try {
      const res = await resendInvitation(userId, effectiveToken)
      setMessage(res.message || `Invitation resent to ${userEmail}.`)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  // Cancel Pending Invitation
  const handleCancelInvitation = async (userId: string, userEmail: string) => {
    if (!effectiveToken) return
    setIsWorking(true)
    setError('')
    try {
      const res = await cancelInvitation(userId, effectiveToken)
      setMessage(res.message || `Invitation for ${userEmail} cancelled.`)
      await refreshData()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  // Trigger Day 1-6 Reminders
  const handleTriggerReminders = async () => {
    if (!effectiveToken) return
    setIsProcessingBatch(true)
    setError('')
    try {
      const res = await triggerUnclaimedReminders(effectiveToken)
      setMessage(
        res.message ||
          `Batch completed: ${res.remindersSent} reminder(s) sent (${res.processedCount} processed).`,
      )
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsProcessingBatch(false)
    }
  }

  // Trigger Day 7 Cleanup
  const handleTriggerCleanup = async () => {
    if (!effectiveToken) return
    setIsProcessingBatch(true)
    setError('')
    try {
      const res = await triggerUnclaimedCleanup(effectiveToken)
      setMessage(
        res.message ||
          `Cascade cleanup completed: ${res.expiredAndDeleted} expired unclaimed account(s) safely deleted.`,
      )
      await refreshData()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsProcessingBatch(false)
    }
  }

  // Grant Support Access
  const handleGrantSupportAccess = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!effectiveToken) return
    if (grantReason.trim().length < 10) {
      setError(
        'A comprehensive justification reason (at least 10 characters) is required for break-glass support access.',
      )
      return
    }
    setIsWorking(true)
    setError('')
    try {
      const newGrant = await grantSupportAccess(effectiveToken, {
        targetType: grantTargetType,
        targetId: grantTargetId.trim(),
        reason: grantReason.trim(),
        durationMinutes: grantDurationMinutes,
      })
      setSupportGrants((prev) => [newGrant, ...prev])
      setShowGrantModal(false)
      setGrantTargetId('')
      setGrantReason('')
      setMessage(
        `Break-glass support access granted for ${newGrant.durationMinutes} minutes. Audit logged.`,
      )
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  // View Record under Active Grant
  const handleViewSensitiveRecord = async (grant: SupportAccessGrant) => {
    if (!effectiveToken) return
    setIsViewingRecord(true)
    setError('')
    try {
      const recordData = await viewSensitiveRecord(
        effectiveToken,
        grant.targetType,
        grant.targetId,
        grant.grantId,
      )
      setViewedRecord(recordData)
      // Refresh grant to show incremented accessCount
      setSupportGrants((prev) =>
        prev.map((g) =>
          g.grantId === grant.grantId ? { ...g, accessCount: g.accessCount + 1 } : g,
        ),
      )
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsViewingRecord(false)
    }
  }

  // Revoke Support Grant
  const handleRevokeSupportGrant = async () => {
    if (!selectedGrantForRevoke || !effectiveToken || !grantRevokeReason.trim()) return
    setIsWorking(true)
    setError('')
    try {
      const revoked = await revokeSupportAccess(
        effectiveToken,
        selectedGrantForRevoke.grantId,
        grantRevokeReason.trim(),
      )
      setSupportGrants((prev) =>
        prev.map((g) =>
          g.grantId === revoked.grantId
            ? { ...g, isRevoked: true, revocationReason: revoked.revocationReason }
            : g,
        ),
      )
      setSelectedGrantForRevoke(null)
      setGrantRevokeReason('')
      setMessage('Support grant revoked immediately.')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  // Update Setting
  const handleUpdateSetting = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingSetting || !effectiveToken || !settingEditReason.trim()) return
    setIsWorking(true)
    setError('')
    try {
      let parsedValue: unknown = settingEditValue
      try {
        parsedValue = JSON.parse(settingEditValue)
      } catch {
        // Keep string if not valid JSON
      }
      const updated = await updateAdminSetting(
        effectiveToken,
        editingSetting.key,
        parsedValue,
        settingEditReason.trim(),
      )
      setSettings((prev) => prev.map((s) => (s.key === updated.key ? updated : s)))
      setEditingSetting(null)
      setSettingEditValue('')
      setSettingEditReason('')
      setMessage(`Configuration setting ${updated.key} updated and audit entry recorded.`)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <main
      className="account-workspace admin-workspace"
      aria-label="System Administration Workspace"
    >
      {/* Workspace Header */}
      <header className="workspace-header">
        <div>
          <div className="eyebrow">ADMINISTRATION CONTROL</div>
          <h1>System Admin Workspace</h1>
          <p className="account-summary">
            Authorized oversight, least-privilege role management, operational monitoring, and
            audited break-glass support access.
          </p>
        </div>

        <div className="workspace-header-actions">
          {effectiveToken && (
            <button
              type="button"
              className="danger-button"
              onClick={handleSignOut}
              aria-label="Sign out of admin workspace"
            >
              <LogOut size={16} /> Sign out
            </button>
          )}
        </div>
      </header>

      {/* Auth Banner / Sign-in */}
      {!effectiveToken && (
        <section className="admin-auth-card" aria-label="Administrator Authentication">
          <div className="auth-card-header">
            <Lock size={20} className="icon-warning" />
            <div>
              <h3>Admin Session Required</h3>
              <p>
                Sign in with verified administrator credentials or provide an authorized JWT bearer
                token.
              </p>
            </div>
          </div>

          <form onSubmit={handleSignIn} className="admin-login-form">
            <div className="form-row">
              <label htmlFor="admin-email">Admin Email</label>
              <input
                id="admin-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@soilsync.go.ke"
                required
              />
            </div>
            <div className="form-row">
              <label htmlFor="admin-password">Password</label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            <button type="submit" className="primary-button" disabled={isWorking}>
              {isWorking ? 'Authenticating…' : 'Sign In as Admin'}
            </button>
          </form>

          {import.meta.env.MODE === 'test' && (
            <details className="manual-token-details">
              <summary>Use Direct Session Token (Testing / Verification)</summary>
              <form onSubmit={handleManualTokenSubmit} className="token-form">
                <input
                  type="text"
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  placeholder="Paste Bearer token here"
                  aria-label="Manual bearer token"
                />
                <button type="submit" className="secondary-button">
                  Set Token
                </button>
              </form>
            </details>
          )}
        </section>
      )}

      {/* Status Messages */}
      {error && (
        <div className="admin-alert error" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}
      {message && (
        <div className="admin-alert success" role="status">
          <CheckCircle size={18} />
          <span>{message}</span>
        </div>
      )}

      {/* Main Admin Console Tabs */}
      {effectiveToken && (
        <>
          <nav className="admin-tabs" aria-label="Admin Navigation Tabs">
            <button
              type="button"
              className={`admin-tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              <Activity size={16} /> Overview & Stats
            </button>
            <button
              type="button"
              className={`admin-tab-btn ${activeTab === 'users' ? 'active' : ''}`}
              onClick={() => setActiveTab('users')}
            >
              <Users size={16} /> Accounts & Roles
            </button>
            <button
              type="button"
              className={`admin-tab-btn ${activeTab === 'health' ? 'active' : ''}`}
              onClick={() => setActiveTab('health')}
            >
              <Server size={16} /> Operational Health
            </button>
            <button
              type="button"
              className={`admin-tab-btn ${activeTab === 'support' ? 'active' : ''}`}
              onClick={() => setActiveTab('support')}
            >
              <KeyRound size={16} /> Support Access
            </button>
            <button
              type="button"
              className={`admin-tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
              onClick={() => setActiveTab('settings')}
            >
              <Settings size={16} /> System Settings
            </button>
            <button
              type="button"
              className={`admin-tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
              onClick={() => setActiveTab('audit')}
            >
              <Shield size={16} /> Audit Trail
            </button>
          </nav>

          <div className="admin-content-area">
            {/* TAB 1: OVERVIEW & STATS */}
            {activeTab === 'overview' && (
              <section className="overview-section" aria-label="System Overview and Metrics">
                <div className="section-toolbar">
                  <h2>System Health & Metric Cards</h2>
                  <button
                    type="button"
                    className="secondary-button icon-button"
                    onClick={refreshData}
                    disabled={isLoadingData}
                  >
                    <RefreshCw size={14} className={isLoadingData ? 'spinning' : ''} /> Refresh
                    Queries
                  </button>
                </div>

                {overview ? (
                  <div className="metric-cards-grid">
                    <div className="metric-card">
                      <div className="metric-header">
                        <Users size={20} className="icon-blue" />
                        <span>Registered Users</span>
                      </div>
                      <div className="metric-value">{overview.totalUsers}</div>
                      <div className="metric-subtitle">
                        {overview.activeUsers} active accounts · {overview.pendingApprovals} pending
                        approvals
                      </div>
                    </div>

                    <div className="metric-card">
                      <div className="metric-header">
                        <Database size={20} className="icon-green" />
                        <span>Farms & Readings</span>
                      </div>
                      <div className="metric-value">{overview.totalFarms} Farms</div>
                      <div className="metric-subtitle">
                        {overview.totalSoilReadings} validated soil readings
                      </div>
                    </div>

                    <div className="metric-card">
                      <div className="metric-header">
                        <Activity size={20} className="icon-amber" />
                        <span>Sync Subsystem</span>
                      </div>
                      <div className="metric-value">{overview.syncOverview.pending} Queued</div>
                      <div className="metric-subtitle">
                        {overview.syncOverview.failed} failed · {overview.syncOverview.conflict}{' '}
                        conflicts
                      </div>
                    </div>

                    <div className="metric-card">
                      <div className="metric-header">
                        <ShieldAlert size={20} className="icon-purple" />
                        <span>Support & Alerts</span>
                      </div>
                      <div className="metric-value">{overview.unresolvedAlerts} Alerts</div>
                      <div className="metric-subtitle">
                        {overview.activeSupportGrants} active break-glass grants
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="loading-state">
                    Loading authorized overview metrics from database…
                  </p>
                )}

                {/* Role Breakdown Sub-panel */}
                {overview && (
                  <div className="role-breakdown-panel">
                    <h3>Verified Role Distribution</h3>
                    <div className="roles-chips-grid">
                      <div className="role-chip">
                        <span className="role-chip-name">Farmers</span>
                        <strong>{overview.roleBreakdown.farmers}</strong>
                      </div>
                      <div className="role-chip">
                        <span className="role-chip-name">Extension Officers</span>
                        <strong>{overview.roleBreakdown.extensionOfficers}</strong>
                      </div>
                      <div className="role-chip">
                        <span className="role-chip-name">Agrodealer Outlets</span>
                        <strong>{overview.roleBreakdown.agrodealers}</strong>
                      </div>
                      <div className="role-chip">
                        <span className="role-chip-name">System Admins</span>
                        <strong>{overview.roleBreakdown.admins}</strong>
                      </div>
                    </div>
                  </div>
                )}

                {/* Permissions Badge Strip */}
                {permissions.length > 0 && (
                  <div className="permissions-strip" aria-label="Active Admin Permissions">
                    <span className="strip-title">Active Permissions:</span>
                    {permissions.map((p) => (
                      <span key={p.id} className="permission-badge">
                        <CheckCircle size={12} /> {p.permission}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* TAB 2: ACCOUNTS & ROLES */}
            {activeTab === 'users' && (
              <section className="users-section" aria-label="Audited Account and Role Management">
                <div className="section-toolbar">
                  <h2>Account Lifecycle & Role Governance</h2>
                  <div className="filter-controls">
                    <div className="search-input-wrapper">
                      <Search size={14} />
                      <input
                        type="text"
                        placeholder="Search accounts…"
                        value={userSearchQuery}
                        onChange={(e) => setUserSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && refreshData()}
                      />
                    </div>

                    <select
                      value={userRoleFilter}
                      onChange={(e) => setUserRoleFilter(e.target.value)}
                      aria-label="Filter by role"
                    >
                      <option value="">All Roles</option>
                      <option value="farmer">Farmer</option>
                      <option value="extension_officer">Extension Officer</option>
                      <option value="agrodealer">Agrodealer</option>
                      <option value="agronomist">Agronomist</option>
                      <option value="admin">Admin</option>
                    </select>

                    <select
                      value={userApprovalFilter}
                      onChange={(e) => setUserApprovalFilter(e.target.value)}
                      aria-label="Filter by approval status"
                    >
                      <option value="">All Statuses</option>
                      <option value="approved">Approved</option>
                      <option value="pending">Pending</option>
                      <option value="suspended">Suspended</option>
                      <option value="unclaimed">Unclaimed</option>
                    </select>

                    <button type="button" className="secondary-button" onClick={refreshData}>
                      Filter
                    </button>

                    <button
                      type="button"
                      className="primary-button"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                      onClick={() => setShowInviteOfficerModal(true)}
                    >
                      <UserPlus size={14} />
                      Invite Officer
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                      onClick={() => setShowInviteAgrodealerModal(true)}
                    >
                      <Store size={14} />
                      Invite Agrodealer
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                      onClick={() => setShowInviteAgronomistModal(true)}
                    >
                      <Award size={14} />
                      Invite Agronomist
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                      Unclaimed Account Lifecycle:
                    </span>
                    <button
                      type="button"
                      className="secondary-button"
                      style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                      onClick={handleTriggerReminders}
                      disabled={isProcessingBatch}
                      title="Send automated reminders to officer-registered farmers on days 1-6"
                    >
                      <Clock size={13} /> Trigger Day 1–6 Reminders
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', color: '#c0392b' }}
                      onClick={handleTriggerCleanup}
                      disabled={isProcessingBatch}
                      title="Cascade-delete unverified farmer accounts and their initial farms on day 7"
                    >
                      <Trash2 size={13} /> Trigger Day 7 Cleanup
                    </button>
                  </div>
                </div>

                <div className="table-responsive">
                  <table className="admin-table" aria-label="System Users Table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Role</th>
                        <th>Approval</th>
                        <th>Account</th>
                        <th>Created</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="empty-table-cell">
                            No accounts match the current query criteria.
                          </td>
                        </tr>
                      ) : (
                        users.map((u) => (
                          <tr key={u.userId}>
                            <td>
                              <strong>{u.displayName || 'Unnamed User'}</strong>
                              <span className="cell-subtext">{u.email}</span>
                            </td>
                            <td>
                              <select
                                value={u.role}
                                onChange={(e) =>
                                  executeWithReauth(
                                    `Change role of ${u.email} to ${e.target.value}`,
                                    () => handleRoleChange(u.userId, e.target.value),
                                  )
                                }
                                className="inline-role-select"
                                aria-label={`Role for ${u.email}`}
                              >
                                <option value="farmer">Farmer</option>
                                <option value="extension_officer">Extension Officer</option>
                                <option value="agrodealer">Agrodealer</option>
                                <option value="agronomist">Agronomist</option>
                                <option value="admin">Admin</option>
                              </select>
                            </td>
                            <td>
                              <span className={`status-pill ${u.approvalStatus}`}>
                                {u.approvalStatus}
                              </span>
                              {u.revocationReason && (
                                <span className="reason-hint" title={u.revocationReason}>
                                  Reason: {u.revocationReason}
                                </span>
                              )}
                            </td>
                            <td>
                              <button
                                type="button"
                                className={`toggle-status-btn ${u.isActive ? 'active' : 'inactive'}`}
                                onClick={() => handleToggleActive(u.userId, u.isActive)}
                              >
                                {u.isActive ? 'Active' : 'Disabled'}
                              </button>
                            </td>
                            <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                            <td>
                              <div className="action-buttons-cell">
                                {u.approvalStatus !== 'approved' && (
                                  <button
                                    type="button"
                                    className="approve-btn"
                                    onClick={() => setSelectedUserForApprove(u)}
                                    title="Approve Account"
                                  >
                                    <UserCheck size={14} /> Approve
                                  </button>
                                )}
                                {u.approvalStatus !== 'suspended' && (
                                  <button
                                    type="button"
                                    className="revoke-btn"
                                    onClick={() => setSelectedUserForRevoke(u)}
                                    title="Suspend / Revoke Account"
                                  >
                                    <UserX size={14} /> Suspend
                                  </button>
                                )}
                                {(u.approvalStatus === 'pending' || u.approvalStatus === 'unclaimed') && (
                                  <>
                                    <button
                                      type="button"
                                      className="secondary-button"
                                      style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                                      onClick={() => handleResendInvitation(u.userId, u.email)}
                                      title="Resend invitation email"
                                    >
                                      <Send size={12} /> Resend
                                    </button>
                                    <button
                                      type="button"
                                      className="revoke-btn"
                                      style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                                      onClick={() => handleCancelInvitation(u.userId, u.email)}
                                      title="Cancel pending invitation"
                                    >
                                      <Trash2 size={12} /> Cancel
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Approve User Modal */}
                {selectedUserForApprove && (
                  <div className="modal-backdrop" role="dialog" aria-modal="true">
                    <div className="modal-card">
                      <h3>Approve Account: {selectedUserForApprove.email}</h3>
                      <p>
                        Verify this account for active participation. Extension officers and
                        agrodealers will receive operational access.
                      </p>
                      <div className="form-row">
                        <label htmlFor="approval-notes">
                          Approval Justification Notes (Optional)
                        </label>
                        <input
                          id="approval-notes"
                          type="text"
                          value={approvalNotes}
                          onChange={(e) => setApprovalNotes(e.target.value)}
                          placeholder="e.g. Validated credentials with county agricultural directorate"
                        />
                      </div>
                      <div className="modal-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setSelectedUserForApprove(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() =>
                            executeWithReauth(
                              `Approve ${selectedUserForApprove.email}`,
                              handleApproveUser,
                            )
                          }
                          disabled={isWorking}
                        >
                          {isWorking ? 'Approving…' : 'Confirm Approval'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Revoke / Suspend User Modal */}
                {selectedUserForRevoke && (
                  <div className="modal-backdrop" role="dialog" aria-modal="true">
                    <div className="modal-card">
                      <h3>Suspend Account: {selectedUserForRevoke.email}</h3>
                      <p>
                        Suspension immediately revokes session tokens and stops active operations. A
                        formal justification reason is required.
                      </p>
                      <div className="form-row">
                        <label htmlFor="revoke-reason">Reason for Suspension (Mandatory)</label>
                        <textarea
                          id="revoke-reason"
                          value={revokeReason}
                          onChange={(e) => setRevokeReason(e.target.value)}
                          placeholder="Document the exact breach of terms, regulatory non-compliance, or officer request…"
                          rows={3}
                          required
                        />
                      </div>
                      <div className="form-checkbox-row">
                        <input
                          type="checkbox"
                          id="revoke-role-check"
                          checked={revokeRoleCheck}
                          onChange={(e) => setRevokeRoleCheck(e.target.checked)}
                        />
                        <label htmlFor="revoke-role-check">
                          Demote privileged role back to standard farmer
                        </label>
                      </div>
                      <div className="modal-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setSelectedUserForRevoke(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="danger-button"
                          onClick={() =>
                            executeWithReauth(
                              `Suspend ${selectedUserForRevoke.email}`,
                              handleRevokeUser,
                            )
                          }
                          disabled={isWorking || revokeReason.trim().length < 5}
                        >
                          {isWorking ? 'Suspending…' : 'Suspend Account'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Invite Extension Officer Modal */}
                {showInviteOfficerModal && (
                  <div className="modal-backdrop" role="dialog" aria-modal="true">
                    <div className="modal-card" style={{ maxWidth: '520px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <UserPlus size={20} color="var(--primary, #2d6a4f)" />
                        <h3 style={{ margin: 0 }}>Invite Extension Officer</h3>
                      </div>
                      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                        Officers cannot self-register. Their profile and farmer access are scoped to the assigned
                        jurisdiction; the role activates after they set a password from the email invitation.
                      </p>
                      <form onSubmit={handleInviteOfficer}>
                        <div className="form-row">
                          <label htmlFor="invite-officer-email">Officer Email *</label>
                          <input
                            id="invite-officer-email"
                            type="email"
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            placeholder="officer@agriculture.go.ke"
                            required
                          />
                        </div>

                        <div className="form-row">
                          <label htmlFor="invite-officer-name">Display Name (Optional)</label>
                          <input
                            id="invite-officer-name"
                            type="text"
                            value={inviteDisplayName}
                            onChange={(e) => setInviteDisplayName(e.target.value)}
                            placeholder="e.g. Mary Wambui"
                          />
                        </div>

                        <div className="form-row">
                          <label htmlFor="invite-officer-designation">Designation Level *</label>
                          <select
                            id="invite-officer-designation"
                            value={inviteDesignation}
                            onChange={(e) => setInviteDesignation(e.target.value as 'county' | 'subcounty' | 'ward')}
                          >
                            <option value="ward">Ward Officer (Ward + Sub-County + County)</option>
                            <option value="subcounty">Sub-County Officer (Sub-County + County)</option>
                            <option value="county">County Officer (Entire County)</option>
                          </select>
                        </div>

                        <div className="form-row">
                          <label htmlFor="invite-officer-county">County *</label>
                          <select
                            id="invite-officer-county"
                            value={inviteCounty}
                            onChange={(e) => setInviteCounty(e.target.value)}
                            required
                          >
                            <option value="">Select County…</option>
                            {KENYA_COUNTIES.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </div>

                        {inviteDesignation !== 'county' && (
                          <div className="form-row">
                            <label htmlFor="invite-officer-subcounty">Sub-County *</label>
                            <input
                              id="invite-officer-subcounty"
                              type="text"
                              value={inviteSubCounty}
                              onChange={(e) => setInviteSubCounty(e.target.value)}
                              placeholder="e.g. Njoro"
                              required
                            />
                          </div>
                        )}

                        {inviteDesignation === 'ward' && (
                          <div className="form-row">
                            <label htmlFor="invite-officer-ward">Ward *</label>
                            <input
                              id="invite-officer-ward"
                              type="text"
                              value={inviteWard}
                              onChange={(e) => setInviteWard(e.target.value)}
                              placeholder="e.g. Mau Narok"
                              required
                            />
                          </div>
                        )}

                        <div className="modal-actions" style={{ marginTop: '1rem' }}>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => setShowInviteOfficerModal(false)}
                            disabled={isInviting}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="primary-button"
                            disabled={isInviting || !inviteEmail.trim() || !inviteCounty.trim()}
                          >
                            {isInviting ? 'Inviting…' : 'Send Invitation'}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}

                {showInviteAgrodealerModal && (
                  <div className="modal-backdrop" role="dialog" aria-modal="true">
                    <div className="modal-card" style={{ maxWidth: '520px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <Store size={20} color="var(--primary, #2d6a4f)" />
                        <h3 style={{ margin: 0 }}>Invite Agrodealer</h3>
                      </div>
                      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                        The dealer receives a secure setup link, chooses a password, then manages their profile,
                        products, and stock in the dealer workspace.
                      </p>
                      <form onSubmit={handleInviteAgrodealer}>
                        <div className="form-row">
                          <label htmlFor="invite-dealer-email">Email *</label>
                          <input
                            id="invite-dealer-email"
                            type="email"
                            value={inviteDealerEmail}
                            onChange={(event) => setInviteDealerEmail(event.target.value)}
                            required
                          />
                        </div>
                        <div className="form-row">
                          <label htmlFor="invite-dealer-contact">Contact Name *</label>
                          <input
                            id="invite-dealer-contact"
                            type="text"
                            value={inviteDealerName}
                            onChange={(event) => setInviteDealerName(event.target.value)}
                            required
                          />
                        </div>
                        <div className="form-row">
                          <label htmlFor="invite-dealer-business">Business Name *</label>
                          <input
                            id="invite-dealer-business"
                            type="text"
                            value={inviteDealerBusinessName}
                            onChange={(event) => setInviteDealerBusinessName(event.target.value)}
                            required
                          />
                        </div>
                        <div className="form-row">
                          <label htmlFor="invite-dealer-county">County (optional)</label>
                          <select
                            id="invite-dealer-county"
                            value={inviteDealerCounty}
                            onChange={(event) => setInviteDealerCounty(event.target.value)}
                          >
                            <option value="">Select County…</option>
                            {KENYA_COUNTIES.map((county) => (
                              <option key={county} value={county}>{county}</option>
                            ))}
                          </select>
                        </div>
                        <div className="form-row">
                          <label htmlFor="invite-dealer-subcounty">Sub-County (optional)</label>
                          <input
                            id="invite-dealer-subcounty"
                            type="text"
                            value={inviteDealerSubCounty}
                            onChange={(event) => setInviteDealerSubCounty(event.target.value)}
                          />
                        </div>
                        <div className="form-row">
                          <label htmlFor="invite-dealer-ward">Ward (optional)</label>
                          <input
                            id="invite-dealer-ward"
                            type="text"
                            value={inviteDealerWard}
                            onChange={(event) => setInviteDealerWard(event.target.value)}
                          />
                        </div>
                        <div className="modal-actions" style={{ marginTop: '1rem' }}>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => setShowInviteAgrodealerModal(false)}
                            disabled={isInviting}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="primary-button"
                            disabled={
                              isInviting ||
                              !inviteDealerEmail.trim() ||
                              !inviteDealerName.trim() ||
                              !inviteDealerBusinessName.trim()
                            }
                          >
                            {isInviting ? 'Inviting…' : 'Send Invitation'}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}

                {showInviteAgronomistModal && (
                  <div className="modal-backdrop" role="dialog" aria-modal="true">
                    <div className="modal-card" style={{ maxWidth: '520px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <Award size={20} color="var(--primary, #2d6a4f)" />
                        <h3 style={{ margin: 0 }}>Invite Agronomist</h3>
                      </div>
                      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                        Provision a licensed agronomist. The agronomist receives a secure setup link.
                        Unapproved agronomists remain blocked from review actions until approved.
                      </p>
                      <form onSubmit={handleInviteAgronomist}>
                        <div className="form-row">
                          <label htmlFor="invite-agronomist-email">Email *</label>
                          <input
                            id="invite-agronomist-email"
                            type="email"
                            value={inviteAgronomistEmail}
                            onChange={(e) => setInviteAgronomistEmail(e.target.value)}
                            placeholder="agronomist@example.com"
                            required
                          />
                        </div>
                        <div className="form-row">
                          <label htmlFor="invite-agronomist-name">Full Name *</label>
                          <input
                            id="invite-agronomist-name"
                            type="text"
                            value={inviteAgronomistName}
                            onChange={(e) => setInviteAgronomistName(e.target.value)}
                            placeholder="e.g. Dr. Peter Kamau"
                            required
                          />
                        </div>
                        <div className="form-row">
                          <label htmlFor="invite-agronomist-licence">Licence / Registration Number *</label>
                          <input
                            id="invite-agronomist-licence"
                            type="text"
                            value={inviteAgronomistLicence}
                            onChange={(e) => setInviteAgronomistLicence(e.target.value)}
                            placeholder="e.g. AGR-KE-2024-889"
                            required
                          />
                        </div>
                        <div className="form-row">
                          <label htmlFor="invite-agronomist-status">Initial Approval Status</label>
                          <select
                            id="invite-agronomist-status"
                            value={inviteAgronomistStatus}
                            onChange={(e) => setInviteAgronomistStatus(e.target.value as 'pending' | 'approved')}
                          >
                            <option value="pending">Pending Approval (Awaiting Verification)</option>
                            <option value="approved">Pre-Approved (Immediate Active Access)</option>
                          </select>
                        </div>
                        <div className="form-row">
                          <label htmlFor="invite-agronomist-county">County of Practice</label>
                          <select
                            id="invite-agronomist-county"
                            value={inviteAgronomistCounty}
                            onChange={(e) => setInviteAgronomistCounty(e.target.value)}
                          >
                            <option value="">Select County (Optional)…</option>
                            {KENYA_COUNTIES.map((county) => (
                              <option key={county} value={county}>{county}</option>
                            ))}
                          </select>
                        </div>
                        <div className="form-row">
                          <label htmlFor="invite-agronomist-subcounty">Sub-County (optional)</label>
                          <input
                            id="invite-agronomist-subcounty"
                            type="text"
                            value={inviteAgronomistSubCounty}
                            onChange={(e) => setInviteAgronomistSubCounty(e.target.value)}
                            placeholder="e.g. Njoro"
                          />
                        </div>
                        <div className="form-row">
                          <label htmlFor="invite-agronomist-ward">Ward (optional)</label>
                          <input
                            id="invite-agronomist-ward"
                            type="text"
                            value={inviteAgronomistWard}
                            onChange={(e) => setInviteAgronomistWard(e.target.value)}
                            placeholder="e.g. Mau Narok"
                          />
                        </div>
                        <div className="modal-actions" style={{ marginTop: '1rem' }}>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => setShowInviteAgronomistModal(false)}
                            disabled={isInviting}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="primary-button"
                            disabled={
                              isInviting ||
                              !inviteAgronomistEmail.trim() ||
                              !inviteAgronomistName.trim() ||
                              !inviteAgronomistLicence.trim()
                            }
                          >
                            {isInviting ? 'Inviting…' : 'Send Invitation'}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* TAB 3: OPERATIONAL HEALTH */}
            {activeTab === 'health' && (
              <section
                className="health-section"
                aria-label="Operational Health and Provider Monitoring"
              >
                <div className="section-toolbar">
                  <h2>Operational Health & Ingestion Pipeline</h2>
                  <button
                    type="button"
                    className="secondary-button icon-button"
                    onClick={refreshData}
                    disabled={isLoadingData}
                  >
                    <RefreshCw size={14} className={isLoadingData ? 'spinning' : ''} /> Check Status
                  </button>
                </div>

                {health ? (
                  <>
                    <div className="health-cards-grid">
                      <div className="health-card">
                        <div className="health-card-header">
                          <Database size={18} className="icon-green" />
                          <span>Primary Database</span>
                        </div>
                        <div className="health-status-row">
                          <span className="status-badge operational">Connected</span>
                          <strong>{health.database.engine}</strong>
                        </div>
                        <p className="health-meta">Pool Status: {health.database.poolStatus}</p>
                      </div>

                      <div className="health-card">
                        <div className="health-card-header">
                          <Activity size={18} className="icon-blue" />
                          <span>Sync Subsystem</span>
                        </div>
                        <div className="health-status-row">
                          <span className="status-badge operational">Healthy</span>
                          <span>
                            {health.syncSubsystem.failedDraftsCount} Failed ·{' '}
                            {health.syncSubsystem.conflictDraftsCount} Conflicts
                          </span>
                        </div>
                        <p className="health-privacy-note">
                          {health.syncSubsystem.privacySafeguard}
                        </p>
                      </div>
                    </div>

                    {/* External Providers */}
                    <div className="providers-panel">
                      <h3>Integrated Provider Status</h3>
                      <div className="providers-grid">
                        {health.externalProviders.map((p) => (
                          <div key={p.provider} className="provider-card">
                            <div className="provider-header">
                              <strong>{p.label}</strong>
                              <span className="provider-status-pill">{p.status}</span>
                            </div>
                            <p>{p.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Dataset Ingestion Batches */}
                    <div className="batches-panel">
                      <h3>Dataset Ingestion Batches (source_import_batches)</h3>
                      <div className="table-responsive">
                        <table className="admin-table batches-table">
                          <thead>
                            <tr>
                              <th>Batch / Dataset</th>
                              <th>File</th>
                              <th>Status</th>
                              <th>Rows Read</th>
                              <th>Imported</th>
                              <th>Rejected</th>
                              <th>Started</th>
                            </tr>
                          </thead>
                          <tbody>
                            {health.importBatches.length === 0 ? (
                              <tr>
                                <td colSpan={7} className="empty-table-cell">
                                  No import batches recorded.
                                </td>
                              </tr>
                            ) : (
                              health.importBatches.map((b) => (
                                <tr key={b.batchId}>
                                  <td>
                                    <strong>{b.datasetTitle}</strong>
                                    <span className="cell-subtext">{b.datasetKey}</span>
                                  </td>
                                  <td>{b.fileName}</td>
                                  <td>
                                    <span className={`status-pill ${b.status}`}>{b.status}</span>
                                  </td>
                                  <td>{b.rowsRead}</td>
                                  <td className="highlight-green">{b.rowsImported}</td>
                                  <td className={b.rowsRejected > 0 ? 'highlight-red' : ''}>
                                    {b.rowsRejected}
                                  </td>
                                  <td>{new Date(b.startedAt).toLocaleString()}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="loading-state">Querying operational subsystems…</p>
                )}
              </section>
            )}

            {/* TAB 4: SUPPORT ACCESS (BREAK-GLASS) */}
            {activeTab === 'support' && (
              <section
                className="support-section"
                aria-label="Time-Limited Support Access Protocol"
              >
                <div className="break-glass-warning">
                  <ShieldAlert size={24} className="icon-warning" />
                  <div>
                    <h3>Break-Glass Support Protocol</h3>
                    <p>
                      Access to sensitive farmer records, soil readings, and dealer orders is
                      strictly time-limited and scoped. Every view action is cryptographically tied
                      to your identity and permanently audited.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => setShowGrantModal(true)}
                  >
                    + Request Support Access
                  </button>
                </div>

                <h3>Active & Recent Support Grants</h3>
                <div className="table-responsive">
                  <table className="admin-table support-table">
                    <thead>
                      <tr>
                        <th>Target</th>
                        <th>Authorized Admin</th>
                        <th>Justification Reason</th>
                        <th>Expires</th>
                        <th>Access Count</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {supportGrants.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="empty-table-cell">
                            No break-glass support access grants currently active.
                          </td>
                        </tr>
                      ) : (
                        supportGrants.map((g) => {
                          const isExpired = new Date(g.expiresAt).getTime() < currentTime
                          const isActive = !g.isRevoked && !isExpired

                          return (
                            <tr key={g.grantId}>
                              <td>
                                <strong>{g.targetType.toUpperCase()}</strong>
                                <span className="cell-subtext">{g.targetId}</span>
                              </td>
                              <td>{g.adminName || g.adminEmail || g.adminUserId}</td>
                              <td className="reason-cell">{g.reason}</td>
                              <td>
                                {new Date(g.expiresAt).toLocaleTimeString()}
                                <span className="cell-subtext">
                                  {isExpired ? '(Expired)' : `${g.durationMinutes}m window`}
                                </span>
                              </td>
                              <td>{g.accessCount} views</td>
                              <td>
                                <span
                                  className={`status-pill ${
                                    g.isRevoked ? 'suspended' : isExpired ? 'expired' : 'approved'
                                  }`}
                                >
                                  {g.isRevoked ? 'Revoked' : isExpired ? 'Expired' : 'Active'}
                                </span>
                              </td>
                              <td>
                                <div className="action-buttons-cell">
                                  {isActive && (
                                    <>
                                      <button
                                        type="button"
                                        className="view-record-btn"
                                        onClick={() => handleViewSensitiveRecord(g)}
                                        disabled={isViewingRecord}
                                      >
                                        <Eye size={14} /> View Record
                                      </button>
                                      <button
                                        type="button"
                                        className="revoke-grant-btn"
                                        onClick={() => setSelectedGrantForRevoke(g)}
                                      >
                                        <XCircle size={14} /> Revoke
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Request Support Grant Modal */}
                {showGrantModal && (
                  <div className="modal-backdrop" role="dialog" aria-modal="true">
                    <div className="modal-card">
                      <h3>Request Break-Glass Support Access</h3>
                      <p>
                        Specify the target entity and provide a mandatory technical/support
                        justification.
                      </p>

                      <form onSubmit={handleGrantSupportAccess}>
                        <div className="form-row">
                          <label htmlFor="grant-target-type">Target Type</label>
                          <select
                            id="grant-target-type"
                            value={grantTargetType}
                            onChange={(e) =>
                              setGrantTargetType(e.target.value as SupportGrantTarget)
                            }
                          >
                            <option value="farm">Farm Record</option>
                            <option value="reading">Soil Reading</option>
                            <option value="farmer_profile">Farmer Profile</option>
                            <option value="agrodealer_order">Agrodealer Order</option>
                          </select>
                        </div>

                        <div className="form-row">
                          <label htmlFor="grant-target-id">Target ID (UUID)</label>
                          <input
                            id="grant-target-id"
                            type="text"
                            value={grantTargetId}
                            onChange={(e) => setGrantTargetId(e.target.value)}
                            placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                            required
                          />
                        </div>

                        <div className="form-row">
                          <label htmlFor="grant-duration">Access Window Duration</label>
                          <select
                            id="grant-duration"
                            value={grantDurationMinutes}
                            onChange={(e) => setGrantDurationMinutes(Number(e.target.value))}
                          >
                            <option value={15}>15 Minutes</option>
                            <option value={30}>30 Minutes (Standard)</option>
                            <option value={60}>60 Minutes (Complex Case)</option>
                            <option value={120}>120 Minutes (Maximum)</option>
                          </select>
                        </div>

                        <div className="form-row">
                          <label htmlFor="grant-reason">Justification Reason (Min. 10 chars)</label>
                          <textarea
                            id="grant-reason"
                            value={grantReason}
                            onChange={(e) => setGrantReason(e.target.value)}
                            placeholder="Describe customer inquiry, support ticket reference, or error investigation details…"
                            rows={3}
                            required
                          />
                        </div>

                        <div className="modal-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => setShowGrantModal(false)}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="primary-button"
                            disabled={
                              isWorking || !grantTargetId.trim() || grantReason.trim().length < 10
                            }
                          >
                            {isWorking ? 'Authorizing…' : 'Authorize Support Grant'}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}

                {/* Revoke Grant Modal */}
                {selectedGrantForRevoke && (
                  <div className="modal-backdrop" role="dialog" aria-modal="true">
                    <div className="modal-card">
                      <h3>Revoke Support Access Grant</h3>
                      <p>Terminates support access immediately.</p>
                      <div className="form-row">
                        <label htmlFor="grant-revoke-reason">Revocation Reason</label>
                        <input
                          id="grant-revoke-reason"
                          type="text"
                          value={grantRevokeReason}
                          onChange={(e) => setGrantRevokeReason(e.target.value)}
                          placeholder="e.g. Ticket resolved / analysis finished"
                          required
                        />
                      </div>
                      <div className="modal-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setSelectedGrantForRevoke(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="danger-button"
                          onClick={handleRevokeSupportGrant}
                          disabled={isWorking || !grantRevokeReason.trim()}
                        >
                          {isWorking ? 'Revoking…' : 'Revoke Grant'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Record Viewer Modal */}
                {viewedRecord && (
                  <div className="modal-backdrop" role="dialog" aria-modal="true">
                    <div className="modal-card record-viewer-modal">
                      <div className="modal-header-with-badge">
                        <h3>Sensitive Record Inspection</h3>
                        <span className="status-pill approved">Access Logged</span>
                      </div>
                      <p className="record-meta">
                        Target: {viewedRecord.targetType.toUpperCase()} ({viewedRecord.targetId}) ·
                        Viewed At: {new Date(viewedRecord.accessedAt).toLocaleTimeString()}
                      </p>

                      <div className="record-payload-viewer">
                        <pre>{JSON.stringify(viewedRecord.record, null, 2)}</pre>
                      </div>

                      <div className="modal-actions">
                        <button
                          type="button"
                          className="primary-button"
                          onClick={() => setViewedRecord(null)}
                        >
                          Close Record
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* TAB 5: SYSTEM SETTINGS */}
            {activeTab === 'settings' && (
              <section className="settings-section" aria-label="System Settings Configuration">
                <div className="section-toolbar">
                  <h2>System Configuration & Parameters</h2>
                  <button
                    type="button"
                    className="secondary-button icon-button"
                    onClick={refreshData}
                    disabled={isLoadingData}
                  >
                    <RefreshCw size={14} className={isLoadingData ? 'spinning' : ''} /> Reload
                  </button>
                </div>

                <div className="settings-grid">
                  {settings.map((s) => (
                    <div key={s.key} className="setting-card">
                      <div className="setting-header">
                        <div className="setting-title-wrap">
                          <strong>{s.key}</strong>
                          <span className="category-pill">{s.category}</span>
                        </div>
                        {s.isReadOnly ? (
                          <span className="status-pill suspended">Read-Only</span>
                        ) : (
                          <button
                            type="button"
                            className="edit-setting-btn"
                            onClick={() => {
                              setEditingSetting(s)
                              setSettingEditValue(
                                typeof s.value === 'object'
                                  ? JSON.stringify(s.value)
                                  : String(s.value),
                              )
                            }}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                      <p className="setting-description">{s.description}</p>
                      <div className="setting-value-display">
                        <code>{JSON.stringify(s.value)}</code>
                      </div>
                      <span className="setting-updated">
                        Updated {new Date(s.updatedAt).toLocaleDateString()}
                        {s.updatedByName && ` by ${s.updatedByName}`}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Edit Setting Modal */}
                {editingSetting && (
                  <div className="modal-backdrop" role="dialog" aria-modal="true">
                    <div className="modal-card">
                      <h3>Update Setting: {editingSetting.key}</h3>
                      <p>{editingSetting.description}</p>

                      <form onSubmit={handleUpdateSetting}>
                        <div className="form-row">
                          <label htmlFor="setting-val">Parameter Value (JSON or Primitive)</label>
                          <input
                            id="setting-val"
                            type="text"
                            value={settingEditValue}
                            onChange={(e) => setSettingEditValue(e.target.value)}
                            required
                          />
                        </div>

                        <div className="form-row">
                          <label htmlFor="setting-reason">Change Justification (Audited)</label>
                          <input
                            id="setting-reason"
                            type="text"
                            value={settingEditReason}
                            onChange={(e) => setSettingEditReason(e.target.value)}
                            placeholder="e.g. Adjust batch size for seasonal planting rush"
                            required
                          />
                        </div>

                        <div className="modal-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => setEditingSetting(null)}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="primary-button"
                            disabled={isWorking || !settingEditReason.trim()}
                          >
                            {isWorking ? 'Saving…' : 'Save & Audit'}
                          </button>
                        </div>
                      </form>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* TAB 6: AUDIT TRAIL */}
            {activeTab === 'audit' && (
              <section className="audit-section" aria-label="Immutable Audit Trail">
                <div className="section-toolbar">
                  <h2>Privileged Actions Audit Log</h2>
                  <button
                    type="button"
                    className="secondary-button icon-button"
                    onClick={refreshData}
                    disabled={isLoadingData}
                  >
                    <RefreshCw size={14} className={isLoadingData ? 'spinning' : ''} /> Refresh Log
                  </button>
                </div>

                <div className="table-responsive">
                  <table className="admin-table audit-table">
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Action</th>
                        <th>Target</th>
                        <th>Details</th>
                        <th>Actor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="empty-table-cell">
                            No audit log entries recorded.
                          </td>
                        </tr>
                      ) : (
                        auditLogs.map((log) => (
                          <tr key={log.id}>
                            <td>{new Date(log.createdAt).toLocaleString()}</td>
                            <td>
                              <span className="action-pill">{log.action}</span>
                            </td>
                            <td>
                              <strong>{log.targetType || 'System'}</strong>
                              {log.targetId && <span className="cell-subtext">{log.targetId}</span>}
                            </td>
                            <td>
                              <code className="audit-detail-json">
                                {JSON.stringify(log.detail)}
                              </code>
                            </td>
                            <td>
                              <span>{log.actorRole}</span>
                              <span className="cell-subtext">{log.actorUserId}</span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        </>
      )}

      {/* Sensitive Action Re-Authentication Modal */}
      {pendingSensitiveAction && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reauth-modal-title"
          data-testid="reauth-modal"
        >
          <div className="modal-card" style={{ maxWidth: '480px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <ShieldAlert size={22} color="#dc2626" />
              <h3 id="reauth-modal-title" style={{ margin: 0 }}>Security Verification Required</h3>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary, #64748b)', marginBottom: '1rem' }}>
              You are performing a sensitive administrative action: <strong>{pendingSensitiveAction.title}</strong>.
              Please confirm your identity by re-entering your administrator password.
            </p>

            {reauthError && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.75rem',
                  borderRadius: '6px',
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#991b1b',
                  fontSize: '0.875rem',
                  marginBottom: '1rem',
                }}
                role="alert"
              >
                <AlertTriangle size={16} />
                <span>{reauthError}</span>
              </div>
            )}

            <form onSubmit={handleReauthSubmit}>
              <div className="form-row">
                <label htmlFor="reauth-admin-password">Administrator Password *</label>
                <input
                  id="reauth-admin-password"
                  name="reauthPassword"
                  type="password"
                  value={reauthPassword}
                  onChange={(e) => setReauthPassword(e.target.value)}
                  placeholder="Enter your current password"
                  required
                  autoFocus
                />
              </div>

              <div className="modal-actions" style={{ marginTop: '1.25rem' }}>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setPendingSensitiveAction(null)
                    setReauthPassword('')
                    setReauthError('')
                  }}
                  disabled={isReauthenticating}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={isReauthenticating || !reauthPassword.trim()}
                >
                  {isReauthenticating ? 'Verifying…' : 'Confirm & Proceed'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  )
}
