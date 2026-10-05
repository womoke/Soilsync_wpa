import { Leaf } from 'lucide-react'

interface SoilSyncLoadingProps {
  label: string
  compact?: boolean
  fullScreen?: boolean
}

export function SoilSyncLoading({
  label,
  compact = false,
  fullScreen = false,
}: SoilSyncLoadingProps) {
  return (
    <div
      className={`soilsync-loading${compact ? ' soilsync-loading-compact' : ''}${fullScreen ? ' soilsync-loading-fullscreen' : ''}`}
      role="status"
      aria-label={label}
    >
      <span className="soilsync-loading-brand" aria-hidden="true">
        <span className="soilsync-loading-mark-shell">
          <span className="soilsync-loading-orbit" />
          <span className="brand-mark soilsync-loading-mark">
            <Leaf size={32} strokeWidth={2.1} />
          </span>
        </span>
        <span className="brand-name soilsync-loading-wordmark">
          Soil<span>Sync</span> <span className="brand-ai">AI</span>
        </span>
      </span>
    </div>
  )
}
