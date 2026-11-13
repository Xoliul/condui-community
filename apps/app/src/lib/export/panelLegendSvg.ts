import { A4_PORTRAIT, PAGE_MARGIN } from './pageSizes'
import type { Panel, Circuit, ProtectionDevice, CircuitKind } from '@/types/schema'
import { getDerivedCircuitKind } from '@/lib/circuitKind'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { panelNumberRankById } from '@/lib/panel/panelNumberOrder'
import type { ExportTheme } from './types'
import { getThemeColors } from '@/lib/theme/colors'
import { displayedProtectionCurve, formatProtectionCurveRating } from '@/lib/protectionLabels'

interface CircuitLegendRow {
  panelName: string
  circuitCode: string
  kind: CircuitKind
  protection: ProtectionDevice | null
  notes: string | undefined
}

const LEGEND_LINE_HEIGHT = 4
// Reserve breathing room after the divider before the next row starts.
const LEGEND_ROW_EXTRA_HEIGHT = 3
const LEGEND_NOTES_ESTIMATED_CHAR_WIDTH = 1.5

function collectAllPanelsWithPath(
  panels: Panel[],
  prefix: string[] = []
): Array<{ panel: Panel; pathLabel: string }> {
  const result: Array<{ panel: Panel; pathLabel: string }> = []
  for (const panel of panels) {
    const path = [...prefix, panel.name]
    result.push({ panel, pathLabel: path.join(' / ') })
    result.push(...collectAllPanelsWithPath(panel.subPanels, path))
  }
  return result
}

function getProtectionForCircuit(panel: Panel, circuitId: string): ProtectionDevice | null {
  for (const protection of panel.protections) {
    if (protection.circuits?.some((c) => c.id === circuitId)) {
      return protection
    }
  }
  return null
}

export function buildPanelCircuitLegendRows(
  project: ProjectWithOptionalV2Electrical
): CircuitLegendRow[] {
  const rows: CircuitLegendRow[] = []
  const rootPanels = getProjectElectricalPanels(project)
  const rankById = panelNumberRankById(rootPanels, getProjectElectricalInstallation(project))
  const panelsWithPath = collectAllPanelsWithPath(rootPanels).sort(
    (left, right) => (rankById.get(left.panel.id) ?? 0) - (rankById.get(right.panel.id) ?? 0)
  )

  for (const { panel, pathLabel } of panelsWithPath) {
    const candidates = new Map<
      string,
      { circuit: Circuit; protection: ProtectionDevice | null; circuitCode: string }
    >()

    const addCircuit = (circuit: Circuit, owningProtection?: ProtectionDevice) => {
      const protection = owningProtection ?? getProtectionForCircuit(panel, circuit.id)
      const circuitCode = circuit.code?.trim() || protection?.label?.trim() || ''
      if (!circuitCode) return

      const codeLower = circuitCode.toLowerCase()
      const nameLower = panel.name.toLowerCase()
      // Keep named empty circuits in the legend: installers use these rows for
      // spare/reserve ways, including circuits attached to a secondary busbar.
      // Only structural panel-feeder placeholders remain hidden.
      if (codeLower === 'panel' || codeLower === nameLower) return

      const existing = candidates.get(circuit.id)
      const candidate = { circuit, protection, circuitCode }
      if (!existing || shouldPreferCircuitLegendCandidate(candidate, existing)) {
        candidates.set(circuit.id, candidate)
      }
    }

    for (const circuit of panel.circuits) {
      addCircuit(circuit)
    }

    for (const protection of panel.protections) {
      if (!protection.circuits) continue
      for (const circuit of protection.circuits) {
        addCircuit(circuit, protection)
      }
    }

    for (const { circuit, protection, circuitCode } of candidates.values()) {
      rows.push({
        panelName: pathLabel,
        circuitCode,
        kind: getDerivedCircuitKind(circuit, protection ?? undefined),
        protection,
        notes: circuit.notes,
      })
    }
  }

  rows.sort((a, b) => {
    if (a.panelName === b.panelName) {
      return a.circuitCode.localeCompare(b.circuitCode, undefined, { numeric: true })
    }
    return a.panelName.localeCompare(b.panelName)
  })

  return rows
}

function formatProtection(protection: ProtectionDevice | null): string {
  if (!protection) return ''
  const parts: string[] = []
  if (protection.type === 'MCB' || protection.type === 'RCBO') {
    const rating = formatProtectionCurveRating(displayedProtectionCurve(protection), protection.ratingA)
    if (rating) parts.push(rating)
  } else if (protection.ratingA != null) {
    parts.push(`${protection.ratingA}A`)
  }
  if (protection.polesConfig) {
    parts.push(protection.polesConfig)
  }
  if (protection.sensitivityMa != null) {
    parts.push(`${protection.sensitivityMa}mA`)
  }
  if (protection.residualCurrentType) {
    parts.push(protection.residualCurrentType)
  }
  if (protection.type === 'RCD' || protection.type === 'RCBO') {
    if (protection.selective) parts.push('S')
    if (protection.superImmunized) parts.push('SI')
  }
  return parts.join(' ')
}

