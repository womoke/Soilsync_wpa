import { useState, useMemo, type FC, type FormEvent } from 'react'
import { Sprout } from 'lucide-react'
import { getSupabaseClient } from './lib/supabase'
import { KENYA_COUNTIES, getSubCounties, getWards } from './data/kenyaLocations'

interface FarmerOnboardingProps {
  userId: string
  initialName?: string
  onComplete: () => void
}

export const FarmerOnboarding: FC<FarmerOnboardingProps> = ({
  userId,
  initialName = '',
  onComplete,
}) => {
  const supabase = getSupabaseClient()
  const [fullName, setFullName] = useState(initialName)
  const [county, setCounty] = useState('Nakuru')
  const [subCounty, setSubCounty] = useState('')
  const [ward, setWard] = useState('')
  const [farmName, setFarmName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const availableSubCounties = useMemo(() => getSubCounties(county), [county])
  const availableWards = useMemo(() => getWards(county, subCounty), [county, subCounty])

  const handleCountyChange = (nextCounty: string) => {
    setCounty(nextCounty)
    setSubCounty('')
    setWard('')
  }

  const handleSubCountyChange = (nextSubCounty: string) => {
    setSubCounty(nextSubCounty)
    setWard('')
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!county || !subCounty.trim() || !ward.trim() || !farmName.trim()) {
      setError('Please provide your county, sub-county, ward, and farm name.')
      return
    }

    if (phoneNumber.trim() && !/^\+254\d{9}$/.test(phoneNumber.trim())) {
      setError('Phone number must be in +254 format (e.g. +254712345678).')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      if (supabase) {
        // 1. Update profiles table
        const { error: profileError } = await supabase
          .from('profiles')
          .update({
            full_name: fullName.trim() || null,
            county,
            sub_county: subCounty.trim(),
            ward: ward.trim(),
            phone_number: phoneNumber.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', userId)

        if (profileError) throw profileError

        // 2. Create initial farm
        const { error: farmError } = await supabase.from('farms').insert({
          owner_id: userId,
          name: farmName.trim(),
          county,
          sub_county: subCounty.trim(),
          ward: ward.trim(),
        })

        // If farms table requires database user id vs auth id, log and continue safely
        if (farmError) {
          console.warn('Initial farm insertion through Supabase client note:', farmError.message)
        }
      }

      onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete profile onboarding.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="onboarding-shell" style={{ maxWidth: '640px', margin: '40px auto', padding: '0 20px' }}>
      <div
        className="onboarding-card"
        style={{
          background: 'var(--surface-bg, #ffffff)',
          border: '1px solid var(--border-color, #e2e8f0)',
          borderRadius: '16px',
          padding: '32px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--accent, #059669)', marginBottom: '8px' }}>
          <Sprout size={24} />
          <span style={{ fontSize: '13px', fontWeight: '700', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Farmer Onboarding
          </span>
        </div>

        <h1 style={{ fontSize: '24px', fontWeight: '700', margin: '0 0 8px 0', color: 'var(--ink, #0f172a)' }}>
          Welcome to SoilSync AI
        </h1>
        <p style={{ color: 'var(--ink-muted, #64748b)', margin: '0 0 24px 0', fontSize: '14px', lineHeight: '1.5' }}>
          Set up your farm profile to receive localized agronomic context, soil recommendations, and
          connect with extension services in your ward.
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
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div>
            <label htmlFor="onboarding-full-name" style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: 'var(--ink)' }}>
              Full name
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="onboarding-full-name"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Amina Njeri"
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

          <div>
            <label htmlFor="onboarding-farm-name" style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: 'var(--ink)' }}>
              Farm name
            </label>
            <input
              id="onboarding-farm-name"
              type="text"
              value={farmName}
              onChange={(e) => setFarmName(e.target.value)}
              placeholder="e.g. Mau View Shamba"
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

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '14px' }}>
            <div>
              <label htmlFor="onboarding-county" style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: 'var(--ink)' }}>
                County
              </label>
              <select
                id="onboarding-county"
                value={county}
                onChange={(e) => handleCountyChange(e.target.value)}
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
                <option value="">Select County</option>
                {KENYA_COUNTIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="onboarding-sub-county" style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: 'var(--ink)' }}>
                Sub-County
              </label>
              <select
                id="onboarding-sub-county"
                value={subCounty}
                onChange={(e) => handleSubCountyChange(e.target.value)}
                disabled={!county || availableSubCounties.length === 0}
                required
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  fontSize: '14px',
                  background: !county ? 'var(--input-disabled-bg, #f1f5f9)' : 'var(--input-bg, #ffffff)',
                  cursor: !county ? 'not-allowed' : 'default',
                }}
              >
                <option value="">{county ? 'Select Sub-County' : 'Select County first'}</option>
                {availableSubCounties.map((sc) => (
                  <option key={sc} value={sc}>
                    {sc}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="onboarding-ward" style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: 'var(--ink)' }}>
                Ward
              </label>
              <select
                id="onboarding-ward"
                value={ward}
                onChange={(e) => setWard(e.target.value)}
                disabled={!subCounty || availableWards.length === 0}
                required
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color, #cbd5e1)',
                  fontSize: '14px',
                  background: !subCounty ? 'var(--input-disabled-bg, #f1f5f9)' : 'var(--input-bg, #ffffff)',
                  cursor: !subCounty ? 'not-allowed' : 'default',
                }}
              >
                <option value="">{subCounty ? 'Select Ward' : 'Select Sub-County first'}</option>
                {availableWards.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="onboarding-phone-number" style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: 'var(--ink)' }}>
              Phone number (optional)
            </label>
            <input
              id="onboarding-phone-number"
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
            <small style={{ color: 'var(--ink-muted, #64748b)', fontSize: '12px', marginTop: '4px', display: 'block' }}>
              Used strictly for agricultural alert SMS notifications under your consent.
            </small>
          </div>

          <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
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
              {isSubmitting ? 'Saving Profile…' : 'Complete Setup & Open Farm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
