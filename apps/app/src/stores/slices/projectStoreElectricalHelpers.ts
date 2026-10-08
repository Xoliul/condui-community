import { normalizeInstallationNominalVoltage } from '@/constants/nominalVoltage'
import {
  ensureLinkedSubPanelsHaveOwnPanelEndpoint,
  healPromotedIncomingProtectionGridRefs,
  normalizeDomoticaProject,
  normalizeFloorPlanAssets,
  removePanelGridDuplicateRefsInProject,
  removePromotedIncomingProtectionsFromSubPanels,
  pruneStalePanelGridProtectionReferencesInProject,
} from '@/lib/eendraad/projectElectricalDomain'
import { dedupeAllPanelsProtectionsInProject } from '@/lib/eendraad/mainBusOrder'
import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import {
  healPanelMountedSupplyTrunkSlots,
  healSupplyTrunkMisplacedOnMainGrid,
} from '@/lib/panel/healSupplyTrunkGrid'
import { reconcileInvalidPanelFeedOrganizationsInProject } from '@/lib/panel/panelFeedOrganization'
import { healEarthingSitplanPlacements } from '@/lib/plan/earthingSitplanPlacement'
import { healEnergyConversionSitplanPlacements } from '@/lib/plan/energyConversionSitplanPlacement'
import { healJunctionBoxSitplanPlacements } from '@/lib/plan/junctionBoxSitplanPlacement'
import { healProjectFloorsElectricalLayers } from '@/lib/plan/floorLayers'
import { healPlanWiring } from '@/lib/plan/planWiring'
import { syncPanelAndSituationPlanDeviceVisibility } from '@/lib/plan/panelPlanPlacementVisibility'
import { healSharedPlanScale } from '@/lib/projectV2/buildingFloors'
import {
  selectProjectElectricalInstallation,
  selectProjectElectricalPanels,
  editProjectSupplyAssemblies,
} from '@/lib/projectV2/electrical'
import { projectToStoredProjectV2 } from '@/lib/projectV2/migration'
import { hasLegacyV2ProjectBloat } from '@/lib/projectV2/sanitizeLegacyV2Project'
import { logOrphanReport } from '@/lib/validation/orphanDetection'
import { healSupplyTrunkProtectionBreakingCapacity } from '@/lib/protectionDefaults'
import { recordSessionAction } from '@/lib/diagnostics/sessionActionLog'
import {
  healSourceChangeoverFeedScope,
  healMissingChangeoverBackupBranch,
  initializeDirectConverterPanelBranches,
  repairCrossOutputSupplyConverterDcConnections,
  reconcileDirectConverterCommonLoadPath,
} from '@/lib/supplyAssembly/editorIntegration'
import { shortProjectIdLabel } from '@/utils/project'
import { logger } from '@/lib/logger'
import { summarizeConverterDcPersistence } from '@/lib/supplyAssembly/persistenceDiagnostics'
import { migrateLegacyWireRunEdgeAnchors } from '@/lib/wires/migrateWireRunAnchors'
import { ensureProjectConductorIds } from '@/lib/wires/conductorIdentity'
import { syncJunctionAssetsForEdition } from '@/lib/junction/junctionHostedHooks'
import { joinSecondaryFeederRuns } from '@/lib/wires/secondaryFeederRuns'
import { materializeLegacyDcRailConnections } from '@/lib/wires/circuitWireIdentity'
import {
  collectSupplyDeviceReferenceIssues,
  linkSupplyAssemblyDeviceReferences,
} from '@/lib/supplyAssembly/deviceReferences'
import { healSupplyBranchPanelInputFlags } from '@/lib/supplyAssembly/electricalTopology'
import { repairDanglingSupplyAssemblyReferences } from '@/lib/supplyAssembly/repairDanglingReferences'
import { type Project, type ProjectInput, type ProjectState } from './projectStoreTypes'
import { findPanelById, findPanelByName } from '@/lib/panel/panelTree'

