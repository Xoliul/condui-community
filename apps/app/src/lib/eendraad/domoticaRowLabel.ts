import type {
  Circuit,
  DomoticaRowLabelOverride,
  Endpoint,
  SymbolLabelDisplayConfig,
} from '@/types/schema'
import { isSymbolLabelVisible } from '@/lib/symbolLabels'
import { isHorizontalDomotica } from '@/lib/layout/domoticaHorizontalGeometry'
import { formatBranchLabel, formatDomoticaOutputLabel } from '@/lib/eendraad/labelScheme'
import { getActiveLabelScheme } from '@/lib/eendraad/labelSchemeContext'
import { getScopedBusRowLabel } from '@/lib/controlLink/controlLinkNoteContext'

const ROW_ADDRESS_SEPARATOR = ' · '

export const DOMOTICA_ROW_LABEL_VISIBILITY_KEY = 'domoticaRowLabel'

/**
 * Label stem that output row labels are generated from (`{stem}.{n}`): the module's own label,
 * which is the branch label it sits on (F1 → F1.1, F1.2) or, for a nested module, its row label.
 */
export function getDomoticaOutputBaseLabel(parent: Endpoint, circuitCode: string): string {
  return parent.label?.trim() || formatBranchLabel(getActiveLabelScheme(), circuitCode, 1)
}

/** Text between the module label and the output number (`.` unless the scheme says otherwise). */
export function getDomoticaOutputSeparator(): string {
  return getActiveLabelScheme().separator
}

export function resolveDomoticaRowLabel(
  base: string,
  outputIndex: number,
  override: DomoticaRowLabelOverride | undefined
): string {
  if (override?.kind === 'tail' && typeof override.tail === 'string') return `${base}${override.tail}`
  if (override?.kind === 'literal' && typeof override.text === 'string' && override.text.trim())
    return override.text
  return formatDomoticaOutputLabel(getActiveLabelScheme(), base, outputIndex + 1)
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
export function findDomoticaRowRoot(circuit: Pick<Circuit, 'endpoints'>, endpoint: Endpoint): Endpoint | undefined {
  const ref = endpoint.domoticaChildProps
  if (!ref) return undefined
  const parent = circuit.endpoints.find((e) => e.id === ref.parentEndpointId)
  const rootId = parent?.domoticaProps?.endpointChildEndpointIds?.[ref.outputIndex]
  return (rootId ? circuit.endpoints.find((e) => e.id === rootId) : undefined) ?? endpoint
}

/** Output identity stays independent of the connected appliance or board's own name. */
export function getDomoticaEndpointOutputLabel(circuit: Pick<Circuit, 'code' | 'endpoints'>, endpoint: Endpoint): string {
  const ref = endpoint.domoticaChildProps
  if (!ref) return ''
  const parent = circuit.endpoints.find((candidate) => candidate.id === ref.parentEndpointId)
  if (!parent) return ''
  return resolveDomoticaRowLabel(
    getDomoticaOutputBaseLabel(parent, circuit.code),
    ref.outputIndex,
    findDomoticaRowRoot(circuit, endpoint)?.domoticaRowLabel,
  )
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
  // Outputs of a horizontal module stand 20 units apart, so they carry no row label yet.
  if (isHorizontalDomotica(parent)) return false
  const rootId = parent?.domoticaProps?.endpointChildEndpointIds?.[ref.outputIndex]
  const root = rootId ? endpoints.find((e) => e.id === rootId) : undefined
  return isDomoticaRowLabelVisible(root ?? endpoint)
}

/**
 * Text painted next to a domotica output row. Connected boards keep their name and
 * output reference together, and a bus output keeps its bus name. Configured channels of
 * wired outputs are rendered below the row's final symbol instead.
 */
export function getDomoticaRowDisplayLabel(
  endpoint: Pick<Endpoint, 'id' | 'label'> & Partial<Pick<Endpoint, 'symbol' | 'domoticaChildProps'>>,
  circuit?: Pick<Circuit, 'code' | 'endpoints'>,
): string {
  let label = endpoint.label?.trim() ?? ''
  if (!label) return ''
  if (endpoint.symbol === 'panel_distribution' && endpoint.domoticaChildProps && circuit) {
    const actualEndpoint = circuit.endpoints.find((candidate) => candidate.id === endpoint.id)
    const outputLabel = actualEndpoint ? getDomoticaEndpointOutputLabel(circuit, actualEndpoint) : ''
    if (outputLabel && outputLabel !== label) label = `${label}${ROW_ADDRESS_SEPARATOR}${outputLabel}`
  }
  const busName = getScopedBusRowLabel(endpoint.id)
  return busName ? `${label}${ROW_ADDRESS_SEPARATOR}${busName}` : label
}
