/**
 * 1draad context menu: duplicate and paste (copy buffer) logic.
 */

import { findDropTarget } from '@/lib/layout/findDropTarget'
import type { LayoutTree } from '@/lib/layout/layoutTree'
import type { Point } from '@/types/ui'
import type { Selection } from '@/types/ui'
import type { Endpoint, TrunkDevice, Circuit, ProtectionDevice, Panel } from '@/types/schema'
import { duplicateProtection } from '@/handlers/eendraad/duplicateProtection'
import {
  canDuplicateEendraadSelection,
  runEendraadDuplicate,
} from '@/lib/eendraad/duplicateSelection'
import type { ProjectWithOptionalV2Building } from '@/lib/projectV2/buildingFloors'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'

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
  duplicateProtection?: (protectionId: string) => string | null
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
  if (selection.type === 'endpoint' || selection.type === 'trunkDevice') {
    const project = get.getCurrentProject?.()
    if (!project || selection.ids.length === 0) return
    const outcome = runProjectCommand('electrical.duplicateElements', {
      items: selection.ids.map((id) => ({ kind: selection.type === 'endpoint' ? 'endpoint' as const : 'trunkDevice' as const, id })),
      purpose: 'duplicate',
      target: { type: 'sourceSelection' },
    }, { label: 'Duplicate selection' })
    const select = outcome?.results[0]?.select?.filter((ref) => ref.kind === selection.type)
    if (!outcome?.changed || !select?.length) return
    actions.setSelection({ type: selection.type, ids: select.map((ref) => ref.id) })
    return
  }
  const result = runEendraadDuplicate(
    selection,
    get,
    (protectionId) => actions.duplicateProtection ? actions.duplicateProtection(protectionId) : duplicateProtection({ protectionId }),
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
  if (!target) return false
  const itemKind = clipboard.type === 'endpoint' ? 'endpoint' : clipboard.type === 'trunkDevice' ? 'trunkDevice' : null
  if (!itemKind) return false
  let commandTarget: unknown
  if (target.type === 'supplyWire' && itemKind === 'trunkDevice') {
    commandTarget = { type: 'supply', panelId: target.panelId ?? null, feedScope: target.supplyFeedScope ?? 'shared', insertIndex: target.supplyDeviceInsertIndex ?? 0 }
  } else if (target.type === 'groundWire' && itemKind === 'trunkDevice') {
    commandTarget = { type: 'ground', panelId: target.panelId ?? null, insertIndex: target.groundDeviceInsertIndex ?? 0 }
  } else if (target.circuitId && itemKind === 'endpoint') {
    commandTarget = { type: 'pasteEndpoints', circuitId: target.circuitId, insertAfterEndpointId: target.insertAfterEndpointId }
  } else if (target.circuitId && itemKind === 'trunkDevice') {
    const circuit = get.getCircuitById(target.circuitId)
    if (!circuit) return false
    if (target.dcBusId && target.branchId) {
      commandTarget = { type: 'dcBranchDevice', circuitId: target.circuitId, branchId: target.branchId, insertIndex: target.branchDeviceInsertIndex ?? 0 }
    } else {
      commandTarget = { type: 'circuitTrunk', circuitId: target.circuitId, insertIndex: target.circuitTrunkSegmentIndex ?? (circuit.trunkDevices?.length ?? 0) }
    }
  } else return false
  const outcome = runProjectCommand('electrical.duplicateElements', {
    items: clipboard.ids.map((id) => ({ kind: itemKind, id })),
    purpose: 'paste',
    target: commandTarget,
  }, { label: 'Paste' })
  const result = outcome?.results[0]
  if (!outcome?.changed || !result?.select?.length) return false
  const endpointIds = result.select.filter((ref) => ref.kind === 'endpoint').map((ref) => ref.id)
  const deviceIds = result.select.filter((ref) => ref.kind === 'trunkDevice').map((ref) => ref.id)
  if (endpointIds.length) actions.setSelection({ type: 'endpoint', ids: endpointIds })
  else if (deviceIds.length) actions.setSelection({ type: 'trunkDevice', ids: deviceIds })
  return true
}
