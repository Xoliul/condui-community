import { useEendraadArtworkPreview } from '@/hooks/eendraad/useEendraadArtworkPreview'

import type { resolveLiveProtectionBusPreview } from '@/lib/layout/liveProtectionBusPreview'
import { LiveProtectionBusPreview } from './LiveProtectionBusPreview'

import type { useViewportUIApi } from '@/components/viewport/ViewportUIStore'

import { useMemo } from 'react'

import {
  Circle,
  Group,
  Line,
  Rect,
} from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type Konva from 'konva'
import type { useTranslation } from 'react-i18next'

import type { ProjectState } from '@/stores/projectStore'

import type { Point, Selection } from '@/types/ui'
import type { Frame, WireSegment } from '@/types/schema'
import type { BaseCanvasHandle } from '../BaseCanvas'

import { WireSegments } from '../WireSegment'

import {
  DragCursorSymbol,
  DragPreview,
  DropZoneHintsOverlay,
  HitZoneDebugOverlay,
} from './'
import { FrameComponent } from './FrameComponent'
import RenderNode from './RenderNode'
import { OneWireDragGhost } from './OneWireDragGhost'

import { NoteSymbol } from './NoteSymbol'

import {
  SYMBOL_SIZE,
  DRAG_PREVIEW_WIRE_WIDTH,
  DRAG_PREVIEW_BUS_WIDTH,
  DRAG_PREVIEW_HIGHLIGHT_WIDTH,
  DRAG_PREVIEW_DASH,
} from './canvasSymbols'
import { CanvasPanOrClickProvider } from './CanvasPanOrClickProvider'

import type { BranchDropTargets } from '@/lib/layout/branchDropInteraction'
import { BranchDropHints } from './BranchDropHints'
import { SameSymbolAddMorePreview } from './SameSymbolAddMorePreview'
import type { validateEendraadPreview } from '@/hooks/eendraad/validateEendraadPreview'
import { BranchInsertionPreview } from './BranchInsertionPreview'
import { InsertionPreviewChunk } from './InsertionPreviewChunk'

import type {
  useEendraadLayout,
  useEendraadWireSegments,
  useLayoutTree,
  useChangeoverGridSourcePreview,
} from '@/hooks/eendraad'
import { ChangeoverGridSourcePreviewArtwork } from './ChangeoverGridSourcePreviewArtwork'

import type { useEendraadPreviewGraph } from '@/hooks/eendraad/useEendraadPreviewGraph'

import type { LayoutNode } from '@/lib/layout/layoutTree'

import type { DropZoneHintRelocation } from '@/lib/layout/collectDropZoneHints'
import { findDropTargetWithDebug, getHitZoneBounds } from '@/lib/layout/findDropTarget'

import { TrunkBranchSlotPreview } from '@/components/canvas/eendraad/TrunkBranchSlotPreview'

import { ENCLOSURE_SEPARATOR_HALF_LENGTH } from '@/lib/layout/enclosureSeparatorGeometry'

import type { SymbolMetadata } from '@/lib/symbols'

import { getPanelDiagramId, type BottomUpPanelLayout } from '@/lib/layout/bottomUpLayout'
import {
  getAddedPreviewWireSegments,
  getChangedPreviewWireSegments,
  getPreviewCircuitTranslation,
  getPreviewPanelTranslation,
} from '@/lib/layout/eendraadPreviewWires'
import { resolvePanelAttachmentPreviewGeometry } from '@/lib/layout/panelAttachmentPreview'
import {
  getProtectionPreviewBusSegments,
  isSecondaryBusPreviewTarget,
  resolveProtectionNestPreviewCircuitId,
  usesStructuralDropPreview,
} from '@/lib/layout/eendraadPreviewTarget'
import {
  DOMOTICA_BRANCH_LEAD,
  DOMOTICA_MAX_ENDPOINT_OUTPUTS,
  DOMOTICA_OUTPUT_SPACING,
} from '@/lib/domoticaLayout'

import { BoundedCanvasPreview } from '../shared/BoundedCanvasPreview'
import { ViewportMountedDiagram } from './ViewportMountedDiagram'
import { indexDiagramSceneMounting } from '@/lib/eendraad/diagramSceneMounting'
import { buildDiagramOverview } from '@/lib/eendraad/diagramOverview'
import { DiagramAuxiliaryNodes, DiagramOverview } from './DiagramOverview'

import { type queryOneWireNotes, queryOneWireFrames } from '@/lib/projectV2/annotations'

import type {
  ComponentProps,
  Dispatch,
  RefObject,
  SetStateAction,
} from 'react'
import { type getSupplySeparatorsForDiagram, getChangedSupplySeparatorsForDiagram } from '@/lib/layout/supplySeparatorSceneGeometry'

type ViewportUIState = ReturnType<ReturnType<typeof useViewportUIApi>['getState']>
type NodeProps = ComponentProps<typeof RenderNode>
interface EendraadSceneArtworkOptions extends Pick<ProjectState,
  'getEndpointById' | 'getFramesByPanel' | 'getPanelById' | 'getProtectionById'> {
  activeDropTargetNodeId: string | null
  activePlacementSymbol: SymbolMetadata | null
  advancedPanelLabels: boolean
  altDuplicatePointerDragActive: boolean
  beginInteractiveOverlayPan: (clientX: number, clientY: number) => void
  branchDropTargets: BranchDropTargets | null
  canDragItems: boolean
  canPlaceSymbols: boolean
  canvasRef: RefObject<BaseCanvasHandle | null>
  changeoverGridSourcePreviewScene: ReturnType<typeof useChangeoverGridSourcePreview>
  currentProject: ProjectState['currentProject']
  describeEnclosureTransition: (transition: { from: string; to: string }) => string
  dragPreview: ReturnType<typeof validateEendraadPreview>
  eendraadNotes: ReturnType<typeof queryOneWireNotes>
  eendraadView: ViewportUIState['eendraadView']
  getCanvasPositionFromEvent: NonNullable<NodeProps['getCanvasPositionFromEvent']>
  internalDragPlacement: (DropZoneHintRelocation & { symbol: SymbolMetadata }) | null
  layout: ReturnType<typeof useEendraadLayout>
  layoutTree: ReturnType<typeof useLayoutTree>
  liveProtectionBusPreview: ReturnType<typeof resolveLiveProtectionBusPreview>
  previewGraph: ReturnType<typeof useEendraadPreviewGraph>
  selection: Selection
  setSeparatorTooltip: Dispatch<SetStateAction<{ text: string; clientX: number; clientY: number } | null>>
  shouldSuppressKonvaDragEnd: () => boolean
  showLegacyDragPreview: boolean
  showSimulatedDragPreview: boolean
  stableElementDragEnd: NonNullable<NodeProps['onElementDragEnd']>
  stableElementDragMove: NonNullable<NodeProps['onElementDragMove']>
  stableElementDragStart: NonNullable<NodeProps['onElementDragStart']>
  stableGroundDragEnd: () => void
  stableNoteDragEnd: (noteId: string, newPos: Point) => void
  supplySeparators: ReturnType<typeof getSupplySeparatorsForDiagram>
  t: ReturnType<typeof useTranslation>['t']
  trunkBranchSlotMarkerRef: RefObject<Konva.Circle | null>
  viewportUI: ReturnType<typeof useViewportUIApi>
  wireSegments: ReturnType<typeof useEendraadWireSegments>
}

