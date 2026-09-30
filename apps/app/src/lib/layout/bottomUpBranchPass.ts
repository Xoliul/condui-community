import type { Circuit, Endpoint, Panel, ProtectionDevice, TrunkDevice } from '@/types/schema'
import { DOMOTICA_MIN_ENDPOINT_OUTPUTS, DOMOTICA_MAX_ENDPOINT_OUTPUTS, DOMOTICA_OUTPUT_SPACING } from '@/lib/domoticaLayout'
import { getCircuitBranches } from './endpointChains'
import type { BranchLayout, TrunkLayout } from './wireSegments'
import { calculateBranchWidth, getEndpointLayoutOffsets } from './bottomUpBranchWidths'
import { getDomoticaNoteBounds } from '@/lib/eendraad/domoticaNotes'
import { getProtectionOneWireAnchorLineIndex, getProtectionOneWireLabelLines } from '@/lib/protectionLabels'
import { getVisibleConversionLabelParts, getVisibleEndpointNoteText } from '@/lib/conversionLabels'
import { getVisibleCertificationLabelParts } from '@/lib/certificationLabels'
import { countSymbolLabelVisualLines } from '@/lib/symbolLabelMetrics'
import {
  getEndpointBranchLabelPrefix,
  getExpectedBranchLabel,
} from '@/lib/eendraad/automaticEndpointBranchNaming'
import {
  CIRCUIT_CONVERTER_OUTPUT_ROW_SPACING,
  getCircuitConverterDcConnectionCount,
  getCircuitConverterPrimaryEndpointIds,
  isCircuitConverterDcChild,
  supportsCircuitConverterDcConnections,
} from './circuitConverterGeometry'
import {
  getProtectionToTrunkDeviceCenterGap,
  getTrunkDeviceToFirstBranchExtraGap,
  getTrunkDeviceVerticalPaintHeight,
  TRUNK_DEVICE_BRANCH_CLEARANCE,
} from './trunkDeviceSpacing'
import { getBranchConverterMetadataCalloutHeight } from './circuitConverterMetadataCallouts'

export interface BranchPassConstants {
  BRANCH_LEAD_IN: number
  BRANCH_START_OFFSET: number
  ENDPOINT_BRANCH_SPACING: number
  ENDPOINT_HORIZONTAL_SPACING: number
  APPLIANCE_AFTER_SOCKET_GAP: number
  MCB_Y_OFFSET: number
  RCD_TRUNK_OFFSET: number
  SECONDARY_BUS_ABOVE_ENDPOINTS_GAP: number
  TRUNK_DEVICE_MCB_GAP: number
  TRUNK_DEVICE_SPACING: number
  SYMBOL_SIZE: number
  PROTECTION_WIDTH: number
  DOMOTICA_MIN_ENDPOINT_OUTPUTS: number
  DOMOTICA_MAX_ENDPOINT_OUTPUTS: number
  DOMOTICA_OUTPUT_SPACING: number
}

export interface CircuitLayoutForBranches {
  circuit: Circuit
  protection?: ProtectionDevice | null
  parentRcd: { id: string } | null
  parentCircuit: Circuit | null
  x: number
  leftReserve: number
}

export interface BranchLayoutPassResult {
  branches: BranchLayout[]
  secondaryBusYByCircuitId: Map<string, number>
}

const NESTED_BRANCH_LABEL_CLEARANCE = 10
const ENDPOINT_LABEL_LINE_HEIGHT = 10
const ENDPOINT_LABEL_FIXED_VERTICAL_CLEARANCE = 25
const BRANCH_METADATA_CARD_GAP = 28
// The placement solver keeps a 6px callout clearance around a 4px symbol
// obstacle rectangle. Add one pixel so the inclusive rectangle intersection
// test does not treat a just-touching border as a collision.
const BRANCH_METADATA_COLLISION_CLEARANCE = 11

function endpointUsesRightSideLabel(endpoint: Circuit['endpoints'][number], isBranchEnd: boolean) {
  return (
    isBranchEnd &&
    (endpoint.symbol === 'solar_panel' || endpoint.symbol === 'battery' || endpoint.symbol === 'ev')
  )
}

