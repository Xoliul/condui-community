import { z } from 'zod'
import { checkForkRunMove, moveSavedForkRun, usesForkRunMove } from '@/lib/eendraad/forkRunMove'
import { PROJECT_V2_FORK_SCHEMA_VERSION } from '@/types/projectV2'
import { electricalDropTargetSchema, checkElectricalDropTarget } from '../electricalDropTarget'
import { electricalSemanticDestinationSchema, resolveElectricalSemanticTarget } from '../electricalSemanticTarget'
import type { ElectricalSemanticDestination, SemanticTargetResult } from '../electricalSemanticTarget'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import { CommandError, defineProjectCommand, type EntityRef } from '../types'
import type { ProjectV2 } from '@/types/projectV2'
import type { Circuit, Endpoint } from '@/types/schema'
import { executeDropBehavior } from '@/lib/eendraad/dropBehaviors'
import { computeEndpointInsertAfter } from '@/lib/eendraad/endpointInsertAfter'
import { createDraftDropBehaviorCallbacks } from '@/lib/eendraad/draftDropBehaviorCallbacks'
import {
  moveEndpointSelectionBetweenCircuits,
  moveEndpointSelectionOnCircuit,
} from '@/lib/eendraad/moveEndpointSelection'
import { planEndpointSelectionMove } from '@/lib/eendraad/multiSelectionMove'
import {
  reorderDomoticaChildEndpoint,
} from '@/lib/eendraad/domoticaOutputOrdering'
import { getBranchDownstreamEndpointIds } from '@/lib/eendraad/downstreamSelection'
import {
  collectDomoticaEndpointIdsForDeletion,
  findCircuitById,
  findEndpointById,
} from '@/lib/eendraad/projectElectricalDomain'
import { isMainPanelDistributionEndpoint } from '@/lib/plan/panelDistributionEndpoint'
import { isDomoticaPanelFeedEndpoint } from '@/lib/eendraad/panelSupplyLink'
import { circuitContainsJunctionPanelIdentity, getJunctionIdentity } from '@/lib/junctionIdentity'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { getSymbolById } from '@/lib/symbols'
import { deleteEndpointsFromProject } from '@/lib/eendraad/endpointDeletion'
import { getDomainTranslator } from '@/lib/i18n/domainI18n'
import { moveEndpointToSupplyDcBus } from '@/lib/eendraad/supplyTrunkDeviceMove'
import {
  reconcileDirectConverterDcDevices,
  reconcileSupplyAssemblyBranchProtections,
} from '@/lib/supplyAssembly/editorIntegration'
import {
  addEndpointToProject,
  applyEndpointCircuitResultsInProject,
  mergeEndpointIntoMultiplierInProject,
  takeOrdinaryEndpointForMove,
} from '@/lib/eendraad/endpointMutations'

const sitplanSchema = z.object({
  activeFloorId: z.string().min(1).nullable(),
  viewportCenter: z.object({ x: z.number().finite(), y: z.number().finite() }).nullable(),
  activePanelId: z.string().min(1).nullable(),
})

function circuitForProject(project: ProjectV2, circuitId: string): Circuit | undefined {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const found = findCircuitById(panel, circuitId)
    if (found) return found.circuit
  }
  return undefined
}

function sourceForEndpoint(project: ProjectV2, endpointId: string) {
  for (const panel of getEditableProjectElectricalPanels(project)) {
    const found = findEndpointById(panel, endpointId)
    if (found) return found
  }
  return null
}

function equalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function domoticaGroup(circuit: Circuit, endpointId: string): string[] {
  const endpoint = circuit.endpoints.find((candidate) => candidate.id === endpointId)
  if (endpoint?.symbol !== 'domotica' || endpoint.domoticaChildProps) return []
  return [...collectDomoticaEndpointIdsForDeletion(circuit, [endpointId])].filter((id) =>
    circuit.endpoints.some((candidate) => candidate.id === id)
  )
}

