import { getSocketExtraWidth } from '@/components/canvas/eendraad/canvasSymbols'
import { getVisibleCertificationLabelParts } from '@/lib/certificationLabels'
import { getVisibleConversionLabelParts, getVisibleEndpointNoteText } from '@/lib/conversionLabels'
import { getProtectionOneWireLabelLines } from '@/lib/protectionLabels'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import { isSymbolLabelVisible } from '@/lib/symbolLabels'
import type { Circuit, Endpoint, ProtectionDevice, TrunkDevice } from '@/types/schema'
import { getEndpointMultiplier } from '@/utils/endpointMultipliers'
import { getSupplyDeviceMultiplier } from '@/lib/supplyAssembly/inverterMultipliers'
import { getMultiplierBadgeWidth } from '@/lib/eendraad/multiplierBadgeGeometry'
import { DOMOTICA_BOX_WIDTH, DOMOTICA_CHILD_LABEL_GAP } from '@/lib/domoticaLayout'
import { getDomoticaRowDisplayLabel } from '@/lib/eendraad/domoticaRowLabel'
import {
  getCollisionSafeLabelWidth,
  getCrowdedEndpointNoteLabelBounds,
  getEndpointNoteMinimumLeftX,
} from '@/lib/eendraad/endpointNoteLabelCollision'
import {
  calculateBranchWidth,
  getEndpointLayoutXOffsets,
  getEndpointXOffsets,
} from './bottomUpBranchWidths'
import { getCircuitBranches } from './endpointChains'
import { getCircuitNotesPaintBounds } from './circuitNoteMetrics'
import {
  CIRCUIT_CONVERTER_BLOCK_SIZE,
  CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD,
  getCircuitConverterDcConnectionCount,
  getCircuitConverterPrimaryBranch,
  getCircuitConverterPrimaryEndpointIds,
  isCircuitConverterDcChild,
  supportsCircuitConverterDcConnections,
} from './circuitConverterGeometry'
import {
  getCircuitConverterMetadataCallouts,
  getBranchConverterMetadataCallouts,
  getBranchConverterMetadataCalloutHeight,
  type CircuitConverterMetadataCallout,
} from './circuitConverterMetadataCallouts'

export interface HorizontalEnvelope {
  /** Painted extent left of the circuit trunk anchor. */
  left: number
  /** Painted extent right of the circuit trunk anchor. */
  right: number
}

export interface CircuitLayoutEnvelope extends HorizontalEnvelope {
  /** Child trunk offsets relative to this circuit's trunk, in secondary-bus order. */
  nestedAnchorOffsets: Map<string, number>
}

export interface CircuitEnvelopeConfig {
  symbolSize: number
  protectionWidth: number
  branchLeadIn: number
  endpointSpacing: number
  applianceAfterSocketGap: number
  endpointBranchSpacing: number
  protectionLabelOffset: number
  spdProtectionLabelOffset: number
  protectionTechnicalLabelOffset: number
  secondaryBusPanelColumnWidth: number
  /** Optional painted width needed by a linked secondary-panel label. */
  secondaryBusPanelLabelWidth?: (
    protection: ProtectionDevice | undefined,
    circuit: Circuit
  ) => number
  secondaryBusExtension: number
  dcBusMinWidth: number
  dcBusBranchLeadIn: number
  dcBusBranchMinSpacing: number
  dcBusBranchLabelGap: number
  nestedGutter: number
  circuitNotesOrientation: 'horizontal' | 'vertical'
}

const ENDPOINT_LABEL_FONT_SIZE = 8
const PROTECTION_LABEL_FONT_SIZE = 11
const PROTECTION_TECHNICAL_LABEL_FONT_SIZE = 10
const TRUNK_DEVICE_LABEL_FONT_SIZE = 10
const LABEL_OFFSET_FROM_SYMBOL = 5
const BRANCH_LABEL_RIGHT_OFFSET = 20
const LABEL_SAFETY = 2
const CIRCUIT_LABEL_MAX_WIDTH = 220
const LABEL_FONT_FAMILY = 'Figtree'

function estimateTextWidth(text: string, fontSize: number): number {
  return measureSymbolLabelTextWidth(text, LABEL_FONT_FAMILY, fontSize)
}

function estimateCircuitLabelWidth(text: string): number {
  return Math.min(CIRCUIT_LABEL_MAX_WIDTH, estimateTextWidth(text, PROTECTION_LABEL_FONT_SIZE))
}

function unionEnvelope(
  envelope: HorizontalEnvelope,
  left: number,
  right: number
): HorizontalEnvelope {
  return {
    left: Math.min(envelope.left, left),
    right: Math.max(envelope.right, right),
  }
}