export function getBranchBottomLabelHeight(branchEndpoints: Circuit['endpoints']): number {
  let maximumVisualLines = 0

  branchEndpoints.forEach((endpoint, index) => {
    // Domotica notes use their actual bottom-row paint extent below.
    if (endpoint.symbol === 'domotica') return
    if (endpointUsesRightSideLabel(endpoint, index === branchEndpoints.length - 1)) return

    const texts = [
      ...getVisibleConversionLabelParts(endpoint).map((part) => part.text),
      ...getVisibleCertificationLabelParts(endpoint).map((part) => part.text),
      getVisibleEndpointNoteText(endpoint),
    ].filter((text) => text.length > 0)
    const visualLines = texts.reduce((total, text) => total + countSymbolLabelVisualLines(text), 0)
    maximumVisualLines = Math.max(maximumVisualLines, visualLines)
  })

  return maximumVisualLines * ENDPOINT_LABEL_LINE_HEIGHT
}

function getSequentialBranchLabelFallback(circuit: Circuit, branchIndex: number): string {
  const prefix = getEndpointBranchLabelPrefix(circuit)
  return prefix ? getExpectedBranchLabel(circuit, prefix, branchIndex) : ''
}

export function buildBranchCircuitMap(panel?: Panel): Map<string, Circuit> {
  const circuitMap = new Map<string, Circuit>()
  if (!panel) return circuitMap
  for (const circuit of panel.circuits) {
    circuitMap.set(circuit.id, circuit)
  }
  for (const protection of panel.protections) {
    for (const circuit of protection.circuits ?? []) {
      if (!circuitMap.has(circuit.id)) circuitMap.set(circuit.id, circuit)
    }
  }
  return circuitMap
}

export function resolveBranchSubCircuits(
  circuit: Circuit,
  circuitMap: Map<string, Circuit>
): Circuit[] {
  if (!circuit.subCircuitIds || circuit.subCircuitIds.length === 0) return []
  return circuit.subCircuitIds
    .map((id) => circuitMap.get(id))
    .filter((c): c is Circuit => c !== undefined)
}

export function getBranchProtectionAnchorOffset(
  leftReserve: number,
  constants: Pick<BranchPassConstants, 'PROTECTION_WIDTH' | 'SYMBOL_SIZE'>
): number {
  const baseWidth = Math.max(constants.PROTECTION_WIDTH, constants.SYMBOL_SIZE)
  return leftReserve + baseWidth / 2
}

export function getBranchStartX(
  circuitLayout: Pick<CircuitLayoutForBranches, 'x' | 'leftReserve'>,
  constants: Pick<BranchPassConstants, 'PROTECTION_WIDTH' | 'SYMBOL_SIZE'>
): number {
  return circuitLayout.x + getBranchProtectionAnchorOffset(circuitLayout.leftReserve, constants)
}

