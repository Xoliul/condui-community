import { captureForkPlacementBranches, insertSavedForkEndpoint } from './forkSymbolPlacement'
import {
  addCircuitTrunkDeviceAtDrop,
  addCircuitDcPassiveDevice,
  addDcBusBranchProtectionDevice,
  dcBusBehavior,
  addConverterDcBranchDevice,
  buildVisibleTrunkSitplanPlacement,
  circuitIsTerminalPanelFeeder,
} from './dropDcDistribution'
export { canDropDcBusOnTarget } from './dropDcDistribution'
/**
 * Per-symbol drop behaviors registry
 *
 * Replaces the monolithic createDropHandler with focused, per-symbol handlers.
 * Each symbol type has its own small handler that knows what to create.
 */

import { logger } from '@/lib/logger'
import {
  getTerminalStripCreationProps,
  getTerminalStripTrunkCreationProps,
} from '@/lib/terminalStrip/labels'
import { getNextJunctionIdentity, isSharedJunctionSymbol } from '@/lib/junctionIdentity'
import { isDomoticaPanelFeedEndpoint } from '@/lib/eendraad/panelSupplyLink'
import type {
  EditorCanvasAnalytics,
  SymbolPlacementMethod,
} from '@/lib/analytics/editorEventAnalytics'
import { ensureElectricalLayerOnFloor } from '@/lib/plan/floorLayers'
import { buildAutoSitplanPlacement } from '@/lib/plan/autoSitplanPlacement'

import { resolveCircuitSitplanTargetFloorId } from '@/lib/plan/sitplanTargetFloor'
import { canSymbolAppearOnSituationPlan } from '@/lib/plan/situationPlanSymbolEligibility'
import { withSearchPresetCallbacks } from '@/lib/library/searchPresetDrop'
import { isModularSocketLibraryId } from '@/lib/socket/modularSocket'
import { generateId, getEndpointTypeFromSymbol, getSymbolKeyFromSymbol } from '@/utils'
import { getNextAvailableCircuitCode } from '@/utils/project'
import { applyLibraryPresetToEndpoint } from '@/utils/symbolMapping'
import { hideInlineConverterMetadataByDefault } from '@/lib/conversionLabels'
import { initializeBranchesIfNeeded } from '@/lib/layout/endpointChains'
import {
  getVoltagePolesConfig,
  getDefaultTrunkDeviceProtectionProps,
  getProtectionCreationProps,
} from '@/lib/protectionDefaults'
import {
  PROTECTION_SYMBOL_ID_TO_TYPE,
  PROTECTION_SYMBOL_IDS,
  isCircuitTrunkAddOnProtectionType,
  resolveInitialProtectionBusLabel,
} from '@/lib/protectionKind'
import { getPortDomainsForSymbol, getSymbolById, symbolSupportsWireDomain } from '@/lib/symbols'
import {
  findOrdinaryCircuitDcBusForOutput,
  getCircuitConverterPrimaryBranch,
} from '@/lib/layout/circuitConverterGeometry'
import {
  createDefaultAcCircuitCable,
  DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
} from '@/lib/wires/circuitWireDefaults'
import {
  domoticaChildRefForEndpoint,
  updateDomoticaChainHeadAfterInsert,
  resolveDomoticaConversionDropTarget,
  domoticaChildRefForBranchInsert,
  insertDomoticaChildEndpoint,
} from '@/lib/eendraad/domoticaOutputOrdering'
import {
  circuitAcceptsTrunkSwitch,
  createCircuitTrunkSwitchDevice,
  getCircuitTrunkSwitchPositionForDrop,
  isCircuitTrunkSwitchDropTarget,
  isCircuitTrunkSwitchSymbol,
} from '@/lib/eendraad/circuitTrunkSwitch'
import type { SymbolMetadata } from '@/lib/symbols'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import type {
  Endpoint,
  ProtectionDevice,
  Circuit,
  Panel,
  TrunkDevice,
  Branch,
} from '@/types/schema'

import type { TFunction } from 'i18next'

import {
  refreshBranchDropTargetAfterInsert,
  isEmptyBranchWireDrop,
  resolveLayoutBranchIndex,
  resolveSmartSwitchExpansion,
  shouldApplySmartSwitchExpansion,
} from '@/lib/eendraad/smartSwitchDrop'
import {
  computeEndpointInsertAfter,
  shouldDefaultRelayToImpulse,
} from '@/lib/eendraad/endpointInsertAfter'
import { promoteDcBusConverterEndpoint } from '@/lib/eendraad/resizeConverterDcConnections'

import { clamp } from '@/lib/geometry'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import { findPanelById } from '@/lib/panel/panelTree'
import { getMainBusInsertionSectionId } from '@/lib/panel/panelBusSections'
import { getPanelFeedOrganization } from '@/lib/panel/panelFeedOrganization'
import { canCreateSupplyTopologyFromDrop } from '@/lib/supplyTopologyFeature'
import {
  attachBackupConverterToAssembly,
  buildDirectConverterSupplyAssembly,
  findAssemblyForDirectConverter,
  findAssemblyForChangeover,
  upgradeDirectConverterToChangeoverAssembly,
} from '@/lib/supplyAssembly/editorIntegration'
import {
  directConverterBackupInlineDevicesToTrunkDevices,
  findDirectConverterBackupProtection,
  getDirectConverterOutputChainForChangeover,
  resolveDirectConverterChangeoverInsertIndex,
} from '@/lib/supplyAssembly/directConverterBackupUpgrade'
import {
  type DropBehaviorProject,
  type DropBehavior,
  type DropBehaviorCallbacks,
  viewportCenterOn,
  projectPanels,
  findPanelForTarget,
  findProtectionByCircuitIdInProject,
} from './dropBehaviorModel'
import {
  isEmptyProtectionCircuitForDcDrop,
  getSupplyDevicesForDropTarget,
  getCircuitTrunkPositionForDrop,
  getWireDomainAtDropTarget,
  isConversionSymbol,
  checkDomainForConversion,
} from './dropWireDomain'
import {
  addBackupLaneTrunkDevice,
  addChangeoverGridLaneDevice,
  addDirectConverterBackupCircuit,
  addGroundTrunkDevice,
  getFirstJunctionPanelLabel,
  addSupplyTrunkDevice,
} from './dropSupplyDevices'
import { panelBehavior, groundBehavior, earthingSeparatorBehavior } from './dropPanelBehaviors'

export type {
  DropBehaviorProject,
  DropBehavior,
  DropBehaviorCallbacks,
  DropBehaviorEditorHooks,
} from './dropBehaviorModel'
export { isEmptyProtectionCircuitForDcDrop } from './dropWireDomain'

/**
 * Inserts an endpoint into one branch and removes any provisional membership
 * assigned by addEndpoint from the other branches.
 */
function insertEndpointIntoBranch(
  branches: Branch[],
  branchId: string,
  endpointId: string,
  insertAfterEndpointId?: string | null
): Branch[] {
  const targetBranch = branches.find((branch) => branch.id === branchId)
  if (!targetBranch) return branches

  return branches.map((branch) => {
    const endpointIds = branch.endpointIds.filter((id) => id !== endpointId)
    if (branch.id === branchId) {
      const anchorIndex =
        typeof insertAfterEndpointId === 'string' ? endpointIds.indexOf(insertAfterEndpointId) : -1
      const insertIndex =
        typeof insertAfterEndpointId !== 'string'
          ? 0
          : anchorIndex >= 0
            ? anchorIndex + 1
            : endpointIds.length
      endpointIds.splice(insertIndex, 0, endpointId)
      return { ...branch, endpointIds }
    }
    return endpointIds.length === branch.endpointIds.length ? branch : { ...branch, endpointIds }
  })
}

/** Place a shared switching device in series on an ordinary circuit trunk. */
function addCircuitTrunkSwitchAtDrop(
  symbol: SymbolMetadata,
  target: DropTarget,
  project: DropBehaviorProject,
  callbacks: DropBehaviorCallbacks
): boolean {
  if (!isCircuitTrunkSwitchSymbol(symbol.id) || !isCircuitTrunkSwitchDropTarget(target)) {
    return false
  }
  const circuitId = target.circuitId!
  if (circuitIsTerminalPanelFeeder(project, circuitId)) return false
  const circuit = callbacks.getCircuitById(circuitId)
  if (!circuit || !circuitAcceptsTrunkSwitch(circuit)) return false

  const device = createCircuitTrunkSwitchDevice(
    symbol.id,
    callbacks.newId?.() ?? generateId(),
    getCircuitTrunkSwitchPositionForDrop(target, getCircuitTrunkPositionForDrop(target, circuit))
  )
  const placement = buildVisibleTrunkSitplanPlacement(
    project,
    callbacks.getSitplanTarget(),
    circuitId,
    undefined,
    callbacks.newId
  )
  if (placement) device.placements = [placement]
  addCircuitTrunkDeviceAtDrop(target, circuit, device, callbacks)
  callbacks.setSelection({ type: 'trunkDevice', ids: [device.id] })
  return true
}

/**
 * Generic protection behavior for MCB, FUSE, MAIN_SWITCH, and SPD
 * These all create a protection device + circuit in the same way,
 * just with different types and default properties.
 */
