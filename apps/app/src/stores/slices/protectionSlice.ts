import { DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS } from '@/lib/wires/circuitWireDefaults'
import type { ProjectSliceCreator } from './projectStoreTypes'
import { recordSessionAction } from '@/lib/diagnostics/sessionActionLog'
import { liftCircuitContentAboveOwnProtection } from '@/lib/eendraad/circuitContentInsertion'
import { runDuplicateProtectionLeft } from '@/lib/eendraad/duplicateProtectionLeftCore'
import {
  moveProtectionToSupplyWireInProject,
  promoteCircuitToMainBusInProject,
} from '@/lib/eendraad/busMoveMutations'
import { ensureSitplanPlacementsForEndpoints } from '@/lib/eendraad/duplicateSitplanHelpers'
import { findParentCircuitInfo } from '@/lib/eendraad/findParentCircuitInfo'
import { pruneEendraadFrames } from '@/lib/eendraad/frameContent'
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
} from '@/lib/eendraad/mainBusOrder'
import { moveCircuitsToRcdBus } from '@/lib/eendraad/panelAttachmentMove'
import {
  applyAutomaticEendraadNamingAllPanelsInProject,
  cleanupPanelGridSlotsForDevice,
  deleteLinkedSubPanelsIfOrphaned,
  ensureLinkedSubPanelsHaveOwnPanelEndpoint,
  ensureRcboSensitivityOnProtection,
  findCircuitById,
  findPanelContainingCircuit,
  findPanelOwningProtection,
  findProtectionById,
  getAllCircuits,
  maybeApplyAutomaticEendraadNamingForPanel,
  migrateSubCircuitContentToParent,
  prunePanelGridSlotsForUnresolvedModules,
  pruneStaleElectricalEndpointRecords,
  pruneStalePanelGridProtectionReferencesInProject,
  removePanelGridDuplicateRefs,
  rewirePanelGridProtectionModuleId,
  syncLinkedSubPanelHierarchy,
} from '@/lib/eendraad/projectElectricalDomain'
import { addProtectionToProject } from '@/lib/eendraad/protectionMutations'
import { resolveSecondaryBusEjectSelection } from '@/lib/eendraad/secondaryBusEjectEligibility'
import { ejectSecondaryBusProtectionsToNewPanelInProject } from '@/lib/eendraad/secondaryBusEjectMutation'
import { ensureInstallationFeedTopology } from '@/lib/feedTopology'
import domainI18n from '@/lib/i18n/domainI18n'
import { logger } from '@/lib/logger'
import { findPanelById } from '@/lib/panel/panelTree'
import { getViewportCenterPlanSpaceIfApplicable } from '@/lib/plan/autoSitplanPlacement'
import { healPlanWiring } from '@/lib/plan/planWiring'
import {
  collectPanelEndpointIds,
  deleteProtectionInProject,
  moveCircuitOnMainBusInProject,
  moveCircuitToSecondaryBusInProject,
  preserveDeletedProtectionPanelLinks,
  promoteDeletedProtectionSubcircuits,
  updateProtectionInProject,
} from '@/lib/projectMutations/storeActions'
import {
  getEditableProjectElectricalInstallation,
  getEditableProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { getDefaultProtectionProps, getVoltagePolesConfig } from '@/lib/protectionDefaults'
import { createDefaultAcCircuitCable } from '@/lib/wires/circuitWireDefaults'
import { useUIStore } from '@/stores/uiStore'
import type { Circuit, Panel, ProtectionDevice } from '@/types/schema'
import { ensurePanelPlacement } from '@/utils/panelPlacement'
import { countPanels, generateId, getNextAvailableCircuitCode } from '@/utils/project'

export const createProtectionSlice: ProjectSliceCreator = (set, get) => ({
  // Protection actions
  addProtection: (panelId, protection) =>
    set((state) => {
      if (
        state.currentProject &&
        addProtectionToProject(state.currentProject, panelId, protection)
      ) {
        state.isDirty = true
      }
    }),

  insertProtectionAfter: (panelId, protection, afterProtectionId) =>
    set((state) => {
      if (state.currentProject) {
        const panels = getEditableProjectElectricalPanels(state.currentProject)
        const panel = findPanelById(panels, panelId)
        if (panel) {
          const idx = panel.protections.findIndex((p) => p.id === afterProtectionId)
          if (idx >= 0) {
            if (!protection.circuits) protection.circuits = []
            ensureRcboSensitivityOnProtection(protection)
            panel.protections.splice(idx + 1, 0, protection)
            state.isDirty = true
            maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, panelId)
          }
        }
      }
    }),

  insertProtectionBefore: (panelId, protection, beforeProtectionId) =>
    set((state) => {
      if (state.currentProject) {
        const panels = getEditableProjectElectricalPanels(state.currentProject)
        const panel = findPanelById(panels, panelId)
        if (panel) {
          const idx = panel.protections.findIndex((p) => p.id === beforeProtectionId)
          if (idx >= 0) {
            if (!protection.circuits) protection.circuits = []
            ensureRcboSensitivityOnProtection(protection)
            panel.protections.splice(idx, 0, protection)
            state.isDirty = true
            maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, panelId)
          }
        }
      }
    }),

  duplicateProtectionLeft: (protectionId, mainBusPlacement, options) =>
    runDuplicateProtectionLeft(
      protectionId,
      {
        getProject: () => get().currentProject,
        withSingleUndoEntry: (fn, opts) => get().withSingleUndoEntry(fn, opts),
        insertProtectionAfter: (...a) => get().insertProtectionAfter(...a),
        addCircuit: (...a) => get().addCircuit(...a),
        setDraft: (recipe) => set(recipe),
        ensureSitplanForEndpoints: (endpointIds) => {
          const project = get().currentProject
          if (!project || endpointIds.length === 0) return
          const ui = useUIStore.getState()
          ensureSitplanPlacementsForEndpoints(
            project,
            endpointIds,
            (id) => get().getEndpointById(id),
            (endpointId, placement) => get().addPlacement(endpointId, placement),
            {
              activeFloorId: ui.activeFloorId,
              viewportLayout: ui.viewportLayout,
              planCanvasViewportPx: ui.planCanvasViewportPx,
              planView: ui.planView,
            }
          )
        },
      },
      mainBusPlacement,
      options
    ),

  updateProtection: (id, updates) =>
    set((state) => {
      if (!state.currentProject) return
      const result = updateProtectionInProject(state.currentProject, id, updates)
      if (result.circuitId) state.lastWorkedCircuitId = result.circuitId
      if (result.changed) state.isDirty = true
    }),

  deleteProtection: (id, options) =>
    set((state) => {
      if (!state.currentProject) return
      const protectionLabel = getEditableProjectElectricalPanels(state.currentProject)
        .map((panel) => findProtectionById(panel, id))
        .find((protection) => protection)?.label?.trim() || id
      const result = deleteProtectionInProject(state.currentProject, id, options)
      if (result.circuitId) state.lastWorkedCircuitId = result.circuitId
      if (result.changed) {
        state.isDirty = true
        recordSessionAction(`delete protection "${protectionLabel}"`)
      }
    }),

  deleteProtections: (ids, options) =>
    set((state) => {
      if (state.currentProject) {
        const currentProject = state.currentProject
        const panels = getEditableProjectElectricalPanels(currentProject)
        const electricalDevices = currentProject.disciplines.electrical?.devices
        if (ids.length === 1) {
          const onlyId = ids[0]!
          let protLabel: string | undefined
          for (const panel of panels) {
            const prot = findProtectionById(panel, onlyId)
            if (prot) {
              protLabel = prot.label?.trim()
              break
            }
          }
          recordSessionAction(
            protLabel ? `delete protection "${protLabel}"` : `delete protection (${onlyId})`
          )
        } else if (ids.length > 1) {
          recordSessionAction(`delete ${ids.length} protections`)
        }

        const idsSet = new Set(ids)
        const endpointIdsBeforeDeletion = collectPanelEndpointIds(panels)

        // Promote each deleted protection's children into its parent's chain slot. A
        // linked feeder that is explicitly being preserved keeps the existing
        // content-migration behavior so its secondary panel remains attached.
        for (const panel of panels) {
          const promoteInPanel = (p: Panel) => {
            for (const prot of p.protections) {
              if (idsSet.has(prot.id)) {
                if (prot.subPanelId && options?.preserveLinkedPanels) {
                  migrateSubCircuitContentToParent(
                    prot,
                    panels,
                    electricalDevices
                  )
                } else {
                  promoteDeletedProtectionSubcircuits(prot, panels)
                }
              }
            }
            for (const subPanel of p.subPanels) promoteInPanel(subPanel)
          }
          promoteInPanel(panel)
        }

        const linkedSubPanelIds = new Set<string>()
        const collectLinkedSubPanels = (panel: Panel) => {
          for (const prot of panel.protections) {
            if (idsSet.has(prot.id) && prot.subPanelId) {
              linkedSubPanelIds.add(prot.subPanelId)
            }
          }
          for (const subPanel of panel.subPanels) collectLinkedSubPanels(subPanel)
        }
        for (const panel of panels) collectLinkedSubPanels(panel)

        if (options?.preserveLinkedPanels && linkedSubPanelIds.size > 0) {
          preserveDeletedProtectionPanelLinks(panels, idsSet)
        }

        // Remove all matching protections in a single pass
        const removeProtections = (panel: Panel) => {
          panel.protections = panel.protections.filter((p) => !idsSet.has(p.id))
          for (const subPanel of panel.subPanels) {
            removeProtections(subPanel)
          }
        }
        for (const panel of panels) {
          removeProtections(panel)
        }
        if (linkedSubPanelIds.size > 0 && !options?.preserveLinkedPanels) {
          deleteLinkedSubPanelsIfOrphaned(state.currentProject, linkedSubPanelIds)
        }
        for (const id of idsSet) {
          cleanupPanelGridSlotsForDevice(panels, { kind: 'protection', id })
        }
        pruneStalePanelGridProtectionReferencesInProject(state.currentProject)
        const endpointIdsAfterDeletion = collectPanelEndpointIds(panels)
        const removedEndpointIds = [...endpointIdsBeforeDeletion].filter(
          (endpointId) => !endpointIdsAfterDeletion.has(endpointId)
        )
        pruneEendraadFrames(state.currentProject, {
          removedMemberIds: [...ids, ...removedEndpointIds],
        })
        healPlanWiring(state.currentProject)
        pruneStaleElectricalEndpointRecords(state.currentProject)
        state.isDirty = true
        applyAutomaticEendraadNamingAllPanelsInProject(state.currentProject)
      }
    }),

  moveCircuitOnMainBus: (panelId, circuitId, direction) =>
    set((state) => {
      if (!state.currentProject) return
      const result = moveCircuitOnMainBusInProject(
        state.currentProject,
        panelId,
        circuitId,
        direction
      )
      if (result.circuitId) state.lastWorkedCircuitId = result.circuitId
      if (result.changed) state.isDirty = true
    }),

  moveCircuitOnSecondaryBus: (circuitId, direction) =>
    set((state) => {
      logger.info('[moveCircuitOnSecondaryBus]', { circuitId, direction })
      if (!state.currentProject) {
        logger.warn('[moveCircuitOnSecondaryBus] No current project')
        return
      }

      // Find the parent circuit that contains this circuit in subCircuitIds
      for (const panel of getEditableProjectElectricalPanels(state.currentProject)) {
        const allCircuits = getAllCircuits(panel)
        for (const parentCircuit of allCircuits) {
          if (parentCircuit.subCircuitIds && parentCircuit.subCircuitIds.includes(circuitId)) {
            const index = parentCircuit.subCircuitIds.indexOf(circuitId)
            logger.info('[moveCircuitOnSecondaryBus] Found in parent circuit', {
              parentCircuitId: parentCircuit.id,
              index,
              total: parentCircuit.subCircuitIds.length,
            })
            if (direction === 'left' && index > 0) {
              // Move left (earlier in array)
              const temp = parentCircuit.subCircuitIds[index]
              if (temp === undefined) return
              const prevId = parentCircuit.subCircuitIds[index - 1]
              if (prevId === undefined) return
              parentCircuit.subCircuitIds[index] = prevId
              parentCircuit.subCircuitIds[index - 1] = temp
              logger.info('[moveCircuitOnSecondaryBus] Moved left', {
                newIndex: index - 1,
                newOrder: parentCircuit.subCircuitIds,
              })
              state.isDirty = true
              const ownerPanel = findPanelContainingCircuit(panel, parentCircuit.id)
              if (ownerPanel) {
                maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, ownerPanel.id)
              }
              return
            } else if (direction === 'right' && index < parentCircuit.subCircuitIds.length - 1) {
              // Move right (later in array)
              const temp = parentCircuit.subCircuitIds[index]
              if (temp === undefined) return
              const nextId = parentCircuit.subCircuitIds[index + 1]
              if (nextId === undefined) return
              parentCircuit.subCircuitIds[index] = nextId
              parentCircuit.subCircuitIds[index + 1] = temp
              logger.info('[moveCircuitOnSecondaryBus] Moved right', {
                newIndex: index + 1,
                newOrder: parentCircuit.subCircuitIds,
              })
              state.isDirty = true
              const ownerPanel = findPanelContainingCircuit(panel, parentCircuit.id)
              if (ownerPanel) {
                maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, ownerPanel.id)
              }
              return
            } else {
              logger.info('[moveCircuitOnSecondaryBus] Cannot move', {
                direction,
                index,
                length: parentCircuit.subCircuitIds.length,
              })
            }
          }
        }
      }
      logger.warn("[moveCircuitOnSecondaryBus] Circuit not found in any parent's subCircuitIds", {
        circuitId,
      })
    }),

  moveCircuitToMainBus: (panelId, circuitId, mainBusInsertIndex) =>
    set((state) => {
      if (!state.currentProject) return
      const result = promoteCircuitToMainBusInProject(state.currentProject, {
        kind: 'promoteCircuit',
        panelId,
        circuitId,
        insertIndex: mainBusInsertIndex,
      })
      if (result.changed) state.isDirty = true
    }),

  moveProtectionToPanelSupplyWire: (protectionId, panelId) => {
    let moved = false
    set((state) => {
      if (!state.currentProject) return
      moved = moveProtectionToSupplyWireInProject(state.currentProject, protectionId, panelId)
      if (!moved) return
      state.isDirty = true
    })
    return moved
  },

  ejectProtectionToNewPanel: (protectionId, opts) => {
    let createdId: string | null = null
    set((state) => {
      if (!state.currentProject) return
      const sourcePanel = findPanelOwningProtection(
        getEditableProjectElectricalPanels(state.currentProject),
        protectionId
      )
      const protection = sourcePanel && findProtectionById(sourcePanel, protectionId)
      if (!sourcePanel || !protection) return

      const insertIdx = computeMainBusInsertIndexForEjectedProtection(
        sourcePanel,
        protectionId,
        getEditableProjectElectricalPanels(state.currentProject)
      )
      const movedCircuitIds = collectCircuitClosureDownstreamFromProtection(sourcePanel, protection)
      const representativeCircuitId = pickRepresentativeCircuitIdForMainBusMove(
        sourcePanel,
        protection
      )
      const originalParentInfo = representativeCircuitId
        ? findParentCircuitInfo(
            representativeCircuitId,
            getEditableProjectElectricalPanels(state.currentProject)
          )
        : null
      const originalParentCircuit = originalParentInfo?.parentCircuit
      const originalParentSubCircuitIndex =
        representativeCircuitId && originalParentCircuit?.subCircuitIds
          ? originalParentCircuit.subCircuitIds.indexOf(representativeCircuitId)
          : -1
      const shouldReattachFeederToOriginalParent =
        !!originalParentCircuit &&
        originalParentSubCircuitIndex >= 0 &&
        !movedCircuitIds.has(originalParentCircuit.id)

      const totalPanelCount = countPanels(getEditableProjectElectricalPanels(state.currentProject))
      const panelNumber = totalPanelCount + 1
      const newPanelId = generateId()
      createdId = newPanelId

      const descriptiveName = deriveDescriptiveNameFromProtectionForNewSubPanel(protection)
      const autoSecondaryName = `Panel ${panelNumber}`
      const derivedPanelName =
        opts?.newPanelName ??
        (descriptiveName && descriptiveName.length > 0 ? descriptiveName : autoSecondaryName)

      const newPanel: Panel = {
        id: newPanelId,
        name: derivedPanelName,
        symbol: 'panel_distribution',
        isMain: false,
        protections: [],
        circuits: [],
        subPanels: [],
      }

      if (!sourcePanel.subPanels) sourcePanel.subPanels = []
      sourcePanel.subPanels.push(newPanel)

      const uiSnap = useUIStore.getState()
      const preferredPlanPos = uiSnap.activeFloorId
        ? (getViewportCenterPlanSpaceIfApplicable(
            uiSnap.viewportLayout,
            uiSnap.planCanvasViewportPx,
            uiSnap.activeFloorId,
            uiSnap.activeFloorId,
            uiSnap.planView
          ) ?? undefined)
        : undefined
      const panelPlacement = ensurePanelPlacement(state.currentProject, newPanel, {
        ...(preferredPlanPos ? { preferredPlanPos } : {}),
      })
      if (panelPlacement) {
        const targetPanelForPlacement = findPanelById(
          getEditableProjectElectricalPanels(state.currentProject),
          newPanelId
        )!
        const panelCircuit = findCircuitById(targetPanelForPlacement, 'PANEL')

        if (!panelCircuit) {
          const dummyCircuit: Circuit = {
            id: generateId(),
            code: 'PANEL',
            kind: 'other',
            cable: {
              kind: 'XVB',
              conductors: 3,
              sectionMm2: 6,
              hasPE: true,
            },
            endpoints: [],
          }

          targetPanelForPlacement.circuits.push(dummyCircuit)
          panelPlacement.endpoint.placements = [panelPlacement.placement]
          dummyCircuit.endpoints.push(panelPlacement.endpoint)
        } else {
          const existingEndpoint = panelCircuit.circuit.endpoints.find(
            (e) =>
              e.symbol === 'panel_distribution' &&
              (e.panelId === newPanel.id || e.label === newPanel.name)
          )
          if (existingEndpoint) {
            existingEndpoint.placements.push(panelPlacement.placement)
          } else {
            panelPlacement.endpoint.placements = [panelPlacement.placement]
            panelCircuit.circuit.endpoints.push(panelPlacement.endpoint)
          }
        }
      }

      const voltagePoles = getVoltagePolesConfig(state.currentProject)
      const targetPanel = findPanelById(
        getEditableProjectElectricalPanels(state.currentProject),
        newPanelId
      )!
      if (!targetPanel.circuits.some((circuit) => circuit.code === 'PANEL')) {
        targetPanel.circuits.push({
          id: generateId(),
          code: 'PANEL',
          kind: 'other',
          cable: {
            kind: 'XVB',
            conductors: 3,
            sectionMm2: 6,
            hasPE: true,
          },
          endpoints: [],
        })
      }
      relocateProtectionToPanelMainBus(sourcePanel, targetPanel, protection, 0)
      const incomingDevice = protectionDeviceToSubPanelIncomingTrunkDevice(
        protection,
        protection.id,
        voltagePoles
      )
      const protectionHasOwnEndpoints = (protection.circuits ?? []).some(
        (circuit) => (circuit.endpoints?.length ?? 0) > 0
      )
      if (!protectionHasOwnEndpoints) {
        promoteMovedSubPanelRootToIncomingTrunk(targetPanel, protection.id, incomingDevice)
      }

      const parentProtForMergedFeeder = originalParentInfo?.parentProtection
      if (shouldReattachFeederToOriginalParent && parentProtForMergedFeeder) {
        parentProtForMergedFeeder.subPanelId = newPanelId
        rewirePanelGridProtectionModuleId(sourcePanel, protectionId, parentProtForMergedFeeder.id)
        originalParentCircuit.subCircuitIds = originalParentCircuit.subCircuitIds?.filter(
          (circuitId) => circuitId !== representativeCircuitId
        )
        if (originalParentCircuit.subCircuitIds?.length === 0) {
          originalParentCircuit.subCircuitIds = undefined
        }
      } else {
        const feederCode = getNextAvailableCircuitCode(state.currentProject, sourcePanel.id)
        const feederProtectionId = generateId()
        const mcbDefaults = getDefaultProtectionProps('MCB', voltagePoles)
        const feederProtection: ProtectionDevice = {
          id: feederProtectionId,
          type: 'MCB',
          label: feederCode,
          circuits: [],
          subPanelId: newPanelId,
          ...mcbDefaults,
        }
        ensureRcboSensitivityOnProtection(feederProtection)
        sourcePanel.protections.push(feederProtection)
        feederProtection.circuits = [
          {
            id: generateId(),
            code: feederCode,
            kind: 'other',
            cable: createDefaultAcCircuitCable({ sectionMm2: 6 }),
            endpoints: [],
            ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
          },
        ]
        rewirePanelGridProtectionModuleId(sourcePanel, protectionId, feederProtectionId)
        moveProtectionToMainBusInsertIndex(sourcePanel, feederProtectionId, insertIdx)
      }

      prunePanelGridSlotsForUnresolvedModules(sourcePanel)
      removePanelGridDuplicateRefs(state.currentProject, sourcePanel)

      dedupePanelProtectionsInPanelTree(sourcePanel)
      dedupePanelProtectionsInPanelTree(targetPanel)
      ensureLinkedSubPanelsHaveOwnPanelEndpoint(state.currentProject)
      syncLinkedSubPanelHierarchy(state.currentProject)
      const installation = getEditableProjectElectricalInstallation(state.currentProject)
      if (!installation) return
      ensureInstallationFeedTopology(
        installation,
        getEditableProjectElectricalPanels(state.currentProject)
      )

      state.isDirty = true
      maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, sourcePanel.id)
      maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, targetPanel.id)
    })
    return createdId
  },

  ejectSecondaryBusProtectionsToNewPanel: (protectionIds, opts): string | null => {
    const current = get().currentProject
    const initialSelection = resolveSecondaryBusEjectSelection(current, protectionIds)
    if (!initialSelection) return null

    let createdId: string | null = null
    set((state) => {
      if (!state.currentProject) return
      const selection = resolveSecondaryBusEjectSelection(state.currentProject, protectionIds)
      if (!selection) return
      const uiSnap = useUIStore.getState()
      const preferredPlanPos = uiSnap.activeFloorId
        ? (getViewportCenterPlanSpaceIfApplicable(
            uiSnap.viewportLayout,
            uiSnap.planCanvasViewportPx,
            uiSnap.activeFloorId,
            uiSnap.activeFloorId,
            uiSnap.planView
          ) ?? undefined)
        : undefined
      // Reuse the domain helper for the same topology mutation as the command path.
      // Use the legacy placement policy (ground/first floor and overlap avoidance) to
      // compute the placement on a detached panel, then pass its coordinates into the
      // shared mutation so the panel and its plan endpoint appear atomically.
      const placementProbe: Panel = {
        id: generateId(),
        name: 'Panel',
        symbol: 'panel_distribution',
        isMain: false,
        protections: [],
        circuits: [],
        subPanels: [],
      }
      const placement = ensurePanelPlacement(state.currentProject, placementProbe, {
        ...(preferredPlanPos ? { preferredPlanPos } : {}),
      })
      const result = ejectSecondaryBusProtectionsToNewPanelInProject(
        state.currentProject,
        selection.protectionIds,
        {
          ...(opts?.newPanelName ? { newPanelName: opts.newPanelName } : {}),
          language: domainI18n.language,
          newId: generateId,
          ...(placement
            ? {
                planPlacement: {
                  floorId: placement.placement.floorId,
                  layer: placement.placement.layer,
                  pos: placement.placement.pos,
                },
              }
            : {}),
        }
      )
      if (!result) return
      createdId = result.panelId
      state.isDirty = true
    })
    return createdId
  },

  moveCircuitToSecondaryBus: (panelId, parentCircuitId, circuitId, insertIndex, options) =>
    set((state) => {
      if (!state.currentProject) return
      const result = moveCircuitToSecondaryBusInProject(
        state.currentProject,
        panelId,
        parentCircuitId,
        circuitId,
        insertIndex,
        options
      )
      if (result.circuitId) state.lastWorkedCircuitId = result.circuitId
      if (result.changed) state.isDirty = true
    }),

  moveCircuitsToRcdBus: (panelId, rcdProtectionId, circuitIds, insertIndex) => {
    let moved = false
    set((state) => {
      if (!state.currentProject) return
      const result = moveCircuitsToRcdBus(
        getEditableProjectElectricalPanels(state.currentProject),
        panelId,
        rcdProtectionId,
        circuitIds,
        insertIndex
      )
      if (!result) return
      moved = true
      state.isDirty = true
      maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, panelId)
    })
    return moved
  },

  liftCircuitContentAboveOwnProtection: (panelId, circuitId) => {
    let changed = false
    set((state) => {
      if (!state.currentProject) return
      const panel = findPanelById(getEditableProjectElectricalPanels(state.currentProject), panelId)
      if (!panel) return

      changed = liftCircuitContentAboveOwnProtection(panel, circuitId)
      if (!changed) return
      state.isDirty = true
      maybeApplyAutomaticEendraadNamingForPanel(state.currentProject, panelId)
    })
    return changed
  },
})
