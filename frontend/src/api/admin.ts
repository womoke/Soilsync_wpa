export type AdminOverview = {
  totalUsers: number
  activeUsers: number
  pendingApprovals: number
  roleBreakdown: {
    farmers: number
    extensionOfficers: number
    agrodealers: number
    admins: number
  }
  totalFarms: number
  totalSoilReadings: number
  syncOverview: {
    pending: number
    draft: number
    failed: number
    conflict: number
  }
  unresolvedAlerts: number
  activeSupportGrants: number
}

export type AdminUser = {
  userId: string
  authUserId?: string | null
  displayName: string | null
  email: string
  phone: string | null
  role: 'farmer' | 'extension_officer' | 'agrodealer' | 'admin' | 'agronomist'
  isActive: boolean
  approvalStatus: 'pending' | 'approved' | 'rejected' | 'suspended' | 'unclaimed'
  approvedAt: string | null
  revocationReason: string | null
  suspendedAt: string | null
  createdAt: string
}

export type OperationalHealth = {
  status: string
  checkedAt: string
  database: {
    status: string
    engine: string
    poolStatus: string
  }
  syncSubsystem: {
    failedDraftsCount: number
    conflictDraftsCount: number
    privacySafeguard: string
  }
  importBatches: Array<{
    batchId: string
    datasetKey: string
    datasetTitle: string
    fileName: string
    status: string
    rowsRead: number
    rowsImported: number
    rowsRejected: number
    startedAt: string
    completedAt: string | null
  }>
  externalProviders: Array<{
    provider: string
    label: string
    status: string
    description: string
  }>
}

export type SupportAccessGrant = {
  grantId: string
  adminUserId: string
  adminName?: string
  adminEmail?: string
  targetType: 'farm' | 'reading' | 'farmer_profile' | 'agrodealer_order'
  targetId: string
  reason: string
  durationMinutes: number
  expiresAt: string
  isRevoked: boolean
  revokedAt?: string | null
  revocationReason?: string | null
  accessCount: number
  lastAccessedAt?: string | null
  createdAt: string
}

export type SensitiveRecordAccess = {
  grantId: string
  targetType: string
  targetId: string
  accessReason: string
  accessedAt: string
  record: Record<string, unknown>
}

export type SystemSetting = {
  settingId: string
  key: string
  value: unknown
  category: 'security' | 'sync' | 'recommendations' | 'notifications' | 'general'
  description: string
  isReadOnly: boolean
  updatedByName?: string | null
  updatedAt: string
}

export type AdminAuditEntry = {
  id: string
  actorUserId: string
  actorRole: string
  action: string
  targetType: string | null
  targetId: string | null
  detail: Record<string, unknown>
  ipAddress: string | null
  createdAt: string
}

export type AdminPermission = {
  id: string
  permission: string
  expiresAt: string | null
  isActive: boolean
}

async function getResponseErrorMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null)
  if (body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string') {
    return body.detail
  }
  return `${fallback} (HTTP ${response.status})`
}

