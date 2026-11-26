import type { Branch, Circuit, Endpoint, Panel, ProtectionDevice } from '@/types/schema'
import { isHorizontalDomotica } from '@/lib/layout/domoticaHorizontalGeometry'
import { initializeBranchesIfNeeded } from '@/lib/layout/endpointChains'

/**
 * Terminal rule of the horizontal domotica module (`domoticaProps.oneWireLayout === 'horizontal'`).
 *
 * A horizontal module is the last thing on its circuit: no sibling continues past it on its
 * branch, no further branch or fork leaves the circuit after it and no trunk device sits after
 * it. Its outputs only hold branch chains of plain devices, never another module. It also never
 * belongs to the supply side (see "Supply assembly" below). One pure
 * module backs the properties field, the commands, the drop targets and the transaction
 * invariant so they cannot disagree. Existing data that already violates the rule is never
 * changed here; the rule only refuses to offer or add more.
 */

export const HORIZONTAL_DOMOTICA_TERMINAL_MESSAGE =
  'A horizontal domotica module is the last device on its circuit; nothing can be placed after it.'
export const HORIZONTAL_DOMOTICA_NO_NESTING_MESSAGE =
  'A horizontal domotica module cannot contain another domotica module.'

export const HORIZONTAL_DOMOTICA_TOP_LEVEL_MESSAGE =
  'A horizontal domotica module cannot be placed on the output of another module.'

export const HORIZONTAL_DOMOTICA_NO_SUPPLY_MESSAGE =
  'A horizontal domotica module cannot be part of a supply assembly.'

type CircuitShape = Pick<Circuit, 'endpoints' | 'branches' | 'trunkDevices'>

/*
 * Supply assembly: a horizontal module is never part of the supply/feed topology. Supply trunk
 * devices, supply-assembly nodes and DC buses are handled by the project-level invariant
 * (commands/project/horizontalDomoticaIntegrity.ts). The circuit-level checks below decide
 * whether a module on a circuit sits on the supply side: on a DC bus rail or converter lane,
 * or on a circuit that hangs on a supply tap, a converter backup port or a DC bus.
 */

/** The records a circuit hangs under; they carry supply markers a bare circuit does not. */
export interface SupplySideOwner {
  protection?: Pick<ProtectionDevice, 'supplyTap' | 'dcBusId' | 'directDcBusFeeder'>
  panel?: Pick<Panel, 'virtual'>
}

type SupplyCircuitShape = Pick<Circuit, 'supplyTap' | 'supplySource' | 'dcBusSource'>

export function isCircuitOnSupplySide(circuit: SupplyCircuitShape, owner?: SupplySideOwner): boolean {
  return !!(
    circuit.supplyTap ||
    circuit.supplySource ||
    circuit.dcBusSource ||
    owner?.protection?.supplyTap ||
    owner?.protection?.dcBusId ||
    owner?.protection?.directDcBusFeeder ||
    owner?.panel?.virtual?.kind === 'supply-taps'
  )
}

/** Whether the endpoint sits on a DC bus rail, a converter lane or a supply-side circuit. */
export function isEndpointInSupplyAssembly(
  circuit: CircuitShape & SupplyCircuitShape,
  endpointId: string,
  owner?: SupplySideOwner
): boolean {
  const endpoint = circuit.endpoints.find((candidate) => candidate.id === endpointId)
  if (!endpoint) return false
  if (endpoint.converterDcConnection) return true
  if (circuit.branches?.some((branch) => branch.dcBusId && branch.endpointIds.includes(endpointId)))
    return true
  return isCircuitOnSupplySide(circuit, owner)
}

/** The drop-target fields that mean "somewhere on the supply side"; `DropTarget` satisfies it. */
export interface SupplyDropTargetFields {
  type?: string | null
  supplyTapAnchor?: unknown
  supplyDeviceInsertIndex?: number
  supplyFeedScope?: string
  supplyPanelInput?: boolean
  supplyConverterDcBranch?: string
  supplyConverterDcConnectionIndex?: number
  supplyDcBusId?: string
  supplyDcBusBranchId?: string
  converterGridPlacement?: string
  changeoverGridPlacement?: string
  supplyConverterChangeoverSlot?: boolean
  dcBusId?: string
  converterDcConnection?: unknown
  branchDeviceInsertIndex?: number
}

/**
 * Whether a drop at `target` lands in the supply assembly: a supply wire, tap, converter or DC
 * bus zone, or a circuit that itself hangs on the supply side (`circuit` and `owner` describe the
 * circuit the target resolves to, when it has one).
 */
