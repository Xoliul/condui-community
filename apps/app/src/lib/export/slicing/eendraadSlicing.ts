/**
 * Eendraad slicing with clean cuts and fixed scale
 *
 * - Page units are the same x/width rectangles drawn by the trunk debug overlay.
 * - Internal seams clip on those exact left/right edges. Nested child envelopes are
 *   used only when a parent is wider than one slice.
 * - Scale and page crop come from the packed trunk/supply paint, not the empty
 *   panel frame or canvas info block, so a short board can fill A4. Each panel
 *   height-fits independently; every page of that panel shares the same scale.
 * - The first page still starts at the packed bus/box left and the last page
 *   still ends at the packed right, so the main bus is not cropped at the ends.
 * - Adjacent pages render a small overlap and clip back to that core seam.
 */

import type { BottomUpPanelLayout, BottomUpCircuitLayout } from '@/lib/layout/bottomUpLayout'
import type { ExportScene } from '../types'
import { ExportError } from '../types'
import { exportLog } from '../exportLogger'
import { getEendraadSchematicAreaMm, limitEendraadScaleToInfoBlockCollision } from '../pdfPageLayout'
import type { ExportPaperSize } from '../pageSizes'
import { getCircuitBusSectionId } from '@/lib/panel/panelBusSections'
import { getPanelPackedPaintBounds } from '@/lib/layout/trunkPaintedEnvelope'

/** Overlap between adjacent slices in scene pixels is derived from this physical margin. */
const SLICE_OVERLAP_MM = 2

/**
 * Maximum scale (mm per scene pixel) for eendraad export. The height-based scale is capped
 * so the diagram does not appear larger than this; taller diagrams scale down to fit and
 * slicing adjusts (fewer, wider slices). This is the shared one-wire scale ceiling: keep
 * it high enough to fill A4 around the title, QR, and info block after packing
 * to the painted trunks. Height-fit of those trunks is the usual limiter, and
 * the result is then collided against the PDF info-box obstacle.
 */
export const EENDRAAD_MAX_SCALE_MM_PER_PX = 0.36

export interface FrameSlice {
  x: number
  y: number
  width: number
  height: number
  circuitIds: string[]
  /** Overlap in scene px (each side); used to expand render bounds and clip to content. */
  overlapPx?: number
}

export interface EendraadSlicingResult {
  slices: FrameSlice[]
  globalScale: number
  mainBusY: number
}

/** One top-level painted trunk envelope and its nested circuit ownership. */
interface MainBusBlock {
  left: number
  right: number
  circuitIds: string[]
  busSectionId: string
  /** Child circuit extents used for safe internal cut points when the block is oversized. */
  nestedExtents?: Array<{ left: number; right: number }>
}

function getCircuitEnvelope(circuitLayout: BottomUpCircuitLayout): { left: number; right: number } {
  return { left: circuitLayout.x, right: circuitLayout.x + circuitLayout.width }
}

function addEnvelopeSeam(points: number[], left: { right: number }): void {
  points.push(left.right)
}

/**
 * Build safe page units from the same x/width rectangles drawn by the trunk debug overlay.
 * A top-level envelope owns every nested descendant. An inconsistent/legacy layout where a
 * descendant protrudes beyond its parent is conservatively unioned into the parent block.
 */
