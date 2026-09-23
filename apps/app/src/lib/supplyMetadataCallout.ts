import type { Point } from '@/types/ui'
import type { TrunkDevice } from '@/types/schema'
import { getSupplyDeviceMultiplier } from '@/lib/supplyAssembly/inverterMultipliers'
import { getMetadataCalloutGroups } from '@/lib/metadataCalloutGrouping'
import { isVerticalSupplyDevice } from '@/lib/layout/supplyDeviceOrientation'

export interface SupplyMetadataCalloutSegment {
  startPoint: Point
  endPoint: Point
}

export interface SupplyMetadataCalloutPlacement {
  x: number
  y: number
}

export interface SupplyMetadataCalloutRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface SupplyMetadataCalloutGroupItem {
  id: string
  symbolPosition: Point
  width: number
  height: number
  placement?: 'upper-left' | 'top' | 'top-right'
}

export interface SupplyMetadataCalloutGroupPlacement extends SupplyMetadataCalloutGroupItem {
  x: number
  y: number
  rect: SupplyMetadataCalloutRect
}

export type SupplyMetadataCalloutPlacementKind = 'upper-left' | 'top'

export interface SupplyMetadataCalloutCluster {
  ownerConverterId: string
  representativeId: string
  targetIds: string[]
  totalMultiplier: number
}

/**
 * Supply metadata cards belong to the horizontal supply lane. Devices mounted
 * on a DC bus are rendered on vertical branch risers, where their labels must
 * not participate in the horizontal card packing or frame sizing.
 */
export function isSupplyMetadataCalloutDevice(device: TrunkDevice): boolean {
  return (
    !device.supplyDcBusId &&
    (device.symbol === 'inverter' ||
      device.symbol === 'dc_dc_converter' ||
      device.symbol === 'solar_panel' ||
      device.symbol === 'battery')
  )
}

/**
 * Automatic supply cards may be attached to the horizontal rail or to a
 * vertical top-port riser. Ordinary vertical circuit devices and DC-bus
 * branch devices stay with their inline side labels.
 */
export function canRenderSupplyMetadataCallout(
  device: TrunkDevice,
  isHorizontal?: boolean
): boolean {
  return (
    isSupplyMetadataCalloutDevice(device) &&
    (isHorizontal === true || isVerticalSupplyDevice(device))
  )
}

/**
 * Groups identical supply metadata only within one converter-owned topology.
 * Non-metadata devices do not interrupt ownership, so a fuse or junction box
 * between two equal panels still allows them to share one frame.
 */
export function getSupplyMetadataCalloutClusters(
  items: Array<{ device: TrunkDevice; lines: string[] }>
): Map<string, SupplyMetadataCalloutCluster> {
  const ownerByDeviceId = new Map<string, string>()
  let activeConverterId: string | undefined

  for (const { device } of items) {
    if (device.supplyPath === 'converter-branch' || device.supplyPath === 'backup') {
      activeConverterId = device.id
      ownerByDeviceId.set(device.id, device.id)
      continue
    }
    const belongsToActiveConverter =
      device.supplyPath === 'converter-dc' || device.supplyPath === 'converter-dc-top'
    ownerByDeviceId.set(
      device.id,
      belongsToActiveConverter && activeConverterId ? activeConverterId : device.id
    )
  }

  const groups = getMetadataCalloutGroups(
    items.map(({ device, lines }) => ({
      id: device.id,
      ownerId: ownerByDeviceId.get(device.id) ?? device.id,
      symbol: device.symbol ?? '',
      lines,
      multiplier: getSupplyDeviceMultiplier(device),
    }))
  )

  const result = new Map<string, SupplyMetadataCalloutCluster>()
  for (const group of new Set(groups.values())) {
    const representativeId = group.representativeId
    const targetIds = group.targetIds
    const cluster = {
      ownerConverterId: ownerByDeviceId.get(representativeId) ?? representativeId,
      representativeId,
      targetIds,
      totalMultiplier: group.totalMultiplier,
    }
    targetIds.forEach((targetId) => result.set(targetId, cluster))
  }
  return result
}

