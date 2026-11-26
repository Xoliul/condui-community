/** Shared node connections and circuit wire-property resolution for wire derivation. */
import type { LayoutNode } from './layoutTree'
import { isVirtualPanel } from '@/lib/supplyTaps/virtualPanel'
import type {
  WireSegment,
  Circuit,
  Panel,
  ElectricalDomain,
  Endpoint,
  TrunkDevice,
} from '@/types/schema'
import { resolveSymbolPortsForWire, DEFAULT_ELECTRICAL_DOMAIN } from '@/lib/symbols'
import { resolveShowFireClassLabel, resolveShowWireLengthLabel } from '@/lib/wires/circuitWireDefaults'
import { findSectionWireOverride, type CircuitSectionRef } from '@/lib/wires/sectionWireOverrides'
import { applyRotatedWireInset } from './rotatedWireInsets'
import { DOMOTICA_BOX_WIDTH } from '@/lib/domoticaLayout'
import { isHorizontalDomotica } from './domoticaHorizontalGeometry'
import {
  CIRCUIT_CONVERTER_BLOCK_SIZE,
  CIRCUIT_CONVERTER_TOP_WIRE_INSET,
  getCircuitConverterBodyGeometry,
  getCircuitConverterDcConnectionCount,
  getSupplyConverterBodyGeometry,
  supportsCircuitConverterDcConnections,
} from './circuitConverterGeometry'

const SECONDARY_BUS_REFERENCE_LABEL_INTERVAL = 4

export function shouldLabelSecondaryBusSegment(segmentIndex: number, childCount: number): boolean {
  if (childCount <= SECONDARY_BUS_REFERENCE_LABEL_INTERVAL) return false
  const childNumberAtSegmentEnd = segmentIndex + 1
  return childNumberAtSegmentEnd % SECONDARY_BUS_REFERENCE_LABEL_INTERVAL === 0
}

export function getCircuitDisplayLabel(circuit: Circuit, protection?: { label?: string } | null): string {
  return (protection?.label ?? '').trim() || (circuit.code ?? '').trim()
}

/** Get the symbolId from a layout node's visual (if it's a symbol) */
export function getNodeSymbolId(node: LayoutNode): string | undefined {
  return node.visual?.type === 'symbol' ? node.visual.symbolId : undefined
}

function getNodeLightPointProps(node: LayoutNode): Endpoint['lightPointProps'] | undefined {
  if (node.type !== 'endpoint' || !node.domainRef) return undefined
  return (node.domainRef as Endpoint).lightPointProps
}

function getNodeMotionDetectorProps(node: LayoutNode): Endpoint['motionDetectorProps'] | undefined {
  if (node.type !== 'endpoint' || !node.domainRef) return undefined
  return (node.domainRef as Endpoint).motionDetectorProps
}

export function getDomoticaOutputPhaseState(
  circuit: Circuit,
  segment: WireSegment,
  incomingSourceEndpoint?: Endpoint,
):
  | Pick<ReturnType<typeof getCircuitWirePropertiesForDomain>, 'phaseAssignment' | 'showPhaseLabel'>
  | undefined {
  if (!segment.domoticaOutputGroup || segment.domoticaOutputIndex == null) return undefined
  const segmentSource = incomingSourceEndpoint ?? circuit.endpoints.find((endpoint) => endpoint.id === segment.fromElementId)
  const parentId =
    segmentSource?.symbol === 'domotica'
      ? segmentSource.id
      : segmentSource?.domoticaChildProps?.parentEndpointId
  const domotica = circuit.endpoints.find(
    (endpoint) =>
      endpoint.id === parentId && endpoint.symbol === 'domotica' && endpoint.domoticaProps
  )
  if (!domotica?.domoticaProps) return undefined
  const outputWires =
    segment.domoticaOutputGroup === 'control'
      ? domotica.domoticaProps.controlOutputWires
      : domotica.domoticaProps.endpointOutputWires
  const output = outputWires?.[segment.domoticaOutputIndex]
  return output
    ? { phaseAssignment: output.phaseAssignment, showPhaseLabel: output.showPhaseLabel }
    : undefined
}

