/**
 * Duplicate an endpoint on a circuit with configurable branch placement.
 * Used from 1draad / plan context menus and intended for helper-bubble call sites.
 */

import {
  clonePlacementsForDuplicate,
  clonePlacementsOptionsForEndpoint,
  sitplanPlacementsForDuplicateClone,
} from '@/lib/eendraad/duplicateSitplanHelpers'
import { endpointSupportsMultiplier } from '@/utils/endpointMultipliers'
import type { Branch, Circuit, Endpoint, Panel } from '@/types/schema'
import { generateId } from '@/utils'
import { initializeBranchesIfNeeded } from '@/lib/layout/endpointChains'
import { isInBetweenEndpoint } from '@/utils/symbolMapping'
import { resolvePanelSupplyLinksForSourcePanel } from '@/lib/eendraad/panelSupplyLink'
import { clamp } from '@/lib/geometry'
import { clearDuplicatedControlChannel } from '@/lib/controlLink/duplicateAddress'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

function circuitFeedsSubPanel(project: ProjectWithOptionalV2Electrical, circuitId: string): boolean {
  const stack: Panel[] = [...getProjectElectricalPanels(project)]
  while (stack.length) {
    const panel = stack.pop()!
    for (const link of resolvePanelSupplyLinksForSourcePanel(project, panel)) {
      if (link.feederCircuit?.id === circuitId) return true
    }
    if (panel.subPanels?.length) {
      stack.push(...panel.subPanels)
    }
  }
  return false
}

/** Which UI surface chose default placement rules */
export type EndpointDuplicateContext = 'eendraad' | 'plan'

/**
 * - new_branch: only the duplicate lives on a new horizontal branch (circuit row in 1draad).
 *   `order` controls where that branch is inserted in the branch list (layout: higher index = further up).
 * - same_branch_after_anchor: insert immediately after `anchorEndpointId` on the same branch
 *   (chained lights, or a switch duplicated before the downstream terminal).
 */
export type EndpointDuplicatePlacement =
  | {
      mode: 'new_branch'
      order?: 'append' | 'before_source_branch' | 'after_source_branch'
    }
  | { mode: 'same_branch_after_anchor'; anchorEndpointId: string }

export interface DuplicateEndpointOnCircuitParams {
  circuitId: string
  sourceEndpointId: string
  context: EndpointDuplicateContext
  /** When omitted, {@link resolveDefaultEndpointDuplicatePlacement} is used */
  placement?: EndpointDuplicatePlacement
  selectNew?: boolean
}

export interface DuplicateEndpointDeps {
  getCircuitById: (id: string) => Circuit | undefined
  getEndpointById: (id: string) => Endpoint | undefined
  addEndpoint: (
    circuitId: string,
    endpoint: Endpoint,
    insertAfterEndpointId?: string | null
  ) => void
  updateCircuit: (circuitId: string, updates: Partial<Circuit>) => void
  setSelection?: (sel: { type: 'endpoint'; ids: string[] }) => void
}

export interface DuplicateEndpointOnCircuitResult {
  ok: boolean
  newEndpointId?: string
  newEndpointIds?: string[]
  reason?: string
}

function copyBranches(circuit: Circuit): Branch[] {
  return initializeBranchesIfNeeded(circuit).map((b) => ({
    ...b,
    endpointIds: [...b.endpointIds],
  }))
}

function branchIndexContaining(branches: Branch[], endpointId: string): number {
  return branches.findIndex((b) => b.endpointIds.includes(endpointId))
}

/**
 * Default rules: in-between device → after self; else new branch on top.
 * Plan canvas uses sitplan multipliers (extra placements) for lights / impulse / DC symbols — not this path.
 */
export function resolveDefaultEndpointDuplicatePlacement(
  endpoint: Endpoint,
  _context: EndpointDuplicateContext
): EndpointDuplicatePlacement {
  if (isInBetweenEndpoint(endpoint)) {
    return { mode: 'same_branch_after_anchor', anchorEndpointId: endpoint.id }
  }
  return { mode: 'new_branch', order: 'append' }
}