export function calculateFirstBranchY(
  circuitLayout: Pick<CircuitLayoutForBranches, 'circuit' | 'parentRcd'>,
  startY: number,
  constants: Pick<
    BranchPassConstants,
    | 'MCB_Y_OFFSET'
    | 'TRUNK_DEVICE_MCB_GAP'
    | 'TRUNK_DEVICE_SPACING'
    | 'SYMBOL_SIZE'
    | 'BRANCH_START_OFFSET'
  >
): number {
  const mcbStartY = circuitLayout.parentRcd ? startY - constants.MCB_Y_OFFSET : startY
  const trunkDevicesBeforeBranches = (circuitLayout.circuit.trunkDevices || []).filter(
    // A DC rail is the terminal branch row itself, not another inline device
    // that should push that row farther away from the converter.
    (d) => d.trunkPosition === 0 && d.type !== 'dc_bus'
  )
  const converterReserve = trunkDevicesBeforeBranches.reduce(
    (reserve, device) =>
      reserve +
      (supportsCircuitConverterDcConnections(device)
        ? Math.max(0, getCircuitConverterDcConnectionCount(device) - 2) *
          CIRCUIT_CONVERTER_OUTPUT_ROW_SPACING
        : 0),
    0
  )
  const firstDeviceGap = trunkDevicesBeforeBranches[0]
    ? getProtectionToTrunkDeviceCenterGap(
        trunkDevicesBeforeBranches[0],
        constants.TRUNK_DEVICE_MCB_GAP
      )
    : constants.TRUNK_DEVICE_MCB_GAP
  const firstBranchExtraGap = getTrunkDeviceToFirstBranchExtraGap(
    trunkDevicesBeforeBranches[0]
  )
  return trunkDevicesBeforeBranches.length > 0
    ? mcbStartY -
        firstDeviceGap -
        (trunkDevicesBeforeBranches.length - 1) *
          (constants.TRUNK_DEVICE_SPACING + constants.SYMBOL_SIZE) -
        constants.BRANCH_START_OFFSET -
        firstBranchExtraGap -
        converterReserve
    : mcbStartY - constants.BRANCH_START_OFFSET
}

function getNonPanelEndpoints(circuit: Circuit) {
  return circuit.endpoints.filter(
    (e) => e.symbol !== 'panel_distribution' && !isCircuitConverterDcChild(e)
  )
}

function getStandardCircuitBranches(circuit: Circuit) {
  const primaryEndpointIds = getCircuitConverterPrimaryEndpointIds(circuit)
  const dcBusEndpointIds = new Set(
    (circuit.branches ?? [])
      .filter((branch) => !!branch.dcBusId)
      .flatMap((branch) => branch.endpointIds)
  )
  return getCircuitBranches(circuit).filter(
    (branchEndpoints) =>
      !branchEndpoints.some(
        (endpoint) =>
          isCircuitConverterDcChild(endpoint) ||
          primaryEndpointIds.has(endpoint.id) ||
          dcBusEndpointIds.has(endpoint.id)
      )
  )
}

function createEmptyBranch(
  circuit: Circuit,
  startX: number,
  startY: number,
  branchY: number
): BranchLayout {
  return {
    id: `branch-${circuit.id}-empty`,
    circuitId: circuit.id,
    label: '',
    trunkX: startX,
    trunkY: startY,
    branchX: startX,
    branchY,
    branchWidth: 0,
    endpoints: [],
    isStraight: false,
  }
}

function getDomoticaExtraRows(
  branchEndpoints: ReturnType<typeof getCircuitBranches>[number],
  constants: Pick<
    BranchPassConstants,
    'DOMOTICA_MIN_ENDPOINT_OUTPUTS' | 'DOMOTICA_MAX_ENDPOINT_OUTPUTS'
  >
): number {
  const domotica = branchEndpoints.find((ep) => ep.symbol === 'domotica' && !ep.domoticaChildProps)
  if (!domotica) return 0
  const byParent = new Map<string, Endpoint[]>()
  for (const endpoint of branchEndpoints) {
    const parentId = endpoint.domoticaChildProps?.parentEndpointId
    if (!parentId) continue
    const children = byParent.get(parentId) ?? []
    children.push(endpoint)
    byParent.set(parentId, children)
  }
  const visit = (module: Endpoint, inputRow: number, ancestry: Set<string>): number => {
    if (ancestry.has(module.id)) return inputRow
    const nextAncestry = new Set(ancestry).add(module.id)
    const endpointCount = Math.max(
      constants.DOMOTICA_MIN_ENDPOINT_OUTPUTS,
      Math.min(
        constants.DOMOTICA_MAX_ENDPOINT_OUTPUTS,
        Math.trunc(module.domoticaProps?.endpointCount ?? constants.DOMOTICA_MIN_ENDPOINT_OUTPUTS)
      )
    )
    const firstOutputRow = inputRow + Math.max(0, endpointCount - 1)
    return (byParent.get(module.id) ?? []).reduce((maxRow, child) => {
      if (child.symbol !== 'domotica') return maxRow
      const childInputRow = firstOutputRow - (child.domoticaChildProps?.outputIndex ?? 0)
      return Math.max(maxRow, visit(child, childInputRow, nextAncestry))
    }, firstOutputRow)
  }
  return visit(domotica, 0, new Set())
}

