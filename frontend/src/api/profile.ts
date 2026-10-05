export interface EditableProfile {
  id: string
  fullName: string
  county: string | null
  subCounty: string | null
  ward: string | null
  phoneNumber: string | null
}

export async function updateOwnProfile(
  token: string,
  payload: { full_name: string; phone_number: string | null },
): Promise<EditableProfile> {
  const response = await fetch('/api/v1/profile/me', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const detail =
      body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string'
        ? body.detail
        : `Failed to update profile (HTTP ${response.status}).`
    throw new Error(detail)
  }
  if (!body || typeof body !== 'object') {
    throw new Error('Profile update returned an invalid response.')
  }

  const profile = body as Partial<EditableProfile>
  if (
    typeof profile.id !== 'string' ||
    typeof profile.fullName !== 'string' ||
    !(profile.county === null || typeof profile.county === 'string') ||
    !(profile.subCounty === null || typeof profile.subCounty === 'string') ||
    !(profile.ward === null || typeof profile.ward === 'string') ||
    !(profile.phoneNumber === null || typeof profile.phoneNumber === 'string')
  ) {
    throw new Error('Profile update returned an invalid response.')
  }
  return {
    id: profile.id,
    fullName: profile.fullName,
    county: profile.county,
    subCounty: profile.subCounty,
    ward: profile.ward,
    phoneNumber: profile.phoneNumber,
  }
}