function getProtectionOwnEnvelope(
  circuit: Circuit,
  protection: ProtectionDevice | undefined,
  config: CircuitEnvelopeConfig
): HorizontalEnvelope {
  const halfSymbol = Math.max(config.symbolSize, config.protectionWidth) / 2
  let envelope: HorizontalEnvelope = { left: -halfSymbol, right: halfSymbol }

  if (protection && circuit.eendraadLetterVisible !== false) {
    const label = (protection.label ?? '').trim()
    if (label) {
      const right =
        protection.type === 'SPD' ? config.spdProtectionLabelOffset : config.protectionLabelOffset
      envelope = unionEnvelope(
        envelope,
        right - estimateCircuitLabelWidth(label) - LABEL_SAFETY,
        right
      )
    }
  }

  if (protection) {
    const technicalLines = getProtectionOneWireLabelLines(protection).map((line) => line.text)
    const technicalWidth = Math.max(
      0,
      ...technicalLines.map((line) => estimateTextWidth(line, PROTECTION_TECHNICAL_LABEL_FONT_SIZE))
    )
    if (technicalWidth > 0) {
      envelope = unionEnvelope(
        envelope,
        envelope.left,
        config.symbolSize / 2 + config.protectionTechnicalLabelOffset + technicalWidth
      )
    }
  }

  // A linked panel symbol can be one of several children on a parent
  // secondary bus (for example after its protection is removed and its feeder
  // is retained). Reserve the label on that child itself so the next nested
  // bus is packed after the painted text, not merely after the panel-column
  // fallback used when the attachment belongs to the parent circuit.
  const panelLabelWidth = protection?.subPanelId
    ? (config.secondaryBusPanelLabelWidth?.(protection, circuit) ?? 0)
    : 0
  if (panelLabelWidth > 0) {
    envelope = unionEnvelope(envelope, envelope.left, panelLabelWidth)
  }

  return envelope
}

function getEndpointLabelLines(endpoint: Endpoint): string[] {
  return [
    ...getVisibleConversionLabelParts(endpoint).map((part) => part.text),
    ...getVisibleCertificationLabelParts(endpoint).map((part) => part.text),
    getVisibleEndpointNoteText(endpoint),
  ].filter((line) => line.length > 0)
}

function getEndpointEnvelope(
  endpoint: Endpoint,
  anchorX: number,
  isBranchEnd: boolean,
  symbolSize: number,
  includeInlineMetadata = true,
  bottomLabelMinimumLeftX?: number,
  bottomLabelMaximumRightX?: number
): HorizontalEnvelope {
  const halfSymbol = symbolSize / 2
  const socketExtra =
    endpoint.type === 'socket'
      ? getSocketExtraWidth(Math.max(1, endpoint.socketProps?.socketCount ?? 1))
      : 0
  const groupCenterX = anchorX + socketExtra / 2
  let envelope: HorizontalEnvelope = {
    left: anchorX - halfSymbol,
    right: anchorX + halfSymbol + socketExtra,
  }

  const multiplier = getEndpointMultiplier(endpoint)
  if (multiplier > 1) {
    const multiplierWidth = getMultiplierBadgeWidth(multiplier)
    envelope = unionEnvelope(
      envelope,
      groupCenterX + halfSymbol + socketExtra - multiplierWidth / 2,
      groupCenterX + halfSymbol + socketExtra + multiplierWidth / 2
    )
  }

  if (!includeInlineMetadata) return envelope

  const labelLines = getEndpointLabelLines(endpoint)

  const usesRightLabel =
    isBranchEnd &&
    (endpoint.symbol === 'solar_panel' || endpoint.symbol === 'battery' || endpoint.symbol === 'ev')
  if (usesRightLabel) {
    const labelWidth = Math.max(
      0,
      ...labelLines.map((line) => estimateTextWidth(line, ENDPOINT_LABEL_FONT_SIZE))
    )
    if (labelWidth === 0) return envelope
    const labelLeft = groupCenterX + halfSymbol + LABEL_OFFSET_FROM_SYMBOL
    return unionEnvelope(envelope, labelLeft, labelLeft + labelWidth)
  }

  const socketLabelOffset = socketExtra / 2
  for (const line of labelLines) {
    const lineWidth = estimateTextWidth(line, ENDPOINT_LABEL_FONT_SIZE)
    const lineLeft =
      bottomLabelMinimumLeftX == null
        ? groupCenterX - lineWidth / 2
        : anchorX + Math.max(socketLabelOffset - lineWidth / 2, bottomLabelMinimumLeftX)
    const renderedLineWidth = getCollisionSafeLabelWidth(
      lineWidth,
      lineLeft - anchorX - socketLabelOffset,
      bottomLabelMaximumRightX == null ? undefined : bottomLabelMaximumRightX - socketLabelOffset
    )
    envelope = unionEnvelope(envelope, lineLeft, lineLeft + renderedLineWidth)
  }
  return envelope
}

