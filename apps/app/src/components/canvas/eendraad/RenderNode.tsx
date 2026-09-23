import { memo, useMemo, useRef } from 'react'
import type { TFunction } from 'i18next'
import { Group, Text } from 'react-konva'
import { getLayoutNodeIdentityKey, type LayoutNode } from '@/lib/layout/layoutTree'
import { SupplySymbol } from './SupplySymbol'
import { GroundSymbol } from './GroundSymbol'
import { ProtectionSymbol } from './ProtectionSymbol'
import { EndpointMetadataCallout, EndpointSymbol } from './EndpointSymbol'
import { CircuitLabel } from './CircuitLabel'
import { PanelFrame } from './PanelFrame'
import { PanelSymbol } from './PanelSymbol'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { getPanelSymbolLabel } from '@/lib/panel/panelDiagramLabels'
import { TrunkDeviceSymbol } from './TrunkDeviceSymbol'
import { EENDRAAD_PANEL_SYMBOL_WIDTH, getEendraadPanelBodyCenterYOffset } from './canvasSymbols'
import { useThemeColors } from '@/lib/theme/hooks'
import { useCanvasFontFamily } from '@/editions/community/communityHooks'
import type { BottomUpPanelLayout } from '@/lib/layout/bottomUpLayout'
import {
  CIRCUIT_NOTES_FONT_SIZE,
  CIRCUIT_NOTES_LINE_HEIGHT,
  CIRCUIT_NOTES_VERTICAL_X_NUDGE,
  estimateCircuitNotesBlockHeight,
  estimateCircuitNotesRenderedWidth,
  estimateCircuitNotesWidth,
  getCircuitNotesVisualLines,
  measureCircuitNotesLineWidth,
  normalizeCircuitNotesText,
} from '@/lib/layout/circuitNoteMetrics'
import type { Circuit, Endpoint, ProtectionDevice, TrunkDevice, Panel } from '@/types/schema'
import { isPanelOnlySubPanelFeeder as isPanelOnlySubPanelFeederCircuit } from '@/lib/layout/bottomUpLayout'
import type { Point } from '@/types/ui'
import { getSupplyProtectionLabelCollisionInfo } from '@/lib/eendraad/supplyProtectionLabelCollisions'
import { findPanelDistributionEndpointInCircuit } from '@/lib/eendraad/panelSupplyLink'
import { countPanelCircuits } from '@/utils/plan/placementHelpers'
import { isVerticalSupplyDevice } from '@/lib/layout/supplyDeviceOrientation'
import { reconcileLayoutNode } from '@/lib/layout/eendraadDerivedLayout'

function isPanelOnlySubPanelFeeder(
  protection: ProtectionDevice,
  circuitId?: string,
  targetPanel?: Panel
): boolean {
  if (!protection.subPanelId) return false
  const circuit = circuitId
    ? protection.circuits?.find((candidate) => candidate.id === circuitId)
    : targetPanel
      ? (protection.circuits?.find((candidate) =>
          findPanelDistributionEndpointInCircuit(candidate, targetPanel)
        ) ?? protection.circuits?.[0])
      : protection.circuits?.[0]
  if (!circuit) return false
  return isPanelOnlySubPanelFeederCircuit(protection, circuit)
}

interface RenderNodeProps {
  node: LayoutNode
  translate: TFunction
  advancedPanelLabels: boolean
  panelLayout?: BottomUpPanelLayout // For PanelFrame and child nodes
  getProtectionById?: (id: string) => ProtectionDevice | undefined // For protection lookup
  getPanelById?: (id: string) => Panel | undefined // For panel lookup
  supplyProtectionCollisionIds?: Set<string>
  /** Records Alt/Option at drag start; return true to cancel Konva drag (pointer duplicate). */
  onElementDragStart?: (id: string, type: string, altKey: boolean, nativeEvt: MouseEvent) => boolean
  shouldSuppressKonvaDragEnd?: () => boolean
  /** Live drag handler used during internal 1‑draad drags (for preview). */
  onElementDragMove?: (id: string, type: string, newPos: Point) => void
  /** Drag end handler used to execute the actual move on drop. */
  onElementDragEnd?: (id: string, type: string, newPos: Point) => boolean | void
  onGroundDragEnd?: (newPos: Point) => void
  /** Convert Konva drag event to canvas position (pointer). Used so drop target uses cursor position. */
  getCanvasPositionFromEvent?: (e: unknown) => Point | null
  /** Render a selected endpoint instead of leaving it for the interaction overlay. */
  renderSelectedEndpoint?: boolean
  /** Internal guard used when this node is already rendered inside a translated island. */
  disablePositionIsland?: boolean
}

