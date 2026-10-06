import { logger } from '@/lib/logger'
import {
  useRef,
  useCallback,
  useMemo,
  useState,
  useEffect,
  type MutableRefObject,
  type RefObject,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Printer, Tag } from 'lucide-react'
import { Group, Rect, Line, Text, Image as KonvaImage } from 'react-konva'
import Konva from 'konva'
import BaseCanvas, { type BaseCanvasHandle } from '../BaseCanvas'
import ViewNavigationToolbar from '../ViewNavigationToolbar'
import CanvasFloatingControlRail from '../CanvasFloatingControlRail'
import { FloatingControl } from '../FloatingControls'
import { openLabelStripExportDialog } from '@/lib/ui/labelStripExportDialog'

import { AutoArrangeIcon } from '@/components/icons/UiIcons'
import { SupplySymbol } from '../eendraad/SupplySymbol'
import { useUIStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useProjectStore } from '@/stores/projectStore'
import { useDialogStore } from '@/stores/dialogStore'
import { useThemeColors } from '@/lib/theme/hooks'
import { useCanvasFontFamily } from '@/editions/community/communityHooks'
import { useTouchPrimaryDevice } from '@/hooks/useTouchPrimaryDevice'
import { ZOOM_100 } from '@/constants/canvasConstants'
import {
  panelGridModuleRefKey,
  resolveModuleWidthCols,
  CELL_W,
  canResizeModulePlacement,
  CELL_H,
  ROW_GAP,
  ROW_STRIDE,
  TERMINAL_STRIP_RAIL_H,
  getTerminalStripTopOffset,
  getPanelMainHorizontalRoutingLanes,
  snapTerminalStripPlacementCol,
  snapToGrid,
  type ModulePlacement,
} from './panelGridLayout'
import { getModuleDisplayInfo } from './getModuleDisplayInfo'
import ModuleBox, { type ModuleTooltipData } from './ModuleBox'
import { PanelLabelModeOverlay, type PanelLabelEntityUpdates } from './PanelLabelModeOverlay'
import RelationWires, { type PanelHierarchyRoute } from './RelationWires'
import type { PanelWirePathRegion, WirePathSegment } from './panelWireRouter'
import { RewireTool } from './RewireTool'
import { RewirePreviewWire } from './RewirePreviewWire'
import { findPanelLibraryDropSlot } from '@/lib/panel/panelLibraryDropSlot'
import {
  buildDirectPanelFeederConnectors,
  buildFullPanelScene,
  PANEL_SCENE_FRAME_MARGIN,
  PANEL_SCENE_SHARED_SUPPLY_ID,
  getConverterBackupFeedMarkerGeometry,
  type BuiltPanelScene,
  type PanelSceneSurface,
} from '@/lib/panel/panelScene'
import { applyPanelSceneFilter, type PanelSceneFilter } from '@/lib/panel/applyPanelSceneFilter'
import { generateId } from '@/utils'
import {
  applyLibraryPresetToEndpoint,
  getEndpointTypeFromSymbol,
  getSymbolKeyFromSymbol,
} from '@/utils/symbolMapping'
import { findTrunkDeviceInProject, getNextAvailableCircuitCode } from '@/utils/project'
import { addToSelection } from '@/utils/selection'
import {
  getProjectElectricalPanels,
  getEditableProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import {
  getPanelRewireOperation,
  isRootSupplyTailOrSharedSupplyTailRef,
  validatePanelRewireOperation,
} from '@/lib/panel/panelRewire'
import { isTerminalStripDevice, resolveTerminalStripModule } from '@/lib/eendraad/projectElectricalDomain'
import {
  createDefaultAcCircuitCable,
  DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
} from '@/lib/wires/circuitWireDefaults'
import { getVoltagePolesConfig, getProtectionCreationProps } from '@/lib/protectionDefaults'
import {
  PROTECTION_SYMBOL_IDS,
  protectionTypeFromSymbolId,
  resolveInitialProtectionBusLabel,
  ROTATING_SWITCH_SYMBOL_ID,
} from '@/lib/protectionKind'
import type {
  PanelGridSlot,
  PanelGridModuleRef,
  ProtectionDevice,
  Circuit,
  Endpoint,
  TrunkDevice,
  Panel,
} from '@/types/schema'
import type { ProjectState } from '@/stores/projectStore'
import type { CanvasDropMeta, Point, Selection as CanvasSelection } from '@/types/ui'
import type { ContextMenuItem } from '@/components/common/ContextMenu'
import { getSymbolById, type SymbolMetadata } from '@/lib/symbols'
import { loadProcessedSymbol } from '@/lib/symbolImage'
import {
  CONVERTER_ARTWORK_PATHS,
  getConverterArtworkLayout,
  getConverterCornerPosition,
  getConverterDomainCorner,
  isDirectionalConverterSymbol,
  SUPPLY_ASSEMBLY_CONNECTION_DOMAINS,
} from '@/lib/converterArtwork'
import type { EditorCapabilities } from '@/lib/viewerMode'
import { polesFromConfig } from '@/constants/poleConfig'
import { clamp, rectContainsRect } from '@/lib/geometry'
import { isKeyboardTypingTarget } from '@/lib/ui/keyboardTypingTarget'
import { upsertPanelGridSlotPosition } from '@/lib/panel/panelSupplySlots'
import {
  MIN_PANEL_GRID_MODULE_WIDTH,
  normalizePanelModuleMeasure,
} from '@/lib/panel/panelGridUnits'
import { collectCircuits, getLastAssignableCircuit } from '@/lib/panel/panelTree'
import {
  isAuxiliaryMountableSupplyDevice,
  planAuxiliarySupplyEnclosureGrid,
} from '@/lib/panel/auxiliarySupplyEnclosures'
import { resolvePanelWireSelectionFocus } from '@/lib/panel/panelWireSelection'
import { duplicateEndpointOnCircuit } from '@/lib/eendraad/duplicateEndpoint'
import {
  canDropModularSocketOnPanel,
  findPreferredModularSocketCircuit,
  findPreferredModularSocketProtection,
  getModularSocketCount,
  isModularSocket,
  isModularSocketLibraryId,
  MODULAR_SOCKET_SINGLE_MODULE_WIDTH,
  snapModularSocketModuleWidthWithin,
  socketCountForModularWidth,
  withModularSocketProps,
} from '@/lib/socket/modularSocket'

type Project = NonNullable<ProjectState['currentProject']>

interface PanelFrameResizePreview {
  panelId: string
  axis: 'rows' | 'columns'
  value: number
  x: number
  y: number
  width: number
  height: number
}

function ConverterBackupFeedMarker({
  surface,
  debugMode,
}: {
  surface: PanelSceneSurface
  debugMode: boolean
}) {
  const colors = useThemeColors()
  const themeMode = useSettingsStore((state) => state.theme.mode)
  const getTrunkDeviceById = useProjectStore((state: ProjectState) => state.getTrunkDeviceById)
  const converterId = surface.converterBackupSourceFeed?.converterId
  const converter = converterId ? getTrunkDeviceById(converterId)?.device : undefined
  const symbolPath = getSymbolById(converter?.symbol ?? 'inverter')?.svgPath
  const [symbolImage, setSymbolImage] = useState<HTMLImageElement | null>(null)
  const [baseImage, setBaseImage] = useState<HTMLImageElement | null>(null)
  const [diagonalImage, setDiagonalImage] = useState<HTMLImageElement | null>(null)
  const [acImage, setAcImage] = useState<HTMLImageElement | null>(null)
  const [dcImage, setDcImage] = useState<HTMLImageElement | null>(null)
  const geometry = getConverterBackupFeedMarkerGeometry(surface)
  const isDirectional = isDirectionalConverterSymbol(converter?.symbol)

  useEffect(() => {
    if (!symbolPath) {
      setSymbolImage(null)
      return
    }
    loadProcessedSymbol(symbolPath, themeMode === 'dark')
      .then(setSymbolImage)
      .catch(() => setSymbolImage(null))
  }, [symbolPath, themeMode])

  useEffect(() => {
    if (!isDirectional) {
      setBaseImage(null)
      setDiagonalImage(null)
      setAcImage(null)
      setDcImage(null)
      return
    }
    loadProcessedSymbol(CONVERTER_ARTWORK_PATHS.base, themeMode === 'dark')
      .then(setBaseImage)
      .catch(() => setBaseImage(null))
    loadProcessedSymbol(CONVERTER_ARTWORK_PATHS.diagonal, themeMode === 'dark')
      .then(setDiagonalImage)
      .catch(() => setDiagonalImage(null))
    loadProcessedSymbol(CONVERTER_ARTWORK_PATHS.AC, themeMode === 'dark')
      .then(setAcImage)
      .catch(() => setAcImage(null))
    loadProcessedSymbol(CONVERTER_ARTWORK_PATHS.DC, themeMode === 'dark')
      .then(setDcImage)
      .catch(() => setDcImage(null))
  }, [isDirectional, themeMode])

  if (!geometry) return null
  const half = geometry.symbolSize / 2
  return (
    <Group name={`virtual-converter-feed-${surface.panel?.id ?? surface.id}`} listening={false}>
      {geometry.wirePaths.map((points, index) => (
        <Line
          key={`virtual-converter-feed-wire-${index}`}
          points={points}
          stroke={colors.supplyWire}
          strokeWidth={1.5}
          lineCap="square"
          lineJoin="round"
          listening={false}
        />
      ))}
      {isDirectional && baseImage && diagonalImage ? (
        (() => {
          const size = geometry.symbolSize
          const iconSize = size * 0.27
          const layout = getConverterArtworkLayout(
            converter?.symbol === 'inverter' ? 'DC' : 'AC',
            converter?.symbol === 'inverter' ? 'AC' : 'DC',
            SUPPLY_ASSEMBLY_CONNECTION_DOMAINS
          )
          const domainPosition = (domain: 'AC' | 'DC') => {
            const corner = getConverterDomainCorner(layout, domain)
            if (!corner) return undefined
            const point = getConverterCornerPosition(corner, size, size, size * 0.12, iconSize)
            return { x: size / 2 + point.x, y: size / 2 + point.y }
          }
          const acPosition = domainPosition('AC')
          const dcPosition = domainPosition('DC')
          return (
            <>
              <KonvaImage
                image={baseImage}
                x={geometry.sourceX}
                y={geometry.sourceY}
                width={size}
                height={size}
                offsetX={half}
                offsetY={half}
                listening={false}
              />
              <KonvaImage
                image={diagonalImage}
                x={geometry.sourceX}
                y={geometry.sourceY}
                width={size}
                height={size}
                offsetX={half}
                offsetY={half}
                scaleX={layout.diagonal === 'top-left-to-bottom-right' ? -1 : 1}
                listening={false}
              />
              {acImage && acPosition && (
                <KonvaImage
                  image={acImage}
                  x={geometry.sourceX + acPosition.x - iconSize / 2}
                  y={geometry.sourceY + acPosition.y - iconSize / 2}
                  width={iconSize}
                  height={iconSize}
                  listening={false}
                />
              )}
              {dcImage && dcPosition && (
                <KonvaImage
                  image={dcImage}
                  x={geometry.sourceX + dcPosition.x - iconSize / 2}
                  y={geometry.sourceY + dcPosition.y - iconSize / 2}
                  width={iconSize}
                  height={iconSize}
                  listening={false}
                />
              )}
            </>
          )
        })()
      ) : symbolImage ? (
        <KonvaImage
          image={symbolImage}
          x={geometry.sourceX - half}
          y={geometry.sourceY - half}
          width={geometry.symbolSize}
          height={geometry.symbolSize}
          listening={false}
        />
      ) : (
        <>
          <Rect
            x={geometry.sourceX - half}
            y={geometry.sourceY - half}
            width={geometry.symbolSize}
            height={geometry.symbolSize}
            stroke={colors.supplyWire}
            strokeWidth={1.5}
            listening={false}
          />
          <Line
            points={[
              geometry.sourceX - half,
              geometry.sourceY + half,
              geometry.sourceX + half,
              geometry.sourceY - half,
            ]}
            stroke={colors.supplyWire}
            strokeWidth={1.5}
            listening={false}
          />
        </>
      )}
      {debugMode && (
        <Rect
          x={geometry.sourceX - half - 4}
          y={geometry.sourceY - half - 4}
          width={geometry.symbolSize + 8}
          height={geometry.symbolSize + 8}
          stroke="#06b6d4"
          strokeWidth={1}
          dash={[4, 3]}
          listening={false}
        />
      )}
    </Group>
  )
}

function findPanelRecursive(panels: Panel[], id: string): Panel | undefined {
  for (const panel of panels) {
    if (panel.id === id) return panel
    const nested = findPanelRecursive(panel.subPanels ?? [], id)
    if (nested) return nested
  }
  return undefined
}

function moduleRefMatchesSelection(ref: PanelGridModuleRef, selection: CanvasSelection): boolean {
  if (!selection.type || selection.ids.length === 0) return false
  if (selection.type === 'protection')
    return ref.kind === 'protection' && selection.ids.includes(ref.id)
  if (selection.type === 'trunkDevice') {
    return ref.kind === 'trunkDevice' && selection.ids.includes(ref.id)
  }
  if (selection.type === 'endpoint') {
    return ref.kind === 'domotica' && selection.ids.includes(ref.endpointId)
  }
  return false
}

function placementMatchesSelection(
  placement: Pick<ModulePlacement, 'ref' | 'terminalStripMemberRefs'>,
  selection: CanvasSelection
): boolean {
  return (
    moduleRefMatchesSelection(placement.ref, selection) ||
    (placement.terminalStripMemberRefs?.some((ref) => moduleRefMatchesSelection(ref, selection)) ??
      false)
  )
}

function getModuleSelectionBounds(
  placements: Array<{
    x: number
    y: number
    width: number
    height: number
    ref: PanelGridModuleRef
    terminalStripMemberRefs?: PanelGridModuleRef[]
  }>,
  selection: CanvasSelection,
  padding = 0
): { x: number; y: number; width: number; height: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let found = false

  for (const placement of placements) {
    if (!placementMatchesSelection(placement, selection)) continue
    minX = Math.min(minX, placement.x)
    minY = Math.min(minY, placement.y)
    maxX = Math.max(maxX, placement.x + placement.width)
    maxY = Math.max(maxY, placement.y + placement.height)
    found = true
  }

  if (
    !found ||
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    return null
  }

  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  }
}

function applyPanelRewireOperation({
  panel,
  currentProject,
  origin,
  target,
  rewireModules,
  placeSupplyModuleAfterInsert,
  updatePanelGridSlots,
  updateSupplyPanelSlots,
}: {
  panel: Panel | null
  currentProject: Project | null
  origin: PanelGridModuleRef
  target: PanelGridModuleRef | null
  rewireModules: (originCircuitId: string, targetCircuitId: string) => void
  placeSupplyModuleAfterInsert: (
    targetPanel: Panel,
    targetProject: Project,
    moduleRef: PanelGridModuleRef,
    preferredRow?: number,
    preferredCol?: number
  ) => { mainSlots: PanelGridSlot[]; supplySlots: PanelGridSlot[] }
  updatePanelGridSlots: (panelId: string, slots: PanelGridSlot[]) => void
  updateSupplyPanelSlots: (panelId: string, slots: PanelGridSlot[]) => void
}): boolean {
  if (!panel || !currentProject) return false
  const operation = getPanelRewireOperation(panel, currentProject, origin, target)
  if (!operation) return false

  if (operation.kind === 'promotePanelToRootSupply') {
    useProjectStore.getState().movePanelSupply(operation.panelId, { type: 'supply' })
    useUIStore.getState().setSelection({ type: 'panel', ids: [operation.panelId] })
    return true
  }

  if (operation.kind === 'moveSharedSupplyDevice') {
    useProjectStore.getState().moveSupplyTrunkDevice(operation.targetSupplyId, operation.direction)
    return true
  }

  if (
    operation.kind === 'promoteProtectionToSharedSupply' ||
    operation.kind === 'promoteProtectionToRootSupply'
  ) {
    const deviceId = generateId()
    const trunkDevice: TrunkDevice = { id: deviceId, ...operation.trunkDevice }
    useProjectStore.getState().addSupplyTrunkDevice(trunkDevice, operation.insertIndex, {
      panelId: panel.id,
      feedScope: operation.kind === 'promoteProtectionToRootSupply' ? 'root' : 'shared',
    })
    const nextProject = useProjectStore.getState().currentProject
    const nextPanel =
      nextProject != null
        ? findPanelRecursive(getProjectElectricalPanels(nextProject), panel.id)
        : undefined
    if (nextProject && nextPanel) {
      const { mainSlots, supplySlots } = placeSupplyModuleAfterInsert(
        nextPanel,
        nextProject,
        { kind: 'trunkDevice', id: deviceId, scope: 'supply' },
        undefined,
        undefined
      )
      updatePanelGridSlots(panel.id, mainSlots)
      updateSupplyPanelSlots(panel.id, supplySlots)
    }
    useProjectStore.setState((state: ProjectState) => {
      if (!state.currentProject) return
      const targetPanel = findPanelRecursive(
        getEditableProjectElectricalPanels(state.currentProject),
        panel.id
      )
      if (!targetPanel) return
      let circuitRemoved = false
      const findAndRemove = (candidate: Panel): boolean => {
        const prot = candidate.protections.find((pr) => pr.id === operation.protectionId)
        if (prot?.circuits) {
          const circuitIndex = prot.circuits.findIndex((c) => c.id === operation.circuit.id)
          if (circuitIndex !== -1) {
            prot.circuits.splice(circuitIndex, 1)
            circuitRemoved = true
            if (prot.circuits.length === 0) {
              const protIndex = candidate.protections.findIndex(
                (pr) => pr.id === operation.protectionId
              )
              if (protIndex !== -1) candidate.protections.splice(protIndex, 1)
            }
            return true
          }
        }
        for (const subPanel of candidate.subPanels) if (findAndRemove(subPanel)) return true
        return false
      }
      for (const rootPanel of getEditableProjectElectricalPanels(state.currentProject))
        if (findAndRemove(rootPanel)) break
      if (circuitRemoved) {
        if (!targetPanel.circuits) targetPanel.circuits = []
        targetPanel.circuits.push(operation.circuit)
        state.isDirty = true
      }
    })
    return true
  }

  if (operation.kind === 'detachCircuitFromSupplyParent') {
    useProjectStore
      .getState()
      .updateCircuit(operation.parentCircuitId, { subCircuitIds: operation.subCircuitIds })
    return true
  }

  rewireModules(operation.originCircuitId, operation.targetCircuitId)
  return true
}

function getLibraryDropWidthCols(symbol: SymbolMetadata, project: Project | null): number {
  if (isModularSocketLibraryId(symbol.id)) return MODULAR_SOCKET_SINGLE_MODULE_WIDTH
  if (symbol.id === 'energy_meter')
    return Math.max(1, polesFromConfig(getVoltagePolesConfig(project)))
  if (symbol.id === ROTATING_SWITCH_SYMBOL_ID) return 1
  const protectionType = protectionTypeFromSymbolId(symbol.id)
  const defaults = getProtectionCreationProps(project, protectionType)
  const poles =
    defaults.poles ??
    (defaults.polesConfig ? polesFromConfig(defaults.polesConfig) : undefined) ??
    1
  return Math.max(1, poles)
}

const PANEL_FRAME_MARGIN = PANEL_SCENE_FRAME_MARGIN

export type PanelOption = {
  id: string
  name: string
  panel: Panel
  depth: number
  isRoot: boolean
}

const PANEL_RELATION_DEBUG_WIRE_LEGEND = [
  { label: 'Available pathways', color: '#06b6d4' },
  { label: 'Internal routing (WINT)', color: '#22c55e' },
  { label: 'Shared supply -> main protections (WSPM)', color: '#a855f7' },
  { label: 'Shared supply -> unique supply device (WSUD)', color: '#0ea5e9' },
  { label: 'Unique supply -> main protections (WUMP)', color: '#f97316' },
  { label: 'Panel bus feed -> protections (WPBP)', color: '#f43f5e' },
  { label: 'Main protection -> secondary panel feed (WSPF)', color: '#2563eb' },
] as const

const PANEL_RELATION_DEBUG_MODULE_LEGEND = [
  { label: 'Protection module (MPRO)', color: '#f43f5e' },
  { label: 'Secondary-panel feeder protection (MSPF)', color: '#2563eb' },
  { label: 'Shared supply trunk device (MSUP)', color: '#a855f7' },
  { label: 'Unique supply wire device (MUNQ)', color: '#f97316' },
  { label: 'Circuit trunk / bus feed device (MCIR)', color: '#06b6d4' },
  { label: 'Domotica module (MDOM)', color: '#8b5cf6' },
] as const

/** Parent-side protection that declares `subPanelId` for this secondary panel. */
function findProtectionFeedingSubPanel(
  project: Project,
  subPanelId: string
): { panel: Panel; protection: ProtectionDevice } | null {
  const scan = (panels: Panel[]): { panel: Panel; protection: ProtectionDevice } | null => {
    for (const pan of panels) {
      for (const pr of pan.protections ?? []) {
        if (pr.subPanelId === subPanelId) return { panel: pan, protection: pr }
      }
      const nested = scan(pan.subPanels ?? [])
      if (nested) return nested
    }
    return null
  }
  return scan(getProjectElectricalPanels(project))
}

function findCircuitFeedingSubPanel(pr: ProtectionDevice, subPanelId: string): Circuit | null {
  for (const c of pr.circuits ?? []) {
    if (c.endpoints?.some((e) => e.symbol === 'panel_distribution' && e.panelId === subPanelId))
      return c
  }
  return pr.circuits?.[0] ?? null
}
void findProtectionFeedingSubPanel
void findCircuitFeedingSubPanel

type HierarchySurface = PanelSceneSurface

const HIERARCHY_PANEL_FRAME_HIT_MARGIN = 18
const HIERARCHY_PANEL_FRAME_TITLE_HIT_HEIGHT = 40
const PANEL_FRAME_DRAG_THRESHOLD = 6

function beginDeferredPanelFrameSelectionRect(options: {
  event: Konva.KonvaEventObject<MouseEvent>
  canvasRef: RefObject<BaseCanvasHandle | null>
  leftDragPansCanvas: boolean
  pointerDownRef: MutableRefObject<{ x: number; y: number } | null>
  pendingCleanupRef: MutableRefObject<(() => void) | null>
}): void {
  const { event, canvasRef, leftDragPansCanvas, pointerDownRef, pendingCleanupRef } = options

  if (event.evt.button !== 0) return

  const pointer = event.target.getStage()?.getPointerPosition()
  if (!pointer) return

  pointerDownRef.current = {
    x: event.evt.clientX,
    y: event.evt.clientY,
  }

  if (pendingCleanupRef.current) {
    pendingCleanupRef.current()
    pendingCleanupRef.current = null
  }

  const clientX = event.evt.clientX
  const clientY = event.evt.clientY

  const cleanup = () => {
    window.removeEventListener('mousemove', handleWindowMouseMove, true)
    window.removeEventListener('mouseup', handleWindowMouseUp, true)
    if (pendingCleanupRef.current === cleanup) {
      pendingCleanupRef.current = null
    }
  }

  const handleWindowMouseMove = (evt: MouseEvent) => {
    if (!pendingCleanupRef.current) return
    const dx = evt.clientX - clientX
    const dy = evt.clientY - clientY
    if (Math.hypot(dx, dy) <= PANEL_FRAME_DRAG_THRESHOLD) return
    if (leftDragPansCanvas && !event.evt.shiftKey) {
      canvasRef.current?.startMousePan(clientX, clientY)
    } else {
      canvasRef.current?.startSelectionRect(pointer)
    }
    cleanup()
  }

  const handleWindowMouseUp = () => {
    cleanup()
  }

  pendingCleanupRef.current = cleanup
  window.addEventListener('mousemove', handleWindowMouseMove, true)
  window.addEventListener('mouseup', handleWindowMouseUp, true)

  event.cancelBubble = true
}

