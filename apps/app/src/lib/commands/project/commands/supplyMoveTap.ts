import { z } from 'zod'
import { checkSupplyTapAnchor } from '@/lib/supplyTaps/createSupplyTap'
import { findPanelById } from '@/lib/panel/panelTree'
import { getEditableProjectElectricalPanels, getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { getSupplyTapsPanel } from '@/lib/supplyTaps/virtualPanel'
import type { ProjectV2 } from '@/types/projectV2'
import type { Panel } from '@/types/schema'
import { CommandError, defineProjectCommand } from '../types'

const inputSchema = z.strictObject({
  ownerPanelId: z.string().min(1).describe('ID of the main panel whose supply the tap leaves from.'),
  itemId: z
    .string()
    .min(1)
    .describe('ID of the tap: the top-level protection or unprotected circuit in the panel supply-taps board.'),
  anchor: z
    .strictObject({
      leg: z.enum(['grid-run', 'changeover-grid', 'converter-input']),
      afterTrunkDeviceId: z.string().min(1).optional(),
      order: z.number().finite().optional(),
    })
    .describe('New place on the grid wire, as for supply_create_tap.'),
})

function findTapItem(board: Panel | undefined, itemId: string) {
  const protection = board?.protections.find((item) => item.id === itemId && item.supplyTap)
  if (protection) return { item: protection, kind: 'protection' as const }
  const circuit = board?.circuits.find((item) => item.id === itemId && item.supplyTap)
  return circuit ? { item: circuit, kind: 'circuit' as const } : undefined
}

/** Moves an existing supply tap to another place on the grid side of the same supply. */
export const supplyMoveTap = defineProjectCommand({
  id: 'supply.moveTap',
  version: 1,
  input: inputSchema,
  check(project, input) {
    const owner = findPanelById(getProjectElectricalPanels(project as ProjectV2), input.ownerPanelId)
    if (!findTapItem(owner ? getSupplyTapsPanel(owner) : undefined, input.itemId))
      return { ok: false, code: 'tap_not_found', message: 'Supply tap not found' }
    return checkSupplyTapAnchor(project as ProjectV2, input.ownerPanelId, input.anchor)
  },
  apply(draft, input) {
    const project = draft as ProjectV2
    const owner = findPanelById(getEditableProjectElectricalPanels(project), input.ownerPanelId)
    const found = findTapItem(owner ? getSupplyTapsPanel(owner) : undefined, input.itemId)
    if (!found) throw new CommandError('check_failed', 'Supply tap not found', { reason: 'tap_not_found' })
    const { item, kind } = found
    const current = item.supplyTap!
    const next = { ...input.anchor }
    if (
      current.leg === next.leg &&
      current.afterTrunkDeviceId === next.afterTrunkDeviceId &&
      current.order === next.order
    ) {
      return { created: [], changed: [], removed: [] }
    }
    item.supplyTap = next
    return {
      created: [],
      changed: [{ kind, id: item.id }],
      removed: [],
      related: [{ kind: 'panel' as const, id: input.ownerPanelId }],
      select: [{ kind, id: item.id }],
    }
  },
})
