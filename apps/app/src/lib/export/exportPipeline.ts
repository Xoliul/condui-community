import { logger } from '@/lib/logger'
/**
 * Main export pipeline
 * Orchestrates the entire export process
 */

import type {
  ExportOptions,
  ExportResult,
  ExportPage,
  ExportScene,
  ExportContext,
  ExportDiagnostic,
  ExportPageReference,
  ExportProjectInstallerOverride,
} from './types'
export type { ExportContext } from './types'
import { ExportError } from './types'
import { injectPlanGraphicCatalogSvgsIntoExportSvg } from './planGraphicSvgInject'
import {
  injectSymbolSvgsIntoExportSvg,
  replaceRasterSymbolImagesInExportSvg,
} from './symbolSvgInject'
import { embedExternalImagesInExportSvg } from './exportSvgImageEmbed'
import { renderSvgFromScene } from './renderSvgFromScene'
import { fixEendraadWireLineCapsInExportSvg } from './eendraadWireSvgFix'
import {
  composePdfPage,
  composeFullSvgPage,
  composeLimitedRasterPdfPage,
  createPdfDocument,
} from './pdfComposer'
import { preparePanelScene } from './sceneProviders/panelSceneProvider'
import { prepareSitplanScene } from './sceneProviders/sitplanSceneProvider'
import { prepareEendraadScene } from './sceneProviders/eendraadSceneProvider'
import { calculateEendraadSlices } from './slicing/eendraadSlicing'
import { A4_LANDSCAPE, A4_PORTRAIT, getPageDimensions, type ExportPaperSize } from './pageSizes'
import { buildInfoBlockSvg } from './infoBlockSvg'
import { getInfoBlockColumns, getInfoBlockTotalWidth } from '@/lib/infoBlockLayout'
import { resolveInfoBlockLogoForExport } from '@/lib/infoBlockLogoImage'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { yieldToBrowser } from './yieldToBrowser'
import { applyPreparedSceneThemeToSvg } from './sceneSvgTheme'
import { applyExportFontToSvg, getExportFontFamily } from './fontPostProcessor'
import {
  collectEendraadTextOverlays,
  collectEendraadFreeNoteOverlays,
  collectEendraadWireLabelOverlays,
  collectEendraadSecondaryBusReferenceOverlays,
  getTextOverlaysForSlice,
  drawEendraadTextOverlaysOnPdf,
  injectEendraadLabelsIntoSvg,
} from './eendraadLabelOverlay'
import { addExportFontToPdf } from './pdfFontRegistration'
import { getInstallerProfile, type InstallerProfile } from '@/lib/installerProfile'
import { getInfoBlockBrandForCurrentDomain } from '@/utils/language'
import i18n from '@/i18n'
import { buildPanelCircuitLegendRows, buildPanelLegendSvgs } from './panelLegendSvg'
import { getPanelDiagramTitleLine } from '@/lib/panel/panelDiagramLabels'
import { buildSitplanExportTargets } from './sitplanExportPlan'
import { exportLog } from './exportLogger'
import { normalizeExportOptions } from './types'
import { queryOneWireNotes } from '@/lib/projectV2/annotations'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { shouldRasterizePdf } from '@/lib/editionPdfRenderingPolicy'
/* @project-documents-strip-start */
import { isCableRoutesEnabled } from '@/lib/cableRouting/availability'
import { buildCableSchedule } from '@/lib/cableRouting/cableSchedule'
import {
  buildCableScheduleSvgPages,
  getCableSchedulePdfLabels,
} from '@/lib/cableRouting/cableSchedulePdf'
import { estimateCableRoutes } from '@/lib/cableRouting/estimateCableRoutes'
import { isProjectV2 } from '@/lib/projectV2/migration'

import { appendDocumentsToPdf } from '@/lib/documents/appendDocumentsToPdf'

import { buildAddressTable } from '@/lib/controlLink/addressTable'
import { buildAddressTableSvgPages, getAddressTablePdfLabels } from '@/lib/controlLink/addressTablePdf'
import {
  cableScheduleDocument,
  controlAddressesDocument,
  getExportedProjectDocuments,
  getProjectDocuments,
} from '@/lib/documents/projectDocuments'
/* @project-documents-strip-end */
import { getPanelDiagramId } from '@/lib/layout/bottomUpLayout'
import { buildPanelExportTargets, orderEendraadLayoutsForExport } from './exportPlan'

function normalizeInstallerProfile(
  profile: InstallerProfile | ExportProjectInstallerOverride
): InstallerProfile {
  return {
    name: profile.name,
    address: profile.address,
    companyNumber: profile.companyNumber ?? '',
    email: profile.email ?? '',
    mobile: profile.mobile ?? '',
    phone: profile.phone ?? '',
    signatureDataUrl: profile.signatureDataUrl,
    logoDataUrl: profile.logoDataUrl,
  }
}

