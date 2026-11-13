import type { Installation, Panel } from '@/types/schema'
import { getSupplyTransformerOutputs } from './feedNominalVoltage'
import { getVoltageSummaryLabel } from '@/utils/voltageLabel'
import { getInstallationSupplyTransformer } from './supplyTransformer'

/** Common Belgian LV settings; suggestions, not an operator-independent approval list.
 * Sources and scope: docs/electrical/connection-current.md.
 */
export const CONNECTION_CURRENT_PRESETS_A = [
  16, 20, 25, 32, 40, 50, 63, 80, 100, 120, 125, 140, 160, 200, 250,
] as const

/** Editor starting value, not a claim about an existing or approved connection. */
export const DEFAULT_CONNECTION_CURRENT_A = 25

/** Match the installed LV connection setting, not the breaker frame size.
 * A marked source transformer establishes the LV boundary; other conversions stop the search.
 */
export function syncConnectionSupplyBreaker(installation: Installation, currentA: number): string | undefined {
  if (!Number.isSafeInteger(currentA) || currentA <= 0) return undefined
  if (installation.mainSupply.origin && installation.mainSupply.origin !== 'grid') return undefined
  const devices = installation.mainSupply.supplyTrunkDevices ?? installation.feedTopology?.sharedFeed.trunkDevices ?? []
  const serial = devices.filter((device) => device.supplyPath == null || device.supplyPath === 'serial')
    .sort((a, b) => a.trunkPosition - b.trunkPosition)
  const transformer = getInstallationSupplyTransformer(installation)
  let onLowVoltageSide = !transformer
  for (const device of serial) {
    if (device.id === transformer?.id) {
      onLowVoltageSide = true
      continue
    }
    if (!onLowVoltageSide) continue
    if (device.type === 'energy_meter' || device.symbol === 'transformer' || device.type === 'conversion') return undefined
    if (device.type !== 'protection') continue
    if (device.protectionType !== 'MCB' || device.ratingA === currentA) return undefined
    device.ratingA = currentA
    return device.id
  }
  return undefined
}

function getLowVoltageConnectionLabel(installation: Installation): string {
  const voltage = getVoltageSummaryLabel(installation.nominalVoltage)
  const current = installation.connectionCurrentA
  return current != null && Number.isSafeInteger(current) && current > 0
    ? `${voltage} · ${current} A`
    : voltage
}

/** Label at the utility entrance: never put an LV breaker setting on the MV side. */
export function getSupplySourceSummaryLabel(installation: Installation): string {
  const transformer = getInstallationSupplyTransformer(installation)
  if (!transformer) return getLowVoltageConnectionLabel(installation)
  const primary = transformer.conversionProps?.transformerPrimaryVoltageV
  return primary != null && primary > 1000 ? `3×${primary / 1000}kV` : '3~ ? kV'
}

/** Document summary includes the source-to-installation voltage conversion. */
export function getConnectionSummaryLabel(installation: Installation, panels: Panel[] = []): string {
  const outputs = getSupplyTransformerOutputs(installation, panels)
  // Several transformer outputs: the single LV connection setting no longer describes the site.
  const lowVoltage = outputs.length > 1
    ? outputs.map(getVoltageSummaryLabel).join(' + ')
    : getLowVoltageConnectionLabel(installation)
  return getInstallationSupplyTransformer(installation)
    ? `${getSupplySourceSummaryLabel(installation)} → ${lowVoltage}` : lowVoltage
}
