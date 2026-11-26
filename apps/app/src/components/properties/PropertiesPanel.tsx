import {
  updateProjectProperties,
  updateOneWireNoteProperties,
  updateSituationPlanNoteProperties,
  updateGraphicElementProperties,
  updateFrameProperties,
} from '@/handlers/properties/editGeneralProperties'
import { CanonicalWireProperties } from './editors/CanonicalWireProperties'
import React from 'react'
import {
  beginPropertiesFieldEdit,
  endPropertiesFieldEdit,
  updateCircuitProperties,
  updateEndpointProperties,
  updateProtectionProperties,
  updatePanelProperties,
  updateInstallationProperties,
  updatePanelGridProperties,
  updateAuxiliaryEnclosureProperties,
} from '@/handlers/properties/editProperties'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useUIStore, type UIState } from '@/stores/uiStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { WallProperties } from './WallProperties'
import { OpeningProperties } from './OpeningProperties'
import { StairProperties } from './StairProperties'
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
import { SupplyTapModeToggle } from './shared/SupplyTapModeToggle'
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
/* @vision-scan-strip-start */
import { OneWireReferenceProperties } from './OneWireReferenceProperties'
import { isElectricalVisionScanEnabled } from '@/lib/vision/availability'
/* @vision-scan-strip-end */
/* @project-documents-strip-start */
import LinkedDocumentsSection from '@/components/documents/LinkedDocumentsSection'
import DocumentProperties from '@/components/documents/DocumentProperties'
import DocumentTitleBadges from '@/components/documents/DocumentTitleBadges'
import { isProjectDocumentsEnabled } from '@/lib/documents/availability'
/* @project-documents-strip-end */
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
  React.useEffect(() => () => endPropertiesFieldEdit(), [])
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
    getCircuitById,
    getPanelById,
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
        getCircuitById: state.getCircuitById,
        getPanelById: state.getPanelById,
        getEndpointById: state.getEndpointById,
        getPlacementById: state.getPlacementById,
        getTrunkDeviceById: state.getTrunkDeviceById,
        getEendraadNoteById: state.getEendraadNoteById,
        getSitplanNoteById: state.getSitplanNoteById,
      }
    })
  )
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
        updateProject={updateProjectProperties}
        updateInstallation={updateInstallationProperties}
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
            updateProject={updateProjectProperties}
            readOnly={readOnly}
          />
        )}
        {selection.type === 'panel' && (
          <PanelProperties key={id} panelId={id} panel={panel} onUpdate={updatePanelProperties} />
        )}
        {(selection.type === 'protection' ||
          selection.type === 'circuit' ||
          selection.type === 'trunkDevice') && (
          <SupplyTapModeToggle key={`tap-${id}`} entityId={id} readOnly={readOnly} />
        )}
        {selection.type === 'protection' && (
          <ProtectionProperties
            key={id}
            protectionId={id}
            protection={protection}
            onUpdate={updateProtectionProperties}
            updateCircuit={updateCircuitProperties}
            getCircuitById={getCircuitById}
          />
        )}
        {selection.type === 'circuit' && (
          <CircuitProperties
            key={id}
            circuitId={id}
            circuit={circuit}
            onUpdate={updateCircuitProperties}
          />
        )}
        {selection.type === 'endpoint' && (
          <EndpointProperties
            key={id}
            endpointId={id}
            endpoint={endpoint}
            project={currentProject}
            onUpdate={updateEndpointProperties}
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
                  onUpdate={updateEndpointProperties}
                />
              )
            }
            if (target.type === 'trunkDevice') {
              return (
                <TrunkDeviceProperties
                  key={`${target.deviceId}:${id}`}
                  deviceId={target.deviceId}
                  placementId={id}
                  readOnly={readOnly}
                />
              )
            }
            if (target.type === 'auxiliaryEnclosure') {
              const enclosure = currentProject
                ? selectProjectAuxiliaryElectricalEnclosures(currentProject).find(
                    (candidate) => candidate.id === target.enclosureId
                  )
                : undefined
              return enclosure ? (
                <AuxiliaryEnclosureProperties
                  key={enclosure.id}
                  enclosure={enclosure}
                  onUpdate={updateAuxiliaryEnclosureProperties}
                />
              ) : null
            }
            return null
          })()}
        {selection.type === 'wire' && (
          <WirePropertiesWithLayout
            key={id}
            wireSegmentId={id}
            onUpdate={updateCircuitProperties}
          />
        )}
        {selection.type === 'trunkDevice' && (
          <TrunkDeviceProperties key={id} deviceId={id} readOnly={readOnly} />
        )}
        {selection.type === 'junctionPanelTerminal' && selection.junctionPanelTerminalOwnerId ? (
          <JunctionPanelTerminalProperties ownerDeviceId={selection.junctionPanelTerminalOwnerId} />
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
                onUpdate={
                  isEendraad ? updateOneWireNoteProperties : updateSituationPlanNoteProperties
                }
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
                onUpdate={updateGraphicElementProperties}
              />
            ) : null
          })()}
        {selection.type === 'frame' && (
          <FrameProperties frameId={id} frame={frame} onUpdate={updateFrameProperties} />
        )}
        {selection.type === 'supplyPanel' &&
          (() => {
            const panel = getPanelById(id)
            return panel ? (
              <SupplyPanelProperties
                panelId={id}
                panel={panel}
                updatePanelGrid={updatePanelGridProperties}
              />
            ) : null
          })()}
        {selection.type === 'auxiliaryEnclosure' && auxiliaryEnclosure ? (
          <AuxiliaryEnclosureProperties
            enclosure={auxiliaryEnclosure}
            onUpdate={updateAuxiliaryEnclosureProperties}
          />
        ) : null}
        {(selection.type === 'structuralNode' || selection.type === 'structuralConnection') &&
        selection.structuralMetadata ? (
          selection.wireAnchor && selection.structuralMetadata.wire?.cable ? (
            <CanonicalWireProperties
              anchor={selection.wireAnchor}
              cable={selection.structuralMetadata.wire.cable}
              domain={selection.structuralMetadata.wire.domain}
              defaults={{
                defaultWireLabelVisible: !selection.wireAnchor.includes(':into:open-end:'),
              }}
            />
          ) : (
            <StructuralReadOnlyProperties metadata={selection.structuralMetadata} />
          )
        ) : null}
        {/* @vision-scan-strip-start */}
        {isElectricalVisionScanEnabled() && selection.type === 'oneWireReference' && (
          <OneWireReferenceProperties key={id} itemId={id} readOnly={readOnly} />
        )}
        {/* @vision-scan-strip-end */}
        {/* @project-documents-strip-start */}
        {isProjectDocumentsEnabled() && selection.type === 'document' && (
          <DocumentProperties key={id} documentId={id} />
        )}
        {isProjectDocumentsEnabled() && (
          <LinkedDocumentsSection
            selectionType={selection.type}
            selectedId={id}
            elementLabel={panelTitle}
          />
        )}
        {/* @project-documents-strip-end */}
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

  let titleAccessory: React.ReactNode = null
  /* @project-documents-strip-start */
  if (isProjectDocumentsEnabled() && selection.type === 'document' && selectedId) {
    titleAccessory = <DocumentTitleBadges documentId={selectedId} />
  }
  /* @project-documents-strip-end */

  return (
    <PropertiesPanelFrame
      title={panelTitle}
      titleAccessory={titleAccessory}
      panelVisible={panelVisible}
      embedded={embedded}
      panelWidth={panelWidth}
      readOnly={readOnly}
      allowReadOnlyInteraction={showProjectProperties}
      showSensitiveInfoNotice={showSensitiveInfoNotice}
      onToggle={() => togglePanel('properties')}
    >
      <div
        onFocusCapture={(event) => beginPropertiesFieldEdit(event.target as HTMLElement)}
        onBlur={() => endPropertiesFieldEdit()}
      >
        {content}
      </div>
    </PropertiesPanelFrame>
  )
}
