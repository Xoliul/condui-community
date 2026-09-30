import { selectProjectWireRuns, findWireRunForAnchor } from '@/lib/projectV2/wireRuns'
import { logger } from '@/lib/logger'
/**
 * Wire Segment Component
 *
 * Renders a selectable wire segment with properties
 */

import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Line, Group, Circle, Text as KonvaText } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useUIStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'
import { useThemeColors } from '@/lib/theme/hooks'
import { useIsPreviewSelected } from '@/contexts/SelectionPreviewContext'
import {
  useCanvasFontFamily,
  useEffectiveCanvasZoom,
  useIsWireSelected,
  useSetSelection,
} from '@/editions/community/communityHooks'
import type {
  Endpoint,
  Installation,
  ProtectionDevice,
  TrunkDevice,
  WireSegment,
} from '@/types/schema'
import { WireTextLabel } from '@/components/canvas/eendraad/WireTextLabel'
import { SELECTION_COLOR } from '@/components/canvas/eendraad/canvasSymbols'
import { INTERACTIVE_OVERLAY_EXPORT_NAME } from '@/lib/export/interactiveOverlayExport'
import {
  ZOOM_100,
  screenPxToCanvasUnits,
  HOVER_OUTLINE_DASH_PX,
  HOVER_OUTLINE_DASH_PX_MIN,
  HOVER_OUTLINE_DASH_PX_MAX,
  HOVER_OUTLINE_STROKE_PX,
  HOVER_OUTLINE_STROKE_PX_MIN,
  HOVER_OUTLINE_STROKE_PX_MAX,
  WIRE_SELECTION_EXTRA_PX,
  WIRE_SELECTION_EXTRA_PX_MIN,
  WIRE_SELECTION_EXTRA_PX_MAX,
} from '@/constants/canvasConstants'
import {
  isBusBarProtectionStubSegment,
  isFireClassLabelVisibleForSegment,
  isRouteIndicatorVisibleForSegment,
  isSupplyWireSegmentForLabel,
  isWireLabelVisibleForSegment,
  isWireLengthLabelVisibleForSegment,
} from '@/lib/wireLabelVisibility'
import { getWireLengthLabel } from '@/lib/wires/wireFingerprint'
import { getVerticalRouteIndicatorEndY } from '@/lib/wires/wireRouteIndicatorGeometry'
import { getDomainForSymbol, getSymbolById } from '@/lib/symbols'
import { DomainMarker } from '@/components/canvas/eendraad/DomainMarker'
import { CatalogSymbolImage } from '@/components/canvas/eendraad/CatalogSymbolImage'
import {
  WIRE_LABEL_DISTANCE_FROM_WIRE,
  WIRE_LABEL_FONT_SIZE,
  formatWireLabel,
  getWireFireClassLabel,
  getWireLabelAlignForSegment,
  getWireLabelOffsetAlongWire,
  getWireLabelOrientationForSegment,
  getSupplyWireLabelAnchor,
  getPhaseLabelTextLayout,
} from '@/lib/wireTextLabel'
import type { WireTranslateFn } from '@/lib/wires/wireFingerprint'
import { shouldShowDomainChangeMarker } from '@/lib/wires/domainChangeMarker'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import { getAllCircuits, getAllProtections } from '@/lib/eendraad/projectElectricalDomain'
import { collectAllGroundTrunkDevices } from '@/lib/eendraad/panelGround'
import type { ProjectV2 } from '@/types/projectV2'
import {
  getPhaseAssignmentLabel,
  getVisiblePhaseAssignmentLabel,
  isPhaseAssignmentLabelVisible,
} from '@/lib/wires/phaseAssignment'
import {
  BUS_FEED_MARKER_LABEL_Y,
  getBusFeedMarkerLabelLayout,
  getBusFeedMarkerPosition,
} from '@/lib/layout/busFeedMarkerGeometry'
import { panelHasModularChangeover } from '@/lib/panel/panelFeedOrganization'
import { orderWireSegmentsForRendering } from './wireRenderOrder'
import {
  isPrimaryWireSelection,
  wireSegmentSelectsBusSection,
} from '@/lib/wires/wireSelectionTarget'
import {
  getSupplyWireDecorationOwnerIds,
  hasStableSupplyWireDecorationIdentity,
} from '@/lib/wires/supplyWireDecoration'
import { getCircuitWireJunctions } from './wireJunctions'
import { localizeWireSegment } from './wireSegmentLocalCoordinates'

type WireSegmentPointerEvent = KonvaEventObject<MouseEvent | TouchEvent>

type WireRenderLookup = {
  endpoints: Map<string, Endpoint>
  protections: Map<string, ProtectionDevice>
  trunkDevices: Map<string, TrunkDevice>
  modularChangeoverPanels: Set<string>
  phaseSystem: Installation['nominalVoltage']['system'] | undefined
}

const wireRenderLookupCache = new WeakMap<ProjectV2, WireRenderLookup>()

function getWireRenderLookup(project: ProjectV2): WireRenderLookup {
  const cached = wireRenderLookupCache.get(project)
  if (cached) return cached

  const endpoints = new Map<string, Endpoint>()
  const protections = new Map<string, ProtectionDevice>()
  const trunkDevices = new Map<string, TrunkDevice>()
  const modularChangeoverPanels = new Set<string>()
  const panels = getProjectElectricalPanels(project)
  for (const rootPanel of panels) {
    for (const circuit of getAllCircuits(rootPanel)) {
      for (const endpoint of circuit.endpoints) endpoints.set(endpoint.id, endpoint)
      for (const device of circuit.trunkDevices ?? []) trunkDevices.set(device.id, device)
    }
    for (const protection of getAllProtections(rootPanel)) {
      protections.set(protection.id, protection)
    }
  }
  const installation = getProjectElectricalInstallation(project)
  for (const device of installation?.mainSupply?.supplyTrunkDevices ?? []) {
    trunkDevices.set(device.id, device)
  }
  for (const device of collectAllGroundTrunkDevices(panels, installation)) {
    trunkDevices.set(device.id, device)
  }
  for (const panel of panels) {
    if (panelHasModularChangeover(project, panel.id)) modularChangeoverPanels.add(panel.id)
  }

  const lookup = {
    endpoints,
    protections,
    trunkDevices,
    modularChangeoverPanels,
    phaseSystem: installation?.nominalVoltage.system,
  }
  wireRenderLookupCache.set(project, lookup)
  return lookup
}

