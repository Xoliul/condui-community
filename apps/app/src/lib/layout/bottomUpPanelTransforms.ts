/** Positioned panel transforms: supply mirroring, frame reflow, placement and row alignment. */
import type { Point } from '@/types/ui'
import { INFO_BLOCK_FRAME_MARGIN, INFO_BLOCK_HEIGHT } from '@/lib/infoBlockLayout'
import type { BottomUpLayoutElement, BottomUpPanelLayout } from './bottomUpLayout'
import { LAYOUT_CONSTANTS, MAIN_BUS_RENDER_STROKE_WIDTH } from './bottomUpLayoutConstants'
import { getBranchProtectionAnchorOffset } from './bottomUpBranchPass'
import { getSupplyDcBusBranchBounds } from './bottomUpSupplyPaintBounds'
import { arrangeBottomRightBlock } from './oneWireBlockLayout'

function mirrorPointX(x: number, axisX: number): number {
  return axisX * 2 - x
}

function mirrorRectX(x: number, width: number, axisX: number): number {
  return axisX * 2 - x - width
}

export function alignCompactInlineSupplyBusWithAnchors(panelLayout: BottomUpPanelLayout): void {
  if (!panelLayout.compactInlineSupplyBus) return
  const rightmostBusAnchor = Math.max(
    panelLayout.supplyBend?.x ?? Number.NEGATIVE_INFINITY,
    panelLayout.ground?.x ?? Number.NEGATIVE_INFINITY
  )
  if (!Number.isFinite(rightmostBusAnchor)) return

  // The ordinary implicit bus ends just beyond the earth/feed risers. Anchor
  // the supply-only rail to those final positioned risers as well; doing this
  // after panel placement prevents an earlier canonical coordinate from
  // leaving the rail stranded below the panel title.
  const compactBusX = rightmostBusAnchor + LAYOUT_CONSTANTS.LEFT_MARGIN - panelLayout.mainBus.width
  panelLayout.mainBus.x = compactBusX
  const mainBusElement = panelLayout.elements.find((element) => element.type === 'mainBus')
  if (mainBusElement) mainBusElement.position.x = compactBusX
  const mainBusBlock = panelLayout.layoutBlocks?.find((block) => block.kind === 'main-bus')
  if (mainBusBlock) {
    mainBusBlock.x = compactBusX - MAIN_BUS_RENDER_STROKE_WIDTH / 2
    mainBusBlock.width = panelLayout.mainBus.width + MAIN_BUS_RENDER_STROKE_WIDTH
  }
}

/**
 * Supply taps keep their branch orientation: a tap's columns are shifted with the mirror instead of
 * reflected, so its branches point right in the final scene like those of an ordinary board.
 * `shift = 2 * (axis - tap.x)` moves a tap's content to its mirrored column (`axis*2 - tap.x`). The
 * transform stays an involution because the next application reads the already moved column.
 */
function getSupplyTapMirrorShifts(panelLayout: BottomUpPanelLayout, axisX: number) {
  const byCircuit = new Map<string, number>()
  const byProtection = new Map<string, number>()
  for (const tap of panelLayout.supplyTaps ?? []) {
    const shift = (axisX - tap.x) * 2
    for (const circuitId of tap.circuitIds) byCircuit.set(circuitId, shift)
    if (tap.protectionId) byProtection.set(tap.protectionId, shift)
  }
  return { byCircuit, byProtection }
}

/**
 * Mirror a detached supply frame's positioned geometry without mirroring text or symbol artwork.
 *
 * The supply topology and hit-zone builders still use their established right-to-left canonical
 * coordinates. This involutive transform lets those builders temporarily return to canonical
 * space while the public layout and rendered frame flow from left to right.
 */