function getBranchLabel(circuit: Circuit, branchIndex: number, endpoints: Endpoint[]): string {
  const stored = circuit.branches?.[branchIndex]?.label?.trim()
  if (stored) return stored
  return endpoints.find((endpoint) => endpoint.label?.trim())?.label?.trim() ?? ''
}

export interface DcBusBranchHorizontalLayout {
  branchId: string
  /** Branch center offset from the DC bus connection anchor. */
  offset: number
  /** Painted horizontal envelope relative to the branch center. */
  left: number
  right: number
}

/**
 * Pack ordinary DC-bus branches from their painted horizontal envelopes.
 *
 * A DC-bus branch is vertical, so every endpoint in one branch shares the
 * same X coordinate. The old layout advanced that coordinate by a fixed
 * endpoint spacing, which made endpoint metadata collide as soon as one
 * branch had wider text than its neighbour. Keep the spacing rules in the
 * envelope module so the scene graph and panel-frame calculations use the
 * exact same geometry.
 */
export function getDcBusBranchHorizontalLayouts(
  circuit: Circuit,
  dcBusId: string,
  config: CircuitEnvelopeConfig
): DcBusBranchHorizontalLayout[] {
  const endpointById = new Map(circuit.endpoints.map((endpoint) => [endpoint.id, endpoint]))
  const nestedConverterIds = new Set(
    (circuit.branches ?? []).flatMap((branch) =>
      (branch.branchDevices ?? []).flatMap((device) =>
        supportsCircuitConverterDcConnections(device) ? [device.id] : []
      )
    )
  )
  let previous: DcBusBranchHorizontalLayout | null = null

  return (circuit.branches ?? [])
    .filter((branch) => branch.dcBusId === dcBusId)
    .filter(
      (branch) =>
        branch.endpointIds.some((endpointId) => {
          const endpoint = endpointById.get(endpointId)
          return (
            endpoint &&
            !(
              endpoint.converterDcConnection &&
              nestedConverterIds.has(endpoint.converterDcConnection.converterId)
            )
          )
        }) ||
        (branch.branchDevices ?? []).some(
          (device) =>
            !(
              device.converterDcConnection &&
              nestedConverterIds.has(device.converterDcConnection.converterId)
            )
        )
    )
    .map((branch) => {
      const endpoints = branch.endpointIds.flatMap((endpointId) => {
        const endpoint = endpointById.get(endpointId)
        return endpoint &&
          !(
            endpoint.converterDcConnection &&
            nestedConverterIds.has(endpoint.converterDcConnection.converterId)
          )
          ? [endpoint]
          : []
      })
      const halfSymbol = config.symbolSize / 2
      let bounds: HorizontalEnvelope = { left: -halfSymbol, right: halfSymbol }

      endpoints.forEach((endpoint, endpointIndex) => {
        const endpointEnvelope = getEndpointEnvelope(
          endpoint,
          0,
          endpointIndex === endpoints.length - 1,
          config.symbolSize
        )
        bounds = unionEnvelope(bounds, endpointEnvelope.left, endpointEnvelope.right)
      })

      // Branch-local DC devices are painted on the same vertical tap as the
      // endpoints. Their labels can be wider than the endpoint metadata, so
      // include the exact trunk-device envelope in the same horizontal packing
      // calculation used by the bus and frame layout.
      for (const device of branch.branchDevices ?? []) {
        if (
          device.converterDcConnection &&
          nestedConverterIds.has(device.converterDcConnection.converterId)
        )
          continue
        const deviceEnvelope = getTrunkDeviceEnvelope(device, config)
        bounds = unionEnvelope(bounds, deviceEnvelope.left, deviceEnvelope.right)
        if (nestedConverterIds.has(device.id)) {
          const metadataCallouts = getCircuitConverterMetadataCallouts({
            circuit,
            device,
            anchor: { x: 0, y: 0 },
            symbolSize: config.symbolSize,
            endpointSpacing: config.endpointSpacing,
            applianceAfterSocketGap: config.applianceAfterSocketGap,
          })
          const childrenEnvelope = getConverterDcChildrenEnvelope(
            circuit,
            device,
            config,
            metadataCallouts
          )
          if (childrenEnvelope) {
            bounds = unionEnvelope(bounds, childrenEnvelope.left, childrenEnvelope.right)
          }
        }
      }

      const branchLabel =
        branch.label?.trim() || endpoints.find((endpoint) => endpoint.label?.trim())?.label?.trim()
      if (branchLabel) {
        const labelRight = -BRANCH_LABEL_RIGHT_OFFSET
        bounds = unionEnvelope(
          bounds,
          labelRight - estimateCircuitLabelWidth(branchLabel) - LABEL_SAFETY,
          labelRight
        )
      }

      const offset = previous
        ? previous.offset +
          Math.max(
            config.dcBusBranchMinSpacing,
            previous.right - bounds.left + config.dcBusBranchLabelGap
          )
        : 0
      const layout: DcBusBranchHorizontalLayout = {
        branchId: branch.id,
        offset,
        left: bounds.left,
        right: bounds.right,
      }
      previous = layout
      return layout
    })
}

