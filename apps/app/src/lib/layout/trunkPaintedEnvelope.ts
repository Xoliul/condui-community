import type { BottomUpCircuitLayout, BottomUpPanelLayout } from '@/lib/layout/bottomUpLayout'
import {
  LAYOUT_CONSTANTS,
  MAIN_BUS_RENDER_STROKE_WIDTH,
} from '@/lib/layout/bottomUpLayout'
import {
  CIRCUIT_NOTES_HORIZONTAL_SLICE_CLEARANCE,
  CIRCUIT_NOTES_VERTICAL_SLICE_CLEARANCE,
  getCircuitNotesPaintBounds,
} from '@/lib/layout/circuitNoteMetrics'
import {
  getCircuitConverterDcConnectionCount,
  getOrdinaryCircuitConverterOutputRowY,
  supportsCircuitConverterDcConnections,
} from '@/lib/layout/circuitConverterGeometry'

export interface TrunkPaintedEnvelope {
  x: number
  y: number
  width: number
  height: number
}

export interface PackedPaintBounds {
  x: number
  y: number
  width: number
  height: number
}

function collectDescendantIds(
  panelLayout: BottomUpPanelLayout,
  circuitLayout: BottomUpCircuitLayout,
): Set<string> {
  const ids = new Set<string>()
  const visit = (circuitId: string) => {
    if (ids.has(circuitId)) return
    ids.add(circuitId)
    const circuit = panelLayout.circuits.find(
      (candidate) => candidate.circuit.id === circuitId,
    )?.circuit
    for (const childId of circuit?.subCircuitIds ?? []) visit(childId)
  }
  visit(circuitLayout.circuit.id)
  return ids
}

/**
 * Same cyan trunk rectangle as the one-wire debug overlay: circuit x/width and
 * the painted vertical extent of that trunk's branches, devices, and notes.
 */
export function getCircuitTrunkPaintedEnvelope(
  panelLayout: BottomUpPanelLayout,
  circuitLayout: BottomUpCircuitLayout,
): TrunkPaintedEnvelope {
  const circuitIds = collectDescendantIds(panelLayout, circuitLayout)
  let minY = panelLayout.mainBus.y - LAYOUT_CONSTANTS.SYMBOL_SIZE
  let maxY = panelLayout.mainBus.y + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2

  for (const branch of panelLayout.branches ?? []) {
    if (!circuitIds.has(branch.circuitId)) continue
    minY = Math.min(minY, branch.branchY - LAYOUT_CONSTANTS.SYMBOL_SIZE)
    maxY = Math.max(maxY, branch.branchY + LAYOUT_CONSTANTS.SYMBOL_SIZE)
  }
  for (const element of panelLayout.elements ?? []) {
    if (!element.circuitId || !circuitIds.has(element.circuitId)) continue
    minY = Math.min(minY, element.position.y - LAYOUT_CONSTANTS.SYMBOL_SIZE)
    maxY = Math.max(maxY, element.position.y + LAYOUT_CONSTANTS.SYMBOL_SIZE)
    if (element.type === 'trunkDevice' && element.trunkDeviceId) {
      const circuit = panelLayout.circuits.find(
        (candidate) => candidate.circuit.id === element.circuitId,
      )?.circuit
      const device = circuit?.trunkDevices?.find(
        (candidate) => candidate.id === element.trunkDeviceId,
      )
      if (supportsCircuitConverterDcConnections(device)) {
        const count = getCircuitConverterDcConnectionCount(device)
        minY = Math.min(
          minY,
          ...Array.from({ length: count }, (_, connectionIndex) =>
            getOrdinaryCircuitConverterOutputRowY(device!, element.position.y, connectionIndex) -
              LAYOUT_CONSTANTS.SYMBOL_SIZE,
          ),
        )
      }
    }
  }
  for (const note of panelLayout.circuitNotes ?? []) {
    if (!circuitIds.has(note.circuitId) || note.notesVisible === false) continue
    const noteBounds = getCircuitNotesPaintBounds(note.label, note.notesOrientation)
    const clearance =
      note.notesOrientation === 'vertical'
        ? CIRCUIT_NOTES_VERTICAL_SLICE_CLEARANCE
        : CIRCUIT_NOTES_HORIZONTAL_SLICE_CLEARANCE
    minY = Math.min(minY, note.y + noteBounds.top - clearance)
  }

  const circuit = panelLayout.circuits.find(
    (candidate) => candidate.circuit.id === circuitLayout.circuit.id,
  )?.circuit
  const dcBusBranchStep = LAYOUT_CONSTANTS.SYMBOL_SIZE + LAYOUT_CONSTANTS.TRUNK_DEVICE_SPACING
  for (const bus of (circuit?.trunkDevices ?? []).filter((device) => device.type === 'dc_bus')) {
    const busElement = (panelLayout.elements ?? []).find(
      (element) => element.type === 'trunkDevice' && element.trunkDeviceId === bus.id,
    )
    let busY = busElement?.position.y
    if (busY == null && bus.converterDcConnection) {
      const converterElement = (panelLayout.elements ?? []).find(
        (element) =>
          element.type === 'trunkDevice' &&
          element.trunkDeviceId === bus.converterDcConnection?.converterId,
      )
      const converter = circuit?.trunkDevices?.find(
        (device) => device.id === bus.converterDcConnection?.converterId,
      )
      if (converterElement && converter) {
        busY = getOrdinaryCircuitConverterOutputRowY(
          converter,
          converterElement.position.y,
          bus.converterDcConnection.connectionIndex,
        )
      }
    }
    if (busY == null) continue

    minY = Math.min(minY, busY - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2)
    for (const branch of (circuit?.branches ?? []).filter(
      (candidate) => candidate.dcBusId === bus.id,
    )) {
      if (branch.endpointIds.length === 0) continue
      minY = Math.min(minY, busY - branch.endpointIds.length * dcBusBranchStep - 4)
    }
  }

  return {
    x: circuitLayout.x,
    y: minY,
    width: circuitLayout.width,
    height: Math.max(1, maxY - minY),
  }
}

