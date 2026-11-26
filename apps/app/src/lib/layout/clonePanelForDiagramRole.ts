import type { Circuit, Panel, ProtectionDevice } from '@/types/schema'

function isConverterBackupCircuit(circuit: Circuit): boolean {
  return circuit.supplySource?.kind === 'converter-backup'
}

/** The part of a main board drawn in its panel frame or in its detached supply frame. */
export function clonePanelForDiagramRole(panel: Panel, role: 'panel' | 'supply'): Panel {
  const keepCircuit = (circuit: Circuit) =>
    role === 'supply' ? isConverterBackupCircuit(circuit) : !isConverterBackupCircuit(circuit)

  return {
    ...panel,
    circuits: panel.circuits.filter(keepCircuit),
    protections: panel.protections.flatMap((protection): ProtectionDevice[] => {
      const circuits = (protection.circuits ?? []).filter(keepCircuit)
      if ((protection.circuits?.length ?? 0) > 0 && circuits.length === 0) return []
      if (role === 'supply' && circuits.length === 0) return []
      return [{ ...protection, circuits }]
    }),
  }
}
