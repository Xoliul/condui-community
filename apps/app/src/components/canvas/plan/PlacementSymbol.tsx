import React, { useCallback, useRef, useState, useEffect, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { Image, Group, Line, Path, Rect, Text } from 'react-konva'
import type Konva from 'konva'
import { useProjectStore } from '@/stores/projectStore'
import type { ProjectState } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { usePlanDragPosition, usePlanDragRotation } from '@/stores/planDragVisualStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useThemeColors } from '@/lib/theme/hooks'
import { logger } from '@/lib/logger'
import {
  getSymbolById,
  getFixedApplianceSymbolPath,
  SOCKET_OVERLAY_PATHS,
  getSwitchSymbolPaths,
  LIGHT_POINT_OVERLAY_PATHS,
  LIGHT_SPOT_OVERLAY_PATHS,
  HVAC_ENERGY_SOURCE_PATHS,
  HVAC_TYPE_OVERLAY_PATHS,
  RELAY_OVERLAY_PATHS,
  SMOKE_DETECTOR_OVERLAY_PATHS,
} from '@/lib/symbols'
import { loadProcessedSymbol } from '@/lib/symbolImage'
import {
  CONVERTER_ARTWORK_PATHS,
  CONVERTER_DOMAIN_ICON_SIZE_RATIO,
  getCanonicalConverterArtworkLayout,
  getConverterCornerPosition,
  getConverterDomainCorner,
  isDirectionalConverterSymbol,
} from '@/lib/converterArtwork'
import { showLightPointDecentralOverlay, showLightPointSafetyOverlay } from '@/lib/lightPointProps'
import {
  canPlanAltDuplicate,
  createPlanAltDuplicatePlacement,
  type PlanAltDuplicateSource,
} from '@/lib/plan/planAltDragDuplicate'
import {
  SYMBOL_SIZE,
  MULTI_SOCKET_OFFSET,
  PANEL_SYMBOL_WIDTH,
  PANEL_SYMBOL_HEIGHT,
  PLAN_PANEL_VISUAL_SCALE,
  PANEL_CIRCUIT_LINE_START_Y,
  PANEL_CIRCUIT_LINE_END_Y,
  PANEL_CIRCUIT_LINE_SPACING,
  PANEL_CIRCUIT_LINE_STROKE_WIDTH,
  PANEL_MAX_CIRCUIT_LINES,
  HVAC_ENERGY_OFFSET_Y_FACTOR,
  HVAC_FUNCTION_OFFSET_X_FACTOR,
  HVAC_HEAT_EXCHANGE_TYPE_OFFSET_Y,
} from '../eendraad/canvasSymbols'
import type { Endpoint, Panel, Placement, TrunkDevice } from '@/types/schema'
import type { Point, Selection } from '@/types/ui'
import { countPanelCircuits } from '@/utils/plan/placementHelpers'
import { TRANSFORMER_OVERLAY_PATHS } from '@/lib/symbols'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import {
  useCanvasFontFamily,
  useClearSelectionStore,
  useSetSelectionStore,
  useTouchPrimaryDevice,
} from '@/editions/community/communityHooks'
import { applyTouchHitPadding } from '@/lib/canvas/touchHitZones'
import {
  SELECTION_OUTLINE_CORNER_RADIUS_PX,
  SELECTION_OUTLINE_CORNER_RADIUS_PX_MAX,
  SELECTION_OUTLINE_CORNER_RADIUS_PX_MIN,
  SELECTION_OUTLINE_STROKE_PX,
  SELECTION_OUTLINE_STROKE_PX_MAX,
  SELECTION_OUTLINE_STROKE_PX_MIN,
  screenPxToCanvasUnits,
  canvasSizeWithScreenMinimum,
} from '@/constants/canvasConstants'
import { resolvePanelForDistributionEndpoint } from '@/lib/plan/panelDistributionEndpoint'
import { endpointSelectionShouldDragAllPlacements } from '@/lib/ui/crossCanvasSelection'
import {
  useAreAnyPreviewSelected,
  useIsMarqueeSelecting,
  useIsPreviewSelected,
} from '@/contexts/SelectionPreviewContext'
import {
  selectProjectElectricalInstallation,
  selectProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { getPlanPanelBodyGeometry } from './panelPlanSymbolGeometry'
import { ImpulseSwitchCountMarker } from '../shared/ImpulseSwitchCountMarker'
import { INTERACTIVE_OVERLAY_EXPORT_NAME } from '@/lib/export/interactiveOverlayExport'

/** Avoid flooding the console when many placements fail the same asset fetch (e.g. bad imports). */
const loggedSitplanSymbolFailures = new Set<string>()

const selectionBoolEqual = (a: boolean, b: boolean) => a === b

function collectJunctionPanelTrunkDevicesByLabel(
  project: ProjectWithOptionalV2Electrical | null | undefined,
  label: string | undefined
): TrunkDevice[] {
  if (!project || !label) return []
  const devices: TrunkDevice[] = []
  const installation = selectProjectElectricalInstallation(project)
  const addIfMatching = (device: TrunkDevice) => {
    if (device.type === 'junction_panel' && device.label === label) {
      devices.push(device)
    }
  }

  installation?.mainSupply?.supplyTrunkDevices?.forEach(addIfMatching)
  installation?.groundTrunkDevices?.forEach(addIfMatching)

  const visitPanel = (panel: Panel) => {
    const circuits = [
      ...panel.circuits,
      ...panel.protections.flatMap((protection) => protection.circuits ?? []),
    ]
    for (const circuit of circuits) {
      circuit.trunkDevices?.forEach(addIfMatching)
    }
    panel.subPanels.forEach(visitPanel)
  }

  selectProjectElectricalPanels(project).forEach(visitPanel)
  return devices
}

function isPlanPlacementSymbolSelected(
  selection: Selection,
  placementId: string,
  endpoint: Endpoint | null | undefined,
  isEarthing: boolean,
  isJunctionPanel: boolean,
  junctionPanelLabel: string | undefined,
  panelId: string | null | undefined,
  trunkDeviceId?: string
): boolean {
  if (
    (isEarthing && selection.type === 'placement' && selection.ids.includes(placementId)) ||
    (isEarthing && selection.type === 'ground' && selection.ids.includes('ground'))
  ) {
    return true
  }
  if (trunkDeviceId && selection.type === 'trunkDevice' && selection.ids.includes(trunkDeviceId)) {
    return true
  }
  if (
    !isJunctionPanel &&
    !isEarthing &&
    selection.type === 'placement' &&
    selection.ids.includes(placementId)
  ) {
    return true
  }
  if (
    !isJunctionPanel &&
    !isEarthing &&
    endpoint &&
    selection.type === 'endpoint' &&
    selection.ids.includes(endpoint.id)
  ) {
    return true
  }
  if (isJunctionPanel && selection.type === 'trunkDevice' && junctionPanelLabel) {
    const jpLabel = junctionPanelLabel
    return selection.ids.some((id) => {
      const res = useProjectStore.getState().getTrunkDeviceById(id)
      const dev = res?.device
      return dev?.type === 'junction_panel' && dev.label === jpLabel
    })
  }
  if (
    !isJunctionPanel &&
    endpoint?.symbol === 'panel_distribution' &&
    panelId &&
    selection.type === 'panel' &&
    selection.ids.includes(panelId)
  ) {
    return true
  }
  return false
}

function isPlanPlacementBreadcrumbHovered(
  hover: Selection,
  endpoint: Endpoint | null | undefined,
  isJunctionPanel: boolean,
  panelId: string | null | undefined,
  trunkDeviceId?: string
): boolean {
  if (trunkDeviceId && hover.type === 'trunkDevice' && hover.ids.includes(trunkDeviceId))
    return true
  if (isJunctionPanel || !endpoint) return false
  if (hover.type === 'endpoint' && hover.ids.includes(endpoint.id)) return true
  return (
    endpoint.symbol === 'panel_distribution' &&
    panelId != null &&
    hover.type === 'panel' &&
    hover.ids.includes(panelId)
  )
}

interface PlacementSymbolProps {
  placement: Placement
  sourceEndpoint?: Endpoint | null
  sourceTrunkDevice?: TrunkDevice | null
  /** Optional position override (e.g. local drag positions during multi-select drag). */
  positionOverride?: Point
  /** Optional rotation override used for live preview while dragging. */
  rotationOverrideDeg?: number
  baseSymbolSizePx: number
  currentZoom?: number
  isDrawingToolActive?: boolean
  canDrag?: boolean
  onMultiSelectDragStart?: (draggedEndpointId: string) => void
  onMultiSelectDrag?: (draggedEndpointId: string, newPos: Point) => void
  onMultiSelectDragEnd?: () => void
  onDragStart?: () => void
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void
  onDragEnd?: (finalPos: Point) => void
  /** When set, snaps symbol center to grid while dragging and on release. */
  snapPosition?: (pos: Point) => Point
  isQuickPlacerCurrent?: boolean
}

const SOCKET_VECTOR_VIEWBOX_SIZE = 48
const INTERACTIVE_HIT_FILL = 'rgba(0,0,0,0.001)'
type WindowWithEendraTapSuppression = Window & { __eendraSuppressNextElementTap?: boolean }

function renderSocketVectorSymbol(symbolId: string, width: number, height: number, color: string) {
  const scaleX = width / SOCKET_VECTOR_VIEWBOX_SIZE
  const scaleY = height / SOCKET_VECTOR_VIEWBOX_SIZE
  const strokeWidth = 2
  const showGround = symbolId === 'socket_gnd' || symbolId === 'socket_gnd_child'
  const showChildProtection = symbolId === 'socket_child' || symbolId === 'socket_gnd_child'

  return (
    <Group x={-width / 2} y={-height / 2} scaleX={scaleX} scaleY={scaleY} listening={false}>
      <Line
        points={[0.3, 24, 18.8, 24]}
        stroke={color}
        strokeWidth={strokeWidth}
        lineCap="round"
        listening={false}
      />
      <Path
        data="M35.3,8c-8.8,0-16,7.2-16,16s7.2,16,16,16"
        stroke={color}
        strokeWidth={strokeWidth}
        lineCap="round"
        listening={false}
      />
      {showGround && (
        <Line
          points={[19.3, 8, 19.3, 40]}
          stroke={color}
          strokeWidth={strokeWidth}
          lineCap="round"
          listening={false}
        />
      )}
      {showChildProtection && (
        <>
          <Line
            points={[35.5, 40, 35.5, 45]}
            stroke={color}
            strokeWidth={strokeWidth}
            lineCap="round"
            listening={false}
          />
          <Line
            points={[35.5, 3.6, 35.5, 8]}
            stroke={color}
            strokeWidth={strokeWidth}
            lineCap="round"
            listening={false}
          />
        </>
      )}
    </Group>
  )
}

/**
 * Component to render a placement symbol
 */
function PlacementSymbolInner({
  placement,
  sourceEndpoint: sourceEndpointProp,
  sourceTrunkDevice: sourceTrunkDeviceProp,
  positionOverride,
  rotationOverrideDeg,
  baseSymbolSizePx,
  currentZoom = 1,
  isDrawingToolActive = false,
  canDrag = true,
  onMultiSelectDragStart,
  onMultiSelectDrag,
  onMultiSelectDragEnd,
  onDragStart,
  onDragMove,
  onDragEnd,
  snapPosition,
  isQuickPlacerCurrent = false,
}: PlacementSymbolProps) {
  const snapPos = useCallback((p: Point) => (snapPosition ? snapPosition(p) : p), [snapPosition])
  const dragPos = usePlanDragPosition(placement.id)
  const dragRotation = usePlanDragRotation(placement.id)
  const pos = positionOverride ?? dragPos ?? placement.pos
  const setSelection = useSetSelectionStore()
  const clearSelection = useClearSelectionStore()
  const theme = useSettingsStore((state) => state.theme)
  const planPlacementDebug = useSettingsStore((s) => s.planPlacementDebug)
  const colors = useThemeColors()
  const fontFamily = useCanvasFontFamily()
  const [processedImage, setProcessedImage] = useState<HTMLImageElement | null>(null)
  const [converterDiagonalImage, setConverterDiagonalImage] = useState<HTMLImageElement | null>(
    null
  )
  const [converterAcImage, setConverterAcImage] = useState<HTMLImageElement | null>(null)
  const [converterDcImage, setConverterDcImage] = useState<HTMLImageElement | null>(null)
  const [overlaySwitchImage, setOverlaySwitchImage] = useState<HTMLImageElement | null>(null)
  const [overlaySwitchLockImage, setOverlaySwitchLockImage] = useState<HTMLImageElement | null>(
    null
  )
  const [switchOverlayImage, setSwitchOverlayImage] = useState<HTMLImageElement | null>(null)
  const [lightPointSafetyImage, setLightPointSafetyImage] = useState<HTMLImageElement | null>(null)
  const [lightPointDecentralImage, setLightPointDecentralImage] = useState<HTMLImageElement | null>(
    null
  )
  const [lightPointSwitchImage, setLightPointSwitchImage] = useState<HTMLImageElement | null>(null)
  const [lightSpotBeamImage, setLightSpotBeamImage] = useState<HTMLImageElement | null>(null)
  const [transformerSafetyImage, setTransformerSafetyImage] = useState<HTMLImageElement | null>(
    null
  )
  const [transformerShortcircuitImage, setTransformerShortcircuitImage] =
    useState<HTMLImageElement | null>(null)
  const [transformerProtectionImage, setTransformerProtectionImage] =
    useState<HTMLImageElement | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [hvacEnergyImage, setHvacEnergyImage] = useState<HTMLImageElement | null>(null)
  const [hvacTypeImage, setHvacTypeImage] = useState<HTMLImageElement | null>(null)
  const [relayOverlayImage, setRelayOverlayImage] = useState<HTMLImageElement | null>(null)
  const [smokeDetectorOverlayImage, setSmokeDetectorOverlayImage] =
    useState<HTMLImageElement | null>(null)
  const groupRef = useRef<Konva.Group | null>(null)
  const planAltDuplicateGhostRef = useRef<Konva.Group | null>(null)
  const planAltDuplicatePointerCleanupRef = useRef<(() => void) | null>(null)
  const suppressKonvaDragEndRef = useRef(false)
  /** Fresh multi-drag flag for this gesture (avoids stale isMultiSelect after select-on-drag-start). */
  const planDragMultiRef = useRef(false)

  // Resolve endpoint and symbol without early return so hook count is stable
  const placementRow = placement as Placement & {
    endpointId?: string
    trunkDeviceId?: string
    enclosureId?: string
    junctionPanelLabel?: string
    isEarthing?: boolean
  }
  const projectState = useProjectStore.getState()
  const sourceEndpoint =
    sourceEndpointProp !== undefined
      ? sourceEndpointProp
      : placementRow.endpointId != null
        ? (projectState.getEndpointById(placementRow.endpointId) ?? null)
        : null
  const trunkDevice =
    sourceTrunkDeviceProp !== undefined
      ? sourceTrunkDeviceProp
      : placementRow.trunkDeviceId
        ? (projectState.getTrunkDeviceById(placementRow.trunkDeviceId)?.device ?? null)
        : null
  // A supply enclosure (virtual panel) is drawn as a board carrying its name.
  const enclosureName = useProjectStore((state: ProjectState) =>
    placementRow.enclosureId
      ? (state.currentProject?.disciplines?.electrical?.auxiliaryEnclosures?.find(
          (candidate) => candidate.id === placementRow.enclosureId
        )?.name ?? '')
      : null
  )
  const endpoint = useMemo<Endpoint | null>(
    () =>
      sourceEndpoint ??
      (placementRow.enclosureId && enclosureName !== null
        ? {
            id: placementRow.enclosureId,
            type: 'fixed_appliance',
            label: enclosureName,
            symbol: 'panel_distribution',
            placements: [],
          }
        : null) ??
      (trunkDevice
        ? {
            id: trunkDevice.id,
            type: 'fixed_appliance',
            label: trunkDevice.label,
            symbol: trunkDevice.symbol,
            placements: trunkDevice.placements ?? [],
            energyConversionProps: trunkDevice.conversionProps,
            batteryProps: trunkDevice.batteryProps,
            solarPanelProps: trunkDevice.solarPanelProps,
          }
        : null),
    [enclosureName, placementRow.enclosureId, sourceEndpoint, trunkDevice]
  )
  const isEarthing = placementRow.isEarthing === true
  const isJunctionPanel = placementRow.junctionPanelLabel != null
  const symbol = isEarthing
    ? getSymbolById('earthing')
    : isJunctionPanel
      ? getSymbolById('junction_panel')
      : endpoint?.symbol
        ? getSymbolById(endpoint.symbol)
        : null
  const isSocket = endpoint?.type === 'socket'
  const isVectorSocketSymbol =
    endpoint?.symbol === 'socket' ||
    endpoint?.symbol === 'socket_gnd' ||
    endpoint?.symbol === 'socket_child' ||
    endpoint?.symbol === 'socket_gnd_child'
  const isSwitch = endpoint?.type === 'switch'
  const socketProps = endpoint?.socketProps
  const switchProps = endpoint?.switchProps
  const showSwitchOverlay = isSocket && socketProps?.switchOverlay
  const showSwitchOverlayLock = isSocket && socketProps?.switchOverlayLock
  const socketCount = isSocket ? socketProps?.socketCount || 1 : 1
  const lightPointProps = endpoint?.lightPointProps
  const lightSpotProps = endpoint?.lightSpotProps
  const lightFluorescentProps = endpoint?.lightFluorescentProps
  const isLightPoint = endpoint?.type === 'light_point' && endpoint?.symbol === 'light_point'
  const isLightSpot = endpoint?.type === 'light_point' && endpoint?.symbol === 'light_spot'
  const isLightFluorescent =
    endpoint?.type === 'light_point' && endpoint?.symbol === 'light_fluorescent'
  const tubeCount = isLightFluorescent ? (lightFluorescentProps?.tubeCount ?? 1) : 1
  const currentProject = useProjectStore((state: ProjectState) =>
    isJunctionPanel || endpoint?.symbol === 'panel_distribution' ? state.currentProject : null
  )

  const resolvedPanelForSymbol = useMemo(() => {
    if (!currentProject || !endpoint || endpoint.symbol !== 'panel_distribution') return null
    return resolvePanelForDistributionEndpoint(currentProject, endpoint)
  }, [currentProject, endpoint])
  const resolvedPanelId = resolvedPanelForSymbol?.id ?? null
  const junctionPanelDeviceIds = useMemo(
    () =>
      isJunctionPanel && placementRow.junctionPanelLabel
        ? collectJunctionPanelTrunkDevicesByLabel(
            currentProject,
            placementRow.junctionPanelLabel
          ).map((device) => device.id)
        : [],
    [currentProject, isJunctionPanel, placementRow.junctionPanelLabel]
  )
  const isMarqueeSelecting = useIsMarqueeSelecting()
  const isPlacementPreviewSelected = useIsPreviewSelected('placement', placement.id)
  const isPanelPreviewSelected = useIsPreviewSelected('panel', resolvedPanelId ?? '')
  const isTrunkPreviewSelected = useAreAnyPreviewSelected('trunkDevice', junctionPanelDeviceIds)
  const isPreviewSelected =
    isPlacementPreviewSelected || isPanelPreviewSelected || isTrunkPreviewSelected
  const isSelected = useStoreWithEqualityFn(
    useUIStore,
    (s) =>
      isPlanPlacementSymbolSelected(
        s.selection,
        placement.id,
        endpoint,
        isEarthing,
        isJunctionPanel,
        placementRow.junctionPanelLabel,
        resolvedPanelId,
        placementRow.trunkDeviceId
      ),
    selectionBoolEqual
  )
  const isHoveredFromBreadcrumb = useStoreWithEqualityFn(
    useUIStore,
    (s) =>
      isPlanPlacementBreadcrumbHovered(
        s.hover,
        endpoint,
        isJunctionPanel,
        resolvedPanelId,
        placementRow.trunkDeviceId
      ),
    selectionBoolEqual
  )
  const isHvac = endpoint?.symbol === 'furnace'
  const hvacProps = endpoint?.hvacProps
  const relayProps = endpoint?.relayProps
  const smokeDetectorProps = endpoint?.smokeDetectorProps
  const motionDetectorType = endpoint?.motionDetectorProps?.type ?? 'spread'
  const switchSymbolPathProps =
    endpoint?.symbol === 'motion_detector' ? { ...switchProps, motionDetectorType } : switchProps
  const isTransformer = endpoint?.symbol === 'transformer'
  const conversionProps = trunkDevice?.conversionProps ?? endpoint?.energyConversionProps
  const transformerLabel = isTransformer
    ? (conversionProps?.transformerOverlayLabel || '').trim()
    : ''
  const isDirectionalConverter = isDirectionalConverterSymbol(endpoint?.symbol)
  const converterInputDomain = endpoint?.symbol === 'inverter' ? 'DC' : 'AC'
  const converterOutputDomain = endpoint?.symbol === 'inverter' ? 'AC' : 'DC'
  const converterArtworkLayout = isDirectionalConverter
    ? getCanonicalConverterArtworkLayout(converterInputDomain, converterOutputDomain)
    : null

  // Base SVG path: switches use getSwitchSymbolPaths; boiler/heating use getFixedApplianceSymbolPath; else symbol.svgPath
  const baseSvgPath = isEarthing
    ? symbol?.svgPath
    : isDirectionalConverter
      ? CONVERTER_ARTWORK_PATHS.base
      : isSwitch && endpoint?.symbol
        ? getSwitchSymbolPaths(endpoint.symbol, switchSymbolPathProps).basePath
        : endpoint?.symbol === 'boiler'
          ? (getFixedApplianceSymbolPath('boiler', endpoint?.fixedApplianceProps) ??
            symbol?.svgPath)
          : endpoint?.symbol === 'heating'
            ? (getFixedApplianceSymbolPath('heating', endpoint?.fixedApplianceProps) ??
              symbol?.svgPath)
            : symbol?.svgPath
  const switchOverlayPath =
    isSwitch && endpoint?.symbol
      ? getSwitchSymbolPaths(endpoint.symbol, switchSymbolPathProps).overlayPath
      : undefined

  const hvacEnergyKey = hvacProps?.energySource ?? 'none'
  const hvacTypeKey = hvacProps?.hvacType ?? 'none'
  const hvacFunctionKey = hvacProps?.hvacFunction ?? 'none'

  // Load the symbol image and process it for theme (must run unconditionally for Rules of Hooks)
  useEffect(() => {
    if (!baseSvgPath) {
      setProcessedImage(null)
      return
    }
    const isDark = theme.mode === 'dark'
    loadProcessedSymbol(baseSvgPath, isDark)
      .then(setProcessedImage)
      .catch(() => {
        if (!loggedSitplanSymbolFailures.has(baseSvgPath)) {
          loggedSitplanSymbolFailures.add(baseSvgPath)
          logger.warn('Failed to load sitplan symbol (shown once per path):', baseSvgPath)
        }
        setProcessedImage(null)
      })
  }, [baseSvgPath, theme.mode])

  // Directional converters are composed from the shared base, diagonal, and
  // domain artwork so the situation plan uses the same symbol as the other
  // canvas renderers.
  useEffect(() => {
    if (!isDirectionalConverter) {
      setConverterDiagonalImage(null)
      setConverterAcImage(null)
      setConverterDcImage(null)
      return
    }
    const isDark = theme.mode === 'dark'
    loadProcessedSymbol(CONVERTER_ARTWORK_PATHS.diagonal, isDark)
      .then(setConverterDiagonalImage)
      .catch(() => setConverterDiagonalImage(null))
    loadProcessedSymbol(CONVERTER_ARTWORK_PATHS.AC, isDark)
      .then(setConverterAcImage)
      .catch(() => setConverterAcImage(null))
    loadProcessedSymbol(CONVERTER_ARTWORK_PATHS.DC, isDark)
      .then(setConverterDcImage)
      .catch(() => setConverterDcImage(null))
  }, [isDirectionalConverter, theme.mode])

  // Load socket overlay images when socketProps request them (sitplan)
  useEffect(() => {
    if (!showSwitchOverlay && !showSwitchOverlayLock) {
      setOverlaySwitchImage(null)
      setOverlaySwitchLockImage(null)
      return
    }
    const isDark = theme.mode === 'dark'
    if (showSwitchOverlay) {
      loadProcessedSymbol(SOCKET_OVERLAY_PATHS.switchOverlay, isDark)
        .then(setOverlaySwitchImage)
        .catch(() => setOverlaySwitchImage(null))
    } else {
      setOverlaySwitchImage(null)
    }
    if (showSwitchOverlayLock) {
      loadProcessedSymbol(SOCKET_OVERLAY_PATHS.switchOverlayLock, isDark)
        .then(setOverlaySwitchLockImage)
        .catch(() => setOverlaySwitchLockImage(null))
    } else {
      setOverlaySwitchLockImage(null)
    }
  }, [showSwitchOverlay, showSwitchOverlayLock, theme.mode])

  // Load switch verklikkerlamp overlay (sitplan)
  useEffect(() => {
    if (!switchOverlayPath) {
      setSwitchOverlayImage(null)
      return
    }
    const isDark = theme.mode === 'dark'
    loadProcessedSymbol(switchOverlayPath, isDark)
      .then(setSwitchOverlayImage)
      .catch(() => setSwitchOverlayImage(null))
  }, [switchOverlayPath, theme.mode])

  // Load light point overlays (safety, decentral, switch 1p) – sitplan: no onWall line
  useEffect(() => {
    if (!isLightPoint || !lightPointProps) {
      setLightPointSafetyImage(null)
      setLightPointDecentralImage(null)
      setLightPointSwitchImage(null)
      return
    }
    const isDark = theme.mode === 'dark'
    if (showLightPointSafetyOverlay(lightPointProps)) {
      loadProcessedSymbol(LIGHT_POINT_OVERLAY_PATHS.safety, isDark)
        .then(setLightPointSafetyImage)
        .catch(() => setLightPointSafetyImage(null))
    } else {
      setLightPointSafetyImage(null)
    }
    if (showLightPointDecentralOverlay(lightPointProps)) {
      loadProcessedSymbol(LIGHT_POINT_OVERLAY_PATHS.decentral, isDark)
        .then(setLightPointDecentralImage)
        .catch(() => setLightPointDecentralImage(null))
    } else {
      setLightPointDecentralImage(null)
    }
    if (lightPointProps.switch1p) {
      loadProcessedSymbol(LIGHT_POINT_OVERLAY_PATHS.switch1p, isDark)
        .then(setLightPointSwitchImage)
        .catch(() => setLightPointSwitchImage(null))
    } else {
      setLightPointSwitchImage(null)
    }
  }, [
    isLightPoint,
    lightPointProps,
    lightPointProps?.safety,
    lightPointProps?.decentral,
    lightPointProps?.autonomous,
    lightPointProps?.switch1p,
    theme.mode,
  ])

  // Load transformer overlays (safety type, short‑circuit, protection) – sitplan
  useEffect(() => {
    if (!isTransformer) {
      setTransformerSafetyImage(null)
      setTransformerShortcircuitImage(null)
      setTransformerProtectionImage(null)
      return
    }
    const isDark = theme.mode === 'dark'
    const safetyType = conversionProps?.transformerSafetyType ?? 'none'

    if (safetyType === 'safety_closed') {
      loadProcessedSymbol(TRANSFORMER_OVERLAY_PATHS.safetyClosed, isDark)
        .then(setTransformerSafetyImage)
        .catch(() => setTransformerSafetyImage(null))
    } else if (safetyType === 'safety_open') {
      loadProcessedSymbol(TRANSFORMER_OVERLAY_PATHS.safetyOpen, isDark)
        .then(setTransformerSafetyImage)
        .catch(() => setTransformerSafetyImage(null))
    } else {
      setTransformerSafetyImage(null)
    }

    if (conversionProps?.transformerShortCircuitProtected) {
      loadProcessedSymbol(TRANSFORMER_OVERLAY_PATHS.shortcircuit, isDark)
        .then(setTransformerShortcircuitImage)
        .catch(() => setTransformerShortcircuitImage(null))
    } else {
      setTransformerShortcircuitImage(null)
    }

    if (conversionProps?.transformerProtected) {
      loadProcessedSymbol(TRANSFORMER_OVERLAY_PATHS.protection, isDark)
        .then(setTransformerProtectionImage)
        .catch(() => setTransformerProtectionImage(null))
    } else {
      setTransformerProtectionImage(null)
    }
  }, [
    isTransformer,
    conversionProps?.transformerSafetyType,
    conversionProps?.transformerShortCircuitProtected,
    conversionProps?.transformerProtected,
    theme.mode,
  ])

  // Load light spot beam overlay (sitplan)
  useEffect(() => {
    if (!isLightSpot || !lightSpotProps?.beamType || lightSpotProps.beamType === 'none') {
      setLightSpotBeamImage(null)
      return
    }
    const path =
      lightSpotProps.beamType === 'straight'
        ? LIGHT_SPOT_OVERLAY_PATHS.straight
        : LIGHT_SPOT_OVERLAY_PATHS.diverging
    const isDark = theme.mode === 'dark'
    loadProcessedSymbol(path, isDark)
      .then(setLightSpotBeamImage)
      .catch(() => setLightSpotBeamImage(null))
  }, [isLightSpot, lightSpotProps?.beamType, theme.mode])

  // Load HVAC energy source overlays (sitplan)
  useEffect(() => {
    if (!isHvac || !hvacEnergyKey || hvacEnergyKey === 'none') {
      setHvacEnergyImage(null)
      return
    }
    const path = HVAC_ENERGY_SOURCE_PATHS[hvacEnergyKey as keyof typeof HVAC_ENERGY_SOURCE_PATHS]
    if (!path) {
      setHvacEnergyImage(null)
      return
    }
    const isDark = theme.mode === 'dark'
    loadProcessedSymbol(path, isDark)
      .then(setHvacEnergyImage)
      .catch(() => setHvacEnergyImage(null))
  }, [isHvac, hvacEnergyKey, theme.mode])

  // Load HVAC type overlays (sitplan)
  useEffect(() => {
    if (!isHvac || !hvacTypeKey || hvacTypeKey === 'none') {
      setHvacTypeImage(null)
      return
    }
    const path = HVAC_TYPE_OVERLAY_PATHS[hvacTypeKey as keyof typeof HVAC_TYPE_OVERLAY_PATHS]
    if (!path) {
      setHvacTypeImage(null)
      return
    }
    const isDark = theme.mode === 'dark'
    loadProcessedSymbol(path, isDark)
      .then(setHvacTypeImage)
      .catch(() => setHvacTypeImage(null))
  }, [isHvac, hvacTypeKey, theme.mode])

  // Load relay control overlay (sitplan)
  useEffect(() => {
    if (endpoint?.symbol !== 'relay') {
      setRelayOverlayImage(null)
      return
    }
    const controlKey = relayProps?.control ?? 'standard'
    const path = RELAY_OVERLAY_PATHS[controlKey as keyof typeof RELAY_OVERLAY_PATHS]
    if (!path) {
      setRelayOverlayImage(null)
      return
    }
    const isDark = theme.mode === 'dark'
    loadProcessedSymbol(path, isDark)
      .then(setRelayOverlayImage)
      .catch(() => setRelayOverlayImage(null))
  }, [endpoint?.symbol, relayProps?.control, theme.mode])

  // Load smoke / fire detector overlay (sitplan)
  useEffect(() => {
    if (endpoint?.symbol !== 'smoke_detector') {
      setSmokeDetectorOverlayImage(null)
      return
    }
    const typeKey = smokeDetectorProps?.type ?? 'smoke'
    const path = SMOKE_DETECTOR_OVERLAY_PATHS[typeKey as keyof typeof SMOKE_DETECTOR_OVERLAY_PATHS]
    if (!path) {
      setSmokeDetectorOverlayImage(null)
      return
    }
    const isDark = theme.mode === 'dark'
    loadProcessedSymbol(path, isDark)
      .then(setSmokeDetectorOverlayImage)
      .catch(() => setSmokeDetectorOverlayImage(null))
  }, [endpoint?.symbol, smokeDetectorProps?.type, theme.mode])

  /** Same selection rules as click; used from onClick and from mouse drag-start when the symbol was not yet selected. */
  const applyPlanSymbolPointerSelection = useCallback(
    (evt: Pick<MouseEvent, 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>) => {
      if (isEarthing) {
        if (evt.shiftKey) {
          const { selection } = useUIStore.getState()
          if (selection.type === 'ground' && !selection.ids.includes('ground')) {
            setSelection({ type: 'ground', ids: [...selection.ids, 'ground'] })
          } else if (selection.type !== 'ground') {
            setSelection({ type: 'ground', ids: ['ground'] })
          }
        } else if (evt.altKey || evt.ctrlKey || evt.metaKey) {
          const { selection } = useUIStore.getState()
          if (selection.type === 'ground' && selection.ids.includes('ground')) {
            clearSelection()
          }
        } else {
          setSelection({ type: 'ground', ids: ['ground'] })
        }
        return
      }

      if (isJunctionPanel) {
        const jpLabel = placementRow.junctionPanelLabel
        const project = useProjectStore.getState().currentProject
        const junctionDeviceIds = collectJunctionPanelTrunkDevicesByLabel(project, jpLabel).map(
          (device) => device.id
        )

        const selectionType = 'trunkDevice' as const
        const selectionIds = junctionDeviceIds.length > 0 ? junctionDeviceIds : [placement.id]

        if (evt.shiftKey) {
          const { selection } = useUIStore.getState()
          if (selection.type === selectionType) {
            const merged = Array.from(new Set([...selection.ids, ...selectionIds]))
            setSelection({ type: selectionType, ids: merged })
          } else {
            setSelection({ type: selectionType, ids: selectionIds })
          }
        } else if (evt.altKey || evt.ctrlKey || evt.metaKey) {
          const { selection } = useUIStore.getState()
          if (selection.type === selectionType) {
            const removeSet = new Set(selectionIds)
            const newIds = selection.ids.filter((id) => !removeSet.has(id))
            if (newIds.length === 0) {
              clearSelection()
            } else {
              setSelection({ type: selectionType, ids: newIds })
            }
          }
        } else {
          setSelection({ type: selectionType, ids: selectionIds })
        }

        return
      }

      if (!endpoint) return

      const isPanel = endpoint.symbol === 'panel_distribution'
      if (isPanel) {
        const panel =
          currentProject != null
            ? resolvePanelForDistributionEndpoint(currentProject, endpoint)
            : null
        if (panel) {
          if (evt.shiftKey) {
            const { selection } = useUIStore.getState()
            if (selection.type === 'panel' && !selection.ids.includes(panel.id)) {
              setSelection({ type: 'panel', ids: [...selection.ids, panel.id] })
            } else if (selection.type !== 'panel') {
              setSelection({ type: 'panel', ids: [panel.id] })
            }
          } else if (evt.altKey || evt.ctrlKey || evt.metaKey) {
            const { selection } = useUIStore.getState()
            if (selection.type === 'panel' && selection.ids.includes(panel.id)) {
              const newIds = selection.ids.filter((id) => id !== panel.id)
              if (newIds.length === 0) {
                clearSelection()
              } else {
                setSelection({ type: 'panel', ids: newIds })
              }
            }
          } else {
            setSelection({ type: 'panel', ids: [panel.id] })
          }
          return
        }
      }

      const selectionType = 'placement' as const
      const selectionId = placement.id

      if (evt.shiftKey) {
        const { selection } = useUIStore.getState()
        if (selection.type === selectionType && !selection.ids.includes(selectionId)) {
          setSelection({ type: selectionType, ids: [...selection.ids, selectionId] })
        } else if (selection.type !== selectionType) {
          setSelection({ type: selectionType, ids: [selectionId] })
        }
      } else if (evt.altKey || evt.ctrlKey || evt.metaKey) {
        const { selection } = useUIStore.getState()
        if (selection.type === selectionType && selection.ids.includes(selectionId)) {
          const newIds = selection.ids.filter((id) => id !== selectionId)
          if (newIds.length === 0) {
            clearSelection()
          } else {
            setSelection({ type: selectionType, ids: newIds })
          }
        }
      } else {
        setSelection({ type: selectionType, ids: [selectionId] })
      }
    },
    [
      clearSelection,
      currentProject,
      endpoint,
      isEarthing,
      isJunctionPanel,
      placement.id,
      placementRow.junctionPanelLabel,
      setSelection,
    ]
  )

  /** Mouse/pen only: briefly allow Konva drag while unselected so one gesture can select + move (touch keeps select-then-drag). */
  const [allowUnselectedMouseDrag, setAllowUnselectedMouseDrag] = useState(false)

  const handleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      const windowWithSuppression = window as WindowWithEendraTapSuppression
      if (windowWithSuppression.__eendraSuppressNextElementTap) {
        windowWithSuppression.__eendraSuppressNextElementTap = false
        return
      }
      if ('button' in e.evt && e.evt.button != null && e.evt.button !== 0) return
      e.cancelBubble = true
      applyPlanSymbolPointerSelection(e.evt)
    },
    [applyPlanSymbolPointerSelection]
  )

  // Sync hover to eendraad: when hovering panel_distribution on sitplan, set global panel hover so frame highlights
  const handlePlacementMouseEnter = useCallback(() => {
    setIsHovered(true)
    if (planPlacementDebug && endpoint?.type === 'socket') {
      logger.info('[PlanSocketDebug] hover enter', {
        placementId: placement.id,
        endpointId: endpoint.id,
        symbol: endpoint.symbol,
        rotationDeg: rotationOverrideDeg ?? placement.rotationDeg,
        pos,
      })
    }
    if (placementRow.trunkDeviceId) {
      useUIStore.getState().setHover({ type: 'trunkDevice', ids: [placementRow.trunkDeviceId] })
      return
    }
    if (!endpoint) return
    if (endpoint.symbol === 'panel_distribution') {
      const panel =
        currentProject != null
          ? resolvePanelForDistributionEndpoint(currentProject, endpoint)
          : null
      if (panel) useUIStore.getState().setHover({ type: 'panel', ids: [panel.id] })
    }
  }, [
    currentProject,
    endpoint,
    placement.id,
    placement.rotationDeg,
    placementRow.trunkDeviceId,
    planPlacementDebug,
    pos,
    rotationOverrideDeg,
  ])

  const handlePlacementMouseLeave = useCallback(() => {
    setIsHovered(false)
    if (planPlacementDebug && endpoint?.type === 'socket') {
      logger.info('[PlanSocketDebug] hover leave', {
        placementId: placement.id,
        endpointId: endpoint.id,
      })
    }
    if (placementRow.trunkDeviceId || endpoint?.symbol === 'panel_distribution') {
      useUIStore.getState().clearHover()
    }
  }, [
    endpoint?.id,
    endpoint?.symbol,
    endpoint?.type,
    placement.id,
    placementRow.trunkDeviceId,
    planPlacementDebug,
  ])

  // Outline/hit dimensions and selection — before early returns so hook count stays stable
  const symbolSize = baseSymbolSizePx * placement.scale
  const isPanelSymbol = !isJunctionPanel && endpoint?.symbol === 'panel_distribution'
  const isPanelLike = isPanelSymbol || isJunctionPanel
  const panelScaleFactor = PANEL_SYMBOL_HEIGHT / SYMBOL_SIZE
  const symbolHeight = isPanelLike
    ? baseSymbolSizePx * panelScaleFactor * PLAN_PANEL_VISUAL_SCALE * placement.scale
    : symbolSize
  const panelAspectRatio = PANEL_SYMBOL_WIDTH / PANEL_SYMBOL_HEIGHT
  const symbolWidth = isPanelLike ? symbolHeight * panelAspectRatio : symbolSize
  const outlineWidth = isPanelLike ? symbolWidth : symbolSize
  const outlineHeight = isPanelLike ? symbolHeight : symbolSize
  const socketOffset = MULTI_SOCKET_OFFSET * (symbolSize / SYMBOL_SIZE)
  const socketExtraWidth = Math.max(0, socketCount - 1) * socketOffset
  const finalOutlineWidth = outlineWidth + socketExtraWidth

  const touchPrimary = useTouchPrimaryDevice()
  const placementHitRect = useMemo(
    () =>
      applyTouchHitPadding(
        {
          x: -outlineWidth / 2,
          y: -outlineHeight / 2,
          width: finalOutlineWidth,
          height: outlineHeight,
        },
        currentZoom,
        isSelected,
        touchPrimary
      ),
    [outlineWidth, outlineHeight, finalOutlineWidth, currentZoom, isSelected, touchPrimary]
  )

  const endPlanAltDuplicatePointerDrag = useCallback(() => {
    planAltDuplicatePointerCleanupRef.current?.()
    planAltDuplicatePointerCleanupRef.current = null
    const ghost = planAltDuplicateGhostRef.current
    planAltDuplicateGhostRef.current = null
    if (ghost) {
      const layer = ghost.getLayer()
      ghost.destroy()
      layer?.batchDraw()
    }
    suppressKonvaDragEndRef.current = false
  }, [])

  useEffect(() => () => endPlanAltDuplicatePointerDrag(), [endPlanAltDuplicatePointerDrag])

  const pointerClientToPlanPoint = useCallback((clientX: number, clientY: number): Point | null => {
    const stage = groupRef.current?.getStage()
    const container = stage?.container()
    if (!stage || !container) return null
    const rect = container.getBoundingClientRect()
    const planView = useUIStore.getState().planView
    return {
      x: (clientX - rect.left - planView.pan.x) / planView.zoom,
      y: (clientY - rect.top - planView.pan.y) / planView.zoom,
    }
  }, [])

  const beginPlanAltDuplicatePointerDrag = useCallback(
    (duplicateSource: PlanAltDuplicateSource, refPlacement: Placement) => {
      endPlanAltDuplicatePointerDrag()
      suppressKonvaDragEndRef.current = true

      let latestPosition: Point | null = null
      const previewPosition = (position: Point) => {
        latestPosition = position
        let ghost = planAltDuplicateGhostRef.current
        if (!ghost) {
          const sourceGroup = groupRef.current
          const layer = sourceGroup?.getLayer()
          if (!sourceGroup || !layer) return
          ghost = sourceGroup.clone({
            x: position.x,
            y: position.y,
            draggable: false,
            listening: false,
            opacity: 0.72,
          })
          planAltDuplicateGhostRef.current = ghost
          layer.add(ghost)
          ghost.moveToTop()
        } else {
          ghost.position(position)
        }
        ghost.getLayer()?.batchDraw()
      }

      const onMove = (ev: MouseEvent) => {
        const p = pointerClientToPlanPoint(ev.clientX, ev.clientY)
        if (!p) return
        // This is deliberately imperative: creating a project object here wakes
        // the one-wire canvas and makes the preview latency depend on its size.
        previewPosition(snapPos(p))
      }
      const onUp = (ev: MouseEvent) => {
        const final = pointerClientToPlanPoint(ev.clientX, ev.clientY)
        if (final) previewPosition(snapPos(final))
        if (latestPosition) {
          const targetPlacementId = createPlanAltDuplicatePlacement(duplicateSource, refPlacement)
          if (targetPlacementId) {
            useProjectStore.getState().updatePlacement(targetPlacementId, { pos: latestPosition })
          }
        }
        endPlanAltDuplicatePointerDrag()
      }

      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp, true)
      planAltDuplicatePointerCleanupRef.current = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp, true)
      }
    },
    [endPlanAltDuplicatePointerDrag, pointerClientToPlanPoint, snapPos]
  )

  // Early returns only after all hooks have run
  if (!isJunctionPanel && !isEarthing && (!endpoint || !endpoint.symbol)) return null
  if (!symbol) return null
  if (!processedImage && !isPanelSymbol && !isVectorSocketSymbol && !isEarthing) return null

  // Circuit indicator lines for panel symbols
  const panel = isPanelSymbol ? resolvedPanelForSymbol : null
  const circuitCount = panel ? countPanelCircuits(panel) : 0
  const lineCount = Math.min(circuitCount, PANEL_MAX_CIRCUIT_LINES)
  // The constants are in eendraad pixel coordinates (where SYMBOL_SIZE=40, baseSymbolSizePx=40).
  // In sitplan, baseSymbolSizePx can differ (e.g. when floor has pxPerMeter), so we
  // scale by the ratio of sitplan base size to eendraad base size, plus user placement.scale.
  const sitplanScale = (baseSymbolSizePx / SYMBOL_SIZE) * placement.scale
  const lineStartY = PANEL_CIRCUIT_LINE_START_Y * sitplanScale
  const lineEndY = PANEL_CIRCUIT_LINE_END_Y * sitplanScale
  const lineSpacing = PANEL_CIRCUIT_LINE_SPACING * sitplanScale
  const lineStrokeWidth = PANEL_CIRCUIT_LINE_STROKE_WIDTH * sitplanScale
  const symbolColor = colors.symbolColor
  const panelBodyX = -symbolWidth / 2 + symbolWidth * (4.4 / 88.2)
  const panelBodyY = -symbolHeight / 2 + symbolHeight * (15.6 / 48)
  const panelBodyWidth = symbolWidth * (79.4 / 88.2)
  const panelBodyHeight = symbolHeight * (16.9 / 48)
  const panelBodyGeometry = getPlanPanelBodyGeometry(symbolHeight)
  const panelBodyStrokeWidth = panelBodyGeometry.strokeWidth
  const panelBodyCornerRadius = panelBodyGeometry.cornerRadius

  const junctionPanelInstanceCount = junctionPanelDeviceIds.length

  // Combine local mouse hover with breadcrumb hover
  const isHoveredAny = !isMarqueeSelecting && (isHovered || isHoveredFromBreadcrumb)

  const selectionOutlineStrokeCanvas = screenPxToCanvasUnits(
    currentZoom,
    SELECTION_OUTLINE_STROKE_PX,
    SELECTION_OUTLINE_STROKE_PX_MIN,
    SELECTION_OUTLINE_STROKE_PX_MAX
  )
  const selectionOutlineCornerCanvas = screenPxToCanvasUnits(
    currentZoom,
    SELECTION_OUTLINE_CORNER_RADIUS_PX,
    SELECTION_OUTLINE_CORNER_RADIUS_PX_MIN,
    SELECTION_OUTLINE_CORNER_RADIUS_PX_MAX
  )
  const selectionOutlineWidth = canvasSizeWithScreenMinimum(currentZoom, finalOutlineWidth)
  const selectionOutlineHeight = canvasSizeWithScreenMinimum(currentZoom, outlineHeight)
  const isLocked = placement.locked ?? false
  const panelForTouch =
    !isJunctionPanel && endpoint?.symbol === 'panel_distribution' ? resolvedPanelForSymbol : null

  const symbolGroup = (
    <Group
      ref={groupRef}
      name={
        isEarthing
          ? `earthing-${placement.id}`
          : isJunctionPanel
            ? `junction-panel-${placement.id}`
            : `endpoint-${endpoint!.id}`
      }
      x={pos.x}
      y={pos.y}
      rotation={rotationOverrideDeg ?? dragRotation ?? placement.rotationDeg}
      draggable={
        canDrag && !isLocked && !isDrawingToolActive && (!!isSelected || allowUnselectedMouseDrag)
      }
      listening={!isDrawingToolActive}
      onMouseEnter={handlePlacementMouseEnter}
      onMouseLeave={handlePlacementMouseLeave}
      onPointerDown={(e) => {
        if (!canDrag || isLocked || isDrawingToolActive) return
        if (e.evt.pointerType === 'touch') return
        if (e.evt.button !== 0) return
        const duplicateSource = { endpoint: sourceEndpoint, trunkDevice }
        if (e.evt.altKey && canPlanAltDuplicate(duplicateSource)) {
          // Begin listening now; the first move, rather than Konva's delayed
          // drag-start, creates and displays the copy.
          beginPlanAltDuplicatePointerDrag(duplicateSource, placement)
          return
        }
        if (!isSelected) {
          flushSync(() => setAllowUnselectedMouseDrag(true))
        }
      }}
      onPointerUp={(e) => {
        if (e.evt.pointerType !== 'touch') setAllowUnselectedMouseDrag(false)
      }}
      onPointerCancel={(e) => {
        if (e.evt.pointerType !== 'touch') {
          setAllowUnselectedMouseDrag(false)
          endPlanAltDuplicatePointerDrag()
        }
      }}
      onDragStart={(e) => {
        // Prevent drag if locked
        if (!canDrag || isLocked || isDrawingToolActive) {
          e.cancelBubble = true
          return
        }
        // An Alt gesture is managed from pointer-down so the preview starts on
        // its first movement. Keep Konva from starting a competing source drag.
        if (planAltDuplicatePointerCleanupRef.current) {
          e.target.stopDrag()
          e.target.position({ x: pos.x, y: pos.y })
          return
        }
        const nativeEvt = e.evt as unknown as { pointerType?: string }
        const ptrType = typeof nativeEvt.pointerType === 'string' ? nativeEvt.pointerType : ''
        const isTouchLike = ptrType === 'touch'
        if (isTouchLike && !isSelected) {
          e.target.stopDrag()
          return
        }
        if (!isTouchLike && !isSelected) {
          applyPlanSymbolPointerSelection(e.evt)
        }

        const sel = useUIStore.getState().selection
        const endpointSelectionMovesMultiplePlacements =
          !isJunctionPanel &&
          !isEarthing &&
          endpointSelectionShouldDragAllPlacements(sel, endpoint, placement)
        const useMulti =
          !isJunctionPanel &&
          !isEarthing &&
          !!onMultiSelectDragStart &&
          (sel.type === 'placement' || sel.type === 'endpoint') &&
          (sel.ids.length > 1 || endpointSelectionMovesMultiplePlacements) &&
          (sel.type === 'placement'
            ? sel.ids.includes(placement.id)
            : !!(endpoint && sel.ids.includes(endpoint.id)))

        planDragMultiRef.current = useMulti

        if (useMulti) {
          onMultiSelectDragStart!(placement.id)
        } else {
          onDragStart?.()
        }
      }}
      onDragMove={(e) => {
        // Prevent drag if locked
        if (!canDrag || isLocked || isDrawingToolActive) {
          e.cancelBubble = true
          return
        }
        // Update positions in real-time during drag for smooth movement
        if (planDragMultiRef.current && onMultiSelectDrag) {
          const currentPos = snapPos({ x: e.target.x(), y: e.target.y() })
          e.target.position(currentPos)
          const dragId = placement.id
          onMultiSelectDrag(dragId, currentPos)
        } else {
          const currentPos = snapPos({ x: e.target.x(), y: e.target.y() })
          e.target.position(currentPos)
          // Single element drag move
          onDragMove?.(e)
        }
      }}
      onDragEnd={(e) => {
        // Prevent drag if locked
        if (!canDrag || isLocked || isDrawingToolActive) {
          e.cancelBubble = true
          return
        }
        const newPos = snapPos({ x: e.target.x(), y: e.target.y() })
        e.target.position(newPos)

        const wasMulti = planDragMultiRef.current
        planDragMultiRef.current = false

        // Final update on drag end
        if (wasMulti && onMultiSelectDrag) {
          onMultiSelectDrag(placement.id, newPos)
          onMultiSelectDragEnd?.()
        } else if (suppressKonvaDragEndRef.current) {
          e.target.position({ x: pos.x, y: pos.y })
        } else {
          if (isJunctionPanel) {
            useProjectStore.getState().updateJunctionPanelPlacement(placement.id, { pos: newPos })
          } else if (isEarthing) {
            useProjectStore.getState().updateEarthingPlacement(placement.id, { pos: newPos })
          } else {
            useProjectStore.getState().updatePlacement(placement.id, { pos: newPos })
          }
          onDragEnd?.(newPos)
        }
      }}
      onClick={handleClick}
      onTap={handleClick}
    >
      {planPlacementDebug && (
        <Rect
          x={-outlineWidth / 2}
          y={-outlineHeight / 2}
          width={finalOutlineWidth}
          height={outlineHeight}
          fill={isHoveredAny ? 'rgba(234, 88, 12, 0.18)' : 'rgba(14, 165, 233, 0.12)'}
          stroke={isHoveredAny ? '#ea580c' : '#0ea5e9'}
          strokeWidth={1}
          dash={[4, 3]}
          listening={false}
        />
      )}
      {/* Render socket symbols (1-4 copies offset in local +X, which rotates with the group) */}
      {Array.from({ length: socketCount }, (_, i) => (
        <Group key={i} x={i * socketOffset}>
          {isPanelSymbol ? (
            <Rect
              x={panelBodyX}
              y={panelBodyY}
              width={panelBodyWidth}
              height={panelBodyHeight}
              fill="transparent"
              stroke={symbolColor}
              strokeWidth={panelBodyStrokeWidth}
              cornerRadius={panelBodyCornerRadius}
              listening={false}
            />
          ) : isVectorSocketSymbol && endpoint?.symbol ? (
            <>
              <Rect
                x={-outlineWidth / 2}
                y={-outlineHeight / 2}
                width={outlineWidth}
                height={outlineHeight}
                fill={INTERACTIVE_HIT_FILL}
                listening={i === 0 && !touchPrimary}
              />
              {renderSocketVectorSymbol(endpoint.symbol, outlineWidth, outlineHeight, symbolColor)}
            </>
          ) : isDirectionalConverter && converterDiagonalImage && converterArtworkLayout ? (
            <>
              <Image
                image={processedImage ?? undefined}
                width={outlineWidth}
                height={outlineHeight}
                offsetX={outlineWidth / 2}
                offsetY={outlineHeight / 2}
                listening={i === 0 && !touchPrimary}
              />
              <Image
                image={converterDiagonalImage}
                width={outlineWidth}
                height={outlineHeight}
                offsetX={outlineWidth / 2}
                offsetY={outlineHeight / 2}
                scaleX={converterArtworkLayout.diagonal === 'top-left-to-bottom-right' ? -1 : 1}
                listening={false}
              />
              {(['AC', 'DC'] as const).map((domain) => {
                const image = domain === 'AC' ? converterAcImage : converterDcImage
                const corner = getConverterDomainCorner(converterArtworkLayout, domain)
                if (!image || !corner) return null
                const symbolExtent = Math.min(outlineWidth, outlineHeight)
                // AC/DC SVGs use a 24×24 viewBox while the converter artwork
                // uses 48×48. Render them at half the converter size so their
                // visible strokes match the original combined SVGs.
                const iconSize = symbolExtent * CONVERTER_DOMAIN_ICON_SIZE_RATIO
                const point = getConverterCornerPosition(
                  corner,
                  outlineWidth,
                  outlineHeight,
                  symbolExtent * 0.12,
                  iconSize,
                  iconSize,
                  false
                )
                return (
                  <Image
                    key={domain}
                    image={image}
                    width={iconSize}
                    height={iconSize}
                    offsetX={iconSize / 2}
                    offsetY={iconSize / 2}
                    x={point.x}
                    y={point.y}
                    listening={false}
                  />
                )
              })}
            </>
          ) : (
            <Image
              image={processedImage ?? undefined}
              width={outlineWidth}
              height={outlineHeight}
              offsetX={outlineWidth / 2}
              offsetY={outlineHeight / 2}
              listening={i === 0 && !touchPrimary}
            />
          )}
          {endpoint?.symbol === 'relay' && relayOverlayImage && (
            <Image
              image={relayOverlayImage}
              width={outlineWidth}
              height={outlineHeight}
              offsetX={outlineWidth / 2}
              offsetY={outlineHeight / 2}
              listening={false}
            />
          )}
          {endpoint?.symbol === 'smoke_detector' && smokeDetectorOverlayImage && (
            <Image
              image={smokeDetectorOverlayImage}
              width={outlineWidth}
              height={outlineHeight}
              offsetX={outlineWidth / 2}
              offsetY={outlineHeight / 2}
              listening={false}
            />
          )}
          {overlaySwitchImage && (
            <Image
              image={overlaySwitchImage}
              width={outlineWidth}
              height={outlineHeight}
              offsetX={outlineWidth / 2}
              offsetY={outlineHeight / 2}
              listening={false}
            />
          )}
          {overlaySwitchLockImage && (
            <Image
              image={overlaySwitchLockImage}
              width={outlineWidth}
              height={outlineHeight}
              offsetX={outlineWidth / 2}
              offsetY={outlineHeight / 2}
              listening={false}
            />
          )}
          {switchOverlayImage && (
            <Image
              image={switchOverlayImage}
              width={outlineWidth}
              height={outlineHeight}
              offsetX={outlineWidth / 2}
              offsetY={outlineHeight / 2}
              listening={false}
            />
          )}
          {endpoint?.symbol === 'switch_impulse' && (
            <ImpulseSwitchCountMarker
              count={endpoint.switchProps?.switchingCount ?? 1}
              size={outlineWidth}
              color={symbolColor}
              fontFamily={fontFamily}
            />
          )}
          {/* Light point overlays (safety, switch 1p); no onWall on sitplan */}
          {isLightPoint && lightPointSafetyImage && (
            <Image
              image={lightPointSafetyImage}
              width={outlineWidth}
              height={outlineHeight}
              offsetX={outlineWidth / 2}
              offsetY={outlineHeight / 2}
              listening={false}
            />
          )}
          {isLightPoint && lightPointDecentralImage && (
            <Image
              image={lightPointDecentralImage}
              width={outlineWidth}
              height={outlineHeight}
              offsetX={outlineWidth / 2}
              offsetY={outlineHeight / 2}
              listening={false}
            />
          )}
          {isLightPoint && lightPointSwitchImage && (
            <Image
              image={lightPointSwitchImage}
              width={outlineWidth}
              height={outlineHeight}
              offsetX={outlineWidth / 2}
              offsetY={outlineHeight / 2}
              listening={false}
            />
          )}
          {/* Light fluorescent: tube lines — match 1draad spacing exactly, scaled to sitplan size */}
          {isLightFluorescent &&
            (() => {
              // Match EndpointSymbol logic:
              // - SYMBOL_SIZE space, tubeMarginX = 0.5
              // - 1 tube: y = 0
              // - 2 tubes: bandHeight = SYMBOL_SIZE * 0.2, y = ±bandHeight/2
              // - 3 tubes: step = SYMBOL_SIZE / 8, y = [-step, 0, step]
              const scaleX = outlineWidth / SYMBOL_SIZE
              const scaleY = outlineHeight / SYMBOL_SIZE

              const baseTubeMarginX = 0.5
              const halfSpanBase = SYMBOL_SIZE / 2 - baseTubeMarginX
              const halfSpan = halfSpanBase * scaleX

              let baseYPositions: number[]
              if (tubeCount === 1) {
                baseYPositions = [0]
              } else if (tubeCount === 2) {
                const bandHeightBase = SYMBOL_SIZE * 0.2
                baseYPositions = [-bandHeightBase / 2, bandHeightBase / 2]
              } else {
                const stepBase = SYMBOL_SIZE / 8
                baseYPositions = [-stepBase, 0, stepBase]
              }

              const yPositions = baseYPositions.map((y) => y * scaleY)

              const strokeWidth = Math.max(0.8, 1 * scaleX)

              return yPositions.map((y, idx) => (
                <Line
                  key={idx}
                  points={[-halfSpan, y, halfSpan, y]}
                  stroke={symbolColor}
                  strokeWidth={strokeWidth}
                  listening={false}
                />
              ))
            })()}
          {/* Light spot: beam overlay */}
          {isLightSpot && lightSpotBeamImage && (
            <Image
              image={lightSpotBeamImage}
              width={outlineWidth}
              height={outlineHeight}
              offsetX={outlineWidth / 2}
              offsetY={outlineHeight / 2}
              listening={false}
            />
          )}

          {/* HVAC overlays: mirror 1draad layout (type center, energy + function at bottom) */}
          {isHvac && (
            <>
              {/* Type overlay (centered, with small upward offset for heat exchange) */}
              {hvacTypeImage && (
                <Image
                  image={hvacTypeImage}
                  width={outlineWidth}
                  height={outlineHeight}
                  offsetX={outlineWidth / 2}
                  offsetY={outlineHeight / 2}
                  // Scale the 1draad offset into sitplan coordinates
                  y={
                    hvacTypeKey === 'heat_exchange'
                      ? HVAC_HEAT_EXCHANGE_TYPE_OFFSET_Y * (outlineHeight / SYMBOL_SIZE)
                      : 0
                  }
                  listening={false}
                />
              )}
              {(() => {
                const hasEnergy = !!hvacEnergyImage && hvacEnergyKey !== 'none'
                const hasFunction = hvacFunctionKey !== 'none'
                if (!hasEnergy && !hasFunction) return null

                const energyOffsetY = SYMBOL_SIZE * HVAC_ENERGY_OFFSET_Y_FACTOR
                const scaleY = outlineHeight / SYMBOL_SIZE
                const baseY = energyOffsetY * scaleY

                const scaleX = outlineWidth / SYMBOL_SIZE
                const xOffsetBase = SYMBOL_SIZE * HVAC_FUNCTION_OFFSET_X_FACTOR
                const xOffset = xOffsetBase * scaleX

                const energyX = hasEnergy && hasFunction ? -xOffset : 0
                const funcX = hasEnergy && hasFunction ? xOffset : 0

                const funcText =
                  hvacFunctionKey === 'heat'
                    ? '+'
                    : hvacFunctionKey === 'cool'
                      ? '-'
                      : hvacFunctionKey === 'heat_cool'
                        ? '+/-'
                        : ''

                // Center text visually over funcX (scaled to sitplan coordinates)
                const funcXAdjust =
                  funcText === '+/-'
                    ? -SYMBOL_SIZE * 0.07 * scaleX
                    : funcText.length === 1
                      ? SYMBOL_SIZE * 0.02 * scaleX
                      : 0

                return (
                  <>
                    {hasEnergy && hvacEnergyImage && (
                      <Image
                        image={hvacEnergyImage}
                        width={outlineWidth}
                        height={outlineHeight}
                        offsetX={outlineWidth / 2}
                        offsetY={outlineHeight / 2}
                        x={energyX}
                        y={baseY}
                        listening={false}
                      />
                    )}
                    {hasFunction && funcText && (
                      <Text
                        text={funcText}
                        x={funcX + funcXAdjust}
                        y={baseY - 2}
                        fontSize={4 * (outlineHeight / SYMBOL_SIZE)}
                        fill={symbolColor}
                        align="center"
                        listening={false}
                      />
                    )}
                  </>
                )
              })()}
            </>
          )}

          {/* Transformer overlays – sitplan */}
          {isTransformer && transformerSafetyImage && (
            <Image
              image={transformerSafetyImage}
              width={outlineWidth}
              height={outlineHeight}
              offsetX={outlineWidth / 2}
              offsetY={outlineHeight / 2}
              listening={false}
            />
          )}
          {isTransformer && transformerShortcircuitImage && (
            <Image
              image={transformerShortcircuitImage}
              width={outlineWidth}
              height={outlineHeight}
              offsetX={outlineWidth / 2}
              offsetY={outlineHeight / 2}
              listening={false}
            />
          )}
          {isTransformer && transformerProtectionImage && (
            <Image
              image={transformerProtectionImage}
              width={outlineWidth}
              height={outlineHeight}
              offsetX={outlineWidth / 2}
              offsetY={outlineHeight / 2}
              listening={false}
            />
          )}

          {/* Transformer overlay label – sitplan */}
          {isTransformer && transformerLabel && (
            <Text
              x={0}
              y={-outlineHeight / 2 - 4 * (outlineHeight / SYMBOL_SIZE)}
              text={transformerLabel}
              fontSize={(8 * outlineHeight) / SYMBOL_SIZE}
              fontFamily={fontFamily}
              fill={colors.symbolColor}
              align="center"
              listening={false}
            />
          )}
        </Group>
      ))}

      {/* Circuit indicator lines for panel symbols */}
      {isPanelSymbol &&
        lineCount > 0 &&
        Array.from({ length: lineCount }).map((_, i) => {
          // Calculate X position for each line, spread equally across lineSpacing
          const xOffset = lineCount === 1 ? 0 : (i / (lineCount - 1) - 0.5) * lineSpacing

          // In eendraad, the symbol uses offsetY = PANEL_SYMBOL_HEIGHT/4, which shifts it down
          // In sitplan, the symbol is centered (offsetY = height/2), so we need to adjust
          // the line positions to match eendraad's visual appearance
          const yAdjustment = -(PANEL_SYMBOL_HEIGHT / 3) * sitplanScale

          return (
            <Line
              key={`circuit-line-${i}`}
              points={[xOffset, lineStartY + yAdjustment, xOffset, lineEndY + yAdjustment]}
              stroke={symbolColor}
              strokeWidth={lineStrokeWidth}
              listening={false}
            />
          )
        })}

      {/* Supply feed line for panel symbols (sitplan only) — single central line on opposite side of circuit lines */}
      {isPanelSymbol &&
        (() => {
          const yAdj = (PANEL_SYMBOL_HEIGHT / 3) * sitplanScale
          // Circuit lines go from START_Y to END_Y (upward). Supply line goes the other way (downward).
          const supplyStartY = -PANEL_CIRCUIT_LINE_START_Y * sitplanScale + yAdj
          const supplyEndY = -PANEL_CIRCUIT_LINE_END_Y * sitplanScale + yAdj
          return (
            <Line
              points={[0, supplyStartY, 0, supplyEndY]}
              stroke={symbolColor}
              strokeWidth={lineStrokeWidth}
              listening={false}
            />
          )
        })()}

      {/* Junction panel tick wires above and below symbol (mirrors panel spacing, capped at 8) */}
      {isJunctionPanel &&
        junctionPanelInstanceCount > 0 &&
        (() => {
          const yAdj = (PANEL_SYMBOL_HEIGHT / 2) * sitplanScale - 0.5
          const topStartY = lineStartY + yAdj
          const topEndY = lineEndY + yAdj
          const bottomStartY = -PANEL_CIRCUIT_LINE_START_Y * sitplanScale - yAdj
          const bottomEndY = -PANEL_CIRCUIT_LINE_END_Y * sitplanScale - yAdj
          const count = Math.min(junctionPanelInstanceCount, PANEL_MAX_CIRCUIT_LINES)
          return Array.from({ length: count }).map((_, i) => {
            const xOffset = count === 1 ? 0 : (i / (count - 1) - 0.5) * lineSpacing
            return (
              <React.Fragment key={`jp-lines-${i}`}>
                <Line
                  points={[xOffset, topStartY, xOffset, topEndY]}
                  stroke={symbolColor}
                  strokeWidth={lineStrokeWidth}
                  listening={false}
                />
                <Line
                  points={[xOffset, bottomStartY, xOffset, bottomEndY]}
                  stroke={symbolColor}
                  strokeWidth={lineStrokeWidth}
                  listening={false}
                />
              </React.Fragment>
            )
          })
        })()}

      {/* Hover highlight (from breadcrumb or mouse) — outer symbol bounds */}
      {isHoveredAny && !isSelected && !isPreviewSelected && (
        <Rect
          name={INTERACTIVE_OVERLAY_EXPORT_NAME}
          x={-selectionOutlineWidth / 2}
          y={-selectionOutlineHeight / 2}
          width={selectionOutlineWidth}
          height={selectionOutlineHeight}
          fill="transparent"
          stroke="#fbbf24"
          strokeWidth={selectionOutlineStrokeCanvas}
          dash={[
            screenPxToCanvasUnits(currentZoom, 4, 2, 8),
            screenPxToCanvasUnits(currentZoom, 4, 2, 8),
          ]}
          cornerRadius={selectionOutlineCornerCanvas}
          listening={false}
        />
      )}
      {/* Selection outline — outer symbol bounds */}
      {(isSelected || isPreviewSelected) && (
        <Rect
          name={INTERACTIVE_OVERLAY_EXPORT_NAME}
          x={-selectionOutlineWidth / 2}
          y={-selectionOutlineHeight / 2}
          width={selectionOutlineWidth}
          height={selectionOutlineHeight}
          fill="transparent"
          stroke="#fbbf24"
          strokeWidth={selectionOutlineStrokeCanvas}
          cornerRadius={selectionOutlineCornerCanvas}
          listening={false}
        />
      )}
      {isQuickPlacerCurrent && (
        <Rect
          name={INTERACTIVE_OVERLAY_EXPORT_NAME}
          x={-outlineWidth / 2 - 6 / currentZoom}
          y={-outlineHeight / 2 - 6 / currentZoom}
          width={finalOutlineWidth + 12 / currentZoom}
          height={outlineHeight + 12 / currentZoom}
          fill="transparent"
          stroke="#0ea5e9"
          strokeWidth={selectionOutlineStrokeCanvas}
          dash={[
            screenPxToCanvasUnits(currentZoom, 6, 3, 10),
            screenPxToCanvasUnits(currentZoom, 4, 2, 8),
          ]}
          cornerRadius={selectionOutlineCornerCanvas + 4 / currentZoom}
          listening={false}
        />
      )}
      {/* Hit target on top of visuals so panel body / image shapes cannot carve out dead zones */}
      <Rect
        {...placementHitRect}
        fill={INTERACTIVE_HIT_FILL}
        listening={!touchPrimary}
        onMouseEnter={handlePlacementMouseEnter}
        onMouseLeave={handlePlacementMouseLeave}
        onClick={handleClick}
        onTap={handleClick}
        onPointerDown={(e) => {
          if (planPlacementDebug && endpoint?.type === 'socket') {
            logger.info('[PlanSocketDebug] hitbox pointer down', {
              placementId: placement.id,
              endpointId: endpoint.id,
              symbol: endpoint.symbol,
              button: e.evt.button,
              pointerType: (e.evt as PointerEvent).pointerType,
              pos,
              rotationDeg: rotationOverrideDeg ?? placement.rotationDeg,
              outlineWidth,
              outlineHeight,
              finalOutlineWidth,
            })
          }
          if (!canDrag || isLocked || isDrawingToolActive) return
          if (e.evt.pointerType === 'touch') return
          if (e.evt.button !== 0) return
          if (!isSelected) {
            flushSync(() => setAllowUnselectedMouseDrag(true))
          }
        }}
      />
      {touchPrimary && (
        <Rect
          {...placementHitRect}
          fill={INTERACTIVE_HIT_FILL}
          listening
          onMouseEnter={handlePlacementMouseEnter}
          onMouseLeave={handlePlacementMouseLeave}
          onClick={handleClick}
          onTap={handleClick}
        />
      )}
    </Group>
  )

  const wrappedSymbolGroup = <Group name={`placement-${placement.id}`}>{symbolGroup}</Group>

  if (panelForTouch) {
    return <Group name={`panel-${panelForTouch.id}`}>{wrappedSymbolGroup}</Group>
  }
  return wrappedSymbolGroup
}

export const PlacementSymbol = React.memo(PlacementSymbolInner)
