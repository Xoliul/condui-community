import { formatCableTypeLabel } from '@/lib/wireTextLabel'
import type { CableSpec } from '@/types/schema'
import type { CableRoutePoint, CableRouteEstimate } from './estimateCableRoutes'

/** Where a row's length comes from. */
export type CableScheduleLengthSource = 'entered' | 'accepted' | 'estimate' | 'missing' | 'stale' | 'uncalibrated'

export interface CableScheduleRow {
  anchor: string
  circuitId: string
  boardName: string
  circuitCode: string
  order: number
  fromLabel: string
  toLabel: string
  /** Readable ends for display; absent when a location could not be resolved. */
  fromPoint?: CableRoutePoint
  toPoint?: CableRoutePoint
  cable?: CableSpec
  cableLabel: string
  /** Stored length (typed or accepted). */
  lengthM?: number
  lengthSource: CableScheduleLengthSource
  estimateLowM?: number
  estimateHighM?: number
  /** Length used for totals: stored, else the high estimate. */
  quantityM?: number
}

export interface CableScheduleTotal {
  cableLabel: string
  lengthM: number
  /** Some rows only have an estimate. */
  includesEstimates: boolean
}

export interface CableSchedule {
  rows: CableScheduleRow[]
  totals: CableScheduleTotal[]
}

export function formatCableSpec(cable: CableSpec | undefined): string {
  if (!cable) return ''
  const conductors = cable.conductors ? `${cable.conductors}${cable.hasPE ? 'G' : 'x'}` : ''
  const section = cable.sectionMm2 ? `${conductors}${cable.sectionMm2}` : ''
  return [formatCableTypeLabel(cable), section].filter(Boolean).join(' ')
}

/** Rows grouped by board and circuit in feed order, plus totals per cable for purchasing. */
export function buildCableSchedule(routes: readonly CableRouteEstimate[]): CableSchedule {
  const rows = routes
    .map((route): CableScheduleRow => {
      const estimated = route.highM > 0 && route.scaleCalibrated !== false
      const lengthSource: CableScheduleLengthSource =
        route.enteredLengthM != null
          ? route.enteredLengthEstimated
            ? 'accepted'
            : 'entered'
          : route.scaleCalibrated === false ? 'uncalibrated' : estimated
            ? route.estimateNeedsReview ? 'stale' : 'estimate'
            : 'missing'
      return {
        anchor: route.anchor,
        circuitId: route.circuitId,
        boardName: route.boardName ?? '',
        circuitCode: route.circuitCode ?? '',
        order: route.order,
        fromLabel: route.fromLabel,
        toLabel: route.toLabel,
        ...(route.fromPoint ? { fromPoint: route.fromPoint } : {}),
        ...(route.toPoint ? { toPoint: route.toPoint } : {}),
        cable: route.cable,
        cableLabel: formatCableSpec(route.cable),
        lengthM: route.enteredLengthM,
        lengthSource,
        ...(estimated ? { estimateLowM: route.lowM, estimateHighM: route.highM } : {}),
        quantityM: route.enteredLengthM ?? (estimated ? route.highM : undefined),
      }
    })
    .sort(
      (a, b) =>
        a.boardName.localeCompare(b.boardName) ||
        a.circuitCode.localeCompare(b.circuitCode, undefined, { numeric: true }) ||
        a.order - b.order
    )

  const totalsByCable = new Map<string, CableScheduleTotal>()
  for (const row of rows) {
    if (row.quantityM == null || !row.cableLabel) continue
    const total = totalsByCable.get(row.cableLabel) ?? {
      cableLabel: row.cableLabel,
      lengthM: 0,
      includesEstimates: false,
    }
    total.lengthM += row.quantityM
    if (row.lengthSource === 'estimate' || row.lengthSource === 'stale') total.includesEstimates = true
    totalsByCable.set(row.cableLabel, total)
  }
  const totals = [...totalsByCable.values()].sort((a, b) =>
    a.cableLabel.localeCompare(b.cableLabel)
  )
  return { rows, totals }
}

/** One circuit's cables in the schedule, with their combined length. */
export interface CableScheduleCircuitGroup {
  key: string
  circuitId: string
  boardName: string
  circuitCode: string
  rows: CableScheduleRow[]
  /** Distinct cable types, in row order. */
  cableLabels: string[]
  /** Combined length: stored lengths, plus the low or high end of each estimate. */
  lowM: number
  highM: number
  /** Some lengths are only estimated. */
  includesEstimates: boolean
  /** Cables without any length. */
  missingCount: number
  sourceCounts: Partial<Record<CableScheduleLengthSource, number>>
}

/** Schedule rows per circuit, keeping the schedule's board and circuit order. */
export function groupCableScheduleByCircuit(
  rows: readonly CableScheduleRow[]
): CableScheduleCircuitGroup[] {
  const groups = new Map<string, CableScheduleCircuitGroup>()
  for (const row of rows) {
    const key = `${row.boardName}|${row.circuitId}`
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        circuitId: row.circuitId,
        boardName: row.boardName,
        circuitCode: row.circuitCode,
        rows: [],
        cableLabels: [],
        lowM: 0,
        highM: 0,
        includesEstimates: false,
        missingCount: 0,
        sourceCounts: {},
      }
      groups.set(key, group)
    }
    group.rows.push(row)
    if (row.cableLabel && !group.cableLabels.includes(row.cableLabel)) {
      group.cableLabels.push(row.cableLabel)
    }
    group.sourceCounts[row.lengthSource] = (group.sourceCounts[row.lengthSource] ?? 0) + 1
    if (row.lengthM != null) {
      group.lowM += row.lengthM
      group.highM += row.lengthM
    } else if (row.estimateHighM != null) {
      group.lowM += row.estimateLowM ?? row.estimateHighM
      group.highM += row.estimateHighM
      group.includesEstimates = true
    } else {
      group.missingCount += 1
    }
  }
  return [...groups.values()]
}

function csvCell(value: string | number | undefined): string {
  if (value == null) return ''
  const text = typeof value === 'number' ? String(Math.round(value * 10) / 10) : value
  return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * CSV with the given localized headers, source labels, and point names; `;`-separated for
 * European Excel. `pointLabel` falls back to the raw row labels.
 */
export function cableScheduleCsv(
  schedule: CableSchedule,
  headers: string[],
  sourceLabel: (source: CableScheduleLengthSource) => string,
  pointLabel: (point: CableRoutePoint | undefined, fallback: string) => string = (_, fallback) =>
    fallback
): string {
  const lines = [headers.map(csvCell).join(';')]
  for (const row of schedule.rows) {
    lines.push(
      [
        row.boardName,
        row.circuitCode,
        row.order || '',
        pointLabel(row.fromPoint, row.fromLabel),
        pointLabel(row.toPoint, row.toLabel),
        row.cableLabel,
        row.lengthM,
        row.estimateLowM,
        row.estimateHighM,
        sourceLabel(row.lengthSource),
      ]
        .map((value) => csvCell(value === '' ? undefined : value))
        .join(';')
    )
  }
  return `${lines.join('\n')}\n`
}