const protectionBehavior: DropBehavior = {
  validTargets: [
    'mainBus',
    'rcd',
    'circuit',
    'supplyWire',
    'supplyBackupWire',
    'supplyBackupOutputWire',
    'supplyChangeoverGridWire',
    'supplyConverterGridWire',
    'supplyConverterBackupWire',
    'supplyConverterDcWire',
  ],
  execute: (target, project, symbol, _t, callbacks) => {
    const requestedProtectionType = PROTECTION_SYMBOL_ID_TO_TYPE[symbol.id] ?? 'MCB'
    if (target.dcBusId) {
      addDcBusBranchProtectionDevice(target, project, symbol, callbacks)
      return
    }
    if (target.converterDcConnection && !target.dcBusId && target.circuitId) {
      addCircuitDcPassiveDevice(target, project, symbol, callbacks)
      return
    }
    if (
      !target.dcBusId &&
      target.type === 'circuit' &&
      target.circuitId &&
      !target.branchEndpoints?.length &&
      getWireDomainAtDropTarget(target, project, callbacks) === 'DC'
    ) {
      addCircuitDcPassiveDevice(target, project, symbol, callbacks)
      return
    }
    if (
      target.type === 'supplyConverterBackupWire' &&
      addDirectConverterBackupCircuit(target, project, callbacks, requestedProtectionType)
    ) {
      return
    }
    // If dropped on supply wire, add as a supply trunk device
    if (
      target.type === 'supplyWire' ||
      target.type === 'supplyBackupWire' ||
      target.type === 'supplyBackupOutputWire' ||
      target.type === 'supplyChangeoverGridWire' ||
      target.type === 'supplyConverterGridWire' ||
      target.type === 'supplyConverterDcWire'
    ) {
      if (target.type === 'supplyConverterDcWire') {
        addConverterDcBranchDevice(symbol, target, project, callbacks)
      } else if (target.type === 'supplyChangeoverGridWire') {
        addChangeoverGridLaneDevice(symbol, target, project, callbacks)
      } else if (target.type === 'supplyBackupWire' || target.type === 'supplyBackupOutputWire') {
        addBackupLaneTrunkDevice(symbol, target, project, callbacks)
      } else {
        addSupplyTrunkDevice(symbol, target, project, callbacks)
      }
      return
    }

    const panel = findPanelForTarget(project, target)
    if (!panel) return

    const protectionType = requestedProtectionType

    // A rotating switch or SPD placed on an outgoing circuit wire is an inline add-on, not a
    // downstream protective boundary. Represent it on the existing circuit trunk so the
    // owning protection keeps its automatic bus letter. Secondary-bus slots deliberately
    // remain protection-row targets because they do not identify a position on the trunk.
    if (
      isCircuitTrunkAddOnProtectionType(protectionType) &&
      target.type === 'circuit' &&
      target.circuitId &&
      typeof target.circuitTrunkSegmentIndex === 'number' &&
      !target.branchEndpoints?.length &&
      target.insertAfterCircuitContent !== true &&
      typeof target.secondaryBusInsertIndex !== 'number'
    ) {
      if (circuitIsTerminalPanelFeeder(project, target.circuitId)) return
      const circuit = callbacks.getCircuitById(target.circuitId)
      if (!circuit) return

      const deviceId = callbacks.newId?.() ?? generateId()
      const trunkDevice: TrunkDevice = {
        id: deviceId,
        type: 'protection',
        protectionType,
        symbol: symbol.id as TrunkDevice['symbol'],
        label: '',
        trunkPosition: getCircuitTrunkPositionForDrop(target, circuit),
        ...getDefaultTrunkDeviceProtectionProps(protectionType, getVoltagePolesConfig(project)),
      }
      const placement = buildVisibleTrunkSitplanPlacement(
        project,
        callbacks.getSitplanTarget(),
        target.circuitId,
        undefined,
        callbacks.newId
      )
      if (placement) trunkDevice.placements = [placement]
      addCircuitTrunkDeviceAtDrop(target, circuit, trunkDevice, callbacks)
      callbacks.setSelection({ type: 'trunkDevice', ids: [deviceId] })
      return
    }

    const autoCircuitCode = resolveInitialProtectionBusLabel(
      protectionType,
      getNextAvailableCircuitCode(project, panel.id)
    )
    const targetedCircuit =
      target.type === 'circuit' && target.circuitId
        ? callbacks.getCircuitById(target.circuitId)
        : null
    if (targetedCircuit?.supplySource?.kind === 'converter-backup') return
    const targetedProtection =
      targetedCircuit && target.circuitId
        ? findProtectionByCircuitIdInProject(projectPanels(project), target.circuitId)
        : null
    if (targetedCircuit && targetedProtection?.directPanelFeeder && targetedProtection.subPanelId) {
      callbacks.updateProtection(targetedProtection.id, {
        type: protectionType,
        label: autoCircuitCode,
        ...getProtectionCreationProps(project, protectionType),
        directPanelFeeder: undefined,
      })
      callbacks.updateCircuit(targetedCircuit.id, { code: autoCircuitCode })
      return
    }

    const circuitId = callbacks.newId?.() ?? generateId()
    const protectionId = callbacks.newId?.() ?? generateId()
    const defaults = getProtectionCreationProps(project, protectionType)
    const protection: ProtectionDevice = {
      id: protectionId,
      type: protectionType,
      label: autoCircuitCode,
      circuits: [],
      ...(target.type === 'mainBus'
        ? {
            busSectionId:
              target.busSectionId ?? getMainBusInsertionSectionId(panel, target.mainBusInsertIndex),
          }
        : {}),
      ...defaults,
    }

    callbacks.addProtection(panel.id, protection)

    const circuit: Circuit = {
      id: circuitId,
      code: autoCircuitCode,
      kind: 'other',
      cable: createDefaultAcCircuitCable(),
      endpoints: [],
      ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
    }

    // Add circuit to new protection (single source of truth)
    callbacks.addCircuit(panel.id, circuit, protectionId)

    if (target.type === 'rcd' && target.protectionId) {
      // Also register under the RCD for grouping (via store action, not direct mutation)
      callbacks.addCircuitToProtection(panel.id, target.protectionId, circuit)
    } else if (
      target.type === 'circuit' &&
      target.circuitId &&
      !(typeof target.secondaryBusInsertIndex === 'number' && target.secondaryBusInsertIndex >= 0)
    ) {
      // Record nested relationship — ID only, no duplicated object
      const parentCircuit = callbacks.getCircuitById(target.circuitId)
      if (parentCircuit) {
        const insertedBetween = target.insertBeforeNestedCircuitId
          ? insertProtectionBetweenNestedCircuits(
              parentCircuit,
              circuitId,
              target.insertBeforeNestedCircuitId,
              callbacks
            )
          : false
        if (!insertedBetween) {
          if (target.insertAfterCircuitContent) {
            callbacks.updateCircuit(parentCircuit.id, {
              subCircuitIds: [...(parentCircuit.subCircuitIds ?? []), circuitId],
            })
          } else {
            moveParentContentToSubCircuit(
              parentCircuit,
              target.circuitId,
              circuitId,
              protectionId,
              panel,
              callbacks
            )
          }
        }
      }
    }

    // When dropped on the main bus, reposition the new circuit/protection to
    // match the cursor segment between existing bus items.
    if (target.type === 'mainBus' && typeof target.mainBusInsertIndex === 'number') {
      const panelForReorder = findPanelForTarget(project, target)
      if (panelForReorder) {
        const beforeCount = target.mainBusItemCount ?? 0
        const totalAfter = beforeCount + 1
        const desiredIndex = clamp(target.mainBusInsertIndex, 0, totalAfter - 1)
        const currentIndex = totalAfter - 1 // Newly added item starts at the end
        const movesLeft = Math.max(0, currentIndex - desiredIndex)
        for (let i = 0; i < movesLeft; i++) {
          callbacks.moveCircuitOnMainBus(panelForReorder.id, circuitId, 'left')
        }
      }
    }

    // When dropped on a secondary bus (nested circuits), place the new
    // subcircuit directly at the resolved slot. This is more reliable than
    // appending and replaying left/right swaps when the bus has many children.
    if (
      target.type === 'circuit' &&
      target.circuitId &&
      typeof target.secondaryBusInsertIndex === 'number' &&
      target.secondaryBusInsertIndex >= 0
    ) {
      callbacks.moveCircuitToSecondaryBus(
        panel.id,
        target.circuitId,
        circuitId,
        target.secondaryBusInsertIndex
      )
    }
  },
}

// Alias for backwards compatibility — kept for drop behavior registry lookup by symbol id
export const mcbBehavior = protectionBehavior

/**
 * RCD/RCBO drop behavior — creates protection + circuit, just like MCB.
 * All protection devices share the same base flow: create protection, create circuit, link them.
 */
const rcdBehavior: DropBehavior = {
  validTargets: [
    'mainBus',
    'rcd',
    'circuit',
    'supplyWire',
    'supplyBackupWire',
    'supplyBackupOutputWire',
    'supplyChangeoverGridWire',
    'supplyConverterGridWire',
    'supplyConverterBackupWire',
    'supplyConverterDcWire',
  ],
  execute: (target, project, symbol, _t, callbacks) => {
    if (target.dcBusId) {
      addDcBusBranchProtectionDevice(target, project, symbol, callbacks)
      return
    }
    if (target.converterDcConnection && !target.dcBusId && target.circuitId) {
      addCircuitDcPassiveDevice(target, project, symbol, callbacks)
      return
    }
    if (
      !target.dcBusId &&
      target.type === 'circuit' &&
      target.circuitId &&
      !target.branchEndpoints?.length &&
      getWireDomainAtDropTarget(target, project, callbacks) === 'DC'
    ) {
      addCircuitDcPassiveDevice(target, project, symbol, callbacks)
      return
    }
    const isRcbo = symbol.id === 'rcbo'
    const protectionType = isRcbo ? 'RCBO' : 'RCD'
    if (
      target.type === 'supplyConverterBackupWire' &&
      addDirectConverterBackupCircuit(target, project, callbacks, protectionType)
    ) {
      return
    }
    // If dropped on supply wire, add as a supply trunk device
    if (
      target.type === 'supplyWire' ||
      target.type === 'supplyBackupWire' ||
      target.type === 'supplyBackupOutputWire' ||
      target.type === 'supplyChangeoverGridWire' ||
      target.type === 'supplyConverterGridWire' ||
      target.type === 'supplyConverterDcWire'
    ) {
      if (target.type === 'supplyConverterDcWire') {
        addConverterDcBranchDevice(symbol, target, project, callbacks)
      } else if (target.type === 'supplyChangeoverGridWire') {
        addChangeoverGridLaneDevice(symbol, target, project, callbacks)
      } else if (target.type === 'supplyBackupWire' || target.type === 'supplyBackupOutputWire') {
        addBackupLaneTrunkDevice(symbol, target, project, callbacks)
      } else {
        addSupplyTrunkDevice(symbol, target, project, callbacks)
      }
      return
    }

    const panel = findPanelForTarget(project, target)
    if (!panel) return
    if (
      target.type === 'circuit' &&
      target.circuitId &&
      callbacks.getCircuitById(target.circuitId)?.supplySource?.kind === 'converter-backup'
    ) {
      return
    }

    const autoCircuitCode = resolveInitialProtectionBusLabel(
      protectionType,
      getNextAvailableCircuitCode(project, panel.id)
    )

    const circuitId = callbacks.newId?.() ?? generateId()
    const protectionId = callbacks.newId?.() ?? generateId()
    const defaults = getProtectionCreationProps(project, protectionType)
    const protection: ProtectionDevice = {
      id: protectionId,
      type: protectionType,
      label: autoCircuitCode,
      circuits: [],
      ...(target.type === 'mainBus'
        ? {
            busSectionId:
              target.busSectionId ?? getMainBusInsertionSectionId(panel, target.mainBusInsertIndex),
          }
        : {}),
      ...defaults,
    }

    callbacks.addProtection(panel.id, protection)

    const circuit: Circuit = {
      id: circuitId,
      code: autoCircuitCode,
      kind: 'other',
      cable: createDefaultAcCircuitCable(),
      endpoints: [],
      ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
    }

    // Add circuit to new protection (single source of truth)
    callbacks.addCircuit(panel.id, circuit, protectionId)

    if (target.type === 'rcd' && target.protectionId) {
      // Also register under the existing RCD for grouping (via store action)
      callbacks.addCircuitToProtection(panel.id, target.protectionId, circuit)
    } else if (
      target.type === 'circuit' &&
      target.circuitId &&
      !(typeof target.secondaryBusInsertIndex === 'number' && target.secondaryBusInsertIndex >= 0)
    ) {
      // Record nested relationship — ID only, no duplicated object
      const parentCircuit = callbacks.getCircuitById(target.circuitId)
      if (parentCircuit) {
        const insertedBetween = target.insertBeforeNestedCircuitId
          ? insertProtectionBetweenNestedCircuits(
              parentCircuit,
              circuitId,
              target.insertBeforeNestedCircuitId,
              callbacks
            )
          : false
        if (!insertedBetween) {
          if (target.insertAfterCircuitContent) {
            callbacks.updateCircuit(parentCircuit.id, {
              subCircuitIds: [...(parentCircuit.subCircuitIds ?? []), circuitId],
            })
          } else {
            moveParentContentToSubCircuit(
              parentCircuit,
              target.circuitId,
              circuitId,
              protectionId,
              panel,
              callbacks
            )
          }
        }
      }
    }

    // When dropped on the main bus, reposition the new RCD/RCBO to the
    // correct segment along the bus based on cursor position.
    if (target.type === 'mainBus' && typeof target.mainBusInsertIndex === 'number') {
      const panelForReorder = findPanelForTarget(project, target)
      if (panelForReorder) {
        const beforeCount = target.mainBusItemCount ?? 0
        const totalAfter = beforeCount + 1
        const desiredIndex = clamp(target.mainBusInsertIndex, 0, totalAfter - 1)
        const currentIndex = totalAfter - 1
        const movesLeft = Math.max(0, currentIndex - desiredIndex)
        for (let i = 0; i < movesLeft; i++) {
          callbacks.moveCircuitOnMainBus(panelForReorder.id, circuitId, 'left')
        }
      }
    }

    // Same exact-slot placement as MCB/fuse drops for nested secondary buses.
    if (
      target.type === 'circuit' &&
      target.circuitId &&
      typeof target.secondaryBusInsertIndex === 'number' &&
      target.secondaryBusInsertIndex >= 0
    ) {
      callbacks.moveCircuitToSecondaryBus(
        panel.id,
        target.circuitId,
        circuitId,
        target.secondaryBusInsertIndex
      )
    }
  },
}

