import type { ProjectV2 } from '@/types/projectV2'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { collectCircuits, walkPanels } from '@/lib/panel/panelTree'
import { getTerminalStripCreationProps, getTerminalStripTrunkCreationProps } from '@/lib/terminalStrip/labels'

/**
 * TRiK connection clamps (Aansluitklem) import as terminal-strip occurrences on strip X1.
 * Give them the identity and pin a canvas drop would: occurrences in one circuit share a
 * pin, and each further circuit takes the next free pin on the strip.
 */
export function assignTrikTerminalStripPins(project: ProjectV2): void {
  for (const circuit of [...walkPanels(getEditableProjectElectricalPanels(project))].flatMap(collectCircuits)) {
    for (const endpoint of circuit.endpoints) {
      if (endpoint.symbol !== 'terminal_strip' || endpoint.terminalStripPin != null) continue
      const { junctionIdentity, terminalStripPin } = getTerminalStripCreationProps(project, endpoint.junctionIdentity ?? '1', circuit.id)
      endpoint.junctionIdentity = junctionIdentity
      endpoint.terminalStripPin = terminalStripPin
    }
    // A clamp on the shared trunk is a trunk device: same identity, pin and label as a canvas drop.
    for (const device of circuit.trunkDevices ?? []) {
      if (device.type !== 'terminal_strip' || device.terminalStripPin != null) continue
      Object.assign(device, getTerminalStripTrunkCreationProps(project, device.junctionIdentity ?? '1', circuit.id))
    }
  }
}
