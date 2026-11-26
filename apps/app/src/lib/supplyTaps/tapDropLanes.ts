import { Immer } from 'immer'
import {
  calculateSupplyFrameLayout,
  getPanelDiagramId,
  type BottomUpLayoutResult,
  type BottomUpPanelLayout,
} from '@/lib/layout/bottomUpLayout'
import { getSupplyTapLaneZone, type SupplyTapLane, type SupplyTapSlot } from '@/lib/layout/supplyTapDropTargets'
import { getCachedLayoutTree } from '@/lib/layout/eendraadDerivedLayout'
import { getHitZoneBounds, type HitBounds } from '@/lib/layout/findDropTarget'
import type { LayoutNode } from '@/lib/layout/layoutTree'
import type { ProjectV2 } from '@/types/projectV2'
import type { SupplyTapAnchor } from '@/types/supplySources'
import { createSupplyTapInProject, findSupplyTapOwner } from './createSupplyTap'
import { getGridSideTapDevices, type SupplyTapLeg } from './legs'
import { getSupplyTapUpstreamDevices } from './upstreamTrunkDevices'
import { getEffectiveSupplyTapOrders } from './tapOrder'
import { getSupplyTapsPanel } from './virtualPanel'

const sameTapAnchor = (left: SupplyTapAnchor, right: SupplyTapAnchor) =>
  left.leg === right.leg && left.afterTrunkDeviceId === right.afterTrunkDeviceId

const LEGS: readonly SupplyTapLeg[] = ['grid-run', 'changeover-grid', 'converter-input']
/** Free movement reaches this far past the outermost slot or own device of a lane. */
const LANE_OVERHANG = 24
/** A tap at the open end of a row stays this close to its only neighbour. */
const OPEN_END_REACH = 40
/** Slots closer than this are the same spot on the wire. */
const SAME_SPOT = 2

interface Mark {
  key: string
  x: number
  y: number
  shared?: boolean
}

const sameRow = (left: number, right: number) => Math.abs(left - right) < 1

/** Hit-zone half-width of a supply wire (`pad` in layoutTreeMainBus.ts). */
const WIRE_PAD = 10

/**
 * Fixed points on the supply wires of a frame: devices, existing taps and every riser leaving a
 * horizontal wire. Risers come from the wire hit zones, which follow the drawn wires; the layout's
 * own changeover elbow can sit elsewhere when labels widen it.
 */
function marks(layout: BottomUpLayoutResult, panel: BottomUpPanelLayout): Mark[] {
  const list: Mark[] = [{ key: 'supply', ...panel.supply }]
  for (const entry of panel.supplyDevices ?? [])
    list.push({ key: `device:${entry.device.id}`, x: entry.x, y: entry.y, shared: entry.feedScope === 'shared' })
  const cb = panel.supplyConverterBranch
  if (cb) list.push({ key: 'converter-t', x: cb.x, y: cb.lineY })
  for (const tap of panel.supplyTaps ?? []) list.push({ key: `tap:${tap.id}`, x: tap.x, y: tap.laneY })
  const diagramId = getPanelDiagramId(panel)
  const visit = (node: LayoutNode) => {
    const { bounds } = node
    if (node.type === 'wire' && node.hitZone?.type?.startsWith('supply') && bounds.height > bounds.width) {
      const x = bounds.x + bounds.width / 2
      list.push({ key: `riser-top:${node.id}`, x, y: bounds.y + WIRE_PAD })
      list.push({ key: `riser-bottom:${node.id}`, x, y: bounds.y + bounds.height - WIRE_PAD })
    }
    node.children.forEach(visit)
  }
  for (const node of getCachedLayoutTree(layout).panels)
    if ((node as LayoutNode & { diagramId?: string }).diagramId === diagramId) visit(node)
  return list
}

function supplyFrames(layout: BottomUpLayoutResult) {
  return layout.panels.filter((panel) => panel.frameRole === 'supply')
}

/** Lays out a simulated project; only the owner's supply frame is read. */
export type SupplyTapLayoutFn = (project: ProjectV2, ownerPanelId: string) => BottomUpLayoutResult

// Not the canvas's cached layout: that cache remembers the latest layout per project id, and a
// simulated copy shares the id. Only the order of marks on a row is read, which overrides keep.
const supplyFrameLayout: SupplyTapLayoutFn = calculateSupplyFrameLayout

