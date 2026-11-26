/**
 * Store actions extracted to run on a mutable project (an Immer draft in the store or in a
 * project command, ADR 0003). The store slices call these and keep only their bookkeeping.
 */
import { projectMutationNow } from './mutationTime'
import { suggestRotationForPlacement } from '@/utils/planAutoOrient'
import { normalizeProtectionCapacityUpdates } from '@/lib/protectionDefaults'
import { addOneWireNoteInProject } from './annotationMutations'
import { syncSequentialEndpointBranchLabelsToCircuit } from '@/lib/eendraad/automaticEndpointBranchNaming'
import {
  resolveUniqueProtectionLabelOnPanel,
  resolveUniqueSupplyProtectionLabelOnPanel,
} from '@/lib/eendraad/automaticMainBusNaming'
import { moveCircuitToCircuitContentPosition } from '@/lib/eendraad/circuitContentInsertion'
import { renameCircuitCodeKeepingEndpoints } from '@/lib/eendraad/circuitEndpointLabels'
import { resolveLabelScheme } from '@/lib/eendraad/labelScheme'
import { withLabelScheme } from '@/lib/eendraad/labelSchemeContext'
import { isDomoticaPanelFeedEndpoint } from '@/lib/eendraad/panelSupplyLink'
import { applyDomoticaRowLabelEdit } from '@/lib/eendraad/domoticaRowLabel'
import { syncDerivedEndpointFlags } from '@/lib/eendraad/endpointInsertAfter'
import { findParentCircuitInfo } from '@/lib/eendraad/findParentCircuitInfo'
import { pruneEendraadFrames } from '@/lib/eendraad/frameContent'
import { getMainBusItemsWithIndices } from '@/lib/eendraad/mainBusOrder'
import { applySecondaryPanelEarthingStem } from '@/lib/eendraad/panelGround'
import {
  cleanupPanelGridSlotsForDevice,
  clearStaleAutoModuleWidthForModuleRef,
  collectDomoticaEndpointIdsForDeletion,
  deleteLinkedSubPanelsIfOrphaned,
  deletePanelFromProject,
  findCircuitById,
  findCircuitOwner,
  findEndpointById,
  findPanelOwningProtection,
  findPanelOwningSupplyDevice,
  findProtectionById,
  findSupplyDeviceContainer,
  getAllEndpoints,
  getSupplyFeedListForTarget,
  maybeApplyAutomaticEendraadNamingForPanel,
  migrateSubCircuitContentToParent,
  normalizeDomoticaCircuit,
  promoteCircuitSubcircuitsToParent,
  pruneStaleElectricalEndpointRecords,
  pruneStalePanelGridProtectionReferencesInProject,
  refreshAutomaticNamingForPanelsShowingSupplyDevice,
  removeEndpointIdsFromCircuit,
  syncManualChronologyForInstallDateUpdate,
} from '@/lib/eendraad/projectElectricalDomain'
import { ensureInstallationFeedTopology, type SupplyFeedScope } from '@/lib/feedTopology'
import { clamp } from '@/lib/geometry'
import { resolveInstallationProfile } from '@/lib/installationProfile'
import { syncConnectionSupplyBreaker } from '@/lib/electrical/supplyConnection'
import { syncSupplyTransformerOutput } from '@/lib/electrical/supplyTransformer'
import { isPanelSupplyFrameDetached } from '@/lib/layout/supplyFrameDetachment'
import { logger } from '@/lib/logger'
import {
  applyNonHouseholdPanelDefaults,
  inheritEarthingFromMainForNewPanel,
} from '@/lib/panel/panelEarthingSync'
import { syncPanelBackupBusPhaseOrderInProject } from '@/lib/panel/panelFeedOrganization'
import { getModuleWidthInCols } from '@/lib/panel/panelGridLayout'
import { findPanelById } from '@/lib/panel/panelTree'
import { setSupplyDevicePanelVisibility } from '@/lib/panel/supplyPanelVisibility'
import { ensureElectricalLayerOnFloor } from '@/lib/plan/floorLayers'
import {
  ensurePanelDistributionEndpointInProject,
  ensurePanelDistributionPlacementInProject,
} from '@/lib/plan/panelPlacementMutations'
import { transformPlanBackgroundFloorView } from '@/lib/plan/floorSetupMutations'
import {
  isMainPanelDistributionEndpoint,
  resolvePanelForDistributionEndpoint,
} from '@/lib/plan/panelDistributionEndpoint'
import {
  hasIndependentSituationPlanVisibility,
  showSituationPlanPlacementInPanel,
  showSituationPlanPlacementOnPlan,
  syncPanelAndSituationPlanDeviceVisibility,
} from '@/lib/plan/panelPlanPlacementVisibility'
import { resolvePlanPxPerMeter } from '@/lib/plan/planScale'
import { healPlanWiring } from '@/lib/plan/planWiring'
import {
  invalidatePlanLengthEstimates,
  preserveOtherFloorsOnScaleChange,
} from '@/lib/plan/rescalePlan'
import {
  commitBuildingFloorView,
  mutateBuildingFloorViews,
  readLegacyCompatibilityFloors,
  selectProjectFloorPlan,
  selectProjectPlanScale,
  setPlanScaleForProject,
} from '@/lib/projectV2/buildingFloors'
import {
  editProjectSupplyAssemblies,
  getEditableProjectElectricalInstallation,
  getEditableProjectElectricalPanels,
  getProjectElectricalInstallation,
  selectProjectSupplyAssemblies,
} from '@/lib/projectV2/electrical'
import { protectionCreationTemplateFromDevice } from '@/lib/protectionDefaults'
import { isModularSocket, normalizeModularSocketProps } from '@/lib/socket/modularSocket'
import {
  attachBackupConverterToAssembly,
  buildChangeoverSupplyAssembly,
  buildDirectConverterSupplyAssembly,
  initializeDirectConverterPanelBranches,
  reconcileChangeoverSupplyAssembly,
  reconcileDirectConverterCommonLoadPath,
  reconcileDirectConverterDcDevices,
  reconcileDirectConverterGridProtections,
  reconcileInverterUnitMultiplier,
  reconcileSupplyAssemblyAcConductorFlow,
  reconcileSupplyAssemblyBranchProtections,
} from '@/lib/supplyAssembly/editorIntegration'
import {
  getPanelInputDeviceStartIndex,
  getSupplyNodePhysicalDeviceId,
  isSupplyBranchDevice,
  resolveAssemblyPanelInput,
} from '@/lib/supplyAssembly/electricalTopology'
import { attachRootPanelToExistingSupplyAssembly } from '@/lib/supplyAssembly/panelHandoff'
import { summarizeConverterDcPersistence } from '@/lib/supplyAssembly/persistenceDiagnostics'
import type { FloorV2, ProjectV2 } from '@/types/projectV2'
import type {
  Circuit,
  EarthingPlacement,
  Endpoint,
  Floor,
  Installation,
  Note,
  Panel,
  PanelGridModuleRef,
  Point2,
  ProtectionDevice,
  TrunkDevice,
} from '@/types/schema'
import type { OffGridSupplyAssembly } from '@/types/supplyAssembly'
import { generateId } from '@/utils/id'
import { ensurePanelPlacement } from '@/utils/panelPlacement'
import { ensureDefaultEarthingSeparators } from '@/utils/project'