type TrunkPlacementConstants = Pick<BranchPassConstants, 'SYMBOL_SIZE' | 'BRANCH_START_OFFSET' | 'TRUNK_DEVICE_SPACING'> &
  Partial<Pick<BranchPassConstants, 'DOMOTICA_MIN_ENDPOINT_OUTPUTS' | 'DOMOTICA_MAX_ENDPOINT_OUTPUTS' | 'DOMOTICA_OUTPUT_SPACING'>>

function getDomoticaBranchBottomExtent(endpoints: Endpoint[], symbolSize: number): number {
  const offsets = getEndpointLayoutOffsets(endpoints, 20, 30, 0, symbolSize)
  return endpoints.reduce((bottom, endpoint, index) => {
    const offset = offsets[index]!
    return Math.max(bottom, getDomoticaNoteBounds(endpoint, offset.x, offset.y, 0)?.bottom ?? bottom)
  }, symbolSize / 2)
}

function getFirstBranchObstacleHalfHeight(circuit: Circuit, protection: ProtectionDevice | null | undefined, symbolSize: number): number {
  const device = circuit.trunkDevices?.filter((device) => device.trunkPosition === 0 &&
    device.type !== 'dc_bus' && !device.converterDcConnection).at(-1)
  if (device) return getTrunkDeviceVerticalPaintHeight(device, symbolSize) / 2
  if (!protection) return symbolSize / 2
  const lines = getProtectionOneWireLabelLines(protection)
  const position = protection.symbolLabelDisplay?.position ?? 'right'
  const labelTop = position === 'top'
    ? symbolSize / 2 + 5 + lines.reduce((height, line) => height + countSymbolLabelVisualLines(line.text) * 12, 0)
    : position === 'bottom'
      ? 0
      : getProtectionOneWireAnchorLineIndex(lines) * 12 + 6
  return Math.max(symbolSize / 2, labelTop)
}

/** Place serial devices in the clear band above a branch's upward-growing modules. */
export function getTrunkDeviceBranchGapY(
  device: TrunkDevice,
  devices: TrunkDevice[],
  branches: BranchLayout[],
  constants: TrunkPlacementConstants
): number | undefined {
  if (device.trunkPosition <= 0) return undefined
  const precedingBranch = branches[device.trunkPosition - 1]
  if (!precedingBranch) return undefined
  const followingBranch = branches[device.trunkPosition]
  const growth = getDomoticaExtraRows(precedingBranch.endpoints, {
    DOMOTICA_MIN_ENDPOINT_OUTPUTS: constants.DOMOTICA_MIN_ENDPOINT_OUTPUTS ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS,
    DOMOTICA_MAX_ENDPOINT_OUTPUTS: constants.DOMOTICA_MAX_ENDPOINT_OUTPUTS ?? DOMOTICA_MAX_ENDPOINT_OUTPUTS,
  }) * (constants.DOMOTICA_OUTPUT_SPACING ?? DOMOTICA_OUTPUT_SPACING)
  const peers = devices.filter((candidate) => candidate.trunkPosition === device.trunkPosition && !candidate.converterDcConnection)
  const index = peers.indexOf(device)
  if (index < 0) return undefined
  const heights = peers.map((peer) => getTrunkDeviceVerticalPaintHeight(peer, constants.SYMBOL_SIZE))
  if (!followingBranch) {
    if (device.type === 'dc_bus' && precedingBranch.endpoints.length === 0) return precedingBranch.branchY
    const firstGap = Math.max(constants.BRANCH_START_OFFSET,
      constants.SYMBOL_SIZE / 2 + heights[0]! / 2 + TRUNK_DEVICE_BRANCH_CLEARANCE)
    return precedingBranch.branchY - growth - firstGap -
      heights.slice(0, index).reduce((offset, height, peerIndex) =>
        offset + constants.TRUNK_DEVICE_SPACING + (height + heights[peerIndex + 1]!) / 2, 0)
  }
  const lowerEdge = precedingBranch.branchY - growth - constants.SYMBOL_SIZE / 2
  const upperEdge = followingBranch.branchY + getDomoticaBranchBottomExtent(followingBranch.endpoints, constants.SYMBOL_SIZE)
  const clearance = (lowerEdge - upperEdge - heights.reduce((sum, height) => sum + height, 0)) / (peers.length + 1)
  return lowerEdge - clearance * (index + 1) -
    heights.slice(0, index).reduce((sum, height) => sum + height, 0) - heights[index]! / 2
}