function findEndpointRenderTarget(
  panelNodes: LayoutNode[],
  endpointId: string
): { node: LayoutNode; panelNode: LayoutNode } | null {
  const findInNode = (node: LayoutNode): LayoutNode | null => {
    if (node.type === 'endpoint' && node.domainId === endpointId) return node
    for (const child of node.children) {
      const found = findInNode(child)
      if (found) return found
    }
    return null
  }
  for (const panelNode of panelNodes) {
    const node = findInNode(panelNode)
    if (node) return { node, panelNode }
  }
  return null
}

export function useEendraadSceneArtwork({
  activeDropTargetNodeId,
  activePlacementSymbol,
  advancedPanelLabels,
  altDuplicatePointerDragActive,
  beginInteractiveOverlayPan,
  branchDropTargets,
  canDragItems,
  canPlaceSymbols,
  canvasRef,
  changeoverGridSourcePreviewScene,
  currentProject,
  describeEnclosureTransition,
  dragPreview,
  eendraadNotes,
  eendraadView,
  getCanvasPositionFromEvent,
  getEndpointById,
  getFramesByPanel,
  getPanelById,
  getProtectionById,
  internalDragPlacement,
  layout,
  layoutTree,
  liveProtectionBusPreview,
  previewGraph,
  selection,
  setSeparatorTooltip,
  shouldSuppressKonvaDragEnd,
  showLegacyDragPreview,
  showSimulatedDragPreview,
  stableElementDragEnd,
  stableElementDragMove,
  stableElementDragStart,
  stableGroundDragEnd,
  stableNoteDragEnd,
  supplySeparators,
  t,
  trunkBranchSlotMarkerRef,
  viewportUI,
  wireSegments,
}: EendraadSceneArtworkOptions) {
  const normalSceneArtworkRevision = useMemo(
    () => ({
      layout,
      layoutTree,
      wireSegments,
      currentProject,
      advancedPanelLabels,
      t,
      supplySeparators,
    }),
    [
      layout,
      layoutTree,
      wireSegments,
      currentProject,
      advancedPanelLabels,
      t,
      supplySeparators,
    ]
  )

  const diagramSceneMounting = useMemo(
    () => indexDiagramSceneMounting(layout?.panels ?? [], layoutTree?.panels ?? [], wireSegments),
    [layout, layoutTree, wireSegments]
  )
  const diagramOverviewModels = useMemo(() => {
    const models = new Map<string, NonNullable<ReturnType<typeof buildDiagramOverview>>>()
    if (!layout || !layoutTree || layout.panels.length <= 8) return models
    const wiresByDiagram = new Map<string, WireSegment[]>()
    for (const wire of wireSegments) {
      const id = wire.diagramId ?? wire.panelId
      let wires = wiresByDiagram.get(id)
      if (!wires) wiresByDiagram.set(id, wires = [])
      wires.push(wire)
    }
    for (const panelLayout of layout.panels) {
      if (panelLayout.frameRole === 'supply' || panelLayout.supplyChangeoverBranches ||
        panelLayout.supplyConverterBranch || (currentProject && queryOneWireFrames(currentProject)
          .filter((frame) => frame.panelId === panelLayout.panel.id).length > 0)) continue
      const id = getPanelDiagramId(panelLayout)
      const panelNode = layoutTree.panels.find((node) => node.diagramId === id)
      if (!panelNode) continue
      const model = buildDiagramOverview(panelNode, wiresByDiagram.get(id) ?? [])
      if (model) models.set(id, model)
    }
    return models
  }, [layout, layoutTree, wireSegments, currentProject])
  const selectedDiagramIds = useMemo(() => {
    const ids = new Set<string>()
    for (const id of [...selection.ids, ...(selection.wireAnchor ? [selection.wireAnchor] : [])]) {
      for (const diagramId of diagramSceneMounting.diagramIdsByEntityId.get(id) ?? []) {
        ids.add(diagramId)
      }
    }
    if (selection.type === 'frame') {
      for (const panel of layout?.panels ?? []) {
        if (getFramesByPanel(panel.panel.id).some((frame) => selection.ids.includes(frame.id))) {
          ids.add(getPanelDiagramId(panel))
        }
      }
    }
    if (selection.type === 'supply') {
      for (const panel of layout?.panels ?? []) {
        if (!selection.supplyPanelId || panel.panel.id === selection.supplyPanelId) {
          ids.add(getPanelDiagramId(panel))
        }
      }
    }
    return ids
  }, [diagramSceneMounting, selection, layout, getFramesByPanel])

  const normalScene = useMemo(() => {
    if (!layoutTree || !layout) return null
    const initialZoom = viewportUI.getState().eendraadView.zoom

    return (
      <>
        {layout.panels.map((panelLayout) => {
          const panelNode = layoutTree.panels.find(
            (p) => p.diagramId === getPanelDiagramId(panelLayout)
          )
          if (!panelNode) return null
          const overviewModel = diagramOverviewModels.get(getPanelDiagramId(panelLayout))
          const nodeProps = {
            translate: t, advancedPanelLabels, panelLayout, getProtectionById, getPanelById,
            getCanvasPositionFromEvent,
            onElementDragStart: canDragItems ? stableElementDragStart : undefined,
            shouldSuppressKonvaDragEnd: canDragItems ? shouldSuppressKonvaDragEnd : undefined,
            onElementDragMove: canDragItems ? stableElementDragMove : undefined,
            onElementDragEnd: canDragItems ? stableElementDragEnd : undefined,
            onGroundDragEnd: canDragItems ? stableGroundDragEnd : undefined,
          }

          return (
            <ViewportMountedDiagram
              key={getPanelDiagramId(panelLayout)}
              name={`panel-group-${getPanelDiagramId(panelLayout)}`}
              logicalBounds={
                diagramSceneMounting.boundsByDiagramId.get(getPanelDiagramId(panelLayout)) ??
                panelLayout.frame
              }
              boundsRevision={normalSceneArtworkRevision}
              virtualized={layout.panels.length > 8}
              initialZoom={initialZoom}
              forceMounted={selectedDiagramIds.has(getPanelDiagramId(panelLayout))}
              materializeForcedDetail={false}
              overview={overviewModel ? (
                <DiagramOverview model={overviewModel} panelLayout={panelLayout}
                  auxiliaryNodes={<DiagramAuxiliaryNodes nodes={overviewModel.auxiliaryNodes} nodeProps={nodeProps} />} />
              ) : undefined}
            >
              {/* Frames layer - render first so they appear under everything */}
              {panelLayout.frameRole !== 'supply' &&
                getFramesByPanel(panelLayout.panel.id).map((frame: Frame) => (
                  <FrameComponent key={frame.id} frame={frame} panelLayout={panelLayout} />
                ))}

              {/* Supply/panel dashed separator — behind wires and labels */}
              {supplySeparators
                .filter((separator) => separator.diagramId === getPanelDiagramId(panelLayout))
                .flatMap((separator) =>
                  separator.pieces.map((points, index) => (
                    <Line
                      key={`${separator.id}-${index}`}
                      points={points}
                      stroke="#6b7280"
                      strokeWidth={2.25}
                      dash={[4, 4]}
                      lineCap="round"
                      listening={false}
                    />
                  ))
                )}

              {/* Wire segments layer - render above frames/separator but below symbols */}
              <WireSegments
                panelId={panelLayout.panel.id}
                diagramId={getPanelDiagramId(panelLayout)}
                wireSegments={wireSegments}
              />

              {/* Tree-based element rendering */}
              <RenderNode node={panelNode} {...nodeProps} />

              {/* Small hover zones naming the two enclosures of each dashed transition */}
              {supplySeparators
                .filter(
                  (separator) =>
                    separator.transition != null &&
                    separator.diagramId === getPanelDiagramId(panelLayout)
                )
                .map((separator) => {
                  const long = ENCLOSURE_SEPARATOR_HALF_LENGTH * 2 + 4
                  const width = separator.horizontal ? 10 : long
                  const height = separator.horizontal ? long : 10
                  const text = describeEnclosureTransition(separator.transition!)
                  const show = (event: KonvaEventObject<MouseEvent>) =>
                    setSeparatorTooltip({
                      text,
                      clientX: event.evt.clientX,
                      clientY: event.evt.clientY,
                    })
                  return (
                    <Rect
                      key={`${separator.id}-hover`}
                      name="eendraad-enclosure-separator-hover"
                      x={separator.center.x - width / 2}
                      y={separator.center.y - height / 2}
                      width={width}
                      height={height}
                      fill="transparent"
                      onMouseEnter={show}
                      onMouseMove={show}
                      onMouseLeave={() => setSeparatorTooltip(null)}
                    />
                  )
                })}
            </ViewportMountedDiagram>
          )
        })}

        {/* Notes layer - render last so they appear on top of everything (above preview graph) */}
        {eendraadNotes.map((note) => (
          <NoteSymbol key={note.id} note={note} onDragEnd={stableNoteDragEnd} />
        ))}
      </>
    )
  }, [
    advancedPanelLabels,
    canDragItems,
    eendraadNotes,
    getCanvasPositionFromEvent,
    getFramesByPanel,
    getPanelById,
    getProtectionById,
    layout,
    layoutTree,
    normalSceneArtworkRevision,
    diagramSceneMounting,
    diagramOverviewModels,
    selectedDiagramIds,
    shouldSuppressKonvaDragEnd,
    stableElementDragEnd,
    stableElementDragMove,
    stableElementDragStart,
    stableGroundDragEnd,
    stableNoteDragEnd,
    supplySeparators,
    describeEnclosureTransition,
    t,
    wireSegments,
    viewportUI,
    setSeparatorTooltip,
  ])

  const selectedEndpointOverlay = useMemo(() => {
    if (
      selection.type !== 'endpoint' ||
      selection.ids.length !== 1 ||
      !layoutTree ||
      !layout
    ) {
      return null
    }
    const target = findEndpointRenderTarget(layoutTree.panels, selection.ids[0]!)
    if (!target) return null
    const panelLayout = layout.panels.find(
      (candidate) => getPanelDiagramId(candidate) === target.panelNode.diagramId
    )
    if (!panelLayout) return null
    return (
      <CanvasPanOrClickProvider onBeginPan={beginInteractiveOverlayPan}>
        <RenderNode
          node={target.node}
          translate={t}
          advancedPanelLabels={advancedPanelLabels}
          panelLayout={panelLayout}
          getProtectionById={getProtectionById}
          getPanelById={getPanelById}
          getCanvasPositionFromEvent={getCanvasPositionFromEvent}
          onElementDragStart={canDragItems ? stableElementDragStart : undefined}
          shouldSuppressKonvaDragEnd={canDragItems ? shouldSuppressKonvaDragEnd : undefined}
          onElementDragMove={canDragItems ? stableElementDragMove : undefined}
          onElementDragEnd={canDragItems ? stableElementDragEnd : undefined}
          onGroundDragEnd={canDragItems ? stableGroundDragEnd : undefined}
          renderSelectedEndpoint
        />
      </CanvasPanOrClickProvider>
    )
  }, [
    advancedPanelLabels,
    beginInteractiveOverlayPan,
    canDragItems,
    getCanvasPositionFromEvent,
    getPanelById,
    getProtectionById,
    layout,
    layoutTree,
    selection,
    shouldSuppressKonvaDragEnd,
    stableElementDragEnd,
    stableElementDragMove,
    stableElementDragStart,
    stableGroundDragEnd,
    t,
  ])

  const artworkPreview = useEendraadArtworkPreview(dragPreview, activeDropTargetNodeId)

  const simulatedDragArtwork = useMemo(
    () => (
      <BoundedCanvasPreview>
        {/* Ordinary drops show added ink; protection drops retain their dynamic bus preview. */}
        {showSimulatedDragPreview &&
          previewGraph &&
          previewGraph.affectedPanelIds
            .flatMap((panelId) =>
              previewGraph.layout.panels
                .filter((p: BottomUpPanelLayout) => p.panel.id === panelId)
                .map((previewPanelLayout) => ({ panelId, previewPanelLayout }))
            )
            .map(({ panelId, previewPanelLayout }) => {
              const diagramId = getPanelDiagramId(previewPanelLayout)
              const previewPanelNode = previewGraph.layoutTree.panels.find(
                (p: LayoutNode) => p.diagramId === diagramId
              )
              const currentPanelNode = layoutTree?.panels.find(
                (p: LayoutNode) => p.diagramId === diagramId
              )
              const currentPanelLayout = layout?.panels.find(
                (candidate) => getPanelDiagramId(candidate) === diagramId
              )
              if (!previewPanelLayout || !previewPanelNode) return null

              const previewPanelTranslation = getPreviewPanelTranslation(
                currentPanelLayout,
                previewPanelLayout
              )

              const showStructuralPreview = usesStructuralDropPreview(artworkPreview?.symbolData?.id, artworkPreview?.dropTarget)
              const hasDynamicProtectionPreview =
                previewGraph.createdProtectionIds.length > 0 || !!artworkPreview?.movingProtection
              const previewProtectionIds = new Set([
                ...previewGraph.createdProtectionIds,
                ...(artworkPreview?.movingProtection ? [artworkPreview.movingProtection.protectionId] : []),
              ])
              const includeGroundStem = artworkPreview?.dropTarget?.type === 'groundWire' || (
                artworkPreview?.dropTarget?.type === 'mainBus' &&
                (artworkPreview.symbolData?.id === 'earthing' || artworkPreview.symbolData?.id === 'earthing_separator')
              )
              // Collect nodes for newly created symbols (endpoints, protections, trunk devices).
              const createdNodes: LayoutNode[] = []
              const collectCreated = (node: LayoutNode) => {
                if (
                  (node.type === 'endpoint' &&
                    node.domainId &&
                    previewGraph.createdEndpointIds.includes(node.domainId)) ||
                  ((node.type === 'mcb' || node.type === 'rcd') &&
                    node.domainId &&
                    (previewGraph.createdProtectionIds.includes(node.domainId) ||
                      artworkPreview?.movingProtection?.protectionId === node.domainId)) ||
                  (node.type === 'trunkDevice' &&
                    node.domainId &&
                    previewGraph.createdTrunkDeviceIds.includes(node.domainId))
                ) {
                  createdNodes.push(node)
                }
                if (node.children && node.children.length > 0) {
                  node.children.forEach(collectCreated)
                }
              }
              collectCreated(previewPanelNode)
              const dropTarget = artworkPreview?.dropTarget
              const expandingDomoticaParentNode: LayoutNode | null =
                dropTarget?.domoticaOutput?.expands && dropTarget.endpointId
                  ? (() => {
                      let found: LayoutNode | null = null
                      const visit = (node: LayoutNode) => {
                        if (found) return
                        if (node.type === 'endpoint' && node.domainId === dropTarget.endpointId) {
                          found = node
                          return
                        }
                        node.children?.forEach(visit)
                      }
                      visit(previewPanelNode)
                      return found
                    })()
                  : null

              // Preview nodes are taken from the same simulated layout graph that
              // will be used after commit, including domotica output branches.
              const previewNodes: LayoutNode[] = []
              const seenNodeIds = new Set<string>()
              if (
                expandingDomoticaParentNode &&
                !seenNodeIds.has((expandingDomoticaParentNode as LayoutNode).id)
              ) {
                seenNodeIds.add((expandingDomoticaParentNode as LayoutNode).id)
                previewNodes.push(expandingDomoticaParentNode)
              }
              for (const node of createdNodes) {
                if (!seenNodeIds.has(node.id)) {
                  seenNodeIds.add(node.id)
                  previewNodes.push(node)
                }
              }
              const previewStroke = '#0284c7'
              const previewSeparatorStroke = '#38bdf8'
              const dashPattern = DRAG_PREVIEW_DASH
              const previewSupplySeparators = showStructuralPreview
                ? getChangedSupplySeparatorsForDiagram(
                    previewGraph.wireSegments,
                    wireSegments,
                    diagramId
                  )
                : []
              if (artworkPreview?.movingPanelAttachment) {
                const panelPreviewTarget =
                  artworkPreview.dropTarget?.type === 'mainBus' && artworkPreview.dropTarget.panelId
                    ? {
                        type: 'mainBus' as const,
                        panelId: artworkPreview.dropTarget.panelId,
                      }
                    : artworkPreview.dropTarget?.type === 'circuit' &&
                        artworkPreview.dropTarget.panelId &&
                        artworkPreview.dropTarget.circuitId
                      ? {
                          type: 'circuit' as const,
                          panelId: artworkPreview.dropTarget.panelId,
                          circuitId: artworkPreview.dropTarget.circuitId,
                        }
                      : artworkPreview.dropTarget?.type === 'rcd' &&
                          artworkPreview.dropTarget.panelId &&
                          artworkPreview.dropTarget.protectionId
                        ? {
                            type: 'rcd' as const,
                            panelId: artworkPreview.dropTarget.panelId,
                            protectionId: artworkPreview.dropTarget.protectionId,
                          }
                        : null
                const geometry = panelPreviewTarget
                  ? resolvePanelAttachmentPreviewGeometry(
                      wireSegments,
                      panelPreviewTarget,
                      artworkPreview.position.x
                    )
                  : null

                // Never fall through to the generic changed-wire preview for a
                // panel move. A panel reflow can change almost every wire and
                // would render a second, ghost copy of the entire bus layout.
                if (!geometry || panelPreviewTarget?.panelId !== panelId) return null

                const { busSegment, busY, ghostX, symbolY } = geometry
                return (
                  <Group
                    key={`preview-panel-attachment-${diagramId}`}
                    name={`preview-panel-attachment-${panelId}`}
                    opacity={0.88}
                    listening={false}
                  >
                    <Line
                      points={[
                        busSegment.startPoint.x,
                        busSegment.startPoint.y,
                        busSegment.endPoint.x,
                        busSegment.endPoint.y,
                      ]}
                      stroke={previewStroke}
                      strokeWidth={DRAG_PREVIEW_HIGHLIGHT_WIDTH}
                      opacity={0.6}
                      lineCap="round"
                      listening={false}
                    />
                    <Line
                      points={[ghostX, busY, ghostX, symbolY + 14]}
                      stroke={previewStroke}
                      strokeWidth={DRAG_PREVIEW_WIRE_WIDTH}
                      dash={dashPattern}
                      lineCap="round"
                      listening={false}
                    />
                    <Rect
                      x={ghostX - 13}
                      y={symbolY}
                      width={26}
                      height={14}
                      stroke={previewStroke}
                      strokeWidth={2}
                      dash={dashPattern}
                      cornerRadius={3}
                      fill="rgba(59,130,246,0.12)"
                      listening={false}
                    />
                  </Group>
                )
              }

              const mainBusInsertIndex = dropTarget?.mainBusInsertIndex
              const isDomoticaOutputPreview =
                !!dropTarget?.domoticaOutput && !!dropTarget.endpointId && !!dropTarget.circuitId

              // Special-case: when inserting a protection on the main or
              // secondary bus, show a very explicit ghost (highlighted bus
              // segment + vertical line + box) at the resolved insertion slot.
              const isMainBusProtectionPreview =
                !showStructuralPreview && dropTarget?.type === 'mainBus' && previewGraph.createdProtectionIds.length > 0
              const isSecondaryBusProtectionPreview =
                isSecondaryBusPreviewTarget(dropTarget) && hasDynamicProtectionPreview && !showStructuralPreview

              const shouldUseMainBusInsertionGhost =
                isMainBusProtectionPreview &&
                typeof mainBusInsertIndex === 'number' &&
                typeof dropTarget.mainBusItemCount === 'number'
              const nestCircuitIdAtCursor = (() => {
                if (!layoutTree || !artworkPreview?.position) return undefined
                const matched = findDropTargetWithDebug(
                  layoutTree,
                  artworkPreview.position
                ).debug.path.find(
                  (step) => step.matched && step.nodeId?.startsWith('circuit-nest-')
                )
                const id = matched?.nodeId?.slice('circuit-nest-'.length)
                return id && id.length > 0 ? id : undefined
              })()

              const nestCircuitIdForPreview = resolveProtectionNestPreviewCircuitId(
                dropTarget,
                nestCircuitIdAtCursor
              )

              const isProtectionNestOnCircuitPreview =
                !!nestCircuitIdForPreview && previewGraph.createdProtectionIds.length > 0

              const nestedPreviewOffsetX = (() => {
                if (
                  dropTarget?.insertBeforeNestedCircuitId ||
                  !isProtectionNestOnCircuitPreview ||
                  !nestCircuitIdForPreview ||
                  isSecondaryBusProtectionPreview ||
                  !currentPanelNode
                ) {
                  return 0
                }

                const createdProtectionNode = previewNodes.find(
                  (node) =>
                    (node.type === 'mcb' || node.type === 'rcd') &&
                    !!node.domainId &&
                    previewGraph.createdProtectionIds.includes(node.domainId)
                )
                if (!createdProtectionNode) return 0

                const currentMatch: {
                  nest: LayoutNode | null
                  protection: LayoutNode | null
                } = { nest: null, protection: null }
                const visit = (node: LayoutNode) => {
                  if (node.id === `circuit-nest-${nestCircuitIdForPreview}`) {
                    currentMatch.nest = node
                  }
                  if (
                    (node.type === 'mcb' || node.type === 'rcd') &&
                    node.circuitIdForWires === nestCircuitIdForPreview
                  ) {
                    currentMatch.protection = node
                  }
                  node.children?.forEach(visit)
                }
                visit(currentPanelNode)
                if (currentMatch.protection) {
                  return currentMatch.protection.bounds.x - createdProtectionNode.bounds.x
                }
                if (!currentMatch.nest) return 0

                const currentNestBounds = getHitZoneBounds(currentMatch.nest, 'core')
                const currentAttachX = (currentNestBounds.left + currentNestBounds.right) / 2
                return currentAttachX - createdProtectionNode.bounds.x
              })()

              const circuitPreviewTranslation = !showStructuralPreview && !previewProtectionIds.size
                ? getPreviewCircuitTranslation(currentPanelNode, previewPanelNode, dropTarget?.circuitId)
                : { x: 0, y: 0 }
              const localPreviewTranslation = {
                x: nestedPreviewOffsetX + previewPanelTranslation.x + circuitPreviewTranslation.x,
                y: previewPanelTranslation.y + circuitPreviewTranslation.y,
              }
              const previewWiresForPanel = showStructuralPreview
                ? getChangedPreviewWireSegments(previewGraph.wireSegments, wireSegments, panelId, previewPanelNode, diagramId)
                : getAddedPreviewWireSegments(
                    previewGraph.wireSegments.filter((segment) => segment.panelId === panelId &&
                      (segment.diagramId ?? segment.panelId) === diagramId),
                    wireSegments,
                    new Set([...previewGraph.createdEndpointIds, ...previewGraph.createdTrunkDeviceIds, ...previewProtectionIds]),
                    {
                      translation: localPreviewTranslation,
                      includeGroundStem,
                      previewProtectionIds,
                    }
                  )

              if (
                previewWiresForPanel.length === 0 &&
                previewNodes.length === 0 &&
                previewSupplySeparators.length === 0
              ) {
                return null
              }

              if (isDomoticaOutputPreview) {
                const currentDomoticaWires = wireSegments
                  .filter(
                    (ws) =>
                      ws.panelId === panelId &&
                      ws.circuitId === dropTarget.circuitId &&
                      ws.type === 'branch' &&
                      ws.fromElementId === dropTarget.endpointId
                  )
                  .sort((a, b) => a.startPoint.y - b.startPoint.y)
                const bottomWire = currentDomoticaWires[currentDomoticaWires.length - 1]
                const targetWire =
                  currentDomoticaWires.find(
                    (ws) => ws.domoticaOutputIndex === dropTarget.domoticaOutput?.index
                  ) ?? currentDomoticaWires[dropTarget.domoticaOutput!.index]
                const allCurrentRowsOccupied =
                  currentDomoticaWires.length > 0 &&
                  currentDomoticaWires.every((ws) => !!ws.toElementId)
                const shouldRenderExpandPreview =
                  !!dropTarget.domoticaOutput?.expands ||
                  (allCurrentRowsOccupied &&
                    currentDomoticaWires.length < DOMOTICA_MAX_ENDPOINT_OUTPUTS &&
                    !!targetWire?.toElementId)
                if (!shouldRenderExpandPreview) {
                  // Non-expanding domotica output previews use the generic simulated graph.
                } else {
                  const anchorWire = dropTarget.domoticaOutput?.expands ? bottomWire : targetWire
                  if (!anchorWire) return null

                  const outputStartX = anchorWire.startPoint.x
                  const outputY = dropTarget.domoticaOutput?.expands
                    ? anchorWire.startPoint.y + DOMOTICA_OUTPUT_SPACING
                    : anchorWire.startPoint.y - DOMOTICA_OUTPUT_SPACING
                  const ghostX = outputStartX + DOMOTICA_BRANCH_LEAD
                  const ghostSize = SYMBOL_SIZE
                  const expandCueHeight = Math.max(12, DOMOTICA_OUTPUT_SPACING - 4)
                  const domoticaParentPreviewNode: LayoutNode | null = (() => {
                    let found: LayoutNode | null = null
                    const visit = (node: LayoutNode) => {
                      if (found) return
                      if (node.type === 'endpoint' && node.domainId === dropTarget.endpointId) {
                        found = node
                        return
                      }
                      node.children?.forEach(visit)
                    }
                    visit(previewPanelNode)
                    return found
                  })()

                  return (
                    <Group
                      key={`preview-panel-${diagramId}`}
                      name={`preview-panel-${panelId}`}
                      opacity={0.85}
                      listening={false}
                    >
                      {domoticaParentPreviewNode &&
                        (() => {
                          const { x, y, width, height } = (domoticaParentPreviewNode as LayoutNode)
                            .bounds
                          const inset = 2
                          const adjWidth = Math.max(0, width - inset * 2)
                          const adjHeight = Math.max(0, height - inset * 2)
                          return (
                            <Rect
                              key={`preview-node-${(domoticaParentPreviewNode as LayoutNode).id}`}
                              x={x - adjWidth / 2}
                              y={y - adjHeight / 2}
                              width={adjWidth}
                              height={adjHeight}
                              stroke={previewStroke}
                              strokeWidth={2}
                              dash={dashPattern}
                              cornerRadius={4}
                              fill="rgba(59,130,246,0.08)"
                              listening={false}
                            />
                          )
                        })()}
                      <Rect
                        x={outputStartX - 6}
                        y={outputY - expandCueHeight / 2}
                        width={12}
                        height={expandCueHeight}
                        stroke={previewStroke}
                        strokeWidth={2}
                        dash={dashPattern}
                        cornerRadius={6}
                        fill="rgba(59,130,246,0.16)"
                        listening={false}
                      />
                      <Circle
                        x={outputStartX}
                        y={outputY}
                        radius={4}
                        fill={previewStroke}
                        opacity={0.9}
                        listening={false}
                      />
                      <Line
                        points={[outputStartX, outputY, ghostX, outputY]}
                        stroke={previewStroke}
                        strokeWidth={DRAG_PREVIEW_WIRE_WIDTH}
                        dash={dashPattern}
                        lineCap="round"
                        lineJoin="round"
                        listening={false}
                      />
                      <Rect
                        x={ghostX - ghostSize / 2}
                        y={outputY - ghostSize / 2}
                        width={ghostSize}
                        height={ghostSize}
                        stroke={previewStroke}
                        strokeWidth={2}
                        dash={dashPattern}
                        cornerRadius={4}
                        fill="rgba(59,130,246,0.12)"
                        listening={false}
                      />
                    </Group>
                  )
                }
              }

              if (dropTarget && (
                (isMainBusProtectionPreview && !nestCircuitIdAtCursor) ||
                isSecondaryBusProtectionPreview
              )) {
                const createdProtectionNode = previewNodes.find(
                  (node) =>
                    (node.type === 'mcb' || node.type === 'rcd') &&
                    !!node.domainId &&
                    (previewGraph.createdProtectionIds.includes(node.domainId) ||
                      artworkPreview?.movingProtection?.protectionId === node.domainId)
                )
                const busSegments = getProtectionPreviewBusSegments(
                  previewGraph.wireSegments, dropTarget, diagramId
                )
                const realBusSegments = getProtectionPreviewBusSegments(wireSegments, dropTarget, diagramId)
                const segmentsForHighlight = realBusSegments.length > 0 ? realBusSegments : busSegments
                const artworkPreviewPosition = artworkPreview?.position
                // Hovering an existing protection body means "after this item";
                // keep that ghost clear of the symbol. Direct rail hovers follow X.
                const pointerOnSecondaryRail = isSecondaryBusProtectionPreview && artworkPreviewPosition &&
                  segmentsForHighlight[0] &&
                  Math.abs(artworkPreviewPosition.y - segmentsForHighlight[0].startPoint.y) <= 20
                const shouldUseInsertionGhost = shouldUseMainBusInsertionGhost || pointerOnSecondaryRail
                const targetX = shouldUseInsertionGhost
                  ? artworkPreviewPosition?.x
                  : createdProtectionNode?.bounds.x

                // For insertion ghost, use REAL layout's bus segments (matches the
                // segments the drop logic will hit-test against) so the highlighted
                // segment and ghost X align with what the user actually clicks on.
                // The simulated layout has an extra ghost item which shifts its
                // segments away from the cursor's true position.
                const hitSegment =
                  (targetX != null
                    ? segmentsForHighlight.find((ws) => {
                        const minX = Math.min(ws.startPoint.x, ws.endPoint.x)
                        const maxX = Math.max(ws.startPoint.x, ws.endPoint.x)
                        return targetX >= minX && targetX <= maxX
                      })
                    : undefined) ??
                  (targetX != null && segmentsForHighlight.length > 0
                    ? [...segmentsForHighlight].sort((a, b) => {
                        const aMid = (a.startPoint.x + a.endPoint.x) / 2
                        const bMid = (b.startPoint.x + b.endPoint.x) / 2
                        return Math.abs(aMid - targetX) - Math.abs(bMid - targetX)
                      })[0]
                    : undefined)

                const busY = hitSegment?.startPoint.y ?? previewPanelLayout.mainBus.y
                // Approximate the real MCB geometry: short vertical from bus to symbol,
                // and a nearly square symbol box.
                const verticalLen = 40
                const symbolHeight = 20
                const symbolWidth = 20
                const symbolCenterY = busY - verticalLen
                // Follow the pointer on either rail; the slot still determines
                // insertion order and the simulated graph stays cached within it.
                const ghostCenterX = shouldUseInsertionGhost
                  ? (targetX ??
                    (hitSegment ? (hitSegment.startPoint.x + hitSegment.endPoint.x) / 2 : 0))
                  : (createdProtectionNode?.bounds.x ?? targetX)

                if (ghostCenterX == null) {
                  return null
                }

                return (
                  <Group
                    key={`preview-panel-${diagramId}`}
                    name={`preview-panel-${panelId}`}
                    opacity={0.85}
                    listening={false}
                  >
                    {/* Show the live rail; extend only as far as the pointer's new connection. */}
                    {isSecondaryBusProtectionPreview &&
                      segmentsForHighlight.map((ws) => (
                        <Line
                          key={`preview-extended-secondary-bus-${ws.id}`}
                          name="eendraad-preview-secondary-bus"
                          points={[ws.startPoint.x, ws.startPoint.y, ws.endPoint.x, ws.endPoint.y]}
                          stroke={previewStroke}
                          strokeWidth={DRAG_PREVIEW_BUS_WIDTH}
                          opacity={0.6}
                          listening={false}
                        />
                      ))}
                    {isSecondaryBusProtectionPreview && segmentsForHighlight.length > 0 && (() => {
                      const left = Math.min(...segmentsForHighlight.flatMap((ws) => [ws.startPoint.x, ws.endPoint.x]))
                      const right = Math.max(...segmentsForHighlight.flatMap((ws) => [ws.startPoint.x, ws.endPoint.x]))
                      const edge = ghostCenterX < left ? left : ghostCenterX > right ? right : null
                      return edge == null ? null : <Line
                        name="eendraad-preview-secondary-bus"
                        points={[edge, busY, ghostCenterX, busY]}
                        stroke={previewStroke}
                        strokeWidth={DRAG_PREVIEW_BUS_WIDTH}
                        opacity={0.6}
                        listening={false}
                      />
                    })()}

                    {/* Highlight the busbar segment we're inserting on */}
                    {hitSegment && (
                      <Line
                        points={[
                          hitSegment.startPoint.x,
                          hitSegment.startPoint.y,
                          hitSegment.endPoint.x,
                          hitSegment.endPoint.y,
                        ]}
                        stroke={previewStroke}
                        strokeWidth={DRAG_PREVIEW_HIGHLIGHT_WIDTH}
                        opacity={0.6}
                        listening={false}
                      />
                    )}

                    {/* Vertical preview wire from bus to protection */}
                    <Line
                      points={[ghostCenterX, busY, ghostCenterX, symbolCenterY + symbolHeight]}
                      stroke={previewStroke}
                      strokeWidth={DRAG_PREVIEW_WIRE_WIDTH}
                      dash={dashPattern}
                      lineCap="round"
                      lineJoin="round"
                      listening={false}
                    />

                    {/* Vertical preview wire from protection to empty top */}
                    <Line
                      points={[ghostCenterX, symbolCenterY, ghostCenterX, symbolCenterY - 70]}
                      stroke={previewStroke}
                      strokeWidth={DRAG_PREVIEW_WIRE_WIDTH}
                      dash={dashPattern}
                      lineCap="round"
                      lineJoin="round"
                      listening={false}
                    />

                    {/* Protection ghost box, centered on symbolCenterY */}
                    <Rect
                      name={artworkPreview?.movingProtection
                        ? 'eendraad-preview-moved-protection' : 'eendraad-preview-created-protection'}
                      x={ghostCenterX - symbolWidth / 2}
                      y={symbolCenterY}
                      width={symbolWidth}
                      height={symbolWidth}
                      stroke={previewStroke}
                      strokeWidth={2}
                      dash={dashPattern}
                      cornerRadius={4}
                      fill="rgba(59,130,246,0.12)"
                      listening={false}
                    />
                  </Group>
                )
              }

              return (
                <Group
                  key={`preview-panel-${diagramId}`}
                  name={`preview-panel-${panelId}`}
                  x={localPreviewTranslation.x}
                  y={localPreviewTranslation.y}
                  opacity={0.8}
                  listening={false}
                >
                  {previewSupplySeparators.flatMap((separator) =>
                    separator.pieces.map((points, index) => (
                      <Line
                        key={`preview-${separator.id}-${index}`}
                        name="eendraad-preview-supply-separator"
                        points={points}
                        stroke={previewSeparatorStroke}
                        strokeWidth={4}
                        dash={[5, 5]}
                        opacity={0.95}
                        lineCap="round"
                        listening={false}
                      />
                    ))
                  )}

                  {previewWiresForPanel.map((ws) => {
                    const isThick = ws.type === 'trunk' || ws.type === 'mainBus'
                    return (
                      <Line
                        key={`preview-wire-${ws.id}`}
                        name="eendraad-preview-added-wire"
                        points={[ws.startPoint.x, ws.startPoint.y, ws.endPoint.x, ws.endPoint.y]}
                        stroke={previewStroke}
                        strokeWidth={isThick ? DRAG_PREVIEW_BUS_WIDTH : DRAG_PREVIEW_WIRE_WIDTH}
                        dash={dashPattern}
                        lineCap="round"
                        lineJoin="round"
                        listening={false}
                      />
                    )
                  })}

                  {previewNodes.map((node) => {
                    const { x, y, width, height } = node.bounds
                    const inset = 4
                    const adjWidth = Math.max(0, width - inset * 2)
                    const adjHeight = Math.max(0, height - inset * 2)
                    const rectX = x - adjWidth / 2
                    const rectY = y - adjHeight / 2

                    return (
                      <InsertionPreviewChunk
                        key={`preview-node-${node.id}`}
                        name={
                          node.domainId && previewGraph.createdProtectionIds.includes(node.domainId)
                            ? 'eendraad-preview-created-protection'
                            : artworkPreview?.movingProtection?.protectionId === node.domainId
                              ? 'eendraad-preview-moved-protection'
                              : 'eendraad-preview-created-symbol'
                        }
                        x={rectX}
                        y={rectY}
                        width={adjWidth}
                        height={adjHeight}
                      />
                    )
                  })}
                </Group>
              )
            })}
      </BoundedCanvasPreview>
    ),
    [artworkPreview, layout, layoutTree, previewGraph, showSimulatedDragPreview, wireSegments]
  )

  // Keep pointer-driven decorations off the dense diagram's scene canvas.
  // Both layers use the same camera; these shapes never participate in hit testing.
  const canvasDragArtwork = useMemo(
    () => (
      <Group name="canvas-drag-artwork" listening={false}>
        {layout?.panels.flatMap((panel) => panel.branches.filter((branch) => branch.forkFrom && !branch.endpoints.length)
          .map((branch) => <Circle key={`empty-fork-${branch.id}`} name={`empty-onewire-fork-${branch.storedBranchId}`}
            x={branch.branchX + branch.branchWidth} y={branch.branchY} radius={3.5} stroke="#0284c7" fill="#e0f2fe" strokeWidth={1} />))}
        {simulatedDragArtwork}
        <OneWireDragGhost layout={layout} layoutTree={layoutTree} wireSegments={wireSegments} translate={t}
          advancedPanelLabels={advancedPanelLabels} getProtectionById={getProtectionById} getPanelById={getPanelById} />
        {artworkPreview?.sameSymbolAddMore && <SameSymbolAddMorePreview
          target={artworkPreview.sameSymbolAddMore}
          increment={artworkPreview.movingEndpointSelection
            ? Math.max(1, getEndpointById(artworkPreview.movingEndpointSelection.draggedEndpointId)?.placements.length ?? 1) : 1}
          zoom={canvasRef.current?.getLiveViewTransform().zoom ?? eendraadView.zoom} />}
        {layout && artworkPreview?.branchIntent && <BranchInsertionPreview
          layout={layout} intent={artworkPreview.branchIntent} project={currentProject} preview={artworkPreview} />}
        {branchDropTargets && <BranchDropHints targets={branchDropTargets}
          activeId={artworkPreview?.branchIntent?.id ?? null}
          zoom={canvasRef.current?.getLiveViewTransform().zoom ?? eendraadView.zoom} />}

        {/* Drop-zone hints: legal targets while dragging from the library */}
        {canPlaceSymbols && activePlacementSymbol && !dragPreview?.trunkBranchSlot && (
          <DropZoneHintsOverlay
            layoutTree={layoutTree}
            project={currentProject}
            symbol={artworkPreview?.symbolData ?? activePlacementSymbol}
            activeDropTarget={artworkPreview?.dropTarget ?? null}
            activeDropTargetNodeId={activeDropTargetNodeId}
            activeSameSymbolTargetNodeId={artworkPreview?.sameSymbolAddMore?.nodeId ?? null}
            activePosition={artworkPreview?.position ?? null}
            relocation={internalDragPlacement}
            branchEndpointNodeIds={branchDropTargets?.endpointNodeIds}
            branchCircuitIds={branchDropTargets?.circuitIds}
            movingPanelAttachmentId={
              internalDragPlacement?.elementId ?? dragPreview?.movingPanelAttachment?.panelId
            }
          />
        )}

        {canPlaceSymbols && liveProtectionBusPreview && (
          <BoundedCanvasPreview>
            <LiveProtectionBusPreview geometry={liveProtectionBusPreview} />
          </BoundedCanvasPreview>
        )}

        {/* Legacy drag preview fallback when simulated preview graph is unavailable. */}
        {canPlaceSymbols && showLegacyDragPreview && dragPreview && (
          <BoundedCanvasPreview>
            <DragPreview
              position={dragPreview.position}
              dropTarget={dragPreview.dropTarget}
              layout={layout}
              wireSegments={wireSegments}
              symbolData={dragPreview.symbolData}
              showMainBusPositionMarker={!dragPreview.movingProtection}
            />
          </BoundedCanvasPreview>
        )}

        {/* Pointer-follow icon (Alt-duplicate); library drag uses HTML5 setDragImage instead. */}
        {canPlaceSymbols &&
          altDuplicatePointerDragActive &&
          dragPreview?.symbolData &&
          dragPreview.position.x !== -Infinity && (
            <BoundedCanvasPreview>
              <DragCursorSymbol
                position={dragPreview.position}
                symbolData={dragPreview.symbolData}
              />
            </BoundedCanvasPreview>
          )}
        {import.meta.env.DEV && (
          <HitZoneDebugOverlay layoutTree={layoutTree} dragPreview={dragPreview} />
        )}
      </Group>
    ),
    [
      getEndpointById,
      activeDropTargetNodeId,
      activePlacementSymbol,
      branchDropTargets,
      eendraadView.zoom,
      altDuplicatePointerDragActive,
      artworkPreview,
      canPlaceSymbols,
      currentProject,
      dragPreview,
      internalDragPlacement,
      layout,
      layoutTree,
      showLegacyDragPreview,
      liveProtectionBusPreview,
      simulatedDragArtwork,
      wireSegments,
      canvasRef,
      t,
      advancedPanelLabels,
      getProtectionById,
      getPanelById,
    ]
  )

  const canvasInteractionOverlay = useMemo(
    () => (
      <>
        {canvasDragArtwork}
        {changeoverGridSourcePreviewScene && (
          <BoundedCanvasPreview>
            <ChangeoverGridSourcePreviewArtwork scene={changeoverGridSourcePreviewScene} />
          </BoundedCanvasPreview>
        )}
        {selectedEndpointOverlay}
        {dragPreview?.trunkBranchSlot && (
          <BoundedCanvasPreview>
            <TrunkBranchSlotPreview
              slot={dragPreview.trunkBranchSlot}
              markerRef={trunkBranchSlotMarkerRef}
            />
          </BoundedCanvasPreview>
        )}
      </>
    ),
    [canvasDragArtwork, changeoverGridSourcePreviewScene, dragPreview, selectedEndpointOverlay, trunkBranchSlotMarkerRef]
  )

  return { normalScene, canvasInteractionOverlay }
}
