/** Main-bus scene geometry, with circuit builders supplied by the scene assembler. */
import type { LayoutNode } from './layoutTree'
import type { BottomUpCircuitLayout, BottomUpLayoutElement, BottomUpPanelLayout } from './bottomUpLayout'
import { LAYOUT_CONSTANTS } from './bottomUpLayoutConstants'
import { getPanelDiagramId } from './bottomUpLayout'
import { getDirectConverterChangeoverInsertIndex } from '@/lib/supplyAssembly/directConverterBackupUpgrade'
import { buildMainBusSegmentNodes } from './mainBusSegmentNodes'
import {
  horizontalSupplyHitNode,
  isChangeoverGridRailDrawn,
  resolveChangeoverGridRailStartX,
  resolveDrawnChangeoverElbowX,
  resolveGroundWireTopY,
  resolveSupplyBusRunStubX,
  verticalSupplyHitNode,
} from './supplyHitZoneGeometry'
import { isSupplyTapNode, markSupplyTapNodes } from './layoutTreeSupplyTaps'
import { getSupplyConverterBodyGeometry } from './circuitConverterGeometry'
import { getSupplyConverterDcConnectionIndex } from '@/lib/supplyAssembly/converterDcConnections'
import { isConverterGridLegPlacement, orderConverterGridLegDevicesFromConverter } from '@/lib/supplyAssembly/changeoverGridSource'

/**
 * Bottom y of a feed stub insertion gap. The backup section's stub is a changeover load riser, which
 * deriveWires draws down to the changeover's row, beyond the end of the stub stack.
 */
export function resolveFeedStubGapEndY(
  panelLayout: BottomUpPanelLayout,
  busSectionId: string,
  centers: readonly number[],
  gapIndex: number
): number {
  const isLastGap = gapIndex === centers.length - 2
  const endY = centers[gapIndex + 1]!
  const isBackup = panelLayout.panel.busSections?.some(
    (section) => section.id === busSectionId && section.role === 'backup'
  )
  const branches = panelLayout.supplyChangeoverBranches
  if (isLastGap && branches && isBackup) return Math.max(endY, branches.y)
  return endY - (isLastGap ? 0 : 13)
}

