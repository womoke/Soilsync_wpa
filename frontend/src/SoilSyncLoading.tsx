import { Leaf } from 'lucide-react'

interface SoilSyncLoadingProps {
  label: string
}

export function SoilSyncLoading({ label }: SoilSyncLoadingProps) {
  return (
    <div className="soilsync-loading" role="status" aria-label={label}>
      <span className="soilsync-loading-brand" aria-hidden="true">
        <span className="brand-mark soilsync-loading-mark">
          <Leaf size={22} strokeWidth={2.1} />
        </span>
        <span className="brand-name soilsync-loading-wordmark">
          Soil<span>Sync</span> <span className="brand-ai">AI</span>
        </span>
      </span>
      <span className="soilsync-loading-label">{label}</span>
    </div>
  )
}