/**
 * A lone metadata card can sit directly above its device. Inverter cards use
 * the upper-left position only when they are part of a grouped supply row,
 * where that offset leaves room for the other equipment cards.
 */
export function getSupplyMetadataCalloutPlacementKind({
  symbol,
  peerCount,
  stackVertically,
}: {
  symbol?: string
  peerCount: number
  stackVertically?: boolean
}): SupplyMetadataCalloutPlacementKind {
  if (symbol === 'inverter' && peerCount > 1 && !stackVertically) return 'upper-left'
  return 'top'
}

const CALLOUT_WIRE_CLEARANCE = 6

/**
 * Connects a metadata card to the shortest of its three bottom-edge anchors.
 *
 * The canvas renders the returned points relative to the device symbol. Keeping
 * this calculation here makes the leader geometry deterministic for every
 * callout placement, including grouped cards that move left or right.
 */
export function getSupplyMetadataCalloutLeaderPoints({
  placement,
  width,
  height,
  symbolWidth,
  symbolHeight,
  placementKind,
  mirrorHorizontally = false,
  adaptiveAnchors = false,
}: {
  placement: SupplyMetadataCalloutPlacement
  width: number
  height: number
  symbolWidth: number
  symbolHeight: number
  placementKind: SupplyMetadataCalloutPlacementKind
  /** Keep the leader attached to the equivalent symbol port in a mirrored supply layout. */
  mirrorHorizontally?: boolean
  /** Choose the nearest card and symbol edges instead of fixed bottom/top anchors. */
  adaptiveAnchors?: boolean
}): [number, number, number, number] {
  if (adaptiveAnchors) {
    const symbolGap = 0.5
    const cardAnchors = [
      { x: placement.x, y: placement.y },
      { x: placement.x, y: placement.y + height / 2 },
      { x: placement.x, y: placement.y + height },
      { x: placement.x + width / 2, y: placement.y },
      { x: placement.x + width / 2, y: placement.y + height },
      { x: placement.x + width, y: placement.y },
      { x: placement.x + width, y: placement.y + height / 2 },
      { x: placement.x + width, y: placement.y + height },
    ]
    const symbolAnchors = [
      { x: 0, y: -symbolHeight / 2 - symbolGap },
      { x: symbolWidth / 2 + symbolGap, y: 0 },
      { x: 0, y: symbolHeight / 2 + symbolGap },
      { x: -symbolWidth / 2 - symbolGap, y: 0 },
    ]
    let closest = { card: cardAnchors[0]!, symbol: symbolAnchors[0]!, distance: Infinity }
    for (const card of cardAnchors) {
      for (const symbol of symbolAnchors) {
        const distance = (card.x - symbol.x) ** 2 + (card.y - symbol.y) ** 2
        if (distance < closest.distance) closest = { card, symbol, distance }
      }
    }
    return [closest.card.x, closest.card.y, closest.symbol.x, closest.symbol.y]
  }

  const canonicalSymbolAnchor =
    placementKind === 'top'
      ? { x: 0, y: -symbolHeight / 2 - 2 }
      : { x: -symbolWidth / 2 - 2, y: -symbolHeight / 2 - 2 }
  const symbolAnchor = {
    x: mirrorHorizontally ? -canonicalSymbolAnchor.x : canonicalSymbolAnchor.x,
    y: canonicalSymbolAnchor.y,
  }
  const bottom = placement.y + height
  const anchors = [
    { x: placement.x, y: bottom },
    { x: placement.x + width / 2, y: bottom },
    { x: placement.x + width, y: bottom },
  ]
  const closestAnchor = anchors.reduce((closest, anchor) => {
    const distance = (anchor.x - symbolAnchor.x) ** 2 + (anchor.y - symbolAnchor.y) ** 2
    const closestDistance = (closest.x - symbolAnchor.x) ** 2 + (closest.y - symbolAnchor.y) ** 2
    return distance < closestDistance ? anchor : closest
  })

  return [closestAnchor.x, closestAnchor.y, symbolAnchor.x, symbolAnchor.y]
}