export interface ProjectMutationResult {
  changed: boolean
  /** Circuit the change belongs to, for the editor's last-worked circuit. */
  circuitId?: string
}

/** Store action `addCircuitToProtection` on a mutable project (extracted from circuitTrunkSlice.ts). */
export function addCircuitToProtectionInProject(
  project: ProjectV2,
  panelId: string,
  protectionId: string,
  circuit: Circuit
): ProjectMutationResult {
  let __changed = false
  let __circuitId: string | null | undefined
  const __result = (): ProjectMutationResult => ({
    changed: __changed,
    circuitId: __circuitId ?? undefined,
  })
  if (project) {
    const panels = getEditableProjectElectricalPanels(project)
    const panel = findPanelById(panels, panelId)
    if (panel) {
      const protection = panel.protections.find((p) => p.id === protectionId)
      if (protection) {
        if (!protection.circuits) {
          protection.circuits = []
        }
        protection.circuits.push(circuit)
        __changed = true
        maybeApplyAutomaticEendraadNamingForPanel(project, panelId)
      }
    }
  }
  return __result()
}

/** Store action `addSupplyTrunkDevice` on a mutable project (extracted from circuitTrunkSlice.ts). */
export function addSupplyTrunkDeviceInProject(
  project: ProjectV2,
  device: TrunkDevice,
  insertIndex?: number,
  target?: {
    panelId?: string
    feedScope?: SupplyFeedScope
    diagramId?: string
    supplyPanelInput?: boolean
    busSectionId?: string
  }
): ProjectMutationResult {
  let __changed = false
  let __circuitId: string | null | undefined
  const __result = (): ProjectMutationResult => ({
    changed: __changed,
    circuitId: __circuitId ?? undefined,
  })
  if (project) {
    const scope = target?.feedScope ?? 'shared'
    // Hit zones carry electrical ownership explicitly. Retain diagram identity
    // as a fallback for older callers that do not yet provide that contract.
    const isContinuationDiagramDrop =
      !isSupplyBranchDevice(device) &&
      (target?.supplyPanelInput ??
        (!!target?.panelId &&
          target.diagramId === target.panelId &&
          isPanelSupplyFrameDetached(project, target.panelId)))
    const feedScope = isContinuationDiagramDrop ? 'root' : scope
    const devices = getSupplyFeedListForTarget(
      project,
      target?.panelId,
      feedScope,
      target?.busSectionId
    )
    if (isContinuationDiagramDrop && target?.panelId) {
      const source =
        devices.find((item) => item.symbol === 'source_changeover') ??
        devices.find((item) => item.supplyPath === 'converter-branch')
      if (source && !assemblyOwnsSupplyDevice(project, source.id)) {
        const backupConverter = devices.find(
          (item) => item.type === 'conversion' && item.supplyPath === 'backup'
        )
        editProjectSupplyAssemblies(project).push(
          source.symbol === 'source_changeover'
            ? backupConverter
              ? attachBackupConverterToAssembly(project, target.panelId, source, backupConverter)
              : buildChangeoverSupplyAssembly(project, target.panelId, source)
            : buildDirectConverterSupplyAssembly(project, target.panelId, source)
        )
        reconcileSupplyAssemblyBranchProtections(project, target.panelId)
        reconcileDirectConverterDcDevices(project, target.panelId)
      }
    }
    const insertFloor = isContinuationDiagramDrop
      ? firstPanelLocalRootSupplyInsertIndex(project, devices)
      : 0
    const firstPanelInput = devices.findIndex((item) => item.supplyPanelInput)
    const insertCeiling =
      !isContinuationDiagramDrop && firstPanelInput !== -1 ? firstPanelInput : devices.length
    const idx = clamp(insertIndex ?? insertCeiling, insertFloor, insertCeiling)
    if (isContinuationDiagramDrop) device.supplyPanelInput = true
    devices.splice(idx, 0, device)
    devices.forEach((item, index) => {
      item.trunkPosition = index
    })
    if (device.supplyPath === 'converter-branch') {
      setSupplyDevicePanelVisibility(project, device.id, true)
      const placementIds = new Set((device.placements ?? []).map((placement) => placement.id))
      if (placementIds.size > 0) {
        mutateBuildingFloorViews(project, (floors) => {
          for (const floor of floors) {
            const hiddenPlacementIds = floor.hiddenSitplanPlacementIds ?? []
            const nextHiddenPlacementIds = [
              ...hiddenPlacementIds,
              ...[...placementIds].filter(
                (placementId) => !hiddenPlacementIds.includes(placementId)
              ),
            ]
            floor.hiddenSitplanPlacementIds = nextHiddenPlacementIds.length
              ? nextHiddenPlacementIds
              : undefined
          }
        })
      }
    }
    if (
      target?.panelId &&
      (device.supplyPath === 'backup-output' ||
        device.supplyPath === 'changeover-grid' ||
        device.supplyPath === 'converter-grid')
    ) {
      reconcileSupplyAssemblyBranchProtections(project, target.panelId)
      reconcileDirectConverterGridProtections(project, target.panelId)
    }
    if (
      target?.panelId &&
      (device.supplyPath === 'converter-dc' || device.supplyPath === 'converter-dc-top')
    ) {
      reconcileDirectConverterDcDevices(project, target.panelId)
      const dcPersistenceSummary = summarizeConverterDcPersistence(project)
      if (dcPersistenceSummary) {
        logger.debug('[SUPPLY-PERSIST] added converter DC device', dcPersistenceSummary)
      }
    }
    const commonOutputOwner = findPanelOwningSupplyDevice(project, device.id)
    if (commonOutputOwner && !isContinuationDiagramDrop) {
      reconcileSupplyAssemblyBranchProtections(project, commonOutputOwner.id, {
        absorbDeviceIds: [device.id],
      })
      reconcileDirectConverterCommonLoadPath(project, commonOutputOwner.id, {
        absorbDeviceIds: [device.id],
      })
    }
    syncPanelAndSituationPlanDeviceVisibility(project)
    __changed = true
  }
  return __result()
}

