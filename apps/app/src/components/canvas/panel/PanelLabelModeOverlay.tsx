import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { PanelGridModuleRef, PanelLabelCellSource, PanelLabelConfig } from '@/types/schema'
import type { ProjectV2 } from '@/types/projectV2'
import type { BaseCanvasHandle } from '../BaseCanvas'
import {
  getPanelLabelSource,
  getPanelLabelSources,
  getPanelLabelText,
  getPanelLabelValues,
  setPanelLabelSource,
  setPanelLabelSources,
  setPanelLabelAlignment,
  swapPanelLabelSources,
  type PanelLabelCellSide,
  type PanelLabelValues,
} from '@/lib/panel/panelLabelContent'
import {
  CELL_W,
  panelGridModuleRefKey,
  ROW_GAP,
  type ModulePlacement,
} from '@/lib/panel/panelGridLayout'
import type { ModuleDisplayInfo } from '@/lib/panel/getModuleDisplayInfo'
import { getCachedModuleDisplayInfo } from '@/lib/panel/moduleDisplayInfoCache'
import {
  canMarkPanelMainProtection,
  getPanelMainProtectionRole,
  panelMainProtectionRoleText,
  panelMainProtectionSide,
  toggledPanelMainProtectionOverride,
  type PanelMainProtectionRole,
} from '@/lib/panel/panelMainProtection'
import type { PanelSceneSurface } from '@/lib/panel/panelScene'

export type PanelLabelEntityUpdates = {
  notes?: string
  labelNotes?: string
  panelLabel?: PanelLabelConfig
}

interface PanelLabelItem {
  surfaceId: string
  ref: PanelGridModuleRef
  placement: ModulePlacement & { inSupplyPanel?: boolean }
  info: ModuleDisplayInfo
  values: PanelLabelValues
  canMarkMain: boolean
  mainRole: PanelMainProtectionRole | null
  mainOverrideOnToggle: boolean | null
}

type LabelAlignment = 'left' | 'center' | 'right' | 'justify'

interface BulkLabelTarget {
  surfaceId: string
  rowKey?: string
  side: PanelLabelCellSide
  anchor: 'panel' | 'left' | 'right'
  sources: PanelLabelCellSource[]
  alignment: LabelAlignment | null
}

interface LabelCellProps {
  side: PanelLabelCellSide
  item: PanelLabelItem
  zoom: number
  canEdit: boolean
  onWheel: (event: WheelEvent) => void
  onUpdate: (ref: PanelGridModuleRef, updates: PanelLabelEntityUpdates) => void
  focusRequestId: number | null
  onRequestFocus: (side: PanelLabelCellSide) => void
  bandFontSize: number
}

const SOURCE_OPTIONS: PanelLabelCellSource[] = [
  'label',
  'notes',
  'labelNotes',
  'technical',
  'feeds',
]
/** Sources that stack in one cell, in print order; the others replace the cell content. */
const COMBINABLE_SOURCES: PanelLabelCellSource[] = ['label', 'notes', 'feeds']
const ALIGNMENT_OPTIONS: LabelAlignment[] = ['left', 'center', 'right', 'justify']

function sameSources(left: PanelLabelCellSource[], right: PanelLabelCellSource[]): boolean {
  return left.length === right.length && left.every((source, index) => source === right[index])
}

function uniformSources(items: PanelLabelItem[], side: PanelLabelCellSide): PanelLabelCellSource[] {
  const first = items[0]
  if (!first) return []
  const sources = getPanelLabelSources(first.values.config, side, first.values)
  return items.every((item) => sameSources(getPanelLabelSources(item.values.config, side, item.values), sources))
    ? sources
    : []
}

function uniformAlignment(
  items: PanelLabelItem[],
  side: PanelLabelCellSide
): LabelAlignment | null {
  const first = items[0]
  if (!first) return null
  const alignment = first.values.config?.[side]?.alignment ?? 'center'
  return items.every((item) => (item.values.config?.[side]?.alignment ?? 'center') === alignment)
    ? alignment
    : null
}

function toggledSources(
  selectedSources: PanelLabelCellSource[],
  nextSource: PanelLabelCellSource
): PanelLabelCellSource[] {
  if (!COMBINABLE_SOURCES.includes(nextSource)) return [nextSource]
  if (!selectedSources.every((source) => COMBINABLE_SOURCES.includes(source))) {
    return [nextSource]
  }
  const toggled = selectedSources.includes(nextSource)
    ? selectedSources.filter((source) => source !== nextSource)
    : [...selectedSources, nextSource]
  return toggled.length
    ? COMBINABLE_SOURCES.filter((source) => toggled.includes(source))
    : ['labelNotes']
}

function compactModuleGeometry(item: PanelLabelItem, zoom: number) {
  const width = item.placement.width * zoom
  const height = item.placement.height * zoom * 0.5
  const top = item.placement.y * zoom + item.placement.height * zoom * 0.25
  return { width, height, top }
}

function panelLabelRowKey(item: PanelLabelItem): string {
  return `${item.placement.inSupplyPanel ? 'supply' : 'main'}:${item.placement.terminalStripRail ?? 'regular'}:${item.placement.row}`
}

function sourceLabel(source: PanelLabelCellSource, t: (key: string, fallback: string) => string) {
  if (source === 'label') return t('panelCanvas.labelSourceLabel', 'Label')
  if (source === 'notes') return t('panelCanvas.labelSourceNotes', 'Notes')
  if (source === 'labelNotes') return t('panelCanvas.labelSourceExtra', 'Label text')
  if (source === 'feeds') return t('panelCanvas.labelSourceFeeds', 'Feeds')
  return t('panelCanvas.labelSourceTechnical', 'Technical')
}

function alignmentLabel(
  alignment: 'left' | 'center' | 'right' | 'justify',
  t: (key: string, fallback: string) => string
) {
  return t(`panelCanvas.labelAlign${alignment[0]!.toUpperCase()}${alignment.slice(1)}`, alignment)
}