function getMainBusBlocks(panelLayout: BottomUpPanelLayout): MainBusBlock[] {
  const circuits = panelLayout.circuits
  const blocks: MainBusBlock[] = []
  const childrenByParentId = new Map<string, BottomUpCircuitLayout[]>()
  for (const circuit of circuits) {
    const parentId = circuit.parentCircuit?.id
    if (!parentId) continue
    const children = childrenByParentId.get(parentId) ?? []
    children.push(circuit)
    childrenByParentId.set(parentId, children)
  }

  const collectDescendants = (root: BottomUpCircuitLayout): BottomUpCircuitLayout[] => {
    const descendants: BottomUpCircuitLayout[] = []
    const visit = (parentId: string) => {
      for (const child of childrenByParentId.get(parentId) ?? []) {
        descendants.push(child)
        visit(child.circuit.id)
      }
    }
    visit(root.circuit.id)
    return descendants
  }

  const topLevel = circuits.filter((cl) => cl.parentCircuit === null).sort((a, b) => a.x - b.x)

  for (const cl of topLevel) {
    const descendants = collectDescendants(cl)
    const ownedLayouts = [cl, ...descendants]
    const ownedExtents = ownedLayouts.map(getCircuitEnvelope)
    const left = Math.min(...ownedExtents.map((extent) => extent.left))
    const right = Math.max(...ownedExtents.map((extent) => extent.right))
    const directChildren = childrenByParentId.get(cl.circuit.id) ?? []
    blocks.push({
      left,
      right,
      circuitIds: ownedLayouts.map((layout) => layout.circuit.id),
      busSectionId: getCircuitBusSectionId(
        panelLayout.panel,
        cl.circuit,
        cl.parentRcd ?? cl.protection ?? undefined
      ),
      nestedExtents: directChildren.map(getCircuitEnvelope).sort((a, b) => a.left - b.left),
    })
  }

  return blocks.sort((a, b) => a.left - b.left)
}

/**
 * Cut points: scene left, the right edge of each finished envelope, and scene right.
 * For oversized RCD or parent/sub-circuit blocks, add nested child right edges between
 * adjacent circuits. Outer scene bounds stay available so the first and last pages
 * can keep the bus bar ends.
 */
function getCutPoints(
  blocks: MainBusBlock[],
  sceneBounds: ExportScene['bounds'],
  sliceWidthPx: number
): number[] {
  const points: number[] = [sceneBounds.x]
  const sceneRight = sceneBounds.x + sceneBounds.width

  for (let i = 0; i < blocks.length - 1; i++) {
    addEnvelopeSeam(points, blocks[i]!)
  }
  for (const block of blocks) {
    if (!block.nestedExtents || block.nestedExtents.length < 2) continue
    if (block.right - block.left <= sliceWidthPx) continue
    for (let j = 0; j < block.nestedExtents.length - 1; j++) {
      addEnvelopeSeam(points, block.nestedExtents[j]!)
    }
  }
  points.push(sceneRight)
  return [...new Set(points)].sort((a, b) => a - b)
}

function isBusSectionBoundary(blocks: MainBusBlock[], cutPoint: number): boolean {
  for (let index = 0; index < blocks.length - 1; index++) {
    const left = blocks[index]!
    const right = blocks[index + 1]!
    if (left.busSectionId === right.busSectionId) continue
    if (Math.abs(left.right - cutPoint) < 0.01) return true
  }
  return false
}

function getPackBounds(
  panelLayout: BottomUpPanelLayout,
  sceneBounds: ExportScene['bounds']
): ExportScene['bounds'] {
  const packed = getPanelPackedPaintBounds(panelLayout)
  if (!packed) return sceneBounds
  return {
    x: packed.x,
    y: packed.y,
    width: packed.width,
    height: packed.height,
    space: 'scene',
  }
}

/**
 * Height-fit one panel into the A4 schematic area, capped at the readable
 * maximum and collided against the info-box obstacle. All pages of this panel
 * use the same value; other panels may differ.
 */
export function chooseEendraadPanelScale(
  packHeightPx: number,
  paperSize: ExportPaperSize = 'A4',
  infoBlockNativeWidth?: number
): number {
  // A3 keeps the A4 physical scale so the wider sheet carries more circuits per
  // page instead of enlarging the same content. The A3 sheet is larger in both
  // directions, so the A4 scale always clears its (smaller) info box.
  const heightMm = getEendraadSchematicAreaMm('landscape', 'A4').heightMm
  const heightFit = Math.min(EENDRAAD_MAX_SCALE_MM_PER_PX, heightMm / Math.max(packHeightPx, 1))
  const a4Scale = limitEendraadScaleToInfoBlockCollision(
    packHeightPx,
    heightFit,
    infoBlockNativeWidth
  )
  if (paperSize === 'A4') return a4Scale
  return limitEendraadScaleToInfoBlockCollision(
    packHeightPx,
    a4Scale,
    infoBlockNativeWidth,
    paperSize
  )
}