function hierarchyRouteForHierarchySurface(
  surface: PanelSceneSurface,
  sharedSurface: PanelSceneSurface | undefined,
  side: 'left' | 'right',
  panelInset: number
): PanelHierarchyRoute {
  const panelTopY = surface.y + surface.mainPanelY
  const panelBottomY = panelTopY + surface.panelFrameHeight
  const sharedCorridorY = (() => {
    if (!sharedSurface) return panelBottomY + 8
    const sharedTopY = sharedSurface.y
    const sharedBottomY = sharedSurface.y + sharedSurface.height
    return sharedBottomY <= panelTopY
      ? (sharedBottomY + panelTopY) / 2
      : (panelBottomY + sharedTopY) / 2
  })()
  return {
    side,
    corridorY: sharedCorridorY,
    panelLeftX: surface.x,
    panelRightX: surface.x + surface.width,
    panelTopY,
    panelBottomY,
    feedFromTop: surface.feedFromTop,
    panelInset,
  }
}

function buildPanelWirePathRegions(surfaces: PanelSceneSurface[]): PanelWirePathRegion[] {
  const regions: PanelWirePathRegion[] = []
  const addRegion = (
    id: string,
    surface: PanelSceneSurface,
    contentTop: number,
    rows: number,
    routingPanel?: Panel
  ) => {
    const rowCount = Math.max(1, rows)
    regions.push({
      id,
      surfaceId: surface.id,
      left: surface.x + PANEL_FRAME_MARGIN / 2,
      right: surface.x + surface.width - PANEL_FRAME_MARGIN / 2,
      horizontalYs: routingPanel
        ? getPanelMainHorizontalRoutingLanes(routingPanel, contentTop, rowCount)
        : Array.from({ length: rowCount + 1 }, (_, gapIndex) => {
            const rowGapCenterY = contentTop - ROW_GAP / 2 + gapIndex * ROW_STRIDE
            if (gapIndex === 0) return rowGapCenterY - ROW_GAP / 2
            if (gapIndex === rowCount) return rowGapCenterY + ROW_GAP / 2
            return rowGapCenterY
          }),
    })
  }

  for (const surface of surfaces) {
    if (surface.kind === 'shared_supply') {
      addRegion(
        `${surface.id}:shared`,
        surface,
        surface.y + PANEL_FRAME_MARGIN,
        Math.max(1, surface.rows)
      )
      continue
    }
    if (surface.kind === 'auxiliary' || surface.kind === 'junction_panel') {
      const routingPanel = surface.panel ??
        (surface.enclosure
          ? ({ gridView: surface.enclosure.gridView } as Panel)
          : surface.junctionPanelGridView
            ? ({ gridView: surface.junctionPanelGridView } as Panel)
            : undefined)
      addRegion(
        `${surface.id}:enclosure`,
        surface,
        surface.y + PANEL_FRAME_MARGIN + getTerminalStripTopOffset(routingPanel),
        surface.rows,
        routingPanel
      )
      continue
    }
    const mainContentTop =
      surface.y + surface.mainPanelY + PANEL_FRAME_MARGIN + getTerminalStripTopOffset(surface.panel)
    const mainRegion = {
      id: `${surface.id}:main`,
      surfaceId: surface.id,
      left: surface.x + PANEL_FRAME_MARGIN / 2,
      right: surface.x + surface.width - PANEL_FRAME_MARGIN / 2,
      horizontalYs: getPanelMainHorizontalRoutingLanes(surface.panel, mainContentTop, surface.rows),
    }
    regions.push(mainRegion)
    if (surface.supplyPanelVisible) {
      addRegion(
        `${surface.id}:supply`,
        surface,
        surface.y + surface.supplyPanelY + PANEL_FRAME_MARGIN,
        surface.supplyRows
      )
    }
  }
  return regions
}

function buildPanelWirePathLinks(connectors: BuiltPanelScene['connectors']): WirePathSegment[] {
  return connectors.flatMap((connector) => {
    const segments: WirePathSegment[] = []
    for (let index = 0; index <= connector.points.length - 4; index += 2) {
      segments.push({
        from: { x: connector.points[index]!, y: connector.points[index + 1]! },
        to: { x: connector.points[index + 2]!, y: connector.points[index + 3]! },
        fromPortal: index === 0,
        toPortal: index === connector.points.length - 4,
        fromSurfaceId: index === 0 ? connector.sourceSurfaceId : undefined,
        toSurfaceId: index === connector.points.length - 4 ? connector.targetSurfaceId : undefined,
      })
    }
    return segments
  })
}

interface HierarchyDragPreview {
  surfaceId: string
  panelId?: string
  x: number
  y: number
  width: number
  height: number
  ref?: PanelGridModuleRef
  isAltDuplicate?: boolean
  invalid?: boolean
  /** Library drop onto an existing protection: preview wire from that feeder (canvas coords). */
  feedWirePoints?: number[]
  createAuxiliary?: boolean
  deviceIds?: string[]
  items?: Array<{
    ref: PanelGridModuleRef
    x: number
    y: number
    width: number
    height: number
  }>
}

type ModuleScopeKey = string