/**
 * When dropping a protection device onto an existing circuit's trunk,
 * move the parent circuit's endpoints, branches, and trunk devices
 * into the newly created subcircuit.
 *
 * Before: A { endpoints, branches }
 * After:  A { subCircuitIds: [B] }  →  B { endpoints, branches }
 *
 * Also handles sub-panel connections: if the parent's protection has
 * a subPanelId (feeds a secondary panel), that link is transferred
 * to the new child protection so the panel symbol follows the content.
 *
 * Without this, both parent and subcircuit would draw on top of each other.
 */
function moveParentContentToSubCircuit(
  parentCircuit: Circuit,
  parentCircuitId: string,
  newSubCircuitId: string,
  newProtectionId: string,
  panel: Panel,
  callbacks: DropBehaviorCallbacks
): void {
  const hasEndpoints = parentCircuit.endpoints.length > 0
  const hasBranches = (parentCircuit.branches?.length ?? 0) > 0
  const hasTrunkDevices = (parentCircuit.trunkDevices?.length ?? 0) > 0

  if (hasEndpoints || hasBranches || hasTrunkDevices) {
    // Move parent's content to the new subcircuit
    const updates: Partial<Circuit> = {}
    if (hasEndpoints) updates.endpoints = [...parentCircuit.endpoints]
    if (hasBranches) updates.branches = [...parentCircuit.branches!]
    if (hasTrunkDevices) updates.trunkDevices = [...parentCircuit.trunkDevices!]
    callbacks.updateCircuit(newSubCircuitId, updates)

    // Clear parent and register the new subcircuit
    callbacks.updateCircuit(parentCircuitId, {
      endpoints: [],
      branches: [],
      trunkDevices: [],
      subCircuitIds: [...(parentCircuit.subCircuitIds || []), newSubCircuitId],
    })
  } else {
    // No content to move — just register the subcircuit
    callbacks.updateCircuit(parentCircuitId, {
      subCircuitIds: [...(parentCircuit.subCircuitIds || []), newSubCircuitId],
    })
  }

  // Transfer subPanelId from parent's protection to new child protection.
  // If the parent MCB was feeding a secondary panel, the new MCB now sits
  // between them, so the new MCB should be the one linked to the sub-panel.
  const parentProtection = panel.protections.find((p) =>
    p.circuits?.some((c) => c.id === parentCircuitId)
  )
  if (parentProtection?.subPanelId) {
    const subPanelId = parentProtection.subPanelId
    // Remove from parent protection, assign to new child protection
    callbacks.updateProtection(parentProtection.id, { subPanelId: undefined })
    callbacks.updateProtection(newProtectionId, { subPanelId })
  }
}

function insertProtectionBetweenNestedCircuits(
  parentCircuit: Circuit,
  newCircuitId: string,
  existingChildCircuitId: string,
  callbacks: Pick<DropBehaviorCallbacks, 'updateCircuit'>
): boolean {
  const childIds = parentCircuit.subCircuitIds ?? []
  const childIndex = childIds.indexOf(existingChildCircuitId)
  if (childIndex < 0) return false

  const nextParentChildren = [...childIds]
  nextParentChildren.splice(childIndex, 1, newCircuitId)
  callbacks.updateCircuit(parentCircuit.id, { subCircuitIds: nextParentChildren })
  callbacks.updateCircuit(newCircuitId, { subCircuitIds: [existingChildCircuitId] })
  return true
}

/**
 * Next unique label for a domotica output child: base.1, base.2, … (base = parent label, e.g. D1).
 * Uses a single sequence for all children of this parent (control and output wires), so the first
 * control switch is D1.1 and the first output light is D1.2, not both D1.1.
 */
function getNextDomoticaChildLabel(
  circuit: Circuit,
  parent: Endpoint,
  _group: 'endpoint' | 'control',
  outputIndex?: number
): string {
  const base = parent.label?.trim() || `${circuit.code}1`
  let rowLabelIndex = 1
  const scanRows = (ids: string[] | undefined, rowGroup: 'endpoint' | 'control'): string | null => {
    for (let index = 0; index < (ids?.length ?? 0); index++) {
      const id = ids?.[index]
      if (!id) continue
      const label = `${base}.${rowLabelIndex}`
      if (rowGroup === 'endpoint' && index === outputIndex) return label
      rowLabelIndex += 1
    }
    return null
  }
  return (
    scanRows(parent.domoticaProps?.endpointChildEndpointIds, 'endpoint') ??
    `${base}.${rowLabelIndex}`
  )
}

/**
 * Endpoint drop behavior (sockets, lights, static devices, and in-between devices).
 * - Actual endpoints: one per branch, always at the end; a static device may follow a socket.
 * - In-between (switches, relay, domotica, energy_meter): any number, always between trunk and endpoint.
 */
