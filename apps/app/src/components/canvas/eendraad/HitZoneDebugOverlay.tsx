import { useMemo } from 'react'
import { Group, Rect } from 'react-konva'
import type { LayoutTree, LayoutNode } from '@/lib/layout/layoutTree'
import { findDropTargetWithDebug, getHitZoneBounds, type HitBounds } from '@/lib/layout/findDropTarget'
import type { DragPreviewState } from '@/hooks/eendraad'
import { useSettingsStore } from '@/stores/settingsStore'

interface HitZoneDebugOverlayProps {
  layoutTree: LayoutTree | null
  dragPreview: DragPreviewState | null
}

interface DebugNodeInfo {
  nodeId: string
  boundsCore: HitBounds
  boundsPadded: HitBounds
  hitZoneType: string
}

const HITZONE_COLORS: Record<string, string> = {
  supplyBranchDevice: '#14b8a6', // teal: converter/battery/PV symbol selection area
  endpoint: '#22c55e', // green
  circuit: '#0284c7', // blue
  mainBus: '#f97316', // orange
  rcd: '#8b5cf6', // violet
  protection: '#0ea5e9', // cyan
  supplyWire: '#a855f7', // purple
  supplyBackupWire: '#db2777', // pink: empty converter slot
  supplyBackupOutputWire: '#0891b2', // cyan: converter backup output
  supplyChangeoverGridWire: '#16a34a', // green: changeover grid-only lower lane
  supplyConverterGridWire: '#dc2626', // red: converter grid input
  supplyConverterBackupWire: '#65a30d', // lime: standalone converter backup output
  supplyConverterDcWire: '#f59e0b', // amber: converter battery/PV DC
  groundWire: '#ca8a04', // amber
  endpointBefore: '#f97316', // orange: insert before Domotica child
  endpointAfter: '#a855f7', // purple: insert after Domotica child
}

function collectDebugNodes(layoutTree: LayoutTree): DebugNodeInfo[] {
  const nodes: DebugNodeInfo[] = []

  const visit = (node: LayoutNode) => {
    if (node.hitZone?.type) {
      const boundsCore = getHitZoneBounds(node, 'core')
      const boundsPadded = getHitZoneBounds(node, 'padded')
      nodes.push({
        nodeId: node.id,
        boundsCore,
        boundsPadded,
        hitZoneType:
          node.hitZone.domoticaChildDropIntent === 'insertBefore'
            ? 'endpointBefore'
            : node.hitZone.domoticaChildDropIntent === 'insertAfter'
              ? 'endpointAfter'
              : node.hitZone.type,
      })
    } else if (
      node.type === 'trunkDevice' &&
      (node.domainRef as { supplyPath?: string } | undefined)?.supplyPath &&
      ['backup', 'converter-branch', 'converter-dc', 'converter-dc-top'].includes(
        (node.domainRef as { supplyPath: string }).supplyPath
      )
    ) {
      const boundsCore = getHitZoneBounds(node, 'core')
      nodes.push({
        nodeId: node.id,
        boundsCore,
        boundsPadded: boundsCore,
        hitZoneType: 'supplyBranchDevice',
      })
    } else if (node.id.startsWith('supply-direct-converter-dc-wire-')) {
      const boundsCore = getHitZoneBounds(node, 'core')
      nodes.push({
        nodeId: node.id,
        boundsCore,
        boundsPadded: boundsCore,
        hitZoneType: 'supplyConverterDcWire',
      })
    }
    for (const child of node.children) {
      visit(child)
    }
  }

  for (const panel of layoutTree.panels) {
    visit(panel)
  }

  return nodes
}

export function HitZoneDebugOverlay({ layoutTree, dragPreview }: HitZoneDebugOverlayProps) {
  const debugSettingEnabled = useSettingsStore((s) => s.eendraadHitboxDebug)
  const enabled = import.meta.env.DEV && debugSettingEnabled

  const debugNodes = useMemo(() => {
    if (!layoutTree || !enabled) return []
    return collectDebugNodes(layoutTree)
  }, [layoutTree, enabled])

  const highlightedNodeId = useMemo(() => {
    if (!layoutTree || !dragPreview || !enabled) return null
    const { debug } = findDropTargetWithDebug(
      layoutTree,
      dragPreview.position,
      dragPreview.relocatingTrunkDevice ? { ignoreCircuitTrunkDeviceSymbolHits: true } : undefined,
    )
    const matched = debug.path.find((step) => step.matched && step.nodeId)
    return matched?.nodeId ?? null
  }, [layoutTree, dragPreview, enabled])

  if (!import.meta.env.DEV || !enabled || !layoutTree || debugNodes.length === 0) {
    return null
  }

  return (
    <Group listening={false}>
      {debugNodes.map((node) => {
        const isHighlighted = highlightedNodeId === node.nodeId
        const color =
          HITZONE_COLORS[node.hitZoneType] ??
          '#ef4444' // default red for unknown types

        const coreWidth = node.boundsCore.right - node.boundsCore.left
        const coreHeight = node.boundsCore.bottom - node.boundsCore.top
        const paddedWidth = node.boundsPadded.right - node.boundsPadded.left
        const paddedHeight = node.boundsPadded.bottom - node.boundsPadded.top

        return (
          <Group key={node.nodeId}>
            {/* Padded hit zone */}
            <Rect
              x={node.boundsPadded.left}
              y={node.boundsPadded.top}
              width={paddedWidth}
              height={paddedHeight}
              fill={isHighlighted ? `${color}22` : 'transparent'}
              stroke={color}
              strokeWidth={isHighlighted ? 2 : 1}
              dash={isHighlighted ? [6, 4] : [4, 4]}
              listening={false}
            />
            {/* Core bounds */}
            <Rect
              x={node.boundsCore.left}
              y={node.boundsCore.top}
              width={coreWidth}
              height={coreHeight}
              fill="transparent"
              stroke={isHighlighted ? '#000000' : color}
              strokeWidth={isHighlighted ? 2.5 : 1}
              listening={false}
            />
          </Group>
        )
      })}
    </Group>
  )
}