/** Store action `updateSupplyTrunkDevice` on a mutable project (extracted from circuitTrunkSlice.ts). */
export function updateSupplyTrunkDeviceInProject(
  project: ProjectV2,
  deviceId: string,
  updates: Partial<TrunkDevice>
): ProjectMutationResult {
  let __changed = false
  let __circuitId: string | null | undefined
  const __result = (): ProjectMutationResult => ({
    changed: __changed,
    circuitId: __circuitId ?? undefined,
  })
  if (project) {
    const container = findSupplyDeviceContainer(project, deviceId)
    const devices = container?.devices
    if (devices) {
      const device = devices.find((d) => d.id === deviceId)
      if (!device) return __result()
      updates = normalizeProtectionCapacityUpdates(updates, device)
      const supplyRef: PanelGridModuleRef = {
        kind: 'trunkDevice',
        id: deviceId,
        scope: 'supply',
      }
      const oldPoleWidth = getModuleWidthInCols(supplyRef, project)
      const oldLabel = typeof device.label === 'string' ? device.label.trim() : ''
      const owningPanel = findPanelOwningSupplyDevice(project, deviceId)
      const nextUpdates =
        device.type === 'protection' &&
        typeof updates.label === 'string' &&
        owningPanel &&
        getEditableProjectElectricalInstallation(project)?.eendraadAutomaticNaming
          ? {
              ...updates,
              label: resolveUniqueSupplyProtectionLabelOnPanel(
                owningPanel,
                project,
                deviceId,
                updates.label
              ),
            }
          : updates
      Object.assign(device, nextUpdates)
      // Legacy direct supply drawings may not have materialized their graph yet.
      // Create it on an explicit AC-mode edit before reconciling its ports and loads.
      if (
        owningPanel &&
        device.symbol === 'inverter' &&
        device.supplyPath === 'converter-branch' &&
        (updates.converterAcConnection === 'shared' ||
          updates.converterAcConnection === 'separate') &&
        !assemblyOwnsSupplyDevice(project, deviceId)
      ) {
        editProjectSupplyAssemblies(project).push(
          buildDirectConverterSupplyAssembly(project, owningPanel.id, device)
        )
        reconcileDirectConverterDcDevices(project, owningPanel.id)
      }
      if (
        owningPanel &&
        (device.supplyPath === 'backup-output' ||
          device.supplyPath === 'changeover-grid' ||
          device.supplyPath === 'converter-grid')
      ) {
        reconcileSupplyAssemblyBranchProtections(project, owningPanel.id)
        reconcileDirectConverterGridProtections(project, owningPanel.id)
      }
      if (
        owningPanel &&
        (device.supplyPath === 'converter-dc' || device.supplyPath === 'converter-dc-top')
      ) {
        reconcileDirectConverterDcDevices(project, owningPanel.id)
      }
      if (owningPanel && device.type === 'conversion') {
        if (device.supplyPath === 'backup') {
          reconcileSupplyAssemblyBranchProtections(project, owningPanel.id)
        } else if (device.supplyPath === 'converter-branch') {
          reconcileDirectConverterGridProtections(project, owningPanel.id)
        }
      }
      if (
        device.symbol === 'inverter' &&
        (device.supplyPath === 'backup' || device.supplyPath === 'converter-branch')
      ) {
        reconcileInverterUnitMultiplier(project, device)
        if (owningPanel && device.supplyPath === 'backup') {
          syncPanelBackupBusPhaseOrderInProject(project, owningPanel.id)
        }
      }
      if (device.symbol === 'source_changeover') {
        reconcileChangeoverSupplyAssembly(project, device)
        if (owningPanel) {
          syncPanelBackupBusPhaseOrderInProject(project, owningPanel.id)
        }
      }
      if (owningPanel && assemblyOwnsSupplyDevice(project, deviceId)) {
        reconcileSupplyAssemblyBranchProtections(project, owningPanel.id)
        reconcileDirectConverterCommonLoadPath(project, owningPanel.id)
        reconcileSupplyAssemblyAcConductorFlow(
          project,
          container?.scope === 'shared' ? undefined : owningPanel.id
        )
      }
      syncManualChronologyForInstallDateUpdate(
        project,
        { id: deviceId, type: 'trunkDevice' },
        nextUpdates
      )
      const newPoleWidth = getModuleWidthInCols(supplyRef, project)
      if (oldPoleWidth !== newPoleWidth) {
        clearStaleAutoModuleWidthForModuleRef(
          getEditableProjectElectricalPanels(project),
          supplyRef,
          oldPoleWidth
        )
      }
      const newLabel = typeof nextUpdates.label === 'string' ? nextUpdates.label.trim() : oldLabel
      if (
        Object.prototype.hasOwnProperty.call(updates, 'label') &&
        newLabel !== oldLabel &&
        getEditableProjectElectricalInstallation(project)?.eendraadAutomaticNaming
      ) {
        refreshAutomaticNamingForPanelsShowingSupplyDevice(project, deviceId)
      }
      __changed = true
    }
  }
  return __result()
}

/** Store action `addGroundTrunkDevice` on a mutable project (extracted from planPlacementSlice.ts). */
export function addGroundTrunkDeviceInProject(
  project: ProjectV2,
  device: TrunkDevice,
  insertIndex?: number,
  panelId?: string
): ProjectMutationResult {
  let __changed = false
  let __circuitId: string | null | undefined
  const __result = (): ProjectMutationResult => ({
    changed: __changed,
    circuitId: __circuitId ?? undefined,
  })
  if (!project) return __result()
  const targetPanel = panelId
    ? findPanelById(getEditableProjectElectricalPanels(project), panelId)
    : undefined
  if (targetPanel && targetPanel.isMain === false) {
    if (!targetPanel.groundTrunkDevices) targetPanel.groundTrunkDevices = []
    const idx = insertIndex ?? targetPanel.groundTrunkDevices.length
    targetPanel.groundTrunkDevices.splice(idx, 0, device)
    targetPanel.hasGround = true
    __changed = true
    return __result()
  }
  const installation = getEditableProjectElectricalInstallation(project)
  if (!installation) return __result()
  if (!installation.groundTrunkDevices) {
    installation.groundTrunkDevices = []
  }
  const idx = insertIndex ?? installation.groundTrunkDevices.length
  installation.groundTrunkDevices.splice(idx, 0, device)
  __changed = true
  return __result()
}

/** Store action `ensureSecondaryPanelEarthingStem` on a mutable project (extracted from planPlacementSlice.ts). */
export function ensureSecondaryPanelEarthingStemInProject(
  project: ProjectV2,
  panelId: string,
  language?: string,
  newId?: () => string
): ProjectMutationResult {
  let __changed = false
  let __circuitId: string | null | undefined
  const __result = (): ProjectMutationResult => ({
    changed: __changed,
    circuitId: __circuitId ?? undefined,
  })
  if (!project) return __result()
  const panel = findPanelById(getEditableProjectElectricalPanels(project), panelId)
  if (!panel) return __result()
  if (applySecondaryPanelEarthingStem(panel, language, newId)) __changed = true
  return __result()
}

/** Store action `deleteEndpoint` on a mutable project (extracted from planPlacementSlice.ts). */
export function deleteEndpointInProject(project: ProjectV2, id: string): ProjectMutationResult {
  let __changed = false
  let __circuitId: string | null | undefined
  const __result = (): ProjectMutationResult => ({
    changed: __changed,
    circuitId: __circuitId ?? undefined,
  })
  if (project) {
    const panels = getEditableProjectElectricalPanels(project)
    for (const panel of panels) {
      const result = findEndpointById(panel, id)
      if (result) {
        if (isMainPanelDistributionEndpoint(project, result.endpoint)) {
          logger.warn('[projectStore] deleteEndpoint blocked for main panel distribution symbol', {
            endpointId: id,
          })
          return __result()
        }
        if (result.endpoint.symbol === 'panel_distribution') {
          const linkedPanel = resolvePanelForDistributionEndpoint(project, result.endpoint)
          if (linkedPanel && !linkedPanel.isMain) {
            if (deletePanelFromProject(project, linkedPanel.id)) {
              healPlanWiring(project)
              pruneStaleElectricalEndpointRecords(project)
              __changed = true
            }
            return __result()
          }
        }
        const idsToDelete = collectDomoticaEndpointIdsForDeletion(result.circuit, [id])
        if (result.endpoint.symbol === 'domotica') {
          cleanupPanelGridSlotsForDevice(panels, {
            kind: 'domotica',
            endpointId: result.endpoint.id,
            circuitId: result.circuit.id,
          })
        }

        removeEndpointIdsFromCircuit(result.circuit, idsToDelete)
        normalizeDomoticaCircuit(result.circuit)
        syncDerivedEndpointFlags(result.circuit)
        syncSequentialEndpointBranchLabelsToCircuit(result.circuit)
        healPlanWiring(project)
        if (getEditableProjectElectricalInstallation(project)?.eendraadAutomaticNaming) {
          const owner = findCircuitOwner(panels, result.circuit.id)
          if (owner) {
            maybeApplyAutomaticEendraadNamingForPanel(project, owner.panel.id)
          }
        }
        pruneEendraadFrames(project, { removedMemberIds: idsToDelete })
        pruneStaleElectricalEndpointRecords(project)
        __changed = true
        return __result()
      }
    }
  }
  return __result()
}