const endpointBehavior: DropBehavior = {
  validTargets: ['endpoint', 'circuit', 'protection', 'supplyConverterDcWire'],
  execute: (target, project, symbol, _t, callbacks) => {
    if (target.type === 'supplyConverterDcWire' && target.panelId) {
      const device = addConverterDcBranchDevice(symbol, target, project, callbacks)
      if (device) callbacks.setSelection({ type: 'trunkDevice', ids: [device.id] })
      return
    }
    if (target.converterDcConnection && !target.dcBusId && target.circuitId) {
      const targetCircuit = callbacks.getCircuitById(target.circuitId)
      const existingBus = targetCircuit
        ? findOrdinaryCircuitDcBusForOutput(targetCircuit, target.converterDcConnection)
        : undefined
      if (existingBus) {
        target = { ...target, dcBusId: existingBus.id, wireDomain: 'DC' }
      } else {
        addEndpointToCircuitConverterDcConnection(target, project, symbol, _t, callbacks)
        return
      }
    }
    let circuitId = target.circuitId
    if (!circuitId && target.type === 'protection' && target.protectionId) {
      const protection = callbacks.getProtectionById(target.protectionId)
      circuitId = protection?.circuits?.[0]?.id
    }
    if (!circuitId) return

    // Dedicated feeders go exclusively to the sub-panel. A mixed circuit may
    // share the feed with existing consumer branches, which remain editable.
    if (circuitIsTerminalPanelFeeder(project, circuitId)) {
      return
    }

    const circuit = callbacks.getCircuitById(circuitId)
    if (!circuit) return

    if (!target.dcBusId && symbolSupportsWireDomain(symbol.id, 'DC')) {
      const existingBus = findOrdinaryCircuitDcBusForOutput(circuit, target.converterDcConnection)
      if (existingBus) {
        target = { ...target, dcBusId: existingBus.id, wireDomain: 'DC' }
      }
    }
    const dcBusId = target.dcBusId

    if (
      dcBusId &&
      !(circuit.trunkDevices ?? []).some(
        (device) => device.id === dcBusId && device.type === 'dc_bus'
      )
    ) {
      return
    }

    initializeBranchesIfNeeded(circuit)

    const endpointId = callbacks.existingEndpointId ?? callbacks.newId?.() ?? generateId()
    const endpointType = getEndpointTypeFromSymbol(symbol)
    if (!endpointType) return
    const symbolKey = getSymbolKeyFromSymbol(symbol)
    const junctionIdentity = isSharedJunctionSymbol(symbol.id)
      ? symbol.id === 'terminal_strip'
        ? '1'
        : getNextJunctionIdentity(project, symbol.id)
      : undefined

    const isDomoticaOutputDrop = !!target.domoticaOutput && !!target.endpointId
    const panelOnTargetOutput =
      isDomoticaOutputDrop && target.domoticaOutput?.group === 'endpoint'
        ? circuit.endpoints.find(
            (candidate) =>
              isDomoticaPanelFeedEndpoint(candidate) &&
              candidate.domoticaChildProps.parentEndpointId === target.endpointId &&
              candidate.domoticaChildProps.outputIndex === target.domoticaOutput!.index
          )
        : undefined
    const isDomoticaChildReplace =
      target.domoticaChildDropIntent === 'replace' && !!target.endpointId

    const endpoint: Endpoint = {
      id: endpointId,
      type: endpointType,
      label: '',
      symbol: symbolKey,
      placements: [],
      ...(junctionIdentity ? { junctionIdentity } : {}),
      ...(symbol.id === 'terminal_strip'
        ? {
            terminalStripPin: getTerminalStripCreationProps(project, undefined, target.circuitId)
              .terminalStripPin,
          }
        : {}),
      ...(symbol.id === 'domotica'
        ? { domoticaProps: { endpointCount: 1, endpointChildEndpointIds: [] } }
        : {}),
    }
    if (isDomoticaOutputDrop) {
      const parent = circuit.endpoints.find((e: Endpoint) => e.id === target.endpointId)
      if (parent) {
        endpoint.label = getNextDomoticaChildLabel(
          circuit,
          parent,
          'endpoint',
          target.domoticaOutput!.index
        )
      }
      endpoint.domoticaChildProps = {
        parentEndpointId: target.endpointId!,
        outputGroup: 'endpoint',
        outputIndex: target.domoticaOutput!.index,
      }
    }

    // HVAC furnace presets: apply default hvacProps based on library preset ID.
    if (symbol.id === 'furnace_heatpump') {
      endpoint.hvacProps = {
        energySource: 'electricity',
        hvacType: 'heat_exchange',
        hvacFunction: 'heat_cool',
      }
    } else if (symbol.id === 'furnace_gas') {
      endpoint.hvacProps = {
        energySource: 'gas_atmospheric',
        hvacType: 'boiler',
        hvacFunction: 'heat',
      }
    } else if (symbol.id === 'furnace_oil') {
      endpoint.hvacProps = {
        energySource: 'liquid',
        hvacType: 'boiler',
        hvacFunction: 'heat',
      }
    } else if (symbol.id === 'furnace_pellets') {
      endpoint.hvacProps = {
        energySource: 'solid',
        hvacType: 'cogeneration',
        hvacFunction: 'heat',
      }
    }

    // DC generation/storage presets (plugIn synced from branch layout in projectStore)
    if (symbol.id === 'solar_panel') {
      endpoint.solarPanelProps = {
        wattageW: 1000,
      }
    } else if (symbol.id === 'battery') {
      endpoint.batteryProps = {
        voltageV: 48,
        capacityKWh: 5,
      }
    }

    applyLibraryPresetToEndpoint(symbol, endpoint)

    const hadAnyEndpointsBeforeAdd = (circuit.endpoints?.length ?? 0) > 0
    const computedInsert = computeEndpointInsertAfter(target, circuit, symbol)
    let { insertAfterEndpointId, createNewBranch } = computedInsert
    if (panelOnTargetOutput) {
      // Adding a load to a board's existing output shares that row. Keep the
      // board last so its caption and incoming reference remain unambiguous.
      const branch = circuit.branches?.find((candidate) =>
        candidate.endpointIds.includes(panelOnTargetOutput.id)
      )
      const index = branch?.endpointIds.indexOf(panelOnTargetOutput.id) ?? -1
      insertAfterEndpointId = index > 0 ? branch!.endpointIds[index - 1] : target.endpointId
      createNewBranch = false
    }
    const existingDcBusBranch = dcBusId
      ? (circuit.branches ?? []).find(
          (branch) =>
            branch.dcBusId === dcBusId &&
            (branch.id === target.branchId ||
              branch.endpointIds.some((id) => target.branchEndpoints?.includes(id)))
        )
      : undefined
    if (dcBusId) {
      createNewBranch = !existingDcBusBranch
      if (!existingDcBusBranch) insertAfterEndpointId = undefined
    }
    if (circuit.supplySource?.kind === 'converter-backup' && circuit.endpoints.length > 0) {
      insertAfterEndpointId = circuit.endpoints.at(-1)?.id
      createNewBranch = false
    }
    if (shouldDefaultRelayToImpulse(circuit, symbol, insertAfterEndpointId)) {
      endpoint.relayProps = { ...endpoint.relayProps, control: 'impulse' }
    }

    if (!isDomoticaOutputDrop) {
      const chainRef =
        isDomoticaChildReplace || target.domoticaChildDropIntent === 'insertBefore'
          ? domoticaChildRefForEndpoint(circuit, target.endpointId)
          : domoticaChildRefForBranchInsert(circuit, insertAfterEndpointId, target.branchEndpoints)
      if (chainRef) {
        endpoint.domoticaChildProps = chainRef
        const parent = circuit.endpoints.find((e: Endpoint) => e.id === chainRef.parentEndpointId)
        if (parent) {
          endpoint.label = getNextDomoticaChildLabel(
            circuit,
            parent,
            chainRef.outputGroup,
            chainRef.outputIndex
          )
        }
      }
    }

    const forkBranches = captureForkPlacementBranches(circuit, target)
    const branches = forkBranches ?? (circuit.branches?.length ? circuit.branches : initializeBranchesIfNeeded(circuit))

    const downstreamIds = target.branchEndpoints?.slice(
      typeof insertAfterEndpointId === 'string'
        ? target.branchEndpoints.indexOf(insertAfterEndpointId) + 1
        : 0
    )
    if (!createNewBranch && downstreamIds?.length) hideInlineConverterMetadataByDefault(endpoint)

    // Branch point labels are synced after addEndpoint / updateCircuit (sequential A1…n in branch order).
    callbacks.addEndpoint(circuitId, endpoint, insertAfterEndpointId)

    if (target.domoticaChildDropIntent === 'insertBefore') {
      const afterAdd = callbacks.getCircuitById(circuitId)
      if (afterAdd)
        callbacks.updateCircuit(circuitId, {
          endpoints: updateDomoticaChainHeadAfterInsert(afterAdd, endpointId, target.endpointId),
        })
    }

    if (isDomoticaChildReplace && target.endpointId && target.endpointId !== endpointId) {
      callbacks.deleteEndpoint(target.endpointId)
    }

    // Ordinary output insertion shifts existing occupants down. A board-fed
    // output is shared instead: the new load precedes the board on that row.
    if (isDomoticaOutputDrop && target.endpointId) {
      const circuitAfterAdd = callbacks.getCircuitById(circuitId)
      if (circuitAfterAdd) {
        const nextCircuit = panelOnTargetOutput
          ? {
              ...circuitAfterAdd,
              endpoints: updateDomoticaChainHeadAfterInsert(
                circuitAfterAdd,
                endpointId,
                panelOnTargetOutput.id
              ),
            }
          : insertDomoticaChildEndpoint(
              circuitAfterAdd,
              endpointId,
              target.endpointId,
              'endpoint',
              target.domoticaOutput!.index
            )
        if (nextCircuit) {
          callbacks.updateCircuit(circuitId, {
            endpoints: nextCircuit.endpoints,
            branches: nextCircuit.branches,
          })
        }
      }
    }

    if (forkBranches) {
      callbacks.updateCircuit(circuitId, { branches: insertSavedForkEndpoint(forkBranches, target, endpointId) })
    } else if (isDomoticaChildReplace) {
      // addEndpoint/deleteEndpoint already replaced the target in endpoints, branches and slots.
    } else if (isDomoticaOutputDrop) {
      // Fully handled by insertDomoticaChildEndpoint; skip branch bookkeeping on stale data.
    } else if (createNewBranch) {
      // Create a new branch with this endpoint at the hovered branch position.
      // `addEndpoint()` may already have inserted endpointId into an existing branch,
      // so strip it first and then insert a dedicated branch at the intended slot.
      const circuitAfterAdd = callbacks.getCircuitById(circuitId)
      const branchSource = circuitAfterAdd?.branches?.length ? circuitAfterAdd.branches : branches
      const branchesSansNewEndpoint = branchSource
        .map((b: Branch) => ({
          ...b,
          endpointIds: (b.endpointIds ?? []).filter((id: string) => id !== endpointId),
        }))
        .filter(
          (b: Branch) => (b.endpointIds ?? []).length > 0 || (b.branchDevices?.length ?? 0) > 0
        )

      const branchIndexFromLayout = resolveLayoutBranchIndex(target.branchId, circuitId)
      const branchIndexFromEndpoints =
        target.branchEndpoints && target.branchEndpoints.length > 0
          ? branchesSansNewEndpoint.findIndex((b: Branch) =>
              b.endpointIds.some((id: string) => target.branchEndpoints!.includes(id))
            )
          : -1
      const anchorBranchIndex =
        branchIndexFromLayout !== null
          ? branchIndexFromLayout
          : branchIndexFromEndpoints >= 0
            ? branchIndexFromEndpoints
            : branchesSansNewEndpoint.length - 1
      const dcBusBranchIndexes = dcBusId
        ? branchesSansNewEndpoint.flatMap((branch, index) =>
            branch.dcBusId === dcBusId ? [index] : []
          )
        : []
      const requestedDcBusIndex = clamp(
        target.secondaryBusInsertIndex ?? dcBusBranchIndexes.length,
        0,
        dcBusBranchIndexes.length
      )
      const insertionIndex =
        typeof target.branchInsertIndex === 'number'
          ? clamp(target.branchInsertIndex, 0, branchesSansNewEndpoint.length)
          : dcBusId
            ? requestedDcBusIndex < dcBusBranchIndexes.length
              ? dcBusBranchIndexes[requestedDcBusIndex]!
              : (dcBusBranchIndexes.at(-1) ?? branchesSansNewEndpoint.length - 1) + 1
            : target.insertAfterEndpointId === null
              ? Math.max(0, anchorBranchIndex)
              : Math.max(0, anchorBranchIndex + 1)

      const nextBranches = [...branchesSansNewEndpoint]
      nextBranches.splice(clamp(insertionIndex, 0, nextBranches.length), 0, {
        id: callbacks.newId?.() ?? generateId(),
        label: '',
        endpointIds: [endpointId],
        ...(dcBusId ? { dcBusId } : {}),
      })
      callbacks.updateCircuit(circuitId, { branches: nextBranches })
    } else if (
      target.branchEndpoints !== undefined &&
      target.branchEndpoints.length === 0 &&
      isEmptyBranchWireDrop(target, circuitId)
    ) {
      const branchIndex = resolveLayoutBranchIndex(target.branchId, circuitId)
      const storedBranches = branches.length ? branches : initializeBranchesIfNeeded(circuit)
      const targetBranch = branchIndex !== null ? storedBranches[branchIndex] : undefined
      if (targetBranch) {
        const updatedBranches = insertEndpointIntoBranch(
          storedBranches,
          targetBranch.id,
          endpointId,
          insertAfterEndpointId
        )
        callbacks.updateCircuit(circuitId, { branches: updatedBranches })
      }
    } else if (target.branchEndpoints !== undefined && target.branchEndpoints.length > 0) {
      // Adding to an existing branch — find it in stored or inferred branches and update.
      // Always persist branches so multi-branch circuits keep correct assignment
      // (without stored branches, groupEndpointsIntoBranches re-infers linearly
      // and would assign in-between devices to the wrong branch).
      const targetBranch = branches.find((b: Branch) =>
        b.endpointIds.some((id: string) => target.branchEndpoints!.includes(id))
      )
      if (targetBranch) {
        const updatedBranches = insertEndpointIntoBranch(
          branches,
          targetBranch.id,
          endpointId,
          insertAfterEndpointId
        )
        callbacks.updateCircuit(circuitId, { branches: updatedBranches })
      }
    } else if (
      target.branchEndpoints === undefined ||
      (target.branchEndpoints.length === 0 && !isEmptyBranchWireDrop(target, circuitId))
    ) {
      // No branch wire context (trunk / MCB / protection) — create a new branch when needed
      // For the very first endpoint on a fresh circuit, `addEndpoint()` already creates
      // the canonical first branch and label (e.g. P1). Do not run a second naming pass.
      if (!hadAnyEndpointsBeforeAdd) {
        // Keep the branch + label assigned by addEndpoint as the single source of truth.
      } else {
        const circuitAfterAdd = callbacks.getCircuitById(circuitId)
        if (!circuitAfterAdd) {
          callbacks.updateCircuit(circuitId, {
            branches: [
              ...branches,
              {
                id: callbacks.newId?.() ?? generateId(),
                label: endpoint.label,
                endpointIds: [endpointId],
              },
            ],
          })
        } else {
          // `store.addEndpoint()` keeps branch endpointIds in sync while inserting the new
          // endpoint. When this drop is intended to create a *new* branch, we must ensure
          // the new endpoint is not accidentally inserted into an existing branch first
          // (which would reuse the old branch label, e.g. 05 instead of 06).
          const branchesSansNewEndpoint = (circuitAfterAdd.branches ?? [])
            .map((b: Branch) => ({
              ...b,
              endpointIds: (b.endpointIds ?? []).filter((id: string) => id !== endpointId),
            }))
            .filter((b: Branch) => (b.endpointIds ?? []).length > 0)

          callbacks.updateCircuit(circuitId, {
            branches: [
              ...branchesSansNewEndpoint,
              { id: callbacks.newId?.() ?? generateId(), label: '', endpointIds: [endpointId] },
            ],
          })
        }
      }
    }

    if (circuit.supplySource?.kind === 'converter-backup') {
      const circuitAfterAdd = callbacks.getCircuitById(circuitId)
      if (circuitAfterAdd) {
        const branch = circuitAfterAdd.branches?.[0] ?? {
          id: callbacks.newId?.() ?? generateId(),
          label: '',
          endpointIds: [],
        }
        callbacks.updateCircuit(circuitId, {
          branches: [
            {
              ...branch,
              endpointIds: circuitAfterAdd.endpoints.map((item) => item.id),
            },
          ],
        })
      }
    }

    // Global selection (uiStore): eendraad, sitplan, panel, and inspectors all react to this.
    callbacks.setSelection({ type: 'endpoint', ids: [endpointId] })

    // Auto-place new sitplan symbol when it doesn't yet exist on the plan.
    // Layout rule:
    // - Start from a common origin.
    // - One horizontal row per circuit (grouped by circuit).
    // - New symbol in same circuit goes to the right of existing ones on that row.
    // - New circuit gets a new row "above" the existing rows.
    //
    // Floor + layer: match plan canvas drops (plan uses active floor + layers[0] ?? 'electrical').
    // Do not require floors[0].layers — many floors omit `layers` in data; skipping auto-place
    // left endpoints invisible on every sitplan floor (bug).
    // Do not create placements for one-line-only or explicitly excluded symbols.
    if (!canSymbolAppearOnSituationPlan(symbol.id) || isModularSocketLibraryId(symbol.id)) {
      return
    }

    const currentProject = project
    const activeFloorId = resolveCircuitSitplanTargetFloorId(
      currentProject,
      callbacks.getSitplanTarget().activeFloorId,
      circuitId
    )

    if (activeFloorId && currentProject) {
      const floorEntity = selectProjectBuildingFloors(currentProject).find(
        (f) => f.id === activeFloorId
      )
      if (!floorEntity) return
      if ('layers' in floorEntity) ensureElectricalLayerOnFloor(floorEntity)
      const preferredPlanPos =
        viewportCenterOn(callbacks.getSitplanTarget(), activeFloorId) ?? undefined
      const placement = buildAutoSitplanPlacement(currentProject, {
        circuitId,
        floorId: activeFloorId,
        placementId: callbacks.newId?.() ?? generateId(),
        ...(preferredPlanPos ? { preferredPlanPos } : {}),
      })
      if (placement) {
        callbacks.addPlacement(endpointId, placement)
      }
    }
  },
}

