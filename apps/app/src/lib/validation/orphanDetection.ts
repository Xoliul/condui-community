import { logger } from '@/lib/logger'
/**
 * Orphan detection for the one-line (eendraad) diagram.
 *
 * Detects data inconsistencies that cause endpoints, circuits, or frame contents
 * to be missing from the wire view or to appear under the wrong protection:
 *
 * 1. Circuit reference mismatch: a circuit is listed under one protection but
 *    also appears as a subcircuit of another circuit (under a different protection).
 *    The diagram will only show it under the parent circuit, so it appears "orphaned"
 *    from the protection that lists it.
 *
 * 2. Protection reference conflict: a circuit is listed by multiple protections. RCD/RCBO
 *    secondary-bus nesting uses the anchor's subCircuitIds and does not duplicate ownership.
 *
 * 3. Endpoint not in any branch: circuit.endpoints contains an endpoint that
 *    is not in any branch.endpointIds, so it never appears on a branch in the layout.
 *
 * 4. Branch references missing endpoint: branch.endpointIds references an
 *    endpoint id that is not in circuit.endpoints (stale reference).
 *
 * 5. Frame content orphans: eendraadFrames[].contentIds reference endpoints or
 *    protections that don't exist or belong to another panel.
 *
 * 6. Sitplan placement missing: endpoint is on the one-line diagram (and should appear on the
 *    floor plan) but has no placements — invisible on every PlanCanvas floor.
 *
 * 7. Sub-circuit self-reference: `circuit.subCircuitIds` contains the circuit's own id (invalid).
 *    One-line layout may skip the circuit while plan-drop pickers still list it.
 */

