import type { Circuit, CircuitKind, Panel, ProtectionDevice } from '@/types/schema'
import type { EndpointType } from '@/types/schema'
import { getDerivedCircuitKind } from '@/lib/circuitKind'
import type { SymbolMetadata } from '@/lib/symbols'
import { getEndpointTypeFromSymbol } from '@/utils'
import { collectCircuits } from '@/utils/eendraad/panelHelpers'
import { flattenBoardPanels } from '@/lib/panel/panelTree'
import { findVirtualPanelOwner } from '@/lib/supplyTaps/virtualPanel'
import {
  selectProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { getMainBusOrder } from '@/lib/eendraad/mainBusOrder'
import { excelColumnLabelFromZeroBasedIndex } from '@/utils/project'

/** Belgian practice: avoid stuffing more than this many branch points on one circuit from plan drops. */
export const PLAN_DROP_MAX_ENDPOINTS_PER_CIRCUIT = 8
export const PLAN_DROP_AUTO_CIRCUIT_CODE_OPTION_COUNT = 78

export type PlanDropKind = 'lighting' | 'sockets' | 'fixed_appliance' | 'other'

export function endpointTypeToPlanDropKind(endpointType: EndpointType): PlanDropKind {
  if (endpointType === 'light_point' || endpointType === 'switch') return 'lighting'
  if (endpointType === 'socket') return 'sockets'
  if (endpointType === 'fixed_appliance') return 'fixed_appliance'
  return 'other'
}

export function planDropKindToCircuitKind(dropKind: PlanDropKind): CircuitKind {
  switch (dropKind) {
    case 'lighting':
      return 'lighting'
    case 'sockets':
      return 'sockets'
    case 'fixed_appliance':
      return 'fixed_appliance'
    default:
      return 'other'
  }
}

export function countPlanDropEndpoints(circuit: Circuit): number {
  return circuit.endpoints.filter((e) => e.symbol !== 'panel_distribution').length
}

function circuitWithoutEndpoints(circuit: Circuit, ignoredEndpointIds: ReadonlySet<string>): Circuit {
  if (ignoredEndpointIds.size === 0) return circuit
  return {
    ...circuit,
    endpoints: circuit.endpoints.filter((endpoint) => !ignoredEndpointIds.has(endpoint.id)),
    branches: circuit.branches?.map((branch) => ({
      ...branch,
      endpointIds: branch.endpointIds.filter((endpointId) => !ignoredEndpointIds.has(endpointId)),
    })),
  }
}

export function circuitHasNestedSubCircuits(circuit: Circuit): boolean {
  return (circuit.subCircuitIds?.length ?? 0) > 0
}

export type PlanDropCircuitIssue =
  | 'wrong_kind'
  | 'at_capacity'
  | 'has_nested_circuits'
  | 'dedicated_fixed_appliance'

export function planDropCircuitIssues(
  circuit: Circuit,
  protection: ProtectionDevice | null | undefined,
  dropKind: PlanDropKind,
  options: { ignoredEndpointIds?: Iterable<string> } = {}
): { derivedKind: CircuitKind; issues: PlanDropCircuitIssue[] } {
  const ignoredEndpointIds = new Set(options.ignoredEndpointIds ?? [])
  const effectiveCircuit = circuitWithoutEndpoints(circuit, ignoredEndpointIds)
  const derivedKind = getDerivedCircuitKind(effectiveCircuit, protection)
  const issues: PlanDropCircuitIssue[] = []
  if (circuitHasNestedSubCircuits(effectiveCircuit)) issues.push('has_nested_circuits')
  if (countPlanDropEndpoints(effectiveCircuit) >= PLAN_DROP_MAX_ENDPOINTS_PER_CIRCUIT) {
    issues.push('at_capacity')
  }
  if (isDedicatedApplianceKind(derivedKind) && countPlanDropEndpoints(effectiveCircuit) > 0) {
    issues.push('dedicated_fixed_appliance')
  }
  if (isWrongKindForPlanDrop(derivedKind, dropKind)) {
    issues.push('wrong_kind')
  }
  return { derivedKind, issues }
}

export function isEligiblePlanDropTarget(issues: PlanDropCircuitIssue[]): boolean {
  return issues.length === 0
}

/** Preferred (eligible) circuits first, then less-ideal targets — each group sorted by `compareCircuits`. */
export function orderPlanDropCircuitsForDisplay(
  circuits: Circuit[],
  isEligible: (circuitId: string) => boolean,
  compareCircuits: (a: Circuit, b: Circuit) => number
): { preferred: Circuit[]; other: Circuit[] } {
  const preferred: Circuit[] = []
  const other: Circuit[] = []
  for (const circuit of circuits) {
    if (isEligible(circuit.id)) preferred.push(circuit)
    else other.push(circuit)
  }
  preferred.sort(compareCircuits)
  other.sort(compareCircuits)
  return { preferred, other }
}

/** Circuit codes offered for a new circuit; `codeAt` follows the project's label scheme. */
export function buildPlanDropAutoCircuitCodeOptions(
  count = PLAN_DROP_AUTO_CIRCUIT_CODE_OPTION_COUNT,
  codeAt: (index: number) => string = excelColumnLabelFromZeroBasedIndex
): string[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => codeAt(index))
}

