import type { SymbolMetadata } from '@/lib/symbols'
import type { DropBehaviorCallbacks } from '@/lib/eendraad/dropBehaviorModel'
import { applySearchPreset, getSearchPreset } from './searchPresets'

/** Apply explicit defaults before insertion so placement repairs see the final device. */
export function withSearchPresetCallbacks(
  symbol: SymbolMetadata,
  callbacks: DropBehaviorCallbacks
): DropBehaviorCallbacks {
  if (!getSearchPreset(symbol.id, symbol.searchPreset)) return callbacks
  return {
    ...callbacks,
    addEndpoint: (circuitId, endpoint, ...rest) => {
      applySearchPreset(symbol, endpoint)
      callbacks.addEndpoint(circuitId, endpoint, ...rest)
    },
    addTrunkDevice: (circuitId, device) => {
      applySearchPreset(symbol, device)
      callbacks.addTrunkDevice(circuitId, device)
    },
    addSupplyTrunkDevice: (device, ...rest) => {
      applySearchPreset(symbol, device)
      callbacks.addSupplyTrunkDevice(device, ...rest)
    },
    addGroundTrunkDevice: (device, ...rest) => {
      applySearchPreset(symbol, device)
      callbacks.addGroundTrunkDevice(device, ...rest)
    },
    addProtection: (panelId, protection) => {
      applySearchPreset(symbol, protection)
      callbacks.addProtection(panelId, protection)
    },
  }
}
