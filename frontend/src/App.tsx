import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FlaskConical,
  House,
  Info,
  Leaf,
  LogOut,
  MapPin,
  Moon,
  Plus,
  ShieldCheck,
  Settings,
  Sun,
  X,
} from 'lucide-react'
import { getAgrodealerCatalog, type AgrodealerCatalog } from './api/agrodealer'
import { getDashboardSeedData, type DashboardSeedData } from './api/dashboard'
import { getDemoRecommendations, getDemoSoilReading } from './api/soil'
import { AuthProvider, useAuth } from './context/AuthContext'
import { RouteGuard } from './RouteGuard'
import AuthEntry from './AuthEntry'
import ProfileSettings from './ProfileSettings'
import { SoilSyncLoading } from './SoilSyncLoading'
import { roleOptions, workflowByRole, type UserRole } from './mock/userRoles'
import type { SoilAnalyte, SoilReading, SoilReadingValues, SoilRecommendation } from './types/soil'
import './App.css'

const FarmerAccount = lazy(() => import('./FarmerAccount'))
const ExtensionOfficerAccount = lazy(() => import('./ExtensionOfficerAccount'))
const AgrodealerAccount = lazy(() => import('./AgrodealerAccount'))
const AgronomistAccount = lazy(() => import('./AgronomistAccount'))
const AdminAccount = lazy(() => import('./AdminAccount'))

type Theme = 'light' | 'dark'
export type Destination =
  'welcome' | 'farmer' | 'officer' | 'dealer' | 'agronomist' | 'admin' | 'workshop'

function getInitialDestination(): Destination {
  if (typeof window === 'undefined') return 'welcome'
  const path = window.location.pathname.toLowerCase()
  if (path === '/agronomist') return 'agronomist'
  if (path === '/workshop' && import.meta.env.MODE === 'test') return 'workshop'
  return 'welcome'
}

function getInitialRole(): UserRole {
  if (typeof window === 'undefined') return 'farmer'
  const path = window.location.pathname.toLowerCase()
  if (path === '/officer') return 'extension-officer'
  if (path === '/dealer') return 'agrodealer'
  if (path === '/admin') return 'admin'
  return 'farmer'
}

function getWorkspaceMode(destination: Destination) {
  if (destination === 'farmer') return 'farmer-account'
  if (destination === 'officer') return 'officer-account'
  if (destination === 'dealer') return 'dealer-account'
  if (destination === 'agronomist') return 'agronomist-account'
  if (destination === 'admin') return 'admin-account'
  return 'demo'
}

const emptyReading: SoilReadingValues = {
  soilPh: null,
  nitrogen: null,
  phosphorus: null,
  potassium: null,
  organicCarbon: null,
}

type ReadingField = keyof SoilReadingValues
type ReadingDraft = Record<ReadingField, string>
type RecommendationFeedback = 'viewed' | 'followed' | 'modified' | 'not-followed'

const recommendationFeedbackOptions: Array<{ value: RecommendationFeedback; label: string }> = [
  { value: 'viewed', label: 'Viewed' },
  { value: 'followed', label: 'Followed' },
  { value: 'modified', label: 'Modified' },
  { value: 'not-followed', label: 'Not followed' },
]

const readingFields: Array<{
  key: ReadingField
  label: string
  analyte: SoilAnalyte
  step: string
  max?: number
}> = [
  { key: 'soilPh', label: 'Soil pH', analyte: 'soil_ph', step: '0.1', max: 14 },
  { key: 'nitrogen', label: 'Total nitrogen', analyte: 'total_nitrogen', step: '0.01' },
  { key: 'phosphorus', label: 'Olsen phosphorus', analyte: 'olsen_phosphorus', step: '1' },
  {
    key: 'potassium',
    label: 'Exchangeable potassium',
    analyte: 'exchangeable_potassium',
    step: '0.01',
  },
  { key: 'organicCarbon', label: 'Organic carbon', analyte: 'organic_carbon', step: '0.1' },
]