export function applyNodeWireInset(
  point: { x: number; y: number },
  otherEnd: { x: number; y: number },
  node: LayoutNode
): { x: number; y: number } {
  if (node.type === 'endpoint' && getNodeSymbolId(node) === 'domotica') {
    // A horizontal module is fed at its anchor column; the wire is not trimmed to a box edge.
    if (isHorizontalDomotica(node.domainRef as Endpoint | undefined)) return point
    const dx = otherEnd.x - point.x
    const dy = otherEnd.y - point.y
    if (Math.abs(dx) >= Math.abs(dy)) {
      return {
        x: point.x + (dx < 0 ? -DOMOTICA_BOX_WIDTH / 2 : DOMOTICA_BOX_WIDTH / 2),
        y: point.y,
      }
    }
    return {
      x: point.x,
      y: point.y + (dy < 0 ? -node.bounds.height / 2 : node.bounds.height / 2),
    }
  }
  // Supply DC-bus domotica uses the same anchored, variable-height frame as
  // regular-panel domotica. Its vertical bus connection must terminate at the
  // actual frame edge, not at the layout anchor/center.
  if (node.type === 'trunkDevice' && getNodeSymbolId(node) === 'domotica') {
    const dx = otherEnd.x - point.x
    const dy = otherEnd.y - point.y
    if (Math.abs(dy) > Math.abs(dx)) {
      return {
        x: point.x,
        y: point.y + (dy < 0 ? -node.bounds.height / 2 : node.bounds.height / 2),
      }
    }
  }
  const converter = node.domainRef as TrunkDevice | undefined
  if (
    node.connectionAnchor &&
    node.converterGrowthDirection &&
    converter &&
    supportsCircuitConverterDcConnections(converter)
  ) {
    const geometry =
      node.converterGrowthDirection === 'left'
        ? getSupplyConverterBodyGeometry(converter, node.connectionAnchor)
        : getCircuitConverterBodyGeometry(converter, node.connectionAnchor)
    const dx = otherEnd.x - point.x
    const dy = otherEnd.y - point.y
    const edgeInset = CIRCUIT_CONVERTER_BLOCK_SIZE / 2 - CIRCUIT_CONVERTER_TOP_WIRE_INSET
    if (Math.abs(dx) >= Math.abs(dy)) {
      return {
        x: dx < 0 ? geometry.left + edgeInset : geometry.right - edgeInset,
        y: node.connectionAnchor.y,
      }
    }
    return {
      x: node.connectionAnchor.x,
      y: dy < 0 ? geometry.top + edgeInset : geometry.bottom - edgeInset,
    }
  }
  return applyRotatedWireInset(
    point,
    otherEnd,
    node.type,
    getNodeSymbolId(node),
    node.visual?.type === 'symbol' ? (node.visual.rotationDeg ?? 0) : 0,
    {
      lightPointProps: getNodeLightPointProps(node),
      motionDetectorProps: getNodeMotionDetectorProps(node),
    }
  )
}

export function getNodeConnectionAnchor(node: LayoutNode): { x: number; y: number } {
  return node.connectionAnchor ?? { x: node.bounds.x, y: node.bounds.y }
}

// Conversion components that are allowed to change electrical domain along a trunk
const CONVERSION_SYMBOL_IDS = new Set(['transformer', 'rectifier', 'inverter', 'dc_dc_converter'])

/** Domain for a segment leaving the given node on a trunk, based on previous domain and conversion devices only. */
export function getTrunkDomainAfterNode(
  previousDomain: typeof DEFAULT_ELECTRICAL_DOMAIN,
  node: LayoutNode | null
): typeof DEFAULT_ELECTRICAL_DOMAIN {
  if (!node) return previousDomain
  const symbolId = getNodeSymbolId(node)
  const trunkDevice = node.domainRef as TrunkDevice | undefined
  if (
    node.type === 'trunkDevice' &&
    supportsCircuitConverterDcConnections(trunkDevice) &&
    getCircuitConverterDcConnectionCount(trunkDevice) > 1
  ) {
    return previousDomain
  }
  if (!symbolId || !CONVERSION_SYMBOL_IDS.has(symbolId)) {
    // Non-conversion devices (protection, energy meter, etc.) are domain agnostic
    return previousDomain
  }
  const resolved = resolveSymbolPortsForWire(symbolId, previousDomain)
  if (!resolved.matched || !resolved.oppositePortDomain) {
    return previousDomain
  }
  return resolved.oppositePortDomain
}

export function getCircuitWirePropertiesForDomain(
  circuit: Circuit,
  domain: ElectricalDomain,
  sectionRef?: CircuitSectionRef | null
) {
  const domainOverride = circuit.domainWireOverrides?.[domain]
  const sectionOverride = sectionRef ? findSectionWireOverride(circuit, sectionRef) : undefined
  const wireRoute =
    sectionOverride?.wireRoute ??
    domainOverride?.wireRoute ??
    circuit.wireRoute ??
    (circuit.inWall ? 'wall' : undefined)
  return {
    cable: sectionOverride?.cable ?? domainOverride?.cable ?? circuit.cable,
    phaseAssignment:
      sectionOverride?.phaseAssignment ??
      domainOverride?.phaseAssignment ??
      circuit.phaseAssignment,
    showPhaseLabel:
      sectionOverride?.showPhaseLabel ?? domainOverride?.showPhaseLabel ?? circuit.showPhaseLabel,
    inTube: sectionOverride?.inTube ?? domainOverride?.inTube ?? circuit.inTube,
    wireRoute,
    inWall:
      sectionOverride?.inWall ??
      domainOverride?.inWall ??
      (wireRoute === 'wall' ? (circuit.inWall ?? false) : false),
    hideWireLabel:
      sectionOverride?.hideWireLabel ?? domainOverride?.hideWireLabel ?? circuit.hideWireLabel,
    showFireClassLabel: resolveShowFireClassLabel(
      sectionOverride?.showFireClassLabel ??
        domainOverride?.showFireClassLabel ??
        circuit.showFireClassLabel,
      domain
    ),
    wireLengthM: sectionOverride?.wireLengthM ?? domainOverride?.wireLengthM ?? circuit.wireLengthM,
    showWireLengthLabel: resolveShowWireLengthLabel(
      sectionOverride?.showWireLengthLabel ??
        domainOverride?.showWireLengthLabel ??
        circuit.showWireLengthLabel
    ),
  }
}