/**
 * Switch drop behavior — expands two-way / cross drops on switch-free branches.
 */
const switchBehavior: DropBehavior = {
  validTargets: [
    'endpoint',
    'circuit',
    'protection',
    'supplyBackupWire',
    'supplyBackupOutputWire',
    'supplyConverterDcWire',
  ],
  execute: (target, project, symbol, t, callbacks) => {
    if (target.dcBusId) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }
    if (target.converterDcConnection && target.circuitId) {
      addEndpointToCircuitConverterDcConnection(target, project, symbol, t, callbacks)
      return
    }
    if (target.type === 'supplyBackupWire' || target.type === 'supplyBackupOutputWire') {
      addBackupLaneTrunkDevice(symbol, target, project, callbacks)
      return
    }
    if (target.type === 'supplyConverterDcWire') {
      addConverterDcBranchDevice(symbol, target, project, callbacks)
      return
    }
    if (addCircuitTrunkSwitchAtDrop(symbol, target, project, callbacks)) return
    const expansion = resolveSmartSwitchExpansion(symbol)
    if (!expansion) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }

    let circuitId = target.circuitId
    if (!circuitId && target.type === 'protection' && target.protectionId) {
      const protection = callbacks.getProtectionById(target.protectionId)
      circuitId = protection?.circuits?.[0]?.id
    }
    if (!circuitId) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }

    const circuit = callbacks.getCircuitById(circuitId)
    if (!circuit || !shouldApplySmartSwitchExpansion(target, circuit, symbol)) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }

    let workingTarget = target
    let lastAddedEndpointId: string | undefined
    let primaryEndpointId: string | undefined

    for (let i = 0; i < expansion.symbols.length; i++) {
      const sym = expansion.symbols[i]!
      const trackingCallbacks: DropBehaviorCallbacks = {
        ...callbacks,
        addEndpoint: (cid, endpoint, insertAfter, branchOpts) => {
          lastAddedEndpointId = endpoint.id
          callbacks.addEndpoint(cid, endpoint, insertAfter, branchOpts)
        },
        setSelection: () => {},
      }

      endpointBehavior.execute(workingTarget, project, sym, t, trackingCallbacks)

      if (!lastAddedEndpointId) continue
      if (i === expansion.primaryIndex) {
        primaryEndpointId = lastAddedEndpointId
      }

      const circuitAfter = callbacks.getCircuitById(circuitId)
      if (!circuitAfter) break
      workingTarget = refreshBranchDropTargetAfterInsert(
        circuitAfter,
        workingTarget,
        lastAddedEndpointId
      )
    }

    if (primaryEndpointId) {
      callbacks.setSelection({ type: 'endpoint', ids: [primaryEndpointId] })
    }
  },
}

/** Relays are inline switching devices on both AC and DC supply paths. */
const relayBehavior: DropBehavior = {
  validTargets: [
    ...switchBehavior.validTargets,
    'supplyWire',
    'supplyConverterGridWire',
    'supplyChangeoverGridWire',
  ],
  execute: (target, project, symbol, t, callbacks) => {
    if (
      target.type === 'supplyWire' ||
      target.type === 'supplyConverterGridWire' ||
      target.type === 'supplyChangeoverGridWire'
    ) {
      const device =
        target.type === 'supplyChangeoverGridWire'
          ? addChangeoverGridLaneDevice(symbol, target, project, callbacks)
          : addSupplyTrunkDevice(symbol, target, project, callbacks)
      if (device) callbacks.setSelection({ type: 'trunkDevice', ids: [device.id] })
      return
    }
    switchBehavior.execute(target, project, symbol, t, callbacks)
  },
}

function addEndpointToCircuitConverterDcConnection(
  target: DropTarget,
  project: DropBehaviorProject,
  symbol: SymbolMetadata,
  t: TFunction,
  callbacks: DropBehaviorCallbacks
): boolean {
  const connection = target.converterDcConnection
  if (!connection || !target.circuitId) return false
  const circuit = callbacks.getCircuitById(target.circuitId)
  if (!circuit) return false

  const existingBus = findOrdinaryCircuitDcBusForOutput(circuit, connection)
  if (!target.dcBusId && existingBus) {
    endpointBehavior.execute(
      { ...target, dcBusId: existingBus.id, wireDomain: 'DC' },
      project,
      symbol,
      t,
      callbacks
    )
    return true
  }

  const converter = [
    ...(circuit.trunkDevices ?? []),
    ...(circuit.branches ?? []).flatMap((branch) => branch.branchDevices ?? []),
  ].find((device) => device.id === connection.converterId)
  const owningConverterBranch = circuit.branches?.find((branch) =>
    branch.branchDevices?.some((device) => device.id === connection.converterId)
  )
  const primaryBranch =
    connection.connectionIndex === 0 && converter
      ? (owningConverterBranch ?? getCircuitConverterPrimaryBranch(circuit, converter))
      : undefined
  const primaryIds = new Set(primaryBranch?.endpointIds ?? [])
  const existing = circuit.endpoints.filter(
    (endpoint) =>
      primaryIds.has(endpoint.id) ||
      (endpoint.converterDcConnection?.converterId === connection.converterId &&
        endpoint.converterDcConnection.connectionIndex === connection.connectionIndex)
  )
  const existingIds = new Set(existing.map((endpoint) => endpoint.id))
  const existingBranch =
    primaryBranch ??
    circuit.branches?.find((branch) =>
      branch.endpointIds.some((endpointId) => existingIds.has(endpointId))
    )
  const lastEndpoint = existing.at(-1)
  const requestedInsertAfter =
    target.insertAfterEndpointId && existingIds.has(target.insertAfterEndpointId)
      ? target.insertAfterEndpointId
      : lastEndpoint?.id
  const normalizedTarget: DropTarget = lastEndpoint
    ? {
        type: 'endpoint',
        circuitId: circuit.id,
        endpointId: requestedInsertAfter ?? lastEndpoint.id,
        insertAfterEndpointId: requestedInsertAfter ?? lastEndpoint.id,
        branchId: existingBranch?.id,
        branchEndpoints: existing.map((endpoint) => endpoint.id),
        wireDomain: 'DC',
      }
    : {
        type: 'circuit',
        circuitId: circuit.id,
        branchId: owningConverterBranch?.id,
        dcBusId: owningConverterBranch?.dcBusId,
        branchEndpoints: [],
        wireDomain: 'DC',
      }

  const trackingCallbacks: DropBehaviorCallbacks = {
    ...callbacks,
    addEndpoint: (circuitId, endpoint, insertAfterEndpointId, branchOpts) => {
      callbacks.addEndpoint(
        circuitId,
        { ...endpoint, converterDcConnection: connection },
        insertAfterEndpointId,
        {
          ...branchOpts,
          branchId: existingBranch?.id ?? branchOpts?.branchId,
          forceNewBranch:
            existing.length === 0 && !owningConverterBranch ? true : branchOpts?.forceNewBranch,
          branchInsertIndex:
            existing.length === 0 ? connection.connectionIndex : branchOpts?.branchInsertIndex,
        }
      )
      const updated = callbacks.getCircuitById(circuitId)
      if (updated && (primaryIds.size > 0 || owningConverterBranch?.dcBusId)) {
        callbacks.updateCircuit(circuitId, {
          // Once output zero gains an explicit reference, promote every
          // endpoint on its legacy implicit branch in the same edit.
          endpoints: updated.endpoints.map((candidate) =>
            primaryIds.has(candidate.id) && !candidate.converterDcConnection
              ? { ...candidate, converterDcConnection: connection }
              : candidate
          ),
          // A new string branch below a branch-local converter remains part
          // of the outer DC bus so deleting or moving that bus keeps the
          // complete nested converter topology together.
          branches: owningConverterBranch?.dcBusId
            ? (updated.branches ?? [])
                .map((branch) =>
                  branch.id === owningConverterBranch.id
                    ? {
                        ...branch,
                        endpointIds: branch.endpointIds.includes(endpoint.id)
                          ? branch.endpointIds
                          : [...branch.endpointIds, endpoint.id],
                      }
                    : {
                        ...branch,
                        endpointIds: branch.endpointIds.filter(
                          (endpointId) => endpointId !== endpoint.id
                        ),
                      }
                )
                .filter(
                  (branch) =>
                    branch.endpointIds.length > 0 || (branch.branchDevices?.length ?? 0) > 0
                )
            : updated.branches,
        })
      }
    },
  }
  endpointBehavior.execute(normalizedTarget, project, symbol, t, trackingCallbacks)
  return true
}

