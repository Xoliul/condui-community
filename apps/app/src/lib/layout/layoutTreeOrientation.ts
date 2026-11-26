/** Horizontal scene transforms and supply converter/DC bus growth normalization. */
import type { Panel, ProtectionDevice, TrunkDevice } from '@/types/schema'
import { getSupplyConverterDcConnectionIndex } from '@/lib/supplyAssembly/converterDcConnections'
import { LAYOUT_CONSTANTS } from './bottomUpLayout'
import {
  CIRCUIT_CONVERTER_BLOCK_SIZE,
  CIRCUIT_CONVERTER_EMPTY_OUTPUT_STUB,
  CIRCUIT_CONVERTER_TOP_WIRE_INSET,
  getCircuitConverterBodyGeometry,
  getCircuitConverterDcConnectionCount,
  getOrdinaryCircuitConverterOutputRowY,
  getSupplyConverterBodyGeometry,
  supportsCircuitConverterDcConnections,
} from './circuitConverterGeometry'
import type { LayoutNode } from './layoutTree'
import { getNestedConverterOutputs, NESTED_LANE_JOG_STEP } from './supplyNestedConverterLanes'

function layoutNodeUsesAnchorX(node: LayoutNode): boolean {
  return (
    (node.visual?.type === 'label' && node.visual.align === 'center') ||
    node.type === 'supply' ||
    node.type === 'ground' ||
    node.type === 'rcd' ||
    node.type === 'mcb' ||
    node.type === 'endpoint' ||
    node.type === 'trunkDevice'
  )
}

/** Mirror one positioned scene node while leaving its text and symbol artwork readable. */
function mirrorLayoutNodeSelfHorizontally(
  node: LayoutNode,
  axisX: number,
  mirrorSymbolRotation = false
): void {
  node.bounds.x = layoutNodeUsesAnchorX(node)
    ? axisX * 2 - node.bounds.x
    : axisX * 2 - node.bounds.x - node.bounds.width
  if (node.connectionAnchor) {
    node.connectionAnchor.x = axisX * 2 - node.connectionAnchor.x
  }
  if (node.hitZone?.dropHintAnchor) {
    node.hitZone.dropHintAnchor.x = axisX * 2 - node.hitZone.dropHintAnchor.x
  }
  if (node.converterGrowthDirection) {
    node.converterGrowthDirection = node.converterGrowthDirection === 'left' ? 'right' : 'left'
  }

  if (node.visual?.type === 'label') {
    if (node.visual.align === 'left') node.visual.align = 'right'
    else if (node.visual.align === 'right') node.visual.align = 'left'
  } else if (node.visual?.type === 'symbol') {
    if (mirrorSymbolRotation && node.visual.rotationDeg != null) {
      node.visual.rotationDeg = -node.visual.rotationDeg
    }
    if (node.visual.mirrorHorizontally != null) {
      node.visual.mirrorHorizontally = !node.visual.mirrorHorizontally
    }
    const oldMinimumLeftX = node.visual.bottomLabelMinimumLeftX
    const oldMaximumRightX = node.visual.bottomLabelMaximumRightX
    node.visual.bottomLabelMinimumLeftX =
      oldMaximumRightX == null ? undefined : axisX * 2 - oldMaximumRightX
    node.visual.bottomLabelMaximumRightX =
      oldMinimumLeftX == null ? undefined : axisX * 2 - oldMinimumLeftX
  }

  if (node.nestedChildXs) {
    node.nestedChildXs = node.nestedChildXs.map((x) => axisX * 2 - x)
  }
}

/** Mirror positioned scene nodes while leaving their text and symbol artwork readable. */
export function mirrorLayoutNodeHorizontally(
  node: LayoutNode,
  axisX: number,
  mirrorSymbolRotation = false
): void {
  mirrorLayoutNodeSelfHorizontally(node, axisX, mirrorSymbolRotation)
  node.children.forEach((child) => mirrorLayoutNodeHorizontally(child, axisX, mirrorSymbolRotation))
}

function isSupplyAssemblyLayoutNode(node: LayoutNode): boolean {
  if (node.id.includes('--feed-stub-') || node.id.startsWith('supply-wire-feed-stub-')) {
    return false
  }
  return (
    node.type === 'supply' ||
    node.type === 'ground' ||
    node.id.startsWith('supplyTrunkDevice-') ||
    node.id.startsWith('groundTrunkDevice-') ||
    node.id.startsWith('ground-wire-') ||
    node.id.startsWith('supply-wire-') ||
    node.id.startsWith('supply-changeover-') ||
    node.id.startsWith('supply-direct-converter-') ||
    node.id === 'supply-continuation-label' ||
    node.id.startsWith('feed-output-')
  )
}