function getDcBusBranchEnvelope(
  circuit: Circuit,
  dcBusId: string,
  config: CircuitEnvelopeConfig
): HorizontalEnvelope | null {
  const layouts = getDcBusBranchHorizontalLayouts(circuit, dcBusId, config)
  if (layouts.length === 0) return null

  return layouts.reduce<HorizontalEnvelope>(
    (envelope, layout) =>
      unionEnvelope(envelope, layout.offset + layout.left, layout.offset + layout.right),
    { left: layouts[0]!.offset + layouts[0]!.left, right: layouts[0]!.offset + layouts[0]!.right }
  )
}

function getBranchesEnvelope(circuit: Circuit, config: CircuitEnvelopeConfig): HorizontalEnvelope {
  let envelope: HorizontalEnvelope = { left: 0, right: 0 }
  const primaryEndpointIds = getCircuitConverterPrimaryEndpointIds(circuit)
  const branches = getCircuitBranches(circuit).filter(
    (endpoints) =>
      !endpoints.some(
        (endpoint) => isCircuitConverterDcChild(endpoint) || primaryEndpointIds.has(endpoint.id)
      )
  )

  const branchMetadataTargets: Array<{
    endpoint: Endpoint
    position: { x: number; y: number }
  }> = []
  const branchMetadataSegments: Array<{
    startPoint: { x: number; y: number }
    endPoint: { x: number; y: number }
  }> = []
  const branchMetadataYs: number[] = []
  let metadataVerticalReserve = 0

  branches.forEach((endpoints, branchIndex) => {
    let branchY = -branchIndex * config.endpointBranchSpacing - metadataVerticalReserve
    const previousBranchY = branchMetadataYs.at(-1)
    const previousCardHeight = Math.max(
      ...(branches[branchIndex - 1]?.map(getBranchConverterMetadataCalloutHeight) ?? []),
      0
    )
    if (previousBranchY != null && previousCardHeight > 0) {
      const requiredBranchGap = previousCardHeight + 28 + config.symbolSize / 2 + 11
      const additionalReserve = Math.max(0, requiredBranchGap - (previousBranchY - branchY))
      metadataVerticalReserve += additionalReserve
      branchY -= additionalReserve
    }
    branchMetadataYs.push(branchY)
    const branchWidth = calculateBranchWidth(
      endpoints,
      config.branchLeadIn,
      config.endpointSpacing,
      config.applianceAfterSocketGap
    )
    envelope = unionEnvelope(envelope, 0, branchWidth)

    const offsets = getEndpointLayoutXOffsets(
      endpoints,
      config.branchLeadIn,
      config.endpointSpacing,
      config.applianceAfterSocketGap
    )
    const bottomNoteEndpointIndexes = new Set(
      endpoints.flatMap((endpoint, endpointIndex) => {
        const isRightLabel =
          endpointIndex === endpoints.length - 1 &&
          (endpoint.symbol === 'solar_panel' ||
            endpoint.symbol === 'battery' ||
            endpoint.symbol === 'ev')
        return endpoint.symbol !== 'domotica' && !isRightLabel && getVisibleEndpointNoteText(endpoint) ? [endpointIndex] : []
      })
    )
    endpoints.forEach((endpoint, endpointIndex) => {
      const anchorX = offsets[endpointIndex] ?? config.branchLeadIn
      const crowdedNoteLabelBounds = getCrowdedEndpointNoteLabelBounds(
        endpointIndex,
        offsets,
        bottomNoteEndpointIndexes,
        0
      )
      const endpointEnvelope = getEndpointEnvelope(
        endpoint,
        anchorX,
        endpointIndex === endpoints.length - 1,
        config.symbolSize,
        true,
        endpoint.symbol === 'domotica' || (endpoints.length === 1 && endpoint.type !== 'switch')
          ? getEndpointNoteMinimumLeftX(anchorX, 0)
          : bottomNoteEndpointIndexes.has(endpointIndex)
            ? (crowdedNoteLabelBounds?.minimumLeftX ?? getEndpointNoteMinimumLeftX(anchorX, 0))
            : undefined,
        crowdedNoteLabelBounds?.maximumRightX
      )
      envelope = unionEnvelope(envelope, endpointEnvelope.left, endpointEnvelope.right)

      const domoticaRef = endpoint.domoticaChildProps
      const label = getDomoticaRowDisplayLabel(endpoint)
      if (domoticaRef && label) {
        const hasRowEndpointToRight = endpoints.some((candidate, candidateIndex) => {
          const candidateRef = candidate.domoticaChildProps
          return (
            candidateRef?.parentEndpointId === domoticaRef.parentEndpointId &&
            candidateRef.outputGroup === domoticaRef.outputGroup &&
            candidateRef.outputIndex === domoticaRef.outputIndex &&
            (offsets[candidateIndex] ?? config.branchLeadIn) > anchorX
          )
        })
        if (!hasRowEndpointToRight) {
          const labelLeft =
            endpoint.symbol === 'domotica'
              ? anchorX - DOMOTICA_BOX_WIDTH / 2
              : anchorX + config.symbolSize / 2 + DOMOTICA_CHILD_LABEL_GAP
          envelope = unionEnvelope(
            envelope,
            labelLeft,
            labelLeft + estimateCircuitLabelWidth(label) + LABEL_SAFETY
          )
        }
      }
    })

    branchMetadataTargets.push(
      ...endpoints.map((endpoint, endpointIndex) => ({
        endpoint,
        position: { x: offsets[endpointIndex] ?? config.branchLeadIn, y: branchY },
      }))
    )
    branchMetadataSegments.push({
      startPoint: { x: 0, y: branchY },
      endPoint: { x: branchWidth, y: branchY },
    })

    const branchLabel = getBranchLabel(circuit, branchIndex, endpoints)
    if (branchLabel) {
      const labelRight = -BRANCH_LABEL_RIGHT_OFFSET
      envelope = unionEnvelope(
        envelope,
        labelRight - estimateCircuitLabelWidth(branchLabel) - LABEL_SAFETY,
        labelRight
      )
    }
  })

  if (branchMetadataTargets.length > 0) {
    const branchYs = branchMetadataTargets.map(({ position }) => position.y)
    branchMetadataSegments.push({
      startPoint: { x: 0, y: Math.min(...branchYs) },
      endPoint: { x: 0, y: Math.max(...branchYs) },
    })
    const branchMetadataCallouts = getBranchConverterMetadataCallouts({
      targets: branchMetadataTargets,
      symbolSize: config.symbolSize,
      segments: branchMetadataSegments,
    })
    for (const callout of branchMetadataCallouts.values()) {
      envelope = unionEnvelope(envelope, callout.rect.left, callout.rect.right)
    }
  }

  return envelope
}

