/**
 * Renders canvas components that are not currently visible in the viewport,
 * so PDF export can capture them even when only one canvas is visible.
 * Only mounted while isExporting is true.
 */

import { useUIStore } from '@/stores/uiStore'
import { EendraadCanvas, PlanCanvas, PanelCanvas } from '@/components/canvas'
import type { CanvasType } from '@/types/ui'

const CANVAS_TYPES: CanvasType[] = ['eendraad', 'plan', 'panel']

/** Fixed size for hidden canvas containers so Konva stages render. */
const HIDDEN_CANVAS_WIDTH = 800
const HIDDEN_CANVAS_HEIGHT = 600

function CanvasForType({ type }: { type: CanvasType }) {
  switch (type) {
    case 'eendraad':
      return <EendraadCanvas />
    case 'plan':
      return <PlanCanvas />
    case 'panel':
      return <PanelCanvas />
    case 'structure':
    case 'documents':
      return null
  }
}

/**
 * When isExporting is true, mounts PanelCanvas, PlanCanvas, and/or EendraadCanvas
 * for any canvas type that is not currently in the viewport layout, so the
 * export pipeline can get their stages from the registry.
 */
export function ExportCanvasPool() {
  const isExporting = useUIStore((s) => s.isExporting)
  const viewportLayout = useUIStore((s) => s.viewportLayout)

  if (!isExporting) return null

  const visibleCanvasTypes = new Set(viewportLayout.panels.map((p) => p.canvas))
  const typesToMount = CANVAS_TYPES.filter((t) => !visibleCanvasTypes.has(t))

  if (typesToMount.length === 0) return null

  return (
    <div
      aria-hidden
      className="fixed pointer-events-none invisible"
      style={{
        left: -9999,
        top: 0,
        width: HIDDEN_CANVAS_WIDTH,
        height: HIDDEN_CANVAS_HEIGHT,
      }}
    >
      {typesToMount.map((type) => (
        <div
          key={type}
          className="absolute inset-0"
          style={{ width: HIDDEN_CANVAS_WIDTH, height: HIDDEN_CANVAS_HEIGHT }}
        >
          <CanvasForType type={type} />
        </div>
      ))}
    </div>
  )
}