function isConverterBackupCircuitRoot(node: LayoutNode): boolean {
  if (node.type !== 'mcb' && node.type !== 'rcd') return false
  const protection = node.domainRef as ProtectionDevice | undefined
  return (
    protection?.circuits?.some((circuit) => circuit.supplySource?.kind === 'converter-backup') ===
    true
  )
}

export function normalizeSupplyConverterGrowth(node: LayoutNode): void {
  const device = node.domainRef as TrunkDevice | undefined
  if (
    node.connectionAnchor &&
    device &&
    supportsCircuitConverterDcConnections(device) &&
    getCircuitConverterDcConnectionCount(device) > 1 &&
    (device.supplyPath === 'converter-branch' || device.supplyPath === 'backup')
  ) {
    const geometry = getSupplyConverterBodyGeometry(device, node.connectionAnchor)
    node.bounds.x = geometry.center.x
    node.bounds.y = geometry.center.y
    node.converterGrowthDirection = 'left'
  }
  node.children.forEach(normalizeSupplyConverterGrowth)
}

export function translateLayoutNodeHorizontally(node: LayoutNode, dx: number): void {
  node.bounds.x += dx
  if (node.connectionAnchor) node.connectionAnchor.x += dx
  if (node.hitZone?.dropHintAnchor) node.hitZone.dropHintAnchor.x += dx
  if (node.nestedChildXs) node.nestedChildXs = node.nestedChildXs.map((x) => x + dx)
  node.children.forEach((child) => translateLayoutNodeHorizontally(child, dx))
}

