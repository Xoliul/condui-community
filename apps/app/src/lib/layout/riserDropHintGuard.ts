/**
 * A circuit with manual risers takes only the trunk devices of the shared part under the split (energy meter,
 * terminal strip, junction box/panel, trunk switch; their hints stay on the trunk segments there). Converters are
 * rejected by the commands, so their hints must not appear on the circuit's wires or nest zone: hint and commit agree. A breaker or other protection is refused on such a circuit
 * too (it would wrap the rows, stems included, into a nested circuit): none of its hints appear on the circuit's
 * wires or nest zone, the preview shows nothing and the command and the MCP reject the drop.
 */
import type { SymbolMetadata } from '@/lib/symbols'
import { isCircuitTrunkSwitchSymbol } from '@/lib/eendraad/circuitTrunkSwitch'
import { hasOneWireRisers } from '@/lib/eendraad/oneWireRisers'
import { PROTECTION_SYMBOL_IDS } from '@/lib/protectionKind'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { collectCircuits, walkPanels } from '@/lib/panel/panelTree'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import type { DropZoneHint } from './collectDropZoneHints'

export const RISER_TRUNK_DEVICE_SYMBOLS: ReadonlySet<string> = new Set([
  'energy_meter', 'transformer', 'rectifier', 'inverter', 'dc_dc_converter', 'terminal_strip', 'junction_box', 'junction_panel',
])
const RISER_CONVERTER_SYMBOLS: ReadonlySet<string> = new Set(['transformer', 'rectifier', 'inverter', 'dc_dc_converter'])
/** The trunk segments between the breaker, the devices and the split: the shared part. */
const SHARED_TRUNK_SEGMENT = /^circuit-trunk-.+-segment-\d+$/
const CIRCUIT_WIRE = /^circuit-(trunk|crossbar|riser|stem|stemlead|stemcrossbar)-/

export function withoutRiserIneligibleHints<T extends Pick<DropZoneHint, 'nodeId' | 'match'>>(
  hints: T[], symbol: SymbolMetadata, project: ProjectWithOptionalV2Electrical,
): T[] {
  const trunkSwitch = isCircuitTrunkSwitchSymbol(symbol.id)
  const protection = (PROTECTION_SYMBOL_IDS as readonly string[]).includes(symbol.id)
  if (!trunkSwitch && !protection && !RISER_TRUNK_DEVICE_SYMBOLS.has(symbol.id)) return hints
  if (!hints.some((hint) => hint.match?.circuitId)) return hints
  const withRisers = new Set([...walkPanels(getProjectElectricalPanels(project))].flatMap(collectCircuits)
    .filter((circuit) => hasOneWireRisers(circuit)).map((circuit) => circuit.id))
  if (!withRisers.size) return hints
  return hints.filter((hint) => {
    const circuitId = hint.match?.circuitId
    if (!circuitId || !withRisers.has(circuitId)) return true
    // Every circuit-targeted protection hint nests into the circuit, its own secondary-bus slots included.
    if (protection) return false
    if (RISER_CONVERTER_SYMBOLS.has(symbol.id)) return !(CIRCUIT_WIRE.test(hint.nodeId) || hint.nodeId.startsWith('circuit-nest-'))
    // Eligible devices land on the shared part only (not on risers, crossbars, leads or the gaps between rows);
    // a trunk switch may still start a branch from the nest zone.
    if (SHARED_TRUNK_SEGMENT.test(hint.nodeId)) return true
    return trunkSwitch ? !CIRCUIT_WIRE.test(hint.nodeId) : !(CIRCUIT_WIRE.test(hint.nodeId) || hint.nodeId.startsWith('circuit-nest-'))
  })
}