function createEndpointBranchRows(
  circuit: Circuit,
  startX: number,
  startY: number,
  firstBranchY: number,
  constants: BranchPassConstants,
  nestedBranchLabelClearance: number,
  protection?: ProtectionDevice | null
): BranchLayout[] {
  const endpointBranches = getStandardCircuitBranches(circuit)
  const storedBranches = (circuit.branches ?? []).filter((branch) => !branch.dcBusId)
  const result: BranchLayout[] = []
  let domoticaVerticalReserve = 0
  let labelVerticalReserve = 0
  let metadataVerticalReserve = 0
  const nestedBranchGroupOffset =
    (circuit.trunkDevices || []).length === 0 ? nestedBranchLabelClearance : 0

  endpointBranches.forEach((branchEndpoints, branchIndex) => {
    const trunkDevicesBetween = (circuit.trunkDevices || []).filter(
      (d) => d.trunkPosition > 0 && d.trunkPosition <= branchIndex
    )
    const interBranchTrunkDeviceOffset =
      trunkDevicesBetween.length * constants.TRUNK_DEVICE_SPACING +
      trunkDevicesBetween.reduce(
        (reserve, device) =>
          reserve +
          (supportsCircuitConverterDcConnections(device)
            ? Math.max(0, getCircuitConverterDcConnectionCount(device) - 2) *
              CIRCUIT_CONVERTER_OUTPUT_ROW_SPACING
            : 0),
        0
      )
    const availableLabelHeight =
      (branchIndex === 0 ? constants.BRANCH_START_OFFSET : constants.ENDPOINT_BRANCH_SPACING) -
      ENDPOINT_LABEL_FIXED_VERTICAL_CLEARANCE
    labelVerticalReserve += Math.max(
      0,
      getBranchBottomLabelHeight(branchEndpoints) - availableLabelHeight
    )
    let branchY =
      firstBranchY -
      branchIndex * constants.ENDPOINT_BRANCH_SPACING -
      interBranchTrunkDeviceOffset -
      domoticaVerticalReserve -
      labelVerticalReserve -
      metadataVerticalReserve -
      nestedBranchGroupOffset

    // Bottom notes grow toward the preceding branch/protection. Raise this row
    // until both painted blocks have a clear gap.
    const previousBranch = result.at(-1)
    const bottomExtent = getDomoticaBranchBottomExtent(branchEndpoints, constants.SYMBOL_SIZE)
    if (bottomExtent > constants.SYMBOL_SIZE / 2) {
      const precedingTop = previousBranch
        ? previousBranch.branchY - getDomoticaExtraRows(previousBranch.endpoints, constants) * constants.DOMOTICA_OUTPUT_SPACING
        : firstBranchY + constants.BRANCH_START_OFFSET
      const precedingHalfHeight = previousBranch ? constants.SYMBOL_SIZE / 2 :
        getFirstBranchObstacleHalfHeight(circuit, protection, constants.SYMBOL_SIZE)
      const requiredGap = bottomExtent + precedingHalfHeight + TRUNK_DEVICE_BRANCH_CLEARANCE
      const additionalReserve = Math.max(0, requiredGap - (precedingTop - branchY))
      metadataVerticalReserve += additionalReserve
      branchY -= additionalReserve
    }
    if (previousBranch) {
      const gapDevices = (circuit.trunkDevices ?? []).filter((device) =>
        device.trunkPosition === branchIndex && !device.converterDcConnection)
      if (gapDevices.length > 0) {
        const requiredGap = getDomoticaExtraRows(previousBranch.endpoints, constants) * constants.DOMOTICA_OUTPUT_SPACING +
          constants.SYMBOL_SIZE / 2 + bottomExtent +
          gapDevices.reduce((height, device) => height + getTrunkDeviceVerticalPaintHeight(device, constants.SYMBOL_SIZE), 0) +
          TRUNK_DEVICE_BRANCH_CLEARANCE * (gapDevices.length + 1)
        const additionalReserve = Math.max(0, requiredGap - (previousBranch.branchY - branchY))
        metadataVerticalReserve += additionalReserve
        branchY -= additionalReserve
      }
      // Detached converter cards occupy the band above the preceding branch.
      const previousCardHeight = Math.max(
        ...previousBranch.endpoints.map(getBranchConverterMetadataCalloutHeight),
        0
      )
      if (previousCardHeight > 0) {
        const requiredBranchGap =
          previousCardHeight +
          BRANCH_METADATA_CARD_GAP +
          constants.SYMBOL_SIZE / 2 +
          BRANCH_METADATA_COLLISION_CLEARANCE
        const actualBranchGap = previousBranch.branchY - branchY
        const additionalReserve = Math.max(0, requiredBranchGap - actualBranchGap)
        if (additionalReserve > 0) {
          metadataVerticalReserve += additionalReserve
          branchY -= additionalReserve
        }
      }
    }

    const storedBranch = storedBranches[branchIndex]
    const storedLabel = storedBranch?.label?.trim() ?? ''
    const storedLabelIsDuplicate =
      storedLabel.length > 0 && result.some((existing) => existing.label === storedLabel)
    const branchLabel =
      (!storedLabelIsDuplicate ? storedLabel : '') ||
      getSequentialBranchLabelFallback(circuit, branchIndex) ||
      branchEndpoints.find((ep) => ep.label)?.label ||
      ''
    result.push({
      id: `branch-${circuit.id}-${branchIndex}`,
      circuitId: circuit.id,
      label: branchLabel,
      trunkX: startX,
      trunkY: startY,
      branchX: startX,
      branchY,
      // A converter DC-bus branch is a vertical tap from the rail. Its
      // endpoint is aligned with the branch/MCP anchor, so it must not reserve
      // or render the normal horizontal lead-in.
      branchWidth: circuit.dcBusSource
        ? 0
        : calculateBranchWidth(
            branchEndpoints,
            constants.BRANCH_LEAD_IN,
            constants.ENDPOINT_HORIZONTAL_SPACING,
            constants.APPLIANCE_AFTER_SOCKET_GAP
          ),
      endpoints: branchEndpoints,
      isStraight: false,
    })

    domoticaVerticalReserve +=
      getDomoticaExtraRows(branchEndpoints, constants) * constants.DOMOTICA_OUTPUT_SPACING
  })

  return result
}

