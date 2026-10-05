import { useEffect, useState, type FC } from 'react'
import { ArrowRight, Clock, Lock, RefreshCw } from 'lucide-react'
import { getAgrodealerApplicationStatus, type AgrodealerApplicationResult } from './api/agrodealer'
import { useAuth } from './context/AuthContext'

interface AgrodealerPendingViewProps {
  onBackToHome: () => void
}

export const AgrodealerPendingView: FC<AgrodealerPendingViewProps> = ({ onBackToHome }) => {
  const { session, refreshRoles } = useAuth()
  const [application, setApplication] = useState<AgrodealerApplicationResult | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const loadStatus = async () => {
    setIsRefreshing(true)
    setStatusMessage(null)
    try {
      if (session?.access_token) {
        const result = await getAgrodealerApplicationStatus(session.access_token)
        if (result.hasApplication && result.application) {
          setApplication(result.application)
        }
      }
      await refreshRoles()
      setStatusMessage('Application status checked.')
    } catch {
      setStatusMessage('Unable to retrieve latest application records.')
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    let isMounted = true
    async function initialFetch() {
      if (!session?.access_token) return
      try {
        const result = await getAgrodealerApplicationStatus(session.access_token)
        if (isMounted && result.hasApplication && result.application) {
          setApplication(result.application)
        }
      } catch {
        // Initial silent check
      }
    }
    void initialFetch()
    return () => {
      isMounted = false
    }
  }, [session?.access_token])

  return (
    <div className="pending-shell" style={{ maxWidth: '640px', margin: '40px auto', padding: '0 20px' }}>
      <div
        className="pending-card"
        style={{
          background: 'var(--surface-bg, #ffffff)',
          border: '1px solid var(--border-color, #e2e8f0)',
          borderRadius: '16px',
          padding: '36px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: '64px',
            height: '64px',
            borderRadius: '50%',
            background: '#fef3c7',
            color: '#d97706',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
          }}
        >
          <Clock size={32} />
        </div>

        <div
          style={{
            display: 'inline-block',
            padding: '4px 12px',
            borderRadius: '20px',
            background: '#fffbeb',
            border: '1px solid #fde68a',
            color: '#b45309',
            fontSize: '12px',
            fontWeight: '700',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            marginBottom: '12px',
          }}
        >
          Application Under Review
        </div>

        <h1 style={{ fontSize: '24px', fontWeight: '700', margin: '0 0 10px 0', color: 'var(--ink, #0f172a)' }}>
          Dealer Application Pending Approval
        </h1>

        <p style={{ color: 'var(--ink-muted, #64748b)', fontSize: '14px', lineHeight: '1.6', margin: '0 0 24px 0' }}>
          Your application to register as an authorized agrodealer has been submitted.
          A system administrator must review and verify your business licence before product listing
          and farmer orders can be activated.
        </p>

        {application && (
          <div
            style={{
              background: 'var(--table-header-bg, #f8fafc)',
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: '12px',
              padding: '20px',
              textAlign: 'left',
              marginBottom: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              fontSize: '13px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--ink-muted)' }}>Business Name:</span>
              <strong style={{ color: 'var(--ink)' }}>{application.businessName}</strong>
            </div>
            {application.licenceNumber && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--ink-muted)' }}>Trade Licence:</span>
                <strong style={{ color: 'var(--ink)' }}>{application.licenceNumber}</strong>
              </div>
            )}
            {application.contactName && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--ink-muted)' }}>Contact Person:</span>
                <span style={{ color: 'var(--ink)' }}>{application.contactName}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--ink-muted)' }}>County & Ward:</span>
              <span style={{ color: 'var(--ink)' }}>
                {[application.county, application.ward].filter(Boolean).join(' · ')}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--ink-muted)' }}>Verification State:</span>
              <span style={{ color: '#d97706', fontWeight: '600', textTransform: 'capitalize' }}>
                {application.verificationState}
              </span>
            </div>
          </div>
        )}

        <div
          style={{
            background: '#fffbeb',
            border: '1px solid #fef3c7',
            borderRadius: '12px',
            padding: '16px',
            textAlign: 'left',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
          }}
        >
          <Lock size={18} style={{ color: '#d97706', marginTop: '2px', flexShrink: 0 }} />
          <div style={{ fontSize: '13px', color: '#92400e', lineHeight: '1.5' }}>
            <strong>Catalog and Orders Locked:</strong> You cannot add inventory items, publish stock,
            or accept customer orders until verification is confirmed by an administrator.
          </div>
        </div>

        {statusMessage && (
          <p style={{ fontSize: '13px', color: 'var(--ink-muted)', marginBottom: '16px' }}>
            {statusMessage}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="secondary-button"
            onClick={loadStatus}
            disabled={isRefreshing}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 18px',
              fontSize: '14px',
            }}
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
            {isRefreshing ? 'Checking…' : 'Check Status'}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={onBackToHome}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 20px',
              fontSize: '14px',
              fontWeight: '600',
            }}
          >
            Return to Farmer Workspace
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