export function endpointSymbolCanBeDuplicated(
  endpoint: Endpoint | undefined,
  options?: { allowDomoticaChild?: boolean },
): boolean {
  if (!endpoint) return false
  if (endpoint.symbol === 'panel_distribution') return false
  if (endpoint.domoticaChildProps && !options?.allowDomoticaChild) return false
  return true
}

function cloneEndpointForDuplicate(
  source: Endpoint,
  options?: { keepPlacements?: boolean },
): Endpoint {
  const clone: Endpoint = JSON.parse(JSON.stringify(source))
  clone.id = generateId()
  clone.label = ''
  clone.placements =
    options?.keepPlacements && endpointSupportsMultiplier(source) && source.placements?.length
      ? clonePlacementsForDuplicate(
          source.placements,
          clonePlacementsOptionsForEndpoint(source),
        )
      : []
  clone.controlledEndpointIds = undefined
  if (clone.domoticaProps) {
    clone.domoticaProps = {
      ...clone.domoticaProps,
      endpointChildEndpointIds: undefined,
      controlChildEndpointIds: undefined,
    }
  }
  return clearDuplicatedControlChannel(clone)
}

function repairNewBranch(
  circuitId: string,
  newEndpointId: string,
  insertIndex: number,
  deps: DuplicateEndpointDeps,
  dcBusId?: string,
): void {
  const circuit = deps.getCircuitById(circuitId)
  if (!circuit) return

  const next = copyBranches(circuit)
  for (const b of next) {
    b.endpointIds = b.endpointIds.filter((id) => id !== newEndpointId)
  }
  const clamped = clamp(insertIndex, 0, next.length)
  const newBranch: Branch = {
    id: generateId(),
    label: '',
    endpointIds: [newEndpointId],
    ...(dcBusId ? { dcBusId } : {}),
  }
  next.splice(clamped, 0, newBranch)
  deps.updateCircuit(circuitId, { branches: next })
}

/**
 * Duplicate `sourceEndpointId` on `circuitId` using `placement` (or defaults from `context`).
 * Pass `project` to block terminal sub-panel feeder circuits (same as drop rules).
 */
/**
 * Duplicate every endpoint on a branch as a new branch inserted above the source branch.
 */
/** Branch list index: higher index = further up on the one-wire diagram. */
function branchInsertIndexAboveSource(sourceBranchIdx: number): number {
  return sourceBranchIdx + 1
}

export function duplicateBranchAboveOnCircuit(
  project: ProjectWithOptionalV2Electrical | null,
  params: { circuitId: string; sourceEndpointIds: string[]; selectNew?: boolean },
  deps: DuplicateEndpointDeps,
): DuplicateEndpointOnCircuitResult {
  const { circuitId, sourceEndpointIds, selectNew = true } = params
  if (project && circuitFeedsSubPanel(project, circuitId)) {
    return { ok: false, reason: 'circuit_feeds_subpanel' }
  }

  const circuit = deps.getCircuitById(circuitId)
  if (!circuit) return { ok: false, reason: 'circuit_not_found' }

  const orderedIds = sourceEndpointIds.filter((id) => {
    const ep = deps.getEndpointById(id)
    return ep && endpointSymbolCanBeDuplicated(ep)
  })
  if (orderedIds.length === 0) return { ok: false, reason: 'invalid_source' }

  const branchesBefore = copyBranches(circuit)
  const sourceBranchIdx = branchIndexContaining(branchesBefore, orderedIds[0]!)
  if (sourceBranchIdx < 0) return { ok: false, reason: 'source_not_in_branch' }
  const sourceBranch = branchesBefore[sourceBranchIdx]

  const clones: Endpoint[] = []
  for (const eid of orderedIds) {
    const source = deps.getEndpointById(eid)
    if (!source) continue
    const clone = cloneEndpointForDuplicate(source)
    clone.placements = sitplanPlacementsForDuplicateClone(source)
    clones.push(clone)
  }
  if (clones.length === 0) return { ok: false, reason: 'invalid_source' }

  const newEndpointIds = clones.map((c) => c.id)
  const nextBranches = copyBranches(circuit)
  const newBranch: Branch = {
    id: generateId(),
    label: '',
    endpointIds: newEndpointIds,
    ...(sourceBranch?.dcBusId ? { dcBusId: sourceBranch.dcBusId } : {}),
  }
  nextBranches.splice(branchInsertIndexAboveSource(sourceBranchIdx), 0, newBranch)

  deps.updateCircuit(circuitId, {
    endpoints: [...circuit.endpoints, ...clones],
    branches: nextBranches,
  })

  if (selectNew && newEndpointIds.length > 0) {
    deps.setSelection?.({ type: 'endpoint', ids: newEndpointIds })
  }
  return { ok: true, newEndpointId: newEndpointIds[0], newEndpointIds }
}

