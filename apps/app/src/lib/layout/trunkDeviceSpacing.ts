import type { TrunkDevice } from '@/types/schema'
import { getVisibleConversionLabelParts } from '@/lib/conversionLabels'
import { getVisibleCertificationLabelParts } from '@/lib/certificationLabels'
import { countSymbolLabelVisualLines } from '@/lib/symbolLabelMetrics'
import { isSymbolLabelVisible } from '@/lib/symbolLabels'

export const TERMINAL_STRIP_WIRE_LABEL_SPAN = 56
/** Keep the circuit's cable caption on the lower trunk beside its protection. */
export const CIRCUIT_WIRE_LABEL_BASE_SPAN = 80
export const TRUNK_DEVICE_BRANCH_CLEARANCE = 10

/** Generic vertical trunk specs are centered beside the symbol at 10 units per line. */
export function getTrunkDeviceVerticalPaintHeight(device: TrunkDevice, symbolSize: number): number {
  if (device.type !== 'conversion') return symbolSize
  const labels = [
    ...getVisibleConversionLabelParts(device).map((part) => part.text),
    ...getVisibleCertificationLabelParts(device).map((part) => part.text),
    ...(isSymbolLabelVisible(device.symbolLabelDisplay, 'trunkDeviceNotes', true)
      ? [(device.notes ?? '').trim()]
      : []),
  ]
  return Math.max(symbolSize, labels.reduce((height, text) => height + countSymbolLabelVisualLines(text) * 10, 0))
}
