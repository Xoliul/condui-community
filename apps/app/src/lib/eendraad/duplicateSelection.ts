/**
 * Resolve eendraad selection into a duplicate action and run it.
 *
 * Endpoint and trunk-device duplication is the electrical.duplicateElements project command;
 * protection (circuit) duplication is electrical.duplicateProtection.
 */

import { endpointSymbolCanBeDuplicated } from '@/lib/eendraad/duplicateEndpoint'
import type { Panel } from '@/types/schema'
import type { Selection } from '@/types/ui'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import type { ProjectStoreGetters } from '@/lib/eendraad/contextMenuActions'

export type EendraadDuplicateResult = {
  selection: Selection
} | null


function protectionIdInSelection(selection: Selection, get: ProjectStoreGetters): string | undefined {
  return selection.ids.find((id) => get.getProtectionById?.(id))
}

function circuitIdInSelection(selection: Selection, get: ProjectStoreGetters): string | undefined {
  if (selection.type === 'circuit' && selection.ids.length === 1) {
    return selection.ids[0]
  }
  for (const id of selection.ids) {
    if (get.getCircuitById(id)) return id
  }
  return undefined
}

function endpointIdsShareCircuit(
  endpointIds: string[],
  get: ProjectStoreGetters,
): { circuitId: string } | null {
  if (endpointIds.length === 0) return null
  let circuitId: string | undefined
  for (const eid of endpointIds) {
    const ep = get.getEndpointById(eid)
    if (!ep || !endpointSymbolCanBeDuplicated(ep)) return null
    const info = get.findCircuitForEndpoint(eid)
    if (!info) return null
    if (circuitId == null) {
      circuitId = info.circuit.id
    } else if (circuitId !== info.circuit.id) {
      return null
    }
  }
  return circuitId ? { circuitId } : null
}

function protectionForCircuitId(get: ProjectStoreGetters, circuitId: string): string | undefined {
  const project = get.getCurrentProject?.()
  if (!project) return undefined
  const walk = (panels: Panel[]): string | undefined => {
    for (const panel of panels) {
      for (const prot of panel.protections) {
        if (prot.circuits?.some((c) => c.id === circuitId)) return prot.id
      }
      for (const sub of panel.subPanels ?? []) {
        const found = walk([sub])
        if (found) return found
      }
    }
    return undefined
  }
  return walk(getProjectElectricalPanels(project))
}


/** Whether Duplicate should appear for this eendraad selection. */
export function canDuplicateEendraadSelection(
  selection: Selection,
  get: ProjectStoreGetters,
): boolean {
  if (selection.ids.length === 0) return false
  if (selection.type === 'supply' || selection.type === 'ground') return false
  if (selection.ids.includes('supply') || selection.ids.includes('ground')) return false
  if (selection.ids.some((id) =>
    get.getEndpointById(id)?.symbol === 'junction_panel' ||
    get.getTrunkDeviceById(id)?.device.symbol === 'junction_panel'
  )) return false

  if (protectionIdInSelection(selection, get)) return true
  if (selection.type === 'circuit' && selection.ids.length === 1 && get.getCircuitById(selection.ids[0]!)) {
    return !!protectionForCircuitId(get, selection.ids[0]!)
  }

  const endpointIds = selection.ids.filter((id) => get.getEndpointById(id))
  if (endpointIds.length === selection.ids.length && endpointIds.length > 0) {
    return endpointIdsShareCircuit(endpointIds, get) != null
  }

  const trunkIds = selection.ids.filter((id) => get.getTrunkDeviceById(id))
  if (trunkIds.length === selection.ids.length && trunkIds.length > 0) {
    const first = get.getTrunkDeviceById(trunkIds[0]!)
    if (!first) return false
    if (trunkIds.length === 1 && first.device.type === 'dc_bus') return false
    const isSupply = first.isSupplyDevice
    const isGround = first.isGroundDevice
    const circuitId = first.circuit?.id
    for (let i = 1; i < trunkIds.length; i++) {
      const r = get.getTrunkDeviceById(trunkIds[i]!)
      if (!r) return false
      if (isSupply && !r.isSupplyDevice) return false
      if (isGround && !r.isGroundDevice) return false
      if (circuitId && r.circuit?.id !== circuitId) return false
    }
    return true
  }

  return false
}

export function runEendraadDuplicate(
  selection: Selection,
  get: ProjectStoreGetters,
  duplicateProtection: (protectionId: string) => string | null,
  sitplan: { activeFloorId: string | null } = { activeFloorId: null },
): EendraadDuplicateResult {
  if (selection.ids.length === 0) return null
  if (selection.ids.some((id) =>
    get.getEndpointById(id)?.symbol === 'junction_panel' ||
    get.getTrunkDeviceById(id)?.device.symbol === 'junction_panel'
  )) return null

  const protId =
    protectionIdInSelection(selection, get) ??
    (() => {
      const circuitId = circuitIdInSelection(selection, get)
      return circuitId ? protectionForCircuitId(get, circuitId) : undefined
    })()

  if (protId) {
    const newProtId = duplicateProtection(protId)
    if (!newProtId) return null
    return { selection: { type: 'protection', ids: [newProtId] } }
  }

  const endpointIds = selection.ids.filter((id) => get.getEndpointById(id))
  const trunkIds = selection.ids.filter((id) => get.getTrunkDeviceById(id))
  const kind =
    endpointIds.length === selection.ids.length
      ? ('endpoint' as const)
      : trunkIds.length === selection.ids.length
        ? ('trunkDevice' as const)
        : null
  if (!kind) return null

  const outcome = runProjectCommand(
    'electrical.duplicateElements',
    {
      items: selection.ids.map((id) => ({ kind, id })),
      purpose: 'duplicate',
      target: { type: 'sourceSelection' },
      sitplan: { activeFloorId: sitplan.activeFloorId, viewportCenter: null, activePanelId: null },
    },
    { label: 'Duplicate selection' },
  )
  const created = outcome?.results[0]?.select?.filter((ref) => ref.kind === kind)
  if (!outcome?.changed || !created?.length) return null
  return { selection: { type: kind, ids: created.map((ref) => ref.id) } }
}
