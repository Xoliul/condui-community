import { z } from 'zod'
import { repairDuplicatedBoardSymbolsInProject } from '@/lib/panel/duplicatedBoardSymbols'
import type { ProjectV2 } from '@/types/projectV2'
import { defineProjectCommand } from '../types'

/** Gives every board that holds another board's symbol its own symbol; a no-op when none do. */
export const panelRepairDuplicatedBoardSymbols = defineProjectCommand({
  id: 'panel.repairDuplicatedBoardSymbols',
  version: 1,
  input: z.strictObject({}),
  check() {
    return { ok: true }
  },
  apply(draft, _input, env) {
    const result = repairDuplicatedBoardSymbolsInProject(draft as ProjectV2, env.newId)
    return {
      created: result.createdEndpointIds.map((id) => ({ kind: 'endpoint' as const, id })),
      changed: [...new Set(result.repairedPanelIds)].map((id) => ({ kind: 'panel' as const, id })),
      removed: [],
    }
  },
})
