import { z } from 'zod'
import { importSupplySystemSchema } from '@/lib/electricalImport/supplyTypes'
import {
  ADD_SUPPLY_SYSTEM_UNSUPPORTED_MESSAGE,
  AddSupplySystemError,
  addSupplySystemInProject,
  canAddSupplySystem,
} from '@/lib/electricalImport/addSupplySystem'
import { getProjectElectricalInstallation } from '@/lib/projectV2/electrical'
import { CommandError, defineProjectCommand } from '../types'
import { collectTopologyRefs, diffTopologyRefs } from '../topologyRefs'

export const supplyAddSystemInputSchema = z.strictObject({
  /** The only main panel, whose supply path must still be empty. */
  panelId: z.string().min(1).max(200),
  system: importSupplySystemSchema,
})

/**
 * Adds a supply system (grid connection, inverters, batteries and sources) through the shared import
 * supply compiler. Only for a single main panel with an empty supply path; existing supplies are
 * never replaced.
 */
export const supplyAddSystem = defineProjectCommand({
  id: 'supply.addSystem',
  version: 1,
  input: supplyAddSystemInputSchema,
  check(project, input) {
    if (!getProjectElectricalInstallation(project))
      return { ok: false, code: 'unsupported_topology', message: ADD_SUPPLY_SYSTEM_UNSUPPORTED_MESSAGE }
    if (!canAddSupplySystem(project, input.panelId))
      return { ok: false, code: 'unsupported_topology', message: ADD_SUPPLY_SYSTEM_UNSUPPORTED_MESSAGE }
    return { ok: true }
  },
  apply(draft, input) {
    const beforeRefs = collectTopologyRefs(draft)
    try {
      addSupplySystemInProject(draft, input.panelId, input.system)
    } catch (error) {
      if (error instanceof AddSupplySystemError) throw new CommandError('check_failed', error.message, { reason: error.code })
      throw error
    }
    const diff = diffTopologyRefs(beforeRefs, collectTopologyRefs(draft))
    return { ...diff, related: [], select: [{ kind: 'panel' as const, id: input.panelId }] }
  },
})
