import {
  DOMOTICA_MAX_ENDPOINT_OUTPUTS,
  DOMOTICA_MIN_ENDPOINT_OUTPUTS,
} from '@/lib/domoticaLayout'
import type { Circuit, Endpoint } from '@/types/schema'
import { clamp } from '@/lib/geometry'
import { resolveSymbolPortsForWire } from '@/lib/symbols'
import type { ElectricalDomain } from '@/types/schema'
import type { DropTarget } from '@/lib/layout/findDropTarget'

type DomoticaOutputGroup = 'control' | 'endpoint'
type DomoticaChildRef = NonNullable<Endpoint['domoticaChildProps']>

function normalizeOutputGroup(_group: DomoticaOutputGroup | undefined): 'endpoint' {
  return 'endpoint'
}

function normalizeDomoticaCount(value: number | undefined, fallback = DOMOTICA_MIN_ENDPOINT_OUTPUTS): number {
  const normalized = Number.isFinite(value) ? Math.trunc(value as number) : fallback
  return clamp(normalized, DOMOTICA_MIN_ENDPOINT_OUTPUTS, DOMOTICA_MAX_ENDPOINT_OUTPUTS)
}

function padSlots(ids: string[] | undefined, count: number): string[] {
  const next = [...(ids ?? [])]
  while (next.length < count) next.push('')
  return next.slice(0, count)
}

function getGroupSlots(parent: Endpoint, group: DomoticaOutputGroup, requestedIndex: number): string[] {
  const props = parent.domoticaProps ?? {}
  const baseCount =
    group === 'endpoint'
      ? normalizeDomoticaCount(props.endpointCount, DOMOTICA_MIN_ENDPOINT_OUTPUTS)
      : normalizeDomoticaCount(props.switchCount, DOMOTICA_MIN_ENDPOINT_OUTPUTS)
  const count = Math.max(
    baseCount,
    Math.min(DOMOTICA_MAX_ENDPOINT_OUTPUTS, Math.trunc(requestedIndex) + 1),
  )
  return padSlots(
    group === 'endpoint' ? props.endpointChildEndpointIds : props.controlChildEndpointIds,
    count,
  )
}

function setGroupSlots(
  parent: Endpoint,
  group: DomoticaOutputGroup,
  slots: string[],
): Endpoint {
  const props = parent.domoticaProps ?? {}
  const nextSlots = slots.slice(0, DOMOTICA_MAX_ENDPOINT_OUTPUTS)
  return {
    ...parent,
    domoticaProps: {
      ...props,
      ...(group === 'endpoint'
        ? {
            endpointCount: normalizeDomoticaCount(
              Math.max(props.endpointCount ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS, nextSlots.length),
            ),
            endpointChildEndpointIds: nextSlots,
          }
        : {
            switchControlEnabled: true,
            switchCount: normalizeDomoticaCount(
              Math.max(props.switchCount ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS, nextSlots.length),
            ),
            controlChildEndpointIds: nextSlots,
          }),
    },
  }
}

function insertMovingId(
  slots: string[],
  movingId: string,
  requestedIndex: number,
): string[] | null {
  const targetIndex = Math.max(0, Math.min(Math.trunc(requestedIndex), DOMOTICA_MAX_ENDPOINT_OUTPUTS - 1))
  const expanded = padSlots(slots, Math.max(slots.length, targetIndex + 1))
  const targetOccupant = expanded[targetIndex]

  if (targetOccupant && targetOccupant !== movingId) {
    const occupied = expanded.filter((id) => id && id !== movingId)
    const targetOccupiedIndex = occupied.indexOf(targetOccupant)
    if (targetOccupiedIndex === -1) return null
    occupied.splice(targetOccupiedIndex, 0, movingId)
    if (occupied.length > DOMOTICA_MAX_ENDPOINT_OUTPUTS) return null
    return padSlots(occupied, Math.max(expanded.length, occupied.length))
  }

  const next = expanded.map((id) => (id === movingId ? '' : id))
  next[targetIndex] = movingId
  return next
}

function getSlotsForParent(parent: Endpoint, group: DomoticaOutputGroup): string[] {
  const props = parent.domoticaProps ?? {}
  return group === 'endpoint'
    ? [...(props.endpointChildEndpointIds ?? [])]
    : [...(props.controlChildEndpointIds ?? [])]
}

function removeIdFromSlots(slots: string[], id: string): string[] {
  return slots.map((slotId) => (slotId === id ? '' : slotId))
}

