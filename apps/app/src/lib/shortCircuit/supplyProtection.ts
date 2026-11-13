import { queryPanelSupplyTrunkDevices } from '@/lib/feedTopology'
import { isOvercurrentProtectionType, trunkProtectionType } from '@/lib/protectionKind'
import type { Installation, Panel, ProtectionDevice, TrunkDevice } from '@/types/schema'

/**
 * The main breaker or fuse on the incoming wire: the last overcurrent device before the main
 * board, on the low-voltage side of a supply transformer. It protects the supply cable.
 */
export function findMainSupplyProtection(
  installation: Installation | undefined,
  panels: readonly Panel[]
): TrunkDevice | undefined {
  const main = panels.find((panel) => panel.isMain)
  if (!installation || !main) return undefined
  const byPosition = (a: TrunkDevice, b: TrunkDevice) => a.trunkPosition - b.trunkPosition
  const shared = installation.mainSupply.supplyTrunkDevices ?? installation.feedTopology?.sharedFeed.trunkDevices ?? []
  // The shared incoming wire first, then the main board's own root feed.
  const serial = [...shared].sort(byPosition)
    .concat(queryPanelSupplyTrunkDevices(installation, main).slice(shared.length).sort(byPosition))
    .filter((device) => device.supplyPath == null || device.supplyPath === 'serial')
  const transformer = serial.findLastIndex((device) => device.conversionProps?.transformerRole === 'supply')
  return serial
    .slice(transformer + 1)
    .findLast((device) => device.type === 'protection' && isOvercurrentProtectionType(trunkProtectionType(device)))
}

/** The supply device as a protection, so the calculation and labels treat it like any breaker. */
export function supplyProtectionAsDevice(device: TrunkDevice): ProtectionDevice {
  const protection: ProtectionDevice = { id: device.id, type: trunkProtectionType(device), label: device.label }
  for (const key of PROTECTION_FIELDS) {
    if (device[key] !== undefined) Object.assign(protection, { [key]: device[key] })
  }
  return protection
}

const PROTECTION_FIELDS = [
  'ratingA',
  'curve',
  'breakingCapacityKa',
  'breakingCapacityOption',
  'polesConfig',
  'poles',
  'tripSettings',
  'fuseClass',
] as const satisfies ReadonlyArray<keyof TrunkDevice & keyof ProtectionDevice>