import type {
  Panel,
  Circuit,
  PanelGridModuleRef,
  ProtectionDevice,
  TrunkDevice,
} from '@/types/schema'
import i18next from '@/lib/validation/validationI18n'
import type { OrphanReason } from '@/types/schema'
import type { Issue, Offender } from './core/types'
import { findCircuitInProject, resolveFrameContentItems } from '@/lib/eendraad/frameContent'
import { endpointSupportsMultiplier } from '@/utils/endpointMultipliers'
import { isActualEndpoint } from '@/utils/symbolMapping'
import { symbolRequiresSituationPlanPlacement } from '@/lib/plan/situationPlanSymbolEligibility'
import { isModularSocket } from '@/lib/socket/modularSocket'
import { resolvePanelForDistributionEndpoint } from '@/lib/plan/panelDistributionEndpoint'
import { panelGridModuleRefKey } from '@/lib/panel/panelGridModuleRef'
import {
  findPanelGridDuplicateFindings,
  isSupplyBusProtectionLabelCollision,
} from '@/lib/panel/panelGridDuplicates'
import {
  panelSupplyLinkHasRenderableSymbol,
  resolvePanelSupplyLinkForPanel,
  resolvePanelSupplyLinkForProtection,
} from '@/lib/eendraad/panelSupplyLink'
import { getAllSupplyTrunkDevices, getPanelFeedProjection } from '@/lib/feedTopology'
import { collectAllGroundTrunkDevices } from '@/lib/eendraad/panelGround'
import { queryOneWireFrames, type AnnotationProject } from '@/lib/projectV2/annotations'
import {
  selectProjectBuildingFloorIds,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  selectProjectSupplyAssemblies,
  selectProjectAuxiliaryElectricalEnclosures,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { collectCircuits, findPanelById, walkPanels } from '@/lib/panel/panelTree'
import { isSupplyHandoffTargetPresent } from '@/lib/supplyAssembly/handoffTargetIntegrity'
import { hasExplicitPanelBusSections } from '@/lib/panel/panelBusSections'
import { panelHasBackupOutput } from '@/lib/panel/panelFeedOrganization'
import { resolveSupplyDeviceMounting } from '@/lib/panel/auxiliarySupplyEnclosures'
import {
  isInverterPanelDevice,
  isSupplyDeviceVisibleInPanel,
} from '@/lib/panel/supplyPanelVisibility'
import { trunkDeviceCanAppearInPanelGrid } from '@/lib/eendraad/projectElectricalDomain'

type OrphanDetectionProject = ProjectWithOptionalV2Electrical &
  ProjectWithOptionalV2Building &
  AnnotationProject

type PlanPlacementOwner = {
  kind: 'endpoint' | 'trunkDevice'
  id: string
  label: string
}

type PlanPlacementIdentityConflict = {
  placementId: string
  owners: PlanPlacementOwner[]
}

function collectPlanPlacementIdentityConflicts(
  project: OrphanDetectionProject
): PlanPlacementIdentityConflict[] {
  const ownersByPlacementId = new Map<string, PlanPlacementOwner[]>()
  const add = (placementId: string, owner: PlanPlacementOwner) => {
    const owners = ownersByPlacementId.get(placementId) ?? []
    owners.push(owner)
    ownersByPlacementId.set(placementId, owners)
  }
  const addDevice = (device: TrunkDevice) => {
    for (const placement of device.placements ?? []) {
      add(placement.id, { kind: 'trunkDevice', id: device.id, label: device.label || device.id })
    }
  }
  const visit = (panels: Panel[]) => {
    for (const panel of panels) {
      for (const circuit of collectCircuits(panel)) {
        for (const endpoint of circuit.endpoints) {
          for (const placement of endpoint.placements) {
            add(placement.id, {
              kind: 'endpoint',
              id: endpoint.id,
              label: endpoint.label || endpoint.id,
            })
          }
        }
        for (const device of circuit.trunkDevices ?? []) addDevice(device)
        for (const branch of circuit.branches ?? []) {
          for (const device of branch.branchDevices ?? []) addDevice(device)
        }
      }
      visit(panel.subPanels ?? [])
    }
  }
  visit(getProjectElectricalPanels(project))
  for (const device of getAllSupplyTrunkDevices(project)) addDevice(device)
  for (const device of collectAllGroundTrunkDevices(
    getProjectElectricalPanels(project),
    getProjectElectricalInstallation(project)
  )) {
    addDevice(device)
  }

  return [...ownersByPlacementId.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([placementId, owners]) => ({ placementId, owners }))
}

function validationUnnamedCircuitLabel(): string {
  return i18next.t('validation.labels.unnamedCircuit', {
    defaultValue: '[unnamed circuit]',
  })
}

function validationUnnamedProtectionLabel(): string {
  return i18next.t('validation.labels.unnamedProtection', {
    defaultValue: '[unnamed protection]',
  })
}

function validationCircuitCode(code: string | undefined | null): string {
  return code?.trim() || validationUnnamedCircuitLabel()
}

function validationProtectionLabel(label: string | undefined | null): string {
  return label?.trim() || validationUnnamedProtectionLabel()
}

function canMergeIntoMultiplierRun(ep: Circuit['endpoints'][number]): boolean {
  if (!isActualEndpoint(ep) || !endpointSupportsMultiplier(ep)) return false
  if (ep.domoticaChildProps) return false
  // Solar/battery support multipliers via multiple *placements* of one endpoint, but several
  // endpoints in sequence on a branch are valid (e.g. PV string). Do not treat them like
  // duplicate light endpoints that should merge.
  if (ep.symbol === 'solar_panel' || ep.symbol === 'battery') return false
  return true
}

function compatibleMultiplierMerge(
  a: Circuit['endpoints'][number],
  b: Circuit['endpoints'][number]
): boolean {
  return a.type === b.type && a.symbol === b.symbol
}

/** Optional plan symbols are valid with zero placements and must never be reported as orphans. */
function endpointExpectedOnSitplan(ep: Circuit['endpoints'][number]): boolean {
  return symbolRequiresSituationPlanPlacement(ep.symbol) && !isModularSocket(ep)
}

type SupplyTrunkVisualPlacementMissingReason =
  | 'missingPanel'
  | 'missingAuxiliaryEnclosure'
  | 'wrongRootFeed'
  | 'panelMountingSlotMismatch'

function supplyTrunkModuleKey(deviceId: string): string {
  return panelGridModuleRefKey({ kind: 'trunkDevice', id: deviceId, scope: 'supply' })
}

/**
 * A hidden panel module is an explicit user visibility choice, not an orphan. The key is checked
 * across the panel tree because shared supply visibility is synchronized between occurrences.
 */
function isSupplyTrunkDeviceManuallyHidden(
  project: OrphanDetectionProject,
  deviceId: string
): boolean {
  const key = supplyTrunkModuleKey(deviceId)
  return [...walkPanels(getProjectElectricalPanels(project))].some((panel) =>
    panel.gridView?.hiddenModuleKeys?.includes(key)
  )
}

/**
 * Return a reason only when an eligible supply device has a mounting that the panel canvas cannot
 * reach. Unslotted root-panel devices and grid/auxiliary devices are auto-placed by the renderer.
 */
function findSupplyTrunkVisualPlacementMissingReason(
  project: OrphanDetectionProject,
  device: TrunkDevice
): { reason: SupplyTrunkVisualPlacementMissingReason; panelId?: string } | undefined {
  if (!trunkDeviceCanAppearInPanelGrid(device)) return undefined
  if (isInverterPanelDevice(device) && !isSupplyDeviceVisibleInPanel(project, device.id))
    return undefined
  if (isSupplyTrunkDeviceManuallyHidden(project, device.id)) return undefined

  const mounting = resolveSupplyDeviceMounting(project, device.id)
  if (!mounting) return { reason: 'wrongRootFeed' }

  if (mounting.kind === 'grid') return undefined
  if (mounting.kind === 'auxiliary') {
    return selectProjectAuxiliaryElectricalEnclosures(project).some(
      (enclosure) => enclosure.id === mounting.enclosureId
    )
      ? undefined
      : { reason: 'missingAuxiliaryEnclosure' }
  }

  const targetPanel = findPanelById(getProjectElectricalPanels(project), mounting.panelId)
  if (!targetPanel) return { reason: 'missingPanel', panelId: mounting.panelId }

  const moduleKey = panelGridModuleRefKey({
    kind: 'trunkDevice',
    id: device.id,
    scope: 'supply',
  })
  const hasMainPanelSlot = targetPanel.gridView?.slots?.some(
    (slot) => panelGridModuleRefKey(slot.module) === moduleKey
  )
  const hasSupplyPanelSlot = targetPanel.gridView?.supplyPanelSlots?.some(
    (slot) => panelGridModuleRefKey(slot.module) === moduleKey
  )
  if (!hasMainPanelSlot && hasSupplyPanelSlot) {
    return { reason: 'panelMountingSlotMismatch', panelId: targetPanel.id }
  }

  // The panel selector includes mounted supply devices from every electrical feed.
  // Existing main and secondary enclosures can auto-place them without owning their input.
  return undefined
}

/** Single detected orphan for UI: banner, inspector, focus and quarantine */
export interface DetectedOrphan {
  id: string
  kind: 'circuit' | 'endpoint' | 'frame'
  reason: OrphanReason
  summary: string
  panelId: string
  /** Set selection to this to focus the offending entity on the diagram */
  focusSelection: { type: 'circuit' | 'endpoint' | 'protection' | 'trunkDevice'; ids: string[] }
  /** If set, caller can quarantine this item (circuit or endpoint) */
  quarantinePayload?:
    | { kind: 'circuit'; circuitId: string; originalParentId?: string; originalRefId?: string }
    | { kind: 'endpoint'; circuitId: string; endpointId: string; originalRefId?: string }
  /** Optional non-destructive repair payload for inspector quick-fixes. */
  resolutionPayload?:
    | {
        kind: 'dedupeEndpointPlacements'
        endpointId: string
        keepPlacementId: string
        removePlacementIds: string[]
      }
    | {
        kind: 'repairSharedPlanPlacementIds'
        placementId: string
        owners: Array<{ kind: 'endpoint' | 'trunkDevice'; id: string }>
      }
    | {
        kind: 'attachCircuitToProtection'
        panelId: string
        circuitId: string
      }
    | {
        kind: 'repairPanelGridDuplicateModules'
        panelId: string
        removeSlots: Array<{
          area: 'main' | 'supply'
          row: number
          col: number
          moduleKey: string
        }>
        hideModuleKeys: string[]
      }
    | {
        /** Move a supply-scope trunk module from main `gridView.slots` into `supplyPanelSlots`. */
        kind: 'ejectSupplyTrunkToSupplyStrip'
        panelId: string
        moduleRef: PanelGridModuleRef
      }
    | {
        /** Move a physically panel-mounted supply module out of stale supply-strip slots. */
        kind: 'repairSupplyTrunkPanelMountingSlot'
        panelId: string
        deviceId: string
      }
    | {
        kind: 'repairDomoticaChildLink'
        circuitId: string
        endpointId: string
        parentEndpointId: string
        outputGroup: 'endpoint' | 'control'
        outputIndex: number
      }
    | { kind: 'addAutoSitplanPlacement'; endpointId: string }
    | { kind: 'syncPanelDistributionLabel'; endpointId: string }
    | {
        kind: 'mergeMultiplierEndpointsOnBranch'
        circuitId: string
        keepEndpointId: string
        absorbEndpointIds: string[]
      }
    | {
        /** Rebuild `circuit.branches` so every endpoint is on a branch (e.g. missing branches after a bug). */
        kind: 'repairCircuitBranchMembership'
        panelId: string
        circuitId: string
      }
    | {
        /** Remove a circuit's own id from `subCircuitIds` (invalid self-nesting). */
        kind: 'repairSubCircuitSelfReference'
        panelId: string
        circuitId: string
      }
    | {
        /** Drop a stale id from eendraad frame membership (or remove the frame if empty). */
        kind: 'pruneFrameContentReference'
        contentId: string
        contentType: 'endpoint' | 'protection' | 'trunkDevice' | 'ground' | 'circuit'
      }
    | {
        /** Collapse stale split-feed data back onto the main panel's single grid feed. */
        kind: 'collapsePanelFeedToSingleGrid'
        panelId: string
      }
}

/** Build circuit id -> circuit for a panel (same logic as layout) */
function buildCircuitMap(panel: Panel): Map<string, Circuit> {
  const map = new Map<string, Circuit>()
  for (const c of panel.circuits) {
    map.set(c.id, c)
  }
  for (const protection of panel.protections) {
    if (protection.circuits) {
      for (const c of protection.circuits) {
        if (!map.has(c.id)) map.set(c.id, c)
      }
    }
  }
  return map
}

/**
 * Structural circuit ownership is broader than electrical protection. A rotating switch can
 * deliberately start a trunk even though it does not count as functional protection for AREI
 * validation or hardware tallies.
 */
function isUnprotectedDirectDcBusFeeder(protection: ProtectionDevice, circuit: Circuit): boolean {
  return (
    protection.type === 'OTHER' &&
    protection.directDcBusFeeder === true &&
    protection.dcBusId != null &&
    circuit.dcBusSource?.busId === protection.dcBusId
  )
}

function hasDirectCircuitOwner(panel: Panel, circuitId: string): boolean {
  for (const protection of panel.protections) {
    const circuit = protection.circuits?.find((candidate) => candidate.id === circuitId)
    if (circuit && !isUnprotectedDirectDcBusFeeder(protection, circuit)) {
      return true
    }
  }
  return false
}

export interface OrphanReport {
  /** Non-PANEL circuit is not owned by any panel protection (one-wire cannot render it). */
  circuitMissingProtection: Array<{
    circuitId: string
    circuitCode: string
    endpointCount: number
  }>
  /** Circuit is listed under protection P but displayed as subcircuit under another protection */
  circuitRefMismatch: Array<{
    circuitId: string
    circuitCode: string
    listedUnderProtectionId: string
    listedUnderProtectionLabel: string
    parentCircuitId: string
    parentCircuitCode: string
    displayedUnderProtectionId: string
    displayedUnderProtectionLabel: string
  }>
  /** Circuit is referenced by multiple protections instead of having one structural owner. */
  protectionReferenceConflict: Array<{
    circuitId: string
    circuitCode: string
    protectionIds: string[]
    protectionLabels: string[]
  }>
  /** Endpoint exists in circuit.endpoints but is not in any branch.endpointIds */
  endpointNotInBranch: Array<{
    circuitId: string
    circuitCode: string
    endpointId: string
    endpointLabel: string
  }>
  /** branch.endpointIds references an id not in circuit.endpoints */
  branchRefsMissingEndpoint: Array<{
    circuitId: string
    circuitCode: string
    branchId: string
    branchLabel: string
    endpointId: string
  }>
  /** Frame contentId does not exist or is not in this panel */
  frameContentOrphans: Array<{
    frameId: string
    frameTitle: string
    panelId: string
    contentId: string
    contentType: 'endpoint' | 'protection' | 'trunkDevice' | 'ground' | 'circuit'
    reason: 'missing' | 'wrong_panel'
  }>
  /** Circuit lists its own id in subCircuitIds (corrupt nest / layout may skip the circuit on one-line) */
  subCircuitSelfReference: Array<{
    circuitId: string
    circuitCode: string
  }>
  /** Circuit has subCircuitIds entry that does not exist in the panel (stale reference) */
  subCircuitIdMissingCircuit: Array<{
    parentCircuitId: string
    parentCircuitCode: string
    missingCircuitId: string
  }>
  /** Endpoint is attached to PANEL pseudo-circuit; unsupported/invalid */
  endpointOnPanelCircuit: Array<{
    circuitId: string
    circuitCode: string
    endpointId: string
    endpointLabel: string
  }>
  /** Endpoint has placements on multiple floors, but symbol is single-instance */
  endpointMultipleFloorPlacements: Array<{
    circuitId: string
    circuitCode: string
    endpointId: string
    endpointLabel: string
    placementIds: string[]
    floorIds: string[]
  }>
  /** Generic placement integrity violations (stale floor refs, duplicate ids, etc.) */
  endpointPlacementIntegrity: Array<{
    circuitId: string
    circuitCode: string
    endpointId: string
    endpointLabel: string
    placementId: string
    violation: 'missingFloor' | 'duplicatePlacementId'
    floorId?: string
  }>
  /** Multiple plan symbols share one global placement id, breaking plan selection and labels. */
  planPlacementIdentityConflict: Array<PlanPlacementIdentityConflict>
  /** Domotica parent slot list references an endpoint whose reverse child link is missing/wrong. */
  domoticaChildLinkMismatch: Array<{
    circuitId: string
    circuitCode: string
    parentEndpointId: string
    parentLabel: string
    endpointId: string
    endpointLabel: string
    outputGroup: 'endpoint' | 'control'
    outputIndex: number
  }>
  /**
   * Endpoint exists on the one-line diagram but has no sitplan placement — invisible on every floor plan
   * (often after eendraad-only drop when auto-place was skipped).
   */
  endpointMissingPlanPlacement: Array<{
    circuitId: string
    circuitCode: string
    endpointId: string
    endpointLabel: string
    symbol: string
  }>
  /** panel_distribution label does not match the resolved panel name (plan selection / labels break). */
  panelDistributionLabelDrift: Array<{
    circuitId: string
    circuitCode: string
    endpointId: string
    endpointLabel: string
    panelId: string
    panelName: string
  }>
  /** Non-main panel exists but no source-side feeder circuit renders a panel_distribution one-wire symbol. */
  panelMissingOneWireSymbol: Array<{
    panelId: string
    panelName: string
    feederProtectionId?: string
    feederCircuitId?: string
  }>
  /**
   * Same branch lists several multiplier-capable terminals (e.g. two lights, not DC string endpoints) as separate endpoints.
   * Sitplan expects one endpoint with multiple placements. Plan properties need endpointId on the placement row.
   */
  branchMultiplierEndpointsSplit: Array<{
    circuitId: string
    circuitCode: string
    branchId: string
    branchLabel: string
    keepEndpointId: string
    keepEndpointLabel: string
    absorbEndpointIds: string[]
  }>
  /** Same panel-grid module ref is stored multiple times in main/supply slots. */
  panelGridDuplicateModule: Array<{
    reason: 'duplicateRef' | 'duplicateVisibleLabel'
    summaryLabel: string
    keep: {
      moduleKey: string
      moduleRef: NonNullable<Panel['gridView']>['slots'][number]['module']
      area: 'main' | 'supply'
      row: number
      col: number
    }
    remove: Array<{
      moduleKey: string
      moduleRef: NonNullable<Panel['gridView']>['slots'][number]['module']
      area: 'main' | 'supply'
      row: number
      col: number
    }>
    hideModuleKeys: string[]
  }>
  /** Supply trunk device slotted on main panel grid instead of the supply strip (invalid layout). */
  supplyTrunkMisplacedInMainGrid: Array<{
    trunkDeviceId: string
    label: string
    row: number
    col: number
  }>
  /** Supply trunk device has a physical mounting that cannot produce a panel-canvas placement. */
  supplyTrunkVisualPlacementMissing: Array<{
    trunkDeviceId: string
    label: string
    reason: SupplyTrunkVisualPlacementMissingReason
    panelId?: string
  }>
  /** Main panel has several bus sections but no connected backup path capable of supplying one. */
  splitBusWithoutBackupSupply: Array<{
    panelId: string
    panelName: string
    busSectionCount: number
  }>
  /** Supply handoff references a circuit that no longer exists in its target panel. */
  supplyAssemblyHandoffTargetMissing: Array<{
    assemblyId: string
    handoffId: string
    handoffNodeId: string
    missingCircuitId: string
  }>
}

/**
 * Run orphan detection for a single panel and (for frames) project-level frame references for that panel.
 */
export function detectPanelOrphans(project: OrphanDetectionProject, panelId: string): OrphanReport {
  const report: OrphanReport = {
    circuitMissingProtection: [],
    circuitRefMismatch: [],
    protectionReferenceConflict: [],
    endpointNotInBranch: [],
    branchRefsMissingEndpoint: [],
    frameContentOrphans: [],
    subCircuitSelfReference: [],
    subCircuitIdMissingCircuit: [],
    endpointOnPanelCircuit: [],
    endpointMultipleFloorPlacements: [],
    endpointPlacementIntegrity: [],
    planPlacementIdentityConflict: [],
    domoticaChildLinkMismatch: [],
    endpointMissingPlanPlacement: [],
    panelDistributionLabelDrift: [],
    panelMissingOneWireSymbol: [],
    branchMultiplierEndpointsSplit: [],
    panelGridDuplicateModule: [],
    supplyTrunkMisplacedInMainGrid: [],
    supplyTrunkVisualPlacementMissing: [],
    splitBusWithoutBackupSupply: [],
    supplyAssemblyHandoffTargetMissing: [],
  }

  const projectPanels = getProjectElectricalPanels(project)
  const projectInstallation = getProjectElectricalInstallation(project)
  const panel = findPanelById(projectPanels, panelId)
  if (!panel) return report
  const currentPanel = panel
  if (currentPanel.isMain === true) {
    report.planPlacementIdentityConflict = collectPlanPlacementIdentityConflicts(project)
  }
  if (
    currentPanel.isMain !== false &&
    hasExplicitPanelBusSections(currentPanel) &&
    currentPanel.busSections!.length > 1 &&
    !panelHasBackupOutput(project, currentPanel.id)
  ) {
    report.splitBusWithoutBackupSupply.push({
      panelId: currentPanel.id,
      panelName: currentPanel.name,
      busSectionCount: currentPanel.busSections!.length,
    })
  }
  const reportedMissingOneWirePanelIds = new Set<string>()
  const reportMissingOneWirePanel = (
    missingPanel: Panel,
    feeder?: { protectionId: string; circuitId?: string }
  ) => {
    if (reportedMissingOneWirePanelIds.has(missingPanel.id)) return
    reportedMissingOneWirePanelIds.add(missingPanel.id)
    report.panelMissingOneWireSymbol.push({
      panelId: missingPanel.id,
      panelName: missingPanel.name,
      feederProtectionId: feeder?.protectionId,
      feederCircuitId: feeder?.circuitId,
    })
  }

  // Validate feeder links from the source side too. This catches a parent board
  // protection that claims it feeds a sub-panel but has no real one-line panel symbol.
  for (const protection of currentPanel.protections ?? []) {
    if (!protection.subPanelId) continue
    const link = resolvePanelSupplyLinkForProtection(project, currentPanel, protection)
    if (!link) continue
    if (!panelSupplyLinkHasRenderableSymbol(link)) {
      reportMissingOneWirePanel(link.targetPanel, {
        protectionId: protection.id,
        circuitId: protection.circuits?.[0]?.id,
      })
    }
  }

  if (!currentPanel.isMain) {
    const link = resolvePanelSupplyLinkForPanel(project, panelId)
    if (!link || !panelSupplyLinkHasRenderableSymbol(link)) {
      reportMissingOneWirePanel(
        currentPanel,
        link
          ? {
              protectionId: link.protection.id,
              circuitId: link.feederCircuit?.id,
            }
          : undefined
      )
    }
  }

  const circuitMap = buildCircuitMap(currentPanel)
  const circuits = collectCircuits(currentPanel)
  for (const assembly of selectProjectSupplyAssemblies(project)) {
    for (const handoff of assembly.loadHandoffs) {
      if (
        handoff.target.kind !== 'circuit-input' ||
        handoff.target.panelId !== currentPanel.id ||
        isSupplyHandoffTargetPresent(handoff, projectPanels, projectInstallation)
      ) {
        continue
      }
      report.supplyAssemblyHandoffTargetMissing.push({
        assemblyId: assembly.id,
        handoffId: handoff.id,
        handoffNodeId: handoff.handoffNodeId,
        missingCircuitId: handoff.target.circuitId,
      })
    }
  }
  const knownFloorIds = new Set(selectProjectBuildingFloorIds(project))

  const describePanelGridModule = (
    ref: NonNullable<Panel['gridView']>['slots'][number]['module']
  ): string => {
    if (ref.kind === 'protection') {
      const protection = currentPanel.protections.find((p) => p.id === ref.id)
      return protection ? validationProtectionLabel(protection.label) : ref.id
    }
    if (ref.kind === 'trunkDevice') {
      if (ref.scope === 'supply') {
        return (
          projectInstallation?.mainSupply?.supplyTrunkDevices?.find((d) => d.id === ref.id)
            ?.label || ref.id
        )
      }
      if (ref.scope === 'ground') {
        return (
          collectAllGroundTrunkDevices(projectPanels, projectInstallation).find(
            (d) => d.id === ref.id
          )?.label || ref.id
        )
      }
      const circuit = ref.circuitId ? findCircuitInProject(project, ref.circuitId) : null
      return circuit?.trunkDevices?.find((d) => d.id === ref.id)?.label || ref.id
    }
    for (const circuit of circuits) {
      const endpoint = circuit.endpoints.find((ep) => ep.id === ref.endpointId)
      if (endpoint) return endpoint.label || endpoint.id
    }
    return ref.endpointId
  }

  const panelGridCandidates = [
    ...(currentPanel.gridView?.slots ?? []).map((slot, index) => ({
      ref: slot.module,
      area: 'main' as const,
      row: slot.row,
      col: slot.col,
      order: index,
    })),
    ...(currentPanel.gridView?.supplyPanelSlots ?? []).map((slot, index) => ({
      ref: slot.module,
      area: 'supply' as const,
      row: slot.row,
      col: slot.col,
      order: (currentPanel.gridView?.slots?.length ?? 0) + index,
    })),
  ]
  const pushPanelGridDuplicate = (
    finding: ReturnType<typeof findPanelGridDuplicateFindings>[number]
  ) => {
    report.panelGridDuplicateModule.push({
      reason: finding.reason,
      summaryLabel: finding.summaryLabel || describePanelGridModule(finding.keep.ref),
      keep: {
        moduleKey: panelGridModuleRefKey(finding.keep.ref),
        moduleRef: finding.keep.ref,
        area: finding.keep.area,
        row: finding.keep.row,
        col: finding.keep.col,
      },
      remove: finding.remove.map((item) => ({
        moduleKey: panelGridModuleRefKey(item.ref),
        moduleRef: item.ref,
        area: item.area,
        row: item.row,
        col: item.col,
      })),
      hideModuleKeys: finding.hideModuleKeys,
    })
  }
  for (const finding of findPanelGridDuplicateFindings(project, panelGridCandidates)) {
    if (isSupplyBusProtectionLabelCollision(finding, project)) continue
    pushPanelGridDuplicate(finding)
  }

  const sharedSupplyKeys =
    currentPanel.isMain && projectInstallation
      ? new Set(
          (
            getPanelFeedProjection(projectInstallation, projectPanels, currentPanel)?.sharedFeed
              .trunkDevices ?? []
          )
            .filter(
              (device) =>
                !isInverterPanelDevice(device) || isSupplyDeviceVisibleInPanel(project, device.id)
            )
            .filter(
              (device) =>
                device.panelMounting?.kind !== 'panel' ||
                device.panelMounting.panelId !== currentPanel.id
            )
            .map((device) =>
              panelGridModuleRefKey({ kind: 'trunkDevice', id: device.id, scope: 'supply' })
            )
        )
      : new Set<string>()

  if (currentPanel.isMain && currentPanel.gridView?.slots) {
    for (const slot of currentPanel.gridView.slots) {
      const m = slot.module
      if (
        m.kind === 'trunkDevice' &&
        m.scope === 'supply' &&
        sharedSupplyKeys.has(panelGridModuleRefKey(m))
      ) {
        report.supplyTrunkMisplacedInMainGrid.push({
          trunkDeviceId: m.id,
          label: describePanelGridModule(m),
          row: slot.row,
          col: slot.col,
        })
      }
    }
  }

  // Supply-device visual placement is project-level, but each panel invokes this detector. Keep
  // one canonical report on the first main/root panel so the same missing module is not repeated
  // once per panel in the orphan inspector.
  const supplyPlacementReportPanelId =
    projectPanels.find((candidate) => candidate.isMain === true)?.id ?? projectPanels[0]?.id
  if (currentPanel.id === supplyPlacementReportPanelId) {
    for (const device of getAllSupplyTrunkDevices(project)) {
      const placementIssue = findSupplyTrunkVisualPlacementMissingReason(project, device)
      if (!placementIssue) continue
      report.supplyTrunkVisualPlacementMissing.push({
        trunkDeviceId: device.id,
        label: device.label || device.id,
        ...placementIssue,
      })
    }
  }

  const pushPlacementIntegrity = (circuit: Circuit, ep: Circuit['endpoints'][number]) => {
    const seenPlacementIds = new Set<string>()
    for (const placement of ep.placements) {
      if (!knownFloorIds.has(placement.floorId)) {
        report.endpointPlacementIntegrity.push({
          circuitId: circuit.id,
          circuitCode: validationCircuitCode(circuit.code),
          endpointId: ep.id,
          endpointLabel: ep.label || ep.id,
          placementId: placement.id,
          violation: 'missingFloor',
          floorId: placement.floorId,
        })
      }
      if (seenPlacementIds.has(placement.id)) {
        report.endpointPlacementIntegrity.push({
          circuitId: circuit.id,
          circuitCode: validationCircuitCode(circuit.code),
          endpointId: ep.id,
          endpointLabel: ep.label || ep.id,
          placementId: placement.id,
          violation: 'duplicatePlacementId',
        })
      } else {
        seenPlacementIds.add(placement.id)
      }
    }
  }

  // 1. Circuit reference integrity
  // A circuit has exactly one protection owner. RCD/RCBO grouping is represented by the
  // anchor circuit's subCircuitIds, not by copying child circuit objects into the RCD list.
  // Duplicate ownership makes the layout render the same protection twice and is a hard error,
  // even when a parent link happens to exist.
  for (const circuit of circuits) {
    const owners = currentPanel.protections.filter((protection) =>
      protection.circuits?.some((candidate) => candidate.id === circuit.id)
    )
    if (owners.length <= 1) continue

    report.protectionReferenceConflict.push({
      circuitId: circuit.id,
      circuitCode: validationCircuitCode(circuit.code),
      protectionIds: owners.map((owner) => owner.id),
      protectionLabels: owners.map((owner) => validationProtectionLabel(owner.label)),
    })
  }

  // 2 & 3. Endpoint/branch consistency per circuit
  for (const circuit of circuits) {
    const endpointCount = circuit.endpoints.filter(
      (endpoint) => endpoint.symbol !== 'panel_distribution'
    ).length
    if (circuit.code !== 'PANEL' && !hasDirectCircuitOwner(currentPanel, circuit.id)) {
      report.circuitMissingProtection.push({
        circuitId: circuit.id,
        circuitCode: validationCircuitCode(circuit.code),
        endpointCount,
      })
    }

    const endpointIds = new Set(circuit.endpoints.map((e) => e.id))
    const endpointById = new Map(circuit.endpoints.map((e) => [e.id, e]))
    const inBranchIds = new Set<string>()

    for (const parent of circuit.endpoints) {
      if (parent.symbol !== 'domotica' || !parent.domoticaProps) continue
      const checkSlots = (ids: string[] | undefined, outputGroup: 'endpoint' | 'control') => {
        for (const [outputIndex, endpointId] of (ids ?? []).entries()) {
          if (!endpointId) continue
          const child = endpointById.get(endpointId)
          if (!child) continue
          const ref = child.domoticaChildProps
          const matches =
            ref?.parentEndpointId === parent.id &&
            ref.outputGroup === outputGroup &&
            ref.outputIndex === outputIndex
          if (matches) continue
          report.domoticaChildLinkMismatch.push({
            circuitId: circuit.id,
            circuitCode: validationCircuitCode(circuit.code),
            parentEndpointId: parent.id,
            parentLabel: parent.label || parent.id,
            endpointId: child.id,
            endpointLabel: child.label || child.id,
            outputGroup,
            outputIndex,
          })
        }
      }
      checkSlots(parent.domoticaProps.endpointChildEndpointIds, 'endpoint')
      checkSlots(parent.domoticaProps.controlChildEndpointIds, 'control')
    }

    if (circuit.branches) {
      for (const branch of circuit.branches) {
        for (const eid of branch.endpointIds) {
          inBranchIds.add(eid)
          if (!endpointIds.has(eid)) {
            report.branchRefsMissingEndpoint.push({
              circuitId: circuit.id,
              circuitCode: validationCircuitCode(circuit.code),
              branchId: branch.id,
              branchLabel: branch.label || branch.id,
              endpointId: eid,
            })
          }
        }
      }
    }

    if (circuit.branches) {
      for (const branch of circuit.branches) {
        const ids = branch.endpointIds
        let idx = 0
        while (idx < ids.length) {
          const ep0 = endpointById.get(ids[idx]!)
          if (!ep0 || !canMergeIntoMultiplierRun(ep0)) {
            idx++
            continue
          }
          const run0 = idx
          idx++
          while (idx < ids.length) {
            const epN = endpointById.get(ids[idx]!)
            if (!epN || !canMergeIntoMultiplierRun(epN)) break
            const epFirst = endpointById.get(ids[run0]!)!
            if (!compatibleMultiplierMerge(epFirst, epN)) break
            idx++
          }
          const runLen = idx - run0
          if (runLen >= 2) {
            const runIds = ids.slice(run0, run0 + runLen)
            const keepId = runIds[0]!
            const keepEp = endpointById.get(keepId)!
            report.branchMultiplierEndpointsSplit.push({
              circuitId: circuit.id,
              circuitCode: validationCircuitCode(circuit.code),
              branchId: branch.id,
              branchLabel: branch.label || branch.id,
              keepEndpointId: keepId,
              keepEndpointLabel: keepEp.label || keepId,
              absorbEndpointIds: runIds.slice(1),
            })
          }
        }
      }
    }

    for (const ep of circuit.endpoints) {
      pushPlacementIntegrity(circuit, ep)
      if (ep.symbol === 'panel_distribution') continue
      if (!endpointSupportsMultiplier(ep)) {
        const floorIds = Array.from(new Set(ep.placements.map((p) => p.floorId)))
        if (ep.placements.length > 1) {
          report.endpointMultipleFloorPlacements.push({
            circuitId: circuit.id,
            circuitCode: validationCircuitCode(circuit.code),
            endpointId: ep.id,
            endpointLabel: ep.label || ep.id,
            placementIds: ep.placements.map((p) => p.id),
            floorIds,
          })
        }
      }
      if (ep.placements.length === 0 && endpointExpectedOnSitplan(ep)) {
        report.endpointMissingPlanPlacement.push({
          circuitId: circuit.id,
          circuitCode: validationCircuitCode(circuit.code),
          endpointId: ep.id,
          endpointLabel: ep.label || ep.id,
          symbol: ep.symbol ?? '',
        })
      }
      if (
        report.domoticaChildLinkMismatch.some(
          (item) => item.circuitId === circuit.id && item.endpointId === ep.id
        )
      ) {
        continue
      }
      if (inBranchIds.has(ep.id)) continue
      report.endpointNotInBranch.push({
        circuitId: circuit.id,
        circuitCode: validationCircuitCode(circuit.code),
        endpointId: ep.id,
        endpointLabel: ep.label || ep.id,
      })
    }
  }

  // PANEL pseudo-circuit endpoints are excluded from collectPanelCircuits(), so run
  // placement consistency checks here as well (this catches panel_distribution duplicates).
  for (const circuit of panel.circuits ?? []) {
    if (circuit.code !== 'PANEL') continue
    for (const ep of circuit.endpoints ?? []) {
      pushPlacementIntegrity(circuit, ep)
      if (!endpointSupportsMultiplier(ep) && ep.placements.length > 1) {
        const floorIds = Array.from(new Set(ep.placements.map((p) => p.floorId)))
        report.endpointMultipleFloorPlacements.push({
          circuitId: circuit.id,
          circuitCode: validationCircuitCode(circuit.code),
          endpointId: ep.id,
          endpointLabel: ep.label || ep.id,
          placementIds: ep.placements.map((p) => p.id),
          floorIds,
        })
      }
      if (
        ep.symbol !== 'panel_distribution' &&
        ep.placements.length === 0 &&
        endpointExpectedOnSitplan(ep)
      ) {
        report.endpointMissingPlanPlacement.push({
          circuitId: circuit.id,
          circuitCode: validationCircuitCode(circuit.code),
          endpointId: ep.id,
          endpointLabel: ep.label || ep.id,
          symbol: ep.symbol ?? '',
        })
      }
      if (ep.symbol === 'panel_distribution') {
        const resolved = resolvePanelForDistributionEndpoint(project, ep)
        if (resolved && ep.label !== resolved.name) {
          report.panelDistributionLabelDrift.push({
            circuitId: circuit.id,
            circuitCode: validationCircuitCode(circuit.code),
            endpointId: ep.id,
            endpointLabel: ep.label || ep.id,
            panelId: resolved.id,
            panelName: resolved.name,
          })
        }
      }
    }
  }

  // Endpoints on PANEL pseudo-circuit are invalid (except the panel symbol itself).
  for (const circuit of panel.circuits ?? []) {
    if (circuit.code !== 'PANEL') continue
    for (const ep of circuit.endpoints ?? []) {
      if (ep.symbol === 'panel_distribution') continue
      report.endpointOnPanelCircuit.push({
        circuitId: circuit.id,
        circuitCode: validationCircuitCode(circuit.code),
        endpointId: ep.id,
        endpointLabel: ep.label || ep.id,
      })
    }
  }

  // 4a. subCircuitIds lists this circuit's own id (invalid — treated like nested sub-circuit of itself; layout/pickers diverge)
  for (const circuit of circuits) {
    if (!circuit.subCircuitIds?.length) continue
    if (circuit.subCircuitIds.includes(circuit.id)) {
      report.subCircuitSelfReference.push({
        circuitId: circuit.id,
        circuitCode: validationCircuitCode(circuit.code),
      })
    }
  }

  // 4b. subCircuitIds reference missing circuit (stale reference after delete/move)
  for (const circuit of circuits) {
    if (!circuit.subCircuitIds?.length) continue
    for (const refId of circuit.subCircuitIds) {
      if (!circuitMap.has(refId)) {
        report.subCircuitIdMissingCircuit.push({
          parentCircuitId: circuit.id,
          parentCircuitCode: validationCircuitCode(circuit.code),
          missingCircuitId: refId,
        })
      }
    }
  }

  // 5. Frame content orphans (frames that belong to this panel)
  const frames = queryOneWireFrames(project).filter((f) => f.panelId === panelId)
  const allEndpointIds = new Set<string>()
  const allProtectionIds = new Set<string>()
  const allTrunkDeviceIds = new Set<string>()
  for (const c of circuits) {
    for (const ep of c.endpoints) {
      allEndpointIds.add(ep.id)
    }
    for (const td of c.trunkDevices ?? []) {
      allTrunkDeviceIds.add(td.id)
    }
  }
  for (const protection of currentPanel.protections) {
    allProtectionIds.add(protection.id)
  }
  // Supply/ground trunk devices belong to main panels. Resolve supply devices through the
  // canonical feed projection so current V2 root-feed devices are included alongside legacy
  // mainSupply devices.
  for (const td of currentPanel.groundTrunkDevices ?? []) {
    allTrunkDeviceIds.add(td.id)
  }
  if (currentPanel.isMain === true) {
    for (const td of projectInstallation
      ? (getPanelFeedProjection(projectInstallation, projectPanels, currentPanel)?.devices ?? [])
      : []) {
      allTrunkDeviceIds.add(td.id)
    }
    for (const td of projectInstallation?.groundTrunkDevices ?? []) {
      allTrunkDeviceIds.add(td.id)
    }
  }

  for (const frame of frames) {
    for (const span of frame.trunkSpans ?? []) {
      if (!findCircuitInProject(project, span.circuitId)) {
        report.frameContentOrphans.push({
          frameId: frame.id,
          frameTitle: frame.title,
          panelId: frame.panelId,
          contentId: span.circuitId,
          contentType: 'circuit',
          reason: 'missing',
        })
      }
    }
    const resolved = resolveFrameContentItems(frame, project)
    for (const { id: contentId, kind } of resolved) {
      if (kind === 'ground') {
        if (contentId !== 'ground') {
          report.frameContentOrphans.push({
            frameId: frame.id,
            frameTitle: frame.title,
            panelId: frame.panelId,
            contentId,
            contentType: 'ground',
            reason: 'missing',
          })
        }
        continue
      }
      if (kind === 'endpoint') {
        if (!allEndpointIds.has(contentId)) {
          report.frameContentOrphans.push({
            frameId: frame.id,
            frameTitle: frame.title,
            panelId: frame.panelId,
            contentId,
            contentType: 'endpoint',
            reason: 'missing',
          })
        }
        continue
      }
      if (kind === 'protection') {
        if (!allProtectionIds.has(contentId)) {
          report.frameContentOrphans.push({
            frameId: frame.id,
            frameTitle: frame.title,
            panelId: frame.panelId,
            contentId,
            contentType: 'protection',
            reason: 'missing',
          })
        }
        continue
      }
      if (kind === 'trunkDevice') {
        if (!allTrunkDeviceIds.has(contentId)) {
          report.frameContentOrphans.push({
            frameId: frame.id,
            frameTitle: frame.title,
            panelId: frame.panelId,
            contentId,
            contentType: 'trunkDevice',
            reason: 'missing',
          })
        }
      }
    }
  }

  return report
}

/**
 * Return a flat list of all detected orphans in the project for the UI (banner, inspector, focus, quarantine).
 */
export function getDetectedOrphans(project: OrphanDetectionProject): DetectedOrphan[] {
  const out: DetectedOrphan[] = []
  const projectPanels = getProjectElectricalPanels(project)
  if (projectPanels.length === 0) return out
  const panelIds = collectPanelIds(projectPanels)
  const seenPanelMissingOneWireIds = new Set<string>()
  for (const panelId of panelIds) {
    const report = detectPanelOrphans(project, panelId)
    for (const item of report.circuitMissingProtection) {
      out.push({
        id: `circuit-missing-protection-${item.circuitId}`,
        kind: 'circuit',
        reason: 'circuitMissingProtection',
        summary: `Circuit "${item.circuitCode}" has no owning protection`,
        panelId,
        focusSelection: { type: 'circuit', ids: [item.circuitId] },
        quarantinePayload: { kind: 'circuit', circuitId: item.circuitId },
        resolutionPayload: {
          kind: 'attachCircuitToProtection',
          panelId,
          circuitId: item.circuitId,
        },
      })
    }
    for (const item of report.circuitRefMismatch) {
      out.push({
        id: `circuit-ref-${item.circuitId}`,
        kind: 'circuit',
        reason: 'circuitRefMismatch',
        summary: `Circuit "${item.circuitCode}" under wrong protection`,
        panelId,
        focusSelection: { type: 'circuit', ids: [item.circuitId] },
        quarantinePayload: {
          kind: 'circuit',
          circuitId: item.circuitId,
          originalParentId: item.listedUnderProtectionId,
          originalRefId: item.parentCircuitId,
        },
      })
    }
    for (const item of report.protectionReferenceConflict) {
      out.push({
        id: `protection-reference-conflict-${item.circuitId}`,
        kind: 'circuit',
        reason: 'protectionReferenceConflict',
        summary: `Circuit "${item.circuitCode}" has conflicting protection references`,
        panelId,
        focusSelection: { type: 'circuit', ids: [item.circuitId] },
      })
    }
    for (const item of report.endpointNotInBranch) {
      out.push({
        id: `endpoint-orphan-${item.endpointId}`,
        kind: 'endpoint',
        reason: 'endpointNotInBranch',
        summary: `Endpoint "${item.endpointLabel}" not on any branch (circuit ${item.circuitCode})`,
        panelId,
        focusSelection: { type: 'endpoint', ids: [item.endpointId] },
        quarantinePayload: {
          kind: 'endpoint',
          circuitId: item.circuitId,
          endpointId: item.endpointId,
        },
        resolutionPayload: {
          kind: 'repairCircuitBranchMembership',
          panelId,
          circuitId: item.circuitId,
        },
      })
    }
    for (const item of report.branchRefsMissingEndpoint) {
      out.push({
        id: `branch-ref-${item.circuitId}-${item.branchId}-${item.endpointId}`,
        kind: 'endpoint',
        reason: 'branchRefsMissingEndpoint',
        summary: `Branch "${item.branchLabel}" references missing endpoint (circuit ${item.circuitCode})`,
        panelId,
        focusSelection: { type: 'circuit', ids: [item.circuitId] },
        // No quarantinePayload: the endpoint is not in the circuit (stale ref); user should remove id from branch or add endpoint
      })
    }
    for (const item of report.frameContentOrphans) {
      const focusType =
        item.contentType === 'protection'
          ? 'protection'
          : item.contentType === 'endpoint'
            ? 'endpoint'
            : item.contentType === 'circuit'
              ? 'circuit'
              : item.contentType === 'trunkDevice'
                ? 'trunkDevice'
                : 'circuit'
      const summaryCircuit =
        item.contentType === 'circuit' ? 'circuit (frame trunk span)' : item.contentType
      out.push({
        id: `frame-${item.frameId}-${item.contentId}`,
        kind: 'frame',
        reason: 'frameContentOrphan',
        summary: `Frame "${item.frameTitle}" references missing ${summaryCircuit}`,
        panelId,
        focusSelection: {
          type: focusType,
          ids: item.contentId === 'ground' ? [] : [item.contentId],
        },
        resolutionPayload: {
          kind: 'pruneFrameContentReference',
          contentId: item.contentId,
          contentType: item.contentType,
        },
      })
    }
    for (const item of report.subCircuitSelfReference) {
      out.push({
        id: `subcircuit-self-${item.circuitId}`,
        kind: 'circuit',
        reason: 'subCircuitSelfReference',
        summary: `Circuit "${item.circuitCode}" lists itself as a sub-circuit (invalid one-line data)`,
        panelId,
        focusSelection: { type: 'circuit', ids: [item.circuitId] },
        resolutionPayload: {
          kind: 'repairSubCircuitSelfReference',
          panelId,
          circuitId: item.circuitId,
        },
      })
    }
    for (const item of report.subCircuitIdMissingCircuit) {
      out.push({
        id: `subcircuit-missing-${item.parentCircuitId}-${item.missingCircuitId}`,
        kind: 'circuit',
        reason: 'subCircuitIdMissingCircuit',
        summary: `Circuit "${item.parentCircuitCode}" references missing sub-circuit (id: ${item.missingCircuitId})`,
        panelId,
        focusSelection: { type: 'circuit', ids: [item.parentCircuitId] },
      })
    }
    for (const item of report.endpointOnPanelCircuit) {
      out.push({
        id: `endpoint-on-panel-${item.endpointId}`,
        kind: 'endpoint',
        reason: 'endpointOnPanelCircuit',
        summary: `Endpoint "${item.endpointLabel}" is attached to PANEL pseudo-circuit`,
        panelId,
        focusSelection: { type: 'endpoint', ids: [item.endpointId] },
        quarantinePayload: {
          kind: 'endpoint',
          circuitId: item.circuitId,
          endpointId: item.endpointId,
        },
      })
    }
    for (const item of report.endpointMultipleFloorPlacements) {
      const keepPlacementId = item.placementIds[0] ?? ''
      const removePlacementIds = item.placementIds.slice(1)
      out.push({
        id: `endpoint-multi-floor-${item.endpointId}`,
        kind: 'endpoint',
        reason: 'endpointMultipleFloorPlacements',
        summary: `Endpoint "${item.endpointLabel}" has placements on multiple floors (${item.floorIds.length})`,
        panelId,
        focusSelection: { type: 'endpoint', ids: [item.endpointId] },
        ...(keepPlacementId && removePlacementIds.length > 0
          ? {
              resolutionPayload: {
                kind: 'dedupeEndpointPlacements' as const,
                endpointId: item.endpointId,
                keepPlacementId,
                removePlacementIds,
              },
            }
          : {}),
      })
    }
    for (const item of report.endpointPlacementIntegrity) {
      const summary =
        item.violation === 'missingFloor'
          ? `Endpoint "${item.endpointLabel}" has placement on missing floor "${item.floorId}"`
          : `Endpoint "${item.endpointLabel}" has duplicate placement id "${item.placementId}"`
      out.push({
        id: `endpoint-placement-integrity-${item.endpointId}-${item.placementId}-${item.violation}`,
        kind: 'endpoint',
        reason: 'endpointPlacementIntegrity',
        summary,
        panelId,
        focusSelection: { type: 'endpoint', ids: [item.endpointId] },
      })
    }
    for (const item of report.planPlacementIdentityConflict) {
      const trunkDeviceIds = [
        ...new Set(
          item.owners.filter((owner) => owner.kind === 'trunkDevice').map((owner) => owner.id)
        ),
      ]
      const endpointIds = [
        ...new Set(
          item.owners.filter((owner) => owner.kind === 'endpoint').map((owner) => owner.id)
        ),
      ]
      const focusSelection =
        trunkDeviceIds.length > 0
          ? { type: 'trunkDevice' as const, ids: trunkDeviceIds }
          : { type: 'endpoint' as const, ids: endpointIds }
      out.push({
        id: `plan-placement-conflict-${item.placementId}`,
        kind: 'circuit',
        reason: 'planPlacementIdentityConflict',
        summary: `Situation-plan placement "${item.placementId}" is shared by ${item.owners.map((owner) => owner.label).join(', ')}`,
        panelId,
        focusSelection,
        resolutionPayload: {
          kind: 'repairSharedPlanPlacementIds',
          placementId: item.placementId,
          owners: item.owners.map(({ kind, id }) => ({ kind, id })),
        },
      })
    }
    for (const item of report.domoticaChildLinkMismatch) {
      out.push({
        id: `domotica-child-link-${item.circuitId}-${item.endpointId}-${item.outputGroup}-${item.outputIndex}`,
        kind: 'endpoint',
        reason: 'domoticaChildLinkMismatch',
        summary: `Domotica output "${item.endpointLabel}" is listed on ${item.parentLabel} output ${item.outputIndex + 1} but is detached from the module`,
        panelId,
        focusSelection: { type: 'endpoint', ids: [item.endpointId] },
        resolutionPayload: {
          kind: 'repairDomoticaChildLink',
          circuitId: item.circuitId,
          endpointId: item.endpointId,
          parentEndpointId: item.parentEndpointId,
          outputGroup: item.outputGroup,
          outputIndex: item.outputIndex,
        },
      })
    }
    for (const item of report.endpointMissingPlanPlacement) {
      const label = item.endpointLabel?.trim() || item.endpointId
      out.push({
        id: `endpoint-no-plan-${item.endpointId}`,
        kind: 'endpoint',
        reason: 'endpointMissingPlanPlacement',
        summary: `${label} (${item.circuitCode}) · not on plan`,
        panelId,
        focusSelection: { type: 'endpoint', ids: [item.endpointId] },
        resolutionPayload: { kind: 'addAutoSitplanPlacement', endpointId: item.endpointId },
      })
    }
    for (const item of report.panelDistributionLabelDrift) {
      out.push({
        id: `panel-label-drift-${item.endpointId}`,
        kind: 'endpoint',
        reason: 'panelDistributionLabelDrift',
        summary: `Panel symbol label "${item.endpointLabel}" ≠ board "${item.panelName}" (out of sync)`,
        panelId,
        focusSelection: { type: 'endpoint', ids: [item.endpointId] },
        resolutionPayload: { kind: 'syncPanelDistributionLabel', endpointId: item.endpointId },
      })
    }
    for (const item of report.panelMissingOneWireSymbol) {
      if (seenPanelMissingOneWireIds.has(item.panelId)) continue
      seenPanelMissingOneWireIds.add(item.panelId)
      out.push({
        id: `panel-missing-onewire-${item.panelId}`,
        kind: 'circuit',
        reason: 'panelMissingOneWireSymbol',
        summary: `Panel "${item.panelName}" exists but has no one-wire feeder panel symbol`,
        panelId,
        focusSelection: { type: 'circuit', ids: [] },
      })
    }
    for (const item of report.branchMultiplierEndpointsSplit) {
      out.push({
        id: `branch-mult-${item.circuitId}-${item.branchId}-${item.keepEndpointId}`,
        kind: 'endpoint',
        reason: 'branchMultiplierEndpointsSplit',
        summary: `Circuit ${item.circuitCode}: ${item.absorbEndpointIds.length + 1} separate "${item.keepEndpointLabel}" symbols on one branch — merge into one endpoint (×${item.absorbEndpointIds.length + 1} placements)`,
        panelId,
        focusSelection: { type: 'endpoint', ids: [item.keepEndpointId] },
        resolutionPayload: {
          kind: 'mergeMultiplierEndpointsOnBranch',
          circuitId: item.circuitId,
          keepEndpointId: item.keepEndpointId,
          absorbEndpointIds: item.absorbEndpointIds,
        },
      })
    }
    for (const item of report.panelGridDuplicateModule) {
      const offenderRef = item.remove[0]?.moduleRef ?? item.keep.moduleRef
      const focusSelection =
        offenderRef.kind === 'protection'
          ? { type: 'protection' as const, ids: [offenderRef.id] }
          : offenderRef.kind === 'trunkDevice'
            ? { type: 'trunkDevice' as const, ids: [offenderRef.id] }
            : { type: 'endpoint' as const, ids: [offenderRef.endpointId] }
      out.push({
        id: `panel-grid-duplicate-${panelId}-${item.keep.moduleKey}-${item.reason}`,
        kind: 'circuit',
        reason: 'panelGridDuplicateModule',
        summary:
          item.reason === 'duplicateVisibleLabel'
            ? `Panel canvas shows "${item.summaryLabel}" more than once; keeping the fuller module`
            : `Panel canvas module "${item.summaryLabel}" is stored ${item.remove.length + 1} times`,
        panelId,
        focusSelection,
        resolutionPayload: {
          kind: 'repairPanelGridDuplicateModules',
          panelId,
          removeSlots: item.remove.map((entry) => ({
            area: entry.area,
            row: entry.row,
            col: entry.col,
            moduleKey: entry.moduleKey,
          })),
          hideModuleKeys: item.hideModuleKeys,
        },
      })
    }
    for (const item of report.supplyTrunkMisplacedInMainGrid) {
      const moduleRef: PanelGridModuleRef = {
        kind: 'trunkDevice',
        id: item.trunkDeviceId,
        scope: 'supply',
      }
      out.push({
        id: `supply-trunk-main-grid-${panelId}-${item.trunkDeviceId}`,
        kind: 'circuit',
        reason: 'supplyTrunkMisplacedInMainGrid',
        summary: `Supply device "${item.label}" is on the main panel grid (row ${item.row}, col ${item.col}) but belongs in the supply strip`,
        panelId,
        focusSelection: { type: 'trunkDevice', ids: [item.trunkDeviceId] },
        resolutionPayload: {
          kind: 'ejectSupplyTrunkToSupplyStrip',
          panelId,
          moduleRef,
        },
      })
    }
    for (const item of report.supplyTrunkVisualPlacementMissing) {
      out.push({
        id: `supply-trunk-visual-placement-${item.trunkDeviceId}`,
        kind: 'circuit',
        reason: 'supplyTrunkVisualPlacementMissing',
        summary: `Supply device "${item.label}" has no reachable panel-canvas placement`,
        panelId,
        focusSelection: { type: 'trunkDevice', ids: [item.trunkDeviceId] },
        ...(item.reason === 'panelMountingSlotMismatch'
          ? {
              resolutionPayload: {
                kind: 'repairSupplyTrunkPanelMountingSlot' as const,
                panelId: item.panelId ?? panelId,
                deviceId: item.trunkDeviceId,
              },
            }
          : {}),
      })
    }
    for (const item of report.splitBusWithoutBackupSupply) {
      out.push({
        id: `split-bus-without-backup-${item.panelId}`,
        kind: 'circuit',
        reason: 'splitBusWithoutBackupSupply',
        summary: `Panel "${item.panelName}" has a split bus but no connected backup supply`,
        panelId: item.panelId,
        focusSelection: { type: 'circuit', ids: [] },
        resolutionPayload: {
          kind: 'collapsePanelFeedToSingleGrid',
          panelId: item.panelId,
        },
      })
    }
  }
  return out
}

function collectPanelIds(panels: Panel[]): string[] {
  const ids: string[] = []
  const visit = (list: Panel[]) => {
    for (const p of list) {
      ids.push(p.id)
      visit(p.subPanels ?? [])
    }
  }
  visit(panels)
  return ids
}

const ORPHAN_LOG_PREFIX = '[Eendraad Orphan]'

/**
 * Run orphan detection for the whole project and log every finding to the console
 * with logger.error so it appears prominently in the browser devtools.
 * Includes "likely cause" / "where it might have come from" hints for debugging.
 * Call this when loading a project or when running validation so you're notified immediately.
 */
export function logOrphanReport(project: OrphanDetectionProject): void {
  const projectPanels = getProjectElectricalPanels(project)
  if (projectPanels.length === 0) return

  const panelIds = collectPanelIds(projectPanels)
  let totalCount = 0

  for (const panelId of panelIds) {
    const report = detectPanelOrphans(project, panelId)
    const count =
      report.circuitMissingProtection.length +
      report.circuitRefMismatch.length +
      report.protectionReferenceConflict.length +
      report.endpointNotInBranch.length +
      report.branchRefsMissingEndpoint.length +
      report.frameContentOrphans.length +
      report.subCircuitSelfReference.length +
      report.subCircuitIdMissingCircuit.length +
      report.endpointOnPanelCircuit.length +
      report.endpointMultipleFloorPlacements.length +
      report.endpointPlacementIntegrity.length +
      report.planPlacementIdentityConflict.length +
      report.domoticaChildLinkMismatch.length +
      report.endpointMissingPlanPlacement.length +
      report.panelDistributionLabelDrift.length +
      report.panelMissingOneWireSymbol.length +
      report.branchMultiplierEndpointsSplit.length +
      report.panelGridDuplicateModule.length +
      report.supplyTrunkMisplacedInMainGrid.length +
      report.supplyTrunkVisualPlacementMissing.length +
      report.splitBusWithoutBackupSupply.length +
      report.supplyAssemblyHandoffTargetMissing.length
    if (count === 0) continue

    totalCount += count

    for (const item of report.circuitMissingProtection) {
      const msg = `${ORPHAN_LOG_PREFIX} Circuit missing protection: circuit "${item.circuitCode}" (id: ${item.circuitId}) has no owning protection (${item.endpointCount} endpoint(s)).`
      logger.error(msg)
      logger.error(
        `${ORPHAN_LOG_PREFIX} Likely cause: circuit has no renderable protective owner — it may exist only in panel.circuits, or be held by a legacy OTHER/directDcBusFeeder carrier. The one-wire layout creates protection nodes from real protection rows, so this circuit will be invisible.`,
        {
          type: 'circuitMissingProtection',
          circuitId: item.circuitId,
          circuitCode: item.circuitCode,
          endpointCount: item.endpointCount,
          panelId,
        }
      )
    }

    for (const item of report.circuitRefMismatch) {
      const msg = `${ORPHAN_LOG_PREFIX} Circuit reference mismatch: circuit "${item.circuitCode}" (id: ${item.circuitId}) is listed under protection "${item.listedUnderProtectionLabel}" but is also a subcircuit of circuit "${item.parentCircuitCode}" (under protection "${item.displayedUnderProtectionLabel}"). It will only appear under "${item.parentCircuitCode}" in the one-line diagram.`
      logger.error(msg)
      logger.error(
        `${ORPHAN_LOG_PREFIX} Likely cause: Same circuit is in two places — under protection "${item.listedUnderProtectionLabel}" (protection.circuits) AND in parent circuit "${item.parentCircuitCode}" (subCircuitIds). Remove it from one: either remove from subCircuitIds of the parent circuit, or remove from the protection's circuits array.`,
        {
          type: 'circuitRefMismatch',
          circuitId: item.circuitId,
          circuitCode: item.circuitCode,
          listedUnderProtectionId: item.listedUnderProtectionId,
          listedUnderProtectionLabel: item.listedUnderProtectionLabel,
          parentCircuitId: item.parentCircuitId,
          parentCircuitCode: item.parentCircuitCode,
          displayedUnderProtectionId: item.displayedUnderProtectionId,
          panelId,
        }
      )
    }

    for (const item of report.protectionReferenceConflict) {
      const protections = item.protectionLabels.join('", "')
      logger.error(
        `${ORPHAN_LOG_PREFIX} Protection reference conflict: circuit "${item.circuitCode}" (id: ${item.circuitId}) is referenced by multiple protections ("${protections}"). RCD/RCBO grouping must use the anchor circuit's subCircuitIds without duplicating the child in the RCD list.`
      )
      logger.error(
        `${ORPHAN_LOG_PREFIX} Likely cause: a multi-select RCD move copied the circuit into both the RCD grouping and its MCB, or a partial undo left competing protection owners. Repair the topology before rendering or exporting.`,
        {
          type: 'protectionReferenceConflict',
          circuitId: item.circuitId,
          circuitCode: item.circuitCode,
          protectionIds: item.protectionIds,
          protectionLabels: item.protectionLabels,
          panelId,
        }
      )
    }

    for (const item of report.endpointNotInBranch) {
      const msg = `${ORPHAN_LOG_PREFIX} Endpoint not on any branch: "${item.endpointLabel}" (id: ${item.endpointId}) is in circuit "${item.circuitCode}" endpoints but not in any branch.endpointIds — it will not appear on the one-line diagram.`
      logger.error(msg)
      logger.error(
        `${ORPHAN_LOG_PREFIX} Likely cause: Endpoint was removed from a branch (or never added). Add it to a branch in circuit "${item.circuitCode}" (circuit.branches[].endpointIds), or remove it from circuit.endpoints if it was intentionally deleted.`,
        {
          type: 'endpointNotInBranch',
          circuitId: item.circuitId,
          circuitCode: item.circuitCode,
          endpointId: item.endpointId,
          endpointLabel: item.endpointLabel,
          panelId,
        }
      )
    }

    for (const item of report.branchRefsMissingEndpoint) {
      const msg = `${ORPHAN_LOG_PREFIX} Branch references missing endpoint: branch "${item.branchLabel}" (id: ${item.branchId}) on circuit "${item.circuitCode}" has endpointId "${item.endpointId}" which is not in circuit.endpoints.`
      logger.error(msg)
      logger.error(
        `${ORPHAN_LOG_PREFIX} Likely cause: Stale reference — the endpoint was removed from the circuit but the branch still references it. Remove "${item.endpointId}" from branch "${item.branchLabel}".endpointIds, or add the endpoint back to the circuit.`,
        {
          type: 'branchRefsMissingEndpoint',
          circuitId: item.circuitId,
          circuitCode: item.circuitCode,
          branchId: item.branchId,
          branchLabel: item.branchLabel,
          endpointId: item.endpointId,
          panelId,
        }
      )
    }

    for (const item of report.frameContentOrphans) {
      const msg = `${ORPHAN_LOG_PREFIX} Frame content orphan: frame "${item.frameTitle}" (id: ${item.frameId}) references ${item.contentType} "${item.contentId}" which is missing or invalid (reason: ${item.reason}).`
      logger.error(msg)
      logger.error(
        `${ORPHAN_LOG_PREFIX} Likely cause: The ${item.contentType} was deleted or moved; frame contentIds were not updated. Edit the frame to remove "${item.contentId}" from contentIds or add a valid ${item.contentType} to the panel.`,
        {
          type: 'frameContentOrphans',
          frameId: item.frameId,
          frameTitle: item.frameTitle,
          contentId: item.contentId,
          contentType: item.contentType,
          reason: item.reason,
          panelId,
        }
      )
    }

    for (const item of report.subCircuitSelfReference) {
      const msg = `${ORPHAN_LOG_PREFIX} Sub-circuit self-reference: circuit "${item.circuitCode}" (id: ${item.circuitId}) includes its own id in subCircuitIds. The one-line layout may hide this circuit while plan drop pickers still list it.`
      logger.error(msg)
      logger.error(
        `${ORPHAN_LOG_PREFIX} Likely cause: corrupt merge or bug wrote this circuit's id into its own subCircuitIds. Remove the circuit id from subCircuitIds (Repair in Orphan Inspector).`,
        {
          type: 'subCircuitSelfReference',
          circuitId: item.circuitId,
          circuitCode: item.circuitCode,
          panelId,
        }
      )
    }

    for (const item of report.subCircuitIdMissingCircuit) {
      const msg = `${ORPHAN_LOG_PREFIX} Sub-circuit reference missing: circuit "${item.parentCircuitCode}" (id: ${item.parentCircuitId}) has subCircuitIds entry "${item.missingCircuitId}" which does not exist in the panel.`
      logger.error(msg)
      logger.error(
        `${ORPHAN_LOG_PREFIX} Likely cause: The sub-circuit was deleted or moved but subCircuitIds was not updated. Remove "${item.missingCircuitId}" from circuit "${item.parentCircuitCode}".subCircuitIds.`,
        {
          type: 'subCircuitIdMissingCircuit',
          parentCircuitId: item.parentCircuitId,
          parentCircuitCode: item.parentCircuitCode,
          missingCircuitId: item.missingCircuitId,
          panelId,
        }
      )
    }

    for (const item of report.endpointOnPanelCircuit) {
      const msg = `${ORPHAN_LOG_PREFIX} Endpoint on PANEL pseudo-circuit: "${item.endpointLabel}" (id: ${item.endpointId}) is attached to circuit "${item.circuitCode}". Endpoints must be on real circuits to render correctly.`
      logger.error(msg)
      logger.error(
        `${ORPHAN_LOG_PREFIX} Likely cause: Endpoint was assigned to the PANEL pseudo-circuit by legacy/bad data. Move it to a real circuit, or quarantine/remove it.`,
        {
          type: 'endpointOnPanelCircuit',
          circuitId: item.circuitId,
          circuitCode: item.circuitCode,
          endpointId: item.endpointId,
          endpointLabel: item.endpointLabel,
          panelId,
        }
      )
    }
    for (const item of report.endpointMultipleFloorPlacements) {
      const msg = `${ORPHAN_LOG_PREFIX} Endpoint placed on multiple floors: "${item.endpointLabel}" (id: ${item.endpointId}) is on floors [${item.floorIds.join(', ')}] but this symbol supports only one placement.`
      logger.error(msg)
      logger.error(
        `${ORPHAN_LOG_PREFIX} Likely cause: A move/sync path appended a new placement instead of moving/replacing the existing placement. Keep exactly one placement for this endpoint.`,
        {
          type: 'endpointMultipleFloorPlacements',
          circuitId: item.circuitId,
          circuitCode: item.circuitCode,
          endpointId: item.endpointId,
          endpointLabel: item.endpointLabel,
          floorIds: item.floorIds,
          panelId,
        }
      )
    }
    for (const item of report.endpointPlacementIntegrity) {
      const msg =
        item.violation === 'missingFloor'
          ? `${ORPHAN_LOG_PREFIX} Endpoint placement references missing floor: "${item.endpointLabel}" (endpoint id: ${item.endpointId}) has placement "${item.placementId}" on floor "${item.floorId}" that does not exist.`
          : `${ORPHAN_LOG_PREFIX} Endpoint has duplicate placement id: "${item.endpointLabel}" (endpoint id: ${item.endpointId}) contains duplicate placement id "${item.placementId}".`
      logger.error(msg)
      logger.error(
        `${ORPHAN_LOG_PREFIX} Likely cause: stale floor references after floor operations or duplicate placement append logic. Ensure each placement references an existing floor and placement ids are unique per endpoint.`,
        {
          type: 'endpointPlacementIntegrity',
          circuitId: item.circuitId,
          circuitCode: item.circuitCode,
          endpointId: item.endpointId,
          endpointLabel: item.endpointLabel,
          placementId: item.placementId,
          violation: item.violation,
          floorId: item.floorId,
          panelId,
        }
      )
    }

    for (const item of report.planPlacementIdentityConflict) {
      logger.error(
        `${ORPHAN_LOG_PREFIX} Situation-plan placement identity conflict: placement "${item.placementId}" is shared by ${item.owners.length} symbols (${item.owners.map((owner) => `${owner.label} [${owner.id}]`).join(', ')}). Selection and labels may jump or disappear.`
      )
      logger.error(
        `${ORPHAN_LOG_PREFIX} Likely cause: a duplicate operation copied a trunk-device or endpoint placement without generating a new placement id. Delete and recreate the affected duplicated symbols, or assign each symbol a unique placement record.`,
        {
          type: 'planPlacementIdentityConflict',
          placementId: item.placementId,
          owners: item.owners,
          panelId,
        }
      )
    }

    for (const item of report.domoticaChildLinkMismatch) {
      const msg = `${ORPHAN_LOG_PREFIX} Domotica child link mismatch: endpoint "${item.endpointLabel}" (${item.endpointId}) is listed on parent "${item.parentLabel}" (${item.parentEndpointId}) ${item.outputGroup} output ${item.outputIndex + 1}, but its domoticaChildProps do not match.`
      logger.error(msg)
      logger.error(
        `${ORPHAN_LOG_PREFIX} Likely cause: a domotica child drag resolved as a generic endpoint move and cleared the child link. Use Repair in the Orphan Inspector to force it back into the domotica output slot.`,
        { type: 'domoticaChildLinkMismatch', ...item, panelId }
      )
    }

    for (const item of report.endpointMissingPlanPlacement) {
      const logLabel = item.endpointLabel?.trim() || item.endpointId
      const msg = `${ORPHAN_LOG_PREFIX} "${logLabel}" (${item.circuitCode}) — no sitplan placement (id: ${item.endpointId}, symbol: ${item.symbol}); invisible on floor plans.`
      logger.error(msg)
      logger.error(
        `${ORPHAN_LOG_PREFIX} Likely cause: one-line drop auto-place was skipped (e.g. chosen floor had no \`layers\` array in project data, or only eendraad-only symbols skip placement). Drop the symbol on the plan to place it, or add a placement in the data. New drops use the active floor and default layer "electrical" when layers are missing.`,
        {
          type: 'endpointMissingPlanPlacement',
          circuitId: item.circuitId,
          circuitCode: item.circuitCode,
          endpointId: item.endpointId,
          endpointLabel: item.endpointLabel,
          symbol: item.symbol,
          panelId,
        }
      )
    }

    for (const item of report.panelDistributionLabelDrift) {
      const msg = `${ORPHAN_LOG_PREFIX} Panel distribution label drift: endpoint "${item.endpointLabel}" (id: ${item.endpointId}) does not match board name "${item.panelName}" (panel id: ${item.panelId}). Plan canvas uses label for some lookups — sync the label to the board name or use Repair in the Orphan Inspector.`
      logger.error(msg)
      logger.error(
        `${ORPHAN_LOG_PREFIX} Likely cause: panel was renamed or locale default label was stored on the endpoint without updating the label field.`,
        {
          type: 'panelDistributionLabelDrift',
          endpointId: item.endpointId,
          panelId: item.panelId,
          panelName: item.panelName,
          circuitId: item.circuitId,
        }
      )
    }

    for (const item of report.panelMissingOneWireSymbol) {
      const msg = `${ORPHAN_LOG_PREFIX} Panel missing one-wire symbol: panel "${item.panelName}" (id: ${item.panelId}) exists but no source-side feeder circuit contains a panel_distribution endpoint for it.`
      logger.error(msg)
      logger.error(
        `${ORPHAN_LOG_PREFIX} Likely cause: panel symbol/feeder link was removed without deleting the panel, or a feeder protection has subPanelId=${item.panelId} but its circuit has no panel_distribution endpoint. Delete the orphan panel or recreate the feeder panel symbol.`,
        {
          type: 'panelMissingOneWireSymbol',
          panelId: item.panelId,
          panelName: item.panelName,
          feederProtectionId: item.feederProtectionId,
          feederCircuitId: item.feederCircuitId,
        }
      )
    }

    for (const item of report.branchMultiplierEndpointsSplit) {
      const msg = `${ORPHAN_LOG_PREFIX} Branch multiplier split: circuit "${item.circuitCode}" branch "${item.branchLabel}" lists separate endpoints (${[item.keepEndpointId, ...item.absorbEndpointIds].join(', ')}) that should be one multiplier endpoint (keep ${item.keepEndpointId}, absorb ${item.absorbEndpointIds.join(', ')}).`
      logger.error(msg)
      logger.error(
        `${ORPHAN_LOG_PREFIX} Likely cause: duplicate/plan flow created a second light (or other multiplier symbol) as a new endpoint on the same branch instead of a second placement. Use Repair in the Orphan Inspector to merge placements into the first endpoint.`,
        { type: 'branchMultiplierEndpointsSplit', ...item, panelId }
      )
    }

    for (const item of report.panelGridDuplicateModule) {
      const duplicates = item.remove.map((entry) => `${entry.area}@${entry.row},${entry.col}`)
      const msg =
        item.reason === 'duplicateVisibleLabel'
          ? `${ORPHAN_LOG_PREFIX} Panel-grid visible duplicate: module "${item.summaryLabel}" appears multiple times in the panel canvas. Keeping ${item.keep.area}@${item.keep.row},${item.keep.col} and suppressing ${duplicates.join(', ')}.`
          : `${ORPHAN_LOG_PREFIX} Panel-grid duplicate ref: module "${item.summaryLabel}" is stored multiple times in panel canvas slots. Keeping ${item.keep.area}@${item.keep.row},${item.keep.col} and removing ${duplicates.join(', ')}.`
      logger.error(msg)
      logger.error(
        `${ORPHAN_LOG_PREFIX} Likely cause: stale panel-grid slot data or a supply device that visually collides with a real protection. Use Repair in the Orphan Inspector to remove the weaker duplicate from the panel canvas.`,
        { type: 'panelGridDuplicateModule', ...item, panelId }
      )
    }

    for (const item of report.supplyTrunkMisplacedInMainGrid) {
      const msg = `${ORPHAN_LOG_PREFIX} Supply trunk misplaced on main panel grid: "${item.label}" (id: ${item.trunkDeviceId}) at main grid row ${item.row}, col ${item.col}. It belongs in the supply strip only.`
      logger.error(msg)
      logger.error(
        `${ORPHAN_LOG_PREFIX} Likely cause: undo/redo or a partial grid update left a supply-scope trunk device in gridView.slots while feed topology still lists it on the supply chain — panel canvas and one-line disagree. Reload/auto-heal moves it to the supply strip, or use Repair in the Orphan Inspector.`,
        { type: 'supplyTrunkMisplacedInMainGrid', ...item, panelId }
      )
    }

    for (const item of report.supplyTrunkVisualPlacementMissing) {
      const msg = `${ORPHAN_LOG_PREFIX} Supply trunk visual placement missing: "${item.label}" (id: ${item.trunkDeviceId}) has no reachable panel-canvas placement (${item.reason}).`
      logger.error(msg)
      logger.error(
        `${ORPHAN_LOG_PREFIX} Likely cause: a supply device was moved to a panel/virtual enclosure but its panel-canvas placement was not carried along, or the target panel cannot render supply modules. A manually hidden module is excluded from this check.`,
        { type: 'supplyTrunkVisualPlacementMissing', ...item, panelId }
      )
    }

    for (const item of report.splitBusWithoutBackupSupply) {
      logger.error(
        `${ORPHAN_LOG_PREFIX} Split bus without backup supply: panel "${item.panelName}" (id: ${item.panelId}) retains ${item.busSectionCount} bus sections but no connected backup path.`
      )
      logger.error(
        `${ORPHAN_LOG_PREFIX} Likely cause: the supply assembly was removed or disconnected without collapsing its panel bus sections. Use Repair in the Orphan Inspector to restore one grid-fed bus.`,
        { type: 'splitBusWithoutBackupSupply', ...item }
      )
    }

    for (const item of report.supplyAssemblyHandoffTargetMissing) {
      logger.error(
        `${ORPHAN_LOG_PREFIX} Supply handoff references missing circuit "${item.missingCircuitId}" (handoff ${item.handoffId}, assembly ${item.assemblyId}).`,
        { type: 'supplyAssemblyHandoffTargetMissing', ...item, panelId }
      )
    }
  }

  if (totalCount > 0) {
    logger.error(
      `${ORPHAN_LOG_PREFIX} Total: ${totalCount} orphan(s) detected. These should never happen — fix the data or report the bug. Filter console by "${ORPHAN_LOG_PREFIX}" to see all.`
    )
  }
}

/**
 * Convert an OrphanReport into validation Issues (for use by the primitive).
 */
export function orphanReportToIssues(
  report: OrphanReport,
  panelId: string,
  ruleId: string,
  jurisdiction: string,
  rulesetVersion: string,
  msg: {
    circuitMissingProtection: (opts: Record<string, string>) => string
    circuitRefMismatch: (opts: Record<string, string>) => string
    protectionReferenceConflict: (opts: Record<string, string>) => string
    endpointNotInBranch: (opts: Record<string, string>) => string
    branchRefsMissingEndpoint: (opts: Record<string, string>) => string
    frameContentOrphans: (opts: Record<string, string>) => string
    subCircuitSelfReference: (opts: Record<string, string>) => string
    subCircuitIdMissingCircuit: (opts: Record<string, string>) => string
    endpointOnPanelCircuit: (opts: Record<string, string>) => string
    endpointMultipleFloorPlacements: (opts: Record<string, string>) => string
    endpointPlacementIntegrity: (opts: Record<string, string>) => string
    planPlacementIdentityConflict: (opts: Record<string, string>) => string
    domoticaChildLinkMismatch?: (opts: Record<string, string>) => string
    endpointMissingPlanPlacement: (opts: Record<string, string>) => string
    panelDistributionLabelDrift: (opts: Record<string, string>) => string
    panelMissingOneWireSymbol: (opts: Record<string, string>) => string
    panelGridDuplicateModule: (opts: Record<string, string>) => string
    supplyTrunkMisplacedInMainGrid: (opts: Record<string, string>) => string
    supplyTrunkVisualPlacementMissing: (opts: Record<string, string>) => string
    splitBusWithoutBackupSupply: (opts: Record<string, string>) => string
    supplyAssemblyHandoffTargetMissing: (opts: Record<string, string>) => string
  }
): Issue[] {
  const issues: Issue[] = []

  for (const item of report.circuitMissingProtection) {
    issues.push({
      id: `${ruleId}:board:${panelId}:circuit-missing-protection:${item.circuitId}`,
      ruleId,
      severity: 'error',
      jurisdiction,
      rulesetVersion,
      scope: { type: 'board', id: panelId },
      offenders: [{ kind: 'circuit', id: item.circuitId, viewHint: 'eendraad' }],
      message: msg.circuitMissingProtection({
        circuitCode: item.circuitCode,
        endpointCount: String(item.endpointCount),
      }),
      details: undefined,
      citations: [],
      tags: ['orphan', 'eendraad', 'consistency'],
    })
  }
  for (const item of report.circuitRefMismatch) {
    issues.push({
      id: `${ruleId}:board:${panelId}:circuit-ref:${item.circuitId}`,
      ruleId,
      severity: 'error',
      jurisdiction,
      rulesetVersion,
      scope: { type: 'board', id: panelId },
      offenders: [
        { kind: 'circuit', id: item.circuitId, viewHint: 'eendraad' },
        { kind: 'protection', id: item.listedUnderProtectionId, viewHint: 'eendraad' },
      ],
      message: msg.circuitRefMismatch({
        circuitCode: item.circuitCode,
        listedUnderLabel: item.listedUnderProtectionLabel,
        parentCircuitCode: item.parentCircuitCode,
        displayedUnderLabel: item.displayedUnderProtectionLabel,
      }),
      details: undefined,
      citations: [],
      tags: ['orphan', 'eendraad', 'consistency'],
    })
  }

  for (const item of report.protectionReferenceConflict) {
    issues.push({
      id: `${ruleId}:board:${panelId}:protection-reference-conflict:${item.circuitId}`,
      ruleId,
      severity: 'error',
      jurisdiction,
      rulesetVersion,
      scope: { type: 'board', id: panelId },
      offenders: [
        { kind: 'circuit', id: item.circuitId, viewHint: 'eendraad' },
        ...item.protectionIds.map((id) => ({
          kind: 'protection' as const,
          id,
          viewHint: 'eendraad' as const,
        })),
      ],
      message: msg.protectionReferenceConflict({
        circuitCode: item.circuitCode,
        protectionLabels: item.protectionLabels.join('", "'),
      }),
      details: undefined,
      citations: [],
      tags: ['orphan', 'eendraad', 'topology', 'consistency'],
    })
  }

  for (const item of report.endpointNotInBranch) {
    issues.push({
      id: `${ruleId}:board:${panelId}:endpoint-orphan:${item.endpointId}`,
      ruleId,
      severity: 'error',
      jurisdiction,
      rulesetVersion,
      scope: { type: 'board', id: panelId },
      offenders: [
        { kind: 'circuit', id: item.circuitId, viewHint: 'eendraad' },
        { kind: 'endpoint', id: item.endpointId, viewHint: 'eendraad' },
      ],
      message: msg.endpointNotInBranch({
        endpointLabel: item.endpointLabel,
        circuitCode: item.circuitCode,
      }),
      details: undefined,
      citations: [],
      tags: ['orphan', 'eendraad', 'consistency'],
    })
  }

  for (const item of report.branchRefsMissingEndpoint) {
    issues.push({
      id: `${ruleId}:board:${panelId}:branch-orphan:${item.circuitId}:${item.branchId}:${item.endpointId}`,
      ruleId,
      severity: 'error',
      jurisdiction,
      rulesetVersion,
      scope: { type: 'board', id: panelId },
      offenders: [
        { kind: 'circuit', id: item.circuitId, viewHint: 'eendraad' },
        { kind: 'endpoint', id: item.endpointId, viewHint: 'eendraad' },
      ],
      message: msg.branchRefsMissingEndpoint({
        circuitCode: item.circuitCode,
        branchLabel: item.branchLabel,
        endpointId: item.endpointId,
      }),
      details: undefined,
      citations: [],
      tags: ['orphan', 'eendraad', 'consistency'],
    })
  }

  for (const item of report.frameContentOrphans) {
    const offenderKind: Offender['kind'] =
      item.contentType === 'protection'
        ? 'protection'
        : item.contentType === 'endpoint'
          ? 'endpoint'
          : 'device'
    issues.push({
      id: `${ruleId}:board:${panelId}:frame-orphan:${item.frameId}:${item.contentId}`,
      ruleId,
      severity: 'warning',
      jurisdiction,
      rulesetVersion,
      scope: { type: 'board', id: panelId },
      offenders: [{ kind: offenderKind, id: item.contentId, viewHint: 'eendraad' }],
      message: msg.frameContentOrphans({
        frameTitle: item.frameTitle,
        contentId: item.contentId,
        reason: item.reason,
      }),
      details: undefined,
      citations: [],
      tags: ['orphan', 'eendraad', 'frame'],
    })
  }

  for (const item of report.supplyAssemblyHandoffTargetMissing) {
    issues.push({
      id: `${ruleId}:board:${panelId}:supply-handoff-target-missing:${item.handoffId}`,
      ruleId,
      severity: 'warning',
      jurisdiction,
      rulesetVersion,
      scope: { type: 'board', id: panelId },
      offenders: [{ kind: 'device', id: item.handoffNodeId, viewHint: 'eendraad' }],
      message: msg.supplyAssemblyHandoffTargetMissing({
        missingCircuitId: item.missingCircuitId,
      }),
      details: undefined,
      citations: [],
      tags: ['orphan', 'eendraad', 'supply'],
    })
  }

  for (const item of report.subCircuitSelfReference) {
    issues.push({
      id: `${ruleId}:board:${panelId}:subcircuit-self:${item.circuitId}`,
      ruleId,
      severity: 'error',
      jurisdiction,
      rulesetVersion,
      scope: { type: 'board', id: panelId },
      offenders: [{ kind: 'circuit', id: item.circuitId, viewHint: 'eendraad' }],
      message: msg.subCircuitSelfReference({
        circuitCode: item.circuitCode,
      }),
      details: undefined,
      citations: [],
      tags: ['orphan', 'eendraad', 'consistency'],
    })
  }

  for (const item of report.subCircuitIdMissingCircuit) {
    issues.push({
      id: `${ruleId}:board:${panelId}:subcircuit-missing:${item.parentCircuitId}:${item.missingCircuitId}`,
      ruleId,
      severity: 'error',
      jurisdiction,
      rulesetVersion,
      scope: { type: 'board', id: panelId },
      offenders: [{ kind: 'circuit', id: item.parentCircuitId, viewHint: 'eendraad' }],
      message: msg.subCircuitIdMissingCircuit({
        parentCircuitCode: item.parentCircuitCode,
        missingCircuitId: item.missingCircuitId,
      }),
      details: undefined,
      citations: [],
      tags: ['orphan', 'eendraad', 'consistency'],
    })
  }

  for (const item of report.endpointOnPanelCircuit) {
    issues.push({
      id: `${ruleId}:board:${panelId}:endpoint-on-panel:${item.endpointId}`,
      ruleId,
      severity: 'error',
      jurisdiction,
      rulesetVersion,
      scope: { type: 'board', id: panelId },
      offenders: [
        { kind: 'circuit', id: item.circuitId, viewHint: 'eendraad' },
        { kind: 'endpoint', id: item.endpointId, viewHint: 'eendraad' },
      ],
      message: msg.endpointOnPanelCircuit({
        endpointLabel: item.endpointLabel,
      }),
      details: undefined,
      citations: [],
      tags: ['orphan', 'eendraad', 'consistency'],
    })
  }
  for (const item of report.endpointMultipleFloorPlacements) {
    issues.push({
      id: `${ruleId}:board:${panelId}:endpoint-multi-floor:${item.endpointId}`,
      ruleId,
      severity: 'error',
      jurisdiction,
      rulesetVersion,
      scope: { type: 'board', id: panelId },
      offenders: [
        { kind: 'circuit', id: item.circuitId, viewHint: 'eendraad' },
        { kind: 'endpoint', id: item.endpointId, viewHint: 'eendraad' },
      ],
      message: msg.endpointMultipleFloorPlacements({
        endpointLabel: item.endpointLabel,
        floorCount: String(item.floorIds.length),
      }),
      details: undefined,
      citations: [],
      tags: ['orphan', 'eendraad', 'consistency'],
    })
  }
  for (const item of report.endpointPlacementIntegrity) {
    issues.push({
      id: `${ruleId}:board:${panelId}:endpoint-placement-integrity:${item.endpointId}:${item.placementId}:${item.violation}`,
      ruleId,
      severity: 'error',
      jurisdiction,
      rulesetVersion,
      scope: { type: 'board', id: panelId },
      offenders: [
        { kind: 'circuit', id: item.circuitId, viewHint: 'eendraad' },
        { kind: 'endpoint', id: item.endpointId, viewHint: 'eendraad' },
      ],
      message: msg.endpointPlacementIntegrity({
        endpointLabel: item.endpointLabel,
        placementId: item.placementId,
        floorId: item.floorId ?? '',
        violation: item.violation,
      }),
      details: undefined,
      citations: [],
      tags: ['orphan', 'eendraad', 'consistency'],
    })
  }

  for (const item of report.planPlacementIdentityConflict) {
    issues.push({
      id: `${ruleId}:board:${panelId}:plan-placement-conflict:${item.placementId}`,
      ruleId,
      severity: 'error',
      jurisdiction,
      rulesetVersion,
      scope: { type: 'board', id: panelId },
      offenders: item.owners.map((owner) => ({
        kind: owner.kind === 'trunkDevice' ? 'device' : 'endpoint',
        id: owner.id,
        viewHint: 'both',
      })),
      message: msg.planPlacementIdentityConflict({
        placementId: item.placementId,
        ownerLabels: item.owners.map((owner) => owner.label).join(', '),
      }),
      details: undefined,
      citations: [],
      tags: ['orphan', 'sitplan', 'consistency'],
    })
  }

  for (const item of report.domoticaChildLinkMismatch) {
    issues.push({
      id: `${ruleId}:board:${panelId}:domotica-child-link:${item.circuitId}:${item.endpointId}:${item.outputGroup}:${item.outputIndex}`,
      ruleId,
      severity: 'error',
      jurisdiction,
      rulesetVersion,
      scope: { type: 'board', id: panelId },
      offenders: [
        { kind: 'circuit', id: item.circuitId, viewHint: 'eendraad' },
        { kind: 'endpoint', id: item.endpointId, viewHint: 'eendraad' },
      ],
      message: (
        msg.domoticaChildLinkMismatch ??
        ((opts) =>
          `Domotica output "${opts.endpointLabel}" is listed on "${opts.parentLabel}" output ${opts.outputNumber}, but it is detached from the module.`)
      )({
        endpointLabel: item.endpointLabel,
        parentLabel: item.parentLabel,
        outputNumber: String(item.outputIndex + 1),
        circuitCode: item.circuitCode,
      }),
      details: undefined,
      citations: [],
      tags: ['orphan', 'eendraad', 'domotica', 'consistency'],
    })
  }

  for (const item of report.endpointMissingPlanPlacement) {
    issues.push({
      id: `${ruleId}:board:${panelId}:endpoint-no-plan:${item.endpointId}`,
      ruleId,
      severity: 'warning',
      jurisdiction,
      rulesetVersion,
      scope: { type: 'board', id: panelId },
      offenders: [
        { kind: 'circuit', id: item.circuitId, viewHint: 'both' },
        { kind: 'endpoint', id: item.endpointId, viewHint: 'both' },
      ],
      message: msg.endpointMissingPlanPlacement({
        endpointLabel: item.endpointLabel,
        circuitCode: item.circuitCode,
      }),
      details: undefined,
      citations: [],
      tags: ['orphan', 'sitplan', 'consistency'],
    })
  }

  for (const item of report.panelDistributionLabelDrift) {
    issues.push({
      id: `${ruleId}:board:${panelId}:panel-label-drift:${item.endpointId}`,
      ruleId,
      severity: 'warning',
      jurisdiction,
      rulesetVersion,
      scope: { type: 'board', id: panelId },
      offenders: [
        { kind: 'circuit', id: item.circuitId, viewHint: 'both' },
        { kind: 'endpoint', id: item.endpointId, viewHint: 'both' },
      ],
      message: msg.panelDistributionLabelDrift({
        endpointLabel: item.endpointLabel,
        panelName: item.panelName,
        circuitCode: item.circuitCode,
      }),
      details: undefined,
      citations: [],
      tags: ['orphan', 'sitplan', 'consistency'],
    })
  }

  for (const item of report.panelMissingOneWireSymbol) {
    issues.push({
      id: `${ruleId}:board:${panelId}:panel-missing-onewire:${item.panelId}`,
      ruleId,
      severity: 'error',
      jurisdiction,
      rulesetVersion,
      scope: { type: 'board', id: panelId },
      offenders: [],
      message: msg.panelMissingOneWireSymbol({
        panelName: item.panelName,
      }),
      details: undefined,
      citations: [],
      tags: ['orphan', 'eendraad', 'consistency'],
    })
  }

  for (const item of report.branchMultiplierEndpointsSplit) {
    issues.push({
      id: `${ruleId}:board:${panelId}:branch-mult:${item.circuitId}-${item.branchId}-${item.keepEndpointId}`,
      ruleId,
      severity: 'error',
      jurisdiction,
      rulesetVersion,
      scope: { type: 'board', id: panelId },
      offenders: [
        { kind: 'circuit', id: item.circuitId, viewHint: 'both' },
        { kind: 'endpoint', id: item.keepEndpointId, viewHint: 'both' },
      ],
      message: i18next.t('validation.orphanDetection.branchMultiplierEndpointsSplit', {
        circuitCode: item.circuitCode,
        branchLabel: item.branchLabel,
        keepEndpointLabel: item.keepEndpointLabel,
        absorbCount: String(item.absorbEndpointIds.length),
        defaultValue: `Circuit {{circuitCode}}: branch "{{branchLabel}}" has {{absorbCount}} extra multiplier symbol(s) as separate endpoints; merge via Orphan Inspector (keep "{{keepEndpointLabel}}").`,
      }),
      details: undefined,
      citations: [],
      tags: ['orphan', 'eendraad', 'sitplan', 'consistency'],
    })
  }

  for (const item of report.panelGridDuplicateModule) {
    const offenderRef = item.remove[0]?.moduleRef ?? item.keep.moduleRef
    const offenderKind: Offender['kind'] =
      offenderRef.kind === 'protection'
        ? 'protection'
        : offenderRef.kind === 'domotica'
          ? 'endpoint'
          : 'device'
    issues.push({
      id: `${ruleId}:board:${panelId}:panel-grid-duplicate:${item.keep.moduleKey}:${item.reason}`,
      ruleId,
      severity: 'warning',
      jurisdiction,
      rulesetVersion,
      scope: { type: 'board', id: panelId },
      offenders: [
        {
          kind: offenderKind,
          id: offenderRef.kind === 'domotica' ? offenderRef.endpointId : offenderRef.id,
          viewHint: 'eendraad',
        },
      ],
      message: msg.panelGridDuplicateModule({
        moduleLabel: item.summaryLabel,
        duplicateCount: String(item.remove.length),
        mode: item.reason,
      }),
      details: undefined,
      citations: [],
      tags: ['orphan', 'panel-grid', 'consistency'],
    })
  }

  for (const item of report.supplyTrunkMisplacedInMainGrid) {
    issues.push({
      id: `${ruleId}:board:${panelId}:supply-trunk-main-grid:${item.trunkDeviceId}`,
      ruleId,
      severity: 'warning',
      jurisdiction,
      rulesetVersion,
      scope: { type: 'board', id: panelId },
      offenders: [{ kind: 'device', id: item.trunkDeviceId, viewHint: 'both' }],
      message: msg.supplyTrunkMisplacedInMainGrid({
        label: item.label,
        row: String(item.row),
        col: String(item.col),
      }),
      details: undefined,
      citations: [],
      tags: ['orphan', 'panel-grid', 'consistency'],
    })
  }

  for (const item of report.supplyTrunkVisualPlacementMissing) {
    issues.push({
      id: `${ruleId}:board:${panelId}:supply-trunk-visual-placement:${item.trunkDeviceId}`,
      ruleId,
      severity: 'warning',
      jurisdiction,
      rulesetVersion,
      scope: { type: 'board', id: panelId },
      offenders: [{ kind: 'device', id: item.trunkDeviceId, viewHint: 'both' }],
      message: msg.supplyTrunkVisualPlacementMissing({ label: item.label }),
      details: undefined,
      citations: [],
      tags: ['orphan', 'panel-grid', 'supply', 'consistency'],
    })
  }

  for (const item of report.splitBusWithoutBackupSupply) {
    issues.push({
      id: `${ruleId}:board:${panelId}:split-bus-without-backup`,
      ruleId,
      severity: 'error',
      jurisdiction,
      rulesetVersion,
      scope: { type: 'board', id: panelId },
      offenders: [],
      message: msg.splitBusWithoutBackupSupply({
        panelName: item.panelName,
        busSectionCount: String(item.busSectionCount),
      }),
      details: undefined,
      citations: [],
      tags: ['orphan', 'eendraad', 'supply', 'consistency'],
    })
  }

  return issues
}