export function mirrorDetachedSupplyPanelLayoutHorizontally(
  panelLayout: BottomUpPanelLayout
): void {
  const axisX = panelLayout.frame.x + panelLayout.frame.width / 2
  panelLayout.supplyMirrorAxisX = axisX

  panelLayout.supplyFlowDirection =
    panelLayout.supplyFlowDirection === 'left-to-right' ? 'right-to-left' : 'left-to-right'

  const tapShifts = getSupplyTapMirrorShifts(panelLayout, axisX)
  const tapShiftOf = (circuitId?: string, protectionId?: string): number | undefined =>
    (circuitId != null ? tapShifts.byCircuit.get(circuitId) : undefined) ??
    (protectionId != null ? tapShifts.byProtection.get(protectionId) : undefined)

  panelLayout.elements.forEach((element) => {
    const tapShift = tapShiftOf(element.circuitId, element.protectionId)
    if (tapShift != null) {
      element.position.x += tapShift
      return
    }
    if (
      element.width != null &&
      (element.type === 'mainBus' || element.type === 'branch' || element.type === 'trunk')
    ) {
      element.position.x = mirrorRectX(element.position.x, element.width, axisX)
    } else {
      element.position.x = mirrorPointX(element.position.x, axisX)
    }
    if (
      element.type === 'endpoint' &&
      panelLayout.circuits.some(
        ({ circuit }) =>
          circuit.id === element.circuitId && circuit.supplySource?.kind === 'converter-backup'
      )
    ) {
      element.mirrorEndpointHorizontally = !element.mirrorEndpointHorizontally
    }
  })

  panelLayout.branches.forEach((branch) => {
    const tapShift = tapShiftOf(branch.circuitId)
    if (tapShift != null) {
      branch.trunkX += tapShift
      branch.branchX += tapShift
      if (branch.labelX != null) branch.labelX += tapShift
      return
    }
    branch.trunkX = mirrorPointX(branch.trunkX, axisX)
    branch.branchX = mirrorRectX(branch.branchX, branch.branchWidth, axisX)
  })
  panelLayout.trunks.forEach((trunk) => {
    const tapShift =
      tapShiftOf(undefined, trunk.protectionId) ??
      trunk.circuits.map((circuit) => tapShiftOf(circuit.id)).find((shift) => shift != null)
    if (tapShift != null) trunk.x += tapShift
    else trunk.x = mirrorRectX(trunk.x, trunk.width, axisX)
  })
  panelLayout.mainBus.x = mirrorRectX(panelLayout.mainBus.x, panelLayout.mainBus.width, axisX)
  panelLayout.supply.x = mirrorPointX(panelLayout.supply.x, axisX)
  if (panelLayout.supplyBend)
    panelLayout.supplyBend.x = mirrorPointX(panelLayout.supplyBend.x, axisX)
  if (panelLayout.ground) panelLayout.ground.x = mirrorPointX(panelLayout.ground.x, axisX)

  panelLayout.supplyDevices?.forEach((device) => {
    device.x = mirrorPointX(device.x, axisX)
    if (device.metadataCalloutRect) {
      const { left, right } = device.metadataCalloutRect
      device.metadataCalloutRect.left = mirrorPointX(right, axisX)
      device.metadataCalloutRect.right = mirrorPointX(left, axisX)
    }
    device.topLabelPlacements?.forEach((placement) => {
      placement.x = mirrorRectX(placement.x, placement.width, axisX)
      placement.offsetX *= -1
    })
  })
  panelLayout.groundDevices?.forEach((device) => {
    device.x = mirrorPointX(device.x, axisX)
  })
  if (panelLayout.supplyChangeoverBranches) {
    panelLayout.supplyChangeoverBranches.x = mirrorPointX(
      panelLayout.supplyChangeoverBranches.x,
      axisX
    )
    panelLayout.supplyChangeoverBranches.elbowX = mirrorPointX(
      panelLayout.supplyChangeoverBranches.elbowX,
      axisX
    )
    panelLayout.supplyChangeoverBranches.slotEndX = mirrorPointX(
      panelLayout.supplyChangeoverBranches.slotEndX,
      axisX
    )
    const converterInputTap = panelLayout.supplyChangeoverBranches.converterInputTap
    if (converterInputTap) {
      converterInputTap.x = mirrorPointX(converterInputTap.x, axisX)
      converterInputTap.riserX = mirrorPointX(converterInputTap.riserX, axisX)
    }
  }
  if (panelLayout.supplyConverterBranch) {
    panelLayout.supplyConverterBranch.x = mirrorPointX(panelLayout.supplyConverterBranch.x, axisX)
    panelLayout.supplyConverterBranch.dcEndX = mirrorPointX(
      panelLayout.supplyConverterBranch.dcEndX,
      axisX
    )
    if (panelLayout.supplyConverterBranch.dcTopEndX != null) {
      panelLayout.supplyConverterBranch.dcTopEndX = mirrorPointX(
        panelLayout.supplyConverterBranch.dcTopEndX,
        axisX
      )
    }
    panelLayout.supplyConverterBranch.dcPorts?.forEach((port) => {
      port.x = mirrorPointX(port.x, axisX)
      port.endX = mirrorPointX(port.endX, axisX)
    })
  }
  if (panelLayout.supplyConverterBackup) {
    const { x1, x2 } = panelLayout.supplyConverterBackup
    panelLayout.supplyConverterBackup.x1 = mirrorPointX(x2, axisX)
    panelLayout.supplyConverterBackup.x2 = mirrorPointX(x1, axisX)
  }
  if (panelLayout.feedOutput) {
    panelLayout.feedOutput.x = mirrorPointX(panelLayout.feedOutput.x, axisX)
  }

  panelLayout.supplyTaps?.forEach((tap) => {
    tap.x = mirrorPointX(tap.x, axisX)
  })
  panelLayout.circuits.forEach((circuit) => {
    const tapShift = tapShiftOf(circuit.circuit.id)
    if (tapShift != null) {
      circuit.x += tapShift
      return
    }
    const protectionAnchorOffset = getProtectionAnchorOffset(circuit.leftReserve)
    circuit.x = mirrorPointX(circuit.x + protectionAnchorOffset, axisX) - protectionAnchorOffset
  })
  panelLayout.circuitNotes?.forEach((note) => {
    note.x += tapShiftOf(note.circuitId) ?? mirrorPointX(note.x, axisX) - note.x
  })
  panelLayout.layoutBlocks?.forEach((block) => {
    // The information block is a readable document control, not electrical
    // topology. Keep its established bottom-right frame anchor.
    if (block.kind !== 'info-block') block.x = mirrorRectX(block.x, block.width, axisX)
  })
  // DC-bus branch labels intentionally keep their readable left/right side in
  // the mirrored drawing. Re-measure these blocks around the final symbol
  // positions instead of mirroring a canonical rectangle whose wide side may
  // now point away from the text it is meant to reserve.
  panelLayout.layoutBlocks?.forEach((block) => {
    const positionedBranch = panelLayout.supplyDevices?.find(
      ({ device }) =>
        device.supplyDcBusId != null &&
        device.type !== 'dc_bus' &&
        block.id.endsWith(`-supply-device-${device.id}`)
    )
    if (!positionedBranch) return
    const branchBounds = getSupplyDcBusBranchBounds([positionedBranch.device])
    block.x = positionedBranch.x + branchBounds.left - 4
    block.y = positionedBranch.y + branchBounds.top - 4
    block.width = branchBounds.right - branchBounds.left + 8
    block.height = branchBounds.bottom - branchBounds.top + 8
  })
  if (panelLayout.parentMcb) {
    panelLayout.parentMcb.position.x = mirrorPointX(panelLayout.parentMcb.position.x, axisX)
  }
}