export { findPanelById, findPanelByName }

export function hydrateProjectForEditor(project: ProjectInput): {
  project: Project
  isDirty: boolean
} {
  const sanitizedLegacyV2Bloat = hasLegacyV2ProjectBloat(project)
  const runtimeProject = projectToStoredProjectV2(project) as Project
  const healedSharedPlanScale = healSharedPlanScale(runtimeProject)
  const installation = selectProjectElectricalInstallation(runtimeProject)
  const panels = selectProjectElectricalPanels(runtimeProject)
  const repairedDanglingSupplyHandoffs = repairDanglingSupplyAssemblyReferences(runtimeProject)
  if (installation) {
    ensureInstallationFeedTopology(installation, panels)
  }
  const healedSupplyBranchPanelInputs = healSupplyBranchPanelInputFlags(runtimeProject)
  const healedSourceChangeoverFeedScope = healSourceChangeoverFeedScope(runtimeProject)
  const linkedSupplyAssemblyDeviceReferences = linkSupplyAssemblyDeviceReferences(runtimeProject)
  const healedMissingBackupBranch = healMissingChangeoverBackupBranch(runtimeProject)
  const initializedDirectBranches = editProjectSupplyAssemblies(runtimeProject).reduce(
    (changed, assembly) =>
      initializeDirectConverterPanelBranches(runtimeProject, assembly) || changed,
    false
  )
  const reconciledPanelFeedOrganizations =
    reconcileInvalidPanelFeedOrganizationsInProject(runtimeProject)
  const normalizedNominalVoltage = installation
    ? normalizeInstallationNominalVoltage(installation)
    : false
  const healedSupplyProtectionBreakingCapacity =
    healSupplyTrunkProtectionBreakingCapacity(runtimeProject)
  const reconciledDirectSupplyOutputs = panels.reduce(
    (changed, panel) => reconcileDirectConverterCommonLoadPath(runtimeProject, panel.id) || changed,
    initializedDirectBranches
  )
  const repairedCrossOutputDcConnections =
    repairCrossOutputSupplyConverterDcConnections(runtimeProject)
  const healedPanelMountedSupplySlots = healPanelMountedSupplyTrunkSlots(runtimeProject)
  const healedSupplyGrid = healSupplyTrunkMisplacedOnMainGrid(runtimeProject)
  const dedupedProtections = dedupeAllPanelsProtectionsInProject(runtimeProject)
  const removedPromotedIncomingProtections =
    removePromotedIncomingProtectionsFromSubPanels(runtimeProject)
  const healedPromotedIncomingGridRefs = healPromotedIncomingProtectionGridRefs(runtimeProject)
  const healedLinkedSubPanelSymbols = ensureLinkedSubPanelsHaveOwnPanelEndpoint(runtimeProject)
  const removedDuplicatePanelGridRefs = removePanelGridDuplicateRefsInProject(runtimeProject)
  const prunedStalePanelGridProtectionRefs =
    pruneStalePanelGridProtectionReferencesInProject(runtimeProject)
  normalizeDomoticaProject(runtimeProject)
  normalizeFloorPlanAssets(runtimeProject)
  healProjectFloorsElectricalLayers(runtimeProject)
  const healedEarthingSitplan = healEarthingSitplanPlacements(runtimeProject)
  // Repair impossible legacy state before the conversion-placement healer makes
  // unclaimed conversion devices visible on the situation plan.
  const synchronizedPanelPlanVisibilityBeforePlacementHealing =
    syncPanelAndSituationPlanDeviceVisibility(runtimeProject)
  const healedEnergyConversionSitplan = healEnergyConversionSitplanPlacements(runtimeProject)
  const healedJunctionBoxSitplan = healJunctionBoxSitplanPlacements(runtimeProject)
  const synchronizedPanelPlanVisibility = syncPanelAndSituationPlanDeviceVisibility(runtimeProject)
  const healedPlanWiring = healPlanWiring(runtimeProject)
  const materializedDcRailConnections = materializeLegacyDcRailConnections(panels)
  const migratedWireRunAnchors = migrateLegacyWireRunEdgeAnchors(runtimeProject)
  // A secondary board's feeder edited on one board before this was joined: join its two ends.
  const joinedSecondaryFeederRuns = joinSecondaryFeederRuns(runtimeProject)
  // Cores written before core identity (or by an older client) get deterministic ids. Not a
  // reason to save: the same ids are assigned on every load and written with the next save.
  ensureProjectConductorIds(runtimeProject)
  // Junction assets are derived deterministically from the occurrences, so linking them is not a
  // reason to save either.
  syncJunctionAssetsForEdition(runtimeProject)
  recordSessionAction(
    `Opened project in editor (${shortProjectIdLabel(runtimeProject.project.id)})`
  )
  logOrphanReport(runtimeProject)
  const dcPersistenceSummary = summarizeConverterDcPersistence(runtimeProject)
  if (dcPersistenceSummary) {
    logger.debug('[SUPPLY-PERSIST] hydrated converter DC topology', dcPersistenceSummary)
  }
  const supplyDeviceReferenceIssues = collectSupplyDeviceReferenceIssues(runtimeProject)
  if (supplyDeviceReferenceIssues.length > 0) {
    logger.warn('[SUPPLY-PERSIST] supply device reference issues', supplyDeviceReferenceIssues)
  }

  return {
    project: runtimeProject,
    isDirty:
      sanitizedLegacyV2Bloat ||
      repairedDanglingSupplyHandoffs.repairedHandoffCount > 0 ||
      healedSourceChangeoverFeedScope ||
      healedSupplyBranchPanelInputs ||
      healedMissingBackupBranch ||
      linkedSupplyAssemblyDeviceReferences ||
      reconciledDirectSupplyOutputs ||
      repairedCrossOutputDcConnections ||
      healedPanelMountedSupplySlots ||
      reconciledPanelFeedOrganizations ||
      normalizedNominalVoltage ||
      healedSupplyProtectionBreakingCapacity ||
      healedSupplyGrid ||
      dedupedProtections ||
      removedPromotedIncomingProtections ||
      healedPromotedIncomingGridRefs ||
      healedLinkedSubPanelSymbols ||
      removedDuplicatePanelGridRefs ||
      prunedStalePanelGridProtectionRefs ||
      healedSharedPlanScale ||
      healedEarthingSitplan ||
      synchronizedPanelPlanVisibilityBeforePlacementHealing ||
      healedEnergyConversionSitplan ||
      healedJunctionBoxSitplan ||
      synchronizedPanelPlanVisibility ||
      healedPlanWiring ||
      materializedDcRailConnections ||
      migratedWireRunAnchors ||
      joinedSecondaryFeederRuns,
  }
}

export function resetDisciplineSessionState(state: ProjectState): void {
  state.lastWorkedCircuitId = null
}

export function applyProjectMetadataUpdate(
  project: Project,
  updates: Partial<Project['project']>
): void {
  Object.assign(project.project, updates)
}

export function prepareProjectForPersistence(project: Project): void {
  const installation = selectProjectElectricalInstallation(project)
  if (installation) {
    ensureInstallationFeedTopology(installation, selectProjectElectricalPanels(project))
  }
  linkSupplyAssemblyDeviceReferences(project)
  materializeLegacyDcRailConnections(selectProjectElectricalPanels(project))
  repairCrossOutputSupplyConverterDcConnections(project)
  migrateLegacyWireRunEdgeAnchors(project)
  ensureProjectConductorIds(project)
  syncJunctionAssetsForEdition(project)
  healPlanWiring(project)
}

export * from '@/lib/eendraad/projectElectricalDomain'