function buildOutputIndexRemap(oldSlots: string[], newSlots: string[]): Map<number, number> {
  const oldIndexByRootId = new Map<string, number>()
  oldSlots.forEach((id, index) => {
    if (id) oldIndexByRootId.set(id, index)
  })

  const remap = new Map<number, number>()
  newSlots.forEach((id, newIndex) => {
    if (!id) return
    const oldIndex = oldIndexByRootId.get(id)
    if (oldIndex == null) return
    remap.set(oldIndex, newIndex)
  })
  return remap
}

function collectChildRefsForParents(
  parents: Endpoint[],
): Map<string, DomoticaChildRef> {
  const childRefById = new Map<string, DomoticaChildRef>()
  for (const parent of parents) {
    const endpointIds = parent.domoticaProps?.endpointChildEndpointIds ?? []
    endpointIds.forEach((id, index) => {
      if (id) childRefById.set(id, { parentEndpointId: parent.id, outputGroup: 'endpoint', outputIndex: index })
    })
    const controlIds = parent.domoticaProps?.controlChildEndpointIds ?? []
    controlIds.forEach((id, index) => {
      if (id) childRefById.set(id, { parentEndpointId: parent.id, outputGroup: 'control', outputIndex: index })
    })
  }
  return childRefById
}

function updateEndpointsForDomoticaParents(
  circuit: Circuit,
  updatedParents: Map<string, Endpoint>,
  outputIndexRemaps: Map<string, Map<number, number>>,
  explicitChildRefs: Map<string, DomoticaChildRef> = new Map(),
): Endpoint[] {
  const rootChildRefById = collectChildRefsForParents([...updatedParents.values()])

  return circuit.endpoints.map((endpoint) => {
    const updatedParent = updatedParents.get(endpoint.id)
    if (updatedParent) return updatedParent

    const explicitRef = explicitChildRefs.get(endpoint.id)
    if (explicitRef) return { ...endpoint, domoticaChildProps: explicitRef }

    const rootRef = rootChildRefById.get(endpoint.id)
    if (rootRef) return { ...endpoint, domoticaChildProps: rootRef }

    const currentRef = endpoint.domoticaChildProps
    if (!currentRef) return endpoint

    const remapKey = `${currentRef.parentEndpointId}:${currentRef.outputGroup}`
    const remappedIndex = outputIndexRemaps.get(remapKey)?.get(currentRef.outputIndex)
    if (remappedIndex != null) {
      return {
        ...endpoint,
        domoticaChildProps: {
          ...currentRef,
          outputIndex: remappedIndex,
        },
      }
    }

    return endpoint
  })
}

export function relabelDomoticaChildRows(circuit: Circuit): Endpoint[] {
  const nextById = new Map(circuit.endpoints.map((endpoint) => [endpoint.id, { ...endpoint }]))
  const visited = new Set<string>()

  const labelParent = (parentId: string, ancestry: Set<string>) => {
    if (ancestry.has(parentId) || visited.has(parentId)) return
    const parent = nextById.get(parentId)
    if (parent?.symbol !== 'domotica' || !parent.domoticaProps) return
    visited.add(parentId)
    const nextAncestry = new Set(ancestry).add(parentId)

    const parentLabel = parent.label?.trim() || `${circuit.code}1`
    const baseLabel = parent.domoticaChildProps
      ? parentLabel
      : parentLabel.replace(/\.\d+$/, '')
    const nestedChildIds: string[] = []

    const labelRowsForGroup = (ids: string[] | undefined, group: DomoticaOutputGroup) => {
      (ids ?? []).forEach((rootChildId, outputIndex) => {
        if (!rootChildId) return
        const rowLabel = `${baseLabel}.${outputIndex + 1}`
        const rowChildren = circuit.endpoints.filter(
          (child) =>
            child.domoticaChildProps?.parentEndpointId === parent.id &&
            child.domoticaChildProps.outputGroup === normalizeOutputGroup(group) &&
            child.domoticaChildProps.outputIndex === outputIndex,
        )
        const orderedRowIds = [
          rootChildId,
          ...rowChildren.map((child) => child.id).filter((id) => id !== rootChildId),
        ]
        for (const childId of orderedRowIds) {
          const child = nextById.get(childId)
          if (!child) continue
          child.label = rowLabel
          if (child.symbol === 'domotica' && child.domoticaProps) nestedChildIds.push(child.id)
        }
      })
    }

    labelRowsForGroup(parent.domoticaProps.endpointChildEndpointIds, 'endpoint')

    for (const nestedChildId of nestedChildIds) {
      labelParent(nestedChildId, nextAncestry)
    }
  }

  const modules = circuit.endpoints.filter(
    (endpoint) => endpoint.symbol === 'domotica' && endpoint.domoticaProps
  )
  const rootModules = modules.filter((endpoint) => {
    const parentId = endpoint.domoticaChildProps?.parentEndpointId
    return !parentId || nextById.get(parentId)?.symbol !== 'domotica'
  })
  for (const root of rootModules) labelParent(root.id, new Set())
  for (const module of modules) {
    if (!visited.has(module.id)) labelParent(module.id, new Set())
  }

  return circuit.endpoints.map((endpoint) => nextById.get(endpoint.id) ?? endpoint)
}