/**
 * Energy conversion drop behavior — circuit trunk, source-changeover backup
 * lane, or a direct converter's DC branch.
 */
const energyConversionBehavior: DropBehavior = {
  validTargets: [
    'endpoint',
    'circuit',
    'protection',
    'supplyWire',
    'supplyBackupWire',
    'supplyConverterDcWire',
  ],
  execute: (target, project, symbol, t, callbacks) => {
    const targetCircuit = target.circuitId ? callbacks.getCircuitById(target.circuitId) : null
    if (targetCircuit) target = resolveDomoticaConversionDropTarget(targetCircuit, target)
    if (target.dcBusId) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }
    if (target.converterDcConnection && target.circuitId) {
      if (
        !checkDomainForConversion({ ...target, wireDomain: 'DC' }, project, symbol, t, callbacks)
      ) {
        return
      }
      addEndpointToCircuitConverterDcConnection(target, project, symbol, t, callbacks)
      return
    }
    // A transformer is a serial AC/AC device, not an inverter with a backup/DC branch.
    if (target.type === 'supplyWire' && symbol.id === 'transformer') {
      if (!checkDomainForConversion(target, project, symbol, t, callbacks)) return
      const transformer = addSupplyTrunkDevice(symbol, target, project, callbacks)
      if (transformer) callbacks.setSelection({ type: 'trunkDevice', ids: [transformer.id] })
      return
    }
    if (
      target.type === 'supplyWire' &&
      target.panelId &&
      target.supplyFeedScope === 'root' &&
      isConversionSymbol(symbol)
    ) {
      const supplyDevices = getSupplyDevicesForDropTarget(target, project)
      if (
        supplyDevices.some(
          (device) =>
            device.symbol === 'source_changeover' || device.supplyPath === 'converter-branch'
        )
      ) {
        return
      }
      const converter = addSupplyTrunkDevice(symbol, target, project, callbacks, {
        supplyPath: 'converter-branch',
      })
      if (!converter) return
      callbacks.addSupplyAssembly(
        buildDirectConverterSupplyAssembly(project, target.panelId, converter)
      )
      callbacks.setSelection({ type: 'trunkDevice', ids: [converter.id] })
      return
    }

    if (target.type === 'supplyBackupWire' && target.panelId) {
      const supplyDevices = getSupplyDevicesForDropTarget(
        { ...target, type: 'supplyWire', supplyFeedScope: 'root' },
        project
      )
      const changeover = supplyDevices.find((device) => device.symbol === 'source_changeover')
      if (!changeover || supplyDevices.some((device) => device.type === 'conversion')) return

      const converter = addSupplyTrunkDevice(
        symbol,
        {
          ...target,
          supplyFeedScope: 'root',
          supplyDeviceInsertIndex:
            target.supplyDeviceInsertIndex ?? Math.max(0, changeover.trunkPosition + 1),
        },
        project,
        callbacks
      )
      if (!converter) return

      const assembly = attachBackupConverterToAssembly(
        project,
        target.panelId,
        changeover,
        converter
      )
      const existing = findAssemblyForChangeover(project, changeover.id)
      if (existing) callbacks.replaceSupplyAssembly(existing.id, assembly)
      else callbacks.addSupplyAssembly(assembly)
      callbacks.setSelection({ type: 'trunkDevice', ids: [converter.id] })
      return
    }

    // A converter's right/top DC lane is a real serial branch.  Keep the
    // dropped device on that lane so the supply-assembly reconciler can wire
    // it after the existing battery/PV devices instead of treating it as a
    // new AC supply entry point.
    if (target.type === 'supplyConverterDcWire' && target.panelId) {
      if (!checkDomainForConversion(target, project, symbol, t, callbacks)) return
      const device = addConverterDcBranchDevice(symbol, target, project, callbacks)
      if (device) callbacks.setSelection({ type: 'trunkDevice', ids: [device.id] })
      return
    }

    if (!checkDomainForConversion(target, project, symbol, t, callbacks)) return

    if (target.type === 'circuit' && target.circuitId && !target.branchEndpoints?.length) {
      if (circuitIsTerminalPanelFeeder(project, target.circuitId)) {
        return
      }
      const circuit = callbacks.getCircuitById(target.circuitId)
      if (!circuit) return
      const trunkPosition = getCircuitTrunkPositionForDrop(target, circuit)
      const deviceId = callbacks.newId?.() ?? generateId()
      const trunkDevice: TrunkDevice = {
        id: deviceId,
        type: 'conversion',
        symbol: symbol.id as TrunkDevice['symbol'],
        label: '',
        trunkPosition,
      }
      const placement = buildVisibleTrunkSitplanPlacement(
        project,
        callbacks.getSitplanTarget(),
        target.circuitId,
        undefined,
        callbacks.newId
      )
      if (placement) trunkDevice.placements = [placement]
      addCircuitTrunkDeviceAtDrop(target, circuit, trunkDevice, callbacks)
      callbacks.setSelection({ type: 'trunkDevice', ids: [deviceId] })
      return
    }
    endpointBehavior.execute(target, project, symbol, t, callbacks)
  },
}

/** DC-only endpoint drop behavior (solar panel, battery). */
const dcEndpointBehavior: DropBehavior = {
  validTargets: ['endpoint', 'circuit', 'protection', 'supplyConverterDcWire'],
  execute: (target, project, symbol, t, callbacks) => {
    if (target.endpointId && target.circuitId) {
      const circuit = callbacks.getCircuitById(target.circuitId)
      const targetEndpoint = circuit?.endpoints.find(
        (endpoint) => endpoint.id === target.endpointId
      )
      const owningBranch = circuit?.branches?.find(
        (branch) => branch.dcBusId && branch.endpointIds.includes(target.endpointId!)
      )
      if (
        circuit &&
        owningBranch &&
        (targetEndpoint?.symbol === 'dc_dc_converter' || targetEndpoint?.symbol === 'inverter')
      ) {
        const promoted = promoteDcBusConverterEndpoint(circuit, targetEndpoint.id)
        if (!promoted) return
        callbacks.updateCircuit(circuit.id, {
          endpoints: promoted.endpoints,
          branches: promoted.branches,
        })
        addEndpointToCircuitConverterDcConnection(
          {
            type: 'circuit',
            circuitId: circuit.id,
            branchId: owningBranch.id,
            dcBusId: owningBranch.dcBusId,
            branchEndpoints: [],
            wireDomain: 'DC',
            converterDcConnection: {
              converterId: targetEndpoint.id,
              connectionIndex: 0,
            },
          },
          project,
          symbol,
          t,
          callbacks
        )
        return
      }
    }
    if (target.converterDcConnection && target.circuitId) {
      const circuit = callbacks.getCircuitById(target.circuitId)
      const isNestedDcBusConverter = circuit?.branches?.some((branch) =>
        branch.branchDevices?.some(
          (device) => device.id === target.converterDcConnection?.converterId
        )
      )
      if (
        isNestedDcBusConverter &&
        addEndpointToCircuitConverterDcConnection(target, project, symbol, t, callbacks)
      ) {
        return
      }
    }
    if (target.dcBusId) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }
    if (
      target.converterDcConnection &&
      addEndpointToCircuitConverterDcConnection(target, project, symbol, t, callbacks)
    ) {
      return
    }
    if (target.type === 'supplyConverterDcWire' && target.panelId) {
      const device = addConverterDcBranchDevice(symbol, target, project, callbacks)
      if (device) callbacks.setSelection({ type: 'trunkDevice', ids: [device.id] })
      return
    }

    // Resolve circuit from target or protection (same as endpointBehavior)
    let circuitId = target.circuitId
    if (!circuitId && target.type === 'protection' && target.protectionId) {
      const protection = callbacks.getProtectionById(target.protectionId)
      circuitId = protection?.circuits?.[0]?.id
    }
    if (!circuitId) return

    const circuit = callbacks.getCircuitById(circuitId)
    if (!circuit) return

    const targetProtection =
      target.type === 'protection' && target.protectionId
        ? callbacks.getProtectionById(target.protectionId)
        : target.type === 'circuit' &&
            target.circuitId &&
            !target.branchEndpoints?.length &&
            (target.circuitTrunkSegmentIndex === 0 || target.insertAfterCircuitContent === true)
          ? findProtectionByCircuitIdInProject(projectPanels(project), target.circuitId)
          : null
    if (targetProtection && isEmptyProtectionCircuitForDcDrop(targetProtection)) {
      const inverterMeta = getSymbolById('inverter')
      if (!inverterMeta) return

      const inverterId = callbacks.newId?.() ?? generateId()
      const inverter: TrunkDevice = {
        id: inverterId,
        type: 'conversion',
        symbol: 'inverter',
        label: '',
        trunkPosition: 0,
      }
      callbacks.addTrunkDevice(circuitId, inverter)

      let addedEndpointId: string | undefined
      const trackingCallbacks: DropBehaviorCallbacks = {
        ...callbacks,
        addEndpoint: (targetCircuitId, endpoint, insertAfterEndpointId, branchOpts) => {
          addedEndpointId = endpoint.id
          callbacks.addEndpoint(targetCircuitId, endpoint, insertAfterEndpointId, branchOpts)
        },
      }
      endpointBehavior.execute(target, project, symbol, t, trackingCallbacks)

      const updatedCircuit = callbacks.getCircuitById(circuitId)
      const addedEndpoint = updatedCircuit?.endpoints.find(
        (endpoint) => endpoint.id === addedEndpointId
      )
      const endpointPlacement = addedEndpoint?.placements[0]
      const inverterPlacement = buildVisibleTrunkSitplanPlacement(
        project,
        callbacks.getSitplanTarget(),
        circuitId,
        endpointPlacement
          ? { x: endpointPlacement.pos.x - 80, y: endpointPlacement.pos.y }
          : undefined,
        callbacks.newId
      )
      if (updatedCircuit && inverterPlacement) {
        callbacks.updateCircuit(circuitId, {
          trunkDevices: (updatedCircuit.trunkDevices ?? []).map((device) =>
            device.id === inverterId ? { ...device, placements: [inverterPlacement] } : device
          ),
        })
      }
      return
    }

    const wireDomain = getWireDomainAtDropTarget(target, project, callbacks)

    if (wireDomain === 'DC') {
      // Already on a DC wire – behave like a standard endpoint.
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }

    // DC-only sources require an explicit DC-producing component everywhere else.
    const message = t('wires.domainMismatchDrop', {
      defaultValue: '{{component}} requires {{domain}} input, but the wire here is {{wireDomain}}.',
      component: symbol.name,
      domain: 'DC',
      wireDomain,
    })
    callbacks.onDropRejected?.(message)
  },
}