/**
 * Build export plan - list of pages to export
 */
function getEendraadPaperSize(options: Pick<ExportOptions, 'eendraadPaperSize'>): ExportPaperSize {
  return options.eendraadPaperSize === 'A3' ? 'A3' : 'A4'
}

function buildExportPlan(options: ExportOptions, context: ExportContext): ExportPage[] {
  const pages: ExportPage[] = []
  const { project, eendraadLayout } = context

  if (options.includeEendraad === true && eendraadLayout) {
    // For each panel, we'll calculate slices during scene preparation
    // For now, create placeholder pages - actual slicing happens in prepareSceneForPage
    const orderedLayouts = orderEendraadLayoutsForExport(eendraadLayout.panels)
    for (const panelLayout of orderedLayouts) {
      const diagramId = getPanelDiagramId(panelLayout)
      // We'll create one page per panel initially, then slice during preparation
      pages.push({
        id: `eendraad-${diagramId}`,
        scene: {
          id: `eendraad-${diagramId}`,
          kind: 'eendraad',
          // rootNode and bounds will be set by scene provider
          rootNode: null as unknown as ExportScene['rootNode'], // Temporary, will be set during preparation
          bounds: { x: 0, y: 0, width: 0, height: 0, space: 'scene' }, // Temporary
          preferredOrientation: 'landscape',
        },
        pageSize: getEendraadPaperSize(options),
        orientation: 'landscape',
      })
    }
  }

  if (options.includeSitplan === true) {
    for (const target of buildSitplanExportTargets(project, options.mergePlanPages)) {
      pages.push({
        id: target.id,
        scene: {
          id: target.id,
          kind: 'sitplan',
          rootNode: null as unknown as ExportScene['rootNode'], // Temporary
          bounds: { x: 0, y: 0, width: 0, height: 0, space: 'scene' }, // Temporary
          metadata: {
            floorId: target.floorId,
            ...(target.panelId ? { panelId: target.panelId } : {}),
            ...(target.title ? { exportTitle: target.title } : {}),
          },
        },
        pageSize: 'A4',
        orientation: 'portrait', // Will be determined by bounds
      })
    }
  }

  if (options.includePanel === true) {
    for (const target of buildPanelExportTargets(project)) {
      pages.push({
        id: target.id,
        scene: {
          id: target.id,
          kind: 'panel',
          rootNode: null as unknown as ExportScene['rootNode'],
          bounds: { x: 0, y: 0, width: 0, height: 0, space: 'scene' },
          preferredOrientation: target.orientation,
          metadata:
            target.mode.kind === 'overview'
              ? { exportMode: 'overview' }
              : target.mode.kind === 'hierarchy-surface'
                ? { exportMode: 'hierarchy-surface', surfaceId: target.mode.surfaceId }
                : undefined,
        },
        pageSize: 'A4',
        orientation: target.orientation,
      })
    }
  }

  return pages
}

/** Pre-prepared eendraad full scenes for all eendraad pages. */
interface EendraadPrepCache {
  byPanelId: Map<string, ExportScene>
}

interface EendraadOverlayCache {
  byPanelId: Map<string, ReturnType<typeof collectEendraadTextOverlays>>
}

/**
 * Prepare scene for a page
 * Handles eendraad slicing and scene preparation. When eendraadCache is provided,
 * reuses the same cloned scene for all slices (consistent theme). Each panel
 * height-fits independently so every page of that panel shares one scale.
 */