/** Store action `addEarthingPlacement` on a mutable project (extracted from planPlacementSlice.ts). */
export function addEarthingPlacementInProject(
  project: ProjectV2,
  placement: EarthingPlacement
): ProjectMutationResult {
  let __changed = false
  let __circuitId: string | null | undefined
  const __result = (): ProjectMutationResult => ({
    changed: __changed,
    circuitId: __circuitId ?? undefined,
  })
  if (project) {
    const installation = getProjectElectricalInstallation(project)
    if (!installation) return __result()
    if (!installation.earthingPlacements) {
      installation.earthingPlacements = []
    }
    installation.earthingPlacements.push(placement)
    __changed = true
  }
  return __result()
}

/** Store action `updateProtection` on a mutable project (extracted from protectionSlice.ts). */
export function updateProtectionInProject(
  project: ProjectV2,
  id: string,
  updates: Partial<ProtectionDevice>
): ProjectMutationResult {
  let __changed = false
  let __circuitId: string | null | undefined
  const __result = (): ProjectMutationResult => ({
    changed: __changed,
    circuitId: __circuitId ?? undefined,
  })
  if (project) {
    const owningPanel = findPanelOwningProtection(getEditableProjectElectricalPanels(project), id)
    if (owningPanel) {
      const protection = owningPanel.protections.find((p) => p.id === id)
      if (protection) {
        updates = normalizeProtectionCapacityUpdates(updates, protection)
        const oldLabel = protection.label
        const newLabelRaw = updates.label
        const nextUpdates =
          typeof newLabelRaw === 'string' &&
          getEditableProjectElectricalInstallation(project)?.eendraadAutomaticNaming &&
          !protection.circuits?.some((circuit) => circuit.eendraadManualCodeLock === true)
            ? {
                ...updates,
                label: resolveUniqueProtectionLabelOnPanel(owningPanel, id, newLabelRaw, project),
              }
            : updates
        const newLabel = typeof nextUpdates.label === 'string' ? nextUpdates.label.trim() : null

        // Fast no-op: if this update doesn't actually change anything, skip.
        let hasAnyChange = false
        for (const [k, v] of Object.entries(nextUpdates)) {
          const key = k as keyof ProtectionDevice
          if (key === 'label') {
            const next = typeof v === 'string' ? v : ''
            const curr = typeof protection.label === 'string' ? protection.label : ''
            if (next !== curr) hasAnyChange = true
            continue
          }
          const protectionValue = protection[key as keyof ProtectionDevice]
          if (!Object.is(protectionValue, v)) {
            hasAnyChange = true
            break
          }
        }
        if (!hasAnyChange) return __result()

        const protectionRef: PanelGridModuleRef = { kind: 'protection', id: protection.id }
        const oldPoleWidth = getModuleWidthInCols(protectionRef, project)

        // Apply protection updates
        Object.assign(protection, nextUpdates)
        syncManualChronologyForInstallDateUpdate(project, { id, type: 'protection' }, nextUpdates)

        project.project.protectionCreationTemplates = {
          ...(project.project.protectionCreationTemplates ?? {}),
          [protection.type]: protectionCreationTemplateFromDevice(protection),
        }

        const newPoleWidth = getModuleWidthInCols(protectionRef, project)
        if (oldPoleWidth !== newPoleWidth) {
          clearStaleAutoModuleWidthForModuleRef(
            getEditableProjectElectricalPanels(project),
            protectionRef,
            oldPoleWidth
          )
        }

        // If the protection label changed, update circuit codes to match, including clears.
        if (newLabel !== null && newLabel !== oldLabel) {
          const circuits = protection.circuits
          if (circuits?.length) {
            const scheme = resolveLabelScheme(getEditableProjectElectricalInstallation(project)?.labelScheme)
            withLabelScheme(scheme, () => {
              for (const circuit of circuits) {
                renameCircuitCodeKeepingEndpoints(circuit, newLabel)
              }
            })
          }
        }

        __circuitId = protection.circuits?.[0]?.id ?? null
        __changed = true
        return __result()
      }
    }
    logger.info('[updateProtection] Protection not found', { id })
  }
  return __result()
}

