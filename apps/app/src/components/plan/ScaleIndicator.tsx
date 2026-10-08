import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { useCanvasOverlayScale } from '@/contexts/CanvasOverlayScaleContext'
import { calculatePxPerMeter } from '@/hooks/plan/usePlanScale'
import type { Floor } from '@/types/schema'
import { readLegacyCompatibilityFloors } from '@/lib/projectV2/buildingFloors'

function ScaleIndicator() {
  const currentProject = useProjectStore((state) => state.currentProject)
  const activeFloorId = useUIStore((state) => state.activeFloorId)
  const planView = useUIStore((state) => state.planView)
  const { scale } = useCanvasOverlayScale()

  const activeFloor = activeFloorId
    ? (currentProject ? readLegacyCompatibilityFloors(currentProject) : []).find(
        (f: Floor) => f.id === activeFloorId
      )
    : null

  const pxPerMeter = calculatePxPerMeter(activeFloor ?? null)
  if (!pxPerMeter) return null

  // Calculate scale at current zoom level
  const scaleAtZoom = pxPerMeter * planView.zoom

  // Calculate a nice round number for display (e.g., 1m, 2m, 5m, 10m)
  // We want to show a ruler that's about 100-200 pixels wide
  const targetPixels = 150
  const targetMeters = targetPixels / scaleAtZoom
  const niceMeters = Math.pow(10, Math.floor(Math.log10(targetMeters)))
  const roundedMeters = Math.round(targetMeters / niceMeters) * niceMeters
  const displayPixels = roundedMeters * scaleAtZoom

  return (
    <div
      className="pointer-events-none absolute bottom-4 left-4 z-10 select-none"
      style={{ transform: `scale(${scale})`, transformOrigin: 'bottom left' }}
    >
      <div className="flex items-center gap-3 rounded-lg border border-gray-200/80 bg-white/95 px-3 py-2 shadow-sm backdrop-blur-sm dark:border-gray-600/60 dark:bg-gray-800/95">
        <svg
          aria-hidden="true"
          className="h-4 shrink-0 overflow-visible text-sky-600 dark:text-sky-400"
          width={displayPixels}
          height={16}
          viewBox={`0 0 ${displayPixels} 16`}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
        >
          <path d={`M 0 12 H ${displayPixels}`} />
          {/* Fixed subdivisions stay readable at every zoom level. */}
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
            <path
              key={fraction}
              d={`M ${fraction * displayPixels} ${
                fraction === 0 || fraction === 1 ? 3 : fraction === 0.5 ? 6 : 9
              } V 12`}
            />
          ))}
        </svg>
        <span className="whitespace-nowrap text-xs font-medium tabular-nums text-gray-700 dark:text-gray-200">
          {roundedMeters.toFixed(roundedMeters < 1 ? 1 : 0)} m
        </span>
      </div>
    </div>
  )
}

export default ScaleIndicator
