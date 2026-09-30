import {
  hasSupplyInlineLabels,
  getSupplyInlineLabelLines,
} from '@/lib/layout/supplyInlineDeviceLabels'
import { useState, useEffect, useCallback, useContext, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  HOVER_OUTLINE_DASH_PX,
  HOVER_OUTLINE_DASH_PX_MAX,
  HOVER_OUTLINE_DASH_PX_MIN,
  HOVER_OUTLINE_STROKE_PX,
  HOVER_OUTLINE_STROKE_PX_MAX,
  HOVER_OUTLINE_STROKE_PX_MIN,
  WIRE_SELECTION_EXTRA_PX,
  WIRE_SELECTION_EXTRA_PX_MAX,
  WIRE_SELECTION_EXTRA_PX_MIN,
  ZOOM_100,
  screenPxToCanvasUnits,
} from '@/constants/canvasConstants'
import { Group, Image, Line, Rect, Text } from 'react-konva'
import {
  getDomainForSymbol,
  getSwitchSymbolPaths,
  getSwitchDisplaySvgPath,
  getSymbolById,
  SOCKET_OVERLAY_PATHS,
  DOMOTICA_CONTROL_OVERLAY_PATHS,
  TRANSFORMER_OVERLAY_PATHS,
  RELAY_OVERLAY_PATHS,
} from '@/lib/symbols'
import { SYMBOL_EXPORT_ATTR_SVG_PATH, loadProcessedSymbol } from '@/lib/symbolImage'
import {
  getSurgeProtectionBodyBounds,
  getSurgeProtectionSymbolPath,
  getSurgeProtectionSymbolAnchor,
  getSurgeProtectionSelectionBounds,
} from '@/lib/surgeProtectionSymbol'
import { useSettingsStore } from '@/stores/settingsStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import {
  useClearHover,
  useHoverIncludes,
  useSetHover,
  useSetSelection,
  useTrunkDeviceSelected,
} from '@/editions/community/communityHooks'
import { useIsPreviewSelected } from '@/contexts/SelectionPreviewContext'
import { useCanvasFontFamily, useEffectiveCanvasZoom, useTouchPrimaryDevice } from '@/editions/community/communityHooks'
import { SymbolTextLabels } from './SymbolTextLabels'
import {
  getJunctionIdentity,
  getJunctionIdentityDisplay,
  getJunctionIdentityLabelPosition,
  isJunctionIdentityVisibleByDefault,
  isSharedJunctionSymbol,
} from '@/lib/junctionIdentity'
import { getEffectiveTerminalStripOutgoingPin } from '@/lib/terminalStrip/labels'
import {
  SYMBOL_SIZE,
  ENDPOINT_OUTLINE_SIZE,
  getTouchAwareHitAreaProps,
  getSelectionOutlineProps,
  getHoverOutlineProps,
  getPreviewOutlineProps,
  getPaddedRectSelectionOutlineProps,
  getPaddedRectHoverOutlineProps,
  getPaddedRectPreviewOutlineProps,
  getSecondaryTextColor,
  getSymbolColor,
  getTextColor,
  SELECTION_COLOR,
  DOMOTICA_BASE_HEIGHT,
  DOMOTICA_BOX_WIDTH,
  DOMOTICA_OUTPUT_SPACING,
  DOMOTICA_MAX_ENDPOINT_OUTPUTS,
  DOMOTICA_MIN_ENDPOINT_OUTPUTS,
  DOMOTICA_CONTROL_BAR_HEIGHT,
} from './canvasSymbols'
import { ProtectionOneWireLabels } from './ProtectionOneWireLabels'
import { useEendraadWireSegments } from '@/hooks/eendraad'
import { getCertificationSideLabelExtraOffsetPx } from '@/lib/conversionSideLabelOffset'
import { getVisibleCertificationLabelParts } from '@/lib/certificationLabels'
import { getVisibleConversionLabelParts } from '@/lib/conversionLabels'
import { isSymbolLabelVisible } from '@/lib/symbolLabels'
import type { DomoticaControlKey, SymbolLabelPosition, TrunkDevice } from '@/types/schema'
import type { Point } from '@/types/ui'
import { getSupplyDeviceMultiplier } from '@/lib/supplyAssembly/inverterMultipliers'
import { openSupplyDeviceAddMoreDialog } from '@/components/endpoints/AddMoreCountDialog'
import { MultiplierBadge } from './MultiplierBadge'
import { useCanvasPanOrClickGesture } from './CanvasPanOrClickGesture'
import { DomainMarker } from './DomainMarker'
import { getProjectElectricalInstallation } from '@/lib/projectV2/electrical'
import { resolveEarthingSeparatorPairIds } from '@/lib/eendraad/earthingSeparatorPairs'
import {
  getPhaseAssignmentLabel,
  phaseAssignmentDiffersFromInstallation,
} from '@/lib/wires/phaseAssignment'
import { getSupplyConverterAcPhaseAssignment } from '@/lib/supplyAssembly/supplyConverterPhases'
import { INTERACTIVE_OVERLAY_EXPORT_NAME } from '@/lib/export/interactiveOverlayExport'
import {
  CONVERTER_ARTWORK_PATHS,
  CONVERTER_DOMAIN_ICON_SIZE_RATIO,
  getConverterArtworkLayout,
  getConverterConnectionDomains,
  getConverterCornerPosition,
  getConverterDomainCorner,
  getSeparateSupplyInverterArtworkLayout,
  getSeparateSupplyInverterDomainMarkers,
  isDirectionalConverterSymbol,
} from '@/lib/converterArtwork'
import { countSymbolLabelVisualLines } from '@/lib/symbolLabelMetrics'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import {
  getSupplyMetadataCalloutGroupPlacements,
  getSupplyMetadataCalloutClusters,
  getSupplyMetadataCalloutLeaderPoints,
  getSupplyMetadataCalloutPlacement,
  getSupplyMetadataCalloutPlacementKind,
  getSupplyMetadataSharedLeaderPointSets,
  canRenderSupplyMetadataCallout,
  isSupplyMetadataCalloutDevice,
  shouldUseSupplyDeviceMetadataCallout,
} from '@/lib/supplyMetadataCallout'
import { getCircuitLabelVisualRect } from '@/lib/layout/bottomUpLayout'
import { resolveTrunkDeviceMetadataCalloutSelection } from '@/lib/ui/metadataCalloutSelection'
import {
  applyMetadataCalloutMultiplier,
  getMetadataCalloutWidth,
} from '@/lib/metadataCalloutGrouping'
import {
  getCircuitConverterDcConnectionCount,
  getSupplyConverterBodyGeometry,
  supportsCircuitConverterDcConnections,
} from '@/lib/layout/circuitConverterGeometry'
import {
  clampConverterDcConnectionCount,
  resizeConverterDcConnections,
} from '@/lib/eendraad/resizeConverterDcConnections'
import { isVerticalSupplyDevice } from '@/lib/layout/supplyDeviceOrientation'
import type { SupplyTopLabelPlacement } from '@/lib/layout/supplyTopLabelLayout'
import { ConverterResizeViewportContext } from './ConverterResizeViewportContext'

type EendraadPointerEvent = {
  cancelBubble: boolean
  evt: {
    button?: number
    shiftKey?: boolean
    altKey?: boolean
    ctrlKey?: boolean
    metaKey?: boolean
  }
}
type WindowWithEendraTapSuppression = Window & { __eendraSuppressNextElementTap?: boolean }

const CONVERTER_RESIZE_OUTLINE_PADDING = 4
const CONVERTER_RESIZE_HANDLE_WIDTH = 6
const CONVERTER_RESIZE_HANDLE_HIT_WIDTH = 14

interface TrunkDeviceSymbolProps {
  device: TrunkDevice
  position: Point
  /** Original circuit-trunk anchor when a widened converter's painted center shifts right. */
  circuitConverterAnchor?: Point
  converterGrowthDirection?: 'left' | 'right'
  /** Painted width of a selectable DC busbar. */
  dcBusWidth?: number
  /** Circuit-level collision-solved metadata frame for a widened converter. */
  metadataCallout?: {
    x: number
    y: number
    width: number
    height: number
    leaderPoints: [number, number, number, number]
    targetIds?: string[]
  }
  /** Other devices on this supply lane, used to keep metadata cards apart. */
  supplyDevicePositions?: Array<{
    device: TrunkDevice
    x: number
    y: number
    metadataCalloutRect?: { left: number; top: number; right: number; bottom: number }
    topLabelPlacements?: SupplyTopLabelPlacement[]
  }>
  /** Left-to-right supply layouts are solved in canonical space, then mirrored back. */
  supplyMirrorAxisX?: number
  supplyPanelMainBusY?: number
  supplyPanelId?: string
  supplyPanelLabel?: string
  /** Attached supply wires may use the device-specific vertical notes preference. */
  allowVerticalSupplyNotes?: boolean
  /** If true, symbol is on a horizontal wire (supply trunk). Default: vertical trunk. */
  isHorizontal?: boolean
  /** Artwork rotation resolved by the shared layout tree. */
  symbolRotationDeg?: number
  /** Show the device's own label on the left for special vertical feeder contexts. */
  showDeviceLabelLeft?: boolean
  /** Split a wide residual-current line to avoid adjacent supply-label collisions. */
  splitProtectionResidualLine?: boolean
  /** Override protection label placement for a wire branch with a fixed orientation. */
  protectionLabelPosition?: SymbolLabelPosition
  /** Drop target uses cursor position on drag end (same as protection / endpoint). */
  getCanvasPositionFromEvent?: (e: unknown) => Point | null
  onDragMove?: (newPos: Point) => void
  onDragEnd?: (newPos: Point) => boolean | void
  onDragStart?: (altKey: boolean, nativeEvt: MouseEvent) => boolean
  shouldSuppressKonvaDragEnd?: () => boolean
  /** Circuit trunk devices: allow 1‑draad drag to another trunk when selected alone. */
  draggableCircuitTrunk?: boolean
}

const SUPPLY_METADATA_FONT_SIZE = 8
const CONVERTER_ARTWORK_VIEWBOX_SIZE = 48
const CONVERTER_ARTWORK_EDGE = 5.3
const CONVERTER_ARTWORK_STROKE = 2

function getSupplyMetadataLinesForDevice(device: TrunkDevice, multiplier = 1): string[] {
  const certificationParts = getVisibleCertificationLabelParts(device)
  const conversionParts =
    device.type === 'conversion' || device.symbol === 'solar_panel' || device.symbol === 'battery'
      ? getVisibleConversionLabelParts(device)
      : []
  const notesText = (device.notes ?? '').trim()
  const showNotes =
    !hasSupplyInlineLabels(device) &&
    notesText.length > 0 &&
    isSymbolLabelVisible(device.symbolLabelDisplay, 'trunkDeviceNotes', true)

  return applyMetadataCalloutMultiplier(
    [
      ...conversionParts,
      ...certificationParts,
      ...(showNotes ? [{ key: 'trunkDeviceNotes', text: notesText }] : []),
    ],
    multiplier
  ).map((item) => item.text)
}

