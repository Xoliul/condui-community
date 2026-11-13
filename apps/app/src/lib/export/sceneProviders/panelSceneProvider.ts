import { prepareIsolatedExportScene } from './isolatedExportScene'
import { logger } from '@/lib/logger'
/**
 * Panel scene provider
 * Prepares isolated panel scene for export
 */

import Konva from 'konva'
import type { ExportScene, ExportOptions } from '../types'
import { ExportError } from '../types'
import { findContentLayer, findCanvasContentGroup, calculateSceneBounds } from './helpers'
import { EXPORT_STAGE_WAIT_MS, waitForExportStage } from './waitForExportStage'
import { describeMissingExportStage } from './exportStageDiagnostics'
import { collectAndRemoveSymbolImagesForExport } from '../symbolSvgInject'
import { adjustSymbolImagesForExport } from './symbolImageExport'
import { useUIStore } from '@/stores/uiStore'
import { useCanvasRegistryStore } from '@/stores/canvasRegistryStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { exportLog } from '../exportLogger'
import { stripInteractiveOverlaysForExport } from '../interactiveOverlayExport'
import { acquireCanvasGroupMaterialization } from '@/lib/canvas/groupMaterialization'

export type PanelSceneExportMode =
  | { kind: 'panel'; panelId: string }
  | { kind: 'overview' }
  | { kind: 'hierarchy-surface'; surfaceId: string }

/**
 * Prepare isolated panel scene for export
 *
 * @param exportMode Panel export mode
 * @param options Export options
 * @returns Isolated export scene
 */
export async function preparePanelScene(
  exportMode: PanelSceneExportMode,
  options: ExportOptions
): Promise<ExportScene> {
  // 1. Ensure the panel canvas is in the right mode before cloning its scene
  const { setActivePanelId, setPanelCanvasMode } = useUIStore.getState()
  const activePanelId = useUIStore.getState().activePanelId
  const currentMode = useUIStore.getState().panelCanvasMode

  const needsModeSwitch =
    exportMode.kind === 'panel'
      ? activePanelId !== exportMode.panelId ||
        currentMode.kind !== 'panel' ||
        currentMode.panelId !== exportMode.panelId
      : currentMode.kind !== 'all'

  if (needsModeSwitch) {
    if (exportMode.kind === 'panel') {
      exportLog(`[Export] Switching to panel ${exportMode.panelId} (was: ${activePanelId})`)
      setActivePanelId(exportMode.panelId)
      setPanelCanvasMode({ kind: 'panel', panelId: exportMode.panelId })
    } else {
      exportLog('[Export] Switching panel canvas to hierarchy mode')
      setPanelCanvasMode({ kind: 'all' })
    }
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  // 2. Get stage from registry (now always returns stage if canvas is mounted)
  const stageLookupId = exportMode.kind === 'panel' ? exportMode.panelId : (activePanelId ?? '')
  const stage = await waitForExportStage(() =>
    useCanvasRegistryStore.getState().registry.panel?.getStage(stageLookupId)
  )

  if (!stage) {
    throw new ExportError(
      'STAGE_UNAVAILABLE',
      `Panel stage not available for ${exportMode.kind}. Canvas may not be mounted. ${describeMissingExportStage(EXPORT_STAGE_WAIT_MS)}`
    )
  }

  exportLog(`[Export] Got panel stage for ${exportMode.kind}, layers: ${stage.getLayers().length}`)

  // 3. Find canvas-content Group explicitly
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
    throw new ExportError('NO_CONTENT', `Panel export scene has no canvas-content group`)
  }

  exportLog(`[Export] Found canvas-content group for ${exportMode.kind}`)

  // A per-board page needs only that board's offscreen artwork. The overview
  // deliberately materializes the complete hierarchy once.
  const materializationGroup =
    exportMode.kind === 'hierarchy-surface'
      ? canvasContentGroup.findOne<Konva.Group>(`.hierarchy-surface-${exportMode.surfaceId}`)
      : canvasContentGroup
  if (!materializationGroup) {
    throw new ExportError(
      'NO_CONTENT',
      `Hierarchy surface ${exportMode.kind === 'hierarchy-surface' ? exportMode.surfaceId : ''} not found in export scene.`
    )
  }
  // Clone canvas-content Group (deep clone, no live references)
  const releaseMaterialization = await acquireCanvasGroupMaterialization(materializationGroup)
  let clonedGroup: Konva.Group
  try {
    clonedGroup = canvasContentGroup.clone({ deep: true })
  } finally {
    releaseMaterialization()
  }
  return prepareIsolatedExportScene(clonedGroup, async (createStage) => {
    clonedGroup.find('.panel-surface-placeholder').forEach((node) => node.destroy())

    // Reset transforms to identity (scene space is canvas-content space)
    clonedGroup.x(0)
    clonedGroup.y(0)
    clonedGroup.scaleX(1)
    clonedGroup.scaleY(1)
    clonedGroup.rotation(0)

    stripInteractiveOverlaysForExport(clonedGroup)

    // Normalize symbol images (supply, domotica, etc.) to data URLs so SVG/PDF embed them
    const sourceTheme = useSettingsStore.getState().theme.mode
    const targetTheme = options.theme ?? 'light'
    const symbolExports = collectAndRemoveSymbolImagesForExport(clonedGroup)

    await adjustSymbolImagesForExport(clonedGroup, sourceTheme, targetTheme)

    // Allocate the temporary stage only after materialization and asynchronous
    // image preparation succeeded, so a failed acquire cannot leak a stage.
    const tempStage = createStage(stage.width(), stage.height())
    const tempLayer = new Konva.Layer()
    tempStage.add(tempLayer)
    tempLayer.add(clonedGroup)
    tempStage.draw()

    // 5. Calculate bounds in scene coordinate space (fallback to stage size if invalid)
    const fallbackBounds = {
      x: 0,
      y: 0,
      width: tempStage.width(),
      height: tempStage.height(),
      space: 'scene',
    } as const

    let bounds = calculateSceneBounds(clonedGroup, fallbackBounds)

    if (exportMode.kind === 'hierarchy-surface') {
      const selector = `.hierarchy-surface-${exportMode.surfaceId}`
      const surfaceNode = clonedGroup.findOne(selector)
      if (!surfaceNode) {
        throw new ExportError(
          'NO_CONTENT',
          `Hierarchy surface ${exportMode.surfaceId} not found in export scene.`
        )
      }
      const rect = surfaceNode.getClientRect({ relativeTo: clonedGroup })
      bounds = {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        space: 'scene',
      }
    }

    const sceneId =
      exportMode.kind === 'panel'
        ? `panel-${exportMode.panelId}`
        : exportMode.kind === 'overview'
          ? 'panel-overview'
          : `panel-${exportMode.surfaceId}`

    // 6. Return isolated scene
    return {
      id: sceneId,
      kind: 'panel',
      renderedTheme: sourceTheme,
      rootNode: clonedGroup, // Isolated clone, safe to export
      bounds,
      preferredOrientation: exportMode.kind === 'overview' ? 'landscape' : 'portrait',
      symbolExports: symbolExports.length > 0 ? symbolExports : undefined,
    }
  })
}