/** E-shape line geometry for wall route (in-wall): vertical left, 3 horizontals right. Drawn once, reused above/below; on-wall = 180° rotation. */
const WALL_ROUTE_LINES: Array<[number, number, number, number]> = [
  [0, -6, 0, 6], // vertical
  [0, -6, 6, -6], // top horizontal
  [0, 0, 6, 0], // middle
  [0, 6, 6, 6], // bottom
]

interface WireSegmentProps {
  wireSegment: WireSegment
  onSelect?: (wireSegmentId: string) => void
  isSupplyDecorationOwner?: boolean
  hasModularChangeover?: boolean
  phaseSystem?: Installation['nominalVoltage']['system']
  fromTrunkDevice?: TrunkDevice
  fromEndpoint?: Endpoint
  targetProtectionType?: ProtectionDevice['type']
}

type EffectiveRoute = 'inWall' | 'onWall' | 'ground' | 'air' | undefined

function SupplyWireRouteIndicators({
  wireSegment,
  effectiveRoute,
  color,
}: {
  wireSegment: WireSegment
  effectiveRoute: EffectiveRoute
  color: string
}) {
  if (!wireSegment.inTube && !effectiveRoute) return null

  const isHorizontal = wireSegment.startPoint.y === wireSegment.endPoint.y
  const anchor = getSupplyWireLabelAnchor(wireSegment) ?? {
    x: (wireSegment.startPoint.x + wireSegment.endPoint.x) / 2,
    y: (wireSegment.startPoint.y + wireSegment.endPoint.y) / 2,
  }
  // Cable text is above a horizontal supply wire and to the right of a
  // vertical one. Keep route/tube glyphs on the quiet, opposite side.
  const groupX = isHorizontal ? anchor.x : wireSegment.startPoint.x - 8
  const groupY = isHorizontal ? anchor.y + 8 : anchor.y
  const hasBoth = wireSegment.inTube && effectiveRoute
  const isWallRoute = effectiveRoute === 'inWall' || effectiveRoute === 'onWall'
  const tubeX = effectiveRoute !== 'air' && !isWallRoute && hasBoth && isHorizontal ? -6 : 0
  const tubeY = effectiveRoute !== 'air' && !isWallRoute && hasBoth && !isHorizontal ? -6 : 0
  const routePositions =
    effectiveRoute === 'air'
      ? [
          {
            // The air-route circle is the one route marker that sits directly on
            // the conductor instead of beside the cable label.
            x: isHorizontal ? 0 : 8,
            y: isHorizontal ? -8 : 0,
          },
        ]
      : isWallRoute
        ? isHorizontal
          ? [
              { x: -14, y: 0 },
              { x: 14, y: 0 },
            ]
          : [
              { x: 0, y: -14 },
              { x: 0, y: 14 },
            ]
        : [
            {
              x: hasBoth && isHorizontal ? 6 : 0,
              y: hasBoth && !isHorizontal ? 6 : 0,
            },
          ]
  const thickness = 1.35

  const renderRouteGlyph = (x: number, y: number, key: number) => {
    if (effectiveRoute === 'air') {
      return (
        <Circle
          key={key}
          x={x}
          y={y}
          radius={3.5}
          stroke={color}
          strokeWidth={thickness}
          listening={false}
        />
      )
    }
    if (effectiveRoute === 'ground') {
      return (
        <Group key={key} x={x} y={y} listening={false}>
          <Line points={[-6, -4, 6, -4]} stroke={color} strokeWidth={thickness} lineCap="round" />
          <Line points={[-4, 0, 4, 0]} stroke={color} strokeWidth={thickness} lineCap="round" />
          <Line points={[-2, 4, 2, 4]} stroke={color} strokeWidth={thickness} lineCap="round" />
        </Group>
      )
    }
    if (effectiveRoute === 'inWall' || effectiveRoute === 'onWall') {
      return (
        <Group
          key={key}
          x={x}
          y={y}
          scaleX={0.72}
          scaleY={0.72}
          offsetX={3}
          rotation={(effectiveRoute === 'inWall' ? 0 : 180) + (isHorizontal ? -90 : 0)}
          listening={false}
        >
          {WALL_ROUTE_LINES.map((points, index) => (
            <Line
              key={index}
              points={points}
              stroke={color}
              strokeWidth={thickness}
              lineCap="round"
              listening={false}
            />
          ))}
        </Group>
      )
    }
    return null
  }

  return (
    <Group x={groupX} y={groupY} name="export-strip-label" listening={false}>
      {wireSegment.inTube ? (
        <Circle x={tubeX} y={tubeY} radius={3} stroke={color} strokeWidth={1} listening={false} />
      ) : null}
      {routePositions.map(({ x, y }, index) => renderRouteGlyph(x, y, index))}
    </Group>
  )
}

