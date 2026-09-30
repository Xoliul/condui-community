/**
 * 1draad context menu: duplicate and paste (copy buffer) logic.
 */

import { findDropTarget } from '@/lib/layout/findDropTarget'
import type { LayoutTree } from '@/lib/layout/layoutTree'
import type { Point } from '@/types/ui'
import type { Selection } from '@/types/ui'
import type { Endpoint, TrunkDevice, Circuit, ProtectionDevice, Panel } from '@/types/schema'
import { generateId } from '@/utils'
import { clonePlacementsForDuplicate } from '@/lib/eendraad/duplicateSitplanHelpers'
import { circuitContainsJunctionPanelIdentity, getJunctionIdentity } from '@/lib/junctionIdentity'
import { useProjectStore } from '@/stores/projectStore'
import {
  canDuplicateEendraadSelection,
  runEendraadDuplicate,
} from '@/lib/eendraad/duplicateSelection'
import type { ProjectWithOptionalV2Building } from '@/lib/projectV2/buildingFloors'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'

export type EendraadClipboard = { type: 'endpoint' | 'trunkDevice' | 'protection' | 'panel'; ids: string[] }

type ProjectStoreProject = ProjectWithOptionalV2Building & ProjectWithOptionalV2Electrical

export interface ProjectStoreGetters {
  getEndpointById: (id: string) => Endpoint | undefined
  getCircuitById: (id: string) => Circuit | undefined
  findCircuitForEndpoint: (endpointId: string) => { circuit: Circuit; panel: { id: string }; protection?: unknown } | undefined
  getTrunkDeviceById: (deviceId: string) => {
    device: TrunkDevice
    circuit: Circuit | null
    isSupplyDevice?: boolean
    supplyFeedScope?: 'shared' | 'root'
    supplyPanelId?: string
    isGroundDevice?: boolean
  } | undefined
  getProtectionById?: (id: string) => ProtectionDevice | undefined
  getPanelForProtection?: (protectionId: string) => Panel | undefined
  getCircuitsByPanel?: (panelId: string) => Circuit[]
  getSupplyTrunkDeviceIndex?: (deviceId: string) => number
  getGroundTrunkDeviceIndex?: (deviceId: string) => number
  getCurrentProject?: () => ProjectStoreProject | null
}

export interface ProjectStoreActions {
  addEndpoint: (circuitId: string, endpoint: Endpoint, insertAfterEndpointId?: string | null) => void
  syncEndpointMultiplierCount?: (endpointId: string, count: number) => boolean
  addCircuit: (panelId: string, circuit: Circuit, protectionId?: string) => void
  addTrunkDevice: (circuitId: string, device: TrunkDevice) => void
  updateTrunkDevice: (circuitId: string, deviceId: string, updates: Partial<TrunkDevice>) => void
  addSupplyTrunkDevice: (
    device: TrunkDevice,
    insertIndex?: number,
    target?: { panelId?: string; feedScope?: 'shared' | 'root' },
  ) => void
  syncSupplyDeviceMultiplierCount?: (deviceId: string, count: number) => boolean
  addGroundTrunkDevice: (device: TrunkDevice, insertIndex?: number, panelId?: string) => void
  insertProtectionAfter: (panelId: string, protection: ProtectionDevice, afterProtectionId: string) => void
  updateCircuit: (circuitId: string, updates: Partial<Circuit>) => void
  setSelection: (selection: { type: 'endpoint' | 'trunkDevice' | 'protection'; ids: string[] }) => void
}

export { canDuplicateEendraadSelection }

/** Returns true if selection is on supply wire or earth wire (no duplicate/copy). */
export function isSelectionOnSupplyOrGround(selection: Selection): boolean {
  if (selection.type === 'supply' || selection.type === 'ground') return true
  if (selection.ids.includes('supply') || selection.ids.includes('ground')) return true
  return false
}

/** Perform duplicate for the current eendraad selection. */
export function doEendraadDuplicate(
  selection: Selection,
  get: ProjectStoreGetters,
  actions: ProjectStoreActions,
): void {
  const store = useProjectStore.getState()
  const result = runEendraadDuplicate(
    selection,
    get,
    actions,
    (protectionId) => store.duplicateProtectionLeft(protectionId),
    (fn, opts) => store.withSingleUndoEntry(fn, opts),
  )
  if (result) {
    actions.setSelection(result.selection as Parameters<ProjectStoreActions['setSelection']>[0])
  }
}

