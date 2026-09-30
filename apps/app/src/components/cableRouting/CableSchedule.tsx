import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Download, Ruler } from 'lucide-react'
import {
  buildCableSchedule,
  cableScheduleCsv,
  groupCableScheduleByCircuit,
  type CableScheduleCircuitGroup,
  type CableScheduleLengthSource,
  type CableScheduleRow,
} from '@/lib/cableRouting/cableSchedule'
import { cableRouteFloorId, formatCableMetres } from '@/lib/cableRouting/cableRouteSelection'
import type { CableRoutePoint } from '@/lib/cableRouting/estimateCableRoutes'
import { getSymbolById } from '@/lib/symbols'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { acceptedEstimateLengthM } from './useWireLengthSuggestion'
import { useCableRouteEstimation } from './useCableRouteEstimation'
import { useCableHoverStore } from './cableHoverStore'
import {
  cableSchedulePointFullName,
  cableSchedulePointName,
  cableSchedulePointText,
} from '@/lib/cableRouting/cableSchedulePointLabels'
import { isKeyboardTypingTarget } from '@/lib/ui/keyboardTypingTarget'
import { useDialogStore } from '@/stores/dialogStore'

const SOURCE_CLASS: Record<CableScheduleLengthSource, string> = {
  entered: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  accepted: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-100',
  estimate: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-100',
  missing: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-100',
  stale: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-100',
  uncalibrated: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-100',
}

