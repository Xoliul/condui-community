import type React from 'react'
import { useCallback } from 'react'
import { clearProjectHistory } from '@/stores/slices/projectStoreHistory'
import { nanoid } from 'nanoid'
import type { Floor, Point2 } from '@/types/schema'
import { logger } from '@/lib/logger'
import { processPlanImage, processPdfRasterBackground } from '@/utils/planImageProcessing'
import {
  normalizePdfPageAsset,
  mapPdfScaleReferenceToAsset,
  type PdfImportCropBox,
  type PdfImportPageCandidate,
} from '@/lib/plan/pdfImport'
import {
  attachCadReferenceToPlanImportAsset,
  buildCadReferenceForFloorImport,
  defaultCropInAssetSpace,
  type CadImportPipelineContext,
} from '@/lib/plan/cadReferenceBuilder'
import { schedulePlanFitToViewAfterImport } from '@/components/plan/planImportFloor'
import {
  readLegacyCompatibilityFloors,
  selectProjectPlanScale,
} from '@/lib/projectV2/buildingFloors'
import {
  DEFAULT_PLAN_PX_PER_METER,
  resolvePlanPxPerMeter,
  createPlanScaleReference,
} from '@/lib/plan/planScale'
import { rescaleImportedPlanAsset, scalePlanPoint } from '@/lib/plan/rescalePlan'
import { useWallScanStore, type WallScanTarget } from '@/stores/wallScanStore'
import { liveProjectSession } from '@/stores/liveProjectCommandSession'
import { CommandError } from '@/lib/commands/project'
import { type CommandInvocation } from '@/lib/commands/project'

interface PdfPlanImportTransactionOptions {
  currentProject: import('@/types/projectV2').ProjectV2 | null
  file: File | null
  isApplyingPdfImport: boolean
  pdfPages: import('@/lib/plan/pdfImport').PdfImportPageCandidate[]
  selectedPdfPages: number[]
  t: import('i18next').TFunction<'translation', undefined>
  setIsApplyingPdfImport: React.Dispatch<React.SetStateAction<boolean>>
  pdfPageCropMap: Record<number, import('@/lib/plan/pdfImport').PdfImportCropBox>
  isCadMultiCropImport: boolean
  pdfConvertCadToGrayscale: boolean
  setImportError: React.Dispatch<React.SetStateAction<string | null>>
  pdfScalePerPage: Record<
    number,
    {
      p1: import('@/types/schema').Point2
      p2: import('@/types/schema').Point2
      meters: number
    } | null
  >
  pdfScaleSkippedPages: Record<number, true>
  pdfPageCroppedPreviewMap: Record<number, string>
  loadImageDimensions: (dataUrl: string) => Promise<{ width: number; height: number }>
  applyPdfScaleToAll: boolean
  cadImportPipelinesByPage: Record<
    number,
    import('@/lib/plan/cadReferenceBuilder').CadImportPipelineContext
  >
  cadImportPipeline: import('@/lib/plan/cadReferenceBuilder').CadImportPipelineContext | null
  pdfDestinationMode: 'replace-floor' | 'new-floor-per-page'
  selectedFloorId: string | null
  getFloorById: (id: string) => import('@/types/schema').Floor | undefined
  activeFloorId: string | null
  isFloorEmptyForAutoReplace: (floor: import('@/types/schema').Floor | null | undefined) => boolean
  setActiveFloor: (floorId: string | null) => void
  handleClose: () => void
  saveProjectAfterImport: () => void
}

