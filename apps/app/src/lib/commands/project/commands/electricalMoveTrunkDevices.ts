import { z } from 'zod'
import { moveSupplyTrunkDeviceAtDropTarget } from '@/lib/eendraad/supplyTrunkDeviceMove'
import { mutateTrunkDeviceRelocation } from '@/lib/layout/eendraadPreviewSimulation'
import {
  findCircuitById,
  findPanelContainingCircuit,
  cleanupPanelGridSlotsForDevice,
  rewriteRelocatedCircuitTrunkDeviceGridRef,
} from '@/lib/eendraad/projectElectricalDomain'
import { findPanelById } from '@/lib/panel/panelTree'
import {
  getEditableProjectElectricalPanels,
  getProjectElectricalInstallation,
} from '@/lib/projectV2/electrical'
import { retargetSupplyTapAnchors } from '@/lib/supplyTaps/healSupplyTaps'
import {
  reconcileDirectConverterDcDevices,
  reconcileSupplyAssemblyBranchProtections,
} from '@/lib/supplyAssembly/editorIntegration'
import { getSymbolById } from '@/lib/symbols'
import type { ProjectV2 } from '@/types/projectV2'
import type { ElectricalEnclosureRef } from '@/types/supplyAssembly'
import { CommandError, defineProjectCommand, type EntityRef } from '../types'
import { checkElectricalDropTarget, electricalDropTargetSchema } from '../electricalDropTarget'

const enclosureRefSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('grid') }),
  z.strictObject({ kind: z.literal('panel'), panelId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('auxiliary'), enclosureId: z.string().min(1) }),
]) satisfies z.ZodType<ElectricalEnclosureRef>

const supplyMoveInput = z.strictObject({
  deviceId: z.string().min(1),
  target: electricalDropTargetSchema,
  targetMounting: enclosureRefSchema.optional(),
})

const circuitMoveInput = z.strictObject({
  deviceId: z.string().min(1),
  sourceCircuitId: z.string().min(1),
  target: electricalDropTargetSchema,
})

function cloneProject(project: ProjectV2): ProjectV2 {
  return JSON.parse(JSON.stringify(project)) as ProjectV2
}

function commitCandidate(draft: ProjectV2, candidate: ProjectV2): void {
  Object.assign(draft, candidate)
}

function runSupplyMove(
  project: ProjectV2,
  input: z.output<typeof supplyMoveInput>,
  newId: () => string
): { panels: string[]; deviceId: string; changed: boolean } | null {
  // Taps that leave the wire after the moved device follow the device before it.
  const sourceFeed = getProjectElectricalInstallation(project)?.feedTopology?.rootFeeds?.find((feed) =>
    (feed.trunkDevices ?? []).some((device) => device.id === input.deviceId)
  )
  const sourceOwner = sourceFeed
    ? findPanelById(getEditableProjectElectricalPanels(project), sourceFeed.panelId)
    : undefined
  const devicesBefore = [...(sourceFeed?.trunkDevices ?? [])]
  const result = moveSupplyTrunkDeviceAtDropTarget(
    project,
    input.deviceId,
    input.target,
    input.targetMounting,
    newId
  )
  if (!result) return null
  if (result.changed !== false && sourceOwner)
    retargetSupplyTapAnchors(sourceOwner, devicesBefore, input.deviceId)
  const panelIds = [
    ...new Set([result.sourcePanelId, result.targetPanelId].filter((id): id is string => !!id)),
  ]
  for (const panelId of panelIds) {
    reconcileDirectConverterDcDevices(project, panelId)
    reconcileSupplyAssemblyBranchProtections(project, panelId)
  }
  return { panels: panelIds, deviceId: result.device.id, changed: result.changed !== false }
}

function circuitRelocationContext(project: ProjectV2, circuitId: string, deviceId: string) {
  const owner = getEditableProjectElectricalPanels(project)
    .map((panel) => findPanelContainingCircuit(panel, circuitId))
    .find((panel) => panel != null)
  const result = owner && findCircuitById(owner, circuitId)
  const device = result?.circuit.trunkDevices?.find((entry) => entry.id === deviceId)
  return owner && result && device ? { panel: owner, circuit: result.circuit, device } : null
}

