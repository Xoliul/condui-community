import { prepareIsolatedExportScene } from './isolatedExportScene'
import { logger } from '@/lib/logger'
/**
 * Sitplan scene provider
 * Prepares isolated sitplan scene for export
 */

import Konva from 'konva'
import type { ExportScene, ExportOptions } from '../types'
import { ExportError } from '../types'
import { findContentLayer, findCanvasContentGroup, calculateSceneBounds } from './helpers'
import { EXPORT_STAGE_WAIT_MS, waitForExportStage } from './waitForExportStage'
import { describeMissingExportStage } from './exportStageDiagnostics'
import { useUIStore } from '@/stores/uiStore'
import { useCanvasRegistryStore } from '@/stores/canvasRegistryStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { applyExportThemeToKonvaNodes } from '../konvaThemeExport'
import { exportLog } from '../exportLogger'
import {
  floorExpectsPlanBackground,
  getPlanBackgroundFloorId,
  isFloorPlanBackgroundDarkModeAware,
  stageHasPlanBackgroundForFloor,
} from '../planBackgroundExport'
import {
  collectAndRemovePlanGraphicElementsForExport,
  unionSceneBoundsWithPlanGraphicExports,
} from '../planGraphicSvgInject'
import {
  isSitplanSymbolImageForExport,
  stripPlanWireEditOverlayForExport,
  stripWallPointHandlesForExport,
} from '../sitplanExportStrip'
import { collectAndRemoveSymbolImagesForExport } from '../symbolSvgInject'
import { adjustSymbolImagesForExport } from './symbolImageExport'
import { stripInteractiveOverlaysForExport } from '../interactiveOverlayExport'
import { acquireCanvasDescendantsMaterialization } from '@/lib/canvas/groupMaterialization'

const SITPLAN_EXPORT_BOUNDS_PADDING = 80
const PLAN_BACKGROUND_WAIT_MS = 15000

/**
 * Walk up the tree and check if a node is inside an endpoint group.
 */
function isInsideEndpointGroup(node: Konva.Node): boolean {
  let current: Konva.Node | null = node
  while (current) {
    const name = current.name()
    if (name && name.startsWith('endpoint-')) {
      return true
    }
    current = current.getParent()
  }
  return false
}

function expandSceneBounds(
  bounds: ReturnType<typeof calculateSceneBounds>,
  padding: number
): ReturnType<typeof calculateSceneBounds> {
  if (padding <= 0) return bounds
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
    space: 'scene',
  }
}

/**
 * Prepare isolated sitplan scene for export
 *
 * @param floorId Floor ID
 * @param options Export options
 * @returns Isolated export scene
 */