// A simulation must not freeze the caller's objects.
const simulation = new Immer({ autoFreeze: false })

/**
 * Where the layout draws a tap with `anchor`, carried over to the current layout: the new tap
 * sits between two fixed marks on its row in a layout that contains it (placing a tap widens
 * that gap), so it keeps the same share of that gap here.
 */
function locateSlot(
  project: ProjectV2,
  ownerPanelId: string,
  anchor: SupplyTapAnchor,
  currentLayout: BottomUpLayoutResult,
  current: BottomUpPanelLayout,
  layoutFor: SupplyTapLayoutFn
): { x: number; y: number } | null {
  let id = 0
  let created = false
  // Shares every untouched branch with the real project, like a command draft.
  const draft = simulation.produce(project, (next) => {
    created = createSupplyTapInProject(
      next,
      { ownerPanelId, anchor, symbolId: 'mcb' },
      { newId: () => `__tap_slot_${++id}` }
    ).ok
  })
  if (!created) return null
  const diagramId = getPanelDiagramId(current)
  const simulatedLayout = layoutFor(draft, ownerPanelId)
  const simulated = supplyFrames(simulatedLayout).find(
    (panel) => getPanelDiagramId(panel) === diagramId
  )
  if (!simulated) return null
  const before = new Set((current.supplyTaps ?? []).map((tap) => tap.id))
  const placed = (simulated.supplyTaps ?? []).find((tap) => !before.has(tap.id))
  if (!placed) return null
  const known = new Map(marks(currentLayout, current).map((mark) => [mark.key, mark]))
  let below: [Mark, Mark] | null = null
  let above: [Mark, Mark] | null = null
  for (const mark of marks(simulatedLayout, simulated)) {
    const here = known.get(mark.key)
    if (!here || !sameRow(mark.y, placed.laneY)) continue
    if (mark.x <= placed.x && (!below || mark.x > below[0].x)) below = [mark, here]
    if (mark.x > placed.x && (!above || mark.x < above[0].x)) above = [mark, here]
  }
  if (below && above && sameRow(below[1].y, above[1].y)) {
    const share = (placed.x - below[0].x) / (above[0].x - below[0].x)
    return { x: below[1].x + share * (above[1].x - below[1].x), y: below[1].y }
  }
  // At the open end of a row, keep the distance to the only neighbour.
  const only = below ?? above
  if (!only) return null
  const offset = Math.sign(placed.x - only[0].x) * Math.min(Math.abs(placed.x - only[0].x), OPEN_END_REACH)
  return { x: only[1].x + offset, y: only[1].y }
}

/** Padded hit boxes of every drop target drawn in one diagram. */
function frameHitBoxes(layout: BottomUpLayoutResult, diagramId: string): HitBounds[] {
  const boxes: HitBounds[] = []
  const visit = (node: LayoutNode) => {
    if (node.hitZone?.type) boxes.push(getHitZoneBounds(node, 'padded'))
    node.children.forEach(visit)
  }
  for (const panel of getCachedLayoutTree(layout).panels)
    if ((panel as LayoutNode & { diagramId?: string }).diagramId === diagramId) visit(panel)
  return boxes
}

/**
 * Narrows a lane so its tap zone overlaps no other drop target: a drop on the wire, a device or a
 * riser is never a tap. Each box in the way trims the side of the zone it sits on.
 */
function clearOfHitBoxes(lane: SupplyTapLane, boxes: readonly HitBounds[]): SupplyTapLane | null {
  const zone = getSupplyTapLaneZone(lane)
  const centre = lane.slots.reduce((sum, slot) => sum + slot.x, 0) / lane.slots.length
  let { left, right } = lane
  for (const box of boxes) {
    if (box.top >= zone.bottom || box.bottom <= zone.top || box.right <= left || box.left >= right) continue
    if ((box.left + box.right) / 2 <= centre) left = Math.max(left, box.right)
    else right = Math.min(right, box.left)
  }
  return right > left ? { ...lane, left, right } : null
}

/**
 * The horizontal grid wire stretches of every supply frame a tap can be dropped above, with the
 * spots the layout would draw a tap at. Lanes never reach into the grid operator's cabinet (up to
 * the last shared supply device, or halfway to the first own device when there is none).
 * Yields after every simulated tap, so idle-time work can stop between them.
 */