/** Mirror only the lower supply/earthing assembly of an ordinary panel frame. */
export function mirrorInlineSupplyPanelLayoutHorizontally(panelLayout: BottomUpPanelLayout): void {
  const axisX =
    panelLayout.supplyMirrorAxisX ??
    (panelLayout.supply.x + (panelLayout.supplyBend?.x ?? panelLayout.mainBus.x)) / 2
  panelLayout.supplyMirrorAxisX = axisX
  panelLayout.supplyFlowDirection =
    panelLayout.supplyFlowDirection === 'left-to-right' ? 'right-to-left' : 'left-to-right'

  if (panelLayout.inlineEmptySplitRails) {
    panelLayout.mainBus.x = mirrorRectX(
      panelLayout.mainBus.x,
      panelLayout.mainBus.width,
      axisX
    )
    panelLayout.elements.forEach((element) => {
      if (element.type === 'mainBus') {
        element.position.x = mirrorRectX(element.position.x, element.width ?? 0, axisX)
      }
    })
    panelLayout.layoutBlocks?.forEach((block) => {
      if (block.kind === 'supply-stub') block.x = mirrorRectX(block.x, block.width, axisX)
    })
  }

  const isSupplyElement = (element: BottomUpLayoutElement) =>
    element.type === 'supply' ||
    element.type === 'ground' ||
    (element.type === 'trunkDevice' &&
      (element.id.startsWith('supplyTrunkDevice-') ||
        element.id.startsWith('groundTrunkDevice-'))) ||
    element.id === 'supply-continuation-label' ||
    element.id === 'feed-output-label' ||
    (element.circuitId != null &&
      panelLayout.circuits.some(
        ({ circuit }) =>
          circuit.id === element.circuitId && circuit.supplySource?.kind === 'converter-backup'
      ))

  panelLayout.elements.forEach((element) => {
    if (isSupplyElement(element)) {
      element.position.x = mirrorPointX(element.position.x, axisX)
    }
  })
  panelLayout.supply.x = mirrorPointX(panelLayout.supply.x, axisX)
  if (panelLayout.supplyBend)
    panelLayout.supplyBend.x = mirrorPointX(panelLayout.supplyBend.x, axisX)
  if (panelLayout.ground) panelLayout.ground.x = mirrorPointX(panelLayout.ground.x, axisX)
  panelLayout.supplyDevices?.forEach((device) => {
    device.x = mirrorPointX(device.x, axisX)
    if (device.metadataCalloutRect) {
      const { left, right } = device.metadataCalloutRect
      device.metadataCalloutRect.left = mirrorPointX(right, axisX)
      device.metadataCalloutRect.right = mirrorPointX(left, axisX)
    }
    device.topLabelPlacements?.forEach((placement) => {
      placement.x = mirrorRectX(placement.x, placement.width, axisX)
      placement.offsetX *= -1
    })
  })
  panelLayout.groundDevices?.forEach((device) => {
    device.x = mirrorPointX(device.x, axisX)
  })
  if (panelLayout.supplyChangeoverBranches) {
    panelLayout.supplyChangeoverBranches.x = mirrorPointX(
      panelLayout.supplyChangeoverBranches.x,
      axisX
    )
    panelLayout.supplyChangeoverBranches.elbowX = mirrorPointX(
      panelLayout.supplyChangeoverBranches.elbowX,
      axisX
    )
    panelLayout.supplyChangeoverBranches.slotEndX = mirrorPointX(
      panelLayout.supplyChangeoverBranches.slotEndX,
      axisX
    )
    const converterInputTap = panelLayout.supplyChangeoverBranches.converterInputTap
    if (converterInputTap) {
      converterInputTap.x = mirrorPointX(converterInputTap.x, axisX)
      converterInputTap.riserX = mirrorPointX(converterInputTap.riserX, axisX)
    }
  }
  if (panelLayout.supplyConverterBranch) {
    panelLayout.supplyConverterBranch.x = mirrorPointX(panelLayout.supplyConverterBranch.x, axisX)
    panelLayout.supplyConverterBranch.dcEndX = mirrorPointX(
      panelLayout.supplyConverterBranch.dcEndX,
      axisX
    )
    if (panelLayout.supplyConverterBranch.dcTopEndX != null) {
      panelLayout.supplyConverterBranch.dcTopEndX = mirrorPointX(
        panelLayout.supplyConverterBranch.dcTopEndX,
        axisX
      )
    }
    panelLayout.supplyConverterBranch.dcPorts?.forEach((port) => {
      port.x = mirrorPointX(port.x, axisX)
      port.endX = mirrorPointX(port.endX, axisX)
    })
  }
  if (panelLayout.supplyConverterBackup) {
    const { x1, x2 } = panelLayout.supplyConverterBackup
    panelLayout.supplyConverterBackup.x1 = mirrorPointX(x2, axisX)
    panelLayout.supplyConverterBackup.x2 = mirrorPointX(x1, axisX)
  }
  panelLayout.circuits.forEach((circuitLayout) => {
    if (circuitLayout.circuit.supplySource?.kind !== 'converter-backup') return
    const protectionAnchorOffset = getProtectionAnchorOffset(circuitLayout.leftReserve)
    circuitLayout.x =
      mirrorPointX(circuitLayout.x + protectionAnchorOffset, axisX) - protectionAnchorOffset
  })
  panelLayout.branches.forEach((branch) => {
    const circuit = panelLayout.circuits.find(
      ({ circuit }) => circuit.id === branch.circuitId
    )?.circuit
    if (circuit?.supplySource?.kind !== 'converter-backup') return
    branch.trunkX = mirrorPointX(branch.trunkX, axisX)
    branch.branchX = mirrorRectX(branch.branchX, branch.branchWidth, axisX)
  })
  panelLayout.trunks.forEach((trunk) => {
    if (!trunk.circuits.some((circuit) => circuit.supplySource?.kind === 'converter-backup')) {
      return
    }
    trunk.x = mirrorRectX(trunk.x, trunk.width, axisX)
  })
  panelLayout.circuitNotes?.forEach((note) => {
    const circuit = panelLayout.circuits.find(
      ({ circuit }) => circuit.id === note.circuitId
    )?.circuit
    if (circuit?.supplySource?.kind === 'converter-backup') {
      note.x = mirrorPointX(note.x, axisX)
    }
  })
  panelLayout.layoutBlocks?.forEach((block) => {
    if (block.kind === 'supply-assembly') {
      block.x = mirrorRectX(block.x, block.width, axisX)
    }
  })
}

