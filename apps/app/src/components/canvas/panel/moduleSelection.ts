import type { Endpoint, PanelGridModuleRef } from '@/types/schema'
import type { Selection } from '@/types/ui'

export function getSelectionForRef(ref: PanelGridModuleRef, endpoint?: Endpoint): Selection {
  if (ref.kind === 'protection') return { type: 'protection', ids: [ref.id] }
  if (ref.kind === 'trunkDevice') return { type: 'trunkDevice', ids: [ref.id] }
  if (ref.kind === 'domotica') {
    if (endpoint?.symbol === 'panel_distribution' && endpoint.panelId) {
      return { type: 'panel', ids: [endpoint.panelId] }
    }
    return { type: 'endpoint', ids: [ref.endpointId] }
  }
  return { type: null, ids: [] }
}