function localizeLayoutNode(node: LayoutNode, originX: number, originY: number): LayoutNode {
  return {
    ...node,
    bounds: { ...node.bounds, x: node.bounds.x - originX, y: node.bounds.y - originY },
    connectionAnchor: node.connectionAnchor
      ? {
          x: node.connectionAnchor.x - originX,
          y: node.connectionAnchor.y - originY,
        }
      : undefined,
    nestedChildXs: node.nestedChildXs?.map((x) => x - originX),
    // Metadata callouts are positioned relative to their owning symbol node.
    // The symbol itself is localized by its bounds/position island, so translating
    // the callout here a second time moves the floating card off-canvas.
    visual: node.visual,
    children: node.children.map((child) => localizeLayoutNode(child, originX, originY)),
  }
}

/**
 * Recursive component that renders a LayoutNode and its children
 *
 * This is the unified rendering system that walks the layout tree
 * and renders the appropriate Konva components for each node type.
 */
function renderNodePropsEqual(previous: RenderNodeProps, next: RenderNodeProps): boolean {
  if (
    previous.node !== next.node ||
    previous.translate !== next.translate ||
    previous.advancedPanelLabels !== next.advancedPanelLabels ||
    previous.getProtectionById !== next.getProtectionById ||
    previous.getPanelById !== next.getPanelById ||
    previous.onElementDragStart !== next.onElementDragStart ||
    previous.shouldSuppressKonvaDragEnd !== next.shouldSuppressKonvaDragEnd ||
    previous.onElementDragMove !== next.onElementDragMove ||
    previous.onElementDragEnd !== next.onElementDragEnd ||
    previous.onGroundDragEnd !== next.onGroundDragEnd ||
    previous.getCanvasPositionFromEvent !== next.getCanvasPositionFromEvent ||
    previous.renderSelectedEndpoint !== next.renderSelectedEndpoint ||
    previous.disablePositionIsland !== next.disablePositionIsland
  ) {
    return false
  }

  const needsPanelLayout =
    next.node.type === 'panel' ||
    next.node.type === 'trunkDevice' ||
    (next.node.type === 'endpoint' &&
      next.node.visual?.type === 'symbol' &&
      next.node.visual.symbolId === 'panel_distribution')
  if (needsPanelLayout && previous.panelLayout !== next.panelLayout) return false
  if (
    next.node.type === 'trunkDevice' &&
    previous.supplyProtectionCollisionIds?.has(next.node.id) !==
      next.supplyProtectionCollisionIds?.has(next.node.id)
  ) {
    return false
  }
  return true
}

const PositionedRenderIsland = memo(function PositionedRenderIsland({
  node,
  translate,
  advancedPanelLabels,
  panelLayout,
  getProtectionById,
  getPanelById,
  supplyProtectionCollisionIds,
  onElementDragStart,
  onElementDragMove,
  onElementDragEnd,
  shouldSuppressKonvaDragEnd,
  onGroundDragEnd,
  getCanvasPositionFromEvent,
  renderSelectedEndpoint,
}: RenderNodeProps) {
  const previousLocalNodeRef = useRef<LayoutNode | undefined>(undefined)
  const localNode = useMemo(() => {
    const localized = localizeLayoutNode(node, node.bounds.x, node.bounds.y)
    const reconciled = reconcileLayoutNode(localized, previousLocalNodeRef.current)
    previousLocalNodeRef.current = reconciled
    return reconciled
  }, [node])
  return (
    <Group x={node.bounds.x} y={node.bounds.y} name="eendraad-hit-cullable">
      <RenderNode
        node={localNode}
        translate={translate}
        advancedPanelLabels={advancedPanelLabels}
        panelLayout={panelLayout}
        getProtectionById={getProtectionById}
        getPanelById={getPanelById}
        supplyProtectionCollisionIds={supplyProtectionCollisionIds}
        onElementDragStart={onElementDragStart}
        onElementDragMove={onElementDragMove}
        onElementDragEnd={onElementDragEnd}
        shouldSuppressKonvaDragEnd={shouldSuppressKonvaDragEnd}
        onGroundDragEnd={onGroundDragEnd}
        getCanvasPositionFromEvent={getCanvasPositionFromEvent}
        renderSelectedEndpoint={renderSelectedEndpoint}
        disablePositionIsland
      />
    </Group>
  )
})