/** Topmost branch anchor among an already-collected set of a circuit's branches. */
function topmostBranchYOf(circuitBranches: BranchLayout[], fallbackY: number): number {
  return circuitBranches.length > 0 ? Math.min(...circuitBranches.map((b) => b.branchY)) : fallbackY
}

/**
 * A domotica box grows upward from its branch anchor. When a protection is
 * placed above the branch (a nested sub-circuit MCB on the circuit's secondary
 * bus), the gap above the branch must clear that upward growth — otherwise the
 * box overlaps the protection once the module grows past ~3 endpoints. Returns
 * how far a branch's tallest domotica box rises above its branch anchor row.
 */
function getBranchDomoticaUpwardExtent(
  branchEndpoints: BranchLayout['endpoints'],
  constants: Pick<
    BranchPassConstants,
    'DOMOTICA_MIN_ENDPOINT_OUTPUTS' | 'DOMOTICA_MAX_ENDPOINT_OUTPUTS' | 'DOMOTICA_OUTPUT_SPACING'
  >
): number {
  return getDomoticaExtraRows(branchEndpoints, constants) * constants.DOMOTICA_OUTPUT_SPACING
}

/**
 * Topmost visual extent of a circuit's endpoint branches — the highest branch
 * anchor, raised further by any domotica box on it that grows upward. Used to
 * position the secondary bus (and the protection above) with a constant gap
 * regardless of domotica endpoint count, so the module keeps looking the same
 * whether or not a protection sits above it.
 */
