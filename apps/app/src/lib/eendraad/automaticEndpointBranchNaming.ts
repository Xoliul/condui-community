import { formatBranchLabel } from '@/lib/eendraad/labelScheme'
import { getActiveLabelScheme } from '@/lib/eendraad/labelSchemeContext'
import type { Circuit, Panel } from '@/types/schema'
import { getBranchLabelOwners, getCircuitPointSequence } from '@/lib/eendraad/circuitPointNumbering'

/** Circuits on this panel only (`panel.circuits` + `protection.circuits`). Subpanels are separate panels for naming. */
export function forEachCircuitOnPanel(panel: Panel, fn: (circuit: Circuit) => void): void {
  for (const c of panel.circuits) {
    fn(c)
  }
  for (const protection of panel.protections) {
    for (const c of protection.circuits ?? []) {
      fn(c)
    }
  }
}

/**
 * Resolve the prefix used for sequential endpoint-branch labels. A blank nested circuit inherits
 * the nearest labeled parent circuit so series protections share the visible bus label.
 *
 * Nested circuits can legitimately have an empty circuit code while already
 * carrying a branch label such as `C1`. In that case, preserve that established
 * prefix so newly added sibling branches become `C2`, `C3`, and so on.
 */
function getInheritedCircuitLabelPrefix(
  panel: Panel,
  circuitId: string,
  visited = new Set<string>(),
): string {
  if (visited.has(circuitId)) return ''
  visited.add(circuitId)

  const candidates: Circuit[] = []
  forEachCircuitOnPanel(panel, (candidate) => candidates.push(candidate))
  const parent = candidates.find((candidate) => candidate.subCircuitIds?.includes(circuitId))
  if (!parent) return ''

  const parentCode = (parent.code ?? '').trim()
  return parentCode || getInheritedCircuitLabelPrefix(panel, parent.id, visited)
}

export function getEndpointBranchLabelPrefix(circuit: Circuit, panel?: Panel): string {
  if (circuit.code === 'PANEL') return ''
  const circuitCode = (circuit.code ?? '').trim()
  if (circuitCode) return circuitCode

  const inheritedPrefix = panel ? getInheritedCircuitLabelPrefix(panel, circuit.id) : ''
  if (inheritedPrefix) return inheritedPrefix

  for (const branch of circuit.branches ?? []) {
    const match = (branch.label ?? '').trim().match(/^(.+?)(\d+)$/)
    // A separated branch label (`3.1`) leaves its separator on the prefix; drop it again.
    const prefix = match?.[1]?.trim().replace(/[.\-/]$/, '')
    if (prefix) return prefix
  }

  return ''
}

/**
 * True if branch labels, endpoint labels on those branches, or numbered trunk-switch labels
 * differ from `{code}{1..n}` in circuit point order.
 */
export function endpointBranchLabelsWouldChange(
  circuit: Circuit,
  circuitCodeForBranches: string,
  panel?: Panel,
): boolean {
  if (circuit.code === 'PANEL') return false
  const code = circuitCodeForBranches.trim() || getEndpointBranchLabelPrefix(circuit, panel)
  if (!code) return false
  const branches = circuit.branches ?? []
  const sequence = getCircuitPointSequence(circuit)
  for (let point = 0; point < sequence.length; point++) {
    const slot = sequence[point]!
    const expected = getExpectedBranchLabel(circuit, code, point)
    if (slot.kind === 'trunkSwitch') {
      if ((slot.device.label ?? '').trim() !== expected) return true
      continue
    }
    const branch = branches[slot.branchIndex]!
    if ((branch.label ?? '').trim() !== expected) return true
    for (const id of branch.endpointIds) {
      const ep = circuit.endpoints.find((e) => e.id === id)
      if (ep && ep.symbol !== 'panel_distribution' && (ep.label ?? '').trim() !== expected) return true
    }
  }
  const owners = getBranchLabelOwners(circuit)
  const byId = new Map(branches.map((branch) => [branch.id, branch]))
  return branches.some((branch) => branch.forkFrom && branch.label !== byId.get(owners.get(branch.id) ?? '')?.label)
}

/**
 * DC-bus branches already carry their hierarchical branch number in the
 * circuit code (for example A1.2). Do not append another flat `1` to it.
 */
export function getExpectedBranchLabel(
  circuit: Circuit,
  code: string,
  branchIndex: number
): string {
  return circuit.dcBusSource && code.includes('.')
    ? branchIndex === 0
      ? code
      : `${code}.${branchIndex + 1}`
    : formatBranchLabel(getActiveLabelScheme(), code, branchIndex + 1)
}

/**
 * Assign branch + endpoint labels `{prefix}1`…`{prefix}n` (per the active label scheme) in stored branch order, numbering
 * plain trunk switches in place along the trunk (`getCircuitPointSequence`). A nested circuit
 * with no own code inherits the nearest labeled parent when panel context is available.
 * Always run after branch topology changes (delete, reorder, merge). Not gated on
 * `installation.eendraadAutomaticNaming` — that setting controls main-bus letters and
 * manual protection labels, not sequential branch numbering.
 */
export function syncSequentialEndpointBranchLabelsToCircuit(circuit: Circuit, panel?: Panel): void {
  if (circuit.supplySource?.kind === 'converter-backup') return
  const code = getEndpointBranchLabelPrefix(circuit, panel)
  if (!code) return
  const branches = circuit.branches ?? []
  const sequence = getCircuitPointSequence(circuit)
  for (let point = 0; point < sequence.length; point++) {
    const slot = sequence[point]!
    const label = getExpectedBranchLabel(circuit, code, point)
    if (slot.kind === 'trunkSwitch') {
      // Replace rather than mutate: drop flows hand in devices taken from frozen store state.
      const devices = circuit.trunkDevices!
      const index = devices.indexOf(slot.device)
      if (index >= 0 && slot.device.label !== label) devices[index] = { ...slot.device, label }
      continue
    }
    const branch = branches[slot.branchIndex]!
    branch.label = label
    for (const id of branch.endpointIds) {
      const ep = circuit.endpoints.find((e) => e.id === id)
      if (!ep || ep.domoticaChildProps || ep.symbol === 'panel_distribution') continue
      ep.label = label
    }
  }
  syncForkBranchLabels(circuit)
}

/**
 * Legs share the label of the branch they hang from: their root, or the nearest
 * numbered leg (numbered in sequence by the caller).
 */
export function syncForkBranchLabels(circuit: Circuit): void {
  const branches = circuit.branches ?? []
  const owners = getBranchLabelOwners(circuit)
  const byId = new Map(branches.map((branch) => [branch.id, branch]))
  const endpoints = new Map(circuit.endpoints.map((endpoint) => [endpoint.id, endpoint]))
  for (const branch of branches) {
    if (!branch.forkFrom) continue
    const ownerId = owners.get(branch.id)
    const owner = ownerId && ownerId !== branch.id ? byId.get(ownerId) : undefined
    if (!owner) continue
    branch.label = owner.label
    for (const id of branch.endpointIds) {
      const endpoint = endpoints.get(id)
      if (endpoint) endpoint.label = owner.label
    }
  }
}

export function applyAutomaticEndpointBranchLabelsToCircuit(circuit: Circuit, panel?: Panel): void {
  syncSequentialEndpointBranchLabelsToCircuit(circuit, panel)
}

export function applyAutomaticEndpointBranchLabelsToPanel(panel: Panel): void {
  forEachCircuitOnPanel(panel, (circuit) => {
    if (circuit.supplySource?.kind === 'converter-backup') return
    applyAutomaticEndpointBranchLabelsToCircuit(circuit, panel)
  })
}
