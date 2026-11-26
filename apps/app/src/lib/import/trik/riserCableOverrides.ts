import type { Circuit } from '@/types/schema'
import type { TrikRiserCable } from '@/lib/import/trik/shared'

/**
 * A riser Leiding with its own cable attributes becomes the riser's cable section, stored the way an
 * edit of a riser's cable is (`sectionWireOverrides` with `riserStem`). Attributes it leaves out
 * stay those of the circuit's cable; a riser without any shares the trunk cable and gets no entry.
 * The riser leaves the protection, or the topmost trunk device when the shared trunk has one.
 */
export function applyTrikRiserCables(
  circuit: Circuit,
  protectionId: string,
  cables: Readonly<Record<number, TrikRiserCable>>,
  normalizeCableKind: (kind: string | undefined) => Circuit['cable']['kind'],
): void {
  const topDevice = [...(circuit.trunkDevices ?? [])].sort((a, b) => (b.trunkPosition ?? 0) - (a.trunkPosition ?? 0))[0]
  const overrides = Object.entries(cables).map(([stem, own]): NonNullable<Circuit['sectionWireOverrides']>[number] => ({
    ...(topDevice
      ? { fromElementType: 'endpoint' as const, fromElementId: topDevice.id }
      : { fromElementType: 'protection' as const, fromElementId: protectionId }),
    domain: 'AC',
    riserStem: Number(stem),
    cable: {
      ...circuit.cable,
      ...(own.kind ? { kind: normalizeCableKind(own.kind) } : {}),
      ...(own.conductors !== undefined ? { conductors: own.conductors } : {}),
      ...(own.sectionMm2 !== undefined ? { sectionMm2: own.sectionMm2 } : {}),
      ...(own.hasPe !== undefined ? { hasPE: own.hasPe } : {}),
    },
    ...(own.inTube !== undefined ? { inTube: own.inTube } : {}),
  }))
  if (overrides.length > 0) circuit.sectionWireOverrides = [...(circuit.sectionWireOverrides ?? []), ...overrides]
}
