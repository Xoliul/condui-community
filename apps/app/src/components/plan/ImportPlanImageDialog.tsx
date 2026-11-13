import { usePdfPlanImportTransaction } from '@/components/plan/usePdfPlanImportTransaction'
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
  svgHasUnresolvedEmbeddedImages,
  cropImageDataUrl,
} from '@/utils/planImageProcessing'
import type { PlanImageProcessingResult } from '@/utils/planImageProcessing'
import {
  parsePdfFile,
  normalizePdfPageAsset,
  mapPreviewCropToPageCrop,
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
import { type CadImportPipelineContext } from '@/lib/plan/cadReferenceBuilder'
import {
  resolveDefaultImportFloorId,
  schedulePlanFitToViewAfterImport,
  shouldShowPdfDestinationOptions,
} from './planImportFloor'
import CustomDropdown from '@/components/common/CustomDropdown'
import { usePlanImportPagePreviews } from './usePlanImportPagePreviews'
import { querySitplanNotes } from '@/lib/projectV2/annotations'
import {
  readLegacyCompatibilityFloors,
  selectProjectPlanScale,
} from '@/lib/projectV2/buildingFloors'
import {
  DEFAULT_PLAN_PX_PER_METER,
  resolvePlanPxPerMeter,
  createPlanScaleReference,
} from '@/lib/plan/planScale'
import { scalePlanPoint } from '@/lib/plan/rescalePlan'
import { selectProjectElectricalPanels } from '@/lib/projectV2/electrical'
import {
  isRasterPlanImportFile,
  isSupportedPlanImportFile,
  PLAN_IMPORT_FILE_ACCEPT,
} from './planImportFiles'
import { isFloorplanScanEnabled } from '@/lib/vision/availability'
import { useWallScanStore } from '@/stores/wallScanStore'
import { useWallRecognitionAccess, WallRecognitionToggle } from './WallRecognitionControls'
import { liveProjectSession } from '@/stores/liveProjectCommandSession'
import { CommandError, type CommandInvocation } from '@/lib/commands/project'

// Component to show processed image with dark mode preview
function ProcessedImagePreview({
  processedDataUrl,
  isDarkMode,
}: {
  processedDataUrl: string
  isDarkMode: boolean
}) {
  const [previewUrl, setPreviewUrl] = useState<string>(processedDataUrl)
  const [previewSource, setPreviewSource] = useState({ processedDataUrl, isDarkMode })
  if (
    previewSource.processedDataUrl !== processedDataUrl ||
    previewSource.isDarkMode !== isDarkMode
  ) {
    setPreviewSource({ processedDataUrl, isDarkMode })
    if (!isDarkMode) setPreviewUrl(processedDataUrl)
  }

  useEffect(() => {
    if (!isDarkMode) return
    applyDarkModeInversion(processedDataUrl)
      .then((inverted) => setPreviewUrl(inverted))
      .catch(() => setPreviewUrl(processedDataUrl))
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
  const pdfScaleReady =
    selectedPdfPages.length > 0 &&
    (applyPdfScaleToAll
      ? [selectedPdfPages.slice().sort((a, b) => a - b)[0]!]
      : selectedPdfPages
    ).every((pageIndex) => {
      if (pdfScaleSkippedPages[pageIndex]) return true
      const reference = pdfScalePerPage[pageIndex]
      return !!reference && !!createPlanScaleReference(reference.p1, reference.p2, reference.meters)
    })
  const [pdfScaleCurrentPageIndex, setPdfScaleCurrentPageIndex] = useState<number | null>(null)
  const [isApplyingPdfImport, setIsApplyingPdfImport] = useState(false)
  // Wall recognition is on by default where it is available; the toggle turns itself off
  // for projects without recognition access or accounts without scans left.
  const [recognizeWalls, setRecognizeWalls] = useState(true)
  const [importError, setImportError] = useState<string | null>(null)
  const autoImportStartedRef = useRef(false)
  const wallRecognitionAccess = useWallRecognitionAccess()
  const wallRecognitionAvailable = isFloorplanScanEnabled() && wallRecognitionAccess === 'available'
  const pdfEnableDarkModeProcessing = true
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
  const dropZoneRef = useRef<HTMLButtonElement>(null)
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
  const {
    pdfPageThemePreviewMap,
    setPdfPageThemePreviewMap,
    pdfPageRasterThemePreviewMap,
    setPdfPageRasterThemePreviewMap,
  } = usePlanImportPagePreviews({
    isPdfImport,
    isCadMultiCropImport,
    pdfPages,
    pdfPageCroppedPreviewMap,
    isDarkMode,
  })
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
  const needsFloorSelection =
    isOpen &&
    floors.length > 0 &&
    (step === 'floor' || (step === 'pdfPages' && pdfDestinationMode === 'replace-floor'))
  if (needsFloorSelection && !floors.some((floor: Floor) => floor.id === selectedFloorId)) {
    setSelectedFloorId(resolveDefaultImportFloorId(floors, activeFloorId))
  }

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
      const isRasterImage = isRasterPlanImportFile(selectedFile)

      if (isPdf || isDxf || isDwg || isSvg || isRasterImage) {
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
              : isRasterImage
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
                      : isRasterImage
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
                    : isRasterImage
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
        void handleProcessImage(croppedImageDataUrl)
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
      void handleProcessImage(croppedImageDataUrl)
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
    setRecognizeWalls(true)
    setImportError(null)
    autoImportStartedRef.current = false
    // Closing before the plan is imported releases a wall scan that was started for it.
    if (!useWallScanStore.getState().projectId) useWallScanStore.getState().discard()
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
  }, [onClose, setPdfPageRasterThemePreviewMap, setPdfPageThemePreviewMap])

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
    if (createNewFloor && !newFloorName.trim()) {
      alert(t('planImport.floorNameRequired'))
      return
    }

    const expectedRevision = liveProjectSession.revision
    // Use processed image if available and enabled, otherwise use original
    const finalImageDataUrl =
      enableBackgroundProcessing && processingResult?.processedDataUrl
        ? processingResult.processedDataUrl
        : croppedImageDataUrl
    const imageDimensions = await loadImageDimensions(finalImageDataUrl).catch(() => null)
    const targetPxPerMeter =
      resolvePlanPxPerMeter(selectProjectPlanScale(currentProject)) ?? DEFAULT_PLAN_PX_PER_METER
    const measuredPxPerMeter = resolvePlanPxPerMeter({ reference: scaleReference ?? undefined })
    const factor = measuredPxPerMeter ? targetPxPerMeter / measuredPxPerMeter : 1
    const imageWidth = (imageDimensions?.width ?? 1) * factor
    const imageHeight = (imageDimensions?.height ?? 1) * factor
    const importedScale: Floor['scale'] = {
      pxPerMeter: targetPxPerMeter,
      reference:
        scaleReference && measuredPxPerMeter
          ? (createPlanScaleReference(
              scalePlanPoint(scaleReference.p1, factor),
              scalePlanPoint(scaleReference.p2, factor),
              scaleReference.meters
            ) ?? undefined)
          : undefined,
    }

    const hasWhiteBackground = processingResult?.hasWhiteBackground ?? false

    const importedAsset = {
      id: nanoid(),
      kind: 'raster' as const,
      sourceName: file?.name,
      width: imageWidth,
      height: imageHeight,
      dataUrl: croppedImageDataUrl,
      processedDataUrl:
        enableBackgroundProcessing && processingResult?.processedDataUrl
          ? processingResult.processedDataUrl
          : undefined,
      hasWhiteBackground,
      darkModeAware: enableBackgroundProcessing && hasWhiteBackground,
    }
    const invocation: CommandInvocation | null = createNewFloor
      ? {
          id: 'floor.create',
          input: {
            name: newFloorName.trim(),
            scale: importedScale,
            planScaleNeedsCalibration: !measuredPxPerMeter,
            asset: importedAsset,
          },
        }
      : selectedFloorId
        ? {
            id: 'plan.attachBackground',
            input: {
              floorId: selectedFloorId,
              asset: importedAsset,
              scale: importedScale,
              planScaleNeedsCalibration: !measuredPxPerMeter,
            },
          }
        : null
    if (!invocation) return
    let targetFloorId: string | undefined
    try {
      const outcome = liveProjectSession.execute([invocation], {
        expectedRevision,
        label: 'import plan image',
        source: 'plan_import',
      })
      targetFloorId = createNewFloor
        ? outcome.results[0]?.created.find((ref) => ref.kind === 'floor')?.id
        : (selectedFloorId ?? undefined)
    } catch (error) {
      if (!(error instanceof CommandError)) throw error
      logger.warn('[planImport] Image import command rejected:', {
        code: error.details?.reason ?? error.code,
      })
      alert(t(error.details?.reason === 'collab_too_large' ? 'planImport.collabTooLarge' : 'planImport.importFailed'))
      return
    }
    if (!targetFloorId) return
    setActiveFloor(targetFloorId)

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
    selectedFloorId,
    createNewFloor,
    newFloorName,
    scaleReference,
    processingResult,
    enableBackgroundProcessing,
    file?.name,
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

  const { handlePdfImport } = usePdfPlanImportTransaction({
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
  })

  /**
   * Starts the wall scan in the background as soon as the pages and crops are chosen, so it
   * runs while the user calibrates the scale. The import itself never waits for it.
   */
  const startWallScan = useCallback(() => {
    const scan = useWallScanStore.getState()
    if (!file || !recognizeWalls || !wallRecognitionAvailable || isCadMultiCropImport) {
      if (!scan.projectId) scan.discard()
      return
    }
    const pages = pdfPages
      .filter((page) => selectedPdfPages.includes(page.pageIndex))
      .sort((a, b) => a.pageIndex - b.pageIndex)
    const inputKey = JSON.stringify([
      file.name,
      file.size,
      file.lastModified,
      pages.map((page) => [page.pageIndex, pdfPageCropMap[page.pageIndex] ?? null]),
    ])
    if (scan.inputKey === inputKey && scan.status !== 'failed') return
    void Promise.all(
      pages.map((page) => normalizePdfPageAsset(page, file.name, pdfPageCropMap[page.pageIndex]))
    )
      .then((assets) => {
        const images = assets.flatMap((asset) =>
          asset.dataUrl
            ? [
                {
                  pageIndex: asset.pageIndex,
                  dataUrl: asset.dataUrl,
                  name: `${file.name}-${asset.pageIndex + 1}`,
                },
              ]
            : []
        )
        if (images.length > 0) useWallScanStore.getState().start(inputKey, images)
      })
      .catch((error: unknown) =>
        logger.warn('[planImport] Could not prepare the wall scan:', error)
      )
  }, [
    file,
    recognizeWalls,
    wallRecognitionAvailable,
    isCadMultiCropImport,
    pdfPages,
    selectedPdfPages,
    pdfPageCropMap,
  ])

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
        .catch((error) =>
          logger.error('[planImport] Failed to refresh cropped CAD preview:', error)
        )
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

  // Raster images and PDFs always receive background processing after calibration.
  useEffect(() => {
    if (step !== 'pdfBackground' || isCadMultiCropImport) {
      autoImportStartedRef.current = false
      return
    }
    if (autoImportStartedRef.current) return
    autoImportStartedRef.current = true
    void handlePdfImport(false)
  }, [step, isCadMultiCropImport, handlePdfImport])

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
    else if (
      orderedSelected.every((index) => {
        const reference = pdfScalePerPage[index]
        return (
          index === currentPage ||
          pdfScaleSkippedPages[index] ||
          (reference && createPlanScaleReference(reference.p1, reference.p2, reference.meters))
        )
      })
    )
      setStep('pdfBackground')
  }, [
    selectedPdfPages,
    pdfScaleCurrentPageIndex,
    applyPdfScaleToAll,
    pdfScalePerPage,
    pdfScaleSkippedPages,
  ])

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

  const pdfBackgroundRequest = useMemo(() => {
    if (step !== 'pdfBackground' || !isCadMultiCropImport || !file) return null
    const selected = selectedPdfPages.slice().sort((a, b) => a - b)
    const pageIndex = pdfPreviewPageIndex ?? selected[0] ?? null
    if (pageIndex == null) return null
    const page = pdfPages.find((candidate) => candidate.pageIndex === pageIndex)
    return page
      ? {
          page,
          pageIndex,
          file,
          crop: pdfPageCropMap[pageIndex],
          isCadMultiCropImport,
          isSvgImport,
          pdfEnableDarkModeProcessing,
        }
      : null
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
  const [previewRequestSource, setPreviewRequestSource] = useState(pdfBackgroundRequest)
  if (previewRequestSource !== pdfBackgroundRequest) {
    setPreviewRequestSource(pdfBackgroundRequest)
    if (pdfBackgroundRequest) setIsPreparingPdfPreview(true)
  }
  useEffect(() => {
    if (!pdfBackgroundRequest) return
    const {
      page,
      pageIndex,
      file: previewFile,
      crop,
      isCadMultiCropImport,
      isSvgImport,
      pdfEnableDarkModeProcessing,
    } = pdfBackgroundRequest
    let cancelled = false

    normalizePdfPageAsset(page, previewFile.name, crop)
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
  }, [pdfBackgroundRequest])

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
              <button
                type="button"
                ref={dropZoneRef}
                className="block w-full border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-md p-12 text-center cursor-pointer hover:border-sky-400 transition-colors"
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
                <span className="block mt-4 text-lg font-medium text-gray-700 dark:text-gray-300">
                  {t('planImport.dragDropOrClick')}
                </span>
                <span className="block mt-2 text-sm text-gray-500 dark:text-gray-400">
                  {t('planImport.orPaste')}
                </span>
                <span className="block mt-2 text-xs text-gray-400 dark:text-gray-500">
                  {t('planImport.supportedFormats')}
                </span>
              </button>

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
                  {isFloorplanScanEnabled() && !isCadMultiCropImport && !isParsingPdf && (
                    <WallRecognitionToggle
                      access={wallRecognitionAccess}
                      checked={recognizeWalls}
                      onChange={setRecognizeWalls}
                    />
                  )}
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
                          <label
                            key={layer.name}
                            className="flex min-w-0 items-center gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={!cadHiddenLayers.has(layer.name)}
                              onChange={() => handleToggleCadLayer(layer.name)}
                            />
                            <span
                              aria-hidden="true"
                              className={`h-3 w-3 shrink-0 rounded-sm border border-gray-300 dark:border-gray-600 ${
                                isCadForegroundColor(layer.color)
                                  ? 'bg-gray-900 dark:bg-gray-100'
                                  : ''
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
              const scaledCount = orderedSelected.filter((pageIndex) => {
                const reference = pdfScalePerPage[pageIndex]
                return (
                  !pdfScaleSkippedPages[pageIndex] &&
                  reference &&
                  createPlanScaleReference(reference.p1, reference.p2, reference.meters)
                )
              }).length
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

          {step === 'pdfBackground' && !isCadMultiCropImport && !importError && (
            <div className="flex flex-1 items-center justify-center py-16">
              <div className="inline-block h-10 w-10 animate-spin rounded-full border-b-2 border-sky-600" />
            </div>
          )}
          {step === 'pdfBackground' && isCadMultiCropImport && (
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
        {importError && step === 'pdfBackground' && (
          <div role="alert" className="px-6 pb-2 text-sm text-red-600 dark:text-red-400">
            {importError}
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
                onClick={() => void handleImport()}
                disabled={!createNewFloor && !selectedFloorId}
                className="flex-1 px-6 py-3 bg-sky-600 hover:bg-sky-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold rounded-md shadow-md transition-colors"
              >
                {t('common.ok')}
              </button>
            )}
            {step === 'pdfPages' && (
              <button
                type="button"
                data-testid="e2e-import-plan-continue-pages"
                onClick={() => {
                  if (pdfImportError) return
                  startWallScan()
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
            {step === 'pdfBackground' && (isCadMultiCropImport || importError) && (
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
                {isApplyingPdfImport ? t('planImport.importing') : t('common.ok')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default ImportPlanImageDialog