function getTrunkDeviceEnvelope(
  device: TrunkDevice,
  config: CircuitEnvelopeConfig,
  includeInlineMetadata = true
): HorizontalEnvelope {
  const symbolSize = config.symbolSize
  const halfSymbol = symbolSize / 2
  if (device.type === 'dc_bus') {
    const labelWidth = device.label?.trim()
      ? estimateTextWidth(device.label.trim(), TRUNK_DEVICE_LABEL_FONT_SIZE)
      : 0
    return {
      // The shared DC domain marker and the generous pointer target sit just
      // outside the electrical attachment at the left end of the rail.
      left: -20,
      right: Math.max(config.dcBusMinWidth, labelWidth),
    }
  }
  const connectionCount = getCircuitConverterDcConnectionCount(device)
  const bodyRight =
    supportsCircuitConverterDcConnections(device) && connectionCount > 1
      ? (connectionCount - 1) * CIRCUIT_CONVERTER_BLOCK_SIZE + halfSymbol
      : halfSymbol
  let envelope: HorizontalEnvelope = { left: -halfSymbol, right: bodyRight }
  const labelLines =
    device.type === 'protection'
      ? getProtectionOneWireLabelLines(device).map((line) => line.text)
      : [
          ...getVisibleConversionLabelParts(device).map((part) => part.text),
          ...getVisibleCertificationLabelParts(device).map((part) => part.text),
          ...(isSymbolLabelVisible(device.symbolLabelDisplay, 'trunkDeviceNotes', true) &&
          device.notes?.trim()
            ? [device.notes.trim()]
            : []),
        ]
  const labelWidth = Math.max(
    0,
    ...labelLines.map((line) => estimateTextWidth(line, TRUNK_DEVICE_LABEL_FONT_SIZE))
  )
  if (includeInlineMetadata && labelWidth > 0) {
    envelope = unionEnvelope(
      envelope,
      envelope.left,
      bodyRight + LABEL_OFFSET_FROM_SYMBOL + labelWidth
    )
  }

  const multiplier = getSupplyDeviceMultiplier(device)
  if (multiplier > 1) {
    const multiplierWidth = getMultiplierBadgeWidth(multiplier)
    envelope = unionEnvelope(envelope, envelope.left, bodyRight + multiplierWidth / 2)
  }
  return envelope
}

