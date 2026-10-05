import { useState, type FormEvent } from 'react'
import { KeyRound, X } from 'lucide-react'
import { useAuth } from './context/AuthContext'
import { getSupabaseClient } from './lib/supabase'

interface ProfileSettingsProps {
  onClose: () => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The requested account action failed.'
}

export default function ProfileSettings({ onClose }: ProfileSettingsProps) {
  const { session, user, profile, allRoles, updateProfile } = useAuth()
  const [fullName, setFullName] = useState(profile?.fullName ?? '')
  const [phoneNumber, setPhoneNumber] = useState(profile?.phoneNumber ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const [isSendingReset, setIsSendingReset] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    setMessage('')
    setError('')
    const result = await updateProfile(fullName.trim(), phoneNumber.trim() || null)
    setIsSaving(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    setMessage('Your profile was updated.')
  }

  async function sendPasswordReset() {
    const supabase = getSupabaseClient()
    const email = user?.email
    if (!supabase || !email) {
      setError('Password reset is unavailable for this account. Contact your administrator.')
      return
    }

    setIsSendingReset(true)
    setMessage('')
    setError('')
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: new URL('/reset-password', window.location.origin).toString(),
      })
      if (resetError) throw resetError
      setMessage('If this account can receive email, password reset instructions have been sent.')
    } catch (resetError) {
      setError(errorMessage(resetError))
    } finally {
      setIsSendingReset(false)
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving && !isSendingReset) onClose()
      }}
    >
      <section
        className="reading-dialog profile-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-settings-title"
      >
        <div className="dialog-heading">
          <div>
            <div className="eyebrow">ACCOUNT</div>
            <h2 id="profile-settings-title">Profile settings</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            disabled={isSaving || isSendingReset}
            aria-label="Close profile settings"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={(event) => void submitProfile(event)}>
          <label className="field-control profile-settings-field">
            <span>Full name</span>
            <input
              autoComplete="name"
              maxLength={200}
              required
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </label>
          <label className="field-control profile-settings-field">
            <span>
              Contact phone <small>Optional, format +254712345678</small>
            </span>
            <input
              autoComplete="tel"
              type="tel"
              pattern="(\+254[0-9]{9})?"
              title="Enter a Kenyan number in +254 format, or leave blank."
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
            />
          </label>

          <div className="profile-readonly-fields" aria-label="Read-only account details">
            <div>
              <span>Email</span>
              <strong>{user?.email ?? 'Unavailable'}</strong>
            </div>
            <div>
              <span>Role / approval status</span>
              <strong>
                {allRoles.length
                  ? allRoles
                      .map(({ role, status }) => `${role.replace('-', ' ')} (${status})`)
                      .join(', ')
                  : 'No assigned role'}
              </strong>
            </div>
            <div>
              <span>Assigned area</span>
              <strong>
                {[profile?.ward, profile?.subCounty, profile?.county]
                  .filter((value): value is string => Boolean(value))
                  .join(', ') || 'Not supplied'}
              </strong>
            </div>
          </div>
          <p className="profile-settings-note">
            Email, role, approval status, and assigned area are managed separately and cannot be
            changed here.
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

          <div className="dialog-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => void sendPasswordReset()}
              disabled={isSendingReset || isSaving || !session}
            >
              <KeyRound size={15} />
              {isSendingReset ? 'Sending reset link…' : 'Send password reset link'}
            </button>
            <button className="primary-button" type="submit" disabled={isSaving || isSendingReset}>
              {isSaving ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
