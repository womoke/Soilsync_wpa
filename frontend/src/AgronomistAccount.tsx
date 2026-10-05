import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2, RefreshCw, ShieldCheck, UserCheck, Undo2 } from 'lucide-react'
import {
  claimAssessment,
  editAssessment,
  getUnverifiedAssessments,
  publishAssessment,
  releaseAssessment,
  type AssessmentAdjustment,
  type UnverifiedAssessmentItem,
} from './api/officer'
import { SoilSyncLoading } from './SoilSyncLoading'
import { useAuth } from './context/AuthContext'

type ReviewDraft = {
  notes: string
  licenseNumber: string
  finalNotes: string
  adjustments: Record<string, string>
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.'
}

function adjustmentKey(section: string, target: string, field: string): string {
  return `${section}:${target}:${field}`
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Not recorded' : date.toLocaleString()
}

function getSavedFieldValue(
  assessment: UnverifiedAssessmentItem,
  adjustment: AssessmentAdjustment,
  originalValue: string,
): string {
  let value = originalValue
  for (const edit of assessment.agronomistEdits) {
    for (const saved of edit.adjustments ?? []) {
      if (
        saved.section === adjustment.section &&
        saved.target === adjustment.target &&
        saved.field === adjustment.field
      ) {
        value = saved.value
      }
    }
  }
  return value
}

const emptyDraft = (): ReviewDraft => ({
  notes: '',
  licenseNumber: '',
  finalNotes: '',
  adjustments: {},
})

