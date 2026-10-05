import type { SoilReading, SoilRecommendation } from '../types/soil'

export interface FarmerFarm {
  farmId: string
  name: string
  county: string | null
  subCounty?: string | null
  ward: string | null
  sizeAcres?: number | null
  crops?: string | null
  latitude: number | null
  longitude: number | null
  coordinatesCaptured?: boolean
  coordinatesCapturedBy?: string | null
  coordinatesCapturedAt?: string | null
  soilDataCollected?: boolean
  hasVisitRequest?: boolean
  visitStatus?: string | null
  isIncomplete?: boolean
  ownerVerified: boolean
  createdAt: string
  updatedAt: string
}

export interface FarmerProfile {
  farmerId: string
  name: string | null
  phone: string | null
  farmId: string | null
  farmName: string | null
  ownerVerified: boolean
  farms: FarmerFarm[]
}

export interface RecommendationFeedback {
  feedbackId: string
  recommendationId: string
  response: 'viewed' | 'followed' | 'modified' | 'not-followed'
  createdAt: string
}

async function farmerRequest<T>(
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
    throw new FarmerApiError(detail, response.status)
  }
  return payload as T
}

class FarmerApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'FarmerApiError'
  }
}

export function linkFarmerAccount(accessToken: string, displayName?: string) {
  return farmerRequest<{
    status: 'linked'
    appUserId: string
    identityProvider: 'supabase'
    role: string
  }>(accessToken, '/api/v1/auth/link', {
    method: 'POST',
    body: JSON.stringify(displayName ? { displayName } : {}),
  })
}

export function getFarmerProfile(accessToken: string) {
  return farmerRequest<FarmerProfile>(accessToken, '/api/v1/farms/me')
}

export function getFarmerFarms(accessToken: string) {
  return farmerRequest<FarmerFarm[]>(accessToken, '/api/v1/farms')
}

export function createFarmerFarm(
  accessToken: string,
  farm: {
    name: string
    county?: string
    subCounty?: string
    ward?: string
    sizeAcres?: number | null
    crops?: string | null
  },
) {
  return farmerRequest<FarmerFarm>(accessToken, '/api/v1/farms', {
    method: 'POST',
    body: JSON.stringify({
      name: farm.name,
      county: farm.county,
      subCounty: farm.subCounty,
      ward: farm.ward,
      size_acres: farm.sizeAcres,
      crops: farm.crops,
    }),
  })
}

export function requestFarmerFieldVisit(accessToken: string, farmId: string, notes?: string) {
  return farmerRequest<{
    requestId: string
    farmId: string
    status: string
    message: string
    createdAt: string
  }>(accessToken, `/api/v1/farms/${encodeURIComponent(farmId)}/visit-request`, {
    method: 'POST',
    body: JSON.stringify(notes ? { notes } : {}),
  })
}

export function getFarmerReadings(accessToken: string, farmId: string) {
  return farmerRequest<SoilReading[]>(
    accessToken,
    `/api/v1/farms/${encodeURIComponent(farmId)}/readings`,
  )
}

export function createFarmerReading(
  accessToken: string,
  farmId: string,
  reading: {
    sourceLabel?: string
    sampledAt?: string
    measurements: Array<{
      analyte: SoilReading['measurements'][number]['analyte']
      value: number | null
      sourceUnit: string
      qualityStatus: SoilReading['measurements'][number]['qualityStatus']
    }>
  },
) {
  return farmerRequest<SoilReading>(
    accessToken,
    `/api/v1/farms/${encodeURIComponent(farmId)}/readings`,
    {
      method: 'POST',
      body: JSON.stringify(reading),
    },
  )
}

export function getFarmerRecommendations(accessToken: string, farmId: string) {
  return farmerRequest<SoilRecommendation[]>(
    accessToken,
    `/api/v1/farms/${encodeURIComponent(farmId)}/recommendations`,
  )
}

export function saveRecommendationFeedback(
  accessToken: string,
  recommendationId: string,
  response: RecommendationFeedback['response'],
) {
  return farmerRequest<RecommendationFeedback>(
    accessToken,
    `/api/v1/recommendations/${encodeURIComponent(recommendationId)}/feedback`,
    { method: 'POST', body: JSON.stringify({ response }) },
  )
}

export function getRecommendationFeedback(accessToken: string, recommendationId: string) {
  return farmerRequest<RecommendationFeedback[]>(
    accessToken,
    `/api/v1/recommendations/${encodeURIComponent(recommendationId)}/feedback`,
  )
}

export interface FarmSyncStatus {
  status: 'ready' | 'ownership_review_pending'
  ready: boolean
  offlineDrafts: number
  pendingSyncs: number
  farmId: string | null
  ownerFarmerId: string
  currentStep: string
  requiresOwnerApproval: boolean
  message: string
}

export interface SyncDraftResult {
  status: 'draft_created'
  draftId: string
  draftType: string
  farmId: string
  ownerFarmerId: string
  version: number
  message: string
}

export interface SyncSubmitResult {
  status: 'queued' | 'conflict' | 'not_found' | 'ownership_pending'
  queueId?: string
  draftId?: string
  statusMessage?: string
  message?: string
}

export function getFarmerSyncStatus(accessToken: string) {
  return farmerRequest<FarmSyncStatus>(accessToken, '/api/v1/farms/sync-status')
}

export function createFarmerSyncDraft(
  accessToken: string,
  draft: {
    draftType: string
    payload: Record<string, unknown>
    version?: number
    clientDraftId?: string
  },
) {
  return farmerRequest<SyncDraftResult>(accessToken, '/api/v1/farms/sync-drafts', {
    method: 'POST',
    body: JSON.stringify({
      draftType: draft.draftType,
      payload: draft.payload,
      version: draft.version ?? 1,
      clientDraftId: draft.clientDraftId,
    }),
  })
}

export function submitFarmerSyncDraft(
  accessToken: string,
  submission: {
    draftId: string
    payload: Record<string, unknown>
  },
) {
  return farmerRequest<SyncSubmitResult>(accessToken, '/api/v1/farms/sync-submit', {
    method: 'POST',
    body: JSON.stringify({
      draftId: submission.draftId,
      payload: submission.payload,
    }),
  })
}

export interface VerifiedSoilReport {
  reportId: string
  assessmentId: string
  farmId: string
  farmName: string
  crop: string
  county: string
  subCounty?: string | null
  ward?: string | null
  assessedAt?: string | null
  sampledAt?: string | null
  officerName?: string | null
  publishedAt: string
  publishedBy: {
    agronomistId: string
    name: string
    licenseNumber: string
  }
  status: 'verified'
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
  certification: string
  finalAgronomistNotes?: string
}

export async function getFarmVerifiedReport(
  accessToken: string,
  farmId: string,
): Promise<VerifiedSoilReport | null> {
  try {
    return await farmerRequest<VerifiedSoilReport>(
      accessToken,
      `/api/v1/farms/${encodeURIComponent(farmId)}/reports/verified`,
    )
  } catch (error) {
    if (error instanceof FarmerApiError && error.status === 404) return null
    throw error
  }
}
