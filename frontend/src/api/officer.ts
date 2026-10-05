export interface OfficerJurisdiction {
  assignmentId: string
  designation?: 'county' | 'subcounty' | 'ward' | string | null
  county: string | null
  subCounty: string | null
  ward: string | null
  assignedAt: string
}

export interface OfficerFarmerRosterItem {
  farmerId: string
  name: string
  farmId: string | null
  farmName: string | null
  county: string | null
  subCounty: string | null
  ward: string | null
  readingCount: number
}

export interface OfficerVisitItem {
  visitId: string
  officerUserId?: string | null
  farmerId: string
  farmerName?: string | null
  farmerPhone?: string | null
  farmId?: string | null
  farmName?: string | null
  county?: string | null
  subCounty?: string | null
  ward?: string | null
  plannedDate?: string | null
  status: 'requested' | 'claimed' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
  notes?: string | null
  createdAt: string
  updatedAt: string
}

export interface OfficerAlertItem {
  alertId: string
  officerUserId?: string | null
  farmerId: string
  farmerName?: string | null
  farmId?: string | null
  farmName?: string | null
  source: string
  severity: 'info' | 'warning' | 'critical'
  status: 'open' | 'acknowledged' | 'resolved'
  title: string
  summary?: string | null
  notes?: string | null
  resolutionNotes?: string | null
  resolvedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface OfficerWardSummaryItem {
  county: string
  subCounty?: string | null
  ward: string
  farmerCount: number
  farmCount: number
  readingCount: number
  sampleCount: number
  aggregationLimits: string
  dataFreshness?: string | null
}

export interface OfficerExportResponse {
  exportId: string
  officerUserId: string
  scope: {
    county?: string | null
    subCounty?: string | null
    ward?: string | null
  }
  allowlistedFields: string[]
  privacyDisclaimer: string
  recordCount: number
  exportedAt: string
  records: Array<{
    readingId: string
    farmerName: string
    farmName: string | null
    county: string | null
    subCounty: string | null
    ward: string | null
    sampleYear?: number | null
    sampledAt?: string | null
    topCm?: number | null
    bottomCm?: number | null
    sourceProvider: string
    analyte: string
    value: number | null
    unit: string
    qualityStatus: string
  }>
}

async function officerRequest<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${accessToken}`)
  if (init.body) headers.set('Content-Type', 'application/json')

  const response = await fetch(path, { ...init, headers })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const detail =
      payload &&
      typeof payload === 'object' &&
      'detail' in payload &&
      typeof payload.detail === 'string'
        ? payload.detail
        : `SoilSync API returned HTTP ${response.status}`
    throw new Error(detail)
  }
  return payload as T
}

export function getOfficerJurisdictions(accessToken: string): Promise<OfficerJurisdiction[]> {
  return officerRequest<OfficerJurisdiction[]>(accessToken, '/api/v1/officer/jurisdictions')
}

export function getOfficerFarmerRoster(accessToken: string): Promise<OfficerFarmerRosterItem[]> {
  return officerRequest<OfficerFarmerRosterItem[]>(accessToken, '/api/v1/officer/farmers')
}

export function getOfficerVisits(accessToken: string): Promise<OfficerVisitItem[]> {
  return officerRequest<OfficerVisitItem[]>(accessToken, '/api/v1/officer/visits')
}

export function getOfficerVisitPool(accessToken: string): Promise<OfficerVisitItem[]> {
  return officerRequest<OfficerVisitItem[]>(accessToken, '/api/v1/officer/visit-pool')
}

export function claimOfficerVisit(accessToken: string, visitId: string): Promise<OfficerVisitItem> {
  return officerRequest<OfficerVisitItem>(
    accessToken,
    `/api/v1/officer/visits/${encodeURIComponent(visitId)}/claim`,
    {
      method: 'POST',
    },
  )
}

export function releaseOfficerVisit(
  accessToken: string,
  visitId: string,
): Promise<OfficerVisitItem> {
  return officerRequest<OfficerVisitItem>(
    accessToken,
    `/api/v1/officer/visits/${encodeURIComponent(visitId)}/release`,
    {
      method: 'POST',
    },
  )
}

export function scheduleOfficerVisit(
  accessToken: string,
  data: {
    farmerId: string
    farmId?: string | null
    plannedDate: string
    status?: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
    notes?: string | null
  },
): Promise<OfficerVisitItem> {
  return officerRequest<OfficerVisitItem>(accessToken, '/api/v1/officer/visits', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function updateOfficerVisit(
  accessToken: string,
  visitId: string,
  data: {
    plannedDate?: string | null
    status?: 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | null
    notes?: string | null
  },
): Promise<OfficerVisitItem> {
  return officerRequest<OfficerVisitItem>(
    accessToken,
    `/api/v1/officer/visits/${encodeURIComponent(visitId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(data),
    },
  )
}