function downloadText(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function PointCell({ point, fallback }: { point?: CableRoutePoint; fallback: string }) {
  const { t } = useTranslation()
  const meta = point?.symbolId ? getSymbolById(point.symbolId) : undefined
  if (!point) return <span className="text-gray-400">{fallback}</span>
  const name = cableSchedulePointName(point, t)
  return (
    <span
      className="flex min-w-0 items-center gap-2"
      title={[point.code, cableSchedulePointFullName(point, t)].filter(Boolean).join(' ')}
    >
      {meta ? (
        <img
          src={meta.svgPath}
          alt=""
          className="h-5 w-5 shrink-0 object-contain dark:invert"
          draggable={false}
        />
      ) : (
        <span className="h-5 w-5 shrink-0" />
      )}
      <span className="shrink-0 font-medium text-gray-800 dark:text-gray-100">{point.code}</span>
      {name && <span className="truncate text-gray-500 dark:text-gray-400">{name}</span>}
    </span>
  )
}

/** Side margin of the list; it gives way first when the table no longer fits. */
const MAX_SIDE_PADDING_PX = 72
const MIN_SIDE_PADDING_PX = 12

/**
 * The widest side margin (up to 72 px) that still lets the table fit; at least 12 px, after
 * which the table scrolls sideways.
 */
function useSidePaddingThatYields(
  containerRef: React.RefObject<HTMLDivElement | null>,
  tableRef: React.RefObject<HTMLTableElement | null>,
  /** The table is rendered (it is absent while the list is empty). */
  hasTable: boolean
): number {
  const [padding, setPadding] = useState(MAX_SIDE_PADDING_PX)
  useEffect(() => {
    const container = containerRef.current
    const table = tableRef.current
    if (!container || !table || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      // The table's own width when nothing stretches it: its content, unwrapped.
      const previousWidth = table.style.width
      table.style.width = 'max-content'
      const contentWidth = table.getBoundingClientRect().width
      table.style.width = previousWidth
      const spare = (container.clientWidth - contentWidth) / 2
      const next = Math.round(
        Math.min(MAX_SIDE_PADDING_PX, Math.max(MIN_SIDE_PADDING_PX, spare))
      )
      setPadding((current) => (current === next ? current : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    observer.observe(table)
    return () => observer.disconnect()
  }, [containerRef, tableRef, hasTable])
  return padding
}

const SOURCE_ORDER: CableScheduleLengthSource[] = ['entered', 'accepted', 'estimate', 'stale', 'uncalibrated', 'missing']

function rowLengthText(row: CableScheduleRow): string {
  if (row.lengthM != null) {
    return `${row.lengthSource === 'accepted' ? '≈ ' : ''}${formatCableMetres(row.lengthM)} m`
  }
  if (row.estimateHighM != null) {
    return `≈ ${formatCableMetres(row.estimateLowM!)}–${formatCableMetres(row.estimateHighM)} m`
  }
  return '–'
}

function groupLengthText(group: CableScheduleCircuitGroup): string {
  if (group.highM <= 0) return '–'
  if (!group.includesEstimates) return `${formatCableMetres(group.highM)} m`
  return `≈ ${formatCableMetres(group.lowM)}–${formatCableMetres(group.highM)} m`
}

function SourceBadge({ source, label }: { source: CableScheduleLengthSource; label: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${SOURCE_CLASS[source]}`}>
      {label}
    </span>
  )
}

function useCableScheduleModel() {
  const { t } = useTranslation()
  const estimation = useCableRouteEstimation()
  const projectName = useProjectStore((s) => s.currentProject?.project.name ?? '')
  const acceptEstimates = useProjectStore((s) => s.acceptWireLengthEstimates)
  const schedule = useMemo(() => buildCableSchedule(estimation?.routes ?? []), [estimation])

  const sourceLabel = (source: CableScheduleLengthSource) =>
    ({
      entered: t('cableSchedule.source.entered', 'Entered'),
      accepted: t('cableSchedule.source.accepted', 'From plan'),
      estimate: t('cableSchedule.source.estimate', 'Estimate'),
      missing: t('cableSchedule.source.missing', 'Unknown'),
      stale: t('cableSchedule.source.stale', 'Review length'),
      uncalibrated: t('cableSchedule.source.uncalibrated', 'Set scale'),
    })[source]

  const acceptable = schedule.rows.filter(
    (row) => (row.lengthSource === 'estimate' || row.lengthSource === 'stale') && row.cable && row.estimateHighM != null
  )
  const accept = (rows: CableScheduleRow[]) =>
    acceptEstimates(
      rows.map((row) => ({
        anchor: row.anchor,
        cable: row.cable!,
        lengthM: acceptedEstimateLengthM(row.estimateHighM!),
      }))
    )

  const exportCsv = () => {
    const title = t('cableSchedule.title', 'Cable schedule')
    const headers = [
      t('cableSchedule.board', 'Board'),
      t('cableSchedule.circuit', 'Circuit'),
      '#',
      t('cableSchedule.from', 'From'),
      t('cableSchedule.to', 'To'),
      t('cableSchedule.cable', 'Cable'),
      t('cableSchedule.length', 'Length (m)'),
      t('cableSchedule.estimateLow', 'Estimate low (m)'),
      t('cableSchedule.estimateHigh', 'Estimate high (m)'),
      t('cableSchedule.sourceHeader', 'Source'),
    ]
    downloadText(
      cableScheduleCsv(schedule, headers, sourceLabel, (point, fallback) =>
        cableSchedulePointText(point, fallback, t)
      ),
      `${projectName || title} - ${title}.csv`
    )
  }

  return { estimation, schedule, sourceLabel, acceptable, accept, exportCsv }
}

/** "Use estimates" and "Export CSV", shown in the Documents top bar next to the title. */
export function CableScheduleActions() {
  const { t } = useTranslation()
  const { acceptable, accept, exportCsv } = useCableScheduleModel()
  return (
    <div className="ml-auto flex shrink-0 items-center gap-2">
      {acceptable.length > 0 && (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-sky-700"
          onClick={() => accept(acceptable)}
        >
          <Ruler className="h-4 w-4" />
          {t('cableSchedule.useEstimates', 'Use estimates ({{count}})', {
            count: acceptable.length,
          })}
        </button>
      )}
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-100 dark:border-gray-500 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
        onClick={exportCsv}
      >
        <Download className="h-4 w-4" />
        {t('cableSchedule.exportCsv', 'Export CSV')}
      </button>
    </div>
  )
}

/**
 * Cable schedule: every cable run grouped by board and circuit, with its length (typed, accepted
 * from the plan, or only estimated) and totals per cable. Selecting a row selects the cable
 * everywhere, so the plan shows its route.
 */
export function CableSchedule() {
  const { t } = useTranslation()
  const { estimation, schedule, sourceLabel, accept } = useCableScheduleModel()
  const selectedAnchor = useUIStore((s) => s.selection.wireAnchor)
  const setSelection = useUIStore((s) => s.setSelection)
  const setActiveFloor = useUIStore((s) => s.setActiveFloor)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })

  const select = (row: CableScheduleRow) => {
    if (!row.cable) return
    // Show the cable on the plan: switch to the floor it runs on.
    const route = estimation?.byAnchor.get(row.anchor)
    const floorId = route ? cableRouteFloorId(route) : undefined
    if (floorId && floorId !== useUIStore.getState().activeFloorId) setActiveFloor(floorId)
    setSelection({
      type: 'structuralConnection',
      ids: [row.anchor],
      wireAnchor: row.anchor,
      structuralMetadata: {
        label: `${cableSchedulePointText(row.fromPoint, row.fromLabel, t)} → ${cableSchedulePointText(row.toPoint, row.toLabel, t)}`,
        kind: 'electrical',
        knowledge: 'explicit',
        source: { entityKind: 'wire', container: 'cableSchedule' },
        wire: { cable: row.cable, label: row.cableLabel, conductorCount: row.cable.conductors },
      },
    })
  }

  // Hovering a row shows its cable on the plan; a collapsed circuit shows all of its cables.
  const setHovered = useCableHoverStore((s) => s.setHovered)
  useEffect(() => () => setHovered([]), [setHovered])

  const groups = groupCableScheduleByCircuit(schedule.rows)
  // Arrow up/down steps through the visible rows while the pointer is over the list.
  const visibleRows = groups.flatMap((group) => (collapsed.has(group.key) ? [] : group.rows))
  const listRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const sidePaddingPx = useSidePaddingThatYields(listRef, tableRef, schedule.rows.length > 0)
  const pointerInsideRef = useRef(false)
  const stepRef = useRef<(delta: number) => boolean>(() => false)
  stepRef.current = (delta) => {
    const index = visibleRows.findIndex((row) => row.anchor === selectedAnchor)
    if (index < 0) return false
    for (let next = index + delta; next >= 0 && next < visibleRows.length; next += delta) {
      const row = visibleRows[next]!
      if (!row.cable) continue
      select(row)
      listRef.current
        ?.querySelector(`[data-anchor="${CSS.escape(row.anchor)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
      return true
    }
    return true
  }
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      if (event.ctrlKey || event.metaKey || event.altKey || !pointerInsideRef.current) return
      if (isKeyboardTypingTarget(event.target) || useDialogStore.getState().dialog) return
      if (!stepRef.current(event.key === 'ArrowDown' ? 1 : -1)) return
      // Capture phase: the app-wide arrow shortcuts must not also nudge anything.
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const headers = [
    t('cableSchedule.circuit', 'Circuit'),
    '#',
    t('cableSchedule.from', 'From'),
    t('cableSchedule.to', 'To'),
    t('cableSchedule.cable', 'Cable'),
    t('cableSchedule.length', 'Length (m)'),
    t('cableSchedule.sourceHeader', 'Source'),
  ]

  let previousBoard: string | undefined

  return (
    <div
      ref={listRef}
      className="h-full overflow-auto pb-6"
      style={{ paddingInline: sidePaddingPx }}
      data-testid="cable-schedule"
      data-documents-scroll="true"
      onMouseEnter={() => {
        pointerInsideRef.current = true
      }}
      onMouseLeave={() => {
        pointerInsideRef.current = false
        setHovered([])
      }}
    >
      {schedule.rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
          {t('cableSchedule.empty', 'Place symbols on the plan to list their cables.')}
        </p>
      ) : (
        <table
          ref={tableRef}
          className="w-full border-separate border-spacing-y-0.5 text-sm"
        >
          <thead className="sticky top-0 z-10 bg-white text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
            <tr>
              {headers.map((header) => (
                <th key={header} className="px-2 py-2 text-left font-medium whitespace-nowrap">
                  {header}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const boardHeader = group.boardName !== previousBoard
              previousBoard = group.boardName
              const open = !collapsed.has(group.key)
              // A collapsed circuit holding the selected cable shows the selection on its row.
              const holdsSelection =
                !open && group.rows.some((row) => row.anchor === selectedAnchor)
              const toggleLabel = open
                ? t('cableSchedule.collapseCircuit', 'Collapse circuit')
                : t('cableSchedule.expandCircuit', 'Expand circuit')
              const toggleButton = (
                <button
                  type="button"
                  aria-label={toggleLabel}
                  aria-expanded={open}
                  title={toggleLabel}
                  className="-ml-1 shrink-0 rounded p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
                  onClick={(event) => {
                    event.stopPropagation()
                    toggle(group.key)
                  }}
                >
                  <ChevronRight
                    className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`}
                  />
                </button>
              )
              return (
                <Fragment key={group.key}>
                  {boardHeader && (
                    <tr>
                      <td
                        colSpan={8}
                        className="pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300"
                      >
                        {group.boardName}
                      </td>
                    </tr>
                  )}
                  {!open && (
                    // Collapsed: one row with the circuit's combined cables.
                    <tr
                      data-testid="cable-schedule-circuit"
                      className={`cursor-pointer rounded bg-gray-50 outline-2 -outline-offset-2 outline-yellow-400 dark:bg-gray-800/60 ${
                        holdsSelection ? 'outline' : 'hover:outline-dashed'
                      }`}
                      onClick={() => toggle(group.key)}
                      onMouseEnter={() => setHovered(group.rows.map((row) => row.anchor))}
                      onMouseLeave={() => setHovered([])}
                    >
                      <td className="px-2 py-1.5 font-medium whitespace-nowrap text-gray-800 dark:text-gray-100">
                        <span className="flex items-center gap-1">
                          {toggleButton}
                          {group.circuitCode}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 tabular-nums text-gray-500">
                        {group.rows.length}
                      </td>
                      <td colSpan={2} className="px-2 py-1.5 text-gray-500 dark:text-gray-400">
                        {t('cableSchedule.cableCount', '{{count}} cables', {
                          count: group.rows.length,
                        })}
                      </td>
                      <td className="max-w-[12rem] truncate px-2 py-1.5 whitespace-nowrap text-gray-700 dark:text-gray-200">
                        {group.cableLabels.join(', ')}
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap font-medium tabular-nums text-gray-800 dark:text-gray-100">
                        {groupLengthText(group)}
                      </td>
                      <td className="px-2 py-1.5" colSpan={2}>
                        <span className="flex flex-wrap gap-1">
                          {SOURCE_ORDER.filter((source) => group.sourceCounts[source]).map(
                            (source) => (
                              <SourceBadge
                                key={source}
                                source={source}
                                label={`${group.sourceCounts[source]} ${sourceLabel(source)}`}
                              />
                            )
                          )}
                        </span>
                      </td>
                    </tr>
                  )}
                  {open &&
                    group.rows.map((row, index) => {
                      const selected = selectedAnchor === row.anchor
                      return (
                        <tr
                          key={row.anchor}
                          data-anchor={row.anchor}
                          aria-selected={selected}
                          {...(index === 0 ? { 'data-testid': 'cable-schedule-circuit' } : {})}
                          className={`cursor-pointer rounded outline-2 -outline-offset-2 outline-yellow-400 ${
                            selected
                              ? 'bg-yellow-50 outline dark:bg-yellow-900/20'
                              : 'hover:outline-dashed'
                          }`}
                          onClick={() => select(row)}
                          onMouseEnter={() => setHovered([row.anchor])}
                          onMouseLeave={() => setHovered([])}
                        >
                          <td
                            className={`py-1.5 pr-2 font-medium whitespace-nowrap text-gray-800 dark:text-gray-100 ${
                              index === 0 ? 'pl-2' : 'pl-7'
                            }`}
                          >
                            {index === 0 ? (
                              <span className="flex items-center gap-1">
                                {toggleButton}
                                {row.circuitCode}
                              </span>
                            ) : (
                              row.circuitCode
                            )}
                          </td>
                          <td className="px-2 py-1.5 tabular-nums text-gray-500">
                            {row.order || ''}
                          </td>
                          <td className="max-w-[16rem] px-2 py-1.5">
                            <PointCell point={row.fromPoint} fallback={row.fromLabel} />
                          </td>
                          <td className="max-w-[16rem] px-2 py-1.5">
                            <PointCell point={row.toPoint} fallback={row.toLabel} />
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap text-gray-700 dark:text-gray-200">
                            {row.cableLabel}
                          </td>
                          <td className="px-2 py-1.5 whitespace-nowrap tabular-nums text-gray-800 dark:text-gray-100">
                            {rowLengthText(row)}
                          </td>
                          <td className="px-2 py-1.5">
                            <SourceBadge
                              source={row.lengthSource}
                              label={sourceLabel(row.lengthSource)}
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            {(row.lengthSource === 'estimate' || row.lengthSource === 'stale') && row.cable && (
                              <button
                                type="button"
                                className="text-xs text-sky-600 hover:underline dark:text-sky-400"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  accept([row])
                                }}
                              >
                                {t('cableSchedule.use', 'Use')}
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      )}

      {schedule.totals.length > 0 && (
        <section className="mt-8 max-w-md">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
            {t('cableSchedule.totals', 'Totals per cable')}
          </h3>
          <table className="w-full text-sm">
            <tbody>
              {schedule.totals.map((total) => (
                <tr
                  key={total.cableLabel}
                  className="border-t border-gray-100 dark:border-gray-800"
                >
                  <td className="py-1.5 text-gray-700 dark:text-gray-200">{total.cableLabel}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-800 dark:text-gray-100">
                    {total.includesEstimates ? '≈ ' : ''}
                    {formatCableMetres(total.lengthM)} m
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
