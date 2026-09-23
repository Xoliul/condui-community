import {
  appendUndoSnapshotInStore,
  captureProjectForHistory,
  projectHistory,
} from './projectStoreHistory'
import type { ProjectSliceCreator } from './projectStoreTypes'
import { getModuleWidthInCols } from '@/components/canvas/panel/panelGridLayout'
import { recordSessionAction } from '@/lib/diagnostics/sessionActionLog'
import { syncSequentialEndpointBranchLabelsToCircuit } from '@/lib/eendraad/automaticEndpointBranchNaming'
import { resolveUniqueSupplyProtectionLabelOnPanel } from '@/lib/eendraad/automaticMainBusNaming'
import { migrateEndpointLabelsAfterCircuitCodeChange } from '@/lib/eendraad/circuitEndpointLabels'
import { findParentCircuitInfo } from '@/lib/eendraad/findParentCircuitInfo'
import { collectCircuitFrameRemovalIds, pruneEendraadFrames } from '@/lib/eendraad/frameContent'
import { collectAllGroundTrunkDevices } from '@/lib/eendraad/panelGround'
import { logger } from '@/lib/logger'
import {
  cleanupPanelGridSlotsForDevice,
  clearStaleAutoModuleWidthForModuleRef,
  ensureRcboSensitivityOnTrunkDevice,
  findCircuitById,
  findPanelContainingCircuit,
  findPanelOwningSupplyDevice,
  findSupplyDeviceContainer,
  getAllCircuits,
  getSupplyFeedListForTarget,
  maybeApplyAutomaticEendraadNamingForPanel,
  migrateCircuitContentToParent,
  pruneStaleElectricalEndpointRecords,
  refreshAutomaticNamingForPanelsShowingSupplyDevice,
  rewriteRelocatedCircuitTrunkDeviceGridRef,
  syncManualChronologyForInstallDateUpdate,
} from '@/lib/eendraad/projectElectricalDomain'
import {
  logTrunkDnDCommit,
  summarizeDropTarget,
  trunkDnDCommitLogEnabled,
} from '@/lib/eendraad/trunkDeviceDnDLog'
import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import { clamp } from '@/lib/geometry'
import { mutateTrunkDeviceRelocation } from '@/lib/layout/eendraadPreviewSimulation'
import { findPanelById } from '@/lib/panel/panelTree'
import {
  reconcileInvalidPanelFeedOrganizationsInProject,
  syncPanelBackupBusPhaseOrderInProject,
} from '@/lib/panel/panelFeedOrganization'
import { healPlanWiring } from '@/lib/plan/planWiring'
import { syncPanelAndSituationPlanDeviceVisibility } from '@/lib/plan/panelPlanPlacementVisibility'
import { setSupplyDevicePanelVisibility } from '@/lib/panel/supplyPanelVisibility'
import { mutateBuildingFloorViews } from '@/lib/projectV2/buildingFloors'
import {
  buildDirectConverterSupplyAssembly,
  buildChangeoverSupplyAssembly,
  attachBackupConverterToAssembly,
  reconcileDirectConverterDcDevices,
  reconcileDirectConverterGridProtections,
  reconcileDirectConverterCommonLoadPath,
  downgradeChangeoverToDirectConverterAssembly,
  reconcileChangeoverSupplyAssembly,
  reconcileInverterUnitMultiplier,
  reconcileSupplyAssemblyAcConductorFlow,
  reconcileSupplyAssemblyBranchProtections,
} from '@/lib/supplyAssembly/editorIntegration'
import { getSupplyNodePhysicalDeviceId, getPanelInputDeviceStartIndex, isSupplyBranchDevice } from '@/lib/supplyAssembly/electricalTopology'
import { isPanelSupplyFrameDetached } from '@/lib/layout/supplyFrameDetachment'
import { summarizeConverterDcPersistence } from '@/lib/supplyAssembly/persistenceDiagnostics'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  getEditableProjectElectricalInstallation,
  getEditableProjectElectricalPanels,
  editProjectSupplyAssemblies,
  selectProjectSupplyAssemblies,
} from '@/lib/projectV2/electrical'
import { getSymbolById } from '@/lib/symbols'
import { supportsCircuitConverterDcConnections } from '@/lib/layout/circuitConverterGeometry'
import type { Circuit, Panel, PanelGridModuleRef, ProtectionDevice, TrunkDevice } from '@/types/schema'

function assemblyOwnsSupplyDevice(
  project: Parameters<typeof selectProjectSupplyAssemblies>[0],
  deviceId: string
): boolean {
  return selectProjectSupplyAssemblies(project).some((assembly) =>
    assembly.nodes.some((node) => getSupplyNodePhysicalDeviceId(node) === deviceId)
  )
}

function firstPanelLocalRootSupplyInsertIndex(
  project: Parameters<typeof selectProjectSupplyAssemblies>[0],
  devices: TrunkDevice[]
): number {
  return getPanelInputDeviceStartIndex(project, devices)
}

function removeConverterBackupDependents(panels: Panel[], converterId: string): string[] {
  const removedIds: string[] = []
  const linkedPanelIds = new Set<string>()
  const visit = (panel: Panel) => {
    for (let index = panel.protections.length - 1; index >= 0; index--) {
      const protection = panel.protections[index]!
      const ownedCircuits = (protection.circuits ?? []).filter(
        (circuit) =>
          circuit.supplySource?.kind === 'converter-backup' &&
          circuit.supplySource.converterId === converterId
      )
      if (ownedCircuits.length === 0) continue
      removedIds.push(
        protection.id,
        ...ownedCircuits.flatMap((circuit) => [
          circuit.id,
          ...circuit.endpoints.map((endpoint) => endpoint.id),
          ...(circuit.trunkDevices ?? []).map((device) => device.id),
        ])
      )
      if (protection.subPanelId) linkedPanelIds.add(protection.subPanelId)
      panel.protections.splice(index, 1)
    }
    panel.subPanels.forEach(visit)
  }
  panels.forEach(visit)

  const removePanels = (panelList: Panel[]) => {
    for (let index = panelList.length - 1; index >= 0; index--) {
      const panel = panelList[index]!
      removePanels(panel.subPanels)
      if (!linkedPanelIds.has(panel.id)) continue
      removedIds.push(panel.id)
      panelList.splice(index, 1)
    }
  }
  removePanels(panels)
  return removedIds
}