async function prepareSceneForPage(
  page: ExportPage,
  options: ExportOptions,
  context: ExportContext,
  eendraadCache?: EendraadPrepCache
): Promise<ExportScene[]> {
  const scenes: ExportScene[] = []

  switch (page.scene.kind) {
    case 'eendraad': {
      const diagramId = page.scene.id.replace('eendraad-', '')
      const panelLayout = context.eendraadLayout?.panels.find(
        (p) => getPanelDiagramId(p) === diagramId
      )
      if (!panelLayout) {
        throw new ExportError('NO_CONTENT', `Diagram ${diagramId} not found in layout`)
      }

      const fullScene = eendraadCache
        ? eendraadCache.byPanelId.get(diagramId)
        : await prepareEendraadScene(diagramId, 0, null, options, undefined, {
            project: context.project,
            panelLayout,
            wireSegments: context.eendraadWireSegments,
          })
      if (!fullScene) {
        throw new ExportError('NO_CONTENT', `Eendraad scene for diagram ${diagramId} not in cache`)
      }

      const { slices, globalScale, mainBusY } = await calculateEendraadSlices(
        panelLayout,
        fullScene,
        undefined,
        getEendraadPaperSize(options)
      )

      for (let i = 0; i < slices.length; i++) {
        const slice = slices[i]!
        const rootClone = fullScene.rootNode.clone({ deep: true })
        const overlapPx = slice.overlapPx ?? 0
        const contentRect = {
          x: slice.x,
          y: slice.y,
          width: slice.width,
          height: slice.height,
          space: 'scene' as const,
        }
        scenes.push({
          ...fullScene,
          rootNode: rootClone,
          id: `eendraad-${diagramId}-slice-${i}`,
          // Slice-local bounds (including overlap) drive scaling and placement.
          // The core visible rect (without overlap) is enforced via contentClipRect.
          bounds: {
            x: slice.x - overlapPx,
            y: slice.y,
            width: slice.width + 2 * overlapPx,
            height: slice.height,
            space: 'scene',
          },
          contentClipRect: overlapPx > 0 ? contentRect : undefined,
          metadata: { circuitIds: slice.circuitIds.join(',') },
          eendraadSlice: { globalScale, mainBusY },
        })
      }
      break
    }

    case 'panel': {
      const panelId = page.scene.id.replace('panel-', '')
      const exportMode = page.scene.metadata?.exportMode
      const surfaceId = page.scene.metadata?.surfaceId
      const scene = await preparePanelScene(
        exportMode === 'overview'
          ? { kind: 'overview' }
          : exportMode === 'hierarchy-surface' && surfaceId
            ? { kind: 'hierarchy-surface', surfaceId }
            : { kind: 'panel', panelId },
        options
      )
      scenes.push(scene)
      break
    }

    case 'sitplan': {
      const floorId = page.scene.metadata?.floorId ?? page.scene.id.replace('sitplan-', '')
      const panelId = page.scene.metadata?.panelId ?? null
      const scene = await prepareSitplanScene(floorId, options, panelId)
      if (page.scene.metadata) {
        scene.metadata = { ...(scene.metadata ?? {}), ...page.scene.metadata }
      }
      scenes.push(scene)
      break
    }

    default:
      throw new ExportError('NO_CONTENT', `Unknown scene kind: ${page.scene.kind}`)
  }

  return scenes
}

/**
 * Progress callback interface
 */
export interface ExportProgressCallbacks {
  onProgress?: (progress: number) => void // 0-1
  onPageChange?: (pageId: string) => void
}

/**
 * Main export function with chunked processing and progress callbacks
 */
