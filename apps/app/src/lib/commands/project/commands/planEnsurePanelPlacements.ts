import { z } from 'zod'
import { ensureAllPanelPlacementsInProject } from '@/lib/plan/ensurePanelPlacements'
import type { ProjectV2 } from '@/types/projectV2'
import { defineProjectCommand } from '../types'

/** Ensures every board has its plan endpoint and placement; a no-op when all already have one. */
export const planEnsurePanelPlacements = defineProjectCommand({
  id: 'plan.ensurePanelPlacements',
  version: 1,
  input: z.strictObject({}),
  check() {
    return { ok: true }
  },
  apply(draft, _input, env) {
    const result = ensureAllPanelPlacementsInProject(draft as ProjectV2, env.newId)
    return {
      created: [
        ...result.createdCircuitIds.map((id) => ({ kind: 'circuit' as const, id })),
        ...result.createdEndpointIds.map((id) => ({ kind: 'endpoint' as const, id })),
        ...result.createdPlacementIds.map((id) => ({ kind: 'placement' as const, id })),
      ],
      changed: [],
      removed: [],
    }
  },
})
