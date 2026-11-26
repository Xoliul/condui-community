import type { LayoutNode } from './layoutTree'
import {
  getHorizontalDomoticaAnchorFromBounds,
  getHorizontalDomoticaGeometry,
  isHorizontalDomotica,
  type HorizontalDomoticaGeometry,
} from './domoticaHorizontalGeometry'
import type { Endpoint, WireSegment } from '@/types/schema'

/** Body geometry of a horizontal module node, or null for the vertical module. */
export function getHorizontalDomoticaBody(
  node: LayoutNode,
  branchY: number,
  outputCount: number
): HorizontalDomoticaGeometry | null {
  if (!isHorizontalDomotica(node.domainRef as Endpoint | undefined)) return null
  return getHorizontalDomoticaGeometry(
    { x: getHorizontalDomoticaAnchorFromBounds(node.bounds).x, y: branchY },
    outputCount
  )
}

/** A horizontal module is fed at its anchor column, not at the centre of its body. */
export function getHorizontalDomoticaFeedNode(
  node: LayoutNode,
  body: HorizontalDomoticaGeometry | null,
  branchY: number
): LayoutNode {
  return body ? { ...node, bounds: { ...node.bounds, x: body.anchor.x, y: branchY } } : node
}

/**
 * Short stub from the branch wire up to the bottom edge of the body. It continues the feed
 * section, so it carries no label of its own.
 */
export function buildHorizontalDomoticaFeedStub(input: {
  id: string
  body: HorizontalDomoticaGeometry
  feed: WireSegment | undefined
  fallback: Pick<WireSegment, 'cable'>
  panelId: string
  circuitId: string
  domain: WireSegment['domain']
  moduleId: string | undefined
}): WireSegment {
  const { body, feed } = input
  return {
    id: input.id,
    type: 'branch',
    startPoint: body.feedWirePoint,
    endPoint: body.feedPort,
    cable: feed?.cable ?? input.fallback.cable,
    panelId: input.panelId,
    domain: input.domain,
    circuitId: input.circuitId,
    fromElementId: input.moduleId,
    fromElementType: 'endpoint',
    inTube: feed?.inTube,
    inWall: feed?.inWall,
    wireRoute: feed?.wireRoute,
    hideWireLabel: true,
    trunkContinuation: true,
  }
}