/** Store action `moveCircuitOnMainBus` on a mutable project (extracted from protectionSlice.ts). */
export function moveCircuitOnMainBusInProject(
  project: ProjectV2,
  panelId: string,
  circuitId: string,
  direction: 'left' | 'right'
): ProjectMutationResult {
  let __changed = false
  let __circuitId: string | null | undefined
  const __result = (): ProjectMutationResult => ({
    changed: __changed,
    circuitId: __circuitId ?? undefined,
  })
  logger.info('[moveCircuitOnMainBus]', { panelId, circuitId, direction })
  if (!project) {
    logger.warn('[moveCircuitOnMainBus] No current project')
    return __result()
  }
  const panel = findPanelById(getEditableProjectElectricalPanels(project), panelId)
  if (!panel) {
    logger.warn('[moveCircuitOnMainBus] Panel not found', { panelId })
    return __result()
  }

  // Find the circuit - could be in panel.circuits or in a protection's circuits
  let circuit: Circuit | undefined
  let protection: ProtectionDevice | undefined
  let array: Circuit[] | undefined
  let index: number = -1

  // Check direct circuits first
  circuit = panel.circuits.find((c) => c.id === circuitId)
  if (circuit) {
    array = panel.circuits
    index = panel.circuits.indexOf(circuit)
  } else {
    // Check protection circuits
    for (const prot of panel.protections) {
      if (prot.circuits) {
        circuit = prot.circuits.find((c) => c.id === circuitId)
        if (circuit) {
          protection = prot
          array = prot.circuits
          index = prot.circuits.indexOf(circuit)
          break
        }
      }
    }
  }

  if (!circuit || !array || index === -1) {
    logger.warn('[moveCircuitOnMainBus] Circuit not found', {
      circuitId,
      foundCircuit: !!circuit,
      foundArray: !!array,
      index,
    })
    return __result()
  }

  logger.info('[moveCircuitOnMainBus] Found circuit', {
    circuitId,
    isDirect: array === panel.circuits,
    protectionId: protection?.id,
  })

  const mainBusItems = getMainBusItemsWithIndices(panel)
  logger.info('[moveCircuitOnMainBus] Main bus items', {
    items: mainBusItems.map((i) => ({ type: i.type, id: i.id })),
  })

  // Find current item
  const currentItem = mainBusItems.find(
    (item) =>
      (item.type === 'circuit' && item.id === circuitId) ||
      (item.type === 'protection' && protection && item.id === protection.id)
  )

  if (!currentItem) {
    logger.warn('[moveCircuitOnMainBus] Current item not found in main bus items')
    return __result()
  }

  const currentIndex = mainBusItems.indexOf(currentItem)
  logger.info('[moveCircuitOnMainBus] Current position', {
    currentIndex,
    total: mainBusItems.length,
  })

  if (direction === 'left' && currentIndex > 0) {
    // Swap with previous
    const prevItem = mainBusItems[currentIndex - 1]
    logger.info('[moveCircuitOnMainBus] Swapping with previous', { prevItem })
    if (!prevItem) {
      return __result()
    }
    if (currentItem.type === 'circuit' && prevItem.type === 'circuit') {
      // Swap circuits
      const temp = panel.circuits[currentItem.index]
      if (!temp) return __result()
      const prevCircuit = panel.circuits[prevItem.index]
      if (!prevCircuit) return __result()
      panel.circuits[currentItem.index] = prevCircuit
      panel.circuits[prevItem.index] = temp
      logger.info('[moveCircuitOnMainBus] Swapped circuits')
    } else if (currentItem.type === 'protection' && prevItem.type === 'protection') {
      // Swap protections
      const temp = panel.protections[currentItem.index]
      if (!temp) return __result()
      const prevProtection = panel.protections[prevItem.index]
      if (!prevProtection) return __result()
      panel.protections[currentItem.index] = prevProtection
      panel.protections[prevItem.index] = temp
      logger.info('[moveCircuitOnMainBus] Swapped protections')
    }
    __changed = true
    maybeApplyAutomaticEendraadNamingForPanel(project, panelId)
  } else if (direction === 'right' && currentIndex < mainBusItems.length - 1) {
    // Swap with next
    const nextItem = mainBusItems[currentIndex + 1]
    logger.info('[moveCircuitOnMainBus] Swapping with next', { nextItem })
    if (!nextItem) {
      return __result()
    }
    if (currentItem.type === 'circuit' && nextItem.type === 'circuit') {
      // Swap circuits
      const temp = panel.circuits[currentItem.index]
      if (!temp) return __result()
      const nextCircuit = panel.circuits[nextItem.index]
      if (!nextCircuit) return __result()
      panel.circuits[currentItem.index] = nextCircuit
      panel.circuits[nextItem.index] = temp
      logger.info('[moveCircuitOnMainBus] Swapped circuits')
    } else if (currentItem.type === 'protection' && nextItem.type === 'protection') {
      // Swap protections
      const temp = panel.protections[currentItem.index]
      if (!temp) return __result()
      const nextProtection = panel.protections[nextItem.index]
      if (!nextProtection) return __result()
      panel.protections[currentItem.index] = nextProtection
      panel.protections[nextItem.index] = temp
      logger.info('[moveCircuitOnMainBus] Swapped protections')
    }
    __changed = true
    maybeApplyAutomaticEendraadNamingForPanel(project, panelId)
  } else {
    logger.info('[moveCircuitOnMainBus] Cannot move', {
      direction,
      currentIndex,
      total: mainBusItems.length,
    })
  }
  return __result()
}

/** Store action `moveCircuitToSecondaryBus` on a mutable project (extracted from protectionSlice.ts). */
export function moveCircuitToSecondaryBusInProject(
  project: ProjectV2,
  panelId: string,
  parentCircuitId: string,
  circuitId: string,
  insertIndex: number,
  options?: { insertBeforeCircuitContent?: boolean }
): ProjectMutationResult {
  let __changed = false
  let __circuitId: string | null | undefined
  const __result = (): ProjectMutationResult => ({
    changed: __changed,
    circuitId: __circuitId ?? undefined,
  })
  if (!project) return __result()
  const panel = findPanelById(getEditableProjectElectricalPanels(project), panelId)
  if (!panel) return __result()

  const changed = moveCircuitToCircuitContentPosition(
    panel,
    parentCircuitId,
    circuitId,
    insertIndex,
    options
  )
  if (!changed) return __result()
  __changed = true
  maybeApplyAutomaticEendraadNamingForPanel(project, panelId)
  return __result()
}

/** Store action `deleteProtection` on a mutable project (extracted from protectionSlice.ts). */
export function deleteProtectionInProject(
  project: ProjectV2,
  id: string,
  options?: DeleteProtectionOptions
): ProjectMutationResult {
  let __changed = false
  let __circuitId: string | null | undefined
  const __result = (): ProjectMutationResult => ({
    changed: __changed,
    circuitId: __circuitId ?? undefined,
  })
  if (project) {
    const panels = getEditableProjectElectricalPanels(project)
    const endpointIdsBeforeDeletion = collectPanelEndpointIds(panels)
    let protectionToDelete: ProtectionDevice | undefined
    for (const panel of panels) {
      protectionToDelete = findProtectionById(panel, id)
      if (protectionToDelete) break
    }
    if (!protectionToDelete) {
      return __result()
    }
    const linkedPanelIds = new Set([
      ...(protectionToDelete.subPanelId ? [protectionToDelete.subPanelId] : []),
      ...(protectionToDelete.circuits ?? []).flatMap((circuit) =>
        circuit.endpoints.filter(isDomoticaPanelFeedEndpoint).map((endpoint) => endpoint.panelId)),
    ])
    const protectionCircuits = protectionToDelete.circuits ?? []
    const hasSurvivingUpstreamProtection =
      protectionCircuits.length > 0 &&
      protectionCircuits.every((circuit) => {
        const parentProtection = findParentCircuitInfo(circuit.id, panels)?.parentProtection
        return parentProtection != null && parentProtection.id !== id
      })

    if (linkedPanelIds.size && options?.preserveLinkedPanels) {
      // A preserved secondary-panel feeder is intentionally reattached to the
      // surviving parent protection, including its panel link.
      migrateSubCircuitContentToParent(
        protectionToDelete,
        panels,
        project.disciplines.electrical?.devices
      )
    } else if (linkedPanelIds.size === 0 && hasSurvivingUpstreamProtection) {
      // Removing an inline protection should keep its circuit content under the
      // upstream protection. A root protection has no protected parent to inherit it.
      migrateSubCircuitContentToParent(
        protectionToDelete,
        panels,
        project.disciplines.electrical?.devices
      )
    } else {
      // Without a surviving upstream protection, keep the existing cascade behavior
      // and promote any protected children into the deleted protection's position.
      promoteDeletedProtectionSubcircuits(protectionToDelete, panels)
    }
    const linkedSubPanelId = protectionToDelete.subPanelId
    const deletedProtectionIds = new Set([id])
    if (options?.preserveLinkedPanels && linkedSubPanelId) {
      preserveDeletedProtectionPanelLinks(panels, deletedProtectionIds)
    }

    let affectedPanelId: string | null = null
    const removeProtection = (panel: Panel): boolean => {
      const index = panel.protections.findIndex((p) => p.id === id)
      if (index !== -1) {
        panel.protections.splice(index, 1)
        affectedPanelId = panel.id
        return true
      }
      for (const subPanel of panel.subPanels) {
        if (removeProtection(subPanel)) return true
      }
      return false
    }

    for (const panel of panels) {
      if (removeProtection(panel)) {
        __changed = true
        if (linkedPanelIds.size && !options?.preserveLinkedPanels) {
          deleteLinkedSubPanelsIfOrphaned(project, linkedPanelIds)
        }
        if (affectedPanelId) {
          maybeApplyAutomaticEendraadNamingForPanel(project, affectedPanelId)
        }
        // Protection rows are selectable panel-grid modules. Remove their persisted slot and
        // visibility references with the row so a deleted structural device cannot leave a
        // blank module position behind.
        cleanupPanelGridSlotsForDevice(panels, { kind: 'protection', id })
        pruneStalePanelGridProtectionReferencesInProject(project)
        const endpointIdsAfterDeletion = collectPanelEndpointIds(panels)
        const removedEndpointIds = [...endpointIdsBeforeDeletion].filter(
          (endpointId) => !endpointIdsAfterDeletion.has(endpointId)
        )
        pruneEendraadFrames(project, {
          removedMemberIds: [id, ...removedEndpointIds],
        })
        healPlanWiring(project)
        pruneStaleElectricalEndpointRecords(project)
        return __result()
      }
    }
  }
  return __result()
}