export interface PanelLegendLabels {
  title: string
  panel: string
  circuit: string
  type: string
  protection: string
  notes: string
  kindLabels: Record<CircuitKind, string>
}

function shouldPreferCircuitLegendCandidate(
  candidate: { circuit: Circuit; protection: ProtectionDevice | null; circuitCode: string },
  existing: { circuit: Circuit; protection: ProtectionDevice | null; circuitCode: string }
): boolean {
  const candidateHasNotes = Boolean(candidate.circuit.notes?.trim())
  const existingHasNotes = Boolean(existing.circuit.notes?.trim())
  if (candidateHasNotes !== existingHasNotes) return candidateHasNotes

  const candidateHasCircuitCode = Boolean(candidate.circuit.code?.trim())
  const existingHasCircuitCode = Boolean(existing.circuit.code?.trim())
  if (candidateHasCircuitCode !== existingHasCircuitCode) return candidateHasCircuitCode

  return Boolean(candidate.protection) && !existing.protection
}

/** Build one or more legend pages, keeping each panel's rows together when possible. */
export function buildPanelLegendSvgs(
  rows: CircuitLegendRow[],
  fontFamily: string,
  labels: PanelLegendLabels,
  exportTheme: ExportTheme = 'light'
): string[] {
  const rowsByPanel = new Map<string, CircuitLegendRow[]>()
  for (const row of rows) {
    const panelRows = rowsByPanel.get(row.panelName) ?? []
    panelRows.push(row)
    rowsByPanel.set(row.panelName, panelRows)
  }

  const maxRowsHeight = getLegendRowsPageCapacity()
  const pages: string[] = []

  for (const panelRows of rowsByPanel.values()) {
    for (const pageRows of splitPanelRowsForLegendPages(panelRows, maxRowsHeight)) {
      pages.push(buildPanelLegendSvg(pageRows, fontFamily, labels, exportTheme))
    }
  }

  return pages
}

