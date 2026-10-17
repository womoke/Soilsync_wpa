export type SoilDataProvider =
  | 'ISDA_SOIL'
  | 'PROJECT_SOIL_DATASET'
  | 'ISRIC_WOSIS'
  | 'ISRIC_SOILGRIDS'
  | 'FARMER_OBSERVATION'
  | 'OFFICER_FIELD_COLLECTION'
  | 'DEMO'

export type SoilAnalyte =
  | 'soil_ph'
  | 'total_nitrogen'
  | 'organic_carbon'
  | 'olsen_phosphorus'
  | 'exchangeable_potassium'
  | 'extractable_phosphorus'
  | 'extractable_potassium'

export type SoilMeasurementQuality =
  | 'valid'
  | 'missing'
  | 'invalid_source_value'
  | 'unsupported_depth_or_method'
  | 'estimated'
  | 'sample'

export interface SoilMeasurement {
  analyte: SoilAnalyte
  value: number | null
  sourceUnit: string
  canonicalUnit: string | null
  analyticalMethod: string | null
  qualityStatus: SoilMeasurementQuality
  sourceValueText?: string | null
  depthLayer?: string | null
  depthTopCm?: number | null
  depthBottomCm?: number | null
  transformations?: string[]
  normalizationError?: string | null
  uncertainty: {
    intervalLevel: number | null
    lower: number | null
    upper: number | null
  } | null
}

export interface SoilReading {
  contractVersion: 1 | 2
  readingId: string
  farmId: string | null
  source: {
    provider: SoilDataProvider
    datasetId: string | null
    datasetVersion?: string | null
    recordId: string | null
    license: string | null
    attribution: string | null
    retrievedAt: string | null
  }
  sample: {
    sampledAt: string | null
    sampleYear: number | null
    depth: {
      sourceLabel: string | null
      topCm: number | null
      bottomCm: number | null
    }
  }
  location: {
    latitude: number | null
    longitude: number | null
    uncertaintyM: number | null
  }
  measurements: SoilMeasurement[]
}

export interface SoilRecommendation {
  recommendationId: string
  farmId: string | null
  crop: string | null
  title: string
  rationale: string
  applicationRate: number | null
  applicationUnit: string | null
  ruleVersion: string | null
  reviewStatus: 'pending_review' | 'approved'
}

export type SoilReadingValues = {
  soilPh: number | null
  nitrogen: number | null
  phosphorus: number | null
  potassium: number | null
  organicCarbon: number | null
}