export function domoticaChildRefForBranchInsert(
  circuit: Circuit,
  insertAfterEndpointId: string | null | undefined,
  branchEndpointIds: string[] | null | undefined,
): DomoticaChildRef | null {
  if (!branchEndpointIds?.length) return null

  const endpointsById = new Map(circuit.endpoints.map((endpoint) => [endpoint.id, endpoint]))
  if (typeof insertAfterEndpointId === 'string') {
    const ref = endpointsById.get(insertAfterEndpointId)?.domoticaChildProps
    if (ref) return { ...ref }
  }

  const insertAfterIndex =
    typeof insertAfterEndpointId === 'string'
      ? branchEndpointIds.indexOf(insertAfterEndpointId)
      : -1
  const searchEnd = insertAfterIndex >= 0 ? insertAfterIndex : branchEndpointIds.length - 1
  for (let index = searchEnd; index >= 0; index -= 1) {
    const ref = endpointsById.get(branchEndpointIds[index]!)?.domoticaChildProps
    if (ref) return { ...ref }
  }
  return null
}

export function domoticaChildRefForEndpoint(
  circuit: Circuit,
  endpointId: string | null | undefined,
): DomoticaChildRef | null {
  if (!endpointId) return null
  const ref = circuit.endpoints.find((endpoint) => endpoint.id === endpointId)?.domoticaChildProps
  return ref ? { ...ref } : null
}

/** Keep the output's first-child reference on the head of an existing serial row. */
export function updateDomoticaChainHeadAfterInsert(
  circuit: Circuit,
  insertedEndpointId: string,
  beforeEndpointId: string | undefined,
): Endpoint[] {
  const inserted = circuit.endpoints.find((endpoint) => endpoint.id === insertedEndpointId)
  const ref = inserted?.domoticaChildProps
  if (!ref || !beforeEndpointId) return circuit.endpoints
  return circuit.endpoints.map((endpoint) => {
    if (endpoint.id !== ref.parentEndpointId) return endpoint
    const slots = endpoint.domoticaProps?.endpointChildEndpointIds
    if (slots?.[ref.outputIndex] !== beforeEndpointId) return endpoint
    const nextSlots = [...slots]
    nextSlots[ref.outputIndex] = insertedEndpointId
    return { ...endpoint, domoticaProps: { ...endpoint.domoticaProps, endpointChildEndpointIds: nextSlots } }
  })
}

/** A converter on an occupied output belongs before that output's existing loads. */
export function resolveDomoticaConversionDropTarget(circuit: Circuit, target: DropTarget): DropTarget {
  if (!target.domoticaOutput || !target.endpointId) return target
  const parent = circuit.endpoints.find((endpoint) => endpoint.id === target.endpointId)
  const childId = parent?.domoticaProps?.endpointChildEndpointIds?.[target.domoticaOutput.index]
  const branch = circuit.branches?.find((candidate) => childId && candidate.endpointIds.includes(childId))
  if (!childId || !branch) return target
  const index = branch.endpointIds.indexOf(childId)
  return {
    ...target,
    endpointId: childId,
    branchEndpoints: branch.endpointIds,
    insertAfterEndpointId: index > 0 ? branch.endpointIds[index - 1] : null,
    domoticaOutput: undefined,
    domoticaChildDropIntent: 'insertBefore',
  }
}

/** Follow only the owning Domotica row, excluding sibling outputs and descendants. */
export function getDomoticaEndpointInputDomain(
  circuit: Circuit,
  endpointId: string,
  baseDomain: ElectricalDomain,
  ancestry: Set<string> = new Set(),
): ElectricalDomain {
  const endpoint = circuit.endpoints.find((candidate) => candidate.id === endpointId)
  const ref = endpoint?.domoticaChildProps
  if (ancestry.has(endpointId)) return baseDomain
  const nextAncestry = new Set(ancestry).add(endpointId)
  let domain = ref
    ? getDomoticaEndpointInputDomain(circuit, ref.parentEndpointId, baseDomain, nextAncestry)
    : baseDomain
  const branch = circuit.branches?.find((candidate) => candidate.endpointIds.includes(endpointId))
  const ordered = branch
    ? branch.endpointIds.flatMap((id) => circuit.endpoints.find((candidate) => candidate.id === id) ?? [])
    : circuit.endpoints
  for (const candidate of ordered) {
    if (candidate.id === endpointId) break
    const candidateRef = candidate.domoticaChildProps
    if (ref) {
      if (candidateRef?.parentEndpointId !== ref.parentEndpointId ||
          candidateRef.outputGroup !== ref.outputGroup || candidateRef.outputIndex !== ref.outputIndex) continue
    } else if (candidateRef) continue
    if (!candidate.symbol) continue
    const resolved = resolveSymbolPortsForWire(candidate.symbol, domain)
    if (resolved.matched && resolved.oppositePortDomain) domain = resolved.oppositePortDomain
  }
  return domain
}

