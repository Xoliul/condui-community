import { logger } from '@/lib/logger'
/**
 * Eendraad scene provider
 * Prepares isolated eendraad scene for export (with slicing support)
 */

import Konva from 'konva'
import type { ExportScene, ExportOptions, EendraadSliceExportMeta } from '../types'
import { ExportError } from '../types'
import { findContentLayer, findCanvasContentGroup, calculateSceneBounds } from './helpers'
import { collectAndRemoveSymbolImagesForExport } from '../symbolSvgInject'
import { adjustSymbolImagesForExport } from './symbolImageExport'
import {
  applyExportThemeToKonvaNodes,
  applyLightEendraadWireExportColors,
} from '../konvaThemeExport'
import { useCanvasRegistryStore } from '@/stores/canvasRegistryStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import type { BottomUpPanelLayout } from '@/lib/layout/bottomUpLayout'
import type { InstallDateOverlayProject } from '@/components/canvas/eendraad/InstallDateOverlay'
import { createInstallDateExportNode } from '../installDateExport'
import type { FrameSlice } from '../slicing/eendraadSlicing'
import { exportLog } from '../exportLogger'
import { stripInteractiveOverlaysForExport } from '../interactiveOverlayExport'

const EXPORT_STRIP_LABEL_NAME = 'export-strip-label'

function collectNodesByName(node: Konva.Node, name: string, out: Konva.Node[]): void {
  if (node.name() === name) out.push(node)
  const children = (node as Konva.Container).getChildren?.()
  if (children?.length) {
    for (const child of children) collectNodesByName(child, name, out)
  }
}

/**
 * Remove labels owned by the dedicated PDF overlay pass. Supply-trunk device
 * notes deliberately remain in the cloned scene so their Konva rotation and
 * centering are preserved in both vector and limited raster PDF exports.
 */
export function stripEendraadOverlayLabelsForExport(root: Konva.Container): void {
  const labelNodes: Konva.Node[] = []
  collectNodesByName(root, EXPORT_STRIP_LABEL_NAME, labelNodes)
  labelNodes.forEach((node) => node.remove())
}

/**
 * Prepare isolated eendraad scene for export
 *
 * @param panelId Panel ID
 * @param sliceIndex Slice index (for multi-page exports)
 * @param slice Optional slice bounds (if provided, exports only that slice)
 * @param options Export options
 * @param eendraadSliceMeta When provided (for slice exports), fixed scale and main-bus Y for alignment
 * @param installDateSource Project and panel layout used to draw install dates when requested
 * @returns Isolated export scene
 */