/**
 * Energy meter drop behavior — special dual-mode:
 * - On endpoint/protection targets: acts as in-between device on branches (like a switch)
 * - On circuit targets (vertical trunk wire): adds as a trunk device
 *
 * When dropped on the vertical trunk, the energy meter is placed BEFORE all branches
 * by default (trunkPosition 0). The trunkPosition can be refined based on where on
 * the trunk the cursor was (computed from insertAfterEndpointId).
 */
const energyMeterBehavior: DropBehavior = {
  validTargets: [
    'endpoint',
    'circuit',
    'protection',
    'supplyWire',
    'supplyBackupWire',
    'supplyBackupOutputWire',
    'supplyChangeoverGridWire',
    'supplyConverterGridWire',
    'supplyConverterDcWire',
  ],
  execute: (target, project, symbol, t, callbacks) => {
    if (target.dcBusId) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }
    if (target.converterDcConnection && target.circuitId) {
      addCircuitDcPassiveDevice(target, project, symbol, callbacks)
      return
    }
    if (
      target.type === 'supplyWire' ||
      target.type === 'supplyChangeoverGridWire' ||
      target.type === 'supplyConverterGridWire'
    ) {
      addSupplyTrunkDevice(symbol, target, project, callbacks)
      return
    }
    if (target.type === 'supplyConverterDcWire') {
      addConverterDcBranchDevice(symbol, target, project, callbacks)
      return
    }
    if (target.type === 'supplyBackupWire' || target.type === 'supplyBackupOutputWire') {
      addBackupLaneTrunkDevice(symbol, target, project, callbacks)
      return
    }

    // Circuit trunk targets have no branch context. An empty branch still has
    // branch context and should receive an endpoint rather than a trunk device.
    if (target.type === 'circuit' && target.circuitId && target.branchEndpoints === undefined) {
      if (circuitIsTerminalPanelFeeder(project, target.circuitId)) {
        return
      }
      const circuit = callbacks.getCircuitById(target.circuitId)
      if (!circuit) return

      // Compute trunkPosition from explicit circuit trunk segment metadata when available.
      const trunkPosition = getCircuitTrunkPositionForDrop(target, circuit)

      const deviceId = callbacks.newId?.() ?? generateId()
      const trunkDevice: TrunkDevice = {
        id: deviceId,
        type: 'energy_meter',
        symbol: 'energy_meter',
        label: `kWh`,
        trunkPosition,
      }

      addCircuitTrunkDeviceAtDrop(target, circuit, trunkDevice, callbacks)
      return
    }

    // Otherwise, use the standard endpoint behavior (in-between device on branch)
    endpointBehavior.execute(target, project, symbol, t, callbacks)
  },
}

/**
 * Junction box/terminal strip: supply wire, ground wire, circuit trunk, or endpoint branch.
 * Branch-positioned boxes also receive a situation-plan placement. No label.
 */
const junctionBoxBehavior: DropBehavior = {
  validTargets: [
    'supplyWire',
    'supplyBackupWire',
    'supplyBackupOutputWire',
    'supplyConverterDcWire',
    'groundWire',
    'circuit',
    'endpoint',
    'protection',
  ],
  execute: (target, project, symbol, t, callbacks) => {
    if (target.dcBusId) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }
    if (target.converterDcConnection && target.circuitId) {
      addCircuitDcPassiveDevice(target, project, symbol, callbacks)
      return
    }
    const panel = findPanelForTarget(project, target)
    if (target.type === 'supplyWire') {
      addSupplyTrunkDevice(symbol, target, project, callbacks)
      return
    }
    if (target.type === 'supplyConverterDcWire') {
      addConverterDcBranchDevice(symbol, target, project, callbacks)
      return
    }
    if (target.type === 'supplyBackupWire' || target.type === 'supplyBackupOutputWire') {
      addBackupLaneTrunkDevice(symbol, target, project, callbacks)
      return
    }
    if (target.type === 'groundWire') {
      if (!panel?.isMain) return
      addGroundTrunkDevice(symbol, target, project, t, callbacks)
      return
    }
    // On endpoint or protection (branch): add as in-between device on branch, like energy meter
    if (
      target.type === 'endpoint' ||
      target.type === 'protection' ||
      (target.type === 'circuit' && target.branchEndpoints?.length)
    ) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }
    if (target.type === 'circuit' && target.circuitId && !target.branchEndpoints?.length) {
      if (circuitIsTerminalPanelFeeder(project, target.circuitId)) {
        return
      }
      const circuit = callbacks.getCircuitById(target.circuitId)
      if (!circuit) return
      const trunkPosition = getCircuitTrunkPositionForDrop(target, circuit)
      const deviceId = callbacks.newId?.() ?? generateId()
      const isTerminalStrip = symbol.id === 'terminal_strip'
      const trunkDevice: TrunkDevice = {
        id: deviceId,
        type: isTerminalStrip ? 'terminal_strip' : 'junction_box',
        symbol: isTerminalStrip ? 'terminal_strip' : 'junction_box',
        ...(isTerminalStrip
          ? getTerminalStripTrunkCreationProps(project, undefined, target.circuitId)
          : { label: '', junctionIdentity: getNextJunctionIdentity(project, symbol.id) }),
        trunkPosition,
      }
      const activeFloorId = resolveCircuitSitplanTargetFloorId(
        project,
        callbacks.getSitplanTarget().activeFloorId,
        target.circuitId
      )
      if (activeFloorId) {
        const preferredPlanPos =
          viewportCenterOn(callbacks.getSitplanTarget(), activeFloorId) ?? undefined
        const placement = buildAutoSitplanPlacement(project, {
          circuitId: target.circuitId,
          floorId: activeFloorId,
          placementId: callbacks.newId?.() ?? generateId(),
          ...(preferredPlanPos ? { preferredPlanPos } : {}),
        })
        if (placement) trunkDevice.placements = [placement]
      }
      addCircuitTrunkDeviceAtDrop(target, circuit, trunkDevice, callbacks)
      callbacks.setSelection({ type: 'trunkDevice', ids: [deviceId] })
    }
  },
}

/**
 * Junction panel: same as junction box but with label; appears on sitplan (one per label).
 * Can be placed on trunks or on endpoint branches (like energy meter).
 */
const junctionPanelBehavior: DropBehavior = {
  validTargets: [
    'supplyWire',
    'supplyBackupWire',
    'supplyBackupOutputWire',
    'supplyConverterDcWire',
    'groundWire',
    'circuit',
    'endpoint',
    'protection',
  ],
  execute: (target, project, symbol, t, callbacks) => {
    if (target.dcBusId) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }
    if (target.converterDcConnection && target.circuitId) {
      addCircuitDcPassiveDevice(target, project, symbol, callbacks)
      return
    }
    const panel = findPanelForTarget(project, target)
    if (target.type === 'supplyWire') {
      addSupplyTrunkDevice(symbol, target, project, callbacks)
      return
    }
    if (target.type === 'supplyConverterDcWire') {
      addConverterDcBranchDevice(symbol, target, project, callbacks)
      return
    }
    if (target.type === 'supplyBackupWire' || target.type === 'supplyBackupOutputWire') {
      addBackupLaneTrunkDevice(symbol, target, project, callbacks)
      return
    }
    if (target.type === 'groundWire') {
      if (!panel?.isMain) return
      addGroundTrunkDevice(symbol, target, project, t, callbacks)
      return
    }
    // On endpoint or protection (branch): add as in-between device on branch, like energy meter
    if (
      target.type === 'endpoint' ||
      target.type === 'protection' ||
      (target.type === 'circuit' && target.branchEndpoints?.length)
    ) {
      endpointBehavior.execute(target, project, symbol, t, callbacks)
      return
    }
    if (target.type === 'circuit' && target.circuitId && !target.branchEndpoints?.length) {
      if (circuitIsTerminalPanelFeeder(project, target.circuitId)) {
        return
      }
      const circuit = callbacks.getCircuitById(target.circuitId)
      if (!circuit) return
      const label = getFirstJunctionPanelLabel(project) ?? 'JP1'
      callbacks.ensureJunctionPanelPlacementForLabel(label)
      const trunkPosition = getCircuitTrunkPositionForDrop(target, circuit)
      const deviceId = callbacks.newId?.() ?? generateId()
      const trunkDevice: TrunkDevice = {
        id: deviceId,
        type: 'junction_panel',
        symbol: 'junction_panel',
        label,
        junctionIdentity: getNextJunctionIdentity(project, symbol.id),
        trunkPosition,
      }
      addCircuitTrunkDeviceAtDrop(target, circuit, trunkDevice, callbacks)
    }
  },
}

/** Free-floating note on the wire canvas (same data as context menu “Add note”). */
const noteBehavior: DropBehavior = {
  validTargets: [null],
  execute: (_target, _project, _symbol, _t, callbacks) => {
    const pos = callbacks.dropCanvasPosition ?? { x: 0, y: 0 }
    const noteId = `note-${callbacks.newId?.() ?? generateId()}`
    callbacks.addEendraadNote({
      id: noteId,
      text: 'New note',
      fontSize: 14,
      pos,
      panelId: undefined,
    })
    callbacks.setSelection({ type: 'note', ids: [noteId] })
    callbacks.onNotePlaced?.()
  },
}