function* buildSupplyTapDropLanes(
  project: ProjectV2,
  layout: BottomUpLayoutResult,
  layoutFor: SupplyTapLayoutFn
): Generator<undefined, SupplyTapLane[]> {
  const lanes: SupplyTapLane[] = []
  for (const frame of supplyFrames(layout)) {
    const ownerPanelId = frame.ownerPanelId ?? frame.panel.id
    const owner = findSupplyTapOwner(project, ownerPanelId)
    if (!owner) continue
    const diagramId = getPanelDiagramId(frame)
    const dir = Math.sign((frame.supplyBend?.x ?? frame.supply.x) - frame.supply.x) || 1
    const along = (x: number) => (x - frame.supply.x) * dir
    const frameMarks = marks(layout, frame)
    const board = getSupplyTapsPanel(owner.panel)
    const orders = getEffectiveSupplyTapOrders(
      board
        ? [...board.protections, ...board.circuits].flatMap((item) =>
            item.supplyTap ? [{ id: item.id, anchor: item.supplyTap }] : []
          )
        : []
    )
    let boxes: HitBounds[] | null = null
    const hitBoxes = () => (boxes ??= frameHitBoxes(layout, diagramId))
    const rows = new Map<number, SupplyTapSlot[]>()
    for (const leg of LEGS) {
      const anchors: SupplyTapAnchor[] = [
        { leg },
        ...getGridSideTapDevices(owner.devices, leg).map((device) => ({ leg, afterTrunkDeviceId: device.id })),
      ]
      for (const anchor of anchors) {
        const spot = locateSlot(project, ownerPanelId, anchor, layout, frame, layoutFor)
        yield
        if (!spot) continue
        // A rail without a drawn wire (a changeover riser switch with no grid bus) has no hit zone.
        if (!hitBoxes().some((box) => spot.x >= box.left && spot.x <= box.right && spot.y >= box.top && spot.y <= box.bottom)) continue
        // Offer only spots drawn where the tap is electrically: the installation's own devices
        // drawn before the spot on its wire are exactly the tap's upstream chain.
        const at = along(spot.x)
        const upstream = new Set(getSupplyTapUpstreamDevices([], owner.devices, anchor).map((device) => device.id))
        // A device of the chain on a riser is never upstream of a spot on the horizontal wire.
        const consistent = frameMarks.every((mark) => {
          if (!mark.key.startsWith('device:') || mark.shared) return true
          const inChain = upstream.has(mark.key.slice('device:'.length))
          if (!sameRow(mark.y, spot.y)) return !inChain
          return (along(mark.x) < at) === inChain
        })
        if (!consistent) continue
        const row = [...rows.keys()].find((y) => sameRow(y, spot.y)) ?? spot.y
        const slots = rows.get(row) ?? []
        if (slots.some((slot) => Math.abs(slot.x - spot.x) < SAME_SPOT)) continue
        slots.push({ id: `${diagramId}/supply-tap/${leg}/${anchor.afterTrunkDeviceId ?? 'start'}`, anchor, x: spot.x })
        rows.set(row, slots)
      }
    }
    for (const [y, slots] of rows) {
      const onRow = frameMarks.filter((mark) => sameRow(mark.y, y))
      const lastShared = Math.max(-Infinity, ...onRow.filter((mark) => mark.shared).map((mark) => along(mark.x)))
      const own = onRow
        .filter((mark) => !mark.shared && mark.key !== 'supply' && along(mark.x) > lastShared)
        .map((mark) => along(mark.x))
      const firstOwn = own.length ? Math.min(...own) : Math.min(...slots.map((slot) => along(slot.x)))
      // The cabinet ends at its last shared device; without one, the boundary sits halfway.
      const start = Number.isFinite(lastShared) ? firstOwn : firstOwn / 2
      const usable = slots.filter((slot) => along(slot.x) > start)
      if (!usable.length) continue
      const end = Math.max(...own, ...usable.map((slot) => along(slot.x))) + LANE_OVERHANG
      // The preview roams one stretch between two devices or junctions and locks inside it, so a
      // drop never jumps across a device. Existing taps do not split a stretch.
      const stops = [
        ...new Set([
          start,
          ...onRow
            .filter((mark) => !mark.shared && mark.key !== 'supply' && !mark.key.startsWith('tap:'))
            .map((mark) => along(mark.x))
            .filter((at) => at > start && at < end),
          end,
        ]),
      ].sort((left, right) => left - right)
      for (let index = 0; index + 1 < stops.length; index++) {
        const from = stops[index]!
        const to = stops[index + 1]!
        const inside = usable.filter((slot) => along(slot.x) > from && along(slot.x) < to)
        if (!inside.length) continue
        // Taps already in the stretch split it: one zone before, between and after them, each
        // inserting a tap at that position among the taps of the same anchor.
        const anchor = inside[0]!.anchor
        const placed = (frame.supplyTaps ?? [])
          .filter((tap) => sameRow(tap.laneY, y) && along(tap.x) > from && along(tap.x) < to)
          .sort((left, right) => along(left.x) - along(right.x))
        const pieces: Array<{ from: number; to: number; slots: SupplyTapSlot[] }> = []
        if (!placed.length) pieces.push({ from, to, slots: inside })
        else {
          const sameAnchor = placed.filter((tap) => sameTapAnchor(tap.anchor, anchor))
          const orderOf = (id: string) => orders.get(id) ?? 0
          const edges = [from, ...placed.map((tap) => along(tap.x)), to]
          for (let piece = 0; piece + 1 < edges.length; piece++) {
            const low = edges[piece]!
            const high = edges[piece + 1]!
            const before = sameAnchor.filter((tap) => along(tap.x) <= low).at(-1)
            const after = sameAnchor.find((tap) => along(tap.x) >= high)
            const order = before && after ? (orderOf(before.id) + orderOf(after.id)) / 2
              : before ? orderOf(before.id) + 1
                : after ? orderOf(after.id) - 1
                  : undefined
            pieces.push({
              from: low,
              to: high,
              slots: [{
                id: `${inside[0]!.id}/${piece}`,
                anchor: order === undefined ? anchor : { ...anchor, order },
                x: frame.supply.x + ((low + high) / 2) * dir,
              }],
            })
          }
        }
        for (const piece of pieces) {
          const a = frame.supply.x + piece.from * dir
          const b = frame.supply.x + piece.to * dir
          const lane = clearOfHitBoxes(
            { diagramId, ownerPanelId, y, left: Math.min(a, b), right: Math.max(a, b), slots: piece.slots },
            hitBoxes()
          )
          if (lane) lanes.push(lane)
        }
      }
    }
  }
  return lanes
}