/** Keep a supply DC bus entirely left of its electrical connection after any frame mirroring. */
export function normalizeSupplyDcBusGrowth(node: LayoutNode): void {
  const nodes: LayoutNode[] = []
  const visit = (candidate: LayoutNode) => {
    nodes.push(candidate)
    candidate.children.forEach(visit)
  }
  visit(node)
  const supplyConverterNode = nodes.find((candidate) => {
    const candidateDevice = candidate.domainRef as TrunkDevice | undefined
    return (
      !!candidateDevice &&
      supportsCircuitConverterDcConnections(candidateDevice) &&
      (candidateDevice.supplyPath === 'converter-branch' || candidateDevice.supplyPath === 'backup')
    )
  })
  for (const busNode of nodes) {
    const busDevice = busNode.domainRef as TrunkDevice | undefined
    if (!busNode.connectionAnchor || busDevice?.type !== 'dc_bus' || !busDevice.supplyPath) {
      continue
    }
    const branchXs = nodes
      .filter(
        (candidate) =>
          (candidate.domainRef as TrunkDevice | undefined)?.supplyDcBusId === busDevice.id &&
          !(candidate.domainRef as TrunkDevice | undefined)?.converterDcConnection
      )
      .map((candidate) => candidate.connectionAnchor?.x ?? candidate.bounds.x)
    const isSideConverterOutput = getSupplyConverterDcConnectionIndex(busDevice) === 0
    const converterSidePortX = isSideConverterOutput
      ? supplyConverterNode?.connectionAnchor
        ? getSupplyConverterBodyGeometry(
            supplyConverterNode.domainRef as TrunkDevice,
            supplyConverterNode.connectionAnchor
          ).left
        : supplyConverterNode
          ? supplyConverterNode.bounds.x - supplyConverterNode.bounds.width / 2
          : busNode.connectionAnchor.x
      : busNode.connectionAnchor.x
    const attachmentX = isSideConverterOutput
      ? (() => {
          const inlineLaneNodes = nodes.filter((candidate) => {
            const candidateDevice = candidate.domainRef as TrunkDevice | undefined
            return (
              candidateDevice != null &&
              candidateDevice.id !== busDevice.id &&
              candidateDevice.type !== 'dc_bus' &&
              !candidateDevice.supplyDcBusId &&
              getSupplyConverterDcConnectionIndex(candidateDevice) ===
                getSupplyConverterDcConnectionIndex(busDevice)
            )
          })
          if (inlineLaneNodes.length === 0) {
            return converterSidePortX - LAYOUT_CONSTANTS.SUPPLY_DC_BUS_CONNECTION_LEAD
          }

          // The inline lane is ordered from the converter toward the bus. The
          // bus must terminate on the far side of the last inline symbol, not
          // at the converter port; otherwise the bus-bar artwork is painted
          // underneath the wire and the inline device.
          const inlineAverageX =
            inlineLaneNodes.reduce((sum, candidate) => sum + candidate.bounds.x, 0) /
            inlineLaneNodes.length
          const converterIsRightOfInlineLane = converterSidePortX >= inlineAverageX
          const busSideInlineNode = inlineLaneNodes.reduce(
            (selected, candidate) => {
              if (!selected) return candidate
              return converterIsRightOfInlineLane
                ? candidate.bounds.x < selected.bounds.x
                  ? candidate
                  : selected
                : candidate.bounds.x > selected.bounds.x
                  ? candidate
                  : selected
            },
            undefined as LayoutNode | undefined
          )
          if (!busSideInlineNode) {
            return converterSidePortX - LAYOUT_CONSTANTS.SUPPLY_DC_BUS_CONNECTION_LEAD
          }

          const symbolHalfSize = LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
          return converterIsRightOfInlineLane
            ? busSideInlineNode.bounds.x -
                symbolHalfSize -
                LAYOUT_CONSTANTS.SUPPLY_DC_BUS_CONNECTION_LEAD
            : busSideInlineNode.bounds.x +
                symbolHalfSize +
                LAYOUT_CONSTANTS.SUPPLY_DC_BUS_CONNECTION_LEAD
        })()
      : converterSidePortX
    busNode.connectionAnchor.x = attachmentX
    const busStartX = Math.min(
      attachmentX - LAYOUT_CONSTANTS.DC_BUS_MIN_WIDTH,
      ...branchXs.map((branchX) => branchX - LAYOUT_CONSTANTS.SECONDARY_BUS_EXTENSION)
    )
    const busEndX = attachmentX
    busNode.bounds.x = (busStartX + busEndX) / 2
    busNode.bounds.width = busEndX - busStartX

    const branchGroups = new Map<
      string,
      { x: number; firstSupplyIndex: number; nodes: LayoutNode[] }
    >()
    for (const candidate of nodes) {
      const candidateDevice = candidate.domainRef as TrunkDevice | undefined
      if (candidateDevice?.supplyDcBusId !== busDevice.id || candidateDevice.converterDcConnection)
        continue
      const branchId = candidateDevice.supplyDcBusBranchId ?? candidateDevice.id
      const supplyIndex = candidate.hitZone?.supplyInsertIndex ?? Number.MAX_SAFE_INTEGER
      const existing = branchGroups.get(branchId)
      if (!existing) {
        branchGroups.set(branchId, {
          x: candidate.connectionAnchor?.x ?? candidate.bounds.x,
          firstSupplyIndex: supplyIndex,
          nodes: [candidate],
        })
      } else {
        existing.firstSupplyIndex = Math.min(existing.firstSupplyIndex, supplyIndex)
        existing.nodes.push(candidate)
      }
    }
    const visualGroups = [...branchGroups.entries()]
      .map(([branchId, group]) => ({ branchId, ...group }))
      .sort((a, b) => a.x - b.x)
    const finalSupplyIndex = Math.max(
      (busNode.hitZone?.supplyInsertIndex ?? -1) + 1,
      visualGroups.reduce((max, group) => Math.max(max, group.firstSupplyIndex), -1) + 1
    )
    const waypoints = [busStartX, ...visualGroups.map((group) => group.x), busEndX]
    busNode.children = busNode.children.filter(
      (child) =>
        !child.id.startsWith(`supply-dc-bus-segment-${busDevice.id}-`) &&
        !child.id.startsWith(`supply-dc-bus-branch-slot-${busDevice.id}-`)
    )
    for (let segmentIndex = 0; segmentIndex < waypoints.length - 1; segmentIndex += 1) {
      const startX = waypoints[segmentIndex]!
      const endX = waypoints[segmentIndex + 1]!
      if (endX <= startX) continue
      const insertIndex =
        segmentIndex === 0
          ? finalSupplyIndex
          : (visualGroups[segmentIndex - 1]?.firstSupplyIndex ?? finalSupplyIndex)
      busNode.children.push({
        id: `supply-dc-bus-segment-${busDevice.id}-${segmentIndex}`,
        type: 'wire',
        bounds: {
          x: startX,
          y: busNode.connectionAnchor.y - LAYOUT_CONSTANTS.BUS_THICKNESS / 2,
          width: endX - startX,
          height: LAYOUT_CONSTANTS.BUS_THICKNESS,
        },
        visual: { type: 'busBar', thickness: LAYOUT_CONSTANTS.BUS_THICKNESS },
        hitZone: {
          type: 'supplyConverterDcWire',
          padding: 20,
          supplyFeedScope: busNode.hitZone?.supplyFeedScope,
          supplyInsertIndex: insertIndex,
          supplyPanelId: busNode.hitZone?.supplyPanelId,
          supplyConverterDcBranch: busNode.hitZone?.supplyConverterDcBranch,
          supplyConverterDcConnectionIndex: busNode.hitZone?.supplyConverterDcConnectionIndex,
          supplyDcBusId: busDevice.id,
        },
        children: [],
      })
    }

    const branchSlotPadding = 12
    const symbolHalfSize = LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
    const pushBranchSlot = (
      group: (typeof visualGroups)[number],
      slotIndex: number,
      fromY: number,
      toY: number,
      insertIndex: number
    ) => {
      const top = Math.min(fromY, toY)
      const bottom = Math.max(fromY, toY)
      if (bottom <= top) return
      busNode.children.push({
        id: `supply-dc-bus-branch-slot-${busDevice.id}-${group.branchId}-${slotIndex}`,
        type: 'wire',
        bounds: {
          x: group.x - branchSlotPadding,
          y: top,
          width: branchSlotPadding * 2,
          height: bottom - top,
        },
        hitZone: {
          type: 'supplyConverterDcWire',
          padding: 0,
          supplyFeedScope: busNode.hitZone?.supplyFeedScope,
          supplyInsertIndex: insertIndex,
          supplyPanelId: busNode.hitZone?.supplyPanelId,
          supplyConverterDcBranch: busNode.hitZone?.supplyConverterDcBranch,
          supplyConverterDcConnectionIndex: busNode.hitZone?.supplyConverterDcConnectionIndex,
          supplyDcBusId: busDevice.id,
          supplyDcBusBranchId: group.branchId,
          dropHintAnchor: { x: group.x, y: (top + bottom) / 2 },
        },
        children: [],
      })
    }

    for (const group of visualGroups) {
      // Strings on a multi-port converter's outputs take their drops from the converter's own
      // output zones (normalizeNestedSupplyDcConverterGrowth); these slots cover the devices
      // directly on the branch, so neither covers the other's wires.
      const ordered = group.nodes
        .filter((node) => !(node.domainRef as TrunkDevice | undefined)?.converterDcConnection)
        .sort((a, b) => b.bounds.y - a.bounds.y)
      const first = ordered[0]
      if (!first) continue
      pushBranchSlot(
        group,
        0,
        busNode.connectionAnchor.y,
        first.bounds.y + symbolHalfSize,
        first.hitZone?.supplyInsertIndex ?? group.firstSupplyIndex
      )
      for (let index = 0; index < ordered.length - 1; index += 1) {
        const lower = ordered[index]!
        const upper = ordered[index + 1]!
        pushBranchSlot(
          group,
          index + 1,
          lower.bounds.y - symbolHalfSize,
          upper.bounds.y + symbolHalfSize,
          upper.hitZone?.supplyInsertIndex ?? group.firstSupplyIndex + index + 1
        )
      }
      const last = ordered.at(-1)!
      const lastDevice = last.domainRef as TrunkDevice | undefined
      if (
        lastDevice &&
        supportsCircuitConverterDcConnections(lastDevice) &&
        getCircuitConverterDcConnectionCount(lastDevice) > 1
      )
        continue
      const appendIndex =
        (last.hitZone?.supplyInsertIndex ?? group.firstSupplyIndex + ordered.length - 1) + 1
      pushBranchSlot(
        group,
        ordered.length,
        last.bounds.y - symbolHalfSize,
        last.bounds.y - LAYOUT_CONSTANTS.SUPPLY_DC_BUS_BRANCH_DEVICE_SPACING + symbolHalfSize,
        appendIndex
      )
    }

    // The bus node itself spans the complete rail, but it is not an insertion
    // slot. Its precise rail segments and vertical branch slots above are the
    // only valid drop targets; keeping the parent hit zone active makes a
    // padded full-width fallback win over those slots and inserts at the bus's
    // own feed position instead.
    if (busNode.hitZone) {
      busNode.hitZone = { ...busNode.hitZone, type: null }
    }
  }
}