export default function AgronomistAccount({ onBackToDemo }: { onBackToDemo: () => void }) {
  const { session } = useAuth()
  const accessToken = session?.access_token
  const agronomistId = session?.user?.id
  const [assessments, setAssessments] = useState<UnverifiedAssessmentItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [busyAssessmentId, setBusyAssessmentId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null)

  const refreshAssessments = useCallback(async () => {
    if (!accessToken) {
      setAssessments([])
      setIsLoading(false)
      setHasLoaded(true)
      setError('A verified session is required to load assessments.')
      return
    }

    setIsLoading(true)
    try {
      const items = await getUnverifiedAssessments(accessToken)
      setAssessments(items)
      setLastRefreshed(new Date().toISOString())
      setError('')
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setIsLoading(false)
      setHasLoaded(true)
    }
  }, [accessToken])

  useEffect(() => {
    void Promise.resolve().then(refreshAssessments)
  }, [refreshAssessments])

  const performAssessmentAction = async (
    assessmentId: string,
    action: (accessToken: string, id: string) => Promise<{ message: string }>,
  ): Promise<boolean> => {
    if (!accessToken) {
      setError('A verified session is required to update assessments.')
      return false
    }

    setBusyAssessmentId(assessmentId)
    setError('')
    setMessage('')
    try {
      const result = await action(accessToken, assessmentId)
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

  const updateDraft = (
    assessmentId: string,
    key: keyof Omit<ReviewDraft, 'adjustments'>,
    value: string,
  ) => {
    setDrafts((previous) => ({
      ...previous,
      [assessmentId]: {
        ...(previous[assessmentId] ?? emptyDraft()),
        [key]: value,
      },
    }))
  }

  const updateAdjustmentDraft = (assessmentId: string, key: string, value: string) => {
    setDrafts((previous) => {
      const draft = previous[assessmentId] ?? emptyDraft()
      return {
        ...previous,
        [assessmentId]: {
          ...draft,
          adjustments: { ...draft.adjustments, [key]: value },
        },
      }
    })
  }

  const getPendingAdjustments = (
    assessment: UnverifiedAssessmentItem,
    draft: ReviewDraft,
  ): AssessmentAdjustment[] => {
    const changes: AssessmentAdjustment[] = []
    for (const diagnosis of assessment.engineBaseline.diagnoses) {
      const adjustment: AssessmentAdjustment = {
        section: 'diagnosis',
        target: diagnosis.analyte,
        field: 'interpretation',
        value: '',
      }
      const key = adjustmentKey(adjustment.section, adjustment.target, adjustment.field)
      const nextValue = draft.adjustments[key]?.trim()
      const currentValue = getSavedFieldValue(assessment, adjustment, diagnosis.interpretation)
      if (nextValue && nextValue !== currentValue) changes.push({ ...adjustment, value: nextValue })
    }
    for (const prescription of assessment.engineBaseline.prescriptions) {
      const target = `${prescription.category}::${prescription.productType}`
      for (const field of ['applicationTiming', 'ratePerHa', 'ratePerAcre'] as const) {
        const adjustment: AssessmentAdjustment = {
          section: 'prescription',
          target,
          field,
          value: '',
        }
        const key = adjustmentKey(adjustment.section, adjustment.target, adjustment.field)
        const nextValue = draft.adjustments[key]?.trim()
        const currentValue = getSavedFieldValue(assessment, adjustment, prescription[field])
        if (nextValue && nextValue !== currentValue)
          changes.push({ ...adjustment, value: nextValue })
      }
    }
    return changes
  }

  const handleSaveNotes = async (
    event: FormEvent<HTMLFormElement>,
    assessment: UnverifiedAssessmentItem,
  ) => {
    event.preventDefault()
    const draft = drafts[assessment.assessmentId] ?? emptyDraft()
    const notes = draft.notes.trim()
    const adjustments = getPendingAdjustments(assessment, draft)
    if (!notes && adjustments.length === 0) {
      setError('Add a review note or change a diagnosis or prescription before saving.')
      return
    }
    const saved = await performAssessmentAction(assessment.assessmentId, (token, id) =>
      adjustments.length
        ? editAssessment(token, id, notes || 'Updated the agronomic report content.', adjustments)
        : editAssessment(token, id, notes),
    )
    if (saved) updateDraft(assessment.assessmentId, 'notes', '')
  }

  const handlePublish = async (
    event: FormEvent<HTMLFormElement>,
    assessment: UnverifiedAssessmentItem,
  ) => {
    event.preventDefault()
    const draft = drafts[assessment.assessmentId] ?? emptyDraft()
    if (getPendingAdjustments(assessment, draft).length > 0) {
      setError('Save your report changes before publishing the verified report.')
      return
    }
    const licenseNumber = draft.licenseNumber.trim()
    if (!licenseNumber) {
      setError('Enter your licence or accreditation number before publishing.')
      return
    }
    await performAssessmentAction(assessment.assessmentId, (token, id) =>
      publishAssessment(token, id, {
        licenseNumber,
        finalNotes: draft.finalNotes.trim() || undefined,
      }),
    )
  }

  const availableCount = assessments.filter((item) => !item.claimingAgronomistId).length
  const claimedByMeCount = assessments.filter(
    (item) => item.claimingAgronomistId === agronomistId,
  ).length

  return (
    <section className="role-panel-block" aria-labelledby="agronomist-heading">
      <header className="section-heading">
        <div>
          <div className="eyebrow">AGRONOMIST WORKSPACE</div>
          <h1 id="agronomist-heading">Assessment review</h1>
          <p className="page-subtitle">
            Claim eligible assessments, edit recommendations, collaborate with the assigned officer,
            and publish verified reports.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void refreshAssessments()}
            disabled={isLoading}
          >
            <RefreshCw size={16} /> {isLoading && hasLoaded ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="secondary-button" type="button" onClick={onBackToDemo}>
            Back to sign in
          </button>
        </div>
      </header>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="form-success" role="status">
          {message}
        </p>
      )}

      {hasLoaded && (
        <section aria-label="Assessment queue metrics">
          <h2>Queue overview</h2>
          <div className="queue-metrics-grid">
            {[
              { label: 'In your review', value: claimedByMeCount },
              { label: 'Ready to claim', value: availableCount },
              { label: 'Assessments in queue', value: assessments.length },
            ].map((metric) => (
              <div className="metric-card" key={metric.label}>
                <span className="metric-label">{metric.label}</span>
                <span className="metric-value">{metric.value}</span>
              </div>
            ))}
          </div>
          {lastRefreshed && <p className="timestamp-chip">Last refreshed: {new Date(lastRefreshed).toLocaleString()}</p>}
        </section>
      )}

      {!hasLoaded && isLoading ? (
        <SoilSyncLoading label="Loading assessment review pool…" compact />
      ) : !isLoading && assessments.length === 0 ? (
        <div className="empty-state">
          <p>
            No unverified assessments are currently available in your approved county review pool.
            Field collections performed by officers will generate assessments for agronomic review.
          </p>
          <p style={{ color: 'var(--muted)' }}>
            Try refreshing the queue or check your assigned jurisdictions — if there should be
            assessments, confirm that officers have marked visits as completed and that sample
            collections succeeded.
          </p>
          <div className="empty-state-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => void refreshAssessments()}
              disabled={isLoading}
            >
              <RefreshCw size={14} /> Refresh assessments
            </button>
          </div>
        </div>
      ) : assessments.length > 0 ? (
        <div className="assessment-list" style={{ display: 'grid', gap: '1rem' }}>
          {assessments.map((assessment) => {
            const isClaimedByCurrentUser =
              assessment.claimingAgronomistId === agronomistId && Boolean(agronomistId)
            const isClaimedElsewhere =
              Boolean(assessment.claimingAgronomistId) && !isClaimedByCurrentUser
            const isBusy = busyAssessmentId === assessment.assessmentId
            const draft = drafts[assessment.assessmentId] ?? emptyDraft()
            const pendingAdjustments = getPendingAdjustments(assessment, draft)

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
                    {isClaimedByCurrentUser
                      ? 'Claimed by you'
                      : isClaimedElsewhere
                        ? 'In another review'
                        : 'Awaiting review'}
                  </span>
                </div>

                <p>
                  Assessment status: {assessment.status}; review stage: {assessment.reviewStage}.{' '}
                  Engine: {assessment.engineVersion ?? 'Not recorded'}.
                </p>

                <p>
                  <strong>Location:</strong> {assessment.county || 'Not recorded'} ·{' '}
                  {assessment.subCounty || 'Not recorded'} · {assessment.ward || 'Not recorded'}.{' '}
                  <strong>Collected:</strong> {formatDate(assessment.sampledAt)}.{' '}
                  <strong>Assessment created:</strong> {formatDate(assessment.createdAt)}.{' '}
                  <strong>Extension officer:</strong> {assessment.officerName || 'Not recorded'}.{' '}
                  <strong>GPS:</strong>{' '}
                  {assessment.latitude != null && assessment.longitude != null ? (
                    <>
                      {assessment.latitude.toFixed(5)}, {assessment.longitude.toFixed(5)}
                      {assessment.locationUncertaintyM != null ? (
                        <> (±{Number(assessment.locationUncertaintyM).toFixed(1)} m)</>
                      ) : (
                        <> (accuracy not recorded)</>
                      )}
                    </>
                  ) : (
                    'Not recorded'
                  )}
                </p>

                {assessment.engineBaseline.diagnoses.length > 0 && (
                  <div>
                    <h3>Soil diagnoses</h3>
                    <ul style={{ display: 'grid', gap: '0.75rem', paddingLeft: '1.25rem' }}>
                      {assessment.engineBaseline.diagnoses.map((diagnosis) => {
                        const field = 'interpretation' as const
                        const target = diagnosis.analyte
                        const key = adjustmentKey('diagnosis', target, field)
                        const saved = getSavedFieldValue(
                          assessment,
                          { section: 'diagnosis', target, field, value: '' },
                          diagnosis.interpretation,
                        )
                        return (
                          <li key={diagnosis.analyte} style={{ paddingLeft: '0.25rem' }}>
                            <strong>{diagnosis.analyte.replaceAll('_', ' ')}</strong>:{' '}
                            {diagnosis.value} ({diagnosis.status}; target {diagnosis.targetRange})
                            {isClaimedByCurrentUser ? (
                              <label className="auth-field">
                                <span>
                                  Reviewed interpretation: {diagnosis.analyte.replaceAll('_', ' ')}
                                </span>
                                <textarea
                                  value={draft.adjustments[key] ?? saved}
                                  onChange={(event) =>
                                    updateAdjustmentDraft(
                                      assessment.assessmentId,
                                      key,
                                      event.target.value,
                                    )
                                  }
                                  rows={2}
                                />
                              </label>
                            ) : (
                              <p>{saved}</p>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}

                {assessment.engineBaseline.prescriptions.length > 0 && (
                  <div>
                    <h3>Recommended prescriptions</h3>
                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                      {assessment.engineBaseline.prescriptions.map((prescription) => {
                        const target = `${prescription.category}::${prescription.productType}`
                        return (
                          <div
                            className="history-panel"
                            key={target}
                            style={{ padding: '0.75rem' }}
                          >
                            <strong>{prescription.productType}</strong> · {prescription.category}
                            {(['ratePerHa', 'ratePerAcre', 'applicationTiming'] as const).map(
                              (field) => {
                                const fieldLabel = {
                                  ratePerHa: 'Rate per hectare',
                                  ratePerAcre: 'Rate per acre',
                                  applicationTiming: 'Application timing',
                                }[field]
                                const key = adjustmentKey('prescription', target, field)
                                const saved = getSavedFieldValue(
                                  assessment,
                                  { section: 'prescription', target, field, value: '' },
                                  prescription[field],
                                )
                                const value = draft.adjustments[key] ?? saved
                                return isClaimedByCurrentUser ? (
                                  <label className="auth-field" key={field}>
                                    <span>{fieldLabel}</span>
                                    <input
                                      value={value}
                                      onChange={(event) =>
                                        updateAdjustmentDraft(
                                          assessment.assessmentId,
                                          key,
                                          event.target.value,
                                        )
                                      }
                                    />
                                  </label>
                                ) : (
                                  <p key={field}>
                                    <strong>{fieldLabel}:</strong> {value}
                                  </p>
                                )
                              },
                            )}
                          </div>
                        )
                      })}
                    </div>
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
                            <strong>
                              {edit.authorName} ({edit.role}):
                            </strong>{' '}
                            {edit.notes}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}

                {!isClaimedByCurrentUser && !isClaimedElsewhere && (
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
                        <span>Review note (optional when report fields are changed)</span>
                        <textarea
                          value={draft.notes}
                          onChange={(event) =>
                            updateDraft(assessment.assessmentId, 'notes', event.target.value)
                          }
                          rows={3}
                        />
                      </label>
                      <button className="secondary-button" type="submit" disabled={isBusy}>
                        Save report changes
                        {pendingAdjustments.length ? ` (${pendingAdjustments.length})` : ''}
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
                            updateDraft(
                              assessment.assessmentId,
                              'licenseNumber',
                              event.target.value,
                            )
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
                      <button
                        className="primary-button"
                        type="submit"
                        disabled={isBusy || pendingAdjustments.length > 0}
                      >
                        <CheckCircle2 size={16} /> Publish verified report
                      </button>
                      {pendingAdjustments.length > 0 && (
                        <p className="page-subtitle">
                          Save your {pendingAdjustments.length} unsaved report change(s) before
                          publishing.
                        </p>
                      )}
                    </form>
                  </>
                )}
              </article>
            )
          })}
        </div>
      ) : null}

      <p className="sidebar-note">
        <ShieldCheck size={16} /> Unverified assessment details are restricted to the assigned
        officer and claiming agronomist.
      </p>
    </section>
  )
}