export async function exportToPDF(
  rawOptions: ExportOptions,
  context: ExportContext,
  progressCallbacks?: ExportProgressCallbacks
): Promise<ExportResult> {
  const options = normalizeExportOptions(rawOptions)
  // Ensure theme is explicit (default to light)
  const exportTheme: ExportOptions['theme'] = options.theme || 'light'
  const isLimitedRasterExport = shouldRasterizePdf(options)
  const originalTheme = useSettingsStore.getState().theme.mode

  const runExport = async (renderTheme: 'light' | 'dark'): Promise<ExportResult> => {
    const diagnostics: ExportDiagnostic[] = []
    let referenceLink: ExportPageReference | null = null
    if (
      context.resolvePageReference &&
      !isLimitedRasterExport &&
      typeof window !== 'undefined' &&
      window.location?.href
    ) {
      try {
        referenceLink = await context.resolvePageReference(context.project, window.location.href)
      } catch (error) {
        logger.warn('[Export] Failed to build page reference; continuing without it.', error)
      }
    }

    // Save interactive UI state so we can restore it after export.
    // - activeFloorId: sitplan provider switches floors
    // - selection/hover: canvases render selection/hover overlays that should never appear in PDF
    const uiState = useUIStore.getState()
    const originalActiveFloorId = options.includeSitplan ? uiState.activeFloorId : null
    const originalSitplanPanelFilterId = options.includeSitplan
      ? uiState.sitplanPanelFilterId
      : null
    const originalActivePanelId = options.includePanel ? uiState.activePanelId : null
    const originalPanelCanvasMode = options.includePanel ? uiState.panelCanvasMode : null
    const originalPanelView = options.includePanel ? uiState.panelView : null
    const originalSelection = uiState.selection
    const originalHover = uiState.hover

    // Clear selection/hover so export clones are rendered without interactive overlays.
    if (originalSelection.type || originalSelection.ids.length > 0) {
      uiState.clearSelection()
    }
    if (originalHover.type || originalHover.ids.length > 0) {
      uiState.clearHover()
    }

    try {
      // Give React/Konva and symbol-image effects a moment to settle after theme switch
      await new Promise((resolve) => requestAnimationFrame(resolve))
      await new Promise((resolve) => requestAnimationFrame(resolve))
      await new Promise((resolve) => setTimeout(resolve, 120))

      // Build export plan
      const pages = buildExportPlan({ ...options, theme: exportTheme }, context)

      exportLog(`[Export] Building export plan: ${pages.length} pages`)
      exportLog(`[Export] Options:`, { ...options, theme: exportTheme })
      exportLog(`[Export] Context:`, {
        projectId: context.project.project.id,
        panels: getProjectElectricalPanels(context.project).length,
        floors: selectProjectBuildingFloors(context.project).length,
        eendraadLayoutPanels: context.eendraadLayout?.panels.length ?? 0,
      })

      if (pages.length === 0) {
        throw new ExportError(
          'NO_CONTENT',
          'No pages to export. Please select at least one canvas type.'
        )
      }

      // Pre-pass: prepare all eendraad full scenes once. Each panel later
      // chooses its own height-fit scale so tall notes only shrink that board.
      let eendraadCache: EendraadPrepCache | undefined
      let eendraadOverlayCache: EendraadOverlayCache | undefined
      const eendraadPages = pages.filter((p) => p.scene.kind === 'eendraad')
      if (eendraadPages.length > 0 && context.eendraadLayout) {
        const byPanelId = new Map<string, ExportScene>()
        const overlayByPanelId = new Map<string, ReturnType<typeof collectEendraadTextOverlays>>()
        for (const page of eendraadPages) {
          const diagramId = page.scene.id.replace('eendraad-', '')
          const panelLayout = context.eendraadLayout!.panels.find(
            (p) => getPanelDiagramId(p) === diagramId
          )
          if (!panelLayout) continue
          const fullScene = await prepareEendraadScene(
            diagramId,
            0,
            null,
            { ...options, theme: exportTheme },
            undefined,
            { project: context.project, panelLayout, wireSegments: context.eendraadWireSegments }
          )
          byPanelId.set(diagramId, fullScene)
          const baseOverlays = collectEendraadTextOverlays(panelLayout, exportTheme)
          const noteOverlays =
            panelLayout.frameRole === 'supply'
              ? []
              : collectEendraadFreeNoteOverlays(
                  queryOneWireNotes(context.project),
                  panelLayout.panel.id,
                  exportTheme
                )
          const wireLabelOverlays = collectEendraadWireLabelOverlays(
            context.eendraadWireSegments ?? [],
            panelLayout.panel.id,
            exportTheme,
            diagramId
          )
          overlayByPanelId.set(diagramId, [...baseOverlays, ...noteOverlays, ...wireLabelOverlays])
        }
        eendraadCache = {
          byPanelId,
        }
        eendraadOverlayCache = {
          byPanelId: overlayByPanelId,
        }
        exportLog(`[Export] Eendraad pre-pass: ${byPanelId.size} panels`)
      }

      // Resolve effective installer profile and shared strings for per-page info block
      const project = context.project
      const rawEffectiveProfile = normalizeInstallerProfile(
        project.project.installerOverride ?? (await getInstallerProfile())
      )
      const brandedProfile =
        isLimitedRasterExport && rawEffectiveProfile
          ? {
              ...rawEffectiveProfile,
              companyNumber: rawEffectiveProfile.companyNumber ?? '',
              email: rawEffectiveProfile.email ?? '',
              mobile: rawEffectiveProfile.mobile ?? '',
              phone: rawEffectiveProfile.phone ?? '',
              logoDataUrl: null,
              signatureDataUrl: null,
            }
          : {
              ...rawEffectiveProfile,
              signatureDataUrl: options.includeSignature
                ? rawEffectiveProfile.signatureDataUrl
                : null,
            }
      // Only a logo that decodes gets the info-block column (matches the canvas).
      const effectiveProfile = brandedProfile?.logoDataUrl
        ? {
            ...brandedProfile,
            logoDataUrl: await resolveInfoBlockLogoForExport(brandedProfile.logoDataUrl),
          }
        : brandedProfile
      const { language } = useSettingsStore.getState()
      const countryLabel = i18n.t('installation.countryBelgium', 'Belgium')
      const madeWithText = i18n.t('infoBlock.madeWith', {
        brand: getInfoBlockBrandForCurrentDomain(language),
      })
      const headerInstaller = i18n.t('infoBlock.headerInstaller', 'Installer')
      const headerInstallation = i18n.t('infoBlock.headerInstallation', 'Installation address')
      const headerInspectionAgency = i18n.t('project.inspectionAgency', 'Inspection agency')
      const infoBlockNativeWidth = getInfoBlockTotalWidth(
        getInfoBlockColumns(project, { hasLogo: Boolean(effectiveProfile?.logoDataUrl) })
      )
      const fontFamily = getExportFontFamily()

      const getViewTitleForSceneKind = (kind: ExportScene['kind']): string => {
        switch (kind) {
          case 'eendraad':
            return i18n.t('infoBlock.viewTitle.oneWire', 'One-wire diagram')
          case 'sitplan':
            return i18n.t('infoBlock.viewTitle.sitplan', 'Situation plan')
          case 'panel':
            return i18n.t('infoBlock.viewTitle.panel', 'Distribution board')
          default:
            return i18n.t('infoBlock.viewTitle.oneWire', 'One-wire diagram')
        }
      }

      // Calculate total operations for progress tracking
      // Each page has: prepare (1) + render (N scenes) + compose (N scenes)
      let totalOperations = 0
      for (const _page of pages) {
        // We'll estimate 1 scene per page initially, then update as we go
        totalOperations += 3 // prepare + render + compose
      }

      let completedOperations = 0
      const updateProgress = () => {
        const progress = totalOperations > 0 ? completedOperations / totalOperations : 0
        progressCallbacks?.onProgress?.(Math.min(progress, 1))
      }

      // Create PDF
      let pdf: ReturnType<typeof createPdfDocument> | null = null
      let successfulPages = 0
      let isFirstPage = true

      // Process each page in chunks
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex]!

        try {
          progressCallbacks?.onPageChange?.(page.id)
          exportLog(`[Export] Processing page: ${page.id} (${page.scene.kind})`)

          // Yield before preparing scene
          await yieldToBrowser()

          // Prepare scenes for this page (may be multiple for eendraad slices)
          const scenes = await prepareSceneForPage(
            page,
            { ...options, theme: exportTheme },
            context,
            eendraadCache
          )
          completedOperations++
          updateProgress()

          // Update total operations based on actual scene count
          const additionalScenes = scenes.length - 1
          if (additionalScenes > 0) {
            totalOperations += additionalScenes * 2 // render + compose for each additional scene
          }

          exportLog(`[Export] Prepared ${scenes.length} scene(s) for page ${page.id}`)

          // Export each scene as a page
          for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
            const scene = scenes[sceneIndex]!

            exportLog(
              `[Export] Rendering scene ${sceneIndex + 1}/${scenes.length} for page ${page.id}`
            )

            // Yield before rendering
            await yieldToBrowser()

            // Normalize the Konva-rendered portion before injecting catalog vectors that are
            // already target-themed. This prevents a target light symbol color from being
            // reinterpreted as a source dark color when both palettes share a hex value.
            let svgString = await renderSvgFromScene(scene)
            if (scene.kind === 'eendraad') {
              const diagramId = scene.id.replace(/^eendraad-/, '').replace(/-slice-\d+$/, '')
              const isSupplyFrame = context.eendraadLayout?.panels.some(
                (panelLayout) =>
                  getPanelDiagramId(panelLayout) === diagramId && panelLayout.frameRole === 'supply'
              )
              const panelLayout = context.eendraadLayout?.panels.find(
                (candidate) => getPanelDiagramId(candidate) === diagramId
              )
              svgString = fixEendraadWireLineCapsInExportSvg(svgString, {
                preserveRoundedThickCaps: isSupplyFrame,
                mainBus: panelLayout?.mainBus,
              })
            }
            svgString = applyPreparedSceneThemeToSvg(svgString, scene, exportTheme, renderTheme)
            if (scene.symbolExports?.length) {
              svgString = await injectSymbolSvgsIntoExportSvg(
                svgString,
                scene.symbolExports,
                exportTheme
              )
            }
            svgString = await replaceRasterSymbolImagesInExportSvg(svgString, exportTheme)
            if (scene.kind === 'sitplan' && scene.planGraphicExports?.length) {
              svgString = await injectPlanGraphicCatalogSvgsIntoExportSvg(
                svgString,
                scene.planGraphicExports
              )
            }
            svgString = applyExportFontToSvg(svgString)
            if (isLimitedRasterExport && scene.kind === 'eendraad' && context.eendraadLayout) {
              const diagramId = scene.id.replace(/^eendraad-/, '').replace(/-slice-\d+$/, '')
              const panelLayout = context.eendraadLayout.panels.find(
                (candidate) => getPanelDiagramId(candidate) === diagramId
              )
              const circuitIds = (scene.metadata?.circuitIds ?? '').split(',').filter(Boolean)
              if (panelLayout && circuitIds.length > 0) {
                // The scene provider strips these labels for the vector PDF overlay pass.
                // Limited PDFs rasterize the SVG before that pass, so restore the labels
                // inside the SVG to make them part of the single rasterized page image.
                svgString = injectEendraadLabelsIntoSvg(
                  svgString,
                  circuitIds,
                  panelLayout,
                  exportTheme
                )
              }
            }
            svgString = await embedExternalImagesInExportSvg(svgString)

            completedOperations++
            updateProgress()

            exportLog(
              `[Export] Rendered SVG (${svgString.length} chars) for scene ${sceneIndex + 1}`
            )

            // Only one-wire pages follow the chosen paper size; everything else stays A4.
            const scenePaperSize: ExportPaperSize =
              scene.kind === 'eendraad' ? getEendraadPaperSize(options) : 'A4'

            // Create PDF if first page
            if (!pdf) {
              const orientation =
                scene.kind === 'eendraad' || scene.preferredOrientation === 'landscape'
                  ? 'landscape'
                  : scene.bounds.width > scene.bounds.height
                    ? 'landscape'
                    : 'portrait'
              pdf = createPdfDocument(
                getPageDimensions(orientation, scenePaperSize),
                orientation
              )
              await addExportFontToPdf(pdf)
              exportLog(`[Export] Created PDF document (${orientation})`)
            }

            // Add new page if not first
            if (!isFirstPage) {
              const orientation =
                scene.kind === 'eendraad' || scene.preferredOrientation === 'landscape'
                  ? 'landscape'
                  : scene.bounds.width > scene.bounds.height
                    ? 'landscape'
                    : 'portrait'
              const { width: pageWidthMm, height: pageHeightMm } = getPageDimensions(
                orientation,
                scenePaperSize
              )
              pdf.addPage([pageWidthMm, pageHeightMm], orientation)
              exportLog(`[Export] Added new page (${orientation})`)
            }

            // Create page descriptor for this scene
            const scenePage: ExportPage = {
              id: `${page.id}${scenes.length > 1 ? `-slice-${sceneIndex}` : ''}`,
              scene,
              pageSize: scenePaperSize,
              orientation:
                scene.kind === 'eendraad' || scene.preferredOrientation === 'landscape'
                  ? 'landscape'
                  : scene.bounds.width > scene.bounds.height
                    ? 'landscape'
                    : 'portrait',
            }

            // Yield before composing
            await yieldToBrowser()

            // Build per-page info block (installer, address, view title) for bottom-right
            const viewTitle = getViewTitleForSceneKind(scene.kind)
            const infoBlockSvg = buildInfoBlockSvg({
              profile: effectiveProfile,
              project,
              viewTitle,
              headerInstaller,
              headerInstallation,
              headerInspectionAgency,
              isDark: exportTheme === 'dark',
              fontFamily,
              countryLabel,
              madeWithText,
            })

            // Panel title for eendraad slice pages (top-left on every slice)
            const panelTitle =
              scene.kind === 'eendraad'
                ? (() => {
                    const diagramId = scene.id.replace(/^eendraad-/, '').replace(/-slice-\d+$/, '')
                    const panelLayout = context.eendraadLayout?.panels.find(
                      (p) => getPanelDiagramId(p) === diagramId
                    )
                    if (!panelLayout) return null
                    if (panelLayout.frameRole === 'supply') {
                      return i18n.t('canvas.supplyFrame.title', 'Supply')
                    }
                    return getPanelDiagramTitleLine(
                      project,
                      panelLayout.panel,
                      i18n.t.bind(i18n),
                      context.advancedPanelLabels === true
                    )
                  })()
                : scene.kind === 'sitplan'
                  ? (scene.metadata?.exportTitle ?? null)
                  : scene.id === 'panel-overview'
                    ? i18n.t('export.panelRelationOverview', 'Panel relation overview')
                    : null

            // Compose PDF page (main content + info block in reserved zone, optional panel title)
            const placement = isLimitedRasterExport
              ? await composeLimitedRasterPdfPage(
                  pdf,
                  svgString,
                  scenePage,
                  diagnostics,
                  {
                    svgString: infoBlockSvg,
                    nativeWidth: infoBlockNativeWidth,
                  },
                  panelTitle,
                  exportTheme
                )
              : await composePdfPage(
                  pdf,
                  svgString,
                  scenePage,
                  diagnostics,
                  {
                    svgString: infoBlockSvg,
                    nativeWidth: infoBlockNativeWidth,
                  },
                  panelTitle,
                  referenceLink,
                  exportTheme
                )

            if (
              !isLimitedRasterExport &&
              scene.kind === 'eendraad' &&
              eendraadOverlayCache &&
              placement
            ) {
              const diagramId = scene.id.replace(/^eendraad-/, '').replace(/-slice-\d+$/, '')
              const panelLayout = context.eendraadLayout?.panels.find(
                (candidate) => getPanelDiagramId(candidate) === diagramId
              )
              const allOverlays = eendraadOverlayCache.byPanelId.get(diagramId) ?? []
              const sliceCircuitIds = (scene.metadata?.circuitIds ?? '').split(',').filter(Boolean)
              const clipRect = scene.contentClipRect ?? scene.bounds
              const sliceOverlays = getTextOverlaysForSlice(
                allOverlays,
                scene.bounds,
                sliceCircuitIds,
                4,
                clipRect
              )
              const secondaryBusReferenceOverlays = collectEendraadSecondaryBusReferenceOverlays(
                context.eendraadWireSegments ?? [],
                panelLayout?.panel.id ?? diagramId,
                exportTheme,
                scene.contentClipRect ?? scene.bounds,
                diagramId
              )
              const overlays = [...sliceOverlays, ...secondaryBusReferenceOverlays]
              if (overlays.length > 0) {
                drawEendraadTextOverlaysOnPdf(pdf, overlays, placement, exportTheme)
              }
            }
            completedOperations++
            updateProgress()

            successfulPages++
            isFirstPage = false
            exportLog(`[Export] Successfully added page ${successfulPages}`)
          }
        } catch (error) {
          logger.error(`[Export] Error processing page ${page.id}:`, error)
          diagnostics.push({
            level: 'error',
            code: 'SVG_RENDER_FAILED',
            pageId: page.id,
            canvasKind: page.scene.kind,
            message: `Failed to export page: ${
              error instanceof Error ? error.message : String(error)
            }`,
            details: { error },
          })
          // Continue with other pages
          // Still count as completed operation for progress
          completedOperations += 3
          updateProgress()
        }

        // Yield after each page
        if (pageIndex < pages.length - 1) {
          await yieldToBrowser()
        }
      }

      // Optional legend page for panel circuits: only when panel pages are included.
      if (options.includePanel && pdf) {
        const legendRows = buildPanelCircuitLegendRows(context.project)
        if (legendRows.length > 0) {
          const orientation = 'portrait' as const
          const pageSize: [number, number] = [A4_PORTRAIT.width, A4_PORTRAIT.height]
          const legendLabels = {
            title: i18n.t('circuits.legendTitle', 'Circuit legend'),
            panel: i18n.t('panels.distribution', 'Distribution board'),
            circuit: i18n.t('circuits.code', 'Code'),
            type: i18n.t('circuits.kind', 'Type'),
            protection: i18n.t('protections.title', 'Protections'),
            notes: i18n.t('installation.notes', 'Notes'),
            kindLabels: {
              lighting: i18n.t('circuits.lighting', 'Lighting'),
              sockets: i18n.t('circuits.sockets', 'Sockets'),
              fixed_appliance: i18n.t('circuits.fixed_appliance', 'Fixed appliance'),
              mixed: i18n.t('circuits.mixed', 'Mixed'),
              stove: i18n.t('circuits.stove', 'Stove'),
              solar: i18n.t('circuits.solar', 'Solar'),
              battery: i18n.t('circuits.battery', 'Battery'),
              doorbell: i18n.t('circuits.doorbell', 'Doorbell'),
              subpanel: i18n.t('circuits.subpanel', 'Subpanel'),
              hvac: i18n.t('circuits.hvac', 'HVAC'),
              boiler: i18n.t('circuits.boiler', 'Boiler'),
              heating: i18n.t('circuits.heating', 'Heating'),
              ev: i18n.t('circuits.ev', 'EV charger'),
              empty: i18n.t('circuits.empty', 'Empty circuit'),
              other: i18n.t('circuits.other', 'Other'),
            },
          } as const
          const legendSvgs = buildPanelLegendSvgs(legendRows, fontFamily, legendLabels, exportTheme)
          for (const [legendPageIndex, legendSvg] of legendSvgs.entries()) {
            const legendPageId =
              legendSvgs.length === 1 ? 'panel-legend' : `panel-legend-${legendPageIndex + 1}`
            pdf.addPage(pageSize, orientation)
            if (isLimitedRasterExport) {
              await composeLimitedRasterPdfPage(
                pdf,
                legendSvg,
                {
                  id: legendPageId,
                  scene: {
                    id: legendPageId,
                    kind: 'panel',
                    rootNode: null as unknown as ExportScene['rootNode'],
                    bounds: {
                      x: 0,
                      y: 0,
                      width: A4_PORTRAIT.width,
                      height: A4_PORTRAIT.height,
                      space: 'scene',
                    },
                    preferredOrientation: orientation,
                  },
                  pageSize: 'A4',
                  orientation,
                },
                diagnostics,
                null,
                null,
                exportTheme
              )
            } else {
              await composeFullSvgPage(
                pdf,
                legendSvg,
                legendPageId,
                diagnostics,
                orientation,
                exportTheme
              )
            }
            successfulPages++
          }
          exportLog(
            `[Export] Added ${legendSvgs.length} panel circuit legend page${legendSvgs.length === 1 ? '' : 's'}`
          )
        }
      }

      /* @project-documents-strip-start */
      // Attached documents follow the drawings. Generated tables render as vector pages.
      if (options.includeDocuments && pdf) {
        const documentPages: Array<{ id: string; svg: string }> = []
        if (
          isCableRoutesEnabled() &&
          isProjectV2(context.project) &&
          cableScheduleDocument('', context.project.assets).includeInExport
        ) {
          const schedule = buildCableSchedule(estimateCableRoutes(context.project).routes)
          const schedulePages = buildCableScheduleSvgPages(
            schedule,
            getCableSchedulePdfLabels(i18n.t),
            fontFamily,
            exportTheme
          )
          schedulePages.forEach((svg, index) =>
            documentPages.push({ id: `document-cable-schedule-${index + 1}`, svg })
          )
          exportLog(`[Export] Added the cable schedule (${schedulePages.length} page(s))`)
        }
        if (
          isProjectV2(context.project) &&
          controlAddressesDocument('', context.project.assets).includeInExport
        ) {
          const table = buildAddressTable(getProjectElectricalPanels(context.project))
          if (table.length > 0) {
            const tablePages = buildAddressTableSvgPages(
              table,
              getAddressTablePdfLabels(i18n.t),
              fontFamily,
              exportTheme
            )
            tablePages.forEach((svg, index) =>
              documentPages.push({ id: `document-control-addresses-${index + 1}`, svg })
            )
            exportLog(`[Export] Added the domotics address table (${tablePages.length} page(s))`)
          }
        }
        
        for (const { id: tablePageId, svg: tableSvg } of documentPages) {
          const orientation = 'landscape' as const
          pdf.addPage([A4_LANDSCAPE.width, A4_LANDSCAPE.height], orientation)
          if (isLimitedRasterExport) {
            await composeLimitedRasterPdfPage(
              pdf,
              tableSvg,
              {
                id: tablePageId,
                scene: {
                  id: tablePageId,
                  kind: 'panel',
                  rootNode: null as unknown as ExportScene['rootNode'],
                  bounds: {
                    x: 0,
                    y: 0,
                    width: A4_LANDSCAPE.width,
                    height: A4_LANDSCAPE.height,
                    space: 'scene',
                  },
                  preferredOrientation: orientation,
                },
                pageSize: 'A4',
                orientation,
              },
              diagnostics,
              null,
              null,
              exportTheme
            )
          } else {
            await composeFullSvgPage(pdf, tableSvg, tablePageId, diagnostics, orientation, exportTheme)
          }
          successfulPages++
        }
      }
      /* @project-documents-strip-end */

      if (!pdf) {
        const errorMessage =
          successfulPages === 0
            ? `No pages were exported. ${diagnostics.length} error(s) occurred.`
            : 'No pages were exported'
        logger.error(`[Export] Export failed: ${errorMessage}`)
        logger.error(`[Export] Diagnostics:`, diagnostics)
        throw new ExportError('NO_CONTENT', errorMessage)
      }

      let blob = pdf.output('blob')
      let pageCount = successfulPages
      /* @project-documents-strip-start */
      // Uploaded PDFs (selected pages) and images follow, merged into the finished PDF.
      if (options.includeDocuments) {
        const uploads = getExportedProjectDocuments(getProjectDocuments(context.project.assets)).filter(
          (document) => document.kind === 'pdf' || document.kind === 'image'
        )
        if (uploads.length > 0) {
          let renderLimitedPages: Parameters<typeof appendDocumentsToPdf>[3]
          
          const merged = await appendDocumentsToPdf(
            await blob.arrayBuffer(),
            uploads,
            undefined,
            renderLimitedPages
          )
          blob = new Blob([merged.bytes], { type: 'application/pdf' })
          pageCount += merged.addedPages
          for (const failure of merged.failed) {
            logger.warn('[Export] Could not add document to PDF', failure)
            diagnostics.push({
              level: 'error',
              code: 'DOCUMENT_APPEND_FAILED',
              pageId: `document-${failure.id}`,
              message: i18n.t('projectDocuments.exportFailed', { name: failure.name }),
            })
          }
          exportLog(`[Export] Added ${merged.addedPages} page(s) from ${uploads.length} document(s)`)
        }
      }
      /* @project-documents-strip-end */

      // Final progress update
      progressCallbacks?.onProgress?.(1)

      return {
        blob,
        diagnostics,
        pageCount,
      }
    } finally {
      const ui = useUIStore.getState()
      // Restore activeFloorId so sitplan canvas shows what the user had before export
      if (originalActiveFloorId != null) {
        ui.setActiveFloor(originalActiveFloorId)
      }
      if (options.includeSitplan) {
        ui.setSitplanPanelFilterId(originalSitplanPanelFilterId)
      }
      if (options.includePanel) {
        ui.setActivePanelId(originalActivePanelId)
        if (originalPanelCanvasMode) {
          ui.setPanelCanvasMode(originalPanelCanvasMode)
        }
        if (originalPanelView) {
          ui.setPanelView(originalPanelView)
        }
      }
      // Restore selection/hover so the UI returns to the user's context after export
      if (originalSelection) {
        ui.setSelection(originalSelection)
      }
      if (originalHover) {
        ui.setHover(originalHover)
      }
    }
  }

  // Never switch global UI theme during export. Keep the app visually stable.
  return runExport(originalTheme)
}