export function reflowSupplyInfoBlockAfterMirror(
  panelLayout: BottomUpPanelLayout,
  preferBelow: boolean
): void {
  const infoBlock = panelLayout.layoutBlocks?.find((block) => block.kind === 'info-block')
  if (!infoBlock) return
  const obstacles = (panelLayout.layoutBlocks ?? []).filter((block) => block !== infoBlock)
  const arrangement = arrangeBottomRightBlock({
    frameLeft: panelLayout.frame.x,
    frameTop: panelLayout.frame.y,
    initialFrameRight: panelLayout.frame.x + panelLayout.frame.width,
    initialFrameBottom: panelLayout.frame.y + panelLayout.frame.height,
    frameMargin: INFO_BLOCK_FRAME_MARGIN,
    blockWidth: infoBlock.width,
    blockHeight: infoBlock.height,
    obstacles,
    clearance: 10,
    preferBelow,
    sideStepLimitRatio: preferBelow ? undefined : 1,
  })
  infoBlock.x = arrangement.block.x
  infoBlock.y = arrangement.block.y
  infoBlock.label = `info block (${arrangement.placement})`
  panelLayout.frame.width = arrangement.frameRight - panelLayout.frame.x
  panelLayout.frame.height = arrangement.frameBottom - panelLayout.frame.y
}