export function isDropTargetIntoSupplyAssembly(
  target: SupplyDropTargetFields,
  circuit?: SupplyCircuitShape,
  owner?: SupplySideOwner
): boolean {
  if (typeof target.type === 'string' && target.type.startsWith('supply')) return true
  if (
    target.supplyTapAnchor ||
    target.supplyDeviceInsertIndex !== undefined ||
    target.supplyFeedScope ||
    target.supplyPanelInput ||
    target.supplyConverterDcBranch ||
    target.supplyConverterDcConnectionIndex !== undefined ||
    target.supplyDcBusId ||
    target.supplyDcBusBranchId ||
    target.converterGridPlacement ||
    target.changeoverGridPlacement ||
    target.supplyConverterChangeoverSlot ||
    target.dcBusId ||
    target.converterDcConnection ||
    target.branchDeviceInsertIndex !== undefined
  )
    return true
  return !!circuit && isCircuitOnSupplySide(circuit, owner)
}

export interface ContinuationAfterModule {
  /** Non-output endpoints that follow the module on its own branch. */
  siblingEndpointIds: string[]
  /** Root branches stored after the module's branch. */
  branchIds: string[]
  /** Forks that leave the module or a sibling after it. */
  forkBranchIds: string[]
  /** Trunk devices positioned after the module's branch. */
  trunkDeviceIds: string[]
}

export function countContinuation(continuation: ContinuationAfterModule): number {
  return (
    continuation.siblingEndpointIds.length +
    continuation.branchIds.length +
    continuation.forkBranchIds.length +
    continuation.trunkDeviceIds.length
  )
}

interface ModuleSite {
  branches: Branch[]
  branch: Branch
  branchIndex: number
  /** Index among the branches that do not fork from another branch (the trunk order). */
  rootIndex: number
  moduleIndex: number
}

function locateModule(circuit: CircuitShape, moduleId: string): ModuleSite | null {
  const branches = initializeBranchesIfNeeded(circuit) as Branch[]
  const branchIndex = branches.findIndex((branch) => branch.endpointIds.includes(moduleId))
  if (branchIndex < 0) return null
  const branch = branches[branchIndex]!
  const rootIndex = branch.forkFrom
    ? -1
    : branches.slice(0, branchIndex).filter((candidate) => !candidate.forkFrom).length
  return { branches, branch, branchIndex, rootIndex, moduleIndex: branch.endpointIds.indexOf(moduleId) }
}

/** What follows the module on its circuit, or null when the module is not on a branch. */
export function getContinuationAfterDomoticaModule(
  circuit: CircuitShape,
  moduleId: string
): ContinuationAfterModule | null {
  const site = locateModule(circuit, moduleId)
  if (!site) return null
  const byId = new Map(circuit.endpoints.map((endpoint) => [endpoint.id, endpoint]))
  const after = site.branch.endpointIds.slice(site.moduleIndex + 1)
  const siblingEndpointIds = after.filter((id) => !byId.get(id)?.domoticaChildProps)
  const anchors = new Set([moduleId, ...siblingEndpointIds])
  const forkBranchIds = site.branches
    .filter((branch) => branch.forkFrom && anchors.has(branch.forkFrom.afterEndpointId))
    .map((branch) => branch.id)
  const branchIds =
    site.rootIndex < 0
      ? []
      : site.branches
          .filter((branch) => !branch.forkFrom)
          .slice(site.rootIndex + 1)
          .map((branch) => branch.id)
  const trunkDeviceIds =
    site.rootIndex < 0
      ? []
      : (circuit.trunkDevices ?? [])
          .filter((device) => !device.converterDcConnection && device.trunkPosition > site.rootIndex)
          .map((device) => device.id)
  return { siblingEndpointIds, branchIds, forkBranchIds, trunkDeviceIds }
}

export type HorizontalDomoticaSwitchBlock =
  | 'not_a_module'
  | 'nested'
  | 'dc_bus'
  | 'supply_assembly'
  | 'has_nested_modules'
  | 'continuation'

/**
 * Why `moduleId` cannot be switched to the horizontal layout, or null when it can. The one rule
 * for both the Layout field and `properties.edit`. Switching back to vertical is always allowed.
 */
export function getHorizontalDomoticaSwitchBlock(
  circuit: CircuitShape & Partial<SupplyCircuitShape>,
  moduleId: string,
  owner?: SupplySideOwner
): HorizontalDomoticaSwitchBlock | null {
  const module = circuit.endpoints.find((endpoint) => endpoint.id === moduleId)
  if (!module || module.symbol !== 'domotica') return 'not_a_module'
  if (module.domoticaChildProps) return 'nested'
  const site = locateModule(circuit, moduleId)
  if (!site) return 'not_a_module'
  if (site.branch.dcBusId) return 'dc_bus'
  if (isEndpointInSupplyAssembly(circuit, moduleId, owner)) return 'supply_assembly'
  if (
    circuit.endpoints.some(
      (endpoint) =>
        endpoint.symbol === 'domotica' && endpoint.domoticaChildProps?.parentEndpointId === moduleId
    )
  )
    return 'has_nested_modules'
  const continuation = getContinuationAfterDomoticaModule(circuit, moduleId)
  return continuation && countContinuation(continuation) > 0 ? 'continuation' : null
}

export interface HorizontalDomoticaViolation {
  /** Items that continue past the module. */
  after: number
  /** Domotica modules placed on its outputs. */
  nested: number
}

