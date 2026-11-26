/**
 * Manual risers: a second cable leaving the breaker. The trunk splits at a node just above the breaker output, below the
 * cable captions; a lead runs to riser k, and every stem draws its own vertical with its own caption.
 */
import type { Circuit, Panel, ProtectionDevice, WireSegment } from '@/types/schema'
import { generateId } from '@/utils'
import type { CircuitSectionRef } from '@/lib/wires/sectionWireOverrides'
import { getCircuitWirePropertiesForDomain } from './circuitWireDerivationSupport'
import { continueSegment, deriveCircuitColumnWires, getBranchNodeStem, getCircuitCrossbarY } from './deriveCircuitColumnWires'
import { parseCircuitTrunkWire } from './layoutTreeCircuitColumns'
import type { LayoutNode } from './layoutTree'

type Point2 = { x: number; y: number }

/** Manual riser stems (k > 0) drawn for this circuit, from its lead nodes. */
export function getManualRiserStems(mcbNode: LayoutNode): number[] {
  return mcbNode.children.flatMap((node) => {
    const wire = parseCircuitTrunkWire(node)
    return wire?.kind === 'stemLead' ? [wire.stem] : []
  }).sort((a, b) => a - b)
}

export interface ManualRiserWireInput {
  mcbNode: LayoutNode
  circuit: Circuit
  panel: Panel
  protection?: ProtectionDevice | null
  /** The trunk's single vertical as drawn without risers (breaker output up to the top of the trunk). */
  trunkSegment: WireSegment
  branchNodes: LayoutNode[]
  /** Base of a cable caption starting at `start` for a stem whose caption ends at `crossbarY` (if any). */
  labelBaseEnd: (start: Point2, end: Point2, crossbarY?: number) => Point2
  /** Label visibility of the trunk's own cable above the split (it keeps its caption like every riser). */
  upperHideLabel?: boolean
}

export interface ManualRiserWires {
  /** Replaces `trunkSegment`: the stub up to the split and the trunk above it. */
  trunk: WireSegment[]
  /** The vertical of each manual riser, keyed by stem (also the base of its crossbar and automatic columns). */
  riserSegments: Map<number, WireSegment>
  /** Leads, in drawing order, after the riser verticals. */
  segments: WireSegment[]
}

const center = (node: LayoutNode): number => node.bounds.y + node.bounds.height / 2

export function deriveManualRiserWires(input: ManualRiserWireInput): ManualRiserWires {
  const { mcbNode, circuit, protection, trunkSegment, branchNodes } = input
  const leads = mcbNode.children.filter((node) => parseCircuitTrunkWire(node)?.kind === 'stemLead')
  const splitY = center(leads[0]!)
  const x = trunkSegment.startPoint.x
  const stub = {
    ...continueSegment(trunkSegment, trunkSegment.startPoint, { x, y: splitY }),
  }
  const upperStart = { x, y: splitY }
  const upper: WireSegment = {
    ...trunkSegment, id: generateId(), startPoint: upperStart,
    wireLabelBaseEndPoint: input.labelBaseEnd(upperStart, trunkSegment.endPoint),
    ...('upperHideLabel' in input ? { hideWireLabel: input.upperHideLabel } : {}),
  }
  const riserSegments = new Map<number, WireSegment>()
  const segments: WireSegment[] = []
  for (const lead of leads) {
    const wire = parseCircuitTrunkWire(lead)!
    const riserNode = mcbNode.children.find((node) => {
      const other = parseCircuitTrunkWire(node)
      return other?.kind === 'riser' && other.manual && other.stem === wire.stem
    })
    if (!riserNode) continue
    const riserX = riserNode.bounds.x + riserNode.bounds.width / 2
    const rows = branchNodes.filter((node) => getBranchNodeStem(node) === wire.stem && (node.branchLayout?.column?.index ?? 0) === wire.column)
    const crossbarY = getCircuitCrossbarY(mcbNode, wire.stem)
    const topY = rows.length ? Math.min(...rows.map(center)) : riserNode.bounds.y
    const nearestRowY = rows.length ? Math.max(...rows.map(center)) : topY
    // The riser's cable leaves the protection, or the topmost trunk device of the shared part.
    const sectionRef: CircuitSectionRef = { fromElementType: trunkSegment.fromElementType as CircuitSectionRef['fromElementType'], fromElementId: trunkSegment.fromElementId ?? protection?.id, domain: trunkSegment.domain, riserStem: wire.stem }
    const props = getCircuitWirePropertiesForDomain(circuit, trunkSegment.domain ?? 'AC', sectionRef)
    const start = { x: riserX, y: splitY }
    const end = { x: riserX, y: topY }
    const riser: WireSegment = {
      ...trunkSegment, id: generateId(), startPoint: start, endPoint: end, riserStem: wire.stem,
      cable: props.cable, inTube: props.inTube, wireRoute: props.wireRoute, inWall: props.inWall,
      // Unset shows the caption only on a protection output, so a riser leaving a trunk device says so explicitly.
      hideWireLabel: props.hideWireLabel ?? (trunkSegment.fromElementType === 'protection' ? undefined : false),
      wireLabelEndPoint: { x: riserX, y: crossbarY ?? nearestRowY },
      wireLabelBaseEndPoint: input.labelBaseEnd(start, { x: riserX, y: crossbarY ?? nearestRowY }, crossbarY),
    }
    riserSegments.set(wire.stem, riser)
    segments.push(riser, continueSegment(riser, { x, y: splitY }, start))
  }
  return { trunk: [stub, upper], riserSegments, segments }
}

/**
 * Risers on a trunk with devices: the last trunk segment (topmost device up to the top of the trunk's own rows)
 * is cut at the split into a stub and the trunk's own cable, and every riser leaves from the split. Without risers
 * it only adds the automatic columns, as before. The cut segment is removed from `segments`.
 */
export function deriveTrunkDeviceColumnWires(
  segments: WireSegment[],
  lastTrunkSegment: WireSegment | undefined,
  input: Omit<ManualRiserWireInput, 'trunkSegment' | 'upperHideLabel'>,
): WireSegment[] {
  if (!lastTrunkSegment || !getManualRiserStems(input.mcbNode).length) return deriveCircuitColumnWires(input.mcbNode, lastTrunkSegment)
  const index = segments.indexOf(lastTrunkSegment)
  if (index >= 0) segments.splice(index, 1)
  const props = getCircuitWirePropertiesForDomain(input.circuit, lastTrunkSegment.domain ?? 'AC', {
    fromElementType: lastTrunkSegment.fromElementType as CircuitSectionRef['fromElementType'], fromElementId: lastTrunkSegment.fromElementId, domain: lastTrunkSegment.domain,
  })
  const risers = deriveManualRiserWires({ ...input, trunkSegment: lastTrunkSegment, upperHideLabel: props.hideWireLabel ?? false })
  return [...risers.trunk, ...risers.segments, ...deriveCircuitColumnWires(input.mcbNode, risers.trunk[1], risers.riserSegments)]
}
