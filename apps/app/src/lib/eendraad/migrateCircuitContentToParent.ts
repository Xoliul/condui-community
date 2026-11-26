import type { ElectricalDeviceV2 } from '@/types/projectV2'
import type { Circuit } from '@/types/schema'

/** Move a subcircuit's content back into its parent and rehome endpoint references. */
export function migrateCircuitContentToParent(
  circuit: Circuit,
  parentCircuit: Circuit,
  electricalDevices?: ElectricalDeviceV2[]
): void {
  const movedEndpointIds = new Set(circuit.endpoints.map(({ id }) => id))
  for (const device of electricalDevices ?? []) {
    if (device.circuitId === circuit.id && movedEndpointIds.has(device.legacyEndpointId)) {
      device.circuitId = parentCircuit.id
    }
  }

  if (circuit.endpoints.length > 0) parentCircuit.endpoints.push(...circuit.endpoints)

  if (circuit.branches && circuit.branches.length > 0) {
    if (!parentCircuit.branches) parentCircuit.branches = []
    parentCircuit.branches.push(...circuit.branches)
  }

  if (circuit.trunkDevices && circuit.trunkDevices.length > 0) {
    if (!parentCircuit.trunkDevices) parentCircuit.trunkDevices = []
    parentCircuit.trunkDevices.push(...circuit.trunkDevices)
  }

  if (circuit.subCircuitIds && circuit.subCircuitIds.length > 0) {
    if (!parentCircuit.subCircuitIds) parentCircuit.subCircuitIds = []
    parentCircuit.subCircuitIds.push(...circuit.subCircuitIds)
  }

  if (parentCircuit.subCircuitIds) {
    const index = parentCircuit.subCircuitIds.indexOf(circuit.id)
    if (index !== -1) parentCircuit.subCircuitIds.splice(index, 1)
  }
}