export function buildPlanDropAvailableCircuitCodeOptions(
  panel: Panel,
  movingCircuitId: string | null | undefined,
  count = PLAN_DROP_AUTO_CIRCUIT_CODE_OPTION_COUNT,
  codeAt: (index: number) => string = excelColumnLabelFromZeroBasedIndex
): string[] {
  const used = new Set<string>()
  const movingProtectionIds = new Set<string>()
  for (const protection of panel.protections ?? []) {
    if (protection.circuits?.some((c) => c.id === movingCircuitId)) {
      movingProtectionIds.add(protection.id)
      continue
    }
    const label = (protection.label ?? '').trim().toUpperCase()
    if (label) used.add(label)
  }
  for (const circuit of collectCircuits(panel)) {
    if (circuit.id === movingCircuitId || circuit.code === 'PANEL') continue
    const code = (circuit.code ?? '').trim().toUpperCase()
    if (code) used.add(code)
  }

  const generated = buildPlanDropAutoCircuitCodeOptions(count, codeAt)
  const options = generated.filter((code) => !used.has(code.toUpperCase()))
  const currentProtection = panel.protections.find((p) => movingProtectionIds.has(p.id))
  const currentCode = (
    collectCircuits(panel).find((c) => c.id === movingCircuitId)?.code ||
    currentProtection?.label ||
    ''
  )
    .trim()
    .toUpperCase()
  // Keep the circuit's own automatic code on offer, even past the generated range.
  const ownCode =
    generated.find((code) => code.toUpperCase() === currentCode) ??
    (/^[A-Z]+$/.test(currentCode) ? currentCode : undefined)
  if (ownCode && !options.includes(ownCode)) {
    options.unshift(ownCode)
  }
  return options
}

function excelColumnLabelToZeroBasedIndex(label: string): number | null {
  const normalized = label.trim().toUpperCase()
  if (!/^[A-Z]+$/.test(normalized)) return null
  let n = 0
  for (const char of normalized) {
    n = n * 26 + (char.charCodeAt(0) - 64)
  }
  return n - 1
}