function topmostBranchExtentYOf(
  circuitBranches: BranchLayout[],
  fallbackY: number,
  constants: Pick<
    BranchPassConstants,
    'DOMOTICA_MIN_ENDPOINT_OUTPUTS' | 'DOMOTICA_MAX_ENDPOINT_OUTPUTS' | 'DOMOTICA_OUTPUT_SPACING'
  >
): number {
  if (circuitBranches.length === 0) return fallbackY
  return Math.min(
    ...circuitBranches.map((b) => b.branchY - getBranchDomoticaUpwardExtent(b.endpoints, constants))
  )
}

function getTopmostBranchExtentY(
  branches: BranchLayout[],
  circuitId: string,
  fallbackY: number,
  constants: Pick<
    BranchPassConstants,
    'DOMOTICA_MIN_ENDPOINT_OUTPUTS' | 'DOMOTICA_MAX_ENDPOINT_OUTPUTS' | 'DOMOTICA_OUTPUT_SPACING'
  >
): number {
  return topmostBranchExtentYOf(
    branches.filter((b) => b.circuitId === circuitId),
    fallbackY,
    constants
  )
}

function processNestedCircuitBranches(
  immediateParentCircuit: Circuit,
  nestedCircuits: Circuit[],
  parentWireEndY: number,
  context: {
    circuitLayouts: CircuitLayoutForBranches[]
    circuitMap: Map<string, Circuit>
    constants: BranchPassConstants
    branches: BranchLayout[]
    secondaryBusYByCircuitId: Map<string, number>
  }
): void {
  const { circuitLayouts, circuitMap, constants, branches, secondaryBusYByCircuitId } = context
  const immediateParentLayout = circuitLayouts.find(
    (cl) => cl.circuit.id === immediateParentCircuit.id
  )
  const immediateParentAnchorX = immediateParentLayout
    ? getBranchStartX(immediateParentLayout, constants)
    : 0
  const singleNestedUnderImmediateParent =
    resolveBranchSubCircuits(immediateParentCircuit, circuitMap).length === 1

  nestedCircuits.forEach((nestedCircuit) => {
    const nestedCircuitLayout = circuitLayouts.find((cl) => cl.circuit.id === nestedCircuit.id)
    const nestedMcbY = parentWireEndY - constants.MCB_Y_OFFSET
    const nestedStartX =
      singleNestedUnderImmediateParent &&
      nestedCircuitLayout &&
      immediateParentLayout &&
      nestedCircuitLayout.x === immediateParentLayout.x
        ? immediateParentAnchorX
        : nestedCircuitLayout
          ? getBranchStartX(nestedCircuitLayout, constants)
          : immediateParentAnchorX
    // Measure from the nested protection itself so the cable caption beside it
    // gets the same protection-to-first-branch span as a top-level circuit.
    const nestedFirstBranchY = calculateFirstBranchY(
      { circuit: nestedCircuit, parentRcd: null },
      nestedMcbY,
      constants
    )

    if (getNonPanelEndpoints(nestedCircuit).length === 0) {
      branches.push(createEmptyBranch(nestedCircuit, nestedStartX, nestedMcbY, nestedFirstBranchY))
    } else {
      branches.push(
        ...createEndpointBranchRows(
          nestedCircuit,
          nestedStartX,
          nestedMcbY,
          nestedFirstBranchY,
          constants,
          NESTED_BRANCH_LABEL_CLEARANCE,
          nestedCircuitLayout?.protection
        )
      )
    }

    const deeperNestedCircuits = resolveBranchSubCircuits(nestedCircuit, circuitMap)
    if (deeperNestedCircuits.length > 0) {
      const topmostNestedExtentY = getTopmostBranchExtentY(
        branches,
        nestedCircuit.id,
        nestedMcbY,
        constants
      )
      const nestedSecondaryBusY =
        getCircuitBranches(nestedCircuit).length > 0
          ? topmostNestedExtentY - constants.SECONDARY_BUS_ABOVE_ENDPOINTS_GAP
          : topmostNestedExtentY
      secondaryBusYByCircuitId.set(nestedCircuit.id, nestedSecondaryBusY)
      processNestedCircuitBranches(
        nestedCircuit,
        deeperNestedCircuits,
        nestedSecondaryBusY,
        context
      )
    }
  })
}