export function HierarchyPanelCanvas({
  canvasRef,
  currentProject,
  panelOptions,
  panelSceneFilter,
  libraryInteraction,
  libraryCanvasExtras,
  assignToCircuitMode = false,
  onAssignTargetClick,
  feedSideDirection,
  panelZoom,
  panelPan,
  handleZoomChange,
  handlePanChange,
  handleFitToView,
  handleViewTransformCommit,
  onMultiFingerSwipe,
  containerRef,
  getPanelGridModules,
  buildAutoArrangeSlots,
  applyPanelAutoArrange,
  placeSupplyModuleAfterInsert,
  panelRelationDebug,
  
  capabilities,
}: {
  canvasRef: RefObject<BaseCanvasHandle | null>
  currentProject: Project | null
  panelOptions: PanelOption[]
  panelSceneFilter: PanelSceneFilter
  libraryInteraction?: {
    onGetContextMenuItems?: (position: Point, elementId: string | null) => ContextMenuItem[]
    onDrop?: (position: Point, symbolData: unknown, meta?: CanvasDropMeta) => void
    onDragOver?: (position: Point, symbolData: unknown | null) => void
    onFindElementsInRectangle?: (rect: {
      x: number
      y: number
      width: number
      height: number
    }) => Array<{ id: string; type: string }>
    onGetSelectionBounds?: () => { x: number; y: number; width: number; height: number } | null
  }
  libraryCanvasExtras?: ReactNode
  assignToCircuitMode?: boolean
  onAssignTargetClick?: (ref: PanelGridModuleRef) => void
  feedSideDirection: 'left' | 'right'
  panelZoom: number
  panelPan: Point
  handleZoomChange: (zoom: number) => void
  handlePanChange: (pan: { x: number; y: number }) => void
  handleFitToView: () => void
  handleViewTransformCommit: (patch: { pan?: Point; zoom?: number }) => void
  onMultiFingerSwipe?: (
    direction: 'left' | 'right' | 'up' | 'down',
    fingerCount: number,
    startClientX: number
  ) => void
  containerRef: RefObject<HTMLDivElement | null>
  getPanelGridModules: ProjectState['getPanelGridModules']
  buildAutoArrangeSlots: (
    targetPanel: Panel,
    targetProject: Project
  ) => { mainSlots: PanelGridSlot[]; supplySlots: PanelGridSlot[] }
  applyPanelAutoArrange: ProjectState['applyPanelAutoArrange']
  placeSupplyModuleAfterInsert: (
    targetPanel: Panel,
    targetProject: Project,
    moduleRef: PanelGridModuleRef,
    preferredRow?: number,
    preferredCol?: number
  ) => { mainSlots: PanelGridSlot[]; supplySlots: PanelGridSlot[] }
  panelRelationDebug: boolean
  
  capabilities?: EditorCapabilities
}) {
  const { t } = useTranslation()
  const connectorGroupRef = useRef<Konva.Group>(null)
  const colors = useThemeColors()
  const fontFamily = useCanvasFontFamily()
  const touchPrimary = useTouchPrimaryDevice()
  const touchHandleHitStrokeWidth = touchPrimary ? 56 / Math.max(panelZoom, 0.1) : 'auto'
  const selection = useUIStore((s) => s.selection)
  const setSelection = useUIStore((s) => s.setSelection)
  const openDialog = useDialogStore((s) => s.openDialog)
  const canPlaceSymbols = capabilities?.canPlaceSymbols ?? true
  const canDragItems = capabilities?.canDragItems ?? true
  const canEditProject = capabilities?.canEditProject ?? true
  const canUseRewireTools = capabilities?.canUseRewireTools ?? true
  const leftDragPansCanvas = useSettingsStore((s) => s.leftDragPansCanvas)
  const updatePanelGridSlots = useProjectStore((s: ProjectState) => s.updatePanelGridSlots)
  const updatePanelGrid = useProjectStore((s: ProjectState) => s.updatePanelGrid)
  const updateJunctionPanelGrid = useProjectStore((s: ProjectState) => s.updateJunctionPanelGrid)
  const updateSupplyPanelSlots = useProjectStore((s: ProjectState) => s.updateSupplyPanelSlots)
  const createAuxiliarySupplyEnclosure = useProjectStore(
    (s: ProjectState) => s.createAuxiliarySupplyEnclosure
  )
  const moveSupplyDeviceToAuxiliaryEnclosure = useProjectStore(
    (s: ProjectState) => s.moveSupplyDeviceToAuxiliaryEnclosure
  )
  const moveSupplyDeviceToPanelEnclosure = useProjectStore(
    (s: ProjectState) => s.moveSupplyDeviceToPanelEnclosure
  )
  const moveSupplyDeviceToGridEnclosure = useProjectStore(
    (s: ProjectState) => s.moveSupplyDeviceToGridEnclosure
  )
  const moveTerminalStripToPanel = useProjectStore((s: ProjectState) => s.moveTerminalStripToPanel)
  const updateAuxiliaryElectricalEnclosure = useProjectStore(
    (s: ProjectState) => s.updateAuxiliaryElectricalEnclosure
  )
  const updateProtection = useProjectStore((s: ProjectState) => s.updateProtection)
  const getProtectionById = useProjectStore((s: ProjectState) => s.getProtectionById)
  const updateCircuit = useProjectStore((s: ProjectState) => s.updateCircuit)
  const updateEndpoint = useProjectStore((s: ProjectState) => s.updateEndpoint)
  const updateTrunkDevice = useProjectStore((s: ProjectState) => s.updateTrunkDevice)
  const updateSupplyTrunkDevice = useProjectStore((s: ProjectState) => s.updateSupplyTrunkDevice)
  const updateGroundTrunkDevice = useProjectStore((s: ProjectState) => s.updateGroundTrunkDevice)
  const getTrunkDeviceById = useProjectStore((s: ProjectState) => s.getTrunkDeviceById)
  const rewireModules = useProjectStore((s: ProjectState) => s.rewireModules)
  const [tooltip, setTooltip] = useState<ModuleTooltipData | null>(null)
  void tooltip
  void setTooltip
  const [hoveredModuleRef, setHoveredModuleRef] = useState<PanelGridModuleRef | null>(null)
  void setHoveredModuleRef
  const [dragPreview, setDragPreview] = useState<HierarchyDragPreview | null>(null)
  const [moduleDragPreview, setModuleDragPreview] = useState<HierarchyDragPreview | null>(null)
  const [moduleDragLive, setModuleDragLive] = useState<HierarchyDragPreview | null>(null)
  const [panelFrameResizePreview, setPanelFrameResizePreview] =
    useState<PanelFrameResizePreview | null>(null)
  const panelFrameResizePreviewRef = useRef<PanelFrameResizePreview | null>(null)
  const hierarchyFeedFromTop = useMemo(
    () => panelOptions.find((option) => option.isRoot)?.panel.gridView?.feedFromTop ?? false,
    [panelOptions]
  )
  const [rewireMode, setRewireMode] = useState(false)
  const [rewireOriginRef, setRewireOriginRef] = useState<PanelGridModuleRef | null>(null)
  const [rewireOriginSurfaceId, setRewireOriginSurfaceId] = useState<string | null>(null)
  const [rewireDragPos, setRewireDragPos] = useState<Point | null>(null)
  const [rewireTargetRef, setRewireTargetRef] = useState<PanelGridModuleRef | null>(null)
  const [rewireTargetSurfaceId, setRewireTargetSurfaceId] = useState<string | null>(null)
  const [rewireTargetValid, setRewireTargetValid] = useState(true)
  const [labelMode, setLabelMode] = useState(false)

  const updateModuleLabel = useCallback(
    (ref: PanelGridModuleRef, updates: PanelLabelEntityUpdates) => {
      if (!canEditProject) return
      if (ref.kind === 'protection') {
        const notes = updates.notes
        const protectionUpdates: PanelLabelEntityUpdates = { ...updates }
        delete protectionUpdates.notes
        const protection = getProtectionById(ref.id)
        const firstCircuitId = protection?.circuits?.[0]?.id
        if (notes !== undefined && firstCircuitId) updateCircuit(firstCircuitId, { notes })
        else if (notes !== undefined) protectionUpdates.notes = notes
        if (Object.keys(protectionUpdates).length > 0) {
          updateProtection(ref.id, protectionUpdates)
        }
        return
      }
      if (ref.kind === 'domotica') {
        updateEndpoint(ref.endpointId, updates)
        return
      }
      if (ref.scope === 'supply' || getTrunkDeviceById(ref.id)?.isSupplyDevice) {
        updateSupplyTrunkDevice(ref.id, updates)
        return
      }
      if (ref.scope === 'ground' || getTrunkDeviceById(ref.id)?.isGroundDevice) {
        updateGroundTrunkDevice(ref.id, updates)
        return
      }
      const circuitId = ref.circuitId ?? getTrunkDeviceById(ref.id)?.circuit?.id
      if (circuitId) updateTrunkDevice(circuitId, ref.id, updates)
    },
    [
      canEditProject,
      getProtectionById,
      getTrunkDeviceById,
      updateEndpoint,
      updateGroundTrunkDevice,
      updateProtection,
      updateCircuit,
      updateSupplyTrunkDevice,
      updateTrunkDevice,
    ]
  )

  const fullScene = useMemo(() => {
    if (!currentProject) return null
    const panelScenePanelOptions = panelOptions.map((o) => ({
      id: o.id,
      panel: o.panel,
      isRoot: o.isRoot,
    }))
    return buildFullPanelScene({
      project: currentProject,
      panelOptions: panelScenePanelOptions,
      getPanelGridModules,
      includeDescendants: true,
      hierarchyFeedFromTop,
      sharedSupplyLabel: t('panelCanvas.supplyPanel', 'Grid panel'),
    })
  }, [currentProject, panelOptions, getPanelGridModules, hierarchyFeedFromTop, t])

  const scene = useMemo(() => {
    if (!fullScene || !currentProject) return null
    return applyPanelSceneFilter(fullScene, panelSceneFilter, currentProject, hierarchyFeedFromTop)
  }, [fullScene, panelSceneFilter, currentProject, hierarchyFeedFromTop])
  const directPanelFeederConnectors = useMemo(
    () =>
      scene && currentProject
        ? buildDirectPanelFeederConnectors(scene.surfaces, currentProject)
        : [],
    [currentProject, scene]
  )
  const panelWirePathRegions = useMemo(
    () => buildPanelWirePathRegions(scene?.surfaces ?? []),
    [scene]
  )
  const panelWirePathLinks = useMemo(
    () => buildPanelWirePathLinks([...(scene?.connectors ?? []), ...directPanelFeederConnectors]),
    [directPanelFeederConnectors, scene]
  )

  const selectedPanelIds = useMemo(
    () => (selection.type === 'panel' ? selection.ids : []),
    [selection]
  )
  const selectedSupplyPanelIds = useMemo(
    () => (selection.type === 'supplyPanel' ? selection.ids : []),
    [selection]
  )
  const selectedAuxiliaryEnclosureIds = useMemo(
    () => (selection.type === 'auxiliaryEnclosure' ? selection.ids : []),
    [selection]
  )
  const selectedPanels = useMemo(
    () =>
      selectedPanelIds
        .map((panelId) => panelOptions.find((panelOption) => panelOption.id === panelId)?.panel)
        .filter((panel): panel is Panel => panel != null),
    [panelOptions, selectedPanelIds]
  )
  const hierarchyPanelsFromSelection = useMemo(() => {
    if (!scene || selection.ids.length === 0) return [] as Panel[]
    const selectedIds = new Set(selection.ids)
    const byPanelId = new Map<string, Panel>()
    for (const panelOption of panelOptions) {
      if (selectedIds.has(panelOption.panel.id))
        byPanelId.set(panelOption.panel.id, panelOption.panel)
    }
    for (const surface of scene.surfaces) {
      if (surface.kind !== 'panel' || !surface.panel) continue
      const hasSelectedModule = surface.placements.some((placement) => {
        if (placement.ref.kind === 'protection') return selectedIds.has(placement.ref.id)
        if (placement.ref.kind === 'trunkDevice') return selectedIds.has(placement.ref.id)
        if (placement.ref.kind === 'domotica') return selectedIds.has(placement.ref.endpointId)
        return false
      })
      if (hasSelectedModule) byPanelId.set(surface.panel.id, surface.panel)
    }
    return [...byPanelId.values()]
  }, [panelOptions, scene, selection.ids])
  const panelDepthById = useMemo(() => {
    const out = new Map<string, number>()
    const walk = (panels: Panel[], depth: number) => {
      for (const candidate of panels) {
        out.set(candidate.id, depth)
        walk(candidate.subPanels ?? [], depth + 1)
      }
    }
    if (currentProject) walk(getProjectElectricalPanels(currentProject) ?? [], 0)
    return out
  }, [currentProject])

  const getSurfaceRewireId = useCallback(
    (surface: HierarchySurface) =>
      surface.kind === 'shared_supply' ? PANEL_SCENE_SHARED_SUPPLY_ID : surface.id,
    []
  )

  const canUseHierarchyRewireSurface = useCallback(
    (originSurfaceId: string | null, candidate: HierarchySurface) => {
      if (!originSurfaceId) return false
      const candidateSurfaceId = getSurfaceRewireId(candidate)
      if (candidateSurfaceId === originSurfaceId) return true
      const originIsTerminalStrip =
        currentProject != null &&
        rewireOriginRef?.kind === 'trunkDevice' &&
        rewireOriginRef.scope === 'circuit' &&
        isTerminalStripDevice(findTrunkDeviceInProject(currentProject, rewireOriginRef.id))
      if (originIsTerminalStrip && candidate.kind === 'panel' && candidate.panel != null) {
        return true
      }
      return (
        currentProject != null &&
        rewireOriginRef != null &&
        isRootSupplyTailOrSharedSupplyTailRef(currentProject, rewireOriginRef) &&
        candidate.kind === 'panel' &&
        candidate.panel?.isMain !== true
      )
    },
    [currentProject, getSurfaceRewireId, rewireOriginRef]
  )

  const resolveHierarchyRewirePanel = useCallback(
    (originSurfaceId: string | null, targetSurfaceId: string | null): Panel | null => {
      if (!scene || !originSurfaceId || !targetSurfaceId) return null
      if (
        originSurfaceId === PANEL_SCENE_SHARED_SUPPLY_ID &&
        targetSurfaceId === PANEL_SCENE_SHARED_SUPPLY_ID
      ) {
        return panelOptions.find((opt) => opt.isRoot && opt.panel.isMain)?.panel ?? null
      }

      const surface = scene.surfaces.find(
        (candidate) => getSurfaceRewireId(candidate) === targetSurfaceId
      )
      if (surface?.kind !== 'panel' || !surface.panel) return null
      if (
        originSurfaceId !== targetSurfaceId &&
        !(
          currentProject != null &&
          rewireOriginRef != null &&
          isRootSupplyTailOrSharedSupplyTailRef(currentProject, rewireOriginRef) &&
          surface.panel.isMain !== true
        ) &&
        !(
          currentProject != null &&
          rewireOriginRef?.kind === 'trunkDevice' &&
          rewireOriginRef.scope === 'circuit' &&
          isTerminalStripDevice(findTrunkDeviceInProject(currentProject, rewireOriginRef.id))
        )
      ) {
        return null
      }
      return surface.panel
    },
    [currentProject, getSurfaceRewireId, panelOptions, rewireOriginRef, scene]
  )

  const resetHierarchyRewireState = useCallback(() => {
    setRewireOriginRef(null)
    setRewireOriginSurfaceId(null)
    setRewireDragPos(null)
    setRewireTargetRef(null)
    setRewireTargetSurfaceId(null)
    setRewireTargetValid(true)
  }, [])
  useEffect(() => {
    if (!labelMode) return
    setRewireMode(false)
    resetHierarchyRewireState()
    setSelection({ type: null, ids: [] })
    setTooltip(null)
    setHoveredModuleRef(null)
  }, [labelMode, resetHierarchyRewireState, setSelection])
  useEffect(() => {
    if (!labelMode) return
    const exitLabelMode = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return
      } else {
        const target = event.target
        if (!(target instanceof Node) || !containerRef.current?.contains(target)) return
      }
      event.preventDefault()
      event.stopPropagation()
      setLabelMode(false)
    }
    window.addEventListener('keydown', exitLabelMode)
    window.addEventListener('contextmenu', exitLabelMode, true)
    return () => {
      window.removeEventListener('keydown', exitLabelMode)
      window.removeEventListener('contextmenu', exitLabelMode, true)
    }
  }, [containerRef, labelMode])
  useEffect(() => {
    if (!rewireMode) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (isKeyboardTypingTarget(event.target)) return
      event.preventDefault()
      resetHierarchyRewireState()
      setRewireMode(false)
    }
    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target
      const insidePanelCanvas = target instanceof Node && !!containerRef.current?.contains(target)
      if (!insidePanelCanvas) return
      event.preventDefault()
      event.stopPropagation()
      resetHierarchyRewireState()
      setRewireMode(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('contextmenu', handleContextMenu, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('contextmenu', handleContextMenu, true)
    }
  }, [containerRef, resetHierarchyRewireState, rewireMode])

  const handleHierarchyRewireDragStart = useCallback(
    (surface: HierarchySurface, ref: PanelGridModuleRef) => {
      if (!rewireMode) return false
      setRewireOriginRef(ref)
      setRewireOriginSurfaceId(getSurfaceRewireId(surface))
      setRewireDragPos(null)
      setRewireTargetRef(null)
      setRewireTargetSurfaceId(null)
      setRewireTargetValid(true)
      return true
    },
    [getSurfaceRewireId, rewireMode]
  )

  const handleHierarchyRewireDragMove = useCallback(
    (_surface: HierarchySurface, _stage: Konva.Stage, pointerPos: Point) => {
      if (!scene || !rewireMode || !rewireOriginRef || !rewireOriginSurfaceId) return

      const zoom = panelZoom
      const pan = panelPan
      const canvasPos = {
        x: (pointerPos.x - pan.x) / zoom,
        y: (pointerPos.y - pan.y) / zoom,
      }
      setRewireDragPos(canvasPos)

      let foundTarget: { ref: PanelGridModuleRef; surfaceId: string } | null = null
      for (const surface of scene.surfaces) {
        if (!canUseHierarchyRewireSurface(rewireOriginSurfaceId, surface)) continue
        for (const placement of surface.placements) {
          const moduleKey = panelGridModuleRefKey(placement.ref)
          if (moduleKey === panelGridModuleRefKey(rewireOriginRef)) continue
          const left = surface.x + placement.x
          const right = left + placement.width
          const top = surface.y + placement.y
          const bottom = top + placement.height
          if (
            canvasPos.x >= left &&
            canvasPos.x <= right &&
            canvasPos.y >= top &&
            canvasPos.y <= bottom
          ) {
            foundTarget = { ref: placement.ref, surfaceId: getSurfaceRewireId(surface) }
            break
          }
        }
        if (foundTarget) break
      }

      let foundFrameSurfaceId: string | null = null
      if (!foundTarget) {
        for (const surface of scene.surfaces) {
          if (
            surface.kind !== 'panel' ||
            !surface.panel ||
            !canUseHierarchyRewireSurface(rewireOriginSurfaceId, surface)
          ) {
            continue
          }
          const left = surface.x - HIERARCHY_PANEL_FRAME_HIT_MARGIN
          const right = surface.x + surface.width + HIERARCHY_PANEL_FRAME_HIT_MARGIN
          const top =
            surface.y +
            surface.mainPanelY -
            Math.max(HIERARCHY_PANEL_FRAME_HIT_MARGIN, HIERARCHY_PANEL_FRAME_TITLE_HIT_HEIGHT)
          const bottom =
            surface.y +
            surface.mainPanelY +
            surface.panelFrameHeight +
            HIERARCHY_PANEL_FRAME_HIT_MARGIN
          if (
            canvasPos.x < left ||
            canvasPos.x > right ||
            canvasPos.y < top ||
            canvasPos.y > bottom
          ) {
            continue
          }
          const surfaceId = getSurfaceRewireId(surface)
          if (validatePanelRewireOperation(surface.panel, currentProject, rewireOriginRef, null)) {
            foundFrameSurfaceId = surfaceId
            break
          }
        }
      }

      setRewireTargetRef(foundTarget?.ref ?? null)
      setRewireTargetSurfaceId(foundTarget?.surfaceId ?? foundFrameSurfaceId)
      if (!foundTarget) {
        setRewireTargetValid(foundFrameSurfaceId !== null)
        return
      }

      const targetPanel = resolveHierarchyRewirePanel(rewireOriginSurfaceId, foundTarget.surfaceId)
      setRewireTargetValid(
        validatePanelRewireOperation(targetPanel, currentProject, rewireOriginRef, foundTarget.ref)
      )
    },
    [
      canUseHierarchyRewireSurface,
      currentProject,
      panelPan,
      panelZoom,
      resolveHierarchyRewirePanel,
      rewireMode,
      rewireOriginRef,
      rewireOriginSurfaceId,
      scene,
      getSurfaceRewireId,
    ]
  )

  const handleHierarchyRewireDragEnd = useCallback(() => {
    if (
      !rewireMode ||
      !rewireOriginRef ||
      !rewireOriginSurfaceId ||
      !rewireTargetSurfaceId ||
      !rewireTargetValid
    ) {
      resetHierarchyRewireState()
      return
    }

    const targetPanel = resolveHierarchyRewirePanel(rewireOriginSurfaceId, rewireTargetSurfaceId)
    if (!targetPanel) {
      resetHierarchyRewireState()
      return
    }

    try {
      useProjectStore.getState().withSingleUndoEntry(
        () =>
          applyPanelRewireOperation({
            panel: targetPanel,
            currentProject,
            origin: rewireOriginRef,
            target: rewireTargetRef,
            rewireModules,
            placeSupplyModuleAfterInsert,
            updatePanelGridSlots,
            updateSupplyPanelSlots,
          }),
        { sessionLabel: 'rewire panel module connection' }
      )
    } finally {
      resetHierarchyRewireState()
    }
  }, [
    currentProject,
    placeSupplyModuleAfterInsert,
    rewireMode,
    rewireModules,
    rewireOriginRef,
    rewireOriginSurfaceId,
    rewireTargetRef,
    rewireTargetSurfaceId,
    rewireTargetValid,
    resolveHierarchyRewirePanel,
    resetHierarchyRewireState,
    updatePanelGridSlots,
    updateSupplyPanelSlots,
  ])

  const hierarchyRewirePreviewWire = useMemo(() => {
    if (!scene || !rewireMode || !rewireOriginRef || !rewireOriginSurfaceId || !rewireDragPos) {
      return null
    }

    let originPlacement:
      | (ModulePlacement & { inSupplyPanel?: boolean; surface: HierarchySurface })
      | null = null
    let targetPlacement:
      | (ModulePlacement & { inSupplyPanel?: boolean; surface: HierarchySurface })
      | null = null

    for (const surface of scene.surfaces) {
      const surfaceId = getSurfaceRewireId(surface)
      for (const placement of surface.placements) {
        const key = panelGridModuleRefKey(placement.ref)
        if (surfaceId === rewireOriginSurfaceId && key === panelGridModuleRefKey(rewireOriginRef)) {
          originPlacement = { ...placement, surface }
        }
        if (
          rewireTargetRef &&
          rewireTargetSurfaceId === surfaceId &&
          key === panelGridModuleRefKey(rewireTargetRef)
        ) {
          targetPlacement = { ...placement, surface }
        }
      }
    }

    if (!originPlacement) return null

    const originCx = originPlacement.surface.x + originPlacement.x + originPlacement.width / 2
    const originY = originPlacement.surface.y + originPlacement.y
    let finalTargetX = rewireDragPos.x
    let finalTargetY = rewireDragPos.y

    if (targetPlacement) {
      finalTargetX = targetPlacement.surface.x + targetPlacement.x + targetPlacement.width / 2
      finalTargetY = targetPlacement.surface.y + targetPlacement.y
    }

    const targetPanel = resolveHierarchyRewirePanel(rewireOriginSurfaceId, rewireTargetSurfaceId)
    const operation = targetPanel
      ? getPanelRewireOperation(targetPanel, currentProject, rewireOriginRef, rewireTargetRef)
      : null
    const promotionPanelId =
      operation?.kind === 'promotePanelToRootSupply' ? operation.panelId : null
    if (promotionPanelId && !targetPlacement) {
      const targetSurface = scene.surfaces.find(
        (surface) => surface.kind === 'panel' && surface.panel?.id === promotionPanelId
      )
      if (targetSurface) {
        finalTargetX = targetSurface.x + targetSurface.width / 2
        finalTargetY = targetSurface.y + targetSurface.mainPanelY
      }
    }

    const useBottomGap =
      finalTargetY > originY + originPlacement.height &&
      rewireOriginSurfaceId === rewireTargetSurfaceId
    const routingGapY = useBottomGap
      ? originY + originPlacement.height + ROW_GAP / 2
      : originY - ROW_GAP / 2
    const points = useBottomGap
      ? [
          originCx,
          originY + originPlacement.height,
          originCx,
          routingGapY,
          finalTargetX,
          routingGapY,
          finalTargetX,
          finalTargetY,
        ]
      : [
          originCx,
          originY,
          originCx,
          routingGapY,
          finalTargetX,
          routingGapY,
          finalTargetX,
          finalTargetY,
        ]

    const stroke = promotionPanelId
      ? '#2563eb'
      : rewireTargetRef && targetPlacement
        ? rewireTargetValid
          ? '#10b981'
          : '#ef4444'
        : '#f59e0b'

    return {
      points,
      stroke,
      promotionPanelId,
    }
  }, [
    getSurfaceRewireId,
    rewireDragPos,
    rewireMode,
    rewireOriginRef,
    rewireOriginSurfaceId,
    rewireTargetRef,
    rewireTargetSurfaceId,
    rewireTargetValid,
    currentProject,
    resolveHierarchyRewirePanel,
    scene,
  ])

  const handleHierarchyAutoArrange = useCallback(() => {
    if (!currentProject || !scene) return

    const targetPanels =
      selectedPanels.length > 0
        ? selectedPanels
        : hierarchyPanelsFromSelection.length > 0
          ? hierarchyPanelsFromSelection
          : scene.surfaces
              .filter(
                (surface): surface is HierarchySurface & { panel: Panel } =>
                  surface.kind === 'panel' && surface.panel != null
              )
              .map((surface) => surface.panel)

    if (targetPanels.length === 0) return

    openDialog({
      type: 'confirm',
      title: t('panelCanvas.autoArrange'),
      message:
        targetPanels.length === 1
          ? t(
              'panelCanvas.autoArrangeConfirm',
              'This will fully replace the current panel layout (main and supply). Continue?'
            )
          : t(
              'panelCanvas.autoArrangeVisibleConfirm',
              'This will fully replace the current layout of the visible panels. Continue?'
            ),
      variant: 'warning',
      confirmLabel: t('common.confirm', 'Confirm'),
      cancelLabel: t('common.cancel', 'Cancel'),
      onConfirm: () => {
        for (const targetPanel of targetPanels) {
          const { mainSlots, supplySlots } = buildAutoArrangeSlots(targetPanel, currentProject)
          applyPanelAutoArrange(targetPanel.id, mainSlots, supplySlots)
        }
      },
    })
  }, [
    applyPanelAutoArrange,
    buildAutoArrangeSlots,
    currentProject,
    hierarchyPanelsFromSelection,
    openDialog,
    scene,
    selectedPanels,
    t,
  ])

  const handleHierarchyPanelSelect = useCallback(
    (
      panelId: string,
      event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } | undefined
    ) => {
      const additive = !!event?.shiftKey || !!event?.ctrlKey || !!event?.metaKey
      if (!additive || selection.type !== 'panel') {
        setSelection({ type: 'panel', ids: [panelId] })
        return
      }
      if (selection.ids.includes(panelId)) return
      setSelection(addToSelection(selection, panelId))
    },
    [selection, setSelection]
  )

  const panelFramePointerDownRef = useRef<{ x: number; y: number } | null>(null)
  const pendingPanelFrameSelectCleanupRef = useRef<(() => void) | null>(null)
  const shouldIgnorePanelFrameClick = useCallback(
    (event?: { button?: number; clientX?: number; clientY?: number }) => {
      const start = panelFramePointerDownRef.current
      panelFramePointerDownRef.current = null
      if (event?.button != null && event.button !== 0) return true
      if (!start || event?.clientX == null || event?.clientY == null) return false
      return (
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > PANEL_FRAME_DRAG_THRESHOLD
      )
    },
    []
  )

  useEffect(() => {
    const cleanup = pendingPanelFrameSelectCleanupRef.current
    return () => {
      cleanup?.()
    }
  }, [])

  const startPanelFrameSelectionRect = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent>) => {
      beginDeferredPanelFrameSelectionRect({
        event,
        canvasRef,
        leftDragPansCanvas,
        pointerDownRef: panelFramePointerDownRef,
        pendingCleanupRef: pendingPanelFrameSelectCleanupRef,
      })
    },
    [canvasRef, leftDragPansCanvas]
  )

  const handleGetHierarchySelectionBounds = useCallback(() => {
    const padding = 20
    if (!scene) return null
    if (selection.type === 'panel' && selectedPanelIds.length > 0) {
      const selectedSurfaces = scene.surfaces.filter(
        (surface): surface is HierarchySurface & { panel: Panel } =>
          surface.kind === 'panel' &&
          surface.panel != null &&
          selectedPanelIds.includes(surface.panel.id)
      )
      if (selectedSurfaces.length === 0) return null

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity

      for (const surface of selectedSurfaces) {
        minX = Math.min(minX, surface.x)
        minY = Math.min(minY, surface.y)
        maxX = Math.max(maxX, surface.x + surface.width)
        maxY = Math.max(maxY, surface.y + surface.height)
      }

      return {
        x: minX - padding,
        y: minY - padding,
        width: maxX - minX + padding * 2,
        height: maxY - minY + padding * 2,
      }
    }

    if (selection.type === 'auxiliaryEnclosure' && selectedAuxiliaryEnclosureIds.length > 0) {
      const selectedSurfaces = scene.surfaces.filter(
        (surface) =>
          surface.kind === 'auxiliary' && selectedAuxiliaryEnclosureIds.includes(surface.id)
      )
      if (selectedSurfaces.length === 0) return null
      const minX = Math.min(...selectedSurfaces.map((surface) => surface.x))
      const minY = Math.min(...selectedSurfaces.map((surface) => surface.y))
      const maxX = Math.max(...selectedSurfaces.map((surface) => surface.x + surface.width))
      const maxY = Math.max(...selectedSurfaces.map((surface) => surface.y + surface.height))
      return {
        x: minX - padding,
        y: minY - padding,
        width: maxX - minX + padding * 2,
        height: maxY - minY + padding * 2,
      }
    }

    const placementsInScene = scene.surfaces.flatMap((surface) =>
      surface.placements.map((placement) => ({
        ref: placement.ref,
        x: surface.x + placement.x,
        y: surface.y + placement.y,
        width: placement.width,
        height: placement.height,
      }))
    )

    return getModuleSelectionBounds(placementsInScene, selection, padding)
  }, [scene, selection, selectedAuxiliaryEnclosureIds, selectedPanelIds])

  const onFindHierarchyElementsInRectangle = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => {
      if (!scene) return []
      const buckets = new Map<
        ModuleScopeKey,
        {
          hits: Array<{ id: string; type: 'protection' | 'trunkDevice' | 'endpoint' | 'panel' }>
          panelDepth: number
        }
      >()
      for (const surface of scene.surfaces) {
        if (surface.kind === 'panel' && surface.panel) {
          const frameBox = {
            x: surface.x,
            y: surface.y + surface.mainPanelY,
            width: surface.width,
            height: surface.panelFrameHeight,
          }
          if (rectContainsRect(rect, frameBox)) {
            const scopeKey = `panel:${surface.panel.id}:frame`
            buckets.set(scopeKey, {
              hits: [{ id: surface.panel.id, type: 'panel' }],
              panelDepth: panelDepthById.get(surface.panel.id) ?? Number.MAX_SAFE_INTEGER,
            })
          }
        }
        for (const pl of surface.placements) {
          const renderBox = {
            x: surface.x + pl.x,
            y: surface.y + pl.y,
            width: pl.width,
            height: pl.height,
          }
          if (!rectContainsRect(rect, renderBox)) continue
          const scopeKey =
            surface.kind === 'panel' && surface.panel
              ? `panel:${surface.panel.id}:${pl.inSupplyPanel ? 'supply' : 'main'}`
              : 'shared-supply'
          const panelDepth =
            surface.kind === 'panel' && surface.panel
              ? (panelDepthById.get(surface.panel.id) ?? Number.MAX_SAFE_INTEGER)
              : -1
          if (!buckets.has(scopeKey)) {
            buckets.set(scopeKey, { hits: [], panelDepth })
          }
          const bucket = buckets.get(scopeKey)!
          if (pl.ref.kind === 'protection') {
            bucket.hits.push({ id: pl.ref.id, type: 'protection' })
          } else if (pl.ref.kind === 'trunkDevice') {
            bucket.hits.push({ id: pl.ref.id, type: 'trunkDevice' })
          } else {
            const endpoint = useProjectStore.getState().getEndpointById(pl.ref.endpointId)
            if (endpoint?.symbol === 'panel_distribution' && endpoint.panelId) {
              bucket.hits.push({ id: endpoint.panelId, type: 'panel' })
            } else {
              bucket.hits.push({ id: pl.ref.endpointId, type: 'endpoint' })
            }
          }
        }
      }
      let winner: {
        hits: Array<{ id: string; type: 'protection' | 'trunkDevice' | 'endpoint' | 'panel' }>
        panelDepth: number
      } | null = null
      for (const bucket of buckets.values()) {
        if (!winner) {
          winner = bucket
          continue
        }
        if (bucket.hits.length > winner.hits.length) {
          winner = bucket
          continue
        }
        if (bucket.hits.length === winner.hits.length && bucket.panelDepth < winner.panelDepth) {
          winner = bucket
        }
      }
      return winner?.hits ?? []
    },
    [panelDepthById, scene]
  )

  const createHierarchySelectionResolver = useCallback(
    (surface: HierarchySurface, placement: ModulePlacement & { inSupplyPanel?: boolean }) =>
      (
        nextSelection: CanvasSelection,
        context: {
          event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }
          currentSelection: CanvasSelection
        }
      ) => {
        const additive = context.event.shiftKey || context.event.ctrlKey || context.event.metaKey
        if (!additive || nextSelection.type == null) return nextSelection
        const scopedPlacements = surface.placements.filter(
          (candidate) => candidate.inSupplyPanel === placement.inSupplyPanel
        )
        // Include every module entity id in this zone (all ref kinds). Drag-rect can set
        // selection.type to a single "dominant" kind while ids list mixes protections, trunks
        // (e.g. MUNQ), endpoints — filtering only by nextSelection.type would drop the rest.
        const scopedIds = new Set(
          scopedPlacements.flatMap((candidate) => {
            if (candidate.ref.kind === 'protection') return [candidate.ref.id]
            if (candidate.ref.kind === 'trunkDevice') return [candidate.ref.id]
            if (candidate.ref.kind === 'domotica') return [candidate.ref.endpointId]
            return []
          })
        )
        return {
          type: nextSelection.type,
          ids: nextSelection.ids.filter((id) => scopedIds.has(id)),
        }
      },
    []
  )

  const detectHierarchyPanelTarget = useCallback(
    (position: Point) => {
      if (!scene) return null
      for (const surface of scene.surfaces) {
        if (surface.kind !== 'panel' || !surface.panel) continue
        const titleHitHeight = 36
        const frameLeft = surface.x - 10
        const frameRight = surface.x + surface.width + 10
        const frameTop = surface.y + surface.mainPanelY - 10
        const frameBottom = surface.y + surface.mainPanelY + surface.panelFrameHeight + 10
        if (
          position.x >= frameLeft &&
          position.x <= frameRight &&
          position.y >= frameTop &&
          position.y <= frameBottom
        ) {
          return surface
        }
        const titleTop = surface.y + surface.mainPanelY
        if (
          position.x >= frameLeft &&
          position.x <= frameRight &&
          position.y >= titleTop &&
          position.y <= titleTop + titleHitHeight
        ) {
          return surface
        }
      }
      return null
    },
    [scene]
  )

  const detectHierarchyLibraryDropHover = useCallback(
    (position: Point) => {
      if (!scene) return null
      const panelTarget = detectHierarchyPanelTarget(position)
      if (panelTarget) return panelTarget
      for (const surface of scene.surfaces) {
        if (surface.kind === 'panel') continue
        if (
          position.x >= surface.x - 10 &&
          position.x <= surface.x + surface.width + 10 &&
          position.y >= surface.y - 10 &&
          position.y <= surface.y + surface.height + 10
        ) {
          return surface
        }
      }
      return null
    },
    [detectHierarchyPanelTarget, scene]
  )

  const detectHierarchyModuleDropTarget = useCallback(
    (position: Point, ref: PanelGridModuleRef) => {
      if (!scene || !currentProject) return null
      const stripModule = resolveTerminalStripModule(currentProject, ref)
      const isTerminalStrip = stripModule != null
      // Endpoint-form strips can move between panels but have no auxiliary mounting.
      const isEndpointStrip = stripModule?.form === 'endpoint'
      const trunkRefId = ref.kind === 'trunkDevice' ? ref.id : ''
      if (!isTerminalStrip && !(ref.kind === 'trunkDevice' && ref.scope === 'supply')) return null
      if (!isTerminalStrip && !isAuxiliaryMountableSupplyDevice(currentProject, trunkRefId)) return null

      for (const surface of scene.surfaces) {
        if (surface.kind === 'auxiliary' && surface.enclosure) {
          const inside =
            position.x >= surface.x - 10 &&
            position.x <= surface.x + surface.width + 10 &&
            position.y >= surface.y - 10 &&
            position.y <= surface.y + surface.height + 10
          if (!inside) continue
          if (isEndpointStrip) continue
          const ownerPanelId = surface.enclosure.ownerPanelId
          const ownerPanel = ownerPanelId
            ? panelOptions.find((option) => option.panel.id === ownerPanelId)?.panel
            : panelOptions[0]?.panel
          if (!ownerPanel || (!isTerminalStrip && !isAuxiliaryMountableSupplyDevice(currentProject, trunkRefId))) return null
          return { surface, panel: ownerPanel, area: 'auxiliary' as const }
        }
        if (surface.kind === 'shared_supply') {
          if (isTerminalStrip) continue
          const frameLeft = surface.x
          const frameRight = surface.x + surface.width
          const frameTop = surface.y
          const frameBottom = surface.y + surface.height
          if (
            position.x >= frameLeft &&
            position.x <= frameRight &&
            position.y >= frameTop &&
            position.y <= frameBottom
          ) {
            const rootPanel = panelOptions.find(
              (option) => option.isRoot && option.panel.isMain
            )?.panel
            if (!rootPanel) return null
            return { surface, panel: rootPanel, area: 'supply' as const }
          }
          continue
        }

        if (surface.kind !== 'panel' || !surface.panel) continue
        const frameLeft = surface.x - 10
        const frameRight = surface.x + surface.width + 10
        const mainTop = surface.y + surface.mainPanelY - 10
        const mainBottom = surface.y + surface.mainPanelY + surface.panelFrameHeight + 10
        if (
          position.x >= frameLeft &&
          position.x <= frameRight &&
          position.y >= mainTop &&
          position.y <= mainBottom
        ) {
          return { surface, panel: surface.panel, area: 'main' as const }
        }

        const supplyTop = surface.y + surface.supplyPanelY - 10
        const supplyBottom = surface.y + surface.supplyPanelY + surface.supplyFrameHeight + 10
        if (
          surface.supplyPanelVisible &&
          position.x >= frameLeft &&
          position.x <= frameRight &&
          position.y >= supplyTop &&
          position.y <= supplyBottom
        ) {
          if (isTerminalStrip) return null
          return { surface, panel: surface.panel, area: 'supply' as const }
        }
      }
      return null
    },
    [currentProject, panelOptions, scene]
  )

  /**
   * Where a library symbol dropped at `position` lands on `surface`: the pointer's cell when
   * it is free, otherwise the nearest free cells beside the module under the pointer. A
   * protection dropped on an existing protection is fed from it (the feeder).
   */
  const resolveHierarchyLibraryDrop = useCallback(
    (position: Point, symbol: SymbolMetadata, surface: HierarchySurface) => {
      if (!currentProject) return null
      const gridTop =
        surface.y +
        (surface.kind === 'panel' ? surface.mainPanelY : 0) +
        PANEL_FRAME_MARGIN +
        getTerminalStripTopOffset(surface.panel)
      const gridLeft = surface.x + PANEL_FRAME_MARGIN
      const localX = position.x - gridLeft
      const localY = position.y - gridTop
      const widthCols = getLibraryDropWidthCols(symbol, currentProject)
      const requestedCol = Math.max(
        0,
        Math.min(surface.cols - widthCols, Math.round(localX / CELL_W) - Math.floor(widthCols / 2))
      )
      const requestedRow = clamp(snapToGrid(localX, localY + CELL_H / 2).row, 0, surface.rows - 1)

      const gridPlacements = surface.placements.filter(
        (placement) => !placement.inSupplyPanel && !placement.isOverflow
      )
      const hit = gridPlacements.find(
        (placement) =>
          position.x >= surface.x + placement.x &&
          position.x <= surface.x + placement.x + placement.width &&
          position.y >= surface.y + placement.y &&
          position.y <= surface.y + placement.y + placement.height
      )
      const slot = findPanelLibraryDropSlot({
        occupied: gridPlacements.map((placement) => ({
          row: placement.row,
          col: placement.col,
          widthCols: placement.width / CELL_W,
        })),
        rows: surface.rows,
        cols: surface.cols,
        widthCols,
        requested: { row: requestedRow, col: requestedCol },
        anchor: hit ? { row: hit.row, col: hit.col, widthCols: hit.width / CELL_W } : null,
      })

      const hitProtectionId = hit?.ref.kind === 'protection' ? hit.ref.id : undefined
      const isProtectionDrop = (PROTECTION_SYMBOL_IDS as readonly string[]).includes(symbol.id)
      const feederProtection =
        isProtectionDrop && hitProtectionId
          ? surface.panel?.protections.find(
              (protection) =>
                protection.id === hitProtectionId && (protection.circuits?.length ?? 0) > 0
            )
          : undefined

      const ghost = slot
        ? {
            x: gridLeft + slot.col * CELL_W,
            y: gridTop + slot.row * ROW_STRIDE,
            width: widthCols * CELL_W,
            height: CELL_H,
          }
        : null
      let feedWirePoints: number[] | undefined
      if (ghost && hit && feederProtection) {
        const originCx = surface.x + hit.x + hit.width / 2
        const originTop = surface.y + hit.y
        const originBottom = originTop + hit.height
        const targetCx = ghost.x + ghost.width / 2
        const below = ghost.y > originBottom
        const gapY = below ? originBottom + ROW_GAP / 2 : originTop - ROW_GAP / 2
        feedWirePoints = [
          originCx,
          below ? originBottom : originTop,
          originCx,
          gapY,
          targetCx,
          gapY,
          targetCx,
          ghost.y,
        ]
      }

      return {
        slot,
        ghost,
        widthCols,
        requestedRow,
        requestedCol,
        gridTop,
        feederProtection,
        feedWirePoints,
      }
    },
    [currentProject]
  )

  const handleHierarchyDragOver = useCallback(
    (position: Point, symbolData: unknown | null) => {
      if (!scene || !currentProject || !symbolData || typeof symbolData !== 'object') {
        setDragPreview(null)
        return
      }
      const symbol = symbolData as SymbolMetadata
      const isModularSocketDrop = isModularSocketLibraryId(symbol.id)
      const hoverSurface = isModularSocketDrop
        ? detectHierarchyLibraryDropHover(position)
        : detectHierarchyPanelTarget(position)
      if (!hoverSurface) {
        setDragPreview(null)
        return
      }

      const resolved = resolveHierarchyLibraryDrop(position, symbol, hoverSurface)
      if (!resolved) {
        setDragPreview(null)
        return
      }
      const invalid =
        !resolved.ghost ||
        (isModularSocketDrop &&
          (hoverSurface.kind !== 'panel' || !canDropModularSocketOnPanel(hoverSurface.panel)))

      setDragPreview({
        surfaceId: hoverSurface.id,
        panelId: hoverSurface.panel?.id,
        ...(resolved.ghost ?? {
          x: hoverSurface.x + PANEL_FRAME_MARGIN + resolved.requestedCol * CELL_W,
          y: resolved.gridTop + resolved.requestedRow * ROW_STRIDE,
          width: resolved.widthCols * CELL_W,
          height: CELL_H,
        }),
        invalid,
        feedWirePoints: invalid ? undefined : resolved.feedWirePoints,
      })
    },
    [
      currentProject,
      detectHierarchyLibraryDropHover,
      detectHierarchyPanelTarget,
      resolveHierarchyLibraryDrop,
      scene,
    ]
  )

  const handleHierarchyDrop = useCallback(
    (position: Point, symbolData: unknown | null, _meta?: CanvasDropMeta) => {
      setDragPreview(null)
      if (!currentProject || !symbolData || typeof symbolData !== 'object') return
      const symbol = symbolData as SymbolMetadata
      const isModularSocketDrop = isModularSocketLibraryId(symbol.id)
      const targetSurface = isModularSocketDrop
        ? detectHierarchyLibraryDropHover(position)
        : detectHierarchyPanelTarget(position)
      const targetPanel = targetSurface?.panel
      if (!targetSurface || !targetPanel) return
      if (isModularSocketDrop && (targetSurface.kind !== 'panel' || !canDropModularSocketOnPanel(targetPanel))) {
        return
      }

      setSelection({ type: 'panel', ids: [targetPanel.id] })

      const isProtectionDevice = (PROTECTION_SYMBOL_IDS as readonly string[]).includes(symbol.id)
      const isEnergyMeter = symbol.id === 'energy_meter'

      // Never stack modules: land beside whatever is under the pointer instead.
      const resolved = resolveHierarchyLibraryDrop(position, symbol, targetSurface)
      if (!resolved?.slot) return
      const { row, col } = resolved.slot
      const feederCircuitId = resolved.feederProtection?.circuits?.[0]?.id

      if (isModularSocketDrop) {
        const hitPlacement = targetSurface.placements.find(
          (placement) =>
            placement.ref.kind === 'protection' &&
            position.x >= targetSurface.x + placement.x &&
            position.x <= targetSurface.x + placement.x + placement.width &&
            position.y >= targetSurface.y + placement.y &&
            position.y <= targetSurface.y + placement.y + placement.height
        )
        const hitProtectionId = hitPlacement?.ref.kind === 'protection' ? hitPlacement.ref.id : undefined
        const hitProtection = hitProtectionId
          ? targetPanel.protections.find((protection) => protection.id === hitProtectionId)
          : undefined
        const protection = findPreferredModularSocketProtection(targetPanel, hitProtection)
        if (!protection) return
        let targetCircuit = findPreferredModularSocketCircuit(targetPanel, protection)
        if (!targetCircuit) {
          const circuitId = generateId()
          const autoCircuitCode = resolveInitialProtectionBusLabel(
            protection.type,
            getNextAvailableCircuitCode(currentProject, targetPanel.id)
          )
          targetCircuit = {
            id: circuitId,
            code: autoCircuitCode,
            kind: 'other',
            cable: createDefaultAcCircuitCable(),
            endpoints: [],
            ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
          }
          useProjectStore.getState().addCircuit(targetPanel.id, targetCircuit, protection.id)
        }

        const endpoint: Endpoint = {
          id: generateId(),
          type: getEndpointTypeFromSymbol(symbol) ?? 'socket',
          symbol: getSymbolKeyFromSymbol(symbol) ?? 'socket_gnd_child',
          label: '',
          placements: [],
        }
        applyLibraryPresetToEndpoint(symbol, endpoint)
        useProjectStore.getState().addEndpoint(targetCircuit.id, endpoint)

        const projectAfterDrop = useProjectStore.getState().currentProject
        const persistedPanel = projectAfterDrop
          ? findPanelRecursive(getProjectElectricalPanels(projectAfterDrop), targetPanel.id)
          : undefined
        const persistedCircuit = persistedPanel
          ? collectCircuits(persistedPanel).find((circuit) => circuit.id === targetCircuit.id)
          : undefined
        if (
          !persistedPanel ||
          !persistedCircuit?.endpoints.some((item) => item.id === endpoint.id)
        ) {
          logger.error('PanelCanvas hierarchy: Modular socket could not be assigned to the circuit', {
            panelId: targetPanel.id,
            circuitId: targetCircuit.id,
            endpointId: endpoint.id,
          })
          return
        }

        const moduleRef: PanelGridModuleRef = {
          kind: 'domotica',
          endpointId: endpoint.id,
          circuitId: targetCircuit.id,
        }
        const existingSlots = persistedPanel.gridView?.slots ?? []
        useProjectStore
          .getState()
          .unhideModuleFromPanel(targetPanel.id, panelGridModuleRefKey(moduleRef))
        useProjectStore
          .getState()
          .updatePanelGridSlots(targetPanel.id, [...existingSlots, { row, col, module: moduleRef }])
        setSelection({ type: 'endpoint', ids: [endpoint.id] })
        return
      }

      if (isProtectionDevice) {
        const store = useProjectStore.getState()
        store.withSingleUndoEntry(
          () => {
            const protectionType = protectionTypeFromSymbolId(symbol.id) || 'MCB'
            const defaults = getProtectionCreationProps(currentProject, protectionType)
            const autoCircuitCode = resolveInitialProtectionBusLabel(
              protectionType,
              getNextAvailableCircuitCode(currentProject, targetPanel.id)
            )
            const protectionId = generateId()
            const circuitId = generateId()
            const protection: ProtectionDevice = {
              id: protectionId,
              type: protectionType,
              label: autoCircuitCode,
              circuits: [],
              ...defaults,
            }
            useProjectStore.getState().addProtection(targetPanel.id, protection)
            const circuit: Circuit = {
              id: circuitId,
              code: autoCircuitCode,
              kind: 'other',
              cable: createDefaultAcCircuitCable(),
              endpoints: [],
              ...DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS,
            }
            useProjectStore.getState().addCircuit(targetPanel.id, circuit, protectionId)
            const moduleRef: PanelGridModuleRef = { kind: 'protection', id: protectionId }
            const existingSlots = targetPanel.gridView?.slots ?? []
            useProjectStore
              .getState()
              .updatePanelGridSlots(
                targetPanel.id,
                [...existingSlots, { row, col, module: moduleRef }],
                { preserveProtectionOrder: true }
              )
            // Dropped on an existing protection: feed the new one from it.
            if (feederCircuitId) {
              useProjectStore.getState().rewireModules(feederCircuitId, circuitId)
            }
            setSelection({ type: 'protection', ids: [protectionId] })
            return true
          },
          { sessionLabel: 'place protection from library' }
        )
        return
      }

      if (isEnergyMeter) {
        const targetCircuit = getLastAssignableCircuit(targetPanel)
        if (!targetCircuit) return
        const deviceId = generateId()
        const trunkDevice: TrunkDevice = {
          id: deviceId,
          type: 'energy_meter',
          symbol: 'energy_meter',
          label: 'kWh',
          trunkPosition: 0,
        }
        useProjectStore.getState().addTrunkDevice(targetCircuit.id, trunkDevice)
        const projectAfterMeter = useProjectStore.getState().currentProject
        const persistedPanel = projectAfterMeter
          ? findPanelRecursive(getProjectElectricalPanels(projectAfterMeter), targetPanel.id)
          : undefined
        const persistedCircuit = persistedPanel
          ? collectCircuits(persistedPanel).find((circuit) => circuit.id === targetCircuit.id)
          : undefined
        if (
          !persistedPanel ||
          !persistedCircuit?.trunkDevices?.some((device) => device.id === deviceId)
        ) {
          logger.error(
            'PanelCanvas hierarchy: Energy meter could not be assigned to the target panel circuit',
            { panelId: targetPanel.id, circuitId: targetCircuit.id, deviceId }
          )
          return
        }
        const moduleRef: PanelGridModuleRef = {
          kind: 'trunkDevice',
          id: deviceId,
          scope: 'circuit',
          circuitId: targetCircuit.id,
        }
        useProjectStore
          .getState()
          .unhideModuleFromPanel(targetPanel.id, panelGridModuleRefKey(moduleRef))
        const existingSlots = persistedPanel.gridView?.slots ?? []
        useProjectStore
          .getState()
          .updatePanelGridSlots(targetPanel.id, [...existingSlots, { row, col, module: moduleRef }])
        setSelection({ type: 'trunkDevice', ids: [deviceId] })
      }
    },
    [
      currentProject,
      detectHierarchyLibraryDropHover,
      detectHierarchyPanelTarget,
      resolveHierarchyLibraryDrop,
      setSelection,
    ]
  )

  const selectedRef = useMemo((): PanelGridModuleRef | null => {
    if (!scene || !selection.type || selection.ids.length === 0) return null
    const id = selection.ids[0]
    if (!id) return null
    for (const surface of scene.surfaces) {
      const match = surface.placements.find((placement) => {
        if (selection.type === 'protection') {
          return placement.ref.kind === 'protection' && placement.ref.id === id
        }
        if (selection.type === 'trunkDevice') {
          return (
            (placement.ref.kind === 'trunkDevice' && placement.ref.id === id) ||
            placement.terminalStripMemberRefs?.some(
              (ref) => ref.kind === 'trunkDevice' && ref.id === id
            ) === true
          )
        }
        if (selection.type === 'endpoint') {
          return placement.ref.kind === 'domotica' && placement.ref.endpointId === id
        }
        if (selection.type === 'junctionPanelTerminal') {
          return placement.junctionPanelTerminal?.terminalId === id
        }
        return false
      })
      if (match) return match.ref
    }
    return null
  }, [scene, selection])
  const panelWireSelectionFocus = useMemo(() => {
    if (!scene || !currentProject) return null
    return resolvePanelWireSelectionFocus(
      selection,
      scene.surfaces.flatMap((surface) => surface.placements)
    )
  }, [currentProject, scene, selection])

  const previewPanelFrameResize = useCallback(
    (surface: HierarchySurface & { panel: Panel }, axis: 'rows' | 'columns', delta: number) => {
      const rows = surface.panel.gridView?.rows ?? surface.rows
      const columns = surface.panel.gridView?.columns ?? surface.cols
      const nextRows = axis === 'rows' ? Math.max(1, rows + Math.round(delta / ROW_STRIDE)) : rows
      const nextColumns =
        axis === 'columns' ? Math.max(1, Math.round(columns + delta / CELL_W)) : columns
      const nextWidth = nextColumns * CELL_W + PANEL_FRAME_MARGIN * 2
      const mainContentHeight = nextRows * CELL_H + Math.max(0, nextRows - 1) * ROW_GAP
      const nextHeight =
        getTerminalStripTopOffset(surface.panel) +
        mainContentHeight +
        (surface.panel.gridView?.terminalStripBottomRail ? TERMINAL_STRIP_RAIL_H + ROW_GAP : 0) +
        PANEL_FRAME_MARGIN * 2
      const preview: PanelFrameResizePreview = {
        panelId: surface.panel.id,
        axis,
        value: axis === 'rows' ? nextRows : nextColumns,
        x: 0,
        y:
          axis === 'rows'
            ? surface.mainPanelY + surface.panelFrameHeight - nextHeight
            : surface.mainPanelY,
        width: axis === 'columns' ? nextWidth : surface.width,
        height: axis === 'rows' ? nextHeight : surface.panelFrameHeight,
      }
      panelFrameResizePreviewRef.current = preview
      setPanelFrameResizePreview(preview)
    },
    []
  )

  const commitPanelFrameResize = useCallback(
    (surface: HierarchySurface & { panel: Panel }) => {
      const preview = panelFrameResizePreviewRef.current
      panelFrameResizePreviewRef.current = null
      setPanelFrameResizePreview(null)
      if (!preview || preview.panelId !== surface.panel.id) return
      updatePanelGrid(surface.panel.id, {
        [preview.axis]: preview.value,
      })
    },
    [updatePanelGrid]
  )

  const previewJunctionPanelFrameResize = useCallback(
    (surface: HierarchySurface, axis: 'rows' | 'columns', delta: number) => {
      const gridView = surface.junctionPanelGridView ?? surface.enclosure?.gridView
      if (!gridView) return
      const rows = gridView.rows ?? surface.rows
      const columns = gridView.columns ?? surface.cols
      const nextRows = axis === 'rows' ? Math.max(1, rows + Math.round(delta / ROW_STRIDE)) : rows
      const nextColumns =
        axis === 'columns' ? Math.max(1, Math.round(columns + delta / CELL_W)) : columns
      const layoutPanel = { gridView } as Panel
      const mainContentHeight = nextRows * CELL_H + Math.max(0, nextRows - 1) * ROW_GAP
      const nextHeight =
        getTerminalStripTopOffset(layoutPanel) +
        mainContentHeight +
        (gridView.terminalStripBottomRail ? TERMINAL_STRIP_RAIL_H + ROW_GAP : 0) +
        PANEL_FRAME_MARGIN * 2
      const preview: PanelFrameResizePreview = {
        panelId: surface.id,
        axis,
        value: axis === 'rows' ? nextRows : nextColumns,
        x: 0,
        y: axis === 'rows' ? surface.height - nextHeight : 0,
        width: axis === 'columns' ? nextColumns * CELL_W + PANEL_FRAME_MARGIN * 2 : surface.width,
        height: axis === 'rows' ? nextHeight : surface.height,
      }
      panelFrameResizePreviewRef.current = preview
      setPanelFrameResizePreview(preview)
    },
    []
  )

  const commitJunctionPanelFrameResize = useCallback(
    (surface: HierarchySurface) => {
      const preview = panelFrameResizePreviewRef.current
      panelFrameResizePreviewRef.current = null
      setPanelFrameResizePreview(null)
      if (!preview || preview.panelId !== surface.id) return
      if (surface.kind === 'auxiliary' && surface.enclosure) {
        updateAuxiliaryElectricalEnclosure(surface.id, {
          gridView: { ...surface.enclosure.gridView, [preview.axis]: preview.value },
        })
        return
      }
      const representative = surface.placements.find(
        (placement) => placement.ref.kind === 'trunkDevice'
      )
      if (representative?.ref.kind !== 'trunkDevice') return
      updateJunctionPanelGrid(representative.ref.id, { [preview.axis]: preview.value })
    },
    [updateAuxiliaryElectricalEnclosure, updateJunctionPanelGrid]
  )

  const isHierarchyRefInSelection = useCallback(
    (ref: PanelGridModuleRef) => {
      if (selection.ids.length === 0) return false
      // Keep hierarchy drag-select behavior aligned with BaseCanvas drag-rect:
      // mixed-type selections may carry IDs from multiple kinds under one selection.type.
      if (ref.kind === 'protection') return selection.ids.includes(ref.id)
      if (ref.kind === 'trunkDevice') {
        const placement = scene?.surfaces
          .flatMap((surface) => surface.placements)
          .find(
            (candidate) =>
              panelGridModuleRefKey(candidate.ref) === panelGridModuleRefKey(ref) ||
              candidate.terminalStripMemberRefs?.some(
                (member) => panelGridModuleRefKey(member) === panelGridModuleRefKey(ref)
              )
          )
        return (
          selection.ids.includes(ref.id) ||
          placement?.terminalStripMemberRefs?.some(
            (member) => member.kind === 'trunkDevice' && selection.ids.includes(member.id)
          ) === true
        )
      }
      if (ref.kind === 'domotica') return selection.ids.includes(ref.endpointId)
      return false
    },
    [scene, selection]
  )

  const handleHierarchyModuleDragMove = useCallback(
    (
      surface: HierarchySurface,
      placement: ModulePlacement & { inSupplyPanel?: boolean },
      rawX: number,
      rawY: number,
      shiftKey = false,
      altKey = false
    ) => {
      const isAltDuplicate =
        altKey &&
        !placement.inSupplyPanel &&
        (placement.ref.kind === 'protection' || placement.ref.kind === 'domotica')
      const surfaceTargetId = surface.panel?.id ?? surface.id
      const key = panelGridModuleRefKey(placement.ref)
      const moduleCols = Math.max(
        MIN_PANEL_GRID_MODULE_WIDTH,
        normalizePanelModuleMeasure(placement.width / CELL_W)
      )
      const maxCol = Math.max(0, surface.cols - moduleCols)
      const selectedPlacements =
        !isAltDuplicate && selection.ids.length >= 2 && isHierarchyRefInSelection(placement.ref)
          ? surface.placements.filter(
              (other) =>
                other.inSupplyPanel === placement.inSupplyPanel &&
                isHierarchyRefInSelection(other.ref)
            )
          : []

      if (placement.ref.kind === 'trunkDevice' && placement.ref.scope === 'supply') {
        const canvasPos = { x: surface.x + rawX, y: surface.y + rawY }
        const detectedTarget = detectHierarchyModuleDropTarget(canvasPos, placement.ref)
        const target = detectedTarget
        const currentArea =
          surface.kind === 'auxiliary' ? 'auxiliary' : placement.inSupplyPanel ? 'supply' : 'main'
        const targetSurfaceId = target ? (target.surface.panel?.id ?? target.surface.id) : null
        const currentSurfaceId = surface.panel?.id ?? surface.id
        if (target && (targetSurfaceId !== currentSurfaceId || target.area !== currentArea)) {
          const targetCols =
            target.area === 'supply' ? target.surface.supplyCols : target.surface.cols
          const targetRows =
            target.area === 'supply' ? target.surface.supplyRows : target.surface.rows
          const targetMaxCol = Math.max(0, targetCols - moduleCols)
          const localX = canvasPos.x - target.surface.x - PANEL_FRAME_MARGIN
          const localY =
            target.area === 'supply'
              ? canvasPos.y - target.surface.y - target.surface.supplyPanelY - PANEL_FRAME_MARGIN
              : canvasPos.y -
                target.surface.y -
                target.surface.mainPanelY -
                PANEL_FRAME_MARGIN -
                getTerminalStripTopOffset(target.surface.panel)
          const snapped = snapToGrid(localX, localY + CELL_H / 2)
          const row =
            target.area === 'supply'
              ? clamp(targetRows - 1, 0, snapped.row)
              : clamp(targetRows - 1, 0, snapped.row)
          const col = clamp(targetMaxCol, 0, snapped.col)
          const targetY =
            target.area === 'supply'
              ? target.surface.y +
                target.surface.supplyPanelY +
                PANEL_FRAME_MARGIN +
                row * ROW_STRIDE
              : target.surface.y +
                target.surface.mainPanelY +
                PANEL_FRAME_MARGIN +
                getTerminalStripTopOffset(target.surface.panel) +
                row * ROW_STRIDE
          const invalid = target.surface.placements.some((other) => {
            const otherArea =
              target.surface.kind === 'auxiliary'
                ? 'auxiliary'
                : other.inSupplyPanel === true
                  ? 'supply'
                  : 'main'
            if (otherArea !== target.area) return false
            if (panelGridModuleRefKey(other.ref) === key) return false
            if (other.row !== row) return false
            const otherCols = Math.max(
              MIN_PANEL_GRID_MODULE_WIDTH,
              normalizePanelModuleMeasure(other.width / CELL_W)
            )
            return col < other.col + otherCols && other.col < col + moduleCols
          })
          setModuleDragLive({
            surfaceId: targetSurfaceId ?? currentSurfaceId,
            x: canvasPos.x,
            y: canvasPos.y,
            width: placement.width,
            height: placement.height,
            ref: placement.ref,
          })
          setModuleDragPreview({
            surfaceId: targetSurfaceId ?? currentSurfaceId,
            x: target.surface.x + PANEL_FRAME_MARGIN + col * CELL_W,
            y: targetY,
            width: placement.width,
            height: placement.height,
            ref: placement.ref,
            invalid,
          })
          return
        }
        const ownerPanelId =
          surface.enclosure?.ownerPanelId ??
          surface.panel?.id ??
          panelOptions.find((option) => option.isRoot && option.panel.isMain)?.panel.id
        const creationPlacements = selectedPlacements.length >= 2 ? selectedPlacements : [placement]
        const creationDeviceIds = creationPlacements.flatMap((candidate) =>
          candidate.ref.kind === 'trunkDevice' && candidate.ref.scope === 'supply'
            ? [candidate.ref.id]
            : []
        )
        const completeEligibleSelection =
          (selection.ids.length <= 1 || creationPlacements.length === selection.ids.length) &&
          creationDeviceIds.length === creationPlacements.length &&
          currentProject != null &&
          creationDeviceIds.every((deviceId) =>
            isAuxiliaryMountableSupplyDevice(currentProject, deviceId)
          )
        const plannedGrid =
          currentProject && completeEligibleSelection
            ? planAuxiliarySupplyEnclosureGrid(currentProject, creationDeviceIds)
            : null
        const isInsideSurface = scene?.surfaces.some(
          (candidate) =>
            canvasPos.x >= candidate.x &&
            canvasPos.x <= candidate.x + candidate.width &&
            canvasPos.y >= candidate.y &&
            canvasPos.y <= candidate.y + candidate.height
        )
        if (!target && !isInsideSurface && ownerPanelId && currentProject && scene) {
          const fallbackColumns = Math.max(
            1,
            creationPlacements.reduce(
              (sum, candidate) =>
                sum +
                Math.max(
                  MIN_PANEL_GRID_MODULE_WIDTH,
                  normalizePanelModuleMeasure(candidate.width / CELL_W)
                ),
              0
            )
          )
          const previewWidth =
            (plannedGrid?.columns ?? fallbackColumns) * CELL_W + PANEL_FRAME_MARGIN * 2
          const previewHeight =
            (plannedGrid?.rows ?? 1) * CELL_H +
            Math.max(0, (plannedGrid?.rows ?? 1) - 1) * ROW_GAP +
            PANEL_FRAME_MARGIN * 2
          const existingOwnerEnclosure = scene.surfaces.find(
            (candidate) =>
              candidate.kind === 'auxiliary' && candidate.enclosure?.ownerPanelId === ownerPanelId
          )
          const sharedSurface = scene.surfaces.find(
            (candidate) => candidate.kind === 'shared_supply'
          )
          const ownerSurface = scene.surfaces.find(
            (candidate) => candidate.kind === 'panel' && candidate.panel?.id === ownerPanelId
          )
          const transitionY = existingOwnerEnclosure
            ? existingOwnerEnclosure.y
            : sharedSurface && ownerSurface && sharedSurface.y < ownerSurface.y
              ? ownerSurface.y
              : sharedSurface && ownerSurface
                ? ownerSurface.y + ownerSurface.height
                : Math.max(0, canvasPos.y - PANEL_FRAME_MARGIN - CELL_H / 2)
          setModuleDragLive({
            surfaceId: surfaceTargetId,
            x: canvasPos.x,
            y: canvasPos.y,
            width: placement.width,
            height: placement.height,
            ref: placement.ref,
            items: creationPlacements.map((candidate) => ({
              ref: candidate.ref,
              x: surface.x + candidate.x + (rawX - placement.x),
              y: surface.y + candidate.y + (rawY - placement.y),
              width: candidate.width,
              height: candidate.height,
            })),
          })
          setModuleDragPreview({
            surfaceId: '__new_auxiliary__',
            x: Math.max(0, canvasPos.x - PANEL_FRAME_MARGIN - placement.width / 2),
            y: Math.max(0, transitionY),
            width: previewWidth,
            height: previewHeight,
            ref: placement.ref,
            createAuxiliary: true,
            deviceIds: creationDeviceIds,
            invalid: plannedGrid == null,
          })
          return
        }
      }

      const isTerminalStrip =
        !placement.inSupplyPanel &&
        currentProject != null &&
        resolveTerminalStripModule(currentProject, placement.ref) != null
      if (isTerminalStrip) {
        const canvasPos = { x: surface.x + rawX, y: surface.y + rawY }
        const target = detectHierarchyModuleDropTarget(canvasPos, placement.ref)
        const currentSurfaceId = surface.panel?.id ?? surface.id
        const targetSurfaceId = target?.surface.panel?.id ?? target?.surface.id
        if (
          (target?.area === 'main' || target?.area === 'auxiliary') &&
          (targetSurfaceId !== currentSurfaceId || target.area === 'auxiliary')
        ) {
          const targetPanel = target.surface.enclosure
            ? { ...target.panel, gridView: target.surface.enclosure.gridView }
            : target.panel
          const targetMaxCol = Math.max(0, target.surface.cols - moduleCols)
          const localX = canvasPos.x - target.surface.x - PANEL_FRAME_MARGIN
          const panelLocalY = canvasPos.y - target.surface.y - target.surface.mainPanelY
          const topRail =
            targetPanel.gridView?.terminalStripTopRail === true &&
            panelLocalY <= PANEL_FRAME_MARGIN + TERMINAL_STRIP_RAIL_H + ROW_GAP / 2
          const bottomRail =
            targetPanel.gridView?.terminalStripBottomRail === true &&
            panelLocalY >=
              target.surface.panelFrameHeight -
                PANEL_FRAME_MARGIN -
                TERMINAL_STRIP_RAIL_H -
                ROW_GAP / 2
          const targetRail = topRail ? 'top' : bottomRail ? 'bottom' : undefined
          const localY = panelLocalY - PANEL_FRAME_MARGIN - getTerminalStripTopOffset(targetPanel)
          const snapped = snapToGrid(localX, localY + CELL_H / 2)
          const row = clamp(snapped.row, 0, target.surface.rows - 1)
          const col = snapTerminalStripPlacementCol(
            localX,
            moduleCols,
            targetMaxCol,
            row,
            target.surface.placements.filter(
              (other) =>
                panelGridModuleRefKey(other.ref) !== key &&
                !other.terminalStripMemberRefs?.some(
                  (member) => panelGridModuleRefKey(member) === key
                )
            ),
            shiftKey,
            targetRail
          )
          const invalid = target.surface.placements.some((other) => {
            if ((other.inSupplyPanel && target.area !== 'auxiliary') || other.terminalStripRail !== targetRail) return false
            if (
              panelGridModuleRefKey(other.ref) === key ||
              other.terminalStripMemberRefs?.some((member) => panelGridModuleRefKey(member) === key)
            )
              return false
            if (!targetRail && other.row !== row) return false
            const otherCols = Math.max(
              MIN_PANEL_GRID_MODULE_WIDTH,
              normalizePanelModuleMeasure(other.width / CELL_W)
            )
            return col < other.col + otherCols && other.col < col + moduleCols
          })
          const previewY =
            targetRail === 'top'
              ? target.surface.y + target.surface.mainPanelY + PANEL_FRAME_MARGIN
              : targetRail === 'bottom'
                ? target.surface.y +
                  target.surface.mainPanelY +
                  target.surface.panelFrameHeight -
                  PANEL_FRAME_MARGIN -
                  TERMINAL_STRIP_RAIL_H
                : target.surface.y +
                  target.surface.mainPanelY +
                  PANEL_FRAME_MARGIN +
                  getTerminalStripTopOffset(targetPanel) +
                  row * ROW_STRIDE
          setModuleDragLive({
            surfaceId: targetSurfaceId ?? currentSurfaceId,
            x: canvasPos.x,
            y: canvasPos.y,
            width: placement.width,
            height: placement.height,
            ref: placement.ref,
          })
          setModuleDragPreview({
            surfaceId: targetSurfaceId ?? currentSurfaceId,
            x: target.surface.x + PANEL_FRAME_MARGIN + col * CELL_W,
            y: previewY,
            width: placement.width,
            height: targetRail ? TERMINAL_STRIP_RAIL_H : CELL_H,
            ref: placement.ref,
            invalid,
          })
          return
        }
      }

      if (placement.inSupplyPanel) {
        const dx = rawX - placement.x
        const dy = rawY - placement.y
        if (selectedPlacements.length >= 2) {
          setModuleDragLive({
            surfaceId: surfaceTargetId,
            x: surface.x + rawX,
            y: surface.y + rawY,
            width: placement.width,
            height: placement.height,
            ref: placement.ref,
            items: selectedPlacements.map((selectedPlacement) => ({
              ref: selectedPlacement.ref,
              x: surface.x + selectedPlacement.x + dx,
              y: surface.y + selectedPlacement.y + dy,
              width: selectedPlacement.width,
              height: selectedPlacement.height,
            })),
          })
        } else {
          setModuleDragLive({
            surfaceId: surfaceTargetId,
            x: surface.x + rawX,
            y: surface.y + rawY,
            width: placement.width,
            height: placement.height,
            ref: placement.ref,
          })
        }
        const col = Math.max(0, Math.min(maxCol, Math.round((rawX - PANEL_FRAME_MARGIN) / CELL_W)))
        if (selectedPlacements.length >= 2) {
          const deltaCol = col - placement.col
          const previewItems = selectedPlacements.map((selectedPlacement) => ({
            ref: selectedPlacement.ref,
            col: selectedPlacement.col + deltaCol,
            x: surface.x + PANEL_FRAME_MARGIN + (selectedPlacement.col + deltaCol) * CELL_W,
            y: surface.y + surface.supplyPanelY + PANEL_FRAME_MARGIN,
            width: selectedPlacement.width,
            height: selectedPlacement.height,
          }))
          const invalid =
            previewItems.some((item) => {
              const widthCols = Math.max(
                MIN_PANEL_GRID_MODULE_WIDTH,
                normalizePanelModuleMeasure(item.width / CELL_W)
              )
              return item.col < 0 || item.col > surface.cols - widthCols
            }) ||
            surface.placements.some((other) => {
              if (!other.inSupplyPanel) return false
              if (
                selectedPlacements.some(
                  (selected) =>
                    panelGridModuleRefKey(selected.ref) === panelGridModuleRefKey(other.ref)
                )
              ) {
                return false
              }
              const otherCols = Math.max(
                MIN_PANEL_GRID_MODULE_WIDTH,
                normalizePanelModuleMeasure(other.width / CELL_W)
              )
              return previewItems.some((item) => {
                const widthCols = Math.max(
                  MIN_PANEL_GRID_MODULE_WIDTH,
                  normalizePanelModuleMeasure(item.width / CELL_W)
                )
                return item.col < other.col + otherCols && other.col < item.col + widthCols
              })
            })
          setModuleDragPreview({
            surfaceId: surfaceTargetId,
            x: surface.x + PANEL_FRAME_MARGIN + col * CELL_W,
            y: surface.y + surface.supplyPanelY + PANEL_FRAME_MARGIN,
            width: placement.width,
            height: placement.height,
            ref: placement.ref,
            invalid,
            items: previewItems.map(({ ref, x, y, width, height }) => ({
              ref,
              x,
              y,
              width,
              height,
            })),
          })
          return
        }
        const invalid = surface.placements.some((other) => {
          if (!other.inSupplyPanel) return false
          if (panelGridModuleRefKey(other.ref) === key) return false
          const otherCols = Math.max(
            MIN_PANEL_GRID_MODULE_WIDTH,
            normalizePanelModuleMeasure(other.width / CELL_W)
          )
          return col < other.col + otherCols && other.col < col + moduleCols
        })
        setModuleDragPreview({
          surfaceId: surfaceTargetId,
          x: surface.x + PANEL_FRAME_MARGIN + col * CELL_W,
          y: surface.y + surface.supplyPanelY + PANEL_FRAME_MARGIN,
          width: placement.width,
          height: placement.height,
          ref: placement.ref,
          invalid,
        })
        return
      }

      const localX = rawX - PANEL_FRAME_MARGIN
      const panelLocalY = rawY - surface.mainPanelY
      const panel =
        surface.panel ??
        (surface.enclosure && panelOptions[0]
          ? { ...panelOptions[0].panel, gridView: surface.enclosure.gridView }
          : null)
      const previewIsTerminal =
        currentProject != null && resolveTerminalStripModule(currentProject, placement.ref) != null
      const previewTopRail =
        previewIsTerminal &&
        panel?.gridView?.terminalStripTopRail === true &&
        panelLocalY <= PANEL_FRAME_MARGIN + TERMINAL_STRIP_RAIL_H + ROW_GAP / 2
      const previewBottomRail =
        previewIsTerminal &&
        panel?.gridView?.terminalStripBottomRail === true &&
        panelLocalY >=
          surface.panelFrameHeight - PANEL_FRAME_MARGIN - TERMINAL_STRIP_RAIL_H - ROW_GAP / 2
      const previewRail = previewTopRail ? 'top' : previewBottomRail ? 'bottom' : undefined
      const localY = panelLocalY - PANEL_FRAME_MARGIN - getTerminalStripTopOffset(panel)
      const snapped = snapToGrid(localX, localY + CELL_H / 2)
      const row = clamp(snapped.row, 0, surface.rows - 1)
      const col = previewIsTerminal
        ? snapTerminalStripPlacementCol(
            localX,
            moduleCols,
            maxCol,
            row,
            surface.placements.filter(
              (other) => panelGridModuleRefKey(other.ref) !== key && !other.inSupplyPanel
            ),
            shiftKey,
            previewRail
          )
        : clamp(maxCol, 0, snapped.col)
      const dx = rawX - placement.x
      const dy = rawY - placement.y
      if (selectedPlacements.length >= 2) {
        setModuleDragLive({
          surfaceId: surfaceTargetId,
          x: surface.x + rawX,
          y: surface.y + rawY,
          width: placement.width,
          height: placement.height,
          ref: placement.ref,
          items: selectedPlacements.map((selectedPlacement) => ({
            ref: selectedPlacement.ref,
            x: surface.x + selectedPlacement.x + dx,
            y: surface.y + selectedPlacement.y + dy,
            width: selectedPlacement.width,
            height: selectedPlacement.height,
          })),
        })
      } else {
        setModuleDragLive({
          isAltDuplicate,
          surfaceId: surfaceTargetId,
          x: surface.x + rawX,
          y: surface.y + rawY,
          width: placement.width,
          height: placement.height,
          ref: placement.ref,
        })
      }
      if (selectedPlacements.length >= 2) {
        const deltaRow = row - placement.row
        const deltaCol = col - placement.col
        const previewItems = selectedPlacements.map((selectedPlacement) => ({
          ref: selectedPlacement.ref,
          row: selectedPlacement.row + deltaRow,
          col: selectedPlacement.col + deltaCol,
          x: surface.x + PANEL_FRAME_MARGIN + (selectedPlacement.col + deltaCol) * CELL_W,
          y:
            surface.y +
            surface.mainPanelY +
            PANEL_FRAME_MARGIN +
            getTerminalStripTopOffset(panel) +
            (selectedPlacement.row + deltaRow) * ROW_STRIDE,
          width: selectedPlacement.width,
          height: selectedPlacement.height,
        }))
        const invalid =
          previewItems.some((item) => {
            const widthCols = Math.max(
              MIN_PANEL_GRID_MODULE_WIDTH,
              normalizePanelModuleMeasure(item.width / CELL_W)
            )
            return (
              item.row < 0 ||
              item.row >= surface.rows ||
              item.col < 0 ||
              item.col > surface.cols - widthCols
            )
          }) ||
          surface.placements.some((other) => {
            if (other.inSupplyPanel) return false
            if (
              selectedPlacements.some(
                (selected) =>
                  panelGridModuleRefKey(selected.ref) === panelGridModuleRefKey(other.ref)
              )
            ) {
              return false
            }
            const otherCols = Math.max(
              MIN_PANEL_GRID_MODULE_WIDTH,
              normalizePanelModuleMeasure(other.width / CELL_W)
            )
            return previewItems.some((item) => {
              const widthCols = Math.max(
                MIN_PANEL_GRID_MODULE_WIDTH,
                normalizePanelModuleMeasure(item.width / CELL_W)
              )
              if (item.row !== other.row) return false
              return item.col < other.col + otherCols && other.col < item.col + widthCols
            })
          })
        setModuleDragPreview({
          surfaceId: surfaceTargetId,
          x: surface.x + PANEL_FRAME_MARGIN + col * CELL_W,
          y:
            surface.y +
            surface.mainPanelY +
            PANEL_FRAME_MARGIN +
            getTerminalStripTopOffset(panel) +
            row * ROW_STRIDE,
          width: placement.width,
          height: placement.height,
          ref: placement.ref,
          invalid,
          items: previewItems.map(({ ref, x, y, width, height }) => ({ ref, x, y, width, height })),
        })
        return
      }
      const invalid = surface.placements.some((other) => {
        if (other.inSupplyPanel) return false
        if (panelGridModuleRefKey(other.ref) === key) return false
        if (other.terminalStripRail !== previewRail) return false
        if (!previewRail && other.row !== row) return false
        const otherCols = Math.max(
          MIN_PANEL_GRID_MODULE_WIDTH,
          normalizePanelModuleMeasure(other.width / CELL_W)
        )
        return col < other.col + otherCols && other.col < col + moduleCols
      })
      setModuleDragPreview({
        surfaceId: surfaceTargetId,
        x: surface.x + PANEL_FRAME_MARGIN + col * CELL_W,
        y:
          surface.y +
          surface.mainPanelY +
          PANEL_FRAME_MARGIN +
          (previewRail === 'top'
            ? 0
            : previewRail === 'bottom'
              ? surface.panelFrameHeight - PANEL_FRAME_MARGIN * 2 - TERMINAL_STRIP_RAIL_H
              : getTerminalStripTopOffset(panel) + row * ROW_STRIDE),
        width: placement.width,
        height: previewRail ? TERMINAL_STRIP_RAIL_H : CELL_H,
        ref: placement.ref,
        invalid,
      })
    },
    [
      currentProject,
      detectHierarchyModuleDropTarget,
      isHierarchyRefInSelection,
      panelOptions,
      scene,
      selection.ids.length,
    ]
  )

  const handleHierarchyModuleDragEnd = useCallback(
    (
      surface: HierarchySurface,
      placement: ModulePlacement & { inSupplyPanel?: boolean },
      rawX: number,
      rawY: number,
      shiftKey = false
    ) => {
      logger.warn('[PanelCanvas hierarchy drag] handleHierarchyModuleDragEnd:start', {
        surfaceId: surface.id,
        panelId: surface.panel?.id ?? null,
        placementRef: placement.ref,
        rawX,
        rawY,
        selection: useUIStore.getState().selection,
      })
      const preview = moduleDragPreview
      setModuleDragPreview(null)
      setModuleDragLive(null)
      const panel = surface.panel ?? (surface.enclosure && panelOptions[0]
        ? { ...panelOptions[0].panel, gridView: surface.enclosure.gridView } : null)
      const surfaceTargetId = panel?.id ?? surface.id
      if (
        preview &&
        preview.surfaceId === surfaceTargetId &&
        preview.ref &&
        panelGridModuleRefKey(preview.ref) === panelGridModuleRefKey(placement.ref) &&
        preview.invalid
      ) {
        logger.warn('[PanelCanvas hierarchy drag] abort:invalid-preview')
        return
      }
      const key = panelGridModuleRefKey(placement.ref)
      const totalCols = placement.inSupplyPanel ? surface.supplyCols : surface.cols
      const totalRows = surface.rows
      const moduleCols = Math.max(
        MIN_PANEL_GRID_MODULE_WIDTH,
        normalizePanelModuleMeasure(placement.width / CELL_W)
      )
      const maxCol = Math.max(0, totalCols - moduleCols)
      const selectedPlacements =
        selection.ids.length >= 2 && isHierarchyRefInSelection(placement.ref)
          ? surface.placements.filter(
              (other) =>
                other.inSupplyPanel === placement.inSupplyPanel &&
                isHierarchyRefInSelection(other.ref)
            )
          : []

      if (placement.ref.kind === 'trunkDevice' && placement.ref.scope === 'supply') {
        const supplyRef = placement.ref
        if (preview?.invalid) return
        const canvasPos = { x: surface.x + rawX, y: surface.y + rawY }
        const detectedTarget = detectHierarchyModuleDropTarget(canvasPos, supplyRef)
        const target = detectedTarget
        const currentArea =
          surface.kind === 'auxiliary' ? 'auxiliary' : placement.inSupplyPanel ? 'supply' : 'main'
        const targetSurfaceId = target ? (target.surface.panel?.id ?? target.surface.id) : null
        const currentSurfaceId = surface.panel?.id ?? surface.id
        if (preview?.createAuxiliary) {
          const ownerPanelId = surface.enclosure?.ownerPanelId ?? surface.panel?.id
          const deviceIds = preview.deviceIds ?? [supplyRef.id]
          if (
            !ownerPanelId ||
            !currentProject ||
            deviceIds.length === 0 ||
            deviceIds.some(
              (deviceId) => !isAuxiliaryMountableSupplyDevice(currentProject, deviceId)
            )
          ) {
            return
          }
          const enclosureId = createAuxiliarySupplyEnclosure(deviceIds, ownerPanelId, {
            x: preview.x,
            y: preview.y,
          })
          if (enclosureId) setSelection({ type: 'auxiliaryEnclosure', ids: [enclosureId] })
          return
        }
        if (target && (targetSurfaceId !== currentSurfaceId || target.area !== currentArea)) {
          const targetCols =
            target.area === 'supply' ? target.surface.supplyCols : target.surface.cols
          const targetRows =
            target.area === 'supply' ? target.surface.supplyRows : target.surface.rows
          const targetMaxCol = Math.max(0, targetCols - moduleCols)
          const localX = canvasPos.x - target.surface.x - PANEL_FRAME_MARGIN
          const localY =
            target.area === 'supply'
              ? canvasPos.y - target.surface.y - target.surface.supplyPanelY - PANEL_FRAME_MARGIN
              : canvasPos.y - target.surface.y - target.surface.mainPanelY - PANEL_FRAME_MARGIN
          const snapped = snapToGrid(localX, localY + CELL_H / 2)
          const row = clamp(targetRows - 1, 0, snapped.row)
          const col = clamp(targetMaxCol, 0, snapped.col)
          if (target.area === 'auxiliary') {
            moveSupplyDeviceToAuxiliaryEnclosure(supplyRef.id, target.surface.id, row, col)
            return
          }

          if (target.area === 'supply') {
            moveSupplyDeviceToGridEnclosure(supplyRef.id, target.panel.id, row, col)
            return
          }
          moveSupplyDeviceToPanelEnclosure(supplyRef.id, target.panel.id, row, col)
          return
        }

        if (surface.kind === 'auxiliary') {
          const localX = rawX - PANEL_FRAME_MARGIN
          const localY = rawY - PANEL_FRAME_MARGIN
          const snapped = snapToGrid(localX, localY + CELL_H / 2)
          moveSupplyDeviceToAuxiliaryEnclosure(
            supplyRef.id,
            surface.id,
            clamp(snapped.row, 0, surface.rows - 1),
            clamp(maxCol, 0, snapped.col)
          )
          return
        }
      }

      if (placement.inSupplyPanel) {
        if (!panel) {
          if (
            placement.ref.kind !== 'trunkDevice' ||
            placement.ref.scope !== 'supply' ||
            !currentProject
          ) {
            logger.warn('[PanelCanvas hierarchy drag] abort:shared-supply-missing-context')
            return
          }
          const rootPanel = panelOptions.find((option) => option.isRoot)?.panel
          if (!rootPanel) return
          const existingSupplySlots = rootPanel.gridView?.supplyPanelSlots ?? []
          const draggedRef = placement.ref
          const sourceX = rawX
          const snappedCol = Math.max(
            0,
            Math.min(maxCol, Math.round((sourceX - PANEL_FRAME_MARGIN) / CELL_W))
          )
          const previousSlot = existingSupplySlots.find(
            (slot) => panelGridModuleRefKey(slot.module) === key
          )
          const collidedSlot = existingSupplySlots.find((slot) => {
            const slotKey = panelGridModuleRefKey(slot.module)
            if (slotKey === key) return false
            const width = Math.max(
              MIN_PANEL_GRID_MODULE_WIDTH,
              resolveModuleWidthCols(slot.module, currentProject, slot)
            )
            return snappedCol < slot.col + width && slot.col < snappedCol + moduleCols
          })
          const reorderedSupplySlots = existingSupplySlots.map((slot) => {
            const slotKey = panelGridModuleRefKey(slot.module)
            if (
              collidedSlot &&
              slotKey === panelGridModuleRefKey(collidedSlot.module) &&
              previousSlot
            ) {
              return {
                ...slot,
                row: previousSlot.row,
                col: previousSlot.col,
              }
            }
            return slot
          })
          const nextSupplySlots = upsertPanelGridSlotPosition(
            reorderedSupplySlots,
            draggedRef,
            0,
            snappedCol
          )
          logger.warn('[PanelCanvas hierarchy drag] shared-supply reorder:calc', {
            draggedId: draggedRef.id,
            snappedCol,
            sourceX,
            usedPreviewX: false,
            rawX,
            rootPanelId: rootPanel.id,
            surfaceSupplyIds: surface.placements
              .filter(
                (
                  p
                ): p is typeof p & { ref: { kind: 'trunkDevice'; id: string; scope: 'supply' } } =>
                  p.inSupplyPanel === true &&
                  p.ref.kind === 'trunkDevice' &&
                  p.ref.scope === 'supply'
              )
              .sort(
                (a, b) =>
                  a.col - b.col ||
                  panelGridModuleRefKey(a.ref).localeCompare(panelGridModuleRefKey(b.ref))
              )
              .map((p) => p.ref.id),
            existingSlotIds: existingSupplySlots.map((slot) =>
              slot.module.kind === 'trunkDevice'
                ? slot.module.id
                : panelGridModuleRefKey(slot.module)
            ),
            nextSlotIds: nextSupplySlots.map((slot) =>
              slot.module.kind === 'trunkDevice'
                ? slot.module.id
                : panelGridModuleRefKey(slot.module)
            ),
          })
          updateSupplyPanelSlots(rootPanel.id, nextSupplySlots)
          logger.warn('[PanelCanvas hierarchy drag] commit:shared-supply-reorder', {
            unchanged:
              existingSupplySlots.length === nextSupplySlots.length &&
              existingSupplySlots.every(
                (slot, index) =>
                  panelGridModuleRefKey(slot.module) ===
                    panelGridModuleRefKey(nextSupplySlots[index]?.module ?? slot.module) &&
                  slot.col === nextSupplySlots[index]?.col &&
                  slot.row === nextSupplySlots[index]?.row
              ),
          })
          return
        }
        const existingSupplySlots = panel.gridView?.supplyPanelSlots ?? []
        const previousSlot = existingSupplySlots.find(
          (slot) => panelGridModuleRefKey(slot.module) === key
        )
        const snappedSupply = snapToGrid(
          rawX - PANEL_FRAME_MARGIN,
          rawY - (surface.supplyPanelY + PANEL_FRAME_MARGIN) + CELL_H / 2
        )
        const row = clamp(surface.supplyRows - 1, 0, snappedSupply.row)
        const col = Math.max(0, Math.min(maxCol, Math.round((rawX - PANEL_FRAME_MARGIN) / CELL_W)))
        if (selectedPlacements.length >= 2) {
          const selectedKeys = new Set(
            selectedPlacements.map((selected) => panelGridModuleRefKey(selected.ref))
          )
          const deltaRow = row - placement.row
          const deltaCol = col - placement.col
          let nextSupplySlots = existingSupplySlots.map((slot) => {
            const slotKey = panelGridModuleRefKey(slot.module)
            if (!selectedKeys.has(slotKey)) return slot
            const selectedPlacement = selectedPlacements.find(
              (selected) => panelGridModuleRefKey(selected.ref) === slotKey
            )
            return {
              ...slot,
              row: (selectedPlacement?.row ?? slot.row) + deltaRow,
              col: (selectedPlacement?.col ?? slot.col) + deltaCol,
            }
          })
          for (const selectedPlacement of selectedPlacements) {
            nextSupplySlots = upsertPanelGridSlotPosition(
              nextSupplySlots,
              selectedPlacement.ref,
              selectedPlacement.row + deltaRow,
              selectedPlacement.col + deltaCol
            )
          }
          updateSupplyPanelSlots(panel.id, nextSupplySlots)
          logger.warn('[PanelCanvas hierarchy drag] commit:supply-multi', {
            selectedCount: selectedPlacements.length,
            afterCount: nextSupplySlots.length,
          })
          return
        }
        const collidedSlot = existingSupplySlots.find((slot) => {
          if (panelGridModuleRefKey(slot.module) === key) return false
          const width = Math.max(
            MIN_PANEL_GRID_MODULE_WIDTH,
            resolveModuleWidthCols(slot.module, currentProject, slot)
          )
          return col < slot.col + width && slot.col < col + moduleCols
        })
        const reorderedSupplySlots = existingSupplySlots.map((slot) => {
          const slotKey = panelGridModuleRefKey(slot.module)
          if (
            collidedSlot &&
            slotKey === panelGridModuleRefKey(collidedSlot.module) &&
            previousSlot
          ) {
            return {
              ...slot,
              row: previousSlot.row,
              col: previousSlot.col,
            }
          }
          return slot
        })
        const nextSupplySlots = upsertPanelGridSlotPosition(
          reorderedSupplySlots,
          placement.ref,
          row,
          col
        )
        updateSupplyPanelSlots(panel.id, nextSupplySlots)
        logger.warn('[PanelCanvas hierarchy drag] commit:supply-single', {
          afterCount: nextSupplySlots.length,
        })
        return
      }

      if (!panel) return

      const terminalStrip = currentProject
        ? resolveTerminalStripModule(currentProject, placement.ref)
        : undefined
      const isTerminalStrip = terminalStrip != null
      if (terminalStrip) {
        const canvasPos = { x: surface.x + rawX, y: surface.y + rawY }
        const target = detectHierarchyModuleDropTarget(canvasPos, placement.ref)
        const targetSurfaceId = target?.surface.panel?.id ?? target?.surface.id
        const currentSurfaceId = surface.panel?.id ?? surface.id
        if (
          (target?.area === 'main' || target?.area === 'auxiliary') &&
          (targetSurfaceId !== currentSurfaceId || target.area === 'auxiliary')
        ) {
          if (preview?.invalid) return
          const targetPanel = target.surface.enclosure
            ? { ...target.panel, gridView: target.surface.enclosure.gridView }
            : target.panel
          const localX = canvasPos.x - target.surface.x - PANEL_FRAME_MARGIN
          const panelLocalY = canvasPos.y - target.surface.y - target.surface.mainPanelY
          const topRail =
            targetPanel.gridView?.terminalStripTopRail === true &&
            panelLocalY <= PANEL_FRAME_MARGIN + TERMINAL_STRIP_RAIL_H + ROW_GAP / 2
          const bottomRail =
            targetPanel.gridView?.terminalStripBottomRail === true &&
            panelLocalY >=
              target.surface.panelFrameHeight -
                PANEL_FRAME_MARGIN -
                TERMINAL_STRIP_RAIL_H -
                ROW_GAP / 2
          const targetRail = topRail ? 'top' : bottomRail ? 'bottom' : undefined
          const localY = panelLocalY - PANEL_FRAME_MARGIN - getTerminalStripTopOffset(targetPanel)
          const snapped = snapToGrid(localX, localY + CELL_H / 2)
          const row = clamp(snapped.row, 0, target.surface.rows - 1)
          const col = snapTerminalStripPlacementCol(
            localX,
            moduleCols,
            Math.max(0, target.surface.cols - moduleCols),
            row,
            target.surface.placements.filter((other) => panelGridModuleRefKey(other.ref) !== key),
            shiftKey,
            targetRail
          )
          const sourceSlot = panel.gridView?.slots?.find(
            (candidate) => panelGridModuleRefKey(candidate.module) === key
          )
          const targetSlot: PanelGridSlot = {
            row: targetRail ? 0 : row,
            col,
            module: placement.ref,
            ...(targetRail ? { terminalStripRail: targetRail } : {}),
            ...(sourceSlot?.moduleWidthManual === true
              ? {
                  moduleWidth: sourceSlot.moduleWidth,
                  moduleWidthManual: true,
                }
              : {}),
          }
          if (moveTerminalStripToPanel(terminalStrip.id, targetPanel.id, targetSlot, target.surface.enclosure?.id)) {
            setSelection({
              type: terminalStrip.form === 'endpoint' ? 'endpoint' : 'trunkDevice',
              ids: [terminalStrip.id],
            })
          }
          return
        }
      }

      const existingMainSlots = panel.gridView?.slots ?? []
      const previousSlot = existingMainSlots.find(
        (slot) => panelGridModuleRefKey(slot.module) === key
      )
      const localX = rawX - PANEL_FRAME_MARGIN
      const panelLocalY = rawY - surface.mainPanelY
      const topRail =
        isTerminalStrip &&
        panel.gridView?.terminalStripTopRail === true &&
        panelLocalY <= PANEL_FRAME_MARGIN + TERMINAL_STRIP_RAIL_H + ROW_GAP / 2
      const bottomRail =
        isTerminalStrip &&
        panel.gridView?.terminalStripBottomRail === true &&
        panelLocalY >=
          surface.panelFrameHeight - PANEL_FRAME_MARGIN - TERMINAL_STRIP_RAIL_H - ROW_GAP / 2
      const targetTerminalRail = topRail ? 'top' : bottomRail ? 'bottom' : undefined
      const localY = panelLocalY - PANEL_FRAME_MARGIN - getTerminalStripTopOffset(panel)
      const snapped = snapToGrid(localX, localY + CELL_H / 2)
      const row = clamp(snapped.row, 0, totalRows - 1)
      const col = isTerminalStrip
        ? snapTerminalStripPlacementCol(
            localX,
            moduleCols,
            maxCol,
            row,
            surface.placements.filter(
              (other) => panelGridModuleRefKey(other.ref) !== key && !other.inSupplyPanel
            ),
            shiftKey,
            targetTerminalRail
          )
        : clamp(maxCol, 0, snapped.col)
      if (selectedPlacements.length >= 2) {
        const selectedKeys = new Set(
          selectedPlacements.map((selected) => panelGridModuleRefKey(selected.ref))
        )
        const deltaRow = row - placement.row
        const deltaCol = col - placement.col
        let nextMainSlots = existingMainSlots.map((slot) => {
          const slotKey = panelGridModuleRefKey(slot.module)
          if (!selectedKeys.has(slotKey)) return slot
          const selectedPlacement = selectedPlacements.find(
            (selected) => panelGridModuleRefKey(selected.ref) === slotKey
          )
          return {
            ...slot,
            row: (selectedPlacement?.row ?? slot.row) + deltaRow,
            col: (selectedPlacement?.col ?? slot.col) + deltaCol,
          }
        })
        for (const selectedPlacement of selectedPlacements) {
          nextMainSlots = upsertPanelGridSlotPosition(
            nextMainSlots,
            selectedPlacement.ref,
            selectedPlacement.row + deltaRow,
            selectedPlacement.col + deltaCol
          )
        }
        updatePanelGridSlots(panel.id, nextMainSlots)
        logger.warn('[PanelCanvas hierarchy drag] commit:main-multi', {
          selectedCount: selectedPlacements.length,
          afterCount: nextMainSlots.length,
        })
        return
      }
      const collidedSlot = existingMainSlots.find((slot) => {
        if (panelGridModuleRefKey(slot.module) === key) return false
        const width = Math.max(
          MIN_PANEL_GRID_MODULE_WIDTH,
          resolveModuleWidthCols(slot.module, currentProject, slot)
        )
        if (slot.terminalStripRail !== targetTerminalRail) return false
        if (!targetTerminalRail && slot.row !== row) return false
        return col < slot.col + width && slot.col < col + moduleCols
      })
      const reorderedMainSlots = existingMainSlots.map((slot) => {
        const slotKey = panelGridModuleRefKey(slot.module)
        if (
          collidedSlot &&
          slotKey === panelGridModuleRefKey(collidedSlot.module) &&
          previousSlot
        ) {
          return {
            ...slot,
            row: previousSlot.row,
            col: previousSlot.col,
          }
        }
        return slot
      })
      const nextMainSlots = upsertPanelGridSlotPosition(
        reorderedMainSlots,
        placement.ref,
        targetTerminalRail ? 0 : row,
        col,
        targetTerminalRail
      )
      updatePanelGridSlots(panel.id, nextMainSlots)
      logger.warn('[PanelCanvas hierarchy drag] commit:main-single', {
        afterCount: nextMainSlots.length,
      })
    },
    [
      currentProject,
      createAuxiliarySupplyEnclosure,
      detectHierarchyModuleDropTarget,
      isHierarchyRefInSelection,
      moduleDragPreview,
      moveSupplyDeviceToAuxiliaryEnclosure,
      moveSupplyDeviceToGridEnclosure,
      moveSupplyDeviceToPanelEnclosure,
      moveTerminalStripToPanel,
      panelOptions,
      selection.ids.length,
      updatePanelGridSlots,
      updateSupplyPanelSlots,
      setSelection,
    ]
  )

  /**
   * Panel-grid Alt-drag is deliberately limited to circuit-owned modules. Protection
   * duplication uses the established circuit-clone command; endpoint modules reuse the
   * normal endpoint duplication rules (including same-branch switches). Supply and
   * trunk devices are topology owners, so copying them here would create broken feeds.
   */
  const handleHierarchyModuleAltDuplicate = useCallback(
    (
      surface: HierarchySurface,
      placement: ModulePlacement & { inSupplyPanel?: boolean },
      rawX: number,
      rawY: number
    ) => {
      const preview = moduleDragPreview
      setModuleDragPreview(null)
      setModuleDragLive(null)
      const sourcePanel = surface.panel
      if (
        !currentProject ||
        !sourcePanel ||
        placement.inSupplyPanel ||
        preview?.invalid ||
        preview?.surfaceId !== sourcePanel.id
      ) {
        return
      }

      // No slot is created until the existing collision preview is valid.
      const localX = rawX - PANEL_FRAME_MARGIN
      const localY =
        rawY - surface.mainPanelY - PANEL_FRAME_MARGIN - getTerminalStripTopOffset(sourcePanel)
      const snapped = snapToGrid(localX, localY + CELL_H / 2)
      const moduleCols = Math.max(
        MIN_PANEL_GRID_MODULE_WIDTH,
        normalizePanelModuleMeasure(placement.width / CELL_W)
      )
      const row = clamp(snapped.row, 0, surface.rows - 1)
      const col = clamp(Math.max(0, surface.cols - moduleCols), 0, snapped.col)

      const store = useProjectStore.getState()
      let duplicateRef: PanelGridModuleRef | null = null

      if (placement.ref.kind === 'protection') {
        const protection = store.getProtectionById(placement.ref.id)
        if (!protection) return
        const protectionOwner = store.getPanelForProtection(placement.ref.id)
        if (protectionOwner?.id !== sourcePanel.id) return
        const newProtectionId = store.duplicateProtectionLeft(placement.ref.id, undefined, {
          copyCircuitContents: false,
        })
        if (!newProtectionId) return
        duplicateRef = { kind: 'protection', id: newProtectionId }
      } else if (placement.ref.kind === 'domotica') {
        const result = duplicateEndpointOnCircuit(
          currentProject,
          {
            circuitId: placement.ref.circuitId,
            sourceEndpointId: placement.ref.endpointId,
            context: 'plan',
          },
          {
            getCircuitById: store.getCircuitById,
            getEndpointById: store.getEndpointById,
            addEndpoint: store.addEndpoint,
            updateCircuit: store.updateCircuit,
            setSelection: undefined,
          }
        )
        if (!result.ok || !result.newEndpointId) return
        duplicateRef = {
          kind: 'domotica',
          endpointId: result.newEndpointId,
          circuitId: placement.ref.circuitId,
        }
      } else {
        return
      }

      const panelAfterDuplicate = store.getPanelById(sourcePanel.id)
      if (!panelAfterDuplicate) return
      const newKey = panelGridModuleRefKey(duplicateRef)
      const existingSlots = panelAfterDuplicate.gridView?.slots ?? []
      const nextSlots = existingSlots.map((slot) =>
        panelGridModuleRefKey(slot.module) === newKey ? { ...slot, row, col } : slot
      )
      if (!nextSlots.some((slot) => panelGridModuleRefKey(slot.module) === newKey)) {
        nextSlots.push({ row, col, module: duplicateRef })
      }
      store.updatePanelGridSlots(sourcePanel.id, nextSlots)
      setSelection(
        duplicateRef.kind === 'protection'
          ? { type: 'protection', ids: [duplicateRef.id] }
          : { type: 'endpoint', ids: [duplicateRef.endpointId] }
      )
    },
    [currentProject, moduleDragPreview, setSelection]
  )

  const handleHierarchyModuleResize = useCallback(
    (
      surface: HierarchySurface,
      placement: ModulePlacement & { inSupplyPanel?: boolean },
      newWidthCols: number
    ) => {
      const panel = surface.panel
      const key = panelGridModuleRefKey(placement.ref)

      if (placement.ref.kind === 'domotica') {
        const endpoint = useProjectStore.getState().getEndpointById(placement.ref.endpointId)
        if (endpoint && isModularSocket(endpoint)) {
          const maxWidthCols = Math.max(2, (placement.inSupplyPanel ? surface.supplyCols : surface.cols) - placement.col)
          const snappedWidth = snapModularSocketModuleWidthWithin(newWidthCols, maxWidthCols)
          const nextCount = socketCountForModularWidth(snappedWidth)
          if (getModularSocketCount(endpoint) !== nextCount) {
            updateEndpoint(placement.ref.endpointId, {
              socketProps: withModularSocketProps(endpoint.socketProps, nextCount),
            })
          }
          return
        }
      }

      if (surface.kind === 'auxiliary' && surface.enclosure) {
        updateAuxiliaryElectricalEnclosure(surface.id, {
          gridView: {
            ...surface.enclosure.gridView,
            slots: surface.enclosure.gridView.slots.map((slot) =>
              panelGridModuleRefKey(slot.module) === key
                ? { ...slot, moduleWidth: newWidthCols, moduleWidthManual: true }
                : slot
            ),
          },
        })
        return
      }
      if (!panel) return

      if (placement.inSupplyPanel) {
        const existingSupplySlots = panel.gridView?.supplyPanelSlots ?? []
        const nextSupplySlots: PanelGridSlot[] = existingSupplySlots.map((slot) =>
          panelGridModuleRefKey(slot.module) === key
            ? { ...slot, moduleWidth: newWidthCols, moduleWidthManual: true }
            : slot
        )
        updateSupplyPanelSlots(panel.id, nextSupplySlots)
        return
      }

      const existingMainSlots = panel.gridView?.slots ?? []
      let found = false
      const nextMainSlots: PanelGridSlot[] = existingMainSlots.map((slot) => {
        if (panelGridModuleRefKey(slot.module) === key) {
          found = true
          return { ...slot, moduleWidth: newWidthCols, moduleWidthManual: true }
        }
        return slot
      })
      if (!found) {
        nextMainSlots.push({
          row: placement.row,
          col: placement.col,
          module: placement.ref,
          moduleWidth: newWidthCols,
          moduleWidthManual: true,
        })
      }
      updatePanelGridSlots(panel.id, nextMainSlots)
    },
    [updateAuxiliaryElectricalEnclosure, updateEndpoint, updatePanelGridSlots, updateSupplyPanelSlots]
  )

  const getHierarchyMaxWidth = useCallback(
    (surface: HierarchySurface, placement: ModulePlacement & { inSupplyPanel?: boolean }) => {
      const totalCols = placement.inSupplyPanel ? surface.supplyCols : surface.cols
      const remaining = Math.max(1, totalCols - placement.col)
      if (placement.ref.kind === 'domotica') {
        const endpoint = useProjectStore.getState().getEndpointById(placement.ref.endpointId)
        if (isModularSocket(endpoint)) {
          return Math.min(4, remaining)
        }
      }
      return remaining
    },
    []
  )

  const isHierarchyResizeWidthValid = useCallback(
    (
      surface: HierarchySurface,
      placement: ModulePlacement & { inSupplyPanel?: boolean },
      newWidthCols: number
    ) =>
      canResizeModulePlacement(
        placement,
        surface.placements,
        newWidthCols,
        placement.inSupplyPanel ? surface.supplyCols : surface.cols
      ),
    []
  )

  const selectedSharedFeederKey = useMemo(() => {
    if (!scene || !selectedRef) return null
    const sharedSurface = scene.surfaces.find((surface) => surface.kind === 'shared_supply')
    const lastPlacement = sharedSurface?.placements[sharedSurface.placements.length - 1]
    if (!lastPlacement) return null
    return panelGridModuleRefKey(lastPlacement.ref) === panelGridModuleRefKey(selectedRef)
      ? panelGridModuleRefKey(lastPlacement.ref)
      : null
  }, [scene, selectedRef])

  useEffect(() => {
    const node = connectorGroupRef.current
    if (!node) return
    const tween = new Konva.Tween({
      node,
      duration: 0.18,
      opacity: selectedSharedFeederKey ? 0.18 : 1,
    })
    tween.play()
    return () => tween.destroy()
  }, [selectedSharedFeederKey])

  return (
    <>
      <BaseCanvas
        ref={canvasRef}
        gestureZoomCanvas="panel"
        zoom={panelZoom}
        pan={panelPan}
        onZoomChange={handleZoomChange}
        onPanChange={handlePanChange}
        onViewTransformCommit={handleViewTransformCommit}
        onFindElementsInRectangle={
          libraryInteraction?.onFindElementsInRectangle ?? onFindHierarchyElementsInRectangle
        }
        onGetSelectionBounds={
          libraryInteraction?.onGetSelectionBounds ?? handleGetHierarchySelectionBounds
        }
        onGetContextMenuItems={libraryInteraction?.onGetContextMenuItems}
        longPressDragSelectFromContent
        selectionFitMaxZoom={ZOOM_100}
        showGrid={false}
        gridSize={24}
        onDragOver={
          canPlaceSymbols ? (libraryInteraction?.onDragOver ?? handleHierarchyDragOver) : undefined
        }
        onDrop={canPlaceSymbols ? (libraryInteraction?.onDrop ?? handleHierarchyDrop) : undefined}
        onMultiFingerSwipe={onMultiFingerSwipe}
        
      >
        <Group name="canvas-content">
          {scene && (
            <Group ref={connectorGroupRef} opacity={1}>
              {scene.connectors.map((connector, index) => (
                <Line
                  key={`hierarchy-connector-${index}`}
                  points={connector.points}
                  stroke={colors.supplyWire}
                  strokeWidth={1.5}
                  dash={[8, 4]}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
              ))}
            </Group>
          )}

          {scene?.surfaces.map((surface) => (
            <Group
              key={surface.id}
              x={surface.x}
              y={surface.y}
              name={`hierarchy-surface hierarchy-surface-${surface.id}`}
            >
              {surface.kind === 'shared_supply' ? (
                <Group>
                  <Rect
                    x={0}
                    y={0}
                    width={surface.width}
                    height={surface.height}
                    stroke={selectedSupplyPanelIds.includes(PANEL_SCENE_SHARED_SUPPLY_ID)
                      ? colors.moduleBorderSelected : colors.panelSupplyStroke}
                    strokeWidth={3}
                    fill={colors.panelFrameFill}
                    cornerRadius={4}
                    listening={!labelMode}
                    name={`supplyPanel-${PANEL_SCENE_SHARED_SUPPLY_ID}`}
                    onMouseDown={startPanelFrameSelectionRect}
                    onClick={(event) => {
                      event.cancelBubble = true
                      if (shouldIgnorePanelFrameClick(event.evt)) return
                      setSelection({ type: 'supplyPanel', ids: [PANEL_SCENE_SHARED_SUPPLY_ID] })
                    }}
                    onTap={(event) => {
                      event.cancelBubble = true
                      setSelection({ type: 'supplyPanel', ids: [PANEL_SCENE_SHARED_SUPPLY_ID] })
                    }}
                  />
                  <Text
                    x={8}
                    y={8}
                    text={t('panelCanvas.supplyPanel', 'Grid panel')}
                    fontSize={14}
                    fontStyle="bold"
                    fontFamily={fontFamily}
                    fill={colors.panelFrameStroke}
                    listening={false}
                  />
                  <Rect
                    x={PANEL_FRAME_MARGIN}
                    y={PANEL_FRAME_MARGIN}
                    width={surface.contentWidth}
                    height={CELL_H}
                    fill="transparent"
                    stroke={colors.panelFrameStroke}
                    opacity={0.18}
                    strokeWidth={1}
                    listening={false}
                  />
                  {Array.from({ length: surface.cols + 1 }).map((_, colIndex) => (
                    <Line
                      key={`shared-col-${colIndex}`}
                      points={[
                        PANEL_FRAME_MARGIN + colIndex * CELL_W,
                        PANEL_FRAME_MARGIN,
                        PANEL_FRAME_MARGIN + colIndex * CELL_W,
                        PANEL_FRAME_MARGIN + CELL_H,
                      ]}
                      stroke={colors.panelFrameStroke}
                      opacity={0.08}
                      strokeWidth={0.75}
                      listening={false}
                    />
                  ))}
                  {(() => {
                    const firstPlacement = surface.placements[0]
                    const symbolX = firstPlacement
                      ? firstPlacement.x + firstPlacement.width / 2
                      : PANEL_FRAME_MARGIN + surface.contentWidth / 2
                    const symbolY = surface.feedFromTop ? -20 : surface.height + 20
                    const wireStartY = surface.feedFromTop
                      ? PANEL_FRAME_MARGIN
                      : PANEL_FRAME_MARGIN + CELL_H
                    return (
                      <>
                        <Line
                          points={[symbolX, wireStartY, symbolX, symbolY]}
                          stroke={colors.supplyWire}
                          strokeWidth={1.5}
                          dash={[8, 4]}
                          lineCap="round"
                          lineJoin="round"
                          listening={false}
                        />
                        <SupplySymbol x={symbolX} y={symbolY} />
                      </>
                    )
                  })()}
                </Group>
              ) : surface.kind === 'auxiliary' || surface.kind === 'junction_panel' ? (
                <>
                  <Rect
                    x={0}
                    y={0}
                    width={surface.width}
                    height={surface.height}
                    stroke={
                      (surface.kind === 'auxiliary' &&
                        selectedAuxiliaryEnclosureIds.includes(surface.id)) ||
                      (surface.kind === 'junction_panel' &&
                        surface.placements.some(
                          (placement) =>
                            placement.ref.kind === 'trunkDevice' &&
                            selection.type === 'trunkDevice' &&
                            selection.ids.includes(placement.ref.id)
                        ))
                        ? colors.moduleBorderSelected
                        : colors.panelSupplyStroke
                    }
                    strokeWidth={
                      (surface.kind === 'auxiliary' &&
                        selectedAuxiliaryEnclosureIds.includes(surface.id)) ||
                      (surface.kind === 'junction_panel' &&
                        surface.placements.some(
                          (placement) =>
                            placement.ref.kind === 'trunkDevice' &&
                            selection.type === 'trunkDevice' &&
                            selection.ids.includes(placement.ref.id)
                        ))
                        ? 3
                        : 2
                    }
                    fill={colors.panelFrameFill}
                    cornerRadius={4}
                    listening={!labelMode}
                    name={
                      surface.kind === 'auxiliary' ? `auxiliaryEnclosure-${surface.id}` : undefined
                    }
                    onMouseDown={
                      surface.kind === 'auxiliary' ? startPanelFrameSelectionRect : undefined
                    }
                    onClick={
                      surface.kind === 'auxiliary'
                        ? (event) => {
                            if (shouldIgnorePanelFrameClick(event.evt)) {
                              event.cancelBubble = true
                              return
                            }
                            event.cancelBubble = true
                            setSelection({ type: 'auxiliaryEnclosure', ids: [surface.id] })
                          }
                        : surface.kind === 'junction_panel'
                          ? (event) => {
                              event.cancelBubble = true
                              setSelection({
                                type: 'trunkDevice',
                                ids: surface.placements.flatMap((placement) =>
                                  placement.ref.kind === 'trunkDevice' ? [placement.ref.id] : []
                                ),
                              })
                            }
                          : undefined
                    }
                    onTap={
                      surface.kind === 'auxiliary'
                        ? (event) => {
                            event.cancelBubble = true
                            setSelection({ type: 'auxiliaryEnclosure', ids: [surface.id] })
                          }
                        : surface.kind === 'junction_panel'
                          ? (event) => {
                              event.cancelBubble = true
                              setSelection({
                                type: 'trunkDevice',
                                ids: surface.placements.flatMap((placement) =>
                                  placement.ref.kind === 'trunkDevice' ? [placement.ref.id] : []
                                ),
                              })
                            }
                          : undefined
                    }
                  />
                  <Text
                    x={8}
                    y={8}
                    width={surface.width - 16}
                    text={surface.label || t('panelCanvas.virtualEnclosure', 'Supply enclosure')}
                    fontSize={14}
                    fontStyle="bold"
                    fontFamily={fontFamily}
                    fill={colors.panelFrameStroke}
                    listening={false}
                  />
                  {((surface.kind === 'junction_panel' &&
                    surface.junctionPanelGridView?.terminalStripTopRail) ||
                    (surface.kind === 'auxiliary' && surface.enclosure?.gridView.terminalStripTopRail)) && (
                      <Rect
                        x={PANEL_FRAME_MARGIN}
                        y={PANEL_FRAME_MARGIN}
                        width={surface.contentWidth}
                        height={TERMINAL_STRIP_RAIL_H}
                        fill="transparent"
                        stroke={colors.panelFrameStroke}
                        opacity={0.2}
                        strokeWidth={1}
                        listening={false}
                      />
                    )}
                  {Array.from({ length: surface.rows }).map((_, rowIndex) => (
                    <Rect
                      key={`auxiliary-rail-${surface.id}-${rowIndex}`}
                      x={PANEL_FRAME_MARGIN}
                      y={
                        PANEL_FRAME_MARGIN +
                        ((surface.kind === 'junction_panel' &&
                        surface.junctionPanelGridView?.terminalStripTopRail) ||
                        (surface.kind === 'auxiliary' && surface.enclosure?.gridView.terminalStripTopRail)
                          ? TERMINAL_STRIP_RAIL_H + ROW_GAP
                          : 0) +
                        rowIndex * ROW_STRIDE
                      }
                      width={surface.contentWidth}
                      height={CELL_H}
                      fill="transparent"
                      stroke={colors.panelFrameStroke}
                      opacity={0.16}
                      strokeWidth={1}
                      listening={false}
                    />
                  ))}
                  {Array.from({ length: surface.rows }).map((_, rowIndex) =>
                    Array.from({ length: surface.cols + 1 }).map((_, colIndex) => (
                      <Line
                        key={`auxiliary-grid-${surface.id}-${rowIndex}-${colIndex}`}
                        points={[
                          PANEL_FRAME_MARGIN + colIndex * CELL_W,
                          PANEL_FRAME_MARGIN +
                            ((surface.kind === 'junction_panel' &&
                            surface.junctionPanelGridView?.terminalStripTopRail) ||
                            (surface.kind === 'auxiliary' && surface.enclosure?.gridView.terminalStripTopRail)
                              ? TERMINAL_STRIP_RAIL_H + ROW_GAP
                              : 0) +
                            rowIndex * ROW_STRIDE,
                          PANEL_FRAME_MARGIN + colIndex * CELL_W,
                          PANEL_FRAME_MARGIN +
                            ((surface.kind === 'junction_panel' &&
                            surface.junctionPanelGridView?.terminalStripTopRail) ||
                            (surface.kind === 'auxiliary' && surface.enclosure?.gridView.terminalStripTopRail)
                              ? TERMINAL_STRIP_RAIL_H + ROW_GAP
                              : 0) +
                            rowIndex * ROW_STRIDE +
                            CELL_H,
                        ]}
                        stroke={colors.panelFrameStroke}
                        opacity={0.08}
                        strokeWidth={0.75}
                        listening={false}
                      />
                    ))
                  )}
                  {((surface.kind === 'junction_panel' &&
                    surface.junctionPanelGridView?.terminalStripBottomRail) ||
                    (surface.kind === 'auxiliary' && surface.enclosure?.gridView.terminalStripBottomRail)) && (
                      <Rect
                        x={PANEL_FRAME_MARGIN}
                        y={surface.height - PANEL_FRAME_MARGIN - TERMINAL_STRIP_RAIL_H}
                        width={surface.contentWidth}
                        height={TERMINAL_STRIP_RAIL_H}
                        fill="transparent"
                        stroke={colors.panelFrameStroke}
                        opacity={0.2}
                        strokeWidth={1}
                        listening={false}
                      />
                    )}
                  {(surface.kind === 'junction_panel' || surface.kind === 'auxiliary') &&
                    canDragItems &&
                    (surface.kind === 'auxiliary'
                      ? selectedAuxiliaryEnclosureIds.includes(surface.id)
                      : surface.placements.some(
                          (placement) =>
                            placement.ref.kind === 'trunkDevice' &&
                            selection.type === 'trunkDevice' &&
                            selection.ids.includes(placement.ref.id)
                        )) && (
                      <>
                        {panelFrameResizePreview?.panelId === surface.id && (
                          <>
                            <Rect
                              x={panelFrameResizePreview.x}
                              y={panelFrameResizePreview.y}
                              width={panelFrameResizePreview.width}
                              height={panelFrameResizePreview.height}
                              fill="transparent"
                              stroke={colors.moduleBorderSelected}
                              strokeWidth={2}
                              dash={[7, 5]}
                              cornerRadius={4}
                              listening={false}
                            />
                            <Group
                              x={
                                panelFrameResizePreview.axis === 'columns'
                                  ? panelFrameResizePreview.width + 10
                                  : panelFrameResizePreview.width / 2 - 30
                              }
                              y={
                                panelFrameResizePreview.axis === 'columns'
                                  ? panelFrameResizePreview.height / 2 - 10
                                  : panelFrameResizePreview.y - 26
                              }
                              listening={false}
                            >
                              <Rect
                                width={60}
                                height={20}
                                fill={colors.panelFrameFill}
                                stroke={colors.moduleBorderSelected}
                                strokeWidth={1}
                                cornerRadius={6}
                              />
                              <Text
                                x={4}
                                y={4}
                                width={52}
                                height={12}
                                text={`${panelFrameResizePreview.axis === 'rows' ? t('panelCanvas.rows', 'Rows') : t('panelCanvas.columns', 'Columns')} ${panelFrameResizePreview.value}`}
                                fontSize={8}
                                fontStyle="bold"
                                fontFamily={fontFamily}
                                fill={colors.moduleText}
                                align="center"
                              />
                            </Group>
                          </>
                        )}
                        <Rect
                          x={surface.width - 3}
                          y={surface.height / 2 - 16}
                          width={6}
                          height={32}
                          fill="#0284c7"
                          cornerRadius={3}
                          stroke="#0284c7"
                          strokeWidth={1}
                          hitStrokeWidth={touchHandleHitStrokeWidth}
                          draggable
                          onDragMove={(event) => {
                            event.cancelBubble = true
                            previewJunctionPanelFrameResize(
                              surface,
                              'columns',
                              event.target.x() - (surface.width - 3)
                            )
                            event.target.y(surface.height / 2 - 16)
                          }}
                          onDragEnd={(event) => {
                            event.cancelBubble = true
                            event.target.position({
                              x: surface.width - 3,
                              y: surface.height / 2 - 16,
                            })
                            commitJunctionPanelFrameResize(surface)
                          }}
                          onMouseEnter={(event) => {
                            const stage = event.target.getStage()
                            if (stage) stage.container().style.cursor = 'ew-resize'
                          }}
                          onMouseLeave={(event) => {
                            const stage = event.target.getStage()
                            if (stage) stage.container().style.cursor = ''
                          }}
                        />
                        <Rect
                          x={surface.width / 2 - 16}
                          y={-3}
                          width={32}
                          height={6}
                          fill="#0284c7"
                          cornerRadius={3}
                          stroke="#0284c7"
                          strokeWidth={1}
                          hitStrokeWidth={touchHandleHitStrokeWidth}
                          draggable
                          onDragMove={(event) => {
                            event.cancelBubble = true
                            previewJunctionPanelFrameResize(surface, 'rows', -event.target.y() - 3)
                            event.target.x(surface.width / 2 - 16)
                          }}
                          onDragEnd={(event) => {
                            event.cancelBubble = true
                            event.target.position({ x: surface.width / 2 - 16, y: -3 })
                            commitJunctionPanelFrameResize(surface)
                          }}
                          onMouseEnter={(event) => {
                            const stage = event.target.getStage()
                            if (stage) stage.container().style.cursor = 'ns-resize'
                          }}
                          onMouseLeave={(event) => {
                            const stage = event.target.getStage()
                            if (stage) stage.container().style.cursor = ''
                          }}
                        />
                      </>
                    )}
                </>
              ) : (
                <>
                  <Rect
                    x={-HIERARCHY_PANEL_FRAME_HIT_MARGIN}
                    y={
                      surface.mainPanelY -
                      Math.max(
                        HIERARCHY_PANEL_FRAME_HIT_MARGIN,
                        HIERARCHY_PANEL_FRAME_TITLE_HIT_HEIGHT
                      )
                    }
                    width={surface.width + HIERARCHY_PANEL_FRAME_HIT_MARGIN * 2}
                    height={
                      surface.panelFrameHeight +
                      HIERARCHY_PANEL_FRAME_HIT_MARGIN +
                      Math.max(
                        HIERARCHY_PANEL_FRAME_HIT_MARGIN,
                        HIERARCHY_PANEL_FRAME_TITLE_HIT_HEIGHT
                      )
                    }
                    fill="rgba(0,0,0,0.001)"
                    stroke="transparent"
                    strokeWidth={0}
                    cornerRadius={4}
                    name={`panel-${surface.panel?.id ?? surface.id}`}
                    listening={!labelMode}
                    onMouseDown={startPanelFrameSelectionRect}
                    onClick={(e) => {
                      if (!surface.panel) return
                      if (shouldIgnorePanelFrameClick(e.evt)) {
                        e.cancelBubble = true
                        return
                      }
                      e.cancelBubble = true
                      handleHierarchyPanelSelect(surface.panel.id, e.evt)
                    }}
                    onTap={(e) => {
                      if (!surface.panel) return
                      e.cancelBubble = true
                      handleHierarchyPanelSelect(surface.panel.id, e.evt)
                    }}
                  />
                  {surface.supplyPanelVisible && (
                    <>
                      <Group listening={false}>
                        <Rect
                          x={0}
                          y={surface.supplyPanelY}
                          width={surface.width}
                          height={surface.supplyFrameHeight}
                          stroke={colors.panelSupplyStroke}
                          strokeWidth={3}
                          fill={colors.panelFrameFill}
                          cornerRadius={4}
                          listening={false}
                        />
                        <Text
                          x={8}
                          y={surface.supplyPanelY + 8}
                          text={t('panelCanvas.supplyPanel', 'Grid panel')}
                          fontSize={14}
                          fontStyle="bold"
                          fontFamily={fontFamily}
                          fill={colors.panelFrameStroke}
                          listening={false}
                        />
                        <Rect
                          x={PANEL_FRAME_MARGIN}
                          y={surface.supplyPanelY + PANEL_FRAME_MARGIN}
                          width={surface.supplyContentWidth}
                          height={
                            surface.supplyRows * CELL_H +
                            Math.max(0, surface.supplyRows - 1) * ROW_GAP
                          }
                          fill="transparent"
                          stroke={colors.panelFrameStroke}
                          opacity={0.12}
                          strokeWidth={1}
                          listening={false}
                        />
                        {Array.from({ length: surface.supplyCols + 1 }).map((_, colIndex) => (
                          <Line
                            key={`supply-col-${surface.id}-${colIndex}`}
                            points={[
                              PANEL_FRAME_MARGIN + colIndex * CELL_W,
                              surface.supplyPanelY + PANEL_FRAME_MARGIN,
                              PANEL_FRAME_MARGIN + colIndex * CELL_W,
                              surface.supplyPanelY +
                                PANEL_FRAME_MARGIN +
                                surface.supplyRows * CELL_H +
                                Math.max(0, surface.supplyRows - 1) * ROW_GAP,
                            ]}
                            stroke={colors.panelFrameStroke}
                            opacity={0.08}
                            strokeWidth={0.75}
                            listening={false}
                          />
                        ))}
                        {Array.from({ length: Math.max(0, surface.supplyRows - 1) }).map(
                          (_, rowIndex) => (
                            <Line
                              key={`supply-row-${surface.id}-${rowIndex}`}
                              points={[
                                PANEL_FRAME_MARGIN,
                                surface.supplyPanelY +
                                  PANEL_FRAME_MARGIN +
                                  (rowIndex + 1) * ROW_STRIDE -
                                  ROW_GAP,
                                PANEL_FRAME_MARGIN + surface.supplyContentWidth,
                                surface.supplyPanelY +
                                  PANEL_FRAME_MARGIN +
                                  (rowIndex + 1) * ROW_STRIDE -
                                  ROW_GAP,
                              ]}
                              stroke={colors.panelFrameStroke}
                              opacity={0.08}
                              strokeWidth={0.75}
                              listening={false}
                            />
                          )
                        )}
                      </Group>
                      <Rect
                        x={0}
                        y={surface.supplyPanelY}
                        width={surface.width}
                        height={surface.supplyFrameHeight}
                        name={`supplyPanel-${surface.panel?.id ?? surface.id}`}
                        fill="transparent"
                        stroke="transparent"
                        strokeWidth={0}
                        cornerRadius={4}
                        listening={!labelMode}
                        onMouseDown={labelMode ? undefined : startPanelFrameSelectionRect}
                        onClick={(e) => {
                          if (labelMode) return
                          if (!surface.panel) return
                          if (shouldIgnorePanelFrameClick(e.evt)) {
                            e.cancelBubble = true
                            return
                          }
                          e.cancelBubble = true
                          setSelection({ type: 'supplyPanel', ids: [surface.panel.id] })
                        }}
                        onTap={(e) => {
                          if (labelMode) return
                          if (!surface.panel) return
                          e.cancelBubble = true
                          setSelection({ type: 'supplyPanel', ids: [surface.panel.id] })
                        }}
                      />
                    </>
                  )}
                  <Group y={surface.mainPanelY} listening={false}>
                    <Rect
                      x={0}
                      y={0}
                      width={surface.width}
                      height={surface.panelFrameHeight}
                      stroke={colors.panelFrameStroke}
                      strokeWidth={3}
                      fill={colors.panelFrameFill}
                      cornerRadius={4}
                      listening={false}
                    />
                    <Text
                      x={8}
                      y={8}
                      text={surface.label}
                      fontSize={14}
                      fontStyle="bold"
                      fontFamily={fontFamily}
                      fill={colors.panelFrameStroke}
                      listening={false}
                    />
                    {surface.panel?.gridView?.terminalStripTopRail && (
                      <Rect
                        x={PANEL_FRAME_MARGIN}
                        y={PANEL_FRAME_MARGIN}
                        width={surface.contentWidth}
                        height={TERMINAL_STRIP_RAIL_H}
                        fill="transparent"
                        stroke={colors.panelFrameStroke}
                        opacity={0.18}
                        strokeWidth={1}
                        listening={false}
                      />
                    )}
                    {Array.from({ length: surface.rows }).map((_, rowIndex) => (
                      <Rect
                        key={`rail-${surface.id}-${rowIndex}`}
                        x={PANEL_FRAME_MARGIN}
                        y={
                          PANEL_FRAME_MARGIN +
                          getTerminalStripTopOffset(surface.panel) +
                          rowIndex * (CELL_H + ROW_GAP)
                        }
                        width={surface.contentWidth}
                        height={CELL_H}
                        fill="transparent"
                        stroke={colors.panelFrameStroke}
                        opacity={0.12}
                        strokeWidth={1}
                        listening={false}
                      />
                    ))}
                    {Array.from({ length: surface.rows }).map((_, rowIndex) =>
                      Array.from({ length: surface.cols + 1 }).map((_, colIndex) => (
                        <Line
                          key={`grid-${surface.id}-${rowIndex}-${colIndex}`}
                          points={[
                            PANEL_FRAME_MARGIN + colIndex * CELL_W,
                            PANEL_FRAME_MARGIN +
                              getTerminalStripTopOffset(surface.panel) +
                              rowIndex * (CELL_H + ROW_GAP),
                            PANEL_FRAME_MARGIN + colIndex * CELL_W,
                            PANEL_FRAME_MARGIN +
                              getTerminalStripTopOffset(surface.panel) +
                              rowIndex * (CELL_H + ROW_GAP) +
                              CELL_H,
                          ]}
                          stroke={colors.panelFrameStroke}
                          opacity={0.08}
                          strokeWidth={0.75}
                          listening={false}
                        />
                      ))
                    )}
                    {surface.panel?.gridView?.terminalStripBottomRail && (
                      <Rect
                        x={PANEL_FRAME_MARGIN}
                        y={surface.panelFrameHeight - PANEL_FRAME_MARGIN - TERMINAL_STRIP_RAIL_H}
                        width={surface.contentWidth}
                        height={TERMINAL_STRIP_RAIL_H}
                        fill="transparent"
                        stroke={colors.panelFrameStroke}
                        opacity={0.18}
                        strokeWidth={1}
                        listening={false}
                      />
                    )}
                  </Group>
                  <Rect
                    x={0}
                    y={surface.mainPanelY}
                    width={surface.width}
                    height={surface.panelFrameHeight}
                    fill="transparent"
                    stroke={
                      selectedPanelIds.includes(surface.panel?.id ?? '')
                        ? colors.moduleBorderSelected
                        : 'transparent'
                    }
                    strokeWidth={selectedPanelIds.includes(surface.panel?.id ?? '') ? 2 : 0}
                    cornerRadius={4}
                    listening={false}
                  />
                  {surface.panel && selectedPanelIds.includes(surface.panel.id) && canDragItems && (
                    <>
                      {panelFrameResizePreview?.panelId === surface.panel.id && (
                        <>
                          <Rect
                            x={panelFrameResizePreview.x}
                            y={panelFrameResizePreview.y}
                            width={panelFrameResizePreview.width}
                            height={panelFrameResizePreview.height}
                            fill="transparent"
                            stroke={colors.moduleBorderSelected}
                            strokeWidth={2}
                            dash={[7, 5]}
                            cornerRadius={4}
                            listening={false}
                          />
                          <Group
                            x={
                              panelFrameResizePreview.axis === 'columns'
                                ? panelFrameResizePreview.width + 10
                                : panelFrameResizePreview.width / 2 - 30
                            }
                            y={
                              panelFrameResizePreview.axis === 'columns'
                                ? panelFrameResizePreview.y +
                                  panelFrameResizePreview.height / 2 -
                                  10
                                : panelFrameResizePreview.y - 26
                            }
                            listening={false}
                          >
                            <Rect
                              width={60}
                              height={20}
                              fill={colors.panelFrameFill}
                              stroke={colors.moduleBorderSelected}
                              strokeWidth={1}
                              cornerRadius={6}
                            />
                            <Text
                              x={4}
                              y={4}
                              width={52}
                              height={12}
                              text={`${panelFrameResizePreview.axis === 'rows' ? t('panelCanvas.rows', 'Rows') : t('panelCanvas.columns', 'Columns')} ${panelFrameResizePreview.value}`}
                              fontSize={8}
                              fontStyle="bold"
                              fontFamily={fontFamily}
                              fill={colors.moduleText}
                              align="center"
                            />
                          </Group>
                        </>
                      )}
                      <Rect
                        x={surface.width - 3}
                        y={surface.mainPanelY + surface.panelFrameHeight / 2 - 16}
                        width={6}
                        height={32}
                        fill="#0284c7"
                        cornerRadius={3}
                        stroke="#0284c7"
                        strokeWidth={1}
                        hitStrokeWidth={touchHandleHitStrokeWidth}
                        draggable
                        onMouseDown={(event) => {
                          event.cancelBubble = true
                        }}
                        onDragStart={(event) => {
                          event.cancelBubble = true
                          panelFrameResizePreviewRef.current = null
                          setPanelFrameResizePreview(null)
                        }}
                        onDragMove={(event) => {
                          event.cancelBubble = true
                          previewPanelFrameResize(
                            surface as HierarchySurface & { panel: Panel },
                            'columns',
                            event.target.x() - (surface.width - 3)
                          )
                          event.target.y(surface.mainPanelY + surface.panelFrameHeight / 2 - 16)
                        }}
                        onDragEnd={(event) => {
                          event.cancelBubble = true
                          event.target.position({
                            x: surface.width - 3,
                            y: surface.mainPanelY + surface.panelFrameHeight / 2 - 16,
                          })
                          commitPanelFrameResize(surface as HierarchySurface & { panel: Panel })
                        }}
                        onMouseEnter={(event) => {
                          const stage = event.target.getStage()
                          if (stage) stage.container().style.cursor = 'ew-resize'
                        }}
                        onMouseLeave={(event) => {
                          const stage = event.target.getStage()
                          if (stage) stage.container().style.cursor = ''
                        }}
                      />
                      <Rect
                        x={surface.width / 2 - 16}
                        y={surface.mainPanelY - 3}
                        width={32}
                        height={6}
                        fill="#0284c7"
                        cornerRadius={3}
                        stroke="#0284c7"
                        strokeWidth={1}
                        hitStrokeWidth={touchHandleHitStrokeWidth}
                        draggable
                        onMouseDown={(event) => {
                          event.cancelBubble = true
                        }}
                        onDragStart={(event) => {
                          event.cancelBubble = true
                          panelFrameResizePreviewRef.current = null
                          setPanelFrameResizePreview(null)
                        }}
                        onDragMove={(event) => {
                          event.cancelBubble = true
                          previewPanelFrameResize(
                            surface as HierarchySurface & { panel: Panel },
                            'rows',
                            surface.mainPanelY - 3 - event.target.y()
                          )
                          event.target.x(surface.width / 2 - 16)
                        }}
                        onDragEnd={(event) => {
                          event.cancelBubble = true
                          event.target.position({
                            x: surface.width / 2 - 16,
                            y: surface.mainPanelY - 3,
                          })
                          commitPanelFrameResize(surface as HierarchySurface & { panel: Panel })
                        }}
                        onMouseEnter={(event) => {
                          const stage = event.target.getStage()
                          if (stage) stage.container().style.cursor = 'ns-resize'
                        }}
                        onMouseLeave={(event) => {
                          const stage = event.target.getStage()
                          if (stage) stage.container().style.cursor = ''
                        }}
                      />
                    </>
                  )}
                  {hierarchyRewirePreviewWire?.promotionPanelId === surface.panel?.id && (
                    <Rect
                      x={0}
                      y={surface.mainPanelY}
                      width={surface.width}
                      height={surface.panelFrameHeight}
                      fill="rgba(37,99,235,0.08)"
                      stroke="#2563eb"
                      strokeWidth={3}
                      dash={[10, 5]}
                      cornerRadius={4}
                      listening={false}
                    />
                  )}
                  {surface.supplyPanelVisible && (
                    <Rect
                      x={0}
                      y={surface.supplyPanelY}
                      width={surface.width}
                      height={surface.supplyFrameHeight}
                      stroke={
                        selectedSupplyPanelIds.includes(surface.panel?.id ?? '')
                          ? colors.moduleBorderSelected
                          : 'transparent'
                      }
                      strokeWidth={selectedSupplyPanelIds.includes(surface.panel?.id ?? '') ? 2 : 0}
                      cornerRadius={4}
                      listening={false}
                    />
                  )}
                </>
              )}

              <ConverterBackupFeedMarker surface={surface} debugMode={panelRelationDebug} />

              {surface.placements.map((placement) => {
                const surfaceTargetId = surface.panel?.id ?? surface.id
                const previewItem =
                  moduleDragLive?.surfaceId === surfaceTargetId
                    ? (moduleDragLive?.items?.find(
                        (item) =>
                          panelGridModuleRefKey(item.ref) === panelGridModuleRefKey(placement.ref)
                      ) ??
                      (moduleDragLive.ref &&
                      panelGridModuleRefKey(moduleDragLive.ref) ===
                        panelGridModuleRefKey(placement.ref)
                        ? {
                            ref: placement.ref,
                            x: moduleDragLive.x,
                            y: moduleDragLive.y,
                            width: placement.width,
                            height: placement.height,
                          }
                        : null))
                    : null
                const isAltDuplicatePreview =
                  moduleDragLive?.isAltDuplicate === true &&
                  !!previewItem &&
                  moduleDragLive.ref != null &&
                  panelGridModuleRefKey(moduleDragLive.ref) === panelGridModuleRefKey(placement.ref)
                return (
                  <>
                    <ModuleBox
                      key={`${surface.id}-${panelGridModuleRefKey(placement.ref)}`}
                      moduleRef={placement.ref}
                      terminalStripMemberRefs={placement.terminalStripMemberRefs}
                      terminalStripRail={placement.terminalStripRail}
                      selectionOverride={
                        placement.junctionPanelTerminal
                          ? {
                              type: 'junctionPanelTerminal',
                              ids: [placement.junctionPanelTerminal.terminalId],
                              junctionPanelTerminalOwnerId:
                                placement.ref.kind === 'trunkDevice' ? placement.ref.id : undefined,
                            }
                          : undefined
                      }
                      x={
                        previewItem && !isAltDuplicatePreview
                          ? previewItem.x - surface.x
                          : placement.x
                      }
                      y={
                        previewItem && !isAltDuplicatePreview
                          ? previewItem.y - surface.y
                          : placement.y
                      }
                      width={placement.width}
                      height={placement.height}
                      info={
                        placement.junctionPanelTerminal
                          ? {
                              label: placement.junctionPanelTerminal.label,
                              specLines: [],
                              terminalStrip: {
                                stripId: placement.junctionPanelTerminal.label.replace(/^X/i, ''),
                                incomingPin: 1,
                                outgoingPin: 1,
                                maxPin: placement.junctionPanelTerminal.pinCount,
                                connectedPins: Array.from(
                                  { length: placement.junctionPanelTerminal.pinCount },
                                  (_, index) => index + 1
                                ),
                              },
                              tooltipText: placement.junctionPanelTerminal.label,
                              kind: 'trunkDevice' as const,
                            }
                          : getModuleDisplayInfo(placement.ref, currentProject)
                      }
                      draggable={canDragItems && !labelMode}
                      interactive={!labelMode}
                      resetPositionOnAltDrag
                      compactLabelMode={labelMode}
                      onDragMove={
                        canDragItems
                          ? (_ref, x, y, shiftKey, altKey) =>
                              handleHierarchyModuleDragMove(
                                surface as HierarchySurface & { panel: Panel },
                                placement,
                                x,
                                y,
                                shiftKey,
                                altKey
                              )
                          : undefined
                      }
                      onDragEnd={
                        canDragItems
                          ? (_ref, x, y, shiftKey, altKey) => {
                              if (altKey) {
                                handleHierarchyModuleAltDuplicate(
                                  surface as HierarchySurface & { panel: Panel },
                                  placement,
                                  x,
                                  y
                                )
                                return
                              }
                              handleHierarchyModuleDragEnd(
                                surface as HierarchySurface & { panel: Panel },
                                placement,
                                x,
                                y,
                                shiftKey
                              )
                            }
                          : undefined
                      }
                      onHoverChange={setTooltip}
                      onHoverRefChange={setHoveredModuleRef}
                      debugMode={panelRelationDebug}
                      debugSupplyTrunkKind={
                        panelRelationDebug && scene?.sharedSupplyTrunkRefKeys
                          ? placement.ref.kind === 'trunkDevice' && placement.ref.scope === 'supply'
                            ? scene.sharedSupplyTrunkRefKeys.has(
                                panelGridModuleRefKey(placement.ref)
                              )
                              ? 'shared'
                              : 'unique'
                            : undefined
                          : undefined
                      }
                      onResizeEnd={
                        canDragItems
                          ? (_ref, newWidthCols) =>
                              handleHierarchyModuleResize(
                                surface as HierarchySurface & { panel: Panel },
                                placement,
                                newWidthCols
                              )
                          : undefined
                      }
                      isResizeWidthValid={
                        canDragItems
                          ? (_ref, newWidthCols) =>
                              isHierarchyResizeWidthValid(
                                surface as HierarchySurface & { panel: Panel },
                                placement,
                                newWidthCols
                              )
                          : undefined
                      }
                      maxWidthCols={getHierarchyMaxWidth(
                        surface as HierarchySurface & { panel: Panel },
                        placement
                      )}
                      onRewireDragStart={
                        canUseRewireTools && rewireMode
                          ? (ref) => handleHierarchyRewireDragStart(surface, ref)
                          : undefined
                      }
                      onRewireDragMove={
                        canUseRewireTools && rewireMode
                          ? (stage, pointerPos) =>
                              handleHierarchyRewireDragMove(surface, stage, pointerPos)
                          : undefined
                      }
                      onRewireDragEnd={
                        canUseRewireTools && rewireMode ? handleHierarchyRewireDragEnd : undefined
                      }
                      onSelectionIntent={createHierarchySelectionResolver(surface, placement)}
                      onAssignTargetClick={
                        assignToCircuitMode && onAssignTargetClick ? onAssignTargetClick : undefined
                      }
                      isRewireOrigin={
                        rewireMode &&
                        rewireOriginRef != null &&
                        rewireOriginSurfaceId === getSurfaceRewireId(surface) &&
                        panelGridModuleRefKey(placement.ref) ===
                          panelGridModuleRefKey(rewireOriginRef)
                      }
                      isRewireTarget={
                        rewireMode &&
                        rewireTargetRef != null &&
                        rewireTargetSurfaceId === getSurfaceRewireId(surface) &&
                        panelGridModuleRefKey(placement.ref) ===
                          panelGridModuleRefKey(rewireTargetRef)
                      }
                      isRewireTargetValid={
                        rewireMode &&
                        rewireTargetRef != null &&
                        rewireTargetSurfaceId === getSurfaceRewireId(surface) &&
                        panelGridModuleRefKey(placement.ref) ===
                          panelGridModuleRefKey(rewireTargetRef)
                          ? rewireTargetValid
                          : true
                      }
                    />
                    {isAltDuplicatePreview && previewItem && (
                      <ModuleBox
                        key={`alt-duplicate-ghost-${surface.id}-${panelGridModuleRefKey(placement.ref)}`}
                        moduleRef={placement.ref}
                        terminalStripMemberRefs={placement.terminalStripMemberRefs}
                        terminalStripRail={placement.terminalStripRail}
                        x={previewItem.x - surface.x}
                        y={previewItem.y - surface.y}
                        width={placement.width}
                        height={placement.height}
                        info={getModuleDisplayInfo(placement.ref, currentProject)}
                        interactive={false}
                        opacity={0.72}
                      />
                    )}
                  </>
                )
              })}
              {moduleDragPreview &&
                moduleDragPreview.surfaceId === (surface.panel?.id ?? surface.id) &&
                (moduleDragPreview.items && moduleDragPreview.items.length > 0
                  ? moduleDragPreview.items.map((item) => (
                      <Rect
                        key={`module-drag-preview-${panelGridModuleRefKey(item.ref)}`}
                        x={item.x - surface.x}
                        y={item.y - surface.y}
                        width={item.width}
                        height={item.height}
                        stroke={moduleDragPreview.invalid ? '#ef4444' : colors.hoverColor}
                        strokeWidth={2}
                        dash={[8, 4]}
                        fill="transparent"
                        listening={false}
                      />
                    ))
                  : [
                      <Rect
                        key="module-drag-preview-single"
                        x={moduleDragPreview.x - surface.x}
                        y={moduleDragPreview.y - surface.y}
                        width={moduleDragPreview.width}
                        height={moduleDragPreview.height}
                        stroke={moduleDragPreview.invalid ? '#ef4444' : colors.hoverColor}
                        strokeWidth={2}
                        dash={[8, 4]}
                        fill="transparent"
                        listening={false}
                      />,
                    ])}
              {dragPreview && dragPreview.surfaceId === surface.id && (
                <Rect
                  x={dragPreview.x - surface.x}
                  y={dragPreview.y - surface.y}
                  width={dragPreview.width}
                  height={dragPreview.height}
                  stroke={dragPreview.invalid ? '#ef4444' : colors.hoverColor}
                  strokeWidth={2}
                  dash={[8, 4]}
                  fill="transparent"
                  listening={false}
                />
              )}
            </Group>
          ))}
          {moduleDragPreview?.createAuxiliary && (
            <Rect
              x={moduleDragPreview.x}
              y={moduleDragPreview.y}
              width={moduleDragPreview.width}
              height={moduleDragPreview.height}
              stroke={moduleDragPreview.invalid ? '#ef4444' : colors.hoverColor}
              strokeWidth={2}
              dash={[10, 5]}
              fill="transparent"
              cornerRadius={4}
              listening={false}
            />
          )}
          {directPanelFeederConnectors.map((connector, index) => (
            <Line
              key={`direct-panel-feeder-${index}`}
              points={connector.points}
              stroke={colors.supplyWire}
              strokeWidth={2}
              dash={[8, 4]}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          ))}
          {(() => {
            const panelSurfaces = scene?.surfaces.filter(
              (surface): surface is HierarchySurface & { panel: Panel } =>
                surface.kind === 'panel' && surface.panel != null
            )
            if (!panelSurfaces || panelSurfaces.length === 0) return null
            if (!scene) return null

            const sharedSurface = scene.surfaces.find((item) => item.kind === 'shared_supply')
            const auxiliarySurfaces = scene.surfaces.filter(
              (surface) => surface.kind === 'auxiliary' || surface.kind === 'junction_panel'
            )
            const mergedPlacements = [
              ...(sharedSurface
                ? sharedSurface.placements.map((placement) => ({
                    ...placement,
                    x: placement.x + sharedSurface.x,
                    y: placement.y + sharedSurface.y,
                  }))
                : []),
              ...auxiliarySurfaces.flatMap((surface) =>
                surface.placements.map((placement) => ({
                  ...placement,
                  x: placement.x + surface.x,
                  y: placement.y + surface.y,
                }))
              ),
              ...panelSurfaces.flatMap((surface) =>
                surface.placements.map((placement) => ({
                  ...placement,
                  x: placement.x + surface.x,
                  y: placement.y + surface.y,
                }))
              ),
            ]
            const mergedSupplyPanelRefKeys = new Set(
              [...panelSurfaces, ...auxiliarySurfaces].flatMap((surface) =>
                surface.placements
                  .filter((placement) => placement.inSupplyPanel === true)
                  .map((placement) => panelGridModuleRefKey(placement.ref))
              )
            )
            const primarySurface = panelSurfaces.find((s) => s.panel.isMain) ?? panelSurfaces[0]!
            const defaultHierarchyRoute = hierarchyRouteForHierarchySurface(
              primarySurface,
              sharedSurface,
              feedSideDirection,
              PANEL_FRAME_MARGIN
            )

            return (
              <Group key="hierarchy-relation-wires-merged" listening={false}>
                <RelationWires
                  placements={mergedPlacements}
                  selectedRef={panelWireSelectionFocus?.ref ?? selectedRef}
                  selectedConnectionSide={panelWireSelectionFocus?.side}
                  selectedConnectionPeerRef={panelWireSelectionFocus?.peerRef}
                  hoveredRef={hoveredModuleRef}
                  panel={primarySurface.panel}
                  project={currentProject}
                  dragOverride={
                    moduleDragPreview && moduleDragPreview.ref
                      ? {
                          ref: moduleDragPreview.ref,
                          x: moduleDragPreview.x,
                          y: moduleDragPreview.y,
                        }
                      : null
                  }
                  preserveRowForRefKeys={mergedSupplyPanelRefKeys}
                  supplyPanelRefKeys={mergedSupplyPanelRefKeys}
                  hierarchyRoute={defaultHierarchyRoute}
                  getHierarchyRoute={(p) => {
                    const s = panelSurfaces.find((x) => x.panel.id === p.id)
                    return s
                      ? hierarchyRouteForHierarchySurface(
                          s,
                          sharedSurface,
                          feedSideDirection,
                          PANEL_FRAME_MARGIN
                        )
                      : null
                  }}
                  animateDash
                  debugMode={panelRelationDebug}
                  pathwayRegions={panelWirePathRegions}
                  pathwayLinks={panelWirePathLinks}
                />
              </Group>
            )
          })()}
          {dragPreview?.feedWirePoints && (
            <RewirePreviewWire points={dragPreview.feedWirePoints} stroke="#10b981" animateDash />
          )}
          {hierarchyRewirePreviewWire && (
            <RewirePreviewWire
              points={hierarchyRewirePreviewWire.points}
              stroke={hierarchyRewirePreviewWire.stroke}
              animateDash
            />
          )}
          {libraryCanvasExtras}
          {}
        </Group>
      </BaseCanvas>

      {labelMode && (
        <PanelLabelModeOverlay
          scene={scene}
          project={currentProject}
          canvasRef={canvasRef}
          panelZoom={panelZoom}
          panelPan={panelPan}
          canEdit={canEditProject}
          onUpdateModuleLabel={updateModuleLabel}
        />
      )}

      <ViewNavigationToolbar
        zoom={panelZoom}
        onZoomChange={handleZoomChange}
        onPanChange={handlePanChange}
        onFitToView={handleFitToView}
        canvasType="panel"
      />

      {scene && (
        <CanvasFloatingControlRail
          side="left"
          verticalAlign="center"
          topOverlayInsetPx={68}
          dataCanvasOverlayAnchor="left"
        >
          <>
            {canUseRewireTools && (
              <RewireTool
                isActive={rewireMode}
                disabled={labelMode}
                onToggle={() => {
                  if (labelMode) return
                  setRewireMode((prev) => !prev)
                  resetHierarchyRewireState()
                }}
                hasOrigin={!!rewireOriginRef}
              />
            )}
            {canDragItems && (
              <FloatingControl
                icon={<AutoArrangeIcon className="w-6 h-6" />}
                label={t('panelCanvas.autoArrange', 'Auto arrange')}
                variant="tool"
                side="left"
                triggerTestId="e2e-panel-auto-arrange"
                disabled={labelMode}
                onClick={handleHierarchyAutoArrange}
              />
            )}
            <FloatingControl
              icon={<Tag className="h-6 w-6" />}
              label={t('panelCanvas.labelMode', 'Label mode')}
              variant="tool"
              side="left"
              active={labelMode}
              triggerTestId="e2e-panel-label-mode"
              onClick={() => setLabelMode((previous) => !previous)}
            />
            {labelMode && (
              <FloatingControl
                icon={<Printer className="h-6 w-6" />}
                label={t('menu.exportLabels', 'Export labels')}
                variant="tool"
                side="left"
                triggerTestId="e2e-panel-label-export"
                onClick={openLabelStripExportDialog}
              />
            )}
          </>
        </CanvasFloatingControlRail>
      )}

      {tooltip && containerRef.current && (
        <div
          className="absolute z-50 pointer-events-none"
          style={{
            left: tooltip.clientX - containerRef.current.getBoundingClientRect().left,
            top: tooltip.clientY - containerRef.current.getBoundingClientRect().top,
            transform: 'translate(12px, 12px)',
          }}
        >
          <div className="rounded bg-black/85 text-white text-xs px-2 py-1 shadow-lg max-w-[240px] whitespace-pre-wrap">
            {tooltip.text}
          </div>
        </div>
      )}
      {panelRelationDebug && (
        <div className="absolute top-3 left-3 z-40 pointer-events-none rounded-md border border-slate-300/70 dark:border-slate-600/80 bg-white/92 dark:bg-slate-900/92 px-3 py-2 shadow-md">
          <div className="text-[11px] font-semibold text-slate-800 dark:text-slate-100 mb-1">
            Panel routing debug
          </div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-1">
            Wires
          </div>
          <div className="space-y-1 mb-2">
            {PANEL_RELATION_DEBUG_WIRE_LEGEND.map((item) => (
              <div
                key={`wire-${item.label}`}
                className="flex items-center gap-2 text-[11px] text-slate-700 dark:text-slate-200"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: item.color }}
                />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-1">
            Modules
          </div>
          <div className="space-y-1">
            {PANEL_RELATION_DEBUG_MODULE_LEGEND.map((item) => (
              <div
                key={`module-${item.label}`}
                className="flex items-center gap-2 text-[11px] text-slate-700 dark:text-slate-200"
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ backgroundColor: item.color }}
                />
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