export function insertDomoticaChildEndpoint(
  circuit: Circuit,
  childEndpointId: string,
  targetParentEndpointId: string,
  targetGroup: DomoticaOutputGroup,
  targetIndex: number,
): Circuit | null {
  const targetParent = circuit.endpoints.find((endpoint) => endpoint.id === targetParentEndpointId)
  const child = circuit.endpoints.find((endpoint) => endpoint.id === childEndpointId)
  if (!targetParent?.domoticaProps || !child) return null

  const endpointById = new Map(circuit.endpoints.map((endpoint) => [endpoint.id, endpoint]))
  const visitedAncestors = new Set<string>()
  let ancestor: Endpoint | undefined = targetParent
  while (ancestor) {
    if (ancestor.id === childEndpointId) return null
    if (visitedAncestors.has(ancestor.id)) return null
    visitedAncestors.add(ancestor.id)
    const parentId: string | undefined = ancestor.domoticaChildProps?.parentEndpointId
    ancestor = parentId ? endpointById.get(parentId) : undefined
  }

  const updatedParents = new Map<string, Endpoint>()
  const outputIndexRemaps = new Map<string, Map<number, number>>()

  for (const endpoint of circuit.endpoints) {
    if (!endpoint.domoticaProps) continue
    let parent = endpoint
    for (const group of ['endpoint', 'control'] as const) {
      const oldSlots = getSlotsForParent(parent, group)
      const withoutChild = removeIdFromSlots(oldSlots, childEndpointId)
      if (withoutChild.some((id, index) => id !== oldSlots[index])) {
        parent = setGroupSlots(parent, group, withoutChild)
        outputIndexRemaps.set(`${parent.id}:${group}`, buildOutputIndexRemap(oldSlots, withoutChild))
      }
    }
    if (parent !== endpoint) updatedParents.set(parent.id, parent)
  }

  const currentTargetParent = updatedParents.get(targetParent.id) ?? targetParent
  const normalizedGroup = normalizeOutputGroup(targetGroup)
  const oldTargetSlots = getGroupSlots(currentTargetParent, normalizedGroup, targetIndex)
  const inserted = insertMovingId(oldTargetSlots, childEndpointId, targetIndex)
  if (!inserted) return null
  const updatedTargetParent = setGroupSlots(currentTargetParent, normalizedGroup, inserted)
  updatedParents.set(updatedTargetParent.id, updatedTargetParent)
  outputIndexRemaps.set(
    `${updatedTargetParent.id}:${normalizedGroup}`,
    buildOutputIndexRemap(oldTargetSlots, inserted),
  )

  const childOutputIndex = inserted.indexOf(childEndpointId)
  if (childOutputIndex < 0) return null

  const nextCircuit = {
    ...circuit,
    endpoints: updateEndpointsForDomoticaParents(
      circuit,
      updatedParents,
      outputIndexRemaps,
      new Map([
        [
          childEndpointId,
          {
            parentEndpointId: targetParentEndpointId,
            outputGroup: normalizedGroup,
            outputIndex: childOutputIndex,
          },
        ],
      ]),
    ),
  }
  return {
    ...nextCircuit,
    endpoints: relabelDomoticaChildRows(nextCircuit),
  }
}

/**
 * Move an existing domotica child to a domotica output slot without creating a
 * copied endpoint. Occupied target slots use insert semantics: the moved child
 * takes the target position and the target plus following children shift down.
 */
export function reorderDomoticaChildEndpoint(
  circuit: Circuit,
  childEndpointId: string,
  targetParentEndpointId: string,
  targetGroup: DomoticaOutputGroup,
  targetIndex: number,
): Circuit | null {
  const child = circuit.endpoints.find((endpoint) => endpoint.id === childEndpointId)
  const sourceRef = child?.domoticaChildProps
  if (!child || !sourceRef) return null
  return insertDomoticaChildEndpoint(circuit, childEndpointId, targetParentEndpointId, targetGroup, targetIndex)
}