function readSavedTheme(): Theme {
  try {
    return window.localStorage.getItem('soilsync-theme') === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function makeDraft(reading: SoilReadingValues): ReadingDraft {
  return Object.fromEntries(
    Object.entries(reading).map(([field, value]) => [field, value === null ? '' : String(value)]),
  ) as ReadingDraft
}

function formatReadingValue(value: number | null): string {
  return value === null
    ? 'Not entered'
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function formatStockUpdatedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Update date unavailable' : date.toLocaleDateString()
}

function formatSampleDate(value: string | null | undefined): string {
  if (!value) return 'Not supplied'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function toReadingValues(record: SoilReading): SoilReadingValues {
  const measurements = new Map(record.measurements.map((item) => [item.analyte, item.value]))
  return {
    soilPh: measurements.get('soil_ph') ?? null,
    nitrogen: measurements.get('total_nitrogen') ?? null,
    phosphorus: measurements.get('olsen_phosphorus') ?? null,
    potassium: measurements.get('exchangeable_potassium') ?? null,
    organicCarbon: measurements.get('organic_carbon') ?? null,
  }
}

function AppContent() {
  const {
    session,
    user,
    profile,
    activeRoles,
    isLoading,
    isInitializing,
    error,
    signOut,
  } = useAuth()
  const [theme, setTheme] = useState<Theme>(readSavedTheme)
  const [currentHash, setCurrentHash] = useState(() => window.location.hash)
  const [reading, setReading] = useState<SoilReadingValues>(emptyReading)
  const [draft, setDraft] = useState<ReadingDraft>(() => makeDraft(emptyReading))
  const [history, setHistory] = useState<SoilReadingValues[]>([])
  const [soilRecord, setSoilRecord] = useState<SoilReading | null>(null)
  const [recommendations, setRecommendations] = useState<SoilRecommendation[]>([])
  const [isOffline, setIsOffline] = useState<boolean>(
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  )
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isProfileSettingsOpen, setIsProfileSettingsOpen] = useState(false)
  const [isPreview, setIsPreview] = useState(false)
  const [workspaceMode, setWorkspaceMode] = useState<
    | 'demo'
    | 'farmer-account'
    | 'officer-account'
    | 'dealer-account'
    | 'agronomist-account'
    | 'admin-account'
  >(() => getWorkspaceMode(getInitialDestination()))
  const [destination, setDestination] = useState<Destination>(getInitialDestination)
  const [activeRole, setActiveRole] = useState<UserRole>(getInitialRole)
  const [recommendationFeedback, setRecommendationFeedback] = useState<
    Record<string, RecommendationFeedback>
  >({})

  const navigateTo = (path: string, replace = false) => {
    try {
      if (replace) window.history.replaceState({}, '', path)
      else window.history.pushState({}, '', path)
    } catch {
      // In restricted or virtual environments, continue safely
    }
    const clean = path.toLowerCase().split('?')[0].split('#')[0]
    if (clean === '/welcome') {
      setDestination('welcome')
      setWorkspaceMode('demo')
    } else if (clean === '/farmer') {
      setDestination('farmer')
      setActiveRole('farmer')
      setWorkspaceMode('farmer-account')
    } else if (clean === '/officer') {
      setDestination('officer')
      setActiveRole('extension-officer')
      setWorkspaceMode('officer-account')
    } else if (clean === '/dealer') {
      setDestination('dealer')
      setActiveRole('agrodealer')
      setWorkspaceMode('dealer-account')
    } else if (clean === '/agronomist') {
      setDestination('agronomist')
      setWorkspaceMode('agronomist-account')
    } else if (clean === '/admin') {
      setDestination('admin')
      setActiveRole('admin')
      setWorkspaceMode('admin-account')
    } else if (clean === '/workshop' && import.meta.env.MODE === 'test') {
      setDestination('workshop')
      setWorkspaceMode('demo')
    } else {
      setDestination('welcome')
      setActiveRole('farmer')
      setWorkspaceMode('demo')
    }
  }

  useEffect(() => {
    if (session && !isLoading && !error && activeRoles.length > 0 && destination === 'welcome') {
      queueMicrotask(() => {
        const path = typeof window !== 'undefined' ? window.location.pathname.toLowerCase() : ''
        if (path === '/admin' && activeRoles.includes('admin')) {
          navigateTo('/admin', true)
        } else if (path === '/officer' && activeRoles.includes('extension-officer')) {
          navigateTo('/officer', true)
        } else if (path === '/dealer' && activeRoles.includes('agrodealer')) {
          navigateTo('/dealer', true)
        } else if (path === '/agronomist' && activeRoles.includes('agronomist')) {
          navigateTo('/agronomist', true)
        } else if (path === '/farmer' && activeRoles.includes('farmer')) {
          navigateTo('/farmer', true)
        } else {
          const primaryPath = activeRoles.includes('admin')
            ? '/admin'
            : activeRoles.includes('extension-officer')
              ? '/officer'
              : activeRoles.includes('agronomist')
                ? '/agronomist'
                : activeRoles.includes('agrodealer')
                  ? '/dealer'
                  : '/farmer'
          navigateTo(primaryPath, true)
        }
      })
    }
  }, [session, isLoading, error, activeRoles, destination])

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname.toLowerCase()
      if (path === '/welcome') {
        setDestination('welcome')
        setWorkspaceMode('demo')
      } else if (path === '/farmer') {
        setDestination('farmer')
        setActiveRole('farmer')
        setWorkspaceMode('farmer-account')
      } else if (path === '/officer') {
        setDestination('officer')
        setActiveRole('extension-officer')
        setWorkspaceMode('officer-account')
      } else if (path === '/dealer') {
        setDestination('dealer')
        setActiveRole('agrodealer')
        setWorkspaceMode('dealer-account')
      } else if (path === '/agronomist') {
        setDestination('agronomist')
        setWorkspaceMode('agronomist-account')
      } else if (path === '/admin') {
        setDestination('admin')
        setActiveRole('admin')
        setWorkspaceMode('admin-account')
      } else if (path === '/workshop' && import.meta.env.MODE === 'test') {
        setDestination('workshop')
        setWorkspaceMode('demo')
      } else {
        setDestination('welcome')
        setWorkspaceMode('demo')
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])
  const [dashboardResponse, setDashboardResponse] = useState<{
    role: UserRole
    data: DashboardSeedData
  } | null>(null)
  const [soilDataError, setSoilDataError] = useState(false)
  const [recommendationDataError, setRecommendationDataError] = useState(false)
  const [dashboardDataError, setDashboardDataError] = useState(false)
  const [dealerCatalog, setDealerCatalog] = useState<AgrodealerCatalog | null>(null)
  const [dealerDataError, setDealerDataError] = useState(false)
  const currentRole = workflowByRole[activeRole]
  const activeAnchor = currentRole.navigation.some((item) => item.anchor === currentHash)
    ? currentHash
    : currentRole.navigation[0]?.anchor
  const dashboardSeed = dashboardResponse?.role === activeRole ? dashboardResponse.data : null
  const currentFarmer = dashboardSeed?.users.find((user) => user.role === 'farmer')
  const readingUnits = new Map(
    soilRecord?.measurements.map((measurement) => [measurement.analyte, measurement.sourceUnit]),
  )
  const readingQualities = new Map(
    soilRecord?.measurements.map((measurement) => [measurement.analyte, measurement.qualityStatus]),
  )
  const databaseError =
    activeRole === 'farmer'
      ? soilDataError || recommendationDataError || dashboardDataError
      : activeRole === 'agrodealer'
        ? dashboardDataError || dealerDataError
        : dashboardDataError

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      window.localStorage.setItem('soilsync-theme', theme)
    } catch {
      // Theme still works for the current session when storage is unavailable.
    }
  }, [theme])

  useEffect(() => {
    const updateCurrentHash = () => setCurrentHash(window.location.hash)
    window.addEventListener('hashchange', updateCurrentHash)
    return () => window.removeEventListener('hashchange', updateCurrentHash)
  }, [])

  useEffect(() => {
    const handleOnlineStatus = () => setIsOffline(!navigator.onLine)

    handleOnlineStatus()
    window.addEventListener('online', handleOnlineStatus)
    window.addEventListener('offline', handleOnlineStatus)

    return () => {
      window.removeEventListener('online', handleOnlineStatus)
      window.removeEventListener('offline', handleOnlineStatus)
    }
  }, [])

  useEffect(() => {
    if (workspaceMode !== 'demo' || destination !== 'workshop') return

    const controller = new AbortController()
    let active = true

    getDemoSoilReading(controller.signal)
      .then((record) => {
        if (!active) return
        const values = toReadingValues(record)
        setSoilRecord(record)
        setReading(values)
        setDraft(makeDraft(values))
        setHistory([values])
        setSoilDataError(false)
      })
      .catch(() => {
        if (active) setSoilDataError(true)
      })

    getDemoRecommendations(controller.signal)
      .then((recommendationList) => {
        if (active) {
          setRecommendations(recommendationList)
          setRecommendationDataError(false)
        }
      })
      .catch(() => {
        if (active) {
          setRecommendations([])
          setRecommendationDataError(true)
        }
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [destination, workspaceMode])

  useEffect(() => {
    if (workspaceMode !== 'demo' || destination !== 'workshop') return

    const controller = new AbortController()
    let active = true

    getDashboardSeedData(activeRole, controller.signal)
      .then((seedData) => {
        if (active) {
          setDashboardResponse({ role: activeRole, data: seedData })
          setDashboardDataError(false)
        }
      })
      .catch(() => {
        if (active) {
          setDashboardDataError(true)
        }
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [activeRole, destination, workspaceMode])

  useEffect(() => {
    if (workspaceMode !== 'demo' || activeRole !== 'agrodealer') return

    const controller = new AbortController()
    let active = true

    getAgrodealerCatalog(controller.signal)
      .then((catalog) => {
        if (active) {
          setDealerCatalog(catalog)
          setDealerDataError(false)
        }
      })
      .catch(() => {
        if (active) setDealerDataError(true)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [activeRole, workspaceMode])

  function previewReading(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextReading = Object.fromEntries(
      readingFields.map(({ key }) => [key, draft[key] === '' ? null : Number(draft[key])]),
    ) as SoilReadingValues
    setReading(nextReading)
    setIsPreview(true)
    setIsFormOpen(false)
  }

  function updateDraft(field: ReadingField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  function applyRecommendationFeedback(recommendationId: string, value: RecommendationFeedback) {
    setRecommendationFeedback((current) => {
      return { ...current, [recommendationId]: value }
    })
  }

  function renderRoleDashboard() {
    const officerWard = dashboardSeed?.users.find((user) => user.role === 'extension-officer')?.ward
    const officerFarmers = (dashboardSeed?.users ?? []).filter(
      (user) => user.role === 'farmer' && user.ward === officerWard,
    )
    const officerAlerts = dashboardSeed?.alerts ?? []
    const officerVisits = dashboardSeed?.farmVisits ?? []

    return (
      <div className="role-dashboard">
        <div className="page-heading">
          <div>
            <div className="eyebrow">ROLE WORKFLOW</div>
            <h1>{currentRole.label}</h1>
            <p className="page-subtitle">{currentRole.description}</p>
          </div>
          <button className="primary-button" type="button" onClick={() => setActiveRole('farmer')}>
            Return to farmer view
          </button>
        </div>

        <div className="demo-banner" role="note">
          <Info size={17} />
          <span>
            <strong>Database-backed workflow.</strong> Dashboard records are loaded from the
            configured system database.
          </span>
          <span className="demo-banner-tag">
            {databaseError ? 'UNAVAILABLE' : dashboardSeed ? 'CONNECTED' : 'LOADING'}
          </span>
        </div>

        <section className="overview-grid" aria-label="Role summary">
          {(dashboardSeed?.summaryCards ?? []).map((card) => (
            <article key={card.label} className="farm-panel role-panel">
              <div className="panel-kicker">
                <Activity size={16} /> {card.label}
              </div>
              <div className="score-placeholder role-score">{card.value}</div>
              <p className="role-card-note">{card.detail}</p>
            </article>
          ))}
          {dashboardSeed && dashboardSeed.summaryCards.length === 0 && (
            <p className="history-empty">No summary records are available for this role.</p>
          )}
          {!dashboardSeed && (
            databaseError ? (
              <p className="history-empty">Dashboard records are unavailable.</p>
            ) : (
              <SoilSyncLoading label="Loading dashboard records…" compact />
            )
          )}
        </section>

        {activeRole === 'extension-officer' && (
          <section className="role-detail-grid" aria-label="Extension officer dashboard">
            <article className="history-panel role-panel-block" id="farmers">
              <div className="section-heading">
                <div>
                  <div className="eyebrow">WARD VIEW</div>
                  <h2>Farmer roster</h2>
                </div>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setWorkspaceMode('officer-account')}
                >
                  Open Authenticated Officer Portal
                </button>
              </div>
              <div className="roster-list">
                {officerFarmers.map((farmer) => (
                  <div key={farmer.id} className="roster-item">
                    <div>
                      <strong>{farmer.name}</strong>
                      <span>{farmer.farmName ?? 'Farm pending'}</span>
                    </div>
                    <div className="roster-meta">
                      <span>{farmer.ward}</span>
                      <small>{farmer.status}</small>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="history-panel role-panel-block" id="alerts">
              <div className="section-heading">
                <div>
                  <div className="eyebrow">ALERTS</div>
                  <h2>Open alerts</h2>
                </div>
              </div>
              <div className="alert-list">
                {officerAlerts.map((alert) => (
                  <div key={alert.id} className="alert-item">
                    <div className="alert-heading">
                      <strong>{alert.title}</strong>
                      <span className={`alert-severity ${alert.severity}`}>{alert.severity}</span>
                    </div>
                    <span>{alert.owner}</span>
                    <p>{alert.summary}</p>
                  </div>
                ))}
              </div>
            </article>

            <article className="history-panel role-panel-block wide-panel" id="visits">
              <div className="section-heading">
                <div>
                  <div className="eyebrow">VISITS</div>
                  <h2>Planned visits</h2>
                </div>
              </div>
              <div className="visit-list">
                {officerVisits.map((visit) => (
                  <div key={`${visit.farmer}-${visit.date}`} className="visit-item">
                    <span>{visit.date}</span>
                    <strong>{visit.farmer}</strong>
                    <small>{visit.outcome}</small>
                    <em>{visit.status}</em>
                  </div>
                ))}
              </div>
            </article>
          </section>
        )}

        {activeRole === 'agrodealer' && (
          <section className="role-detail-grid" aria-label="Agrodealer catalog">
            <article className="history-panel role-panel-block wide-panel" id="inventory">
              <div
                className="section-heading"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div>
                  <div className="eyebrow">CATALOG</div>
                  <h2>Product catalog</h2>
                </div>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => setWorkspaceMode('dealer-account')}
                  style={{ fontSize: '0.85rem' }}
                >
                  Open Agrodealer Portal
                </button>
              </div>
              {dealerCatalog ? (
                <>
                  <div className="dealer-profile-summary">
                    <strong>{dealerCatalog.dealer.businessName}</strong>
                    <span>
                      {[
                        dealerCatalog.dealer.county,
                        dealerCatalog.dealer.subCounty,
                        dealerCatalog.dealer.ward,
                      ]
                        .filter((location): location is string => Boolean(location))
                        .join(' · ') || 'Administrative area not supplied'}
                    </span>
                    <span>
                      {dealerCatalog.dealer.locationVerified
                        ? 'Location verified'
                        : dealerCatalog.dealer.locationStatus === 'unavailable'
                          ? 'Location unavailable'
                          : 'Location unverified'}
                    </span>
                    {dealerCatalog.dealer.demo && <span>Demo profile</span>}
                  </div>
                  <div className="visit-list">
                    {dealerCatalog.products.map((product) => (
                      <div key={product.id} className="visit-item">
                        <span>{product.category}</span>
                        <strong>{product.name}</strong>
                        {product.description && <small>{product.description}</small>}
                        <small>
                          {product.stockQuantity} {product.stockUnit} · Updated{' '}
                          {formatStockUpdatedAt(product.stockUpdatedAt)}
                        </small>
                        <small>
                          {product.unitPrice === null
                            ? 'Price not supplied'
                            : `${product.unitPrice.toFixed(2)} ${product.currency}`}
                        </small>
                        {product.demo && <small>Demo stock record</small>}
                        <em>
                          {product.orderable
                            ? 'Order action is not implemented'
                            : 'Not available for ordering'}
                        </em>
                      </div>
                    ))}
                    {dealerCatalog.products.length === 0 && (
                      <p className="history-empty">
                        No listed products were returned by the database.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                dealerDataError ? (
                  <p className="history-empty">Dealer catalog unavailable.</p>
                ) : (
                  <SoilSyncLoading label="Loading dealer catalog…" compact />
                )
              )}
            </article>
          </section>
        )}

        {activeRole === 'admin' && (
          <section className="role-detail-grid" aria-label="Administration records">
            <article className="history-panel role-panel-block" id="users">
              <div className="section-heading">
                <div>
                  <div className="eyebrow">USERS</div>
                  <h2>System accounts</h2>
                </div>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setWorkspaceMode('admin-account')}
                >
                  Open Authenticated Admin Console
                </button>
              </div>
              <div className="roster-list">
                {(dashboardSeed?.users ?? []).map((user) => (
                  <div key={user.id} className="roster-item">
                    <div>
                      <strong>{user.name}</strong>
                      <span>{user.email}</span>
                    </div>
                    <div className="roster-meta">
                      <span>{user.role}</span>
                      <small>{user.status}</small>
                    </div>
                  </div>
                ))}
              </div>
            </article>
            <article className="history-panel role-panel-block" id="monitoring">
              <div className="section-heading">
                <div>
                  <div className="eyebrow">ALERTS</div>
                  <h2>System alerts</h2>
                </div>
              </div>
              <div className="alert-list">
                {(dashboardSeed?.alerts ?? []).map((alert) => (
                  <div key={alert.id} className="alert-item">
                    <div className="alert-heading">
                      <strong>{alert.title}</strong>
                      <span className={`alert-severity ${alert.severity}`}>{alert.severity}</span>
                    </div>
                    <span>{alert.owner}</span>
                    <p>{alert.summary}</p>
                  </div>
                ))}
              </div>
            </article>
          </section>
        )}

        <section className="role-grid">
          <article className="history-panel role-panel-block">
            <div className="section-heading">
              <div>
                <div className="eyebrow">NEXT ACTIONS</div>
                <h2>Priority queue</h2>
              </div>
            </div>
            <div className="history-list">
              {(dashboardSeed?.actionQueue ?? []).map((item, index) => (
                <div key={`${item.title}-${index}`} className="history-item">
                  <div className="history-pill">#{index + 1}</div>
                  <div className="history-details">
                    <strong>{item.title}</strong>
                    {item.note && <span>{item.note}</span>}
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="history-panel role-panel-block">
            <div className="section-heading">
              <div>
                <div className="eyebrow">LATEST ACTIVITY</div>
                <h2>Recent updates</h2>
              </div>
            </div>
            <div className="history-list">
              {(dashboardSeed?.recentItems ?? []).map((item) => (
                <div key={item.title} className="history-item">
                  <div className="history-pill status-pill">{item.status}</div>
                  <div className="history-details">
                    <strong>{item.title}</strong>
                    <span>{item.note}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>
      </div>
    )
  }

  if (isInitializing) {
    return <SoilSyncLoading label="Loading SoilSync AI…" fullScreen />
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#overview">
        Skip to main content
      </a>
      <header className="topbar">
        <a
          className="brand"
          href={
            session
              ? activeRoles.includes('admin')
                ? '/admin'
                : activeRoles.includes('extension-officer')
                  ? '/officer'
                  : activeRoles.includes('agronomist')
                    ? '/agronomist'
                    : activeRoles.includes('agrodealer')
                      ? '/dealer'
                      : '/farmer'
              : '/welcome'
          }
          onClick={(e) => {
            e.preventDefault()
            if (session) {
              const target = activeRoles.includes('admin')
                ? '/admin'
                : activeRoles.includes('extension-officer')
                  ? '/officer'
                  : activeRoles.includes('agronomist')
                    ? '/agronomist'
                    : activeRoles.includes('agrodealer')
                      ? '/dealer'
                      : '/farmer'
              navigateTo(target, true)
            } else {
              navigateTo('/welcome', true)
            }
          }}
          aria-label="SoilSync AI overview"
        >
          <span className="brand-mark">
            <Leaf size={19} strokeWidth={2.1} />
          </span>
          <span className="brand-name">
            Soil<span>Sync</span> <span className="brand-ai">AI</span>
          </span>
        </a>

        <div className="topbar-meta">
          {session && (
            <div className="topbar-user">
              <div className="topbar-user-info">
                <span className="topbar-user-name">
                  {profile?.fullName ||
                    (typeof user?.user_metadata?.display_name === 'string'
                      ? user.user_metadata.display_name
                      : null) ||
                    user?.email?.split('@')[0] ||
                    'User'}
                </span>
                <span className="topbar-user-role">
                  {activeRoles[0] ? activeRoles[0].replace('-', ' ') : 'Account'}
                </span>
              </div>
              <button
                className="topbar-signout-btn"
                type="button"
                onClick={() => setIsProfileSettingsOpen(true)}
                aria-label="Open profile settings"
              >
                <Settings size={15} />
                <span>Profile</span>
              </button>
              <button
                className="topbar-signout-btn"
                type="button"
                onClick={async () => {
                  await signOut()
                  navigateTo('/welcome', true)
                }}
                aria-label="Sign out"
              >
                <LogOut size={15} />
                <span>Sign out</span>
              </button>
            </div>
          )}

          <button
            className="icon-button theme-toggle"
            type="button"
            onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          >
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          {destination === 'workshop' && (
            <div className="role-switcher" role="group" aria-label="Select user workflow">
              {roleOptions.map((role) => (
                <button
                  key={role.key}
                  type="button"
                  className={`role-toggle ${activeRole === role.key ? 'is-selected' : ''}`}
                  onClick={() => {
                    setActiveRole(role.key)
                  }}
                  aria-pressed={activeRole === role.key}
                >
                  {role.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {destination === 'workshop' && (
        <div className="workshop-mode-indicator" role="status">
          <strong>
            <span className="workshop-mode-pill">Workshop Mode</span>
            Facilitated Presenter & Scenario Walkthrough
          </strong>
          <span>
            Illustrative synthetic data for demonstration only • Not actionable agronomic advice
          </span>
        </div>
      )}

      {destination === 'welcome' ? (
        <AuthEntry onAuthenticated={(path) => navigateTo(path, true)} />
      ) : destination === 'farmer' ? (
        <RouteGuard destination="farmer" onNavigate={(path) => navigateTo(path, true)}>
          <div className="app-workspace-shell">
            <Suspense
              fallback={
                <SoilSyncLoading label="Opening farmer workspace…" />
              }
            >
              <FarmerAccount
                onBackToDemo={() => navigateTo('/welcome', true)}
                roleVerifiedByRoute
              />
            </Suspense>
          </div>
        </RouteGuard>
      ) : destination === 'officer' ? (
        <RouteGuard destination="officer" onNavigate={(path) => navigateTo(path, true)}>
          <div className="app-workspace-shell">
            <Suspense
              fallback={
                <SoilSyncLoading label="Opening officer workspace…" />
              }
            >
              <ExtensionOfficerAccount
                onBackToDemo={() => navigateTo('/welcome', true)}
                roleVerifiedByRoute
              />
            </Suspense>
          </div>
        </RouteGuard>
      ) : destination === 'dealer' ? (
        <RouteGuard destination="dealer" onNavigate={(path) => navigateTo(path, true)}>
          <div className="app-workspace-shell">
            <Suspense
              fallback={
                <SoilSyncLoading label="Opening agrodealer workspace…" />
              }
            >
              <AgrodealerAccount
                onBackToDemo={() => navigateTo('/welcome', true)}
                roleVerifiedByRoute
              />
            </Suspense>
          </div>
        </RouteGuard>
      ) : destination === 'agronomist' ? (
        <RouteGuard destination="agronomist" onNavigate={(path) => navigateTo(path, true)}>
          <div className="app-workspace-shell">
            <Suspense
              fallback={
                <SoilSyncLoading label="Opening agronomist workspace…" />
              }
            >
              <AgronomistAccount onBackToDemo={() => navigateTo('/welcome', true)} />
            </Suspense>
          </div>
        </RouteGuard>
      ) : destination === 'admin' ? (
        <RouteGuard destination="admin" onNavigate={(path) => navigateTo(path, true)}>
          <div className="app-workspace-shell">
            <Suspense
              fallback={
                <SoilSyncLoading label="Opening admin workspace…" />
              }
            >
              <AdminAccount
                onBackToDemo={() => navigateTo('/welcome', true)}
                roleVerifiedByRoute
              />
            </Suspense>
          </div>
        </RouteGuard>
      ) : (
        <RouteGuard destination={destination} onNavigate={(path) => navigateTo(path, true)}>
          <div className="workspace">
            <aside className="sidebar" aria-label="Workspace navigation">
              <div className="workspace-caption">{currentRole.caption}</div>
              <nav className="side-nav">
                {currentRole.navigation.map((item, index) => (
                  <a
                    key={item.anchor}
                    className={`nav-link ${activeAnchor === item.anchor ? 'is-active' : ''}`}
                    href={item.anchor}
                    aria-current={activeAnchor === item.anchor ? 'page' : undefined}
                  >
                    {index === 0 ? (
                      <House size={17} />
                    ) : index === 1 ? (
                      <MapPin size={17} />
                    ) : index === 2 ? (
                      <FlaskConical size={17} />
                    ) : (
                      <ClipboardList size={17} />
                    )}
                    {item.label}
                  </a>
                ))}
              </nav>
              <div className="sidebar-note">
                <div className="sidebar-note-icon">
                  <ShieldCheck size={17} />
                </div>
                <p>Synthetic preview</p>
                <span>Role switching is for stakeholder demonstration only.</span>
              </div>
              <div className="sidebar-bottom">
                SOILSYNC AI <span>•</span> PREVIEW
              </div>
            </aside>

            <main className="main-content" id="overview">
              {activeRole === 'farmer' ? (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">YOUR FIELD AT A GLANCE</div>
                      <h1>Soil overview</h1>
                      <p className="page-subtitle">
                        A clear view of your soil record and what still needs review.
                      </p>
                    </div>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => setIsFormOpen(true)}
                    >
                      <Plus size={17} /> Add a reading
                    </button>
                  </div>

                  <div className="demo-banner" role="note">
                    <Info size={17} />
                    <span>
                      {databaseError ? (
                        <>
                          <strong>Database unavailable.</strong> Screen records are hidden until the
                          system database is connected.
                        </>
                      ) : (
                        <>
                          <strong>Seeded database record.</strong> Soil readings and workflow data
                          are loaded from the system database.
                        </>
                      )}
                    </span>
                    <span className="demo-banner-tag">
                      {databaseError
                        ? 'UNAVAILABLE'
                        : isPreview
                          ? 'LOCAL PREVIEW'
                          : isOffline
                            ? 'OFFLINE'
                            : soilRecord
                              ? 'DATABASE'
                              : 'LOADING'}
                    </span>
                  </div>

                  <section className="overview-grid" aria-label="Farm and soil summary">
                    <article className="farm-panel" id="farm">
                      <div className="farm-panel-top">
                        <span className="farm-icon">
                          <House size={18} />
                        </span>
                        <span className="record-tag">
                          {isPreview ? 'LOCAL PREVIEW' : soilRecord ? 'DATABASE' : 'NO RECORD'}
                        </span>
                      </div>
                      <h2>{currentFarmer?.farmName ?? 'Farm profile unavailable'}</h2>
                      <p className="farm-location">
                        <MapPin size={15} />
                        {currentFarmer?.ward ?? 'Ward unavailable'}
                        {soilRecord?.location.latitude !== null &&
                        soilRecord?.location.latitude !== undefined &&
                        soilRecord.location.longitude !== null &&
                        soilRecord.location.longitude !== undefined
                          ? ` · ${soilRecord.location.latitude}, ${soilRecord.location.longitude}`
                          : ''}
                      </p>
                      <div className="farm-divider" />
                      <div className="farm-facts">
                        <div>
                          <span>Latest record</span>
                          <strong>
                            {isPreview
                              ? 'Local preview'
                              : formatSampleDate(soilRecord?.sample.sampledAt)}
                          </strong>
                        </div>
                        <div>
                          <span>Sample depth</span>
                          <strong>{soilRecord?.sample.depth.sourceLabel ?? 'Not supplied'}</strong>
                        </div>
                        <div>
                          <span>Data source</span>
                          <strong>{soilRecord?.source.provider ?? 'Not available'}</strong>
                        </div>
                        <div>
                          <span>Attribution</span>
                          <strong>{soilRecord?.source.attribution ?? 'Not supplied'}</strong>
                        </div>
                      </div>
                    </article>

                    <article className="score-panel">
                      <div className="panel-kicker">
                        <Activity size={16} /> READING COVERAGE
                      </div>
                      <div className="score-placeholder">
                        {Object.values(reading).filter((value) => value !== null).length}
                        <span>/{readingFields.length}</span>
                      </div>
                      <div className="score-rule" />
                      <p>Measurements entered</p>
                      <span className="score-caption">
                        Soil health scoring is not available yet.
                      </span>
                      <div className="score-foot">
                        <ShieldCheck size={15} />
                        No unreviewed score shown
                      </div>
                    </article>
                  </section>

                  <section className="history-panel" aria-label="Recent readings">
                    <div className="section-heading">
                      <div>
                        <div className="eyebrow">READING HISTORY</div>
                        <h2>Recent readings</h2>
                      </div>
                      <span className="sample-status">
                        <span className="status-dot muted" />
                        {history.length} saved
                      </span>
                    </div>
                    <div className="history-list">
                      {history.length === 0 ? (
                        <p className="history-empty">
                          No soil reading records were returned by the database.
                        </p>
                      ) : (
                        history.map((entry, index) => (
                          <div
                            className="history-item"
                            key={`${index}-${formatReadingValue(entry.soilPh)}`}
                          >
                            <div className="history-pill">#{history.length - index}</div>
                            <div className="history-details">
                              <strong>{formatReadingValue(entry.soilPh ?? null)} pH</strong>
                              <span>
                                N {formatReadingValue(entry.nitrogen ?? null)}% · P{' '}
                                {formatReadingValue(entry.phosphorus ?? null)} ppm · K{' '}
                                {formatReadingValue(entry.potassium ?? null)} meq%
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>

                  <section className="measurements-section" id="measurements">
                    <div className="section-heading">
                      <div>
                        <div className="eyebrow">LAB MEASUREMENTS</div>
                        <h2>Soil readings</h2>
                      </div>
                      <span className="sample-status">
                        <span className="status-dot muted" />
                        {isPreview
                          ? 'Local preview'
                          : soilRecord
                            ? 'Database record'
                            : 'No database record'}
                      </span>
                    </div>
                    <div className="measurement-table" role="table" aria-label="Soil readings">
                      <div className="measurement-header" role="row">
                        <span role="columnheader">MEASURE</span>
                        <span role="columnheader">VALUE</span>
                        <span role="columnheader">SOURCE UNIT</span>
                        <span role="columnheader">QUALITY</span>
                      </div>
                      {readingFields.map((field) => (
                        <div className="measurement-row" role="row" key={field.key}>
                          <span className="measure-name" role="cell">
                            <span className="measure-mark" />
                            {field.label}
                          </span>
                          <strong role="cell">{formatReadingValue(reading[field.key])}</strong>
                          <span className="unit-value" role="cell">
                            {readingUnits.get(field.analyte) ?? 'Not available'}
                          </span>
                          <span className="interpretation" role="cell">
                            {isPreview
                              ? 'local preview'
                              : (readingQualities.get(field.analyte) ?? 'Not available')}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="table-footnote">
                      <Info size={14} /> Units are shown as stored in the database. Laboratory
                      methods and compatible units have not been validated.
                    </p>
                  </section>

                  <section className="guidance-panel" id="guidance">
                    <div className="guidance-icon">
                      <ClipboardList size={19} />
                    </div>
                    <div className="guidance-copy">
                      <div className="eyebrow">RECOMMENDATIONS</div>
                      {recommendations.length > 0 ? (
                        <>
                          <h2>Agronomic guidance</h2>
                          <div className="recommendation-caveat" role="note">
                            <AlertTriangle size={15} />
                            <span>
                              Workshop guidance is illustrative and is not agronomic advice.
                            </span>
                          </div>
                          <div>
                            {recommendations.map((recommendation) => {
                              const selectedFeedback =
                                recommendationFeedback[recommendation.recommendationId]

                              return (
                                <div
                                  key={recommendation.recommendationId}
                                  className="recommendation-card"
                                >
                                  <div className="recommendation-header">
                                    <h3>{recommendation.title}</h3>
                                    <span className="recommendation-version">
                                      v{recommendation.ruleVersion ?? 'prototype'}
                                    </span>
                                  </div>
                                  <div className="recommendation-context-row">
                                    <span className="context-badge">
                                      Crop: {recommendation.crop ?? 'not specified'}
                                    </span>
                                    <span className="context-badge">
                                      Farm context:{' '}
                                      {recommendation.farmId
                                        ? `linked to ${recommendation.farmId}`
                                        : 'local preview only'}
                                    </span>
                                  </div>
                                  <p>{recommendation.rationale}</p>
                                  <small>
                                    {recommendation.applicationRate !== null &&
                                    recommendation.applicationUnit
                                      ? `${recommendation.applicationRate} ${recommendation.applicationUnit}`
                                      : 'Rate pending'}
                                    {' · '}
                                    <span>
                                      {recommendation.reviewStatus === 'pending_review'
                                        ? 'Review pending'
                                        : 'Approved'}
                                    </span>
                                  </small>
                                  <div
                                    className="recommendation-feedback"
                                    aria-label={`Recommendation feedback for ${recommendation.title}`}
                                  >
                                    <span className="recommendation-feedback-label">Feedback</span>
                                    <div className="feedback-options">
                                      {recommendationFeedbackOptions.map((option) => (
                                        <button
                                          key={`${recommendation.recommendationId}-${option.value}`}
                                          type="button"
                                          className={`feedback-button ${selectedFeedback === option.value ? 'is-selected' : ''}`}
                                          aria-pressed={selectedFeedback === option.value}
                                          onClick={() =>
                                            applyRecommendationFeedback(
                                              recommendation.recommendationId,
                                              option.value,
                                            )
                                          }
                                        >
                                          {option.label}
                                        </button>
                                      ))}
                                    </div>
                                    <p className="recommendation-feedback-status">
                                      {selectedFeedback
                                        ? 'Feedback selected for review.'
                                        : 'No feedback recorded yet.'}
                                    </p>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </>
                      ) : (
                        <>
                          <h2>Guidance is not available yet</h2>
                          <p>
                            Thresholds and application rates are awaiting agronomic review. SoilSync
                            AI will not generate fertilizer advice from these sample values.
                          </p>
                        </>
                      )}
                    </div>
                    <span className="review-badge">
                      <span className="review-dot" />{' '}
                      {recommendations.length > 0 ? 'ILLUSTRATIVE' : 'REVIEW PENDING'}
                    </span>
                  </section>

                  <footer className="page-footer">
                    <span>SoilSync AI</span>
                    <span>Soil recommendations require verified data and agronomic review.</span>
                  </footer>
                </>
              ) : (
                renderRoleDashboard()
              )}
            </main>
          </div>
        </RouteGuard>
      )}

      {isFormOpen && (
        <div
          className="dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsFormOpen(false)
          }}
        >
          <section
            className="reading-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reading-dialog-title"
          >
            <div className="dialog-heading">
              <div>
                <div className="eyebrow">LOCAL PREVIEW ONLY</div>
                <h2 id="reading-dialog-title">Enter example readings</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={() => setIsFormOpen(false)}
                aria-label="Close form"
              >
                <X size={18} />
              </button>
            </div>
            <p className="dialog-explainer">
              Enter readings to preview them in this session. These values are not added to the
              database.
            </p>
            <form onSubmit={previewReading}>
              <div className="reading-input-grid">
                {readingFields.map((field) => (
                  <label className="field-control" key={field.key}>
                    <span>
                      {field.label}{' '}
                      <small>({readingUnits.get(field.analyte) ?? 'Unit unavailable'})</small>
                    </span>
                    <input
                      type="number"
                      min="0"
                      max={field.max}
                      step={field.step}
                      value={draft[field.key]}
                      onChange={(event) => updateDraft(field.key, event.target.value)}
                    />
                  </label>
                ))}
              </div>
              <div className="dialog-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                >
                  Cancel
                </button>
                <button className="primary-button" type="submit">
                  <CheckCircle2 size={16} /> Preview values
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {isPreview && (
        <span className="sr-only" role="status" aria-live="polite">
          Reading preview updated. Values are temporary and were not saved.
        </span>
      )}
      {isProfileSettingsOpen && <ProfileSettings onClose={() => setIsProfileSettingsOpen(false)} />}
      {destination === 'workshop' && (
        <div className="mobile-bottom-label">
          <ChevronRight size={14} /> Farmer workspace
        </div>
      )}
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}
