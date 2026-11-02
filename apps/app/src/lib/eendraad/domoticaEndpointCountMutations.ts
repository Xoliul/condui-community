import { DOMOTICA_MAX_ENDPOINT_OUTPUTS, DOMOTICA_MIN_ENDPOINT_OUTPUTS } from '@/lib/domoticaLayout'
import { deleteEndpointsFromProject } from '@/lib/eendraad/endpointDeletion'
import { findEndpointById } from '@/lib/eendraad/projectElectricalDomain'
import { updateEndpointInProject } from '@/lib/projectMutations/storeActions'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import type { ProjectV2 } from '@/types/projectV2'
import type { DomoticaOutputWireProps } from '@/types/schema'

export function clampDomoticaEndpointCount(count: number): number {
  return Math.max(
    DOMOTICA_MIN_ENDPOINT_OUTPUTS,
    Math.min(DOMOTICA_MAX_ENDPOINT_OUTPUTS, Math.round(count))
  )
}

function findEndpointWithCircuit(project: ProjectV2, endpointId: string) {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const found = findEndpointById(panel, endpointId)
    if (found) return found
  }
  return undefined
}

export function isDomoticaEndpointOnDcBusInProject(project: ProjectV2, endpointId: string): boolean {
  return (
    findEndpointWithCircuit(project, endpointId)?.circuit.branches?.some(
      (branch) => !!branch.dcBusId && branch.endpointIds.includes(endpointId)
    ) ?? false
  )
}

/** Whether a regular-panel domotica endpoint can be resized, and to which clamped count. */
export function planDomoticaEndpointResize(
  project: ProjectV2,
  endpointId: string,
  requestedCount: number
): { ok: true; nextCount: number } | { ok: false; reason: 'not_resizable' | 'unchanged' } {
  const info = findEndpointWithCircuit(project, endpointId)
  if (!info || info.endpoint.symbol !== 'domotica' || isDomoticaEndpointOnDcBusInProject(project, endpointId))
    return { ok: false, reason: 'not_resizable' }
  const nextCount = clampDomoticaEndpointCount(requestedCount)
  const currentCount = clampDomoticaEndpointCount(
    info.endpoint.domoticaProps?.endpointCount ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS
  )
  return nextCount === currentCount ? { ok: false, reason: 'unchanged' } : { ok: true, nextCount }
}

/** Resize a regular-panel domotica endpoint while keeping its output model consistent. */
export function resizeDomoticaEndpointCountInProject(
  project: ProjectV2,
  endpointId: string,
  requestedCount: number
): boolean {
  const plan = planDomoticaEndpointResize(project, endpointId, requestedCount)
  if (!plan.ok) return false
  const { endpoint, circuit } = findEndpointWithCircuit(project, endpointId)!
  const nextCount = plan.nextCount
  const domoticaProps = endpoint.domoticaProps ?? {}
  const childEndpointIds = (domoticaProps.endpointChildEndpointIds ?? []).filter(
    (id) => !!findEndpointWithCircuit(project, id)
  )
  const removedChildEndpointIds = childEndpointIds.splice(nextCount)
  const baseRoute = circuit.wireRoute ?? (circuit.inWall ? 'wall' : undefined)
  const endpointOutputWires = [...(domoticaProps.endpointOutputWires ?? [])]

  while (endpointOutputWires.length < nextCount) {
    const wire: DomoticaOutputWireProps = {
      cable: { ...circuit.cable },
      inTube: circuit.inTube,
      wireRoute: baseRoute,
      inWall: circuit.inWall ?? false,
      hideWireLabel: circuit.hideWireLabel,
    }
    endpointOutputWires.push(wire)
  }

  if (removedChildEndpointIds.length > 0) deleteEndpointsFromProject(project, removedChildEndpointIds)
  updateEndpointInProject(project, endpointId, {
    domoticaProps: {
      ...domoticaProps,
      endpointCount: nextCount,
      endpointChildEndpointIds: childEndpointIds,
      endpointOutputWires: endpointOutputWires.slice(0, nextCount),
    },
  })
  return true
}