/** Store action `updateInstallation` on a mutable project (extracted from panelSlice.ts). */
export function updateInstallationInProject(
  project: ProjectV2,
  updates: Partial<Installation>
): ProjectMutationResult & { changedSupplyBreakerId?: string; changedSupplyTransformerId?: string } {
  let __changed = false
  let __circuitId: string | null | undefined
  let changedSupplyBreakerId: string | undefined
  let changedSupplyTransformerId: string | undefined
  const __result = (): ProjectMutationResult & { changedSupplyBreakerId?: string; changedSupplyTransformerId?: string } => ({
    changed: __changed,
    circuitId: __circuitId ?? undefined,
    changedSupplyBreakerId,
    changedSupplyTransformerId,
  })
  if (project) {
    const installation = getEditableProjectElectricalInstallation(project)
    if (!installation) return __result()
    const profileWillBecomeNonHousehold =
      updates.installationProfile === 'non_household' &&
      resolveInstallationProfile(installation) !== 'non_household'
    Object.assign(installation, updates)
    if (profileWillBecomeNonHousehold) {
      applyNonHouseholdPanelDefaults(installation, getEditableProjectElectricalPanels(project))
    }
    // Keep feed topology in sync with installation supply edits (cable/devices),
    // otherwise supply-wire UI can read stale shared/root feed cable values.
    ensureInstallationFeedTopology(installation, getEditableProjectElectricalPanels(project))
    if (updates.connectionCurrentA != null) {
      changedSupplyBreakerId = syncConnectionSupplyBreaker(installation, updates.connectionCurrentA)
    }
    if (updates.nominalVoltage) changedSupplyTransformerId = syncSupplyTransformerOutput(installation)
    reconcileSupplyAssemblyAcConductorFlow(project)
    if (project.project) {
      project.project.updatedAt = projectMutationNow()
    }
    __changed = true
  }
  return __result()
}

/** Store action `addEendraadNote` on a mutable project (extracted from selectorAnnotationSlice.ts). */
export function addEendraadNoteInProject(project: ProjectV2, note: Note): ProjectMutationResult {
  let __changed = false
  let __circuitId: string | null | undefined
  const __result = (): ProjectMutationResult => ({
    changed: __changed,
    circuitId: __circuitId ?? undefined,
  })
  if (project) __changed = addOneWireNoteInProject(project, note)
  return __result()
}

export function assemblyOwnsSupplyDevice(
  project: Parameters<typeof selectProjectSupplyAssemblies>[0],
  deviceId: string
): boolean {
  return selectProjectSupplyAssemblies(project).some((assembly) =>
    assembly.nodes.some((node) => getSupplyNodePhysicalDeviceId(node) === deviceId)
  )
}

export function firstPanelLocalRootSupplyInsertIndex(
  project: Parameters<typeof selectProjectSupplyAssemblies>[0],
  devices: TrunkDevice[]
): number {
  return getPanelInputDeviceStartIndex(project, devices)
}

export function panelTreeHasSurvivingFeeder(
  panels: Panel[],
  subPanelId: string,
  deletedProtectionIds: ReadonlySet<string>
): boolean {
  for (const panel of panels) {
    if (
      panel.protections.some(
        (protection) =>
          !deletedProtectionIds.has(protection.id) && protection.subPanelId === subPanelId
      )
    ) {
      return true
    }
    if (panelTreeHasSurvivingFeeder(panel.subPanels, subPanelId, deletedProtectionIds)) {
      return true
    }
  }
  return false
}

export function preserveDeletedProtectionPanelLinks(
  panels: Panel[],
  deletedProtectionIds: ReadonlySet<string>
): void {
  const preservedPanelIds = new Set<string>()

  const preserveInPanel = (panel: Panel): void => {
    for (let index = 0; index < panel.protections.length; index += 1) {
      const protection = panel.protections[index]
      const subPanelId = protection?.subPanelId
      if (
        !protection ||
        !deletedProtectionIds.has(protection.id) ||
        !subPanelId ||
        preservedPanelIds.has(subPanelId) ||
        panelTreeHasSurvivingFeeder(panels, subPanelId, deletedProtectionIds)
      ) {
        continue
      }

      const carrier: ProtectionDevice = {
        id: generateId(),
        type: 'OTHER',
        label: '',
        circuits: protection.circuits ?? [],
        subPanelId,
        directPanelFeeder: true,
      }
      panel.protections.splice(index + 1, 0, carrier)
      preservedPanelIds.add(subPanelId)
      index += 1
    }

    for (const subPanel of panel.subPanels) preserveInPanel(subPanel)
  }

  for (const panel of panels) preserveInPanel(panel)
}

export function collectPanelEndpointIds(panels: Panel[]): Set<string> {
  return new Set(panels.flatMap((panel) => getAllEndpoints(panel).map((endpoint) => endpoint.id)))
}

export function promoteDeletedProtectionSubcircuits(
  protection: ProtectionDevice,
  panels: Panel[]
): void {
  for (const circuit of protection.circuits ?? []) {
    const parentInfo = findParentCircuitInfo(circuit.id, panels)
    if (parentInfo) promoteCircuitSubcircuitsToParent(circuit, parentInfo.parentCircuit)
  }
}

export interface DeleteProtectionOptions {
  /** Keep any linked secondary panels attached through an unprotected structural feeder. */
  preserveLinkedPanels?: boolean
}

