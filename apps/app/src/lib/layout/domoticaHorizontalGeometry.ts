import type { Endpoint } from '@/types/schema'
import {
  DOMOTICA_MAX_ENDPOINT_OUTPUTS,
  DOMOTICA_MIN_ENDPOINT_OUTPUTS,
  DOMOTICA_OUTPUT_SPACING,
} from '@/lib/domoticaLayout'

/**
 * Geometry of the horizontal domotica module (`domoticaProps.oneWireLayout === 'horizontal'`).
 *
 * The module is a plain outlined body. Its feed enters at the bottom edge at the anchor column
 * (the leftmost column), and output `index` leaves the TOP edge at `anchor.x + index * COLUMN`,
 * so output 0 is leftmost and the index stays the identity of the output. Children stand above
 * their output, one per `CHAIN_STEP` when an output feeds a chain.
 *
 * Pure geometry: no store, DOM or canvas access. The "anchor" is the point where the circuit's
 * branch wire arrives: `{ x: element.position.x, y: branchY }`.
 */

/**
 * Horizontal pitch of one output column. Each output carries an upright number label ("F1.20")
 * beside its wire, so the pitch is wider than the vertical module's 20-unit row spacing; every
 * horizontal path reads this one constant.
 */
export const DOMOTICA_HORIZONTAL_COLUMN_WIDTH = 44
/** Output label: gap right of the port wire, font size, and height of its line box. */
export const DOMOTICA_HORIZONTAL_LABEL_GAP = 4
export const DOMOTICA_HORIZONTAL_LABEL_FONT_SIZE = 11
export const DOMOTICA_HORIZONTAL_LABEL_HEIGHT = 14
/** Label line centre above the top edge of the body. */
export const DOMOTICA_HORIZONTAL_LABEL_RISE = 9
/** Body height, close to the vertical module's `DOMOTICA_BASE_HEIGHT` (26) so both sit alike beside converters. */
export const DOMOTICA_HORIZONTAL_BODY_HEIGHT = 28
/** Module note: font, line height, gap right of the feed wire and below the body (8pt like the vertical note). */
export const DOMOTICA_HORIZONTAL_NOTE_GAP_X = 4
export const DOMOTICA_HORIZONTAL_NOTE_GAP_Y = 1
/** Vertical stub between the branch wire and the bottom edge of the body. */
export const DOMOTICA_HORIZONTAL_FEED_LEAD = 10
/** Distance from the top edge to the first child of an output. */
export const DOMOTICA_HORIZONTAL_OUTPUT_LEAD = 35
/** Distance between chained children on one output. */
export const DOMOTICA_HORIZONTAL_CHAIN_STEP = 40

type HorizontalDomoticaCandidate = Pick<Endpoint, 'symbol' | 'domoticaChildProps' | 'domoticaProps'>

/**
 * The single predicate that switches the horizontal paths on. Only a top-level module (not an
 * output of another module) that stores `oneWireLayout: 'horizontal'` qualifies; every other
 * module keeps the vertical drawing. DC-bus and supply restrictions are enforced when the field
 * is set (`properties.edit`), because an endpoint cannot see its branch here.
 */
export function isHorizontalDomotica(
  endpoint: HorizontalDomoticaCandidate | null | undefined
): boolean {
  return (
    endpoint?.symbol === 'domotica' &&
    !endpoint.domoticaChildProps &&
    endpoint.domoticaProps?.oneWireLayout === 'horizontal'
  )
}

/** Whether `endpoint` is a direct output child of a horizontal module in `endpoints`. */
export function isChildOfHorizontalDomotica(
  endpoint: Pick<Endpoint, 'domoticaChildProps'>,
  endpoints: readonly (HorizontalDomoticaCandidate & Pick<Endpoint, 'id'>)[]
): boolean {
  const parentId = endpoint.domoticaChildProps?.parentEndpointId
  if (!parentId) return false
  return endpoints.some((candidate) => candidate.id === parentId && isHorizontalDomotica(candidate))
}

export function getHorizontalDomoticaOutputCount(
  endpoint: Pick<Endpoint, 'domoticaProps'>
): number {
  return Math.max(
    DOMOTICA_MIN_ENDPOINT_OUTPUTS,
    Math.min(
      DOMOTICA_MAX_ENDPOINT_OUTPUTS,
      Math.trunc(endpoint.domoticaProps?.endpointCount ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS)
    )
  )
}

export interface HorizontalDomoticaPoint {
  x: number
  y: number
}

export interface HorizontalDomoticaOutputPort extends HorizontalDomoticaPoint {
  index: number
}

export interface HorizontalDomoticaGeometry {
  count: number
  anchor: HorizontalDomoticaPoint
  left: number
  right: number
  top: number
  bottom: number
  width: number
  height: number
  center: HorizontalDomoticaPoint
  /** Where the circuit's branch wire arrives (below the body). */
  feedWirePoint: HorizontalDomoticaPoint
  /** Where the feed stub meets the bottom edge of the body. */
  feedPort: HorizontalDomoticaPoint
  /** Output ports on the top edge, output 0 leftmost. */
  outputs: HorizontalDomoticaOutputPort[]
}