export function expandPanelFrameLeftForMirroredSupply(panelLayout: BottomUpPanelLayout): void {
  const mirroredSupplyLeft = Math.min(
    ...(panelLayout.layoutBlocks ?? [])
      .filter((block) => block.kind === 'supply-assembly')
      .map((block) => block.x),
    panelLayout.supply.x - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
  )
  const requiredFrameLeft = mirroredSupplyLeft - 20
  if (requiredFrameLeft >= panelLayout.frame.x) return
  const expansion = panelLayout.frame.x - requiredFrameLeft
  panelLayout.supplyFrameLeftExpansion = expansion
  panelLayout.frame.width += expansion
}

export function applyShiftToPanelLayout(panelLayout: BottomUpPanelLayout, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return

  panelLayout.frame.x += dx
  panelLayout.frame.y += dy
  if (panelLayout.supplyMirrorAxisX != null) panelLayout.supplyMirrorAxisX += dx

  panelLayout.elements.forEach((el) => {
    el.position.x += dx
    el.position.y += dy
  })

  panelLayout.branches.forEach((branch) => {
    branch.branchX += dx
    branch.trunkX += dx
    branch.branchY += dy
    branch.trunkY += dy
    if (branch.column) branch.column.crossbarY += dy
  })

  panelLayout.trunks.forEach((trunk) => {
    trunk.x += dx
    trunk.y += dy
  })

  panelLayout.supplyTaps?.forEach((tap) => {
    tap.x += dx
    tap.laneY += dy
    tap.topY += dy
  })
  panelLayout.mainBus.x += dx
  panelLayout.mainBus.y += dy
  panelLayout.supply.x += dx
  panelLayout.supply.y += dy
  if (panelLayout.supplyBend) {
    panelLayout.supplyBend.x += dx
    panelLayout.supplyBend.y += dy
  }
  if (panelLayout.ground) {
    panelLayout.ground.x += dx
    panelLayout.ground.y += dy
  }
  panelLayout.supplyDevices?.forEach((device) => {
    device.x += dx
    device.y += dy
    if (device.metadataCalloutRect) {
      device.metadataCalloutRect.left += dx
      device.metadataCalloutRect.right += dx
      device.metadataCalloutRect.top += dy
      device.metadataCalloutRect.bottom += dy
    }
    device.topLabelPlacements?.forEach((placement) => {
      placement.x += dx
      placement.y += dy
    })
  })
  if (panelLayout.supplyChangeoverBranches) {
    panelLayout.supplyChangeoverBranches.x += dx
    panelLayout.supplyChangeoverBranches.y += dy
    panelLayout.supplyChangeoverBranches.elbowX += dx
    panelLayout.supplyChangeoverBranches.upperY += dy
    panelLayout.supplyChangeoverBranches.lowerY += dy
    panelLayout.supplyChangeoverBranches.slotEndX += dx
    if (panelLayout.supplyChangeoverBranches.converterInputTap) {
      panelLayout.supplyChangeoverBranches.converterInputTap.x += dx
      panelLayout.supplyChangeoverBranches.converterInputTap.riserX += dx
      panelLayout.supplyChangeoverBranches.converterInputTap.y += dy
    }
  }
  if (panelLayout.supplyConverterBranch) {
    panelLayout.supplyConverterBranch.x += dx
    panelLayout.supplyConverterBranch.y += dy
    panelLayout.supplyConverterBranch.lineY += dy
    panelLayout.supplyConverterBranch.dcEndX += dx
    if (panelLayout.supplyConverterBranch.dcTopY != null) {
      panelLayout.supplyConverterBranch.dcTopY += dy
    }
    if (panelLayout.supplyConverterBranch.dcTopEndX != null) {
      panelLayout.supplyConverterBranch.dcTopEndX += dx
    }
    panelLayout.supplyConverterBranch.dcPorts?.forEach((port) => {
      port.x += dx
      port.y += dy
      port.endX += dx
    })
  }
  if (panelLayout.supplyConverterBackup) {
    panelLayout.supplyConverterBackup.x1 += dx
    panelLayout.supplyConverterBackup.x2 += dx
    panelLayout.supplyConverterBackup.y += dy
  }
  if (panelLayout.feedOutput) {
    panelLayout.feedOutput.x += dx
    panelLayout.feedOutput.busY += dy
    panelLayout.feedOutput.endY += dy
  }
  panelLayout.groundDevices?.forEach((device) => {
    device.x += dx
    device.y += dy
  })
  panelLayout.circuits.forEach((circuit) => {
    circuit.x += dx
    circuit.protectionY += dy
    if (circuit.trunkY != null) circuit.trunkY += dy
    if (circuit.secondaryBusY != null) circuit.secondaryBusY += dy
  })
  panelLayout.circuitNotes?.forEach((note) => {
    note.x += dx
    note.y += dy
  })
  panelLayout.layoutBlocks?.forEach((block) => {
    block.x += dx
    block.y += dy
  })
  if (panelLayout.parentMcb) {
    panelLayout.parentMcb.position.x += dx
    panelLayout.parentMcb.position.y += dy
  }
}