export async function getAdminOverview(
  token: string,
  signal?: AbortSignal,
): Promise<AdminOverview> {
  const res = await fetch('/api/v1/admin/overview', {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
  if (!res.ok) throw new Error(`Failed to load system overview (HTTP ${res.status})`)
  return res.json()
}

export async function getAdminUsers(
  token: string,
  filters?: { role?: string; approvalStatus?: string; search?: string },
  signal?: AbortSignal,
): Promise<AdminUser[]> {
  const params = new URLSearchParams()
  if (filters?.role) params.append('role', filters.role)
  if (filters?.approvalStatus) params.append('approval_status', filters.approvalStatus)
  if (filters?.search) params.append('search', filters.search)

  const url = `/api/v1/admin/users${params.toString() ? `?${params.toString()}` : ''}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
  if (!res.ok) throw new Error(await getResponseErrorMessage(res, 'Failed to load system users'))
  return res.json()
}

export async function approveAdminUser(
  token: string,
  userId: string,
  notes?: string,
): Promise<AdminUser> {
  const res = await fetch(`/api/v1/admin/users/${userId}/approve`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ notes: notes || null }),
  })
  if (!res.ok) throw new Error(`Failed to approve user account (HTTP ${res.status})`)
  return res.json()
}

export async function revokeAdminUser(
  token: string,
  userId: string,
  reason: string,
  revokeRole: boolean = false,
): Promise<AdminUser> {
  const res = await fetch(`/api/v1/admin/users/${userId}/revoke`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ reason, revokeRole }),
  })
  if (!res.ok) throw new Error(`Failed to revoke user account (HTTP ${res.status})`)
  return res.json()
}

export async function updateAdminUserRole(
  token: string,
  userId: string,
  role: string,
): Promise<AdminUser> {
  const res = await fetch(`/api/v1/admin/users/${userId}/role`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role }),
  })
  if (!res.ok) throw new Error(`Failed to update user role (HTTP ${res.status})`)
  return res.json()
}

export async function toggleAdminUserActive(
  token: string,
  userId: string,
  isActive: boolean,
): Promise<AdminUser> {
  const res = await fetch(`/api/v1/admin/users/${userId}/active`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ isActive }),
  })
  if (!res.ok) throw new Error(`Failed to toggle user status (HTTP ${res.status})`)
  return res.json()
}

export async function getAdminOperationalHealth(
  token: string,
  signal?: AbortSignal,
): Promise<OperationalHealth> {
  const res = await fetch('/api/v1/admin/operational-health', {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
  if (!res.ok) throw new Error(`Failed to load operational health (HTTP ${res.status})`)
  return res.json()
}

export async function getSupportAccessGrants(
  token: string,
  activeOnly: boolean = false,
  signal?: AbortSignal,
): Promise<SupportAccessGrant[]> {
  const url = `/api/v1/admin/support-access/grants${activeOnly ? '?active_only=true' : ''}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
  if (!res.ok) throw new Error(`Failed to load support access grants (HTTP ${res.status})`)
  return res.json()
}

export async function grantSupportAccess(
  token: string,
  payload: {
    targetType: 'farm' | 'reading' | 'farmer_profile' | 'agrodealer_order'
    targetId: string
    reason: string
    durationMinutes?: number
  },
): Promise<SupportAccessGrant> {
  const res = await fetch('/api/v1/admin/support-access/grants', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      targetType: payload.targetType,
      targetId: payload.targetId,
      reason: payload.reason,
      durationMinutes: payload.durationMinutes ?? 30,
    }),
  })
  if (!res.ok) throw new Error(`Failed to grant support access (HTTP ${res.status})`)
  return res.json()
}

export async function revokeSupportAccess(
  token: string,
  grantId: string,
  reason: string,
): Promise<SupportAccessGrant> {
  const res = await fetch(`/api/v1/admin/support-access/grants/${grantId}/revoke`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ revocationReason: reason }),
  })
  if (!res.ok) throw new Error(`Failed to revoke support access (HTTP ${res.status})`)
  return res.json()
}

export async function viewSensitiveRecord(
  token: string,
  targetType: string,
  targetId: string,
  grantId?: string,
): Promise<SensitiveRecordAccess> {
  const url = `/api/v1/admin/support-access/records/${targetType}/${targetId}${
    grantId ? `?grant_id=${grantId}` : ''
  }`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error('Access denied: Valid active support grant required')
    }
    throw new Error(`Failed to access record (HTTP ${res.status})`)
  }
  return res.json()
}

export async function getAdminSettings(
  token: string,
  signal?: AbortSignal,
): Promise<SystemSetting[]> {
  const res = await fetch('/api/v1/admin/settings', {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
  if (!res.ok) throw new Error(`Failed to load system settings (HTTP ${res.status})`)
  return res.json()
}

export async function updateAdminSetting(
  token: string,
  key: string,
  value: unknown,
  changeReason: string,
): Promise<SystemSetting> {
  const res = await fetch(`/api/v1/admin/settings/${key}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ value, changeReason }),
  })
  if (!res.ok) throw new Error(`Failed to update system setting (HTTP ${res.status})`)
  return res.json()
}

export async function getAdminAuditLog(
  token: string,
  limit: number = 50,
  signal?: AbortSignal,
): Promise<AdminAuditEntry[]> {
  const res = await fetch(`/api/v1/admin/audit-log?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
  if (!res.ok) throw new Error(`Failed to load audit log (HTTP ${res.status})`)
  return res.json()
}

export async function getAdminPermissions(
  token: string,
  signal?: AbortSignal,
): Promise<AdminPermission[]> {
  const res = await fetch('/api/v1/admin/permissions', {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })
  if (!res.ok) throw new Error(`Failed to load admin permissions (HTTP ${res.status})`)
  return res.json()
}

export interface InviteOfficerPayload {
  email: string
  designation: 'county' | 'subcounty' | 'ward'
  county: string
  sub_county?: string | null
  ward?: string | null
  display_name?: string | null
}

export interface InviteOfficerResponse {
  officerUserId: string
  assignmentId: string
  email: string
  designation: string
  county: string
  subCounty: string | null
  ward: string | null
  role: string
  status: string
  invitedAt: string
}

export async function inviteOfficer(
  payload: InviteOfficerPayload,
  token: string,
  signal?: AbortSignal,
): Promise<InviteOfficerResponse> {
  const res = await fetch('/api/v1/admin/officers/invite', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      email: payload.email,
      designation: payload.designation,
      county: payload.county,
      subCounty: payload.sub_county,
      ward: payload.ward,
      displayName: payload.display_name,
    }),
    signal,
  })
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}))
    throw new Error(errorBody.detail || `Failed to invite extension officer (HTTP ${res.status})`)
  }
  return res.json()
}

