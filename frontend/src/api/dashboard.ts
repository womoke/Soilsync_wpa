export type DashboardUser = {
  id: string
  name: string
  role: 'farmer' | 'extension-officer' | 'agrodealer' | 'admin'
  email: string
  ward: string
  farmName?: string
  status: 'active' | 'review' | 'draft' | 'monitoring'
}

export type DashboardCard = {
  label: string
  value: string
  detail: string
}

export type DashboardWorkItem = {
  title: string
  note: string
  status: string
}

export type DashboardAlert = {
  id: string
  title: string
  owner: string
  category: 'soil' | 'ops' | 'inventory' | 'access'
  severity: 'low' | 'medium' | 'high'
  summary: string
}

export type DashboardVisit = {
  farmer: string
  date: string
  outcome: string
  status: 'Open' | 'Pending' | 'Queued'
}

export type DashboardSeedData = {
  users: DashboardUser[]
  alerts: DashboardAlert[]
  farmVisits: DashboardVisit[]
  summaryCards: DashboardCard[]
  actionQueue: DashboardWorkItem[]
  recentItems: DashboardWorkItem[]
}

function isDashboardUser(value: unknown): value is DashboardUser {
  if (!value || typeof value !== 'object') return false
  const user = value as Partial<DashboardUser>
  return (
    typeof user.id === 'string' &&
    typeof user.name === 'string' &&
    typeof user.role === 'string' &&
    typeof user.email === 'string' &&
    typeof user.ward === 'string' &&
    typeof user.status === 'string'
  )
}

function isDashboardAlert(value: unknown): value is DashboardAlert {
  if (!value || typeof value !== 'object') return false
  const alert = value as Partial<DashboardAlert>
  return (
    typeof alert.id === 'string' &&
    typeof alert.title === 'string' &&
    typeof alert.owner === 'string' &&
    typeof alert.category === 'string' &&
    typeof alert.severity === 'string' &&
    typeof alert.summary === 'string'
  )
}

function isDashboardVisit(value: unknown): value is DashboardVisit {
  if (!value || typeof value !== 'object') return false
  const visit = value as Partial<DashboardVisit>
  return (
    typeof visit.farmer === 'string' &&
    typeof visit.date === 'string' &&
    typeof visit.outcome === 'string' &&
    typeof visit.status === 'string'
  )
}

function isDashboardCard(value: unknown): value is DashboardCard {
  if (!value || typeof value !== 'object') return false
  const card = value as Partial<DashboardCard>
  return (
    typeof card.label === 'string' &&
    typeof card.value === 'string' &&
    typeof card.detail === 'string'
  )
}

function isDashboardWorkItem(value: unknown): value is DashboardWorkItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<DashboardWorkItem>
  return (
    typeof item.title === 'string' &&
    typeof item.note === 'string' &&
    typeof item.status === 'string'
  )
}

export async function getDashboardSeedData(
  role: DashboardUser['role'],
  signal?: AbortSignal,
): Promise<DashboardSeedData> {
  const response = await fetch(
    `/api/v1/demo/dashboard/seed-data?role=${encodeURIComponent(role)}`,
    { signal },
  )
  if (!response.ok) {
    throw new Error(`SoilSync dashboard API returned HTTP ${response.status}`)
  }

  const payload: unknown = await response.json()
  if (
    !payload ||
    typeof payload !== 'object' ||
    !Array.isArray((payload as Partial<DashboardSeedData>).users) ||
    !Array.isArray((payload as Partial<DashboardSeedData>).alerts) ||
    !Array.isArray((payload as Partial<DashboardSeedData>).farmVisits) ||
    !Array.isArray((payload as Partial<DashboardSeedData>).summaryCards) ||
    !Array.isArray((payload as Partial<DashboardSeedData>).actionQueue) ||
    !Array.isArray((payload as Partial<DashboardSeedData>).recentItems)
  ) {
    throw new Error('SoilSync dashboard API returned an unsupported payload')
  }

  const seedData = payload as DashboardSeedData
  if (
    !seedData.users.every(isDashboardUser) ||
    !seedData.alerts.every(isDashboardAlert) ||
    !seedData.farmVisits.every(isDashboardVisit) ||
    !seedData.summaryCards?.every(isDashboardCard) ||
    !seedData.actionQueue?.every(isDashboardWorkItem) ||
    !seedData.recentItems?.every(isDashboardWorkItem)
  ) {
    throw new Error('SoilSync dashboard API returned invalid dashboard records')
  }

  return {
    users: seedData.users,
    alerts: seedData.alerts,
    farmVisits: seedData.farmVisits,
    summaryCards: seedData.summaryCards,
    actionQueue: seedData.actionQueue,
    recentItems: seedData.recentItems,
  }
}