/**
 * Fans a shared metadata frame out from one common, nearest edge anchor. This
 * keeps grouped leaders visually calm while each target still receives the
 * line at the closest safe edge of its own symbol.
 */
export function getSupplyMetadataSharedLeaderPointSets({
  placement,
  width,
  height,
  targets,
}: {
  placement: SupplyMetadataCalloutPlacement
  width: number
  height: number
  targets: Array<{ position: Point; width: number; height: number }>
}): Array<[number, number, number, number]> {
  if (targets.length === 0) return []
  const cardAnchors = [
    { x: placement.x + width / 2, y: placement.y + height },
    { x: placement.x, y: placement.y + height / 2 },
    { x: placement.x + width, y: placement.y + height / 2 },
    { x: placement.x + width / 2, y: placement.y },
    { x: placement.x, y: placement.y + height },
    { x: placement.x + width, y: placement.y + height },
    { x: placement.x, y: placement.y },
    { x: placement.x + width, y: placement.y },
  ]
  const targetAnchors = targets.map((target) => [
    { x: target.position.x, y: target.position.y - target.height / 2 - 0.5 },
    { x: target.position.x + target.width / 2 + 0.5, y: target.position.y },
    { x: target.position.x, y: target.position.y + target.height / 2 + 0.5 },
    { x: target.position.x - target.width / 2 - 0.5, y: target.position.y },
  ])
  const score = (card: Point) =>
    targetAnchors.reduce(
      (total, anchors) =>
        total +
        Math.min(...anchors.map((anchor) => (card.x - anchor.x) ** 2 + (card.y - anchor.y) ** 2)),
      0
    )
  const sharedCardAnchor = cardAnchors.reduce((best, candidate) =>
    score(candidate) < score(best) ? candidate : best
  )

  return targetAnchors.map((anchors) => {
    const targetAnchor = anchors.reduce((best, candidate) => {
      const candidateDistance =
        (sharedCardAnchor.x - candidate.x) ** 2 + (sharedCardAnchor.y - candidate.y) ** 2
      const bestDistance = (sharedCardAnchor.x - best.x) ** 2 + (sharedCardAnchor.y - best.y) ** 2
      return candidateDistance < bestDistance ? candidate : best
    })
    return [sharedCardAnchor.x, sharedCardAnchor.y, targetAnchor.x, targetAnchor.y]
  })
}

export function shouldUseSupplyMetadataCallout(lines: string[], multiplier: number): boolean {
  const visualLineCount = lines.reduce(
    (total, line) => total + Math.max(1, line.split(/\r?\n/).length),
    0
  )
  const longestLine = Math.max(
    0,
    ...lines.flatMap((line) => line.split(/\r?\n/)).map((line) => line.length)
  )
  return multiplier > 1 || visualLineCount >= 4 || longestLine >= 18
}

/** Converter specifications need a collision-aware frame even when only a few fields are shown. */
export function shouldUseSupplyDeviceMetadataCallout(
  device: Pick<TrunkDevice, 'type' | 'supplyPath'>,
  lines: string[],
  multiplier: number
): boolean {
  const isSupplyConverter =
    device.type === 'conversion' &&
    (device.supplyPath === 'converter-branch' || device.supplyPath === 'backup')
  return (
    lines.length > 0 && (isSupplyConverter || shouldUseSupplyMetadataCallout(lines, multiplier))
  )
}

function segmentIntersectsRect(
  segment: SupplyMetadataCalloutSegment,
  rect: SupplyMetadataCalloutRect
): boolean {
  const segmentLeft = Math.min(segment.startPoint.x, segment.endPoint.x)
  const segmentRight = Math.max(segment.startPoint.x, segment.endPoint.x)
  const segmentTop = Math.min(segment.startPoint.y, segment.endPoint.y)
  const segmentBottom = Math.max(segment.startPoint.y, segment.endPoint.y)
  return !(
    segmentRight < rect.left ||
    segmentLeft > rect.right ||
    segmentBottom < rect.top ||
    segmentTop > rect.bottom
  )
}