function getSupplyMetadataCardSize(
  lines: string[],
  fontFamily: string
): { width: number; height: number } {
  const visualLineCount = lines.reduce(
    (total, line) => total + countSymbolLabelVisualLines(line),
    0
  )
  return {
    width: getMetadataCalloutWidth(
      lines.map((line) => measureSymbolLabelTextWidth(line, fontFamily, SUPPLY_METADATA_FONT_SIZE))
    ),
    height: visualLineCount * 10 + 10,
  }
}

/**
 * Renders a trunk device symbol (e.g. energy meter) on a wire.
 * Works for both vertical circuit trunks and horizontal supply wires.
 */
export function TrunkDeviceSymbol({
  device,
  position,
  circuitConverterAnchor,
  converterGrowthDirection,
  dcBusWidth,
  metadataCallout,
  supplyDevicePositions,
  supplyMirrorAxisX,
  supplyPanelMainBusY,
  supplyPanelId,
  supplyPanelLabel,
  allowVerticalSupplyNotes = false,
  isHorizontal,
  symbolRotationDeg,
  showDeviceLabelLeft = false,
  splitProtectionResidualLine = false,
  protectionLabelPosition,
  getCanvasPositionFromEvent,
  onDragMove,
  onDragEnd,
  onDragStart,
  shouldSuppressKonvaDragEnd,
  draggableCircuitTrunk = false,
}: TrunkDeviceSymbolProps) {
  const resizeConverterWithViewportAnchor = useContext(ConverterResizeViewportContext)
  const setSelection = useSetSelection()
  const setHover = useSetHover()
  const clearHover = useClearHover()
  const { t } = useTranslation()
  const isSelected = useTrunkDeviceSelected(device)
  const canDragTrunk = useUIStore(
    (s) => draggableCircuitTrunk && s.selection.ids.includes(device.id)
  )
  const isHoveredFromBreadcrumb = useHoverIncludes('trunkDevice', device.id)
  const canvasZoom = useEffectiveCanvasZoom(ZOOM_100, 'eendraad')
  const touchPrimary = useTouchPrimaryDevice()
  const theme = useSettingsStore((state) => state.theme)
  const fontFamily = useCanvasFontFamily()
  const isPreviewSelected = useIsPreviewSelected('trunkDevice', device.id)
  const [processedImage, setProcessedImage] = useState<HTMLImageElement | null>(null)
  const [converterDiagonalImage, setConverterDiagonalImage] = useState<HTMLImageElement | null>(
    null
  )
  const [converterAcImage, setConverterAcImage] = useState<HTMLImageElement | null>(null)
  const [converterDcImage, setConverterDcImage] = useState<HTMLImageElement | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [converterResizePreviewCount, setConverterResizePreviewCount] = useState<number | null>(
    null
  )
  const converterResizeCountRef = useRef<number | null>(null)
  const [transformerSafetyImage, setTransformerSafetyImage] = useState<HTMLImageElement | null>(
    null
  )
  const [transformerShortcircuitImage, setTransformerShortcircuitImage] =
    useState<HTMLImageElement | null>(null)
  const [transformerProtectionImage, setTransformerProtectionImage] =
    useState<HTMLImageElement | null>(null)
  const [domoticaMainImage, setDomoticaMainImage] = useState<HTMLImageElement | null>(null)
  const [domoticaMainSocketOverlayImage, setDomoticaMainSocketOverlayImage] =
    useState<HTMLImageElement | null>(null)
  const [domoticaControlImages, setDomoticaControlImages] = useState<
    Partial<Record<DomoticaControlKey, HTMLImageElement | null>>
  >({})

  const symbol = getSymbolById(device.symbol)
  const isInlineSwitch = symbol?.category === 'switches'
  const isDark = theme?.mode === 'dark'
  const phaseSystem = useProjectStore((state) =>
    state.currentProject
      ? getProjectElectricalInstallation(state.currentProject)?.nominalVoltage.system
      : undefined
  )
  const supplyTrunkNotesOrientation = useProjectStore((state) =>
    state.currentProject
      ? getProjectElectricalInstallation(state.currentProject)?.supplyTrunkNotesOrientation
      : undefined
  )
  const isTransformer = device.symbol === 'transformer'
  const conversionProps = device.conversionProps
  const supplyDeviceMultiplier = getSupplyDeviceMultiplier(device)
  const isConversionSymbol =
    device.symbol === 'transformer' ||
    device.symbol === 'rectifier' ||
    device.symbol === 'inverter' ||
    device.symbol === 'dc_dc_converter'
  const isDirectionalConverter =
    isDirectionalConverterSymbol(device.symbol) ||
    (!!circuitConverterAnchor && device.symbol === 'dc_dc_converter')
  const converterAcPhaseAssignment =
    isConversionSymbol && device.symbol !== 'dc_dc_converter' && phaseSystem
      ? getSupplyConverterAcPhaseAssignment(device, phaseSystem)
      : undefined
  const converterAcPhaseLabel =
    phaseSystem && phaseAssignmentDiffersFromInstallation(converterAcPhaseAssignment, phaseSystem)
      ? getPhaseAssignmentLabel(converterAcPhaseAssignment, phaseSystem)
      : undefined
  const isRelay = device.symbol === 'relay'
  const isProtection = device.type === 'protection' && !isRelay
  const hasInlineLabels = hasSupplyInlineLabels(device)
  const relayOverlayPath = isRelay ? RELAY_OVERLAY_PATHS[device.relayProps?.control ?? 'standard'] : undefined
  const [relayOverlayImage, setRelayOverlayImage] = useState<HTMLImageElement | null>(null)
  const isSurgeProtection = !isRelay && (device.protectionType === 'SPD' || device.symbol === 'spd')
  const switchSymbolPaths = isInlineSwitch
    ? getSwitchSymbolPaths(device.symbol, {
        poles: Math.min(4, Math.max(1, device.poles ?? 1)) as 1 | 2 | 3 | 4,
        twoPole: device.symbol === 'switch_2p_twoway',
      })
    : undefined
  const renderedSymbolPath = isRelay
    ? getSwitchSymbolPaths('relay').basePath
    : isSurgeProtection
    ? getSurgeProtectionSymbolPath(device.surgeProtectionKind)
    : isDirectionalConverter
      ? CONVERTER_ARTWORK_PATHS.base
      : (switchSymbolPaths?.basePath ?? symbol?.svgPath)
  const nameLabelText = (device.label ?? '').trim()
  const junctionIdentityText = getJunctionIdentity(device)
  const isVerticalSupplyProtection = hasInlineLabels && isVerticalSupplyDevice(device)
  const showSupplyProtectionNameLabel =
    (isHorizontal === true || isVerticalSupplyProtection) &&
    (hasInlineLabels || device.symbol === 'source_changeover') &&
    nameLabelText.length > 0 &&
    !showDeviceLabelLeft &&
    ((isProtection && isVerticalSupplyProtection && !!device.supplyDcBusId) ||
      isSymbolLabelVisible(device.symbolLabelDisplay, 'supplyProtectionNameLabel', true))
  const needsSupplyMetadataGeometry =
    isSupplyMetadataCalloutDevice(device) && (supplyDevicePositions?.length ?? 0) > 0
  const wireSegments = useEendraadWireSegments(
    isDirectionalConverter || isConversionSymbol || needsSupplyMetadataGeometry
  )
  const terminalStripOutgoingPin = useProjectStore((state) =>
    (device.symbol === 'terminal_strip' || device.type === 'terminal_strip') && state.currentProject
      ? getEffectiveTerminalStripOutgoingPin(state.currentProject, device)
      : undefined
  )
  const converterConnectionDomains = isDirectionalConverter
    ? getConverterConnectionDomains(
        wireSegments,
        device.id,
        circuitConverterAnchor ?? position,
        SYMBOL_SIZE
      )
    : {}
  const isSeparateSupplyInverter =
    device.symbol === 'inverter' &&
    device.converterAcConnection === 'separate' &&
    isHorizontal === true &&
    (device.supplyPath === 'converter-branch' || device.supplyPath === 'backup')
  const separateInverterDcSide = supplyMirrorAxisX != null ? 'left' : 'right'
  const converterArtworkLayout = isDirectionalConverter
    ? (() => {
        if (isSeparateSupplyInverter) {
          return getSeparateSupplyInverterArtworkLayout(separateInverterDcSide)
        }
        const domains = getDomainForSymbol(device.symbol)
        return getConverterArtworkLayout(
          domains.inputDomain === 'DC' ? 'DC' : 'AC',
          domains.outputDomain === 'DC' ? 'DC' : 'AC',
          converterConnectionDomains
        )
      })()
    : null
  const hasConnectedTopWire =
    isConversionSymbol &&
    wireSegments.some(
      (segment) =>
        segment.domain === 'DC' &&
        segment.type === 'vertical' &&
        !!segment.supplyConnectionId &&
        Math.abs(segment.startPoint.x - position.x) < 1 &&
        Math.min(segment.startPoint.y, segment.endPoint.y) < position.y &&
        Math.max(segment.startPoint.y, segment.endPoint.y) <= position.y + 1
    )
  const hasConnectedBottomWire = isConversionSymbol && device.converterGridInputConnected !== false
  const conversionLabelParts = getVisibleConversionLabelParts(device)
  const certificationLabelParts = getVisibleCertificationLabelParts(device)
  const notesText = (device.notes ?? '').trim()
  const showNotesLabel =
    notesText.length > 0 &&
    isSymbolLabelVisible(device.symbolLabelDisplay, 'trunkDeviceNotes', true)
  const renderSupplyNotesVertically =
    allowVerticalSupplyNotes &&
    isHorizontal === true &&
    showNotesLabel &&
    supplyTrunkNotesOrientation === 'vertical'
  const isDomoticaDevice = device.symbol === 'domotica'
  const isSupplyDcBusDomotica = isDomoticaDevice && device.supplyDcBusId != null
  const domoticaProps = device.domoticaProps
  const domoticaMainType = domoticaProps?.mainDeviceType
  const domoticaMainSwitchSymbol = domoticaProps?.mainSwitchSymbol
  const domoticaMainSocketSymbol = domoticaProps?.mainSocketSymbol
  const domoticaMainSwitchProps = domoticaProps?.mainSwitchProps
  const domoticaMainSocketProps = domoticaProps?.mainSocketProps
  const domoticaEndpointCount = isSupplyDcBusDomotica
    ? DOMOTICA_MIN_ENDPOINT_OUTPUTS
    : Math.max(
        DOMOTICA_MIN_ENDPOINT_OUTPUTS,
        Math.min(
          DOMOTICA_MAX_ENDPOINT_OUTPUTS,
          Math.trunc(domoticaProps?.endpointCount ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS)
        )
      )
  const domoticaHeight =
    DOMOTICA_BASE_HEIGHT + Math.max(0, domoticaEndpointCount - 1) * DOMOTICA_OUTPUT_SPACING
  const forceProtectionLabelStack = hasInlineLabels && isHorizontal !== true
  const placeNotesOnTop = isDomoticaDevice || isHorizontal === true || forceProtectionLabelStack

  useEffect(() => {
    if (!isDomoticaDevice) {
      setDomoticaControlImages({})
      return
    }
    const isDarkMode = theme?.mode === 'dark'
    const keys: Array<keyof typeof DOMOTICA_CONTROL_OVERLAY_PATHS> = [
      'programmed_control',
      'wireless_control',
      'detection_control',
      'button_control',
    ]
    keys.forEach((key) => {
      loadProcessedSymbol(DOMOTICA_CONTROL_OVERLAY_PATHS[key], isDarkMode)
        .then((image) => setDomoticaControlImages((previous) => ({ ...previous, [key]: image })))
        .catch(() => setDomoticaControlImages((previous) => ({ ...previous, [key]: null })))
    })
  }, [isDomoticaDevice, theme?.mode])

  useEffect(() => {
    if (!isDomoticaDevice) {
      setDomoticaMainImage(null)
      return
    }
    let path: string | null = null
    if (domoticaMainType === 'switch' && domoticaMainSwitchSymbol) {
      path = getSwitchDisplaySvgPath(domoticaMainSwitchSymbol, domoticaMainSwitchProps)
    } else if (domoticaMainType === 'socket' && domoticaMainSocketSymbol) {
      path = getSymbolById(domoticaMainSocketSymbol)?.svgPath ?? null
    }
    if (!path) {
      setDomoticaMainImage(null)
      return
    }
    loadProcessedSymbol(path, theme?.mode === 'dark')
      .then(setDomoticaMainImage)
      .catch(() => setDomoticaMainImage(null))
  }, [
    domoticaMainSocketSymbol,
    domoticaMainSwitchProps,
    domoticaMainSwitchSymbol,
    domoticaMainType,
    isDomoticaDevice,
    theme?.mode,
  ])
  const domoticaMainSocketOverlayPath =
    domoticaMainType === 'socket'
      ? domoticaMainSocketProps?.switchOverlayLock
        ? SOCKET_OVERLAY_PATHS.switchOverlayLock
        : domoticaMainSocketProps?.switchOverlay
          ? SOCKET_OVERLAY_PATHS.switchOverlay
          : null
      : null

  useEffect(() => {
    if (!isDomoticaDevice || !domoticaMainSocketOverlayPath) {
      setDomoticaMainSocketOverlayImage(null)
      return
    }
    loadProcessedSymbol(domoticaMainSocketOverlayPath, theme?.mode === 'dark')
      .then(setDomoticaMainSocketOverlayImage)
      .catch(() => setDomoticaMainSocketOverlayImage(null))
  }, [domoticaMainSocketOverlayPath, isDomoticaDevice, theme?.mode])
  const stackedRightLabelItems = useMemo(
    () => [
      ...(isConversionSymbol || device.symbol === 'solar_panel' || device.symbol === 'battery'
        ? conversionLabelParts.map((part) => ({ key: part.key, text: part.text }))
        : []),
      ...(!placeNotesOnTop
        ? certificationLabelParts.map((part) => ({ key: part.key, text: part.text }))
        : []),
      ...(!placeNotesOnTop && !showDeviceLabelLeft && showNotesLabel
        ? [{ key: 'trunkDeviceNotes', text: notesText }]
        : []),
    ],
    [
      certificationLabelParts,
      conversionLabelParts,
      device.symbol,
      isConversionSymbol,
      notesText,
      placeNotesOnTop,
      showDeviceLabelLeft,
      showNotesLabel,
    ]
  )
  const leftStackLabelItems = useMemo(
    () => [
      ...(nameLabelText.length > 0 ? [{ key: 'trunkDeviceNameLabel', text: nameLabelText }] : []),
      ...(showNotesLabel ? [{ key: 'trunkDeviceNotes', text: notesText }] : []),
    ],
    [nameLabelText, notesText, showNotesLabel]
  )
  const topStackLabelItems = useMemo(
    () => [
      ...certificationLabelParts.map((part) => ({ key: part.key, text: part.text })),
      ...(showNotesLabel && !showDeviceLabelLeft && !renderSupplyNotesVertically
        ? [{ key: 'trunkDeviceNotes' as const, text: notesText }]
        : []),
    ],
    [
      certificationLabelParts,
      notesText,
      renderSupplyNotesVertically,
      showDeviceLabelLeft,
      showNotesLabel,
    ]
  )
  const ownSupplyPosition = supplyDevicePositions?.find(({ device: peer }) => peer.id === device.id)
  const metadataTopPlacement = ownSupplyPosition?.topLabelPlacements?.find(
    (placement) => placement.kind === 'metadata'
  )
  const nameTopPlacement = ownSupplyPosition?.topLabelPlacements?.find(
    (placement) => placement.kind === 'name'
  )
  const renderedTopStackLabelItems = metadataTopPlacement
    ? [{ key: 'supplyTopMetadata', text: metadataTopPlacement.text }]
    : topStackLabelItems
  const topStackVisualLineCount = renderedTopStackLabelItems.reduce(
    (total, item) => total + countSymbolLabelVisualLines(item.text),
    0
  )
  const metadataCalloutItems = useMemo(
    () => [
      ...conversionLabelParts.map((part) => ({ key: part.key, text: part.text })),
      ...certificationLabelParts.map((part) => ({ key: part.key, text: part.text })),
      ...(showNotesLabel ? [{ key: 'trunkDeviceNotes' as const, text: notesText }] : []),
    ],
    [certificationLabelParts, conversionLabelParts, notesText, showNotesLabel]
  )
  const metadataCalloutPeerCount = (
    supplyDevicePositions?.length
      ? supplyDevicePositions
      : [{ device, x: position.x, y: position.y }]
  ).filter(
    ({ device: peer }) =>
      isSupplyMetadataCalloutDevice(peer) &&
      !(peer.supplyPath === 'converter-grid' && peer.converterGridPlacement === 'input-leg')
  ).length
  const metadataCalloutPlacementKind = getSupplyMetadataCalloutPlacementKind({
    symbol: device.symbol,
    peerCount: metadataCalloutPeerCount,
    stackVertically: metadataCalloutPeerCount > 1,
  })
  const metadataCalloutLayout = useMemo(() => {
    const renderedPeerPositions = supplyDevicePositions?.length
      ? supplyDevicePositions
      : [{ device, x: position.x, y: position.y }]
    const peerPositions = renderedPeerPositions.map((peer) => {
      const isScalableSupplyConverter =
        supportsCircuitConverterDcConnections(peer.device) &&
        (peer.device.supplyPath === 'converter-branch' || peer.device.supplyPath === 'backup')
      const visualX = isScalableSupplyConverter
        ? getSupplyConverterBodyGeometry(peer.device, { x: peer.x, y: peer.y }).center.x
        : peer.x
      return {
        ...peer,
        x: supplyMirrorAxisX == null ? visualX : supplyMirrorAxisX * 2 - visualX,
      }
    })
    const peers = peerPositions.filter(
      ({ device: peer }) =>
        isSupplyMetadataCalloutDevice(peer) &&
        !(peer.supplyPath === 'converter-grid' && peer.converterGridPlacement === 'input-leg')
    )
    const hasLongPeer = peers.some(({ device: peer }) => {
      const lines = getSupplyMetadataLinesForDevice(peer)
      return shouldUseSupplyDeviceMetadataCallout(peer, lines, getSupplyDeviceMultiplier(peer))
    })
    const clusters = getSupplyMetadataCalloutClusters(
      peers.map(({ device: peer }) => ({
        device: peer,
        lines: getSupplyMetadataLinesForDevice(peer),
      }))
    )
    if (!hasLongPeer) {
      return {
        placements: new Map<
          string,
          ReturnType<typeof getSupplyMetadataCalloutGroupPlacements> extends Map<
            string,
            infer Placement
          >
            ? Placement
            : never
        >(),
        clusters,
      }
    }

    // The layout owns the measured card bounds, including mirror and frame offsets.
    // Do not run a second packing pass with different font metrics and obstacles.
    if (renderedPeerPositions.some((peer) => peer.metadataCalloutRect)) {
      return {
        clusters,
        placements: new Map(
          renderedPeerPositions.flatMap((peer) => {
            const rect = peer.metadataCalloutRect
            if (!rect) return []
            const center =
              peer.device.id === device.id
                ? { x: position.x, y: position.y }
                : { x: peer.x, y: peer.y }
            return [
              [
                peer.device.id,
                {
                  id: peer.device.id,
                  symbolPosition: center,
                  x: rect.left - center.x,
                  y: rect.top - center.y,
                  width: rect.right - rect.left,
                  height: rect.bottom - rect.top,
                  rect,
                },
              ],
            ]
          })
        ),
      }
    }

    const mainBusLabelRects = supplyPanelLabel
      ? wireSegments
          .filter((segment) => supplyPanelId == null || segment.panelId === supplyPanelId)
          .filter((segment) => segment.type === 'mainBus')
          .map((segment) => {
            const renderedRect = getCircuitLabelVisualRect({
              x: (segment.startPoint.x + segment.endPoint.x) / 2,
              y: segment.startPoint.y - 10,
              label: supplyPanelLabel,
            })
            return supplyMirrorAxisX == null
              ? renderedRect
              : {
                  left: supplyMirrorAxisX * 2 - renderedRect.right,
                  top: renderedRect.top,
                  right: supplyMirrorAxisX * 2 - renderedRect.left,
                  bottom: renderedRect.bottom,
                }
          })
      : []
    const symbolRects = peerPositions.map(({ device: peer, x, y }) => {
      const width = supportsCircuitConverterDcConnections(peer)
        ? SYMBOL_SIZE * getCircuitConverterDcConnectionCount(peer)
        : peer.type === 'dc_bus'
          ? SYMBOL_SIZE + 18
          : SYMBOL_SIZE
      return {
        left: x - width / 2 - 4,
        top: y - SYMBOL_SIZE / 2 - 4,
        right: x + width / 2 + 4,
        bottom: y + SYMBOL_SIZE / 2 + 4,
      }
    })
    const items = peers.flatMap(({ device: peer, x, y }) => {
      const cluster = clusters.get(peer.id)
      const lines = getSupplyMetadataLinesForDevice(peer, cluster?.totalMultiplier)
      if (lines.length === 0) return []
      if (cluster && cluster.representativeId !== peer.id) return []
      const clusterPeers = cluster
        ? peers.filter(({ device: candidate }) => cluster.targetIds.includes(candidate.id))
        : [{ device: peer, x, y }]
      const clusterX =
        clusterPeers.reduce((total, candidate) => total + candidate.x, 0) / clusterPeers.length
      const clusterY = Math.min(...clusterPeers.map((candidate) => candidate.y))
      const { width, height } = getSupplyMetadataCardSize(lines, fontFamily)
      return [
        {
          id: peer.id,
          symbolPosition: { x: clusterX, y: clusterY },
          width,
          height,
          placement: getSupplyMetadataCalloutPlacementKind({
            symbol: peer.symbol,
            peerCount: peers.length,
            stackVertically: peers.length > 1,
          }),
        },
      ]
    })
    const canonicalPlacements = getSupplyMetadataCalloutGroupPlacements({
      items,
      segments: wireSegments
        .filter((segment) => supplyPanelId == null || segment.panelId === supplyPanelId)
        .map((segment) =>
          supplyMirrorAxisX == null
            ? segment
            : {
                ...segment,
                startPoint: {
                  ...segment.startPoint,
                  x: supplyMirrorAxisX * 2 - segment.startPoint.x,
                },
                endPoint: {
                  ...segment.endPoint,
                  x: supplyMirrorAxisX * 2 - segment.endPoint.x,
                },
              }
        ),
      symbolRects: [...symbolRects, ...mainBusLabelRects],
      // Supply assemblies are mirrored for rendering. A canonical right-side
      // nudge becomes the visually preferable left-side placement.
      packRows: supplyMirrorAxisX == null,
      preferRightNudges: supplyMirrorAxisX != null,
      stackVertically: peers.length > 1,
      stackBelowY:
        supplyPanelMainBusY ??
        wireSegments.find(
          (segment) =>
            (supplyPanelId == null || segment.panelId === supplyPanelId) &&
            segment.type === 'mainBus'
        )?.startPoint.y,
    })
    const representativePositionById = new Map(
      peers.map((peer) => [peer.device.id, { x: peer.x, y: peer.y }])
    )
    if (supplyMirrorAxisX == null) {
      return {
        placements: new Map(
          [...canonicalPlacements].map(([id, placement]) => {
            const representative = representativePositionById.get(id) ?? placement.symbolPosition
            return [
              id,
              {
                ...placement,
                symbolPosition: representative,
                x: placement.rect.left - representative.x,
                y: placement.rect.top - representative.y,
              },
            ]
          })
        ),
        clusters,
      }
    }

    return {
      placements: new Map(
        [...canonicalPlacements].map(([id, placement]) => {
          const representative = representativePositionById.get(id) ?? placement.symbolPosition
          const renderedSymbolX = supplyMirrorAxisX * 2 - representative.x
          const renderedCardLeft = supplyMirrorAxisX * 2 - placement.rect.right
          return [
            id,
            {
              ...placement,
              symbolPosition: { x: renderedSymbolX, y: representative.y },
              x: renderedCardLeft - renderedSymbolX,
              y: placement.rect.top - representative.y,
              rect: {
                left: renderedCardLeft,
                top: placement.rect.top,
                right: supplyMirrorAxisX * 2 - placement.rect.left,
                bottom: placement.rect.bottom,
              },
            },
          ]
        })
      ),
      clusters,
    }
  }, [
    device,
    fontFamily,
    position.x,
    position.y,
    supplyDevicePositions,
    supplyMirrorAxisX,
    supplyPanelMainBusY,
    supplyPanelId,
    supplyPanelLabel,
    wireSegments,
  ])
  const metadataCalloutGroup = metadataCalloutLayout.placements
  const metadataCalloutCluster = metadataCalloutLayout.clusters.get(device.id)
  const isSharedMetadataRepresentative =
    metadataCalloutCluster?.representativeId === device.id &&
    metadataCalloutCluster.targetIds.length > 1
  const isSharedMetadataMember =
    metadataCalloutCluster != null && metadataCalloutCluster.targetIds.length > 1
  const renderedMetadataCalloutItems = useMemo(
    () =>
      applyMetadataCalloutMultiplier(
        metadataCalloutItems,
        metadataCalloutCluster?.totalMultiplier ?? supplyDeviceMultiplier
      ),
    [metadataCalloutCluster?.totalMultiplier, metadataCalloutItems, supplyDeviceMultiplier]
  )
  const renderedMetadataCalloutLines = useMemo(
    () => renderedMetadataCalloutItems.map((item) => item.text),
    [renderedMetadataCalloutItems]
  )
  const useMetadataCallout =
    metadataCallout != null ||
    (canRenderSupplyMetadataCallout(device, isHorizontal) &&
      metadataCalloutGroup.has(device.id) &&
      (!isSharedMetadataMember || isSharedMetadataRepresentative))
  const metadataCalloutVisualLineCount = useMemo(
    () =>
      renderedMetadataCalloutLines.reduce(
        (total, line) => total + countSymbolLabelVisualLines(line),
        0
      ),
    [renderedMetadataCalloutLines]
  )
  const metadataCalloutWidth = useMemo(
    () =>
      metadataCallout?.width ??
      metadataCalloutGroup.get(device.id)?.width ??
      getMetadataCalloutWidth(
        renderedMetadataCalloutLines.map((line) => measureSymbolLabelTextWidth(line, fontFamily, 8))
      ),
    [
      device.id,
      fontFamily,
      metadataCalloutGroup,
      metadataCallout?.width,
      renderedMetadataCalloutLines,
    ]
  )
  const metadataCalloutHeight =
    metadataCallout?.height ??
    metadataCalloutGroup.get(device.id)?.height ??
    metadataCalloutVisualLineCount * 10 + 10
  const metadataCalloutPlacement = useMemo(() => {
    if (metadataCallout) return { x: metadataCallout.x, y: metadataCallout.y }
    const groupPlacement = metadataCalloutGroup.get(device.id)
    if (groupPlacement) return { x: groupPlacement.x, y: groupPlacement.y }
    return getSupplyMetadataCalloutPlacement({
      symbolPosition: position,
      width: metadataCalloutWidth,
      height: metadataCalloutHeight,
      segments: wireSegments,
      placement: metadataCalloutPlacementKind,
    })
  }, [
    device.id,
    metadataCalloutHeight,
    metadataCallout,
    metadataCalloutGroup,
    metadataCalloutPlacementKind,
    metadataCalloutWidth,
    position,
    wireSegments,
  ])
  const circuitConverterConnectionCount =
    circuitConverterAnchor && supportsCircuitConverterDcConnections(device)
      ? getCircuitConverterDcConnectionCount(device)
      : 1
  const isSupplyConverterResize =
    supportsCircuitConverterDcConnections(device) &&
    isHorizontal === true &&
    (device.supplyPath === 'converter-branch' || device.supplyPath === 'backup')
  const isOrdinaryConverterResize =
    supportsCircuitConverterDcConnections(device) &&
    circuitConverterAnchor != null &&
    !isSupplyConverterResize
  const converterResizeDirection =
    converterGrowthDirection ??
    (isSupplyConverterResize ? 'left' : isOrdinaryConverterResize ? 'right' : undefined)
  const renderedSymbolSize = useMemo(() => {
    if (circuitConverterConnectionCount > 1) {
      return { width: SYMBOL_SIZE * circuitConverterConnectionCount, height: SYMBOL_SIZE }
    }
    if (!processedImage || !isDomoticaDevice) {
      return { width: SYMBOL_SIZE, height: SYMBOL_SIZE }
    }
    const imgWidth = processedImage.width || processedImage.naturalWidth || SYMBOL_SIZE
    const imgHeight = processedImage.height || processedImage.naturalHeight || SYMBOL_SIZE
    if (imgWidth <= 0 || imgHeight <= 0) {
      return { width: SYMBOL_SIZE, height: SYMBOL_SIZE }
    }
    if (imgWidth >= imgHeight) {
      return {
        width: SYMBOL_SIZE,
        height: SYMBOL_SIZE * (imgHeight / imgWidth),
      }
    }
    return {
      width: SYMBOL_SIZE * (imgWidth / imgHeight),
      height: SYMBOL_SIZE,
    }
  }, [circuitConverterConnectionCount, isDomoticaDevice, processedImage])
  const metadataCalloutLeaderPoints =
    metadataCallout?.leaderPoints ??
    getSupplyMetadataCalloutLeaderPoints({
      placement: metadataCalloutPlacement,
      width: metadataCalloutWidth,
      height: metadataCalloutHeight,
      symbolWidth: renderedSymbolSize.width,
      symbolHeight: renderedSymbolSize.height,
      placementKind: metadataCalloutPlacementKind,
      mirrorHorizontally: supplyMirrorAxisX != null,
      adaptiveAnchors: ownSupplyPosition?.metadataCalloutRect != null,
    })
  const metadataCalloutTargetIds =
    metadataCallout?.targetIds ??
    (isSharedMetadataRepresentative ? metadataCalloutCluster?.targetIds : undefined)
  const metadataCalloutLeaderPointSets = useMemo(() => {
    if (!isSharedMetadataRepresentative || !metadataCalloutTargetIds?.length) {
      return [metadataCalloutLeaderPoints]
    }
    const renderedPeers = supplyDevicePositions?.length
      ? supplyDevicePositions
      : [{ device, x: position.x, y: position.y }]
    const targets = metadataCalloutTargetIds.flatMap((targetId) => {
      const target = renderedPeers.find(({ device: peer }) => peer.id === targetId)
      if (!target) return []
      return [
        {
          position: { x: target.x - position.x, y: target.y - position.y },
          width: supportsCircuitConverterDcConnections(target.device)
            ? SYMBOL_SIZE * getCircuitConverterDcConnectionCount(target.device)
            : SYMBOL_SIZE,
          height: SYMBOL_SIZE,
        },
      ]
    })
    return getSupplyMetadataSharedLeaderPointSets({
      placement: metadataCalloutPlacement,
      width: metadataCalloutWidth,
      height: metadataCalloutHeight,
      targets,
    })
  }, [
    device,
    isSharedMetadataRepresentative,
    metadataCalloutHeight,
    metadataCalloutLeaderPoints,
    metadataCalloutPlacement,
    metadataCalloutTargetIds,
    metadataCalloutWidth,
    position.x,
    position.y,
    supplyDevicePositions,
  ])

  const certificationSideLabelExtraOffset = useMemo(
    () =>
      !isHorizontal
        ? getCertificationSideLabelExtraOffsetPx(device, wireSegments, fontFamily, {
            symbolHalfWidth: renderedSymbolSize.width / 2,
          })
        : 0,
    [device, fontFamily, isHorizontal, renderedSymbolSize.width, wireSegments]
  )

  useEffect(() => {
    if (!renderedSymbolPath) return
    loadProcessedSymbol(renderedSymbolPath, isDark)
      .then(setProcessedImage)
      .catch(() => setProcessedImage(null))
  }, [renderedSymbolPath, isDark])

  useEffect(() => {
    if (!isDirectionalConverter) {
      setConverterDiagonalImage(null)
      setConverterAcImage(null)
      setConverterDcImage(null)
      return
    }
    const paths = [
      [CONVERTER_ARTWORK_PATHS.diagonal, setConverterDiagonalImage],
      [CONVERTER_ARTWORK_PATHS.AC, setConverterAcImage],
      [CONVERTER_ARTWORK_PATHS.DC, setConverterDcImage],
    ] as const
    for (const [path, setter] of paths) {
      loadProcessedSymbol(path, isDark)
        .then(setter)
        .catch(() => setter(null))
    }
  }, [isDirectionalConverter, isDark])

  useEffect(() => {
    let active = true
    setRelayOverlayImage(null)
    if (relayOverlayPath) {
      loadProcessedSymbol(relayOverlayPath, isDark)
        .then((image) => { if (active) setRelayOverlayImage(image) })
        .catch(() => { if (active) setRelayOverlayImage(null) })
    }
    return () => { active = false }
  }, [relayOverlayPath, isDark])

  // Load transformer overlays for trunk devices
  useEffect(() => {
    if (!isTransformer) {
      setTransformerSafetyImage(null)
      setTransformerShortcircuitImage(null)
      setTransformerProtectionImage(null)
      return
    }
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
    isDark,
  ])

  const handleClick = useCallback(
    (event: unknown) => {
      const e = event as EendraadPointerEvent
      const eendraWindow = window as WindowWithEendraTapSuppression
      if (eendraWindow.__eendraSuppressNextElementTap) {
        eendraWindow.__eendraSuppressNextElementTap = false
        return
      }
      e.cancelBubble = true

      if (e.evt.button != null && e.evt.button !== 0) {
        return
      }

      const currentProject = useProjectStore.getState().currentProject
      const pairedIds = resolveEarthingSeparatorPairIds(currentProject, device.id)
      if (e.evt.shiftKey) {
        const { selection } = useUIStore.getState()
        if (
          selection.type === 'trunkDevice' &&
          !pairedIds.every((id) => selection.ids.includes(id))
        ) {
          setSelection({ type: 'trunkDevice', ids: [...new Set([...selection.ids, ...pairedIds])] })
        } else if (selection.type !== 'trunkDevice') {
          setSelection({ type: 'trunkDevice', ids: pairedIds })
        }
      } else if (e.evt.altKey || e.evt.ctrlKey || e.evt.metaKey) {
        const { selection } = useUIStore.getState()
        if (
          selection.type === 'trunkDevice' &&
          pairedIds.some((id) => selection.ids.includes(id))
        ) {
          const newIds = selection.ids.filter((id) => !pairedIds.includes(id))
          if (newIds.length === 0) {
            useUIStore.getState().clearSelection()
          } else {
            setSelection({ type: 'trunkDevice', ids: newIds })
          }
        }
      } else {
        setSelection({ type: 'trunkDevice', ids: pairedIds })
      }
    },
    [device.id, setSelection]
  )
  const handleMetadataCalloutClick = useCallback(
    (event: unknown) => {
      if (!metadataCalloutTargetIds?.length) {
        handleClick(event)
        return
      }
      const e = event as EendraadPointerEvent
      e.cancelBubble = true
      if (e.evt.button != null && e.evt.button !== 0) return
      const { selection } = useUIStore.getState()
      setSelection(
        resolveTrunkDeviceMetadataCalloutSelection(selection, metadataCalloutTargetIds, {
          extend: !!e.evt.shiftKey,
          toggle: !!(e.evt.altKey || e.evt.ctrlKey || e.evt.metaKey),
        })
      )
    },
    [handleClick, metadataCalloutTargetIds, setSelection]
  )
  const metadataCalloutGestureHandlers = useCanvasPanOrClickGesture(handleMetadataCalloutClick)
  const handleMetadataCalloutMouseEnter = useCallback(
    (event: unknown) => {
      const e = event as EendraadPointerEvent
      e.cancelBubble = true
      if (metadataCalloutTargetIds?.length) {
        setHover({ type: 'trunkDevice', ids: metadataCalloutTargetIds })
      }
    },
    [metadataCalloutTargetIds, setHover]
  )
  const handleMetadataCalloutMouseLeave = useCallback(
    (event: unknown) => {
      const e = event as EendraadPointerEvent
      e.cancelBubble = true
      const { hover } = useUIStore.getState()
      if (
        metadataCalloutTargetIds?.length &&
        hover.type === 'trunkDevice' &&
        metadataCalloutTargetIds.every((id) => hover.ids.includes(id))
      ) {
        clearHover()
      }
    },
    [clearHover, metadataCalloutTargetIds]
  )
  const stopMetadataCalloutClickBubble = useCallback((event: unknown) => {
    const pointerEvent = event as EendraadPointerEvent
    pointerEvent.cancelBubble = true
  }, [])

  const rotateForHorizontal = isHorizontal && isProtection && !isInlineSwitch
  const rotateMirroredChangeover =
    isHorizontal === true && device.symbol === 'source_changeover' && supplyMirrorAxisX != null
  const renderedSymbolRotationDeg =
    symbolRotationDeg ??
    (isRelay
      ? isHorizontal
        ? 0
        : 90
      : rotateMirroredChangeover
        ? 180
        : rotateForHorizontal
          ? 90
          : 0)
  const protectionLabelSource = isInlineSwitch
    ? {
        ...device,
        protectionType: undefined,
        ratingA: undefined,
        curve: undefined,
        sensitivityMa: undefined,
        breakingCapacityKa: undefined,
        breakingCapacityOption: undefined,
      }
    : device
  const surgeBodyBounds = getSurgeProtectionBodyBounds(
    renderedSymbolSize.width,
    renderedSymbolSize.height,
    isHorizontal === true
  )
  const surgeSelectionBounds = getSurgeProtectionSelectionBounds(
    renderedSymbolSize.width,
    renderedSymbolSize.height,
    isHorizontal === true
  )
  const surgeSymbolAnchor = getSurgeProtectionSymbolAnchor(
    renderedSymbolSize.width,
    renderedSymbolSize.height
  )

  const converterIconSize = SYMBOL_SIZE * CONVERTER_DOMAIN_ICON_SIZE_RATIO
  const converterIconMargin = 2
  const converterArtworkImagePosition = (domain: 'AC' | 'DC') => {
    const corner = converterArtworkLayout
      ? getConverterDomainCorner(converterArtworkLayout, domain)
      : undefined
    if (!corner) return undefined
    return getConverterCornerPosition(
      corner,
      renderedSymbolSize.width,
      renderedSymbolSize.height,
      converterIconMargin,
      converterIconSize,
      converterIconSize,
      !isSeparateSupplyInverter
    )
  }
  const converterAcPosition = converterArtworkImagePosition('AC')
  const converterDcPosition = converterArtworkImagePosition('DC')
  const separateInverterDomainMarkers = getSeparateSupplyInverterDomainMarkers(
    renderedSymbolSize.width,
    renderedSymbolSize.height,
    separateInverterDcSide
  )
  const dcDcConverterPositions =
    isDirectionalConverter && device.symbol === 'dc_dc_converter'
      ? (['bottom-left', 'top-right'] as const).map((corner) =>
          getConverterCornerPosition(
            corner,
            renderedSymbolSize.width,
            renderedSymbolSize.height,
            converterIconMargin,
            converterIconSize
          )
        )
      : []
  const isWideCircuitConverter = circuitConverterConnectionCount > 1
  const currentConverterWidth = circuitConverterConnectionCount * SYMBOL_SIZE
  const previewConverterWidth =
    (converterResizePreviewCount ?? circuitConverterConnectionCount) * SYMBOL_SIZE
  const converterFixedEdge =
    converterResizeDirection === 'left' ? currentConverterWidth / 2 : -currentConverterWidth / 2
  const converterResizeEdge =
    converterResizeDirection === 'left'
      ? converterFixedEdge - previewConverterWidth
      : converterFixedEdge + previewConverterWidth
  const converterResizeDirectionSign = converterResizeDirection === 'left' ? -1 : 1
  const converterResizeHandleEdge =
    converterResizeEdge + converterResizeDirectionSign * CONVERTER_RESIZE_OUTLINE_PADDING
  const wideConverterArtworkInset =
    (CONVERTER_ARTWORK_EDGE / CONVERTER_ARTWORK_VIEWBOX_SIZE) * SYMBOL_SIZE
  const wideConverterArtworkStroke =
    (CONVERTER_ARTWORK_STROKE / CONVERTER_ARTWORK_VIEWBOX_SIZE) * SYMBOL_SIZE
  const wideConverterArtworkColor = getSymbolColor(theme?.mode === 'dark')
  const wideConverterArtworkLeft = -renderedSymbolSize.width / 2 + wideConverterArtworkInset
  const wideConverterArtworkRight = renderedSymbolSize.width / 2 - wideConverterArtworkInset
  const wideConverterArtworkTop = -renderedSymbolSize.height / 2 + wideConverterArtworkInset
  const wideConverterArtworkBottom = renderedSymbolSize.height / 2 - wideConverterArtworkInset

  const isHoveredAny = isHovered || isHoveredFromBreadcrumb
  const handleSymbolMouseEnter = () => {
    setIsHovered(true)
    setHover({ type: 'trunkDevice', ids: [device.id] })
  }
  const handleSymbolMouseLeave = () => {
    setIsHovered(false)
    const { hover } = useUIStore.getState()
    if (hover.type === 'trunkDevice' && hover.ids.length === 1 && hover.ids[0] === device.id) {
      clearHover()
    }
  }

  if (device.type === 'dc_bus' || device.symbol === 'dc_bus') {
    const busWidth = Math.max(48, dcBusWidth ?? 48)
    const busStartX = -busWidth / 2
    const busEndX = busStartX + busWidth
    const busLineWidth = 5
    const busSelectionStroke =
      busLineWidth +
      screenPxToCanvasUnits(
        canvasZoom,
        WIRE_SELECTION_EXTRA_PX,
        WIRE_SELECTION_EXTRA_PX_MIN,
        WIRE_SELECTION_EXTRA_PX_MAX
      )
    const busHoverStroke = screenPxToCanvasUnits(
      canvasZoom,
      HOVER_OUTLINE_STROKE_PX,
      HOVER_OUTLINE_STROKE_PX_MIN,
      HOVER_OUTLINE_STROKE_PX_MAX
    )
    const busHoverDash = screenPxToCanvasUnits(
      canvasZoom,
      HOVER_OUTLINE_DASH_PX,
      HOVER_OUTLINE_DASH_PX_MIN,
      HOVER_OUTLINE_DASH_PX_MAX
    )
    const busColor =
      isSelected || isPreviewSelected ? SELECTION_COLOR : getSymbolColor(theme?.mode === 'dark')
    return (
      <Group
        name={`trunkDevice-${device.id}`}
        x={position.x}
        y={position.y}
        draggable={canDragTrunk}
        onClick={handleClick}
        onTap={handleClick}
        onMouseEnter={handleSymbolMouseEnter}
        onMouseLeave={handleSymbolMouseLeave}
        onDragStart={
          canDragTrunk && onDragStart
            ? (event) => {
                const nativeEvent = event.evt as MouseEvent
                if (onDragStart(!!nativeEvent.altKey, nativeEvent)) event.target.stopDrag()
              }
            : undefined
        }
        onDragMove={
          canDragTrunk && onDragMove
            ? (event) =>
                onDragMove(
                  getCanvasPositionFromEvent?.(event) ?? {
                    x: event.target.x(),
                    y: event.target.y(),
                  }
                )
            : undefined
        }
        onDragEnd={
          canDragTrunk && onDragEnd
            ? (event) => {
                if (shouldSuppressKonvaDragEnd?.()) return
                onDragEnd(
                  getCanvasPositionFromEvent?.(event) ?? {
                    x: event.target.x(),
                    y: event.target.y(),
                  }
                )
                event.target.position({ x: position.x, y: position.y })
              }
            : undefined
        }
      >
        {/* Match ordinary busbars: a narrow line-shaped target, not the entire surrounding box. */}
        <Line
          points={[busStartX, 0, busEndX, 0]}
          stroke="transparent"
          strokeWidth={Math.max(busLineWidth + 10, 10)}
          lineCap="round"
        />
        <Line
          name="eendraad-schematic-conductor"
          points={[busStartX, 0, busEndX, 0]}
          stroke={busColor}
          strokeWidth={isSelected || isPreviewSelected ? busSelectionStroke : busLineWidth}
          lineCap="round"
          listening={false}
        />
        {isHoveredAny && !isSelected && !isPreviewSelected && (
          <Line
            name={INTERACTIVE_OVERLAY_EXPORT_NAME}
            points={[busStartX, 0, busEndX, 0]}
            stroke={SELECTION_COLOR}
            strokeWidth={busHoverStroke}
            dash={[busHoverDash, busHoverDash]}
            lineCap="round"
            listening={false}
          />
        )}
        <DomainMarker
          domain="DC"
          x={busStartX - 10}
          y={0}
          color={getSecondaryTextColor(theme?.mode === 'dark')}
        />
        {!!device.label?.trim() && (
          <Text
            x={busStartX + 7}
            y={4}
            text={device.label}
            fontFamily={fontFamily}
            fontSize={10}
            fill={getTextColor(theme?.mode === 'dark')}
          />
        )}
      </Group>
    )
  }

  if (isDomoticaDevice) {
    const strokeColor = getSymbolColor(theme?.mode === 'dark')
    const outlineY = -domoticaHeight / 2
    const controlBandHeight = Math.min(DOMOTICA_CONTROL_BAR_HEIGHT, domoticaHeight / 2)
    const dividerY = outlineY + controlBandHeight
    const controlKeys = (domoticaProps?.control ?? []).filter((key) =>
      ['programmed_control', 'wireless_control', 'detection_control', 'button_control'].includes(
        key
      )
    ) as Array<keyof typeof DOMOTICA_CONTROL_OVERLAY_PATHS>
    const mainDeviceSize = SYMBOL_SIZE * 0.75

    return (
      <Group
        name={`trunkDevice-${device.id}`}
        x={position.x - DOMOTICA_BOX_WIDTH / 2}
        y={position.y}
        draggable={canDragTrunk}
        onClick={handleClick}
        onTap={handleClick}
        onMouseEnter={handleSymbolMouseEnter}
        onMouseLeave={handleSymbolMouseLeave}
        onDragStart={
          canDragTrunk && onDragStart
            ? (event) => {
                const nativeEvent = event.evt as MouseEvent
                if (onDragStart(!!nativeEvent.altKey, nativeEvent)) event.target.stopDrag()
              }
            : undefined
        }
        onDragEnd={
          canDragTrunk && onDragEnd
            ? (event) => {
                if (shouldSuppressKonvaDragEnd?.()) return
                onDragEnd(
                  getCanvasPositionFromEvent?.(event) ?? {
                    x: event.target.x(),
                    y: event.target.y(),
                  }
                )
                event.target.position({ x: position.x - DOMOTICA_BOX_WIDTH / 2, y: position.y })
              }
            : undefined
        }
      >
        <Rect
          x={0}
          y={outlineY - 2}
          width={DOMOTICA_BOX_WIDTH}
          height={domoticaHeight + 4}
          fill="rgba(0, 0, 0, 0.01)"
        />
        <Rect
          x={0}
          y={outlineY}
          width={DOMOTICA_BOX_WIDTH}
          height={domoticaHeight}
          fill="transparent"
          stroke={strokeColor}
          strokeWidth={1}
          listening={false}
        />
        {isPreviewSelected && !isSelected && (
          <Rect
            {...getPaddedRectPreviewOutlineProps(
              canvasZoom,
              0,
              outlineY,
              DOMOTICA_BOX_WIDTH,
              domoticaHeight,
              2
            )}
          />
        )}
        {isHoveredAny && !isSelected && !isPreviewSelected && (
          <Rect
            {...getPaddedRectHoverOutlineProps(
              canvasZoom,
              0,
              outlineY,
              DOMOTICA_BOX_WIDTH,
              domoticaHeight,
              2
            )}
          />
        )}
        {isSelected && (
          <Rect
            {...getPaddedRectSelectionOutlineProps(
              canvasZoom,
              0,
              outlineY,
              DOMOTICA_BOX_WIDTH,
              domoticaHeight,
              2
            )}
          />
        )}
        <Line
          points={[0, dividerY, DOMOTICA_BOX_WIDTH, dividerY]}
          stroke={strokeColor}
          strokeWidth={0.6}
          listening={false}
        />
        {controlKeys.map((key, index) => {
          const image = domoticaControlImages[key]
          if (!image) return null
          const size = SYMBOL_SIZE * 0.3
          const count = controlKeys.length
          return (
            <Image
              key={key}
              image={image}
              width={size}
              height={size}
              offsetX={size / 2}
              offsetY={size / 2}
              x={(DOMOTICA_BOX_WIDTH * (index + 1)) / (count + 1)}
              y={outlineY + controlBandHeight / 2}
              listening={false}
            />
          )
        })}
        {domoticaMainImage && domoticaMainType && (
          <Image
            image={domoticaMainImage}
            width={mainDeviceSize}
            height={mainDeviceSize}
            offsetX={mainDeviceSize / 2}
            offsetY={mainDeviceSize / 2}
            x={DOMOTICA_BOX_WIDTH / 2}
            y={dividerY + (domoticaHeight - controlBandHeight) / 2}
            listening={false}
          />
        )}
        {domoticaMainSocketOverlayImage && domoticaMainType === 'socket' && (
          <Image
            image={domoticaMainSocketOverlayImage}
            width={mainDeviceSize}
            height={mainDeviceSize}
            offsetX={mainDeviceSize / 2}
            offsetY={mainDeviceSize / 2}
            x={DOMOTICA_BOX_WIDTH / 2}
            y={dividerY + (domoticaHeight - controlBandHeight) / 2}
            listening={false}
          />
        )}
        {showDeviceLabelLeft && leftStackLabelItems.length > 0 && (
          <SymbolTextLabels
            items={leftStackLabelItems}
            config={{ position: 'left', layout: 'stack' }}
            sideLabelBlockAlign="center"
            textColor={getSecondaryTextColor(isDark ?? false)}
            fontFamily={fontFamily}
            fontSize={8}
            symbolWidth={DOMOTICA_BOX_WIDTH}
            symbolHeight={domoticaHeight}
          />
        )}
        {showNotesLabel && !showDeviceLabelLeft && (
          <SymbolTextLabels
            items={[{ key: 'trunkDeviceNotes', text: notesText }]}
            config={{ position: 'right', layout: 'stack' }}
            sideLabelBlockAlign="center"
            offsetFromSymbol={5}
            textColor={getSecondaryTextColor(isDark ?? false)}
            fontFamily={fontFamily}
            fontSize={8}
            symbolWidth={DOMOTICA_BOX_WIDTH}
            symbolHeight={domoticaHeight}
          />
        )}
      </Group>
    )
  }

  if (!symbol || !processedImage) return null

  return (
    <Group
      name={`trunkDevice-${device.id}`}
      x={position.x}
      y={position.y}
      draggable={canDragTrunk}
      onClick={handleClick}
      onTap={handleClick}
      onMouseEnter={handleSymbolMouseEnter}
      onMouseLeave={handleSymbolMouseLeave}
      onDragStart={
        canDragTrunk && onDragStart
          ? (e) => {
              const evt = e.evt as MouseEvent
              if (onDragStart(!!evt.altKey, evt)) {
                e.target.stopDrag()
                e.target.position({ x: position.x, y: position.y })
              }
            }
          : undefined
      }
      onDragMove={
        canDragTrunk && onDragMove
          ? (e) => {
              onDragMove(getCanvasPositionFromEvent?.(e) ?? { x: e.target.x(), y: e.target.y() })
            }
          : undefined
      }
      onDragEnd={
        canDragTrunk && onDragEnd
          ? (e) => {
              if (shouldSuppressKonvaDragEnd?.()) {
                e.target.position({ x: position.x, y: position.y })
                return
              }
              const pos = getCanvasPositionFromEvent?.(e) ?? { x: e.target.x(), y: e.target.y() }
              onDragEnd(pos)
              e.target.position({ x: position.x, y: position.y })
            }
          : undefined
      }
    >
      {/* Invisible hit area — slightly larger than symbol for easy hover/click selection */}
      {isSurgeProtection ? (
        <Rect
          x={surgeBodyBounds.x - (touchPrimary ? 7 : 4)}
          y={surgeBodyBounds.y - (touchPrimary ? 7 : 4)}
          width={surgeBodyBounds.width + (touchPrimary ? 14 : 8)}
          height={surgeBodyBounds.height + (touchPrimary ? 14 : 8)}
          fill="transparent"
        />
      ) : (
        <Rect
          {...(isWideCircuitConverter
            ? {
                x: -renderedSymbolSize.width / 2 - (touchPrimary ? 7 : 4),
                y: -renderedSymbolSize.height / 2 - (touchPrimary ? 7 : 4),
                width: renderedSymbolSize.width + (touchPrimary ? 14 : 8),
                height: renderedSymbolSize.height + (touchPrimary ? 14 : 8),
                fill: 'transparent',
              }
            : getTouchAwareHitAreaProps(
                ENDPOINT_OUTLINE_SIZE,
                canvasZoom,
                isSelected,
                touchPrimary
              ))}
        />
      )}

      {/* Symbol image — offsetY by orientation; protection on horizontal trunk rotated 90° left */}
      {isWideCircuitConverter ? (
        <Rect
          x={wideConverterArtworkLeft}
          y={wideConverterArtworkTop}
          width={wideConverterArtworkRight - wideConverterArtworkLeft}
          height={wideConverterArtworkBottom - wideConverterArtworkTop}
          cornerRadius={(1.3 / CONVERTER_ARTWORK_VIEWBOX_SIZE) * SYMBOL_SIZE}
          fill="transparent"
          stroke={wideConverterArtworkColor}
          strokeWidth={wideConverterArtworkStroke}
          lineJoin="round"
          listening={false}
        />
      ) : (
        <Image
          image={processedImage}
          {...{ [SYMBOL_EXPORT_ATTR_SVG_PATH]: renderedSymbolPath }}
          width={renderedSymbolSize.width}
          height={renderedSymbolSize.height}
          offsetX={isSurgeProtection ? surgeSymbolAnchor.x : renderedSymbolSize.width / 2}
          offsetY={isSurgeProtection ? surgeSymbolAnchor.y : renderedSymbolSize.height / 2}
          rotation={renderedSymbolRotationDeg}
          listening={false}
        />
      )}
      {isRelay && relayOverlayImage && (
        <Image
          image={relayOverlayImage}
          {...{ [SYMBOL_EXPORT_ATTR_SVG_PATH]: relayOverlayPath }}
          width={renderedSymbolSize.width}
          height={renderedSymbolSize.height}
          offsetX={renderedSymbolSize.width / 2}
          offsetY={renderedSymbolSize.height / 2}
          rotation={renderedSymbolRotationDeg}
          listening={false}
        />
      )}
      {isWideCircuitConverter && converterArtworkLayout ? (
        <Line
          points={
            converterArtworkLayout.diagonal === 'top-left-to-bottom-right'
              ? [
                  wideConverterArtworkLeft,
                  wideConverterArtworkTop,
                  wideConverterArtworkRight,
                  wideConverterArtworkBottom,
                ]
              : [
                  wideConverterArtworkLeft,
                  wideConverterArtworkBottom,
                  wideConverterArtworkRight,
                  wideConverterArtworkTop,
                ]
          }
          stroke={wideConverterArtworkColor}
          strokeWidth={wideConverterArtworkStroke}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      ) : isDirectionalConverter && converterDiagonalImage && converterArtworkLayout ? (
        <Image
          image={converterDiagonalImage}
          {...{ [SYMBOL_EXPORT_ATTR_SVG_PATH]: CONVERTER_ARTWORK_PATHS.diagonal }}
          width={renderedSymbolSize.width}
          height={renderedSymbolSize.height}
          offsetX={renderedSymbolSize.width / 2}
          offsetY={renderedSymbolSize.height / 2}
          scaleX={converterArtworkLayout.diagonal === 'top-left-to-bottom-right' ? -1 : 1}
          listening={false}
        />
      ) : null}
      {isDirectionalConverter && converterAcImage && converterAcPosition && (
        <Image
          image={converterAcImage}
          {...{ [SYMBOL_EXPORT_ATTR_SVG_PATH]: CONVERTER_ARTWORK_PATHS.AC }}
          width={converterIconSize}
          height={converterIconSize}
          offsetX={converterIconSize / 2}
          offsetY={converterIconSize / 2}
          x={converterAcPosition.x}
          y={converterAcPosition.y}
          listening={false}
        />
      )}
      {isDirectionalConverter &&
        converterDcImage &&
        converterDcPosition &&
        device.symbol !== 'dc_dc_converter' && (
          <Image
            image={converterDcImage}
            {...{ [SYMBOL_EXPORT_ATTR_SVG_PATH]: CONVERTER_ARTWORK_PATHS.DC }}
            width={converterIconSize}
            height={converterIconSize}
            offsetX={converterIconSize / 2}
            offsetY={converterIconSize / 2}
            x={converterDcPosition.x}
            y={converterDcPosition.y}
            listening={false}
          />
        )}
      {converterDcImage &&
        dcDcConverterPositions.map((iconPosition, index) => (
          <Image
            key={`dc-dc-domain-${index}`}
            image={converterDcImage}
            {...{ [SYMBOL_EXPORT_ATTR_SVG_PATH]: CONVERTER_ARTWORK_PATHS.DC }}
            width={converterIconSize}
            height={converterIconSize}
            offsetX={converterIconSize / 2}
            offsetY={converterIconSize / 2}
            x={iconPosition.x}
            y={iconPosition.y}
            listening={false}
          />
        ))}
      {isSelected && converterResizeDirection && (
        <>
          {converterResizePreviewCount != null &&
            converterResizePreviewCount !== circuitConverterConnectionCount && (
              <Rect
                name={INTERACTIVE_OVERLAY_EXPORT_NAME}
                x={
                  converterResizeDirection === 'left'
                    ? converterFixedEdge - previewConverterWidth
                    : converterFixedEdge
                }
                y={-renderedSymbolSize.height / 2}
                width={previewConverterWidth}
                height={renderedSymbolSize.height}
                stroke="#0284c7"
                strokeWidth={1}
                dash={[3, 2]}
                listening={false}
              />
            )}
          <Rect
            name={INTERACTIVE_OVERLAY_EXPORT_NAME}
            x={converterResizeHandleEdge - CONVERTER_RESIZE_HANDLE_HIT_WIDTH / 2}
            y={-renderedSymbolSize.height / 2}
            width={CONVERTER_RESIZE_HANDLE_HIT_WIDTH}
            height={renderedSymbolSize.height}
            fill="transparent"
            draggable
            onMouseDown={(event) => {
              event.cancelBubble = true
            }}
            onClick={(event) => {
              event.cancelBubble = true
            }}
            onTap={(event) => {
              event.cancelBubble = true
            }}
            onDragStart={(event) => {
              event.cancelBubble = true
              converterResizeCountRef.current = circuitConverterConnectionCount
              setConverterResizePreviewCount(circuitConverterConnectionCount)
            }}
            onDragMove={(event) => {
              event.cancelBubble = true
              const handleCenter = event.target.x() + CONVERTER_RESIZE_HANDLE_HIT_WIDTH / 2
              const bodyEdgeAtPointer =
                handleCenter - converterResizeDirectionSign * CONVERTER_RESIZE_OUTLINE_PADDING
              const requestedWidth =
                converterResizeDirection === 'left'
                  ? converterFixedEdge - bodyEdgeAtPointer
                  : bodyEdgeAtPointer - converterFixedEdge
              const nextCount = clampConverterDcConnectionCount(requestedWidth / SYMBOL_SIZE)
              converterResizeCountRef.current = nextCount
              setConverterResizePreviewCount(nextCount)
              const snappedWidth = nextCount * SYMBOL_SIZE
              const snappedEdge =
                converterResizeDirection === 'left'
                  ? converterFixedEdge - snappedWidth
                  : converterFixedEdge + snappedWidth
              const snappedHandleEdge =
                snappedEdge + converterResizeDirectionSign * CONVERTER_RESIZE_OUTLINE_PADDING
              event.target.x(snappedHandleEdge - CONVERTER_RESIZE_HANDLE_HIT_WIDTH / 2)
              event.target.y(-renderedSymbolSize.height / 2)
            }}
            onDragEnd={(event) => {
              event.cancelBubble = true
              const nextCount = converterResizeCountRef.current ?? circuitConverterConnectionCount
              converterResizeCountRef.current = null
              setConverterResizePreviewCount(null)
              if (nextCount !== circuitConverterConnectionCount) {
                // Supply-assembly converters grow leftward and reposition their
                // bounds, so the viewport must re-anchor to keep them in view.
                // Ordinary main-bus converters grow in place and need no pan —
                // running the anchored path there flings the viewport off-screen.
                if (isSupplyConverterResize && resizeConverterWithViewportAnchor) {
                  const previousAnchor = circuitConverterAnchor ?? position
                  resizeConverterWithViewportAnchor(device.id, nextCount, previousAnchor)
                } else {
                  resizeConverterDcConnections(device.id, nextCount)
                }
              }
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
        </>
      )}
      {device.symbol === 'source_changeover' &&
        isSymbolLabelVisible(device.symbolLabelDisplay, 'changeoverPort1Label', true) &&
        (device.changeoverProps?.port1Label ?? '1').trim().length > 0 && (
          <Text
            x={
              rotateMirroredChangeover
                ? -renderedSymbolSize.width / 2 + 2
                : renderedSymbolSize.width / 2 - 162
            }
            y={
              rotateMirroredChangeover
                ? (renderedSymbolSize.height * 7) / 24 + 2
                : -(renderedSymbolSize.height * 7) / 24 - 11
            }
            width={160}
            text={device.changeoverProps?.port1Label ?? '1'}
            align={rotateMirroredChangeover ? 'left' : 'right'}
            fontSize={8}
            fontFamily={fontFamily}
            fill={getSecondaryTextColor(isDark ?? false)}
            listening={false}
          />
        )}
      {device.symbol === 'source_changeover' &&
        isSymbolLabelVisible(device.symbolLabelDisplay, 'changeoverPort2Label', true) &&
        (device.changeoverProps?.port2Label ?? '2').trim().length > 0 && (
          <Text
            x={
              rotateMirroredChangeover
                ? -renderedSymbolSize.width / 2 + 2
                : renderedSymbolSize.width / 2 - 162
            }
            y={
              rotateMirroredChangeover
                ? -(renderedSymbolSize.height * 7) / 24 - 11
                : (renderedSymbolSize.height * 7) / 24 + 2
            }
            width={160}
            text={device.changeoverProps?.port2Label ?? '2'}
            align={rotateMirroredChangeover ? 'left' : 'right'}
            fontSize={8}
            fontFamily={fontFamily}
            fill={getSecondaryTextColor(isDark ?? false)}
            listening={false}
          />
        )}
      {isSeparateSupplyInverter && (
        <>
          <DomainMarker domain="DC" {...separateInverterDomainMarkers.DC} color={getSecondaryTextColor(isDark ?? false)} />
          <DomainMarker domain="AC" {...separateInverterDomainMarkers.AC} color={getSecondaryTextColor(isDark ?? false)} />
        </>
      )}
      {!isDirectionalConverter &&
        isConversionSymbol &&
        (device.supplyPath === 'backup' || device.supplyPath === 'converter-branch') && (
          <>
            <DomainMarker
              domain="AC"
              x={-renderedSymbolSize.width / 2 - 6}
              y={-5.5}
              color={getSecondaryTextColor(isDark ?? false)}
            />
            {hasConnectedBottomWire && (
              <DomainMarker
                domain="AC"
                x={7}
                y={renderedSymbolSize.height / 2 + 6}
                color={getSecondaryTextColor(isDark ?? false)}
              />
            )}
            <DomainMarker
              domain="DC"
              x={renderedSymbolSize.width / 2 + 6}
              y={-5.5}
              color={getSecondaryTextColor(isDark ?? false)}
            />
            {hasConnectedTopWire && (
              <DomainMarker
                domain="DC"
                x={7}
                y={-renderedSymbolSize.height / 2 - 6}
                color={getSecondaryTextColor(isDark ?? false)}
              />
            )}
            {converterAcPhaseLabel && (
              <>
                <Text
                  x={-renderedSymbolSize.width / 2 - 30}
                  y={2}
                  width={24}
                  text={converterAcPhaseLabel}
                  align="right"
                  fontSize={6}
                  fontFamily={fontFamily}
                  fill={getSecondaryTextColor(isDark ?? false)}
                  listening={false}
                />
                {hasConnectedBottomWire && (
                  <Text
                    x={-30}
                    y={renderedSymbolSize.height / 2 + 3}
                    width={24}
                    text={converterAcPhaseLabel}
                    align="right"
                    fontSize={6}
                    fontFamily={fontFamily}
                    fill={getSecondaryTextColor(isDark ?? false)}
                    listening={false}
                  />
                )}
              </>
            )}
          </>
        )}
      {supplyDeviceMultiplier > 1 && (
        <MultiplierBadge
          count={supplyDeviceMultiplier}
          anchorX={renderedSymbolSize.width / 2}
          anchorY={-renderedSymbolSize.height / 2}
          fontFamily={fontFamily}
          fill={getSymbolColor(theme?.mode === 'dark')}
          onActivate={() => openSupplyDeviceAddMoreDialog(device, t)}
        />
      )}

      {useMetadataCallout && renderedMetadataCalloutLines.length > 0 && (
        <>
          {metadataCalloutLeaderPointSets.map((points, index) => (
            <Line
              key={`${device.id}-metadata-leader-${index}`}
              points={points}
              stroke={getSecondaryTextColor(isDark ?? false)}
              strokeWidth={0.7}
              dash={[3, 3]}
              listening={false}
            />
          ))}
          <Group
            x={metadataCalloutPlacement.x}
            y={metadataCalloutPlacement.y}
            {...metadataCalloutGestureHandlers}
            onMouseEnter={handleMetadataCalloutMouseEnter}
            onMouseLeave={handleMetadataCalloutMouseLeave}
            onClick={stopMetadataCalloutClickBubble}
            onTap={stopMetadataCalloutClickBubble}
          >
            <Rect
              width={metadataCalloutWidth}
              height={metadataCalloutHeight}
              stroke={
                isSelected || isHoveredAny
                  ? SELECTION_COLOR
                  : getSecondaryTextColor(isDark ?? false)
              }
              strokeWidth={isSelected ? 1.2 : 0.7}
              cornerRadius={2}
              fill="transparent"
            />
            <Text
              x={5}
              y={5}
              width={metadataCalloutWidth - 10}
              height={metadataCalloutHeight - 10}
              text={renderedMetadataCalloutLines.join('\n')}
              fontFamily={fontFamily}
              fontSize={8}
              lineHeight={1.25}
              fill={getSecondaryTextColor(isDark ?? false)}
              wrap="word"
              listening={false}
            />
          </Group>
        </>
      )}

      {/* Transformer overlays on trunk device */}
      {isTransformer && transformerSafetyImage && (
        <Image
          image={transformerSafetyImage}
          width={SYMBOL_SIZE}
          height={SYMBOL_SIZE}
          offsetX={SYMBOL_SIZE / 2}
          offsetY={isHorizontal ? SYMBOL_SIZE / 2 : SYMBOL_SIZE / 2}
          rotation={renderedSymbolRotationDeg}
          listening={false}
        />
      )}
      {isTransformer && transformerShortcircuitImage && (
        <Image
          image={transformerShortcircuitImage}
          width={SYMBOL_SIZE}
          height={SYMBOL_SIZE}
          offsetX={SYMBOL_SIZE / 2}
          offsetY={isHorizontal ? SYMBOL_SIZE / 2 : SYMBOL_SIZE / 2}
          rotation={renderedSymbolRotationDeg}
          listening={false}
        />
      )}
      {isTransformer && transformerProtectionImage && (
        <Image
          image={transformerProtectionImage}
          width={SYMBOL_SIZE}
          height={SYMBOL_SIZE}
          offsetX={SYMBOL_SIZE / 2}
          offsetY={isHorizontal ? SYMBOL_SIZE / 2 : SYMBOL_SIZE / 2}
          rotation={renderedSymbolRotationDeg}
          listening={false}
        />
      )}

      {/* Generic trunk labels on the right: conversion details + notes (single stacked flow). */}
      {!useMetadataCallout && !isSharedMetadataMember && stackedRightLabelItems.length > 0 && (
        <SymbolTextLabels
          items={stackedRightLabelItems}
          config={{ position: 'right', layout: 'stack' }}
          sideLabelBlockAlign="center"
          offsetFromSymbol={5 + certificationSideLabelExtraOffset}
          textColor={getSecondaryTextColor(isDark ?? false)}
          fontFamily={fontFamily}
          fontSize={8}
          symbolWidth={renderedSymbolSize.width}
          symbolHeight={renderedSymbolSize.height}
        />
      )}
      {placeNotesOnTop &&
        !useMetadataCallout &&
        !isSharedMetadataMember &&
        topStackLabelItems.length > 0 &&
        !hasConnectedTopWire && (
          <SymbolTextLabels
            items={renderedTopStackLabelItems}
            config={{ position: 'top', layout: 'stack' }}
            positionOffset={
              metadataTopPlacement
                ? { x: metadataTopPlacement.offsetX, y: metadataTopPlacement.offsetY }
                : undefined
            }
            textColor={getSecondaryTextColor(isDark ?? false)}
            fontFamily={fontFamily}
            fontSize={8}
            symbolWidth={renderedSymbolSize.width}
            symbolHeight={renderedSymbolSize.height}
          />
        )}
      {renderSupplyNotesVertically && (
        <Text
          name="supply-trunk-vertical-note"
          x={-(countSymbolLabelVisualLines(notesText) * SUPPLY_METADATA_FONT_SIZE) / 2}
          y={-renderedSymbolSize.height / 2 - 5}
          text={notesText}
          rotation={-90}
          fontFamily={fontFamily}
          fontSize={SUPPLY_METADATA_FONT_SIZE}
          fill={getSecondaryTextColor(isDark ?? false)}
          wrap="none"
          listening={false}
        />
      )}
      {placeNotesOnTop &&
        !useMetadataCallout &&
        !isSharedMetadataMember &&
        topStackLabelItems.length > 0 &&
        hasConnectedTopWire && (
          <Text
            x={-164}
            y={-renderedSymbolSize.height / 2 - topStackVisualLineCount * 10 - 4}
            width={160}
            text={renderedTopStackLabelItems.map((item) => item.text).join('\n')}
            align="right"
            fontFamily={fontFamily}
            fontSize={8}
            lineHeight={1.25}
            fill={getSecondaryTextColor(isDark ?? false)}
            listening={false}
          />
        )}
      {showSupplyProtectionNameLabel && (
        <SymbolTextLabels
          items={[
            {
              key: 'supplyProtectionNameLabel',
              text: nameTopPlacement?.text ?? nameLabelText,
            },
          ]}
          config={{ position: 'top', layout: 'stack' }}
          positionOffset={
            nameTopPlacement
              ? { x: nameTopPlacement.offsetX, y: nameTopPlacement.offsetY }
              : isVerticalSupplyProtection && topStackVisualLineCount > 0 && !showDeviceLabelLeft
                ? { x: 0, y: -(topStackVisualLineCount * 10 + 4) }
                : undefined
          }
          textColor={getTextColor(isDark ?? false)}
          fontFamily={fontFamily}
          fontSize={11}
          symbolWidth={renderedSymbolSize.width}
          symbolHeight={renderedSymbolSize.height}
        />
      )}
      {showDeviceLabelLeft && leftStackLabelItems.length > 0 && (
        <SymbolTextLabels
          items={leftStackLabelItems}
          config={{ position: 'left', layout: 'stack' }}
          sideLabelBlockAlign="center"
          textColor={
            isVerticalSupplyProtection
              ? getTextColor(isDark ?? false)
              : getSecondaryTextColor(isDark ?? false)
          }
          fontFamily={fontFamily}
          fontSize={isVerticalSupplyProtection ? 11 : 8}
          symbolWidth={renderedSymbolSize.width}
          symbolHeight={renderedSymbolSize.height}
        />
      )}
      {isSharedJunctionSymbol(device.symbol) &&
        junctionIdentityText.length > 0 &&
        isSymbolLabelVisible(
          device.symbolLabelDisplay,
          'junctionIdentityLabel',
          isJunctionIdentityVisibleByDefault(device.symbol)
        ) && (
          <SymbolTextLabels
            items={[
              {
                key: 'junctionIdentityLabel',
                text: getJunctionIdentityDisplay(
                  device.symbol,
                  junctionIdentityText,
                  device.terminalStripPin,
                  device.symbol === 'terminal_strip'
                    ? terminalStripOutgoingPin
                    : device.terminalStripOutgoingPin
                ),
              },
            ]}
            config={{
              position: getJunctionIdentityLabelPosition(device.symbol, isHorizontal === true),
              layout: 'stack',
            }}
            textColor={getTextColor(isDark ?? false)}
            fontFamily={fontFamily}
            fontSize={10}
            symbolWidth={renderedSymbolSize.width}
            symbolHeight={renderedSymbolSize.height}
          />
        )}
      {isRelay && (
        <SymbolTextLabels
          items={[]}
          lines={getSupplyInlineLabelLines(device).map((line) => line.text)}
          anchorLineIndex={0}
          config={{
            ...device.symbolLabelDisplay,
            position: protectionLabelPosition ?? device.symbolLabelDisplay?.position ?? (isHorizontal ? 'bottom' : 'right'),
            layout: 'stack',
          }}
          textColor={getSecondaryTextColor(isDark ?? false)}
          fontFamily={fontFamily}
          fontSize={10}
          symbolWidth={renderedSymbolSize.width}
          symbolHeight={renderedSymbolSize.height}
          onLabelClick={handleClick}
        />
      )}
      {isProtection && (
        <ProtectionOneWireLabels
          source={
            protectionLabelPosition
              ? {
                  ...protectionLabelSource,
                  symbolLabelDisplay: {
                    ...protectionLabelSource.symbolLabelDisplay,
                    position: protectionLabelPosition,
                  },
                }
              : protectionLabelSource
          }
          defaultPosition={isHorizontal ? 'bottom' : 'right'}
          textColor={getSecondaryTextColor(isDark ?? false)}
          fontFamily={fontFamily}
          fontSize={10}
          symbolSize={SYMBOL_SIZE}
          symbolWidth={isSurgeProtection && !isHorizontal ? 0 : renderedSymbolSize.width}
          symbolHeight={
            isSurgeProtection && !isHorizontal ? surgeBodyBounds.height : renderedSymbolSize.height
          }
          splitResidualLine={splitProtectionResidualLine}
          onLabelClick={handleClick}
        />
      )}
      {/* Preview highlight (during selection rectangle drag) */}
      {isPreviewSelected && !isSelected && (
        <Rect
          {...(isSurgeProtection
            ? getPaddedRectPreviewOutlineProps(
                canvasZoom,
                surgeSelectionBounds.x,
                surgeSelectionBounds.y,
                surgeSelectionBounds.width,
                surgeSelectionBounds.height,
                2
              )
            : isWideCircuitConverter || converterResizeDirection != null
              ? getPaddedRectPreviewOutlineProps(
                  canvasZoom,
                  -renderedSymbolSize.width / 2,
                  -renderedSymbolSize.height / 2,
                  renderedSymbolSize.width,
                  renderedSymbolSize.height,
                  4
                )
              : getPreviewOutlineProps(canvasZoom, ENDPOINT_OUTLINE_SIZE))}
        />
      )}
      {/* Hover highlight */}
      {isHoveredAny && !isSelected && !isPreviewSelected && (
        <Rect
          {...(isSurgeProtection
            ? getPaddedRectHoverOutlineProps(
                canvasZoom,
                surgeSelectionBounds.x,
                surgeSelectionBounds.y,
                surgeSelectionBounds.width,
                surgeSelectionBounds.height,
                2
              )
            : isWideCircuitConverter || converterResizeDirection != null
              ? getPaddedRectHoverOutlineProps(
                  canvasZoom,
                  -renderedSymbolSize.width / 2,
                  -renderedSymbolSize.height / 2,
                  renderedSymbolSize.width,
                  renderedSymbolSize.height,
                  4
                )
              : getHoverOutlineProps(canvasZoom, ENDPOINT_OUTLINE_SIZE))}
        />
      )}
      {/* Selection outline */}
      {isSelected && (
        <Rect
          {...(isSurgeProtection
            ? getPaddedRectSelectionOutlineProps(
                canvasZoom,
                surgeSelectionBounds.x,
                surgeSelectionBounds.y,
                surgeSelectionBounds.width,
                surgeSelectionBounds.height,
                2
              )
            : isWideCircuitConverter || converterResizeDirection != null
              ? getPaddedRectSelectionOutlineProps(
                  canvasZoom,
                  -renderedSymbolSize.width / 2,
                  -renderedSymbolSize.height / 2,
                  renderedSymbolSize.width,
                  renderedSymbolSize.height,
                  4
                )
              : getSelectionOutlineProps(canvasZoom, ENDPOINT_OUTLINE_SIZE))}
        />
      )}
      {/* Keep the resize pill above the yellow selection outline. */}
      {isSelected && converterResizeDirection && (
        <Rect
          x={converterResizeHandleEdge - CONVERTER_RESIZE_HANDLE_WIDTH / 2}
          y={-(renderedSymbolSize.height + 2) / 2}
          width={CONVERTER_RESIZE_HANDLE_WIDTH}
          height={renderedSymbolSize.height + 2}
          fill="#0284c7"
          opacity={0.9}
          cornerRadius={2}
          listening={false}
        />
      )}
    </Group>
  )
}
