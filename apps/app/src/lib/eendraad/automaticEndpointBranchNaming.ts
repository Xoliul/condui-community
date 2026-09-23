import type { Circuit, Panel } from '@/types/schema'

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
    const prefix = match?.[1]?.trim()
    if (prefix) return prefix
  }

  return ''
}

/**
 * True if branch labels or endpoint labels on those branches differ from `{code}{1..n}`
 * in `circuit.branches` array order.
 */
export function endpointBranchLabelsWouldChange(
  circuit: Circuit,
  circuitCodeForBranches: string,
  panel?: Panel,
): boolean {
  if (circuit.code === 'PANEL') return false
  const code = circuitCodeForBranches.trim() || getEndpointBranchLabelPrefix(circuit, panel)
  if (!code) return false
  const branches = circuit.branches
  if (!branches?.length) return false
  for (let i = 0; i < branches.length; i++) {
    const branch = branches[i]!
    const expected = getExpectedBranchLabel(circuit, code, i)
    if ((branch.label ?? '').trim() !== expected) return true
    for (const id of branch.endpointIds) {
      const ep = circuit.endpoints.find((e) => e.id === id)
      if (ep && (ep.label ?? '').trim() !== expected) return true
    }
  }
  return false
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
    : `${code}${branchIndex + 1}`
}

/**
 * Assign branch + endpoint labels `{prefix}1`…`{prefix}n` in stored branch order. A nested circuit
 * with no own code inherits the nearest labeled parent when panel context is available.
 * Always run after branch topology changes (delete, reorder, merge). Not gated on
 * `installation.eendraadAutomaticNaming` — that setting controls main-bus letters and
 * manual protection labels, not sequential branch numbering.
 */
export function syncSequentialEndpointBranchLabelsToCircuit(circuit: Circuit, panel?: Panel): void {
  if (circuit.supplySource?.kind === 'converter-backup') return
  const code = getEndpointBranchLabelPrefix(circuit, panel)
  if (!code) return
  const branches = circuit.branches
  if (!branches?.length) return
  for (let i = 0; i < branches.length; i++) {
    const label = getExpectedBranchLabel(circuit, code, i)
    const branch = branches[i]!
    branch.label = label
    for (const id of branch.endpointIds) {
      const ep = circuit.endpoints.find((e) => e.id === id)
      if (!ep || ep.domoticaChildProps) continue
      ep.label = label
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