function rectIntersectsRect(a: SupplyMetadataCalloutRect, b: SupplyMetadataCalloutRect): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom)
}

function expandRect(rect: SupplyMetadataCalloutRect, amount: number): SupplyMetadataCalloutRect {
  return {
    left: rect.left - amount,
    top: rect.top - amount,
    right: rect.right + amount,
    bottom: rect.bottom + amount,
  }
}

function getCalloutRect(
  symbolPosition: Point,
  placement: SupplyMetadataCalloutPlacement,
  width: number,
  height: number,
  clearance = 0
): SupplyMetadataCalloutRect {
  return {
    left: symbolPosition.x + placement.x - clearance,
    top: symbolPosition.y + placement.y - clearance,
    right: symbolPosition.x + placement.x + width + clearance,
    bottom: symbolPosition.y + placement.y + height + clearance,
  }
}

/**
 * Places a group of supply metadata cards deterministically.
 *
 * Every card avoids the device symbols in the group, then cards with the same
 * orientation are packed into one centered row. This is deliberately
 * independent of React rendering order, so the canvas and the layout engine
 * can use the same result when sizing the detached supply frame.
 */
export function getSupplyMetadataCalloutGroupPlacements({
  items,
  segments,
  symbolRects = [],
  packRows = true,
  preferRightNudges = false,
  stackVertically = false,
  stackBelowY,
}: {
  items: SupplyMetadataCalloutGroupItem[]
  segments: SupplyMetadataCalloutSegment[]
  /** Other content (including non-card device symbols) that cards must avoid. */
  symbolRects?: SupplyMetadataCalloutRect[]
  /** Supply assemblies use compact rows; staggered converter outputs stay nearer their symbols. */
  packRows?: boolean
  /** For vertically staggered symbols, try the shorter right-side detour first. */
  preferRightNudges?: boolean
  /** Keep supply cards on one preferred side of the bus and stack them vertically. */
  stackVertically?: boolean
  /** Main bus Y coordinate used as the hard lower edge for a vertical card stack. */
  stackBelowY?: number
}): Map<string, SupplyMetadataCalloutGroupPlacement> {
  const placed = new Map<string, SupplyMetadataCalloutGroupPlacement>()
  const basePlacements = items.map((item) => {
    const avoidRects = [
      ...symbolRects,
      ...items
        .filter((peer) => peer.id !== item.id)
        .map((peer) =>
          getCalloutRect(peer.symbolPosition, { x: -15, y: -15 }, 30, 30, CALLOUT_WIRE_CLEARANCE)
        ),
    ]

    const relativePlacement = getSupplyMetadataCalloutPlacement({
      symbolPosition: item.symbolPosition,
      width: item.width,
      height: item.height,
      segments,
      avoidRects,
      placement: item.placement,
      preferRightNudges,
    })
    return {
      item,
      relativePlacement,
      rect: getCalloutRect(item.symbolPosition, relativePlacement, item.width, item.height),
    }
  })

  // Pack cards with the same orientation as one centered group. This avoids
  // the old cascading behaviour where the first card stayed fixed and every
  // later card was pushed farther right. The median card remains centered;
  // outer cards absorb the small movement with a compact, visible gap.
  const CALLOUT_GROUP_GAP = 6
  const CALLOUT_COLLISION_GAP = 8
  const groups = new Map<'upper-left' | 'top' | 'top-right', typeof basePlacements>()
  basePlacements.forEach((entry) => {
    const kind = entry.item.placement ?? 'upper-left'
    const group = groups.get(kind) ?? []
    group.push(entry)
    groups.set(kind, group)
  })

  if (stackVertically && basePlacements.length > 1) {
    // Keep every card on the same side of the bus with a shared left edge.
    const ordered = [...basePlacements].sort(
      (left, right) =>
        right.item.symbolPosition.y - left.item.symbolPosition.y ||
        left.item.symbolPosition.x - right.item.symbolPosition.x ||
        left.item.id.localeCompare(right.item.id)
    )
    if (ordered.length === 1) {
      const [entry] = ordered
      if (entry) {
        placed.set(entry.item.id, {
          ...entry.item,
          x: entry.relativePlacement.x,
          y: entry.relativePlacement.y,
          rect: entry.rect,
        })
      }
    } else if (ordered.length > 1) {
      const stackWidth = Math.max(...ordered.map((entry) => entry.item.width))
      const stackLeft = preferRightNudges
        ? Math.max(...ordered.map((entry) => entry.item.symbolPosition.x)) + 30
        : Math.min(...ordered.map((entry) => entry.item.symbolPosition.x)) - 30 - stackWidth
      const stackGap = CALLOUT_COLLISION_GAP
      const totalHeight =
        ordered.reduce((total, entry) => total + entry.item.height, 0) +
        stackGap * (ordered.length - 1)
      const preferredBottom =
        (stackBelowY ?? Math.min(...ordered.map((entry) => entry.rect.bottom + totalHeight))) -
        CALLOUT_COLLISION_GAP
      let nextTop = preferredBottom - totalHeight

      ordered.forEach((entry) => {
        entry.relativePlacement = {
          x: stackLeft - entry.item.symbolPosition.x,
          y: nextTop - entry.item.symbolPosition.y,
        }
        entry.rect = getCalloutRect(
          entry.item.symbolPosition,
          entry.relativePlacement,
          entry.item.width,
          entry.item.height
        )
        nextTop += entry.item.height + stackGap
        placed.set(entry.item.id, {
          ...entry.item,
          x: entry.relativePlacement.x,
          y: entry.relativePlacement.y,
          rect: entry.rect,
        })
      })
    }
  } else {
    groups.forEach((group) => {
      const ordered = [...group].sort((left, right) => left.rect.left - right.rect.left)
      if (packRows && ordered.length > 1) {
        const centerIndex = Math.floor((ordered.length - 1) / 2)
        const centerLeft = ordered[centerIndex]!.rect.left
        const centerRight = ordered[centerIndex]!.rect.right
        const anchor = (centerLeft + centerRight) / 2
        const totalWidth =
          ordered.reduce((total, entry) => total + entry.item.width, 0) +
          CALLOUT_GROUP_GAP * (ordered.length - 1)
        let nextLeft = anchor - totalWidth / 2
        ordered.forEach((entry) => {
          entry.relativePlacement = {
            x: nextLeft - entry.item.symbolPosition.x,
            y: entry.relativePlacement.y,
          }
          entry.rect = getCalloutRect(
            entry.item.symbolPosition,
            entry.relativePlacement,
            entry.item.width,
            entry.item.height
          )
          nextLeft += entry.item.width + CALLOUT_GROUP_GAP
        })
      }

      ordered.forEach((entry) => {
        const result = {
          ...entry.item,
          x: entry.relativePlacement.x,
          y: entry.relativePlacement.y,
          rect: entry.rect,
        }
        placed.set(entry.item.id, result)
      })
    })
  }

  // A converter/inverter card can use a different orientation from the solar
  // and battery cards. Resolve those cross-group frame collisions last while
  // leaving the centered top-card row intact. Re-check the actual rail and
  // symbol obstacles after packing: packing deliberately changes the initial
  // collision-free placements and used to be able to put a card back over a
  // busbar.
  const allResults = [...placed.values()]
  allResults.forEach((current, index) => {
    let attempts = 0
    while (attempts < 64) {
      const overlappingPrevious = allResults
        .slice(0, index)
        .filter((previous) =>
          packRows
            ? rectIntersectsRect(current.rect, previous.rect)
            : !(
                current.rect.right + CALLOUT_COLLISION_GAP <= previous.rect.left ||
                current.rect.left >= previous.rect.right + CALLOUT_COLLISION_GAP ||
                current.rect.bottom + CALLOUT_COLLISION_GAP <= previous.rect.top ||
                current.rect.top >= previous.rect.bottom + CALLOUT_COLLISION_GAP
              )
        )
      const protectedRect = getCalloutRect(
        current.symbolPosition,
        { x: current.x, y: current.y },
        current.width,
        current.height,
        CALLOUT_WIRE_CLEARANCE
      )
      const overlapsProtectedContent =
        symbolRects.some((symbolRect) => rectIntersectsRect(protectedRect, symbolRect)) ||
        segments.some((segment) => segmentIntersectsRect(segment, protectedRect))

      if (overlappingPrevious.length === 0 && !overlapsProtectedContent) break

      if (overlapsProtectedContent) {
        const repairedPlacement = getSupplyMetadataCalloutPlacement({
          symbolPosition: current.symbolPosition,
          width: current.width,
          height: current.height,
          segments,
          placement: current.placement,
          preferRightNudges,
          avoidRects: [
            ...symbolRects,
            ...allResults
              .slice(0, index)
              .map((previous) => expandRect(previous.rect, CALLOUT_COLLISION_GAP)),
          ],
        })
        const repairedRect = getCalloutRect(
          current.symbolPosition,
          repairedPlacement,
          current.width,
          current.height
        )
        const didMove = repairedPlacement.x !== current.x || repairedPlacement.y !== current.y
        current.x = repairedPlacement.x
        current.y = repairedPlacement.y
        current.rect = repairedRect

        // The candidate grid is intentionally bounded. If every candidate is
        // occupied, move beyond the rightmost finite obstacle so the card can
        // never silently remain on top of a rail or symbol.
        if (!didMove) {
          const rightmostObstacle = Math.max(
            current.symbolPosition.x,
            ...symbolRects.map((rect) => rect.right),
            ...segments.flatMap((segment) => [segment.startPoint.x, segment.endPoint.x]),
            ...allResults.slice(0, index).map((previous) => previous.rect.right)
          )
          current.x = rightmostObstacle + CALLOUT_COLLISION_GAP - current.symbolPosition.x
          current.rect = getCalloutRect(
            current.symbolPosition,
            { x: current.x, y: current.y },
            current.width,
            current.height
          )
        }
      } else {
        current.x += packRows
          ? current.width + CALLOUT_GROUP_GAP
          : Math.max(...overlappingPrevious.map((previous) => previous.rect.right)) -
            current.rect.left +
            CALLOUT_COLLISION_GAP
        current.rect = getCalloutRect(
          current.symbolPosition,
          { x: current.x, y: current.y },
          current.width,
          current.height
        )
      }
      attempts += 1
    }
  })

  // Final invariant: cards from different placement groups must still be
  // separated after all per-card repairs. Sort by the current rendered edge and
  // push later cards right when their vertical bands overlap. This pass is
  // intentionally independent of the candidate grid so a late mirror or a
  // differing orientation can never reintroduce a card-on-card intersection.
  const orderedResults = [...allResults].sort((left, right) => left.rect.left - right.rect.left)
  for (let pass = 0; pass < orderedResults.length; pass += 1) {
    let moved = false
    for (let currentIndex = 1; currentIndex < orderedResults.length; currentIndex += 1) {
      const current = orderedResults[currentIndex]!
      for (let previousIndex = 0; previousIndex < currentIndex; previousIndex += 1) {
        const previous = orderedResults[previousIndex]!
        const separationGap =
          current.placement === previous.placement ? CALLOUT_GROUP_GAP : CALLOUT_COLLISION_GAP
        const verticalBandsOverlap = !(
          current.rect.bottom + separationGap <= previous.rect.top ||
          current.rect.top >= previous.rect.bottom + separationGap
        )
        if (!verticalBandsOverlap) continue

        const requiredLeft = previous.rect.right + separationGap
        if (current.rect.left >= requiredLeft) continue

        current.x += requiredLeft - current.rect.left
        current.rect = getCalloutRect(
          current.symbolPosition,
          { x: current.x, y: current.y },
          current.width,
          current.height
        )
        moved = true
      }
    }
    if (!moved) break
  }

  return placed
}