export async function prepareSitplanScene(
  floorId: string,
  options: ExportOptions,
  panelId?: string | null
): Promise<ExportScene> {
  const sourceTheme = useSettingsStore.getState().theme.mode
  const targetTheme = options.theme
  // 1. Ensure floor is active (canvas only renders the active floor)
  const { setActiveFloor, setSitplanPanelFilterId } = useUIStore.getState()
  const wasActive = useUIStore.getState().activeFloorId === floorId
  const currentPanelFilterId = useUIStore.getState().sitplanPanelFilterId

  if ((panelId ?? null) !== currentPanelFilterId) {
    setSitplanPanelFilterId(panelId ?? null)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await new Promise((resolve) => setTimeout(resolve, 120))
  }

  if (!wasActive) {
    exportLog(
      `[Export] Switching to floor ${floorId} (was: ${useUIStore.getState().activeFloorId})`
    )
    setActiveFloor(floorId)
    // Wait for React to render and canvas to update
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await new Promise((resolve) => setTimeout(resolve, 300)) // Wait for canvas to render the new floor
  }

  // 2. Get stage from registry (now always returns stage if canvas is mounted)
  const stage = await waitForExportStage(() =>
    useCanvasRegistryStore.getState().registry.sitplan?.getStage(floorId)
  )

  if (!stage) {
    throw new ExportError(
      'STAGE_UNAVAILABLE',
      `Floor ${floorId} stage not available. Canvas may not be mounted. ${describeMissingExportStage(EXPORT_STAGE_WAIT_MS)}`
    )
  }

  // The plan image loads asynchronously after a floor switch. Exporting before it arrives
  // would print a missing or (on slow devices) another floor's plan, so wait for it.
  if (
    useUIStore.getState().planVisibility.groundPlansVisible &&
    floorExpectsPlanBackground(floorId)
  ) {
    const background = await waitForExportStage(
      () => (stageHasPlanBackgroundForFloor(stage, floorId) ? stage : null),
      PLAN_BACKGROUND_WAIT_MS
    )
    if (!background) {
      throw new ExportError(
        'STAGE_UNAVAILABLE',
        `Floor ${floorId} plan image did not finish loading. Try the export again.`
      )
    }
  }

  exportLog(`[Export] Got sitplan stage for ${floorId}, layers: ${stage.getLayers().length}`)

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
    throw new ExportError('NO_CONTENT', `Floor ${floorId} has no canvas-content group`)
  }

  exportLog(`[Export] Found canvas-content group for floor ${floorId}`)

  // 4. Clone into isolated temporary stage
  const releaseMaterialization = await acquireCanvasDescendantsMaterialization(canvasContentGroup)
  let clonedGroup: Konva.Group
  try {
    clonedGroup = canvasContentGroup.clone({ deep: true })
  } finally {
    releaseMaterialization()
  }
  clonedGroup.find('.plan-placement-logical-bounds').forEach((node) => node.destroy())
  return prepareIsolatedExportScene(clonedGroup, async (createStage) => {
    const tempStage = createStage(stage.width(), stage.height())
    const tempLayer = new Konva.Layer()
    tempStage.add(tempLayer)

    // Reset transforms to identity (scene space is canvas-content space)
    clonedGroup.x(0)
    clonedGroup.y(0)
    clonedGroup.scaleX(1)
    clonedGroup.scaleY(1)
    clonedGroup.rotation(0)

    stripWallPointHandlesForExport(clonedGroup)
    stripPlanWireEditOverlayForExport(clonedGroup)
    stripInteractiveOverlaysForExport(clonedGroup)

    const planGraphicExports = await collectAndRemovePlanGraphicElementsForExport(
      clonedGroup,
      targetTheme
    )

    const symbolExports = collectAndRemoveSymbolImagesForExport(clonedGroup)

    if (sourceTheme !== targetTheme) {
      applyExportThemeToKonvaNodes(clonedGroup, sourceTheme, targetTheme)
    }

    // Embed non-symbol images (floor plan backgrounds) for SVG/PDF export.
    await adjustSymbolImagesForExport(clonedGroup, sourceTheme, targetTheme, {
      shouldInvertImage: (imageNode) => {
        if (sourceTheme === targetTheme) return false
        if (isInsideEndpointGroup(imageNode)) return false
        if (isSitplanSymbolImageForExport(imageNode)) return false
        const floorId = getPlanBackgroundFloorId(imageNode)
        if (!floorId) return false
        return isFloorPlanBackgroundDarkModeAware(floorId)
      },
    })

    tempLayer.add(clonedGroup)
    tempStage.draw()

    // 5. Calculate bounds in scene coordinate space.
    // Fallback to stage size when getClientRect returns invalid (e.g. plan with images + vector walls).
    const fullBounds = expandSceneBounds(
      unionSceneBoundsWithPlanGraphicExports(
        calculateSceneBounds(clonedGroup, {
          x: 0,
          y: 0,
          width: tempStage.width(),
          height: tempStage.height(),
          space: 'scene',
        }),
        planGraphicExports
      ),
      SITPLAN_EXPORT_BOUNDS_PADDING
    )
    // A panel filter controls which electrical symbols appear, never which part of
    // the building plan is exported. Symbol proximity alone cannot distinguish an
    // attached room from a detached outbuilding, and trimming on that basis loses
    // essential inspection context. Keep the complete plan until a future,
    // explicitly modelled detached-building boundary can make this decision safely.
    const bounds = fullBounds

    // 6. Return isolated scene
    return {
      id: `sitplan-${floorId}`,
      kind: 'sitplan',
      renderedTheme: targetTheme,
      rootNode: clonedGroup, // Isolated clone, safe to export
      bounds,
      preferredOrientation: 'portrait', // Will be determined by bounds
      planGraphicExports: planGraphicExports.length > 0 ? planGraphicExports : undefined,
      symbolExports: symbolExports.length > 0 ? symbolExports : undefined,
    }
  })
}
