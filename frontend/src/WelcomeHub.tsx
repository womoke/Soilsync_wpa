import type { FC } from 'react'
import {
  Activity,
  ArrowRight,
  Database,
  FlaskConical,
  Lock,
  MapPin,
  Package,
  Shield,
  Sprout,
  Users,
} from 'lucide-react'

interface WelcomeHubProps {
  onSelectDestination: (destination: string) => void
}

export const WelcomeHub: FC<WelcomeHubProps> = ({ onSelectDestination }) => {
  return (
    <div className="welcome-hub" aria-label="SoilSync AI Welcome and Role Directory">
      {/* Hero Section */}
      <section className="welcome-hero">
        <div className="welcome-hero-badge">
          <Sprout size={16} className="text-emerald-500" />
          <span>National Agronomic Intelligence & Soil Health</span>
        </div>
        <h1 className="welcome-hero-title">
          Precision Soil Health & Localized Nutrient Intelligence for Kenyan Agriculture
        </h1>
        <p className="welcome-hero-subtitle">
          SoilSync AI bridges laboratory soil analysis, extension field guidance, and local agrodealer
          input supply to optimize crop yields and restore soil fertility across Kenya’s counties.
        </p>

        <div className="welcome-hero-actions">
          <button
            type="button"
            className="primary-button welcome-cta-primary"
            onClick={() => onSelectDestination('/farmer')}
          >
            <FlaskConical size={18} />
            <span>Open Farmer Workspace</span>
          </button>
        </div>
      </section>

      {/* Role Destinations Grid */}
      <section className="welcome-roles-section" aria-labelledby="roles-directory-heading">
        <div className="section-header-center">
          <div className="eyebrow">ADDRESSABLE ROLE WORKSPACES</div>
          <h2 id="roles-directory-heading">Select Your Role Destination</h2>
          <p>
            Each stakeholder role has a dedicated, directly addressable operational environment.
          </p>
        </div>

        <div className="welcome-roles-grid">
          {/* 1. Farmer Card */}
          <article className="welcome-role-card">
            <div className="welcome-card-header">
              <div className="role-icon-box role-icon-farmer">
                <Sprout size={24} />
              </div>
              <span className="destination-badge">/farmer</span>
            </div>
            <h3>Smallholder Farmer</h3>
            <p>
              View measured soil pH, nitrogen, phosphorus, and potassium levels. Receive
              crop-specific fertilizer recommendations and manage offline drafts.
            </p>
            <ul className="welcome-card-features">
              <li>Verified phone OTP authentication</li>
              <li>Multi-farm ownership and field boundaries</li>
              <li>Offline draft capture and conflict-safe sync</li>
            </ul>
            <button
              type="button"
              className="role-card-button"
              onClick={() => onSelectDestination('/farmer')}
            >
              <span>Enter Farmer Workspace</span>
              <ArrowRight size={16} />
            </button>
          </article>

          {/* 2. Extension Officer Card */}
          <article className="welcome-role-card">
            <div className="welcome-card-header">
              <div className="role-icon-box role-icon-officer">
                <Users size={24} />
              </div>
              <span className="destination-badge">/officer</span>
            </div>
            <h3>Extension Officer</h3>
            <p>
              Supervise assigned county and ward jurisdictions. Monitor soil acidity hotspots,
              schedule on-farm visits, and triage agronomic alerts.
            </p>
            <ul className="welcome-card-features">
              <li>Ward jurisdiction-bound roster queries</li>
              <li>Agronomic alert triage and action notes</li>
              <li>Privacy-preserving report exports</li>
            </ul>
            <button
              type="button"
              className="role-card-button"
              onClick={() => onSelectDestination('/officer')}
            >
              <span>Enter Officer Portal</span>
              <ArrowRight size={16} />
            </button>
          </article>

          {/* 3. Agrodealer Card */}
          <article className="welcome-role-card">
            <div className="welcome-card-header">
              <div className="role-icon-box role-icon-dealer">
                <Package size={24} />
              </div>
              <span className="destination-badge">/dealer</span>
            </div>
            <h3>Agrodealer</h3>
            <p>
              Manage verified input inventory (lime, NPK, certified seeds). Maintain stock freshness
              dates and fulfill customer collection orders.
            </p>
            <ul className="welcome-card-features">
              <li>7-day and 14-day stock freshness tags</li>
              <li>Verified GPS shop coordinates with consent</li>
              <li>Customer proximity and ward fallback routing</li>
            </ul>
            <button
              type="button"
              className="role-card-button"
              onClick={() => onSelectDestination('/dealer')}
            >
              <span>Enter Dealer Portal</span>
              <ArrowRight size={16} />
            </button>
          </article>

          {/* 4. Administrator Card */}
          <article className="welcome-role-card">
            <div className="welcome-card-header">
              <div className="role-icon-box role-icon-admin">
                <Shield size={24} />
              </div>
              <span className="destination-badge">/admin</span>
            </div>
            <h3>System Administrator</h3>
            <p>
              Govern platform security, approve officer and dealer accounts, audit administrative
              actions, and manage break-glass support grants.
            </p>
            <ul className="welcome-card-features">
              <li>Account lifecycle and role suspension flows</li>
              <li>Time-limited break-glass support access</li>
              <li>Anonymized telemetry without personal PII</li>
            </ul>
            <button
              type="button"
              className="role-card-button"
              onClick={() => onSelectDestination('/admin')}
            >
              <span>Enter Admin Console</span>
              <ArrowRight size={16} />
            </button>
          </article>
        </div>
      </section>

      {/* Trust & Architecture Badges */}
      <section className="welcome-trust-strip">
        <div className="trust-pill">
          <Database size={16} />
          <span>PostgreSQL + PostGIS Geospatial Engine</span>
        </div>
        <div className="trust-pill">
          <Lock size={16} />
          <span>Row-Level Security (RLS) Default Deny</span>
        </div>
        <div className="trust-pill">
          <Activity size={16} />
          <span>Strict Anonymization & PII Minimization</span>
        </div>
        <div className="trust-pill">
          <MapPin size={16} />
          <span>County & Ward Jurisdictional Scoping</span>
        </div>
      </section>
    </div>
  )
}

export default WelcomeHub