const RenderNode = memo(function RenderNodeImpl({
  node,
  translate: t,
  advancedPanelLabels,
  panelLayout,
  getProtectionById,
  getPanelById,
  supplyProtectionCollisionIds,
  onElementDragStart,
  onElementDragMove,
  onElementDragEnd,
  shouldSuppressKonvaDragEnd,
  onGroundDragEnd,
  getCanvasPositionFromEvent,
  renderSelectedEndpoint = false,
  disablePositionIsland = false,
}: RenderNodeProps) {
  const resolvedSupplyProtectionCollisionIds =
    supplyProtectionCollisionIds ?? getSupplyProtectionLabelCollisionInfo(node).collisionIds

  if (
    !disablePositionIsland &&
    (node.type === 'rcd' || node.type === 'mcb' || node.type === 'branch')
  ) {
    return (
      <PositionedRenderIsland
        node={node}
        translate={t}
        advancedPanelLabels={advancedPanelLabels}
        panelLayout={panelLayout}
        getProtectionById={getProtectionById}
        getPanelById={getPanelById}
        supplyProtectionCollisionIds={resolvedSupplyProtectionCollisionIds}
        onElementDragStart={onElementDragStart}
        onElementDragMove={onElementDragMove}
        onElementDragEnd={onElementDragEnd}
        shouldSuppressKonvaDragEnd={shouldSuppressKonvaDragEnd}
        onGroundDragEnd={onGroundDragEnd}
        getCanvasPositionFromEvent={getCanvasPositionFromEvent}
        renderSelectedEndpoint={renderSelectedEndpoint}
      />
    )
  }

  // Render based on node type
  switch (node.type) {
    case 'panel':
      // Panel nodes wrap everything in a PanelFrame
      if (!panelLayout) return null
      return (
        <PanelFrame key={node.id} panelLayout={panelLayout}>
          <Group>
            {node.children.map((child) => (
              <RenderNode
                key={getLayoutNodeIdentityKey(child)}
                node={child}
                translate={t}
                advancedPanelLabels={advancedPanelLabels}
                panelLayout={panelLayout}
                getProtectionById={getProtectionById}
                getPanelById={getPanelById}
                supplyProtectionCollisionIds={resolvedSupplyProtectionCollisionIds}
                onElementDragStart={onElementDragStart}
                onElementDragMove={onElementDragMove}
                onElementDragEnd={onElementDragEnd}
                shouldSuppressKonvaDragEnd={shouldSuppressKonvaDragEnd}
                onGroundDragEnd={onGroundDragEnd}
                getCanvasPositionFromEvent={getCanvasPositionFromEvent}
              />
            ))}
          </Group>
        </PanelFrame>
      )

    case 'supply':
      if (node.visual?.type === 'symbol' && node.visual.opacity === 0) return null
      return (
        <SupplySymbol
          key={node.id}
          x={node.bounds.x}
          y={node.bounds.y}
          panelId={panelLayout?.panel.id}
        />
      )

    case 'ground':
      return <GroundSymbol key={node.id} elementId={node.id} x={node.bounds.x} y={node.bounds.y} />

    case 'busBar':
      // Main bus or secondary bus container — visual line is rendered via wire segments
      if (!panelLayout) return null
      return (
        <Group key={node.id}>
          {node.children.map((child) => (
            <RenderNode
              key={getLayoutNodeIdentityKey(child)}
              node={child}
              translate={t}
              advancedPanelLabels={advancedPanelLabels}
              panelLayout={panelLayout}
              getProtectionById={getProtectionById}
              getPanelById={getPanelById}
              supplyProtectionCollisionIds={resolvedSupplyProtectionCollisionIds}
              onElementDragStart={onElementDragStart}
              onElementDragMove={onElementDragMove}
              onElementDragEnd={onElementDragEnd}
              shouldSuppressKonvaDragEnd={shouldSuppressKonvaDragEnd}
              onGroundDragEnd={onGroundDragEnd}
              getCanvasPositionFromEvent={getCanvasPositionFromEvent}
            />
          ))}
        </Group>
      )

    case 'rcd':
    case 'mcb': {
      // Protection devices (RCD, MCB)
      if (!node.domainRef || !getProtectionById) return null
      if (node.id === 'parent-mcb') return null
      const protection = node.domainRef as ProtectionDevice
      const targetPanel =
        protection.subPanelId && getPanelById ? getPanelById(protection.subPanelId) : undefined
      const renderProtectionSymbol = !(
        protection.directDcBusFeeder === true ||
        ((node.id.includes('-nest-') || protection.directPanelFeeder === true) &&
          isPanelOnlySubPanelFeeder(protection, node.circuitIdForWires, targetPanel))
      )
      return (
        <Group key={node.id}>
          {renderProtectionSymbol && (
            <ProtectionSymbol
              protection={protection}
              position={{ x: node.bounds.x, y: node.bounds.y }}
              symbolRotationDeg={
                node.visual?.type === 'symbol' ? node.visual.rotationDeg : undefined
              }
              getCanvasPositionFromEvent={getCanvasPositionFromEvent}
              onDragEnd={
                onElementDragEnd
                  ? (newPos) => onElementDragEnd(protection.id, 'protection', newPos)
                  : () => {}
              }
              onDragStart={
                onElementDragStart
                  ? (altKey, evt) => onElementDragStart(protection.id, 'protection', altKey, evt)
                  : undefined
              }
              shouldSuppressKonvaDragEnd={shouldSuppressKonvaDragEnd}
              onDragMove={
                onElementDragMove
                  ? (newPos) => onElementDragMove(protection.id, 'protection', newPos)
                  : undefined
              }
            />
          )}
          {!renderProtectionSymbol &&
            !node.id.includes('-nest-') &&
            !protection.directPanelFeeder &&
            !protection.directDcBusFeeder && (
              <ProtectionSymbol
                protection={protection}
                position={{ x: node.bounds.x, y: node.bounds.y }}
                renderSymbol={false}
                onDragEnd={() => {}}
              />
            )}
          {node.children.map((child) => (
            <RenderNode
              key={getLayoutNodeIdentityKey(child)}
              node={child}
              translate={t}
              advancedPanelLabels={advancedPanelLabels}
              panelLayout={panelLayout}
              getProtectionById={getProtectionById}
              getPanelById={getPanelById}
              supplyProtectionCollisionIds={resolvedSupplyProtectionCollisionIds}
              getCanvasPositionFromEvent={getCanvasPositionFromEvent}
              onElementDragStart={onElementDragStart}
              onElementDragMove={onElementDragMove}
              onElementDragEnd={onElementDragEnd}
              shouldSuppressKonvaDragEnd={shouldSuppressKonvaDragEnd}
              onGroundDragEnd={onGroundDragEnd}
            />
          ))}
        </Group>
      )
    }

    case 'secondaryBus':
      // Secondary bus (trunk) - rendered as wire segment, but we still need the container
      return (
        <Group key={node.id}>
          {node.children.map((child) => (
            <RenderNode
              key={getLayoutNodeIdentityKey(child)}
              node={child}
              translate={t}
              advancedPanelLabels={advancedPanelLabels}
              panelLayout={panelLayout}
              getProtectionById={getProtectionById}
              getPanelById={getPanelById}
              supplyProtectionCollisionIds={resolvedSupplyProtectionCollisionIds}
              onElementDragStart={onElementDragStart}
              onElementDragMove={onElementDragMove}
              onElementDragEnd={onElementDragEnd}
              shouldSuppressKonvaDragEnd={shouldSuppressKonvaDragEnd}
              onGroundDragEnd={onGroundDragEnd}
              getCanvasPositionFromEvent={getCanvasPositionFromEvent}
            />
          ))}
        </Group>
      )

    case 'branch': {
      const metadataCalloutNodes = node.children.flatMap((child) => {
        if (child.type !== 'endpoint' || !child.domainRef || child.visual?.type !== 'symbol') {
          return []
        }
        const metadataCallout = child.visual.metadataCallout
        if (!metadataCallout || child.visual.suppressMetadataLabel) return []
        return [{ child, metadataCallout }]
      })
      return (
        <Group key={node.id}>
          {node.children.map((child) => (
            <RenderNode
              key={getLayoutNodeIdentityKey(child)}
              node={child}
              translate={t}
              advancedPanelLabels={advancedPanelLabels}
              panelLayout={panelLayout}
              getProtectionById={getProtectionById}
              getPanelById={getPanelById}
              supplyProtectionCollisionIds={resolvedSupplyProtectionCollisionIds}
              onElementDragStart={onElementDragStart}
              onElementDragMove={onElementDragMove}
              onElementDragEnd={onElementDragEnd}
              shouldSuppressKonvaDragEnd={shouldSuppressKonvaDragEnd}
              onGroundDragEnd={onGroundDragEnd}
              getCanvasPositionFromEvent={getCanvasPositionFromEvent}
            />
          ))}
          {metadataCalloutNodes.map(({ child, metadataCallout }) => (
            <EndpointMetadataCallout
              key={`${child.id}-metadata-callout-overlay`}
              endpoint={child.domainRef as Endpoint}
              position={{ x: child.bounds.x, y: child.bounds.y }}
              metadataCallout={metadataCallout}
            />
          ))}
        </Group>
      )
    }

    case 'endpoint': {
      // Endpoint symbol or sub-panel symbol. A panel_distribution endpoint is the
      // canonical source-side symbol for a linked panel, so render/select it as a
      // panel symbol even when it has a real endpoint domainRef.
      if (node.visual?.type === 'symbol' && node.visual.symbolId === 'panel_distribution') {
        const visual = node.visual
        const endpoint = node.domainRef as Endpoint | undefined
        const linkedPanelId = endpoint?.panelId
        const fallbackByLabelId = visual.label
          ? panelLayout?.panel.subPanels?.find((p: Panel) => p.name === visual.label)?.id
          : undefined
        const legacyLinkedPanelId = endpoint ? undefined : node.domainId
        const resolvedSubPanelId = linkedPanelId || fallbackByLabelId || legacyLinkedPanelId
        const subPanel = resolvedSubPanelId ? getPanelById?.(resolvedSubPanelId) : undefined

        if (subPanel) {
          const feederProtectionId = node.id.startsWith('subpanel-symbol-')
            ? node.id.slice('subpanel-symbol-'.length)
            : undefined
          const isHorizontalConverterBackup = panelLayout?.circuits.some(
            ({ circuit }) =>
              circuit.supplySource?.kind === 'converter-backup' &&
              (circuit.endpoints.some((candidate) => candidate.id === endpoint?.id) ||
                panelLayout.elements.some(
                  (element) =>
                    element.type === 'protection' &&
                    element.protectionId === feederProtectionId &&
                    element.circuitId === circuit.id
                ))
          )
          const circuitCount = countPanelCircuits(subPanel)
          const nextColumnX = (() => {
            if (!panelLayout) return null
            const trunkXs = Array.from(
              new Set(panelLayout.branches.map((branch) => Math.round(branch.trunkX)))
            ).sort((a, b) => a - b)
            return trunkXs.find((x) => x > node.bounds.x + 1) ?? null
          })()
          const labelStartX = node.bounds.x + EENDRAAD_PANEL_SYMBOL_WIDTH / 2 + 5
          const maxLabelWidth =
            nextColumnX != null
              ? Math.max(40, nextColumnX - labelStartX - 8)
              : Math.max(80, panelLayout!.frame.x + panelLayout!.frame.width - labelStartX - 12)

          const latestProject = useProjectStore.getState().currentProject
          const panelName =
            latestProject != null
              ? getPanelSymbolLabel(latestProject, subPanel, advancedPanelLabels)
              : subPanel.name || visual.label || endpoint?.label || ''

          return (
            <PanelSymbol
              key={node.id}
              position={{
                x: node.bounds.x,
                y:
                  node.bounds.y -
                  (isHorizontalConverterBackup ? getEendraadPanelBodyCenterYOffset() : 0),
              }}
              panelName={panelName}
              subPanelId={subPanel.id}
              circuitCount={circuitCount}
              symbolLabelDisplay={subPanel.symbolLabelDisplay}
              maxLabelWidth={isHorizontalConverterBackup ? 120 : maxLabelWidth}
              labelPosition={isHorizontalConverterBackup ? 'top' : 'right'}
              onDragStart={
                onElementDragStart
                  ? (altKey, event) =>
                      onElementDragStart(subPanel.id, 'panelAttachment', altKey, event)
                  : undefined
              }
              onDragMove={
                onElementDragMove
                  ? (position) => onElementDragMove(subPanel.id, 'panelAttachment', position)
                  : undefined
              }
              onDragEnd={
                onElementDragEnd
                  ? (position) => onElementDragEnd(subPanel.id, 'panelAttachment', position)
                  : undefined
              }
              getCanvasPositionFromEvent={getCanvasPositionFromEvent}
            />
          )
        }
      }

      // Regular endpoint symbol
      if (!node.domainRef) return null
      const endpoint = node.domainRef as Endpoint
      // Domotica parents are draggable as a complete group; their resize handle
      // stops propagation separately so resizing still takes precedence there.
      const canDragEndpoint = true
      return (
        <EndpointSymbol
          key={node.id}
          endpoint={endpoint}
          position={{ x: node.bounds.x, y: node.bounds.y }}
          circuitConverterAnchor={node.connectionAnchor}
          converterGrowthDirection={node.converterGrowthDirection}
          onDragMove={
            onElementDragMove
              ? (newPos) => onElementDragMove(endpoint.id, 'endpoint', newPos)
              : undefined
          }
          onDragEnd={
            onElementDragEnd
              ? (newPos) => onElementDragEnd(endpoint.id, 'endpoint', newPos)
              : () => {}
          }
          onDragStart={
            onElementDragStart
              ? (altKey, evt) => onElementDragStart(endpoint.id, 'endpoint', altKey, evt)
              : undefined
          }
          shouldSuppressKonvaDragEnd={shouldSuppressKonvaDragEnd}
          // Allow dragging for internal 1‑draad moves; EndpointSymbol will still gate
          // this by selection so only selected endpoints are actually draggable.
          draggable={canDragEndpoint}
          getCanvasPositionFromEvent={getCanvasPositionFromEvent}
          isEndpointAtBranchEnd={
            node.visual?.type === 'symbol' ? node.visual.isEndpointAtBranchEnd : undefined
          }
          mirrorHorizontally={
            node.visual?.type === 'symbol' ? node.visual.mirrorHorizontally : undefined
          }
          bottomLabelMinimumLeftX={
            node.visual?.type === 'symbol' ? node.visual.bottomLabelMinimumLeftX : undefined
          }
          bottomLabelMaximumRightX={
            node.visual?.type === 'symbol' ? node.visual.bottomLabelMaximumRightX : undefined
          }
          metadataCallout={node.visual?.type === 'symbol' ? node.visual.metadataCallout : undefined}
          renderMetadataCallout={false}
          metadataLabelSuppressed={
            node.visual?.type === 'symbol' ? node.visual.suppressMetadataLabel : undefined
          }
          suppressWhenSelected={!renderSelectedEndpoint}
        />
      )
    }

    case 'trunkDevice': {
      // Trunk device symbol (energy meter, protection, etc.)
      if (!node.domainRef) return null
      const trunkDevice = node.domainRef as unknown as TrunkDevice
      // Supply trunk devices can sit on the assembly rail or on upright converter/DC-bus risers.
      const isSupplyTrunkDevice = node.id?.startsWith('supplyTrunkDevice-')
      const isVerticalSupplyBranchDevice =
        isSupplyTrunkDevice &&
        (isVerticalSupplyDevice(trunkDevice) || node.id.includes('--feed-stub-'))
      const isSubPanelSupplyTrunkDevice = node.id?.startsWith('subpanelSupplyTrunkDevice-')
      const isGroundTrunkDevice = node.id?.startsWith('groundTrunkDevice-')
      // Ordinary DC-rail branch protections are serialized inside their branch rather
      // than on Circuit.trunkDevices. They are selectable/editable, but the existing
      // circuit-trunk drag path cannot relocate that nested array safely yet.
      const isDcBusBranchDevice = node.id?.startsWith('dc-bus-branch-device-')
      const isDraggableTrunkDevice = !isGroundTrunkDevice && !isDcBusBranchDevice
      return (
        <>
          <TrunkDeviceSymbol
            key={node.id}
            device={trunkDevice}
            position={{ x: node.bounds.x, y: node.bounds.y }}
            circuitConverterAnchor={node.connectionAnchor}
            converterGrowthDirection={node.converterGrowthDirection}
            dcBusWidth={trunkDevice.type === 'dc_bus' ? node.bounds.width : undefined}
            metadataCallout={
              node.visual?.type === 'symbol' ? node.visual.metadataCallout : undefined
            }
            supplyDevicePositions={panelLayout?.supplyDevices}
            supplyMirrorAxisX={
              panelLayout?.supplyFlowDirection === 'left-to-right'
                ? (panelLayout.supplyMirrorAxisX ??
                  panelLayout.frame.x + panelLayout.frame.width / 2)
                : undefined
            }
            supplyPanelId={panelLayout?.panel.id}
            supplyPanelMainBusY={panelLayout?.mainBus.y}
            supplyPanelLabel={panelLayout?.panel.name}
            allowVerticalSupplyNotes={isSupplyTrunkDevice && panelLayout?.frameRole !== 'supply'}
            isHorizontal={isSupplyTrunkDevice && !isVerticalSupplyBranchDevice}
            symbolRotationDeg={node.visual?.type === 'symbol' ? node.visual.rotationDeg : undefined}
            protectionLabelPosition={isVerticalSupplyBranchDevice ? 'right' : undefined}
            showDeviceLabelLeft={
              isSubPanelSupplyTrunkDevice || isVerticalSupplyBranchDevice
            }
            splitProtectionResidualLine={
              isSupplyTrunkDevice && resolvedSupplyProtectionCollisionIds.has(node.id)
            }
            getCanvasPositionFromEvent={getCanvasPositionFromEvent}
            onDragMove={
              isDraggableTrunkDevice && onElementDragMove
                ? (p) => onElementDragMove(trunkDevice.id, 'trunkDevice', p)
                : undefined
            }
            onDragStart={
              isDraggableTrunkDevice && onElementDragStart
                ? (altKey, nativeEvt) =>
                    onElementDragStart(trunkDevice.id, 'trunkDevice', altKey, nativeEvt)
                : undefined
            }
            shouldSuppressKonvaDragEnd={shouldSuppressKonvaDragEnd}
            onDragEnd={
              isDraggableTrunkDevice && onElementDragEnd
                ? (p) => onElementDragEnd(trunkDevice.id, 'trunkDevice', p)
                : undefined
            }
            draggableCircuitTrunk={isDraggableTrunkDevice}
          />
          {node.children.map((child) => (
            <RenderNode
              key={getLayoutNodeIdentityKey(child)}
              node={child}
              translate={t}
              advancedPanelLabels={advancedPanelLabels}
              panelLayout={panelLayout}
              getProtectionById={getProtectionById}
              getPanelById={getPanelById}
              supplyProtectionCollisionIds={resolvedSupplyProtectionCollisionIds}
              onElementDragStart={onElementDragStart}
              onElementDragMove={onElementDragMove}
              onElementDragEnd={onElementDragEnd}
              shouldSuppressKonvaDragEnd={shouldSuppressKonvaDragEnd}
              onGroundDragEnd={onGroundDragEnd}
              getCanvasPositionFromEvent={getCanvasPositionFromEvent}
            />
          ))}
        </>
      )
    }

    case 'label':
      // Circuit labels and other text labels. Wrapped in Group so export can strip them
      // and redraw on top of each slice (labels are added in a post-process pass).
      if (node.visual?.type === 'label') {
        if (node.visual.variant === 'circuit-notes') {
          return (
            <Group key={node.id} name="export-strip-label">
              <CircuitNotesLabel node={node} />
            </Group>
          )
        }
        const isSupplyFeedLabel =
          node.id === 'supply-continuation-label' || node.id === 'feed-output-label'
        const selectSupply = isSupplyFeedLabel
          ? (event: { cancelBubble: boolean }) => {
              event.cancelBubble = true
              useUIStore.getState().setSelection({
                type: 'supply',
                ids: ['supply'],
                supplyPanelId: panelLayout?.panel.id,
              })
            }
          : undefined
        const labelCircuit = node.domainRef as Circuit | undefined
        const labelProtection = labelCircuit
          ? panelLayout?.panel.protections.find((protection) =>
              protection.circuits?.some((circuit) => circuit.id === labelCircuit.id)
            )
          : undefined
        return (
          <Group
            key={node.id}
            name="export-strip-label"
            onClick={selectSupply}
            onTap={selectSupply}
          >
            <CircuitLabel
              x={node.bounds.x}
              y={node.bounds.y}
              label={
                node.visual.translationKey
                  ? t(node.visual.translationKey, node.visual.text)
                  : node.visual.text
              }
              align={node.visual.align}
              custom={
                labelProtection?.circuits?.some(
                  (circuit) => circuit.eendraadManualCodeLock === true
                ) ?? labelCircuit?.eendraadManualCodeLock === true
              }
              protectionId={labelProtection?.id}
            />
          </Group>
        )
      }
      return null

    default:
      // Unknown node type - just render children
      return (
        <Group key={node.id}>
          {node.children.map((child) => (
            <RenderNode
              key={getLayoutNodeIdentityKey(child)}
              node={child}
              translate={t}
              advancedPanelLabels={advancedPanelLabels}
              panelLayout={panelLayout}
              getProtectionById={getProtectionById}
              getPanelById={getPanelById}
              supplyProtectionCollisionIds={resolvedSupplyProtectionCollisionIds}
              getCanvasPositionFromEvent={getCanvasPositionFromEvent}
              onElementDragStart={onElementDragStart}
              onElementDragMove={onElementDragMove}
              onElementDragEnd={onElementDragEnd}
              shouldSuppressKonvaDragEnd={shouldSuppressKonvaDragEnd}
              onGroundDragEnd={onGroundDragEnd}
            />
          ))}
        </Group>
      )
  }
}, renderNodePropsEqual)

