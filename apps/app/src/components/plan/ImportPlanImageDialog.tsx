import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/stores/projectStore'
import { clearProjectHistory } from '@/stores/slices/projectStoreHistory'
import { useUIStore } from '@/stores/uiStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useDialogStore } from '@/stores/dialogStore'
import { nanoid } from 'nanoid'
import type { Circuit, Floor, Note, Panel, Placement, Point2 } from '@/types/schema'
import ImageCropper from './ImageCropper'
import ScaleRuler from './ScaleRuler'
import { logger } from '@/lib/logger'
import {
  processPlanImage,
  applyDarkModeInversion,
  invertSvgForDarkMode,
  grayscaleSvgColors,
  processPdfRasterBackground,
  svgHasMeaningfulColor,
  svgContentToDataUrl,
  getVectorSvgThemePreviewUrl,
  getRasterThemePreviewUrl,
  svgHasUnresolvedEmbeddedImages,
  cropImageDataUrl,
} from '@/utils/planImageProcessing'
import type { PlanImageProcessingResult } from '@/utils/planImageProcessing'
import {
  parsePdfFile,
  normalizePdfPageAsset,
  mapPreviewCropToPageCrop,
  mapPdfScaleReferenceToAsset,
  type PdfImportCropBox,
  type PdfImportPageCandidate,
} from '@/lib/plan/pdfImport'
import { parseDwgFile, parseDxfFile, parseSvgFile, type CadParseResult } from '@/lib/plan/dxfImport'
import {
  applyCadLayerVisibility,
  getInitiallyHiddenCadLayers,
  isCadForegroundColor,
  mergeCadLayers,
} from '@/lib/plan/cadLayers'
import {
  attachCadReferenceToPlanImportAsset,
  buildCadReferenceForFloorImport,
  defaultCropInAssetSpace,
  type CadImportPipelineContext,
} from '@/lib/plan/cadReferenceBuilder'
import {
  resolveDefaultImportFloorId,
  schedulePlanFitToViewAfterImport,
  shouldShowPdfDestinationOptions,
} from './planImportFloor'
import CustomDropdown from '@/components/common/CustomDropdown'
import { querySitplanNotes } from '@/lib/projectV2/annotations'
import { readLegacyCompatibilityFloors, selectProjectPlanScale } from '@/lib/projectV2/buildingFloors'
import { DEFAULT_PLAN_PX_PER_METER, resolvePlanPxPerMeter, createPlanScaleReference } from '@/lib/plan/planScale'
import { rescaleImportedPlanAsset, scalePlanPoint } from '@/lib/plan/rescalePlan'
import { selectProjectElectricalPanels } from '@/lib/projectV2/electrical'
import {
  isRasterPlanImportFile,
  isSupportedPlanImportFile,
  PLAN_IMPORT_FILE_ACCEPT,
} from './planImportFiles'
import { isFloorplanScanEnabled } from '@/lib/vision/availability'
import { PlanWallRecognitionError, recognizePlanWalls } from '@/lib/vision/recognizePlanWalls'
import { recognizedWallsToFloorPlan } from '@/lib/plan/recognizedWalls'
import type { VisionPlanGeometryMode, VisionPlanReviewPage } from '@/lib/vision/visionReviewApi'

// Component to show processed image with dark mode preview
function ProcessedImagePreview({
  processedDataUrl,
  isDarkMode,
}: {
  processedDataUrl: string
  isDarkMode: boolean
}) {
  const [previewUrl, setPreviewUrl] = useState<string>(processedDataUrl)

  useEffect(() => {
    if (isDarkMode) {
      applyDarkModeInversion(processedDataUrl)
        .then((inverted) => setPreviewUrl(inverted))
        .catch(() => setPreviewUrl(processedDataUrl))
    } else {
      setPreviewUrl(processedDataUrl)
    }
  }, [processedDataUrl, isDarkMode])

  return <img src={previewUrl} alt="Processed" className="max-w-full max-h-full mx-auto" />
}

interface ImportPlanImageDialogProps {
  isOpen: boolean
  onClose: () => void
  initialFile?: File | null
}

type ImportStep =
  | 'upload'
  | 'crop'
  | 'scale'
  | 'background'
  | 'floor'
  | 'pdfPages'
  | 'pdfCrop'
  | 'pdfScale'
  | 'pdfBackground'

async function parseRasterImageFile(file: File): Promise<{
  fileName: string
  pages: PdfImportPageCandidate[]
  warnings: string[]
}> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to read image file'))
        return
      }
      resolve(reader.result)
    }
    reader.onerror = () => reject(new Error('Failed to read image file'))
    reader.readAsDataURL(file)
  })

  const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.width, height: img.height })
    img.onerror = () => reject(new Error('Failed to decode image file'))
    img.src = dataUrl
  })

  return {
    fileName: file.name,
    pages: [
      {
        pageIndex: 0,
        pageCount: 1,
        width: dimensions.width,
        height: dimensions.height,
        previewDataUrl: dataUrl,
        rasterDataUrl: dataUrl,
        warnings: [],
      },
    ],
    warnings: [],
  }
}

