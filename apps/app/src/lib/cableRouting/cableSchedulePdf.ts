import type { TFunction } from 'i18next'
import { getThemeColors } from '@/lib/theme/colors'
import { formatCableMetres } from './cableRouteSelection'
import { cableSchedulePointText } from './cableSchedulePointLabels'
import type { CableRoutePoint } from './estimateCableRoutes'
import type {
  CableSchedule,
  CableScheduleLengthSource,
  CableScheduleRow,
  CableScheduleTotal,
} from './cableSchedule'

/** Page geometry in millimetres: A4 landscape with the export's usual 15 mm margin. */
const PAGE_WIDTH = 297
const PAGE_HEIGHT = 210
const MARGIN = 15
const TITLE_Y = MARGIN + 5
const TABLE_TOP = MARGIN + 11
const HEADER_HEIGHT = 7
const ROW_HEIGHT = 5.5
const FOOTER_Y = PAGE_HEIGHT - MARGIN + 6
const BODY_TOP = TABLE_TOP + HEADER_HEIGHT
const COLUMNS = [
  { key: 'circuit', width: 22 },
  { key: 'order', width: 10 },
  { key: 'from', width: 62 },
  { key: 'to', width: 62 },
  { key: 'cable', width: 44 },
  { key: 'length', width: 34, align: 'end' },
  { key: 'source', width: 33 },
] as const

/** Lines that fit on one page below the column header. */
export const CABLE_SCHEDULE_LINES_PER_PAGE = Math.floor((FOOTER_Y - 6 - BODY_TOP) / ROW_HEIGHT)

export interface CableSchedulePdfLabels {
  title: string
  circuit: string
  from: string
  to: string
  cable: string
  length: string
  sourceHeader: string
  totals: string
  continued: string
  source: (source: CableScheduleLengthSource) => string
  point: (point: CableRoutePoint | undefined, fallback: string) => string
}

/** Localized labels, matching the cable schedule in the Documents view. */
export function getCableSchedulePdfLabels(t: TFunction): CableSchedulePdfLabels {
  const sources: Record<CableScheduleLengthSource, string> = {
    entered: t('cableSchedule.source.entered', 'Entered'),
    accepted: t('cableSchedule.source.accepted', 'From plan'),
    stale: t('cableSchedule.source.stale', 'Review length'),
    uncalibrated: t('cableSchedule.source.uncalibrated', 'Set scale'),
    estimate: t('cableSchedule.source.estimate', 'Estimate'),
    missing: t('cableSchedule.source.missing', 'Unknown'),
  }
  return {
    title: t('cableSchedule.title', 'Cable schedule'),
    circuit: t('cableSchedule.circuit', 'Circuit'),
    from: t('cableSchedule.from', 'From'),
    to: t('cableSchedule.to', 'To'),
    cable: t('cableSchedule.cable', 'Cable'),
    length: t('cableSchedule.length', 'Length (m)'),
    sourceHeader: t('cableSchedule.sourceHeader', 'Source'),
    totals: t('cableSchedule.totals', 'Totals per cable'),
    continued: t('cableSchedule.continued', 'continued'),
    source: (source) => sources[source],
    point: (point, fallback) => cableSchedulePointText(point, fallback, t),
  }
}

type ScheduleLine =
  | { kind: 'board'; text: string; continued?: boolean }
  | { kind: 'row'; row: CableScheduleRow }
  | { kind: 'totals' }
  | { kind: 'total'; total: CableScheduleTotal }

/**
 * The schedule as table lines split into pages: a board heading before each board's cables
 * (repeated when a board continues on the next page), then the totals per cable.
 */
