import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowRight, Check, Eye, EyeOff, FileText, Loader2, Tag } from 'lucide-react'
import type { Panel, PanelGridConfig, PanelGridModuleRef, PanelGridSlot } from '@/types/schema'
import type { AuxiliaryElectricalEnclosure } from '@/types/supplyAssembly'
import { useProjectStore } from '@/stores/projectStore'
import {
  getProjectElectricalPanels,
  selectProjectAuxiliaryElectricalEnclosures,
} from '@/lib/projectV2/electrical'
import { flattenPanels } from '@/utils/eendraad/panelHelpers'
import { getPanelDisplayName } from '@/utils/panelNames'
import { collectJunctionIdentities } from '@/lib/junctionIdentity'
import {
  assessPanelCanvasReadiness,
  getPanelCanvasOverflowModuleKeys,
  panelCanvasNeedsAttention,
} from '@/lib/export/labelStripReadiness'
import { getPanelGridPlacements } from '@/components/canvas/panel/panelGridLayout'
import { PanelIcon } from '@/components/viewport/CanvasIcons'
import { LabelStripPdfPreview } from '@/components/export/LabelStripPdfPreview'
import CustomDropdown from '@/components/common/CustomDropdown'
import { getSymbolById } from '@/lib/symbols'
import { getCachedThemedSymbolBlobUrl, loadProcessedSymbol } from '@/lib/symbolImage'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  getBrotherTapeWidthsMm,
  getDefaultBrotherLbxMode,
  getDefaultBrotherTapeWidthMm,
  type BrotherPrinter,
  type BrotherLbxMode,
  type BrotherTapeWidthMm,
  type LabelStripExportOptions,
} from '@/lib/export/labelStripExport'

type PaperSize = 'A4' | 'A3'
type ExportFormat = 'pdf' | 'brother-lbx'
type StripPreset = '25' | '35' | 'custom'
type StripMode = 'single' | 'double'

interface LabelStripSource {
  id: string
  label: string
  kind: 'panel' | 'junction-panel' | 'virtual'
  gridView?: PanelGridConfig
  moduleRefs: PanelGridModuleRef[]
  automaticallyPositionedSlots?: PanelGridSlot[]
  overflowModuleCount?: number
}

interface LabelStripExportDialogProps {
  onCancel: () => void
  onExport: (options: LabelStripExportOptions) => void | Promise<void>
  onOpenPanelCanvas: () => void
  onPreview: (options: LabelStripExportOptions) => Promise<Blob | string>
  suppressCanvasWarning?: boolean
}

interface RetainedDialogSettings {
  exportFormat: ExportFormat
  brotherPrinter: BrotherPrinter
  brotherTapeWidthMm: BrotherTapeWidthMm
  brotherMode: BrotherLbxMode
  paperSize: PaperSize
  preset: StripPreset
  customHeight: string
  customSecondHeight: string
  stripMode: StripMode
  includeNonProtection: boolean
  includeTerminalStrips: boolean
  includeDomotics: boolean
  skipEmptyRows: boolean
  selectedSourceKeys: string[] | null
}

let retainedDialogSettings: RetainedDialogSettings | null = null

function sourceKey(source: LabelStripSource): string {
  return `${source.kind}:${source.id}`
}

function virtualSource(enclosure: AuxiliaryElectricalEnclosure): LabelStripSource {
  return {
    id: enclosure.id,
    label: enclosure.name,
    kind: 'virtual',
    gridView: enclosure.gridView,
    moduleRefs: [...enclosure.gridView.slots, ...(enclosure.gridView.supplyPanelSlots ?? [])].map(
      (slot) => slot.module
    ),
  }
}

function SingleStripIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="3" y="7" width="26" height="10" rx="1.5" />
    </svg>
  )
}

function DoubleStripIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="3" y="2.5" width="26" height="8" rx="1.5" />
      <rect x="3" y="13.5" width="26" height="8" rx="1.5" />
    </svg>
  )
}