export function comparePlanDropCircuitCodes(a: string, b: string): number {
  const left = a.trim()
  const right = b.trim()
  const leftExcelIndex = excelColumnLabelToZeroBasedIndex(left)
  const rightExcelIndex = excelColumnLabelToZeroBasedIndex(right)
  if (leftExcelIndex !== null && rightExcelIndex !== null) {
    return leftExcelIndex - rightExcelIndex
  }
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

function mainBusItemOwnsCircuit(
  panel: Panel,
  item: { type: 'circuit' | 'protection'; id: string },
  circuitId: string
): boolean {
  if (item.type === 'circuit') return item.id === circuitId
  const protection = panel.protections.find((p) => p.id === item.id)
  return protection?.circuits?.some((c) => c.id === circuitId) === true
}

function mainBusItemCode(
  panel: Panel,
  item: { type: 'circuit' | 'protection'; id: string }
): string {
  if (item.type === 'circuit') {
    return panel.circuits.find((c) => c.id === item.id)?.code?.trim() ?? ''
  }
  const protection = panel.protections.find((p) => p.id === item.id)
  return (
    protection?.label?.trim() ||
    protection?.circuits?.find((c) => c.code?.trim())?.code?.trim() ||
    ''
  )
}

export function getPlanDropCircuitInsertIndexForCode(
  panel: Panel,
  movingCircuitId: string,
  requestedCode: string
): number {
  const requested = requestedCode.trim()
  if (!requested) return getMainBusOrder(panel).length

  const stableOrder = getMainBusOrder(panel).filter(
    (item) => !mainBusItemOwnsCircuit(panel, item, movingCircuitId)
  )
  const insertIndex = stableOrder.findIndex((item) => {
    const existingCode = mainBusItemCode(panel, item)
    if (!existingCode) return false
    return comparePlanDropCircuitCodes(requested, existingCode) < 0
  })
  return insertIndex >= 0 ? insertIndex : stableOrder.length
}

function isWrongKindForPlanDrop(derived: CircuitKind, dropKind: PlanDropKind): boolean {
  if (derived === 'empty' || derived === 'mixed') return false
  if (derived === 'subpanel' || derived === 'solar' || derived === 'battery') return true
  if (dropKind === 'lighting') {
    return derived === 'sockets'
  }
  if (dropKind === 'sockets') {
    return derived === 'lighting'
  }
  if (dropKind === 'fixed_appliance') {
    return derived === 'lighting' || derived === 'sockets'
  }
  return false
}

function isDedicatedApplianceKind(derived: CircuitKind): boolean {
  return (
    derived === 'fixed_appliance' ||
    derived === 'boiler' ||
    derived === 'heating' ||
    derived === 'ev' ||
    derived === 'hvac'
  )
}

/**
 * Pick default circuit id: prefer last choice for this drop kind, then last worked circuit,
 * then first eligible in panel circuit order.
 */
export function pickDefaultPlanDropCircuitId(options: {
  orderedCircuitIds: string[]
  isEligible: (circuitId: string) => boolean
  lastForDropKind: string | null | undefined
  lastWorkedCircuitId: string | null | undefined
}): string | null {
  const { orderedCircuitIds, isEligible, lastForDropKind, lastWorkedCircuitId } = options
  if (lastForDropKind && isEligible(lastForDropKind)) return lastForDropKind
  if (lastWorkedCircuitId && isEligible(lastWorkedCircuitId)) return lastWorkedCircuitId
  return orderedCircuitIds.find((id) => isEligible(id)) ?? null
}

export type PlanDropCircuitChoice =
  | { mode: 'existing'; circuitId: string }
  | { mode: 'new'; protectionLabel?: string; circuitNotes?: string }

/**
 * Same default panel + circuit the picker would choose — used to commit the drop immediately.
 */
export function resolveInitialPlanDropAssignment(
  project: ProjectWithOptionalV2Electrical,
  symbol: SymbolMetadata,
  prefs: {
    planDropLastPanelId: string | null
    planDropLastCircuitIdByDropKind: Partial<Record<PlanDropKind, string>>
    lastWorkedCircuitId: string | null
  },
  getProtectionForCircuit: (circuitId: string) => ProtectionDevice | undefined
): { panelId: string; circuitChoice: PlanDropCircuitChoice; dropKind: PlanDropKind } | null {
  const endpointType = getEndpointTypeFromSymbol(symbol)
  if (!endpointType) return null

  const dropKind = endpointTypeToPlanDropKind(endpointType)
  const panelsFlat = flattenBoardPanels(selectProjectElectricalPanels(project))
  if (panelsFlat.length === 0) return null

  const panelId =
    prefs.planDropLastPanelId && panelsFlat.some((p) => p.id === prefs.planDropLastPanelId)
      ? prefs.planDropLastPanelId
      : panelsFlat[0]!.id

  const panel = panelsFlat.find((p) => p.id === panelId)
  if (!panel) return null

  const circuitRows = collectCircuits(panel).filter((c) => c.code !== 'PANEL')
  const orderedCircuitIds = circuitRows.map((c) => c.id)

  const eligibilityMap = new Map<string, boolean>()
  for (const c of circuitRows) {
    const prot = getProtectionForCircuit(c.id)
    const { issues } = planDropCircuitIssues(c, prot, dropKind)
    eligibilityMap.set(c.id, isEligiblePlanDropTarget(issues))
  }

  const defaultId = pickDefaultPlanDropCircuitId({
    orderedCircuitIds,
    isEligible: (id) => eligibilityMap.get(id) === true,
    lastForDropKind: prefs.planDropLastCircuitIdByDropKind[dropKind],
    lastWorkedCircuitId: prefs.lastWorkedCircuitId,
  })

  if (defaultId) {
    return {
      panelId,
      circuitChoice: { mode: 'existing', circuitId: defaultId },
      dropKind,
    }
  }

  return {
    panelId,
    circuitChoice: { mode: 'new', protectionLabel: '' },
    dropKind,
  }
}

/** The board a picker should preselect: a virtual board (supply taps) maps to the board that owns it. */
export function resolvePickableBoardPanelId(
  project: ProjectWithOptionalV2Electrical,
  panelId: string
): string {
  return findVirtualPanelOwner(selectProjectElectricalPanels(project), panelId)?.id ?? panelId
}