export function normalizeNestedSupplyDcConverterGrowth(node: LayoutNode): void {
  const nodes: LayoutNode[] = []
  const visit = (candidate: LayoutNode) => {
    nodes.push(candidate)
    candidate.children.forEach(visit)
  }
  visit(node)

  for (const converterNode of nodes) {
    const converter = converterNode.domainRef as TrunkDevice | undefined
    if (
      !converter?.supplyDcBusId ||
      !supportsCircuitConverterDcConnections(converter) ||
      getCircuitConverterDcConnectionCount(converter) <= 1
    )
      continue

    const anchor = converterNode.connectionAnchor ?? {
      x: converterNode.bounds.x,
      y: converterNode.bounds.y,
    }
    const growthDirection = converterNode.converterGrowthDirection ?? 'right'
    const geometry =
      growthDirection === 'left'
        ? getSupplyConverterBodyGeometry(converter, anchor)
        : getCircuitConverterBodyGeometry(converter, anchor)
    const dcPorts =
      growthDirection === 'left'
        ? Array.from({ length: geometry.count }, (_, index) => ({
            index,
            x: anchor.x - index * CIRCUIT_CONVERTER_BLOCK_SIZE,
            y: anchor.y - CIRCUIT_CONVERTER_TOP_WIRE_INSET,
          }))
        : getCircuitConverterBodyGeometry(converter, anchor).dcPorts
    converterNode.bounds.x = geometry.center.x
    converterNode.bounds.y = geometry.center.y
    converterNode.bounds.width =
      geometry.width + (LAYOUT_CONSTANTS.SYMBOL_SIZE - CIRCUIT_CONVERTER_BLOCK_SIZE)
    converterNode.connectionAnchor = { ...anchor }
    converterNode.converterGrowthDirection = growthDirection

    const outputNodes = nodes.filter((candidate) => {
      const device = candidate.domainRef as TrunkDevice | undefined
      return device?.converterDcConnection?.converterId === converter.id
    })
    const outputHitNodes: LayoutNode[] = []
    // Each populated output feeds a string like any other branch. The supply layout already
    // placed it (rows level with its neighbours, strings spaced outwards for their captions,
    // getNestedLaneOffsets) and sized the frame around it; nested jogs lead each port to its
    // string, exactly as deriveWires draws them.
    const outputs = getNestedConverterOutputs({
      nodes: outputNodes,
      converterId: converter.id,
      ports: dcPorts,
      halfSymbol: LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
      emptyStubHeight: CIRCUIT_CONVERTER_EMPTY_OUTPUT_STUB,
    })
    const routed = outputs.some((output) => output.route)
    for (let connectionIndex = 0; connectionIndex < geometry.count; connectionIndex += 1) {
      const connection = { converterId: converter.id, connectionIndex }
      const port = dcPorts[connectionIndex]!
      const { laneNodes, route } = outputs[connectionIndex]!
      const rowY =
        route?.stubTopY ?? getOrdinaryCircuitConverterOutputRowY(converter, anchor.y, connectionIndex)
      const laneX = laneNodes[0]?.bounds.x ?? port.x
      const jogY = route?.jogY ?? rowY
      const hitPadding = 9
      // Neighbouring jogs are only NESTED_LANE_JOG_STEP apart; their zones must not overlap.
      const jogHitPadding = NESTED_LANE_JOG_STEP / 2 - 1
      const sharedHitZone: LayoutNode['hitZone'] = {
        type: 'supplyConverterDcWire',
        padding: 0,
        supplyFeedScope: converterNode.hitZone?.supplyFeedScope,
        supplyInsertIndex:
          ((laneNodes.at(-1)?.domainRef as TrunkDevice | undefined)?.trunkPosition ??
            converter.trunkPosition) + 1,
        supplyPanelId: converterNode.hitZone?.supplyPanelId,
        supplyConverterDcBranch: converterNode.hitZone?.supplyConverterDcBranch,
        supplyConverterDcConnectionIndex: converterNode.hitZone?.supplyConverterDcConnectionIndex,
        supplyDcBusId: converter.supplyDcBusId,
        supplyDcBusBranchId: converter.supplyDcBusBranchId,
        converterDcConnection: connection,
      }
      const hitNode = (
        suffix: string,
        x1: number,
        y1: number,
        x2: number,
        y2: number,
        hitZone: LayoutNode['hitZone'],
        padding = hitPadding
      ) =>
        outputHitNodes.push({
          id: `supply-nested-converter-output-${converter.id}-${connectionIndex}-${suffix}`,
          type: 'wire',
          bounds: {
            x: Math.min(x1, x2) - padding,
            y: Math.min(y1, y2) - padding,
            width: Math.abs(x2 - x1) + padding * 2,
            height: Math.abs(y2 - y1) + padding * 2,
          },
          hitZone,
          children: [],
        })
      const quietZone = { ...sharedHitZone, suppressDropHint: true }
      if (laneNodes.length === 0) {
        const stubPadding = routed ? jogHitPadding : hitPadding
        hitNode('vertical', laneX, port.y, laneX, rowY, quietZone, stubPadding)
        hitNode('horizontal', port.x, rowY, laneX, rowY, sharedHitZone, stubPadding)
        continue
      }
      // Like a single string, every gap of the string takes a drop at its own place: after the
      // converter, between two devices, and above the last one.
      const half = LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
      const slotAfter = (index: number) => ({
        ...sharedHitZone,
        supplyInsertIndex:
          (index < 0
            ? converter.trunkPosition
            : ((laneNodes[index]!.domainRef as TrunkDevice).trunkPosition ?? 0)) + 1,
      })
      if (laneX !== port.x) hitNode('port', port.x, port.y, port.x, jogY, quietZone, jogHitPadding)
      if (laneX !== port.x)
        hitNode('horizontal', port.x, jogY, laneX, jogY, { ...slotAfter(-1), suppressDropHint: true }, jogHitPadding)
      laneNodes.forEach((node, index) => {
        const from =
          index === 0
            ? laneX === port.x
              ? port.y
              : jogY
            : laneNodes[index - 1]!.bounds.y - half
        hitNode(`slot-${index}`, laneX, from, laneX, node.bounds.y + half, slotAfter(index - 1))
      })
      const topDevice = laneNodes.at(-1)!.bounds
      const topSlotEnd = topDevice.y - half - LAYOUT_CONSTANTS.SUPPLY_DC_BUS_BRANCH_DEVICE_SPACING / 2
      hitNode('top', laneX, topDevice.y - half, laneX, topSlotEnd, slotAfter(laneNodes.length - 1))
    }
    converterNode.children = [
      ...converterNode.children.filter(
        (child) => !child.id.startsWith(`supply-nested-converter-output-${converter.id}-`)
      ),
      ...outputHitNodes,
    ]
  }
}