export function buildPanelLegendSvg(
  rows: CircuitLegendRow[],
  fontFamily: string,
  labels: PanelLegendLabels,
  exportTheme: ExportTheme = 'light'
): string {
  const colors = getThemeColors(exportTheme)
  const width = A4_PORTRAIT.width
  const height = A4_PORTRAIT.height
  const startX = PAGE_MARGIN
  const startY = PAGE_MARGIN
  const lineHeight = LEGEND_LINE_HEIGHT

  const colCircuit = startX
  const colType = startX + 30
  const colProtection = startX + 70
  const colNotes = startX + 120
  const notesMaxCharacters = getLegendNotesMaxCharacters(width, colNotes)

  let y = startY

  const lines: string[] = []
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="${colors.textColor}">`
  )

  lines.push(
    `<text x="${startX}" y="${y}" font-size="6" font-family="${fontFamily}" font-weight="bold">` +
      escapeXml(labels.title) +
      `</text>`
  )
  y += lineHeight * 1.8

  lines.push(
    `<text x="${colCircuit}" y="${y}" font-size="3.2" font-family="${fontFamily}" font-weight="bold">${escapeXml(
      labels.circuit
    )}</text>`
  )
  lines.push(
    `<text x="${colType}" y="${y}" font-size="3.2" font-family="${fontFamily}" font-weight="bold">${escapeXml(
      labels.type
    )}</text>`
  )
  lines.push(
    `<text x="${colProtection}" y="${y}" font-size="3.2" font-family="${fontFamily}" font-weight="bold">${escapeXml(
      labels.protection
    )}</text>`
  )
  lines.push(
    `<text x="${colNotes}" y="${y}" font-size="3.2" font-family="${fontFamily}" font-weight="bold">${escapeXml(
      labels.notes
    )}</text>`
  )

  y += lineHeight

  let currentPanel: string | null = null

  for (const row of rows) {
    if (y > height - PAGE_MARGIN) {
      break
    }

    if (row.panelName !== currentPanel) {
      currentPanel = row.panelName
      y += lineHeight * 0.5
      lines.push(
        `<text x="${startX}" y="${y}" font-size="3.4" font-family="${fontFamily}" font-weight="bold">${escapeXml(
          `${labels.panel}: ${currentPanel}`
        )}</text>`
      )
      y += lineHeight
      if (y > height - PAGE_MARGIN) {
        break
      }
    }

    const circuitText = row.circuitCode
    const typeText = labels.kindLabels[row.kind]
    const protText = formatProtection(row.protection)
    const notesText = (row.notes ?? '').trim()
    const notesLines = notesText ? wrapLegendNotes(notesText, notesMaxCharacters) : []
    const rowContentHeight = Math.max(1, notesLines.length) * lineHeight
    const rowHeight = rowContentHeight + LEGEND_ROW_EXTRA_HEIGHT

    if (y + rowHeight > height - PAGE_MARGIN) {
      break
    }

    lines.push(
      `<text x="${colCircuit}" y="${y}" font-size="3" font-family="${fontFamily}">${escapeXml(
        circuitText
      )}</text>`
    )
    lines.push(
      `<text x="${colType}" y="${y}" font-size="3" font-family="${fontFamily}">${escapeXml(
        typeText
      )}</text>`
    )
    if (protText) {
      lines.push(
        `<text x="${colProtection}" y="${y}" font-size="3" font-family="${fontFamily}">${escapeXml(
          protText
        )}</text>`
      )
    }
    if (notesText) {
      lines.push(
        `<text x="${colNotes}" y="${y}" font-size="3" font-family="${fontFamily}">`
      )
      notesLines.forEach((line, index) => {
        lines.push(
          `<tspan x="${colNotes}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(
            line
          )}</tspan>`
        )
      })
      lines.push('</text>')
    }

    // Keep the divider tied to the row content. Extra row height belongs below the
    // divider so it creates space before the next row instead of moving the line down.
    const dividerY = y + rowContentHeight - lineHeight / 2
    lines.push(
      `<line x1="${startX}" x2="${width - PAGE_MARGIN}" y1="${dividerY}" y2="${dividerY}" stroke="${colors.supplyWire}" stroke-width="0.35" />`
    )

    y += rowHeight
  }

  lines.push('</svg>')

  return lines.join('')
}

function getLegendNotesMaxCharacters(width: number, notesColumnX: number): number {
  return Math.max(
    1,
    Math.floor((width - PAGE_MARGIN - notesColumnX) / LEGEND_NOTES_ESTIMATED_CHAR_WIDTH)
  )
}

function getLegendRowHeight(noteLineCount: number): number {
  return Math.max(1, noteLineCount) * LEGEND_LINE_HEIGHT + LEGEND_ROW_EXTRA_HEIGHT
}

function getLegendRowsPageCapacity(): number {
  const firstRowY =
    PAGE_MARGIN +
    LEGEND_LINE_HEIGHT * 1.8 +
    LEGEND_LINE_HEIGHT +
    LEGEND_LINE_HEIGHT * 1.5
  return A4_PORTRAIT.height - PAGE_MARGIN - firstRowY
}

function splitPanelRowsForLegendPages(
  rows: CircuitLegendRow[],
  maxRowsHeight: number
): CircuitLegendRow[][] {
  const pages: CircuitLegendRow[][] = []
  let currentPage: CircuitLegendRow[] = []
  let currentHeight = 0
  const notesColumnX = PAGE_MARGIN + 120
  const notesMaxCharacters = getLegendNotesMaxCharacters(A4_PORTRAIT.width, notesColumnX)

  for (const row of rows) {
    for (const pageRow of splitOversizedLegendRow(row, maxRowsHeight, notesMaxCharacters)) {
      const noteLineCount = pageRow.notes?.trim()
        ? wrapLegendNotes(pageRow.notes.trim(), notesMaxCharacters).length
        : 0
      const rowHeight = getLegendRowHeight(noteLineCount)

      if (currentPage.length > 0 && currentHeight + rowHeight > maxRowsHeight) {
        pages.push(currentPage)
        currentPage = []
        currentHeight = 0
      }

      currentPage.push(pageRow)
      currentHeight += rowHeight
    }
  }

  if (currentPage.length > 0) {
    pages.push(currentPage)
  }

  return pages
}

function splitOversizedLegendRow(
  row: CircuitLegendRow,
  maxRowsHeight: number,
  notesMaxCharacters: number
): CircuitLegendRow[] {
  const notesText = row.notes?.trim()
  if (!notesText) return [row]

  const noteLines = wrapLegendNotes(notesText, notesMaxCharacters)
  const maxLinesPerPage = Math.max(
    1,
    Math.floor((maxRowsHeight - LEGEND_ROW_EXTRA_HEIGHT) / LEGEND_LINE_HEIGHT)
  )
  if (noteLines.length <= maxLinesPerPage) return [row]

  const chunks: CircuitLegendRow[] = []
  for (let index = 0; index < noteLines.length; index += maxLinesPerPage) {
    chunks.push({
      ...row,
      notes: noteLines.slice(index, index + maxLinesPerPage).join('\n'),
    })
  }
  return chunks
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Reflow circuit notes into the legend column, then wrap them at word boundaries. */
function wrapLegendNotes(text: string, maxCharacters: number): string[] {
  const result: string[] = []
  const words = text.replace(/\r?\n/g, ' ').split(/\s+/).filter(Boolean)

  let current = ''
  for (const word of words) {
    if (word.length > maxCharacters) {
      if (current) {
        result.push(current)
        current = ''
      }
      let remaining = word
      while (remaining.length > maxCharacters) {
        result.push(remaining.slice(0, maxCharacters))
        remaining = remaining.slice(maxCharacters)
      }
      current = remaining
      continue
    }

    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxCharacters) {
      current = candidate
    } else {
      result.push(current)
      current = word
    }
  }

  if (current) result.push(current)
  return result.length > 0 ? result : ['']
}
