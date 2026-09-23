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
      className="absolute bottom-4 left-4 z-10"
      style={{ transform: `scale(${scale})`, transformOrigin: 'bottom left' }}
    >
      <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 shadow-lg">
        <div className="flex items-center gap-3">
          {/* Ruler visualization */}
          <div className="flex items-center">
            <div
              className="bg-sky-600 h-3 relative"
              style={{ width: `${displayPixels}px` }}
            >
              {/* Tick marks */}
              {Array.from({ length: Math.floor(roundedMeters) + 1 }).map((_, i) => {
                const pos = (i / roundedMeters) * displayPixels
                return (
                  <div
                    key={i}
                    className="absolute top-0 w-px bg-white"
                    style={{
                      left: `${pos}px`,
                      height: i % 5 === 0 ? '12px' : '6px',
                      marginTop: '-3px',
                    }}
                  />
                )
              })}
            </div>
          </div>
          <div className="text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
            {roundedMeters.toFixed(roundedMeters < 1 ? 1 : 0)} m
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {scaleAtZoom.toFixed(1)} px/m
          </div>
        </div>
      </div>
    </div>
  )
}

export default ScaleIndicator
