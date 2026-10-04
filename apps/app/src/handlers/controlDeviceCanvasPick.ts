import { useSyncExternalStore } from 'react'
import { getNextFreeChannel, canOperateControlLinks } from '@/lib/controlLink/controlLink'
import { findEndpointById } from '@/lib/eendraad/projectElectricalDomain'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'

/**
 * "Pick on canvas" for an operated endpoint: while armed, the next canvas click that selects
 * a domotica module links the endpoint to it and selects the endpoint again. Selecting
 * anything else, pressing Escape, or arming again cancels. Canvases need no special mode:
 * the pick rides on their ordinary selection.
 */

let pickingFor: string | null = null
let cleanup: (() => void) | null = null
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

export function cancelControlDevicePick() {
  cleanup?.()
  cleanup = null
  pickingFor = null
  emit()
}

function findDevice(deviceId: string) {
  const project = useProjectStore.getState().currentProject
  if (!project) return undefined
  const panels = getProjectElectricalPanels(project)
  for (const panel of panels) {
    const found = findEndpointById(panel, deviceId)
    if (found) return { panels, endpoint: found.endpoint }
  }
  return undefined
}

export function startControlDevicePick(endpointId: string) {
  cancelControlDevicePick()
  pickingFor = endpointId
  const unsubscribe = useUIStore.subscribe((state, previous) => {
    if (state.selection === previous.selection) return
    const ids = state.selection.type === 'endpoint' ? state.selection.ids : []
    const deviceId = ids.length === 1 ? ids[0] : undefined
    const device = deviceId ? findDevice(deviceId) : undefined
    const target = pickingFor
    cancelControlDevicePick()
    if (!target || !deviceId || !device || !canOperateControlLinks(device.endpoint)) return
    if (deviceId === target) return
    useProjectStore.getState().updateEndpoint(target, {
      controlLink: { deviceId, channel: getNextFreeChannel(device.panels, deviceId, target) || undefined },
    })
    useUIStore.getState().setSelection({ type: 'endpoint', ids: [target] })
  })
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') cancelControlDevicePick()
  }
  window.addEventListener('keydown', onKeyDown, true)
  cleanup = () => {
    unsubscribe()
    window.removeEventListener('keydown', onKeyDown, true)
  }
  emit()
}

/** Id of the endpoint waiting for a canvas pick, if any. */
export function useControlDevicePickTarget(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => pickingFor
  )
}