const MAX_CELL_FONT_SIZE = 11
const MIN_CELL_FONT_SIZE = 5.5
const PLACEHOLDER_CELL_FONT_SIZE = 8

function fittedCellFontSize(value: string, width: number, height: number): number {
  if (!value) return MAX_CELL_FONT_SIZE
  const paragraphs = value.split(/\r?\n/)
  const usableWidth = Math.max(8, width - 4)
  const usableHeight = Math.max(6, height - 4)
  const fits = (size: number, allowWrapping: boolean) => {
    const charsPerLine = Math.max(1, Math.floor(usableWidth / (size * 0.56)))
    const lines = paragraphs.reduce(
      (total, paragraph) =>
        total + (allowWrapping ? Math.max(1, Math.ceil(paragraph.length / charsPerLine)) : 1),
      0
    )
    const widest = Math.max(0, ...paragraphs.map((paragraph) => paragraph.length))
    return lines * size * 1.05 <= usableHeight && (allowWrapping || widest <= charsPerLine)
  }

  // Prefer reducing the type size while preserving authored line breaks. Only introduce
  // automatic wrapping after a single-line fit has reached the minimum useful size.
  for (let size = MAX_CELL_FONT_SIZE; size >= MIN_CELL_FONT_SIZE; size -= 0.5) {
    if (fits(size, false)) return size
  }
  for (let size = MAX_CELL_FONT_SIZE; size >= MIN_CELL_FONT_SIZE; size -= 0.5) {
    if (fits(size, true)) return size
  }
  return MIN_CELL_FONT_SIZE
}