function removeDcBusBranches(
  panels: Panel[],
  _busId: string,
  branchCircuitIds: string[]
): string[] {
  const removedCircuitIds = new Set<string>()
  const removedMemberIds = new Set<string>()
  const pending = [...branchCircuitIds]
  while (pending.length > 0) {
    const circuitId = pending.pop()!
    if (removedCircuitIds.has(circuitId)) continue
    removedCircuitIds.add(circuitId)
    for (const panel of panels) {
      const found = findCircuitById(panel, circuitId)
      if (!found) continue
      removedMemberIds.add(circuitId)
      found.circuit.endpoints.forEach((endpoint) => removedMemberIds.add(endpoint.id))
      found.circuit.trunkDevices?.forEach((device) => removedMemberIds.add(device.id))
      pending.push(...(found.circuit.subCircuitIds ?? []))
      break
    }
  }

  const visit = (panel: Panel) => {
    panel.circuits = panel.circuits.filter((circuit) => !removedCircuitIds.has(circuit.id))
    for (let index = panel.protections.length - 1; index >= 0; index--) {
      const protection = panel.protections[index]!
      const owned = protection.circuits ?? []
      const hasRemovedCircuit = owned.some((circuit) => removedCircuitIds.has(circuit.id))
      if (hasRemovedCircuit) {
        removedMemberIds.add(protection.id)
        panel.protections.splice(index, 1)
      } else {
        protection.circuits = owned.filter((circuit) => !removedCircuitIds.has(circuit.id))
      }
    }
    for (const circuit of getAllCircuits(panel)) {
      if (circuit.subCircuitIds) {
        circuit.subCircuitIds = circuit.subCircuitIds.filter((id) => !removedCircuitIds.has(id))
      }
      for (const device of circuit.trunkDevices ?? []) {
        if (!device.dcBusProps?.branchCircuitIds) continue
        device.dcBusProps.branchCircuitIds = device.dcBusProps.branchCircuitIds.filter(
          (id) => !removedCircuitIds.has(id)
        )
      }
    }
    panel.subPanels.forEach(visit)
  }
  panels.forEach(visit)
  return [...removedMemberIds]
}

