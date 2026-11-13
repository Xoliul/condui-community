import type { Panel, PanelGridConfig, PanelGridModuleRef, PanelGridSlot } from '@/types/schema'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import {
  getPanelGridPlacements,
  panelGridModuleRefKey,
  resolveModuleWidthCols,
} from '@/lib/panel/panelGridLayout'
import { DEFAULT_PANEL_GRID_ROWS } from '@/lib/panel/panelGridDefaults'
import { getPanelGridTotalColumns } from '@/lib/panel/panelGridFields'
import { panelModulesToGridUnits } from '@/lib/panel/panelGridUnits'

export interface PanelCanvasModule {
  ref: PanelGridModuleRef
  terminalStripMemberRefs?: PanelGridModuleRef[]
  slot?: Pick<
    PanelGridSlot,
    'row' | 'col' | 'moduleWidth' | 'moduleWidthManual' | 'terminalStripRail'
  >
  inSupplyPanel?: boolean
}

/**
 * Return modules that cannot be represented by the panel's printable grid.
 *
 * A module is overflow when its complete stored rectangle is outside the
 * configured panel frame. Collisions are unrelated and must not trigger this.
 */
export function getPanelCanvasOverflowModuleKeys(
  panel: Panel,
  project: ProjectWithOptionalV2Electrical | null,
  modules: PanelCanvasModule[]
): Set<string> {
  const mainModules = modules.filter((module) => module.inSupplyPanel !== true)
  const overflowKeys = new Set<string>()
  const rows = Math.max(1, panel.gridView?.rows ?? DEFAULT_PANEL_GRID_ROWS)
  const columnUnits = panelModulesToGridUnits(getPanelGridTotalColumns(panel.gridView))

  for (const module of mainModules) {
    if (module.slot == null) continue
    const row = module.slot.row
    const col = panelModulesToGridUnits(module.slot.col)
    const width = panelModulesToGridUnits(resolveModuleWidthCols(module.ref, project, module.slot))
    const railEnabled =
      (module.slot.terminalStripRail === 'top' && panel.gridView?.terminalStripTopRail === true) ||
      (module.slot.terminalStripRail === 'bottom' &&
        panel.gridView?.terminalStripBottomRail === true)
    const inBounds =
      col >= 0 && col + width <= columnUnits && (railEnabled || (row >= 0 && row < rows))
    if (!inBounds) overflowKeys.add(panelGridModuleRefKey(module.ref))
  }

  // Use the canvas placement path for unslotted modules, while retaining all
  // persisted slots so auto-placement sees their occupied cells. A collision
  // between persisted manual slots is intentionally not considered overflow.
  for (const placement of getPanelGridPlacements(panel, project, mainModules)) {
    if (placement.isOverflow) overflowKeys.add(panelGridModuleRefKey(placement.ref))
  }
  return overflowKeys
}

export type PanelCanvasReadiness = 'ready' | 'untouched' | 'barely-touched' | 'empty'

export interface PanelCanvasReadinessResult {
  status: PanelCanvasReadiness
  positionedModuleCount: number
  moduleCount: number
}

/**
 * Label strips inherit their horizontal segmentation from the panel canvas.
 * Keep this check deliberately conservative: no stored layout, or only a small
 * fraction of the known modules positioned, should call for a user's attention.
 */
export function assessPanelCanvasReadiness(
  gridView: PanelGridConfig | undefined,
  moduleRefs: PanelGridModuleRef[],
  automaticallyPositionedSlots?: PanelGridSlot[]
): PanelCanvasReadinessResult {
  const userModuleRefs = moduleRefs.filter(
    (ref) => !(ref.kind === 'trunkDevice' && (ref.scope === 'supply' || ref.scope === 'ground'))
  )
  const moduleCount = userModuleRefs.length
  if (moduleCount === 0) {
    // A newly created panel can already contain default supply devices while
    // still having no user-arranged panel modules. Treat that as untouched so
    // label export does not silently promise useful placement data.
    return { status: 'untouched', positionedModuleCount: 0, moduleCount }
  }

  const slots: PanelGridSlot[] = [...(gridView?.slots ?? []), ...(gridView?.supplyPanelSlots ?? [])]
  if (!gridView || slots.length === 0) {
    return { status: 'untouched', positionedModuleCount: 0, moduleCount }
  }

  const knownKeys = new Set(userModuleRefs.map((ref) => panelGridModuleRefKey(ref)))
  const positionedKeys = new Set(
    slots.map((slot) => panelGridModuleRefKey(slot.module)).filter((key) => knownKeys.has(key))
  )
  const positionedModuleCount = positionedKeys.size
  const minimumReadyCount = Math.max(1, Math.ceil(moduleCount * 0.5))

  if (automaticallyPositionedSlots) {
    const automaticByKey = new Map(
      automaticallyPositionedSlots
        .filter((slot) => knownKeys.has(panelGridModuleRefKey(slot.module)))
        .map((slot) => [panelGridModuleRefKey(slot.module), slot] as const)
    )
    const storedByKey = new Map(
      slots
        .filter((slot) => knownKeys.has(panelGridModuleRefKey(slot.module)))
        .map((slot) => [panelGridModuleRefKey(slot.module), slot] as const)
    )
    const matchesAutomaticLayout =
      automaticByKey.size === moduleCount &&
      storedByKey.size > 0 &&
      [...storedByKey].every(([key, stored]) => {
        const automatic = automaticByKey.get(key)
        return (
          automatic != null &&
          automatic.row === stored.row &&
          automatic.col === stored.col &&
          automatic.terminalStripRail === stored.terminalStripRail &&
          stored.moduleWidthManual !== true
        )
      })

    if (matchesAutomaticLayout) {
      return { status: 'untouched', positionedModuleCount, moduleCount }
    }
  }

  return {
    status: positionedModuleCount < minimumReadyCount ? 'barely-touched' : 'ready',
    positionedModuleCount,
    moduleCount,
  }
}

export function panelCanvasNeedsAttention(result: PanelCanvasReadinessResult): boolean {
  return result.status === 'untouched' || result.status === 'barely-touched'
}
