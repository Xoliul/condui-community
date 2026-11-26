import { z } from 'zod'
import {
  checkSupplyTapAnchor,
  createSupplyTapInProject,
} from '@/lib/supplyTaps/createSupplyTap'
import { persistAutomaticPanelSlotsInProject } from '@/lib/panel/panelAutomaticSlots'
import { findPanelById } from '@/lib/panel/panelTree'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { getSupplyTapsPanel } from '@/lib/supplyTaps/virtualPanel'
import { getSupplyTapSymbolKind } from '@/lib/supplyTaps/tapSymbols'
import { getSymbolById } from '@/lib/symbols'
import type { ProjectV2 } from '@/types/projectV2'
import { CommandError, defineProjectCommand, type EntityKind } from '../types'
import { collectTopologyRefs, diffTopologyRefs } from '../topologyRefs'

const inputSchema = z.strictObject({
  ownerPanelId: z.string().min(1).describe('ID of the main panel whose supply the tap leaves from.'),
  anchor: z
    .strictObject({
      leg: z
        .enum(['grid-run', 'changeover-grid', 'converter-input'])
        .describe('Grid-side leg of the supply: the main grid run, the changeover grid input, or the converter grid input.'),
      afterTrunkDeviceId: z
        .string()
        .min(1)
        .optional()
        .describe('Supply device the tap leaves directly after. Omit for the start of the leg.'),
      order: z
        .number()
        .finite()
        .optional()
        .describe('Position among taps at the same anchor, increasing along the power flow. Omit to add after them.'),
    })
    .describe('Where the tap leaves the grid wire. Taps are circuits that are dead in island mode.'),
  symbolId: z
    .string()
    .min(1)
    .describe(
      'Library symbol that starts the tap: a protection (mcb, fuse, rcd, rcbo, main_switch, rotating_switch) makes a protected tap, energy_meter a metered tap, a socket, light or fixed appliance such as ev an unprotected load circuit.'
    ),
  searchPreset: z.string().min(1).optional(),
})

/**
 * Branches a new circuit off the grid side of a main panel's supply (a T above the supply wire):
 * a protection, an energy meter or a load. The circuit lives in the panel's supply-taps board.
 */
export const supplyCreateTap = defineProjectCommand({
  id: 'supply.createTap',
  version: 1,
  input: inputSchema,
  check(project, input) {
    const symbol = getSymbolById(input.symbolId)
    if (!symbol) return { ok: false, code: 'unknown_symbol', message: 'Unknown symbol' }
    if (!getSupplyTapSymbolKind(symbol))
      return { ok: false, code: 'unsupported_symbol', message: 'This symbol cannot start a supply tap' }
    return checkSupplyTapAnchor(project as ProjectV2, input.ownerPanelId, input.anchor)
  },
  apply(draft, input, env) {
    const project = draft as ProjectV2
    const before = collectTopologyRefs(project)
    const result = createSupplyTapInProject(project, input, {
      newId: env.newId,
      language: env.language,
    })
    if (!result.ok) throw new CommandError('check_failed', result.message, { reason: result.code })
    // Persist grid slots for the tap's device inside this undo step (the canvas would otherwise
    // repair them afterwards as a separate step).
    const owner = findPanelById(getEditableProjectElectricalPanels(project), input.ownerPanelId)
    const tapBoard = owner ? getSupplyTapsPanel(owner) : undefined
    for (const id of [input.ownerPanelId, tapBoard?.id])
      if (id) persistAutomaticPanelSlotsInProject(project, id)
    const diff = diffTopologyRefs(before, collectTopologyRefs(project))
    return {
      ...diff,
      related: [{ kind: 'panel' as const, id: input.ownerPanelId }],
      select: result.select.map((ref) => ({ kind: ref.kind as EntityKind, id: ref.id })),
    }
  },
})