function getConverterLinkedDeviceOffset(
  circuit: Circuit,
  device: TrunkDevice,
  config: CircuitEnvelopeConfig
): number {
  const connection = device.converterDcConnection
  if (!connection) return 0
  const converter = [
    ...(circuit.trunkDevices ?? []),
    ...(circuit.branches ?? []).flatMap((branch) => branch.branchDevices ?? []),
  ].find((candidate) => candidate.id === connection.converterId)
  if (!converter || !supportsCircuitConverterDcConnections(converter)) return 0

  const primaryIds = new Set(
    getCircuitConverterPrimaryBranch(circuit, converter)?.endpointIds ?? []
  )
  const endpoints = circuit.endpoints.filter((endpoint) =>
    connection.connectionIndex === 0
      ? primaryIds.has(endpoint.id) &&
        (!endpoint.converterDcConnection ||
          (endpoint.converterDcConnection.converterId === converter.id &&
            endpoint.converterDcConnection.connectionIndex === 0))
      : endpoint.converterDcConnection?.converterId === converter.id &&
        endpoint.converterDcConnection.connectionIndex === connection.connectionIndex
  )
  const linkedDevices = [
    ...(circuit.trunkDevices ?? []),
    ...(circuit.branches ?? []).flatMap((branch) => branch.branchDevices ?? []),
  ].filter(
    (candidate) =>
      candidate.id !== converter.id &&
      candidate.converterDcConnection?.converterId === converter.id &&
      candidate.converterDcConnection.connectionIndex === connection.connectionIndex
  )
  const deviceIndex = linkedDevices.findIndex((candidate) => candidate.id === device.id)
  const portX = connection.connectionIndex * CIRCUIT_CONVERTER_BLOCK_SIZE
  const chainLength = linkedDevices.length + endpoints.length
  if (chainLength === 1 || deviceIndex < 0) return portX
  return portX + CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD + deviceIndex * config.endpointSpacing
}