function resolveMoveTarget(project: ProjectV2, input: {
  target?: DropTarget
  destination?: ElectricalSemanticDestination
}): SemanticTargetResult {
  if (input.destination) return resolveElectricalSemanticTarget(project, input.destination)
  const target = input.target
  if (!target) return { ok: false, code: 'target_required', message: 'A move destination is required' }
  if (target.type !== 'endpoint' || !target.endpointId) return { ok: true, target }
  if (target.circuitId && (target.branchEndpoints !== undefined || target.domoticaOutput ||
      target.domoticaChildDropIntent || target.converterDcConnection || target.dcBusId))
    return { ok: true, target }
  const resolved = resolveElectricalSemanticTarget(project, { kind: 'endpoint', endpointId: target.endpointId })
  return resolved.ok ? { ok: true, target: {
    ...resolved.target,
    ...target,
    circuitId: target.circuitId ?? resolved.target.circuitId,
    panelId: target.panelId ?? resolved.target.panelId,
    branchEndpoints: target.branchEndpoints ?? resolved.target.branchEndpoints,
    insertAfterEndpointId: target.insertAfterEndpointId === undefined
      ? resolved.target.insertAfterEndpointId : target.insertAfterEndpointId,
  } } : resolved
}

/** Move existing one-wire endpoints through one atomic project command. */
export const eendraadMoveEndpoints = defineProjectCommand({
  id: 'electrical.moveEndpoints',
  version: 1,
  input: z.object({
    draggedEndpointId: z.string().min(1),
    selectedEndpointIds: z.array(z.string().min(1)).optional(),
    target: electricalDropTargetSchema.optional(),
    destination: electricalSemanticDestinationSchema.optional(),
    sitplan: sitplanSchema.optional(),
  }).strict().superRefine((input, context) => {
    if (Boolean(input.target) === Boolean(input.destination))
      context.addIssue({ code: 'custom', path: ['destination'], message: 'Provide exactly one target or semantic destination.' })
  }),
  check(project, input) {
    const resolved = resolveMoveTarget(project, input)
    if (!resolved.ok) return resolved
    const target = resolved.target
    const source = sourceForEndpoint(project, input.draggedEndpointId)
    if (!source) return { ok: false, code: 'endpoint_not_found', message: 'Endpoint not found' }
    if (isMainPanelDistributionEndpoint(project, source.endpoint)) {
      return {
        ok: false,
        code: 'protected_endpoint',
        message: 'The main panel symbol cannot be moved',
      }
    }
    const selected = input.selectedEndpointIds ?? [input.draggedEndpointId]
    if (new Set(selected).size !== selected.length || !selected.includes(input.draggedEndpointId)) {
      return {
        ok: false,
        code: 'invalid_selection',
        message: 'The dragged endpoint must be in the selection',
      }
    }
    for (const endpointId of selected) {
      const selectedOwner = sourceForEndpoint(project, endpointId)
      if (!selectedOwner) {
        return {
          ok: false,
          code: 'endpoint_selection_mismatch',
          message: 'Every selected endpoint must still exist',
        }
      }
      if (isMainPanelDistributionEndpoint(project, selectedOwner.endpoint)) {
        return {
          ok: false,
          code: 'protected_endpoint',
          message: 'The main panel symbol cannot be moved',
        }
      }
    }
    const sourceCircuit = source.circuit
    const targetCheck = checkElectricalDropTarget(
      project,
      target,
      input.sitplan?.activeFloorId
    )
    if (!targetCheck.ok) return targetCheck
    const targetCircuit = target.circuitId
      ? circuitForProject(project, target.circuitId)
      : undefined
    if (usesForkRunMove(sourceCircuit, targetCircuit, target))
      return checkForkRunMove(sourceCircuit, targetCircuit, input.draggedEndpointId, selected, target)
    const expandedSelection = new Set(selected)
    for (const endpointId of selected) {
      const owner = sourceForEndpoint(project, endpointId)!
      for (const childId of domoticaGroup(owner.circuit, endpointId)) expandedSelection.add(childId)
    }
    const outputFeeds = [...expandedSelection].flatMap((id) => {
      const owner = sourceForEndpoint(project, id)
      return owner && isDomoticaPanelFeedEndpoint(owner.endpoint) ? [owner] : []
    })
    if (outputFeeds.length && (!targetCircuit ||
      outputFeeds.some((owner) => owner.circuit.id !== targetCircuit.id))) {
      return { ok: false, code: 'output_feed', message: 'A domotica output feeding a panel cannot be moved to another circuit.' }
    }
    if (outputFeeds.length && source.endpoint.symbol !== 'domotica' &&
      target.domoticaOutput?.group !== 'endpoint') {
      return { ok: false, code: 'output_feed', message: 'A panel feed must stay on a domotica endpoint output.' }
    }
    if (outputFeeds.length && target.domoticaOutput?.group === 'control') {
      return { ok: false, code: 'output_feed', message: 'A panel feed cannot be moved to a control output.' }
    }
    if (targetCircuit?.code === 'PANEL') {
      return {
        ok: false,
        code: 'panel_circuit_target',
        message: 'Endpoints cannot be moved to the panel anchor circuit',
      }
    }
    if (targetCircuit) {
      const owners = selected.map((endpointId) => sourceForEndpoint(project, endpointId))
      const expandedIds = new Set(selected)
      for (const owner of owners) {
        if (!owner) continue
        for (const childId of domoticaGroup(owner.circuit, owner.endpoint.id)) expandedIds.add(childId)
      }
      const expandedOwners = [...expandedIds].map((endpointId) => sourceForEndpoint(project, endpointId))
      if (new Set(expandedOwners.flatMap((owner) => owner?.circuit.id ?? [])).size > 1) {
        const identities = new Set<string>()
        for (const owner of expandedOwners) {
          if (owner?.endpoint.symbol !== 'junction_panel') continue
          const identity = getJunctionIdentity(owner.endpoint).trim().toUpperCase()
          if (identity && identities.has(identity)) {
            return {
              ok: false,
              code: 'duplicate_junction_panel',
              message: 'This junction panel already belongs to the target circuit',
            }
          }
          if (identity) identities.add(identity)
        }
      }
      for (const endpointId of expandedIds) {
        const selectedEndpoint = sourceForEndpoint(project, endpointId)?.endpoint
        if (
          selectedEndpoint?.symbol === 'junction_panel' &&
          circuitContainsJunctionPanelIdentity(
            targetCircuit,
            getJunctionIdentity(selectedEndpoint),
            selectedEndpoint.id
          )
        ) {
          return {
            ok: false,
            code: 'duplicate_junction_panel',
            message: 'This junction panel already belongs to the target circuit',
          }
        }
      }
    }
    if (
      target.circuitId === sourceCircuit.id &&
      target.type === 'circuit' &&
      target.endpointId &&
      !sourceCircuit.endpoints.some((endpoint) => endpoint.id === target.endpointId)
    ) {
      return {
        ok: false,
        code: 'endpoint_not_found',
        message: 'Drop anchor does not belong to the source circuit',
      }
    }
    return { ok: true }
  },
  apply(draft, input, env) {
    const project = draft as ProjectV2
    const resolved = resolveMoveTarget(project, input)
    if (!resolved.ok) throw new CommandError('check_failed', resolved.message, { reason: resolved.code })
    let target = resolved.target
    const sourceInfo = sourceForEndpoint(project, input.draggedEndpointId)
    if (!sourceInfo)
      throw new CommandError('check_failed', 'Endpoint not found', { reason: 'endpoint_not_found' })
    const sourceCircuit = sourceInfo.circuit
    const sourceEndpoint = sourceInfo.endpoint
    const forkDestination = target.circuitId ? circuitForProject(project, target.circuitId) : undefined
    if (usesForkRunMove(sourceCircuit, forkDestination, target)) {
      const moved = moveSavedForkRun(sourceCircuit, forkDestination!, input.draggedEndpointId, input.selectedEndpointIds ?? [input.draggedEndpointId], target, env.newId)
      if (moved.length) project.schemaVersion = PROJECT_V2_FORK_SCHEMA_VERSION
      return { created: [], changed: moved.length ? [...new Set([sourceCircuit.id, forkDestination!.id])].map((id) => ({ kind: 'circuit' as const, id })) : [], removed: [], select: moved.map((id) => ({ kind: 'endpoint' as const, id })) }
    }
    const selected = input.selectedEndpointIds ?? [input.draggedEndpointId]
    const selectedIdsSet = new Set(selected)
    for (const endpointId of selected) {
      const selectedOwner = sourceForEndpoint(project, endpointId)
      if (!selectedOwner) continue
      for (const childId of domoticaGroup(selectedOwner.circuit, endpointId)) {
        selectedIdsSet.add(childId)
      }
    }
    const selectedIds = [...selectedIdsSet]

    if (target.type === 'supplyConverterDcWire') {
      if (selectedIds.length !== 1)
        throw new CommandError('check_failed', 'Move one endpoint at a time to a supply DC wire', {
          reason: 'unsupported_selection',
        })
      const result = moveEndpointToSupplyDcBus(
        project,
        input.draggedEndpointId,
        sourceCircuit.id,
        target
      )
      if (!result)
        throw new CommandError(
          'check_failed',
          'This endpoint cannot be moved to that supply wire',
          { reason: 'drop_rejected' }
        )
      for (const panelId of new Set([result.sourcePanelId, result.targetPanelId])) {
        if (!panelId) continue
        reconcileDirectConverterDcDevices(project, panelId)
        reconcileSupplyAssemblyBranchProtections(project, panelId)
      }
      const refs: EntityRef[] = [{ kind: 'trunkDevice', id: result.device.id }]
      return {
        created: refs,
        changed: [{ kind: 'circuit', id: sourceCircuit.id }],
        removed: [{ kind: 'endpoint', id: input.draggedEndpointId }],
        select: refs,
      }
    }

    const targetCircuit = target.circuitId
      ? circuitForProject(project, target.circuitId)
      : undefined
    if (sourceEndpoint.symbol === 'domotica' && !sourceEndpoint.domoticaChildProps) {
      const dropEndpoint = target.endpointId
        ? sourceForEndpoint(project, target.endpointId)?.endpoint
        : undefined
      if (dropEndpoint?.domoticaChildProps || target.domoticaOutput) {
        target = {
          ...target,
          domoticaOutput: undefined,
          domoticaChildDropIntent: undefined,
          insertAfterEndpointId: dropEndpoint?.id ?? target.insertAfterEndpointId,
        }
      }
    }
    if (
      sourceEndpoint.domoticaChildProps &&
      target.domoticaChildDropIntent === 'replace' &&
      target.endpointId &&
      selectedIds.length === 1
    ) {
      const merge = mergeEndpointIntoMultiplierInProject(
        project,
        input.draggedEndpointId,
        target.endpointId,
        input.sitplan?.activeFloorId ?? null,
        env.newId
      )
      if (merge?.status === 'blocked') {
        return { created: [], changed: [], removed: [], select: [] }
      }
      if (merge?.status === 'merged') {
        return {
          created: [],
          changed: [...new Set([merge.sourceCircuitId, merge.targetCircuitId])].map((id) => ({
            kind: 'circuit' as const,
            id,
          })),
          removed: [{ kind: 'endpoint', id: input.draggedEndpointId }],
          select: [{ kind: 'endpoint', id: merge.targetEndpointId }],
        }
      }
    }
    if (target.domoticaOutput && target.endpointId && targetCircuit?.id === sourceCircuit.id) {
      const selectedChildIds = selectedIds.filter((endpointId) =>
        sourceCircuit.endpoints.some(
          (endpoint) => endpoint.id === endpointId && !!endpoint.domoticaChildProps
        )
      )
      const childId = selectedChildIds[0]
      const expectedBranchSelection = childId
        ? getBranchDownstreamEndpointIds(sourceCircuit, childId)
        : []
      const selectionMatchesChildBranch =
        selectedChildIds.length === 1 &&
        (selectedIds.length === 1 ||
          (expectedBranchSelection.length === selectedIds.length &&
            expectedBranchSelection.every((endpointId) => selectedIds.includes(endpointId))))
      const result =
        selectionMatchesChildBranch && childId
          ? reorderDomoticaChildEndpoint(
              sourceCircuit,
              childId,
              target.endpointId,
              target.domoticaOutput.group,
              target.domoticaOutput.index
            )
          : null
      if (!result || equalValue(result.endpoints, sourceCircuit.endpoints)) {
        return {
          created: [],
          changed: [],
          removed: [],
          select: selectedIds.map((id) => ({ kind: 'endpoint' as const, id })),
        }
      }
      applyEndpointCircuitResultsInProject(project, [
        {
          circuitId: sourceCircuit.id,
          endpoints: result.endpoints,
          branches: result.branches,
        },
      ])
      return {
        created: [],
        changed: [{ kind: 'circuit', id: sourceCircuit.id }],
        removed: [],
        select: (selectedIds.length === 1 ? [childId!] : expectedBranchSelection).map((id) => ({
          kind: 'endpoint' as const,
          id,
        })),
      }
    }

    const shouldMoveBranches =
      selectedIds.length > 1 ||
      typeof target.branchInsertIndex === 'number' ||
      (sourceEndpoint.symbol === 'domotica' && !sourceEndpoint.domoticaChildProps)
    if (targetCircuit && shouldMoveBranches && selectedIds.length > 1) {
      const move = planEndpointSelectionMove(
        selectedIds,
        target,
        (endpointId) => sourceForEndpoint(project, endpointId)?.circuit,
        (circuitId) => circuitForProject(project, circuitId),
        env.newId
      )
      if (!move) {
        return {
          created: [],
          changed: [],
          removed: [],
          select: selectedIds.map((id) => ({ kind: 'endpoint' as const, id })),
        }
      }
      applyEndpointCircuitResultsInProject(project, move.updates)
      return {
        created: [],
        changed: move.updates.map((update) => ({ kind: 'circuit' as const, id: update.circuitId })),
        removed: [],
        select: move.movedEndpointIds.map((id) => ({ kind: 'endpoint' as const, id })),
      }
    }
    if (targetCircuit && shouldMoveBranches && selectedIds.length === 1) {
      const groupMove =
        sourceCircuit.id === targetCircuit.id
          ? moveEndpointSelectionOnCircuit(
              sourceCircuit,
              input.draggedEndpointId,
              selectedIds,
              target,
              { allowSingle: true, newId: env.newId }
            )
          : moveEndpointSelectionBetweenCircuits(
              sourceCircuit,
              targetCircuit,
              input.draggedEndpointId,
              selectedIds,
              target,
              { allowSingle: true, newId: env.newId }
            )
      if (groupMove) {
        if ('source' in groupMove) {
          applyEndpointCircuitResultsInProject(project, [
            {
              circuitId: sourceCircuit.id,
              endpoints: groupMove.source.endpoints,
              branches: groupMove.source.branches,
            },
            {
              circuitId: targetCircuit.id,
              endpoints: groupMove.target.endpoints,
              branches: groupMove.target.branches,
            },
          ])
        } else {
          applyEndpointCircuitResultsInProject(project, [
            {
              circuitId: sourceCircuit.id,
              endpoints: groupMove.endpoints,
              branches: groupMove.branches,
            },
          ])
        }
        const movedIds =
          'source' in groupMove ? groupMove.target.movedEndpointIds : groupMove.movedEndpointIds
        return {
          created: [],
          changed: [...new Set([sourceCircuit.id, targetCircuit.id])].map((id) => ({
            kind: 'circuit' as const,
            id,
          })),
          removed: [],
          select: movedIds.map((id) => ({ kind: 'endpoint' as const, id })),
        }
      }
      if (
        selectedIds.length > 1 ||
        typeof target.branchInsertIndex === 'number' ||
        (sourceEndpoint.symbol === 'domotica' && !sourceEndpoint.domoticaChildProps)
      ) {
        return {
          created: [],
          changed: [],
          removed: [],
          select: selectedIds.map((id) => ({ kind: 'endpoint', id })),
        }
      }
      if (sourceCircuit.id === targetCircuit.id && typeof target.branchInsertIndex !== 'number') {
        const targetBranch = (sourceCircuit.branches ?? []).find(
          (branch, index) =>
            branch.id === target.branchId ||
            target.branchId === `branch-${sourceCircuit.id}-${index}` ||
            (target.branchEndpoints?.length &&
              branch.endpointIds.some((id) => target.branchEndpoints!.includes(id))) ||
            (!!target.endpointId && branch.endpointIds.includes(target.endpointId))
        )
        if (targetBranch?.endpointIds.some((id) => selectedIds.includes(id))) {
          return {
            created: [],
            changed: [],
            removed: [],
            select: selectedIds.map((id) => ({ kind: 'endpoint', id })),
          }
        }
      }
    }
    if (sourceEndpoint.symbol === 'domotica' && !sourceEndpoint.domoticaChildProps) {
      return {
        created: [],
        changed: [],
        removed: [],
        select: selectedIds.map((id) => ({ kind: 'endpoint', id })),
      }
    }
    if (selectedIds.length > 1) {
      return {
        created: [],
        changed: [],
        removed: [],
        select: selectedIds.map((id) => ({ kind: 'endpoint', id })),
      }
    }

    const symbol = sourceEndpoint.symbol ? getSymbolById(sourceEndpoint.symbol) : undefined
    if (!symbol)
      throw new CommandError('check_failed', 'Endpoint has no movable symbol', {
        reason: 'drop_rejected',
      })
    if (target.endpointId === sourceEndpoint.id || target.insertAfterEndpointId === sourceEndpoint.id) {
      return { created: [], changed: [], removed: [], select: [{ kind: 'endpoint', id: sourceEndpoint.id }] }
    }
    if (targetCircuit?.id === sourceCircuit.id && target.branchEndpoints?.includes(sourceEndpoint.id)) {
      const insertion = computeEndpointInsertAfter(target, sourceCircuit, symbol)
      const branchIndex = target.branchEndpoints.indexOf(sourceEndpoint.id)
      const previousId = branchIndex > 0 ? target.branchEndpoints[branchIndex - 1] : null
      if (!insertion.createNewBranch && (insertion.insertAfterEndpointId === sourceEndpoint.id ||
          insertion.insertAfterEndpointId === previousId))
        return { created: [], changed: [], removed: [], select: [{ kind: 'endpoint', id: sourceEndpoint.id }] }
    }
    const retainedEndpoint = takeOrdinaryEndpointForMove(project, sourceEndpoint.id, target)
    const createdEndpointIds: string[] = []
    let rejectedMessage: string | undefined
    const callbacks = createDraftDropBehaviorCallbacks(
      project,
      input.sitplan ?? { activeFloorId: null, viewportCenter: null, activePanelId: null },
      {
        newId: env.newId,
        existingEndpointId: retainedEndpoint?.id,
        addEndpoint: (circuitId, generatedEndpoint, insertAfterEndpointId, branchOpts) => {
          const latestSource =
            sourceForEndpoint(project, input.draggedEndpointId)?.endpoint ?? sourceEndpoint
          const isDomoticaChildDrop = !!generatedEndpoint.domoticaChildProps
          const movedEndpoint: Endpoint = retainedEndpoint ? {
            ...generatedEndpoint,
            ...retainedEndpoint,
            placements: [...(retainedEndpoint.placements ?? [])],
          } : {
            ...latestSource,
            ...generatedEndpoint,
            placements: [...(latestSource.placements ?? [])],
            domoticaChildProps: generatedEndpoint.domoticaChildProps,
            converterDcConnection: generatedEndpoint.converterDcConnection,
            id: generatedEndpoint.id,
          }
          if (!isDomoticaChildDrop) delete (movedEndpoint as Partial<Endpoint>).label
          const isInterCircuitMove = circuitId !== sourceCircuit.id
          // The shared callback performs the same endpoint insertion and branch repair as the
          // store action; inter-circuit moves intentionally let the destination derive labels.
          const addedId = addEndpointToProject(
            project,
            circuitId,
            movedEndpoint,
            isInterCircuitMove && !retainedEndpoint ? undefined : insertAfterEndpointId,
            branchOpts,
            env.newId
          )
          if (addedId) createdEndpointIds.push(movedEndpoint.id)
        },
        onDropRejected: (message) => {
          rejectedMessage = message
        },
      }
    )
    const addPlacement = callbacks.addPlacement
    callbacks.addPlacement = (endpointId, placement) => {
      const latestSource =
        sourceForEndpoint(project, input.draggedEndpointId)?.endpoint ?? sourceEndpoint
      if ((latestSource.placements?.length ?? 0) > 0) return
      addPlacement(endpointId, placement)
    }
    executeDropBehavior(
      symbol,
      target,
      project,
      getDomainTranslator(env.language),
      callbacks,
      false
    )
    if (rejectedMessage)
      throw new CommandError('check_failed', rejectedMessage, { reason: 'drop_rejected' })
    if (createdEndpointIds.length === 0)
      throw new CommandError('check_failed', 'Endpoint was not moved', { reason: 'nothing_moved' })
    if (retainedEndpoint) {
      applyEndpointCircuitResultsInProject(project, [...new Set([sourceCircuit.id, targetCircuit?.id])]
        .flatMap((id) => {
          const circuit = id ? circuitForProject(project, id) : undefined
          return circuit ? [{ circuitId: circuit.id, endpoints: circuit.endpoints, branches: circuit.branches }] : []
        }))
    } else deleteEndpointsFromProject(project, [input.draggedEndpointId])
    return {
      created: retainedEndpoint ? [] : createdEndpointIds.map((id) => ({ kind: 'endpoint' as const, id })),
      changed: [
        ...[...new Set([sourceCircuit.id, targetCircuit?.id].filter((id): id is string => !!id))]
          .map((id) => ({ kind: 'circuit' as const, id })),
        ...(retainedEndpoint ? [{ kind: 'endpoint' as const, id: retainedEndpoint.id }] : []),
      ],
      removed: retainedEndpoint ? [] : [{ kind: 'endpoint', id: input.draggedEndpointId }],
      select: createdEndpointIds.map((id) => ({ kind: 'endpoint' as const, id })),
    }
  },
})