/** Store action `addPanel` on a mutable project (extracted from panelSlice.ts). */
export function addPanelInProject(
  project: ProjectV2,
  panel: Panel,
  parentPanelId?: string,
  /** Plan viewport centre for the panel symbol, when the plan shows the active floor. */
  preferredPlanPos?: Point2,
  /** Active plan floor supplied by an explicit electrical symbol drop. */
  preferredPlanFloorId?: string
): ProjectMutationResult {
  let __changed = false
  let __circuitId: string | null | undefined
  const __result = (): ProjectMutationResult => ({
    changed: __changed,
    circuitId: __circuitId ?? undefined,
  })
  const projectPanels = getEditableProjectElectricalPanels(project)
  const parentPanel = parentPanelId ? findPanelById(projectPanels, parentPanelId) : undefined
  if (parentPanelId) {
    if (parentPanel) {
      parentPanel.subPanels.push(panel)
    } else {
      // Fallback to root if parent not found
      projectPanels.push(panel)
    }
  } else {
    projectPanels.push(panel)
  }

  inheritEarthingFromMainForNewPanel(getEditableProjectElectricalPanels(project), panel)
  const panelPlacement = ensurePanelPlacement(project, panel, {
    ...(preferredPlanPos ? { preferredPlanPos } : {}),
    ...(preferredPlanFloorId ? { preferredFloorId: preferredPlanFloorId } : {}),
  })
  if (panelPlacement) {
    ensurePanelDistributionPlacementInProject(panel, panelPlacement.placement, {
      endpointCandidate: panelPlacement.endpoint,
    })
  } else {
    ensurePanelDistributionEndpointInProject(panel)
  }

  const installation = getEditableProjectElectricalInstallation(project)
  if (!installation) return __result()
  if (!parentPanel && panel.isMain !== false) {
    ensureDefaultEarthingSeparators(installation)
  }
  ensureInstallationFeedTopology(installation, getEditableProjectElectricalPanels(project))
  if (!parentPanelId && panel.isMain !== false) {
    attachRootPanelToExistingSupplyAssembly(project, panel.id)
  }

  __changed = true
  return __result()
}

/** Store action `updateEndpoint` on a mutable project (extracted from planPlacementSlice.ts). */
export function updateEndpointInProject(
  project: ProjectV2,
  id: string,
  updates: Partial<Endpoint> & { circuitId?: string }
): ProjectMutationResult {
  let __changed = false
  let __circuitId: string | null | undefined
  const __result = (): ProjectMutationResult => ({
    changed: __changed,
    circuitId: __circuitId ?? undefined,
  })
  const hasAnyUpdate = Object.keys(updates).length > 0
  if (!hasAnyUpdate) return __result()
  if (project) {
    for (const panel of getEditableProjectElectricalPanels(project)) {
      const result = findEndpointById(panel, id)
      if (result) {
        const nextLabel = updates.label
        const nextCircuitId = updates.circuitId
        const otherUpdateKeys = Object.keys(updates).filter(
          (key) => key !== 'label' && key !== 'circuitId'
        )
        const isNoOpLabel = nextLabel !== undefined && nextLabel === result.endpoint.label
        const isNoOpCircuitMove = nextCircuitId !== undefined && nextCircuitId === result.circuit.id
        const hasOtherChanges = otherUpdateKeys.some((key) => {
          const nextValue = (updates as Record<string, unknown>)[key]
          const currentValue = (result.endpoint as unknown as Record<string, unknown>)[key]
          return nextValue !== currentValue
        })
        if (
          (isNoOpLabel || nextLabel === undefined) &&
          (isNoOpCircuitMove || nextCircuitId === undefined) &&
          !hasOtherChanges
        ) {
          return __result()
        }
        const previousCircuit = result.circuit
        const wasWallLight = result.endpoint.symbol === 'light_point' && result.endpoint.lightPointProps?.onWall
        // If circuit is changing, we need to move the endpoint
        if (updates.circuitId && updates.circuitId !== result.circuit.id) {
          const newCircuitResult = findCircuitById(panel, updates.circuitId)
          if (newCircuitResult?.circuit.code === 'PANEL') {
            return __result()
          }
          if (newCircuitResult && newCircuitResult.circuit.code !== 'PANEL') {
            // Remove from old circuit
            const index = result.circuit.endpoints.findIndex((e) => e.id === id)
            if (index !== -1) {
              result.circuit.endpoints.splice(index, 1)
            }
            if (result.circuit.branches) {
              result.circuit.branches = result.circuit.branches
                .map((b) => ({
                  ...b,
                  endpointIds: b.endpointIds.filter((bid) => bid !== id),
                }))
                .filter((b) => b.endpointIds.length > 0)
            }

            // Add to new circuit — branch labels synced sequentially after topology change.
            const { label: _omitLabel, ...endpointUpdatesWithoutLabel } = updates
            Object.assign(result.endpoint, endpointUpdatesWithoutLabel)
            if (isModularSocket(result.endpoint)) {
              result.endpoint.socketProps = normalizeModularSocketProps(result.endpoint.socketProps)
            }
            syncManualChronologyForInstallDateUpdate(
              project,
              { id, type: 'endpoint' },
              endpointUpdatesWithoutLabel
            )
            delete (result.endpoint as Endpoint & { circuitId?: string }).circuitId
            newCircuitResult.circuit.endpoints.push(result.endpoint)
            const nb = newCircuitResult.circuit.branches
            if (!nb?.length) {
              const soleBranch = {
                id: generateId(),
                label: '',
                endpointIds: newCircuitResult.circuit.endpoints.map((e) => e.id),
              }
              newCircuitResult.circuit.branches = [soleBranch]
            } else {
              const newBranch = {
                id: generateId(),
                label: '',
                endpointIds: [id],
              }
              nb.push(newBranch)
            }
            normalizeDomoticaCircuit(previousCircuit)
            normalizeDomoticaCircuit(newCircuitResult.circuit)
            syncSequentialEndpointBranchLabelsToCircuit(previousCircuit)
            syncSequentialEndpointBranchLabelsToCircuit(newCircuitResult.circuit)
          }
        } else {
          // A label typed on a domotica output only renames that output row; the module,
          // the branch and the other rows keep their labels.
          const isDomoticaRowLabelEdit =
            updates.label !== undefined && !!result.endpoint.domoticaChildProps
          if (isDomoticaRowLabelEdit) {
            const { label: typedRowLabel, ...updatesWithoutLabel } = updates
            Object.assign(result.endpoint, updatesWithoutLabel)
            applyDomoticaRowLabelEdit(result.circuit, id, typedRowLabel ?? '')
          } else {
            Object.assign(result.endpoint, updates)
          }
          if (isModularSocket(result.endpoint)) {
            result.endpoint.socketProps = normalizeModularSocketProps(result.endpoint.socketProps)
          }
          syncManualChronologyForInstallDateUpdate(project, { id, type: 'endpoint' }, updates)

          // Propagate label changes to the branch and all sibling endpoints.
          // The branch label is the single source of truth — when one endpoint's
          // label is edited, all endpoints on the same branch must follow.
          if (
            updates.label !== undefined &&
            !isDomoticaRowLabelEdit &&
            result.circuit.branches?.length
          ) {
            const branch = result.circuit.branches.find((b) => b.endpointIds.includes(id))
            if (branch) {
              branch.label = updates.label
              // Sync label to all sibling endpoints on this branch
              for (const siblingId of branch.endpointIds) {
                if (siblingId === id) continue
                const sibling = result.circuit.endpoints.find((e) => e.id === siblingId)
                if (sibling) {
                  sibling.label = updates.label
                }
              }
            }
          }
          normalizeDomoticaCircuit(result.circuit)
        }
        if (
          (updates.label !== undefined || updates.circuitId !== undefined) &&
          getEditableProjectElectricalInstallation(project)?.eendraadAutomaticNaming
        ) {
          const circuitIdForRefresh =
            updates.circuitId && updates.circuitId !== previousCircuit.id
              ? previousCircuit.id
              : result.circuit.id
          const owner = findCircuitOwner(
            getEditableProjectElectricalPanels(project),
            circuitIdForRefresh
          )
          if (owner) {
            maybeApplyAutomaticEendraadNamingForPanel(project, owner.panel.id)
          }
          if (updates.circuitId && updates.circuitId !== previousCircuit.id) {
            const destOwner = findCircuitOwner(
              getEditableProjectElectricalPanels(project),
              updates.circuitId
            )
            if (destOwner && destOwner.panel.id !== owner?.panel.id) {
              maybeApplyAutomaticEendraadNamingForPanel(project, destOwner.panel.id)
            }
          }
        }
        if (!wasWallLight && result.endpoint.symbol === 'light_point' && result.endpoint.lightPointProps?.onWall) {
          for (const placement of result.endpoint.placements) {
            if (placement.rotationMode === 'explicit') continue
            const walls = selectProjectFloorPlan(project, placement.floorId)?.walls ?? []
            const rotation = suggestRotationForPlacement(placement, { walls }, 'right')
            if (rotation != null) placement.rotationDeg = rotation
          }
        }
        __circuitId =
          updates.circuitId && updates.circuitId !== result.circuit.id
            ? updates.circuitId
            : result.circuit.id
        __changed = true
        return __result()
      }
    }
  }
  return __result()
}