function getConverterDcChildrenEnvelope(
  circuit: Circuit,
  device: TrunkDevice,
  config: CircuitEnvelopeConfig,
  metadataCallouts: Map<string, CircuitConverterMetadataCallout>
): HorizontalEnvelope | null {
  if (!supportsCircuitConverterDcConnections(device)) return null
  let envelope: HorizontalEnvelope | null = null
  const count = getCircuitConverterDcConnectionCount(device)
  const framedTargetIds = new Set(
    [...metadataCallouts.values()].flatMap((callout) => callout.sharedTargetIds)
  )
  const owningConverterBranch = (circuit.branches ?? []).find((branch) =>
    branch.branchDevices?.some((candidate) => candidate.id === device.id)
  )
  const primaryIds = new Set(
    (owningConverterBranch ?? getCircuitConverterPrimaryBranch(circuit, device))?.endpointIds ?? []
  )
  for (let connectionIndex = 0; connectionIndex < count; connectionIndex++) {
    const endpoints = circuit.endpoints.filter(
      (endpoint) =>
        (endpoint.converterDcConnection?.converterId === device.id &&
          endpoint.converterDcConnection.connectionIndex === connectionIndex) ||
        (connectionIndex === 0 && primaryIds.has(endpoint.id) && !endpoint.converterDcConnection)
    )
    const linkedDevices = [
      ...(circuit.trunkDevices ?? []),
      ...(circuit.branches ?? []).flatMap((branch) => branch.branchDevices ?? []),
    ].filter(
      (candidate) =>
        candidate.id !== device.id &&
        candidate.converterDcConnection?.converterId === device.id &&
        candidate.converterDcConnection.connectionIndex === connectionIndex
    )
    const portX = connectionIndex * CIRCUIT_CONVERTER_BLOCK_SIZE
    const offsets = getEndpointXOffsets(
      endpoints,
      CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD,
      config.endpointSpacing,
      config.applianceAfterSocketGap
    )
    const chainLength = linkedDevices.length + endpoints.length
    const isSingleEndpoint = linkedDevices.length === 0 && endpoints.length === 1
    const itemX = (index: number) =>
      chainLength === 1
        ? portX
        : portX + CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD + index * config.endpointSpacing
    const rowRight =
      chainLength === 0
        ? portX + CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD
        : chainLength === 1
          ? portX
          : itemX(chainLength - 1)
    envelope = unionEnvelope(envelope ?? { left: portX, right: portX }, portX, rowRight)

    const linkedBus = linkedDevices.find((candidate) => candidate.type === 'dc_bus')
    if (linkedBus) {
      const busIndex = linkedDevices.findIndex((candidate) => candidate.id === linkedBus.id)
      const busBaseX = itemX(busIndex)
      const branchEnvelope = getDcBusBranchEnvelope(circuit, linkedBus.id, config)
      if (branchEnvelope) {
        envelope = unionEnvelope(
          envelope,
          busBaseX + branchEnvelope.left,
          busBaseX + branchEnvelope.right
        )
      }
    }
    endpoints.forEach((endpoint, endpointIndex) => {
      const endpointEnvelope = getEndpointEnvelope(
        endpoint,
        linkedDevices.length > 0
          ? itemX(linkedDevices.length + endpointIndex)
          : isSingleEndpoint
            ? portX
            : portX + (offsets[endpointIndex] ?? CIRCUIT_CONVERTER_OUTPUT_BRANCH_LEAD),
        endpointIndex === endpoints.length - 1,
        config.symbolSize,
        !framedTargetIds.has(endpoint.id)
      )
      envelope = unionEnvelope(envelope!, endpointEnvelope.left, endpointEnvelope.right)
    })
    const endpointIds = new Set(endpoints.map((endpoint) => endpoint.id))
    const branchLabel = (circuit.branches ?? [])
      .find((branch) => branch.endpointIds.some((endpointId) => endpointIds.has(endpointId)))
      ?.label?.trim()
    if (branchLabel) {
      const labelRight = -BRANCH_LABEL_RIGHT_OFFSET
      envelope = unionEnvelope(
        envelope!,
        labelRight - estimateCircuitLabelWidth(branchLabel) - LABEL_SAFETY,
        labelRight
      )
    }
  }
  for (const callout of metadataCallouts.values()) {
    envelope = unionEnvelope(
      envelope ?? { left: callout.rect.left, right: callout.rect.right },
      callout.rect.left,
      callout.rect.right
    )
  }
  return envelope
}

function getCircuitNotesEnvelope(
  circuit: Circuit,
  orientation: 'horizontal' | 'vertical'
): HorizontalEnvelope | null {
  if (!circuit.notes?.trim() || circuit.notesVisible === false) return null
  const bounds = getCircuitNotesPaintBounds(circuit.notes, orientation)
  return { left: bounds.left, right: bounds.right }
}