function LibrarySymbolIcon({ symbolId, className }: { symbolId: string; className?: string }) {
  const isDark = useSettingsStore((state) => state.theme.mode === 'dark')
  const symbol = getSymbolById(symbolId)
  const [src, setSrc] = useState<string | null>(() => {
    if (!symbol) return null
    return getCachedThemedSymbolBlobUrl(symbol.svgPath, isDark) ?? symbol.svgPath
  })

  useEffect(() => {
    let cancelled = false
    if (!symbol) {
      setSrc(null)
      return
    }

    const cached = getCachedThemedSymbolBlobUrl(symbol.svgPath, isDark)
    if (cached) {
      setSrc(cached)
      return
    }

    setSrc(symbol.svgPath)
    void loadProcessedSymbol(symbol.svgPath, isDark)
      .then((image) => {
        if (!cancelled) setSrc(image.src)
      })
      .catch(() => {
        // Keep the catalog asset visible if themed processing is unavailable.
      })

    return () => {
      cancelled = true
    }
  }, [isDark, symbol])

  if (!src) return null

  return <img src={src} alt="" aria-hidden className={`object-contain ${className ?? ''}`} />
}

const tileClass = (selected: boolean, align: 'center' | 'start' = 'center') => {
  const itemAlignmentClass = align === 'start' ? 'items-start' : 'items-center'

  return `relative flex min-w-0 ${itemAlignmentClass} gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
    selected
      ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
      : 'border-gray-300 bg-white text-gray-700 hover:border-sky-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
  }`
}

function SelectionMark() {
  return (
    <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-sky-600 text-white">
      <Check className="h-3 w-3" aria-hidden />
    </span>
  )
}