/** Store action `updateFloor` on a mutable project (extracted from buildingFloorSlice.ts). */
export function updateFloorInProject(
  project: ProjectV2,
  id: string,
  updates: Partial<Floor>,
  /** Panel that shows newly visible placements first (the editor's active panel). */
  activePanelId?: string | null
): ProjectMutationResult {
  let __changed = false
  const __result = (): ProjectMutationResult => ({ changed: __changed })
  if (project) {
    const floor = readLegacyCompatibilityFloors(project).find((f) => f.id === id)
    if (floor) {
      if (updates.scale && resolvePlanPxPerMeter(updates.scale) == null) return __result()
      if (updates.planScaleNeedsCalibration === true) invalidatePlanLengthEstimates(project)
      if (updates.scale) {
        preserveOtherFloorsOnScaleChange(project, id, updates.scale)
        if (updates.scale.reference) {
          updates = {
            ...updates,
            scale: { ...updates.scale, reference: { ...updates.scale.reference, floorId: id } },
            planScaleNeedsCalibration: false,
          }
        }
      }
      const previouslyHidden = new Set(floor.hiddenSitplanPlacementIds ?? [])
      const backgroundUpdates = {
        ...(Object.prototype.hasOwnProperty.call(updates, 'planImageOffset')
          ? { planImageOffset: updates.planImageOffset }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, 'planImageRotationDeg')
          ? { planImageRotationDeg: updates.planImageRotationDeg }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, 'planImageOpacity')
          ? { planImageOpacity: updates.planImageOpacity }
          : {}),
      }
      transformPlanBackgroundFloorView(floor, backgroundUpdates)
      const remainingUpdates = { ...updates }
      delete remainingUpdates.planImageOffset
      delete remainingUpdates.planImageRotationDeg
      delete remainingUpdates.planImageOpacity
      Object.assign(floor, remainingUpdates)
      if (clearsPlanImage(updates)) {
        // The floor view also carries the canonical plan ids; left in place they would
        // re-attach the plan when the view is committed.
        const view = floor as Floor & Partial<Pick<FloorV2, 'planAssetId' | 'processedPlanAssetId'>>
        view.planAssetId = undefined
        view.processedPlanAssetId = undefined
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'hiddenSitplanPlacementIds')) {
        const nextHiddenIds = updates.hiddenSitplanPlacementIds ?? []
        const nextHidden = new Set(nextHiddenIds)
        const preferredPanelId = activePanelId ?? null
        for (const placementId of nextHiddenIds) {
          if (previouslyHidden.has(placementId)) continue
          if (!hasIndependentSituationPlanVisibility(project, placementId)) {
            showSituationPlanPlacementInPanel(project, placementId, preferredPanelId)
          }
        }
        for (const placementId of previouslyHidden) {
          if (nextHidden.has(placementId)) continue
          if (!hasIndependentSituationPlanVisibility(project, placementId)) {
            showSituationPlanPlacementOnPlan(project, placementId)
          }
        }
      }
      if (updates.scale) {
        setPlanScaleForProject(project, updates.scale)
        floor.scale = selectProjectPlanScale(project)
      }
      ensureElectricalLayerOnFloor(floor)
      commitBuildingFloorView(project, id, floor)
      __changed = true
    }
  }
  return __result()
}

/** Store action `addSupplyAssembly` on a mutable project (extracted from supplyAssemblySlice.ts). Analytics stay with the caller. */
export function addSupplyAssemblyInProject(
  project: ProjectV2,
  assembly: OffGridSupplyAssembly
): ProjectMutationResult {
  let __changed = false
  const __result = (): ProjectMutationResult => ({ changed: __changed })
  if (!project) return __result()
  const assemblies = editProjectSupplyAssemblies(project)
  if (assemblies.some(({ id }) => id === assembly.id)) return __result()
  assemblies.push(assembly)
  initializeDirectConverterPanelBranches(project, assemblies[assemblies.length - 1]!)
  const input = resolveAssemblyPanelInput(project, assembly.incomingAttachment)
  if (input) reconcileSupplyAssemblyBranchProtections(project, input.panelId)
  __changed = true
  return __result()
}

/** Store action `replaceSupplyAssembly` on a mutable project (extracted from supplyAssemblySlice.ts). Analytics stay with the caller. */
export function replaceSupplyAssemblyInProject(
  project: ProjectV2,
  id: string,
  assembly: OffGridSupplyAssembly
): ProjectMutationResult {
  let __changed = false
  const __result = (): ProjectMutationResult => ({ changed: __changed })
  if (!project) return __result()
  const assemblies = editProjectSupplyAssemblies(project)
  const index = assemblies.findIndex((candidate) => candidate.id === id)
  if (index < 0) return __result()
  if (assembly.id !== id && assemblies.some((candidate) => candidate.id === assembly.id))
    return __result()
  assemblies[index] = assembly
  const input = resolveAssemblyPanelInput(project, assembly.incomingAttachment)
  if (input) reconcileSupplyAssemblyBranchProtections(project, input.panelId)
  __changed = true
  return __result()
}

/** True when an update deliberately removes the floor's plan image. */
export function clearsPlanImage(updates: Partial<Floor>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(updates, 'planAsset') &&
    Object.prototype.hasOwnProperty.call(updates, 'planImportAsset') &&
    !updates.planAsset &&
    !updates.planImportAsset
  )
}
