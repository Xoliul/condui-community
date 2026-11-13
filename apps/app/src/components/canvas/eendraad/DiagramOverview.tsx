import { memo, useContext, useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react'
import type Konva from 'konva'
import { Group, Line, Rect, Shape } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { buildDiagramOverview } from '@/lib/eendraad/diagramOverview'
import type { LayoutNode } from '@/lib/layout/layoutTree'
import type { BottomUpPanelLayout } from '@/lib/layout/bottomUpLayout'
import { useThemeColors } from '@/lib/theme/hooks'
import { PanelFrame } from './PanelFrame'
import RenderNode from './RenderNode'
import { OverviewPrecisionContext, useOverviewInteraction } from './OverviewInteractionContext'

/** Auxiliary subtrees are constructed only after the overview itself mounts. */
export function DiagramAuxiliaryNodes({ nodes, nodeProps }: {
  nodes: readonly LayoutNode[]
  nodeProps: Omit<ComponentProps<typeof RenderNode>, 'node'>
}) {
  return nodes.map((node) => <RenderNode key={node.id} node={node} {...nodeProps} />)
}

/** Transparent proxies need native hit drawing and geometry, but no scene rasterization. */
function OverviewHitTargets({ children }: { children: ReactNode }) {
  const groupRef = useRef<Konva.Group>(null)
  useLayoutEffect(() => {
    const group = groupRef.current
    if (!group) return
    const originalDrawScene = group.drawScene
    const skipScene: Konva.Group['drawScene'] = function (this: Konva.Group) {
      return this
    }
    group.drawScene = skipScene
    return () => {
      if (group.drawScene === skipScene) group.drawScene = originalDrawScene
    }
  }, [])
  return (
    <Group ref={groupRef} name="onewire-overview-hit-targets">
      {children}
    </Group>
  )
}

/** Tiny diagrams retain their topology and named hit proxies without thousands of text/image nodes. */
export function DiagramOverview({
  model,
  panelLayout,
  auxiliaryNodes,
}: {
  model: NonNullable<ReturnType<typeof buildDiagramOverview>>
  panelLayout: BottomUpPanelLayout
  auxiliaryNodes?: ReactNode
}) {
  const precise = useContext(OverviewPrecisionContext)
  return (
    <PanelFrame panelLayout={panelLayout} overview coarseHit={!precise}>
      <DiagramOverviewArtwork model={model} precise={precise} />
      {precise ? auxiliaryNodes : null}
    </PanelFrame>
  )
}

// Selection rebuilds the outer scene's bindings. Keep thousands of unchanged
// overview hit targets out of that reconciliation; their forwarding owner is stable.
const DiagramOverviewArtwork = memo(function DiagramOverviewArtwork({ model, precise }: {
  model: NonNullable<ReturnType<typeof buildDiagramOverview>>
  precise: boolean
}) {
  const colors = useThemeColors()
  const forward = useOverviewInteraction()
  const events = (targetName: string) => ({
    onClick: (event: KonvaEventObject<MouseEvent>) => forward(targetName, event),
    onTap: (event: KonvaEventObject<TouchEvent>) => forward(targetName, event),
    onDblClick: (event: KonvaEventObject<MouseEvent>) => forward(targetName, event),
    onDblTap: (event: KonvaEventObject<TouchEvent>) => forward(targetName, event),
    onContextMenu: (event: KonvaEventObject<PointerEvent>) => forward(targetName, event),
  })
  return (
      <Group name="onewire-diagram-overview">
        <Shape
          name="onewire-overview-topology"
          listening={false}
          perfectDrawEnabled={false}
          sceneFunc={(context) => {
            context.beginPath()
            context.strokeStyle = colors.wireColor
            context.lineWidth = 2
            for (const wire of model.wires) {
              context.moveTo(wire.startPoint.x, wire.startPoint.y)
              context.lineTo(wire.endPoint.x, wire.endPoint.y)
            }
            context.stroke()
            context.beginPath()
            context.strokeStyle = colors.symbolColor
            context.lineWidth = 1
            for (const symbol of precise ? model.symbols : model.coarseSymbols) {
              context.rect(symbol.x + 5, symbol.y + 5, symbol.width - 10, symbol.height - 10)
            }
            context.stroke()
          }}
        />
        {precise && <OverviewHitTargets>
          {model.wires.map((wire) => {
            const bus = wire.type === 'mainBus' || wire.type === 'secondaryBus'
            if (bus && !wire.busSectionId && !wire.wireBusGroup) return null
            return (
              <Line
                key={wire.id}
                name={`wire-${wire.id}`}
                points={[wire.startPoint.x, wire.startPoint.y, wire.endPoint.x, wire.endPoint.y]}
                stroke="transparent"
                strokeWidth={10}
                {...events(`wireHit-${wire.id}`)}
              />
            )
          })}
          {model.symbols.map((symbol) => (
            <Rect
              key={symbol.targetName}
              name={symbol.targetName}
              x={symbol.x}
              y={symbol.y}
              width={symbol.width}
              height={symbol.height}
              fill="transparent"
              {...events(symbol.targetName)}
            />
          ))}
        </OverviewHitTargets>}
      </Group>
  )
})
