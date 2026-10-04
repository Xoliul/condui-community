import type {
  Circuit,
  DomoticaRowLabelOverride,
  Endpoint,
  SymbolLabelDisplayConfig,
} from '@/types/schema'
import { isSymbolLabelVisible } from '@/lib/symbolLabels'

export const DOMOTICA_ROW_LABEL_VISIBILITY_KEY = 'domoticaRowLabel'

/** Label stem that output row labels are generated from (`{stem}.{n}`). */
export function getDomoticaOutputBaseLabel(parent: Endpoint, circuitCode: string): string {
  const parentLabel = parent.label?.trim() || `${circuitCode}1`
  return parent.domoticaChildProps ? parentLabel : parentLabel.replace(/\.\d+$/, '')
}

export function resolveDomoticaRowLabel(
  base: string,
  outputIndex: number,
  override: DomoticaRowLabelOverride | undefined
): string {
  if (override?.kind === 'tail' && typeof override.tail === 'string') return `${base}${override.tail}`
  if (override?.kind === 'literal' && typeof override.text === 'string' && override.text.trim())
    return override.text
  return `${base}.${outputIndex + 1}`
}

/** Turns text typed into an output row's label field into a stored override (or none). */
export function deriveDomoticaRowLabelOverride(
  typed: string,
  base: string,
  outputIndex: number
): DomoticaRowLabelOverride | undefined {
  const text = typed.trim()
  if (!text || text === resolveDomoticaRowLabel(base, outputIndex, undefined)) return undefined
  if (text.startsWith(base)) return { kind: 'tail', tail: text.slice(base.length) }
  return { kind: 'literal', text }
}

/** Root endpoint of the output row that `endpoint` belongs to (carries the override). */
export function findDomoticaRowRoot(circuit: Circuit, endpoint: Endpoint): Endpoint | undefined {
  const ref = endpoint.domoticaChildProps
  if (!ref) return undefined
  const parent = circuit.endpoints.find((e) => e.id === ref.parentEndpointId)
  const rootId = parent?.domoticaProps?.endpointChildEndpointIds?.[ref.outputIndex]
  return (rootId ? circuit.endpoints.find((e) => e.id === rootId) : undefined) ?? endpoint
}

/**
 * Applies a label typed on a domotica output endpoint to its row only: the module, the branch
 * and the other rows are untouched. Caller re-normalizes the circuit afterwards.
 */
export function applyDomoticaRowLabelEdit(circuit: Circuit, endpointId: string, typed: string): void {
  const endpoint = circuit.endpoints.find((e) => e.id === endpointId)
  const ref = endpoint?.domoticaChildProps
  if (!endpoint || !ref) return
  const parent = circuit.endpoints.find((e) => e.id === ref.parentEndpointId)
  const root = findDomoticaRowRoot(circuit, endpoint)
  if (!parent || !root) return
  const override = deriveDomoticaRowLabelOverride(
    typed,
    getDomoticaOutputBaseLabel(parent, circuit.code),
    ref.outputIndex
  )
  if (override) root.domoticaRowLabel = override
  else delete root.domoticaRowLabel
}

export function isDomoticaRowLabelVisible(root: Pick<Endpoint, 'symbolLabelDisplay'> | undefined): boolean {
  return isSymbolLabelVisible(root?.symbolLabelDisplay, DOMOTICA_ROW_LABEL_VISIBILITY_KEY, true)
}

export function withDomoticaRowLabelVisibility(
  config: SymbolLabelDisplayConfig | undefined,
  visible: boolean
): SymbolLabelDisplayConfig {
  return {
    ...(config ?? {}),
    visibility: { ...(config?.visibility ?? {}), [DOMOTICA_ROW_LABEL_VISIBILITY_KEY]: visible },
  }
}

/** Whether the row label of a domotica output endpoint is drawn, given its circuit's endpoints. */
export function isDomoticaRowLabelShown(endpoints: Endpoint[], endpoint: Endpoint): boolean {
  const ref = endpoint.domoticaChildProps
  if (!ref) return true
  const parent = endpoints.find((e) => e.id === ref.parentEndpointId)
  const rootId = parent?.domoticaProps?.endpointChildEndpointIds?.[ref.outputIndex]
  const root = rootId ? endpoints.find((e) => e.id === rootId) : undefined
  return isDomoticaRowLabelVisible(root ?? endpoint)
}
