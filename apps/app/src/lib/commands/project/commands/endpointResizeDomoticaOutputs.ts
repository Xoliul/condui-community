import { z } from 'zod'
import type { ProjectV2 } from '@/types/projectV2'
import {
  planDomoticaEndpointResize,
  resizeDomoticaEndpointCountInProject,
} from '@/lib/eendraad/domoticaEndpointCountMutations'
import { defineProjectCommand } from '../types'

/** Changes how many outputs a regular-panel domotica module has, including its child endpoints. */
export const endpointResizeDomoticaOutputs = defineProjectCommand({
  id: 'endpoint.resizeDomoticaOutputs',
  version: 1,
  input: z.strictObject({
    endpointId: z.string().min(1),
    count: z.number().finite(),
  }),
  check(project, input) {
    const plan = planDomoticaEndpointResize(project as ProjectV2, input.endpointId, input.count)
    if (!plan.ok && plan.reason === 'not_resizable')
      return {
        ok: false,
        code: 'endpoint_not_resizable',
        message: 'This endpoint has no resizable outputs',
      }
    return { ok: true }
  },
  apply(draft, input) {
    if (!resizeDomoticaEndpointCountInProject(draft as ProjectV2, input.endpointId, input.count))
      return { created: [], changed: [], removed: [] }
    return { created: [], changed: [{ kind: 'endpoint', id: input.endpointId }], removed: [] }
  },
})
