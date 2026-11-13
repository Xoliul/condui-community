import { useCanvasRegistryStore } from '@/stores/canvasRegistryStore'
import { useUIStore } from '@/stores/uiStore'

export interface ExportStageContext {
  waitedMs: number
  visibility: string
  focused: boolean | null
  registered: { eendraad: boolean; panel: boolean; sitplan: boolean }
  isExporting: boolean
  activeFloorId: string | null
  usedHeapMb: number | null
  heapLimitMb: number | null
  deviceMemoryGb: number | null
}

const MB = 1024 * 1024

/** Formats the context into a short suffix for a "stage not available" error message. */
export function formatExportStageContext(context: ExportStageContext): string {
  const registered = Object.entries(context.registered)
    .map(([kind, present]) => `${kind}:${present ? 'yes' : 'no'}`)
    .join(',')
  const parts = [
    `waited=${context.waitedMs}ms`,
    `tab=${context.visibility}${context.focused === false ? '/unfocused' : ''}`,
    `registered=${registered}`,
    `exporting=${context.isExporting}`,
    `floor=${context.activeFloorId ?? 'none'}`,
  ]
  if (context.usedHeapMb !== null) {
    parts.push(`heap=${context.usedHeapMb}/${context.heapLimitMb ?? '?'}MB`)
  }
  if (context.deviceMemoryGb !== null) parts.push(`deviceMemory=${context.deviceMemoryGb}GB`)
  return `[${parts.join(' ')}]`
}

export function captureExportStageContext(waitedMs: number): ExportStageContext {
  const registry = useCanvasRegistryStore.getState().registry
  const ui = useUIStore.getState()
  const memory = (performance as { memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number } })
    .memory
  const deviceMemory = (navigator as { deviceMemory?: number }).deviceMemory
  return {
    waitedMs,
    visibility: typeof document === 'undefined' ? 'unknown' : document.visibilityState,
    focused: typeof document === 'undefined' ? null : document.hasFocus(),
    registered: {
      eendraad: registry.eendraad !== null,
      panel: registry.panel !== null,
      sitplan: registry.sitplan !== null,
    },
    isExporting: ui.isExporting,
    activeFloorId: ui.activeFloorId ?? null,
    usedHeapMb: memory?.usedJSHeapSize ? Math.round(memory.usedJSHeapSize / MB) : null,
    heapLimitMb: memory?.jsHeapSizeLimit ? Math.round(memory.jsHeapSizeLimit / MB) : null,
    deviceMemoryGb: typeof deviceMemory === 'number' ? deviceMemory : null,
  }
}

/** Why a stage may be missing: appended to the error so a crash ticket shows the cause. */
export function describeMissingExportStage(waitedMs: number): string {
  return formatExportStageContext(captureExportStageContext(waitedMs))
}
