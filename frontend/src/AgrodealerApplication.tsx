import { useState, type FC, type FormEvent } from 'react'
import { AlertCircle, Store } from 'lucide-react'
import { applyForAgrodealer, type AgrodealerApplicationPayload } from './api/agrodealer'
import { useAuth } from './context/AuthContext'

interface AgrodealerApplicationProps {
  onSuccess: () => void
  onCancel?: () => void
}

import { KENYA_COUNTIES } from './data/kenyaLocations'

export const AgrodealerApplication: FC<AgrodealerApplicationProps> = ({ onSuccess, onCancel }) => {
  const { session, refreshRoles } = useAuth()

  const [businessName, setBusinessName] = useState('')
  const [licenceNumber, setLicenceNumber] = useState('')
  const [contactName, setContactName] = useState('')
  const [county, setCounty] = useState('Nakuru')
  const [subCounty, setSubCounty] = useState('')
  const [ward, setWard] = useState('')
  const [shopLocation, setShopLocation] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [agreedToTerms, setAgreedToTerms] = useState(false)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()

    if (!businessName.trim() || !licenceNumber.trim() || !contactName.trim() || !county) {
      setError('Please fill in all required fields.')
      return
    }

    if (phoneNumber.trim() && !/^\+254\d{9}$/.test(phoneNumber.trim())) {
      setError('Phone number must be in +254 format (e.g. +254712345678).')
      return
    }

    if (!agreedToTerms) {
      setError('You must certify regulatory compliance before submitting your application.')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const payload: AgrodealerApplicationPayload = {
        businessName: businessName.trim(),
        licenceNumber: licenceNumber.trim(),
        contactName: contactName.trim(),
        county,
        subCounty: subCounty.trim() || undefined,
        ward: ward.trim() || undefined,
        shopLocation: shopLocation.trim() || undefined,
        phoneNumber: phoneNumber.trim() || undefined,
      }

      const token = session?.access_token || 'mock-dealer-token'
      await applyForAgrodealer(token, payload)
      await refreshRoles()
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Application submission failed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      className="application-shell"
      style={{ maxWidth: '680px', margin: '40px auto', padding: '0 20px' }}
    >
      <div
        className="application-card"
        style={{
          background: 'var(--surface-bg, #ffffff)',
          border: '1px solid var(--border-color, #e2e8f0)',
          borderRadius: '16px',
          padding: '36px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            color: 'var(--green-strong)',
            marginBottom: '8px',
          }}
        >
          <Store size={26} />
          <span
            style={{
              fontSize: '13px',
              fontWeight: '700',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            Agrodealer Application
          </span>
        </div>

        <h1
          style={{
            fontSize: '24px',
            fontWeight: '700',
            margin: '0 0 8px 0',
            color: 'var(--ink, #0f172a)',
          }}
        >
          Register Your Agrodealer Business
        </h1>
        <p
          style={{
            color: 'var(--ink-muted, #64748b)',
            margin: '0 0 24px 0',
            fontSize: '14px',
            lineHeight: '1.5',
          }}
        >
          Connect directly with farmers in your county. Applications undergo administrative
          verification against county business registers and plant health authorities before catalog
          listing is activated.
        </p>

        {error && (
          <div
            role="alert"
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#b91c1c',
              fontSize: '13px',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}
        >
          <div>
            <label
              htmlFor="dealer-business-name"
              style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: '600',
                marginBottom: '6px',
                color: 'var(--ink)',
              }}
            >
              Business name *
            </label>
            <input
              id="dealer-business-name"
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. Mau Agrovet Supplies Ltd"
              required
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border-color, #cbd5e1)',
                fontSize: '14px',
                background: 'var(--input-bg, #ffffff)',
              }}
            />
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '16px',
            }}
          >
            <div>
              <label
                htmlFor="dealer-licence-number"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: '600',
                  marginBottom: '6px',
                  color: 'var(--ink)',
                }}
              >
                Licence / Registration number *
              </label>
              <input
                id="dealer-licence-number"
                type="text"
                value={licenceNumber}
                onChange={(e) => setLicenceNumber(e.target.value)}
                placeholder="e.g. AFA/2026/0488"
                required
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  fontSize: '14px',
                  background: 'var(--input-bg, #ffffff)',
                }}
              />
            </div>

            <div>
              <label
                htmlFor="dealer-contact-name"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: '600',
                  marginBottom: '6px',
                  color: 'var(--ink)',
                }}
              >
                Contact person name *
              </label>
              <input
                id="dealer-contact-name"
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="e.g. Peter Mwangi"
                required
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  fontSize: '14px',
                  background: 'var(--input-bg, #ffffff)',
                }}
              />
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '14px',
            }}
          >
            <div>
              <label
                htmlFor="dealer-county"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: '600',
                  marginBottom: '6px',
                  color: 'var(--ink)',
                }}
              >
                County *
              </label>
              <select
                id="dealer-county"
                value={county}
                onChange={(e) => setCounty(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  fontSize: '14px',
                  background: 'var(--input-bg, #ffffff)',
                }}
              >
                {KENYA_COUNTIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="dealer-sub-county"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: '600',
                  marginBottom: '6px',
                  color: 'var(--ink)',
                }}
              >
                Sub-County
              </label>
              <input
                id="dealer-sub-county"
                type="text"
                value={subCounty}
                onChange={(e) => setSubCounty(e.target.value)}
                placeholder="e.g. Njoro"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  fontSize: '14px',
                  background: 'var(--input-bg, #ffffff)',
                }}
              />
            </div>

            <div>
              <label
                htmlFor="dealer-ward"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: '600',
                  marginBottom: '6px',
                  color: 'var(--ink)',
                }}
              >
                Ward
              </label>
              <input
                id="dealer-ward"
                type="text"
                value={ward}
                onChange={(e) => setWard(e.target.value)}
                placeholder="e.g. Mau Narok"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  fontSize: '14px',
                  background: 'var(--input-bg, #ffffff)',
                }}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="dealer-shop-location"
              style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: '600',
                marginBottom: '6px',
                color: 'var(--ink)',
              }}
            >
              Shop location / Physical address
            </label>
            <input
              id="dealer-shop-location"
              type="text"
              value={shopLocation}
              onChange={(e) => setShopLocation(e.target.value)}
              placeholder="e.g. Plot 12, Main Street, Mau Narok Center"
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border-color, #cbd5e1)',
                fontSize: '14px',
                background: 'var(--input-bg, #ffffff)',
              }}
            />
          </div>

          <div>
            <label
              htmlFor="dealer-phone-number"
              style={{
                display: 'block',
                fontSize: '13px',
                fontWeight: '600',
                marginBottom: '6px',
                color: 'var(--ink)',
              }}
            >
              Business phone number
            </label>
            <input
              id="dealer-phone-number"
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+254712345678"
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border-color, #cbd5e1)',
                fontSize: '14px',
                background: 'var(--input-bg, #ffffff)',
              }}
            />
            <small
              style={{
                color: 'var(--ink-muted, #64748b)',
                fontSize: '12px',
                marginTop: '4px',
                display: 'block',
              }}
            >
              Used by farmers to confirm stock availability and arrange orders.
            </small>
          </div>

          <div
            style={{
              padding: '16px',
              borderRadius: '8px',
              background: 'var(--table-header-bg, #f8fafc)',
              border: '1px solid var(--border-color, #e2e8f0)',
              marginTop: '4px',
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                fontSize: '13px',
                cursor: 'pointer',
                lineHeight: '1.4',
              }}
            >
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                style={{ marginTop: '2px' }}
              />
              <span>
                I certify that our business holds a valid trade licence, and that all agricultural
                inputs listed on SoilSync AI will comply with national quality and certification
                standards.
              </span>
            </label>
          </div>

          <div
            style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}
          >
            {onCancel && (
              <button
                type="button"
                className="secondary-button"
                onClick={onCancel}
                disabled={isSubmitting}
                style={{ padding: '12px 20px', borderRadius: '8px', fontSize: '14px' }}
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="primary-button"
              style={{
                padding: '12px 24px',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              {isSubmitting ? 'Submitting Application…' : 'Submit Application for Review'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