export function calculateBranchLayoutPass(
  circuitLayouts: CircuitLayoutForBranches[],
  trunks: TrunkLayout[],
  mainBusY: number,
  panel: Panel | undefined,
  constants: BranchPassConstants
): BranchLayoutPassResult {
  const branches: BranchLayout[] = []
  const secondaryBusYByCircuitId = new Map<string, number>()
  const circuitMap = buildBranchCircuitMap(panel)

  for (const circuitLayout of circuitLayouts) {
    if (circuitLayout.parentCircuit) continue

    const circuit = circuitLayout.circuit
    const endpointBranches = getStandardCircuitBranches(circuit)
    const nestedCircuits = resolveBranchSubCircuits(circuit, circuitMap)
    const startX = getBranchStartX(circuitLayout, constants)
    const trunk = circuitLayout.parentRcd
      ? trunks.find((t) => t.protectionId === circuitLayout.parentRcd!.id)
      : undefined
    const startY = circuitLayout.parentRcd
      ? (trunk?.y ?? mainBusY - constants.RCD_TRUNK_OFFSET)
      : mainBusY - constants.MCB_Y_OFFSET
    const firstBranchY = calculateFirstBranchY(circuitLayout, startY, constants)

    // This circuit's own branch rows, kept locally so the topmost-extent lookups
    // below don't re-scan the whole (growing) branches array per circuit — that
    // made the pass O(circuits × totalBranches). Nested circuits are pushed later
    // by processNestedCircuitBranches, so these rows are exactly circuit.id's set.
    const circuitBranchRows =
      getNonPanelEndpoints(circuit).length === 0
        ? [createEmptyBranch(circuit, startX, startY, firstBranchY)]
        : createEndpointBranchRows(circuit, startX, startY, firstBranchY, constants, 0, circuitLayout.protection)
    branches.push(...circuitBranchRows)

    if (nestedCircuits.length === 0) continue

    const hasParentEndpointBranches = endpointBranches.length > 0
    if (hasParentEndpointBranches) {
      // Measure the actual topmost branch (incl. domotica/label/metadata
      // reserves and any upward-growing domotica box) rather than re-deriving it
      // from firstBranchY, so the protection above clears the content.
      const topmostExtentY = topmostBranchExtentYOf(circuitBranchRows, firstBranchY, constants)
      secondaryBusYByCircuitId.set(
        circuit.id,
        topmostExtentY - constants.SECONDARY_BUS_ABOVE_ENDPOINTS_GAP
      )
    } else if (nestedCircuits.some((sc) => getNonPanelEndpoints(sc).length > 0)) {
      secondaryBusYByCircuitId.set(circuit.id, startY)
    }

    const topmostBranchY = topmostBranchYOf(circuitBranchRows, startY)
    const secondaryBusY = secondaryBusYByCircuitId.get(circuit.id)
    const parentWireEndY =
      hasParentEndpointBranches && secondaryBusY != null ? secondaryBusY : topmostBranchY

    processNestedCircuitBranches(circuit, nestedCircuits, parentWireEndY, {
      circuitLayouts,
      circuitMap,
      constants,
      branches,
      secondaryBusYByCircuitId,
    })
  }

  return { branches, secondaryBusYByCircuitId }
}
