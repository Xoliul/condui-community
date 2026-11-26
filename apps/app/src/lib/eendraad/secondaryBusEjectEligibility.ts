import type { Circuit, Panel, ProtectionDevice } from '@/types/schema'
import { findParentCircuitInfo } from '@/lib/eendraad/findParentCircuitInfo'
import { pickRepresentativeCircuitIdForMainBusMove } from '@/lib/eendraad/mainBusOrder'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

export interface SecondaryBusEjectSelection {
  sourcePanel: Panel
  parentCircuit: Circuit
  parentProtection: ProtectionDevice
  protectionIds: string[]
  directCircuitIds: string[]
}

function walkPanels(panels: Panel[], visit: (panel: Panel) => void): void {
  for (const panel of panels) {
    visit(panel)
    walkPanels(panel.subPanels ?? [], visit)
  }
}

function findPanelOwningProtection(panels: Panel[], protectionId: string): Panel | null {
  let out: Panel | null = null
  walkPanels(panels, (panel) => {
    if (out) return
    if ((panel.protections ?? []).some((protection) => protection.id === protectionId)) out = panel
  })
  return out
}

function getProtectionById(panel: Panel, protectionId: string): ProtectionDevice | null {
  return (panel.protections ?? []).find((protection) => protection.id === protectionId) ?? null
}

function getProtectionOwningCircuit(panel: Panel, circuitId: string): ProtectionDevice | null {
  return (
    (panel.protections ?? []).find((protection) =>
      (protection.circuits ?? []).some((circuit) => circuit.id === circuitId)
    ) ?? null
  )
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) return false
  for (const value of left) {
    if (!right.has(value)) return false
  }
  return true
}

/**
 * Valid only when the selected protections are exactly all direct protection
 * children of one secondary bus (`parentCircuit.subCircuitIds`).
 */
export function resolveSecondaryBusEjectSelection(
  project: ProjectWithOptionalV2Electrical | null | undefined,
  selectedProtectionIds: string[]
): SecondaryBusEjectSelection | null {
  if (!project || selectedProtectionIds.length === 0) return null
  const selectedSet = new Set(selectedProtectionIds)
  if (selectedSet.size !== selectedProtectionIds.length) return null
  const projectPanels = getProjectElectricalPanels(project)

  let sourcePanel: Panel | null = null
  let parentCircuit: Circuit | null = null
  let parentProtection: ProtectionDevice | null = null

  for (const protectionId of selectedProtectionIds) {
    const panel = findPanelOwningProtection(projectPanels, protectionId)
    if (!panel) return null
    const protection = getProtectionById(panel, protectionId)
    if (!protection) return null
    if (sourcePanel && sourcePanel.id !== panel.id) return null
    sourcePanel = panel

    const representativeCircuitId = pickRepresentativeCircuitIdForMainBusMove(panel, protection)
    if (!representativeCircuitId) return null
    const parentInfo = findParentCircuitInfo(representativeCircuitId, projectPanels)
    if (!parentInfo?.parentProtection) return null
    if (parentCircuit && parentCircuit.id !== parentInfo.parentCircuit.id) return null
    if (parentProtection && parentProtection.id !== parentInfo.parentProtection.id) return null
    parentCircuit = parentInfo.parentCircuit
    parentProtection = parentInfo.parentProtection
  }

  if (!sourcePanel || !parentCircuit || !parentProtection || parentProtection.subPanelId) return null

  const directCircuitIds = parentCircuit.subCircuitIds ?? []
  if (directCircuitIds.length === 0) return null

  const directProtectionIds: string[] = []
  for (const circuitId of directCircuitIds) {
    const directProtection = getProtectionOwningCircuit(sourcePanel, circuitId)
    if (!directProtection) return null
    if (directProtection.id === parentProtection.id) return null
    if (!directProtectionIds.includes(directProtection.id)) {
      directProtectionIds.push(directProtection.id)
    }
  }

  if (!setsEqual(selectedSet, new Set(directProtectionIds))) return null

  return {
    sourcePanel,
    parentCircuit,
    parentProtection,
    protectionIds: directProtectionIds,
    directCircuitIds,
  }
}