export function getManualOverrideFrameShift(
  panelLayout: Pick<BottomUpPanelLayout, 'circuits'>,
  manualOverrides?: ReadonlyMap<string, Point>
): number {
  // A negative preview override means a widened circuit envelope extends left
  // of the canonical frame. Carry that offset into frame placement so the
  // placement pass does not shift existing circuit trunks to the right again.
  return Math.min(
    0,
    ...panelLayout.circuits
      .map((circuit) => manualOverrides?.get(`circuit-${circuit.circuit.id}`)?.x)
      .filter((x): x is number => x != null)
  )
}

export function applyPanelFrameBottomAlignmentByRow(
  panelLayouts: BottomUpPanelLayout[],
  getRowKey: (panelLayout: BottomUpPanelLayout) => number
): void {
  const extentsByRow = new Map<number, { min: number; max: number }>()

  panelLayouts.forEach((panelLayout) => {
    const rowKey = getRowKey(panelLayout)
    const bottom = panelLayout.frame.y + panelLayout.frame.height
    const extents = extentsByRow.get(rowKey)
    extentsByRow.set(
      rowKey,
      extents
        ? {
            min: Math.min(extents.min, bottom),
            max: Math.max(extents.max, bottom),
          }
        : { min: bottom, max: bottom }
    )
  })

  panelLayouts.forEach((panelLayout) => {
    const rowKey = getRowKey(panelLayout)
    const extents = extentsByRow.get(rowKey)
    if (!extents) return

    const rowBottom = Math.max(extents.min, extents.max - (panelLayout.layoutBlocks?.find((block) => block.kind === 'info-block')?.height ?? INFO_BLOCK_HEIGHT) * 1.75)
    const targetHeight = rowBottom - panelLayout.frame.y
    // A panel's collision solver may have added a right-hand or lower row for
    // its info block. Row alignment may grow a shorter frame, but must never
    // shrink that collision-safe result.
    if (targetHeight > panelLayout.frame.height) {
      panelLayout.frame.height = targetHeight
      const infoBlock = panelLayout.layoutBlocks?.find((block) => block.kind === 'info-block')
      if (!infoBlock) return
      const bottomAlignedY =
        panelLayout.frame.y + panelLayout.frame.height - infoBlock.height - INFO_BLOCK_FRAME_MARGIN
      const requiredInfoY = Math.max(
        bottomAlignedY,
        ...(panelLayout.layoutBlocks ?? [])
          .filter(
            (block) =>
              block !== infoBlock &&
              block.x < infoBlock.x + infoBlock.width + 10 &&
              block.x + block.width + 10 > infoBlock.x
          )
          .map((block) => block.y + block.height + 10)
      )
      panelLayout.frame.height = Math.max(
        panelLayout.frame.height,
        requiredInfoY + infoBlock.height + INFO_BLOCK_FRAME_MARGIN - panelLayout.frame.y
      )
      infoBlock.y =
        panelLayout.frame.y + panelLayout.frame.height - infoBlock.height - INFO_BLOCK_FRAME_MARGIN
    }
  })
}

export function getProtectionAnchorOffset(leftReserve: number): number {
  return getBranchProtectionAnchorOffset(leftReserve, LAYOUT_CONSTANTS)
}
