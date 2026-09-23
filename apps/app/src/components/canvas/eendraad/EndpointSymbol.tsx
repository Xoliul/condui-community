import { memo, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ZOOM_100 } from '@/constants/canvasConstants'
import { Group, Image, Line, Rect, Text } from 'react-konva'
import { useUIStore } from '@/stores/uiStore'
import {
  useClearHover,
  useEndpointSelected,
  useHoverIncludes,
  useSetHover,
  useSetSelection,
} from '@/editions/community/communityHooks'
import { useSettingsStore } from '@/stores/settingsStore'
import { logger } from '@/lib/logger'
import { getStableEndpointRenderRevision } from '@/lib/projectV2/electricalLookupIndex'
import {
  getSymbolById,
  getFixedApplianceSymbolPath,
  SOCKET_OVERLAY_PATHS,
  getSwitchSymbolPaths,
  getSwitchDisplaySvgPath,
  LIGHT_POINT_OVERLAY_PATHS,
  LIGHT_SPOT_OVERLAY_PATHS,
  HVAC_ENERGY_SOURCE_PATHS,
  HVAC_TYPE_OVERLAY_PATHS,
  RELAY_OVERLAY_PATHS,
  SMOKE_DETECTOR_OVERLAY_PATHS,
  DOMOTICA_CONTROL_OVERLAY_PATHS,
  TRANSFORMER_OVERLAY_PATHS,
} from '@/lib/symbols'
import { SYMBOL_EXPORT_ATTR_SVG_PATH, loadProcessedSymbol } from '@/lib/symbolImage'
import { showLightPointDecentralOverlay, showLightPointSafetyOverlay } from '@/lib/lightPointProps'
import { endpointSupportsMultiplier, getEndpointMultiplier } from '@/utils/endpointMultipliers'
import { openAddMoreDialogForEndpoint } from '@/components/endpoints/AddMoreCountDialog'
import { useIsPreviewSelected } from '@/contexts/SelectionPreviewContext'
import { useCanvasFontFamily, useEffectiveCanvasZoom, useTouchPrimaryDevice } from '@/editions/community/communityHooks'
import { applyTouchHitPadding } from '@/lib/canvas/touchHitZones'
import { SymbolTextLabels } from './SymbolTextLabels'
import {
  getJunctionIdentity,
  getJunctionIdentityDisplay,
  isJunctionIdentityVisibleByDefault,
  isSharedJunctionSymbol,
} from '@/lib/junctionIdentity'
import { isSymbolLabelVisible } from '@/lib/symbolLabels'
import {
  SYMBOL_SIZE,
  ENDPOINT_OUTLINE_SIZE,
  DOMOTICA_BASE_HEIGHT,
  DOMOTICA_BOX_WIDTH,
  DOMOTICA_OUTPUT_SPACING,
  DOMOTICA_MAX_ENDPOINT_OUTPUTS,
  DOMOTICA_MIN_ENDPOINT_OUTPUTS,
  DOMOTICA_CONTROL_BAR_HEIGHT,
  MULTI_SOCKET_OFFSET,
  getSocketExtraWidth,
  getSymbolColor,
  getEndpointHoverOutlineProps,
  getEndpointPreviewOutlineProps,
  getEndpointSelectionOutlineProps,
  getPaddedRectHoverOutlineProps,
  getPaddedRectPreviewOutlineProps,
  getPaddedRectSelectionOutlineProps,
  getSecondaryTextColor,
  SOCKET_WATERPROOF_H_OFFSET_RIGHT,
  SOCKET_WATERPROOF_H_OFFSET_TOP,
  SOCKET_WATERPROOF_H_FONT_SIZE,
  LIGHT_POINT_WATERPROOF_H_OFFSET_TOP,
  HVAC_ENERGY_OFFSET_Y_FACTOR,
  HVAC_FUNCTION_OFFSET_X_FACTOR,
  HVAC_HEAT_EXCHANGE_TYPE_OFFSET_Y,
} from './canvasSymbols'
import { MultiplierBadge } from './MultiplierBadge'
import type { Endpoint, DomoticaControlKey } from '@/types/schema'
import { useProjectStore } from '@/stores/projectStore'
import type { Point } from '@/types/ui'
import { getVisibleCertificationLabelParts } from '@/lib/certificationLabels'
import { getVisibleConversionLabelParts, getVisibleEndpointNoteText } from '@/lib/conversionLabels'
import { useEendraadWireSegments } from '@/hooks/eendraad'
import {
  CONVERTER_ARTWORK_PATHS,
  CONVERTER_DOMAIN_ICON_SIZE_RATIO,
  getConverterArtworkLayout,
  getConverterConnectionDomains,
  getConverterCornerPosition,
  getConverterDomainCorner,
  isDirectionalConverterSymbol,
} from '@/lib/converterArtwork'
import { resolveMetadataCalloutSelection } from '@/lib/ui/metadataCalloutSelection'
import { applyMetadataCalloutMultiplier } from '@/lib/metadataCalloutGrouping'
import {
  clampDomoticaEndpointCount,
  isDomoticaEndpointOnDcBus,
  resizeDomoticaEndpointCount,
} from '@/lib/eendraad/resizeDomoticaEndpointCount'
import {
  clampConverterDcConnectionCount,
  resizeConverterDcConnections,
} from '@/lib/eendraad/resizeConverterDcConnections'

const INTERACTIVE_HIT_FILL = 'rgba(0, 0, 0, 0.01)'
const DOMOTICA_RESIZE_OUTLINE_PADDING = 4
const DOMOTICA_RESIZE_HANDLE_WIDTH = 6
const DOMOTICA_RESIZE_HANDLE_HIT_HEIGHT = 14
const CONVERTER_RESIZE_OUTLINE_PADDING = 4
const CONVERTER_RESIZE_HANDLE_WIDTH = 6
const CONVERTER_RESIZE_HANDLE_HIT_WIDTH = 14
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

export interface EndpointMetadataCallout {
  x: number
  y: number
  width: number
  height: number
  leaderPoints: [number, number, number, number]
  leaderSegments?: Array<[number, number, number, number]>
  targetIds?: string[]
  totalMultiplier?: number
}

interface EndpointMetadataCalloutProps {
  endpoint: Endpoint
  position: Point
  metadataCallout: EndpointMetadataCallout
}

