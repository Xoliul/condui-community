import type { ProjectV2 } from '@/types/projectV2'
import type { Circuit, Panel, ProtectionDevice } from '@/types/schema'
import type { Placement } from '@/types/schema'
import { resolveSecondaryBusEjectSelection } from './secondaryBusEjectEligibility'
import {
  ensureLinkedSubPanelsHaveOwnPanelEndpoint,
  ensureRcboSensitivityOnProtection,
  findProtectionById,
  maybeApplyAutomaticEendraadNamingForPanel,
  prunePanelGridSlotsForUnresolvedModules,
  removePanelGridDuplicateRefs,
  rewirePanelGridProtectionModuleId,
  syncLinkedSubPanelHierarchy,
} from './projectElectricalDomain'
import {
  collectCircuitClosureDownstreamFromProtection,
  computeMainBusInsertIndexForEjectedProtection,
  dedupePanelProtectionsInPanelTree,
  deriveDescriptiveNameFromProtectionForNewSubPanel,
  moveProtectionToMainBusInsertIndex,
  pickRepresentativeCircuitIdForMainBusMove,
  promoteMovedSubPanelRootToIncomingTrunk,
  protectionDeviceToSubPanelIncomingTrunkDevice,
  relocateProtectionToPanelMainBus,
} from './mainBusOrder'
import { findParentCircuitInfo } from './findParentCircuitInfo'
import { getMainBusOrder } from './mainBusOrder'
import { findPanelById } from '@/lib/panel/panelTree'
import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import { getEditableProjectElectricalInstallation, getEditableProjectElectricalPanels, getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { getDefaultProtectionProps, getVoltagePolesConfig } from '@/lib/protectionDefaults'
import { createDefaultAcCircuitCable } from '@/lib/wires/circuitWireDefaults'
import { getDomainTranslator } from '@/lib/i18n/domainI18n'
import { protectionFeedsPanel } from './panelSupplyLink'

export interface SecondaryBusEjectResult {
  panelId: string
  sourcePanelId: string
  movedProtectionIds: string[]
  createdProtectionIds: string[]
  placementId?: string
}

function getNextPanelCircuitCode(panel: Panel): string {
  const used = new Set([
    ...panel.circuits.map((circuit) => circuit.code.trim().toUpperCase()),
    ...panel.protections.map((protection) => protection.label.trim().toUpperCase()),
  ])
  for (let index = 0; ; index += 1) {
    let value = index + 1
    let code = ''
    while (value > 0) {
      value -= 1
      code = String.fromCharCode(65 + (value % 26)) + code
      value = Math.floor(value / 26)
    }
    if (!used.has(code)) return code
  }
}

function countAllPanels(project: ProjectV2): number {
  const count = (panels: Panel[]): number =>
    panels.reduce((total, panel) => total + 1 + count(panel.subPanels ?? []), 0)
  return count(getProjectElectricalPanels(project))
}

/** Headless equivalent of the secondary-bus eject gesture; every id is injected by the command. */
export function ejectSecondaryBusProtectionsToNewPanelInProject(
  project: ProjectV2,
  protectionIds: readonly string[],
  options: {
    newPanelName?: string
    newId: () => string
    language?: string | null
    planPlacement?: Omit<Placement, 'id' | 'rotationDeg' | 'scale'>
  }
): SecondaryBusEjectResult | null {
  const selection = resolveSecondaryBusEjectSelection(project, [...protectionIds])
  if (!selection) return null
  const panels = getEditableProjectElectricalPanels(project)
  const sourcePanel = findPanelById(panels, selection.sourcePanel.id)
  if (!sourcePanel) return null
  const parentProtection = findProtectionById(sourcePanel, selection.parentProtection.id)
  const parentCircuit = parentProtection?.circuits?.find(
    (circuit) => circuit.id === selection.parentCircuit.id
  )
  if (!parentProtection || !parentCircuit) return null

  const movedProtections = selection.protectionIds
    .map((id) => findProtectionById(sourcePanel, id))
    .filter((protection): protection is ProtectionDevice => !!protection)
  if (movedProtections.length !== selection.protectionIds.length) return null

  const panelNumber = countAllPanels(project) + 1
  const newPanelId = options.newId()
  const firstProtection = movedProtections[0]!
  const translate = getDomainTranslator(options.language)
  const name =
    options.newPanelName?.trim() ||
    deriveDescriptiveNameFromProtectionForNewSubPanel(firstProtection) ||
    translate('panels.secondaryPanel', {
      number: panelNumber,
      defaultValue: `Panel ${panelNumber}`,
    })
  const newPanel: Panel = {
    id: newPanelId,
    name,
    symbol: 'panel_distribution',
    isMain: false,
    protections: [],
    circuits: [],
    subPanels: [],
  }
  ;(sourcePanel.subPanels ??= []).push(newPanel)

  const voltagePoles = getVoltagePolesConfig(project)
  let panelCircuit = newPanel.circuits.find((circuit) => circuit.code === 'PANEL')
  if (!panelCircuit) {
    panelCircuit = {
      id: options.newId(),
      code: 'PANEL',
      kind: 'other',
      cable: { kind: 'XVB', conductors: 3, sectionMm2: 6, hasPE: true },
      endpoints: [],
    }
    newPanel.circuits.push(panelCircuit)
  }
  const panelEndpoint = {
    id: options.newId(),
    type: 'fixed_appliance' as const,
    label: newPanel.name,
    panelId: newPanel.id,
    symbol: 'panel_distribution' as const,
    placements: options.planPlacement
      ? [{ id: options.newId(), ...options.planPlacement, rotationDeg: 0, scale: 1 }]
      : [],
  }
  panelCircuit.endpoints.push(panelEndpoint)

  const single = movedProtections.length === 1
  const first = movedProtections[0]!
  let originalParentCircuit: Circuit | undefined
  let originalParentProtection: ProtectionDevice | undefined
  let representativeCircuitId: string | undefined
  let movedCircuitIds = new Set<string>()
  let shouldReattachFeeder = false
  let insertIndex = getMainBusOrder(sourcePanel).length

  if (single) {
    insertIndex = computeMainBusInsertIndexForEjectedProtection(sourcePanel, first.id, panels)
    movedCircuitIds = collectCircuitClosureDownstreamFromProtection(sourcePanel, first)
    representativeCircuitId = pickRepresentativeCircuitIdForMainBusMove(sourcePanel, first)
    const parentInfo = representativeCircuitId
      ? findParentCircuitInfo(representativeCircuitId, panels)
      : null
    originalParentCircuit = parentInfo?.parentCircuit
    originalParentProtection = parentInfo?.parentProtection ?? undefined
    const position =
      representativeCircuitId && originalParentCircuit?.subCircuitIds
        ? originalParentCircuit.subCircuitIds.indexOf(representativeCircuitId)
        : -1
    shouldReattachFeeder =
      !!originalParentCircuit && position >= 0 && !movedCircuitIds.has(originalParentCircuit.id)
  }

  movedProtections.forEach((protection, index) =>
    relocateProtectionToPanelMainBus(sourcePanel, newPanel, protection, index)
  )

  if (single) {
    const incomingDevice = protectionDeviceToSubPanelIncomingTrunkDevice(
      first,
      first.id,
      voltagePoles
    )
    const hasOwnEndpoints = (first.circuits ?? []).some((circuit) => (circuit.endpoints?.length ?? 0) > 0)
    if (!hasOwnEndpoints && !protectionFeedsPanel(first))
      promoteMovedSubPanelRootToIncomingTrunk(newPanel, first.id, incomingDevice)

    if (shouldReattachFeeder && originalParentCircuit && originalParentProtection) {
      originalParentProtection.subPanelId = newPanelId
      rewirePanelGridProtectionModuleId(sourcePanel, first.id, originalParentProtection.id)
      originalParentCircuit.subCircuitIds = originalParentCircuit.subCircuitIds?.filter(
        (circuitId) => circuitId !== representativeCircuitId
      )
      if (originalParentCircuit.subCircuitIds?.length === 0)
        originalParentCircuit.subCircuitIds = undefined
    } else {
      const feederCode = getNextPanelCircuitCode(sourcePanel)
      const feederProtectionId = options.newId()
      const feederProtection: ProtectionDevice = {
        id: feederProtectionId,
        type: 'MCB',
        label: feederCode,
        circuits: [],
        subPanelId: newPanelId,
        ...getDefaultProtectionProps('MCB', voltagePoles),
      }
      ensureRcboSensitivityOnProtection(feederProtection)
      sourcePanel.protections.push(feederProtection)
      feederProtection.circuits = [
        {
          id: options.newId(),
          code: feederCode,
          kind: 'other',
          cable: createDefaultAcCircuitCable({ sectionMm2: 6 }),
          endpoints: [],
        },
      ]
      rewirePanelGridProtectionModuleId(sourcePanel, first.id, feederProtectionId)
      moveProtectionToMainBusInsertIndex(sourcePanel, feederProtectionId, insertIndex)
    }
  } else {
    parentProtection.subPanelId = newPanelId
    parentCircuit.subCircuitIds = undefined
  }

  prunePanelGridSlotsForUnresolvedModules(sourcePanel)
  removePanelGridDuplicateRefs(project, sourcePanel)
  dedupePanelProtectionsInPanelTree(sourcePanel)
  dedupePanelProtectionsInPanelTree(newPanel)
  ensureLinkedSubPanelsHaveOwnPanelEndpoint(project, options.newId)
  syncLinkedSubPanelHierarchy(project)
  const installation = getEditableProjectElectricalInstallation(project)
  if (!installation) return null
  ensureInstallationFeedTopology(installation, getEditableProjectElectricalPanels(project), options.newId)
  maybeApplyAutomaticEendraadNamingForPanel(project, sourcePanel.id)
  maybeApplyAutomaticEendraadNamingForPanel(project, newPanelId)
  return {
    panelId: newPanelId,
    sourcePanelId: sourcePanel.id,
    movedProtectionIds: movedProtections.map((protection) => protection.id),
    createdProtectionIds: single && !shouldReattachFeeder ? [sourcePanel.protections.at(-1)!.id] : [],
    ...(panelEndpoint.placements[0]
      ? { placementId: panelEndpoint.placements[0].id }
      : {}),
  }
}
