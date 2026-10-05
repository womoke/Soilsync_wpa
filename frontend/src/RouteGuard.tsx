import { type FC, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Loader2,
  ShieldAlert,
} from 'lucide-react'
import { useAuth, type AppUserRole } from './context/AuthContext'
import { FarmerOnboarding } from './FarmerOnboarding'
import { AgrodealerPendingView } from './AgrodealerPendingView'
import type { Destination } from './App'

export interface RouteGuardProps {
  destination: Destination
  onNavigate: (path: string) => void
  children: ReactNode
}

const roleDestinationMap: Record<AppUserRole, Destination> = {
  farmer: 'farmer',
  'extension-officer': 'officer',
  agrodealer: 'dealer',
  agronomist: 'agronomist',
  admin: 'admin',
}

const destinationRoleMap: Partial<Record<Destination, AppUserRole>> = {
  farmer: 'farmer',
  officer: 'extension-officer',
  dealer: 'agrodealer',
  agronomist: 'agronomist',
  admin: 'admin',
}

const roleLabelMap: Record<AppUserRole, string> = {
  farmer: 'Farmer',
  'extension-officer': 'Extension Officer',
  agrodealer: 'Agrodealer',
  agronomist: 'Agronomist',
  admin: 'Administrator',
}

export const RouteGuard: FC<RouteGuardProps> = ({ destination, onNavigate, children }) => {
  const {
    session,
    user,
    profile,
    activeRoles,
    allRoles,
    isLoading,
    error,
    refreshSession,
    refreshRoles,
    signOut,
  } = useAuth()

  // 1. Unrestricted public routes
  if (destination === 'welcome' || destination === 'workshop') {
    return <>{children}</>
  }

  // 2. Loading session/profile state
  if (isLoading) {
    return (
      <div
        className="route-guard-status"
        role="status"
        style={{
          minHeight: '50vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          color: 'var(--ink-muted, #64748b)',
        }}
      >
        <Loader2 className="animate-spin" size={28} />
        <span>Verifying access permissions…</span>
      </div>
    )
  }

  // 3. Signed out state
  if (!session || !user) {
    return (
      <div
        className="route-guard-card"
        role="alert"
        style={{
          maxWidth: '520px',
          margin: '60px auto',
          padding: '36px',
          background: 'var(--surface-bg, #ffffff)',
          border: '1px solid var(--border-color, #e2e8f0)',
          borderRadius: '16px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05)',
          textAlign: 'center',
        }}
      >
        <ShieldAlert size={48} style={{ color: 'var(--accent, #059669)', margin: '0 auto 16px' }} />
        <h2 style={{ fontSize: '20px', fontWeight: '700', margin: '0 0 8px 0', color: 'var(--ink, #0f172a)' }}>
          Sign-in Required
        </h2>
        <p style={{ color: 'var(--ink-muted, #64748b)', fontSize: '14px', lineHeight: '1.5', margin: '0 0 24px 0' }}>
          You must be signed in to access the {destination} workspace.
        </p>
        <button
          type="button"
          className="primary-button"
          onClick={() => onNavigate('/welcome')}
          style={{ width: '100%', padding: '12px 20px', fontSize: '14px', fontWeight: '600' }}
        >
          Go to Sign In
        </button>
      </div>
    )
  }

  // 4. Signed in, profile/role verification failed.
  if (error) {
    return (
      <div className="route-guard-card" role="alert">
        <ShieldAlert size={44} style={{ color: '#dc2626', margin: '0 auto 16px' }} />
        <h2>Unable to verify account access</h2>
        <p>{error}</p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
          <button
            type="button"
            className="primary-button"
            onClick={() => void refreshSession()}
          >
            Retry verification
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={async () => {
              await signOut()
              onNavigate('/welcome')
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  // 5. Signed in, Incomplete Profile (Required farmer onboarding)
  const isFarmer = activeRoles.includes('farmer')
  const isProfileIncomplete = !profile?.county || !profile?.subCounty || !profile?.ward

  if (isFarmer && isProfileIncomplete && destination === 'farmer') {
    return (
      <FarmerOnboarding
        userId={user.id}
        initialName={profile?.fullName || (user.user_metadata?.full_name as string) || ''}
        onComplete={() => {
          refreshRoles()
        }}
      />
    )
  }

  // 6. Role Authorization
  const requiredRole = destinationRoleMap[destination]
  const hasActiveRole = requiredRole ? activeRoles.includes(requiredRole) : true

  if (requiredRole && !hasActiveRole) {
    // Check if the user has this role in a pending review state (e.g. pending agrodealer)
    const isPending = allRoles.some((r) => r.role === requiredRole && r.status === 'pending')

    const primaryActiveRole = activeRoles[0]
    const homePath = primaryActiveRole ? `/${roleDestinationMap[primaryActiveRole]}` : '/welcome'
    const homeLabel = primaryActiveRole ? `${roleLabelMap[primaryActiveRole]} Workspace` : 'Sign In'

    if (isPending && requiredRole === 'agrodealer') {
      return <AgrodealerPendingView onBackToHome={() => onNavigate(homePath)} />
    }

    return (
      <div
        className="route-guard-card"
        role="alert"
        style={{
          maxWidth: '540px',
          margin: '60px auto',
          padding: '36px',
          background: 'var(--surface-bg, #ffffff)',
          border: '1px solid var(--border-color, #e2e8f0)',
          borderRadius: '16px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05)',
          textAlign: 'center',
        }}
      >
        <AlertTriangle size={44} style={{ color: '#dc2626', margin: '0 auto 16px' }} />
        <h2 style={{ fontSize: '20px', fontWeight: '700', margin: '0 0 8px 0', color: 'var(--ink, #0f172a)' }}>
          Access Restricted
        </h2>
        <p style={{ color: 'var(--ink-muted, #64748b)', fontSize: '14px', lineHeight: '1.5', margin: '0 0 24px 0' }}>
          You do not have active permissions to access the {roleLabelMap[requiredRole] || destination} workspace.
        </p>
        {isPending && requiredRole === 'agronomist' && (
          <p style={{ color: 'var(--ink-muted, #64748b)', fontSize: '14px', lineHeight: '1.5', margin: '0 0 24px 0' }}>
            Agronomist accounts must be approved by an administrator before reviewing assessments.
          </p>
        )}
        {requiredRole === 'agrodealer' && (
          <p style={{ color: 'var(--ink-muted, #64748b)', fontSize: '14px', lineHeight: '1.5', margin: '0 0 24px 0' }}>
            Agrodealer accounts are created by an administrator. Contact your administrator for an invitation.
          </p>
        )}

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="primary-button"
            onClick={() => onNavigate(homePath)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '12px 20px',
              fontSize: '14px',
              fontWeight: '600',
            }}
          >
            Return to {homeLabel}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    )
  }

  // 7. Access authorized
  return <>{children}</>
}