/** Native width of the panel's laid-out info block (optional columns widen it). */
function getPanelInfoBlockNativeWidth(panelLayout: BottomUpPanelLayout): number | undefined {
  return panelLayout.layoutBlocks?.find((block) => block.kind === 'info-block')?.width
}

interface CoreSlice {
  left: number
  right: number
}

function getSliceWidthPxForScale(scale: number, paperSize: ExportPaperSize = 'A4'): number {
  return getEendraadSchematicAreaMm('landscape', paperSize).widthMm / scale
}

function getSliceOverlapPx(globalScale: number): number {
  return SLICE_OVERLAP_MM / globalScale
}

function getBlocksInRange(blocks: MainBusBlock[], left: number, right: number): MainBusBlock[] {
  return blocks.filter((block) => block.left < right && block.right > left)
}

function buildCoreSlices(
  blocks: MainBusBlock[],
  sceneBounds: ExportScene['bounds'],
  globalScale: number,
  paperSize: ExportPaperSize = 'A4'
): CoreSlice[] {
  const sliceWidthPx = getSliceWidthPxForScale(globalScale, paperSize)
  const cutPoints = getCutPoints(blocks, sceneBounds, sliceWidthPx)
  const sceneRight = sceneBounds.x + sceneBounds.width
  const slices: CoreSlice[] = []
  let startX = sceneBounds.x

  while (startX < sceneRight - 1) {
    const maxEndX = startX + sliceWidthPx
    const candidates = cutPoints.filter((cutPoint) => cutPoint > startX && cutPoint <= maxEndX)
    const furthestEndX = candidates.at(-1) ?? startX
    let bestEndX = furthestEndX

    // A physical bus-section transition is the cleanest place to break a drawing. Prefer
    // the latest such boundary that makes a useful page, but never isolate the first block
    // merely to preserve a section boundary. This keeps e.g. 1 grid + many backup circuits
    // packed naturally while making balanced grid/backup runs land on separate pages.
    const preferredBoundary = candidates
      .filter((cutPoint) => isBusSectionBoundary(blocks, cutPoint))
      .filter((cutPoint) => {
        const pageBlocks = getBlocksInRange(blocks, startX, cutPoint)
        const utilization = (cutPoint - startX) / sliceWidthPx
        return pageBlocks.length >= 2 && utilization >= 0.45
      })
      .at(-1)
    if (preferredBoundary != null) {
      const pagesAfterPreferred = Math.ceil((sceneRight - preferredBoundary) / sliceWidthPx)
      const pagesAfterFurthest = Math.ceil((sceneRight - furthestEndX) / sliceWidthPx)
      if (pagesAfterPreferred <= pagesAfterFurthest) bestEndX = preferredBoundary
    }
    if (bestEndX <= startX) {
      bestEndX = Math.min(startX + sliceWidthPx, sceneRight)
    }
    // A gap between envelopes can be wider than one page. Never emit a blank
    // page for that gap; jump to the next trunk box instead.
    if (getBlocksInRange(blocks, startX, bestEndX).length === 0) {
      const nextBlock = blocks.find((block) => block.left >= startX)
      if (nextBlock && nextBlock.left < sceneRight) {
        startX = nextBlock.left
        continue
      }
      if (slices.length > 0) {
        slices[slices.length - 1]!.right = sceneRight
      }
      break
    }
    slices.push({ left: startX, right: bestEndX })
    startX = bestEndX
  }

  // Greedy packing can put every available block on the penultimate page and
  // leave one tiny block alone. Move the smallest possible safe block group to
  // the tail when both resulting pages still fit and contain at least two
  // independent main-bus blocks. This changes only page cuts, never layout.
  if (slices.length >= 2) {
    const previous = slices[slices.length - 2]!
    const tail = slices[slices.length - 1]!
    const previousBlocks = getBlocksInRange(blocks, previous.left, previous.right)
    const tailBlocks = getBlocksInRange(blocks, tail.left, tail.right)

    if (tailBlocks.length === 1 && previousBlocks.length >= 3) {
      const candidates = cutPoints
        .filter((cutPoint) => cutPoint > previous.left && cutPoint < previous.right)
        .sort((a, b) => b - a)
      for (const cutPoint of candidates) {
        const leftBlocks = getBlocksInRange(blocks, previous.left, cutPoint)
        const rightBlocks = getBlocksInRange(blocks, cutPoint, tail.right)
        if (
          cutPoint - previous.left <= sliceWidthPx &&
          tail.right - cutPoint <= sliceWidthPx &&
          leftBlocks.length >= 2 &&
          rightBlocks.length >= 2
        ) {
          previous.right = cutPoint
          tail.left = cutPoint
          break
        }
      }
    }
  }

  return slices
}

