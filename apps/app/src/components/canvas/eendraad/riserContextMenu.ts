import type { ContextMenuItem } from '@/components/common/ContextMenu'
import { getRiserPaletteActions } from '@/lib/commands/ui/riserPaletteActions'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import type { ProjectV2 } from '@/types/projectV2'
import type { Selection } from '@/types/ui'
import type { WireSegment } from '@/types/schema'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { collectCircuits, walkPanels } from '@/lib/panel/panelTree'

/**
 * Riser entries of the one-wire context menu: the same actions, labels and eligibility as Ctrl+K for the same
 * selection (`getRiserPaletteActions`). They sit before the first destructive item.
 */
export function withRiserContextMenuItems(
  items: ContextMenuItem[], project: ProjectV2 | null | undefined, selection: Selection, t: (key: string) => string,
): ContextMenuItem[] {
  if (!project) return items
  const riserItems = getRiserPaletteActions(project, selection).flatMap((action): ContextMenuItem[] => {
    const call = action.invocation({})
    return [{ label: t(action.labelKey), onClick: () => { runProjectCommand(call.id, call.input) } }]
  })
  if (!riserItems.length) return items
  const danger = items.findIndex((item) => item.variant === 'danger')
  if (danger < 0) return [...items, ...riserItems]
  const at = danger > 0 && items[danger - 1]?.separator ? danger - 1 : danger
  return [...items.slice(0, at), ...riserItems, ...items.slice(at)]
}

/**
 * What a right-click means for the riser entries: the element under the pointer, since the selection may still be the
 * previous one when the menu is built. Without a hit element the selection stands.
 */
export function getRiserContextSelection(
  project: ProjectV2 | null | undefined, elementId: string | null, selection: Selection, wires: readonly WireSegment[],
): Selection {
  if (!project || !elementId || selection.ids.includes(elementId)) return selection
  const wire = wires.find((candidate) => candidate.id === elementId)
  if (wire) return {
    type: 'wire', ids: [wire.id],
    wireMetadata: [{ id: wire.id, type: wire.type === 'secondaryBus' ? 'mainBus' : wire.type, domain: wire.domain, circuitId: wire.circuitId, panelId: wire.panelId,
      isSupply: Boolean(wire.isSupplyTrunk), isGround: wire.fromElementType === 'ground' }],
  }
  const panels = [...walkPanels(getProjectElectricalPanels(project))]
  if (panels.flatMap(collectCircuits).some((circuit) => circuit.endpoints.some((endpoint) => endpoint.id === elementId))) return { type: 'endpoint', ids: [elementId] }
  if (panels.some((panel) => panel.protections.some((protection) => protection.id === elementId))) return { type: 'protection', ids: [elementId] }
  return selection
}