export function getHorizontalDomoticaBodyWidth(count: number): number {
  // Exactly one column per output: a one-output body has no empty second column.
  return Math.max(1, count) * DOMOTICA_HORIZONTAL_COLUMN_WIDTH
}

/**
 * Top-left of the module note, relative to the anchor (the feed wire arrival): right of the feed
 * wire, just below the body. The note grows downward, away from the outputs and their children.
 */
export function getHorizontalDomoticaNoteOffset(): HorizontalDomoticaPoint {
  return {
    x: DOMOTICA_HORIZONTAL_NOTE_GAP_X,
    y: -DOMOTICA_HORIZONTAL_FEED_LEAD + DOMOTICA_HORIZONTAL_NOTE_GAP_Y,
  }
}

export function getHorizontalDomoticaGeometry(
  anchor: HorizontalDomoticaPoint,
  count: number
): HorizontalDomoticaGeometry {
  const width = getHorizontalDomoticaBodyWidth(count)
  const height = DOMOTICA_HORIZONTAL_BODY_HEIGHT
  const left = anchor.x - DOMOTICA_HORIZONTAL_COLUMN_WIDTH / 2
  const bottom = anchor.y - DOMOTICA_HORIZONTAL_FEED_LEAD
  const top = bottom - height
  return {
    count,
    anchor,
    left,
    right: left + width,
    top,
    bottom,
    width,
    height,
    center: { x: left + width / 2, y: top + height / 2 },
    feedWirePoint: { x: anchor.x, y: anchor.y },
    feedPort: { x: anchor.x, y: bottom },
    outputs: Array.from({ length: count }, (_, index) => ({
      index,
      x: anchor.x + index * DOMOTICA_HORIZONTAL_COLUMN_WIDTH,
      y: top,
    })),
  }
}

/** Layout nodes and the renderer use the body centre as the node position and its size as bounds. */
export function getHorizontalDomoticaNodeBounds(
  anchor: HorizontalDomoticaPoint,
  count: number
): { x: number; y: number; width: number; height: number } {
  const geometry = getHorizontalDomoticaGeometry(anchor, count)
  return { x: geometry.center.x, y: geometry.center.y, width: geometry.width, height: geometry.height }
}

/** Inverse of {@link getHorizontalDomoticaNodeBounds}: the feed anchor of a module node. */
export function getHorizontalDomoticaAnchorFromBounds(bounds: {
  x: number
  y: number
  width: number
  height: number
}): HorizontalDomoticaPoint {
  return {
    x: bounds.x - bounds.width / 2 + DOMOTICA_HORIZONTAL_COLUMN_WIDTH / 2,
    y: bounds.y + bounds.height / 2 + DOMOTICA_HORIZONTAL_FEED_LEAD,
  }
}

/** Offset of chain position `chainIndex` of output `outputIndex` from the anchor (y is negative: up). */
export function getHorizontalDomoticaChildOffset(
  outputIndex: number,
  chainIndex = 0
): HorizontalDomoticaPoint {
  return {
    x: outputIndex * DOMOTICA_HORIZONTAL_COLUMN_WIDTH,
    y:
      -(
        DOMOTICA_HORIZONTAL_FEED_LEAD +
        DOMOTICA_HORIZONTAL_BODY_HEIGHT +
        DOMOTICA_HORIZONTAL_OUTPUT_LEAD
      ) -
      chainIndex * DOMOTICA_HORIZONTAL_CHAIN_STEP,
  }
}

/** Height above the anchor of the highest child centre (or the empty-output stub end) for chains of `chainLength`. */
export function getHorizontalDomoticaUpwardExtent(chainLength: number): number {
  return -getHorizontalDomoticaChildOffset(0, Math.max(0, chainLength - 1)).y
}

/** The vertical reserve in output-row units, matching the vertical module's `extra rows` contract. */
export function getHorizontalDomoticaExtraRows(chainLength: number): number {
  return Math.ceil(getHorizontalDomoticaUpwardExtent(chainLength) / DOMOTICA_OUTPUT_SPACING)
}

/** Longest chain on any output of `module` among its direct children in `endpoints`. */
export function getHorizontalDomoticaLongestChain(
  module: Pick<Endpoint, 'id'>,
  endpoints: readonly Pick<Endpoint, 'domoticaChildProps'>[]
): number {
  const perOutput = new Map<number, number>()
  for (const endpoint of endpoints) {
    const props = endpoint.domoticaChildProps
    if (props?.parentEndpointId !== module.id) continue
    perOutput.set(props.outputIndex, (perOutput.get(props.outputIndex) ?? 0) + 1)
  }
  return Math.max(1, ...perOutput.values())
}