export function duplicateEndpointOnCircuit(
  project: ProjectWithOptionalV2Electrical | null,
  params: DuplicateEndpointOnCircuitParams,
  deps: DuplicateEndpointDeps
): DuplicateEndpointOnCircuitResult {
  const {
    circuitId,
    sourceEndpointId,
    context,
    placement: placementOverride,
    selectNew = true,
  } = params

  if (project && circuitFeedsSubPanel(project, circuitId)) {
    return { ok: false, reason: 'circuit_feeds_subpanel' }
  }

  const source = deps.getEndpointById(sourceEndpointId)
  if (!source || !endpointSymbolCanBeDuplicated(source)) {
    return { ok: false, reason: 'invalid_source' }
  }

  const circuit = deps.getCircuitById(circuitId)
  if (!circuit) {
    return { ok: false, reason: 'circuit_not_found' }
  }

  const placement = placementOverride ?? resolveDefaultEndpointDuplicatePlacement(source, context)
  const clone = cloneEndpointForDuplicate(source)

  if (placement.mode === 'same_branch_after_anchor') {
    deps.addEndpoint(circuitId, clone, placement.anchorEndpointId)
    if (selectNew) deps.setSelection?.({ type: 'endpoint', ids: [clone.id] })
    return { ok: true, newEndpointId: clone.id }
  }

  const order = placement.order ?? 'append'
  const branchesBefore = copyBranches(circuit)
  const sourceBranchIdx = branchIndexContaining(branchesBefore, sourceEndpointId)
  if (sourceBranchIdx < 0) {
    return { ok: false, reason: 'source_not_in_branch' }
  }

  clone.placements = sitplanPlacementsForDuplicateClone(source)

  if (order === 'append') {
    const lastBranch = branchesBefore[branchesBefore.length - 1]
    const lastId = lastBranch?.endpointIds[lastBranch?.endpointIds.length - 1]
    deps.addEndpoint(circuitId, clone, lastId)
    repairNewBranch(
      circuitId,
      clone.id,
      branchesBefore.length,
      deps,
      branchesBefore[sourceBranchIdx]?.dcBusId,
    )
  } else if (order === 'before_source_branch') {
    const nextBranches = copyBranches(circuit)
    const sourceBranch = nextBranches[sourceBranchIdx]
    const newBranch: Branch = {
      id: generateId(),
      label: '',
      endpointIds: [clone.id],
      ...(sourceBranch?.dcBusId ? { dcBusId: sourceBranch.dcBusId } : {}),
    }
    nextBranches.splice(branchInsertIndexAboveSource(sourceBranchIdx), 0, newBranch)
    deps.updateCircuit(circuitId, {
      endpoints: [...circuit.endpoints, clone],
      branches: nextBranches,
    })
  } else {
    deps.addEndpoint(circuitId, clone, undefined)
    repairNewBranch(
      circuitId,
      clone.id,
      branchInsertIndexAboveSource(sourceBranchIdx),
      deps,
      branchesBefore[sourceBranchIdx]?.dcBusId,
    )
  }

  if (selectNew) deps.setSelection?.({ type: 'endpoint', ids: [clone.id] })
  return { ok: true, newEndpointId: clone.id }
}
