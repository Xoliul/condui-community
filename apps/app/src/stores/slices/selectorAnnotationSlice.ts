import { updateAnnotationPropertiesInProject } from '@/lib/properties/generalPropertyMutations'
import { getProjectStoreApi } from './projectStoreHistory'
import type { ProjectSliceCreator } from './projectStoreTypes'
import { estimateCableRoutes } from '@/lib/cableRouting/estimateCableRoutes'
import { syncDerivedEndpointFlags } from '@/lib/eendraad/endpointInsertAfter'
import { pruneEendraadFrames } from '@/lib/eendraad/frameContent'
import {
  collectAllGroundTrunkDevices,
} from '@/lib/eendraad/panelGround'
import {
  findCircuitById,
  findEndpointById,
  findPanelContainingCircuit,
  getAllCircuits,
  getAllEndpoints,
  getAllProtections,
  getDefaultPanelGridModuleRefs,
  getPanelPathFromRoot,
  normalizeDomoticaCircuit,
  panelGridModuleIsAlwaysVisibleInPanel,
  panelGridModuleIsVisibleByDefault,
  panelGridModuleRefKey,
  removeEndpointIdsFromCircuit,
} from '@/lib/eendraad/projectElectricalDomain'
import { repairCircuitBranchMembership } from '@/lib/eendraad/repairCircuitBranchMembership'
import { getAllSupplyTrunkDevices, getPanelFeedProjection } from '@/lib/feedTopology'
import { getPanelGridModulesInProject } from '@/lib/panel/panelGridModules'
import {
  ejectSupplyTrunkFromMainGridSlot,
  healPanelMountedSupplyTrunkSlotsForPanel,
} from '@/lib/panel/healSupplyTrunkGrid'
import { setPanelFeedOrganizationInProject } from '@/lib/panel/panelFeedOrganization'
import { findPanelById } from '@/lib/panel/panelTree'
import { findProjectTrunkDevice } from '@/lib/projectV2/trunkDeviceLookup'
import {
  getSupplyDeviceVisibilitySurface,
  isSupplyDeviceVisibleInPanel,
} from '@/lib/panel/supplyPanelVisibility'
import {
  buildAutoSitplanPlacement,
  getViewportCenterPlanSpaceIfApplicable,
} from '@/lib/plan/autoSitplanPlacement'
import {
  ensureElectricalLayerOnFloor,
  healProjectFloorsElectricalLayers,
} from '@/lib/plan/floorLayers'
import { resolvePanelForDistributionEndpoint } from '@/lib/plan/panelDistributionEndpoint'
import { duplicateJunctionOccurrenceIds } from '@/lib/plan/sharedJunctionPlacements'
import { resolveSitplanTargetFloorId } from '@/lib/plan/sitplanTargetFloor'
import { addEendraadNoteInProject } from '@/lib/projectMutations/storeActions'
import {
  addOneWireFrameInProject,
  addSitplanNoteInProject,
} from '@/lib/projectMutations/annotationMutations'
import {
  editOneWireFrames,
  editOneWireNotes,
  editOneWireSegments,
  queryOneWireFrames,
  queryOneWireNotes,
  queryOneWireSegments,
  querySitplanNotes,
  replaceOneWireFrames,
  replaceOneWireNotes,
  replaceSitplanNotes,
} from '@/lib/projectV2/annotations'
import {
  mutateBuildingFloorView,
  readLegacyCompatibilityFloors,
} from '@/lib/projectV2/buildingFloors'
import {
  editProjectElectricalPanels,
  getEditableProjectElectricalInstallation,
  selectProjectAuxiliaryElectricalEnclosures,
  selectProjectElectricalInstallation,
  selectProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { getElectricalLookupIndex } from '@/lib/projectV2/electricalLookupIndex'
import { queryQuarantinedItems } from '@/lib/projectV2/validation'
import {
  quarantineCircuit,
  quarantineEndpoint,
  removeFromQuarantine as doRemoveFromQuarantine,
  restoreFromQuarantine as doRestoreFromQuarantine,
} from '@/lib/validation/quarantine'
import { editWireRunAtAnchor } from '@/lib/wires/editWireRun'
import { acceptWireLengthEstimatesInProject } from '@/lib/wires/wireLengthMutations'
import { useUIStore } from '@/stores/uiStore'
import {
  DEFAULT_ELECTRICAL_DOMAIN,
  type Circuit,
  type Endpoint,
  type Frame,
  type Note,
  type PanelGridModuleRef,
  type PanelGridSlot,
  type Placement,
  type ProtectionDevice,
  type TrunkDevice,
  type WireSegment,
} from '@/types/schema'
import {
  findCircuitForEndpointInPanel,
  findCircuitForEndpointInProject,
  generateId,
} from '@/utils/project'

export const createSelectorAnnotationSlice: ProjectSliceCreator = (set, get) => ({
  // Selectors
  getPanelById: (id) => {
    const { currentProject } = getProjectStoreApi().getState()
    if (!currentProject) return undefined
    return getElectricalLookupIndex(selectProjectElectricalPanels(currentProject)).panelsById.get(
      id
    )
  },

  getPanelByName: (name) => {
    const { currentProject } = getProjectStoreApi().getState()
    if (!currentProject) return undefined
    return getElectricalLookupIndex(selectProjectElectricalPanels(currentProject)).panelsByName.get(
      name
    )
  },

  getProtectionById: (id) => {
    const { currentProject } = get()
    if (!currentProject) return undefined
    return getElectricalLookupIndex(
      selectProjectElectricalPanels(currentProject)
    ).protectionsById.get(id)
  },

  getPanelForProtection: (protectionId) => {
    const { currentProject } = get()
    if (!currentProject) return undefined
    return getElectricalLookupIndex(
      selectProjectElectricalPanels(currentProject)
    ).protectionPanelsById.get(protectionId)
  },

  getCircuitById: (id) => {
    const { currentProject } = get()
    if (!currentProject) return undefined
    return getElectricalLookupIndex(selectProjectElectricalPanels(currentProject)).circuitsById.get(
      id
    )?.circuit
  },

  // Get the display identifier for a circuit
  // For single MCBs: returns the MCB label (MCB IS the circuit)
  // For RCD circuits or direct circuits: returns circuit.code
  getCircuitIdentifier: (circuitId) => {
    const { currentProject } = get()
    if (!currentProject) return ''
    const result = getElectricalLookupIndex(
      selectProjectElectricalPanels(currentProject)
    ).circuitsById.get(circuitId)
    if (result?.parent && 'type' in result.parent && 'label' in result.parent) {
      return result.parent.label
    }
    if (result) return result.circuit.code
    return ''
  },

  getEndpointById: (id) => {
    const { currentProject } = get()
    if (!currentProject) return undefined
    return getElectricalLookupIndex(
      selectProjectElectricalPanels(currentProject)
    ).endpointsById.get(id)?.endpoint
  },

  getFloorById: (id) => {
    const { currentProject } = get()
    return currentProject
      ? readLegacyCompatibilityFloors(currentProject).find((f) => f.id === id)
      : undefined
  },

  getPlacementById: (id) => {
    const { currentProject } = get()
    if (!currentProject) return undefined
    const earthing = selectProjectElectricalInstallation(currentProject)?.earthingPlacements?.find(
      (p) => p.id === id
    )
    if (earthing) {
      return {
        id: earthing.id,
        floorId: earthing.floorId,
        layer: earthing.layer ?? 'default',
        pos: earthing.pos,
        rotationDeg: (earthing.rotationDeg ?? 0) as 0 | 90 | 180 | 270,
        rotationMode: earthing.rotationMode,
        scale: earthing.scale ?? 1,
        locked: earthing.locked,
        isEarthing: true,
      }
    }
    for (const device of getAllSupplyTrunkDevices(currentProject)) {
      const placement = device.placements?.find((candidate) => candidate.id === id)
      if (placement) return { ...placement, trunkDeviceId: device.id }
    }
    for (const enclosure of selectProjectAuxiliaryElectricalEnclosures(currentProject)) {
      const placement = enclosure.placements?.find((candidate) => candidate.id === id)
      if (placement) return { ...placement, enclosureId: enclosure.id }
    }
    for (const panel of selectProjectElectricalPanels(currentProject)) {
      for (const endpoint of getAllEndpoints(panel)) {
        const placement = endpoint.placements.find((p) => p.id === id)
        if (placement) {
          return { ...placement, endpointId: endpoint.id }
        }
      }
      for (const circuit of getAllCircuits(panel)) {
        for (const device of circuit.trunkDevices ?? []) {
          const placement = device.placements?.find((candidate) => candidate.id === id)
          if (placement) return { ...placement, trunkDeviceId: device.id }
        }
      }
    }
    return undefined
  },

  getCircuitsByPanel: (panelId) => {
    const { currentProject } = get()
    if (!currentProject) return []
    const panel = findPanelById(selectProjectElectricalPanels(currentProject), panelId)
    return panel ? getAllCircuits(panel) : []
  },

  getProtectionsByPanel: (panelId) => {
    const { currentProject } = get()
    if (!currentProject) return []
    const panel = findPanelById(selectProjectElectricalPanels(currentProject), panelId)
    return panel ? getAllProtections(panel) : []
  },

  getPanelGridModules: (panelId) => {
    const { currentProject } = get()
    return currentProject ? getPanelGridModulesInProject(currentProject, panelId) : []
  },

  getPanelHiddenModuleRefs: (panelId) => {
    const { currentProject } = get()
    if (!currentProject) return []
    const panel = findPanelById(selectProjectElectricalPanels(currentProject), panelId)
    if (!panel) {
      return getAllSupplyTrunkDevices(currentProject)
        .filter(
          (device) =>
            getSupplyDeviceVisibilitySurface(currentProject, device.id)?.id === panelId &&
            !isSupplyDeviceVisibleInPanel(currentProject, device.id)
        )
        .map(
          (device): PanelGridModuleRef => ({ kind: 'trunkDevice', id: device.id, scope: 'supply' })
        )
    }
    const hiddenKeys = new Set(panel.gridView?.hiddenModuleKeys ?? [])
    const shownKeys = new Set(panel.gridView?.shownModuleKeys ?? [])
    const installation = selectProjectElectricalInstallation(currentProject)
    const panels = selectProjectElectricalPanels(currentProject)
    const sharedSupplyKeys = new Set(
      panel.isMain && installation
        ? (getPanelFeedProjection(installation, panels, panel)?.sharedFeed.trunkDevices ?? []).map(
            (device) =>
              panelGridModuleRefKey({ kind: 'trunkDevice', id: device.id, scope: 'supply' })
          )
        : []
    )
    const defaultRefs = getDefaultPanelGridModuleRefs(panel, installation, panels)
    const keys = new Set(defaultRefs.map(panelGridModuleRefKey))
    for (const device of getAllSupplyTrunkDevices(currentProject)) {
      const surface = getSupplyDeviceVisibilitySurface(currentProject, device.id)
      if (surface?.id !== panel.id && surface?.ownerPanelId !== panel.id) continue
      const ref: PanelGridModuleRef = { kind: 'trunkDevice', id: device.id, scope: 'supply' }
      if (!keys.has(panelGridModuleRefKey(ref))) defaultRefs.push(ref)
    }
    return defaultRefs.filter((ref) => {
      if (ref.kind === 'trunkDevice' && ref.scope === 'supply') {
        const surface = getSupplyDeviceVisibilitySurface(currentProject, ref.id)
        return (
          (surface?.id === panel.id || surface?.ownerPanelId === panel.id) &&
          !isSupplyDeviceVisibleInPanel(currentProject, ref.id)
        )
      }
      const key = panelGridModuleRefKey(ref)
      if (panelGridModuleIsAlwaysVisibleInPanel(ref, panels)) return false
      if (hiddenKeys.has(key)) return true
      if (sharedSupplyKeys.has(key)) return false
      return (
        !panelGridModuleIsVisibleByDefault(ref, panel, installation, panels) && !shownKeys.has(key)
      )
    })
  },

  getEndpointsByCircuit: (circuitId) => {
    const { currentProject } = get()
    if (!currentProject) return []
    for (const panel of selectProjectElectricalPanels(currentProject)) {
      const result = findCircuitById(panel, circuitId)
      if (result) return result.circuit.endpoints
    }
    return []
  },

  getPlacementsByFloor: (floorId) => {
    const { currentProject } = get()
    if (!currentProject) return []
    const result: Array<
      Placement & {
        endpointId?: string
        trunkDeviceId?: string
        enclosureId?: string
        planLabel?: string
        junctionPanelLabel?: string
        isEarthing?: boolean
      }
    > = []
    // A junction box drawn several times on the one-wire is one box on the plan.
    const duplicateJunctions = duplicateJunctionOccurrenceIds(currentProject)
    for (const panel of selectProjectElectricalPanels(currentProject)) {
      const endpoints = getAllEndpoints(panel)
      for (const endpoint of endpoints) {
        if (duplicateJunctions.has(endpoint.id)) continue
        for (const placement of endpoint.placements) {
          if (placement.floorId === floorId) {
            result.push({ ...placement, endpointId: endpoint.id })
          }
        }
      }
      for (const circuit of getAllCircuits(panel)) {
        for (const device of circuit.trunkDevices ?? []) {
          if (duplicateJunctions.has(device.id)) continue
          for (const placement of device.placements ?? []) {
            if (placement.floorId === floorId) {
              result.push({ ...placement, trunkDeviceId: device.id })
            }
          }
        }
      }
    }
    const installation = selectProjectElectricalInstallation(currentProject)
    for (const device of getAllSupplyTrunkDevices(currentProject)) {
      if (duplicateJunctions.has(device.id)) continue
      for (const placement of device.placements ?? []) {
        if (placement.floorId === floorId) {
          result.push({ ...placement, trunkDeviceId: device.id })
        }
      }
    }
    for (const device of collectAllGroundTrunkDevices(
      selectProjectElectricalPanels(currentProject),
      installation
    )) {
      if (duplicateJunctions.has(device.id)) continue
      for (const placement of device.placements ?? []) {
        if (placement.floorId === floorId) {
          result.push({ ...placement, trunkDeviceId: device.id })
        }
      }
    }
    for (const enclosure of selectProjectAuxiliaryElectricalEnclosures(currentProject)) {
      for (const placement of enclosure.placements ?? []) {
        if (placement.floorId === floorId) {
          result.push({ ...placement, enclosureId: enclosure.id, planLabel: enclosure.name })
        }
      }
    }
    const jpPlacements = installation?.junctionPanelPlacements ?? []
    for (const jp of jpPlacements) {
      if (jp.floorId === floorId) {
        result.push({
          id: jp.id,
          floorId: jp.floorId,
          layer: jp.layer ?? 'default',
          pos: jp.pos,
          rotationDeg: (jp.rotationDeg ?? 0) as 0 | 90 | 180 | 270,
          rotationMode: jp.rotationMode,
          scale: jp.scale ?? 1,
          junctionPanelLabel: jp.label,
        })
      }
    }
    const earthingPlacements = installation?.earthingPlacements ?? []
    for (const ep of earthingPlacements) {
      if (ep.floorId === floorId) {
        result.push({
          id: ep.id,
          floorId: ep.floorId,
          layer: ep.layer ?? 'default',
          pos: ep.pos,
          rotationDeg: (ep.rotationDeg ?? 0) as 0 | 90 | 180 | 270,
          rotationMode: ep.rotationMode,
          scale: ep.scale ?? 1,
          locked: ep.locked,
          isEarthing: true,
        })
      }
    }
    return result
  },

  getTrunkDeviceById: (deviceId) => {
    const { currentProject } = get()
    return currentProject ? findProjectTrunkDevice(currentProject, deviceId) : undefined
  },

  // Helper to find parent circuit for an endpoint (works for endpoints in main or secondary panels)
  findCircuitForEndpoint: (endpointId) => {
    const { currentProject } = get()
    if (!currentProject) return undefined
    for (const panel of selectProjectElectricalPanels(currentProject)) {
      const found = findCircuitForEndpointInPanel(panel, endpointId)
      if (found) return found
    }
    return undefined
  },

  // Helper to find parent panel for a circuit (returns the panel that actually contains the circuit, including sub-panels)
  findPanelForCircuit: (circuitId) => {
    const { currentProject } = get()
    if (!currentProject) return undefined
    for (const panel of selectProjectElectricalPanels(currentProject)) {
      const found = findPanelContainingCircuit(panel, circuitId)
      if (found) return found
    }
    return undefined
  },

  // Protection that owns this circuit (when under an MCB/RCD etc.)
  getProtectionForCircuit: (circuitId) => {
    const { currentProject } = get()
    if (!currentProject) return undefined
    for (const panel of selectProjectElectricalPanels(currentProject)) {
      const result = findCircuitById(panel, circuitId)
      if (result?.parent && 'type' in result.parent) return result.parent as ProtectionDevice
    }
    return undefined
  },

  // Path from root to the given panel (main panel first, target panel last); null if not found
  getPanelPathFromRoot: (targetPanelId) => {
    const { currentProject } = get()
    if (!currentProject) return null
    return getPanelPathFromRoot(selectProjectElectricalPanels(currentProject), targetPanelId)
  },

  // Helper to get all endpoints (for searching)
  getAllEndpoints: () => {
    const { currentProject } = get()
    if (!currentProject) return []
    const endpoints: Endpoint[] = []
    for (const panel of selectProjectElectricalPanels(currentProject)) {
      endpoints.push(...getAllEndpoints(panel))
    }
    return endpoints
  },

  quarantineDetectedOrphan: (orphan) =>
    set((state) => {
      if (!state.currentProject || !orphan.quarantinePayload) return
      const p = state.currentProject
      if (orphan.quarantinePayload.kind === 'circuit') {
        quarantineCircuit(
          p,
          orphan.panelId,
          orphan.quarantinePayload.circuitId,
          orphan.reason,
          orphan.quarantinePayload.originalParentId,
          orphan.quarantinePayload.originalRefId
        )
      } else {
        quarantineEndpoint(
          p,
          orphan.panelId,
          orphan.quarantinePayload.circuitId,
          orphan.quarantinePayload.endpointId,
          orphan.reason,
          orphan.quarantinePayload.originalRefId
        )
      }
      state.isDirty = true
    }),

  resolveDetectedOrphan: (orphan) =>
    set((state) => {
      if (!state.currentProject || !orphan.resolutionPayload) return
      const payload = orphan.resolutionPayload
      if (payload.kind === 'attachCircuitToProtection') {
        const targetPanel = findPanelById(
          editProjectElectricalPanels(state.currentProject),
          payload.panelId
        )
        if (!targetPanel) return
        const circuitResult = findCircuitById(targetPanel, payload.circuitId)
        const circuit = circuitResult?.circuit
        if (!circuit || circuit.code === 'PANEL') return

        // Older DC-bus drops created a hidden OTHER/directDcBusFeeder carrier instead of a
        // real protective device. Promote that carrier in place so the existing bus and
        // parent-circuit references remain valid while the circuit becomes renderable.
        const hiddenDcBusCarrier = targetPanel.protections.find(
          (protection) =>
            protection.type === 'OTHER' &&
            protection.directDcBusFeeder === true &&
            protection.dcBusId != null &&
            protection.circuits?.some(
              (candidate) =>
                candidate.id === circuit.id && candidate.dcBusSource?.busId === protection.dcBusId
            )
        )
        if (hiddenDcBusCarrier) {
          hiddenDcBusCarrier.type = 'MCB'
          hiddenDcBusCarrier.label = hiddenDcBusCarrier.label?.trim() || circuit.code || 'MCB'
          hiddenDcBusCarrier.ratingA ??= 16
          hiddenDcBusCarrier.curve ??= 'C'
          hiddenDcBusCarrier.directDcBusFeeder = undefined
          state.isDirty = true
          return
        }

        if (circuitResult.parent !== targetPanel) return

        const attachableProtection =
          targetPanel.protections.find((protection) => {
            if (protection.subPanelId) return false
            return (
              protection.type === 'MCB' ||
              protection.type === 'RCBO' ||
              protection.type === 'FUSE' ||
              protection.type === 'OTHER'
            )
          }) ?? targetPanel.protections.find((protection) => !protection.subPanelId)

        if (attachableProtection) {
          if (!attachableProtection.circuits) attachableProtection.circuits = []
          if (!attachableProtection.circuits.some((existing) => existing.id === circuit.id)) {
            attachableProtection.circuits.push(circuit)
          }
        } else {
          targetPanel.protections.push({
            id: generateId(),
            type: 'MCB',
            label: `MCB ${circuit.code}`,
            ratingA: 16,
            curve: 'C',
            circuits: [circuit],
          })
        }

        targetPanel.circuits = targetPanel.circuits.filter(
          (candidate) => candidate.id !== circuit.id
        )
        state.isDirty = true
      } else if (payload.kind === 'dedupeEndpointPlacements') {
        let endpoint: Endpoint | undefined
        for (const panel of editProjectElectricalPanels(state.currentProject)) {
          const found = findEndpointById(panel, payload.endpointId)
          if (found) {
            endpoint = found.endpoint
            break
          }
        }
        if (!endpoint) return
        const keepIndex = endpoint.placements.findIndex((p) => p.id === payload.keepPlacementId)
        if (keepIndex < 0) return
        const removeSet = new Set(payload.removePlacementIds)
        endpoint.placements = endpoint.placements.filter((p, index) =>
          p.id === payload.keepPlacementId ? index === keepIndex : !removeSet.has(p.id)
        )
        state.isDirty = true
      } else if (payload.kind === 'repairSharedPlanPlacementIds') {
        const ownerKeys = new Set(payload.owners.map((owner) => `${owner.kind}:${owner.id}`))
        let keptPlacement = false
        let changed = false

        const repairOwner = (kind: 'endpoint' | 'trunkDevice', owner: Endpoint | TrunkDevice) => {
          if (!ownerKeys.has(`${kind}:${owner.id}`)) return
          if (!owner.placements?.length) return
          owner.placements = owner.placements.map((placement) => {
            if (placement.id !== payload.placementId) return placement
            if (!keptPlacement) {
              keptPlacement = true
              return placement
            }
            changed = true
            return { ...placement, id: generateId() }
          })
        }

        for (const panel of editProjectElectricalPanels(state.currentProject)) {
          for (const endpoint of getAllEndpoints(panel)) repairOwner('endpoint', endpoint)
          for (const circuit of getAllCircuits(panel)) {
            for (const device of circuit.trunkDevices ?? []) repairOwner('trunkDevice', device)
            for (const branch of circuit.branches ?? []) {
              for (const device of branch.branchDevices ?? []) repairOwner('trunkDevice', device)
            }
          }
        }
        for (const device of getAllSupplyTrunkDevices(state.currentProject)) {
          repairOwner('trunkDevice', device)
        }
        for (const device of collectAllGroundTrunkDevices(
          editProjectElectricalPanels(state.currentProject),
          selectProjectElectricalInstallation(state.currentProject)
        )) {
          repairOwner('trunkDevice', device)
        }
        if (changed) state.isDirty = true
      } else if (payload.kind === 'repairPanelGridDuplicateModules') {
        const targetPanel = findPanelById(
          editProjectElectricalPanels(state.currentProject),
          payload.panelId
        )
        if (!targetPanel?.gridView) return

        const shouldKeepSlot = (slot: PanelGridSlot, area: 'main' | 'supply'): boolean =>
          !payload.removeSlots.some(
            (entry) =>
              entry.area === area &&
              entry.row === slot.row &&
              entry.col === slot.col &&
              entry.moduleKey === panelGridModuleRefKey(slot.module)
          )

        targetPanel.gridView.slots = (targetPanel.gridView.slots ?? []).filter((slot) =>
          shouldKeepSlot(slot, 'main')
        )
        targetPanel.gridView.supplyPanelSlots = (
          targetPanel.gridView.supplyPanelSlots ?? []
        ).filter((slot) => shouldKeepSlot(slot, 'supply'))

        if (payload.hideModuleKeys.length > 0) {
          const hidden = new Set(targetPanel.gridView.hiddenModuleKeys ?? [])
          for (const key of payload.hideModuleKeys) hidden.add(key)
          targetPanel.gridView.hiddenModuleKeys = [...hidden]
        }

        state.isDirty = true
      } else if (payload.kind === 'ejectSupplyTrunkToSupplyStrip') {
        const targetPanel = findPanelById(
          editProjectElectricalPanels(state.currentProject),
          payload.panelId
        )
        if (!targetPanel) return
        if (
          ejectSupplyTrunkFromMainGridSlot(targetPanel, state.currentProject, payload.moduleRef)
        ) {
          state.isDirty = true
        }
      } else if (payload.kind === 'repairSupplyTrunkPanelMountingSlot') {
        const targetPanel = findPanelById(
          editProjectElectricalPanels(state.currentProject),
          payload.panelId
        )
        if (!targetPanel) return
        if (
          healPanelMountedSupplyTrunkSlotsForPanel(
            targetPanel,
            state.currentProject,
            payload.deviceId
          )
        ) {
          state.isDirty = true
        }
      } else if (payload.kind === 'repairDomoticaChildLink') {
        const p = state.currentProject
        let circuit: Circuit | null = null
        for (const panel of editProjectElectricalPanels(p)) {
          const found = findCircuitById(panel, payload.circuitId)
          if (found) {
            circuit = found.circuit
            break
          }
        }
        if (!circuit) return
        const parent = circuit.endpoints.find((e) => e.id === payload.parentEndpointId)
        const child = circuit.endpoints.find((e) => e.id === payload.endpointId)
        if (!parent?.domoticaProps || !child) return

        const ids = [...(parent.domoticaProps.endpointChildEndpointIds ?? [])]
        while (ids.length <= payload.outputIndex) ids.push('')
        if (ids[payload.outputIndex] !== payload.endpointId) {
          ids[payload.outputIndex] = payload.endpointId
        }

        parent.domoticaProps = {
          ...parent.domoticaProps,
          endpointCount: Math.max(parent.domoticaProps.endpointCount ?? 1, payload.outputIndex + 1),
          endpointChildEndpointIds: ids,
        }
        child.domoticaChildProps = {
          parentEndpointId: parent.id,
          outputGroup: 'endpoint',
          outputIndex: payload.outputIndex,
        }
        if (circuit.branches?.length) {
          let placed = false
          circuit.branches = circuit.branches.map((branch) => {
            const withoutChild = branch.endpointIds.filter((id) => id !== child.id)
            const parentIndex = withoutChild.indexOf(parent.id)
            if (!placed && parentIndex >= 0) {
              placed = true
              const nextIds = [...withoutChild]
              nextIds.splice(parentIndex + 1, 0, child.id)
              return { ...branch, endpointIds: nextIds }
            }
            return { ...branch, endpointIds: withoutChild }
          })
        }
        normalizeDomoticaCircuit(circuit)
        state.isDirty = true
      } else if (payload.kind === 'addAutoSitplanPlacement') {
        const p = state.currentProject
        healProjectFloorsElectricalLayers(p)
        const floorId = resolveSitplanTargetFloorId(p, useUIStore.getState().activeFloorId)
        if (!floorId) return
        mutateBuildingFloorView(p, floorId, ensureElectricalLayerOnFloor)

        let targetEndpoint: Endpoint | undefined
        for (const panel of editProjectElectricalPanels(p)) {
          const found = findEndpointById(panel, payload.endpointId)
          if (found) {
            targetEndpoint = found.endpoint
            break
          }
        }
        if (!targetEndpoint || targetEndpoint.placements.length > 0) return

        const hit = findCircuitForEndpointInProject(p, payload.endpointId)
        if (!hit) return
        const circuitId = hit.circuit.id

        const uiSnap = useUIStore.getState()
        const preferredPlanPos =
          getViewportCenterPlanSpaceIfApplicable(
            uiSnap.viewportLayout,
            uiSnap.planCanvasViewportPx,
            uiSnap.activeFloorId,
            floorId,
            uiSnap.planView
          ) ?? undefined
        const placement = buildAutoSitplanPlacement(p, {
          circuitId,
          floorId,
          placementId: generateId(),
          ...(preferredPlanPos ? { preferredPlanPos } : {}),
        })
        if (!placement) return

        for (const panel of editProjectElectricalPanels(p)) {
          const found = findEndpointById(panel, payload.endpointId)
          if (found) {
            found.endpoint.placements.push(placement)
            state.isDirty = true
            return
          }
        }
      } else if (payload.kind === 'syncPanelDistributionLabel') {
        const p = state.currentProject
        let target: Endpoint | undefined
        for (const panel of editProjectElectricalPanels(p)) {
          const found = findEndpointById(panel, payload.endpointId)
          if (found) {
            target = found.endpoint
            break
          }
        }
        if (!target || target.symbol !== 'panel_distribution') return
        const board = resolvePanelForDistributionEndpoint(p, target)
        if (!board) return
        target.label = board.name
        if (target.panelId !== board.id) target.panelId = board.id
        state.isDirty = true
      } else if (payload.kind === 'mergeMultiplierEndpointsOnBranch') {
        const p = state.currentProject
        const { circuitId, keepEndpointId, absorbEndpointIds } = payload
        if (!absorbEndpointIds.length) return
        let circuit: Circuit | null = null
        let keeper: Endpoint | undefined
        for (const panel of editProjectElectricalPanels(p)) {
          const found = findCircuitById(panel, circuitId)
          if (found) {
            circuit = found.circuit
            keeper = found.circuit.endpoints.find((e) => e.id === keepEndpointId)
            break
          }
        }
        if (!circuit || !keeper) return
        const absorbs = absorbEndpointIds.map((aid) => circuit!.endpoints.find((e) => e.id === aid))
        if (absorbs.some((a) => !a)) return
        const usedPlacementIds = new Set(keeper.placements.map((pl) => pl.id))
        for (const absorb of absorbs) {
          if (!absorb) continue
          for (const pl of absorb.placements) {
            let pid = pl.id
            if (usedPlacementIds.has(pid)) {
              pid = generateId()
            }
            usedPlacementIds.add(pid)
            keeper.placements.push({ ...pl, id: pid })
          }
        }
        removeEndpointIdsFromCircuit(circuit, new Set(absorbEndpointIds))
        normalizeDomoticaCircuit(circuit)
        state.isDirty = true
      } else if (payload.kind === 'repairCircuitBranchMembership') {
        const targetPanel = findPanelById(
          editProjectElectricalPanels(state.currentProject),
          payload.panelId
        )
        if (!targetPanel) return
        const circuitResult = findCircuitById(targetPanel, payload.circuitId)
        if (!circuitResult || circuitResult.circuit.code === 'PANEL') return
        if (repairCircuitBranchMembership(circuitResult.circuit)) {
          normalizeDomoticaCircuit(circuitResult.circuit)
          syncDerivedEndpointFlags(circuitResult.circuit)
          state.isDirty = true
        }
      } else if (payload.kind === 'repairSubCircuitSelfReference') {
        const targetPanel = findPanelById(
          editProjectElectricalPanels(state.currentProject),
          payload.panelId
        )
        if (!targetPanel) return
        const circuitResult = findCircuitById(targetPanel, payload.circuitId)
        if (!circuitResult || circuitResult.circuit.code === 'PANEL') return
        const c = circuitResult.circuit
        if (!c.subCircuitIds?.length) return
        const next = c.subCircuitIds.filter((id) => id !== c.id)
        if (next.length === c.subCircuitIds.length) return
        c.subCircuitIds = next.length > 0 ? next : undefined
        state.isDirty = true
      } else if (payload.kind === 'pruneFrameContentReference') {
        pruneEendraadFrames(state.currentProject, {
          removedMemberIds: payload.contentType === 'circuit' ? undefined : [payload.contentId],
          removedCircuitIds: payload.contentType === 'circuit' ? [payload.contentId] : undefined,
        })
        state.isDirty = true
      } else if (payload.kind === 'collapsePanelFeedToSingleGrid') {
        if (setPanelFeedOrganizationInProject(state.currentProject, payload.panelId, 'single')) {
          state.isDirty = true
        }
      }
    }),

  restoreFromQuarantine: (quarantinedItemId) =>
    set((state) => {
      if (!state.currentProject) return
      if (doRestoreFromQuarantine(state.currentProject, quarantinedItemId)) {
        state.isDirty = true
      }
    }),

  removeFromQuarantine: (quarantinedItemId) =>
    set((state) => {
      if (!state.currentProject) return
      if (doRemoveFromQuarantine(state.currentProject, quarantinedItemId)) {
        state.isDirty = true
      }
    }),

  repairBranchMembershipForQuarantinedItem: (quarantinedItemId) =>
    set((state) => {
      const p = state.currentProject
      if (!p) return
      const item = queryQuarantinedItems(p).find((q) => q.id === quarantinedItemId)
      if (!item || item.reason !== 'endpointNotInBranch') return

      if (item.kind === 'circuit') {
        const circuit = item.data as Circuit
        if (circuit.code === 'PANEL') return
        if (repairCircuitBranchMembership(circuit)) {
          normalizeDomoticaCircuit(circuit)
          syncDerivedEndpointFlags(circuit)
          state.isDirty = true
        }
        return
      }

      const circuitId = item.originalParentId
      if (!circuitId) return
      const panel = findPanelById(editProjectElectricalPanels(p), item.panelId)
      if (!panel) return
      const found = findCircuitById(panel, circuitId)
      if (!found || found.circuit.code === 'PANEL') return
      if (repairCircuitBranchMembership(found.circuit)) {
        normalizeDomoticaCircuit(found.circuit)
        syncDerivedEndpointFlags(found.circuit)
        state.isDirty = true
      }
    }),

  updateWireRunAtAnchor: (anchor, cable, changes, sharedGeometryAnchors) =>
    set((state) => {
      if (!state.currentProject) return
      if (
        changes.lengthSource === 'estimated' &&
        !estimateCableRoutes(state.currentProject).routes.some(
          (route) =>
            (route.anchor === anchor || route.aliasAnchors?.includes(anchor)) &&
            route.scaleCalibrated !== false &&
            route.highM > 0
        )
      )
        return
      editWireRunAtAnchor(
        state.currentProject,
        anchor,
        cable,
        changes,
        undefined,
        sharedGeometryAnchors
      )
      state.isDirty = true
    }),

  acceptWireLengthEstimates: (entries) =>
    set((state) => {
      if (!state.currentProject || entries.length === 0) return
      if (acceptWireLengthEstimatesInProject(state.currentProject, entries)) state.isDirty = true
    }),

  makeWireCableProjectDefault: (anchor, cable, sharedGeometryAnchors) =>
    set((state) => {
      const installation = state.currentProject
        ? getEditableProjectElectricalInstallation(state.currentProject)
        : undefined
      if (!state.currentProject || !installation) return
      installation.defaultCableKind = cable.kind
      editWireRunAtAnchor(
        state.currentProject,
        anchor,
        cable,
        { followsDefaultCable: true },
        undefined,
        sharedGeometryAnchors
      )
      state.isDirty = true
    }),

  // Wire segment actions
  updateWireSegment: (id, updates) =>
    set((state) => {
      if (state.currentProject) {
        const wireSegments = editOneWireSegments(state.currentProject)

        // Find existing wire segment override
        let wireSegment = wireSegments.find((ws) => ws.id === id)

        if (!wireSegment) {
          // Create new wire segment override with minimal data
          wireSegment = {
            id,
            type: 'vertical', // Default, will be overridden if needed
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 0, y: 0 },
            cable: {
              kind: 'XVB',
              conductors: 3,
              sectionMm2: 2.5,
              hasPE: true,
            },
            domain: DEFAULT_ELECTRICAL_DOMAIN,
            panelId: '', // Will be set from updates if provided
            ...updates,
          } as WireSegment
          wireSegments.push(wireSegment)
        } else {
          // Update existing wire segment override
          // If updating cable, merge the cable object
          if (updates.cable) {
            wireSegment.cable = { ...wireSegment.cable, ...updates.cable }
          }
          // Update other properties (excluding cable which is handled above)
          const { cable: _cable, ...otherUpdates } = updates
          Object.assign(wireSegment, otherUpdates)
        }

        state.isDirty = true
      }
    }),

  getWireSegmentById: (id: string) => {
    const { currentProject } = getProjectStoreApi().getState()
    if (!currentProject) return undefined
    return queryOneWireSegments(currentProject).find((ws: WireSegment) => ws.id === id)
  },

  // Eendraad Note actions
  addEendraadNote: (note: Note) =>
    set((state) => {
      if (!state.currentProject) return
      const result = addEendraadNoteInProject(state.currentProject, note)
      if (result.circuitId) state.lastWorkedCircuitId = result.circuitId
      if (result.changed) state.isDirty = true
    }),

  updateEendraadNote: (id: string, updates: Partial<Note>) =>
    set((state) => {
      if (
        state.currentProject &&
        updateAnnotationPropertiesInProject(
          state.currentProject,
          'note',
          id,
          updates as Record<string, unknown>,
          'oneWire'
        )
      )
        state.isDirty = true
    }),

  deleteEendraadNote: (id: string) =>
    set((state) => {
      if (state.currentProject) {
        const notes = editOneWireNotes(state.currentProject)
        replaceOneWireNotes(
          state.currentProject,
          notes.filter((n: Note) => n.id !== id)
        )
        state.isDirty = true
      }
    }),

  deleteEendraadNotes: (ids: string[]) =>
    set((state) => {
      if (state.currentProject) {
        const notes = editOneWireNotes(state.currentProject)
        replaceOneWireNotes(
          state.currentProject,
          notes.filter((n: Note) => !ids.includes(n.id))
        )
        state.isDirty = true
      }
    }),

  getEendraadNoteById: (id: string) => {
    const { currentProject } = getProjectStoreApi().getState()
    if (!currentProject) return undefined
    return queryOneWireNotes(currentProject).find((n: Note) => n.id === id)
  },

  getEendraadNotesByPanel: (panelId: string) => {
    const { currentProject } = getProjectStoreApi().getState()
    if (!currentProject) return []
    return queryOneWireNotes(currentProject).filter((n: Note) => n.panelId === panelId)
  },

  // Sitplan Note actions
  addSitplanNote: (note: Note) =>
    set((state) => {
      if (state.currentProject && addSitplanNoteInProject(state.currentProject, note)) {
        state.isDirty = true
      }
    }),

  updateSitplanNote: (id: string, updates: Partial<Note>) =>
    set((state) => {
      if (
        state.currentProject &&
        updateAnnotationPropertiesInProject(
          state.currentProject,
          'note',
          id,
          updates as Record<string, unknown>,
          'sitplan'
        )
      )
        state.isDirty = true
    }),

  deleteSitplanNote: (id: string) =>
    set((state) => {
      if (state.currentProject) {
        const notes = querySitplanNotes(state.currentProject)
        replaceSitplanNotes(
          state.currentProject,
          notes.filter((n: Note) => n.id !== id)
        )
        state.isDirty = true
      }
    }),

  deleteSitplanNotes: (ids: string[]) =>
    set((state) => {
      if (state.currentProject) {
        const notes = querySitplanNotes(state.currentProject)
        replaceSitplanNotes(
          state.currentProject,
          notes.filter((n: Note) => !ids.includes(n.id))
        )
        state.isDirty = true
      }
    }),

  getSitplanNoteById: (id: string) => {
    const { currentProject } = getProjectStoreApi().getState()
    if (!currentProject) return undefined
    return querySitplanNotes(currentProject).find((n: Note) => n.id === id)
  },

  getSitplanNotesByFloor: (floorId: string) => {
    const { currentProject } = getProjectStoreApi().getState()
    if (!currentProject) return []
    return querySitplanNotes(currentProject).filter((n: Note) => n.floorId === floorId)
  },

  // Frame actions
  addFrame: (frame: Frame) =>
    set((state) => {
      if (state.currentProject && addOneWireFrameInProject(state.currentProject, frame)) {
        state.isDirty = true
      }
    }),

  updateFrame: (id: string, updates: Partial<Frame>) =>
    set((state) => {
      if (
        state.currentProject &&
        updateAnnotationPropertiesInProject(
          state.currentProject,
          'frame',
          id,
          updates as Record<string, unknown>,
          undefined
        )
      )
        state.isDirty = true
    }),

  deleteFrame: (id: string) =>
    set((state) => {
      if (state.currentProject) {
        const frames = editOneWireFrames(state.currentProject)
        replaceOneWireFrames(
          state.currentProject,
          frames.filter((f: Frame) => f.id !== id)
        )
        state.isDirty = true
      }
    }),

  deleteFrames: (ids: string[]) =>
    set((state) => {
      if (state.currentProject) {
        const frames = editOneWireFrames(state.currentProject)
        replaceOneWireFrames(
          state.currentProject,
          frames.filter((f: Frame) => !ids.includes(f.id))
        )
        state.isDirty = true
      }
    }),

  getFrameById: (id: string) => {
    const { currentProject } = getProjectStoreApi().getState()
    if (!currentProject) return undefined
    return queryOneWireFrames(currentProject).find((f: Frame) => f.id === id)
  },

  getFramesByPanel: (panelId: string) => {
    const { currentProject } = getProjectStoreApi().getState()
    if (!currentProject) return []
    return queryOneWireFrames(currentProject).filter((f: Frame) => f.panelId === panelId)
  },
})