interface LaneJob {
  project: ProjectV2
  steps: Generator<undefined, SupplyTapLane[]>
  lanes?: SupplyTapLane[]
}

const jobs = new WeakMap<BottomUpLayoutResult, LaneJob>()

/** Simulates at most one more tap; returns the lanes once every spot is known. */
export function stepSupplyTapDropLanes(
  project: ProjectV2,
  layout: BottomUpLayoutResult,
  layoutFor: SupplyTapLayoutFn = supplyFrameLayout
): SupplyTapLane[] | null {
  let job = jobs.get(layout)
  if (job?.project !== project) {
    job = { project, steps: buildSupplyTapDropLanes(project, layout, layoutFor) }
    jobs.set(layout, job)
  }
  if (job.lanes) return job.lanes
  const startedAt = import.meta.env?.VITE_E2E ? performance.now() : 0
  try {
    const next = job.steps.next()
    if (next.done) job.lanes = next.value
  } catch (error) {
    // A generator that threw is spent; start over on the next request.
    jobs.delete(layout)
    throw error
  }
  if (import.meta.env?.VITE_E2E) {
    performance.measure('eendra:supply-tap-lanes', { start: startedAt, end: performance.now() })
  }
  return job.lanes ?? null
}

/** All lanes at once, finishing whatever idle-time steps have not done yet. */
export function getSupplyTapDropLanes(
  project: ProjectV2,
  layout: BottomUpLayoutResult,
  layoutFor: SupplyTapLayoutFn = supplyFrameLayout
): SupplyTapLane[] {
  let lanes: SupplyTapLane[] | null = null
  while (!lanes) lanes = stepSupplyTapDropLanes(project, layout, layoutFor)
  return lanes
}