function paginate(schedule: CableSchedule): ScheduleLine[][] {
  const lines: ScheduleLine[] = []
  let board: string | undefined
  for (const row of schedule.rows) {
    if (row.boardName !== board) {
      board = row.boardName
      if (board) lines.push({ kind: 'board', text: board })
    }
    lines.push({ kind: 'row', row })
  }
  if (schedule.totals.length > 0) {
    lines.push({ kind: 'totals' })
    for (const total of schedule.totals) lines.push({ kind: 'total', total })
  }

  const pages: ScheduleLine[][] = []
  let page: ScheduleLine[] = []
  let currentBoard: string | undefined
  for (const [index, line] of lines.entries()) {
    if (page.length === CABLE_SCHEDULE_LINES_PER_PAGE) {
      pages.push(page)
      page = []
      if (line.kind === 'row' && currentBoard) {
        page.push({ kind: 'board', text: currentBoard, continued: true })
      }
    }
    // A heading never ends a page on its own.
    const next = lines[index + 1]
    if (
      (line.kind === 'board' || line.kind === 'totals') &&
      page.length === CABLE_SCHEDULE_LINES_PER_PAGE - 1 &&
      next
    ) {
      pages.push(page)
      page = []
    }
    if (line.kind === 'board') currentBoard = line.text
    if (line.kind === 'totals') currentBoard = undefined
    page.push(line)
  }
  if (page.length > 0) pages.push(page)
  return pages
}

