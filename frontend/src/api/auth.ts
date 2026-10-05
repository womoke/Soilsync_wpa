export type AppRole = 'farmer' | 'extension_officer' | 'agrodealer' | 'admin'

export interface LinkedAppProfile {
  status: 'linked'
  appUserId: string
  identityProvider: 'supabase'
  role: AppRole
}

function isAppRole(value: unknown): value is AppRole {
  return (
    value === 'farmer' ||
    value === 'extension_officer' ||
    value === 'agrodealer' ||
    value === 'admin'
  )
}

export async function linkAuthenticatedAccount(
  accessToken: string,
  displayName?: string,
): Promise<LinkedAppProfile> {
  const response = await fetch('/api/v1/auth/link', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(displayName ? { displayName } : {}),
  })
  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const detail =
      payload &&
      typeof payload === 'object' &&
      'detail' in payload &&
      typeof payload.detail === 'string'
        ? payload.detail
        : `Account verification failed (HTTP ${response.status}).`
    throw new Error(detail)
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    !('status' in payload) ||
    payload.status !== 'linked' ||
    !('appUserId' in payload) ||
    typeof payload.appUserId !== 'string' ||
    !('identityProvider' in payload) ||
    payload.identityProvider !== 'supabase' ||
    !('role' in payload) ||
    !isAppRole(payload.role)
  ) {
    throw new Error('Account verification returned an invalid profile.')
  }

  return {
    status: 'linked',
    appUserId: payload.appUserId,
    identityProvider: 'supabase',
    role: payload.role,
  }
}

export async function activateAccountInvitation(accessToken: string): Promise<void> {
  const response = await fetch('/api/v1/auth/invitations/activate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const detail =
      payload &&
      typeof payload === 'object' &&
      'detail' in payload &&
      typeof payload.detail === 'string'
        ? payload.detail
        : `Invitation activation failed (HTTP ${response.status}).`
    throw new Error(detail)
  }
}