function runCircuitMove(
  project: ProjectV2,
  input: z.output<typeof circuitMoveInput>,
  newId: () => string
): {
  panels: string[]
  relatedCircuits: string[]
  resultKind: 'endpoint' | 'trunkDevice'
  changed: boolean
} | null {
  const source = circuitRelocationContext(project, input.sourceCircuitId, input.deviceId)
  const symbol = source && getSymbolById(source.device.symbol)
  if (!source || !symbol) return null
  const beforeSourceTrunkDevices = JSON.stringify(source.circuit.trunkDevices ?? [])
  if (
    !mutateTrunkDeviceRelocation(
      project,
      { id: input.deviceId, sourceCircuitId: input.sourceCircuitId },
      input.target,
      symbol,
      newId
    )
  )
    return null

  if (
    input.target.type === 'circuit' &&
    input.target.circuitId === input.sourceCircuitId &&
    beforeSourceTrunkDevices === JSON.stringify(source.circuit.trunkDevices ?? [])
  ) {
    return {
      panels: [],
      relatedCircuits: [],
      resultKind: 'trunkDevice',
      changed: false,
    }
  }

  const affectedCircuitIds = new Set([input.sourceCircuitId])
  const panelIds = new Set([source.panel.id])
  if (input.target.circuitId) {
    affectedCircuitIds.add(input.target.circuitId)
    const destination = getEditableProjectElectricalPanels(project)
      .map((panel) => findPanelContainingCircuit(panel, input.target.circuitId!))
      .find((panel) => panel != null)
    if (destination) panelIds.add(destination.id)
  }
  if (
    (input.target.type === 'circuit' || input.target.type === 'endpoint') &&
    input.target.circuitId
  ) {
    rewriteRelocatedCircuitTrunkDeviceGridRef(
      project,
      input.deviceId,
      input.sourceCircuitId,
      input.target.circuitId,
      input.target.type === 'endpoint' ? 'endpoint' : 'trunkDevice'
    )
  } else if (input.target.type === 'supplyConverterDcWire') {
    cleanupPanelGridSlotsForDevice(getEditableProjectElectricalPanels(project), {
      kind: 'trunkDevice',
      id: input.deviceId,
      scope: 'circuit',
      circuitId: input.sourceCircuitId,
    })
    if (input.target.panelId) panelIds.add(input.target.panelId)
    for (const panelId of panelIds) {
      reconcileDirectConverterDcDevices(project, panelId)
      reconcileSupplyAssemblyBranchProtections(project, panelId)
    }
  }
  return {
    panels: [...panelIds],
    relatedCircuits: [...affectedCircuitIds],
    resultKind: input.target.type === 'endpoint' ? 'endpoint' : 'trunkDevice',
    changed: true,
  }
}

function checkTarget(project: ProjectV2, target: z.output<typeof electricalDropTargetSchema>) {
  const result = checkElectricalDropTarget(project, target)
  return result
}

function validateCircuitTarget(
  project: ProjectV2,
  target: z.output<typeof electricalDropTargetSchema>
) {
  const result = checkTarget(project, target)
  if (!result.ok) return result
  if (!['circuit', 'endpoint', 'supplyConverterDcWire'].includes(target.type ?? '')) {
    return {
      ok: false as const,
      code: 'unsupported_relocation_target',
      message: 'This destination does not accept a circuit trunk device',
    }
  }
  return { ok: true as const }
}

/** Relocates supply-frame devices, including their DC branch and enclosure placement. */
export const electricalMoveSupplyTrunkDevice = defineProjectCommand({
  id: 'electrical.moveSupplyTrunkDevice',
  version: 1,
  input: supplyMoveInput,
  check(project, input) {
    const targetCheck = checkTarget(project, input.target)
    if (!targetCheck.ok) return targetCheck
    const candidate = cloneProject(project)
    return runSupplyMove(candidate, input, () => '__command_check_branch__')
      ? { ok: true as const }
      : {
          ok: false as const,
          code: 'move_rejected',
          message: 'Supply device cannot be moved to this destination',
        }
  },
  apply(draft, input, env) {
    const project = draft as ProjectV2
    const before = JSON.stringify(project)
    const candidate = cloneProject(project)
    const result = runSupplyMove(candidate, input, env.newId)
    if (!result)
      throw new CommandError('check_failed', 'Supply device move was rejected', {
        reason: 'move_rejected',
      })
    if (!result.changed || before === JSON.stringify(candidate))
      return { created: [], changed: [], removed: [] }
    commitCandidate(project, candidate)
    return {
      created: [],
      changed: [{ kind: 'trunkDevice', id: result.deviceId }],
      removed: [],
      related: result.panels.map((id) => ({ kind: 'panel' as const, id })),
      select: [{ kind: 'trunkDevice', id: result.deviceId }],
    }
  },
})

/** Relocates a circuit trunk device and applies endpoint conversion/grid/topology repairs. */
export const electricalMoveCircuitTrunkDevice = defineProjectCommand({
  id: 'electrical.moveCircuitTrunkDevice',
  version: 1,
  input: circuitMoveInput,
  check(project, input) {
    const targetCheck = validateCircuitTarget(project, input.target)
    if (!targetCheck.ok) return targetCheck
    if (!circuitRelocationContext(project, input.sourceCircuitId, input.deviceId)) {
      return {
        ok: false,
        code: 'trunk_device_not_found',
        message: 'Trunk device does not belong to the source circuit',
      }
    }
    const candidate = cloneProject(project)
    return runCircuitMove(candidate, input, () => '__command_check_branch__')
      ? { ok: true }
      : {
          ok: false,
          code: 'move_rejected',
          message: 'Circuit trunk device cannot be moved to this destination',
        }
  },
  apply(draft, input, env) {
    const project = draft as ProjectV2
    const before = JSON.stringify(project)
    const candidate = cloneProject(project)
    const result = runCircuitMove(candidate, input, env.newId)
    if (!result)
      throw new CommandError('check_failed', 'Circuit trunk device move was rejected', {
        reason: 'move_rejected',
      })
    if (!result.changed || before === JSON.stringify(candidate))
      return { created: [], changed: [], removed: [] }
    commitCandidate(project, candidate)
    const ref: EntityRef = { kind: result.resultKind, id: input.deviceId }
    return {
      created: [],
      changed: [ref],
      removed: [],
      related: [
        ...result.panels.map((id) => ({ kind: 'panel' as const, id })),
        ...result.relatedCircuits.map((id) => ({ kind: 'circuit' as const, id })),
      ],
      select: [ref],
    }
  },
})
