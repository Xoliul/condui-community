import { useProjectStore } from '@/stores/projectStore'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import {
  clampDomoticaEndpointCount,
  isDomoticaEndpointOnDcBusInProject,
} from '@/lib/eendraad/domoticaEndpointCountMutations'

export { clampDomoticaEndpointCount }

export function isDomoticaEndpointOnDcBus(endpointId: string): boolean {
  const project = useProjectStore.getState().currentProject
  return project ? isDomoticaEndpointOnDcBusInProject(project, endpointId) : false
}

/** Resize a regular-panel domotica endpoint while keeping its output model consistent. */
export function resizeDomoticaEndpointCount(endpointId: string, requestedCount: number): boolean {
  const outcome = runProjectCommand(
    'endpoint.resizeDomoticaOutputs',
    { endpointId, count: requestedCount },
    { label: 'resize domotica outputs', source: 'eendraad' }
  )
  return outcome?.changed === true
}