const LocalizedWireTextLabel = memo(function LocalizedWireTextLabel({
  wireSegment,
  wireLabelOffsetAlongWire,
  fontFamily,
  color,
  onLabelClick,
  onLabelMouseEnter,
  onLabelMouseLeave,
}: {
  wireSegment: WireSegment
  wireLabelOffsetAlongWire: number
  fontFamily: string
  color: string
  onLabelClick: (event: unknown) => void
  onLabelMouseEnter: () => void
  onLabelMouseLeave: () => void
}) {
  const { t } = useTranslation()
  const translateWire = t as unknown as WireTranslateFn
  const labelDistanceFromWire =
    WIRE_LABEL_DISTANCE_FROM_WIRE + (wireSegment.wireRoute === 'air' ? 2 : 0)

  return (
    <WireTextLabel
      text={formatWireLabel(wireSegment, {
        otherLabel: t('wires.other', 'Other'),
        batteryCableLabel: t('wires.batteryCable', 'Battery cable'),
      })}
      fireClassText={
        isFireClassLabelVisibleForSegment(wireSegment)
          ? getWireFireClassLabel(wireSegment.cable)
          : undefined
      }
      wireLengthText={
        isWireLengthLabelVisibleForSegment(wireSegment)
          ? getWireLengthLabel(wireSegment, translateWire)
          : undefined
      }
      startPoint={wireSegment.startPoint}
      endPoint={wireSegment.wireLabelBaseEndPoint ?? wireSegment.wireLabelEndPoint ?? wireSegment.endPoint}
      config={{
        orientation: getWireLabelOrientationForSegment(wireSegment),
        align: getWireLabelAlignForSegment(wireSegment),
        distanceFromWire: labelDistanceFromWire,
        offsetAlongWire: wireLabelOffsetAlongWire,
        labelAnchor: getSupplyWireLabelAnchor(wireSegment),
      }}
      fontSize={WIRE_LABEL_FONT_SIZE}
      fontFamily={fontFamily}
      color={color}
      onLabelClick={onLabelClick}
      onLabelMouseEnter={onLabelMouseEnter}
      onLabelMouseLeave={onLabelMouseLeave}
    />
  )
})