/** Paste clipboard at position: find drop target, then clone each clipboard item and add at target. */
export function doEendraadPaste(
  clipboard: EendraadClipboard,
  position: Point,
  layoutTree: LayoutTree | null,
  get: ProjectStoreGetters,
  actions: ProjectStoreActions
): boolean {
  if (!layoutTree || clipboard.ids.length === 0) return false
  let target = findDropTarget(layoutTree, position)
  if (target?.type === null && target.panelId && get.getCircuitsByPanel && (clipboard.type === 'endpoint' || clipboard.type === 'trunkDevice')) {
    const circuits = get.getCircuitsByPanel(target.panelId)
    const first = circuits[0]
    if (first) {
      target = { type: 'circuit', circuitId: first.id, panelId: target.panelId }
    }
  }
  if (!target || !target.circuitId) {
    if (target?.type === 'supplyWire' && clipboard.type === 'trunkDevice') {
      const devices = clipboard.ids
        .map((id) => get.getTrunkDeviceById(id))
        .filter((r): r is NonNullable<typeof r> => !!r && r.isSupplyDevice === true)
      if (devices.length === 0) return false
      if (devices.some((entry) => entry.device.symbol === 'junction_panel')) return false
      const insertIndex = target.supplyDeviceInsertIndex ?? 0
      devices.forEach((r, i) => {
        const clone: TrunkDevice = {
          ...JSON.parse(JSON.stringify(r.device)),
          id: generateId(),
          placements: r.device.placements?.length
            ? clonePlacementsForDuplicate(r.device.placements, { symbolType: r.device.symbol })
            : r.device.placements,
        }
        actions.addSupplyTrunkDevice(clone, insertIndex + i)
      })
      return true
    }
    if (target?.type === 'groundWire' && clipboard.type === 'trunkDevice') {
      const devices = clipboard.ids
        .map((id) => get.getTrunkDeviceById(id))
        .filter((r): r is NonNullable<typeof r> => !!r && r.isGroundDevice === true)
      if (devices.length === 0) return false
      if (devices.some((entry) => entry.device.symbol === 'junction_panel')) return false
      const insertIndex = target.groundDeviceInsertIndex ?? 0
      devices.forEach((r, i) => {
        const clone: TrunkDevice = {
          ...JSON.parse(JSON.stringify(r.device)),
          id: generateId(),
          placements: r.device.placements?.length
            ? clonePlacementsForDuplicate(r.device.placements, { symbolType: r.device.symbol })
            : r.device.placements,
        }
        actions.addGroundTrunkDevice(clone, insertIndex + i, target.panelId)
      })
      return true
    }
    return false
  }

  const circuitId = target.circuitId

  if (clipboard.type === 'endpoint') {
    const circuit = get.getCircuitById(circuitId)
    if (!circuit) return false
    const junctionIds = clipboard.ids
      .map((id) => get.getEndpointById(id))
      .filter((endpoint) => endpoint?.symbol === 'junction_panel')
      .map((endpoint) => getJunctionIdentity(endpoint!))
    if (
      new Set(junctionIds.map((id) => id.toUpperCase())).size !== junctionIds.length ||
      clipboard.ids.some((id) =>
        get.getEndpointById(id)?.symbol === 'junction_panel' &&
        get.findCircuitForEndpoint(id)?.circuit.id === circuitId
      ) ||
      junctionIds.some((id) => circuitContainsJunctionPanelIdentity(circuit, id))
    ) return false
    let insertAfter = target.insertAfterEndpointId
    const newIds: string[] = []
    for (const eid of clipboard.ids) {
      const ep = get.getEndpointById(eid)
      if (!ep) continue
      const clone: Endpoint = {
        ...JSON.parse(JSON.stringify(ep)),
        id: generateId(),
        placements: (ep.placements ?? []).map((p) => ({ ...p, id: generateId() })),
      }
      actions.addEndpoint(circuitId, clone, insertAfter)
      insertAfter = clone.id
      newIds.push(clone.id)
    }
    if (newIds.length > 0) actions.setSelection({ type: 'endpoint', ids: newIds })
    return true
  }

  if (clipboard.type === 'trunkDevice') {
    const circuit = get.getCircuitById(circuitId)
    if (!circuit) return false
    const devices = clipboard.ids
      .map((id) => get.getTrunkDeviceById(id))
      .filter((r): r is NonNullable<typeof r> => !!r && !r.isSupplyDevice && !r.isGroundDevice)
    if (devices.length === 0) return false
    const junctionIds = devices
      .filter((entry) => entry.device.symbol === 'junction_panel')
      .map((entry) => getJunctionIdentity(entry.device))
    if (
      new Set(junctionIds.map((id) => id.toUpperCase())).size !== junctionIds.length ||
      devices.some((entry) =>
        entry.device.symbol === 'junction_panel' && entry.circuit?.id === circuitId
      ) ||
      junctionIds.some((id) => circuitContainsJunctionPanelIdentity(circuit, id))
    ) return false
    const sorted = [...devices].sort((a, b) => (a.device.trunkPosition ?? 0) - (b.device.trunkPosition ?? 0))
    const newIds: string[] = []
    sorted.forEach((r, i) => {
      const clone: TrunkDevice = {
        ...JSON.parse(JSON.stringify(r.device)),
        id: generateId(),
        trunkPosition: (r.device.trunkPosition ?? 0) + 0.5 + i,
        placements: r.device.placements?.length
          ? clonePlacementsForDuplicate(r.device.placements, { symbolType: r.device.symbol })
          : r.device.placements,
      }
      actions.addTrunkDevice(circuitId, clone)
      newIds.push(clone.id)
    })
    if (newIds.length > 0) actions.setSelection({ type: 'trunkDevice', ids: newIds })
    return true
  }

  return false
}
