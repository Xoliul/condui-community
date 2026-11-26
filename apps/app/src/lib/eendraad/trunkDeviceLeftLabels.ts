import type { TrunkDevice } from '@/types/schema'
import { SYMBOL_SIZE } from '@/lib/canvas/symbolGeometry'
import { DOMOTICA_BOX_WIDTH } from '@/lib/domoticaLayout'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import { getSurgeProtectionBodyBounds } from '@/lib/surgeProtectionSymbol'
import { isSymbolLabelVisible } from '@/lib/symbolLabels'

export const TRUNK_DEVICE_LEFT_LABEL_STYLE = { fontSize: 8, offsetFromSymbol: 5 }

export function getTrunkDeviceLeftLabelItems(device: TrunkDevice) {
  const name = device.label?.trim() ?? ''
  const notes = device.notes?.trim() ?? ''
  return [
    ...(name ? [{ key: 'trunkDeviceNameLabel', text: name }] : []),
    ...(notes && isSymbolLabelVisible(device.symbolLabelDisplay, 'trunkDeviceNotes', true)
      ? [{ key: 'trunkDeviceNotes', text: notes }]
      : []),
  ]
}

export function getIncomingTrunkDeviceLeftLabelReach(device: TrunkDevice): number {
  const items = getTrunkDeviceLeftLabelItems(device)
  if (items.length === 0) return 0

  const { fontSize, offsetFromSymbol } = TRUNK_DEVICE_LEFT_LABEL_STYLE
  const isUprightSurge = device.protectionType === 'SPD' || device.symbol === 'spd'
  // The upright SPD body is landscape and extends left of the wire.
  const symbolWidth =
    device.symbol === 'domotica'
      ? DOMOTICA_BOX_WIDTH
      : isUprightSurge
        ? -getSurgeProtectionBodyBounds(SYMBOL_SIZE, SYMBOL_SIZE, false).x * 2
        : SYMBOL_SIZE
  const labelWidth = Math.max(
    ...items.map(({ text }) => measureSymbolLabelTextWidth(text, 'Figtree', fontSize))
  )
  return symbolWidth / 2 + offsetFromSymbol + labelWidth
}