function LabelCell({
  side,
  item,
  zoom,
  canEdit,
  onWheel,
  onUpdate,
  focusRequestId,
  onRequestFocus,
  bandFontSize,
}: LabelCellProps) {
  const { t, i18n } = useTranslation()
  const cellRef = useRef<HTMLDivElement>(null)
  const shelfRef = useRef<HTMLDivElement>(null)
  const shelfActionsRef = useRef<{
    updateSource: (source: PanelLabelCellSource) => void
    updateAlignment: (alignment: 'left' | 'center' | 'right' | 'justify') => void
    toggleMain: () => void
  } | null>(null)
  const blurTimerRef = useRef<number | null>(null)
  const pendingCommitRef = useRef<(() => void) | null>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const source = getPanelLabelSource(item.values.config, side, item.values)
  const value = getPanelLabelText(item.values.config, side, item.values)
  const [draft, setDraft] = useState(value)
  const [edited, setEdited] = useState(false)
  const hasDraftChanges = edited && draft !== value
  const moduleGeometry = compactModuleGeometry(item, zoom)
  const halfRowGap = (ROW_GAP * zoom) / 2
  const cellHeight = item.placement.height * zoom * 0.25 + halfRowGap
  const isNarrowModule = item.placement.width < CELL_W
  const expandedWidth = isNarrowModule ? Math.max(moduleGeometry.width, 72) : moduleGeometry.width
  const cellWidth = hovered || focused ? expandedWidth : moduleGeometry.width
  const cellLeft = item.placement.x * zoom - (cellWidth - moduleGeometry.width) / 2
  const showSourceBubbles = canEdit && focused
  const selectedSources = getPanelLabelSources(item.values.config, side, item.values)
  const activeSources: PanelLabelCellSource[] =
    hasDraftChanges && source !== 'notes' && source !== 'labelNotes'
      ? ['labelNotes']
      : selectedSources
  const activeSource = activeSources[0] ?? 'labelNotes'
  const configuredAlignment = item.values.config?.[side]?.alignment ?? 'center'
  const [alignment, setAlignment] = useState(configuredAlignment)
  const visibleValue = focused ? draft : value
  const showTechnicalDisplay =
    !focused && selectedSources.length === 1 && selectedSources[0] === 'technical'
  const showPlaceholder = visibleValue.length === 0 && !showTechnicalDisplay
  const draftFontSize = fittedCellFontSize(
    visibleValue,
    item.placement.width,
    item.placement.height * 0.25 + ROW_GAP / 2
  )
  const fontSize = Math.min(bandFontSize, draftFontSize) * zoom
  const mainSide = panelMainProtectionSide(
    getPanelLabelSources(item.values.config, 'top', item.values),
    getPanelLabelSources(item.values.config, 'bottom', item.values)
  )
  const mainBandText =
    item.mainRole && mainSide === side
      ? panelMainProtectionRoleText(item.mainRole, t, i18n.language)
      : ''
  const mainBandHeight = mainBandText ? cellHeight * 0.3 : 0

  const [draftSource, setDraftSource] = useState({ focused, value })
  if (draftSource.focused !== focused || draftSource.value !== value) {
    setDraftSource({ focused, value })
    if (!focused) {
      setDraft(value)
      setEdited(false)
    }
  }
  const [alignmentSource, setAlignmentSource] = useState(configuredAlignment)
  if (alignmentSource !== configuredAlignment) {
    setAlignmentSource(configuredAlignment)
    setAlignment(configuredAlignment)
  }
  useLayoutEffect(() => {
    if (focusRequestId != null) cellRef.current?.querySelector('textarea')?.focus()
  }, [focusRequestId])
  useEffect(() => {
    const cell = cellRef.current
    if (!cell) return
    cell.addEventListener('wheel', onWheel, { passive: false })
    return () => cell.removeEventListener('wheel', onWheel)
  }, [onWheel])
  useEffect(
    () => () => {
      if (blurTimerRef.current != null) window.clearTimeout(blurTimerRef.current)
      // Switching boards or leaving label mode must retain an unblurred draft.
      pendingCommitRef.current?.()
    },
    []
  )

  const commitDraft = useCallback(() => {
    if (!hasDraftChanges) return
    if (source === 'notes') {
      onUpdate(item.ref, { notes: draft })
      return
    }
    onUpdate(item.ref, {
      labelNotes: draft,
      panelLabel:
        source === 'labelNotes'
          ? item.values.config
          : setPanelLabelSource(item.values.config, side, 'labelNotes'),
    })
  }, [draft, hasDraftChanges, item.ref, item.values.config, onUpdate, side, source])

  useLayoutEffect(() => {
    pendingCommitRef.current = hasDraftChanges ? commitDraft : null
  }, [hasDraftChanges, commitDraft])

  const pendingDraftUpdate = hasDraftChanges
    ? source === 'notes'
      ? { notes: draft }
      : { labelNotes: draft }
    : {}

  const updateSource = (nextSource: PanelLabelCellSource) => {
    const nextSources = toggledSources(selectedSources, nextSource)
    const nextConfig = setPanelLabelSources(item.values.config, side, nextSources, item.values)
    onUpdate(item.ref, {
      ...pendingDraftUpdate,
      panelLabel: nextConfig,
    })
    const nextValues = hasDraftChanges
      ? source === 'notes'
        ? { ...item.values, notes: draft }
        : { ...item.values, labelNotes: draft }
      : item.values
    setDraft(getPanelLabelText(nextConfig, side, nextValues))
    setEdited(false)
  }

  const updateAlignment = (nextAlignment: 'left' | 'center' | 'right' | 'justify') => {
    setAlignment(nextAlignment)
    onUpdate(item.ref, {
      ...pendingDraftUpdate,
      panelLabel: setPanelLabelAlignment(item.values.config, side, nextAlignment, item.values),
    })
  }

  const swapThisModule = () => {
    const nextConfig = swapPanelLabelSources(item.values.config, item.values)
    const nextValues = hasDraftChanges
      ? source === 'notes'
        ? { ...item.values, notes: draft }
        : { ...item.values, labelNotes: draft }
      : item.values
    onUpdate(item.ref, {
      ...pendingDraftUpdate,
      panelLabel: nextConfig,
    })
    setDraft(getPanelLabelText(nextConfig, side, nextValues))
    setEdited(false)
    onRequestFocus(side === 'top' ? 'bottom' : 'top')
  }

  const toggleMain = () => {
    onUpdate(item.ref, {
      ...pendingDraftUpdate,
      panelLabel: { ...item.values.config, main: item.mainOverrideOnToggle ?? undefined },
    })
  }

  useLayoutEffect(() => {
    shelfActionsRef.current = { updateSource, updateAlignment, toggleMain }
  })

  useEffect(() => {
    if (!focused) return
    // This HTML overlay is GPU-panned independently from Konva. Chrome can briefly paint the
    // shelf at its transformed position while native hit-testing still reports the element
    // underneath it. Capture the physical point before textarea blur and resolve the visible
    // button by its transformed viewport rect; ordinary button handlers are only the fallback
    // for keyboard/programmatic activation. See `.ai/observations.md` before removing this.
    const routeTransformedShelfPointer = (event: PointerEvent) => {
      const shelf = shelfRef.current
      if (!shelf) return
      const button = [...shelf.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => {
        const rect = candidate.getBoundingClientRect()
        return (
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        )
      })
      if (!button) return

      event.preventDefault()
      event.stopImmediatePropagation()
      const nextSource = button.dataset.labelSource as PanelLabelCellSource | undefined
      const nextAlignment = button.dataset.labelAlignment as
        'left' | 'center' | 'right' | 'justify' | undefined
      if (nextSource) shelfActionsRef.current?.updateSource(nextSource)
      if (nextAlignment) shelfActionsRef.current?.updateAlignment(nextAlignment)
      if (button.dataset.labelMain) shelfActionsRef.current?.toggleMain()
      cellRef.current?.querySelector('textarea')?.focus()
    }
    window.addEventListener('pointerdown', routeTransformedShelfPointer, true)
    return () => window.removeEventListener('pointerdown', routeTransformedShelfPointer, true)
  }, [focused])

  return (
    <div
      ref={cellRef}
      className={`absolute ${focused ? 'z-[100]' : hovered ? 'z-40' : 'z-30'}`}
      style={{
        width: cellWidth,
        height: cellHeight,
        left: cellLeft,
        top:
          side === 'top'
            ? item.placement.y * zoom - halfRowGap
            : item.placement.y * zoom + item.placement.height * zoom * 0.75,
        pointerEvents: 'auto',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <textarea
        data-testid={`panel-label-cell-${panelGridModuleRefKey(item.ref)}-${side}`}
        aria-label={`${sourceLabel(activeSource, t)} ${side}`}
        value={focused ? draft : value}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        disabled={!canEdit}
        rows={1}
        onFocus={() => {
          if (blurTimerRef.current != null) window.clearTimeout(blurTimerRef.current)
          setFocused(true)
        }}
        onBlur={() => {
          if (blurTimerRef.current != null) window.clearTimeout(blurTimerRef.current)
          blurTimerRef.current = window.setTimeout(() => {
            blurTimerRef.current = null
            const activeElement = document.activeElement
            if (
              activeElement &&
              (cellRef.current?.contains(activeElement) ||
                shelfRef.current?.contains(activeElement))
            ) {
              return
            }
            commitDraft()
            setFocused(false)
          }, 0)
        }}
        onChange={(event) => {
          setDraft(event.target.value)
          setEdited(true)
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        className={`h-full w-full select-text resize-none overflow-hidden border border-sky-300 bg-white/95 px-1 py-0.5 shadow-sm outline-none placeholder:text-slate-400 focus:border-sky-600 focus:text-slate-800 focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-600 dark:border-sky-700 dark:bg-slate-800/95 dark:placeholder:text-slate-500 dark:focus:border-sky-400 dark:focus:text-slate-100 dark:focus:ring-sky-900 dark:disabled:bg-slate-700 ${showTechnicalDisplay ? 'text-transparent' : 'text-slate-800 dark:text-slate-100'}`}
        style={{
          fontSize,
          lineHeight: 1.05,
          alignContent: 'center',
          textAlign: alignment === 'justify' ? 'justify' : alignment,
          ...(mainBandHeight ? { paddingTop: mainBandHeight + 2 } : {}),
        }}
      />
      {mainBandText && (
        <div
          aria-hidden="true"
          data-testid={`panel-label-main-band-${panelGridModuleRefKey(item.ref)}`}
          className="pointer-events-none absolute inset-x-px top-px flex items-center justify-center overflow-hidden bg-slate-950 font-bold whitespace-nowrap text-white"
          style={{
            height: mainBandHeight,
            fontSize: Math.min(mainBandHeight * 0.62, (cellWidth - 4) / (mainBandText.length * 0.74)),
            letterSpacing: '0.04em',
          }}
        >
          {mainBandText}
        </div>
      )}
      {showPlaceholder && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center overflow-hidden px-1 py-0.5 whitespace-nowrap text-slate-400 dark:text-slate-500"
          style={{
            top: mainBandHeight,
            fontSize: PLACEHOLDER_CELL_FONT_SIZE * zoom,
            lineHeight: 1.05,
            justifyContent:
              alignment === 'left' ? 'flex-start' : alignment === 'right' ? 'flex-end' : 'center',
            textAlign: alignment === 'justify' ? 'center' : alignment,
          }}
        >
          {sourceLabel(activeSource, t)}
        </div>
      )}
      {showTechnicalDisplay && (
        <div
          className="pointer-events-none absolute inset-0 flex flex-col justify-center overflow-hidden px-1 py-0.5 text-slate-800 dark:text-slate-100"
          style={{
            top: mainBandHeight,
            fontSize,
            lineHeight: 1.05,
            alignItems:
              alignment === 'left' ? 'flex-start' : alignment === 'right' ? 'flex-end' : 'center',
          }}
        >
          {(item.values.technicalParts ?? [{ text: item.values.technical }]).map((part, index) => (
            <span
              key={`${part.text}-${index}`}
              className={part.framed ? 'border border-current px-0.5 leading-none' : undefined}
              style={{
                width: part.framed ? 'auto' : '100%',
                textAlign: alignment === 'justify' ? 'justify' : alignment,
              }}
            >
              {part.text}
            </span>
          ))}
        </div>
      )}
      {canEdit && focused && (
        <button
          type="button"
          title={t('panelCanvas.swapLabelRows', 'Swap rows')}
          aria-label={t('panelCanvas.swapLabelRows', 'Swap rows')}
          onPointerDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
            swapThisModule()
          }}
          className="absolute right-full top-1/2 mr-1 flex h-6 w-6 origin-right -translate-y-1/2 items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] font-semibold text-slate-700 shadow-sm hover:bg-sky-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          ⇅
        </button>
      )}
      {showSourceBubbles && (
        <div
          ref={shelfRef}
          className={`pointer-events-auto absolute left-1/2 z-[110] flex -translate-x-1/2 gap-1 rounded-md border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-600 dark:bg-slate-800 ${
            side === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {SOURCE_OPTIONS.filter(
            (option) => option !== 'feeds' || item.values.feeds.length > 0
          ).map((option) => (
            <button
              key={option}
              type="button"
              data-label-source={option}
              aria-pressed={activeSources.includes(option)}
              aria-label={sourceLabel(option, t)}
              title={sourceLabel(option, t)}
              onClick={(event) => {
                // Physical pointer presses are handled by routeTransformedShelfPointer above.
                // Letting the synthetic click run as well would immediately toggle the source
                // back off. detail === 0 keeps keyboard/programmatic activation working.
                if (event.detail !== 0) return
                updateSource(option)
                cellRef.current?.querySelector('textarea')?.focus()
              }}
              className={`rounded-full px-2 py-1 text-[10px] font-medium whitespace-nowrap ${activeSources.includes(option) ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'}`}
            >
              {sourceLabel(option, t)}
            </button>
          ))}
          {item.canMarkMain && (
            <>
              <span className="mx-0.5 border-l border-slate-300 dark:border-slate-600" />
              <button
                type="button"
                data-label-main="true"
                aria-pressed={item.mainRole != null}
                aria-label={t('panelCanvas.labelSourceMain', 'Main')}
                title={t('panelCanvas.labelSourceMain', 'Main')}
                onClick={(event) => {
                  if (event.detail !== 0) return
                  toggleMain()
                  cellRef.current?.querySelector('textarea')?.focus()
                }}
                className={`rounded-full px-2 py-1 text-[10px] font-medium whitespace-nowrap ${item.mainRole != null ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'}`}
              >
                {t('panelCanvas.labelSourceMain', 'Main')}
              </button>
            </>
          )}
          <span className="mx-0.5 border-l border-slate-300 dark:border-slate-600" />
          {(['left', 'center', 'right', 'justify'] as const).map((option) => (
            <button
              key={option}
              type="button"
              data-label-alignment={option}
              aria-label={alignmentLabel(option, t)}
              title={alignmentLabel(option, t)}
              onClick={(event) => {
                if (event.detail !== 0) return
                updateAlignment(option)
                cellRef.current?.querySelector('textarea')?.focus()
              }}
              className={`rounded px-1.5 py-1 text-[10px] font-semibold ${alignment === option ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'}`}
            >
              {option === 'left'
                ? '≡←'
                : option === 'right'
                  ? '→≡'
                  : option === 'justify'
                    ? '↔'
                    : '≡'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function PanelLabelModeOverlay({
  scene,
  project,
  canvasRef,
  panelZoom,
  panelPan,
  canEdit,
  onUpdateModuleLabel,
  onUpdateModuleLabels,
}: {
  scene: { surfaces: PanelSceneSurface[] } | null
  project: ProjectV2 | null
  canvasRef: RefObject<BaseCanvasHandle | null>
  panelZoom: number
  panelPan: { x: number; y: number }
  canEdit: boolean
  onUpdateModuleLabel: (ref: PanelGridModuleRef, updates: PanelLabelEntityUpdates) => void
  onUpdateModuleLabels: (
    changes: Array<{ ref: PanelGridModuleRef; updates: PanelLabelEntityUpdates }>
  ) => void
}) {
  const { t, i18n } = useTranslation()
  const [swapping, setSwapping] = useState(false)
  const [liveZoom, setLiveZoom] = useState(panelZoom)
  const [focusRequest, setFocusRequest] = useState<{
    moduleKey: string
    side: PanelLabelCellSide
    id: number
  } | null>(null)
  const [bulkTarget, setBulkTarget] = useState<BulkLabelTarget | null>(null)
  const liveZoomRef = useRef(panelZoom)
  const livePanRef = useRef(panelPan)
  const overlayRef = useRef<HTMLDivElement>(null)
  const bulkShelfRef = useRef<HTMLDivElement>(null)
  const bulkActionsRef = useRef<{
    updateSource: (source: PanelLabelCellSource) => void
    updateAlignment: (alignment: LabelAlignment) => void
  } | null>(null)
  const items = useMemo<PanelLabelItem[]>(() => {
    if (!scene || !project) return []
    return scene.surfaces.flatMap((surface) =>
      surface.placements
        .filter((placement) => placement.terminalStripRail == null)
        .map((placement) => {
          const info = getCachedModuleDisplayInfo(placement.ref, project, i18n.language)
          const values = getPanelLabelValues(placement.ref, project, info)
          return {
            surfaceId: surface.id,
            ref: placement.ref,
            placement,
            info,
            values,
            canMarkMain: canMarkPanelMainProtection(placement.ref, project),
            mainRole: getPanelMainProtectionRole(placement.ref, project, values.config),
            mainOverrideOnToggle: toggledPanelMainProtectionOverride(
              placement.ref,
              project,
              values.config
            ),
          }
        })
    )
  }, [project, scene, i18n.language])

  const getBulkItems = useCallback(
    (target: BulkLabelTarget) =>
      items.filter(
        (item) =>
          item.surfaceId === target.surfaceId &&
          (target.rowKey == null || panelLabelRowKey(item) === target.rowKey)
      ),
    [items]
  )

  const toggleBulkTarget = useCallback(
    (
      surfaceId: string,
      rowKey: string | undefined,
      side: PanelLabelCellSide,
      anchor: BulkLabelTarget['anchor']
    ) => {
      if (!canEdit) return
      const scopeItems = items.filter(
        (item) =>
          item.surfaceId === surfaceId && (rowKey == null || panelLabelRowKey(item) === rowKey)
      )
      setBulkTarget((current) => {
        if (
          current?.surfaceId === surfaceId &&
          current.rowKey === rowKey &&
          current.side === side &&
          current.anchor === anchor
        ) {
          return null
        }
        return {
          surfaceId,
          rowKey,
          side,
          anchor,
          sources: uniformSources(scopeItems, side),
          alignment: uniformAlignment(scopeItems, side),
        }
      })
    },
    [canEdit, items]
  )

  const updateBulkSource = useCallback(
    (nextSource: PanelLabelCellSource) => {
      if (!bulkTarget || !canEdit) return
      const nextSources = toggledSources(bulkTarget.sources, nextSource)
      const seen = new Set<string>()
      const changes: Array<{ ref: PanelGridModuleRef; updates: PanelLabelEntityUpdates }> = []
      for (const item of getBulkItems(bulkTarget)) {
        const key = panelGridModuleRefKey(item.ref)
        if (seen.has(key)) continue
        seen.add(key)
        // Modules that feed a single circuit have no list to show.
        if (nextSource === 'feeds' && !item.values.feeds) continue
        changes.push({
          ref: item.ref,
          updates: {
            panelLabel: setPanelLabelSources(item.values.config, bulkTarget.side, nextSources, item.values),
          },
        })
      }
      onUpdateModuleLabels(changes)
      setBulkTarget((current) => (current ? { ...current, sources: nextSources } : current))
    },
    [bulkTarget, canEdit, getBulkItems, onUpdateModuleLabels]
  )

  const updateBulkAlignment = useCallback(
    (nextAlignment: LabelAlignment) => {
      if (!bulkTarget || !canEdit) return
      const seen = new Set<string>()
      const changes: Array<{ ref: PanelGridModuleRef; updates: PanelLabelEntityUpdates }> = []
      for (const item of getBulkItems(bulkTarget)) {
        const key = panelGridModuleRefKey(item.ref)
        if (seen.has(key)) continue
        seen.add(key)
        changes.push({
          ref: item.ref,
          updates: {
            panelLabel: setPanelLabelAlignment(item.values.config, bulkTarget.side, nextAlignment, item.values),
          },
        })
      }
      onUpdateModuleLabels(changes)
      setBulkTarget((current) => (current ? { ...current, alignment: nextAlignment } : current))
    },
    [bulkTarget, canEdit, getBulkItems, onUpdateModuleLabels]
  )

  useLayoutEffect(() => {
    bulkActionsRef.current = { updateSource: updateBulkSource, updateAlignment: updateBulkAlignment }
  }, [updateBulkSource, updateBulkAlignment])

  useEffect(() => {
    const routeBulkPointer = (event: PointerEvent) => {
      const shelfButton = [
        ...(bulkShelfRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []),
      ].find((candidate) => {
        const rect = candidate.getBoundingClientRect()
        return (
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        )
      })
      if (shelfButton) {
        event.preventDefault()
        event.stopImmediatePropagation()
        const source = shelfButton.dataset.labelSource as PanelLabelCellSource | undefined
        const alignment = shelfButton.dataset.labelAlignment as LabelAlignment | undefined
        if (source) bulkActionsRef.current?.updateSource(source)
        if (alignment) bulkActionsRef.current?.updateAlignment(alignment)
        return
      }

      const control = [
        ...(overlayRef.current?.querySelectorAll<HTMLButtonElement>(
          '[data-panel-label-bulk-control="true"]'
        ) ?? []),
      ].find((candidate) => {
        const rect = candidate.getBoundingClientRect()
        return (
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        )
      })
      if (control) {
        if (control.disabled) return
        event.preventDefault()
        event.stopImmediatePropagation()
        toggleBulkTarget(
          control.dataset.surfaceId!,
          control.dataset.rowKey || undefined,
          control.dataset.labelSide as PanelLabelCellSide,
          control.dataset.labelAnchor as BulkLabelTarget['anchor']
        )
        return
      }

      if (bulkTarget) setBulkTarget(null)
    }
    window.addEventListener('pointerdown', routeBulkPointer, true)
    return () => window.removeEventListener('pointerdown', routeBulkPointer, true)
  }, [bulkTarget, toggleBulkTarget])

  useEffect(() => {
    let animationFrame = 0
    const syncLiveCamera = () => {
      const liveCamera = canvasRef.current?.getLiveViewTransform()
      if (liveCamera) {
        const nextZoom = liveCamera.zoom || panelZoom
        if (Math.abs(nextZoom - liveZoomRef.current) > 0.0001) {
          liveZoomRef.current = nextZoom
          // The Konva camera has already applied this zoom in the current frame.
          // Commit the DOM geometry before the browser can paint a mismatched scale.
          flushSync(() => setLiveZoom(nextZoom))
        }
        const overlay = overlayRef.current
        const previousPan = livePanRef.current
        if (
          overlay &&
          (Math.abs(liveCamera.pan.x - previousPan.x) > 0.01 ||
            Math.abs(liveCamera.pan.y - previousPan.y) > 0.01)
        ) {
          livePanRef.current = liveCamera.pan
          overlay.style.transform = `translate3d(${liveCamera.pan.x}px, ${liveCamera.pan.y}px, 0)`
        }
      }
      animationFrame = window.requestAnimationFrame(syncLiveCamera)
    }
    animationFrame = window.requestAnimationFrame(syncLiveCamera)
    return () => window.cancelAnimationFrame(animationFrame)
  }, [canvasRef, panelZoom])

  useLayoutEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return
    const liveCamera = canvasRef.current?.getLiveViewTransform()
    const pan = liveCamera?.pan ?? panelPan
    livePanRef.current = pan
    overlay.style.transform = `translate3d(${pan.x}px, ${pan.y}px, 0)`
  }, [canvasRef, liveZoom, panelPan])

  const forwardWheelToCanvas = useCallback(
    (event: WheelEvent) => {
      const stage = canvasRef.current?.getStage()
      const stageContent = stage?.content
      if (!stageContent) return
      event.preventDefault()
      event.stopPropagation()
      stageContent.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: event.clientX,
          clientY: event.clientY,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaZ: event.deltaZ,
          deltaMode: event.deltaMode,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
        })
      )
    },
    [canvasRef]
  )

  if (!scene || !project) return null

  const swapControlSize = Math.max(12, Math.min(46, 32 * Math.pow(liveZoom, 0.7)))
  const swapControlInset = Math.max(2, swapControlSize * 0.125)
  const swapControlFontSize = Math.max(8, Math.min(19, swapControlSize * 0.44))
  const bulkControlSize = Math.max(12, Math.min(30, 21 * Math.pow(liveZoom, 0.55)))
  const bulkControlFontSize = Math.max(8, Math.min(13, bulkControlSize * 0.48))

  const swapItems = (rowItems: PanelLabelItem[]) => {
    if (!canEdit || swapping) return
    setSwapping(true)
    const seen = new Set<string>()
    const changes: Array<{ ref: PanelGridModuleRef; updates: PanelLabelEntityUpdates }> = []
    for (const item of rowItems) {
      const key = panelGridModuleRefKey(item.ref)
      if (seen.has(key)) continue
      seen.add(key)
      changes.push({
        ref: item.ref,
        updates: {
          panelLabel: swapPanelLabelSources(item.values.config, item.values),
        },
      })
    }
    onUpdateModuleLabels(changes)
    setSwapping(false)
  }

  return (
    <div ref={overlayRef} className="pointer-events-none absolute inset-0 z-[5] select-none">
      {scene.surfaces.map((surface) => {
        const surfaceItems = items.filter((item) => item.surfaceId === surface.id)
        if (surfaceItems.length === 0) return null
        const rows = new Map<string, PanelLabelItem[]>()
        for (const item of surfaceItems) {
          const rowKey = panelLabelRowKey(item)
          const row = rows.get(rowKey) ?? []
          row.push(item)
          rows.set(rowKey, row)
        }
        const sortedRows = [...rows.entries()].sort(
          ([, left], [, right]) => (left[0]?.placement.y ?? 0) - (right[0]?.placement.y ?? 0)
        )
        return (
          <div
            key={surface.id}
            data-panel-label-surface={surface.id}
            className="pointer-events-none absolute outline outline-2 outline-sky-400/70"
            style={{
              left: surface.x * liveZoom,
              top: surface.y * liveZoom,
              width: surface.width * liveZoom,
              height: surface.height * liveZoom,
            }}
          >
            <button
              type="button"
              disabled={!canEdit || swapping}
              title={t('panelCanvas.swapPanelLabels', 'Swap all panel label rows')}
              aria-label={t('panelCanvas.swapPanelLabels', 'Swap all panel label rows')}
              onClick={() => swapItems(surfaceItems)}
              className="pointer-events-auto absolute flex items-center justify-center rounded-full border border-slate-300 bg-white font-semibold text-slate-600 shadow-sm hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              style={{
                left: -swapControlSize - 4,
                top: 0,
                width: swapControlSize,
                height: swapControlSize,
                fontSize: swapControlFontSize,
              }}
            >
              ⇅
            </button>
            {(['top', 'bottom'] as const).map((side, index) => {
              const active =
                bulkTarget?.surfaceId === surface.id &&
                bulkTarget.rowKey == null &&
                bulkTarget.side === side
              const label =
                side === 'top'
                  ? t('panelCanvas.editPanelTopLabels', 'Edit all top labels')
                  : t('panelCanvas.editPanelBottomLabels', 'Edit all bottom labels')
              return (
                <button
                  key={`panel-${side}`}
                  type="button"
                  data-panel-label-bulk-control="true"
                  data-surface-id={surface.id}
                  data-label-side={side}
                  data-label-anchor="panel"
                  disabled={!canEdit}
                  aria-label={label}
                  title={label}
                  aria-pressed={active}
                  onClick={(event) => {
                    if (event.detail !== 0) return
                    toggleBulkTarget(surface.id, undefined, side, 'panel')
                  }}
                  className={`pointer-events-auto absolute z-20 flex items-center justify-center rounded-full border font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                    active
                      ? 'border-sky-600 bg-sky-600 text-white'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-sky-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                  }`}
                  style={{
                    left: -swapControlSize - 4 + (swapControlSize - bulkControlSize) / 2,
                    top: index === 0 ? -bulkControlSize - 3 : swapControlSize + 3,
                    width: bulkControlSize,
                    height: bulkControlSize,
                    fontSize: bulkControlFontSize,
                  }}
                >
                  {side === 'top' ? '↑' : '↓'}
                </button>
              )
            })}
            {sortedRows.map(([rowKey, rowItems]) => {
              const first = rowItems[0]
              if (!first) return null
              const rowTop = Math.min(
                ...rowItems.map((item) => compactModuleGeometry(item, liveZoom).top)
              )
              const rowBottom = Math.max(
                ...rowItems.map((item) => {
                  const geometry = compactModuleGeometry(item, liveZoom)
                  return geometry.top + geometry.height
                })
              )
              const rowButtonTop = (rowTop + rowBottom - swapControlSize) / 2
              const halfRowGap = (ROW_GAP * liveZoom) / 2
              const bandHeight = Math.max(
                ...rowItems.map((item) => item.placement.height * liveZoom * 0.25 + halfRowGap)
              )
              const bandTop = Math.min(
                ...rowItems.map((item) => item.placement.y * liveZoom - halfRowGap)
              )
              const bandBottom = Math.min(
                ...rowItems.map(
                  (item) => item.placement.y * liveZoom + item.placement.height * liveZoom * 0.75
                )
              )
              const bandLeft = Math.min(...rowItems.map((item) => item.placement.x * liveZoom))
              const bandRight = Math.max(
                ...rowItems.map((item) => (item.placement.x + item.placement.width) * liveZoom)
              )
              const bandFontSize = (side: PanelLabelCellSide) =>
                Math.min(
                  ...rowItems.map((item) =>
                    fittedCellFontSize(
                      getPanelLabelText(item.values.config, side, item.values),
                      item.placement.width,
                      item.placement.height * 0.25 + ROW_GAP / 2
                    )
                  )
                )
              const topFontSize = bandFontSize('top')
              const bottomFontSize = bandFontSize('bottom')
              return (
                <div key={rowKey}>
                  {(['top', 'bottom'] as const).map((side) => {
                    const active =
                      bulkTarget?.surfaceId === surface.id &&
                      bulkTarget.side === side &&
                      (bulkTarget.rowKey == null || bulkTarget.rowKey === rowKey)
                    if (!active) return null
                    return (
                      <div
                        key={`highlight-${side}`}
                        className="pointer-events-none absolute z-[90] rounded-sm border-2 border-sky-500 bg-sky-400/10 shadow-[0_0_0_1px_rgba(255,255,255,0.35)]"
                        style={{
                          left: bandLeft - 2,
                          top: (side === 'top' ? bandTop : bandBottom) - 2,
                          width: bandRight - bandLeft + 4,
                          height: bandHeight + 4,
                        }}
                      />
                    )
                  })}
                  {(
                    [
                      swapControlInset,
                      surface.width * liveZoom - swapControlSize - swapControlInset,
                    ] as const
                  ).map((left, index) => (
                    <button
                      key={index === 0 ? 'left-swap' : 'right-swap'}
                      type="button"
                      disabled={!canEdit || swapping}
                      title={t('panelCanvas.swapLabelRows', 'Swap rows')}
                      aria-label={t('panelCanvas.swapLabelRows', 'Swap rows')}
                      onClick={() => swapItems(rowItems)}
                      className="pointer-events-auto absolute z-20 flex items-center justify-center rounded-full border border-slate-300 bg-white font-semibold text-slate-600 shadow-sm hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      style={{
                        left,
                        top: rowButtonTop,
                        width: swapControlSize,
                        height: swapControlSize,
                        fontSize: swapControlFontSize,
                      }}
                    >
                      ⇅
                    </button>
                  ))}
                  {(['left', 'right'] as const).flatMap((anchor) =>
                    (['top', 'bottom'] as const).map((side) => {
                      const active =
                        bulkTarget?.surfaceId === surface.id &&
                        bulkTarget.rowKey === rowKey &&
                        bulkTarget.side === side &&
                        bulkTarget.anchor === anchor
                      const label =
                        side === 'top'
                          ? t('panelCanvas.editRowTopLabels', 'Edit top row labels')
                          : t('panelCanvas.editRowBottomLabels', 'Edit bottom row labels')
                      return (
                        <button
                          key={`${anchor}-${side}-bulk`}
                          type="button"
                          data-panel-label-bulk-control="true"
                          data-surface-id={surface.id}
                          data-row-key={rowKey}
                          data-label-side={side}
                          data-label-anchor={anchor}
                          disabled={!canEdit}
                          aria-label={label}
                          title={label}
                          aria-pressed={active}
                          onClick={(event) => {
                            if (event.detail !== 0) return
                            toggleBulkTarget(surface.id, rowKey, side, anchor)
                          }}
                          className={`pointer-events-auto absolute z-[105] flex items-center justify-center rounded-full border font-semibold shadow-sm disabled:cursor-not-allowed disabled:opacity-40 ${
                            active
                              ? 'border-sky-600 bg-sky-600 text-white'
                              : 'border-slate-300 bg-white text-slate-600 hover:bg-sky-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                          }`}
                          style={{
                            left:
                              anchor === 'left'
                                ? swapControlInset + (swapControlSize - bulkControlSize) / 2
                                : surface.width * liveZoom -
                                  swapControlInset -
                                  (swapControlSize + bulkControlSize) / 2,
                            top:
                              (side === 'top' ? bandTop : bandBottom) +
                              (bandHeight - bulkControlSize) / 2,
                            width: bulkControlSize,
                            height: bulkControlSize,
                            fontSize: bulkControlFontSize,
                          }}
                        >
                          {side === 'top' ? '↑' : '↓'}
                        </button>
                      )
                    })
                  )}
                  {rowItems.map((item) => (
                    <div key={panelGridModuleRefKey(item.ref)}>
                      <LabelCell
                        side="top"
                        item={item}
                        zoom={liveZoom}
                        canEdit={canEdit}
                        onWheel={forwardWheelToCanvas}
                        onUpdate={onUpdateModuleLabel}
                        focusRequestId={
                          focusRequest?.moduleKey === panelGridModuleRefKey(item.ref) &&
                          focusRequest.side === 'top'
                            ? focusRequest.id
                            : null
                        }
                        onRequestFocus={(side) =>
                          setFocusRequest((current) => ({
                            moduleKey: panelGridModuleRefKey(item.ref),
                            side,
                            id: (current?.id ?? 0) + 1,
                          }))
                        }
                        bandFontSize={topFontSize}
                      />
                      <LabelCell
                        side="bottom"
                        item={item}
                        zoom={liveZoom}
                        canEdit={canEdit}
                        onWheel={forwardWheelToCanvas}
                        onUpdate={onUpdateModuleLabel}
                        focusRequestId={
                          focusRequest?.moduleKey === panelGridModuleRefKey(item.ref) &&
                          focusRequest.side === 'bottom'
                            ? focusRequest.id
                            : null
                        }
                        onRequestFocus={(side) =>
                          setFocusRequest((current) => ({
                            moduleKey: panelGridModuleRefKey(item.ref),
                            side,
                            id: (current?.id ?? 0) + 1,
                          }))
                        }
                        bandFontSize={bottomFontSize}
                      />
                    </div>
                  ))}
                </div>
              )
            })}
            {bulkTarget?.surfaceId === surface.id &&
              (() => {
                const targetItems = getBulkItems(bulkTarget)
                if (targetItems.length === 0) return null
                const targetBandHeight = Math.max(
                  ...targetItems.map(
                    (item) => item.placement.height * liveZoom * 0.25 + (ROW_GAP * liveZoom) / 2
                  )
                )
                const targetBandTop = Math.min(
                  ...targetItems.map((item) =>
                    bulkTarget.side === 'top'
                      ? item.placement.y * liveZoom - (ROW_GAP * liveZoom) / 2
                      : item.placement.y * liveZoom + item.placement.height * liveZoom * 0.75
                  )
                )
                const isPanelTarget = bulkTarget.rowKey == null
                const isRight = bulkTarget.anchor === 'right'
                const shelfLeft = isPanelTarget
                  ? 4
                  : isRight
                    ? surface.width * liveZoom - swapControlInset - swapControlSize - 4
                    : swapControlInset + swapControlSize + 4
                const shelfTop = isPanelTarget
                  ? bulkTarget.side === 'top'
                    ? -bulkControlSize - 3
                    : swapControlSize + 3
                  : bulkTarget.side === 'top'
                    ? targetBandTop - 4
                    : targetBandTop + targetBandHeight + 4
                const shelfTransform = isPanelTarget
                  ? 'none'
                  : `translate(${isRight ? '-100%' : '0'}, ${bulkTarget.side === 'top' ? '-100%' : '0'})`
                return (
                  <div
                    ref={bulkShelfRef}
                    data-panel-label-bulk-shelf="true"
                    className="pointer-events-auto absolute z-[120] flex gap-1 rounded-md border border-sky-300 bg-white p-1 shadow-lg dark:border-sky-700 dark:bg-slate-800"
                    style={{ left: shelfLeft, top: shelfTop, transform: shelfTransform }}
                  >
                    {SOURCE_OPTIONS.filter(
                      (option) =>
                        option !== 'feeds' ||
                        getBulkItems(bulkTarget).some((item) => item.values.feeds.length > 0)
                    ).map((option) => (
                      <button
                        key={option}
                        type="button"
                        data-label-source={option}
                        aria-pressed={bulkTarget.sources.includes(option)}
                        aria-label={sourceLabel(option, t)}
                        title={sourceLabel(option, t)}
                        onClick={(event) => {
                          if (event.detail !== 0) return
                          updateBulkSource(option)
                        }}
                        className={`whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-medium ${
                          bulkTarget.sources.includes(option)
                            ? 'bg-sky-600 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
                        }`}
                      >
                        {sourceLabel(option, t)}
                      </button>
                    ))}
                    <span className="mx-0.5 border-l border-slate-300 dark:border-slate-600" />
                    {ALIGNMENT_OPTIONS.map((option) => (
                      <button
                        key={option}
                        type="button"
                        data-label-alignment={option}
                        aria-pressed={bulkTarget.alignment === option}
                        aria-label={alignmentLabel(option, t)}
                        title={alignmentLabel(option, t)}
                        onClick={(event) => {
                          if (event.detail !== 0) return
                          updateBulkAlignment(option)
                        }}
                        className={`rounded px-1.5 py-1 text-[10px] font-semibold ${
                          bulkTarget.alignment === option
                            ? 'bg-sky-600 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
                        }`}
                      >
                        {option === 'left'
                          ? '≡←'
                          : option === 'right'
                            ? '→≡'
                            : option === 'justify'
                              ? '↔'
                              : '≡'}
                      </button>
                    ))}
                  </div>
                )
              })()}
          </div>
        )
      })}
    </div>
  )
}