/** The source selector is a slotted supply-path device, never a free canvas symbol. */
const sourceChangeoverBehavior: DropBehavior = {
  validTargets: ['supplyWire', 'supplyConverterBackupWire'],
  execute: (target, project, symbol, _t, callbacks) => {
    if (target.supplyFeedScope !== 'root') return
    const supplyDevices = getSupplyDevicesForDropTarget(target, project)
    if (supplyDevices.some((device) => device.symbol === 'source_changeover')) return
    const directConverter = supplyDevices.find((device) => device.supplyPath === 'converter-branch')
    if (!directConverter) {
      addSupplyTrunkDevice(symbol, target, project, callbacks)
      return
    }
    const targetPanel = target.panelId
      ? findPanelById(project.disciplines?.electrical?.panels ?? [], target.panelId)
      : undefined
    const acceptsAnyGridFeedSegment = Boolean(
      targetPanel && getPanelFeedOrganization(project, targetPanel) === 'split-backup'
    )
    const deviceAtRequestedSlot = supplyDevices.find(
      (device) => device.trunkPosition === target.supplyDeviceInsertIndex
    )
    if (
      !acceptsAnyGridFeedSegment &&
      (deviceAtRequestedSlot?.supplyPath === 'converter-dc' ||
        deviceAtRequestedSlot?.supplyPath === 'converter-dc-top') &&
      !target.supplyConverterChangeoverSlot
    )
      return
    const normalizedInsertIndex = resolveDirectConverterChangeoverInsertIndex(
      supplyDevices,
      target.supplyDeviceInsertIndex,
      acceptsAnyGridFeedSegment
    )
    const converterOutputChain = getDirectConverterOutputChainForChangeover(
      supplyDevices,
      normalizedInsertIndex ?? undefined
    )
    if (!converterOutputChain || !target.panelId || !callbacks.updateSupplyTrunkDevice) return

    const directBackup = findDirectConverterBackupProtection(
      project,
      target.panelId,
      directConverter.id
    )
    // A terminal load cannot be represented by the switched supply branch without changing
    // ownership. Keep the existing standalone topology intact instead of partially upgrading it.
    if (directBackup?.circuit.endpoints.length) return
    if (directBackup && !callbacks.deleteProtection) return

    const directAssembly = findAssemblyForDirectConverter(project, directConverter.id)
    const changeover = addSupplyTrunkDevice(
      symbol,
      { ...target, supplyDeviceInsertIndex: normalizedInsertIndex ?? undefined },
      project,
      callbacks
    )
    if (!changeover) return
    callbacks.updateSupplyTrunkDevice(directConverter.id, { supplyPath: 'backup' })
    const migratedOutputDevices = acceptsAnyGridFeedSegment
      ? []
      : converterOutputChain.map((device) => ({
          ...device,
          supplyPath: 'backup-output' as const,
        }))
    const migratedGridDevices = acceptsAnyGridFeedSegment
      ? converterOutputChain.map((device) => ({
          ...device,
          supplyPath: 'changeover-grid' as const,
        }))
      : []
    migratedOutputDevices.forEach((device) => {
      callbacks.updateSupplyTrunkDevice!(device.id, { supplyPath: 'backup-output' })
    })
    migratedGridDevices.forEach((device) => {
      callbacks.updateSupplyTrunkDevice!(device.id, { supplyPath: 'changeover-grid' })
    })
    const migratedBackupDevices = directBackup
      ? directConverterBackupInlineDevicesToTrunkDevices(directBackup)
      : []
    if (directBackup) {
      callbacks.deleteProtection?.(directBackup.protection.id)
      migratedBackupDevices.forEach((device) => {
        callbacks.addSupplyTrunkDevice(device, undefined, {
          panelId: target.panelId,
          feedScope: 'root',
        })
      })
    }
    const upgraded = upgradeDirectConverterToChangeoverAssembly(
      project,
      target.panelId,
      changeover,
      directConverter,
      migratedOutputDevices.length > 0 || migratedBackupDevices.length > 0
        ? [
            ...supplyDevices.filter((device) => device.supplyPath === 'backup-output'),
            ...migratedOutputDevices,
            ...migratedBackupDevices,
          ]
        : undefined,
      migratedGridDevices.length > 0 ? migratedGridDevices : undefined
    )
    if (directAssembly) callbacks.replaceSupplyAssembly(directAssembly.id, upgraded)
    else callbacks.addSupplyAssembly(upgraded)
    callbacks.setSelection({ type: 'trunkDevice', ids: [changeover.id] })
  },
}

/**
 * Drop behaviors registry
 */
export const dropBehaviors: Record<string, DropBehavior> = {
  mcb: protectionBehavior,
  rcd: rcdBehavior,
  rcbo: rcdBehavior,
  fuse: protectionBehavior, // Fuse uses generic protection behavior
  main_switch: protectionBehavior, // Main switch uses generic protection behavior
  spd: protectionBehavior, // SPD uses generic protection behavior
  rotating_switch: protectionBehavior,
  source_changeover: sourceChangeoverBehavior,
  socket: endpointBehavior,
  socket_gnd: endpointBehavior,
  socket_child: endpointBehavior,
  socket_gnd_child: endpointBehavior,
  double_socket_child: endpointBehavior,
  double_socket_gnd_child: endpointBehavior,
  modular_socket: endpointBehavior,
  light_point: endpointBehavior,
  light_spot: endpointBehavior,
  light_led: endpointBehavior,
  light_fluorescent: endpointBehavior,
  fixed_appliance_generic: endpointBehavior,
  oven: endpointBehavior,
  washer: endpointBehavior,
  dryer: endpointBehavior,
  dishwasher: endpointBehavior,
  boiler: endpointBehavior,
  ev: endpointBehavior,
  freezer: endpointBehavior,
  fridge: endpointBehavior,
  microwave: endpointBehavior,
  motor: endpointBehavior,
  stove: endpointBehavior,
  furnace: endpointBehavior,
  furnace_heatpump: endpointBehavior,
  furnace_gas: endpointBehavior,
  furnace_oil: endpointBehavior,
  furnace_pellets: endpointBehavior,
  heating: endpointBehavior,
  ventilation: endpointBehavior,
  door_lock: endpointBehavior,
  buzzer: endpointBehavior,
  bell: endpointBehavior,
  horn: endpointBehavior,
  siren: endpointBehavior,
  switch: switchBehavior,
  switch_1p_twoway: switchBehavior,
  switch_2p_twoway: switchBehavior,
  switch_dimmer: switchBehavior,
  switch_1p_changeover: switchBehavior,
  switch_shutter: switchBehavior,
  switch_1p_pull: switchBehavior,
  contact: switchBehavior, light_sensor: switchBehavior,
  switch_impulse: switchBehavior,
  switch_cross: switchBehavior,
  motion_detector: switchBehavior,
  smoke_detector: switchBehavior,
  relay: relayBehavior,
  switch_single: switchBehavior,
  switch_double: switchBehavior,
  domotica: endpointBehavior,
  energy_meter: energyMeterBehavior,
  transformer: energyConversionBehavior,
  rectifier: energyConversionBehavior,
  inverter: energyConversionBehavior,
  dc_dc_converter: energyConversionBehavior,
  solar_panel: dcEndpointBehavior,
  battery: dcEndpointBehavior,
  dc_bus: dcBusBehavior,
  panel_distribution: panelBehavior,
  earthing: groundBehavior,
  earthing_separator: earthingSeparatorBehavior,
  junction_box: junctionBoxBehavior,
  terminal_strip: junctionBoxBehavior,
  junction_panel: junctionPanelBehavior,
  note: noteBehavior,
}

/** Whether a symbol can be dropped on blank one-wire canvas (outside any panel or wire). */
export function canDropSymbolOnEmptyCanvas(symbolId: string): boolean {
  return dropBehaviors[symbolId]?.validTargets.includes(null) ?? false
}

/**
 * Keep existing supply-device moves on the same DC-rail permission surface as
 * library drops. A direct converter-to-bus lead is an inline-device lane, not a
 * second converter/device branch: only protections, junction boxes, terminal
 * strips, energy meters, and direct solar sources may be inserted before the
 * DC bus. Batteries are terminal DC devices and are valid on this lead as
 * well; the full symbol registry is available once a real bus branch is
 * targeted.
 */
export function canDropSymbolOnSupplyConverterDcWire(
  symbolId: string,
  hasDcBusBranch: boolean
): boolean {
  const behavior = dropBehaviors[symbolId]
  if (!behavior?.validTargets.includes('supplyConverterDcWire')) return false

  const isProtectionSymbol = PROTECTION_SYMBOL_IDS.includes(
    symbolId as (typeof PROTECTION_SYMBOL_IDS)[number]
  )
  if (!hasDcBusBranch) {
    return (
      isProtectionSymbol ||
      [
        'battery',
        'dc_bus',
        'junction_box',
        'terminal_strip',
        'energy_meter',
        'relay',
        'solar_panel',
      ].includes(symbolId)
    )
  }
  return true
}

/** Execute drop behavior for a symbol */
export function executeDropBehavior(
  symbol: SymbolMetadata,
  target: DropTarget,
  project: DropBehaviorProject,
  t: TFunction,
  callbacks: DropBehaviorCallbacks,
  analytics:
    | false
    | {
        canvas: EditorCanvasAnalytics
        placementMethod: SymbolPlacementMethod
      } = { canvas: 'eendraad', placementMethod: 'library_drop' }
): void {
  callbacks = withSearchPresetCallbacks(symbol, callbacks)
  const isProtectionSymbol = PROTECTION_SYMBOL_IDS.includes(
    symbol.id as (typeof PROTECTION_SYMBOL_IDS)[number]
  )
  if (
    target.type === 'supplyConverterDcWire' &&
    !target.supplyDcBusId &&
    !canDropSymbolOnSupplyConverterDcWire(symbol.id, false)
  ) {
    logger.warn(
      `[drop-diag] Direct converter DC lead only accepts inline devices: symbol=${symbol.id}`
    )
    return
  }
  const isDirectConverterDcTarget =
    target.converterDcConnection != null &&
    !target.dcBusId &&
    target.type !== 'supplyConverterDcWire'
  if (isProtectionSymbol && isDirectConverterDcTarget) {
    logger.warn(
      `[drop-diag] Protection requires a DC bus branch: symbol=${symbol.id}, targetType=${target.type}`
    )
    return
  }
  if (target.converterDcConnection && !symbolSupportsWireDomain(symbol.id, 'DC')) {
    const requiredPorts = getPortDomainsForSymbol(symbol.id)
    const message = t('wires.domainMismatchDrop', {
      defaultValue:
        '{{component}} has no {{wireDomain}} compatible port (ports: {{portA}} / {{portB}}).',
      component: symbol.name,
      domain: requiredPorts[0],
      wireDomain: 'DC',
      portA: requiredPorts[0],
      portB: requiredPorts[1],
    })
    callbacks.onDropRejected?.(message)
    return
  }
  if (
    target.converterDcConnection &&
    !target.dcBusId &&
    target.type !== 'supplyConverterDcWire' &&
    symbol.id === 'domotica'
  ) {
    addEndpointToCircuitConverterDcConnection(target, project, symbol, t, callbacks)
    if (analytics) {
      callbacks.onSymbolPlaced?.({
        ...analytics,
        symbol,
        targetType: target.type ?? 'empty',
      })
    }
    return
  }

  if (!canCreateSupplyTopologyFromDrop(symbol, target.type)) {
    logger.warn(
      `[drop-diag] Blocked by supply topology gate: symbol=${symbol.id}, targetType=${target.type}`
    )
    return
  }

  const behavior = dropBehaviors[symbol.id]
  if (!behavior) {
    logger.warn(`[drop-diag] No drop behavior registered for symbol: ${symbol.id}`)
    return
  }

  if (!behavior.validTargets.includes(target.type)) {
    logger.warn(
      `[drop-diag] Invalid drop target "${target.type}" for symbol "${symbol.id}". Valid: ${behavior.validTargets.join(', ')}`
    )
    return
  }

  behavior.execute(target, project, symbol, t, callbacks)
  if (analytics) {
    callbacks.onSymbolPlaced?.({
      ...analytics,
      symbol,
      targetType: target.type ?? 'empty',
    })
  }
}