function getSlicingMetrics(
  panelLayout: BottomUpPanelLayout,
  scene: ExportScene,
  globalScale: number,
  paperSize: ExportPaperSize = 'A4'
): { pageCount: number; sparseTail: boolean } {
  const blocks = getMainBusBlocks(panelLayout)
  if (blocks.length === 0) return { pageCount: 1, sparseTail: false }
  const slices = buildCoreSlices(
    blocks,
    getPackBounds(panelLayout, scene.bounds),
    globalScale,
    paperSize
  )
  const tail = slices.at(-1)
  return {
    pageCount: slices.length,
    sparseTail:
      slices.length > 1 && !!tail && getBlocksInRange(blocks, tail.left, tail.right).length <= 2,
  }
}

/**
 * Fast dialog estimate using packed paint bounds. Uses the same per-panel
 * height-fit scale as export slicing so the predicted page count matches the PDF.
 */
export function estimateEendraadPageCount(
  panelLayouts: BottomUpPanelLayout[],
  paperSize: ExportPaperSize = 'A4'
): number {
  return panelLayouts.reduce((count, panelLayout) => {
    if (panelLayout.frameRole === 'supply') return count + 1
    const packed = getPanelPackedPaintBounds(panelLayout)
    const scene = {
      bounds: packed
        ? { ...packed, space: 'scene' as const }
        : {
            x: panelLayout.frame.x,
            y: panelLayout.frame.y,
            width: panelLayout.frame.width,
            height: panelLayout.frame.height,
            space: 'scene' as const,
          },
    } as ExportScene
    const packBounds = getPackBounds(panelLayout, scene.bounds)
    const scale = chooseEendraadPanelScale(
      packBounds.height,
      paperSize,
      getPanelInfoBlockNativeWidth(panelLayout)
    )
    return count + getSlicingMetrics(panelLayout, scene, scale, paperSize).pageCount
  }, 0)
}