/** Same merge as {@link getCircuitWirePropertiesForDomain} when the section override was resolved externally. */
export function getCircuitWirePropertiesFromResolvedOverride(
  circuit: Circuit,
  domain: ElectricalDomain,
  sectionOverride: ReturnType<typeof findSectionWireOverride>
) {
  const domainOverride = circuit.domainWireOverrides?.[domain]
  const wireRoute =
    sectionOverride?.wireRoute ??
    domainOverride?.wireRoute ??
    circuit.wireRoute ??
    (circuit.inWall ? 'wall' : undefined)
  return {
    cable: sectionOverride?.cable ?? domainOverride?.cable ?? circuit.cable,
    phaseAssignment:
      sectionOverride?.phaseAssignment ??
      domainOverride?.phaseAssignment ??
      circuit.phaseAssignment,
    showPhaseLabel:
      sectionOverride?.showPhaseLabel ?? domainOverride?.showPhaseLabel ?? circuit.showPhaseLabel,
    inTube: sectionOverride?.inTube ?? domainOverride?.inTube ?? circuit.inTube,
    wireRoute,
    inWall:
      sectionOverride?.inWall ??
      domainOverride?.inWall ??
      (wireRoute === 'wall' ? (circuit.inWall ?? false) : false),
    hideWireLabel:
      sectionOverride?.hideWireLabel ?? domainOverride?.hideWireLabel ?? circuit.hideWireLabel,
    showFireClassLabel: resolveShowFireClassLabel(
      sectionOverride?.showFireClassLabel ??
        domainOverride?.showFireClassLabel ??
        circuit.showFireClassLabel,
      domain
    ),
    wireLengthM: sectionOverride?.wireLengthM ?? domainOverride?.wireLengthM ?? circuit.wireLengthM,
    showWireLengthLabel: resolveShowWireLengthLabel(
      sectionOverride?.showWireLengthLabel ??
        domainOverride?.showWireLengthLabel ??
        circuit.showWireLengthLabel
    ),
  }
}

/** The source row and its receiving-board copy use the same per-output fallback rules. */
export function resolveDomoticaOutputWireProperties(
  base: ReturnType<typeof getCircuitWirePropertiesForDomain>,
  output: Partial<ReturnType<typeof getCircuitWirePropertiesForDomain>> | undefined,
): ReturnType<typeof getCircuitWirePropertiesForDomain> {
  const wireRoute = output?.wireRoute ?? base.wireRoute
  return {
    cable: output?.cable ?? base.cable,
    phaseAssignment: output?.phaseAssignment ?? base.phaseAssignment,
    showPhaseLabel: output?.showPhaseLabel ?? base.showPhaseLabel,
    wireRoute,
    inTube: output?.inTube ?? base.inTube,
    inWall: output?.inWall ?? (wireRoute === 'wall' ? (base.inWall ?? false) : false),
    hideWireLabel: output?.hideWireLabel ?? base.hideWireLabel,
    showFireClassLabel: output?.showFireClassLabel ?? base.showFireClassLabel,
    wireLengthM: output?.wireLengthM ?? base.wireLengthM,
    showWireLengthLabel: output?.showWireLengthLabel ?? base.showWireLengthLabel,
  }
}

/**
 * Helper to find circuit for a protection device
 */
export function findCircuitForProtection(panel: Panel, protectionId?: string): Circuit | null {
  if (!protectionId) return null

  // Check direct circuits
  for (const circuit of panel.circuits) {
    // Check if any protection in the panel has this circuit
    const protection = panel.protections.find((p) => p.id === protectionId)
    if (protection?.circuits?.some((c) => c.id === circuit.id)) {
      return circuit
    }
  }

  // Check circuits under protections
  for (const protection of panel.protections) {
    if (protection.id === protectionId && protection.circuits?.[0]) {
      return protection.circuits[0]
    }
  }

  return null
}

export function findCircuitByIdInPanel(panel: Panel, circuitId?: string): Circuit | null {
  if (!circuitId) return null
  for (const circuit of panel.circuits ?? []) {
    if (circuit.id === circuitId) return circuit
  }
  for (const protection of panel.protections ?? []) {
    for (const circuit of protection.circuits ?? []) {
      if (circuit.id === circuitId) return circuit
    }
  }
  // Supply taps live on the owner's virtual board but are drawn with the owner's supply frame.
  for (const board of panel.subPanels ?? []) {
    if (!isVirtualPanel(board)) continue
    const circuit = findCircuitByIdInPanel(board, circuitId)
    if (circuit) return circuit
  }
  return null
}