export const EndpointMetadataCallout = memo(function EndpointMetadataCallout({
  endpoint,
  position,
  metadataCallout,
}: EndpointMetadataCalloutProps) {
  const setSelection = useSetSelection()
  const setHover = useSetHover()
  const clearHover = useClearHover()
  const theme = useSettingsStore((state) => state.theme)
  const fontFamily = useCanvasFontFamily()
  const isSelected = useEndpointSelected(endpoint)
  const metadataLabelItems = useMemo(() => {
    const items = [
      ...getVisibleConversionLabelParts(endpoint),
      ...getVisibleCertificationLabelParts(endpoint),
      ...(getVisibleEndpointNoteText(endpoint)
        ? [{ key: 'endpointNotes' as const, text: getVisibleEndpointNoteText(endpoint) }]
        : []),
    ]
    const multiplier = endpointSupportsMultiplier(endpoint) ? getEndpointMultiplier(endpoint) : 1
    return applyMetadataCalloutMultiplier(items, metadataCallout.totalMultiplier ?? multiplier)
  }, [endpoint, metadataCallout.totalMultiplier])

  const handleClick = useCallback(
    (event: unknown) => {
      const e = event as EendraadPointerEvent
      e.cancelBubble = true
      if (e.evt.button != null && e.evt.button !== 0) return
      const targetIds = metadataCallout.targetIds?.length
        ? metadataCallout.targetIds
        : [endpoint.id]
      const { selection } = useUIStore.getState()
      setSelection(
        resolveMetadataCalloutSelection(selection, targetIds, {
          extend: !!e.evt.shiftKey,
          toggle: !!(e.evt.altKey || e.evt.ctrlKey || e.evt.metaKey),
        })
      )
    },
    [endpoint.id, metadataCallout.targetIds, setSelection]
  )

  const handleMouseEnter = useCallback(
    (event: unknown) => {
      const e = event as EendraadPointerEvent
      e.cancelBubble = true
      const targetIds = metadataCallout.targetIds?.length
        ? metadataCallout.targetIds
        : [endpoint.id]
      setHover({ type: 'endpoint', ids: targetIds })
    },
    [endpoint.id, metadataCallout.targetIds, setHover]
  )

  const handleMouseLeave = useCallback(
    (event: unknown) => {
      const e = event as EendraadPointerEvent
      e.cancelBubble = true
      const targetIds = metadataCallout.targetIds?.length
        ? metadataCallout.targetIds
        : [endpoint.id]
      const { hover } = useUIStore.getState()
      if (
        hover.type === 'endpoint' &&
        targetIds.every((id) => hover.ids.includes(id))
      ) {
        clearHover()
      }
    },
    [clearHover, endpoint.id, metadataCallout.targetIds]
  )

  if (metadataLabelItems.length === 0) return null

  return (
    <Group x={position.x} y={position.y}>
      {(metadataCallout.leaderSegments ?? [metadataCallout.leaderPoints]).map(
        (leaderPoints, index) => (
          <Line
            key={`metadata-leader-${index}`}
            points={leaderPoints}
            stroke={getSecondaryTextColor(theme?.mode === 'dark')}
            strokeWidth={0.7}
            dash={[3, 3]}
            listening={false}
          />
        )
      )}
      <Group
        x={metadataCallout.x}
        y={metadataCallout.y}
        onClick={handleClick}
        onTap={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <Rect
          width={metadataCallout.width}
          height={metadataCallout.height}
          stroke={getSecondaryTextColor(theme?.mode === 'dark')}
          strokeWidth={isSelected ? 1.2 : 0.7}
          cornerRadius={2}
          fill="transparent"
        />
        <Text
          x={5}
          y={5}
          width={metadataCallout.width - 10}
          height={metadataCallout.height - 10}
          text={metadataLabelItems.map((part) => part.text).join('\n')}
          fontFamily={fontFamily}
          fontSize={8}
          lineHeight={1.25}
          fill={getSecondaryTextColor(theme?.mode === 'dark')}
          wrap="word"
          listening={false}
        />
      </Group>
    </Group>
  )
})

interface EndpointSymbolProps {
  endpoint: Endpoint
  position: Point
  /**
   * Called when a drag ends. Should return `true` when the drop was accepted
   * and `false` when it was rejected (invalid target) so the symbol can snap back.
   */
  onDragEnd: (newPos: Point) => boolean | void
  /** Optional live drag callback used by 1‑draad internal drag/preview pipeline. */
  onDragMove?: (newPos: Point) => void
  /** Alt/Option at drag start; return true to use pointer-driven duplicate (source stays put). */
  onDragStart?: (altKey: boolean, nativeEvt: MouseEvent) => boolean
  shouldSuppressKonvaDragEnd?: () => boolean
  /** When true, this endpoint is allowed to be dragged (still gated by selection). */
  draggable?: boolean
  /** Convert Konva drag events to the cursor position in canvas coordinates. */
  getCanvasPositionFromEvent?: (e: unknown) => Point | null
  /** Whether this endpoint is the final symbol on its horizontal branch. */
  isEndpointAtBranchEnd?: boolean
  /** Mirror symbol artwork for the exceptional branches that run to the left. */
  mirrorHorizontally?: boolean
  /** Clamp bottom label text away from the branch wire when needed. */
  bottomLabelMinimumLeftX?: number
  /** Limit bottom label text to its crowded branch slot. */
  bottomLabelMaximumRightX?: number
  metadataCallout?: EndpointMetadataCallout
  metadataLabelSuppressed?: boolean
  /** Render the detached metadata card in this endpoint group. */
  renderMetadataCallout?: boolean
  /** Keep the selected entity out of the heavy base layer when rendered separately. */
  suppressWhenSelected?: boolean
  /** Electrical anchor for a DC-bus converter endpoint that can grow horizontally. */
  circuitConverterAnchor?: Point
  converterGrowthDirection?: 'left' | 'right'
}

export const EndpointSymbol = memo(function EndpointSymbol({
  endpoint: layoutEndpoint,
  position,
  onDragEnd,
  onDragMove,
  onDragStart,
  shouldSuppressKonvaDragEnd,
  draggable = false,
  getCanvasPositionFromEvent,
  isEndpointAtBranchEnd = true,
  mirrorHorizontally = false,
  bottomLabelMinimumLeftX,
  bottomLabelMaximumRightX,
  metadataCallout,
  metadataLabelSuppressed = false,
  renderMetadataCallout = true,
  suppressWhenSelected = false,
  circuitConverterAnchor,
  converterGrowthDirection = 'right',
}: EndpointSymbolProps) {
  const endpoint = useProjectStore((state) => {
    const liveEndpoint = state.getEndpointById(layoutEndpoint.id)
    const projectId = state.currentProject?.project.id
    return liveEndpoint && projectId
      ? getStableEndpointRenderRevision(projectId, liveEndpoint)
      : layoutEndpoint
  })
  const setSelection = useSetSelection()
  const isSinglySelectedEndpoint = useUIStore(
    (state) =>
      state.selection.type === 'endpoint' &&
      state.selection.ids.length === 1 &&
      state.selection.ids[0] === endpoint.id
  )
  const { t } = useTranslation()
  const isSelected = useEndpointSelected(endpoint)
  const isHoveredFromBreadcrumb = useHoverIncludes('endpoint', endpoint.id)
  const canvasZoom = useEffectiveCanvasZoom(ZOOM_100, 'eendraad')
  const touchPrimary = useTouchPrimaryDevice()
  const theme = useSettingsStore((state) => state.theme)
  const fontFamily = useCanvasFontFamily()
  const isPreviewSelected = useIsPreviewSelected('endpoint', endpoint.id)
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
  // Selecting an endpoint re-renders it (the selection outline mounts), which can make Konva miss
  // the symbol's mouseleave — leaving isHovered stuck true so the dashed hover outline reappears
  // after deselect. Clear both the local and any stale global hover once it becomes (preview-)selected.
  useEffect(() => {
    if (!isSelected && !isPreviewSelected) return
    setIsHovered(false)
    const { hover, clearHover } = useUIStore.getState()
    if (hover.type === 'endpoint' && hover.ids.includes(endpoint.id)) clearHover()
  }, [isSelected, isPreviewSelected, endpoint.id])
  const [hvacEnergyImage, setHvacEnergyImage] = useState<HTMLImageElement | null>(null)
  const [hvacTypeImage, setHvacTypeImage] = useState<HTMLImageElement | null>(null)
  const [relayOverlayImage, setRelayOverlayImage] = useState<HTMLImageElement | null>(null)
  const [smokeDetectorOverlayImage, setSmokeDetectorOverlayImage] =
    useState<HTMLImageElement | null>(null)
  const [domoticaMainImage, setDomoticaMainImage] = useState<HTMLImageElement | null>(null)
  const [domoticaControlImages, setDomoticaControlImages] = useState<
    Partial<Record<DomoticaControlKey, HTMLImageElement | null>>
  >({})
  const [domoticaResizePreviewCount, setDomoticaResizePreviewCount] = useState<number | null>(null)
  const domoticaResizeCountRef = useRef<number | null>(null)
  const domoticaResizeCommitCountRef = useRef<number | null>(null)
  const domoticaBottomAnchorRef = useRef<number | null>(null)
  const [converterResizePreviewCount, setConverterResizePreviewCount] = useState<number | null>(
    null
  )
  const converterResizeCountRef = useRef<number | null>(null)

  const symbol = endpoint.symbol ? getSymbolById(endpoint.symbol) : null
  const isDirectionalConverter = isDirectionalConverterSymbol(endpoint.symbol)
  const wireSegments = useEendraadWireSegments(isDirectionalConverter)
  const converterConnectionDomains = isDirectionalConverter
    ? getConverterConnectionDomains(wireSegments, endpoint.id, position, SYMBOL_SIZE)
    : {}
  const converterArtworkLayout = isDirectionalConverter
    ? getConverterArtworkLayout(
        endpoint.symbol === 'inverter' ? 'DC' : 'AC',
        endpoint.symbol === 'inverter' ? 'AC' : 'DC',
        converterConnectionDomains
      )
    : null
  const isDomoticaParent = endpoint.symbol === 'domotica'

  const isSocket = endpoint.type === 'socket'
  const isModularSocket = isSocket && endpoint.socketProps?.modular === true
  const isSwitch = endpoint.type === 'switch'
  const socketProps = endpoint.socketProps
  const switchProps = endpoint.switchProps
  const motionDetectorType = endpoint.motionDetectorProps?.type ?? 'spread'
  const switchSymbolPathProps =
    endpoint.symbol === 'motion_detector' ? { ...switchProps, motionDetectorType } : switchProps
  const showSwitchOverlay = isSocket && socketProps?.switchOverlay
  const showSwitchOverlayLock = isSocket && socketProps?.switchOverlayLock
  const showSocketWaterproof = isSocket && socketProps?.waterproof
  const socketCount = isSocket ? socketProps?.socketCount || 1 : 1
  const socketExtraWidth = getSocketExtraWidth(socketCount)
  const isLightPoint = endpoint.type === 'light_point' && endpoint.symbol === 'light_point'
  const isLightSpot = endpoint.type === 'light_point' && endpoint.symbol === 'light_spot'
  const isLightFluorescent =
    endpoint.type === 'light_point' && endpoint.symbol === 'light_fluorescent'
  const lightPointProps = endpoint.lightPointProps
  const showLightPointWaterproof = isLightPoint && lightPointProps?.waterproof
  const onWallExtraWidth = isLightPoint && lightPointProps?.onWall ? 6 : 0
  const totalExtraWidth = socketExtraWidth + onWallExtraWidth
  const lightSpotProps = endpoint.lightSpotProps
  const lightFluorescentProps = endpoint.lightFluorescentProps
  const tubeCount = isLightFluorescent ? (lightFluorescentProps?.tubeCount ?? 1) : 1
  const isHvac = endpoint.symbol === 'furnace'
  const hvacProps = endpoint.hvacProps
  const relayProps = endpoint.relayProps
  const smokeDetectorProps = endpoint.smokeDetectorProps
  const domoticaProps = endpoint.domoticaProps
  const isTransformer = endpoint.symbol === 'transformer'
  const conversionProps = endpoint.energyConversionProps
  const prefersRightEndpointLabel =
    endpoint.symbol === 'solar_panel' || endpoint.symbol === 'battery' || endpoint.symbol === 'ev'
  const endpointLabelPosition =
    prefersRightEndpointLabel && isEndpointAtBranchEnd ? 'right' : 'bottom'
  const conversionLabelParts = getVisibleConversionLabelParts(endpoint)
  const certificationLabelParts = getVisibleCertificationLabelParts(endpoint)
  const endpointNoteText = getVisibleEndpointNoteText(endpoint)
  const symbolSideLabelItems = useMemo(
    () => [
      ...conversionLabelParts,
      ...certificationLabelParts,
      ...(endpointNoteText ? [{ key: 'endpointNotes' as const, text: endpointNoteText }] : []),
    ],
    [certificationLabelParts, conversionLabelParts, endpointNoteText]
  )

  const domoticaMainType = domoticaProps?.mainDeviceType
  const domoticaMainSwitchSymbol = domoticaProps?.mainSwitchSymbol
  const domoticaMainSocketSymbol = domoticaProps?.mainSocketSymbol
  const domoticaMainSwitchProps = domoticaProps?.mainSwitchProps

  // Resolve base SVG path: switches use getSwitchSymbolPaths; boiler/heating use getFixedApplianceSymbolPath; else symbol.svgPath
  const baseSvgPath = isDomoticaParent
    ? null
    : isSwitch && endpoint.symbol
      ? getSwitchSymbolPaths(endpoint.symbol, switchSymbolPathProps).basePath
      : endpoint.symbol === 'boiler'
        ? (getFixedApplianceSymbolPath('boiler', endpoint.fixedApplianceProps) ?? symbol?.svgPath)
        : endpoint.symbol === 'heating'
          ? (getFixedApplianceSymbolPath('heating', endpoint.fixedApplianceProps) ??
            symbol?.svgPath)
          : isDirectionalConverter
            ? CONVERTER_ARTWORK_PATHS.base
            : symbol?.svgPath
  const switchOverlayPath =
    isSwitch && endpoint.symbol
      ? getSwitchSymbolPaths(endpoint.symbol, switchSymbolPathProps).overlayPath
      : undefined

  const hvacEnergyKey = hvacProps?.energySource ?? 'none'
  const hvacTypeKey = hvacProps?.hvacType ?? 'none'
  const hvacFunctionKey = hvacProps?.hvacFunction ?? 'none'

  useEffect(() => {
    if (!baseSvgPath) {
      setProcessedImage(null)
      return
    }
    const isDark = theme?.mode === 'dark'
    loadProcessedSymbol(baseSvgPath, isDark)
      .then(setProcessedImage)
      .catch(() => {
        logger.error('Failed to load symbol:', baseSvgPath)
        setProcessedImage(null)
      })
  }, [baseSvgPath, theme.mode])

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
      loadProcessedSymbol(path, theme?.mode === 'dark')
        .then(setter)
        .catch(() => setter(null))
    }
  }, [isDirectionalConverter, theme?.mode])

  // Load socket overlay images when socketProps request them
  useEffect(() => {
    if (!showSwitchOverlay && !showSwitchOverlayLock) {
      setOverlaySwitchImage(null)
      setOverlaySwitchLockImage(null)
      return
    }
    const isDark = theme?.mode === 'dark'
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
  }, [showSwitchOverlay, showSwitchOverlayLock, theme?.mode])

  // Load switch verklikkerlamp overlay when switchProps.verklikkerlamp
  useEffect(() => {
    if (!switchOverlayPath) {
      setSwitchOverlayImage(null)
      return
    }
    const isDark = theme?.mode === 'dark'
    loadProcessedSymbol(switchOverlayPath, isDark)
      .then(setSwitchOverlayImage)
      .catch(() => setSwitchOverlayImage(null))
  }, [switchOverlayPath, theme?.mode])

  // Load light point overlays (safety, decentral, switch 1p)
  useEffect(() => {
    if (!isLightPoint || !lightPointProps) {
      setLightPointSafetyImage(null)
      setLightPointDecentralImage(null)
      setLightPointSwitchImage(null)
      return
    }
    const isDark = theme?.mode === 'dark'
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
    theme?.mode,
  ])

  // Load transformer overlays (safety type, short‑circuit, protection)
  useEffect(() => {
    if (!isTransformer) {
      setTransformerSafetyImage(null)
      setTransformerShortcircuitImage(null)
      setTransformerProtectionImage(null)
      return
    }
    const isDark = theme?.mode === 'dark'
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
    theme?.mode,
  ])

  // Load light spot beam overlay
  useEffect(() => {
    if (!isLightSpot || !lightSpotProps?.beamType || lightSpotProps.beamType === 'none') {
      setLightSpotBeamImage(null)
      return
    }
    const path =
      lightSpotProps.beamType === 'straight'
        ? LIGHT_SPOT_OVERLAY_PATHS.straight
        : LIGHT_SPOT_OVERLAY_PATHS.diverging
    const isDark = theme?.mode === 'dark'
    loadProcessedSymbol(path, isDark)
      .then(setLightSpotBeamImage)
      .catch(() => setLightSpotBeamImage(null))
  }, [isLightSpot, lightSpotProps?.beamType, theme?.mode])

  // Load HVAC energy source overlays
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
    const isDark = theme?.mode === 'dark'
    loadProcessedSymbol(path, isDark)
      .then(setHvacEnergyImage)
      .catch(() => setHvacEnergyImage(null))
  }, [isHvac, hvacEnergyKey, theme?.mode])

  // Load HVAC type overlays
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
    const isDark = theme?.mode === 'dark'
    loadProcessedSymbol(path, isDark)
      .then(setHvacTypeImage)
      .catch(() => setHvacTypeImage(null))
  }, [isHvac, hvacTypeKey, theme?.mode])

  // Load relay control overlay (based on relayProps.control)
  useEffect(() => {
    if (endpoint.symbol !== 'relay') {
      setRelayOverlayImage(null)
      return
    }
    const controlKey = relayProps?.control ?? 'standard'
    const path = RELAY_OVERLAY_PATHS[controlKey as keyof typeof RELAY_OVERLAY_PATHS]
    if (!path) {
      setRelayOverlayImage(null)
      return
    }
    const isDark = theme?.mode === 'dark'
    loadProcessedSymbol(path, isDark)
      .then(setRelayOverlayImage)
      .catch(() => setRelayOverlayImage(null))
  }, [endpoint.symbol, relayProps?.control, theme?.mode])

  // Load smoke / fire detector overlay (based on smokeDetectorProps.type)
  useEffect(() => {
    if (endpoint.symbol !== 'smoke_detector') {
      setSmokeDetectorOverlayImage(null)
      return
    }
    const typeKey = smokeDetectorProps?.type ?? 'smoke'
    const path = SMOKE_DETECTOR_OVERLAY_PATHS[typeKey as keyof typeof SMOKE_DETECTOR_OVERLAY_PATHS]
    if (!path) {
      setSmokeDetectorOverlayImage(null)
      return
    }
    const isDark = theme?.mode === 'dark'
    loadProcessedSymbol(path, isDark)
      .then(setSmokeDetectorOverlayImage)
      .catch(() => setSmokeDetectorOverlayImage(null))
  }, [endpoint.symbol, smokeDetectorProps?.type, theme?.mode])

  // Load domotica control overlay icons (shared SVGs per key)
  useEffect(() => {
    if (!isDomoticaParent) {
      setDomoticaControlImages({})
      return
    }
    const isDark = theme?.mode === 'dark'
    const keys: Array<keyof typeof DOMOTICA_CONTROL_OVERLAY_PATHS> = [
      'programmed_control',
      'wireless_control',
      'detection_control',
      'button_control',
    ]
    keys.forEach((key) => {
      const path = DOMOTICA_CONTROL_OVERLAY_PATHS[key]
      loadProcessedSymbol(path, isDark)
        .then((img) => {
          setDomoticaControlImages((prev) => ({ ...prev, [key]: img }))
        })
        .catch(() => {
          setDomoticaControlImages((prev) => ({ ...prev, [key]: null }))
        })
    })
  }, [isDomoticaParent, theme?.mode])

  // Load domotica main device symbol (inner symbol rendered in lower section of frame)
  useEffect(() => {
    if (!isDomoticaParent) {
      setDomoticaMainImage(null)
      return
    }
    let path: string | null = null
    if (domoticaMainType === 'switch' && domoticaMainSwitchSymbol) {
      path = getSwitchDisplaySvgPath(domoticaMainSwitchSymbol, domoticaMainSwitchProps)
    } else if (domoticaMainType === 'socket' && domoticaMainSocketSymbol) {
      const sym = getSymbolById(domoticaMainSocketSymbol)
      path = sym?.svgPath ?? null
    }
    if (!path) {
      setDomoticaMainImage(null)
      return
    }
    const isDark = theme?.mode === 'dark'
    loadProcessedSymbol(path, isDark)
      .then(setDomoticaMainImage)
      .catch(() => setDomoticaMainImage(null))
  }, [
    isDomoticaParent,
    domoticaMainType,
    domoticaMainSwitchSymbol,
    domoticaMainSwitchProps,
    domoticaMainSocketSymbol,
    theme?.mode,
  ])

  const handleClick = useCallback(
    (event: unknown) => {
      const e = event as EendraadPointerEvent
      // logger.info('[Touch] EndpointSymbol tap/click', { id: endpoint.id, type: e.type, button: e.evt?.button })
      const eendraWindow = window as WindowWithEendraTapSuppression
      if (eendraWindow.__eendraSuppressNextElementTap) {
        eendraWindow.__eendraSuppressNextElementTap = false
        // logger.info('[Touch] EndpointSymbol tap/click suppressed by long-press', { id: endpoint.id })
        return
      }
      e.cancelBubble = true

      if (e.evt.button != null && e.evt.button !== 0) {
        return
      }

      if (e.evt.shiftKey) {
        const { selection } = useUIStore.getState()
        if (selection.type === 'endpoint' && !selection.ids.includes(endpoint.id)) {
          setSelection({ type: 'endpoint', ids: [...selection.ids, endpoint.id] })
        } else if (selection.type !== 'endpoint') {
          setSelection({ type: 'endpoint', ids: [endpoint.id] })
        }
      } else if (e.evt.altKey || e.evt.ctrlKey || e.evt.metaKey) {
        const { selection } = useUIStore.getState()
        if (selection.type === 'endpoint' && selection.ids.includes(endpoint.id)) {
          const newIds = selection.ids.filter((id) => id !== endpoint.id)
          if (newIds.length === 0) {
            useUIStore.getState().clearSelection()
          } else {
            setSelection({ type: 'endpoint', ids: newIds })
          }
        }
      } else {
        setSelection({ type: 'endpoint', ids: [endpoint.id] })
      }
    },
    [endpoint.id, setSelection]
  )

  // Selected by endpoint id (1‑wire, drag rect, …) or by sitplan placement id (multiplied symbols)
  const isHoveredAny = isHovered || isHoveredFromBreadcrumb
  const multiplier = endpointSupportsMultiplier(endpoint) ? getEndpointMultiplier(endpoint) : 1
  // Copies fan out from the endpoint anchor; center hit and selection bounds on their group.
  const multiSocketGroupOffsetX = (mirrorHorizontally ? -1 : 1) * (socketExtraWidth / 2)
  const multiSocketLabelOffsetX = multiSocketGroupOffsetX
  const bottomLabelMinimumLeftXForGroup =
    bottomLabelMinimumLeftX == null ? undefined : bottomLabelMinimumLeftX - multiSocketLabelOffsetX
  const bottomLabelMaximumRightXForGroup =
    bottomLabelMaximumRightX == null
      ? undefined
      : bottomLabelMaximumRightX - multiSocketLabelOffsetX
  const modularSocketFrameWidth = SYMBOL_SIZE + socketExtraWidth + 4
  const modularSocketFrameCenterX = multiSocketGroupOffsetX
  const modularSocketFrameLeft = modularSocketFrameCenterX - modularSocketFrameWidth / 2
  const modularSocketFrameTop = -SYMBOL_SIZE / 2 - 2
  const modularSocketFrameBottom = SYMBOL_SIZE / 2 + 5

  const standardHitRect = useMemo(() => {
    const base = {
      x: multiSocketGroupOffsetX - (ENDPOINT_OUTLINE_SIZE + socketExtraWidth) / 2,
      y: -ENDPOINT_OUTLINE_SIZE / 2,
      width: ENDPOINT_OUTLINE_SIZE + totalExtraWidth,
      height: ENDPOINT_OUTLINE_SIZE,
    }
    return applyTouchHitPadding(base, canvasZoom, isSelected, touchPrimary)
  }, [
    canvasZoom,
    isSelected,
    multiSocketGroupOffsetX,
    socketExtraWidth,
    touchPrimary,
    totalExtraWidth,
  ])
  const isDcBusConverterResizeEnabled =
    circuitConverterAnchor != null &&
    (endpoint.symbol === 'dc_dc_converter' || endpoint.symbol === 'inverter')
  const converterConnectionCount = clampConverterDcConnectionCount(
    endpoint.energyConversionProps?.dcConnectionCount ?? 1
  )
  const currentConverterWidth = converterConnectionCount * SYMBOL_SIZE
  const previewConverterWidth =
    (converterResizePreviewCount ?? converterConnectionCount) * SYMBOL_SIZE
  const converterFixedEdge =
    converterGrowthDirection === 'left' ? currentConverterWidth / 2 : -currentConverterWidth / 2
  const converterResizeEdge =
    converterGrowthDirection === 'left'
      ? converterFixedEdge - previewConverterWidth
      : converterFixedEdge + previewConverterWidth
  const converterResizeDirectionSign = converterGrowthDirection === 'left' ? -1 : 1
  const converterResizeHandleEdge =
    converterResizeEdge + converterResizeDirectionSign * CONVERTER_RESIZE_OUTLINE_PADDING
  const domoticaEndpointCount = Math.max(
    DOMOTICA_MIN_ENDPOINT_OUTPUTS,
    Math.min(
      DOMOTICA_MAX_ENDPOINT_OUTPUTS,
      Math.trunc(domoticaProps?.endpointCount ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS)
    )
  )
  const domoticaHeight =
    DOMOTICA_BASE_HEIGHT + Math.max(0, domoticaEndpointCount - 1) * DOMOTICA_OUTPUT_SPACING
  const isDomoticaResizeEnabled = isDomoticaParent && !isDomoticaEndpointOnDcBus(endpoint.id)
  const domoticaFixedBottom = domoticaHeight / 2
  const domoticaResizePreviewHeight =
    DOMOTICA_BASE_HEIGHT +
    Math.max(0, (domoticaResizePreviewCount ?? domoticaEndpointCount) - 1) * DOMOTICA_OUTPUT_SPACING
  const domoticaResizeHandleEdge =
    domoticaFixedBottom - domoticaResizePreviewHeight - DOMOTICA_RESIZE_OUTLINE_PADDING

  useEffect(() => {
    const committedCount = domoticaResizeCommitCountRef.current
    const bottomAnchor = domoticaBottomAnchorRef.current
    if (
      committedCount == null ||
      domoticaEndpointCount !== committedCount ||
      bottomAnchor == null
    ) {
      return
    }

    const layoutBottom = position.y + domoticaHeight / 2
    if (Math.abs(layoutBottom - bottomAnchor) > 0.5) return

    domoticaResizeCommitCountRef.current = null
    setDomoticaResizePreviewCount(null)
  }, [domoticaEndpointCount, domoticaHeight, position.y])

  const domoticaLayoutBottom = position.y + domoticaHeight / 2
  if (domoticaResizeCommitCountRef.current == null) {
    domoticaBottomAnchorRef.current = domoticaLayoutBottom
  }
  const domoticaBottomAnchor = domoticaBottomAnchorRef.current ?? domoticaLayoutBottom
  const domoticaGroupY = domoticaBottomAnchor - domoticaHeight / 2
  const converterIconSize = SYMBOL_SIZE * CONVERTER_DOMAIN_ICON_SIZE_RATIO
  const converterIconMargin = 2
  const converterImagePosition = (domain: 'AC' | 'DC') => {
    const corner = converterArtworkLayout
      ? getConverterDomainCorner(converterArtworkLayout, domain)
      : undefined
    if (!corner) return undefined
    return getConverterCornerPosition(
      corner,
      SYMBOL_SIZE,
      SYMBOL_SIZE,
      converterIconMargin,
      converterIconSize
    )
  }
  const converterAcPosition = converterImagePosition('AC')
  const converterDcPosition = converterImagePosition('DC')

  if (!symbol) return null
  if (!processedImage && !isDomoticaParent) return null

  if (isDomoticaParent) {
    const strokeColor = getSymbolColor(theme?.mode === 'dark')
    // Keep the bottom edge fixed at the same place as a normal endpoint (height = DOMOTICA_BASE_HEIGHT)
    // and let additional rows grow upwards.
    const outlineX = 0
    const outlineY = -domoticaHeight / 2
    const outlineWidth = DOMOTICA_BOX_WIDTH
    const outlineHeight = domoticaHeight
    // Outline rect is slightly larger than the box, with rounded corners
    const outlinePad = 2
    const controlBandHeight = Math.min(DOMOTICA_CONTROL_BAR_HEIGHT, domoticaHeight / 2)
    const dividerY = outlineY + controlBandHeight

    const domoticaControlKeys = new Set<DomoticaControlKey>(domoticaProps?.control ?? [])
    const mainDeviceSize = SYMBOL_SIZE * 0.75
    const domoticaHitRect = applyTouchHitPadding(
      { x: outlineX, y: outlineY - 2, width: outlineWidth, height: outlineHeight + 4 },
      canvasZoom,
      isSelected,
      touchPrimary
    )
    return (
      <Group
        name={`endpoint-${endpoint.id}`}
        x={position.x - DOMOTICA_BOX_WIDTH / 2}
        y={domoticaGroupY}
        draggable={draggable}
        onDragStart={
          draggable && onDragStart
            ? (e) => {
                const evt = e.evt as MouseEvent
                if (onDragStart(!!evt.altKey, evt)) {
                  e.target.stopDrag()
                  e.target.position({ x: position.x - DOMOTICA_BOX_WIDTH / 2, y: position.y })
                }
              }
            : undefined
        }
        onDragEnd={
          draggable
            ? (e) => {
                if (shouldSuppressKonvaDragEnd?.()) {
                  e.target.position({ x: position.x - DOMOTICA_BOX_WIDTH / 2, y: position.y })
                  return
                }
                const accepted = onDragEnd(
                  getCanvasPositionFromEvent?.(e) ?? { x: e.target.x(), y: e.target.y() }
                )
                if (accepted === false) {
                  e.target.position({ x: position.x - DOMOTICA_BOX_WIDTH / 2, y: position.y })
                }
              }
            : undefined
        }
        onClick={handleClick}
        onTap={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <Rect {...domoticaHitRect} fill={INTERACTIVE_HIT_FILL} listening={true} />
        <Rect
          x={outlineX}
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
              outlineX,
              outlineY,
              outlineWidth,
              outlineHeight,
              outlinePad
            )}
          />
        )}
        {isHoveredAny && !isSelected && !isPreviewSelected && (
          <Rect
            {...getPaddedRectHoverOutlineProps(
              canvasZoom,
              outlineX,
              outlineY,
              outlineWidth,
              outlineHeight,
              outlinePad
            )}
          />
        )}
        {isSelected && (
          <Rect
            {...getPaddedRectSelectionOutlineProps(
              canvasZoom,
              outlineX,
              outlineY,
              outlineWidth,
              outlineHeight,
              outlinePad
            )}
          />
        )}
        {isSelected && isDomoticaResizeEnabled && (
          <>
            {domoticaResizePreviewCount != null &&
              domoticaResizePreviewCount !== domoticaEndpointCount && (
                <Rect
                  x={outlineX}
                  y={domoticaFixedBottom - domoticaResizePreviewHeight}
                  width={outlineWidth}
                  height={domoticaResizePreviewHeight}
                  stroke="#0284c7"
                  strokeWidth={1}
                  dash={[3, 2]}
                  listening={false}
                />
              )}
            <Rect
              x={outlineX}
              y={domoticaResizeHandleEdge - DOMOTICA_RESIZE_HANDLE_HIT_HEIGHT / 2}
              width={outlineWidth}
              height={DOMOTICA_RESIZE_HANDLE_HIT_HEIGHT}
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
                domoticaResizeCommitCountRef.current = null
                domoticaResizeCountRef.current = domoticaEndpointCount
                setDomoticaResizePreviewCount(domoticaEndpointCount)
              }}
              onDragMove={(event) => {
                event.cancelBubble = true
                const handleCenter = event.target.y() + DOMOTICA_RESIZE_HANDLE_HIT_HEIGHT / 2
                const bodyTopAtPointer = handleCenter + DOMOTICA_RESIZE_OUTLINE_PADDING
                const requestedHeight = domoticaFixedBottom - bodyTopAtPointer
                const nextCount = clampDomoticaEndpointCount(
                  (requestedHeight - DOMOTICA_BASE_HEIGHT) / DOMOTICA_OUTPUT_SPACING + 1
                )
                domoticaResizeCountRef.current = nextCount
                setDomoticaResizePreviewCount(nextCount)
                const snappedHeight =
                  DOMOTICA_BASE_HEIGHT + Math.max(0, nextCount - 1) * DOMOTICA_OUTPUT_SPACING
                const snappedHandleEdge =
                  domoticaFixedBottom - snappedHeight - DOMOTICA_RESIZE_OUTLINE_PADDING
                event.target.y(snappedHandleEdge - DOMOTICA_RESIZE_HANDLE_HIT_HEIGHT / 2)
                event.target.x(outlineX)
              }}
              onDragEnd={(event) => {
                event.cancelBubble = true
                const nextCount = domoticaResizeCountRef.current ?? domoticaEndpointCount
                domoticaResizeCountRef.current = null
                if (nextCount !== domoticaEndpointCount) {
                  domoticaResizeCommitCountRef.current = nextCount
                  setDomoticaResizePreviewCount(nextCount)
                  if (!resizeDomoticaEndpointCount(endpoint.id, nextCount)) {
                    domoticaResizeCommitCountRef.current = null
                    setDomoticaResizePreviewCount(null)
                  }
                } else {
                  setDomoticaResizePreviewCount(null)
                }
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
        {/* Horizontal divider between control band and main device area */}
        <Line
          points={[outlineX, dividerY, outlineX + DOMOTICA_BOX_WIDTH, dividerY]}
          stroke={strokeColor}
          strokeWidth={0.6}
          listening={false}
        />

        {/* Control icons (top band) */}
        {(() => {
          const activeKeys = (Array.from(domoticaControlKeys) as DomoticaControlKey[]).filter(
            (key) =>
              [
                'programmed_control',
                'wireless_control',
                'detection_control',
                'button_control',
              ].includes(key)
          ) as Array<keyof typeof DOMOTICA_CONTROL_OVERLAY_PATHS>
          const count = activeKeys.length
          if (count === 0) return null
          return activeKeys.map((key, index) => {
            const cx = outlineX + (DOMOTICA_BOX_WIDTH * (index + 1)) / (count + 1)
            const cy = outlineY + controlBandHeight / 2
            const image = domoticaControlImages[key]
            if (!image) return null
            return (
              <Image
                key={key}
                image={image}
                width={SYMBOL_SIZE * 0.3}
                height={SYMBOL_SIZE * 0.3}
                offsetX={(SYMBOL_SIZE * 0.3) / 2}
                offsetY={(SYMBOL_SIZE * 0.3) / 2}
                x={cx}
                y={cy}
                listening={false}
              />
            )
          })
        })()}

        {/* Main device symbol (lower section, centered, same scale as regular symbols) */}

        {domoticaMainImage && domoticaMainType && (
          <Image
            image={domoticaMainImage}
            width={mainDeviceSize}
            height={mainDeviceSize}
            offsetX={mainDeviceSize / 2}
            offsetY={mainDeviceSize / 2}
            x={outlineX + DOMOTICA_BOX_WIDTH / 2}
            y={dividerY + (domoticaHeight - controlBandHeight) / 2}
            listening={false}
          />
        )}
        {isSelected && isDomoticaResizeEnabled && (
          <Rect
            x={outlineX}
            y={domoticaResizeHandleEdge - DOMOTICA_RESIZE_HANDLE_WIDTH / 2}
            width={outlineWidth}
            height={DOMOTICA_RESIZE_HANDLE_WIDTH}
            fill="#0284c7"
            opacity={0.9}
            cornerRadius={2}
            listening={false}
          />
        )}
      </Group>
    )
  }

  if (suppressWhenSelected && isSinglySelectedEndpoint) return null

  return (
    <Group
      name={`endpoint-${endpoint.id}`}
      x={position.x}
      y={position.y}
      // Only allow dragging when explicitly enabled *and* this endpoint is selected.
      draggable={draggable && isSelected}
      onDragStart={
        draggable && isSelected && onDragStart
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
        draggable && isSelected && onDragMove
          ? (e) => {
              onDragMove(getCanvasPositionFromEvent?.(e) ?? { x: e.target.x(), y: e.target.y() })
            }
          : undefined
      }
      onDragEnd={
        draggable && isSelected
          ? (e) => {
              if (shouldSuppressKonvaDragEnd?.()) {
                e.target.position({ x: position.x, y: position.y })
                return
              }
              const accepted = onDragEnd(
                getCanvasPositionFromEvent?.(e) ?? { x: e.target.x(), y: e.target.y() }
              )
              // If drop was rejected (no valid target), snap the symbol back to its
              // original layout-driven position so the real symbol never "sticks"
              // at an illegal location.
              if (accepted === false) {
                e.target.position({ x: position.x, y: position.y })
              }
            }
          : undefined
      }
      onClick={handleClick}
      onTap={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Invisible hit area - matches outline size for hover detection, grows for multi-socket */}
      <Rect {...standardHitRect} fill={INTERACTIVE_HIT_FILL} listening={true} />

      {isModularSocket && (
        <Line
          name="eendraad-modular-socket-frame"
          points={[
            modularSocketFrameLeft,
            modularSocketFrameTop,
            modularSocketFrameLeft + modularSocketFrameWidth,
            modularSocketFrameTop,
            modularSocketFrameLeft + modularSocketFrameWidth,
            modularSocketFrameBottom,
            modularSocketFrameLeft,
            modularSocketFrameBottom,
          ]}
          closed
          stroke={getSymbolColor(theme?.mode === 'dark')}
          strokeWidth={0.75}
          lineJoin="miter"
          perfectDrawEnabled={false}
          listening={false}
        />
      )}
      {isModularSocket && (
        <Line
          name="eendraad-modular-socket-footer"
          points={[
            modularSocketFrameLeft + 0.75,
            modularSocketFrameBottom - 3,
            modularSocketFrameLeft + modularSocketFrameWidth - 0.75,
            modularSocketFrameBottom - 3,
          ]}
          stroke={getSymbolColor(theme?.mode === 'dark')}
          strokeWidth={0.65}
          perfectDrawEnabled={false}
          listening={false}
        />
      )}

      {/* Render socket symbols (1-4 copies offset to the right) */}
      {processedImage &&
        Array.from({ length: socketCount }, (_, i) => (
          <Group key={i} x={(mirrorHorizontally ? -1 : 1) * i * MULTI_SOCKET_OFFSET}>
            {isDirectionalConverter ? (
              <>
                <Image
                  image={processedImage}
                  {...{ [SYMBOL_EXPORT_ATTR_SVG_PATH]: CONVERTER_ARTWORK_PATHS.base }}
                  width={SYMBOL_SIZE}
                  height={SYMBOL_SIZE}
                  offsetX={SYMBOL_SIZE / 2}
                  offsetY={SYMBOL_SIZE / 2}
                  y={0}
                  listening={false}
                />
                {converterDiagonalImage && converterArtworkLayout && (
                  <Image
                    image={converterDiagonalImage}
                    {...{ [SYMBOL_EXPORT_ATTR_SVG_PATH]: CONVERTER_ARTWORK_PATHS.diagonal }}
                    width={SYMBOL_SIZE}
                    height={SYMBOL_SIZE}
                    offsetX={SYMBOL_SIZE / 2}
                    offsetY={SYMBOL_SIZE / 2}
                    scaleX={converterArtworkLayout.diagonal === 'top-left-to-bottom-right' ? -1 : 1}
                    y={0}
                    listening={false}
                  />
                )}
                {converterAcImage && converterAcPosition && (
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
                {converterDcImage && converterDcPosition && (
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
              </>
            ) : (
              <Image
                image={processedImage}
                {...{ [SYMBOL_EXPORT_ATTR_SVG_PATH]: baseSvgPath }}
                width={SYMBOL_SIZE}
                height={SYMBOL_SIZE}
                offsetX={SYMBOL_SIZE / 2}
                offsetY={SYMBOL_SIZE / 2}
                scaleX={mirrorHorizontally ? -1 : 1}
                y={0}
                listening={false}
              />
            )}
            {/* Relay control overlay */}
            {endpoint.symbol === 'relay' && relayOverlayImage && (
              <Image
                image={relayOverlayImage}
                width={SYMBOL_SIZE}
                height={SYMBOL_SIZE}
                offsetX={SYMBOL_SIZE / 2}
                offsetY={SYMBOL_SIZE / 2}
                y={0}
                listening={false}
              />
            )}
            {/* Smoke / fire detector overlay */}
            {endpoint.symbol === 'smoke_detector' && smokeDetectorOverlayImage && (
              <Image
                image={smokeDetectorOverlayImage}
                width={SYMBOL_SIZE}
                height={SYMBOL_SIZE}
                offsetX={SYMBOL_SIZE / 2}
                offsetY={SYMBOL_SIZE / 2}
                y={0}
                listening={false}
              />
            )}
            {overlaySwitchImage && (
              <Image
                image={overlaySwitchImage}
                width={SYMBOL_SIZE}
                height={SYMBOL_SIZE}
                offsetX={SYMBOL_SIZE / 2}
                offsetY={SYMBOL_SIZE / 2}
                y={0}
                listening={false}
              />
            )}
            {overlaySwitchLockImage && (
              <Image
                image={overlaySwitchLockImage}
                width={SYMBOL_SIZE}
                height={SYMBOL_SIZE}
                offsetX={SYMBOL_SIZE / 2}
                offsetY={SYMBOL_SIZE / 2}
                y={0}
                listening={false}
              />
            )}
            {switchOverlayImage && (
              <Image
                image={switchOverlayImage}
                width={SYMBOL_SIZE}
                height={SYMBOL_SIZE}
                offsetX={SYMBOL_SIZE / 2}
                offsetY={SYMBOL_SIZE / 2}
                y={0}
                listening={false}
              />
            )}
            {/* Light point overlays: safety, switch 1p */}
            {isLightPoint && lightPointSafetyImage && (
              <Image
                image={lightPointSafetyImage}
                width={SYMBOL_SIZE}
                height={SYMBOL_SIZE}
                offsetX={SYMBOL_SIZE / 2}
                offsetY={SYMBOL_SIZE / 2}
                y={0}
                listening={false}
              />
            )}
            {isLightPoint && lightPointDecentralImage && (
              <Image
                image={lightPointDecentralImage}
                width={SYMBOL_SIZE}
                height={SYMBOL_SIZE}
                offsetX={SYMBOL_SIZE / 2}
                offsetY={SYMBOL_SIZE / 2}
                y={0}
                listening={false}
              />
            )}
            {isLightPoint && lightPointSwitchImage && (
              <Image
                image={lightPointSwitchImage}
                width={SYMBOL_SIZE}
                height={SYMBOL_SIZE}
                offsetX={SYMBOL_SIZE / 2}
                offsetY={SYMBOL_SIZE / 2}
                y={0}
                listening={false}
              />
            )}
            {/* Light point: on wall – line to the right (eendraad only) */}
            {isLightPoint &&
              lightPointProps?.onWall &&
              (() => {
                const gap = 2
                const halfHeight = SYMBOL_SIZE / 2 + 1
                const xStart = SYMBOL_SIZE / 2 + gap
                return (
                  <Line
                    points={[xStart, -halfHeight, xStart, halfHeight]}
                    stroke={getSymbolColor(theme?.mode === 'dark')}
                    strokeWidth={1}
                    listening={false}
                  />
                )
              })()}
            {/* Light fluorescent: dynamic tube lines (1 = centered, 2 = over 25% height, 3 = even) */}
            {isLightFluorescent &&
              (() => {
                const tubeMarginX = 0.5
                const halfSpan = SYMBOL_SIZE / 2 - tubeMarginX
                const strokeColor = getSymbolColor(theme?.mode === 'dark')
                const tubeStrokeWidth = 1
                let yPositions: number[]
                if (tubeCount === 1) {
                  yPositions = [0]
                } else if (tubeCount === 2) {
                  const bandHeight = SYMBOL_SIZE * 0.2
                  yPositions = [-bandHeight / 2, bandHeight / 2]
                } else {
                  const step = SYMBOL_SIZE / 8
                  yPositions = [-step, 0, step]
                }
                return yPositions.map((y, idx) => (
                  <Line
                    key={idx}
                    points={[-halfSpan, y, halfSpan, y]}
                    stroke={strokeColor}
                    strokeWidth={tubeStrokeWidth}
                    listening={false}
                  />
                ))
              })()}
            {/* Light spot: beam overlay */}
            {isLightSpot && lightSpotBeamImage && (
              <Image
                image={lightSpotBeamImage}
                width={SYMBOL_SIZE}
                height={SYMBOL_SIZE}
                offsetX={SYMBOL_SIZE / 2}
                offsetY={SYMBOL_SIZE / 2}
                y={0}
                listening={false}
              />
            )}

            {/* Transformer overlays */}
            {isTransformer && transformerSafetyImage && (
              <Image
                image={transformerSafetyImage}
                width={SYMBOL_SIZE}
                height={SYMBOL_SIZE}
                offsetX={SYMBOL_SIZE / 2}
                offsetY={SYMBOL_SIZE / 2}
                y={0}
                listening={false}
              />
            )}
            {isTransformer && transformerShortcircuitImage && (
              <Image
                image={transformerShortcircuitImage}
                width={SYMBOL_SIZE}
                height={SYMBOL_SIZE}
                offsetX={SYMBOL_SIZE / 2}
                offsetY={SYMBOL_SIZE / 2}
                y={0}
                listening={false}
              />
            )}
            {isTransformer && transformerProtectionImage && (
              <Image
                image={transformerProtectionImage}
                width={SYMBOL_SIZE}
                height={SYMBOL_SIZE}
                offsetX={SYMBOL_SIZE / 2}
                offsetY={SYMBOL_SIZE / 2}
                y={0}
                listening={false}
              />
            )}

            {/* HVAC overlays: type (center), energy + function on bottom */}
            {isHvac && (
              <>
                {/* Type overlay (centered, with small upward offset for heat exchange) */}
                {hvacTypeImage && (
                  <Image
                    image={hvacTypeImage}
                    width={SYMBOL_SIZE}
                    height={SYMBOL_SIZE}
                    offsetX={SYMBOL_SIZE / 2}
                    offsetY={SYMBOL_SIZE / 2}
                    y={hvacTypeKey === 'heat_exchange' ? HVAC_HEAT_EXCHANGE_TYPE_OFFSET_Y : 0}
                    listening={false}
                  />
                )}
                {(() => {
                  const hasEnergy = !!hvacEnergyImage && hvacEnergyKey !== 'none'
                  const hasFunction = hvacFunctionKey !== 'none'
                  if (!hasEnergy && !hasFunction) return null

                  const baseY = SYMBOL_SIZE * HVAC_ENERGY_OFFSET_Y_FACTOR
                  const xOffset = SYMBOL_SIZE * HVAC_FUNCTION_OFFSET_X_FACTOR
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

                  // Center text visually over funcX: single char vs "+/-"
                  const funcXAdjust =
                    funcText === '+/-'
                      ? -SYMBOL_SIZE * 0.07
                      : funcText.length === 1
                        ? SYMBOL_SIZE * 0.02
                        : 0

                  return (
                    <>
                      {hasEnergy && hvacEnergyImage && (
                        <Image
                          image={hvacEnergyImage}
                          width={SYMBOL_SIZE}
                          height={SYMBOL_SIZE}
                          offsetX={SYMBOL_SIZE / 2}
                          offsetY={SYMBOL_SIZE / 2}
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
                          fontSize={4}
                          fontFamily={fontFamily}
                          fill={getSymbolColor(theme?.mode === 'dark')}
                          align="center"
                          listening={false}
                        />
                      )}
                    </>
                  )
                })()}
              </>
            )}
          </Group>
        ))}
      {/* Conversion + endpoint notes: one label block for the whole multi-socket group. */}
      {renderMetadataCallout && metadataCallout && !metadataLabelSuppressed && (
        <EndpointMetadataCallout
          endpoint={endpoint}
          position={{ x: 0, y: 0 }}
          metadataCallout={metadataCallout}
        />
      )}
      {symbolSideLabelItems.length > 0 && !metadataCallout && !metadataLabelSuppressed && (
        <Group x={multiSocketLabelOffsetX}>
          <SymbolTextLabels
            items={symbolSideLabelItems.map((part) => ({ key: part.key, text: part.text }))}
            config={{ position: endpointLabelPosition, layout: 'stack' }}
            sideLabelBlockAlign={endpointLabelPosition === 'right' ? 'center' : 'auto'}
            textColor={getSecondaryTextColor(theme?.mode === 'dark')}
            fontFamily={fontFamily}
            fontSize={8}
            symbolSize={SYMBOL_SIZE}
            bottomMinimumLeftX={
              endpointLabelPosition === 'bottom' ? bottomLabelMinimumLeftXForGroup : undefined
            }
            bottomMaximumRightX={
              endpointLabelPosition === 'bottom' ? bottomLabelMaximumRightXForGroup : undefined
            }
          />
        </Group>
      )}
      {isSharedJunctionSymbol(endpoint.symbol) &&
        isSymbolLabelVisible(
          endpoint.symbolLabelDisplay,
          'junctionIdentityLabel',
          isJunctionIdentityVisibleByDefault(endpoint.symbol)
        ) && (
          <SymbolTextLabels
            items={[
              {
                key: 'junctionIdentityLabel',
                text: getJunctionIdentityDisplay(
                  endpoint.symbol,
                  getJunctionIdentity(endpoint),
                  endpoint.terminalStripPin
                ),
              },
            ]}
            config={{
              position: endpoint.symbol === 'terminal_strip' ? 'bottom' : 'right',
              layout: 'stack',
            }}
            textColor={getSecondaryTextColor(theme?.mode === 'dark')}
            fontFamily={fontFamily}
            fontSize={10}
            symbolSize={SYMBOL_SIZE}
            bottomMinimumLeftX={
              endpoint.symbol === 'terminal_strip' ? bottomLabelMinimumLeftXForGroup : undefined
            }
            bottomMaximumRightX={
              endpoint.symbol === 'terminal_strip' ? bottomLabelMaximumRightXForGroup : undefined
            }
          />
        )}
      {showSocketWaterproof && (
        <Text
          text="h"
          x={SYMBOL_SIZE / 2 - SOCKET_WATERPROOF_H_OFFSET_RIGHT + socketExtraWidth}
          y={-SYMBOL_SIZE / 4 + SOCKET_WATERPROOF_H_OFFSET_TOP}
          fontSize={SOCKET_WATERPROOF_H_FONT_SIZE}
          fontFamily={fontFamily}
          fill={getSymbolColor(theme?.mode === 'dark')}
          align="right"
          listening={false}
        />
      )}
      {showLightPointWaterproof && (
        <Text
          text="h"
          x={socketExtraWidth + onWallExtraWidth}
          y={-SYMBOL_SIZE / 4 + LIGHT_POINT_WATERPROOF_H_OFFSET_TOP}
          fontSize={SOCKET_WATERPROOF_H_FONT_SIZE}
          fontFamily={fontFamily}
          fill={getSymbolColor(theme?.mode === 'dark')}
          align="center"
          listening={false}
        />
      )}
      {multiplier > 1 && (
        <MultiplierBadge
          count={multiplier}
          anchorX={SYMBOL_SIZE / 2 + (mirrorHorizontally ? 0 : socketExtraWidth)}
          anchorY={-SYMBOL_SIZE / 2}
          fontFamily={fontFamily}
          fill={getSymbolColor(theme?.mode === 'dark')}
          onActivate={() => openAddMoreDialogForEndpoint(endpoint, t)}
        />
      )}
      {/* Preview highlight (during selection rectangle drag) — grows for multi-socket */}
      {isPreviewSelected && !isSelected && (
        <Group x={multiSocketGroupOffsetX} listening={false}>
          <Rect
            {...getEndpointPreviewOutlineProps(
              canvasZoom,
              ENDPOINT_OUTLINE_SIZE + totalExtraWidth,
              ENDPOINT_OUTLINE_SIZE
            )}
          />
        </Group>
      )}
      {/* Hover highlight (from breadcrumb or mouse) — grows for multi-socket */}
      {isHoveredAny && !isSelected && !isPreviewSelected && (
        <Group x={multiSocketGroupOffsetX} listening={false}>
          <Rect
            {...getEndpointHoverOutlineProps(
              canvasZoom,
              ENDPOINT_OUTLINE_SIZE + totalExtraWidth,
              ENDPOINT_OUTLINE_SIZE
            )}
          />
        </Group>
      )}
      {/* Selection outline — grows for multi-socket */}
      {isSelected && (
        <Group x={multiSocketGroupOffsetX} listening={false}>
          <Rect
            {...getEndpointSelectionOutlineProps(
              canvasZoom,
              ENDPOINT_OUTLINE_SIZE + totalExtraWidth,
              ENDPOINT_OUTLINE_SIZE
            )}
          />
        </Group>
      )}
      {isSelected && isDcBusConverterResizeEnabled && (
        <>
          {converterResizePreviewCount != null &&
            converterResizePreviewCount !== converterConnectionCount && (
              <Rect
                x={
                  converterGrowthDirection === 'left'
                    ? converterFixedEdge - previewConverterWidth
                    : converterFixedEdge
                }
                y={-SYMBOL_SIZE / 2}
                width={previewConverterWidth}
                height={SYMBOL_SIZE}
                stroke="#0284c7"
                strokeWidth={1}
                dash={[3, 2]}
                listening={false}
              />
            )}
          <Rect
            x={converterResizeHandleEdge - CONVERTER_RESIZE_HANDLE_HIT_WIDTH / 2}
            y={-SYMBOL_SIZE / 2}
            width={CONVERTER_RESIZE_HANDLE_HIT_WIDTH}
            height={SYMBOL_SIZE}
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
              converterResizeCountRef.current = converterConnectionCount
              setConverterResizePreviewCount(converterConnectionCount)
            }}
            onDragMove={(event) => {
              event.cancelBubble = true
              const handleCenter = event.target.x() + CONVERTER_RESIZE_HANDLE_HIT_WIDTH / 2
              const bodyEdgeAtPointer =
                handleCenter - converterResizeDirectionSign * CONVERTER_RESIZE_OUTLINE_PADDING
              const requestedWidth =
                converterGrowthDirection === 'left'
                  ? converterFixedEdge - bodyEdgeAtPointer
                  : bodyEdgeAtPointer - converterFixedEdge
              const nextCount = clampConverterDcConnectionCount(requestedWidth / SYMBOL_SIZE)
              converterResizeCountRef.current = nextCount
              setConverterResizePreviewCount(nextCount)
              const snappedWidth = nextCount * SYMBOL_SIZE
              const snappedEdge =
                converterGrowthDirection === 'left'
                  ? converterFixedEdge - snappedWidth
                  : converterFixedEdge + snappedWidth
              const snappedHandleEdge =
                snappedEdge + converterResizeDirectionSign * CONVERTER_RESIZE_OUTLINE_PADDING
              event.target.x(snappedHandleEdge - CONVERTER_RESIZE_HANDLE_HIT_WIDTH / 2)
              event.target.y(-SYMBOL_SIZE / 2)
            }}
            onDragEnd={(event) => {
              event.cancelBubble = true
              const nextCount = converterResizeCountRef.current ?? converterConnectionCount
              converterResizeCountRef.current = null
              setConverterResizePreviewCount(null)
              if (nextCount !== converterConnectionCount) {
                resizeConverterDcConnections(endpoint.id, nextCount)
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
      {isSelected && isDcBusConverterResizeEnabled && (
        <Rect
          x={converterResizeHandleEdge - CONVERTER_RESIZE_HANDLE_WIDTH / 2}
          y={-(SYMBOL_SIZE + 2) / 2}
          width={CONVERTER_RESIZE_HANDLE_WIDTH}
          height={SYMBOL_SIZE + 2}
          fill="#0284c7"
          opacity={0.9}
          cornerRadius={2}
          listening={false}
        />
      )}
      {/* Label removed - already shown on branch to the left */}
    </Group>
  )
})