export const createCircuitTrunkSlice: ProjectSliceCreator = (set, get) => ({
  // Circuit actions
  addCircuit: (panelId, circuit, protectionId) =>
    set((state) => {
      if (state.currentProject) {
        const panels = getEditableProjectElectricalPanels(state.currentProject)
        const panel = findPanelById(panels, panelId)
        if (panel) {
          const protection = protectionId
            ? panel.protections.find((candidate) => candidate.id === protectionId)
            : undefined
          if (protectionId && !protection) {
            logger.error('Refusing to create an orphan circuit: protection was not found', {
              panelId,
              protectionId,
              circuitId: circuit.id,
              circuitCode: circuit.code,
            })
            return
          }
          if (!protectionId && circuit.code !== 'PANEL') {
            logger.error('Refusing to create an orphan circuit without a protection', {
              panelId,
              circuitId: circuit.id,
              circuitCode: circuit.code,
            })
            return
          }

          if (!circuit.endpoints) {
            circuit.endpoints = []
          }

          if (protection) {
            if (!protection.circuits) {
              protection.circuits = []
            }
            protection.circuits.push(circuit)
          } else {
            // PANEL is the one supported direct circuit: it anchors a panel symbol on plan.
            panel.circuits.push(circuit)
          }
          state.isDirty = true
          maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, panelId)
        }
      }
    }),

  addCircuitToProtection: (panelId, protectionId, circuit) =>
    set((state) => {
      if (state.currentProject) {
        const panels = getEditableProjectElectricalPanels(state.currentProject)
        const panel = findPanelById(panels, panelId)
        if (panel) {
          const protection = panel.protections.find((p) => p.id === protectionId)
          if (protection) {
            if (!protection.circuits) {
              protection.circuits = []
            }
            protection.circuits.push(circuit)
            state.isDirty = true
            maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, panelId)
          }
        }
      }
    }),

  updateCircuit: (id, updates) =>
    set((state) => {
      if (state.currentProject) {
        for (const panel of getEditableProjectElectricalPanels(state.currentProject)) {
          const result = findCircuitById(panel, id)
          if (result) {
            // Store getters return Immer-frozen snapshots. Shallow-clone nested rows so
            // in-place naming (e.g. duplicate → automatic A1/A2 labels) can mutate them.
            let appliedUpdates = updates
            if (Array.isArray(appliedUpdates.endpoints)) {
              appliedUpdates = {
                ...appliedUpdates,
                endpoints: appliedUpdates.endpoints.map((ep) => ({
                  ...ep,
                  placements: (ep.placements ?? []).map((p) => ({ ...p })),
                })),
              }
            }
            if (Array.isArray(appliedUpdates.branches)) {
              appliedUpdates = {
                ...appliedUpdates,
                branches: appliedUpdates.branches.map((b) => ({
                  ...b,
                  endpointIds: [...(b.endpointIds ?? [])],
                  ...(b.branchDevices
                    ? {
                        branchDevices: b.branchDevices.map((device) => ({
                          ...device,
                          placements: (device.placements ?? []).map((placement) => ({
                            ...placement,
                          })),
                        })),
                      }
                    : {}),
                })),
              }
            }

            // Fast no-op: if this update doesn't actually change anything, skip.
            let hasAnyChange = false
            for (const [k, v] of Object.entries(appliedUpdates)) {
              const key = k as keyof Circuit
              if (key === 'code') {
                const next = typeof v === 'string' ? v : ''
                const curr = typeof result.circuit.code === 'string' ? result.circuit.code : ''
                if (next !== curr) hasAnyChange = true
                continue
              }
              const circuitValue = result.circuit[key as keyof Circuit]
              if (!Object.is(circuitValue, v)) {
                hasAnyChange = true
                break
              }
            }
            if (!hasAnyChange) return

            const oldCode = (result.circuit.code || '').trim()
            const newCode =
              typeof appliedUpdates.code === 'string' ? appliedUpdates.code.trim() : null

            if (newCode !== null && newCode !== oldCode) {
              migrateEndpointLabelsAfterCircuitCodeChange(result.circuit, oldCode, newCode)
              Object.assign(result.circuit, { ...appliedUpdates, code: newCode })
              if (result.parent && 'type' in result.parent && 'label' in result.parent) {
                result.parent.label = newCode
              }
            } else {
              Object.assign(result.circuit, appliedUpdates)
            }
            syncManualChronologyForInstallDateUpdate(
              state.currentProject,
              { id, type: 'circuit' },
              appliedUpdates
            )

            state.lastWorkedCircuitId = result.circuit.id
            state.isDirty = true

            const branchTopologyChanged =
              Object.prototype.hasOwnProperty.call(appliedUpdates, 'branches') ||
              Object.prototype.hasOwnProperty.call(appliedUpdates, 'endpoints') ||
              (newCode !== null && newCode !== oldCode)
            if (branchTopologyChanged) {
              syncSequentialEndpointBranchLabelsToCircuit(result.circuit)
              healPlanWiring(state.currentProject)
            }

            // Nesting, endpoints, or branch topology changes: refresh automatic ééndraad naming
            // (main-bus letters only — branch numbers A1, A2, … are synced above).
            const needsAutoNamingRefresh =
              !!getEditableProjectElectricalInstallation(state.currentProject)
                ?.eendraadAutomaticNaming &&
              (Object.prototype.hasOwnProperty.call(appliedUpdates, 'subCircuitIds') ||
                Object.prototype.hasOwnProperty.call(appliedUpdates, 'branches') ||
                Object.prototype.hasOwnProperty.call(appliedUpdates, 'endpoints'))
            if (needsAutoNamingRefresh) {
              for (const rootPanel of getEditableProjectElectricalPanels(state.currentProject)) {
                const ownerPanel = findPanelContainingCircuit(rootPanel, id)
                if (ownerPanel) {
                  maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, ownerPanel.id)
                  break
                }
              }
            }

            return
          }
        }
      }
    }),

  deleteCircuit: (id) =>
    set((state) => {
      if (state.currentProject) {
        const panels = getEditableProjectElectricalPanels(state.currentProject)
        let circuitLogLabel: string | null = null
        for (const panel of panels) {
          const hit = findCircuitById(panel, id)
          if (hit) {
            circuitLogLabel = hit.circuit.code?.trim() || id
            break
          }
        }

        let frameRemoval: ReturnType<typeof collectCircuitFrameRemovalIds> | undefined

        // Before removing, migrate subcircuit content back to parent if applicable
        for (const panel of panels) {
          const result = findCircuitById(panel, id)
          if (result) {
            frameRemoval = collectCircuitFrameRemovalIds(result.circuit)
            const parentInfo = findParentCircuitInfo(id, panels)
            if (parentInfo) {
              migrateCircuitContentToParent(result.circuit, parentInfo.parentCircuit)
              // Transfer subPanelId if the protection owning this circuit has one
              if (
                'type' in result.parent &&
                (result.parent as ProtectionDevice).subPanelId &&
                parentInfo.parentProtection
              ) {
                parentInfo.parentProtection.subPanelId = (
                  result.parent as ProtectionDevice
                ).subPanelId
                ;(result.parent as ProtectionDevice).subPanelId = undefined
              }
            }
            break
          }
        }

        // Helper to remove circuit from panel or protection
        const removeCircuit = (panel: Panel): boolean => {
          // Check direct circuits
          const index = panel.circuits.findIndex((c) => c.id === id)
          if (index !== -1) {
            panel.circuits.splice(index, 1)
            return true
          }

          // Check circuits under protections
          for (const protection of panel.protections) {
            if (protection.circuits) {
              const index = protection.circuits.findIndex((c) => c.id === id)
              if (index !== -1) {
                protection.circuits.splice(index, 1)
                return true
              }
            }
          }

          // Check sub-panels
          for (const subPanel of panel.subPanels) {
            if (removeCircuit(subPanel)) return true
          }
          return false
        }

        for (const panel of panels) {
          if (removeCircuit(panel)) {
            if (frameRemoval) {
              pruneEendraadFrames(state.currentProject, {
                removedMemberIds: frameRemoval.memberIds,
                removedCircuitIds: frameRemoval.circuitIds,
              })
            }
            healPlanWiring(state.currentProject)
            pruneStaleElectricalEndpointRecords(state.currentProject)
            state.isDirty = true
            if (circuitLogLabel) {
              recordSessionAction(`delete circuit "${circuitLogLabel}"`)
            }
            return
          }
        }
      }
    }),

  // Trunk device actions
  addTrunkDevice: (circuitId, device) =>
    set((state) => {
      if (state.currentProject) {
        const panels = getEditableProjectElectricalPanels(state.currentProject)
        for (const panel of panels) {
          const result = findCircuitById(panel, circuitId)
          if (result) {
            if (!result.circuit.trunkDevices) {
              result.circuit.trunkDevices = []
            }
            ensureRcboSensitivityOnTrunkDevice(device)
            // Insert in order by trunkPosition
            const insertIdx = result.circuit.trunkDevices.findIndex(
              (d) => d.trunkPosition > device.trunkPosition
            )
            if (insertIdx >= 0) {
              result.circuit.trunkDevices.splice(insertIdx, 0, device)
            } else {
              result.circuit.trunkDevices.push(device)
            }
            syncPanelAndSituationPlanDeviceVisibility(state.currentProject)
            state.isDirty = true
            return
          }
        }
      }
    }),

  updateTrunkDevice: (circuitId, deviceId, updates) =>
    set((state) => {
      if (state.currentProject) {
        const panels = getEditableProjectElectricalPanels(state.currentProject)
        for (const panel of panels) {
          const result = findCircuitById(panel, circuitId)
          if (result) {
            const device =
              result.circuit.trunkDevices?.find((d) => d.id === deviceId) ??
              result.circuit.branches
                ?.flatMap((branch) => branch.branchDevices ?? [])
                .find((d) => d.id === deviceId)
            if (device) {
              const trunkRef: PanelGridModuleRef = {
                kind: 'trunkDevice',
                id: deviceId,
                scope: 'circuit',
                circuitId,
              }
              const oldPoleWidth = getModuleWidthInCols(trunkRef, state.currentProject)
              const oldLabel = typeof device.label === 'string' ? device.label.trim() : ''
              const nextUpdates =
                result.circuit.code === 'PANEL' &&
                device.type === 'protection' &&
                typeof updates.label === 'string' &&
                getEditableProjectElectricalInstallation(state.currentProject)
                  ?.eendraadAutomaticNaming
                  ? {
                      ...updates,
                      label: resolveUniqueSupplyProtectionLabelOnPanel(
                        panel,
                        state.currentProject,
                        deviceId,
                        updates.label
                      ),
                    }
                  : updates
              Object.assign(device, nextUpdates)
              syncManualChronologyForInstallDateUpdate(
                state.currentProject,
                { id: deviceId, type: 'trunkDevice' },
                nextUpdates
              )
              ensureRcboSensitivityOnTrunkDevice(device)
              const newPoleWidth = getModuleWidthInCols(trunkRef, state.currentProject)
              if (oldPoleWidth !== newPoleWidth) {
                clearStaleAutoModuleWidthForModuleRef(panels, trunkRef, oldPoleWidth)
              }
              const newLabel =
                typeof nextUpdates.label === 'string' ? nextUpdates.label.trim() : oldLabel
              if (
                result.circuit.code === 'PANEL' &&
                Object.prototype.hasOwnProperty.call(updates, 'label') &&
                newLabel !== oldLabel &&
                getEditableProjectElectricalInstallation(state.currentProject)
                  ?.eendraadAutomaticNaming
              ) {
                maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, panel.id)
              }
              state.isDirty = true
              return
            }
          }
        }
      }
    }),

  deleteTrunkDevice: (circuitId, deviceId) =>
    set((state) => {
      if (state.currentProject) {
        const project = state.currentProject
        const installation = getProjectElectricalInstallation(project)
        const panels = getProjectElectricalPanels(project)
        let removedLabel: string | undefined
        for (const panel of panels) {
          const result = findCircuitById(panel, circuitId)
          if (result) {
            const branch = result.circuit.branches?.find((candidate) =>
              candidate.branchDevices?.some((device) => device.id === deviceId)
            )
            if (branch?.branchDevices) {
              const removed = branch.branchDevices.find((device) => device.id === deviceId)
              const removedMemberIds = new Set([deviceId])
              if (supportsCircuitConverterDcConnections(removed)) {
                const ownedEndpointIds = new Set(branch.endpointIds)
                for (const endpoint of result.circuit.endpoints) {
                  if (endpoint.converterDcConnection?.converterId === deviceId) {
                    ownedEndpointIds.add(endpoint.id)
                  }
                }
                ownedEndpointIds.forEach((id) => removedMemberIds.add(id))
                result.circuit.endpoints = result.circuit.endpoints.filter(
                  (endpoint) => !ownedEndpointIds.has(endpoint.id)
                )
                result.circuit.branches = (result.circuit.branches ?? [])
                  .map((candidate) => ({
                    ...candidate,
                    endpointIds: candidate.endpointIds.filter(
                      (endpointId) => !ownedEndpointIds.has(endpointId)
                    ),
                    branchDevices: candidate.branchDevices?.filter((device) => {
                      const isOwned =
                        device.id === deviceId ||
                        device.converterDcConnection?.converterId === deviceId
                      if (isOwned) removedMemberIds.add(device.id)
                      return !isOwned
                    }),
                  }))
                  .filter(
                    (candidate) =>
                      candidate.endpointIds.length > 0 || (candidate.branchDevices?.length ?? 0) > 0
                  )
              } else {
                branch.branchDevices = branch.branchDevices.filter(
                  (device) => device.id !== deviceId
                )
              }
              for (const removedId of removedMemberIds) {
                cleanupPanelGridSlotsForDevice(panels, {
                  kind: 'trunkDevice',
                  id: removedId,
                  scope: 'circuit',
                  circuitId,
                })
              }
              pruneEendraadFrames(project, { removedMemberIds: [...removedMemberIds] })
              healPlanWiring(project)
              pruneStaleElectricalEndpointRecords(project)
              state.isDirty = true
              break
            }
            if (!result.circuit.trunkDevices) continue
            const index = result.circuit.trunkDevices.findIndex((d) => d.id === deviceId)
            if (index !== -1) {
              const [removed] = result.circuit.trunkDevices.splice(index, 1)
              const linkedDevices =
                removed?.type === 'conversion'
                  ? result.circuit.trunkDevices.filter(
                      (device) => device.converterDcConnection?.converterId === deviceId
                    )
                  : []
              if (linkedDevices.length > 0) {
                const linkedIds = new Set(linkedDevices.map((device) => device.id))
                result.circuit.trunkDevices = result.circuit.trunkDevices.filter(
                  (device) => !linkedIds.has(device.id)
                )
              }
              const removedBusDevices = [removed, ...linkedDevices].filter(
                (device): device is NonNullable<typeof device> => device?.type === 'dc_bus'
              )
              const removedDcBusBranchMemberIds = removedBusDevices.flatMap((bus) => {
                const ownedBranches = (result.circuit.branches ?? []).filter(
                  (branch) => branch.dcBusId === bus.id
                )
                const endpointIds = new Set(ownedBranches.flatMap((branch) => branch.endpointIds))
                result.circuit.endpoints = result.circuit.endpoints.filter(
                  (endpoint) => !endpointIds.has(endpoint.id)
                )
                result.circuit.branches = (result.circuit.branches ?? []).filter(
                  (branch) => branch.dcBusId !== bus.id
                )
                return [
                  ...ownedBranches.map((branch) => branch.id),
                  ...ownedBranches.flatMap((branch) =>
                    (branch.branchDevices ?? []).map((device) => device.id)
                  ),
                  ...endpointIds,
                ]
              })
              const dcBusRemovedIds = removedBusDevices.flatMap((bus) =>
                removeDcBusBranches(panels, bus.id, bus.dcBusProps?.branchCircuitIds ?? [])
              )
              const removedEmptyDcBranchIds =
                result.circuit.dcBusSource?.busId &&
                !('symbol' in result.parent) &&
                result.parent.directDcBusFeeder === true &&
                result.circuit.endpoints.length === 0 &&
                (result.circuit.trunkDevices?.length ?? 0) === 0 &&
                (result.circuit.subCircuitIds?.length ?? 0) === 0
                  ? removeDcBusBranches(panels, result.circuit.dcBusSource.busId, [
                      result.circuit.id,
                    ])
                  : []
              for (const endpoint of result.circuit.endpoints) {
                if (endpoint.converterDcConnection?.converterId === deviceId) {
                  delete endpoint.converterDcConnection
                }
              }
              if (removed?.type === 'junction_panel') {
                removedLabel = removed.label
              }
              const deviceRef: PanelGridModuleRef = {
                kind: 'trunkDevice',
                id: deviceId,
                scope: 'circuit',
                circuitId,
              }
              cleanupPanelGridSlotsForDevice(panels, deviceRef)
              pruneEendraadFrames(project, {
                removedMemberIds: [
                  deviceId,
                  ...linkedDevices.map((device) => device.id),
                  ...removedDcBusBranchMemberIds,
                  ...dcBusRemovedIds,
                  ...removedEmptyDcBranchIds,
                ],
              })
              state.isDirty = true
              break
            }
          }
        }
        if (removedLabel && installation?.junctionPanelPlacements) {
          const remainingDevices: { label?: string }[] = []
          installation.mainSupply?.supplyTrunkDevices?.forEach((d) => {
            if (d.type === 'junction_panel') remainingDevices.push({ label: d.label })
          })
          for (const device of collectAllGroundTrunkDevices(panels, installation)) {
            if (device.type === 'junction_panel') remainingDevices.push({ label: device.label })
          }
          for (const panel of panels) {
            const circuits = getAllCircuits(panel)
            circuits.forEach((c) =>
              c.trunkDevices?.forEach((d) => {
                if (d.type === 'junction_panel') remainingDevices.push({ label: d.label })
              })
            )
          }
          const stillUsed = remainingDevices.some((d) => d.label === removedLabel)
          if (!stillUsed) {
            installation.junctionPanelPlacements = installation.junctionPanelPlacements.filter(
              (jp) => jp.label !== removedLabel
            )
          }
        }
      }
    }),

  moveTrunkDeviceInCircuit: (circuitId, deviceId, direction, parentCircuitId) =>
    set((state) => {
      logger.info('[moveTrunkDeviceInCircuit]', {
        circuitId,
        deviceId,
        direction,
        parentCircuitId,
      })
      if (!state.currentProject) {
        logger.warn('[moveTrunkDeviceInCircuit] No current project')
        return
      }

      // If parentCircuitId is provided, this is a single nested circuit case
      // We need to move devices between parent and nested circuits
      if (parentCircuitId) {
        for (const panel of getEditableProjectElectricalPanels(state.currentProject)) {
          const nestedResult = findCircuitById(panel, circuitId)
          const parentResult = findCircuitById(panel, parentCircuitId)

          if (!nestedResult || !parentResult) continue

          const nestedCircuit = nestedResult.circuit
          const parentCircuit = parentResult.circuit

          // Get all devices from both circuits
          const nestedDevices = nestedCircuit.trunkDevices || []
          const parentDevices = parentCircuit.trunkDevices || []

          // Combine and sort by trunkPosition
          const allDevices = [...parentDevices, ...nestedDevices]
          const sorted = [...allDevices].sort(
            (a, b) => (a.trunkPosition || 0) - (b.trunkPosition || 0)
          )
          const index = sorted.findIndex((d) => d.id === deviceId)

          if (index === -1) {
            logger.warn('[moveTrunkDeviceInCircuit] Device not found in combined list', {
              deviceId,
              circuitId,
              parentCircuitId,
            })
            return
          }

          logger.info('[moveTrunkDeviceInCircuit] Found device in combined list', {
            index,
            total: sorted.length,
            isInParent: parentDevices.some((d) => d.id === deviceId),
            isInNested: nestedDevices.some((d) => d.id === deviceId),
          })

          if (
            direction === 'up' &&
            (index > 0 || (index === 0 && parentDevices.length === 0 && nestedDevices.length > 0))
          ) {
            // Special case: moving from nested to empty parent (index 0, parent empty)
            if (index === 0 && parentDevices.length === 0 && nestedDevices.length > 0) {
              // Move first nested device to parent
              const device = nestedDevices.find((d) => d.id === deviceId)!
              const idx = nestedDevices.indexOf(device)
              nestedDevices.splice(idx, 1)
              if (!parentCircuit.trunkDevices) parentCircuit.trunkDevices = []
              parentCircuit.trunkDevices.push(device)
              // Set trunkPosition to 0 for the first device in parent
              device.trunkPosition = 0
              logger.info('[moveTrunkDeviceInCircuit] Moved from nested to empty parent', {
                deviceId,
              })
              state.isDirty = true
              return
            }

            // Normal case: swap with previous device
            const prevDevice = sorted[index - 1]
            const currentDevice = sorted[index]
            if (!prevDevice || !currentDevice) return

            // Swap positions
            const tempPos = currentDevice.trunkPosition || 0
            currentDevice.trunkPosition = prevDevice.trunkPosition || 0
            prevDevice.trunkPosition = tempPos

            // If device moved from nested to parent or vice versa, update which circuit it belongs to
            const wasInParent = parentDevices.some((d) => d.id === deviceId)
            const prevWasInParent = parentDevices.some((d) => d.id === prevDevice.id)

            if (wasInParent && !prevWasInParent) {
              // Moving from parent to nested
              const device = parentDevices.find((d) => d.id === deviceId)!
              const idx = parentDevices.indexOf(device)
              parentDevices.splice(idx, 1)
              if (!nestedCircuit.trunkDevices) nestedCircuit.trunkDevices = []
              nestedCircuit.trunkDevices.push(device)
            } else if (!wasInParent && prevWasInParent) {
              // Moving from nested to parent
              const device = nestedDevices.find((d) => d.id === deviceId)!
              const idx = nestedDevices.indexOf(device)
              nestedDevices.splice(idx, 1)
              if (!parentCircuit.trunkDevices) parentCircuit.trunkDevices = []
              parentCircuit.trunkDevices.push(device)
            }

            logger.info('[moveTrunkDeviceInCircuit] Moved up in combined list', {
              newIndex: index - 1,
            })
            state.isDirty = true
            return
          } else if (direction === 'down' && index < sorted.length - 1) {
            const nextDevice = sorted[index + 1]
            const currentDevice = sorted[index]
            if (!nextDevice || !currentDevice) return

            // Swap positions
            const tempPos = currentDevice.trunkPosition || 0
            currentDevice.trunkPosition = nextDevice.trunkPosition || 0
            nextDevice.trunkPosition = tempPos

            // If device moved from nested to parent or vice versa, update which circuit it belongs to
            const wasInParent = parentDevices.some((d) => d.id === deviceId)
            const nextWasInParent = parentDevices.some((d) => d.id === nextDevice.id)

            if (wasInParent && !nextWasInParent) {
              // Moving from parent to nested
              const device = parentDevices.find((d) => d.id === deviceId)!
              const idx = parentDevices.indexOf(device)
              parentDevices.splice(idx, 1)
              if (!nestedCircuit.trunkDevices) nestedCircuit.trunkDevices = []
              nestedCircuit.trunkDevices.push(device)
            } else if (!wasInParent && nextWasInParent) {
              // Moving from nested to parent
              const device = nestedDevices.find((d) => d.id === deviceId)!
              const idx = nestedDevices.indexOf(device)
              nestedDevices.splice(idx, 1)
              if (!parentCircuit.trunkDevices) parentCircuit.trunkDevices = []
              parentCircuit.trunkDevices.push(device)
            }

            logger.info('[moveTrunkDeviceInCircuit] Moved down in combined list', {
              newIndex: index + 1,
            })
            state.isDirty = true
            return
          } else {
            logger.info('[moveTrunkDeviceInCircuit] Cannot move in combined list', {
              direction,
              index,
              length: sorted.length,
            })
          }
        }
        return
      }

      // Normal case: just move within a single circuit
      for (const panel of getEditableProjectElectricalPanels(state.currentProject)) {
        const result = findCircuitById(panel, circuitId)
        if (result && result.circuit.trunkDevices) {
          const devices = result.circuit.trunkDevices
          // Sort by trunkPosition to get current order
          const sorted = [...devices].sort(
            (a, b) => (a.trunkPosition || 0) - (b.trunkPosition || 0)
          )
          const index = sorted.findIndex((d) => d.id === deviceId)
          if (index === -1) {
            logger.warn('[moveTrunkDeviceInCircuit] Device not found', { deviceId, circuitId })
            return
          }
          logger.info('[moveTrunkDeviceInCircuit] Found device', { index, total: sorted.length })

          if (direction === 'up' && index > 0) {
            // Move up (earlier position = lower trunkPosition)
            const prevDevice = sorted[index - 1]
            const currentDevice = sorted[index]
            if (!prevDevice || !currentDevice) return
            const tempPos = currentDevice.trunkPosition || 0
            currentDevice.trunkPosition = prevDevice.trunkPosition || 0
            prevDevice.trunkPosition = tempPos
            logger.info('[moveTrunkDeviceInCircuit] Moved up', {
              newIndex: index - 1,
              positions: sorted.map((d) => ({ id: d.id, pos: d.trunkPosition })),
            })
            state.isDirty = true
            return
          } else if (direction === 'down' && index < sorted.length - 1) {
            // Move down (later position = higher trunkPosition)
            const nextDevice = sorted[index + 1]
            const currentDevice = sorted[index]
            if (!nextDevice || !currentDevice) return
            const tempPos = currentDevice.trunkPosition || 0
            currentDevice.trunkPosition = nextDevice.trunkPosition || 0
            nextDevice.trunkPosition = tempPos
            logger.info('[moveTrunkDeviceInCircuit] Moved down', {
              newIndex: index + 1,
              positions: sorted.map((d) => ({ id: d.id, pos: d.trunkPosition })),
            })
            state.isDirty = true
            return
          } else {
            logger.info('[moveTrunkDeviceInCircuit] Cannot move', {
              direction,
              index,
              length: sorted.length,
            })
          }
        }
      }
    }),

  relocateCircuitTrunkDevice: (deviceId, dropTarget): boolean => {
    const projectBefore = get().currentProject
    if (!projectBefore) return false
    const snapshotBefore = captureProjectForHistory(projectBefore)
    let ok: boolean = false
    let sourceCircuitIdForLog: string | undefined
    projectHistory.suppressNextDebouncedRun()
    try {
      set((state) => {
        if (!state.currentProject) return
        let sourceCircuitId: string | undefined
        let symbolKey: string | undefined
        for (const panel of getEditableProjectElectricalPanels(state.currentProject)) {
          for (const c of getAllCircuits(panel)) {
            const d = c.trunkDevices?.find((x) => x.id === deviceId)
            if (d) {
              sourceCircuitId = c.id
              symbolKey = d.symbol
              break
            }
          }
          if (sourceCircuitId) break
        }
        if (!sourceCircuitId || !symbolKey) return
        sourceCircuitIdForLog = sourceCircuitId
        const symbol = getSymbolById(symbolKey)
        if (!symbol) return
        ok = mutateTrunkDeviceRelocation(
          state.currentProject,
          { id: deviceId, sourceCircuitId },
          dropTarget,
          symbol
        )
        if (ok) {
          if (dropTarget.type === 'circuit' && dropTarget.circuitId) {
            rewriteRelocatedCircuitTrunkDeviceGridRef(
              state.currentProject,
              deviceId,
              sourceCircuitId,
              dropTarget.circuitId
            )
          } else if (dropTarget.type === 'supplyConverterDcWire') {
            const sourcePanel = getProjectElectricalPanels(state.currentProject)
              .map((panel) => findPanelContainingCircuit(panel, sourceCircuitId))
              .find((panel): panel is Panel => !!panel)
            for (const panelId of new Set([sourcePanel?.id, dropTarget.panelId])) {
              if (!panelId) continue
              reconcileDirectConverterDcDevices(state.currentProject, panelId)
              reconcileSupplyAssemblyBranchProtections(state.currentProject, panelId)
            }
          }
          state.isDirty = true
        }
      })
    } finally {
      projectHistory.clearDebouncedSuppression()
    }
    if (trunkDnDCommitLogEnabled()) {
      logTrunkDnDCommit('relocateCircuitTrunkDevice', {
        deviceId,
        ok,
        sourceCircuitId: sourceCircuitIdForLog,
        targetCircuitId: dropTarget.circuitId,
        dropTarget: summarizeDropTarget(dropTarget),
      })
    }
    if (ok) {
      appendUndoSnapshotInStore(set, snapshotBefore)
      recordSessionAction('relocate circuit trunk device')
    }
    return ok
  },

  // Supply trunk device actions (devices on the main supply wire)
  addSupplyTrunkDevice: (device, insertIndex, target) =>
    set((state) => {
      if (state.currentProject) {
        const scope = target?.feedScope ?? 'shared'
        // Hit zones carry electrical ownership explicitly. Retain diagram identity
        // as a fallback for older callers that do not yet provide that contract.
        const isContinuationDiagramDrop =
          !isSupplyBranchDevice(device) &&
          (target?.supplyPanelInput ?? (!!target?.panelId &&
            target.diagramId === target.panelId &&
            isPanelSupplyFrameDetached(state.currentProject, target.panelId)))
        const feedScope = isContinuationDiagramDrop ? 'root' : scope
        const devices = getSupplyFeedListForTarget(
          state.currentProject,
          target?.panelId,
          feedScope,
          target?.busSectionId
        )
        if (isContinuationDiagramDrop && target?.panelId) {
          const source = devices.find((item) => item.symbol === 'source_changeover') ??
            devices.find((item) => item.supplyPath === 'converter-branch')
          if (source && !assemblyOwnsSupplyDevice(state.currentProject, source.id)) {
            const backupConverter = devices.find((item) =>
              item.type === 'conversion' && item.supplyPath === 'backup')
            editProjectSupplyAssemblies(state.currentProject).push(
              source.symbol === 'source_changeover'
                ? backupConverter
                  ? attachBackupConverterToAssembly(state.currentProject, target.panelId, source, backupConverter)
                  : buildChangeoverSupplyAssembly(state.currentProject, target.panelId, source)
                : buildDirectConverterSupplyAssembly(state.currentProject, target.panelId, source)
            )
            reconcileSupplyAssemblyBranchProtections(state.currentProject, target.panelId)
            reconcileDirectConverterDcDevices(state.currentProject, target.panelId)
          }
        }
        const insertFloor = isContinuationDiagramDrop
          ? firstPanelLocalRootSupplyInsertIndex(state.currentProject, devices)
          : 0
        const firstPanelInput = devices.findIndex((item) => item.supplyPanelInput)
        const insertCeiling = !isContinuationDiagramDrop && firstPanelInput !== -1
          ? firstPanelInput : devices.length
        const idx = clamp(insertIndex ?? insertCeiling, insertFloor, insertCeiling)
        if (isContinuationDiagramDrop) device.supplyPanelInput = true
        devices.splice(idx, 0, device)
        devices.forEach((item, index) => {
          item.trunkPosition = index
        })
        if (device.supplyPath === 'converter-branch') {
          setSupplyDevicePanelVisibility(state.currentProject, device.id, true)
          const placementIds = new Set((device.placements ?? []).map((placement) => placement.id))
          if (placementIds.size > 0) {
            mutateBuildingFloorViews(state.currentProject, (floors) => {
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
          reconcileSupplyAssemblyBranchProtections(state.currentProject, target.panelId)
          reconcileDirectConverterGridProtections(state.currentProject, target.panelId)
        }
        if (
          target?.panelId &&
          (device.supplyPath === 'converter-dc' || device.supplyPath === 'converter-dc-top')
        ) {
          reconcileDirectConverterDcDevices(state.currentProject, target.panelId)
          const dcPersistenceSummary = summarizeConverterDcPersistence(state.currentProject)
          if (dcPersistenceSummary) {
            logger.debug('[SUPPLY-PERSIST] added converter DC device', dcPersistenceSummary)
          }
        }
        const commonOutputOwner = findPanelOwningSupplyDevice(state.currentProject, device.id)
        if (commonOutputOwner && !isContinuationDiagramDrop) {
          reconcileSupplyAssemblyBranchProtections(state.currentProject, commonOutputOwner.id, {
            absorbDeviceIds: [device.id],
          })
          reconcileDirectConverterCommonLoadPath(state.currentProject, commonOutputOwner.id, {
            absorbDeviceIds: [device.id],
          })
        }
        syncPanelAndSituationPlanDeviceVisibility(state.currentProject)
        state.isDirty = true
      }
    }),

  updateSupplyTrunkDevice: (deviceId, updates) =>
    set((state) => {
      if (state.currentProject) {
        const container = findSupplyDeviceContainer(state.currentProject, deviceId)
        const devices = container?.devices
        if (devices) {
          const device = devices.find((d) => d.id === deviceId)
          if (!device) return
          const supplyRef: PanelGridModuleRef = {
            kind: 'trunkDevice',
            id: deviceId,
            scope: 'supply',
          }
          const oldPoleWidth = getModuleWidthInCols(supplyRef, state.currentProject)
          const oldLabel = typeof device.label === 'string' ? device.label.trim() : ''
          const owningPanel = findPanelOwningSupplyDevice(state.currentProject, deviceId)
          const nextUpdates =
            device.type === 'protection' &&
            typeof updates.label === 'string' &&
            owningPanel &&
            getEditableProjectElectricalInstallation(state.currentProject)?.eendraadAutomaticNaming
              ? {
                  ...updates,
                  label: resolveUniqueSupplyProtectionLabelOnPanel(
                    owningPanel,
                    state.currentProject,
                    deviceId,
                    updates.label
                  ),
                }
              : updates
          Object.assign(device, nextUpdates)
          // Legacy direct supply drawings may not have materialized their graph yet.
          // Create it on an explicit AC-mode edit before reconciling its ports and loads.
          if (
            owningPanel && device.symbol === 'inverter' &&
            device.supplyPath === 'converter-branch' &&
            (updates.converterAcConnection === 'shared' || updates.converterAcConnection === 'separate') &&
            !assemblyOwnsSupplyDevice(state.currentProject, deviceId)
          ) {
            editProjectSupplyAssemblies(state.currentProject).push(
              buildDirectConverterSupplyAssembly(state.currentProject, owningPanel.id, device)
            )
            reconcileDirectConverterDcDevices(state.currentProject, owningPanel.id)
          }
          if (
            owningPanel &&
            (device.supplyPath === 'backup-output' ||
              device.supplyPath === 'changeover-grid' ||
              device.supplyPath === 'converter-grid')
          ) {
            reconcileSupplyAssemblyBranchProtections(state.currentProject, owningPanel.id)
            reconcileDirectConverterGridProtections(state.currentProject, owningPanel.id)
          }
          if (
            owningPanel &&
            (device.supplyPath === 'converter-dc' || device.supplyPath === 'converter-dc-top')
          ) {
            reconcileDirectConverterDcDevices(state.currentProject, owningPanel.id)
          }
          if (owningPanel && device.type === 'conversion') {
            if (device.supplyPath === 'backup') {
              reconcileSupplyAssemblyBranchProtections(state.currentProject, owningPanel.id)
            } else if (device.supplyPath === 'converter-branch') {
              reconcileDirectConverterGridProtections(state.currentProject, owningPanel.id)
            }
          }
          if (
            device.symbol === 'inverter' &&
            (device.supplyPath === 'backup' || device.supplyPath === 'converter-branch')
          ) {
            reconcileInverterUnitMultiplier(state.currentProject, device)
            if (owningPanel && device.supplyPath === 'backup') {
              syncPanelBackupBusPhaseOrderInProject(state.currentProject, owningPanel.id)
            }
          }
          if (device.symbol === 'source_changeover') {
            reconcileChangeoverSupplyAssembly(state.currentProject, device)
            if (owningPanel) {
              syncPanelBackupBusPhaseOrderInProject(state.currentProject, owningPanel.id)
            }
          }
          if (owningPanel && assemblyOwnsSupplyDevice(state.currentProject, deviceId)) {
            reconcileSupplyAssemblyBranchProtections(state.currentProject, owningPanel.id)
            reconcileDirectConverterCommonLoadPath(state.currentProject, owningPanel.id)
            reconcileSupplyAssemblyAcConductorFlow(
              state.currentProject,
              container?.scope === 'shared' ? undefined : owningPanel.id
            )
          }
          syncManualChronologyForInstallDateUpdate(
            state.currentProject,
            { id: deviceId, type: 'trunkDevice' },
            nextUpdates
          )
          const newPoleWidth = getModuleWidthInCols(supplyRef, state.currentProject)
          if (oldPoleWidth !== newPoleWidth) {
            clearStaleAutoModuleWidthForModuleRef(
              getEditableProjectElectricalPanels(state.currentProject),
              supplyRef,
              oldPoleWidth
            )
          }
          const newLabel =
            typeof nextUpdates.label === 'string' ? nextUpdates.label.trim() : oldLabel
          if (
            Object.prototype.hasOwnProperty.call(updates, 'label') &&
            newLabel !== oldLabel &&
            getEditableProjectElectricalInstallation(state.currentProject)?.eendraadAutomaticNaming
          ) {
            refreshAutomaticNamingForPanelsShowingSupplyDevice(state.currentProject, deviceId)
          }
          state.isDirty = true
        }
      }
    }),

  deleteSupplyTrunkDevice: (deviceId) =>
    set((state) => {
      if (state.currentProject) {
        const project = state.currentProject
        const installation = getProjectElectricalInstallation(project)
        const panels = getProjectElectricalPanels(project)
        if (!installation) return
        let removedLabel: string | undefined
        const container = findSupplyDeviceContainer(project, deviceId)
        const devices = container?.devices
        if (devices) {
          const index = devices.findIndex((d) => d.id === deviceId)
          if (index !== -1) {
            const owningPanel = findPanelOwningSupplyDevice(project, deviceId)
            const target = devices[index]
            const removedIds = new Set([deviceId])
            if (target?.type === 'dc_bus') {
              devices.forEach((device) => {
                if (device.supplyDcBusId === target.id) removedIds.add(device.id)
              })
            }
            let downgradedGridOrder: string[] | undefined
            if (target?.symbol === 'source_changeover') {
              const backupOutputDevices = devices.filter(
                (device) => device.supplyPath === 'backup-output'
              )
              // Devices after the selector are on its load side even though they are
              // stored as ordinary serial devices. They belong to the selector branch and
              // must be removed with it instead of being left on the restored grid lane.
              const loadSideSerialDevices = devices
                .slice(index + 1)
                .filter((device) => device.supplyPath == null || device.supplyPath === 'serial')
              const changeoverOwnedDevices = [
                ...backupOutputDevices,
                ...loadSideSerialDevices,
                ...devices.filter((device) => device.supplyPath === 'changeover-grid'),
              ]
              changeoverOwnedDevices.forEach((device) => removedIds.add(device.id))
              const backupConverter = devices.find(
                (device) => device.supplyPath === 'backup' && device.symbol === 'inverter'
              )
              const downgraded =
                owningPanel && backupConverter
                  ? downgradeChangeoverToDirectConverterAssembly(
                      project,
                      owningPanel.id,
                      target.id,
                      backupConverter
                    )
                  : undefined
              if (downgraded) {
                downgradedGridOrder = [
                  ...devices.filter((device) => device.supplyPath === 'converter-grid'),
                ].map((device) => device.id)
                const assemblies = editProjectSupplyAssemblies(project)
                const assemblyIndex = assemblies.findIndex(
                  (assembly) => assembly.id === downgraded.id
                )
                if (assemblyIndex >= 0) assemblies[assemblyIndex] = downgraded
                else assemblies.push(downgraded)
              }
              devices.forEach((device) => {
                if (downgraded && device.id === backupConverter?.id) {
                  device.supplyPath = 'converter-branch'
                } else if (
                  !downgraded &&
                  device.supplyPath &&
                  new Set([
                    'backup',
                    'backup-output',
                    'converter-grid',
                    'converter-dc',
                    'converter-dc-top',
                    'converter-branch',
                  ]).has(device.supplyPath)
                ) {
                  removedIds.add(device.id)
                }
              })
            } else if (target?.supplyPath === 'converter-branch') {
              devices.forEach((device) => {
                if (
                  device.supplyPath === 'converter-dc' ||
                  device.supplyPath === 'converter-dc-top'
                )
                  removedIds.add(device.id)
              })
              const dependentIds = removeConverterBackupDependents(panels, target.id)
              dependentIds.forEach((id) => removedIds.add(id))
            }
            const removedDevices = devices.filter((device) => removedIds.has(device.id))
            for (let deviceIndex = devices.length - 1; deviceIndex >= 0; deviceIndex--) {
              if (removedIds.has(devices[deviceIndex]!.id)) {
                devices.splice(deviceIndex, 1)
              }
            }
            if (downgradedGridOrder?.length) {
              const order = new Map(downgradedGridOrder.map((id, orderIndex) => [id, orderIndex]))
              const gridDevices = devices
                .filter((device) => order.has(device.id))
                .sort((left, right) => order.get(left.id)! - order.get(right.id)!)
              for (let deviceIndex = devices.length - 1; deviceIndex >= 0; deviceIndex--) {
                if (order.has(devices[deviceIndex]!.id)) devices.splice(deviceIndex, 1)
              }
              const converterIndex = devices.findIndex(
                (device) => device.supplyPath === 'converter-branch'
              )
              devices.splice(
                converterIndex < 0 ? devices.length : converterIndex,
                0,
                ...gridDevices
              )
            }
            devices.forEach((device, deviceIndex) => {
              device.trunkPosition = deviceIndex
            })
            const removed = removedDevices.find((device) => device.id === deviceId)
            if (
              removed?.symbol === 'source_changeover' ||
              removed?.supplyPath === 'backup' ||
              removed?.supplyPath === 'converter-branch'
            ) {
              const assemblies = editProjectSupplyAssemblies(project)
              for (let assemblyIndex = assemblies.length - 1; assemblyIndex >= 0; assemblyIndex--) {
                const assembly = assemblies[assemblyIndex]!
                if (
                  assembly.nodes.some((node) => removedIds.has(node.deviceId ?? node.id)) ||
                  assembly.connections.some((connection) =>
                    connection.endpoints.some((endpoint) => removedIds.has(endpoint.nodeId))
                  ) ||
                  assembly.loadHandoffs.some((handoff) => removedIds.has(handoff.handoffNodeId))
                ) {
                  assemblies.splice(assemblyIndex, 1)
                }
              }
            }
            if (removed?.type === 'junction_panel') {
              removedLabel = removed.label
            }
            if (
              owningPanel &&
              (removed?.supplyPath === 'backup-output' ||
                removed?.supplyPath === 'changeover-grid' ||
                removed?.supplyPath === 'converter-grid')
            ) {
              reconcileSupplyAssemblyBranchProtections(project, owningPanel.id)
              reconcileDirectConverterGridProtections(project, owningPanel.id)
            }
            if (
              owningPanel &&
              (removed?.supplyPath === 'converter-dc' || removed?.supplyPath === 'converter-dc-top')
            ) {
              reconcileDirectConverterDcDevices(project, owningPanel.id)
            }
            if (owningPanel && target?.symbol === 'source_changeover') {
              reconcileDirectConverterGridProtections(project, owningPanel.id)
              reconcileDirectConverterDcDevices(project, owningPanel.id)
              syncPanelBackupBusPhaseOrderInProject(project, owningPanel.id)
            }
            if (owningPanel) {
              reconcileSupplyAssemblyBranchProtections(project, owningPanel.id)
              reconcileDirectConverterCommonLoadPath(project, owningPanel.id)
            }
            for (const removedId of removedIds) {
              const deviceRef: PanelGridModuleRef = {
                kind: 'trunkDevice',
                id: removedId,
                scope: 'supply',
              }
              cleanupPanelGridSlotsForDevice(panels, deviceRef)
            }
            pruneEendraadFrames(project, { removedMemberIds: [...removedIds] })
            reconcileInvalidPanelFeedOrganizationsInProject(project)
            syncPanelAndSituationPlanDeviceVisibility(project)
            state.isDirty = true
          }
        }
        if (removedLabel && installation.junctionPanelPlacements) {
          const remainingDevices: { label?: string }[] = []
          ensureInstallationFeedTopology(installation, panels).sharedFeed.trunkDevices?.forEach(
            (d) => {
              if (d.type === 'junction_panel') remainingDevices.push({ label: d.label })
            }
          )
          ensureInstallationFeedTopology(installation, panels).rootFeeds.forEach((feed) =>
            (feed.trunkDevices ?? []).forEach((d) => {
              if (d.type === 'junction_panel') remainingDevices.push({ label: d.label })
            })
          )
          for (const device of collectAllGroundTrunkDevices(panels, installation)) {
            if (device.type === 'junction_panel') remainingDevices.push({ label: device.label })
          }
          for (const panel of panels) {
            const circuits = getAllCircuits(panel)
            circuits.forEach((c) =>
              c.trunkDevices?.forEach((d) => {
                if (d.type === 'junction_panel') remainingDevices.push({ label: d.label })
              })
            )
          }
          const stillUsed = remainingDevices.some((d) => d.label === removedLabel)
          if (!stillUsed) {
            installation.junctionPanelPlacements = installation.junctionPanelPlacements.filter(
              (jp) => jp.label !== removedLabel
            )
          }
        }
      }
    }),

  moveSupplyTrunkDevice: (deviceId, direction) =>
    set((state) => {
      logger.info('[moveSupplyTrunkDevice]', { deviceId, direction })
      if (!state.currentProject) {
        logger.warn('[moveSupplyTrunkDevice] No current project')
        return
      }
      const container = findSupplyDeviceContainer(state.currentProject, deviceId)
      const devices = container?.devices
      if (!devices) {
        logger.warn('[moveSupplyTrunkDevice] No supply trunk devices')
        return
      }
      const index = devices.findIndex((d) => d.id === deviceId)
      if (index === -1) {
        logger.warn('[moveSupplyTrunkDevice] Device not found', { deviceId })
        return
      }
      logger.info('[moveSupplyTrunkDevice] Found device', { index, total: devices.length })

      // Array order = supply (index 0) to main bus (last). Left = toward main bus; right = toward supply.
      let moved = false
      if (direction === 'left' && index < devices.length - 1) {
        // Move left (toward main bus): swap with next in array (higher index)
        const temp = devices[index]!
        devices[index] = devices[index + 1]!
        devices[index + 1] = temp
        logger.info('[moveSupplyTrunkDevice] Moved left', { newIndex: index + 1 })
        moved = true
        state.isDirty = true
      } else if (direction === 'right' && index > 0) {
        // Move right (toward supply): swap with previous in array (lower index)
        const temp = devices[index]!
        devices[index] = devices[index - 1]!
        devices[index - 1] = temp
        logger.info('[moveSupplyTrunkDevice] Moved right', { newIndex: index - 1 })
        moved = true
        state.isDirty = true
      } else {
        logger.info('[moveSupplyTrunkDevice] Cannot move', {
          direction,
          index,
          length: devices.length,
        })
      }
      if (moved) {
        devices.forEach((item, itemIndex) => {
          item.trunkPosition = itemIndex
        })
        const owningPanel = findPanelOwningSupplyDevice(state.currentProject, deviceId)
        if (owningPanel) {
          reconcileSupplyAssemblyBranchProtections(state.currentProject, owningPanel.id)
          reconcileDirectConverterCommonLoadPath(state.currentProject, owningPanel.id)
        }
      }

      // IMPORTANT: Reordering supply wire must not auto-repack panel slots.
      // Keep manual supply panel positions untouched; only wire order changes.
      if (moved) {
        logger.info('[moveSupplyTrunkDevice] Supply wire order updated without slot repack')
      }
    }),
})