export function usePdfPlanImportTransaction({
  currentProject,
  file,
  isApplyingPdfImport,
  pdfPages,
  selectedPdfPages,
  t,
  setIsApplyingPdfImport,
  pdfPageCropMap,
  isCadMultiCropImport,
  pdfConvertCadToGrayscale,
  setImportError,
  pdfScalePerPage,
  pdfScaleSkippedPages,
  pdfPageCroppedPreviewMap,
  loadImageDimensions,
  applyPdfScaleToAll,
  cadImportPipelinesByPage,
  cadImportPipeline,
  pdfDestinationMode,
  selectedFloorId,
  getFloorById,
  activeFloorId,
  isFloorEmptyForAutoReplace,
  setActiveFloor,
  handleClose,
  saveProjectAfterImport,
}: PdfPlanImportTransactionOptions) {
  const handlePdfImport = useCallback(
    async (skipScale: boolean = false) => {
      if (!currentProject || !file) return
      if (isApplyingPdfImport) return
      const expectedRevision = liveProjectSession.revision
      const selectedPages = pdfPages.filter((page) => selectedPdfPages.includes(page.pageIndex))
      if (selectedPages.length === 0) {
        alert(t('planImport.selectAtLeastOnePage'))
        return
      }

      setIsApplyingPdfImport(true)
      try {
        const normalized = await Promise.all(
          selectedPages.map((page) =>
            normalizePdfPageAsset(page, file.name, pdfPageCropMap[page.pageIndex])
          )
        )
        const normalizedWithBackground = await Promise.all(
          normalized.map(async (asset) => {
            if (isCadMultiCropImport) {
              // Greyscale is applied when drawing, so it can be switched back to colour later.
              return {
                ...asset,
                processedDataUrl: undefined,
                hasWhiteBackground: false,
                darkModeAware: true,
                grayscale: Boolean(asset.svgContent) && pdfConvertCadToGrayscale,
              }
            }
            if (asset.kind === 'pdf-vector') {
              return {
                ...asset,
                processedDataUrl: undefined,
                hasWhiteBackground: false,
                darkModeAware: true,
              }
            }
            if (asset.kind === 'pdf-raster') {
              const sourceDataUrl = asset.dataUrl
              if (!sourceDataUrl) {
                return {
                  ...asset,
                  processedDataUrl: undefined,
                  hasWhiteBackground: false,
                  darkModeAware: false,
                }
              }
              const processed = await processPdfRasterBackground(sourceDataUrl)
              return {
                ...asset,
                processedDataUrl: processed.hasWhiteBackground
                  ? processed.processedDataUrl
                  : undefined,
                hasWhiteBackground: processed.hasWhiteBackground,
                darkModeAware: true,
              }
            }
            const sourceDataUrl = asset.dataUrl
            if (!sourceDataUrl) {
              return {
                ...asset,
                processedDataUrl: undefined,
                hasWhiteBackground: false,
                darkModeAware: false,
              }
            }
            const processed = await processPlanImage(sourceDataUrl, false)
            return {
              ...asset,
              processedDataUrl: processed.hasWhiteBackground
                ? processed.processedDataUrl
                : undefined,
              hasWhiteBackground: processed.hasWhiteBackground,
              darkModeAware: processed.hasWhiteBackground,
            }
          })
        )

        setImportError(null)
        // Where each scanned page lands, so the background wall scan can be previewed there.
        const wallScanTargets: WallScanTarget[] = []
        const scansWalls = useWallScanStore.getState().status !== 'idle'
        const addWallScanTarget = (target: WallScanTarget) => {
          if (scansWalls) wallScanTargets.push(target)
        }

        const orderedSelectedPages = [...selectedPages].sort((a, b) => a.pageIndex - b.pageIndex)
        const firstSelectedPage = orderedSelectedPages[0]
        const firstSelectedReference = firstSelectedPage
          ? pdfScalePerPage[firstSelectedPage.pageIndex]
          : undefined
        const computeImportedScale = async (
          sourcePage: PdfImportPageCandidate | undefined,
          importedAsset: {
            dataUrl?: string | undefined
            pageIndex: number
            width: number
            height: number
          },
          sourceReference: { p1: Point2; p2: Point2; meters: number } | undefined
        ): Promise<{
          reference: { p1: Point2; p2: Point2; meters: number }
          pxPerMeter: number
        } | null> => {
          if (
            skipScale ||
            !sourcePage ||
            pdfScaleSkippedPages[sourcePage.pageIndex] ||
            !sourceReference ||
            !importedAsset.dataUrl ||
            sourceReference.meters <= 0
          ) {
            return null
          }
          const sourcePreviewForScale =
            pdfPageCroppedPreviewMap[sourcePage.pageIndex] ?? sourcePage.rasterDataUrl
          const sourceImageSizeForScale = await loadImageDimensions(sourcePreviewForScale)
          return mapPdfScaleReferenceToAsset(
            sourceReference,
            sourceImageSizeForScale,
            importedAsset
          )
        }

        const firstSelectedNormalizedAsset = firstSelectedPage
          ? normalizedWithBackground.find(
              (asset) => asset.pageIndex === firstSelectedPage.pageIndex
            )
          : undefined
        const firstScaleForReference =
          applyPdfScaleToAll &&
          firstSelectedPage &&
          firstSelectedReference &&
          firstSelectedNormalizedAsset
            ? await computeImportedScale(
                firstSelectedPage,
                firstSelectedNormalizedAsset,
                firstSelectedReference
              )
            : null

        const getPerPageScale = async (
          page: PdfImportPageCandidate
        ): Promise<{
          reference: { p1: Point2; p2: Point2; meters: number }
          pxPerMeter: number
        } | null> => {
          if (skipScale) return null
          if (applyPdfScaleToAll) return null
          if (pdfScaleSkippedPages[page.pageIndex]) return null
          const perPageRef = pdfScalePerPage[page.pageIndex]
          if (!perPageRef) return null
          const importedAsset = normalizedWithBackground.find(
            (asset) => asset.pageIndex === page.pageIndex
          )
          if (!importedAsset) return null
          return computeImportedScale(page, importedAsset, perPageRef)
        }

        // Import coordinates must match the building's existing physical units.
        const targetPxPerMeter =
          resolvePlanPxPerMeter(selectProjectPlanScale(currentProject)) ?? DEFAULT_PLAN_PX_PER_METER
        const pageScales = new Map<number, Awaited<ReturnType<typeof computeImportedScale>>>()
        for (const page of selectedPages) {
          pageScales.set(
            page.pageIndex,
            applyPdfScaleToAll ? firstScaleForReference : await getPerPageScale(page)
          )
        }
        const normalizedScale = (pageIndex: number): Floor['scale'] => {
          const calibration = pageScales.get(pageIndex)
          if (!calibration) return { pxPerMeter: targetPxPerMeter }
          const factor = targetPxPerMeter / calibration.pxPerMeter
          return {
            pxPerMeter: targetPxPerMeter,
            reference:
              applyPdfScaleToAll && pageIndex !== firstSelectedPage?.pageIndex
                ? undefined
                : (createPlanScaleReference(
                    scalePlanPoint(calibration.reference.p1, factor),
                    scalePlanPoint(calibration.reference.p2, factor),
                    calibration.reference.meters
                  ) ?? undefined),
          }
        }

        const floorNamePrefix = t('canvas.floor')
        const usedFloorNames = new Set(
          readLegacyCompatibilityFloors(currentProject).map((f: Floor) => f.name)
        )
        let nextFloorNumber = usedFloorNames.size + 1
        const getImportedFloorName = (pageIndex: number) => {
          const pageLabel = pdfPages.find((page) => page.pageIndex === pageIndex)?.label
          if (pageLabel && !usedFloorNames.has(pageLabel)) {
            usedFloorNames.add(pageLabel)
            return pageLabel
          }
          let candidate = `${floorNamePrefix} ${nextFloorNumber}`
          while (usedFloorNames.has(candidate)) {
            nextFloorNumber++
            candidate = `${floorNamePrefix} ${nextFloorNumber}`
          }
          usedFloorNames.add(candidate)
          nextFloorNumber++
          return candidate
        }
        const getCadPipeline = (pageIndex: number | undefined) =>
          (pageIndex == null ? undefined : cadImportPipelinesByPage[pageIndex]) ?? cadImportPipeline
        const getCadCropOffset = (
          pageAsset: { pageIndex: number; width: number; height: number; crop?: PdfImportCropBox },
          referenceAsset:
            | { pageIndex: number; width: number; height: number; crop?: PdfImportCropBox }
            | undefined
        ): Point2 | undefined => {
          if (!isCadMultiCropImport || !referenceAsset) return undefined
          const pagePipeline = getCadPipeline(pageAsset.pageIndex)
          const referencePipeline = getCadPipeline(referenceAsset.pageIndex)
          if (pagePipeline && referencePipeline && pagePipeline !== referencePipeline) {
            // DWG layout viewports are separate pages that share model coordinates,
            // so overlapping views (stacked floors) align exactly in CAD space.
            const toCadRect = (
              pipeline: CadImportPipelineContext,
              crop: PdfImportCropBox | undefined
            ) => {
              const scale = pipeline.svgNormalization.scale || 1
              const rect = crop ?? { x: 0, y: 0, ...pipeline.uncroppedAssetSize }
              return {
                x: pipeline.rawViewBox.x + rect.x / scale,
                y: pipeline.rawViewBox.y + rect.y / scale,
                width: rect.width / scale,
                height: rect.height / scale,
              }
            }
            const pageRect = toCadRect(pagePipeline, pdfPageCropMap[pageAsset.pageIndex])
            const referenceRect = toCadRect(
              referencePipeline,
              pdfPageCropMap[referenceAsset.pageIndex]
            )
            const overlaps =
              pageRect.x < referenceRect.x + referenceRect.width &&
              referenceRect.x < pageRect.x + pageRect.width &&
              pageRect.y < referenceRect.y + referenceRect.height &&
              referenceRect.y < pageRect.y + pageRect.height
            if (overlaps) {
              const scale = pagePipeline.svgNormalization.scale || 1
              return {
                x: (pageRect.x - referenceRect.x) * scale,
                y: (pageRect.y - referenceRect.y) * scale,
              }
            }
            return {
              x: (referenceAsset.width - pageAsset.width) / 2,
              y: (referenceAsset.height - pageAsset.height) / 2,
            }
          }
          const pageCrop = pageAsset.crop ?? {
            x: 0,
            y: 0,
            width: pageAsset.width,
            height: pageAsset.height,
          }
          const referenceCrop = referenceAsset.crop ?? {
            x: 0,
            y: 0,
            width: referenceAsset.width,
            height: referenceAsset.height,
          }
          const dx = pageCrop.x - referenceCrop.x
          const dy = pageCrop.y - referenceCrop.y
          const absDx = Math.abs(dx)
          const absDy = Math.abs(dy)
          const sideBySide =
            absDx > Math.max(pageCrop.width, referenceCrop.width) * 0.25 &&
            absDy <= Math.max(pageCrop.height, referenceCrop.height) * 0.35
          const stacked =
            absDy > Math.max(pageCrop.height, referenceCrop.height) * 0.25 &&
            absDx <= Math.max(pageCrop.width, referenceCrop.width) * 0.35
          const centeredX = (referenceAsset.width - pageAsset.width) / 2
          const centeredY = (referenceAsset.height - pageAsset.height) / 2

          if (sideBySide) {
            return { x: centeredX, y: dy }
          }
          if (stacked) {
            return { x: dx, y: centeredY }
          }
          return { x: centeredX, y: centeredY }
        }

        const referenceSourcePage = orderedSelectedPages[0]
        const referenceCropInAssetSpace =
          referenceSourcePage && getCadPipeline(referenceSourcePage.pageIndex)
            ? defaultCropInAssetSpace(
                { width: referenceSourcePage.width, height: referenceSourcePage.height },
                pdfPageCropMap[referenceSourcePage.pageIndex]
              )
            : undefined

        const createPlanImportAsset = (
          pageAsset: (typeof normalizedWithBackground)[number],
          options: { isReferenceCrop: boolean; planImageOffset?: Point2 }
        ) => {
          const sourcePage =
            selectedPages.find((page) => page.pageIndex === pageAsset.pageIndex) ??
            referenceSourcePage
          const base = {
            id: nanoid(),
            kind: pageAsset.kind,
            sourceName: pageAsset.sourceName,
            pageIndex: pageAsset.pageIndex,
            pageCount: pageAsset.pageCount,
            width: pageAsset.width,
            height: pageAsset.height,
            dataUrl: pageAsset.dataUrl,
            processedDataUrl: pageAsset.processedDataUrl,
            svgContent: pageAsset.svgContent,
            hasWhiteBackground: pageAsset.hasWhiteBackground,
            darkModeAware: pageAsset.darkModeAware,
            ...('grayscale' in pageAsset && pageAsset.grayscale ? { grayscale: true } : {}),
            crop: pageAsset.crop,
          }
          const calibration = pageScales.get(pageAsset.pageIndex)
          const factor = calibration ? targetPxPerMeter / calibration.pxPerMeter : 1
          const sourcePipeline = getCadPipeline(sourcePage?.pageIndex)
          if (!isCadMultiCropImport || !sourcePipeline || !sourcePage)
            return rescaleImportedPlanAsset(base, factor)
          const sharesReferencePipeline =
            sourcePipeline === getCadPipeline(referenceSourcePage?.pageIndex)
          const cadReference = buildCadReferenceForFloorImport({
            pipeline: sourcePipeline,
            uncroppedPageSize: { width: sourcePage.width, height: sourcePage.height },
            crop: pdfPageCropMap[sourcePage.pageIndex],
            isReferenceCrop: options.isReferenceCrop,
            referenceCropAssetRect:
              options.isReferenceCrop || !sharesReferencePipeline
                ? undefined
                : referenceCropInAssetSpace,
            planImageOffset: options.planImageOffset,
          })
          return rescaleImportedPlanAsset(
            attachCadReferenceToPlanImportAsset(base, cadReference),
            factor
          )
        }

        const commands: CommandInvocation[] = []
        const wallScanTargetSpecs: Array<{
          pageIndex: number
          floorId?: string
          commandIndex?: number
          imageSize: WallScanTarget['imageSize']
          offset?: Point2
        }> = []
        let firstImportedFloorId: string | null = null

        if (pdfDestinationMode === 'replace-floor') {
          if (!selectedFloorId) {
            alert(t('planImport.selectFloorOption'))
            return
          }
          const first = normalizedWithBackground[0]
          if (!first) return
          const importedAsset = createPlanImportAsset(first, { isReferenceCrop: true })
          commands.push({
            id: 'plan.attachBackground',
            input: {
              floorId: selectedFloorId,
              asset: importedAsset,
              scale: normalizedScale(first.pageIndex),
              planScaleNeedsCalibration: !pageScales.get(first.pageIndex),
            },
          })
          commands.push({
            id: 'floor.rename',
            input: {
              floorId: selectedFloorId,
              name: getImportedFloorName(first.pageIndex),
            },
          })
          wallScanTargetSpecs.push({
            pageIndex: first.pageIndex,
            floorId: selectedFloorId,
            imageSize: importedAsset,
            offset: getFloorById(selectedFloorId)?.planImageOffset,
          })
          firstImportedFloorId = selectedFloorId
        } else {
          const activeFloor = activeFloorId ? getFloorById(activeFloorId) : null
          const fallbackEmptyFloor =
            readLegacyCompatibilityFloors(currentProject).find((floor: Floor) =>
              isFloorEmptyForAutoReplace(floor)
            ) ?? null
          const floorToReuse = isFloorEmptyForAutoReplace(activeFloor)
            ? activeFloor
            : fallbackEmptyFloor
          const reuseActiveFloor = !!floorToReuse
          const orderedAssets = [...normalizedWithBackground].sort(
            (a, b) => a.pageIndex - b.pageIndex
          )
          const referenceAssetForAlignment = orderedAssets[0]

          if (reuseActiveFloor && floorToReuse) {
            const first = orderedAssets.shift()
            if (first) {
              const firstAsset = createPlanImportAsset(first, {
                isReferenceCrop: true,
                planImageOffset: getCadCropOffset(first, referenceAssetForAlignment),
              })
              const firstFactor = firstAsset.width / first.width
              const planImageOffset = getCadCropOffset(first, referenceAssetForAlignment)
                ? scalePlanPoint(getCadCropOffset(first, referenceAssetForAlignment)!, firstFactor)
                : undefined
              commands.push({
                id: 'plan.attachBackground',
                input: {
                  floorId: floorToReuse.id,
                  asset: firstAsset,
                  planImageOffset,
                  scale: normalizedScale(first.pageIndex),
                  planScaleNeedsCalibration: !pageScales.get(first.pageIndex),
                },
              })
              wallScanTargetSpecs.push({
                pageIndex: first.pageIndex,
                floorId: floorToReuse.id,
                imageSize: firstAsset,
                offset: planImageOffset,
              })
              firstImportedFloorId = floorToReuse.id
            }
          }

          for (const [index, pageAsset] of orderedAssets.entries()) {
            const importedAsset = createPlanImportAsset(pageAsset, {
              isReferenceCrop: !reuseActiveFloor && index === 0,
              planImageOffset: getCadCropOffset(pageAsset, referenceAssetForAlignment),
            })
            const originalOffset = getCadCropOffset(pageAsset, referenceAssetForAlignment)
            const planImageOffset = originalOffset
              ? scalePlanPoint(originalOffset, importedAsset.width / pageAsset.width)
              : undefined
            const commandIndex = commands.length
            commands.push({
              id: 'floor.create',
              input: {
                name: getImportedFloorName(pageAsset.pageIndex),
                scale: normalizedScale(pageAsset.pageIndex),
                planScaleNeedsCalibration: !pageScales.get(pageAsset.pageIndex),
                planImageOffset,
                asset: importedAsset,
              },
            })
            wallScanTargetSpecs.push({
              pageIndex: pageAsset.pageIndex,
              commandIndex,
              imageSize: importedAsset,
              offset: planImageOffset,
            })
          }
        }

        if (commands.length === 0) return
        const outcome = liveProjectSession.execute(commands, {
          expectedRevision,
          label: 'import PDF plan',
          source: 'plan_import',
        })
        const resolvedWallScanTargets: WallScanTarget[] = []
        for (const spec of wallScanTargetSpecs) {
          const floorId =
            spec.floorId ??
            outcome.results[spec.commandIndex!]?.created.find((ref) => ref.kind === 'floor')?.id
          if (!floorId) {
            logger.warn('[planImport] PDF import omitted a created floor result:', {
              pageIndex: spec.pageIndex,
            })
            continue
          }
          resolvedWallScanTargets.push({
            pageIndex: spec.pageIndex,
            floorId,
            imageSize: spec.imageSize,
            ...(spec.offset ? { offset: spec.offset } : {}),
          })
        }
        for (const target of resolvedWallScanTargets) addWallScanTarget(target)
        if (firstImportedFloorId) setActiveFloor(firstImportedFloorId)
        else {
          const createdFloor = outcome.results
            .flatMap((result) => result.created)
            .find((ref) => ref.kind === 'floor')
          if (createdFloor) setActiveFloor(createdFloor.id)
        }

        if (scansWalls) {
          useWallScanStore.getState().attach(currentProject.project.id, wallScanTargets)
        }
        schedulePlanFitToViewAfterImport()
        handleClose()
        clearProjectHistory()
        saveProjectAfterImport()
      } catch (error) {
        logger.error('[planImport] Plan import failed:', error)
        setImportError(t(
          error instanceof CommandError && error.details?.reason === 'collab_too_large'
            ? 'planImport.collabTooLarge'
            : 'planImport.importFailed'
        ))
      } finally {
        setIsApplyingPdfImport(false)
      }
    },
    [
      currentProject,
      file,
      pdfPages,
      selectedPdfPages,
      pdfDestinationMode,
      selectedFloorId,
      pdfPageCropMap,
      pdfPageCroppedPreviewMap,
      applyPdfScaleToAll,
      pdfScalePerPage,
      pdfScaleSkippedPages,
      pdfConvertCadToGrayscale,
      isApplyingPdfImport,
      isCadMultiCropImport,
      cadImportPipeline,
      cadImportPipelinesByPage,
      activeFloorId,
      getFloorById,
      isFloorEmptyForAutoReplace,
      loadImageDimensions,
      setActiveFloor,
      t,
      handleClose,
      saveProjectAfterImport,
      setIsApplyingPdfImport,
      setImportError,
    ]
  )

  return { handlePdfImport }
}
