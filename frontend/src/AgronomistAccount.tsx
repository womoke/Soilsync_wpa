import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2, RefreshCw, ShieldCheck, UserCheck, Undo2 } from 'lucide-react'
import {
  claimAssessment,
  editAssessment,
  getUnverifiedAssessments,
  publishAssessment,
  releaseAssessment,
  type UnverifiedAssessmentItem,
} from './api/officer'
import { useAuth } from './context/AuthContext'

type ReviewDraft = {
  notes: string
  licenseNumber: string
  finalNotes: string
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.'
}

export default function AgronomistAccount({
  onBackToDemo,
}: {
  onBackToDemo: () => void
}) {
  const { session } = useAuth()
  const accessToken = session?.access_token
  const [assessments, setAssessments] = useState<UnverifiedAssessmentItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [busyAssessmentId, setBusyAssessmentId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refreshAssessments = useCallback(async () => {
    if (!accessToken) {
      setAssessments([])
      setIsLoading(false)
      setError('A verified session is required to load assessments.')
      return
    }

    setIsLoading(true)
    setError('')
    try {
      setAssessments(await getUnverifiedAssessments(accessToken))
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setIsLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    let isActive = true
    if (!accessToken) {
      void Promise.resolve().then(() => {
        if (!isActive) return
        setAssessments([])
        setIsLoading(false)
        setError('A verified session is required to load assessments.')
      })
    } else {
      void getUnverifiedAssessments(accessToken)
        .then((items) => {
          if (!isActive) return
          setAssessments(items)
          setError('')
        })
        .catch((loadError: unknown) => {
          if (isActive) setError(getErrorMessage(loadError))
        })
        .finally(() => {
          if (isActive) setIsLoading(false)
        })
    }

    return () => {
      isActive = false
    }
  }, [accessToken])

  const performAssessmentAction = async (
    assessmentId: string,
    action: (
      accessToken: string,
      id: string,
    ) => Promise<{ message: string }>,
  ): Promise<boolean> => {
    if (!session?.access_token) {
      setError('A verified session is required to update assessments.')
      return false
    }

    setBusyAssessmentId(assessmentId)
    setError('')
    setMessage('')
    try {
      const result = await action(session.access_token, assessmentId)
      setMessage(result.message)
      await refreshAssessments()
      return true
    } catch (actionError) {
      setError(getErrorMessage(actionError))
      return false
    } finally {
      setBusyAssessmentId(null)
    }
  }

  const updateDraft = (assessmentId: string, key: keyof ReviewDraft, value: string) => {
    setDrafts((previous) => ({
      ...previous,
      [assessmentId]: {
        ...(previous[assessmentId] ?? { notes: '', licenseNumber: '', finalNotes: '' }),
        [key]: value,
      },
    }))
  }

  const handleSaveNotes = async (
    event: FormEvent<HTMLFormElement>,
    assessment: UnverifiedAssessmentItem,
  ) => {
    event.preventDefault()
    const notes = drafts[assessment.assessmentId]?.notes.trim()
    if (!notes) {
      setError('Enter a review note before saving.')
      return
    }
    const saved = await performAssessmentAction(assessment.assessmentId, (accessToken, id) =>
      editAssessment(accessToken, id, notes),
    )
    if (saved) updateDraft(assessment.assessmentId, 'notes', '')
  }

  const handlePublish = async (
    event: FormEvent<HTMLFormElement>,
    assessment: UnverifiedAssessmentItem,
  ) => {
    event.preventDefault()
    const draft = drafts[assessment.assessmentId]
    const licenseNumber = draft?.licenseNumber.trim()
    if (!licenseNumber) {
      setError('Enter your licence or accreditation number before publishing.')
      return
    }
    await performAssessmentAction(assessment.assessmentId, (accessToken, id) =>
      publishAssessment(accessToken, id, {
        licenseNumber,
        finalNotes: draft.finalNotes.trim() || undefined,
      }),
    )
  }

  return (
    <section className="role-panel-block" aria-labelledby="agronomist-heading">
      <header className="section-heading">
        <div>
          <div className="eyebrow">AGRONOMIST WORKSPACE</div>
          <h1 id="agronomist-heading">Assessment review</h1>
          <p className="page-subtitle">
            Claim eligible assessments, collaborate with the assigned officer, and publish verified reports.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void refreshAssessments()}
            disabled={isLoading}
          >
            <RefreshCw size={16} /> Refresh
          </button>
          <button className="secondary-button" type="button" onClick={onBackToDemo}>
            Back to sign in
          </button>
        </div>
      </header>

      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-success" role="status">{message}</p>}
      {isLoading ? (
        <p className="account-loading" role="status">Loading assessment review pool…</p>
      ) : assessments.length === 0 ? (
        <p className="history-empty">
          No unverified assessments are available in your approved county review pool.
        </p>
      ) : (
        <div className="assessment-list" style={{ display: 'grid', gap: '1rem' }}>
          {assessments.map((assessment) => {
            const isClaimedByCurrentUser = Boolean(assessment.claimingAgronomistId)
            const isBusy = busyAssessmentId === assessment.assessmentId
            const draft = drafts[assessment.assessmentId] ?? {
              notes: '',
              licenseNumber: '',
              finalNotes: '',
            }

            return (
              <article
                className="history-panel"
                key={assessment.assessmentId}
                aria-labelledby={`assessment-${assessment.assessmentId}`}
              >
                <div className="section-heading">
                  <div>
                    <h2 id={`assessment-${assessment.assessmentId}`}>
                      {assessment.farmName || 'Farm assessment'}
                    </h2>
                    <p className="page-subtitle">
                      {assessment.farmerName || 'Farmer'} · {assessment.county} · {assessment.crop}
                    </p>
                  </div>
                  <span className="sync-status-indicator">
                    {isClaimedByCurrentUser ? 'Claimed by you' : 'Awaiting review'}
                  </span>
                </div>

                <p>
                  Assessment status: {assessment.status}; review stage: {assessment.reviewStage}.
                  {' '}Engine: {assessment.engineVersion}.
                </p>

                {assessment.engineBaseline.diagnoses.length > 0 && (
                  <div>
                    <h3>Soil diagnoses</h3>
                    <ul>
                      {assessment.engineBaseline.diagnoses.map((diagnosis) => (
                        <li key={diagnosis.analyte}>
                          {diagnosis.analyte.replaceAll('_', ' ')}: {diagnosis.value} — {diagnosis.status}.
                          {' '}{diagnosis.interpretation}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {assessment.officerEdits.length + assessment.agronomistEdits.length > 0 && (
                  <div>
                    <h3>Collaborative review notes</h3>
                    <ul>
                      {[...assessment.officerEdits, ...assessment.agronomistEdits]
                        .sort((first, second) => first.timestamp.localeCompare(second.timestamp))
                        .map((edit, index) => (
                          <li key={`${edit.timestamp}-${index}`}>
                            <strong>{edit.authorName} ({edit.role}):</strong> {edit.notes}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}

                {!isClaimedByCurrentUser && (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={isBusy}
                    onClick={() =>
                      void performAssessmentAction(assessment.assessmentId, claimAssessment)
                    }
                  >
                    <UserCheck size={16} /> Claim assessment
                  </button>
                )}

                {isClaimedByCurrentUser && (
                  <>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        void performAssessmentAction(assessment.assessmentId, releaseAssessment)
                      }
                    >
                      <Undo2 size={16} /> Release to county pool
                    </button>

                    <form
                      className="assessment-review-form"
                      onSubmit={(event) => void handleSaveNotes(event, assessment)}
                    >
                      <label className="auth-field">
                        <span>Add a collaborative review note</span>
                        <textarea
                          value={draft.notes}
                          onChange={(event) =>
                            updateDraft(assessment.assessmentId, 'notes', event.target.value)
                          }
                          rows={3}
                        />
                      </label>
                      <button className="secondary-button" type="submit" disabled={isBusy}>
                        Save review note
                      </button>
                    </form>

                    <form
                      className="assessment-review-form"
                      onSubmit={(event) => void handlePublish(event, assessment)}
                    >
                      <label className="auth-field">
                        <span>Licence / accreditation number</span>
                        <input
                          value={draft.licenseNumber}
                          onChange={(event) =>
                            updateDraft(assessment.assessmentId, 'licenseNumber', event.target.value)
                          }
                          required
                        />
                      </label>
                      <label className="auth-field">
                        <span>Final publication notes (optional)</span>
                        <textarea
                          value={draft.finalNotes}
                          onChange={(event) =>
                            updateDraft(assessment.assessmentId, 'finalNotes', event.target.value)
                          }
                          rows={3}
                        />
                      </label>
                      <button className="primary-button" type="submit" disabled={isBusy}>
                        <CheckCircle2 size={16} /> Publish verified report
                      </button>
                    </form>
                  </>
                )}
              </article>
            )
          })}
        </div>
      )}

      <p className="sidebar-note">
        <ShieldCheck size={16} /> Unverified assessment details are restricted to the assigned officer and claiming agronomist.
      </p>
    </section>
  )
}