export function mirrorSupplyAssemblyLayoutNodesHorizontally(
  node: LayoutNode,
  axisX: number,
  converterBackupCircuitIds?: Set<string>,
  mirrorSymbolRotation = false
): void {
  const backupCircuitIds =
    converterBackupCircuitIds ??
    (node.type === 'panel'
      ? new Set(
          ((node.domainRef as Panel | undefined)?.protections ?? []).flatMap((protection) =>
            (protection.circuits ?? [])
              .filter((circuit) => circuit.supplySource?.kind === 'converter-backup')
              .map((circuit) => circuit.id)
          )
        )
      : new Set<string>())
  if (isConverterBackupCircuitRoot(node)) {
    mirrorLayoutNodeHorizontally(node, axisX, mirrorSymbolRotation)
    return
  }
  if (
    isSupplyAssemblyLayoutNode(node) ||
    (node.id.startsWith('label-') && backupCircuitIds.has(node.id.slice('label-'.length)))
  ) {
    mirrorLayoutNodeSelfHorizontally(node, axisX, mirrorSymbolRotation)
  }
  node.children.forEach((child) =>
    mirrorSupplyAssemblyLayoutNodesHorizontally(
      child,
      axisX,
      backupCircuitIds,
      mirrorSymbolRotation
    )
  )
}

/** Mirror only the empty split rails and their panel-side drop targets. */
export function mirrorInlineSplitBusLayoutNodesHorizontally(
  panelNode: LayoutNode,
  axisX: number
): void {
  const bus = panelNode.children.find((node) => node.type === 'busBar')
  if (!bus) return
  mirrorLayoutNodeSelfHorizontally(bus, axisX)
  bus.children.forEach((node) => {
    if (
      node.id.startsWith('main-bus-segment-') ||
      node.id.startsWith('supply-wire-feed-stub-')
    ) {
      mirrorLayoutNodeHorizontally(node, axisX)
    }
  })
}