export async function calculateEendraadSlices(
  panelLayout: BottomUpPanelLayout,
  scene: ExportScene,
  scaleOverride?: number,
  paperSize: ExportPaperSize = 'A4'
): Promise<EendraadSlicingResult> {
  const sceneBounds = scene.bounds
  if (panelLayout.frameRole === 'supply') {
    const schematicArea = getEendraadSchematicAreaMm('landscape', paperSize)
    const globalScale = limitEendraadScaleToInfoBlockCollision(
      sceneBounds.height,
      Math.min(
        EENDRAAD_MAX_SCALE_MM_PER_PX,
        schematicArea.widthMm / sceneBounds.width,
        schematicArea.heightMm / sceneBounds.height
      ),
      getPanelInfoBlockNativeWidth(panelLayout),
      paperSize
    )
    return {
      slices: [
        {
          x: sceneBounds.x,
          y: sceneBounds.y,
          width: sceneBounds.width,
          height: sceneBounds.height,
          circuitIds: [],
        },
      ],
      globalScale,
      mainBusY: panelLayout.mainBus.y,
    }
  }
  const blocks = getMainBusBlocks(panelLayout)
  const packBounds = getPackBounds(panelLayout, sceneBounds)
  const panelScale = chooseEendraadPanelScale(
    packBounds.height,
    paperSize,
    getPanelInfoBlockNativeWidth(panelLayout)
  )
  const globalScale = Math.min(scaleOverride ?? panelScale, EENDRAAD_MAX_SCALE_MM_PER_PX)
  const mainBusY = panelLayout.mainBus.y
  const sliceWidthPx = getSliceWidthPxForScale(globalScale, paperSize)
  const overlapPx = getSliceOverlapPx(globalScale)

  if (panelScale < EENDRAAD_MAX_SCALE_MM_PER_PX && scaleOverride == null) {
    exportLog(
      `[Export] Eendraad panel scaled to fit height: ${globalScale.toFixed(6)} mm/px ` +
        `(packHeight=${packBounds.height.toFixed(0)}, max=${EENDRAAD_MAX_SCALE_MM_PER_PX})`
    )
  }
  exportLog(
    `[Export] Eendraad slice scale: globalScale=${globalScale.toFixed(6)} mm/px, ` +
      `sliceWidthPx=${sliceWidthPx.toFixed(0)}, packHeight=${packBounds.height.toFixed(0)}, ` +
      `sceneHeight=${sceneBounds.height.toFixed(0)}, ` +
      `source=${scaleOverride != null ? 'override' : 'panel'}`
  )

  if (blocks.length === 0) {
    return {
      slices: [
        {
          x: packBounds.x,
          y: packBounds.y,
          width: packBounds.width,
          height: packBounds.height,
          circuitIds: [],
        },
      ],
      globalScale,
      mainBusY,
    }
  }

  const coreSlices = buildCoreSlices(blocks, packBounds, globalScale, paperSize)
  const slices: FrameSlice[] = []
  const allCircuitIds = new Set(blocks.flatMap((b) => b.circuitIds))

  for (const coreSlice of coreSlices) {
    const circuitIds = blocks
      .filter((b) => b.left < coreSlice.right && b.right > coreSlice.left)
      .flatMap((b) => b.circuitIds)

    slices.push({
      x: coreSlice.left,
      y: packBounds.y,
      width: coreSlice.right - coreSlice.left,
      height: packBounds.height,
      circuitIds,
      overlapPx,
    })
  }

  validateSlices(
    slices,
    Array.from(allCircuitIds).map((id) => {
      const b = blocks.find((bl) => bl.circuitIds.includes(id))!
      return { id, x: b.left, right: b.right }
    })
  )
  exportLog(
    `[Export] Eendraad slice result: scale=${globalScale.toFixed(6)} mm/px (use as reference for minimum scale), slices=${slices.length}`
  )
  return { slices, globalScale, mainBusY }
}

export function validateSlices(
  slices: FrameSlice[],
  circuits: Array<{ id: string; x: number; right: number }>
): void {
  const allCircuitIds = new Set(circuits.map((c) => c.id))
  const slicedCircuitIds = new Set(slices.flatMap((s) => s.circuitIds))
  const missing = Array.from(allCircuitIds).filter((id) => !slicedCircuitIds.has(id))
  if (missing.length > 0) {
    throw new ExportError(
      'SLICE_VALIDATION_FAILED',
      `Missing circuits in slices: ${missing.join(', ')}`
    )
  }
  if (circuits.length > 0) {
    const emptySlices = slices.filter((s) => s.circuitIds.length === 0)
    if (emptySlices.length > 0) {
      throw new ExportError(
        'SLICE_VALIDATION_FAILED',
        `Empty slices detected: ${emptySlices.length}`
      )
    }
  }
}