/** Preferred upper-left callout placement with small deterministic collision nudges. */
export function getSupplyMetadataCalloutPlacement({
  symbolPosition,
  width,
  height,
  segments,
  avoidRects = [],
  placement = 'upper-left',
  preferRightNudges = false,
}: {
  symbolPosition: Point
  width: number
  height: number
  segments: SupplyMetadataCalloutSegment[]
  /** Existing device labels/callouts that this card must not cover. */
  avoidRects?: SupplyMetadataCalloutRect[]
  placement?: 'upper-left' | 'top' | 'top-right'
  preferRightNudges?: boolean
}): SupplyMetadataCalloutPlacement {
  const preferred =
    placement === 'top'
      ? { x: -width / 2, y: -height - 28 }
      : placement === 'top-right'
        ? { x: 18, y: -height - 28 }
        : // Sit clearly above the phase/domain labels around the inverter while keeping
          // the callout close enough that its leader remains short and unambiguous.
          // Keep the same 28px symbol-to-card gap as the centered top placement so
          // grouped cards stay inside the supply frame when there is room below.
          { x: -width - 30, y: -height - 28 }
  const preferredCandidates =
    placement === 'top'
      ? [
          preferred,
          ...(preferRightNudges
            ? [
                // Branch converter cards usually only need to clear a trunk
                // by a few pixels. Try compact right-side steps first so a
                // collision does not jump an entire card width into the next
                // circuit column.
                ...Array.from({ length: Math.ceil((width + 12) / 12) }, (_, index) => ({
                  x: preferred.x + (index + 1) * 12,
                  y: preferred.y,
                })),
                ...Array.from({ length: Math.ceil((width + 12) / 12) }, (_, index) => ({
                  x: preferred.x - (index + 1) * 12,
                  y: preferred.y,
                })),
              ]
            : [
                // Supply rows traditionally expand toward their source side first.
                { x: preferred.x - width - 12, y: preferred.y },
                { x: preferred.x + width + 12, y: preferred.y },
                { x: preferred.x + 24, y: preferred.y },
                { x: preferred.x - 24, y: preferred.y },
              ]),
          { x: preferred.x, y: preferred.y - 20 },
        ]
      : placement === 'top-right'
        ? [
            preferred,
            { x: preferred.x + width + 12, y: preferred.y },
            { x: preferred.x - width - 12, y: preferred.y },
            { x: preferred.x + 20, y: preferred.y - 20 },
            { x: preferred.x, y: preferred.y - 40 },
          ]
        : [
            preferred,
            { x: preferred.x, y: preferred.y - 40 },
            { x: preferred.x + 20, y: preferred.y - 20 },
            { x: preferred.x - 28, y: preferred.y - 20 },
            { x: preferred.x - 56, y: preferred.y },
          ]

  // The named candidates preserve the established compact placements. If all
  // of those are occupied, expand into a small deterministic grid rather than
  // falling back to a position that can still overlap another frame.
  const gridXOffsets = [0, -(width + 12), width + 12, -2 * (width + 12), 2 * (width + 12)]
  const gridYOffsets = [0, -(height + 20), height + 20, -2 * (height + 20), 2 * (height + 20)]
  const gridBaseX =
    placement === 'top' ? -width / 2 : placement === 'top-right' ? 18 : -width - 30
  const gridBaseY = placement === 'upper-left' ? -height - 40 : -height - 28
  const candidates = [
    ...preferredCandidates,
    ...gridYOffsets.flatMap((yOffset) =>
      gridXOffsets.map((xOffset) => ({
        x: gridBaseX + xOffset,
        y: gridBaseY + yOffset,
      }))
    ),
  ]

  return (
    candidates.find((candidate) => {
      const rect = getCalloutRect(symbolPosition, candidate, width, height, CALLOUT_WIRE_CLEARANCE)
      return (
        !segments.some((segment) => segmentIntersectsRect(segment, rect)) &&
        !avoidRects.some((avoidRect) => rectIntersectsRect(rect, avoidRect))
      )
    }) ?? candidates[candidates.length - 1]!
  )
}