/** Per horizontal module in `circuit` that breaks the rule, what breaks it. */
export function getHorizontalDomoticaViolations(
  circuit: CircuitShape
): Map<string, HorizontalDomoticaViolation> {
  const violations = new Map<string, HorizontalDomoticaViolation>()
  for (const endpoint of circuit.endpoints) {
    if (!isHorizontalDomotica(endpoint)) continue
    const continuation = getContinuationAfterDomoticaModule(circuit, endpoint.id)
    const nested = circuit.endpoints.filter(
      (candidate) =>
        candidate.symbol === 'domotica' && candidate.domoticaChildProps?.parentEndpointId === endpoint.id
    ).length
    const after = continuation ? countContinuation(continuation) : 0
    if (after > 0 || nested > 0) violations.set(endpoint.id, { after, nested })
  }
  return violations
}

export function circuitHasHorizontalDomotica(circuit: Pick<Circuit, 'endpoints'>): boolean {
  return circuit.endpoints.some(isHorizontalDomotica)
}

/** The drop-target fields the terminal rule reads; `DropTarget` satisfies it. */
export interface TerminalDropTargetFields {
  type?: string | null
  endpointId?: string
  insertAfterEndpointId?: string | null
  branchEndpoints?: string[]
  branchInsertIndex?: number
  circuitTrunkBranchSlot?: number
  forkAfterEndpointId?: string
  domoticaOutput?: { group: string; index: number; expands?: boolean }
  domoticaChildDropIntent?: 'replace' | 'insertBefore' | 'insertAfter'
  dcBusId?: string
  converterDcConnection?: unknown
}

/**
 * Whether a drop at `target` on `circuit` would put something after one of its horizontal
 * modules: an insert/append on the module's branch past it, a new branch or fork after it, or
 * a trunk slot after it. Drops on an output of the module (including its expand zone) and
 * replacing or inserting within an output chain are not "after".
 */
export function isDropTargetAfterHorizontalDomotica(
  circuit: CircuitShape,
  target: TerminalDropTargetFields
): boolean {
  if (target.dcBusId || target.converterDcConnection) return false
  // Placing within a module's own output chains (or its expand zone) is never "after".
  if (target.domoticaOutput || target.domoticaChildDropIntent) return false
  const modules = circuit.endpoints.filter(isHorizontalDomotica)
  if (!modules.length) return false
  const childOf = new Map(circuit.endpoints.map((endpoint) => [endpoint.id, endpoint.domoticaChildProps]))
  const isOutputContent = (id: string | null | undefined) => !!id && !!childOf.get(id)
  for (const module of modules) {
    const site = locateModule(circuit, module.id)
    if (!site) continue
    const siblingsAfter = new Set(
      site.branch.endpointIds
        .slice(site.moduleIndex + 1)
        .filter((id) => !isOutputContent(id))
    )
    const anchors = new Set([module.id, ...siblingsAfter])
    const inModuleBranch = !!target.branchEndpoints?.includes(module.id)
    if (typeof target.insertAfterEndpointId === 'string') {
      if (anchors.has(target.insertAfterEndpointId)) return true
    } else if (inModuleBranch && target.insertAfterEndpointId === undefined) {
      // An append on the module's branch lands after the module (and after any chain).
      return true
    }
    if (target.forkAfterEndpointId && anchors.has(target.forkAfterEndpointId)) return true
    if (typeof target.branchInsertIndex === 'number' && target.branchInsertIndex > site.branchIndex)
      return true
    if (
      typeof target.circuitTrunkBranchSlot === 'number' &&
      site.rootIndex >= 0 &&
      target.circuitTrunkBranchSlot > site.rootIndex
    )
      return true
  }
  return false
}

/** Whether `endpoint` is an output child of a horizontal module in `circuit` (directly or by chain). */
export function getHorizontalDomoticaParent(
  circuit: Pick<Circuit, 'endpoints'>,
  endpointId: string | undefined
): Endpoint | undefined {
  if (!endpointId) return undefined
  const endpoint = circuit.endpoints.find((candidate) => candidate.id === endpointId)
  const parentId = endpoint?.domoticaChildProps?.parentEndpointId
  if (!parentId) return isHorizontalDomotica(endpoint) ? endpoint : undefined
  const parent = circuit.endpoints.find((candidate) => candidate.id === parentId)
  return isHorizontalDomotica(parent) ? parent : undefined
}

/**
 * Whether placing `symbolId` at `target` would nest a domotica module under a horizontal one:
 * dropped on one of its outputs, or inserted into/replacing a chain on one.
 */
export function isDomoticaNestingUnderHorizontalModule(
  circuit: Pick<Circuit, 'endpoints'>,
  target: TerminalDropTargetFields,
  symbolId: string
): boolean {
  if (symbolId !== 'domotica') return false
  if (target.domoticaOutput && getHorizontalDomoticaParent(circuit, target.endpointId)) return true
  return !!target.domoticaChildDropIntent && !!getHorizontalDomoticaParent(circuit, target.endpointId)
}