function includeRect(
  bounds: { left: number; right: number; top: number; bottom: number },
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (!Number.isFinite(x) || !Number.isFinite(y) || width <= 0 || height <= 0) return
  bounds.left = Math.min(bounds.left, x)
  bounds.right = Math.max(bounds.right, x + width)
  bounds.top = Math.min(bounds.top, y)
  bounds.bottom = Math.max(bounds.bottom, y + height)
}

/**
 * Tight pack of the painted one-wire: trunk debug boxes, the main bus, and
 * non-info layout blocks (supply, stubs). Empty frame padding and the canvas
 * info block stay out so PDF scale can fill the page.
 */
export function getPanelPackedPaintBounds(
  panelLayout: BottomUpPanelLayout,
): PackedPaintBounds | null {
  const bounds = {
    left: Number.POSITIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY,
    top: Number.POSITIVE_INFINITY,
    bottom: Number.NEGATIVE_INFINITY,
  }

  for (const circuitLayout of panelLayout.circuits ?? []) {
    const envelope = getCircuitTrunkPaintedEnvelope(panelLayout, circuitLayout)
    includeRect(bounds, envelope.x, envelope.y, envelope.width, envelope.height)
  }

  const mainBus = panelLayout.mainBus
  if (mainBus && Number.isFinite(mainBus.x) && Number.isFinite(mainBus.width) && mainBus.width > 0) {
    includeRect(
      bounds,
      mainBus.x - MAIN_BUS_RENDER_STROKE_WIDTH / 2,
      mainBus.y - MAIN_BUS_RENDER_STROKE_WIDTH / 2,
      mainBus.width + MAIN_BUS_RENDER_STROKE_WIDTH,
      MAIN_BUS_RENDER_STROKE_WIDTH,
    )
  }

  // These are the same visible boxes shown by the trunk-layout debug overlay.
  // Collision-only reserves and the document info block must not define the
  // PDF viewBox: neither is painted electrical content.
  for (const block of panelLayout.layoutBlocks ?? []) {
    if (block.debugVisible === false || block.kind === 'info-block') continue
    includeRect(bounds, block.x, block.y, block.width, block.height)
  }

  const supply = panelLayout.supply
  if (supply && Number.isFinite(supply.x) && Number.isFinite(supply.y)) {
    includeRect(
      bounds,
      supply.x - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
      supply.y - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
      LAYOUT_CONSTANTS.SYMBOL_SIZE,
      LAYOUT_CONSTANTS.SYMBOL_SIZE,
    )
  }
  const ground = panelLayout.ground
  if (ground && Number.isFinite(ground.x) && Number.isFinite(ground.y)) {
    includeRect(
      bounds,
      ground.x - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
      ground.y - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
      LAYOUT_CONSTANTS.SYMBOL_SIZE,
      LAYOUT_CONSTANTS.SYMBOL_SIZE,
    )
  }
  for (const device of panelLayout.supplyDevices ?? []) {
    includeRect(
      bounds,
      device.x - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
      device.y - LAYOUT_CONSTANTS.SYMBOL_SIZE / 2,
      LAYOUT_CONSTANTS.SYMBOL_SIZE,
      LAYOUT_CONSTANTS.SYMBOL_SIZE,
    )
  }

  if (
    !Number.isFinite(bounds.left) ||
    !Number.isFinite(bounds.right) ||
    bounds.right <= bounds.left ||
    bounds.bottom <= bounds.top
  ) {
    return null
  }

  return {
    x: bounds.left,
    y: bounds.top,
    width: bounds.right - bounds.left,
    height: bounds.bottom - bounds.top,
  }
}
