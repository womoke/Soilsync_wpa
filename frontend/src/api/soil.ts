import type { SoilReading, SoilRecommendation } from '../types/soil'

const DEMO_READING_PATH = '/api/v1/demo/soil-reading'
const DEMO_RECOMMENDATIONS_PATH = '/api/v1/demo/recommendations'
function isDemoSoilReading(value: unknown): value is SoilReading {
  if (typeof value !== 'object' || value === null) return false

  const reading = value as Partial<SoilReading>
  return (
    reading.contractVersion === 1 &&
    typeof reading.readingId === 'string' &&
    reading.source?.provider === 'DEMO' &&
    Array.isArray(reading.measurements) &&
    typeof reading.sample === 'object' &&
    reading.sample !== null &&
    typeof reading.location === 'object' &&
    reading.location !== null
  )
}

function isSoilRecommendation(value: unknown): value is SoilRecommendation {
  if (typeof value !== 'object' || value === null) return false

  const recommendation = value as Partial<SoilRecommendation>
  return (
    typeof recommendation.recommendationId === 'string' &&
    typeof recommendation.title === 'string' &&
    typeof recommendation.rationale === 'string' &&
    recommendation.reviewStatus === 'pending_review'
  )
}

export async function getDemoSoilReading(signal?: AbortSignal): Promise<SoilReading> {
  const response = await fetch(DEMO_READING_PATH, { signal })
  if (!response.ok) {
    throw new Error(`SoilSync API returned HTTP ${response.status}`)
  }

  const payload: unknown = await response.json()
  if (!isDemoSoilReading(payload)) {
    throw new Error('SoilSync API returned an unsupported demo reading')
  }

  return payload
}

export async function getDemoRecommendations(signal?: AbortSignal): Promise<SoilRecommendation[]> {
  const response = await fetch(DEMO_RECOMMENDATIONS_PATH, { signal })
  if (!response.ok) {
    throw new Error(`SoilSync recommendations API returned HTTP ${response.status}`)
  }

  const payload: unknown = await response.json()
  if (!Array.isArray(payload) || !payload.every(isSoilRecommendation)) {
    throw new Error('SoilSync recommendations API returned an unsupported payload')
  }

  return payload
}
