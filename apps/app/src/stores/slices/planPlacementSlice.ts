import {
  appendUndoSnapshotInStore,
  captureProjectForHistory,
  getProjectStoreApi,
  projectHistory,
} from './projectStoreHistory'
import type { Project, ProjectSliceCreator } from './projectStoreTypes'
import { recordSessionAction } from '@/lib/diagnostics/sessionActionLog'
import { syncSequentialEndpointBranchLabelsToCircuit } from '@/lib/eendraad/automaticEndpointBranchNaming'
import { applyDomoticaRowLabelEdit } from '@/lib/eendraad/domoticaRowLabel'
import { syncDerivedEndpointFlags } from '@/lib/eendraad/endpointInsertAfter'
import { getEarthingSeparatorPairIds } from '@/lib/eendraad/earthingSeparatorPairs'
import {
  applySecondaryPanelEarthingStem,
  collectAllGroundTrunkDevices,
  findGroundTrunkDeviceOwner,
} from '@/lib/eendraad/panelGround'
import { pruneEendraadFrames } from '@/lib/eendraad/frameContent'
import { logger } from '@/lib/logger'
import {
  EENDRAAD_NAMING_DEBUG,
  cleanupPanelGridSlotsForDevice,
  collectDomoticaEndpointIdsForDeletion,
  deletePanelFromProject,
  findCircuitById,
  findCircuitOwner,
  findEndpointById,
  getAllCircuits,
  getAllEndpoints,
  getOwningProtectionForCircuit,
  maybeApplyAutomaticEendraadNamingForPanel,
  normalizeDomoticaCircuit,
  pruneStaleElectricalEndpointRecords,
  removeEndpointIdsFromCircuit,
  syncManualChronologyForInstallDateUpdate,
} from '@/lib/eendraad/projectElectricalDomain'
import { withCustomPlacementFlag } from '@/lib/plan/customPlacement'
import {
  isMainPanelDistributionEndpoint,
  resolvePanelForDistributionEndpoint,
} from '@/lib/plan/panelDistributionEndpoint'
import { healPlanWiring } from '@/lib/plan/planWiring'
import { syncPanelAndSituationPlanDeviceVisibility } from '@/lib/plan/panelPlanPlacementVisibility'
import { inheritEendraadLayoutForVisualEndpointChange } from '@/lib/layout/eendraadDerivedLayout'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import {
  selectProjectPlanWireRoutes,
  replacePlanWireRoutesForProject,
} from '@/lib/projectV2/planWiring'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  getEditableProjectElectricalInstallation,
  getEditableProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import type {
  Circuit,
  Endpoint,
  Installation,
  JunctionPanelPlacement,
  Panel,
  Placement,
  ProtectionDevice,
} from '@/types/schema'
import {
  findCircuitForEndpointInPanel,
  generateId,
  getNextAvailableCircuitCode,
} from '@/utils/project'
import { findPanelById } from '@/lib/panel/panelTree'
import { getAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { removeSupplyDevicePlacements } from '@/lib/supplyAssembly/inverterMultipliers'
import { isModularSocket, normalizeModularSocketProps } from '@/lib/socket/modularSocket'
import { setAuxiliaryEnclosureShownOnPlan } from '@/lib/plan/auxiliaryEnclosurePlanPlacement'

type MutablePlacementOwner = {
  placement: Placement
  circuitId?: string
}

/** Resolve every standard situation-plan placement, independent of its electrical owner. */
function findMutablePlacementOwner(
  project: Project,
  placementId: string
): MutablePlacementOwner | null {
  const installation = getEditableProjectElectricalInstallation(project)
  const installationTrunkDevices = [
    ...getAllSupplyTrunkDevices(project),
    ...collectAllGroundTrunkDevices(getEditableProjectElectricalPanels(project), installation),
  ]
  for (const device of installationTrunkDevices) {
    const placement = device.placements?.find((candidate) => candidate.id === placementId)
    if (placement) return { placement }
  }
  for (const enclosure of project.disciplines?.electrical?.auxiliaryEnclosures ?? []) {
    const placement = enclosure.placements?.find((candidate) => candidate.id === placementId)
    if (placement) return { placement }
  }

  for (const panel of getEditableProjectElectricalPanels(project)) {
    for (const endpoint of getAllEndpoints(panel)) {
      const placement = endpoint.placements.find((candidate) => candidate.id === placementId)
      if (!placement) continue
      const owner = findCircuitForEndpointInPanel(panel, endpoint.id)
      return { placement, circuitId: owner?.circuit?.id }
    }
    for (const circuit of getAllCircuits(panel)) {
      for (const device of circuit.trunkDevices ?? []) {
        const placement = device.placements?.find((candidate) => candidate.id === placementId)
        if (placement) return { placement, circuitId: circuit.id }
      }
    }
  }

  return null
}

export const createPlanPlacementSlice: ProjectSliceCreator = (set, get) => ({
  // Ground trunk device actions (devices on the ground wire)
  addGroundTrunkDevice: (device, insertIndex, panelId) =>
    set((state) => {
      if (!state.currentProject) return
      const targetPanel = panelId
        ? findPanelById(getEditableProjectElectricalPanels(state.currentProject), panelId)
        : undefined
      if (targetPanel && targetPanel.isMain === false) {
        if (!targetPanel.groundTrunkDevices) targetPanel.groundTrunkDevices = []
        const idx = insertIndex ?? targetPanel.groundTrunkDevices.length
        targetPanel.groundTrunkDevices.splice(idx, 0, device)
        targetPanel.hasGround = true
        state.isDirty = true
        return
      }
      const installation = getEditableProjectElectricalInstallation(state.currentProject)
      if (!installation) return
      if (!installation.groundTrunkDevices) {
        installation.groundTrunkDevices = []
      }
      const idx = insertIndex ?? installation.groundTrunkDevices.length
      installation.groundTrunkDevices.splice(idx, 0, device)
      state.isDirty = true
    }),

  updateGroundTrunkDevice: (deviceId, updates) =>
    set((state) => {
      if (!state.currentProject) return
      const owner = findGroundTrunkDeviceOwner(
        getEditableProjectElectricalPanels(state.currentProject),
        getEditableProjectElectricalInstallation(state.currentProject),
        deviceId
      )
      const device = owner?.devices[owner.index]
      if (!device) return
      Object.assign(device, updates)
      syncManualChronologyForInstallDateUpdate(
        state.currentProject,
        { id: deviceId, type: 'trunkDevice' },
        updates
      )
      state.isDirty = true
    }),

  deleteGroundTrunkDevice: (deviceId) =>
    set((state) => {
      if (!state.currentProject) return
      const project = state.currentProject
      const installation = getEditableProjectElectricalInstallation(project)
      const panels = getEditableProjectElectricalPanels(project)
      if (!installation) return
      const owner = findGroundTrunkDeviceOwner(panels, installation, deviceId)
      if (!owner) return
      const idsToDelete = new Set(getEarthingSeparatorPairIds(owner.devices, deviceId))
      const removed = owner.devices.filter((device) => idsToDelete.has(device.id))
      if (removed.length === 0) return
      if (owner.panel) {
        owner.panel.groundTrunkDevices = owner.devices.filter((device) => !idsToDelete.has(device.id))
      } else {
        installation.groundTrunkDevices = owner.devices.filter((device) => !idsToDelete.has(device.id))
      }
      const removedLabel = removed.find((device) => device.type === 'junction_panel')?.label
      for (const removedId of idsToDelete) {
        cleanupPanelGridSlotsForDevice(panels, {
          kind: 'trunkDevice',
          id: removedId,
          scope: 'ground',
        })
      }
      pruneEendraadFrames(project, { removedMemberIds: [...idsToDelete] })
      state.isDirty = true
      if (removedLabel && installation.junctionPanelPlacements) {
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
    }),

  ensureSecondaryPanelEarthingStem: (panelId) =>
    set((state) => {
      if (!state.currentProject) return
      const panel = findPanelById(getEditableProjectElectricalPanels(state.currentProject), panelId)
      if (!panel) return
      if (applySecondaryPanelEarthingStem(panel)) state.isDirty = true
    }),


  ensureJunctionPanelPlacementForLabel: (label, floorId) => {
    const state = get()
    const project = state.currentProject
    const installation = project ? getProjectElectricalInstallation(project) : undefined
    if (!project || !installation) return
    const list = installation.junctionPanelPlacements ?? []
    if (list.some((jp) => jp.label === label)) return
    const floors = selectProjectBuildingFloors(project)
    const firstFloorId = floorId ?? floors[0]?.id
    if (!firstFloorId) return
    const placement: JunctionPanelPlacement = {
      id: generateId(),
      label,
      floorId: firstFloorId,
      pos: { x: 200, y: 200 },
      rotationDeg: 0,
      scale: 1,
      layer: 'default',
    }
    state.addJunctionPanelPlacement(placement)
  },

  addJunctionPanelPlacement: (placement) =>
    set((state) => {
      if (state.currentProject) {
        const installation = getProjectElectricalInstallation(state.currentProject)
        if (!installation) return
        if (!installation.junctionPanelPlacements) {
          installation.junctionPanelPlacements = []
        }
        installation.junctionPanelPlacements.push(placement)
        state.isDirty = true
      }
    }),

  updateJunctionPanelPlacement: (id, updates) =>
    set((state) => {
      if (state.currentProject) {
        const list = getProjectElectricalInstallation(state.currentProject)?.junctionPanelPlacements
        if (!list) return
        const idx = list.findIndex((jp) => jp.id === id)
        if (idx !== -1) {
          const jp = list[idx]!
          list[idx] = {
            ...jp,
            ...updates,
          }
          state.isDirty = true
        }
      }
    }),

  removeJunctionPanelPlacement: (id) =>
    set((state) => {
      if (state.currentProject) {
        const installation = getProjectElectricalInstallation(state.currentProject)
        if (!installation?.junctionPanelPlacements) return
        installation.junctionPanelPlacements = installation.junctionPanelPlacements.filter(
          (jp) => jp.id !== id
        )
        state.isDirty = true
      }
    }),

  addEarthingPlacement: (placement) =>
    set((state) => {
      if (state.currentProject) {
        const installation = getProjectElectricalInstallation(state.currentProject)
        if (!installation) return
        if (!installation.earthingPlacements) {
          installation.earthingPlacements = []
        }
        installation.earthingPlacements.push(placement)
        state.isDirty = true
      }
    }),

  setAuxiliaryEnclosureShownOnPlan: (enclosureId, shown) =>
    set((state) => {
      if (!state.currentProject) return
      if (setAuxiliaryEnclosureShownOnPlan(state.currentProject, enclosureId, shown)) {
        state.isDirty = true
      }
    }),

  updateEarthingPlacement: (id, updates) =>
    set((state) => {
      const list = state.currentProject
        ? getProjectElectricalInstallation(state.currentProject)?.earthingPlacements
        : undefined
      if (!list) return
      const idx = list.findIndex((p) => p.id === id)
      if (idx === -1) return
      list[idx] = { ...list[idx]!, ...updates }
      state.isDirty = true
    }),

  removeEarthingPlacement: (id) =>
    set((state) => {
      const inst = state.currentProject
        ? getProjectElectricalInstallation(state.currentProject)
        : undefined
      if (!inst?.earthingPlacements) return
      inst.earthingPlacements = inst.earthingPlacements.filter((p) => p.id !== id)
      state.isDirty = true
    }),

  getJunctionPanelPlacementByLabel: (label) => {
    const project = getProjectStoreApi().getState().currentProject
    return getProjectElectricalInstallation(project ?? {})?.junctionPanelPlacements?.find(
      (jp) => jp.label === label
    )
  },

  // Endpoint actions
  addEndpoint: (circuitId, endpoint, insertAfterEndpointId, branchOpts) =>
    set((state) => {
      if (state.currentProject) {
        const panels = getEditableProjectElectricalPanels(state.currentProject)
        for (const panel of panels) {
          const result = findCircuitById(panel, circuitId)
          if (result) {
            if (!endpoint.placements) {
              endpoint.placements = []
            }
            const circuitCodeBefore = result.circuit.code
            // If this is the first real endpoint on this circuit and the circuit
            // doesn't have a proper alphabetic code yet, assign one now. This is
            // the canonical moment when circuits/protections start to "consume"
            // labels in the global sequence.
            const isFirstEndpoint = result.circuit.endpoints.length === 0
            const hasAlphabeticCode =
              !!result.circuit.code && /^[A-Z]+$/.test(result.circuit.code.trim())
            let assignedCircuitCode: string | null = null

            const usesMainBusAutomaticNaming =
              result.circuit.supplySource?.kind !== 'converter-backup'

            if (isFirstEndpoint && !hasAlphabeticCode && usesMainBusAutomaticNaming) {
              const project = state.currentProject
              const circuitOwner = project
                ? findCircuitOwner(getProjectElectricalPanels(project), circuitId)
                : null
              if (project) {
                const newCode = getNextAvailableCircuitCode(project, circuitOwner?.panel.id)
                assignedCircuitCode = newCode
                result.circuit.code = newCode
              }
            }

            // Branch point labels (A1, A2, …) are assigned after branch topology settles below.

            // If this circuit lives under a protection that currently has no label,
            // assign the protection label to match the circuit code once it gains endpoints.
            const parentProtection = getOwningProtectionForCircuit(result, circuitId)
            const protectionHadLabel =
              !!parentProtection?.label && parentProtection.label.trim().length > 0
            const syncedProtectionFromCode =
              !!parentProtection &&
              !protectionHadLabel &&
              !!result.circuit.code &&
              result.circuit.code.trim().length > 0
            if (
              parentProtection &&
              (!parentProtection.label || parentProtection.label.trim() === '')
            ) {
              parentProtection.label = result.circuit.code
            }

            if (EENDRAAD_NAMING_DEBUG) {
              const p = result.parent
              const parentKind =
                'symbol' in p && (p as Panel).symbol === 'panel_distribution'
                  ? 'panel'
                  : 'protection'
              const parentId = parentKind === 'panel' ? (p as Panel).id : (p as ProtectionDevice).id

              logger.info('[eendraad naming] addEndpoint', {
                circuitId,
                endpointId: endpoint.id,
                loopRootPanelId: panel.id,
                circuitParentKind: parentKind,
                circuitParentId: parentId,
                isFirstEndpoint,
                hadAlphabeticCircuitCode: hasAlphabeticCode,
                circuitCodeBefore,
                circuitCodeAfter: result.circuit.code,
                assignedNewCircuitCode: assignedCircuitCode,
                skipNewCodeReason: !isFirstEndpoint
                  ? 'not_first_endpoint_on_circuit'
                  : hasAlphabeticCode
                    ? 'circuit_already_has_A_Z_code'
                    : !state.currentProject
                      ? 'no_project'
                      : null,
                endpointBranchLabel: endpoint.label,
                parentProtectionResolved: !!parentProtection,
                parentProtectionId: parentProtection?.id ?? null,
                protectionHadLabelBefore: protectionHadLabel,
                protectionLabelAfter: parentProtection?.label ?? null,
                syncedProtectionLabelFromCircuitCode: syncedProtectionFromCode,
                hintIfStillBlank:
                  !parentProtection && parentKind === 'panel'
                    ? 'circuit lives on panel.circuits (not under a protection); MCB letter only syncs for circuits under protection.circuits'
                    : !result.circuit.code?.trim()
                      ? 'circuit.code still empty — no alphabetic code was assigned (see skipNewCodeReason / hadAlphabeticCircuitCode)'
                      : parentProtection &&
                          !protectionHadLabel &&
                          !(parentProtection.label ?? '').trim()
                        ? 'protection resolved but label still empty after sync (check circuit.code above)'
                        : protectionHadLabel
                          ? 'protection already had a label; not overwritten'
                          : null,
              })
            }
            // Insert at position or append (all mutation inside set() so state is writable)
            // null = insert at very start, string = insert after that endpoint, undefined = append
            if (insertAfterEndpointId === null) {
              result.circuit.endpoints.unshift(endpoint)
            } else if (insertAfterEndpointId) {
              const insertIndex = result.circuit.endpoints.findIndex(
                (e) => e.id === insertAfterEndpointId
              )
              if (insertIndex >= 0) {
                result.circuit.endpoints.splice(insertIndex + 1, 0, endpoint)
              } else {
                result.circuit.endpoints.push(endpoint)
              }
            } else {
              result.circuit.endpoints.push(endpoint)
            }

            // Keep branches in sync so the new endpoint appears on the one-line diagram.
            // Callers (e.g. PropertiesPanel enabling domotica control wire) only call addEndpoint;
            // the drop handler additionally calls updateCircuit for branches, but addEndpoint must
            // maintain branch consistency when used alone.
            const endpointId = endpoint.id
            let branches = result.circuit.branches ?? []
            if (branches.length === 0) {
              branches = [
                {
                  id: generateId(),
                  label: result.circuit.endpoints[0]?.label ?? '',
                  endpointIds: result.circuit.endpoints.map((e) => e.id),
                },
              ]
              result.circuit.branches = branches
            } else {
              if (
                branchOpts?.forceNewBranch ||
                (insertAfterEndpointId === undefined && !endpoint.domoticaChildProps)
              ) {
                const newBranch = {
                  id: generateId(),
                  label: '',
                  endpointIds: [endpointId],
                }
                branches.push(newBranch)
                result.circuit.branches = branches
              } else if (insertAfterEndpointId === null) {
                const first = branches[0]
                if (first) {
                  first.endpointIds.unshift(endpointId)
                }
              } else if (insertAfterEndpointId) {
                const branch = branches.find((b) => b.endpointIds.includes(insertAfterEndpointId))
                if (branch) {
                  const idx = branch.endpointIds.indexOf(insertAfterEndpointId)
                  branch.endpointIds.splice(idx + 1, 0, endpointId)
                } else {
                  const last = branches[branches.length - 1]
                  if (last) {
                    last.endpointIds.push(endpointId)
                  }
                }
              } else {
                const last = branches[branches.length - 1]
                if (last) {
                  last.endpointIds.push(endpointId)
                }
              }
            }

            // Skip normalization when adding a domotica child: the drop handler will update the
            // parent's child list at the correct index and then call normalizeDomoticaForCircuit.
            if (!endpoint.domoticaChildProps) {
              normalizeDomoticaCircuit(result.circuit)
            }
            syncDerivedEndpointFlags(result.circuit)
            syncSequentialEndpointBranchLabelsToCircuit(result.circuit)
            healPlanWiring(state.currentProject)
            if (endpoint.placements.length > 0) {
              syncPanelAndSituationPlanDeviceVisibility(state.currentProject)
            }
            const ownerPanel = findCircuitOwner(panels, circuitId)?.panel
            if (ownerPanel) {
              maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, ownerPanel.id)
            }
            state.lastWorkedCircuitId = result.circuit.id
            state.isDirty = true
            return
          }
        }
      }
    }),

  addEndpointWithPlacement: (circuitId, endpoint, placement, insertAfterEndpointId, branchOpts) => {
    const projectBefore = get().currentProject
    if (!projectBefore) return
    const snapshotBefore = captureProjectForHistory(projectBefore)
    const { addEndpoint } = get()
    // A plan drop can be re-entered before the previous state has been rendered. Never let a
    // reused placement object or stale caller id become a second global placement identity.
    const placementToAdd = findMutablePlacementOwner(projectBefore, placement.id)
      ? { ...placement, id: generateId() }
      : { ...placement }
    const endpointWithPlacement: Endpoint = {
      ...endpoint,
      placements: [...(endpoint.placements ?? []), placementToAdd],
    }

    // Prevent split history entries (endpoint first, placement second).
    projectHistory.clearPending()
    projectHistory.runWithoutRecording(() => {
      addEndpoint(circuitId, endpointWithPlacement, insertAfterEndpointId, branchOpts)
    })

    appendUndoSnapshotInStore(set, snapshotBefore)
    recordSessionAction('add endpoint with placement')
  },

  moveEndpointToCircuit: (endpointId, targetCircuitId) =>
    set((state) => {
      if (!state.currentProject) return
      const panels = getEditableProjectElectricalPanels(state.currentProject)
      let targetCircuit: { circuit: Circuit; parent: Panel | ProtectionDevice } | null = null
      for (const panel of panels) {
        const found = findCircuitById(panel, targetCircuitId)
        if (found) {
          targetCircuit = found
          break
        }
      }
      if (!targetCircuit || targetCircuit.circuit.code === 'PANEL') return

      let endpoint: Endpoint | null = null
      let sourceCircuit: Circuit | null = null
      for (const panel of panels) {
        const result = findEndpointById(panel, endpointId)
        if (result) {
          endpoint = result.endpoint
          sourceCircuit = result.circuit
          break
        }
      }
      if (!endpoint || !sourceCircuit) return
      const idx = sourceCircuit.endpoints.findIndex((e) => e.id === endpointId)
      if (idx === -1) return
      sourceCircuit.endpoints.splice(idx, 1)
      if (sourceCircuit.branches) {
        sourceCircuit.branches = sourceCircuit.branches
          .map((b) => ({ ...b, endpointIds: b.endpointIds.filter((id) => id !== endpointId) }))
          .filter((b) => b.endpointIds.length > 0)
      }
      for (const panel of panels) {
        if (targetCircuit && targetCircuit.circuit && findCircuitById(panel, targetCircuitId)) {
          // If this is the first endpoint on the target circuit and it doesn't
          // yet have a proper alphabetic code, assign one now.
          const isFirstEndpointOnTarget = targetCircuit.circuit.endpoints.length === 0
          const hasAlphabeticCodeOnTarget =
            !!targetCircuit.circuit.code && /^[A-Z]+$/.test(targetCircuit.circuit.code.trim())
          if (isFirstEndpointOnTarget && !hasAlphabeticCodeOnTarget) {
            const project = state.currentProject
            const circuitOwner = project
              ? findCircuitOwner(getProjectElectricalPanels(project), targetCircuitId)
              : null
            if (project) {
              const newCode = getNextAvailableCircuitCode(project, circuitOwner?.panel.id)

              logger.info('[moveEndpointToCircuit] assigning circuit code for first endpoint', {
                targetCircuitId,
                newCode,
              })
              targetCircuit.circuit.code = newCode
            }
          }

          endpoint!.label = ''
          targetCircuit.circuit.endpoints.push(endpoint!)
          // New circuits from createEmptyCircuitOnPanel have no branches[]; orphan detection
          // requires every endpoint to appear in branch.endpointIds.
          const existingBranches = targetCircuit.circuit.branches
          if (!existingBranches?.length) {
            const soleBranch = {
              id: generateId(),
              label: '',
              endpointIds: targetCircuit.circuit.endpoints.map((e) => e.id),
            }
            targetCircuit.circuit.branches = [soleBranch]
          } else {
            const newBranch = {
              id: generateId(),
              label: '',
              endpointIds: [endpointId],
            }
            existingBranches.push(newBranch)
          }
          syncSequentialEndpointBranchLabelsToCircuit(sourceCircuit)
          syncSequentialEndpointBranchLabelsToCircuit(targetCircuit.circuit)

          // Ensure the parent protection gets a label once this circuit has endpoints.
          const parentProtection = getOwningProtectionForCircuit(targetCircuit, targetCircuitId)
          if (
            parentProtection &&
            (!parentProtection.label || parentProtection.label.trim() === '')
          ) {
            parentProtection.label = targetCircuit.circuit.code
          }
          normalizeDomoticaCircuit(sourceCircuit)
          normalizeDomoticaCircuit(targetCircuit.circuit)
          syncDerivedEndpointFlags(sourceCircuit)
          syncDerivedEndpointFlags(targetCircuit.circuit)
          state.lastWorkedCircuitId = targetCircuit.circuit.id
          state.isDirty = true
          return
        }
      }
    }),

  updateEndpoint: (id, updates: Partial<Endpoint> & { circuitId?: string }) => {
    const previousProject = get().currentProject
    const isLayoutNeutralSocketOverlayUpdate =
      Object.keys(updates).every((key) => key === 'socketProps') &&
      updates.socketProps != null &&
      !Object.prototype.hasOwnProperty.call(updates.socketProps, 'socketCount')
    set((state) => {
      const hasAnyUpdate = Object.keys(updates).length > 0
      if (!hasAnyUpdate) return
      if (state.currentProject) {
        for (const panel of getEditableProjectElectricalPanels(state.currentProject)) {
          const result = findEndpointById(panel, id)
          if (result) {
            const nextLabel = updates.label
            const nextCircuitId = updates.circuitId
            const otherUpdateKeys = Object.keys(updates).filter(
              (key) => key !== 'label' && key !== 'circuitId'
            )
            const isNoOpLabel = nextLabel !== undefined && nextLabel === result.endpoint.label
            const isNoOpCircuitMove =
              nextCircuitId !== undefined && nextCircuitId === result.circuit.id
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
              return
            }
            const previousCircuit = result.circuit
            // If circuit is changing, we need to move the endpoint
            if (updates.circuitId && updates.circuitId !== result.circuit.id) {
              const newCircuitResult = findCircuitById(panel, updates.circuitId)
              if (newCircuitResult?.circuit.code === 'PANEL') {
                return
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
                  state.currentProject,
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
              syncManualChronologyForInstallDateUpdate(
                state.currentProject,
                { id, type: 'endpoint' },
                updates
              )

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
              getEditableProjectElectricalInstallation(state.currentProject)
                ?.eendraadAutomaticNaming
            ) {
              const circuitIdForRefresh =
                updates.circuitId && updates.circuitId !== previousCircuit.id
                  ? previousCircuit.id
                  : result.circuit.id
              const owner = findCircuitOwner(
                getEditableProjectElectricalPanels(state.currentProject),
                circuitIdForRefresh
              )
              if (owner) {
                maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, owner.panel.id)
              }
              if (updates.circuitId && updates.circuitId !== previousCircuit.id) {
                const destOwner = findCircuitOwner(
                  getEditableProjectElectricalPanels(state.currentProject),
                  updates.circuitId
                )
                if (destOwner && destOwner.panel.id !== owner?.panel.id) {
                  maybeApplyAutomaticEendraadNamingForPanel(
                    state.currentProject,
                    destOwner.panel.id
                  )
                }
              }
            }
            state.lastWorkedCircuitId =
              updates.circuitId && updates.circuitId !== result.circuit.id
                ? updates.circuitId
                : result.circuit.id
            state.isDirty = true
            return
          }
        }
      }
    })
    const nextProject = get().currentProject
    if (
      isLayoutNeutralSocketOverlayUpdate &&
      previousProject &&
      nextProject &&
      previousProject !== nextProject
    ) {
      inheritEendraadLayoutForVisualEndpointChange(previousProject, nextProject)
    }
  },

  deleteEndpoint: (id) =>
    set((state) => {
      if (state.currentProject) {
        const panels = getEditableProjectElectricalPanels(state.currentProject)
        for (const panel of panels) {
          const result = findEndpointById(panel, id)
          if (result) {
            if (isMainPanelDistributionEndpoint(state.currentProject, result.endpoint)) {
              logger.warn(
                '[projectStore] deleteEndpoint blocked for main panel distribution symbol',
                {
                  endpointId: id,
                }
              )
              return
            }
            if (result.endpoint.symbol === 'panel_distribution') {
              const linkedPanel = resolvePanelForDistributionEndpoint(
                state.currentProject,
                result.endpoint
              )
              if (linkedPanel && !linkedPanel.isMain) {
                if (deletePanelFromProject(state.currentProject, linkedPanel.id)) {
                  healPlanWiring(state.currentProject)
                  pruneStaleElectricalEndpointRecords(state.currentProject)
                  state.isDirty = true
                }
                return
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
            healPlanWiring(state.currentProject)
            if (
              getEditableProjectElectricalInstallation(state.currentProject)
                ?.eendraadAutomaticNaming
            ) {
              const owner = findCircuitOwner(panels, result.circuit.id)
              if (owner) {
                maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, owner.panel.id)
              }
            }
            pruneEendraadFrames(state.currentProject, { removedMemberIds: idsToDelete })
            pruneStaleElectricalEndpointRecords(state.currentProject)
            state.isDirty = true
            return
          }
        }
      }
    }),

  moveEndpointInBranch: (endpointId, direction) =>
    set((state) => {
      logger.info('[moveEndpointInBranch]', { endpointId, direction })
      if (!state.currentProject) {
        logger.warn('[moveEndpointInBranch] No current project')
        return
      }
      for (const panel of getEditableProjectElectricalPanels(state.currentProject)) {
        const result = findEndpointById(panel, endpointId)
        if (result && result.circuit.branches) {
          const branch = result.circuit.branches.find((b) => b.endpointIds.includes(endpointId))
          if (branch) {
            const index = branch.endpointIds.indexOf(endpointId)
            logger.info('[moveEndpointInBranch] Found branch', {
              branchId: branch.id,
              index,
              total: branch.endpointIds.length,
            })
            if (direction === 'left' && index > 0) {
              // Move left (earlier in array)
              const temp = branch.endpointIds[index]!
              branch.endpointIds[index] = branch.endpointIds[index - 1]!
              branch.endpointIds[index - 1] = temp
              logger.info('[moveEndpointInBranch] Moved left', {
                newIndex: index - 1,
                newOrder: branch.endpointIds,
              })
              syncDerivedEndpointFlags(result.circuit)
              healPlanWiring(state.currentProject)
              state.isDirty = true
              return
            } else if (direction === 'right' && index < branch.endpointIds.length - 1) {
              // Move right (later in array)
              const temp = branch.endpointIds[index]!
              branch.endpointIds[index] = branch.endpointIds[index + 1]!
              branch.endpointIds[index + 1] = temp
              logger.info('[moveEndpointInBranch] Moved right', {
                newIndex: index + 1,
                newOrder: branch.endpointIds,
              })
              syncDerivedEndpointFlags(result.circuit)
              healPlanWiring(state.currentProject)
              state.isDirty = true
              return
            } else {
              logger.info('[moveEndpointInBranch] Cannot move', {
                direction,
                index,
                length: branch.endpointIds.length,
              })
            }
          } else {
            logger.warn('[moveEndpointInBranch] Endpoint not found in any branch')
          }
        }
      }
    }),

  moveDomoticaChildOutput: (endpointId, direction) =>
    set((state) => {
      if (!state.currentProject) return
      for (const panel of getEditableProjectElectricalPanels(state.currentProject)) {
        const result = findEndpointById(panel, endpointId)
        if (!result) continue
        const { endpoint: child, circuit } = result
        const ref = child.domoticaChildProps
        if (!ref) return
        const parent = circuit.endpoints.find((e) => e.id === ref.parentEndpointId)
        if (!parent?.domoticaProps) return
        const ids: string[] = [...(parent.domoticaProps.endpointChildEndpointIds ?? [])]
        const index = ids.indexOf(endpointId)
        if (index === -1) return
        if (direction === 'up' && index > 0) {
          const prevId = ids[index - 1]
          if (!prevId) return
          ids[index] = prevId
          ids[index - 1] = endpointId
        } else if (direction === 'down' && index < ids.length - 1) {
          const nextId = ids[index + 1]
          if (!nextId) return
          ids[index] = nextId
          ids[index + 1] = endpointId
        } else return
        const nextProps = {
          ...parent.domoticaProps,
          endpointChildEndpointIds: ids,
        }
        parent.domoticaProps = nextProps
        normalizeDomoticaCircuit(circuit)
        state.isDirty = true
        return
      }
    }),

  normalizeDomoticaForCircuit: (circuitId) =>
    set((state) => {
      if (!state.currentProject) return
      for (const panel of getEditableProjectElectricalPanels(state.currentProject)) {
        const result = findCircuitById(panel, circuitId)
        if (result) {
          normalizeDomoticaCircuit(result.circuit)
          state.isDirty = true
          return
        }
      }
    }),

  deleteEndpoints: (ids) =>
    set((state) => {
      if (state.currentProject) {
        const project = state.currentProject
        const panels = getProjectElectricalPanels(project)
        const filtered: string[] = ids.filter((id) => {
          for (const panel of panels) {
            const result = findEndpointById(panel, id)
            if (result && isMainPanelDistributionEndpoint(project, result.endpoint)) {
              logger.warn('[projectStore] deleteEndpoints skipped main panel distribution symbol', {
                endpointId: id,
              })
              return false
            }
          }
          return true
        })
        if (filtered.length === 0) return
        const prunedMemberIds = new Set<string>(filtered)
        const panelIdsToDelete = new Set<string>()
        for (const endpointId of filtered) {
          for (const panel of getProjectElectricalPanels(project)) {
            const result = findEndpointById(panel, endpointId)
            if (!result) continue
            if (result.endpoint.symbol !== 'panel_distribution') continue
            const linkedPanel = resolvePanelForDistributionEndpoint(project, result.endpoint)
            if (linkedPanel && !linkedPanel.isMain) {
              panelIdsToDelete.add(linkedPanel.id)
            }
          }
        }
        for (const panelId of panelIdsToDelete) {
          deletePanelFromProject(project, panelId)
        }
        const idsSet = new Set(filtered)
        const modifiedCircuitIds = new Set<string>()
        const mutablePanels = getEditableProjectElectricalPanels(state.currentProject)
        for (const panel of mutablePanels) {
          const circuits = getAllCircuits(panel)
          for (const circuit of circuits) {
            const roots = circuit.endpoints
              .filter((endpoint) => idsSet.has(endpoint.id))
              .map((endpoint) => endpoint.id)
            const idsToDelete = collectDomoticaEndpointIdsForDeletion(circuit, roots)
            for (const endpoint of circuit.endpoints) {
              if (idsToDelete.has(endpoint.id) && endpoint.symbol === 'domotica') {
                for (const childId of idsToDelete) prunedMemberIds.add(childId)
                cleanupPanelGridSlotsForDevice(mutablePanels, {
                  kind: 'domotica',
                  endpointId: endpoint.id,
                  circuitId: circuit.id,
                })
              }
            }

            const before = circuit.endpoints.length
            removeEndpointIdsFromCircuit(circuit, idsToDelete)
            if (circuit.endpoints.length !== before) {
              normalizeDomoticaCircuit(circuit)
              modifiedCircuitIds.add(circuit.id)
            }
          }
        }
        for (const circuitId of modifiedCircuitIds) {
          for (const panel of mutablePanels) {
            const found = findCircuitById(panel, circuitId)
            if (found) {
              syncSequentialEndpointBranchLabelsToCircuit(found.circuit)
              break
            }
          }
        }
        if (
          getEditableProjectElectricalInstallation(state.currentProject)?.eendraadAutomaticNaming
        ) {
          const panelsToRename = new Set<string>()
          for (const circuitId of modifiedCircuitIds) {
            const owner = findCircuitOwner(mutablePanels, circuitId)
            if (owner) panelsToRename.add(owner.panel.id)
          }
          for (const panelId of panelsToRename) {
            maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, panelId)
          }
        }
        pruneEendraadFrames(state.currentProject, { removedMemberIds: prunedMemberIds })
        healPlanWiring(state.currentProject)
        pruneStaleElectricalEndpointRecords(state.currentProject)
        state.isDirty = true
      }
    }),

  // Placement actions
  addPlacement: (endpointId, placement) =>
    set((state) => {
      if (state.currentProject) {
        for (const panel of getEditableProjectElectricalPanels(state.currentProject)) {
          const result = findEndpointById(panel, endpointId)
          if (result) {
            result.endpoint.placements.push(placement)
            syncPanelAndSituationPlanDeviceVisibility(state.currentProject)
            state.lastWorkedCircuitId = result.circuit.id
            state.isDirty = true
            return
          }
        }
      }
    }),

  updatePlacement: (id, updates) =>
    set((state) => {
      if (!state.currentProject) return
      const owner = findMutablePlacementOwner(state.currentProject, id)
      if (!owner) return
      Object.assign(owner.placement, withCustomPlacementFlag(owner.placement, updates))
      if (owner.circuitId) state.lastWorkedCircuitId = owner.circuitId
      state.isDirty = true
    }),

  updatePlacementsBatch: (updates) =>
    set((state) => {
      if (!state.currentProject || updates.length === 0) return
      let applied = false
      for (const { id, updates: patch } of updates) {
        const owner = findMutablePlacementOwner(state.currentProject, id)
        if (!owner) continue
        Object.assign(owner.placement, withCustomPlacementFlag(owner.placement, patch))
        if (owner.circuitId) state.lastWorkedCircuitId = owner.circuitId
        applied = true
      }
      if (applied) state.isDirty = true
    }),

  movePlanPlacementsToFloor: (moves, floorId) => {
    let applied = false
    set((state) => {
      const project = state.currentProject
      if (!project || moves.length === 0) return
      if (!selectProjectBuildingFloors(project).some((floor) => floor.id === floorId)) return

      const uniqueMoves = new Map(moves.map((move) => [move.id, move]))
      const installation = getEditableProjectElectricalInstallation(project)
      const resolved: Array<{
        kind: 'standard' | 'junctionPanel' | 'earthing'
        placement:
          | Placement
          | JunctionPanelPlacement
          | NonNullable<Installation['earthingPlacements']>[number]
        pos?: Placement['pos']
      }> = []

      for (const move of uniqueMoves.values()) {
        const junctionPanelPlacement = installation?.junctionPanelPlacements?.find(
          (placement) => placement.id === move.id
        )
        if (junctionPanelPlacement) {
          resolved.push({
            kind: 'junctionPanel',
            placement: junctionPanelPlacement,
            pos: move.pos,
          })
          continue
        }

        const earthingPlacement = installation?.earthingPlacements?.find(
          (placement) => placement.id === move.id
        )
        if (earthingPlacement) {
          resolved.push({ kind: 'earthing', placement: earthingPlacement, pos: move.pos })
          continue
        }

        const owner = findMutablePlacementOwner(project, move.id)
        if (!owner) return
        resolved.push({ kind: 'standard', placement: owner.placement, pos: move.pos })
      }

      // Preserve a manual wire when both of its placement endpoints travel together. Routes
      // with only one moved endpoint are removed by healing below instead of becoming stale.
      const movedPlacementIds = new Set(uniqueMoves.keys())
      const planWireRoutes = selectProjectPlanWireRoutes(project)
      planWireRoutes.forEach((route) => {
        const fromPlacementId = route.from.placementId
        const toPlacementId = route.to.placementId
        if (
          fromPlacementId &&
          toPlacementId &&
          movedPlacementIds.has(fromPlacementId) &&
          movedPlacementIds.has(toPlacementId)
        ) {
          route.floorId = floorId
        }
      })
      replacePlanWireRoutesForProject(project, planWireRoutes)

      resolved.forEach(({ kind, placement, pos }) => {
        const patch = { floorId, ...(pos ? { pos } : {}) }
        if (kind === 'standard') {
          Object.assign(placement, withCustomPlacementFlag(placement as Placement, patch))
        } else {
          Object.assign(placement, patch)
        }
      })

      healPlanWiring(project)
      syncPanelAndSituationPlanDeviceVisibility(project)
      state.isDirty = true
      applied = true
    })
    return applied
  },

  deletePlacement: (id) =>
    set((state) => {
      const inst = state.currentProject
        ? getEditableProjectElectricalInstallation(state.currentProject)
        : undefined
      if (inst?.earthingPlacements?.some((p) => p.id === id)) {
        inst.earthingPlacements = inst.earthingPlacements.filter((p) => p.id !== id)
        state.isDirty = true
        return
      }
      if (state.currentProject) {
        for (const device of getAllSupplyTrunkDevices(state.currentProject)) {
          const index = device.placements?.findIndex((placement) => placement.id === id) ?? -1
          if (index === -1) continue
          if (!removeSupplyDevicePlacements(device, new Set([id]))) {
            device.placements!.splice(index, 1)
          }
          state.isDirty = true
          return
        }
        for (const panel of getEditableProjectElectricalPanels(state.currentProject)) {
          const endpoints = getAllEndpoints(panel)
          for (const endpoint of endpoints) {
            const index = endpoint.placements.findIndex((p) => p.id === id)
            if (index !== -1) {
              if (isMainPanelDistributionEndpoint(state.currentProject, endpoint)) {
                logger.warn(
                  '[projectStore] deletePlacement blocked for main panel distribution symbol',
                  {
                    placementId: id,
                  }
                )
                return
              }
              endpoint.placements.splice(index, 1)
              healPlanWiring(state.currentProject)
              state.isDirty = true
              return
            }
          }
          for (const circuit of getAllCircuits(panel)) {
            for (const device of circuit.trunkDevices ?? []) {
              const index = device.placements?.findIndex((placement) => placement.id === id) ?? -1
              if (index === -1) continue
              device.placements!.splice(index, 1)
              state.isDirty = true
              return
            }
          }
        }
      }
    }),

  deletePlacements: (ids) =>
    set((state) => {
      if (state.currentProject) {
        const project = state.currentProject
        const installation = getProjectElectricalInstallation(project)
        const panels = getProjectElectricalPanels(project)
        const blocked = new Set<string>()
        for (const panel of panels) {
          for (const endpoint of getAllEndpoints(panel)) {
            if (!isMainPanelDistributionEndpoint(project, endpoint)) continue
            for (const pl of endpoint.placements) {
              if (ids.includes(pl.id)) blocked.add(pl.id)
            }
          }
        }
        const idsSet = new Set(ids.filter((id) => !blocked.has(id)))
        const earthingIds =
          idsSet.size > 0
            ? (installation?.earthingPlacements ?? [])
                .filter((p) => idsSet.has(p.id))
                .map((p) => p.id)
            : []
        if (idsSet.size === 0 && earthingIds.length === 0) {
          if (blocked.size > 0) {
            logger.warn(
              '[projectStore] deletePlacements skipped main panel distribution placement(s)'
            )
          }
          return
        }
        for (const panel of panels) {
          const endpoints = getAllEndpoints(panel)
          for (const endpoint of endpoints) {
            endpoint.placements = endpoint.placements.filter((p) => !idsSet.has(p.id))
          }
          for (const circuit of getAllCircuits(panel)) {
            for (const device of circuit.trunkDevices ?? []) {
              if (device.placements) {
                device.placements = device.placements.filter(
                  (placement) => !idsSet.has(placement.id)
                )
              }
            }
          }
        }
        for (const device of getAllSupplyTrunkDevices(project)) {
          if (device.placements) {
            if (!removeSupplyDevicePlacements(device, idsSet)) {
              device.placements = device.placements.filter((placement) => !idsSet.has(placement.id))
            }
          }
        }
        if (earthingIds.length > 0 && installation?.earthingPlacements) {
          const removeSet = new Set(earthingIds)
          installation.earthingPlacements = installation.earthingPlacements.filter(
            (p) => !removeSet.has(p.id)
          )
        }
        healPlanWiring(project)
        state.isDirty = true
      }
    }),

  deletePlacementsByEndpoint: (endpointId) =>
    set((state) => {
      if (state.currentProject) {
        for (const panel of getEditableProjectElectricalPanels(state.currentProject)) {
          const result = findEndpointById(panel, endpointId)
          if (result) {
            if (isMainPanelDistributionEndpoint(state.currentProject, result.endpoint)) {
              logger.warn(
                '[projectStore] deletePlacementsByEndpoint blocked for main panel distribution symbol',
                { endpointId }
              )
              return
            }
            result.endpoint.placements = []
            healPlanWiring(state.currentProject)
            state.isDirty = true
            return
          }
        }
      }
    }),
})