export function buildMainBusNode(
  panelLayout: BottomUpPanelLayout,
  mainBusElement: BottomUpLayoutElement,
  groundElement: BottomUpLayoutElement | undefined,
  buildRcdNode: (panel: BottomUpPanelLayout, element: BottomUpLayoutElement, circuits: BottomUpCircuitLayout[]) => LayoutNode,
  buildMcbNode: (panel: BottomUpPanelLayout, circuit: BottomUpCircuitLayout) => LayoutNode | null
): LayoutNode {
  const children: LayoutNode[] = []

  // Group circuits by their parent RCD (if any)
  const rcdGroups = new Map<string, BottomUpCircuitLayout[]>()
  const directMcbs: BottomUpCircuitLayout[] = []

  for (const circuitLayout of panelLayout.circuits) {
    // Skip nested circuits - they'll be handled under their parent circuit
    if (circuitLayout.parentCircuit) {
      continue
    }

    if (circuitLayout.parentRcd) {
      const rcdId = circuitLayout.parentRcd.id
      if (!rcdGroups.has(rcdId)) {
        rcdGroups.set(rcdId, [])
      }
      rcdGroups.get(rcdId)!.push(circuitLayout)
    } else {
      directMcbs.push(circuitLayout)
    }
  }

  // Build RCD nodes (each RCD has a trunk/secondaryBus with MCBs)
  for (const [rcdId, circuits] of rcdGroups.entries()) {
    const rcdElement = panelLayout.elements.find(
      (e) => e.type === 'rcd' && e.protectionId === rcdId
    )
    if (rcdElement) {
      const rcdNode = buildRcdNode(panelLayout, rcdElement, circuits)
      children.push(rcdNode)
    }
  }

  // Build RCD nodes for RCDs with 0 circuits (freshly dropped, not yet populated)
  for (const protection of panelLayout.panel.protections) {
    if (
      (protection.type === 'RCD' || protection.type === 'RCBO') &&
      !rcdGroups.has(protection.id)
    ) {
      const rcdElement = panelLayout.elements.find(
        (e) => e.type === 'rcd' && e.protectionId === protection.id
      )
      if (rcdElement) {
        const rcdNode = buildRcdNode(panelLayout, rcdElement, [])
        children.push(rcdNode)
      }
    }
  }

  // Build direct MCB nodes (not under RCD)
  for (const circuitLayout of directMcbs) {
    const mcbNode = buildMcbNode(panelLayout, circuitLayout)
    if (mcbNode) {
      children.push(mcbNode)
    }
  }

  markSupplyTapNodes(panelLayout, children)
  const busSegmentNodes = buildMainBusSegmentNodes(panelLayout, mainBusElement, children)
  // The changeover frame draws its load riser at the backup section's feed stub.
  const backupBusStubX = panelLayout.supplyChangeoverBranches
    ? resolveSupplyBusRunStubX(busSegmentNodes, panelLayout.panel, 'backup')
    : undefined

  // Supply wire: drop target for inserting energy meters and protection devices.
  // The wire goes from main bus down to the bend point, then optionally horizontal to the supply symbol.
  // When devices exist, the supply symbol is at the END (rightmost) of the horizontal chain.
  const supply = panelLayout.supply
  const supplyBend = panelLayout.supplyBend
  if (supply && mainBusElement.position) {
    const pad = 10
    const supplyDevicesSorted = [...(panelLayout.supplyDevices ?? [])]
      .filter(({ device }) => {
        if (
          device.supplyPath === 'converter-branch' &&
          device.converterGridInputConnected === false
        ) {
          return false
        }
        return (
          panelLayout.supplyChangeoverBranches ||
          !panelLayout.supplyConverterBranch ||
          !['converter-grid', 'converter-dc', 'converter-dc-top'].includes(device.supplyPath ?? '')
        )
      })
      .sort((a, b) => a.x - b.x)
    const hasSupplyDevices = supplyDevicesSorted.length > 0

    if (supplyBend) {
      const bendX = supplyBend.x
      const bendY = supplyBend.y
      const rootDevices = hasSupplyDevices
        ? supplyDevicesSorted.filter((device) => device.feedScope === 'root')
        : []
      const sharedDevices = hasSupplyDevices
        ? supplyDevicesSorted.filter((device) => device.feedScope === 'shared')
        : []
      const rootCount = rootDevices.length
      const sharedCount = sharedDevices.length
      const directChangeoverInsertIndex = getDirectConverterChangeoverInsertIndex(
        (panelLayout.supplyDevices ?? [])
          .filter(({ feedScope }) => feedScope === 'root')
          .map(({ device }) => device)
      )
      const leftmostDevice = supplyDevicesSorted[0]
      const rightmostDevice = supplyDevicesSorted[supplyDevicesSorted.length - 1]
      const leftmostSharedDevice = sharedDevices[0]

      const diagramId = getPanelDiagramId(panelLayout)
      const separateConverter = !panelLayout.supplyChangeoverBranches
        ? panelLayout.supplyDevices?.find(
            ({ device }) =>
              device.supplyPath === 'converter-branch' &&
              device.converterAcConnection === 'separate'
          )
        : undefined
      const pushSupplySegment = (
        id: string,
        x1: number,
        x2: number,
        scope: 'shared' | 'root',
        insertIndex: number,
        supplyConverterChangeoverSlot = false
      ) => {
        // A changeover owns lane-aware hit zones below. Do not leave stale zones
        // behind on the former centerline after its source-side symbols move down.
        if (panelLayout.supplyChangeoverBranches) return
        if (x2 <= x1) return
        const isDirectChangeoverSlot =
          supplyConverterChangeoverSlot ||
          (scope === 'root' && insertIndex === directChangeoverInsertIndex)
        const compactChangeoverSlot = isDirectChangeoverSlot && !separateConverter
        const segmentX1 = compactChangeoverSlot
          ? Math.max(x1, x2 - LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE)
          : x1
        children.unshift({
          id,
          type: 'wire',
          bounds: {
            x: segmentX1 - pad - (compactChangeoverSlot ? 1 : 0),
            y:
              separateConverter &&
              Math.abs((x1 + x2) / 2 - bendX) < Math.abs(separateConverter.x - bendX)
                ? separateConverter.y - pad
                : bendY - pad,
            width: x2 - segmentX1 + pad * 2,
            height: pad * 2,
          },
          hitZone: {
            type: 'supplyWire',
            padding: 0,
            supplyFeedScope: scope,
            supplyInsertIndex: insertIndex,
            supplyPanelId: panelLayout.panel.id,
            supplyConverterChangeoverSlot: isDirectChangeoverSlot,
          },
          children: [],
        })
      }

      // Vertical segment from main bus down to bend point always belongs to the panel-local feed
      // when present; otherwise it is part of the shared path.
      const continuationRootInsertBase = panelLayout.panelLocalRootSupplyInsertBase
      children.unshift({
        id: `supply-wire-vertical-${diagramId}`,
        type: 'wire',
        bounds: {
          x: (backupBusStubX ?? bendX) - pad,
          y: mainBusElement.position.y,
          width: pad * 2,
          height: (separateConverter?.y ?? bendY) - mainBusElement.position.y,
        },
        hitZone: {
          type: 'supplyWire',
          padding: 0,
          supplyFeedScope: 'root',
          supplyInsertIndex:
            continuationRootInsertBase != null
              ? continuationRootInsertBase + rootCount
              : rootCount > 0 || sharedCount > 0
                ? rootCount
                : sharedCount,
          supplyPanelId: panelLayout.panel.id,
        },
        children: [],
      })

      if (hasSupplyDevices && panelLayout.supplyEndpointKind === 'continuation') {
        // Continuation rails never own shared/grid topology. Left and right of a
        // local protection must stay on this panel's root feed at/after insertBase,
        // never splice at the start of the assembly supply wire.
        const insertBase = continuationRootInsertBase ?? 0
        const supplyEndX = supply.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
        const supplyIsLeft = supplyEndX < bendX
        const alongFromSupply = [...supplyDevicesSorted].sort((a, b) =>
          supplyIsLeft ? a.x - b.x : b.x - a.x
        )
        const first = alongFromSupply[0]
        const last = alongFromSupply[alongFromSupply.length - 1]
        if (first) {
          pushSupplySegment(
            `supply-wire-segment-${diagramId}-supply`,
            Math.min(supplyEndX, first.x),
            Math.max(supplyEndX, first.x),
            'root',
            insertBase
          )
        }
        for (let i = 0; i < alongFromSupply.length - 1; i++) {
          const nearerSupply = alongFromSupply[i]!
          const nearerBus = alongFromSupply[i + 1]!
          pushSupplySegment(
            `supply-wire-segment-${diagramId}-${i}`,
            Math.min(nearerSupply.x, nearerBus.x),
            Math.max(nearerSupply.x, nearerBus.x),
            'root',
            Math.max(nearerSupply.feedIndex + 1, insertBase)
          )
        }
        if (last) {
          pushSupplySegment(
            `supply-wire-segment-${diagramId}-entry`,
            Math.min(bendX, last.x),
            Math.max(bendX, last.x),
            'root',
            Math.max(last.feedIndex + 1, insertBase)
          )
        }
      } else if (hasSupplyDevices) {
        if (leftmostDevice) {
          if (rootCount === 0 && leftmostSharedDevice) {
            const separatorX = (bendX + leftmostSharedDevice.x) / 2
            pushSupplySegment(
              `supply-wire-segment-${diagramId}-entry-root`,
              bendX,
              separatorX,
              'root',
              0
            )
            pushSupplySegment(
              `supply-wire-segment-${diagramId}-entry-shared`,
              separatorX,
              leftmostSharedDevice.x,
              'shared',
              sharedCount
            )
          } else {
            pushSupplySegment(
              `supply-wire-segment-${diagramId}-entry`,
              bendX,
              leftmostDevice.x,
              leftmostDevice.feedScope,
              leftmostDevice.feedIndex + 1,
              leftmostDevice.device.supplyPath === 'converter-branch'
            )
          }
        }

        for (let i = 0; i < supplyDevicesSorted.length - 1; i++) {
          const left = supplyDevicesSorted[i]!
          const right = supplyDevicesSorted[i + 1]!

          if (left.feedScope === right.feedScope) {
            pushSupplySegment(
              `supply-wire-segment-${diagramId}-${i}`,
              left.x,
              right.x,
              right.feedScope,
              right.feedIndex + 1,
              right.device.supplyPath === 'converter-branch'
            )
            continue
          }

          const separatorX = (left.x + right.x) / 2
          pushSupplySegment(
            `supply-wire-segment-${diagramId}-${i}-root`,
            left.x,
            separatorX,
            'root',
            0
          )
          pushSupplySegment(
            `supply-wire-segment-${diagramId}-${i}-shared`,
            separatorX,
            right.x,
            'shared',
            sharedCount
          )
        }

        const supplyEndX = supply.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
        if (rightmostDevice) {
          if (sharedCount === 0 && rightmostDevice.feedScope === 'root') {
            const separatorX = (rightmostDevice.x + supplyEndX) / 2
            pushSupplySegment(
              `supply-wire-segment-${diagramId}-supply-root`,
              rightmostDevice.x,
              separatorX,
              'root',
              0
            )
            pushSupplySegment(
              `supply-wire-segment-${diagramId}-supply-shared`,
              separatorX,
              supplyEndX,
              'shared',
              0
            )
          } else {
            pushSupplySegment(
              `supply-wire-segment-${diagramId}-supply`,
              rightmostDevice.x,
              supplyEndX,
              rightmostDevice.feedScope,
              0
            )
          }
        }
      } else if (panelLayout.supplyEndpointKind === 'continuation') {
        // Panel-only handoff frames still paint a horizontal rail to the Voeding
        // endpoint. Without a drop slot there, protections can only be added through
        // panel-canvas rewiring. The full rail is root-scoped: shared topology lives
        // in the detached supply frame.
        const supplyEndX = supply.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
        const handoffLeft = Math.min(bendX, supplyEndX)
        const handoffRight = Math.max(bendX, supplyEndX)
        pushSupplySegment(
          `supply-wire-segment-${diagramId}-handoff`,
          handoffLeft,
          handoffRight,
          'root',
          panelLayout.panelLocalRootSupplyInsertBase ?? 0
        )
      } else {
        const supplyEndX = supply.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
        const separatorX = (bendX + supplyEndX) / 2
        pushSupplySegment(
          `supply-wire-segment-${diagramId}-stub-root`,
          bendX,
          separatorX,
          'root',
          0
        )
        pushSupplySegment(
          `supply-wire-segment-${diagramId}-stub-shared`,
          separatorX,
          supplyEndX,
          'shared',
          0
        )
      }
    } else {
      // Sub-panel / no bend metadata: single vertical hit zone at the feeder X
      const wireY = Math.min(supply.y, mainBusElement.position.y)
      const wireHeight = Math.abs(supply.y - mainBusElement.position.y)
      children.unshift({
        id: `supply-wire-${panelLayout.panel.id}`,
        type: 'wire',
        bounds: {
          x: supply.x - pad,
          y: wireY,
          width: pad * 2,
          height: wireHeight,
        },
        hitZone: {
          type: 'supplyWire',
          padding: 0,
          supplyFeedScope: 'shared',
          supplyInsertIndex: 0,
          supplyPanelId: panelLayout.panel.id,
        },
        children: [],
      })
    }
  }

  const changeoverBranches = panelLayout.supplyChangeoverBranches
  if (changeoverBranches) {
    const pad = 10
    const devices = [...(panelLayout.supplyDevices ?? [])].sort((a, b) => a.x - b.x)
    const sharedCount = devices.filter((candidate) => candidate.feedScope === 'shared').length
    const changeover = devices.find(
      (candidate) => candidate.device.id === changeoverBranches.deviceId
    )
    const backupConverter = devices.find((candidate) => candidate.device.supplyPath === 'backup')
    const converterGridInputConnected =
      backupConverter?.device.converterGridInputConnected !== false
    // deriveWires re-derives the riser x from the positioned nodes; follow it, not the layout field.
    const elbowX = resolveDrawnChangeoverElbowX(panelLayout, devices)
    const rightPortX = changeoverBranches.x + LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE / 2
    const portOffset = (LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE * 7) / 24
    const upperPortY = changeoverBranches.y - portOffset
    const lowerPortY = changeoverBranches.y + portOffset
    const isBranchDevice = (candidate: (typeof devices)[number]) =>
      ['backup', 'backup-output', 'changeover-grid', 'converter-grid'].includes(
        candidate.device.supplyPath ?? ''
      )
    const pushLaneSegment = (
      id: string,
      x1: number,
      x2: number,
      y: number,
      insertIndex: number,
      feedScope: 'shared' | 'root',
      type:
        | 'supplyWire'
        | 'supplyBackupWire'
        | 'supplyBackupOutputWire'
        | 'supplyChangeoverGridWire'
        | 'supplyConverterGridWire' = 'supplyWire'
    ) => {
      if (x2 <= x1) return
      children.unshift({
        id,
        type: 'wire',
        bounds: { x: x1 - pad, y: y - pad, width: x2 - x1 + pad * 2, height: pad * 2 },
        hitZone: {
          type,
          padding: 0,
          supplyFeedScope: feedScope,
          supplyInsertIndex: insertIndex,
          supplyPanelId: panelLayout.panel.id,
          ...(type === 'supplyConverterGridWire'
            ? { converterGridPlacement: 'inline' as const }
            : {}),
        },
        children: [],
      })
    }

    if (changeover) {
      const outputDevices = devices.filter(
        (candidate) => candidate.x < changeover.x && !isBranchDevice(candidate)
      )
      let previousX = backupBusStubX ?? panelLayout.supplyBend?.x ?? changeover.x
      for (const candidate of [...outputDevices, changeover]) {
        pushLaneSegment(
          `supply-changeover-load-slot-${panelLayout.panel.id}-${candidate.device.id}`,
          previousX,
          candidate.x,
          changeoverBranches.y,
          candidate.feedIndex + 1,
          candidate.feedScope
        )
        previousX = candidate.x
      }

      const changeoverGridDevices = devices
        .filter(
          (candidate) =>
            candidate.device.supplyPath === 'changeover-grid' &&
            candidate.device.changeoverGridPlacement !== 'input-leg'
        )
        .sort((a, b) => a.x - b.x)
      const gridBusStubX = resolveSupplyBusRunStubX(busSegmentNodes, panelLayout.panel, 'normal')
      const gridRailX = resolveChangeoverGridRailStartX(
        gridBusStubX,
        groundElement?.position.x,
        mainBusElement.position.x
      )
      previousX = gridRailX
      for (const candidate of changeoverGridDevices) {
        pushLaneSegment(
          `supply-changeover-grid-rail-slot-${panelLayout.panel.id}-${candidate.device.id}`,
          previousX,
          candidate.x,
          changeoverBranches.lowerY,
          candidate.feedIndex,
          'root',
          'supplyChangeoverGridWire'
        )
        previousX = candidate.x
      }
      const railAppendIndex = Math.max(
        changeover.feedIndex + 1,
        ...changeoverGridDevices.map((candidate) => candidate.feedIndex + 1),
        ...devices
          .filter(
            (candidate) =>
              candidate.device.supplyPath === 'changeover-grid' &&
              candidate.device.changeoverGridPlacement === 'input-leg'
          )
          .map((candidate) => candidate.feedIndex + 1)
      )
      // An empty rail (no grid bus section, no inline grid device) has no drawn wire, so no zone.
      if (isChangeoverGridRailDrawn(gridBusStubX, changeoverGridDevices.length)) {
        pushLaneSegment(
          `supply-changeover-grid-rail-slot-${panelLayout.panel.id}-append`,
          previousX,
          elbowX,
          changeoverBranches.lowerY,
          railAppendIndex,
          'root',
          'supplyChangeoverGridWire'
        )
      }
      if (gridBusStubX != null) {
        // The grid section's riser: it carries the first rail section's insertion point.
        const riser = verticalSupplyHitNode(
          `supply-changeover-grid-bus-riser-${panelLayout.panel.id}`,
          gridBusStubX,
          mainBusElement.position.y + (mainBusElement.height || LAYOUT_CONSTANTS.BUS_THICKNESS) / 2,
          changeoverBranches.lowerY,
          {
            type: 'supplyChangeoverGridWire',
            padding: 0,
            supplyFeedScope: 'root',
            supplyInsertIndex: changeoverGridDevices[0]?.feedIndex ?? railAppendIndex,
            supplyPanelId: panelLayout.panel.id,
          }
        )
        if (riser) children.unshift(riser)
      }
      const changeoverGridInputLegDevices = devices
        .filter(
          (candidate) =>
            candidate.device.supplyPath === 'changeover-grid' &&
            candidate.device.changeoverGridPlacement === 'input-leg'
        )
        .sort((a, b) => a.y - b.y)
      // With the converter-input tap the port-1 feed runs horizontally at the T's height, its
      // devices inline (the first stored one nearest the T), and rises to port 1 at the riser
      // when the T sits lower than the port.
      const converterInputTap = changeoverBranches.converterInputTap
      const portOneRiserX = elbowX
      if (converterInputTap) {
        const towardsTap = converterInputTap.x >= portOneRiserX
        const lane = [...changeoverGridInputLegDevices].sort((a, b) =>
          towardsTap ? a.x - b.x : b.x - a.x
        )
        const nearestSwitch = lane[0]
        const waypoints = [
          { x: portOneRiserX, device: undefined as (typeof devices)[number] | undefined },
          ...lane.map((candidate) => ({ x: candidate.x, device: candidate })),
          { x: converterInputTap.x, device: undefined as (typeof devices)[number] | undefined },
        ]
        for (let index = 0; index < waypoints.length - 1; index++) {
          const from = waypoints[index]!
          const to = waypoints[index + 1]!
          const x1 = Math.min(from.x, to.x)
          const x2 = Math.max(from.x, to.x)
          if (x2 <= x1) continue
          children.unshift({
            id: `supply-changeover-converter-input-tap-slot-${panelLayout.panel.id}-${index}`,
            type: 'wire',
            bounds: {
              x: x1 - pad,
              y: converterInputTap.y - pad,
              width: x2 - x1 + pad * 2,
              height: pad * 2,
            },
            hitZone: {
              type: 'supplyChangeoverGridWire',
              padding: 0,
              supplyFeedScope: 'root',
              // A gap inserts after the device on its tap side.
              supplyInsertIndex: to.device
                ? to.device.feedIndex + 1
                : (from.device?.feedIndex ?? changeover.feedIndex),
              supplyPanelId: panelLayout.panel.id,
              changeoverGridPlacement: 'input-leg' as const,
              changeoverGridSource: 'converter-input' as const,
            },
            children: [],
          })
        }
        const portY = lowerPortY
        const tapPortOneHitZone = {
          type: 'supplyChangeoverGridWire' as const,
          padding: 0,
          supplyFeedScope: 'root' as const,
          // Nearest the switch: after every stored port-1 device.
          supplyInsertIndex: nearestSwitch
            ? Math.max(...lane.map((candidate) => candidate.feedIndex)) + 1
            : changeover.feedIndex,
          supplyPanelId: panelLayout.panel.id,
          changeoverGridPlacement: 'input-leg' as const,
          changeoverGridSource: 'converter-input' as const,
        }
        const tapStub = horizontalSupplyHitNode(
          `supply-changeover-converter-input-stub-${panelLayout.panel.id}`,
          rightPortX,
          portOneRiserX,
          portY,
          tapPortOneHitZone
        )
        if (tapStub) children.unshift(tapStub)
        if (converterInputTap.y > portY + 0.01) {
          children.unshift({
            id: `supply-changeover-converter-input-riser-slot-${panelLayout.panel.id}`,
            type: 'wire',
            bounds: {
              x: portOneRiserX - pad,
              y: portY - pad,
              width: pad * 2,
              height: converterInputTap.y - portY + pad * 2,
            },
            hitZone: tapPortOneHitZone,
            children: [],
          })
        }
      }
      const changeoverGridInputLegWaypoints = converterInputTap
        ? []
        : [
            {
              y: lowerPortY,
              index: changeover.feedIndex,
            },
            ...changeoverGridInputLegDevices.map((candidate) => ({
              y: candidate.y,
              index: candidate.feedIndex,
            })),
            { y: changeoverBranches.lowerY, index: changeover.feedIndex },
          ]
      if (changeoverGridInputLegWaypoints.length > 1) {
        // The feed leaves port 1 sideways before it turns onto the riser.
        const stub = horizontalSupplyHitNode(
          `supply-changeover-grid-input-stub-${panelLayout.panel.id}`,
          rightPortX,
          portOneRiserX,
          lowerPortY,
          {
            type: 'supplyChangeoverGridWire',
            padding: 0,
            supplyFeedScope: 'root',
            // Same position as the riser slot below it (the top slot sits after the first device).
            supplyInsertIndex:
              changeoverGridInputLegWaypoints[1]!.index + (changeoverGridInputLegWaypoints.length > 2 ? 1 : 0),
            supplyPanelId: panelLayout.panel.id,
            changeoverGridPlacement: 'input-leg',
          }
        )
        if (stub) children.unshift(stub)
      }
      for (let index = 0; index < changeoverGridInputLegWaypoints.length - 1; index++) {
        const from = changeoverGridInputLegWaypoints[index]!
        const to = changeoverGridInputLegWaypoints[index + 1]!
        if (to.y <= from.y) continue
        children.unshift({
          id: `supply-changeover-grid-input-slot-${panelLayout.panel.id}-${index}`,
          type: 'wire',
          bounds: {
            x: portOneRiserX - pad,
            y: from.y - pad,
            width: pad * 2,
            height: to.y - from.y + pad * 2,
          },
          hitZone: {
            type: 'supplyChangeoverGridWire',
            padding: 0,
            supplyFeedScope: 'root',
            // The riser is stored bottom-up (grid first), the waypoints run top-down: a slot sits
            // after the device below it, or before the one above when nothing is below.
            supplyInsertIndex:
              index + 1 < changeoverGridInputLegWaypoints.length - 1 ? to.index + 1 : from.index,
            supplyPanelId: panelLayout.panel.id,
            changeoverGridPlacement: 'input-leg' as const,
          },
          children: [],
        })
      }
      const gridTapX = backupConverter?.x ?? changeoverBranches.slotEndX
      previousX = elbowX
      const converterGridDevices = converterGridInputConnected
        ? devices
            .filter(
              (candidate) =>
                candidate.device.supplyPath === 'converter-grid' &&
                !isConverterGridLegPlacement(candidate.device.converterGridPlacement)
            )
            .sort((a, b) => a.x - b.x)
        : []
      for (const candidate of converterGridDevices) {
        pushLaneSegment(
          `supply-changeover-converter-grid-slot-${panelLayout.panel.id}-${candidate.device.id}`,
          previousX,
          candidate.x,
          changeoverBranches.lowerY,
          candidate.feedIndex,
          'root',
          'supplyConverterGridWire'
        )
        previousX = candidate.x
      }
      if (backupConverter && converterGridInputConnected) {
        pushLaneSegment(
          `supply-changeover-converter-grid-slot-${panelLayout.panel.id}-tap`,
          previousX,
          gridTapX,
          changeoverBranches.lowerY,
          converterGridDevices.at(-1)?.feedIndex != null
            ? converterGridDevices.at(-1)!.feedIndex + 1
            : backupConverter.feedIndex,
          'root',
          'supplyConverterGridWire'
        )
        previousX = gridTapX
      }
      if (backupConverter && converterGridInputConnected) {
        // Drawn from the converter down: converter-only devices, then shared ones.
        const converterGridInputLegDevices = orderConverterGridLegDevicesFromConverter(
          devices
            .filter(
              (candidate) =>
                candidate.device.supplyPath === 'converter-grid' &&
                isConverterGridLegPlacement(candidate.device.converterGridPlacement)
            )
            .sort((a, b) => a.y - b.y)
        )
        type LegWaypoint = {
          y: number
          index: number
          placement?: 'input-leg' | 'converter-leg'
        }
        const legDeviceWaypoint = (candidate: (typeof devices)[number]): LegWaypoint => ({
          y: candidate.y,
          index: candidate.feedIndex,
          placement:
            candidate.device.converterGridPlacement === 'converter-leg'
              ? 'converter-leg'
              : 'input-leg',
        })
        const tapDevicesAbove = converterInputTap
          ? converterGridInputLegDevices.filter(
              (candidate) => candidate.device.converterGridPlacement === 'converter-leg'
            )
          : []
        const tapDevicesBelow = converterInputTap
          ? converterGridInputLegDevices.filter(
              (candidate) => candidate.device.converterGridPlacement !== 'converter-leg'
            )
          : []
        // With the converter-input tap, each side of the T is its own segment: the last gap
        // above the T appends converter-only devices, the last gap below appends shared ones.
        const verticalWaypoints: LegWaypoint[] = converterInputTap
          ? [
              {
                y: backupConverter.y + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
                index: backupConverter.feedIndex,
              },
              ...tapDevicesAbove.map(legDeviceWaypoint),
              {
                y: converterInputTap.y,
                index: tapDevicesAbove.at(-1)
                  ? tapDevicesAbove.at(-1)!.feedIndex + 1
                  : backupConverter.feedIndex,
                placement: 'converter-leg',
              },
              ...tapDevicesBelow.map(legDeviceWaypoint),
              {
                y: changeoverBranches.lowerY,
                index: tapDevicesBelow.at(-1)
                  ? tapDevicesBelow.at(-1)!.feedIndex + 1
                  : backupConverter.feedIndex,
                placement: 'input-leg',
              },
            ]
          : [
              {
                y: backupConverter.y + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
                index: backupConverter.feedIndex,
              },
              ...converterGridInputLegDevices.map(legDeviceWaypoint),
              { y: changeoverBranches.lowerY, index: backupConverter.feedIndex },
            ]
        for (let index = 0; index < verticalWaypoints.length - 1; index++) {
          const from = verticalWaypoints[index]!
          const to = verticalWaypoints[index + 1]!
          if (to.y <= from.y) continue
          // A gap takes the placement of the device (or tap) closing it from below; the T is
          // the lower end of the converter-only part. Without a tap every gap is shared.
          const placement =
            (converterInputTap && from.y >= converterInputTap.y ? 'input-leg' : to.placement) ??
            'input-leg'
          children.unshift({
            id: `supply-changeover-converter-grid-input-slot-${panelLayout.panel.id}-${index}`,
            type: 'wire',
            bounds: {
              x: backupConverter.x - pad,
              y: from.y - pad,
              width: pad * 2,
              height: to.y - from.y + pad * 2,
            },
            hitZone: {
              type: 'supplyConverterGridWire',
              padding: 0,
              supplyFeedScope: 'root',
              supplyInsertIndex: to.index,
              supplyPanelId: panelLayout.panel.id,
              converterGridPlacement: placement,
            },
            children: [],
          })
        }
      }

      // DC devices belong to the converter's DC wires, not to the AC grid lane.
      const gridDevices = devices.filter(
        (candidate) =>
          candidate.x > changeover.x &&
          !isBranchDevice(candidate) &&
          !['converter-dc', 'converter-dc-top'].includes(candidate.device.supplyPath ?? '')
      )
      let previousScope: 'shared' | 'root' = 'root'
      for (const candidate of gridDevices) {
        if (previousScope !== candidate.feedScope) {
          const separatorX = (previousX + candidate.x) / 2
          pushLaneSegment(
            `supply-changeover-grid-slot-${panelLayout.panel.id}-${candidate.device.id}-root`,
            previousX,
            separatorX,
            changeoverBranches.lowerY,
            0,
            'root'
          )
          pushLaneSegment(
            `supply-changeover-grid-slot-${panelLayout.panel.id}-${candidate.device.id}-shared`,
            separatorX,
            candidate.x,
            changeoverBranches.lowerY,
            sharedCount,
            'shared'
          )
        } else {
          pushLaneSegment(
            `supply-changeover-grid-slot-${panelLayout.panel.id}-${candidate.device.id}`,
            previousX,
            candidate.x,
            changeoverBranches.lowerY,
            candidate.feedIndex + 1,
            candidate.feedScope
          )
        }
        previousX = candidate.x
        previousScope = candidate.feedScope
      }
      // The grid lane stops at the supply symbol, not past it.
      const supplyEndX = supply.x
      if (previousScope === 'root') {
        const separatorX = (previousX + supplyEndX) / 2
        pushLaneSegment(
          `supply-changeover-grid-slot-${panelLayout.panel.id}-supply-root`,
          previousX,
          separatorX,
          changeoverBranches.lowerY,
          0,
          'root'
        )
        pushLaneSegment(
          `supply-changeover-grid-slot-${panelLayout.panel.id}-supply-shared`,
          separatorX,
          supplyEndX,
          changeoverBranches.lowerY,
          0,
          'shared'
        )
      } else {
        pushLaneSegment(
          `supply-changeover-grid-slot-${panelLayout.panel.id}-supply`,
          previousX,
          supplyEndX,
          changeoverBranches.lowerY,
          0,
          'shared'
        )
      }

      const backupOutputDevices = devices
        .filter((candidate) => candidate.device.supplyPath === 'backup-output')
        .sort((a, b) => a.x - b.x)
      // Port 2 leaves the switch sideways and turns up at the riser onto the backup lane.
      const pushBackupPortWires = (
        type: 'supplyBackupOutputWire' | 'supplyBackupWire',
        insertIndex: number
      ) => {
        const hitZone = {
          type,
          padding: 0,
          supplyFeedScope: 'root' as const,
          supplyInsertIndex: insertIndex,
          supplyPanelId: panelLayout.panel.id,
        }
        for (const node of [
          horizontalSupplyHitNode(
            `supply-changeover-backup-port-${panelLayout.panel.id}`,
            rightPortX,
            elbowX,
            upperPortY,
            hitZone
          ),
          verticalSupplyHitNode(
            `supply-changeover-backup-riser-${panelLayout.panel.id}`,
            elbowX,
            changeoverBranches.upperY,
            upperPortY,
            hitZone
          ),
        ]) {
          if (node) children.unshift(node)
        }
      }
      if (backupConverter) {
        const firstBackupSlot = [...backupOutputDevices, backupConverter][0]!
        pushBackupPortWires(
          'supplyBackupOutputWire',
          firstBackupSlot.device.supplyPath === 'backup'
            ? changeover.feedIndex
            : firstBackupSlot.feedIndex
        )
        previousX = elbowX
        for (const candidate of [...backupOutputDevices, backupConverter]) {
          pushLaneSegment(
            `supply-changeover-backup-output-slot-${panelLayout.panel.id}-${candidate.device.id}`,
            previousX,
            candidate.x,
            changeoverBranches.upperY,
            candidate.device.supplyPath === 'backup' ? changeover.feedIndex : candidate.feedIndex,
            'root',
            'supplyBackupOutputWire'
          )
          previousX = candidate.x
        }
      } else {
        const firstBackupOutput = backupOutputDevices[0]
        pushBackupPortWires(
          firstBackupOutput ? 'supplyBackupOutputWire' : 'supplyBackupWire',
          firstBackupOutput
            ? firstBackupOutput.feedIndex
            : (backupOutputDevices.at(-1)?.feedIndex ?? changeover.feedIndex) + 1
        )
        previousX = elbowX
        for (const candidate of backupOutputDevices) {
          pushLaneSegment(
            `supply-changeover-backup-slot-${panelLayout.panel.id}-${candidate.device.id}`,
            previousX,
            candidate.x,
            changeoverBranches.upperY,
            candidate.feedIndex,
            'root',
            'supplyBackupOutputWire'
          )
          previousX = candidate.x
        }
        pushLaneSegment(
          `supply-changeover-backup-slot-${panelLayout.panel.id}-append`,
          previousX,
          (backupOutputDevices.at(-1)?.x ?? elbowX) + LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_SLOT_LENGTH,
          changeoverBranches.upperY,
          backupOutputDevices.at(-1)?.feedIndex != null
            ? backupOutputDevices.at(-1)!.feedIndex + 1
            : (changeover?.feedIndex ?? 0) + 1,
          'root',
          'supplyBackupWire'
        )
      }
    }
  }

  const converterBranch = panelLayout.supplyConverterBranch
  if (converterBranch) {
    const pad = 10
    const devices = panelLayout.supplyDevices ?? []
    const converter = devices.find((candidate) => candidate.device.id === converterBranch.deviceId)
    const gridDevices = devices
      .filter(
        (candidate) =>
          candidate.device.supplyPath === 'converter-grid' &&
          !isConverterGridLegPlacement(candidate.device.converterGridPlacement)
      )
      .sort((a, b) => a.x - b.x)
    if (converter) {
      const converterGridInputConnected = converter.device.converterGridInputConnected !== false
      // Modular changeovers expose their own lane-aware AC hit zones above. The direct-converter
      // AC zones describe different sections and must not overlap those changeover targets.
      const backup = panelLayout.supplyConverterBackup
      if (!converterGridInputConnected) {
        children.unshift({
          id: `supply-direct-converter-load-slot-${panelLayout.panel.id}`,
          type: 'wire',
          bounds: {
            x: converter.x - pad,
            y: panelLayout.supply.y - pad,
            width: pad * 2,
            height: pad * 2,
          },
          hitZone: {
            type: 'supplyWire',
            padding: 0,
            supplyFeedScope: 'root',
            supplyInsertIndex: converter.feedIndex + 1,
            supplyPanelId: panelLayout.panel.id,
          },
          children: [],
        })
      }
      if (!changeoverBranches && backup && backup.x2 > backup.x1) {
        children.unshift({
          id: `supply-direct-converter-backup-slot-${panelLayout.panel.id}`,
          type: 'wire',
          bounds: {
            x: backup.x1 - pad,
            y: backup.y - pad,
            width: backup.x2 - backup.x1 + pad * 2,
            height: pad * 2,
          },
          hitZone: {
            type: 'supplyConverterBackupWire',
            padding: 0,
            supplyFeedScope: 'root',
            supplyPanelId: panelLayout.panel.id,
          },
          children: [],
        })
      }
      const directGridDevices =
        changeoverBranches || !converterGridInputConnected ? [] : gridDevices
      let previousGridX =
        converter.device.converterAcConnection === 'separate'
          ? converter.x
          : (panelLayout.supplyBend?.x ?? converter.x)
      for (const candidate of directGridDevices) {
        children.unshift({
          id: `supply-direct-converter-grid-slot-${panelLayout.panel.id}-${candidate.device.id}`,
          type: 'wire',
          bounds: {
            x: previousGridX - pad,
            y: converterBranch.lineY - pad,
            width: candidate.x - previousGridX + pad * 2,
            height: pad * 2,
          },
          hitZone: {
            type: 'supplyConverterGridWire',
            padding: 0,
            supplyFeedScope: 'root',
            supplyInsertIndex: candidate.feedIndex,
            supplyPanelId: panelLayout.panel.id,
            converterGridPlacement: 'inline',
          },
          children: [],
        })
        previousGridX = candidate.x
      }
      if (!changeoverBranches && converterGridInputConnected && converter.x > previousGridX) {
        const converterGridEndX = converter.x - LAYOUT_CONSTANTS.SUPPLY_CHANGEOVER_RENDER_SIZE - 2
        if (converterGridEndX > previousGridX) {
          children.unshift({
            id: `supply-direct-converter-grid-slot-${panelLayout.panel.id}-append`,
            type: 'wire',
            bounds: {
              x: previousGridX - pad,
              y: converterBranch.lineY - pad,
              width: converterGridEndX - previousGridX + pad * 2,
              height: pad * 2,
            },
            hitZone: {
              type: 'supplyConverterGridWire',
              padding: 0,
              supplyFeedScope: 'root',
              supplyInsertIndex:
                directGridDevices.at(-1)?.feedIndex != null
                  ? directGridDevices.at(-1)!.feedIndex + 1
                  : converter.feedIndex,
              supplyPanelId: panelLayout.panel.id,
              converterGridPlacement: 'inline',
            },
            children: [],
          })
        }
      }
      const inputLegDevices =
        changeoverBranches || !converterGridInputConnected
          ? []
          : orderConverterGridLegDevicesFromConverter(
              devices
                .filter(
                  (candidate) =>
                    candidate.device.supplyPath === 'converter-grid' &&
                    isConverterGridLegPlacement(candidate.device.converterGridPlacement)
                )
                .sort((a, b) => a.y - b.y)
            )
      const inputLegWaypoints =
        changeoverBranches || !converterGridInputConnected
          ? []
          : [
              { y: converter.y + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2, index: converter.feedIndex },
              ...inputLegDevices.map((candidate) => ({
                y: candidate.y,
                index: candidate.feedIndex,
              })),
              { y: converterBranch.lineY, index: converter.feedIndex },
            ]
      for (let index = 0; index < inputLegWaypoints.length - 1; index++) {
        const from = inputLegWaypoints[index]!
        const to = inputLegWaypoints[index + 1]!
        if (to.y <= from.y) continue
        children.unshift({
          id: `supply-direct-converter-grid-input-slot-${panelLayout.panel.id}-${index}`,
          type: 'wire',
          bounds: {
            x: converter.x - pad,
            y: from.y - pad,
            width: pad * 2,
            height: to.y - from.y + pad * 2,
          },
          hitZone: {
            type: 'supplyConverterGridWire',
            padding: 0,
            supplyFeedScope: 'root',
            supplyInsertIndex: to.index,
            supplyPanelId: panelLayout.panel.id,
            converterGridPlacement: 'input-leg',
          },
          children: [],
        })
      }

      const pushDcInsertionSegment = (
        branch: 'right' | 'top',
        connectionIndex: number,
        segmentIndex: number,
        x1: number,
        x2: number,
        y: number,
        insertIndex: number,
        dropHintAnchor?: { x: number; y: number }
      ) => {
        if (x2 <= x1) return
        const branchKey =
          branch === 'right' ? 'right' : connectionIndex === 1 ? 'top' : `top-${connectionIndex}`
        children.unshift({
          id: `supply-direct-converter-dc-${branchKey}-slot-${panelLayout.panel.id}-${segmentIndex}`,
          type: 'wire',
          bounds: {
            x: x1 - pad,
            y: y - pad,
            width: x2 - x1 + pad * 2,
            height: pad * 2,
          },
          hitZone: {
            type: 'supplyConverterDcWire',
            padding: 0,
            supplyFeedScope: 'root',
            supplyInsertIndex: insertIndex,
            supplyPanelId: panelLayout.panel.id,
            supplyConverterDcBranch: branch,
            supplyConverterDcConnectionIndex: connectionIndex,
            dropHintAnchor,
          },
          children: [],
        })
      }
      const pushDcLaneInsertionSegments = (
        branch: 'right' | 'top',
        connectionIndex: number,
        allBranchDevices: typeof devices,
        startX: number,
        endX: number,
        y: number
      ) => {
        // A DC bus terminates the converter's horizontal insertion lane. Its
        // outgoing devices are represented by the bus's vertical branch slots;
        // keeping a trailing horizontal slot here creates a floating
        // left-edge drop zone that is not electrically connected to the bus.
        const busDevice = allBranchDevices.find(({ device }) => device.type === 'dc_bus')
        const branchDevices = busDevice
          ? [
              ...allBranchDevices.filter(
                ({ device, x }) =>
                  device.id !== busDevice.device.id && !device.supplyDcBusId && x < busDevice.x
              ),
              busDevice,
            ].sort((a, b) => a.x - b.x)
          : allBranchDevices
        let previousX = startX
        branchDevices.forEach((candidate, index) => {
          const nextX = candidate.x - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
          pushDcInsertionSegment(
            branch,
            connectionIndex,
            index,
            previousX,
            nextX,
            y,
            candidate.feedIndex
          )
          previousX = candidate.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
        })
        if (!busDevice) {
          const appendIndex =
            branchDevices.at(-1)?.feedIndex != null
              ? branchDevices.at(-1)!.feedIndex + 1
              : converter.feedIndex + 1
          pushDcInsertionSegment(
            branch,
            connectionIndex,
            branchDevices.length,
            previousX,
            endX,
            y,
            appendIndex,
            { x: endX, y }
          )
        }
      }
      const dcPorts = converterBranch.dcPorts ?? []
      for (const port of dcPorts) {
        const branch = port.connectionIndex === 0 ? 'right' : 'top'
        const branchDevices = devices
          .filter(
            (candidate) =>
              getSupplyConverterDcConnectionIndex(candidate.device) === port.connectionIndex
          )
          .sort((a, b) => a.x - b.x)
        if (port.connectionIndex === 0) {
          pushDcLaneInsertionSegments(
            branch,
            port.connectionIndex,
            branchDevices,
            converter.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
            port.endX,
            port.y
          )
          continue
        }
        const converterTopY = getSupplyConverterBodyGeometry(converter.device, converter).top
        children.unshift({
          id: `supply-direct-converter-dc-top-${port.connectionIndex}-vertical-${panelLayout.panel.id}`,
          type: 'wire',
          bounds: {
            x: port.x - pad,
            y: Math.min(port.y, converterTopY) - pad,
            width: pad * 2,
            height: Math.abs(converterTopY - port.y) + pad * 2,
          },
          hitZone: {
            type: 'supplyConverterDcWire',
            padding: 0,
            supplyFeedScope: 'root',
            supplyInsertIndex: branchDevices[0]?.feedIndex ?? converter.feedIndex + 1,
            supplyPanelId: panelLayout.panel.id,
            supplyConverterDcBranch: 'top',
            supplyConverterDcConnectionIndex: port.connectionIndex,
            suppressDropHint: true,
          },
          children: [],
        })
        if (branchDevices.length === 0) {
          pushDcInsertionSegment(
            'top',
            port.connectionIndex,
            0,
            port.x - 1,
            port.x + 1,
            port.y,
            converter.feedIndex + 1,
            { x: port.x, y: port.y }
          )
        } else {
          pushDcLaneInsertionSegments(
            'top',
            port.connectionIndex,
            branchDevices,
            port.x,
            port.endX,
            port.y
          )
        }
      }
    }
  }

  // Add ground wire hit zone (vertical wire from main bus to ground symbol)
  // This must be added AFTER supply wire so it's checked first in hit detection
  if (groundElement && mainBusElement.position) {
    const pad = 10
    // With split bus sections the earth wire rises to the grid lane, not to the bus.
    const hasMainBusConnections = children.some((child) => {
      if (child.type !== 'rcd' && child.type !== 'mcb') return false
      if (isSupplyTapNode(child)) return false
      return (
        panelLayout.circuits.find((candidate) => candidate.circuit.id === child.circuitIdForWires)
          ?.circuit.supplySource?.kind !== 'converter-backup'
      )
    })
    const topY = resolveGroundWireTopY(panelLayout, mainBusElement.position.y, hasMainBusConnections)
    const wireY = Math.min(groundElement.position.y, topY)
    const wireHeight = Math.abs(groundElement.position.y - topY)
    children.unshift({
      id: `ground-wire-${panelLayout.panel.id}`,
      type: 'wire',
      bounds: {
        x: groundElement.position.x - pad,
        y: wireY,
        width: pad * 2,
        height: wireHeight,
      },
      hitZone: {
        type: 'groundWire',
        padding: 0,
      },
      children: [],
    })
  }

  children.push(...busSegmentNodes)

  return {
    id: mainBusElement.id,
    type: 'busBar',
    bounds: {
      x: mainBusElement.position.x,
      y: mainBusElement.position.y,
      width: mainBusElement.width || 0,
      height: mainBusElement.height || LAYOUT_CONSTANTS.BUS_THICKNESS,
    },
    visual: {
      type: 'busBar',
      thickness: LAYOUT_CONSTANTS.BUS_THICKNESS,
    },
    hitZone: {
      // Once the bus has explicit child slots, the parent is only a container.
      // Keeping its old full-width padded zone would swallow every precise
      // segment whenever the pointer is just below the rendered bar.
      type:
        panelLayout.frameRole === 'supply' ||
        children.some((child) => child.id?.startsWith('main-bus-segment-'))
          ? null
          : 'mainBus',
      padding: panelLayout.frameRole === 'supply' ? 0 : 12,
    },
    children,
  }
}
