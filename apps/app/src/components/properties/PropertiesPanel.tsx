import { CanonicalWireProperties } from './editors/CanonicalWireProperties'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useUIStore, type UIState } from '@/stores/uiStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { WallProperties } from './WallProperties'
import { OpeningProperties } from './OpeningProperties'
import { StairProperties } from './StairProperties'
import { usePropertiesPanelFieldBlurOnLeave } from '@/hooks/usePropertiesPanelFieldBlurOnLeave'
import {
  getPropertiesPanelTitle,
  getSelectedGraphicElement,
  getSelectedNote,
  getSelectedOpening,
  getSelectedPlacementTarget,
  getSelectedStair,
  getSelectedWall,
  getStairOnlyPointSelection,
} from './selection'
import { PropertiesPanelFrame } from './PropertiesPanelFrame'
import { MultiSelectionPropertiesEditor } from './MultiSelectionProperties'
import {
  FrameProperties,
  GraphicElementProperties,
  NoteProperties,
} from './editors/AnnotationProperties'
import { InstallerProperties } from '@/components/properties/editors/InstallerProperties'
import { ProjectProperties } from './editors/ProjectProperties'
import { PanelProperties } from './editors/PanelProperties'
import { ProtectionProperties } from './editors/ProtectionProperties'
import { CircuitProperties } from './editors/CircuitProperties'
import { EndpointProperties } from './editors/EndpointProperties'
import { WirePropertiesWithLayout } from './editors/WireProperties'
import { AuxiliaryEnclosureProperties } from './editors/AuxiliaryEnclosureProperties'
import { JunctionPanelTerminalProperties } from './editors/JunctionPanelTerminalProperties'
import { selectProjectAuxiliaryElectricalEnclosures } from '@/lib/projectV2/electrical'
import {
  GroundProperties,
  SupplyPanelProperties,
  SupplyProperties,
  TrunkDeviceProperties,
} from './editors/TrunkSupplyGroundProperties'
import { StructuralReadOnlyProperties } from './StructuralReadOnlyProperties'
export default function PropertiesPanel({
  readOnly = false,
  showSensitiveInfoNotice = false,
  embedded = false,
  isTemplate = false,
}: {
  readOnly?: boolean
  showSensitiveInfoNotice?: boolean
  embedded?: boolean
  isTemplate?: boolean
}) {
  const { t } = useTranslation()
  const { selection, activePlanTool, planWallDrawingThicknessCm, setPlanWallDrawingThicknessCm } =
    useUIStore(
      useShallow((state: UIState) => ({
        selection: state.selection,
        activePlanTool: state.activePlanTool,
        planWallDrawingThicknessCm: state.planWallDrawingThicknessCm,
        setPlanWallDrawingThicknessCm: state.setPlanWallDrawingThicknessCm,
      }))
    )
  const { panelVisible, panelWidth, togglePanel } = useUIStore(
    useShallow((state: UIState) => ({
      panelVisible: state.panels.properties.visible,
      panelWidth: state.panels.properties.width,
      togglePanel: state.togglePanel,
    }))
  )
  const currentProject = useProjectStore((state: ProjectState) => state.currentProject)
  const selectedId = selection.ids[0] ?? ''
  const {
    panel,
    protection,
    circuit,
    endpoint,
    frame,
    placementEndpoint,
    placementTrunkDevice,
    titleEndpoint,
    titleTrunkDevice,
    sameJunctionPanelId,
    auxiliaryEnclosure,
    updatePanel,
    updateProtection,
    updateCircuit,
    updateEndpoint,
    updateProject,
    updateInstallation,
    updateEendraadNote,
    updateSitplanNote,
    updatePlanGraphicElement,
    updateFrame,
    getCircuitById,
    getPanelById,
    updatePanelGrid,
    updateAuxiliaryElectricalEnclosure,
    getEndpointById,
    getPlacementById,
    getTrunkDeviceById,
    getEendraadNoteById,
    getSitplanNoteById,
  } = useProjectStore(
    useShallow((state: ProjectState) => {
      const placement =
        selection.type === 'placement' ? state.getPlacementById(selectedId) : undefined
      const placementEndpointId = placement?.endpointId
      const placementTrunkDeviceId = placement?.trunkDeviceId
      const trunkDeviceRows =
        selection.type === 'trunkDevice'
          ? selection.ids.map((id) => state.getTrunkDeviceById(id)).filter(Boolean)
          : []
      const junctionPanelDevices = trunkDeviceRows.map((row) => row!.device)
      const hasSameJunctionPanel =
        junctionPanelDevices.length > 1 &&
        junctionPanelDevices.every((device) => device.symbol === 'junction_panel') &&
        new Set(junctionPanelDevices.map((device) => device.label || '')).size === 1
      return {
        panel: selection.type === 'panel' ? state.getPanelById(selectedId) : undefined,
        protection:
          selection.type === 'protection' ? state.getProtectionById(selectedId) : undefined,
        circuit: selection.type === 'circuit' ? state.getCircuitById(selectedId) : undefined,
        endpoint: selection.type === 'endpoint' ? state.getEndpointById(selectedId) : undefined,
        frame: selection.type === 'frame' ? state.getFrameById(selectedId) : undefined,
        placementEndpoint: placementEndpointId
          ? state.getEndpointById(placementEndpointId)
          : undefined,
        placementTrunkDevice: placementTrunkDeviceId
          ? state.getTrunkDeviceById(placementTrunkDeviceId)?.device
          : undefined,
        titleEndpoint:
          selection.type === 'endpoint' ? state.getEndpointById(selectedId) : undefined,
        titleTrunkDevice:
          selection.type === 'trunkDevice'
            ? state.getTrunkDeviceById(selectedId)?.device
            : undefined,
        sameJunctionPanelId: hasSameJunctionPanel ? selectedId : null,
        auxiliaryEnclosure:
          selection.type === 'auxiliaryEnclosure' && state.currentProject
            ? selectProjectAuxiliaryElectricalEnclosures(state.currentProject).find(
                (enclosure) => enclosure.id === selectedId
              )
            : undefined,
        updatePanel: state.updatePanel,
        updateProtection: state.updateProtection,
        updateCircuit: state.updateCircuit,
        updateEndpoint: state.updateEndpoint,
        updateProject: state.updateProject,
        updateInstallation: state.updateInstallation,
        updateEendraadNote: state.updateEendraadNote,
        updateSitplanNote: state.updateSitplanNote,
        updatePlanGraphicElement: state.updatePlanGraphicElement,
        updateFrame: state.updateFrame,
        getCircuitById: state.getCircuitById,
        getPanelById: state.getPanelById,
        updatePanelGrid: state.updatePanelGrid,
        updateAuxiliaryElectricalEnclosure: state.updateAuxiliaryElectricalEnclosure,
        getEndpointById: state.getEndpointById,
        getPlacementById: state.getPlacementById,
        getTrunkDeviceById: state.getTrunkDeviceById,
        getEendraadNoteById: state.getEendraadNoteById,
        getSitplanNoteById: state.getSitplanNoteById,
      }
    })
  )
  const { blurActiveFieldOnPanelLeave, cancelBlurOnPanelEnter } =
    usePropertiesPanelFieldBlurOnLeave()

  const stairOnlyPointSelection = React.useMemo(
    () => getStairOnlyPointSelection(selection),
    [selection]
  )
  const titleGraphicElement = React.useMemo(
    () =>
      selection.type === 'graphicElement'
        ? getSelectedGraphicElement(currentProject, selectedId)?.element
        : undefined,
    [currentProject, selectedId, selection.type]
  )
  const isDrawingWall = activePlanTool === 'drawWall' || activePlanTool === 'drawWallRect'
  const panelTitle = React.useMemo(
    () =>
      selection.type === 'junctionPanelTerminal'
        ? t('terminalStrip.component', 'Terminal strip')
        : isDrawingWall
        ? t('wallProperties.drawingTitle', 'New wall')
        : getPropertiesPanelTitle({
            selection,
            stairOnlyPointSelection,
            titleLookups: {
              endpoint: titleEndpoint,
              placementEndpoint,
              placementTrunkDevice,
              graphicElement: titleGraphicElement,
              trunkDevice: titleTrunkDevice,
              sameJunctionPanelId,
            },
            t,
          }),
    [
      selection,
      stairOnlyPointSelection,
      titleEndpoint,
      placementEndpoint,
      placementTrunkDevice,
      titleGraphicElement,
      titleTrunkDevice,
      sameJunctionPanelId,
      t,
      isDrawingWall,
    ]
  )

  let content: React.ReactNode
  const isSingleStairPointSelection = selection.type === 'stairPoint' && selection.ids.length >= 1
  const isStairOnlyPointSelection = stairOnlyPointSelection !== null
  const showProjectProperties =
    !selection.type ||
    selection.ids.length === 0 ||
    (isTemplate && selection.type === 'infoBlock' && selection.ids[0] === 'installer') ||
    (selection.type === 'infoBlock' &&
      selection.ids.length >= 1 &&
      (selection.ids[0] === 'address' || selection.ids[0] === 'ean'))

  if (isDrawingWall) {
    content = (
      <WallProperties
        masterWallThickness={20}
        drawingThickness={planWallDrawingThicknessCm}
        onDrawingThicknessCommit={setPlanWallDrawingThicknessCm}
      />
    )
  } else if (showProjectProperties) {
    content = (
      <ProjectProperties
        project={currentProject}
        updateProject={updateProject}
        updateInstallation={updateInstallation}
        readOnly={readOnly}
        isTemplate={isTemplate}
      />
    )
  } else if (
    selection.ids.length === 1 ||
    isSingleStairPointSelection ||
    isStairOnlyPointSelection
  ) {
    const id = (stairOnlyPointSelection?.stairId ?? selection.ids[0])!
    content = (
      <>
        {selection.type === 'infoBlock' && id === 'installer' && !isTemplate && (
          <InstallerProperties
            project={currentProject}
            updateProject={updateProject}
            readOnly={readOnly}
          />
        )}
        {selection.type === 'panel' && (
          <PanelProperties key={id} panelId={id} panel={panel} onUpdate={updatePanel} />
        )}
        {selection.type === 'protection' && (
          <ProtectionProperties
            key={id}
            protectionId={id}
            protection={protection}
            onUpdate={updateProtection}
            updateCircuit={updateCircuit}
            getCircuitById={getCircuitById}
          />
        )}
        {selection.type === 'circuit' && (
          <CircuitProperties key={id} circuitId={id} circuit={circuit} onUpdate={updateCircuit} />
        )}
        {selection.type === 'endpoint' && (
          <EndpointProperties
            key={id}
            endpointId={id}
            endpoint={endpoint}
            project={currentProject}
            onUpdate={updateEndpoint}
          />
        )}
        {selection.type === 'placement' &&
          (() => {
            const target = getSelectedPlacementTarget(id, {
              getEndpointById,
              getPlacementById,
              getTrunkDeviceById,
            })
            if (target.type === 'ground') return <GroundProperties key="ground-sitplan" />
            if (target.type === 'endpoint') {
              return (
                <EndpointProperties
                  key={target.endpointId}
                  endpointId={target.endpointId}
                  endpoint={target.endpoint}
                  project={currentProject}
                  onUpdate={updateEndpoint}
                />
              )
            }
            if (target.type === 'trunkDevice') {
              return (
                <TrunkDeviceProperties
                  key={`${target.deviceId}:${id}`}
                  deviceId={target.deviceId}
                  placementId={id}
                />
              )
            }
            return null
          })()}
        {selection.type === 'wire' && (
          <WirePropertiesWithLayout key={id} wireSegmentId={id} onUpdate={updateCircuit} />
        )}
        {selection.type === 'trunkDevice' && <TrunkDeviceProperties key={id} deviceId={id} />}
        {selection.type === 'junctionPanelTerminal' && selection.junctionPanelTerminalOwnerId ? (
          <JunctionPanelTerminalProperties
            ownerDeviceId={selection.junctionPanelTerminalOwnerId}
          />
        ) : null}
        {selection.type === 'ground' && <GroundProperties />}
        {selection.type === 'supply' && (
          <SupplyProperties readOnly={readOnly} panelId={selection.supplyPanelId} />
        )}
        {selection.type === 'busSection' && (
          <SupplyProperties
            readOnly={readOnly}
            panelId={selection.busSectionMetadata?.panelId}
            selectedBusSectionId={selection.busSectionMetadata?.busSectionId}
          />
        )}
        {selection.type === 'note' &&
          (() => {
            const { note, isEendraad } = getSelectedNote(id, {
              getEendraadNoteById,
              getSitplanNoteById,
            })
            return (
              <NoteProperties
                noteId={id}
                note={note}
                onUpdate={isEendraad ? updateEendraadNote : updateSitplanNote}
              />
            )
          })()}
        {selection.type === 'wall' &&
          (() => {
            const selected = getSelectedWall(currentProject, id)
            return selected ? (
              <WallProperties
                wall={selected.wall}
                masterWallThickness={selected.masterWallThickness}
              />
            ) : null
          })()}
        {selection.type === 'door' &&
          (() => {
            const selected = getSelectedOpening(currentProject, id, 'door')
            return selected ? (
              <OpeningProperties opening={selected.opening} kind="door" floor={selected.floor} />
            ) : null
          })()}
        {selection.type === 'window' &&
          (() => {
            const selected = getSelectedOpening(currentProject, id, 'window')
            return selected ? (
              <OpeningProperties opening={selected.opening} kind="window" floor={selected.floor} />
            ) : null
          })()}
        {(selection.type === 'stair' ||
          selection.type === 'stairPoint' ||
          isStairOnlyPointSelection) &&
          (() => {
            const selected = getSelectedStair({
              project: currentProject,
              stairId: id,
              selection,
              stairOnlyPointSelection,
            })
            return selected ? (
              <StairProperties
                stair={selected.stair}
                floor={selected.floor}
                selectedPointIndices={selected.selectedPointIndices}
              />
            ) : null
          })()}
        {selection.type === 'graphicElement' &&
          (() => {
            const selected = getSelectedGraphicElement(currentProject, id)
            return selected ? (
              <GraphicElementProperties
                element={selected.element}
                floor={selected.floor}
                readOnly={readOnly}
                onUpdate={updatePlanGraphicElement}
              />
            ) : null
          })()}
        {selection.type === 'frame' && (
          <FrameProperties frameId={id} frame={frame} onUpdate={updateFrame} />
        )}
        {selection.type === 'supplyPanel' &&
          (() => {
            const panel = getPanelById(id)
            return panel ? (
              <SupplyPanelProperties panelId={id} panel={panel} updatePanelGrid={updatePanelGrid} />
            ) : null
          })()}
        {selection.type === 'auxiliaryEnclosure' && auxiliaryEnclosure ? (
          <AuxiliaryEnclosureProperties
            enclosure={auxiliaryEnclosure}
            onUpdate={updateAuxiliaryElectricalEnclosure}
          />
        ) : null}
        {(selection.type === 'structuralNode' || selection.type === 'structuralConnection') &&
        selection.structuralMetadata ? (
          selection.wireAnchor && selection.structuralMetadata.wire?.cable ? (
            <CanonicalWireProperties
              anchor={selection.wireAnchor}
              cable={selection.structuralMetadata.wire.cable}
              domain={selection.structuralMetadata.wire.domain}
              defaults={{ defaultWireLabelVisible: !selection.wireAnchor.includes(':into:open-end:') }}
            />
          ) : <StructuralReadOnlyProperties metadata={selection.structuralMetadata} />
        ) : null}
      </>
    )
  } else {
    // Multi-selection
    content = sameJunctionPanelId ? (
      <TrunkDeviceProperties deviceId={sameJunctionPanelId} />
    ) : (
      <MultiSelectionPropertiesEditor selection={selection} />
    )
  }

  return (
    <PropertiesPanelFrame
      title={panelTitle}
      panelVisible={panelVisible}
      embedded={embedded}
      panelWidth={panelWidth}
      readOnly={readOnly}
      allowReadOnlyInteraction={showProjectProperties}
      showSensitiveInfoNotice={showSensitiveInfoNotice}
      onToggle={() => togglePanel('properties')}
      onMouseEnter={cancelBlurOnPanelEnter}
      onMouseLeave={blurActiveFieldOnPanelLeave}
    >
      {content}
    </PropertiesPanelFrame>
  )
}
