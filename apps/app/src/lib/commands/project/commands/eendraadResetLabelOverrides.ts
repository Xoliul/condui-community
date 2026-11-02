import { z } from 'zod'
import { resetAllManualEendraadLabelOverrides } from '@/lib/eendraad/automaticMainBusNaming'
import { getAllCircuits } from '@/lib/eendraad/projectElectricalDomain'
import { walkPanels } from '@/lib/panel/panelTree'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import type { ProjectV2 } from '@/types/projectV2'
import { defineProjectCommand } from '../types'

function lockedCircuitIds(project: ProjectV2): string[] {
  return [...walkPanels(getEditableProjectElectricalPanels(project))]
    .flatMap((panel) => getAllCircuits(panel))
    .filter((circuit) => circuit.eendraadManualCodeLock === true)
    .map((circuit) => circuit.id)
}

/** Clears every manual one-wire circuit label and renumbers with the automatic naming. */
export const eendraadResetLabelOverrides = defineProjectCommand({
  id: 'eendraad.resetLabelOverrides',
  version: 1,
  input: z.strictObject({}),
  check() {
    return { ok: true }
  },
  apply(draft) {
    const project = draft as ProjectV2
    const locked = [...new Set(lockedCircuitIds(project))]
    if (!resetAllManualEendraadLabelOverrides(project)) {
      return { created: [], changed: [], removed: [] }
    }
    return {
      created: [],
      changed: locked.map((id) => ({ kind: 'circuit' as const, id })),
      removed: [],
    }
  },
})
