import type { Panel } from '@/types/schema'
import type { PanelCanvasMode } from '@/types/ui'
import { getPanelDisplayName } from '@/utils/panelNames'
import {
  orderPanelTreeByNumber,
  type PanelNumberOrderInstallation,
} from '@/lib/panel/panelNumberOrder'

export type PanelOption = {
  id: string
  name: string
  panel: Panel
  depth: number
  isRoot: boolean
}

/** Every board in tree order, as the panel scene expects. */
export function buildPanelOptions(
  panels: readonly Panel[],
  project?: Parameters<typeof getPanelDisplayName>[1],
  depth = 0
): PanelOption[] {
  return panels.flatMap((panel) => [
    { id: panel.id, name: getPanelDisplayName(panel, project), panel, depth, isRoot: depth === 0 },
    ...buildPanelOptions(panel.subPanels ?? [], project, depth + 1),
  ])
}

/** The board selector lists boards by number; sub-boards stay indented below their parent. */
export function orderPanelOptionsByNumber(
  options: readonly PanelOption[],
  rootPanels: readonly Panel[],
  installation: PanelNumberOrderInstallation
): PanelOption[] {
  const optionById = new Map(options.map((option) => [option.id, option]))
  return orderPanelTreeByNumber(rootPanels, installation).flatMap(
    ({ panel }) => optionById.get(panel.id) ?? []
  )
}

export function isPanelOptionActive(mode: PanelCanvasMode, panelId: string): boolean {
  return mode.kind === 'panel' && mode.panelId === panelId
}

export function buildPanelSelectorLabel(
  mode: PanelCanvasMode,
  panelOptions: PanelOption[]
): string {
  if (mode.kind === 'all') return 'All (hierarchy)'
  return panelOptions.find((panelOption) => panelOption.id === mode.panelId)?.name ?? 'Panel'
}