export interface InviteAgrodealerPayload {
  email: string
  display_name: string
  business_name: string
  county?: string | null
  sub_county?: string | null
  ward?: string | null
}

export interface InviteAgrodealerResponse {
  dealerUserId: string
  email: string
  businessName: string
  role: 'agrodealer'
  status: 'pending'
  invitedAt: string
}

export async function inviteAgrodealer(
  payload: InviteAgrodealerPayload,
  token: string,
  signal?: AbortSignal,
): Promise<InviteAgrodealerResponse> {
  const res = await fetch('/api/v1/admin/agrodealer/invite', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      email: payload.email,
      displayName: payload.display_name,
      businessName: payload.business_name,
      county: payload.county,
      subCounty: payload.sub_county,
      ward: payload.ward,
    }),
    signal,
  })
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}))
    throw new Error(errorBody.detail || `Failed to invite agrodealer (HTTP ${res.status})`)
  }
  return res.json()
}

export interface InviteAgronomistPayload {
  email: string
  display_name: string
  licence_number: string
  county?: string | null
  approval_status?: 'pending' | 'approved'
}

export interface InviteAgronomistResponse {
  agronomistUserId: string
  email: string
  licenceNumber: string
  county: string
  role: 'agronomist'
  status: 'pending'
  approvalStatus: string
  invitedAt: string
}

export async function inviteAgronomist(
  payload: InviteAgronomistPayload,
  token: string,
  signal?: AbortSignal,
): Promise<InviteAgronomistResponse> {
  const res = await fetch('/api/v1/admin/agronomists/invite', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      email: payload.email,
      displayName: payload.display_name,
      licenceNumber: payload.licence_number,
      county: payload.county,
      approvalStatus: payload.approval_status || 'pending',
    }),
    signal,
  })
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}))
    throw new Error(errorBody.detail || `Failed to invite agronomist (HTTP ${res.status})`)
  }
  return res.json()
}

export async function updateAgronomistApproval(
  agronomistId: string,
  approvalStatus: 'approved' | 'rejected' | 'suspended',
  notes: string | undefined,
  token: string,
  signal?: AbortSignal,
): Promise<{ agronomistUserId: string; approvalStatus: string; updatedAt: string }> {
  const res = await fetch(`/api/v1/admin/agronomists/${agronomistId}/approval`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ approvalStatus, notes }),
    signal,
  })
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}))
    throw new Error(errorBody.detail || `Failed to update agronomist approval (HTTP ${res.status})`)
  }
  return res.json()
}

export interface InvitationActionResponse {
  authUserId: string
  action: 'resent' | 'cancelled'
  status: string
  message: string
}

export async function resendInvitation(
  authUserId: string,
  token: string,
  signal?: AbortSignal,
): Promise<InvitationActionResponse> {
  const res = await fetch(`/api/v1/admin/invitations/${authUserId}/resend`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal,
  })
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}))
    throw new Error(errorBody.detail || `Failed to resend invitation (HTTP ${res.status})`)
  }
  return res.json()
}

export async function cancelInvitation(
  authUserId: string,
  token: string,
  signal?: AbortSignal,
): Promise<InvitationActionResponse> {
  const res = await fetch(`/api/v1/admin/invitations/${authUserId}/cancel`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal,
  })
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}))
    throw new Error(errorBody.detail || `Failed to cancel invitation (HTTP ${res.status})`)
  }
  return res.json()
}

export async function triggerUnclaimedReminders(
  token: string,
  signal?: AbortSignal,
): Promise<{ processedCount: number; remindersSent: number; message: string }> {
  const res = await fetch('/api/v1/jobs/unclaimed-reminders', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal,
  })
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}))
    throw new Error(errorBody.detail || `Failed to run unclaimed reminders job (HTTP ${res.status})`)
  }
  return res.json()
}

export async function triggerUnclaimedCleanup(
  token: string,
  signal?: AbortSignal,
): Promise<{ processedCount: number; expiredAndDeleted: number; message: string }> {
  const res = await fetch('/api/v1/jobs/unclaimed-cleanup', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    signal,
  })
  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}))
    throw new Error(errorBody.detail || `Failed to run unclaimed cleanup job (HTTP ${res.status})`)
  }
  return res.json()
}