export const WireSegmentComponent = memo(function WireSegmentComponent({
  wireSegment,
  onSelect,
  isSupplyDecorationOwner = true,
  hasModularChangeover = false,
  phaseSystem,
  fromTrunkDevice,
  fromEndpoint,
  targetProtectionType,
}: WireSegmentProps) {
  const { t } = useTranslation()
  const setSelection = useSetSelection()
  const selectedAnchor = useUIStore(s => s.selection.wireAnchor ?? (s.selection.type === 'wire' ? s.selection.wireMetadata?.[0]?.wireAnchor : undefined))
  const selectedRunMember = useProjectStore(s => {
    if (!selectedAnchor || !s.currentProject) return false
    const run = findWireRunForAnchor(selectProjectWireRuns(s.currentProject), selectedAnchor)
    return Boolean(run && wireSegment.wireAnchors?.some(anchor => run.members.includes(anchor)))
  })
  const selectedById = useIsWireSelected(wireSegment.id)
  const isWireSelected = selectedById || selectedRunMember || Boolean(selectedAnchor && wireSegment.wireAnchors?.includes(selectedAnchor))
  const selectedBusSection = useUIStore((state) => state.selection.busSectionMetadata)
  const canvasZoom = useEffectiveCanvasZoom(ZOOM_100, 'eendraad')
  const isExporting = useUIStore((s) => s.isExporting)
  const colors = useThemeColors()
  const fontFamily = useCanvasFontFamily()
  const isPreviewSelected = useIsPreviewSelected('wire', wireSegment.id)
  const [isHovered, setIsHovered] = useState(false)

  // Determine line properties based on wire type
  const isBusBar = wireSegment.type === 'mainBus'
  const selectsBusSection = wireSegmentSelectsBusSection(wireSegment)
  const isSelected = isWireSelected || (selectsBusSection
    ? Boolean(
        isBusBar &&
        wireSegment.busSectionId &&
        selectedBusSection?.panelId === wireSegment.panelId &&
        selectedBusSection.busSectionId === wireSegment.busSectionId
      )
    : false)
  const isThick = wireSegment.type === 'trunk' || isBusBar
  const lineWidth = isThick ? 6 : 2
  // Supply and circuit runs both stop exactly at their derived endpoints. Busbars retain
  // rounded ends as a separate visual convention.
  const lineCap: 'butt' | 'round' = isBusBar ? 'round' : 'butt'
  const lineColor = colors.wireColor
  const busFeedMarkerPosition = getBusFeedMarkerPosition(wireSegment)
  const busFeedMarkerLabelLayout = getBusFeedMarkerLabelLayout(wireSegment)
  const busFeedMarkerLabel =
    wireSegment.busFeedKind === 'backup'
      ? hasModularChangeover
        ? t('feedOrganization.switchableBackupMarker', 'Backup/Grid')
        : t('feedOrganization.backupMarker', 'Backup')
      : t('feedOrganization.gridMarker', 'Grid')

  const selectedColor = colors.selectionColor
  const previewColor = colors.selectionColor
  const wireSelectionExtra = screenPxToCanvasUnits(
    canvasZoom,
    WIRE_SELECTION_EXTRA_PX,
    WIRE_SELECTION_EXTRA_PX_MIN,
    WIRE_SELECTION_EXTRA_PX_MAX
  )
  const wireSelectionStroke = lineWidth + wireSelectionExtra
  const wireHoverStroke = screenPxToCanvasUnits(
    canvasZoom,
    HOVER_OUTLINE_STROKE_PX,
    HOVER_OUTLINE_STROKE_PX_MIN,
    HOVER_OUTLINE_STROKE_PX_MAX
  )
  const wireHoverDash = screenPxToCanvasUnits(
    canvasZoom,
    HOVER_OUTLINE_DASH_PX,
    HOVER_OUTLINE_DASH_PX_MIN,
    HOVER_OUTLINE_DASH_PX_MAX
  )

  const wireMeta = useCallback(
    () => ({
      id: wireSegment.id,
      wireAnchor: wireSegment.wireAnchor,
      wireAnchors: wireSegment.wireAnchors,
      // Persist only segment kinds relevant for re-matching in properties.
      type: wireSegment.type === 'secondaryBus' ? 'mainBus' : wireSegment.type,
      domain: wireSegment.domain,
      circuitId: wireSegment.circuitId,
      panelId: wireSegment.panelId,
      isSupply:
        (wireSegment.type === 'vertical' &&
          !wireSegment.circuitId &&
          !wireSegment.fromElementType) ||
        !!wireSegment.isSupplyTrunk,
      isGround: wireSegment.fromElementType === 'ground',
      ...(wireSegment.supplyWireRole && { supplyWireRole: wireSegment.supplyWireRole }),
      ...(wireSegment.supplyFeedScope && { supplyFeedScope: wireSegment.supplyFeedScope }),
      ...(wireSegment.supplyAssemblyId && { supplyAssemblyId: wireSegment.supplyAssemblyId }),
      ...(wireSegment.supplyConnectionId && {
        supplyConnectionId: wireSegment.supplyConnectionId,
      }),
      ...(wireSegment.supplySectionKey && { supplySectionKey: wireSegment.supplySectionKey }),
      ...(wireSegment.isSupplyTrunk &&
        wireSegment.supplySegmentIndex !== undefined && {
          supplySegmentIndex: wireSegment.supplySegmentIndex,
        }),
      ...(wireSegment.circuitId && {
        fromElementType: wireSegment.fromElementType,
        fromElementId: wireSegment.fromElementId,
        toElementType: wireSegment.toElementType,
        toElementId: wireSegment.toElementId,
      }),
      ...(wireSegment.feederProtectionId && { feederProtectionId: wireSegment.feederProtectionId }),
      ...(wireSegment.showWireLabelOnBusStub && { showWireLabelOnBusStub: true as const }),
      ...(wireSegment.domoticaOutputGroup &&
        typeof wireSegment.domoticaOutputIndex === 'number' && {
          domoticaOutputGroup: wireSegment.domoticaOutputGroup,
          domoticaOutputIndex: wireSegment.domoticaOutputIndex,
        }),
    }),
    [
      wireSegment.id,
      wireSegment.wireAnchor,
      wireSegment.wireAnchors,
      wireSegment.type,
      wireSegment.domain,
      wireSegment.circuitId,
      wireSegment.panelId,
      wireSegment.isSupplyTrunk,
      wireSegment.supplyWireRole,
      wireSegment.supplyFeedScope,
      wireSegment.supplyAssemblyId,
      wireSegment.supplyConnectionId,
      wireSegment.supplySectionKey,
      wireSegment.supplySegmentIndex,
      wireSegment.fromElementType,
      wireSegment.fromElementId,
      wireSegment.toElementType,
      wireSegment.toElementId,
      wireSegment.feederProtectionId,
      wireSegment.domoticaOutputGroup,
      wireSegment.domoticaOutputIndex,
      wireSegment.showWireLabelOnBusStub,
    ]
  )

  const handleClick = useCallback(
    (e: unknown) => {
      const event = e as WireSegmentPointerEvent
      const button = 'button' in event.evt ? event.evt.button : undefined
      if (!isPrimaryWireSelection(button)) return

      if (selectsBusSection) {
        if (!wireSegment.busSectionId) return
        event.cancelBubble = true
        setSelection({
          type: 'busSection',
          wireMetadata: [wireMeta()],
          ids: [wireSegment.busSectionId],
          busSectionMetadata: {
            panelId: wireSegment.panelId,
            busSectionId: wireSegment.busSectionId,
          },
        })
        return
      }
      event.cancelBubble = true

      // Debug logging: inspect exact geometry & metadata for the clicked wire
      // to investigate layout issues (e.g. short stubs above trunk devices).
      // This only runs on user click, so it won't spam the console.

      const renderOrigin = event.currentTarget.findAncestor('.wire-segment-origin')?.position() ?? {
        x: 0,
        y: 0,
      }
      const absoluteStartPoint = {
        x: wireSegment.startPoint.x + renderOrigin.x,
        y: wireSegment.startPoint.y + renderOrigin.y,
      }
      const absoluteEndPoint = {
        x: wireSegment.endPoint.x + renderOrigin.x,
        y: wireSegment.endPoint.y + renderOrigin.y,
      }
      logger.info('[Eendraad Wire Debug]', {
        id: wireSegment.id,
        type: wireSegment.type,
        startPoint: absoluteStartPoint,
        endPoint: absoluteEndPoint,
        circuitId: wireSegment.circuitId,
        panelId: wireSegment.panelId,
        fromElementType: wireSegment.fromElementType,
        fromElementId: wireSegment.fromElementId,
        toElementType: wireSegment.toElementType,
        toElementId: wireSegment.toElementId,
        domain: wireSegment.domain,
        isSupplyTrunk: wireSegment.isSupplyTrunk,
        supplySegmentIndex: wireSegment.supplySegmentIndex,
      })
      logger.info('[Wire Selection Debug][manual click]', {
        id: wireSegment.id,
        type: wireSegment.type,
        domain: wireSegment.domain,
        circuitId: wireSegment.circuitId,
        panelId: wireSegment.panelId,
        fromElementType: wireSegment.fromElementType,
        fromElementId: wireSegment.fromElementId,
        toElementType: wireSegment.toElementType,
        toElementId: wireSegment.toElementId,
        startPoint: absoluteStartPoint,
        endPoint: absoluteEndPoint,
        selectionMetadata: wireMeta(),
      })

      if ('shiftKey' in event.evt && event.evt.shiftKey) {
        // Add to selection
        const { selection } = useUIStore.getState()
        if (selection.type === 'wire' && !selection.ids.includes(wireSegment.id)) {
          setSelection({
            type: 'wire',
            ids: [...selection.ids, wireSegment.id],
            wireMetadata: [...(selection.wireMetadata || []), wireMeta()],
          })
        } else if (selection.type !== 'wire') {
          setSelection({ type: 'wire', ids: [wireSegment.id], wireMetadata: [wireMeta()] })
        }
      } else if (
        ('altKey' in event.evt && event.evt.altKey) ||
        ('ctrlKey' in event.evt && event.evt.ctrlKey) ||
        ('metaKey' in event.evt && event.evt.metaKey)
      ) {
        // Remove from selection
        const { selection } = useUIStore.getState()
        if (selection.type === 'wire' && selection.ids.includes(wireSegment.id)) {
          const newIds = selection.ids.filter((id) => id !== wireSegment.id)
          if (newIds.length === 0) {
            useUIStore.getState().clearSelection()
          } else {
            setSelection({ type: 'wire', ids: newIds })
          }
        }
      } else {
        setSelection({ type: 'wire', ids: [wireSegment.id], wireMetadata: [wireMeta()] })
        if (onSelect) {
          onSelect(wireSegment.id)
        }
      }
    },
    [wireSegment, setSelection, onSelect, selectsBusSection, wireMeta]
  )

  const handleMouseEnter = useCallback(() => {
    if (!isBusBar || wireSegment.busSectionId) setIsHovered(true)
  }, [isBusBar, wireSegment.busSectionId])

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false)
  }, [])

  const wireLinePoints = [
    wireSegment.startPoint.x,
    wireSegment.startPoint.y,
    wireSegment.endPoint.x,
    wireSegment.endPoint.y,
  ]
  const showHoverHighlight = isHovered && !isSelected && !isPreviewSelected

  // Calculate hit area (expand for easier clicking)
  const hitAreaPadding = 5
  const isHorizontal = wireSegment.startPoint.y === wireSegment.endPoint.y
  const isVertical = wireSegment.startPoint.x === wireSegment.endPoint.x
  const isBusBarProtectionStub = isBusBarProtectionStubSegment(wireSegment)
  const isSupplyDecorationSegment = isSupplyWireSegmentForLabel(wireSegment)
  const ownsStableSupplyDecoration =
    !hasStableSupplyWireDecorationIdentity(wireSegment) || isSupplyDecorationOwner
  const isWireLabelVisible = ownsStableSupplyDecoration && isWireLabelVisibleForSegment(wireSegment)
  const wireLabelOffsetAlongWire = getWireLabelOffsetAlongWire(wireSegment)
  const showCableLabel = Boolean(
    (!isBusBarProtectionStub || wireSegment.showWireLabelOnBusStub) && isWireLabelVisible
  )
  const showSupplyRouteIndicators =
    isSupplyDecorationSegment &&
    ownsStableSupplyDecoration &&
    isRouteIndicatorVisibleForSegment(wireSegment)
  const showVerticalRouteIndicators =
    !isSupplyDecorationSegment && isRouteIndicatorVisibleForSegment(wireSegment)
  const secondaryBusReferenceLabel = wireSegment.secondaryBusReferenceLabel?.trim()
  const secondaryBusReferenceFontSize = 8
  const secondaryBusReferenceTextWidth = secondaryBusReferenceLabel
    ? Math.max(10, secondaryBusReferenceLabel.length * secondaryBusReferenceFontSize * 0.62)
    : 0
  const secondaryBusReferenceTextLeft = -secondaryBusReferenceTextWidth
  const secondaryBusReferenceTextCenterY = secondaryBusReferenceFontSize / 2
  const secondaryBusArrowRightX = secondaryBusReferenceTextLeft - 7
  const secondaryBusArrowTipX = secondaryBusArrowRightX - 22
  const secondaryBusArrowHeadHalfHeight = 3
  const route = wireSegment.wireRoute
  const inWall = wireSegment.inWall === true
  const effectiveRoute: 'inWall' | 'onWall' | 'ground' | 'air' | undefined =
    route === 'ground'
      ? 'ground'
      : route === 'air'
        ? 'air'
        : route === 'wall'
          ? inWall
            ? 'inWall'
            : 'onWall'
          : undefined
  const routeIndicatorEndY = getVerticalRouteIndicatorEndY(wireSegment)
  const routeIndicatorDeltaY = routeIndicatorEndY - wireSegment.startPoint.y
  const centeredIndicatorY = routeIndicatorDeltaY / 2 + 10
  const fromDeviceSymbolId = fromTrunkDevice?.symbol ?? fromEndpoint?.symbol
  const fromDeviceSymbol = fromDeviceSymbolId ? getSymbolById(fromDeviceSymbolId) : null
  const fromDeviceDomainInfo = fromDeviceSymbol ? getDomainForSymbol(fromDeviceSymbol.id) : null
  const isFromConversionDevice =
    !!fromDeviceDomainInfo && fromDeviceDomainInfo.inputDomain !== fromDeviceDomainInfo.outputDomain
  const showDomainChangeLabel = fromTrunkDevice
    ? fromTrunkDevice.showDomainChangeLabel !== false
    : true
  const domainLabelText: 'AC' | 'DC' = wireSegment.domain === 'DC' ? 'DC' : 'AC'
  const isTrunkConversionOutput = !!fromTrunkDevice
  const isBranchConversionOutput = !!fromEndpoint
  const shouldDrawDomainLabelOnWire = shouldShowDomainChangeMarker(
    wireSegment,
    fromTrunkDevice ? 'trunkDevice' : fromEndpoint ? 'endpoint' : undefined,
    isFromConversionDevice,
    showDomainChangeLabel
  )
  const isSubPanelIncomingPhaseSegment =
    wireSegment.isSubPanelSupply === true &&
    wireSegment.fromElementId === wireSegment.feederProtectionId
  const isRootSupplyPhaseSegment =
    wireSegment.supplyWireRole === 'downstream' &&
    wireSegment.supplyFeedScope === 'root' &&
    !wireSegment.circuitId
  const isBusFeedStubPhaseSegment =
    isVertical && wireSegment.showBusFeedMarker === true && !!wireSegment.busSectionId
  const incomingPanelPhaseLabel =
    (wireSegment.forcePhaseLabel ||
      isSubPanelIncomingPhaseSegment ||
      (isRootSupplyPhaseSegment && wireSegment.showPhaseLabel === true)) &&
    phaseSystem &&
    (wireSegment.forcePhaseLabel ||
      isPhaseAssignmentLabelVisible(
        wireSegment.phaseAssignment,
        phaseSystem,
        wireSegment.showPhaseLabel
      ))
      ? getPhaseAssignmentLabel(wireSegment.phaseAssignment, phaseSystem)
      : undefined
  const incomingPanelPhaseLabelWidth = 48
  const incomingPanelPhaseLabelTextLayout = getPhaseLabelTextLayout(
    wireSegment,
    incomingPanelPhaseLabelWidth
  )
  const incomingPanelPhaseLabelY =
    wireSegment.phaseLabelAnchor?.y ??
    (isVertical
      ? isBusFeedStubPhaseSegment
        ? Math.min(wireSegment.startPoint.y, wireSegment.endPoint.y) + 4
        : wireSegment.isSubPanelSupply
          ? Math.min(wireSegment.startPoint.y, wireSegment.endPoint.y) + 4
          : Math.max(wireSegment.startPoint.y, wireSegment.endPoint.y) +
            (isRootSupplyPhaseSegment ? 4 : -10)
      : (wireSegment.startPoint.y + wireSegment.endPoint.y) / 2 - 12)
  const incomingPanelPhaseLabelX =
    wireSegment.phaseLabelAnchor?.x ??
    (isVertical
      ? isBusFeedStubPhaseSegment
        ? wireSegment.startPoint.x + 5
        : wireSegment.startPoint.x
      : (wireSegment.startPoint.x + wireSegment.endPoint.x) / 2)
  const isProtectionInputPhaseSegment =
    wireSegment.type === 'vertical' &&
    !!wireSegment.circuitId &&
    wireSegment.toElementType === 'protection'
  const protectionPhaseLabel =
    isProtectionInputPhaseSegment && phaseSystem
      ? getVisiblePhaseAssignmentLabel(
          wireSegment.phaseAssignment,
          phaseSystem,
          wireSegment.showPhaseLabel
        )
      : undefined
  const protectionPhaseLabelWidth = 48
  const protectionPhaseLabelOffsetY = targetProtectionType === 'SPD' ? 14 : 4

  const domainLabelOffsetX = isTrunkConversionOutput && isWireLabelVisible ? 10 : 0
  const domainLabelX =
    wireSegment.startPoint.x + (isBranchConversionOutput ? 7 : 10) + domainLabelOffsetX
  const domainLabelY = wireSegment.startPoint.y - 4

  let hitArea: { x: number; y: number; width: number; height: number } | null = null

  if (isHorizontal) {
    const minX = Math.min(wireSegment.startPoint.x, wireSegment.endPoint.x)
    const maxX = Math.max(wireSegment.startPoint.x, wireSegment.endPoint.x)
    hitArea = {
      x: minX - hitAreaPadding,
      y: wireSegment.startPoint.y - hitAreaPadding,
      width: maxX - minX + hitAreaPadding * 2,
      height: lineWidth + hitAreaPadding * 2,
    }
  } else if (isVertical) {
    const minY = Math.min(wireSegment.startPoint.y, wireSegment.endPoint.y)
    const maxY = Math.max(wireSegment.startPoint.y, wireSegment.endPoint.y)
    hitArea = {
      x: wireSegment.startPoint.x - hitAreaPadding,
      y: minY - hitAreaPadding,
      width: lineWidth + hitAreaPadding * 2,
      height: maxY - minY + hitAreaPadding * 2,
    }
  }

  return (
    <Group name={`wire-${wireSegment.id}`}>
      {/* Main wire line */}
      <Line
        name={`eendraad-schematic-conductor wireHit-${wireSegment.id}`}
        points={wireLinePoints}
        stroke={isSelected ? selectedColor : isPreviewSelected ? previewColor : lineColor}
        strokeWidth={isSelected || isPreviewSelected ? wireSelectionStroke : lineWidth}
        lineCap={lineCap}
        lineJoin="round"
        onClick={isBusBar && !wireSegment.busSectionId && !wireSegment.wireBusGroup ? undefined : handleClick}
        onTap={isBusBar && !wireSegment.busSectionId && !wireSegment.wireBusGroup ? undefined : handleClick}
        onMouseEnter={isBusBar && !wireSegment.busSectionId && !wireSegment.wireBusGroup ? undefined : handleMouseEnter}
        onMouseLeave={isBusBar && !wireSegment.busSectionId && !wireSegment.wireBusGroup ? undefined : handleMouseLeave}
        listening={!isBusBar || Boolean(wireSegment.busSectionId || wireSegment.wireBusGroup)}
      />

      {!isExporting && secondaryBusReferenceLabel && isHorizontal && (
        <Group x={wireSegment.endPoint.x} y={wireSegment.endPoint.y + 10} listening={false}>
          <Line
            points={[
              secondaryBusArrowRightX,
              secondaryBusReferenceTextCenterY,
              secondaryBusArrowTipX + 2,
              secondaryBusReferenceTextCenterY,
            ]}
            stroke={colors.wireColor}
            strokeWidth={1.2}
            lineCap="round"
            lineJoin="round"
            listening={false}
          />
          <Line
            points={[
              secondaryBusArrowTipX,
              secondaryBusReferenceTextCenterY,
              secondaryBusArrowTipX + 6,
              secondaryBusReferenceTextCenterY - secondaryBusArrowHeadHalfHeight,
            ]}
            stroke={colors.wireColor}
            strokeWidth={1.2}
            lineCap="round"
            lineJoin="round"
            listening={false}
          />
          <Line
            points={[
              secondaryBusArrowTipX,
              secondaryBusReferenceTextCenterY,
              secondaryBusArrowTipX + 6,
              secondaryBusReferenceTextCenterY + secondaryBusArrowHeadHalfHeight,
            ]}
            stroke={colors.wireColor}
            strokeWidth={1.2}
            lineCap="round"
            lineJoin="round"
            listening={false}
          />
          <KonvaText
            x={secondaryBusReferenceTextLeft}
            y={0}
            width={secondaryBusReferenceTextWidth}
            text={secondaryBusReferenceLabel}
            fontSize={secondaryBusReferenceFontSize}
            fontFamily={fontFamily}
            fill={colors.wireColor}
            align="right"
            listening={false}
          />
        </Group>
      )}

      {/* Invisible hit area for easier clicking */}
      {hitArea && (!isBusBar || wireSegment.busSectionId) && (
        <Line
          points={wireLinePoints}
          stroke="transparent"
          strokeWidth={Math.max(lineWidth + hitAreaPadding * 2, 10)}
          lineCap="round"
          lineJoin="round"
          onClick={handleClick}
          onTap={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          listening={true}
        />
      )}

      {wireSegment.showBusFeedMarker && wireSegment.busFeedKind && (
        <Group x={busFeedMarkerPosition.x} y={busFeedMarkerPosition.y} listening={false}>
          <CatalogSymbolImage
            symbolId={wireSegment.busFeedKind === 'backup' ? 'backup_feed' : 'mains'}
            width={20}
            height={20}
            fallbackStroke={lineColor}
          />
          <KonvaText
            x={busFeedMarkerLabelLayout.x}
            y={BUS_FEED_MARKER_LABEL_Y}
            width={busFeedMarkerLabelLayout.width}
            text={busFeedMarkerLabel}
            fontSize={7}
            fontFamily={fontFamily}
            fill={lineColor}
            align={busFeedMarkerLabelLayout.align}
            listening={false}
          />
        </Group>
      )}

      {/* Hover highlight — dashed yellow line, matches selectable symbol hover */}
      {showHoverHighlight && (
        <Line
          name={INTERACTIVE_OVERLAY_EXPORT_NAME}
          points={wireLinePoints}
          stroke={SELECTION_COLOR}
          strokeWidth={wireHoverStroke}
          dash={[wireHoverDash, wireHoverDash]}
          lineCap={lineCap}
          lineJoin="round"
          listening={false}
        />
      )}

      {/* Cable label (vertical circuit wires, supply trunk, main supply drop) */}
      {showCableLabel && (
        <LocalizedWireTextLabel
          wireSegment={wireSegment}
          wireLabelOffsetAlongWire={wireLabelOffsetAlongWire}
          fontFamily={fontFamily}
          color={colors.wireColor}
          onLabelClick={handleClick}
          onLabelMouseEnter={handleMouseEnter}
          onLabelMouseLeave={handleMouseLeave}
        />
      )}

      {incomingPanelPhaseLabel && (
        <Group
          x={incomingPanelPhaseLabelX}
          y={incomingPanelPhaseLabelY}
          name="export-strip-label"
          onClick={handleClick}
          onTap={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <KonvaText
            x={
              wireSegment.phaseLabelAnchor
                ? incomingPanelPhaseLabelTextLayout.x
                : isVertical
                  ? isRootSupplyPhaseSegment || isBusFeedStubPhaseSegment
                    ? 5
                    : -incomingPanelPhaseLabelWidth - 5
                  : -incomingPanelPhaseLabelWidth / 2
            }
            y={0}
            width={incomingPanelPhaseLabelWidth}
            text={incomingPanelPhaseLabel}
            fontSize={8}
            fontFamily={fontFamily}
            fill={colors.wireColor}
            align={
              wireSegment.phaseLabelAnchor
                ? incomingPanelPhaseLabelTextLayout.align
                : isVertical
                  ? isRootSupplyPhaseSegment || isBusFeedStubPhaseSegment
                    ? 'left'
                    : 'right'
                  : 'center'
            }
          />
        </Group>
      )}

      {protectionPhaseLabel && (
        <Group
          x={wireSegment.endPoint.x}
          y={wireSegment.endPoint.y + protectionPhaseLabelOffsetY}
          name="export-strip-label"
          onClick={handleClick}
          onTap={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <KonvaText
            x={-protectionPhaseLabelWidth - 3}
            y={0}
            width={protectionPhaseLabelWidth}
            text={protectionPhaseLabel}
            fontSize={8}
            fontFamily={fontFamily}
            fill={colors.wireColor}
            align="right"
          />
        </Group>
      )}

      {showSupplyRouteIndicators ? (
        <SupplyWireRouteIndicators
          wireSegment={wireSegment}
          effectiveRoute={effectiveRoute}
          color={colors.wireColor}
        />
      ) : null}

      {/* Route indicators (tube, wall, air, ground) — vertical circuit wires only */}
      {showVerticalRouteIndicators && (
        <>
          <Group x={wireSegment.startPoint.x} y={wireSegment.startPoint.y - 10} rotation={0}>
            {/* In Tube indicator - Circle (75% size, shifted right so right edge stays at wire) */}
            {wireSegment.inTube && (
              <Circle
                x={effectiveRoute === 'air' ? -8 : -6}
                y={effectiveRoute === 'ground' ? centeredIndicatorY + 7 : centeredIndicatorY}
                radius={3}
                stroke={colors.wireColor}
                strokeWidth={1}
                listening={false}
              />
            )}

            {/* Route indicator: exactly one of none, inWall, onWall, ground, air. Mutually exclusive. */}
            {(() => {
              const thickness = 1.5
              if (effectiveRoute === 'ground') {
                return (
                  <Group
                    x={-6.5}
                    y={wireSegment.inTube ? centeredIndicatorY - 7 : centeredIndicatorY}
                    scaleX={0.75}
                    scaleY={0.75}
                    rotation={-90}
                  >
                    <Line
                      points={[-8, -4, 8, -4]}
                      stroke={colors.wireColor}
                      strokeWidth={thickness}
                      lineCap="round"
                      listening={false}
                    />
                    <Line
                      points={[-4, 0, 4, 0]}
                      stroke={colors.wireColor}
                      strokeWidth={thickness}
                      lineCap="round"
                      listening={false}
                    />
                    <Line
                      points={[-2, 4, 2, 4]}
                      stroke={colors.wireColor}
                      strokeWidth={thickness}
                      lineCap="round"
                      listening={false}
                    />
                  </Group>
                )
              }
              if (effectiveRoute === 'air') {
                return (
                  <>
                    <Circle
                      x={0}
                      y={centeredIndicatorY}
                      radius={3.5}
                      stroke={colors.wireColor}
                      strokeWidth={thickness * 0.75}
                      listening={false}
                    />
                  </>
                )
              }
              if (effectiveRoute === 'inWall' || effectiveRoute === 'onWall') {
                const wallRotation = effectiveRoute === 'inWall' ? 0 : 180
                const wallScale = 0.75
                const wallSymbolCenterX = 3
                const wallSymbolCenterY = 0
                const segmentLength = Math.abs(routeIndicatorDeltaY)
                // Keep both wall symbols within the decorated physical run. Tall trunks can
                // continue beyond the first endpoint branch, but that continuation does not
                // belong to the cable/route section immediately above the protection.
                const idealMargin = 10
                const minMargin = 3
                const marginFromEnds = Math.max(
                  minMargin,
                  Math.min(idealMargin, segmentLength / 2 - minMargin)
                )
                const direction = routeIndicatorDeltaY < 0 ? -1 : 1
                const firstSymbolY = 10 + direction * marginFromEnds
                const secondSymbolY = 10 + routeIndicatorDeltaY - direction * marginFromEnds
                const wallLines = WALL_ROUTE_LINES.map((points, i) => (
                  <Line
                    key={i}
                    points={points}
                    stroke={colors.wireColor}
                    strokeWidth={thickness}
                    lineCap="round"
                    listening={false}
                  />
                ))
                return (
                  <>
                    <Group
                      x={-8.5 + wallSymbolCenterX}
                      y={secondSymbolY}
                      scaleX={wallScale}
                      scaleY={wallScale}
                      offsetX={wallSymbolCenterX}
                      offsetY={wallSymbolCenterY}
                      rotation={wallRotation}
                    >
                      {wallLines}
                    </Group>
                    <Group
                      x={-8.5 + wallSymbolCenterX}
                      y={firstSymbolY}
                      scaleX={wallScale}
                      scaleY={wallScale}
                      offsetX={wallSymbolCenterX}
                      offsetY={wallSymbolCenterY}
                      rotation={wallRotation}
                    >
                      {wallLines}
                    </Group>
                  </>
                )
              }
              return null
            })()}
          </Group>
        </>
      )}

      {/* Domain-change marker immediately after a trunk or branch conversion device. */}
      {shouldDrawDomainLabelOnWire && (
        <DomainMarker
          domain={domainLabelText}
          x={domainLabelX}
          y={domainLabelY - 1}
          color={colors.wireColor}
        />
      )}
    </Group>
  )
})

/**
 * Render wire segments for a panel
 */
export const WireSegments = memo(function WireSegments({
  panelId,
  diagramId,
  wireSegments,
}: {
  panelId: string
  diagramId?: string
  wireSegments: WireSegment[]
}) {
  const panelWires = useMemo(
    () =>
      orderWireSegmentsForRendering(
        wireSegments.filter(
          (ws) =>
            ws.panelId === panelId && (!diagramId || (ws.diagramId ?? ws.panelId) === diagramId)
        )
      ),
    [diagramId, panelId, wireSegments]
  )
  const supplyDecorationOwnerIds = useMemo(
    () => getSupplyWireDecorationOwnerIds(panelWires),
    [panelWires]
  )
  const circuitWireJunctions = useMemo(() => getCircuitWireJunctions(panelWires), [panelWires])
  const colors = useThemeColors()
  const renderState = useProjectStore.getState()
  const currentProject = renderState.currentProject
  const lookup = currentProject ? getWireRenderLookup(currentProject) : null

  return (
    <>
      {circuitWireJunctions.map(({ point, radius }) => (
        <Circle
          key={`wire-junction-${point.x}-${point.y}`}
          name="eendraad-schematic-junction"
          x={point.x}
          y={point.y}
          radius={radius}
          fill={colors.wireColor}
          listening={false}
        />
      ))}
      {panelWires.map((wireSegment) => {
        const localRender = localizeWireSegment(wireSegment)
        const fromTrunkDevice = wireSegment.fromElementId
          ? (lookup?.trunkDevices.get(wireSegment.fromElementId) ??
            renderState.getTrunkDeviceById(wireSegment.fromElementId)?.device)
          : undefined
        const fromEndpoint =
          !fromTrunkDevice &&
          wireSegment.fromElementType === 'endpoint' &&
          wireSegment.fromElementId
            ? lookup?.endpoints.get(wireSegment.fromElementId)
            : undefined
        const targetProtectionType =
          wireSegment.toElementType === 'protection' && wireSegment.toElementId
            ? lookup?.protections.get(wireSegment.toElementId)?.type
            : undefined
        return (
          <Group
            key={wireSegment.id}
            name="wire-segment-origin eendraad-hit-cullable"
            x={localRender.origin.x}
            y={localRender.origin.y}
          >
            <WireSegmentComponent
              wireSegment={localRender.wire}
              isSupplyDecorationOwner={supplyDecorationOwnerIds.has(wireSegment.id)}
              hasModularChangeover={
                wireSegment.busFeedKind === 'backup' &&
                lookup?.modularChangeoverPanels.has(wireSegment.panelId)
              }
              phaseSystem={lookup?.phaseSystem}
              fromTrunkDevice={fromTrunkDevice}
              fromEndpoint={fromEndpoint}
              targetProtectionType={targetProtectionType}
            />
          </Group>
        )
      })}
    </>
  )
})