function ImportPlanImageDialog({
  isOpen,
  onClose,
  initialFile = null,
}: ImportPlanImageDialogProps) {
  const { t } = useTranslation()
  const currentProject = useProjectStore((state) => state.currentProject)
  const addFloor = useProjectStore((state) => state.addFloor)
  const updateFloor = useProjectStore((state) => state.updateFloor)
  const getFloorById = useProjectStore((state) => state.getFloorById)
  const activeFloorId = useUIStore((state) => state.activeFloorId)
  const setActiveFloor = useUIStore((state) => state.setActiveFloor)
  const theme = useSettingsStore((state) => state.theme)

  const [step, setStep] = useState<ImportStep>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [croppedImageDataUrl, setCroppedImageDataUrl] = useState<string | null>(null)
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null)
  const [newFloorName, setNewFloorName] = useState('')
  const [createNewFloor, setCreateNewFloor] = useState(false)
  const [scaleReference, setScaleReference] = useState<{
    p1: Point2
    p2: Point2
    meters: number
  } | null>(null)
  const [, setCropBox] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null
  )
  const [processingResult, setProcessingResult] = useState<PlanImageProcessingResult | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [enableBackgroundProcessing, setEnableBackgroundProcessing] = useState(true)
  const [pdfPages, setPdfPages] = useState<PdfImportPageCandidate[]>([])
  const [selectedPdfPages, setSelectedPdfPages] = useState<number[]>([])
  const [isParsingPdf, setIsParsingPdf] = useState(false)
  const [pdfParseProgress, setPdfParseProgress] = useState(0)
  const [pdfWarnings, setPdfWarnings] = useState<string[]>([])
  const [pdfPageCropMap, setPdfPageCropMap] = useState<Record<number, PdfImportCropBox>>({})
  const [pdfPageCroppedPreviewMap, setPdfPageCroppedPreviewMap] = useState<Record<number, string>>(
    {}
  )
  const [pdfPageThemePreviewMap, setPdfPageThemePreviewMap] = useState<Record<number, string>>({})
  const [pdfPageRasterThemePreviewMap, setPdfPageRasterThemePreviewMap] = useState<
    Record<number, string>
  >({})
  const [cropEditingPageIndex, setCropEditingPageIndex] = useState<number | null>(null)
  const [cadHiddenLayers, setCadHiddenLayers] = useState<ReadonlySet<string>>(() => new Set())
  const cadLayerRevisionRef = useRef(0)
  const [pdfDestinationMode, setPdfDestinationMode] = useState<
    'replace-floor' | 'new-floor-per-page'
  >('new-floor-per-page')
  const [applyPdfScaleToAll, setApplyPdfScaleToAll] = useState(true)
  const [pdfScalePerPage, setPdfScalePerPage] = useState<
    Record<number, { p1: Point2; p2: Point2; meters: number } | null>
  >({})
  const [pdfScaleSkippedPages, setPdfScaleSkippedPages] = useState<Record<number, true>>({})
  const [pdfScaleRulerRevision, setPdfScaleRulerRevision] = useState(0)
  const pdfScaleReady = selectedPdfPages.length > 0 && (applyPdfScaleToAll
    ? [selectedPdfPages.slice().sort((a, b) => a - b)[0]!]
    : selectedPdfPages).every((pageIndex) => {
      if (pdfScaleSkippedPages[pageIndex]) return true
      const reference = pdfScalePerPage[pageIndex]
      return !!reference && !!createPlanScaleReference(reference.p1, reference.p2, reference.meters)
    })
  const [pdfScaleCurrentPageIndex, setPdfScaleCurrentPageIndex] = useState<number | null>(null)
  const [isApplyingPdfImport, setIsApplyingPdfImport] = useState(false)
  const [recognizeWalls, setRecognizeWalls] = useState(false)
  const [scanMethod, setScanMethod] = useState<VisionPlanGeometryMode>('hybrid')
  const [isRecognizingWalls, setIsRecognizingWalls] = useState(false)
  const [recognitionError, setRecognitionError] = useState<string | null>(null)
  const [pdfEnableDarkModeProcessing, setPdfEnableDarkModeProcessing] = useState(true)
  const [pdfConvertCadToGrayscale, setPdfConvertCadToGrayscale] = useState(false)
  const [pdfPreviewPageIndex, setPdfPreviewPageIndex] = useState<number | null>(null)
  const [pdfPreviewOriginalUrl, setPdfPreviewOriginalUrl] = useState<string | null>(null)
  const [pdfPreviewProcessedUrl, setPdfPreviewProcessedUrl] = useState<string | null>(null)
  const [pdfPreviewDarkUrl, setPdfPreviewDarkUrl] = useState<string | null>(null)
  const [pdfPreviewHasWhiteBackground, setPdfPreviewHasWhiteBackground] = useState(false)
  const [isPreparingPdfPreview, setIsPreparingPdfPreview] = useState(false)
  const [pdfImportError, setPdfImportError] = useState<string | null>(null)
  const [cadImportPipeline, setCadImportPipeline] = useState<CadImportPipelineContext | null>(null)
  const [cadImportPipelinesByPage, setCadImportPipelinesByPage] = useState<
    Record<number, CadImportPipelineContext>
  >({})

  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const pasteHandlerRef = useRef<((e: ClipboardEvent) => void) | null>(null)
  const handledInitialFileRef = useRef<File | null>(null)

  const floors = useMemo(
    () => (currentProject ? readLegacyCompatibilityFloors(currentProject) : []),
    [currentProject]
  )
  const currentFileName = file?.name.toLowerCase() ?? ''
  const isCadMultiCropImport = currentFileName.endsWith('.dwg') || currentFileName.endsWith('.dxf')
  const isPdfImport = currentFileName.endsWith('.pdf')
  const isSvgImport = currentFileName.endsWith('.svg')
  const allowDuplicatePage = !isPdfImport || pdfPages.length === 1
  const showPdfDestinationOptions = shouldShowPdfDestinationOptions(
    currentFileName,
    pdfPages.length
  )
  const isDarkMode = theme.mode === 'dark'
  const importPreviewSurfaceClass = isDarkMode ? 'bg-gray-900' : 'bg-gray-50'
  const shouldInvertCadByTheme = isCadMultiCropImport && isDarkMode
  const shouldInvertPreviewForPage = useCallback(
    () => shouldInvertCadByTheme,
    [shouldInvertCadByTheme]
  )

  const getPdfPagePreviewUrl = useCallback(
    (page: PdfImportPageCandidate): string => {
      const themed = pdfPageThemePreviewMap[page.pageIndex]
      if (themed) return themed
      // Dark CAD lines are invisible on the dark surface; wait for the themed copy.
      if (shouldInvertCadByTheme) return ''
      const cropped = pdfPageCroppedPreviewMap[page.pageIndex]
      if (cropped) return cropped
      if (page.vectorSvg && !svgHasUnresolvedEmbeddedImages(page.vectorSvg)) {
        return svgContentToDataUrl(page.vectorSvg)
      }
      return page.previewDataUrl
    },
    [pdfPageThemePreviewMap, pdfPageCroppedPreviewMap, shouldInvertCadByTheme]
  )

  const getPdfPageRasterPreviewUrl = useCallback(
    (page: PdfImportPageCandidate): string => {
      const themedRaster = pdfPageRasterThemePreviewMap[page.pageIndex]
      if (themedRaster) return themedRaster
      if (shouldInvertCadByTheme) return ''
      return pdfPageCroppedPreviewMap[page.pageIndex] ?? page.rasterDataUrl
    },
    [pdfPageRasterThemePreviewMap, pdfPageCroppedPreviewMap, shouldInvertCadByTheme]
  )
  const getPdfRasterThemePreviewUrl = useCallback(
    async (dataUrl: string, darkMode: boolean): Promise<string> => {
      if (darkMode) return applyDarkModeInversion(dataUrl)
      const processed = await processPdfRasterBackground(dataUrl)
      return processed.hasWhiteBackground ? processed.processedDataUrl : dataUrl
    },
    []
  )
  useEffect(() => {
    if ((!isPdfImport && !isCadMultiCropImport) || pdfPages.length === 0) {
      setPdfPageThemePreviewMap({})
      setPdfPageRasterThemePreviewMap({})
      return
    }
    let cancelled = false
    ;(async () => {
      const thumbEntries = await Promise.all(
        pdfPages.map(async (page) => {
          const cropped = pdfPageCroppedPreviewMap[page.pageIndex]
          if (cropped) {
            return [
              page.pageIndex,
              isPdfImport
                ? await getPdfRasterThemePreviewUrl(cropped, isDarkMode)
                : await getRasterThemePreviewUrl(cropped, isDarkMode),
            ] as const
          }
          if (page.vectorSvg && !svgHasUnresolvedEmbeddedImages(page.vectorSvg)) {
            return [
              page.pageIndex,
              await getVectorSvgThemePreviewUrl(page.vectorSvg, isDarkMode),
            ] as const
          }
          return [
            page.pageIndex,
            isPdfImport
              ? await getPdfRasterThemePreviewUrl(page.previewDataUrl, isDarkMode)
              : isDarkMode
                ? await getRasterThemePreviewUrl(page.previewDataUrl, isDarkMode)
                : page.previewDataUrl,
          ] as const
        })
      )
      if (cancelled) return
      // Publish thumbnails first; full-size raster theming can take seconds per page.
      const thumbMap = Object.fromEntries(thumbEntries)
      setPdfPageThemePreviewMap(thumbMap)
      const rasterEntries = await Promise.all(
        pdfPages.map(async (page) => {
          const cropped = pdfPageCroppedPreviewMap[page.pageIndex]
          const themedVector = thumbMap[page.pageIndex]
          if (isCadMultiCropImport && !cropped && page.vectorSvg && themedVector) {
            // The themed SVG has the page's own size, so it serves the scale step
            // without a per-pixel inversion pass.
            return [page.pageIndex, themedVector] as const
          }
          const raster = cropped ?? page.rasterDataUrl
          if (!isDarkMode) return [page.pageIndex, raster] as const
          return [
            page.pageIndex,
            isPdfImport
              ? await getPdfRasterThemePreviewUrl(raster, isDarkMode)
              : await getRasterThemePreviewUrl(raster, isDarkMode),
          ] as const
        })
      )
      if (!cancelled) setPdfPageRasterThemePreviewMap(Object.fromEntries(rasterEntries))
    })()
    return () => {
      cancelled = true
    }
  }, [
    isPdfImport,
    isCadMultiCropImport,
    pdfPages,
    pdfPageCroppedPreviewMap,
    isDarkMode,
    getPdfRasterThemePreviewUrl,
  ])

  const selectedCadHasMeaningfulColor = useMemo(() => {
    if (!isCadMultiCropImport) return true
    return pdfPages
      .filter((page) => selectedPdfPages.includes(page.pageIndex))
      .some((page) => page.vectorSvg && svgHasMeaningfulColor(page.vectorSvg))
  }, [isCadMultiCropImport, pdfPages, selectedPdfPages])

  const getPdfPageStatus = useCallback(
    (page: PdfImportPageCandidate): 'vector' | 'raster' | 'mixed' => {
      if (!page.vectorSvg) return 'raster'
      if (isCadMultiCropImport) return 'vector'
      if (page.hasEmbeddedRasterImages || svgHasUnresolvedEmbeddedImages(page.vectorSvg))
        return 'mixed'
      return page.warnings.length > 0 ? 'mixed' : 'vector'
    },
    [isCadMultiCropImport]
  )

  // Pre-select target floor: current plan floor, else ground floor, else first floor.
  useEffect(() => {
    if (!isOpen || floors.length === 0) return
    const needsFloorSelection =
      step === 'floor' || (step === 'pdfPages' && pdfDestinationMode === 'replace-floor')
    if (!needsFloorSelection) return

    setSelectedFloorId((current) => {
      if (current && floors.some((floor: Floor) => floor.id === current)) return current
      return resolveDefaultImportFloorId(floors, activeFloorId)
    })
  }, [isOpen, step, pdfDestinationMode, floors, activeFloorId])

  // Handle file selection
  const handleFileSelect = useCallback(
    (selectedFile: File) => {
      const lowerName = selectedFile.name.toLowerCase()
      if (!isSupportedPlanImportFile(selectedFile)) {
        alert(t('planImport.invalidFileType'))
        return
      }
      const isPdf = selectedFile.type === 'application/pdf' || lowerName.endsWith('.pdf')
      const isDxf = lowerName.endsWith('.dxf')
      const isDwg = lowerName.endsWith('.dwg')
      const isSvg = selectedFile.type === 'image/svg+xml' || lowerName.endsWith('.svg')
      const isPngJpeg =
        selectedFile.type === 'image/png' ||
        selectedFile.type === 'image/jpeg' ||
        /\.(png|jpe?g)$/i.test(lowerName)

      if (isPdf || isDxf || isDwg || isSvg || isPngJpeg) {
        setFile(selectedFile)
        setStep('pdfPages')
        setIsParsingPdf(true)
        setPdfParseProgress(5)
        setPdfWarnings([])
        setPdfImportError(null)
        let cancelled = false
        let progressValue = 5
        const progressTimer = window.setInterval(() => {
          if (cancelled) return
          progressValue = Math.min(92, progressValue + 6)
          setPdfParseProgress(progressValue)
        }, 180)
        const parsePromise = isDxf
          ? parseDxfFile(selectedFile)
          : isDwg
            ? parseDwgFile(selectedFile)
            : isSvg
              ? parseSvgFile(selectedFile)
              : isPngJpeg
                ? parseRasterImageFile(selectedFile)
                : parsePdfFile(selectedFile, { maxPages: 20 })
        parsePromise
          .then((result) => {
            if (cancelled) return
            if (result.warnings.length > 0) {
              logger.info('Import warnings:', {
                file: selectedFile.name,
                type: isDxf
                  ? 'dxf'
                  : isDwg
                    ? 'dwg'
                    : isSvg
                      ? 'svg'
                      : isPngJpeg
                        ? 'image'
                        : isPdf
                          ? 'pdf'
                          : 'unknown',
                warnings: result.warnings,
              })
            }
            setPdfPages(result.pages)
            setCadHiddenLayers(getInitiallyHiddenCadLayers(result.pages))
            setSelectedPdfPages(result.pages.map((page) => page.pageIndex))
            setPdfWarnings([])
            setPdfImportError(null)
            setCadImportPipeline(
              isDxf || isDwg ? ((result as CadParseResult).cadImportPipeline ?? null) : null
            )
            setCadImportPipelinesByPage(
              isDxf || isDwg ? ((result as CadParseResult).cadImportPipelinesByPage ?? {}) : {}
            )
            if (isDxf) {
              // DXF drawings commonly come through with dark single-color strokes.
              // Start in grayscale mode for better contrast/readability.
              setPdfConvertCadToGrayscale(true)
            }
            setPdfParseProgress(100)
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : ''
            setPdfPages([])
            setSelectedPdfPages([])
            setPdfWarnings([])
            setPdfImportError(
              isDxf
                ? `${t('planImport.invalidDxfFile')}${message ? `: ${message}` : ''}`
                : isDwg
                  ? `${t('planImport.invalidDwgFile')}${message ? `: ${message}` : ''}`
                  : isSvg
                    ? `${t('planImport.invalidSvgFile')}${message ? `: ${message}` : ''}`
                    : isPngJpeg
                      ? `${t('planImport.invalidFileType')}${message ? `: ${message}` : ''}`
                      : `${t('planImport.invalidPdfFile')}${message ? `: ${message}` : ''}`
            )
          })
          .finally(() => {
            cancelled = true
            window.clearInterval(progressTimer)
            setIsParsingPdf(false)
          })
        return
      }

      if (isRasterPlanImportFile(selectedFile)) {
        setFile(selectedFile)
        const reader = new FileReader()
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string
          setImageDataUrl(dataUrl)
          setStep('crop')
        }
        reader.readAsDataURL(selectedFile)
        return
      }
    },
    [t]
  )

  useEffect(() => {
    if (!isOpen) {
      handledInitialFileRef.current = null
      return
    }
    if (!initialFile || handledInitialFileRef.current === initialFile) return
    handledInitialFileRef.current = initialFile
    handleFileSelect(initialFile)
  }, [handleFileSelect, initialFile, isOpen])

  // Handle drag and drop
  useEffect(() => {
    if (!isOpen || !dropZoneRef.current) return

    const dropZone = dropZoneRef.current

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dropZone.classList.add('border-sky-500', 'bg-sky-50', 'dark:bg-sky-900/20')
    }

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dropZone.classList.remove('border-sky-500', 'bg-sky-50', 'dark:bg-sky-900/20')
    }

    const handleDrop = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dropZone.classList.remove('border-sky-500', 'bg-sky-50', 'dark:bg-sky-900/20')

      const files = e.dataTransfer?.files
      const droppedFile = files?.item(0)
      if (droppedFile) {
        handleFileSelect(droppedFile)
      }
    }

    dropZone.addEventListener('dragover', handleDragOver)
    dropZone.addEventListener('dragleave', handleDragLeave)
    dropZone.addEventListener('drop', handleDrop)

    return () => {
      dropZone.removeEventListener('dragover', handleDragOver)
      dropZone.removeEventListener('dragleave', handleDragLeave)
      dropZone.removeEventListener('drop', handleDrop)
    }
  }, [isOpen, handleFileSelect])

  // Handle paste
  useEffect(() => {
    if (!isOpen) return

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return

      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (!item) continue
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) {
            handleFileSelect(file)
            break
          }
        }
      }
    }

    window.addEventListener('paste', handlePaste)
    pasteHandlerRef.current = handlePaste

    return () => {
      if (pasteHandlerRef.current) {
        window.removeEventListener('paste', pasteHandlerRef.current)
      }
    }
  }, [isOpen, handleFileSelect])

  // Handle crop completion
  const handleCropComplete = useCallback(
    (cropped: string, crop: { x: number; y: number; width: number; height: number }) => {
      setCroppedImageDataUrl(cropped)
      setCropBox(crop)
      setStep('scale')
    },
    []
  )

  // Process image for background removal (without dark mode inversion - that's done dynamically)
  const handleProcessImage = useCallback(async (imageUrl: string) => {
    setIsProcessing(true)
    try {
      // Process without dark mode inversion - we'll apply that dynamically when rendering
      const result = await processPlanImage(imageUrl, false)
      setProcessingResult(result)
    } catch (error) {
      logger.error('Failed to process image:', error)
      // If processing fails, use original image
      setProcessingResult({
        processedDataUrl: imageUrl,
        hasWhiteBackground: false,
        originalDataUrl: imageUrl,
      })
    } finally {
      setIsProcessing(false)
    }
  }, [])

  // Handle scale completion
  const handleScaleComplete = useCallback(
    (reference: { p1: Point2; p2: Point2; meters: number }) => {
      setScaleReference(reference)
      setStep('background')
      // Start processing when moving to background step
      if (croppedImageDataUrl) {
        handleProcessImage(croppedImageDataUrl)
      }
    },
    [croppedImageDataUrl, handleProcessImage]
  )

  // Handle skip scale
  const handleSkipScale = useCallback(() => {
    setScaleReference(null)
    setStep('background')
    // Start processing when moving to background step
    if (croppedImageDataUrl) {
      handleProcessImage(croppedImageDataUrl)
    }
  }, [croppedImageDataUrl, handleProcessImage])

  // Handle background processing completion
  const handleBackgroundComplete = useCallback(() => {
    setStep('floor')
  }, [])

  // Reset state
  const handleClose = useCallback(() => {
    setStep('upload')
    setFile(null)
    setImageDataUrl(null)
    setCroppedImageDataUrl(null)
    setSelectedFloorId(null)
    setNewFloorName('')
    setCreateNewFloor(false)
    setScaleReference(null)
    setCropBox(null)
    setProcessingResult(null)
    setEnableBackgroundProcessing(true)
    setIsProcessing(false)
    setPdfPages([])
    setSelectedPdfPages([])
    setIsParsingPdf(false)
    setPdfParseProgress(0)
    setPdfWarnings([])
    setPdfPageCropMap({})
    setPdfPageCroppedPreviewMap({})
    setPdfPageThemePreviewMap({})
    setPdfPageRasterThemePreviewMap({})
    setCropEditingPageIndex(null)
    setCadHiddenLayers(new Set())
    setPdfDestinationMode('new-floor-per-page')
    setApplyPdfScaleToAll(true)
    setPdfScalePerPage({})
    setPdfScaleSkippedPages({})
    setPdfScaleRulerRevision(0)
    setPdfScaleCurrentPageIndex(null)
    setIsApplyingPdfImport(false)
    setRecognizeWalls(false)
    setIsRecognizingWalls(false)
    setRecognitionError(null)
    setPdfEnableDarkModeProcessing(true)
    setPdfConvertCadToGrayscale(false)
    setPdfPreviewPageIndex(null)
    setPdfPreviewOriginalUrl(null)
    setPdfPreviewProcessedUrl(null)
    setPdfPreviewDarkUrl(null)
    setPdfPreviewHasWhiteBackground(false)
    setIsPreparingPdfPreview(false)
    setPdfImportError(null)
    setCadImportPipeline(null)
    setCadImportPipelinesByPage({})
    onClose()
  }, [onClose])

  const saveProjectAfterImport = useCallback(() => {
    const save = () => {
      const { saveCurrentProject } = useProjectStore.getState()
      void saveCurrentProject().catch((error: unknown) => {
        logger.error('[planImport] Failed to save imported plan:', error)
        useDialogStore.getState().openDialog({
          type: 'info',
          title: t('planImport.saveFailedTitle'),
          message: t('planImport.saveFailed'),
          variant: 'error',
        })
      })
    }

    // Let React paint the closed dialog before serializing/uploading a large PDF.
    window.setTimeout(save, 0)
  }, [t])

  const loadImageDimensions = useCallback(
    (dataUrl: string): Promise<{ width: number; height: number }> => {
      return new Promise<{ width: number; height: number }>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve({ width: img.width, height: img.height })
        img.onerror = () => reject(new Error('Failed to load preview image'))
        img.src = dataUrl
      })
    },
    []
  )

  // Handle final import
  const handleImport = useCallback(async () => {
    if (!currentProject || !croppedImageDataUrl) return
    if (isRecognizingWalls) return
    if (createNewFloor && !newFloorName.trim()) {
      alert(t('planImport.floorNameRequired'))
      return
    }

    // Use processed image if available and enabled, otherwise use original
    const finalImageDataUrl =
      enableBackgroundProcessing && processingResult?.processedDataUrl
        ? processingResult.processedDataUrl
        : croppedImageDataUrl
    const imageDimensions = await loadImageDimensions(finalImageDataUrl).catch(() => null)
    const targetPxPerMeter = resolvePlanPxPerMeter(selectProjectPlanScale(currentProject)) ?? DEFAULT_PLAN_PX_PER_METER
    const measuredPxPerMeter = resolvePlanPxPerMeter({ reference: scaleReference ?? undefined })
    const factor = measuredPxPerMeter ? targetPxPerMeter / measuredPxPerMeter : 1
    const imageWidth = (imageDimensions?.width ?? 1) * factor
    const imageHeight = (imageDimensions?.height ?? 1) * factor
    const importedScale: Floor['scale'] = { pxPerMeter: targetPxPerMeter, reference: scaleReference && measuredPxPerMeter ? createPlanScaleReference(scalePlanPoint(scaleReference.p1, factor), scalePlanPoint(scaleReference.p2, factor), scaleReference.meters) ?? undefined : undefined }
    let recognizedPage: VisionPlanReviewPage | null = null
    if (recognizeWalls && isFloorplanScanEnabled()) {
      setIsRecognizingWalls(true)
      setRecognitionError(null)
      try {
        recognizedPage = await recognizePlanWalls(croppedImageDataUrl, file?.name ?? 'plan', scanMethod)
      } catch (error) {
        setRecognitionError(t(error instanceof PlanWallRecognitionError
          ? error.translationKey : 'planImport.recognitionFailed'))
        return
      } finally {
        setIsRecognizingWalls(false)
      }
    }

    const hasWhiteBackground = processingResult?.hasWhiteBackground ?? false

    let targetFloorId = selectedFloorId

    // Create new floor if needed
    if (createNewFloor) {
      const newFloor: Floor = {
        id: nanoid(),
        name: newFloorName.trim(),
        planAsset: croppedImageDataUrl, // Always store original
        planAssetProcessed:
          enableBackgroundProcessing && processingResult?.processedDataUrl
            ? processingResult.processedDataUrl
            : undefined,
        planAssetHasWhiteBackground: hasWhiteBackground,
        planImageOpacity: recognizedPage ? 30 : undefined,
        planImportAsset: {
          id: nanoid(),
          kind: 'raster',
          width: imageWidth,
          height: imageHeight,
          dataUrl: croppedImageDataUrl,
          processedDataUrl:
            enableBackgroundProcessing && processingResult?.processedDataUrl
              ? processingResult.processedDataUrl
              : undefined,
          hasWhiteBackground,
          darkModeAware: enableBackgroundProcessing && hasWhiteBackground,
        },
        scale: importedScale,
        planScaleNeedsCalibration: !measuredPxPerMeter,
      }
      if (recognizedPage) {
        newFloor.floorPlan = recognizedWallsToFloorPlan(
          recognizedPage, newFloor.id, { width: imageWidth, height: imageHeight }
        )
      }

      addFloor(newFloor)
      targetFloorId = newFloor.id
      setActiveFloor(newFloor.id)
    } else if (targetFloorId) {
      // Update existing floor
      const floor = getFloorById(targetFloorId)
      if (floor) {
        updateFloor(targetFloorId, {
          planAsset: croppedImageDataUrl, // Always store original
          planAssetProcessed:
            enableBackgroundProcessing && processingResult?.processedDataUrl
              ? processingResult.processedDataUrl
              : undefined,
          planAssetHasWhiteBackground: hasWhiteBackground,
          ...(recognizedPage ? {
            planImageOpacity: 30,
            floorPlan: recognizedWallsToFloorPlan(
              recognizedPage, targetFloorId, { width: imageWidth, height: imageHeight },
              floor.planImageOffset, floor.floorPlan
            ),
          } : {}),
          planImportAsset: {
            id: nanoid(),
            kind: 'raster',
            width: imageWidth,
            height: imageHeight,
            dataUrl: croppedImageDataUrl,
            processedDataUrl:
              enableBackgroundProcessing && processingResult?.processedDataUrl
                ? processingResult.processedDataUrl
                : undefined,
            hasWhiteBackground,
            darkModeAware: enableBackgroundProcessing && hasWhiteBackground,
          },
          // Existing vector geometry is already absolute in this floor's scale.
          // Keep floor scale unchanged when importing/replacing the image.
          scale: importedScale,
          planScaleNeedsCalibration: !measuredPxPerMeter,
        })
        setActiveFloor(targetFloorId)
      }
    }

    schedulePlanFitToViewAfterImport()

    // The project mutation is complete. Close immediately and persist in the background.
    setStep('upload')
    setFile(null)
    setImageDataUrl(null)
    setCroppedImageDataUrl(null)
    setSelectedFloorId(null)
    setNewFloorName('')
    setCreateNewFloor(false)
    setScaleReference(null)
    setCropBox(null)
    setProcessingResult(null)
    setEnableBackgroundProcessing(true)
    setIsProcessing(false)
    onClose()
    clearProjectHistory()
    saveProjectAfterImport()
  }, [
    currentProject,
    croppedImageDataUrl,
    file,
    recognizeWalls,
    scanMethod,
    isRecognizingWalls,
    selectedFloorId,
    createNewFloor,
    newFloorName,
    scaleReference,
    processingResult,
    enableBackgroundProcessing,
    addFloor,
    updateFloor,
    getFloorById,
    setActiveFloor,
    t,
    onClose,
    loadImageDimensions,
    saveProjectAfterImport,
  ])

  const isFloorEmptyForAutoReplace = useCallback(
    (floor: Floor | null | undefined) => {
      if (!floor || !currentProject) return false
      const mainPanel = selectProjectElectricalPanels(currentProject).find(
        (panel: Panel) => panel.isMain
      )
      const mainPanelId = mainPanel?.id
      const mainPanelName = mainPanel?.name
      const hasFloorPlanData = !!(
        floor.floorPlan &&
        (floor.floorPlan.walls.length > 0 ||
          floor.floorPlan.doors.length > 0 ||
          floor.floorPlan.windows.length > 0)
      )
      const hasAsset = !!(floor.planAsset || floor.planImportAsset)
      const hasNotes = querySitplanNotes(currentProject).some(
        (note: Note) => note.floorId === floor.id
      )
      const hasPlacements = selectProjectElectricalPanels(currentProject).some((panel: Panel) => {
        const checkPanel = (p: Panel): boolean => {
          for (const endpoint of p.circuits.flatMap((circuit: Circuit) => circuit.endpoints)) {
            const hasMeaningfulPlacement = endpoint.placements.some((placement: Placement) => {
              if (placement.floorId !== floor.id) return false
              const isMainPanelPlacement =
                endpoint.symbol === 'panel_distribution' &&
                ((mainPanelId != null && endpoint.panelId === mainPanelId) ||
                  (mainPanelName != null && endpoint.label === mainPanelName))
              return !isMainPanelPlacement
            })
            if (hasMeaningfulPlacement) return true
          }
          for (const protection of p.protections) {
            for (const circuit of protection.circuits ?? []) {
              for (const endpoint of circuit.endpoints) {
                const hasMeaningfulPlacement = endpoint.placements.some((placement: Placement) => {
                  if (placement.floorId !== floor.id) return false
                  const isMainPanelPlacement =
                    endpoint.symbol === 'panel_distribution' &&
                    ((mainPanelId != null && endpoint.panelId === mainPanelId) ||
                      (mainPanelName != null && endpoint.label === mainPanelName))
                  return !isMainPanelPlacement
                })
                if (hasMeaningfulPlacement) return true
              }
            }
          }
          for (const subPanel of p.subPanels) {
            if (checkPanel(subPanel)) return true
          }
          return false
        }
        return checkPanel(panel)
      })
      return !hasFloorPlanData && !hasAsset && !hasNotes && !hasPlacements
    },
    [currentProject]
  )


  const handlePdfImport = useCallback(
    async (skipScale: boolean = false) => {
      if (!currentProject || !file) return
      if (isApplyingPdfImport) return
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
            if (!pdfEnableDarkModeProcessing) {
              return {
                ...asset,
                processedDataUrl: undefined,
                hasWhiteBackground: false,
                darkModeAware: false,
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

        const recognizedByPage = new Map<number, VisionPlanReviewPage>()
        if (recognizeWalls && !isCadMultiCropImport && isFloorplanScanEnabled()) {
          setRecognitionError(null)
          for (const asset of normalizedWithBackground) {
            if (!asset.dataUrl) throw new Error(t('planImport.recognitionFailed'))
            recognizedByPage.set(
              asset.pageIndex,
              await recognizePlanWalls(asset.dataUrl, `${file.name}-${asset.pageIndex + 1}`, scanMethod)
            )
          }
        }

        const orderedSelectedPages = [...selectedPages].sort((a, b) => a.pageIndex - b.pageIndex)
        const firstSelectedPage = orderedSelectedPages[0]
        const firstSelectedReference = firstSelectedPage
          ? pdfScalePerPage[firstSelectedPage.pageIndex]
          : undefined
        const computeImportedScale = async (
          sourcePage: PdfImportPageCandidate | undefined,
          importedAsset: { dataUrl?: string | undefined; pageIndex: number; width: number; height: number },
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
          return mapPdfScaleReferenceToAsset(sourceReference, sourceImageSizeForScale, importedAsset)
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
        const targetPxPerMeter = resolvePlanPxPerMeter(selectProjectPlanScale(currentProject)) ?? DEFAULT_PLAN_PX_PER_METER
        const pageScales = new Map<number, Awaited<ReturnType<typeof computeImportedScale>>>()
        for (const page of selectedPages) {
          pageScales.set(page.pageIndex, applyPdfScaleToAll ? firstScaleForReference : await getPerPageScale(page))
        }
        const normalizedScale = (pageIndex: number): Floor['scale'] => {
          const calibration = pageScales.get(pageIndex)
          if (!calibration) return { pxPerMeter: targetPxPerMeter }
          const factor = targetPxPerMeter / calibration.pxPerMeter
          return { pxPerMeter: targetPxPerMeter, reference: applyPdfScaleToAll && pageIndex !== firstSelectedPage?.pageIndex ? undefined : createPlanScaleReference(
            scalePlanPoint(calibration.reference.p1, factor),
            scalePlanPoint(calibration.reference.p2, factor), calibration.reference.meters,
          ) ?? undefined }
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
            const referenceRect = toCadRect(referencePipeline, pdfPageCropMap[referenceAsset.pageIndex])
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
          if (!isCadMultiCropImport || !sourcePipeline || !sourcePage) return rescaleImportedPlanAsset(base, factor)
          const sharesReferencePipeline =
            sourcePipeline === getCadPipeline(referenceSourcePage?.pageIndex)
          const cadReference = buildCadReferenceForFloorImport({
            pipeline: sourcePipeline,
            uncroppedPageSize: { width: sourcePage.width, height: sourcePage.height },
            crop: pdfPageCropMap[sourcePage.pageIndex],
            isReferenceCrop: options.isReferenceCrop,
            referenceCropAssetRect:
              options.isReferenceCrop || !sharesReferencePipeline ? undefined : referenceCropInAssetSpace,
            planImageOffset: options.planImageOffset,
          })
          return rescaleImportedPlanAsset(attachCadReferenceToPlanImportAsset(base, cadReference), factor)
        }

        if (pdfDestinationMode === 'replace-floor') {
          if (!selectedFloorId) {
            alert(t('planImport.selectFloorOption'))
            return
          }
          const first = normalizedWithBackground[0]
          if (!first) return
          updateFloor(selectedFloorId, {
            name: getImportedFloorName(first.pageIndex),
            planAsset: first.dataUrl,
            planAssetProcessed: first.processedDataUrl,
            planAssetHasWhiteBackground: first.hasWhiteBackground,
            ...(recognizedByPage.has(first.pageIndex) ? {
              planImageOpacity: 30,
              floorPlan: recognizedWallsToFloorPlan(
                recognizedByPage.get(first.pageIndex)!, selectedFloorId,
                createPlanImportAsset(first, { isReferenceCrop: true }),
                getFloorById(selectedFloorId)?.planImageOffset,
                getFloorById(selectedFloorId)?.floorPlan
              ),
            } : {}),
            planImportAsset: createPlanImportAsset(first, { isReferenceCrop: true }),
            scale: normalizedScale(first.pageIndex),
            planScaleNeedsCalibration: !pageScales.get(first.pageIndex),
          })
          setActiveFloor(selectedFloorId)
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
          let firstImportedFloorId: string | null = null

          if (reuseActiveFloor && floorToReuse) {
            const first = orderedAssets.shift()
            if (first) {
              const firstAsset = createPlanImportAsset(first, { isReferenceCrop: true, planImageOffset: getCadCropOffset(first, referenceAssetForAlignment) })
              const firstFactor = firstAsset.width / first.width
              updateFloor(floorToReuse.id, {
                // Reusing the initial empty floor must preserve its identity and
                // numbering. Renaming floor 1 to floor 2 made a two-crop import
                // appear to contain floors 2 and 3 with floor 1 missing.
                name: floorToReuse.name,
                planAsset: first.dataUrl,
                planAssetProcessed: first.processedDataUrl,
                planAssetHasWhiteBackground: first.hasWhiteBackground,
                ...(recognizedByPage.has(first.pageIndex) ? {
                  planImageOpacity: 30,
                  floorPlan: recognizedWallsToFloorPlan(
                    recognizedByPage.get(first.pageIndex)!, floorToReuse.id,
                    firstAsset,
                    getCadCropOffset(first, referenceAssetForAlignment) ? scalePlanPoint(getCadCropOffset(first, referenceAssetForAlignment)!, firstFactor) : undefined, floorToReuse.floorPlan
                  ),
                } : {}),
                planImportAsset: createPlanImportAsset(first, {
                  isReferenceCrop: true,
                  planImageOffset: getCadCropOffset(first, referenceAssetForAlignment),
                }),
                planImageOffset: getCadCropOffset(first, referenceAssetForAlignment) ? scalePlanPoint(getCadCropOffset(first, referenceAssetForAlignment)!, firstFactor) : undefined,
                scale: normalizedScale(first.pageIndex),
                planScaleNeedsCalibration: !pageScales.get(first.pageIndex),
              })
              firstImportedFloorId = floorToReuse.id
            }
          }

          for (const [index, pageAsset] of orderedAssets.entries()) {
            const importedAsset = createPlanImportAsset(pageAsset, { isReferenceCrop: !reuseActiveFloor && index === 0, planImageOffset: getCadCropOffset(pageAsset, referenceAssetForAlignment) })
            const originalOffset = getCadCropOffset(pageAsset, referenceAssetForAlignment)
            const planImageOffset = originalOffset ? scalePlanPoint(originalOffset, importedAsset.width / pageAsset.width) : undefined
            const newFloor: Floor = {
              id: nanoid(),
              name: getImportedFloorName(pageAsset.pageIndex),
              planAsset: pageAsset.dataUrl,
              planAssetProcessed: pageAsset.processedDataUrl,
              planAssetHasWhiteBackground: pageAsset.hasWhiteBackground,
              planImageOpacity: recognizedByPage.has(pageAsset.pageIndex) ? 30 : undefined,
              planImportAsset: importedAsset,
              planImageOffset,
              scale: normalizedScale(pageAsset.pageIndex),
              planScaleNeedsCalibration: !pageScales.get(pageAsset.pageIndex),
            }
            const recognizedPage = recognizedByPage.get(pageAsset.pageIndex)
            if (recognizedPage) {
              newFloor.floorPlan = recognizedWallsToFloorPlan(
                recognizedPage, newFloor.id,
                importedAsset, planImageOffset
              )
            }
            addFloor(newFloor)
            if (!firstImportedFloorId) firstImportedFloorId = newFloor.id
          }
          if (firstImportedFloorId) setActiveFloor(firstImportedFloorId)
        }

        schedulePlanFitToViewAfterImport()
        handleClose()
        clearProjectHistory()
        saveProjectAfterImport()
      } catch (error) {
        setRecognitionError(t(error instanceof PlanWallRecognitionError
          ? error.translationKey : 'planImport.recognitionFailed'))
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
      pdfEnableDarkModeProcessing,
      pdfConvertCadToGrayscale,
      isApplyingPdfImport,
      recognizeWalls,
      scanMethod,
      isCadMultiCropImport,
      cadImportPipeline,
      cadImportPipelinesByPage,
      addFloor,
      updateFloor,
      activeFloorId,
      getFloorById,
      isFloorEmptyForAutoReplace,
      loadImageDimensions,
      setActiveFloor,
      t,
      handleClose,
      saveProjectAfterImport,
    ]
  )

  const croppedPageCount = useMemo(() => Object.keys(pdfPageCropMap).length, [pdfPageCropMap])
  const cadLayerList = useMemo(() => mergeCadLayers(pdfPages), [pdfPages])

  const handleToggleCadLayer = useCallback(
    (layerName: string) => {
      const nextHidden = new Set(cadHiddenLayers)
      if (nextHidden.has(layerName)) nextHidden.delete(layerName)
      else nextHidden.add(layerName)
      setCadHiddenLayers(nextHidden)
      const nextPages = pdfPages.map((page) => applyCadLayerVisibility(page, nextHidden))
      setPdfPages(nextPages)

      // Cropped thumbnails are raster snapshots; rebuild them from the filtered drawing.
      const revision = ++cadLayerRevisionRef.current
      const changedCroppedPages = nextPages.filter(
        (page, index) => page !== pdfPages[index] && pdfPageCropMap[page.pageIndex]
      )
      if (changedCroppedPages.length === 0) return
      void Promise.all(
        changedCroppedPages.map(
          async (page) =>
            [
              page.pageIndex,
              await cropImageDataUrl(page.rasterDataUrl, pdfPageCropMap[page.pageIndex]!, page),
            ] as const
        )
      )
        .then((entries) => {
          if (revision !== cadLayerRevisionRef.current) return
          setPdfPageCroppedPreviewMap((prev) => ({ ...prev, ...Object.fromEntries(entries) }))
        })
        .catch((error) => logger.error('[planImport] Failed to refresh cropped CAD preview:', error))
    },
    [cadHiddenLayers, pdfPages, pdfPageCropMap]
  )

  const handleTogglePdfPageSelection = useCallback(
    (pageIndex: number) => {
      setSelectedPdfPages((prev) => {
        if (pdfDestinationMode === 'replace-floor') {
          return prev.includes(pageIndex) ? [] : [pageIndex]
        }
        return prev.includes(pageIndex)
          ? prev.filter((idx) => idx !== pageIndex)
          : [...prev, pageIndex]
      })
    },
    [pdfDestinationMode]
  )

  const handleDuplicateCadPage = useCallback(() => {
    if (!allowDuplicatePage || pdfPages.length === 0) return
    setPdfPages((prev) => {
      const source = prev[0]
      if (!source) return prev
      const nextPageIndex = Math.max(...prev.map((page) => page.pageIndex)) + 1
      const nextPageCount = prev.length + 1
      const duplicate: PdfImportPageCandidate = {
        ...source,
        pageIndex: nextPageIndex,
        pageCount: nextPageCount,
        warnings: [...source.warnings],
      }
      return [...prev.map((page) => ({ ...page, pageCount: nextPageCount })), duplicate]
    })
    setSelectedPdfPages((prev) => {
      const nextPageIndex = Math.max(...pdfPages.map((page) => page.pageIndex)) + 1
      return prev.includes(nextPageIndex) ? prev : [...prev, nextPageIndex]
    })
  }, [allowDuplicatePage, pdfPages])

  const handlePdfCropComplete = useCallback(
    async (cropped: string, crop: { x: number; y: number; width: number; height: number }) => {
      if (cropEditingPageIndex == null) return
      const page = pdfPages.find((p) => p.pageIndex === cropEditingPageIndex)
      if (!page) return
      const previewImg = new Image()
      await new Promise<void>((resolve, reject) => {
        previewImg.onload = () => resolve()
        previewImg.onerror = () => reject(new Error('preview load error'))
        previewImg.src = page.rasterDataUrl
      })
      setPdfPageCropMap((prev) => ({
        ...prev,
        [cropEditingPageIndex]: mapPreviewCropToPageCrop(
          crop,
          { width: previewImg.width, height: previewImg.height },
          { width: page.width, height: page.height }
        ),
      }))
      setPdfPageCroppedPreviewMap((prev) => ({
        ...prev,
        [cropEditingPageIndex]: cropped,
      }))
      setPdfScalePerPage((prev) => {
        if (!prev[cropEditingPageIndex]) return prev
        const next = { ...prev }
        delete next[cropEditingPageIndex]
        return next
      })
      setStep('pdfPages')
      setCropEditingPageIndex(null)
    },
    [cropEditingPageIndex, pdfPages]
  )

  const handlePdfScaleComplete = useCallback(
    (reference: { p1: Point2; p2: Point2; meters: number }) => {
      const orderedSelected = selectedPdfPages.slice().sort((a, b) => a - b)
      const currentPage = pdfScaleCurrentPageIndex ?? orderedSelected[0]
      if (currentPage == null) return
      setPdfScalePerPage((prev) => ({
        ...prev,
        [currentPage]: reference,
      }))
      if (!applyPdfScaleToAll) {
        const currentIndex = orderedSelected.findIndex((pageIndex) => pageIndex === currentPage)
        const nextPage = currentIndex >= 0 ? orderedSelected[currentIndex + 1] : undefined
        if (nextPage != null) setPdfScaleCurrentPageIndex(nextPage)
      }
    },
    [selectedPdfPages, pdfScaleCurrentPageIndex, applyPdfScaleToAll]
  )

  const handlePdfScaleSkip = useCallback(() => {
    const orderedSelected = selectedPdfPages.slice().sort((a, b) => a - b)
    const currentPage = pdfScaleCurrentPageIndex ?? orderedSelected[0]
    if (currentPage == null) return
    setPdfScaleSkippedPages((prev) => ({ ...prev, [currentPage]: true }))
    if (applyPdfScaleToAll) {
      setStep('pdfBackground')
      return
    }
    const currentIndex = orderedSelected.findIndex((pageIndex) => pageIndex === currentPage)
    const nextPage = currentIndex >= 0 ? orderedSelected[currentIndex + 1] : undefined
    if (nextPage != null) setPdfScaleCurrentPageIndex(nextPage)
    else if (orderedSelected.every((index) => {
      const reference = pdfScalePerPage[index]
      return index === currentPage || pdfScaleSkippedPages[index] || (reference && createPlanScaleReference(reference.p1, reference.p2, reference.meters))
    })) setStep('pdfBackground')
  }, [selectedPdfPages, pdfScaleCurrentPageIndex, applyPdfScaleToAll, pdfScalePerPage, pdfScaleSkippedPages])

  const handlePdfScaleReferenceChange = useCallback(
    (pageIndex: number | null, reference: { p1: Point2; p2: Point2; meters: number } | null) => {
      if (pageIndex == null) return
      if (reference && createPlanScaleReference(reference.p1, reference.p2, reference.meters)) {
        setPdfScaleSkippedPages((prev) => {
          if (!prev[pageIndex]) return prev
          const next = { ...prev }
          delete next[pageIndex]
          return next
        })
      }
      setPdfScalePerPage((prev) => {
        const current = prev[pageIndex]
        if (!reference) {
          if (!current) return prev
          return { ...prev, [pageIndex]: null }
        }
        const isSame =
          !!current &&
          current.meters === reference.meters &&
          current.p1.x === reference.p1.x &&
          current.p1.y === reference.p1.y &&
          current.p2.x === reference.p2.x &&
          current.p2.y === reference.p2.y
        if (isSame) return prev
        return {
          ...prev,
          [pageIndex]: reference,
        }
      })
    },
    []
  )

  const getDefaultScaleReferenceForPage = useCallback(
    (
      page: PdfImportPageCandidate | undefined
    ): { p1: Point2; p2: Point2; meters: number } | null => {
      if (!page) return null
      const crop = pdfPageCropMap[page.pageIndex]
      if (isCadMultiCropImport && page.scaleMetersPerPixel) {
        const width = crop?.width ?? page.width
        const height = crop?.height ?? page.height
        if (width > 0 && height > 0) {
          const p1 = { x: width * 0.25, y: height * 0.5 }
          const p2 = { x: width * 0.75, y: height * 0.5 }
          const meters = Math.abs(p2.x - p1.x) * page.scaleMetersPerPixel
          if (Number.isFinite(meters) && meters > 0) {
            return { p1, p2, meters: Number(meters.toPrecision(6)) }
          }
        }
      }
      if (page.scaleReference && !crop) return page.scaleReference
      return null
    },
    [isCadMultiCropImport, pdfPageCropMap]
  )

  useEffect(() => {
    if (step !== 'pdfBackground' || !file) return
    const selected = selectedPdfPages.slice().sort((a, b) => a - b)
    const pageIndex = pdfPreviewPageIndex ?? selected[0] ?? null
    if (pageIndex == null) return
    const page = pdfPages.find((candidate) => candidate.pageIndex === pageIndex)
    if (!page) return

    let cancelled = false
    setIsPreparingPdfPreview(true)

    normalizePdfPageAsset(page, file.name, pdfPageCropMap[pageIndex])
      .then(async (asset) => {
        if (cancelled) return
        let sourceUrl =
          asset.kind === 'pdf-vector' && asset.svgContent
            ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(asset.svgContent)}`
            : (asset.dataUrl ?? page.rasterDataUrl)

        let processedUrl = sourceUrl
        let darkUrl = sourceUrl
        let hasWhiteBackground = false

        if (asset.kind === 'pdf-vector') {
          const originalSvg = asset.svgContent ?? ''
          const processedSvg =
            isCadMultiCropImport || isSvgImport ? grayscaleSvgColors(originalSvg) : originalSvg
          if (isCadMultiCropImport) {
            sourceUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(originalSvg)}`
            processedUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(processedSvg)}`
            darkUrl = processedUrl
          } else {
            processedUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(processedSvg)}`
            const darkSvg = await invertSvgForDarkMode(processedSvg)
            darkUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(darkSvg)}`
          }
        } else if (asset.kind === 'pdf-raster' && sourceUrl) {
          const processed = await processPdfRasterBackground(sourceUrl)
          processedUrl = processed.hasWhiteBackground ? processed.processedDataUrl : sourceUrl
          darkUrl = pdfEnableDarkModeProcessing
            ? await applyDarkModeInversion(sourceUrl)
            : processedUrl
          hasWhiteBackground = processed.hasWhiteBackground
        } else if (sourceUrl) {
          const processed = await processPlanImage(sourceUrl, false)
          hasWhiteBackground = processed.hasWhiteBackground
          processedUrl = processed.hasWhiteBackground ? processed.processedDataUrl : sourceUrl
          darkUrl = processed.hasWhiteBackground
            ? await applyDarkModeInversion(processed.processedDataUrl)
            : sourceUrl
        }

        if (cancelled) return
        setPdfPreviewPageIndex(pageIndex)
        setPdfPreviewOriginalUrl(sourceUrl)
        setPdfPreviewProcessedUrl(processedUrl)
        setPdfPreviewDarkUrl(darkUrl)
        setPdfPreviewHasWhiteBackground(hasWhiteBackground)
      })
      .catch(() => {
        if (cancelled) return
        setPdfPreviewOriginalUrl(page.previewDataUrl)
        setPdfPreviewProcessedUrl(page.previewDataUrl)
        setPdfPreviewDarkUrl(page.previewDataUrl)
        setPdfPreviewHasWhiteBackground(false)
      })
      .finally(() => {
        if (!cancelled) setIsPreparingPdfPreview(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    step,
    file,
    pdfPages,
    pdfPageCropMap,
    selectedPdfPages,
    pdfPreviewPageIndex,
    isCadMultiCropImport,
    isSvgImport,
    pdfEnableDarkModeProcessing,
  ])

  if (!isOpen) return null

  // Determine dialog size based on step
  const dialogSize =
    step === 'crop' ||
    step === 'scale' ||
    step === 'background' ||
    step === 'pdfCrop' ||
    step === 'pdfPages' ||
    step === 'pdfScale' ||
    step === 'pdfBackground'
      ? 'max-w-6xl w-full'
      : 'max-w-4xl w-full'

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      data-testid="e2e-import-plan-dialog"
    >
      <div
        className={`bg-white dark:bg-gray-800 rounded-md shadow-2xl ${dialogSize} max-h-[95vh] min-h-0 overflow-hidden flex flex-col`}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            {t('planImport.title')}
          </h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div
          className={`flex-1 min-h-0 ${step === 'crop' || step === 'scale' || step === 'background' || step === 'pdfScale' || step === 'pdfBackground' ? 'overflow-hidden' : 'overflow-y-auto'} p-6 flex flex-col`}
        >
          {step === 'upload' && (
            <div className="space-y-4">
              <p className="text-gray-600 dark:text-gray-400">
                {t('planImport.uploadDescription')}
              </p>

              {/* Drop zone */}
              <div
                ref={dropZoneRef}
                className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-md p-12 text-center cursor-pointer hover:border-sky-400 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <svg
                  className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500"
                  stroke="currentColor"
                  fill="none"
                  viewBox="0 0 48 48"
                >
                  <path
                    d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <p className="mt-4 text-lg font-medium text-gray-700 dark:text-gray-300">
                  {t('planImport.dragDropOrClick')}
                </p>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                  {t('planImport.orPaste')}
                </p>
                <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                  {t('planImport.supportedFormats')}
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept={PLAN_IMPORT_FILE_ACCEPT}
                className="hidden"
                data-testid="e2e-import-plan-file-input"
                onChange={(e) => {
                  const selectedFile = e.target.files?.[0]
                  if (selectedFile) {
                    handleFileSelect(selectedFile)
                  }
                }}
              />
            </div>
          )}

          {step === 'crop' && imageDataUrl && (
            <ImageCropper
              imageDataUrl={imageDataUrl}
              onCropComplete={handleCropComplete}
              onBack={() => setStep('upload')}
              surfaceClassName={importPreviewSurfaceClass}
            />
          )}

          {step === 'scale' && croppedImageDataUrl && (
            <ScaleRuler
              autoCreateInitialReference
              imageDataUrl={croppedImageDataUrl}
              onScaleComplete={handleScaleComplete}
              onSkip={handleSkipScale}
              onCancel={() => setStep('crop')}
              surfaceClassName={importPreviewSurfaceClass}
            />
          )}

          {step === 'background' && croppedImageDataUrl && (
            <div className="flex-1 flex flex-col space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  {t('planImport.backgroundProcessing')}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  {t('planImport.backgroundProcessingDescription')}
                </p>
              </div>

              {isProcessing ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-sky-600 mb-4"></div>
                    <p className="text-gray-600 dark:text-gray-400">{t('planImport.processing')}</p>
                  </div>
                </div>
              ) : processingResult ? (
                <div className="flex-1 flex flex-col space-y-6">
                  {processingResult.hasWhiteBackground ? (
                    <>
                      <div className="bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 rounded-md p-4">
                        <div className="flex items-start gap-3">
                          <svg
                            className="w-5 h-5 text-sky-600 dark:text-sky-400 mt-0.5 flex-shrink-0"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                          </svg>
                          <div>
                            <p className="text-sm font-medium text-sky-900 dark:text-sky-200">
                              {t('planImport.whiteBackgroundDetected')}
                            </p>
                            <p className="text-sm text-sky-700 dark:text-sky-300 mt-1">
                              {t('planImport.whiteBackgroundDetectedDescription')}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-4">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={enableBackgroundProcessing}
                            onChange={(e) => setEnableBackgroundProcessing(e.target.checked)}
                            className="w-4 h-4 text-sky-600 rounded"
                          />
                          <span className="text-gray-700 dark:text-gray-300">
                            {t('planImport.enableBackgroundProcessing')}
                          </span>
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
                        <div className="flex flex-col">
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            {t('planImport.original')}
                          </p>
                          <div className="flex-1 border border-gray-200 dark:border-gray-700 rounded-md p-4 bg-white dark:bg-gray-900 overflow-auto">
                            <img
                              src={processingResult.originalDataUrl}
                              alt="Original"
                              className="max-w-full max-h-full mx-auto"
                            />
                          </div>
                        </div>
                        <div className="flex flex-col">
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            {t('planImport.processed')}
                            {theme.mode === 'dark' && (
                              <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                                (inverted for dark mode)
                              </span>
                            )}
                          </p>
                          <div className="flex-1 border border-gray-200 dark:border-gray-700 rounded-md p-4 bg-gray-100 dark:bg-gray-800 overflow-auto">
                            <ProcessedImagePreview
                              processedDataUrl={processingResult.processedDataUrl}
                              isDarkMode={theme.mode === 'dark'}
                            />
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700 rounded-md p-4">
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {t('planImport.noWhiteBackground')}
                      </p>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {step === 'floor' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  {t('planImport.selectFloor')}
                </h3>

                <div className="space-y-4">
                  <label className="flex items-center gap-3">
                    <input
                      type="radio"
                      checked={!createNewFloor}
                      onChange={() => setCreateNewFloor(false)}
                      className="w-4 h-4 text-sky-600"
                    />
                    <span className="text-gray-700 dark:text-gray-300">
                      {t('planImport.existingFloor')}
                    </span>
                  </label>

                  {!createNewFloor && (
                    <CustomDropdown
                      value={selectedFloorId || ''}
                      onChange={(nextValue) => setSelectedFloorId(nextValue || null)}
                      options={[
                        { value: '', label: t('planImport.selectFloorOption') },
                        ...floors.map((floor: Floor) => ({ value: floor.id, label: floor.name })),
                      ]}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  )}

                  <label className="flex items-center gap-3">
                    <input
                      type="radio"
                      checked={createNewFloor}
                      onChange={() => setCreateNewFloor(true)}
                      className="w-4 h-4 text-sky-600"
                    />
                    <span className="text-gray-700 dark:text-gray-300">
                      {t('planImport.createNewFloor')}
                    </span>
                  </label>

                  {createNewFloor && (
                    <input
                      type="text"
                      value={newFloorName}
                      onChange={(e) => setNewFloorName(e.target.value)}
                      placeholder={t('planImport.floorNamePlaceholder')}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  )}
                </div>
              </div>

              {isFloorplanScanEnabled() && (
                <div className="space-y-2">
                  <label className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
                    <input type="checkbox" checked={recognizeWalls}
                      onChange={(event) => setRecognizeWalls(event.target.checked)}
                      disabled={isRecognizingWalls} />
                    <span>{t('planImport.recognizeWalls')}</span>
                  </label>
                  {recognizeWalls && (
                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                      <span>{t('planImport.scanMethod')}</span>
                      <select value={scanMethod} onChange={(event) => setScanMethod(event.target.value as VisionPlanGeometryMode)}
                        disabled={isRecognizingWalls}
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
                        <option value="hybrid">{t('planImport.scanHybrid')}</option>
                        <option value="yolo">{t('planImport.scanYolo')}</option>
                        <option value="luna">{t('planImport.scanLuna')}</option>
                      </select>
                    </label>
                  )}
                </div>
              )}

              {/* Preview */}
              {(enableBackgroundProcessing && processingResult?.processedDataUrl
                ? processingResult.processedDataUrl
                : croppedImageDataUrl) && (
                <div className="border border-gray-200 dark:border-gray-700 rounded-md p-4">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('planImport.preview')}
                  </p>
                  <img
                    src={
                      enableBackgroundProcessing && processingResult?.processedDataUrl
                        ? processingResult.processedDataUrl
                        : croppedImageDataUrl || ''
                    }
                    alt="Preview"
                    className="max-w-full max-h-64 mx-auto rounded"
                  />
                </div>
              )}
            </div>
          )}

          {step === 'pdfPages' && (
            <div className="space-y-4">
              {pdfImportError ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  {pdfImportError}
                </div>
              ) : (
                <>
                  <p className="text-gray-600 dark:text-gray-400">
                    {t('planImport.pdfSelectPages')}
                  </p>
                  {isParsingPdf && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm text-gray-600 dark:text-gray-300">
                        <span>{t('planImport.processingPdf')}</span>
                        <span>{pdfParseProgress}%</span>
                      </div>
                      <div className="h-2 rounded bg-gray-200 dark:bg-gray-700 overflow-hidden">
                        <div
                          className="h-full bg-sky-600 transition-all duration-150"
                          style={{ width: `${pdfParseProgress}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {pdfWarnings.length > 0 && (
                    <div className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded p-3">
                      {pdfWarnings.map((warning) => (
                        <div key={warning}>{warning}</div>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedPdfPages(pdfPages.map((page) => page.pageIndex))}
                      className="px-3 py-2 text-sm text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                    >
                      {t('planImport.selectAllPages')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedPdfPages([])}
                      className="px-3 py-2 text-sm text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                    >
                      {t('planImport.clearAllPages')}
                    </button>
                    <div className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400">
                      {t('planImport.croppedPages', { count: croppedPageCount })}
                    </div>
                  </div>
                  {cadLayerList.length > 0 && (
                    <details className="rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                      <summary className="cursor-pointer select-none px-3 py-2 text-sm text-gray-700 dark:text-gray-200">
                        {t('planImport.cadLayers')}
                        <span className="ml-2 text-gray-500 dark:text-gray-400">
                          {cadLayerList.filter((layer) => !cadHiddenLayers.has(layer.name)).length}/
                          {cadLayerList.length}
                        </span>
                      </summary>
                      <div
                        data-app-scroll="true"
                        className="grid max-h-48 grid-cols-1 gap-x-4 gap-y-1 overflow-y-auto border-t border-gray-200 px-3 py-2 dark:border-gray-700 sm:grid-cols-2 md:grid-cols-3"
                      >
                        {cadLayerList.map((layer) => (
                          <label key={layer.name} className="flex min-w-0 items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={!cadHiddenLayers.has(layer.name)}
                              onChange={() => handleToggleCadLayer(layer.name)}
                            />
                            <span
                              aria-hidden="true"
                              className={`h-3 w-3 shrink-0 rounded-sm border border-gray-300 dark:border-gray-600 ${
                                isCadForegroundColor(layer.color) ? 'bg-gray-900 dark:bg-gray-100' : ''
                              }`}
                              style={
                                isCadForegroundColor(layer.color)
                                  ? undefined
                                  : { backgroundColor: layer.color }
                              }
                            />
                            <span
                              className="truncate text-gray-700 dark:text-gray-300"
                              title={layer.name}
                            >
                              {layer.name}
                            </span>
                          </label>
                        ))}
                      </div>
                    </details>
                  )}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-h-[50vh] overflow-y-auto">
                    {pdfPages.map((page) => (
                      <div
                        key={page.pageIndex}
                        className="border border-gray-200 dark:border-gray-700 rounded-md p-2 bg-white dark:bg-gray-900"
                      >
                        <label className="flex items-center gap-2 mb-2">
                          <input
                            type="checkbox"
                            checked={selectedPdfPages.includes(page.pageIndex)}
                            onChange={() => handleTogglePdfPageSelection(page.pageIndex)}
                          />
                          <span className="text-sm text-gray-700 dark:text-gray-300">
                            {page.label ?? t('planImport.pageLabel', { page: page.pageIndex + 1 })}
                          </span>
                        </label>
                        <div
                          className={`flex h-32 w-full items-center justify-center overflow-hidden rounded ${importPreviewSurfaceClass}`}
                        >
                          {getPdfPagePreviewUrl(page) && (
                            <img
                              src={getPdfPagePreviewUrl(page)}
                              alt={`Page ${page.pageIndex + 1}`}
                              className="h-full w-full object-contain"
                            />
                          )}
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                          {(!isPdfImport || page.vectorSvg) && (
                            <span>
                              {getPdfPageStatus(page) === 'vector'
                                ? t('planImport.vectorPreferred')
                                : getPdfPageStatus(page) === 'mixed'
                                  ? t('common.mixed')
                                  : t('planImport.rasterFallback')}
                            </span>
                          )}
                          {pdfPageCropMap[page.pageIndex] && (
                            <span>{t('planImport.croppedBadge')}</span>
                          )}
                        </div>
                        {!page.vectorSvg && page.warnings.length > 0 && (
                          <p
                            className="mt-1 text-[11px] text-amber-700 dark:text-amber-300 line-clamp-2"
                            title={page.warnings[0]}
                          >
                            {page.warnings[0]}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setCropEditingPageIndex(page.pageIndex)
                            setStep('pdfCrop')
                          }}
                          className="mt-2 w-full px-2 py-1 text-xs text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                        >
                          {t('planImport.cropPage')}
                        </button>
                        {pdfPageCropMap[page.pageIndex] && (
                          <button
                            type="button"
                            onClick={() => {
                              setPdfPageCropMap((prev) => {
                                const next = { ...prev }
                                delete next[page.pageIndex]
                                return next
                              })
                              setPdfPageCroppedPreviewMap((prev) => {
                                if (!prev[page.pageIndex]) return prev
                                const next = { ...prev }
                                delete next[page.pageIndex]
                                return next
                              })
                              setPdfScalePerPage((prev) => {
                                if (!prev[page.pageIndex]) return prev
                                const next = { ...prev }
                                delete next[page.pageIndex]
                                return next
                              })
                            }}
                            className="mt-1 w-full px-2 py-1 text-xs text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                          >
                            {t('planImport.resetPageCrop')}
                          </button>
                        )}
                      </div>
                    ))}
                    {allowDuplicatePage && (
                      <button
                        type="button"
                        onClick={handleDuplicateCadPage}
                        className="flex min-h-[13.5rem] flex-col items-center justify-center rounded-md border border-dashed border-gray-300 bg-white p-2 text-gray-700 hover:border-sky-400 hover:text-sky-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-sky-500 dark:hover:text-sky-300"
                      >
                        <span className="text-5xl leading-none" aria-hidden="true">
                          +
                        </span>
                        <span className="mt-3 text-sm font-medium">
                          {t('planImport.duplicateFloor')}
                        </span>
                      </button>
                    )}
                  </div>
                  {showPdfDestinationOptions && (
                    <div className="space-y-3 border border-gray-200 dark:border-gray-700 rounded-md p-4">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {t('planImport.pdfDestination')}
                      </p>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          checked={pdfDestinationMode === 'new-floor-per-page'}
                          onChange={() => setPdfDestinationMode('new-floor-per-page')}
                        />
                        <span className="text-sm text-gray-700 dark:text-white">
                          {t('planImport.newFloorPerPage')}
                        </span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          checked={pdfDestinationMode === 'replace-floor'}
                          onChange={() => {
                            setPdfDestinationMode('replace-floor')
                            setSelectedPdfPages((prev) => {
                              const firstPage = prev[0]
                              return firstPage == null ? [] : [firstPage]
                            })
                            setSelectedFloorId(
                              (current) =>
                                current ?? resolveDefaultImportFloorId(floors, activeFloorId)
                            )
                          }}
                        />
                        <span className="text-sm text-gray-700 dark:text-white">
                          {t('planImport.replaceSelectedFloor')}
                        </span>
                      </label>
                      {pdfDestinationMode === 'replace-floor' && (
                        <CustomDropdown
                          value={selectedFloorId || ''}
                          onChange={(nextValue) => setSelectedFloorId(nextValue || null)}
                          options={[
                            { value: '', label: t('planImport.selectFloorOption') },
                            ...floors.map((floor: Floor) => ({
                              value: floor.id,
                              label: floor.name,
                            })),
                          ]}
                          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {step === 'pdfCrop' && cropEditingPageIndex != null && (
            <ImageCropper
              imageDataUrl={
                pdfPages.find((page) => page.pageIndex === cropEditingPageIndex)?.rasterDataUrl ??
                ''
              }
              onCropComplete={handlePdfCropComplete}
              onBack={() => {
                setStep('pdfPages')
                setCropEditingPageIndex(null)
              }}
              invertPreview={
                cropEditingPageIndex != null &&
                (() => {
                  const page = pdfPages.find(
                    (candidate) => candidate.pageIndex === cropEditingPageIndex
                  )
                  return page ? shouldInvertPreviewForPage() : false
                })()
              }
              surfaceClassName={importPreviewSurfaceClass}
            />
          )}

          {step === 'pdfScale' &&
            (() => {
              const orderedSelected = selectedPdfPages.slice().sort((a, b) => a - b)
              const firstSelected = orderedSelected[0]
              const currentPageIndex = applyPdfScaleToAll
                ? (firstSelected ?? null)
                : (pdfScaleCurrentPageIndex ?? firstSelected ?? null)
              const scalePage =
                currentPageIndex != null
                  ? pdfPages.find((page) => page.pageIndex === currentPageIndex)
                  : undefined
              if (!scalePage || currentPageIndex == null) return null
              const currentPageIndexValue = currentPageIndex
              const currentPosition = orderedSelected.findIndex(
                (pageIndex) => pageIndex === currentPageIndex
              )
              const hasPrev = currentPosition > 0
              const hasNext = currentPosition >= 0 && currentPosition < orderedSelected.length - 1
              const scaledCount = orderedSelected.filter(
                (pageIndex) => {
                  const reference = pdfScalePerPage[pageIndex]
                  return !pdfScaleSkippedPages[pageIndex] && reference && createPlanScaleReference(reference.p1, reference.p2, reference.meters)
                }
              ).length
              const currentScaleReference =
                currentPageIndexValue in pdfScalePerPage
                  ? pdfScalePerPage[currentPageIndexValue]
                  : getDefaultScaleReferenceForPage(scalePage)
              const scaleReferenceChangeHandler = (
                reference: { p1: Point2; p2: Point2; meters: number } | null
              ) => {
                handlePdfScaleReferenceChange(currentPageIndexValue, reference)
              }
              return (
                <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
                  <div className="flex-shrink-0 space-y-3 border border-gray-200 dark:border-gray-700 rounded-md p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {pdfPages.find((page) => page.pageIndex === currentPageIndexValue)?.label ??
                          t('planImport.pageLabel', { page: currentPageIndexValue + 1 })}
                      </p>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {t('planImport.scaledPagesCount', {
                          count: scaledCount,
                          total: orderedSelected.length,
                        })}
                      </span>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                      <input
                        type="checkbox"
                        checked={applyPdfScaleToAll}
                        onChange={(e) => {
                          const checked = e.target.checked
                          setApplyPdfScaleToAll(checked)
                          if (checked) {
                            // Shared mode always reflects page 1 reference.
                            setPdfScaleCurrentPageIndex(firstSelected ?? null)
                          } else if (pdfScaleCurrentPageIndex == null) {
                            // Keep current page if set; otherwise fall back to first selected.
                            setPdfScaleCurrentPageIndex(firstSelected ?? null)
                          }
                        }}
                      />
                      <span>{t('planImport.applyScaleToAllPages')}</span>
                    </label>
                    {!applyPdfScaleToAll && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (!hasPrev) return
                            setPdfScaleCurrentPageIndex(
                              orderedSelected[currentPosition - 1] ?? null
                            )
                          }}
                          disabled={!hasPrev}
                          className="px-3 py-2 text-sm text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 disabled:opacity-50"
                        >
                          {t('common.back')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!hasNext) return
                            setPdfScaleCurrentPageIndex(
                              orderedSelected[currentPosition + 1] ?? null
                            )
                          }}
                          disabled={!hasNext}
                          className="px-3 py-2 text-sm text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 disabled:opacity-50"
                        >
                          {t('common.next')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPdfScaleRulerRevision((revision) => revision + 1)
                            setPdfScalePerPage((prev) => {
                              if (currentPageIndex == null) return prev
                              const next = { ...prev }
                              delete next[currentPageIndex]
                              return next
                            })
                          }}
                          className="px-3 py-2 text-sm text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800"
                          disabled={!currentScaleReference}
                        >
                          {t('planImport.resetPageScale')}
                        </button>
                      </div>
                    )}
                  </div>
                  <ScaleRuler
                    key={`scale-${currentPageIndexValue}-${pdfScaleRulerRevision}`}
                    autoCreateInitialReference
                    imageDataUrl={getPdfPageRasterPreviewUrl(scalePage)}
                    initialReference={currentScaleReference}
                    onReferenceChange={scaleReferenceChangeHandler}
                    onScaleComplete={handlePdfScaleComplete}
                    onSkip={handlePdfScaleSkip}
                    onCancel={() => setStep('pdfPages')}
                    invertPreview={false}
                    surfaceClassName={importPreviewSurfaceClass}
                    showInlineContinue={false}
                  />
                </div>
              )
            })()}

          {step === 'pdfBackground' && (
            <div className="flex-1 flex flex-col space-y-4 min-h-0">
              <div className="space-y-3 border border-gray-200 dark:border-gray-700 rounded-md p-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {isCadMultiCropImport
                    ? t('planImport.cadColorModeTitle')
                    : t('planImport.pdfDarkModeTitle')}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {isCadMultiCropImport
                    ? t('planImport.cadColorModeDescription')
                    : t('planImport.pdfDarkModeDescription')}
                </p>
                {!isCadMultiCropImport && (
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                    <input
                      type="checkbox"
                      checked={pdfEnableDarkModeProcessing}
                      onChange={(e) => setPdfEnableDarkModeProcessing(e.target.checked)}
                    />
                    <span>{t('planImport.enablePdfDarkModeProcessing')}</span>
                  </label>
                )}
                {isFloorplanScanEnabled() && !isCadMultiCropImport && (
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                      <input type="checkbox" checked={recognizeWalls}
                        onChange={(event) => setRecognizeWalls(event.target.checked)} />
                      <span>{t('planImport.recognizeWalls')}</span>
                    </label>
                    {recognizeWalls && (
                      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                        <span>{t('planImport.scanMethod')}</span>
                        <select value={scanMethod} onChange={(event) => setScanMethod(event.target.value as VisionPlanGeometryMode)}
                          className="rounded border border-gray-300 bg-white px-2 py-1 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
                          <option value="hybrid">{t('planImport.scanHybrid')}</option>
                          <option value="yolo">{t('planImport.scanYolo')}</option>
                          <option value="luna">{t('planImport.scanLuna')}</option>
                        </select>
                      </label>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <label
                    className="text-sm text-gray-700 dark:text-gray-200"
                    htmlFor="pdf-preview-page"
                  >
                    {t('planImport.previewPage')}
                  </label>
                  <CustomDropdown
                    id="pdf-preview-page"
                    value={pdfPreviewPageIndex == null ? '' : String(pdfPreviewPageIndex)}
                    onChange={(nextValue) =>
                      setPdfPreviewPageIndex(nextValue ? Number(nextValue) : null)
                    }
                    options={selectedPdfPages
                      .slice()
                      .sort((a, b) => a - b)
                      .map((pageIndex) => ({
                        value: String(pageIndex),
                        label:
                          pdfPages.find((page) => page.pageIndex === pageIndex)?.label ??
                          t('planImport.pageLabel', { page: pageIndex + 1 }),
                      }))}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100"
                    placeholder={t('planImport.previewPage')}
                    menuPlacement="bottom"
                    menuPortal
                  />
                </div>
                {pdfPreviewHasWhiteBackground && (
                  <p className="text-xs text-sky-700 dark:text-sky-300">
                    {t('planImport.whiteBackgroundDetectedDescription')}
                  </p>
                )}
              </div>

              {isPreparingPdfPreview ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-sky-600 mb-3"></div>
                    <p className="text-gray-600 dark:text-gray-400">{t('planImport.processing')}</p>
                  </div>
                </div>
              ) : isCadMultiCropImport ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-0">
                  <button
                    type="button"
                    onClick={() => setPdfConvertCadToGrayscale(false)}
                    className={`flex min-h-0 flex-col rounded-md border p-3 text-left transition-colors ${
                      !pdfConvertCadToGrayscale
                        ? 'border-sky-500 ring-2 ring-sky-500/40'
                        : 'border-gray-200 hover:border-sky-300 dark:border-gray-700 dark:hover:border-sky-600'
                    }`}
                  >
                    <span className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                      <input
                        type="checkbox"
                        readOnly
                        checked={!pdfConvertCadToGrayscale}
                        className="pointer-events-none"
                      />
                      {t('planImport.colorPreview')}
                    </span>
                    <span
                      className={`flex min-h-0 flex-1 items-center justify-center overflow-auto rounded p-3 ${importPreviewSurfaceClass}`}
                    >
                      {pdfPreviewOriginalUrl && (
                        <img
                          src={pdfPreviewOriginalUrl}
                          alt="CAD color preview"
                          className={`max-w-full max-h-[50vh] mx-auto ${shouldInvertCadByTheme ? 'filter invert' : ''}`}
                        />
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPdfConvertCadToGrayscale(true)}
                    className={`flex min-h-0 flex-col rounded-md border p-3 text-left transition-colors ${
                      pdfConvertCadToGrayscale
                        ? 'border-sky-500 ring-2 ring-sky-500/40'
                        : 'border-gray-200 hover:border-sky-300 dark:border-gray-700 dark:hover:border-sky-600'
                    }`}
                  >
                    <span className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                      <input
                        type="checkbox"
                        readOnly
                        checked={pdfConvertCadToGrayscale}
                        className="pointer-events-none"
                      />
                      {t('planImport.grayscalePreview')}
                    </span>
                    <span
                      className={`flex min-h-0 flex-1 items-center justify-center overflow-auto rounded p-3 ${importPreviewSurfaceClass}`}
                    >
                      {pdfPreviewProcessedUrl && (
                        <img
                          src={pdfPreviewProcessedUrl}
                          alt="CAD grayscale preview"
                          className={`max-w-full max-h-[50vh] mx-auto ${shouldInvertCadByTheme ? 'filter invert' : ''}`}
                        />
                      )}
                    </span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-0">
                  <div className="border border-gray-200 dark:border-gray-700 rounded-md p-3 bg-white overflow-auto">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t('planImport.original')}
                    </p>
                    {pdfPreviewOriginalUrl && (
                      <img
                        src={pdfPreviewOriginalUrl}
                        alt="PDF original preview"
                        className="max-w-full max-h-[50vh] mx-auto"
                      />
                    )}
                  </div>
                  <div className="border border-gray-200 dark:border-gray-700 rounded-md p-3 bg-gray-100 dark:bg-gray-800 overflow-auto">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {pdfEnableDarkModeProcessing
                        ? t('planImport.darkModePreview')
                        : t('planImport.processed')}
                    </p>
                    {(pdfEnableDarkModeProcessing ? pdfPreviewDarkUrl : pdfPreviewProcessedUrl) && (
                      <img
                        src={
                          (pdfEnableDarkModeProcessing
                            ? pdfPreviewDarkUrl
                            : pdfPreviewProcessedUrl) ?? ''
                        }
                        alt="Import processed preview"
                        className="max-w-full max-h-[50vh] mx-auto"
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {recognitionError && (step === 'floor' || step === 'pdfBackground') && (
          <div role="alert" className="px-6 pb-2 text-sm text-red-600 dark:text-red-400">
            {recognitionError}
          </div>
        )}
        {step !== 'crop' && step !== 'pdfCrop' && (
          <div className="sticky bottom-0 z-10 flex shrink-0 gap-3 border-t border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
            <button
              type="button"
              onClick={
                step === 'upload'
                  ? handleClose
                  : () => {
                      if (step === 'scale') setStep('crop')
                      if (step === 'background') setStep('scale')
                      if (step === 'floor') setStep('background')
                      if (step === 'pdfPages') setStep('upload')
                      if (step === 'pdfScale') setStep('pdfPages')
                      if (step === 'pdfBackground') setStep('pdfScale')
                    }
              }
              className="flex-1 px-6 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {step === 'upload' ? t('common.cancel') : t('common.back')}
            </button>
            {step === 'background' && processingResult && !isProcessing && (
              <button
                type="button"
                data-testid="e2e-import-plan-continue-after-bg"
                onClick={handleBackgroundComplete}
                className="flex-1 px-6 py-3 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-md shadow-md transition-colors"
              >
                {t('common.continue')}
              </button>
            )}
            {step === 'floor' && (
              <button
                type="button"
                data-testid="e2e-import-plan-finish"
              onClick={handleImport}
                disabled={(!createNewFloor && !selectedFloorId) || isRecognizingWalls}
                className="flex-1 px-6 py-3 bg-sky-600 hover:bg-sky-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold rounded-md shadow-md transition-colors"
              >
                {isRecognizingWalls ? t('planImport.recognizingWalls') : t('common.ok')}
              </button>
            )}
            {step === 'pdfPages' && (
              <button
                type="button"
                data-testid="e2e-import-plan-continue-pages"
                onClick={() => {
                  if (pdfImportError) return
                  const firstSelected = selectedPdfPages.slice().sort((a, b) => a - b)[0]
                  setPdfScaleCurrentPageIndex(firstSelected ?? null)
                  setPdfPreviewPageIndex(firstSelected ?? null)
                  setStep('pdfScale')
                }}
                disabled={
                  !!pdfImportError ||
                  selectedPdfPages.length === 0 ||
                  (pdfDestinationMode === 'replace-floor' && !selectedFloorId)
                }
                className="flex-1 px-6 py-3 bg-sky-600 hover:bg-sky-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold rounded-md shadow-md transition-colors"
              >
                {t('common.continue')}
              </button>
            )}
            {step === 'pdfScale' && (
              <button
                type="button"
                data-testid="e2e-import-plan-continue-scale"
                onClick={() => {
                  if (!pdfScaleReady) return
                  if (isCadMultiCropImport && !selectedCadHasMeaningfulColor) {
                    void handlePdfImport(false)
                    return
                  }
                  setStep('pdfBackground')
                }}
                disabled={!pdfScaleReady || isApplyingPdfImport}
                className="flex-1 px-6 py-3 bg-sky-600 hover:bg-sky-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold rounded-md shadow-md transition-colors"
              >
                {t('common.continue')}
              </button>
            )}
            {step === 'pdfBackground' && (
              <button
                type="button"
                data-testid="e2e-import-plan-finish"
                onClick={() => handlePdfImport(false)}
                disabled={
                  selectedPdfPages.length === 0 ||
                  (pdfDestinationMode === 'replace-floor' && !selectedFloorId) ||
                  isApplyingPdfImport
                }
                className="flex-1 px-6 py-3 bg-sky-600 hover:bg-sky-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold rounded-md shadow-md transition-colors"
              >
                {isApplyingPdfImport
                  ? recognizeWalls ? t('planImport.recognizingWalls') : t('planImport.importing')
                  : t('common.ok')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default ImportPlanImageDialog