export function getOfficerAlerts(accessToken: string): Promise<OfficerAlertItem[]> {
  return officerRequest<OfficerAlertItem[]>(accessToken, '/api/v1/officer/alerts')
}

export function createOfficerAlert(
  accessToken: string,
  data: {
    farmerId: string
    farmId?: string | null
    title: string
    summary?: string | null
    source: string
    severity: 'info' | 'warning' | 'critical'
    notes?: string | null
  },
): Promise<OfficerAlertItem> {
  return officerRequest<OfficerAlertItem>(accessToken, '/api/v1/officer/alerts', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function triageOfficerAlert(
  accessToken: string,
  alertId: string,
  data: {
    severity?: 'info' | 'warning' | 'critical' | null
    status?: 'open' | 'acknowledged' | 'resolved' | null
    notes?: string | null
    resolutionNotes?: string | null
  },
): Promise<OfficerAlertItem> {
  return officerRequest<OfficerAlertItem>(
    accessToken,
    `/api/v1/officer/alerts/${encodeURIComponent(alertId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(data),
    },
  )
}

export function getOfficerWardSummaries(accessToken: string): Promise<OfficerWardSummaryItem[]> {
  return officerRequest<OfficerWardSummaryItem[]>(accessToken, '/api/v1/officer/ward-summaries')
}

export function exportOfficerReport(
  accessToken: string,
  params: {
    county?: string | null
    subCounty?: string | null
    ward?: string | null
    format?: 'json' | 'csv'
  },
): Promise<OfficerExportResponse> {
  return officerRequest<OfficerExportResponse>(accessToken, '/api/v1/officer/reports/export', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export interface OfficerFieldCollectionData {
  latitude: number
  longitude: number
  locationUncertaintyM?: number | null
  topCm?: number
  bottomCm?: number
  measurements: Array<{
    analyte: string
    value: number
    sourceUnit: string
    qualityStatus?: string
  }>
  notes?: string | null
  markCompleted?: boolean
}

export function recordOfficerFieldCollection(
  accessToken: string,
  visitId: string,
  data: OfficerFieldCollectionData,
): Promise<{
  visitId: string
  farmId: string
  readingId: string
  latitude: number
  longitude: number
  status: string
  soilDataCollected: boolean
  message: string
}> {
  return officerRequest(
    accessToken,
    `/api/v1/officer/visits/${encodeURIComponent(visitId)}/field-collection`,
    {
      method: 'POST',
      body: JSON.stringify({
        latitude: data.latitude,
        longitude: data.longitude,
        location_uncertainty_m: data.locationUncertaintyM,
        top_cm: data.topCm ?? 0,
        bottom_cm: data.bottomCm ?? 20,
        measurements: data.measurements.map((m) => ({
          analyte: m.analyte,
          value: m.value,
          source_unit: m.sourceUnit,
          quality_status: m.qualityStatus ?? 'valid',
        })),
        notes: data.notes,
        mark_completed: data.markCompleted ?? true,
      }),
    },
  )
}

export interface UnverifiedAssessmentItem {
  assessmentId: string
  farmId: string
  farmName: string
  farmerName: string
  readingId: string
  visitId?: string | null
  officerUserId?: string | null
  claimingAgronomistId?: string | null
  status: 'unverified' | 'verified' | 'flagged'
  reviewStage: 'generated' | 'review_requested' | 'claimed' | 'under_review' | 'published'
  county: string
  subCounty?: string | null
  ward?: string | null
  officerName?: string | null
  sampledAt?: string | null
  latitude?: number | null
  longitude?: number | null
  locationUncertaintyM?: number | null
  crop: string
  engineVersion: string
  engineBaseline: {
    engineVersion: string
    crop: string
    farmAcreage: number
    regionalZone: string
    diagnoses: Array<{
      analyte: string
      value: number
      targetRange: string
      status: string
      interpretation: string
    }>
    prescriptions: Array<{
      category: string
      productType: string
      ratePerHa: string
      ratePerAcre: string
      totalFarmPrescription: string
      applicationTiming: string
    }>
    commercialInputs: Array<{
      category: string
      commercialFormulation: string
      purpose: string
      totalBagsNeeded: number
      bagUnit: string
    }>
    splitSchedule: Array<{
      stage: string
      action: string
      notes?: string
    }>
    aiAdvisoryNotes: string[]
    disclaimer: string
  }
  officerEdits: Array<{
    authorName: string
    role: string
    notes: string
    timestamp: string
  }>
  agronomistEdits: Array<{
    authorName: string
    role: string
    notes: string
    timestamp: string
    adjustments?: AssessmentAdjustment[]
  }>
  createdAt?: string | null
}

export interface AssessmentAdjustment {
  section: 'diagnosis' | 'prescription'
  target: string
  field: 'interpretation' | 'applicationTiming' | 'ratePerHa' | 'ratePerAcre'
  value: string
}

export function getUnverifiedAssessments(
  accessToken: string,
  county?: string,
): Promise<UnverifiedAssessmentItem[]> {
  const url = county
    ? `/api/v1/assessments/unverified?county=${encodeURIComponent(county)}`
    : '/api/v1/assessments/unverified'
  return officerRequest<UnverifiedAssessmentItem[]>(accessToken, url)
}

export function claimAssessment(
  accessToken: string,
  assessmentId: string,
): Promise<{
  assessmentId: string
  claimingAgronomistId: string
  reviewStage: string
  status: string
  message: string
}> {
  return officerRequest(
    accessToken,
    `/api/v1/assessments/${encodeURIComponent(assessmentId)}/claim`,
    { method: 'POST' },
  )
}

export function releaseAssessment(
  accessToken: string,
  assessmentId: string,
): Promise<{
  assessmentId: string
  reviewStage: string
  status: string
  message: string
}> {
  return officerRequest(
    accessToken,
    `/api/v1/assessments/${encodeURIComponent(assessmentId)}/release`,
    { method: 'POST' },
  )
}

export function editAssessment(
  accessToken: string,
  assessmentId: string,
  notes: string,
  adjustments?: AssessmentAdjustment[],
): Promise<{
  assessmentId: string
  status: string
  officerEdits: Array<Record<string, unknown>>
  agronomistEdits: Array<Record<string, unknown>>
  message: string
}> {
  return officerRequest(
    accessToken,
    `/api/v1/assessments/${encodeURIComponent(assessmentId)}/edit`,
    {
      method: 'POST',
      body: JSON.stringify({ notes, adjustments }),
    },
  )
}

export function publishAssessment(
  accessToken: string,
  assessmentId: string,
  data?: {
    licenseNumber?: string
    finalNotes?: string
  },
): Promise<{
  assessmentId: string
  status: 'verified'
  reviewStage: 'published'
  publishedAt: string
  verifiedReport: Record<string, unknown>
  message: string
}> {
  return officerRequest(
    accessToken,
    `/api/v1/assessments/${encodeURIComponent(assessmentId)}/publish`,
    {
      method: 'POST',
      body: JSON.stringify({
        license_number: data?.licenseNumber,
        final_notes: data?.finalNotes,
      }),
    },
  )
}

export interface UnclaimedFarmerItem {
  authUserId: string
  farmerUserId: string
  email: string
  fullName: string
  initialFarmId?: string | null
  initialFarmName?: string | null
  county?: string | null
  status: string
  reminderCount: number
  lastReminderAt?: string | null
  createdAt: string
  daysUntilExpiration: number
}

export interface RegisterUnclaimedFarmerPayload {
  email: string
  fullName: string
  farmName?: string | null
  county?: string | null
  subCounty?: string | null
  ward?: string | null
  sizeAcres?: number | null
  crops?: string | null
}

export function registerUnclaimedFarmer(
  accessToken: string,
  data: RegisterUnclaimedFarmerPayload,
): Promise<{
  authUserId: string
  farmerUserId: string
  email: string
  fullName: string
  initialFarmId?: string | null
  status: string
  role: string
  registeredAt: string
  message: string
}> {
  return officerRequest(accessToken, '/api/v1/officer/farmers/register-unclaimed', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function fetchUnclaimedFarmers(accessToken: string): Promise<UnclaimedFarmerItem[]> {
  return officerRequest(accessToken, '/api/v1/officer/unclaimed-farmers')
}