export default RenderNode

/**
 * Circuit notes label component (italic, gray styling).
 * Supports horizontal or vertical (90° rotated) orientation.
 * When notesVisible is false, nothing is drawn (slot still reserved for layout).
 */
function CircuitNotesLabel({ node }: { node: LayoutNode }) {
  const colors = useThemeColors()
  const fontFamily = useCanvasFontFamily()
  const textColor = colors.secondaryText
  const notesText = normalizeCircuitNotesText(node.visual?.type === 'label' ? node.visual.text : '')
  const orientation =
    node.visual?.type === 'label' ? (node.visual.notesOrientation ?? 'horizontal') : 'horizontal'
  const notesVisible = node.visual?.type === 'label' ? node.visual.notesVisible !== false : true

  if (!notesVisible) {
    return null
  }

  const isVertical = orientation === 'vertical'
  const fontSize = CIRCUIT_NOTES_FONT_SIZE
  const lineHeight = CIRCUIT_NOTES_LINE_HEIGHT

  // Both orientations use one shared text block. Rotating it swaps its painted
  // width and height, so multiline vertical notes become wider columns.
  const hWidth = estimateCircuitNotesRenderedWidth(notesText, fontFamily, fontSize)
  const visualLines = getCircuitNotesVisualLines(
    notesText,
    fontFamily,
    fontSize,
    estimateCircuitNotesWidth(notesText, fontFamily, fontSize)
  )
  const blockHeight = estimateCircuitNotesBlockHeight(notesText, fontFamily, fontSize, lineHeight)
  let rotation = 0

  if (isVertical) {
    // Vertical: rotate -90°. We want the *visual* centre of the rendered text
    // (including glyph ascenders/descenders) to stay on the original wire
    // anchor. The Konva Text is rotated around the Group origin, so we:
    // - keep the group's X at the node centre
    // - shift the group's Y up by half the horizontal width so the rotated
    //   box sits symmetrically around the anchor.
    rotation = -90
  }

  const groupX = node.bounds.x + (isVertical ? CIRCUIT_NOTES_VERTICAL_X_NUDGE : 0)
  const groupY = isVertical ? node.bounds.y - hWidth / 2 : node.bounds.y
  const textY = isVertical ? -blockHeight / 2 : -blockHeight + lineHeight / 2

  return (
    <Group x={groupX} y={groupY} offsetX={0} offsetY={0} rotation={rotation}>
      {visualLines.map((line, index) => {
        const lineWidth = measureCircuitNotesLineWidth(line, fontFamily, fontSize)
        return (
          <Text
            key={`${index}-${line}`}
            x={-lineWidth / 2}
            y={textY + index * lineHeight}
            width={lineWidth}
            text={line}
            fontSize={fontSize}
            fontFamily={fontFamily}
            fontStyle="italic"
            fill={textColor}
            align="left"
            wrap="none"
            listening={false}
          />
        )
      })}
    </Group>
  )
}