export function getCableSchedulePdfPageCount(schedule: CableSchedule): number {
  return paginate(schedule).length
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Shortens text to roughly fit `widthMm` at `fontSize` (average glyph ≈ half the font size). */
export function fitText(value: string, widthMm: number, fontSize: number): string {
  const maxCharacters = Math.max(4, Math.floor(widthMm / (fontSize * 0.5)))
  return value.length > maxCharacters ? `${value.slice(0, maxCharacters - 1)}…` : value
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

export function paletteFor(theme: 'light' | 'dark') {
  const colors = getThemeColors(theme)
  return theme === 'dark'
    ? {
        text: colors.textColor,
        secondary: colors.secondaryText,
        headerFill: '#0c4a6e',
        boardFill: '#374151',
        line: '#6b7280',
        strongLine: '#d1d5db',
      }
    : {
        text: colors.textColor,
        secondary: colors.secondaryText,
        headerFill: '#e0f2fe',
        boardFill: '#f3f4f6',
        line: '#9ca3af',
        strongLine: '#374151',
      }
}

/** Stored length (≈ when accepted from the plan), else the estimate range, else a dash. */
export function formatCableScheduleRowLength(row: CableScheduleRow): string {
  if (row.lengthM != null) {
    return `${row.lengthSource === 'accepted' ? '≈ ' : ''}${formatCableMetres(row.lengthM)}`
  }
  if (row.estimateHighM != null) {
    return `≈ ${formatCableMetres(row.estimateLowM!)}–${formatCableMetres(row.estimateHighM)}`
  }
  return '–'
}

/**
 * One SVG (millimetre units, A4 landscape) per page of the cable schedule: cables grouped by
 * board in feed order, then the total length per cable type for purchasing.
 */
export function buildCableScheduleSvgPages(
  schedule: CableSchedule,
  labels: CableSchedulePdfLabels,
  fontFamily: string,
  theme: 'light' | 'dark' = 'light'
): string[] {
  const pages = paginate(schedule)
  return pages.map((lines, pageIndex) => {
    const title =
      pages.length > 1 ? `${labels.title} (${pageIndex + 1}/${pages.length})` : labels.title
    return buildPage(title, lines, labels, fontFamily, paletteFor(theme))
  })
}

function buildPage(
  title: string,
  lines: ScheduleLine[],
  labels: CableSchedulePdfLabels,
  fontFamily: string,
  palette: ReturnType<typeof paletteFor>
): string {
  const left = MARGIN
  const right = PAGE_WIDTH - MARGIN
  const bottom = BODY_TOP + lines.length * ROW_HEIGHT
  const font = `font-family="${fontFamily}"`
  const parts: string[] = []
  const columnX: number[] = []
  COLUMNS.reduce((x, column) => {
    columnX.push(x)
    return x + column.width
  }, left)

  const cell = (index: number, text: string, baseline: number, weight = '') => {
    const column = COLUMNS[index]!
    const value = escapeXml(fitText(text, column.width - 3, 3))
    const bold = weight ? ` font-weight="${weight}"` : ''
    return 'align' in column
      ? `<text x="${round(columnX[index]! + column.width - 1.5)}" y="${baseline}" font-size="3" text-anchor="end"${bold} ${font} fill="${palette.text}">${value}</text>`
      : `<text x="${round(columnX[index]! + 1.5)}" y="${baseline}" font-size="3"${bold} ${font} fill="${palette.text}">${value}</text>`
  }

  parts.push(
    `<text x="${left}" y="${TITLE_Y}" font-size="6" font-weight="bold" ${font} fill="${palette.text}">${escapeXml(fitText(title, right - left, 6))}</text>`
  )
  parts.push(
    `<rect x="${left}" y="${TABLE_TOP}" width="${right - left}" height="${HEADER_HEIGHT}" fill="${palette.headerFill}"/>`
  )
  const headerBaseline = round(TABLE_TOP + HEADER_HEIGHT - 2.3)
  const headers = [
    labels.circuit,
    '#',
    labels.from,
    labels.to,
    labels.cable,
    labels.length,
    labels.sourceHeader,
  ]
  headers.forEach((header, index) => parts.push(cell(index, header, headerBaseline, 'bold')))

  lines.forEach((line, index) => {
    const top = BODY_TOP + index * ROW_HEIGHT
    const baseline = round(top + ROW_HEIGHT - 1.7)
    if (line.kind === 'board' || line.kind === 'totals') {
      parts.push(
        `<rect x="${left}" y="${round(top)}" width="${right - left}" height="${ROW_HEIGHT}" fill="${palette.boardFill}"/>`
      )
      const text =
        line.kind === 'totals'
          ? labels.totals
          : line.continued
            ? `${line.text} (${labels.continued})`
            : line.text
      parts.push(
        `<text x="${left + 1.5}" y="${baseline}" font-size="3.2" font-weight="bold" ${font} fill="${palette.text}">${escapeXml(fitText(text, right - left - 3, 3.2))}</text>`
      )
      return
    }
    if (line.kind === 'total') {
      parts.push(cell(4, line.total.cableLabel, baseline))
      parts.push(
        cell(
          5,
          `${line.total.includesEstimates ? '≈ ' : ''}${formatCableMetres(line.total.lengthM)}`,
          baseline,
          'bold'
        )
      )
      return
    }
    const { row } = line
    parts.push(cell(0, row.circuitCode, baseline, 'bold'))
    if (row.order) parts.push(cell(1, String(row.order), baseline))
    parts.push(cell(2, labels.point(row.fromPoint, row.fromLabel), baseline))
    parts.push(cell(3, labels.point(row.toPoint, row.toLabel), baseline))
    parts.push(cell(4, row.cableLabel, baseline))
    parts.push(cell(5, formatCableScheduleRowLength(row), baseline))
    parts.push(cell(6, labels.source(row.lengthSource), baseline))
  })

  for (let index = 1; index <= lines.length; index++) {
    const y = round(BODY_TOP + index * ROW_HEIGHT)
    parts.push(
      `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="${palette.line}" stroke-width="0.1"/>`
    )
  }
  parts.push(
    `<line x1="${left}" y1="${BODY_TOP}" x2="${right}" y2="${BODY_TOP}" stroke="${palette.strongLine}" stroke-width="0.4"/>`
  )
  parts.push(
    `<rect x="${left}" y="${TABLE_TOP}" width="${right - left}" height="${round(bottom - TABLE_TOP)}" fill="none" stroke="${palette.strongLine}" stroke-width="0.5"/>`
  )

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}">${parts.join('')}</svg>`
}