export function LabelStripExportDialog({
  onCancel,
  onExport,
  onOpenPanelCanvas,
  onPreview,
  suppressCanvasWarning = false,
}: LabelStripExportDialogProps) {
  const { t } = useTranslation()
  const currentProject = useProjectStore((state) => state.currentProject)
  const getPanelGridModules = useProjectStore((state) => state.getPanelGridModules)
  const [exportFormat, setExportFormat] = useState<ExportFormat>(
    retainedDialogSettings?.exportFormat ?? 'pdf'
  )
  const [brotherPrinter, setBrotherPrinter] = useState<BrotherPrinter>(
    retainedDialogSettings?.brotherPrinter ?? 'pt-p900-family'
  )
  const retainedBrotherTapeWidth = retainedDialogSettings?.brotherTapeWidthMm
  const initialBrotherPrinter = retainedDialogSettings?.brotherPrinter ?? 'pt-p900-family'
  const initialBrotherTapeWidth =
    retainedBrotherTapeWidth !== undefined &&
    getBrotherTapeWidthsMm(initialBrotherPrinter).includes(retainedBrotherTapeWidth)
      ? retainedBrotherTapeWidth
      : getDefaultBrotherTapeWidthMm(initialBrotherPrinter)
  const [brotherTapeWidthMm, setBrotherTapeWidthMm] =
    useState<BrotherTapeWidthMm>(initialBrotherTapeWidth)
  const [brotherMode, setBrotherMode] = useState<BrotherLbxMode>(
    retainedDialogSettings?.brotherMode ?? getDefaultBrotherLbxMode(initialBrotherPrinter)
  )
  const [paperSize, setPaperSize] = useState<PaperSize>(retainedDialogSettings?.paperSize ?? 'A4')
  const [preset, setPreset] = useState<StripPreset>(retainedDialogSettings?.preset ?? '25')
  const [customHeight, setCustomHeight] = useState(retainedDialogSettings?.customHeight ?? '40')
  const [customSecondHeight, setCustomSecondHeight] = useState(
    retainedDialogSettings?.customSecondHeight ?? '40'
  )
  const [stripMode, setStripMode] = useState<StripMode>(
    retainedDialogSettings?.stripMode ?? 'single'
  )
  const [includeNonProtection, setIncludeNonProtection] = useState(
    retainedDialogSettings?.includeNonProtection ?? false
  )
  const [includeTerminalStrips, setIncludeTerminalStrips] = useState(
    retainedDialogSettings?.includeTerminalStrips ?? false
  )
  const [includeDomotics, setIncludeDomotics] = useState(
    retainedDialogSettings?.includeDomotics ?? true
  )
  const [skipEmptyRows, setSkipEmptyRows] = useState(retainedDialogSettings?.skipEmptyRows ?? true)
  const [selectedSourceKeys, setSelectedSourceKeys] = useState<string[] | null>(
    retainedDialogSettings?.selectedSourceKeys ?? null
  )
  const [previewRequested, setPreviewRequested] = useState(false)
  const [preview, setPreview] = useState<Blob | string | null>(null)
  const [isPreviewing, setIsPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState(false)
  const previewRef = useRef<HTMLElement>(null)

  useEffect(() => {
    retainedDialogSettings = {
      exportFormat,
      brotherPrinter,
      brotherTapeWidthMm,
      brotherMode,
      paperSize,
      preset,
      customHeight,
      customSecondHeight,
      stripMode,
      includeNonProtection,
      includeTerminalStrips,
      includeDomotics,
      skipEmptyRows,
      selectedSourceKeys,
    }
  }, [
    brotherPrinter,
    brotherTapeWidthMm,
    brotherMode,
    customHeight,
    customSecondHeight,
    includeDomotics,
    includeNonProtection,
    includeTerminalStrips,
    paperSize,
    preset,
    selectedSourceKeys,
    skipEmptyRows,
    stripMode,
    exportFormat,
  ])

  const sources = useMemo<LabelStripSource[]>(() => {
    if (!currentProject) return []
    const panels = flattenPanels(getProjectElectricalPanels(currentProject))
    const panelSources = panels.map((panel: Panel) => {
      const modules = getPanelGridModules(panel.id).filter(
        (module) => !(module.ref.kind === 'trunkDevice' && module.ref.scope === 'ground')
      )
      const overflowModuleCount = getPanelCanvasOverflowModuleKeys(
        panel,
        currentProject,
        modules
      ).size
      const automaticPanel: Panel = {
        ...panel,
        gridView: panel.gridView
          ? { ...panel.gridView, slots: [], supplyPanelSlots: [] }
          : panel.gridView,
      }
      const automaticallyPositionedSlots = getPanelGridPlacements(
        automaticPanel,
        currentProject,
        modules
          .filter((module) => module.inSupplyPanel !== true)
          .map((module) => ({
            ref: module.ref,
            terminalStripMemberRefs: module.terminalStripMemberRefs,
          }))
      ).map((placement) => ({
        row: placement.row,
        col: placement.col,
        module: placement.ref,
        ...(placement.terminalStripRail ? { terminalStripRail: placement.terminalStripRail } : {}),
      }))

      return {
        id: panel.id,
        label: getPanelDisplayName(panel, currentProject),
        kind: 'panel' as const,
        gridView: panel.gridView,
        moduleRefs: modules.map((module) => module.ref),
        automaticallyPositionedSlots,
        overflowModuleCount,
      }
    })
    const junctionPanelSources = collectJunctionIdentities(currentProject, 'junction_panel').map(
      (identity) => ({
        id: identity,
        label: identity,
        kind: 'junction-panel' as const,
        moduleRefs: [],
      })
    )
    const virtualSources = selectProjectAuxiliaryElectricalEnclosures(currentProject)
      .filter((enclosure) => !enclosure.hidden)
      .map(virtualSource)
    return [...panelSources, ...junctionPanelSources, ...virtualSources]
  }, [currentProject, getPanelGridModules])

  const selectedKeys = useMemo(() => {
    if (selectedSourceKeys == null) return new Set(sources.map(sourceKey))
    return new Set(selectedSourceKeys)
  }, [selectedSourceKeys, sources])
  const selectedSources = sources.filter(
    (source) =>
      !(source.kind === 'junction-panel' && !includeTerminalStrips) &&
      selectedKeys.has(sourceKey(source))
  )
  const needsCanvasAttention =
    !suppressCanvasWarning &&
    selectedSources.some(
      (source) =>
        source.kind !== 'junction-panel' &&
        (source.overflowModuleCount != null && source.overflowModuleCount > 0
          ? true
          : panelCanvasNeedsAttention(
              assessPanelCanvasReadiness(
                source.gridView,
                source.moduleRefs,
                source.automaticallyPositionedSlots
              )
            ))
    )
  const hasOverflowWarning = selectedSources.some(
    (source) => source.kind !== 'junction-panel' && (source.overflowModuleCount ?? 0) > 0
  )
  const overflowWarningCount = selectedSources.reduce(
    (count, source) => count + (source.overflowModuleCount ?? 0),
    0
  )

  const toggleSource = (source: LabelStripSource) => {
    if (source.kind === 'junction-panel' && !includeTerminalStrips) return
    const key = sourceKey(source)
    const next = new Set(selectedKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setSelectedSourceKeys([...next])
  }

  const includeChoices = [
    {
      key: 'domotics',
      label: t('labelStripExport.domotics'),
      selected: includeDomotics,
      toggle: () => setIncludeDomotics((value) => !value),
      symbolId: 'domotica',
    },
    {
      key: 'nonProtection',
      label: t('labelStripExport.nonProtection'),
      selected: includeNonProtection,
      toggle: () => setIncludeNonProtection((value) => !value),
      symbolId: 'inverter',
    },
    {
      key: 'terminalStrips',
      label: t('labelStripExport.terminalStrips'),
      selected: includeTerminalStrips,
      toggle: () => setIncludeTerminalStrips((value) => !value),
      symbolId: 'terminal_strip',
    },
  ] as const

  const exportOptions = useMemo<LabelStripExportOptions>(() => {
    const selectedSourceKeysForExport = [...selectedKeys].filter((key) => {
      const source = sources.find((candidate) => sourceKey(candidate) === key)
      return source && !(source.kind === 'junction-panel' && !includeTerminalStrips)
    })
    return {
      exportFormat,
      brotherPrinter,
      brotherTapeWidthMm,
      brotherMode,
      paperSize,
      preset,
      customHeightMm: Math.max(1, Number(customHeight) || 40),
      customSecondHeightMm: Math.max(1, Number(customSecondHeight) || 40),
      stripMode,
      includeDomotics,
      includeNonProtection,
      includeTerminalStrips,
      skipEmptyRows,
      selectedSourceKeys: selectedSourceKeysForExport,
    }
  }, [
    brotherPrinter,
    brotherTapeWidthMm,
    brotherMode,
    exportFormat,
    includeDomotics,
    includeNonProtection,
    includeTerminalStrips,
    paperSize,
    preset,
    selectedKeys,
    skipEmptyRows,
    sources,
    stripMode,
    customHeight,
    customSecondHeight,
  ])

  useEffect(() => {
    if (!previewRequested) return
    let cancelled = false
    setIsPreviewing(true)
    setPreviewError(false)
    setPreview(null)
    void onPreview(exportOptions)
      .then((blob) => {
        if (!cancelled) {
          setPreview(blob)
          previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }
      })
      .catch(() => {
        if (!cancelled) setPreviewError(true)
      })
      .finally(() => {
        if (!cancelled) setIsPreviewing(false)
      })
    return () => {
      cancelled = true
    }
  }, [exportOptions, onPreview, previewRequested])

  const handlePreview = () => {
    if (previewRequested) {
      setPreviewRequested(false)
      setPreview(null)
      setPreviewError(false)
    } else {
      setPreviewRequested(true)
    }
  }

  const handleExport = () => {
    void onExport(exportOptions)
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      {needsCanvasAttention ? (
        <button
          type="button"
          onClick={onOpenPanelCanvas}
          data-testid="label-strip-canvas-warning"
          className="group flex w-full shrink-0 items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-left text-amber-950 transition-colors hover:border-amber-400 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-50 dark:hover:border-amber-600 dark:hover:bg-amber-950/60 dark:focus:ring-offset-gray-900"
        >
          <AlertTriangle
            className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">
              {t(
                hasOverflowWarning
                  ? 'labelStripExport.overflowWarningTitle'
                  : 'labelStripExport.canvasWarningTitle'
              )}
            </div>
            <div className="mt-0.5 text-xs text-amber-800 dark:text-amber-200">
              {t(
                hasOverflowWarning
                  ? 'labelStripExport.overflowWarningMessage'
                  : 'labelStripExport.canvasWarningMessage',
                { count: overflowWarningCount }
              )}
            </div>
          </div>
          <ArrowRight
            className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </button>
      ) : null}

      {previewRequested ? (
        <section
          ref={previewRef}
          aria-busy={isPreviewing}
          className="shrink-0 rounded-md border border-sky-200 bg-sky-50 p-3 dark:border-sky-900/70 dark:bg-sky-950/30"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-sky-900 dark:text-sky-100">
              {t('labelStripExport.preview')}
            </h3>
          </div>
          {preview ? (
            typeof preview === 'string' ? (
              <div
                data-export-scroll="true"
                className="max-h-[28rem] overflow-auto rounded border border-sky-200 bg-white p-3 dark:border-sky-800 dark:bg-gray-900"
                dangerouslySetInnerHTML={{ __html: preview }}
              />
            ) : (
              <LabelStripPdfPreview blob={preview} />
            )
          ) : (
            <div className="flex h-80 items-center justify-center gap-2 rounded border border-sky-200 bg-white text-sm text-gray-500 dark:border-sky-800 dark:bg-gray-900 dark:text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t('labelStripExport.previewLoading')}
            </div>
          )}
        </section>
      ) : null}
      {previewError ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t('labelStripExport.previewError')}
        </p>
      ) : null}

      <section className="rounded-md border border-gray-200 p-3 dark:border-gray-700">
        <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t('labelStripExport.paperSettings')}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <h4 className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-300">
              {t('labelStripExport.exportFormat')}
            </h4>
            <div className="grid grid-cols-3 gap-2" role="radiogroup">
              {(['A4', 'A3'] as const).map((size) => {
                const selected = exportFormat === 'pdf' && paperSize === size
                return (
                  <button
                    key={size}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setExportFormat('pdf')
                      setPaperSize(size)
                    }}
                    className={`${tileClass(selected)} justify-center`}
                  >
                    {selected ? <SelectionMark /> : null}
                    <FileText className={size === 'A4' ? 'h-5 w-5' : 'h-7 w-7'} aria-hidden />
                    <span>{size}</span>
                  </button>
                )
              })}
              <button
                type="button"
                role="radio"
                aria-checked={exportFormat === 'brother-lbx'}
                onClick={() => setExportFormat('brother-lbx')}
                className={`${tileClass(exportFormat === 'brother-lbx')} justify-center`}
              >
                {exportFormat === 'brother-lbx' ? <SelectionMark /> : null}
                <Tag className="h-5 w-5" aria-hidden />
                <span>{t('labelStripExport.brotherLbx')}</span>
              </button>
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-300">
              {exportFormat === 'brother-lbx'
                ? t('labelStripExport.brotherPrinter')
                : t('labelStripExport.preset')}
            </h4>
            {exportFormat === 'brother-lbx' ? (
              <>
                <CustomDropdown
                  value={brotherPrinter}
                  onChange={(value) => {
                    const printer = value as BrotherPrinter
                    setBrotherPrinter(printer)
                    setBrotherTapeWidthMm(getDefaultBrotherTapeWidthMm(printer))
                    setBrotherMode(getDefaultBrotherLbxMode(printer))
                  }}
                  options={[
                    {
                      value: 'pt-p900-family',
                      label: t('labelStripExport.brotherP900Family'),
                    },
                    { value: 'pt-e920bt', label: t('labelStripExport.brotherE920') },
                    { value: 'pt-p910bt', label: t('labelStripExport.brotherP910') },
                    { value: 'pt-e800w', label: t('labelStripExport.brotherE800') },
                    { value: 'pt-d800w', label: t('labelStripExport.brotherD800') },
                    { value: 'pt-e550w', label: t('labelStripExport.brotherE550') },
                    { value: 'pt-e560bt', label: t('labelStripExport.brotherE560') },
                    { value: 'pt-e310bt', label: t('labelStripExport.brotherE310') },
                    { value: 'ql-810w', label: t('labelStripExport.brotherQl810w') },
                    { value: 'ql-820nwb', label: t('labelStripExport.brotherQl820') },
                  ]}
                  ariaLabel={t('labelStripExport.brotherPrinter')}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                />
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <CustomDropdown
                    value={String(brotherTapeWidthMm)}
                    onChange={(value) => setBrotherTapeWidthMm(Number(value) as BrotherTapeWidthMm)}
                    options={getBrotherTapeWidthsMm(brotherPrinter).map((width) => ({
                      value: String(width),
                      label: `${width} mm`,
                    }))}
                    ariaLabel={t('labelStripExport.brotherTapeWidth')}
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                  />
                  <div className="grid grid-cols-2 gap-2" role="radiogroup">
                    {(
                      [
                        ['sheets', t('labelStripExport.brotherSheets')],
                        ['single-strip', t('labelStripExport.brotherSingleStrip')],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={brotherMode === value}
                        onClick={() => setBrotherMode(value)}
                        className={`${tileClass(brotherMode === value)} justify-center px-2 text-xs`}
                      >
                        {brotherMode === value ? <SelectionMark /> : null}
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <CustomDropdown
                value={preset}
                onChange={(value) => setPreset(value as StripPreset)}
                options={[
                  { value: '25', label: t('labelStripExport.generic25') },
                  { value: '35', label: t('labelStripExport.generic35') },
                  { value: 'custom', label: t('labelStripExport.custom') },
                ]}
                ariaLabel={t('labelStripExport.preset')}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
            )}
            {exportFormat === 'pdf' && preset === 'custom' ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {stripMode === 'double' ? (
                  <label className="text-xs text-gray-600 dark:text-gray-300">
                    <span className="mb-1 block">{t('labelStripExport.customHeightFirst')}</span>
                    <span className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="100"
                        step="1"
                        inputMode="numeric"
                        value={customHeight}
                        onChange={(event) => setCustomHeight(event.target.value)}
                        className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                        aria-label={t('labelStripExport.customHeightFirst')}
                      />
                      <span className="shrink-0">mm</span>
                    </span>
                  </label>
                ) : null}
                <label className="text-xs text-gray-600 dark:text-gray-300">
                  <span className="mb-1 block">
                    {stripMode === 'double'
                      ? t('labelStripExport.customHeightSecond')
                      : t('labelStripExport.customHeight')}
                  </span>
                  <span className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      step="1"
                      inputMode="numeric"
                      value={stripMode === 'double' ? customSecondHeight : customHeight}
                      onChange={(event) =>
                        stripMode === 'double'
                          ? setCustomSecondHeight(event.target.value)
                          : setCustomHeight(event.target.value)
                      }
                      className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                      aria-label={
                        stripMode === 'double'
                          ? t('labelStripExport.customHeightSecond')
                          : t('labelStripExport.customHeight')
                      }
                    />
                    <span className="shrink-0">mm</span>
                  </span>
                </label>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-700">
          <h4 className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-300">
            {t('labelStripExport.mode')}
          </h4>
          <div className="grid grid-cols-2 gap-2" role="radiogroup">
            {(
              [
                {
                  value: 'single' as const,
                  label: t('labelStripExport.modeSingle'),
                  icon: SingleStripIcon,
                },
                {
                  value: 'double' as const,
                  label: t('labelStripExport.modeDouble'),
                  icon: DoubleStripIcon,
                },
              ] as const
            ).map((choice) => {
              const selected = stripMode === choice.value
              const Icon = choice.icon
              return (
                <button
                  key={choice.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setStripMode(choice.value)}
                  className={`${tileClass(selected)} justify-center`}
                >
                  {selected ? <SelectionMark /> : null}
                  <Icon className="h-7 w-10" />
                  <span>{choice.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </section>

      <section className="rounded-md border border-gray-200 p-3 dark:border-gray-700">
        <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
          {t('labelStripExport.panelContents')}
        </h3>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div>
            <h4 className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-300">
              {t('labelStripExport.sourcesTitle')}
            </h4>
            <div
              data-export-scroll="true"
              className="max-h-48 divide-y divide-gray-200 overflow-y-auto rounded-md border border-gray-200 dark:divide-gray-700 dark:border-gray-700"
              role="group"
            >
              {sources.length === 0 ? (
                <p className="p-3 text-sm text-gray-500 dark:text-gray-400">
                  {t('labelStripExport.noSources')}
                </p>
              ) : (
                sources.map((source) => {
                  const disabled = source.kind === 'junction-panel' && !includeTerminalStrips
                  const selected = !disabled && selectedKeys.has(sourceKey(source))
                  return (
                    <label
                      key={sourceKey(source)}
                      className={`flex items-center gap-3 px-3 py-1.5 text-sm transition-colors focus-within:bg-sky-50 focus-within:ring-2 focus-within:ring-inset focus-within:ring-sky-500 dark:focus-within:bg-sky-900/20 ${
                        disabled
                          ? 'cursor-not-allowed text-gray-500 opacity-60 dark:text-gray-400'
                          : selected
                            ? 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
                            : 'cursor-pointer text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                      }`}
                    >
                      {source.kind === 'junction-panel' ? (
                        <LibrarySymbolIcon symbolId="junction_panel" className="h-5 w-5 shrink-0" />
                      ) : (
                        <PanelIcon className="h-5 w-5 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{source.label}</span>
                      {source.kind === 'virtual' ? (
                        <span className="shrink-0 text-xs font-normal text-gray-500 dark:text-gray-400">
                          {t('labelStripExport.virtualSource')}
                        </span>
                      ) : null}
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={disabled}
                        onChange={() => toggleSource(source)}
                        className="sr-only"
                        aria-label={source.label}
                      />
                      <span
                        aria-hidden
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          selected
                            ? 'border-sky-600 bg-sky-600 text-white'
                            : 'border-gray-400 bg-white dark:border-gray-500 dark:bg-gray-800'
                        }`}
                      >
                        {selected ? <Check className="h-3 w-3" /> : null}
                      </span>
                    </label>
                  )
                })
              )}
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-300">
              {t('labelStripExport.include')}
            </h4>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1" role="group">
              {includeChoices.map((choice) => (
                <button
                  key={choice.key}
                  type="button"
                  aria-pressed={choice.selected}
                  onClick={choice.toggle}
                  className={`${tileClass(choice.selected)} justify-start`}
                >
                  {choice.selected ? <SelectionMark /> : null}
                  <LibrarySymbolIcon symbolId={choice.symbolId} className="h-7 w-9 shrink-0" />
                  <span className="truncate">{choice.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <label className="mt-3 flex cursor-pointer items-start gap-2 border-t border-gray-200 pt-3 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={skipEmptyRows}
            onChange={(event) => setSkipEmptyRows(event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500 dark:border-gray-600 dark:bg-gray-800"
          />
          <span>
            <span className="block font-medium">{t('labelStripExport.skipEmptyRows')}</span>
            <span className="block text-xs text-gray-500 dark:text-gray-400">
              {t('labelStripExport.skipEmptyRowsDescription')}
            </span>
          </span>
        </label>
      </section>

      <div className="flex justify-end gap-2 border-t border-gray-200 pt-3 dark:border-gray-700">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          {t('common.close')}
        </button>
        <button
          type="button"
          data-testid="label-strip-preview"
          onClick={handlePreview}
          className="inline-flex items-center gap-2 rounded-md border border-sky-600 px-4 py-2 font-medium text-sky-700 hover:bg-sky-50 dark:border-sky-400 dark:text-sky-300 dark:hover:bg-sky-950/40"
        >
          {isPreviewing ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : previewRequested ? (
            <EyeOff className="h-4 w-4" aria-hidden />
          ) : (
            <Eye className="h-4 w-4" aria-hidden />
          )}
          {previewRequested ? t('labelStripExport.hidePreview') : t('labelStripExport.preview')}
        </button>
        <button
          type="button"
          data-testid="label-strip-export-submit"
          onClick={handleExport}
          className="rounded-md bg-sky-600 px-4 py-2 font-medium text-white shadow-sm hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
        >
          {t('labelStripExport.export')}
        </button>
      </div>
    </div>
  )
}
