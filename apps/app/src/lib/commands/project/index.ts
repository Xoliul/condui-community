import { planSetColors } from './commands/planSetColors'
import { planDrawWire } from './commands/planDrawWire'
import { panelEditLayout } from './commands/panelEditLayout'
import { panelRewire } from './commands/panelRewire'
import { ProjectCommandRegistry } from './registry'
import { electricalPlaceSymbol } from './commands/electricalPlaceSymbol'
import { electricalCreateFork, electricalDeleteEmptyFork } from './commands/electricalFork'
import { electricalCreateRiser, electricalDeleteEmptyRiser, electricalJoinRisers } from './commands/electricalRiser'
import { eendraadMoveEndpoints } from './commands/eendraadMoveEndpoints'
import { electricalAssignEndpoints } from './commands/electricalAssignEndpoints'
import { planAssignCircuit, circuitSetCodeAndPosition } from './commands/planAssignCircuit'
import { electricalMoveProtectionOnBus } from './commands/electricalMoveProtectionOnBus'
import { entitiesDelete } from './commands/entitiesDelete'
import { floorRename } from './commands/floorRename'
import { documentShortCircuit } from './commands/documentShortCircuit'
import { planCopyToFloor } from './commands/planCopyToFloor'
import { planDuplicate } from './commands/planDuplicate'
import { circuitCreateEmpty, planPlaceSymbol } from './commands/planPlaceSymbol'
import { planMovePlacements, planMoveToFloor } from './commands/planPlacements'
import {
  planSetPlacementsHidden,
  planRotatePlacements,
  planSetPlacementLocked,
  planDropEarthing,
  planEnsureEarthingPlacement,
  planShowHiddenPlacements,
} from './commands/planPlacementEdits'
import { planSetWiringVisibility, planSetSymbolSize } from './commands/planDisplay'
import { planAltDuplicate } from './commands/planAltDuplicate'
import { propertiesEdit } from './commands/propertiesEdit'
import { electricalCreateCircuitAndAssign } from './commands/electricalCreateCircuitAndAssign'
import { planImportRoomScan } from './commands/planImportRoomScan'
import {
  buildingCreateFloor,
  buildingDeleteFloor,
  buildingReorderFloors,
  planAttachBackground,
  planDetachBackground,
  planCalibrateScale,
  planTransformBackground,
} from './commands/floorSetup'
import { planPlaceExisting } from './commands/planPlaceExisting'
import { planApplyRecognizedWalls } from './commands/planApplyRecognizedWalls'
import { planCreateBuildingGeometry } from './commands/planCreateBuildingGeometry'
import { planMergeWallPoints } from './commands/planMergeWallPoints'
import { planSplitWall } from './commands/planSplitWall'
import { junctionEdit } from './commands/junctionEdit'
import { junctionEnsureAsset } from './commands/junctionEnsureAsset'
import {
  annotationCreateNote,
  eendraadCreateFrame,
  planEditWireRoute,
  planDisconnectWires,
  cableAcceptLengthEstimates,
} from './commands/planFinishing'
import { electricalDuplicateProtection } from './commands/electricalDuplicateProtection'
import { electricalDuplicateElements } from './commands/electricalDuplicateElements'
import { panelMoveSupply } from './commands/panelMoveSupply'
import { endpointResizeDomoticaOutputs } from './commands/endpointResizeDomoticaOutputs'
import { panelMoveAttachmentOnBus } from './commands/panelMoveAttachmentOnBus'
import { planMoveEndpointsToFloor } from './commands/planMoveEndpointsToFloor'
import { eendraadResetLabelOverrides } from './commands/eendraadResetLabelOverrides'
import { planEnsurePanelPlacements } from './commands/planEnsurePanelPlacements'
import { panelRepairDuplicatedBoardSymbols } from './commands/panelRepairDuplicatedBoardSymbols'
import { panelEnsureEarthingStem } from './commands/panelEnsureEarthingStem'
import { panelEjectSecondaryBusProtections } from './commands/panelEjectSecondaryBusProtections'
import { supplyDisconnectInverterGridInput } from './commands/supplyDisconnectInverterGridInput'
import { supplyAddSystem } from './commands/supplyAddSystem'
import { supplyCreateTap } from './commands/supplyCreateTap'
import { supplyMoveTap } from './commands/supplyMoveTap'
import { electricalImportSchematic } from './commands/electricalImportSchematic'
import {
  electricalMoveSupplyTrunkDevice,
  electricalMoveCircuitTrunkDevice,
} from './commands/electricalMoveTrunkDevices'

export {
  electricalCreateCircuitAndAssign,
  electricalCreateCircuitAndAssignInputSchema,
  type ElectricalCreateCircuitAndAssignInput,
} from './commands/electricalCreateCircuitAndAssign'