export function measureCircuitLayoutEnvelope(
  circuit: Circuit,
  circuitMap: Map<string, Circuit>,
  protectionByCircuitId: Map<string, ProtectionDevice>,
  config: CircuitEnvelopeConfig,
  hasPanelAttachment: (protection: ProtectionDevice | undefined, circuit: Circuit) => boolean,
  memo = new Map<string, CircuitLayoutEnvelope>()
): CircuitLayoutEnvelope {
  const cached = memo.get(circuit.id)
  if (cached) return cached

  let envelope = getProtectionOwnEnvelope(circuit, protectionByCircuitId.get(circuit.id), config)
  const branchEnvelope = getBranchesEnvelope(circuit, config)
  envelope = unionEnvelope(envelope, branchEnvelope.left, branchEnvelope.right)

  for (const device of circuit.trunkDevices ?? []) {
    const metadataCallouts = supportsCircuitConverterDcConnections(device)
      ? getCircuitConverterMetadataCallouts({
          circuit,
          device,
          anchor: { x: 0, y: 0 },
          symbolSize: config.symbolSize,
          endpointSpacing: config.endpointSpacing,
          applianceAfterSocketGap: config.applianceAfterSocketGap,
        })
      : new Map<string, CircuitConverterMetadataCallout>()
    const deviceEnvelope = getTrunkDeviceEnvelope(device, config, !metadataCallouts.has(device.id))
    const deviceOffset = getConverterLinkedDeviceOffset(circuit, device, config)
    envelope = unionEnvelope(
      envelope,
      deviceOffset + deviceEnvelope.left,
      deviceOffset + deviceEnvelope.right
    )
    const dcChildrenEnvelope = getConverterDcChildrenEnvelope(
      circuit,
      device,
      config,
      metadataCallouts
    )
    if (dcChildrenEnvelope) {
      envelope = unionEnvelope(envelope, dcChildrenEnvelope.left, dcChildrenEnvelope.right)
    }
    if (device.type === 'dc_bus' && !device.converterDcConnection) {
      const branchEnvelope = getDcBusBranchEnvelope(circuit, device.id, config)
      if (branchEnvelope) {
        envelope = unionEnvelope(
          envelope,
          deviceOffset + branchEnvelope.left,
          deviceOffset + branchEnvelope.right
        )
      }
    }
  }

  const notesEnvelope = getCircuitNotesEnvelope(circuit, config.circuitNotesOrientation)
  if (notesEnvelope) {
    envelope = unionEnvelope(envelope, notesEnvelope.left, notesEnvelope.right)
  }

  const nestedCircuits = (circuit.subCircuitIds ?? [])
    .map((id) => circuitMap.get(id))
    .filter((candidate): candidate is Circuit => candidate !== undefined)
  const nestedAnchorOffsets = new Map<string, number>()
  const dcBusDevice = (circuit.trunkDevices ?? []).find((device) => device.type === 'dc_bus')
  if (dcBusDevice && nestedCircuits.length > 0) {
    const orderedBusCircuitIds = dcBusDevice.dcBusProps?.branchCircuitIds ?? []
    const orderedChildren = [
      ...orderedBusCircuitIds
        .map((id) => nestedCircuits.find((child) => child.id === id))
        .filter((child): child is Circuit => !!child),
      ...nestedCircuits.filter((child) => !orderedBusCircuitIds.includes(child.id)),
    ]
    const busOffset = getConverterLinkedDeviceOffset(circuit, dcBusDevice, config)
    let anchorOffset = busOffset + config.dcBusBranchLeadIn
    let previousRight: number | null = null
    orderedChildren.forEach((child) => {
      const childEnvelope = measureCircuitLayoutEnvelope(
        child,
        circuitMap,
        protectionByCircuitId,
        config,
        hasPanelAttachment,
        memo
      )
      if (previousRight != null) {
        anchorOffset = previousRight + config.nestedGutter - childEnvelope.left
      }
      nestedAnchorOffsets.set(child.id, anchorOffset)
      envelope = unionEnvelope(
        envelope,
        anchorOffset + childEnvelope.left,
        anchorOffset + childEnvelope.right
      )
      previousRight = anchorOffset + childEnvelope.right
    })
    const railRight = Math.max(
      busOffset + config.dcBusMinWidth,
      ...[...nestedAnchorOffsets.values()].map(
        (childAnchor) => childAnchor + config.secondaryBusExtension
      )
    )
    envelope = unionEnvelope(envelope, busOffset - 20, railRight)
  } else if (nestedCircuits.length === 1) {
    const child = nestedCircuits[0]!
    const childEnvelope = measureCircuitLayoutEnvelope(
      child,
      circuitMap,
      protectionByCircuitId,
      config,
      hasPanelAttachment,
      memo
    )
    nestedAnchorOffsets.set(child.id, 0)
    envelope = unionEnvelope(envelope, childEnvelope.left, childEnvelope.right)
  } else if (nestedCircuits.length > 1) {
    const protection = protectionByCircuitId.get(circuit.id)
    const hasPanel = hasPanelAttachment(protection, circuit)
    const panelColumnWidth = hasPanel
      ? Math.max(
          config.secondaryBusPanelColumnWidth,
          config.secondaryBusPanelLabelWidth?.(protection, circuit) ?? 0
        )
      : 0
    let anchorOffset = hasPanel ? panelColumnWidth : 0
    let previousRight: number | null = null

    nestedCircuits.forEach((child) => {
      const childEnvelope = measureCircuitLayoutEnvelope(
        child,
        circuitMap,
        protectionByCircuitId,
        config,
        hasPanelAttachment,
        memo
      )
      if (previousRight != null) {
        anchorOffset = previousRight + config.nestedGutter - childEnvelope.left
      }
      nestedAnchorOffsets.set(child.id, anchorOffset)
      envelope = unionEnvelope(
        envelope,
        anchorOffset + childEnvelope.left,
        anchorOffset + childEnvelope.right
      )
      previousRight = anchorOffset + childEnvelope.right
    })
  }

  const result: CircuitLayoutEnvelope = {
    left: envelope.left,
    right: envelope.right,
    nestedAnchorOffsets,
  }
  memo.set(circuit.id, result)
  return result
}