export async function prepareEendraadScene(
  panelId: string,
  sliceIndex: number,
  slice: FrameSlice | null,
  options: ExportOptions,
  eendraadSliceMeta?: EendraadSliceExportMeta,
  installDateSource?: { project: InstallDateOverlayProject; panelLayout: BottomUpPanelLayout }
): Promise<ExportScene> {
  const sourceTheme = useSettingsStore.getState().theme.mode
  const targetTheme = options.theme

  // 1. Get stage from registry
  const canvasRegistry = useCanvasRegistryStore.getState().registry
  let stage = canvasRegistry.eendraad?.getStage()

  // Retry a few times if stage is not immediately available
  if (!stage) {
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
      stage = canvasRegistry.eendraad?.getStage()
      if (stage) break
    }
  }

  if (!stage) {
    throw new ExportError('STAGE_UNAVAILABLE', 'Eendraad stage not available after retries')
  }

  exportLog(`[Export] Got eendraad stage, layers: ${stage.getLayers().length}`)

  // 2. Find canvas-content Group explicitly
  const contentLayer = findContentLayer(stage)

  // Search children of content layer for canvas-content group
  const children = contentLayer.getChildren()
  let canvasContentGroup: Konva.Group | null = null

  for (const child of children) {
    canvasContentGroup = findCanvasContentGroup(child)
    if (canvasContentGroup) break
  }

  if (!canvasContentGroup) {
    // Log all children of content layer for debugging
    logger.error(
      `[Export] canvas-content group not found. Content layer has ${children.length} children:`
    )
    children.forEach((child, idx) => {
      logger.error(`[Export]   Child ${idx}: type=${child.getType()}, name=${child.name()}`)
    })
    throw new ExportError('NO_CONTENT', `Eendraad panel ${panelId} has no canvas-content group`)
  }

  exportLog(`[Export] Found canvas-content group for eendraad panel ${panelId}`)

  // 3. Find the specific panel's group within canvas-content by name
  const findPanelGroupByName = (node: Konva.Node, targetName: string): Konva.Group | null => {
    if (node.getType() === 'Group') {
      const group = node as Konva.Group
      if (group.name() === targetName) {
        return group
      }
      // Check children recursively
      const children = group.getChildren()
      for (const child of children) {
        const found = findPanelGroupByName(child, targetName)
        if (found) return found
      }
    }
    return null
  }

  // Find the panel group by explicit name
  const panelGroupName = `panel-group-${panelId}`
  const panelGroup = findPanelGroupByName(canvasContentGroup, panelGroupName)

  if (!panelGroup) {
    throw new ExportError(
      'NO_CONTENT',
      `Eendraad panel ${panelId} group not found (looking for name: ${panelGroupName})`
    )
  }

  // 4. Clone into isolated temporary stage
  const tempStage = new Konva.Stage({
    container: document.createElement('div'),
    width: stage.width(),
    height: stage.height(),
  })

  const tempLayer = new Konva.Layer()
  tempStage.add(tempLayer)

  // Clone panel group (deep clone, no live references)
  const clonedGroup = panelGroup.clone({
    // Clone all children recursively
    deep: true,
  })
  clonedGroup.find('.install-date-overlay').forEach((node) => node.destroy())
  if (options.includeInstallDates && installDateSource) {
    const installDates = createInstallDateExportNode(
      installDateSource.project,
      installDateSource.panelLayout,
      useUIStore.getState().eendraadDateMarkingVisibility.installDatesMonochrome
    )
    if (installDates) clonedGroup.add(installDates)
  }

  // Remove the info block from the clone; it will be added per-page in PDF composition
  const INFO_BLOCK_EXPORT_NAME = 'export-info-block'
  const findAndRemoveInfoBlock = (node: Konva.Node): boolean => {
    if (node.getType() === 'Group' && node.name() === INFO_BLOCK_EXPORT_NAME) {
      node.remove()
      return true
    }
    const children = (node as Konva.Container).getChildren?.()
    if (children?.length) {
      for (let i = children.length - 1; i >= 0; i--) {
        if (findAndRemoveInfoBlock(children[i]!)) return true
      }
    }
    return false
  }
  findAndRemoveInfoBlock(clonedGroup)

  // Remove frame elements (border, title, hover/selection) so they are not in the PDF; panel title is added per-page.
  const EXPORT_STRIP_FRAME_NAME = 'export-strip-frame'
  const frameNodes: Konva.Node[] = []
  collectNodesByName(clonedGroup, EXPORT_STRIP_FRAME_NAME, frameNodes)
  frameNodes.forEach((n) => n.remove())

  // Hover/selection state can be held locally by canvas components and may still be
  // present when this clone is taken. It is never part of the exported diagram.
  stripInteractiveOverlaysForExport(clonedGroup)

  // Reset transforms to identity (scene space is canvas-content space).
  clonedGroup.x(0)
  clonedGroup.y(0)
  clonedGroup.scaleX(1)
  clonedGroup.scaleY(1)
  clonedGroup.rotation(0)

  // Capture the full scene envelope before removing overlay-owned labels. The PDF pass redraws
  // those labels later, but their painted bounds must still participate in the scene viewport;
  // otherwise a note at an edge is outside the SVG viewBox and is clipped before it can render.
  tempLayer.add(clonedGroup)
  tempStage.draw()
  const fullSceneBounds = calculateSceneBounds(clonedGroup, {
    x: 0,
    y: 0,
    width: tempStage.width(),
    height: tempStage.height(),
    space: 'scene',
  })

  // Remove circuit/endpoint/notes labels that are wrapped in export-strip-label groups.
  // These are redrawn in the PDF overlay pass; all other text remains in the SVG.
  stripEendraadOverlayLabelsForExport(clonedGroup)

  const symbolExports = collectAndRemoveSymbolImagesForExport(clonedGroup)

  await adjustSymbolImagesForExport(clonedGroup, sourceTheme, targetTheme)
  // Apply export theme to Konva nodes so the clone renders in target theme
  // without switching the UI; SVG then needs no theme post-processing.
  applyExportThemeToKonvaNodes(clonedGroup, sourceTheme, targetTheme)
  if (targetTheme === 'light') {
    applyLightEendraadWireExportColors(clonedGroup)
  }

  tempStage.draw()

  // 4. Calculate bounds - use slice bounds if provided, otherwise use full scene
  let bounds: ReturnType<typeof calculateSceneBounds>

  if (slice) {
    // Use slice bounds
    bounds = {
      x: slice.x,
      y: slice.y,
      width: slice.width,
      height: slice.height,
      space: 'scene',
    }
  } else {
    // Use the pre-strip bounds so overlay-owned notes/labels remain inside the viewport.
    bounds = fullSceneBounds
  }

  // 5. Return isolated scene
  return {
    id: `eendraad-${panelId}-slice-${sliceIndex}`,
    kind: 'eendraad',
    renderedTheme: targetTheme,
    rootNode: clonedGroup, // Isolated clone, safe to export
    bounds,
    preferredOrientation: 'landscape',
    metadata: slice ? { circuitIds: slice.circuitIds.join(',') } : undefined,
    eendraadSlice: eendraadSliceMeta,
    symbolExports: symbolExports.length > 0 ? symbolExports : undefined,
  }
}