export {
  panelEditLayout,
  panelEditLayoutInputSchema,
  type PanelEditLayoutInput,
} from './commands/panelEditLayout'
export { panelRewire, panelRewireInputSchema, type PanelRewireInput } from './commands/panelRewire'
export * from './types'
export * from './inspection'
export { inspectProjectGraph, projectGraphQuerySchema, type ProjectGraphQuery } from './projectGraph'
export { describeProjectWorkflow } from './workflowGuide'
export * from './insertionTargets'
export { inspectJunctionConnections } from './junctionConnections'
export { inspectCableEstimates, cableEstimateQuerySchema } from './cableEstimates'
export { inspectPlanWireRoutes, planWireRouteQuerySchema } from './planWireRoutes'
export { ProjectCommandRegistry, type ParsedInvocation } from './registry'
export {
  propertiesEditInputSchema,
  propertiesEdit,
  type PropertiesEditInput,
  type PropertiesEditAction,
  type PropertyEdit,
  type ProtectionPropertyPatch,
  type CircuitPropertyPatch,
  type EndpointPropertyPatch,
  type CircuitWirePropertyPatch,
} from './commands/propertiesEdit'
export { applyCommandBatch } from './transaction'
export { projectRevisionToken } from './revision'
export {
  createHeadlessProjectSession,
  createDefaultCommandEnv,
  type HeadlessProjectSession,
} from './headlessSession'

/** Every project command, by id. UI adapters, scripts and agents all run commands from here. */
export function createProjectCommandRegistry(): ProjectCommandRegistry {
  return new ProjectCommandRegistry()
    .register(planSetColors)
    .register(floorRename)
    .register(documentShortCircuit)
    .register(planMovePlacements)
    .register(planMoveToFloor)
    .register(planSetPlacementsHidden)
    .register(planRotatePlacements)
    .register(planSetPlacementLocked)
    .register(planDropEarthing)
    .register(planEnsureEarthingPlacement)
    .register(planShowHiddenPlacements)
    .register(planSetWiringVisibility)
    .register(planSetSymbolSize)
    .register(planAltDuplicate)
    .register(entitiesDelete)
    .register(planDuplicate)
    .register(circuitCreateEmpty)
    .register(planPlaceSymbol)
    .register(planCopyToFloor)
    .register(electricalPlaceSymbol)
    .register(electricalCreateFork)
    .register(electricalDeleteEmptyFork)
    .register(electricalCreateRiser)
    .register(electricalJoinRisers)
    .register(electricalDeleteEmptyRiser)
    .register(eendraadMoveEndpoints)
    .register(electricalAssignEndpoints)
    .register(planAssignCircuit)
    .register(circuitSetCodeAndPosition)
    .register(electricalMoveProtectionOnBus)
    .register(panelEditLayout)
    .register(panelRewire)
    .register(propertiesEdit)
    .register(electricalCreateCircuitAndAssign)
    .register(planImportRoomScan)
    .register(planDrawWire)
    .register(buildingCreateFloor)
    .register(buildingDeleteFloor)
    .register(buildingReorderFloors)
    .register(planAttachBackground)
    .register(planDetachBackground)
    .register(planCalibrateScale)
    .register(planPlaceExisting)
    .register(planCreateBuildingGeometry)
    .register(planApplyRecognizedWalls)
    .register(planMergeWallPoints)
    .register(planSplitWall)
    .register(planTransformBackground)
    .register(annotationCreateNote)
    .register(eendraadCreateFrame)
    .register(planEditWireRoute)
    .register(planDisconnectWires)
    .register(cableAcceptLengthEstimates)
    .register(junctionEdit)
    .register(junctionEnsureAsset)
    .register(electricalDuplicateProtection)
    .register(electricalDuplicateElements)
    .register(panelMoveSupply)
    .register(endpointResizeDomoticaOutputs)
    .register(panelMoveAttachmentOnBus)
    .register(planMoveEndpointsToFloor)
    .register(eendraadResetLabelOverrides)
    .register(planEnsurePanelPlacements)
    .register(panelRepairDuplicatedBoardSymbols)
    .register(panelEnsureEarthingStem)
    .register(panelEjectSecondaryBusProtections)
    .register(supplyDisconnectInverterGridInput)
    .register(supplyAddSystem)
    .register(supplyCreateTap)
    .register(supplyMoveTap)
    .register(electricalImportSchematic)
    .register(electricalMoveSupplyTrunkDevice)
    .register(electricalMoveCircuitTrunkDevice)
}

export const projectCommands = createProjectCommandRegistry()
