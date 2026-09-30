import i18n from '@/i18n'
import type {
  Circuit,
  Endpoint,
  Panel,
  PanelGridModuleRef,
  PanelGridSlot,
  ProtectionDevice,
  TrunkDevice,
} from '@/types/schema'
import type { AuxiliaryElectricalEnclosure } from '@/types/supplyAssembly'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import { flattenPanels } from '@/utils/eendraad/panelHelpers'
import { getAllCircuits } from '@/lib/eendraad/projectElectricalDomain'
import { findTrunkDeviceInProject } from '@/utils/project'
import { collectJunctionIdentities, getJunctionIdentity } from '@/lib/junctionIdentity'
import {
  getProjectElectrical,
  getProjectElectricalPanels,
  selectProjectAuxiliaryElectricalEnclosures,
} from '@/lib/projectV2/electrical'
import { resolveModuleWidthCols } from '@/components/canvas/panel/panelGridLayout'
import { DEFAULT_PANEL_GRID_COLUMNS } from '@/lib/panel/panelGridDefaults'
import { RESIDUAL_CURRENT_DELTA } from '@/lib/protectionLabels'
import {
  getPanelLabelSources,
  getPanelLabelText,
  getPanelLabelValues,
} from '@/lib/panel/panelLabelContent'
import { getPanelCanvasOverflowModuleKeys } from './labelStripReadiness'
import { panelGridModuleRefKey } from '@/components/canvas/panel/panelGridLayout'
import { exportLog } from './exportLogger'
import conduiLogoSvg from '../../../public/logos/Condui_logo.svg?raw'

export const BROTHER_TAPE_WIDTHS_MM = [12, 18, 24, 36] as const
/** Handheld PT-E models stop at 24 mm (PT-E310BT at 18 mm). */
export const BROTHER_PT_E24_TAPE_WIDTHS_MM = [12, 18, 24] as const
export const BROTHER_PT_E18_TAPE_WIDTHS_MM = [12, 18] as const
export const BROTHER_QL_TAPE_WIDTHS_MM = [12, 29, 38, 50] as const
export type BrotherPrinter =
  | 'pt-p900-family'
  | 'pt-e920bt'
  | 'pt-p910bt'
  | 'pt-e800w'
  | 'pt-d800w'
  | 'pt-e550w'
  | 'pt-e560bt'
  | 'pt-e310bt'
  | 'ql-810w'
  | 'ql-820nwb'
export type BrotherLbxMode = 'sheets' | 'single-strip'
export type BrotherTapeWidthMm =
  | (typeof BROTHER_TAPE_WIDTHS_MM)[number]
  | (typeof BROTHER_QL_TAPE_WIDTHS_MM)[number]

export function getBrotherTapeWidthsMm(printer: BrotherPrinter): readonly BrotherTapeWidthMm[] {
  if (printer === 'ql-810w' || printer === 'ql-820nwb') return BROTHER_QL_TAPE_WIDTHS_MM
  if (printer === 'pt-e550w' || printer === 'pt-e560bt') return BROTHER_PT_E24_TAPE_WIDTHS_MM
  if (printer === 'pt-e310bt') return BROTHER_PT_E18_TAPE_WIDTHS_MM
  return BROTHER_TAPE_WIDTHS_MM
}

export function getDefaultBrotherTapeWidthMm(printer: BrotherPrinter): BrotherTapeWidthMm {
  if (printer === 'ql-810w' || printer === 'ql-820nwb') return 29
  if (printer === 'pt-e550w' || printer === 'pt-e560bt') return 24
  if (printer === 'pt-e310bt') return 18
  return 36
}

export function getDefaultBrotherLbxMode(printer: BrotherPrinter): BrotherLbxMode {
  return printer === 'ql-810w' || printer === 'ql-820nwb' ? 'sheets' : 'single-strip'
}

export interface LabelStripExportOptions {
  /** The PDF path remains the default; Brother LBX is generated in-browser. */
  exportFormat?: 'pdf' | 'brother-lbx'
  brotherPrinter?: BrotherPrinter
  brotherTapeWidthMm?: BrotherTapeWidthMm
  brotherMode?: BrotherLbxMode
  paperSize: 'A4' | 'A3'
  preset: '25' | '35' | 'custom'
  customHeightMm: number
  customSecondHeightMm: number
  stripMode: 'single' | 'double'
  includeDomotics: boolean
  includeNonProtection: boolean
  includeTerminalStrips: boolean
  skipEmptyRows: boolean
  selectedSourceKeys: string[]
}

export interface LabelStripModule {
  ref: PanelGridModuleRef
  terminalStripMemberRefs?: PanelGridModuleRef[]
  slot?: Pick<
    PanelGridSlot,
    'row' | 'col' | 'moduleWidth' | 'moduleWidthManual' | 'terminalStripRail'
  >
  inSupplyPanel?: boolean
}

export type LabelStripModuleProvider = (panelId: string) => LabelStripModule[]

export interface LabelStripSegment {
  identifier: string
  description: string
  widthMm: number
  blank?: boolean
  cutSpacer?: boolean
  topParts?: LabelStripContentPart[]
  bottomParts?: LabelStripContentPart[]
  topAlignment?: 'left' | 'center' | 'right' | 'justify'
  bottomAlignment?: 'left' | 'center' | 'right' | 'justify'
}

interface LabelStripContentPart {
  source: string
  text: string
  technicalParts?: Array<{ text: string; framed?: boolean }>
}

export interface LabelStrip {
  sourceLabel: string
  row: number
  segments: LabelStripSegment[]
}

interface IndexedEndpoint {
  endpoint: Endpoint
  circuit: Circuit
}

interface IndexedProtection {
  protection: ProtectionDevice
  panel: Panel
}

interface EntityIndex {
  endpoints: Map<string, IndexedEndpoint>
  protections: Map<string, IndexedProtection>
  trunks: Map<string, TrunkDevice>
}

interface SourceRow {
  sourceLabel: string
  row: number
  modules: LabelStripModule[]
  columnCount?: number
}

interface LayoutItem {
  sourceLabel: string
  row: number
  continuationIndex: number
  segments: LabelStripSegment[]
}

interface PageSpec {
  width: number
  height: number
  orientation: 'portrait' | 'landscape'
}

interface PackedPage {
  spec: PageSpec
  items: Array<{ item: LayoutItem; x: number; y: number }>
}

const PAGE_MARGIN_MM = 15
const ROW_GAP_MM = 7
const COLUMN_GAP_MM = 12
const CAPTION_HEIGHT_MM = 5
const CUT_MARK_MM = 2
const CUT_OFFSET_MM = 1
const HORIZONTAL_CUT_OFFSET_MM = 0.5
const ENDPOINT_SCISSOR_OFFSET_MM = 8
const ENDPOINT_MARKER_CLEARANCE_MM = 4
const MODULE_WIDTH_MM = 18
const A4 = { width: 210, height: 297 }
const A3 = { width: 297, height: 420 }
const CONDUI_LINK = 'https://condui.be'
const CONDUI_LOGO_INNER = conduiLogoSvg
  .replace(/^.*?<svg[^>]*>/s, '')
  .replace(/<\/svg>\s*$/s, '')
  .replaceAll('currentColor', '#111827')

function sourceKey(kind: 'panel' | 'junction-panel' | 'virtual', id: string): string {
  return `${kind}:${id}`
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function symbolLabel(symbol: string | undefined, fallback: string): string {
  return cleanText(i18n.t(`symbols.${symbol ?? ''}`, { defaultValue: fallback })) || fallback
}

function buildEntityIndex(project: ProjectWithOptionalV2Electrical): EntityIndex {
  const endpoints = new Map<string, IndexedEndpoint>()
  const protections = new Map<string, IndexedProtection>()
  const trunks = new Map<string, TrunkDevice>()
  const panels = flattenPanels(getProjectElectricalPanels(project))

  for (const panel of panels) {
    for (const protection of panel.protections ?? []) {
      protections.set(protection.id, { protection, panel })
    }
    for (const circuit of getAllCircuits(panel)) {
      for (const endpoint of circuit.endpoints ?? [])
        endpoints.set(endpoint.id, { endpoint, circuit })
      for (const device of circuit.trunkDevices ?? []) trunks.set(device.id, device)
    }
    for (const device of panel.groundTrunkDevices ?? []) trunks.set(device.id, device)
  }

  const electrical = getProjectElectrical(project)
  for (const device of electrical?.installation?.mainSupply?.supplyTrunkDevices ?? []) {
    trunks.set(device.id, device)
  }
  for (const device of electrical?.installation?.groundTrunkDevices ?? [])
    trunks.set(device.id, device)
  return { endpoints, protections, trunks }
}

function findProtection(index: EntityIndex, id: string): IndexedProtection | undefined {
  return index.protections.get(id)
}

function segmentForModule(
  module: LabelStripModule,
  project: ProjectWithOptionalV2Electrical,
  index: EntityIndex,
  include: LabelStripExportOptions
): LabelStripSegment | null {
  const refs = module.terminalStripMemberRefs?.length
    ? module.terminalStripMemberRefs
    : [module.ref]
  const primary = refs[0]
  if (!primary) return null

  let identifier = ''
  let technical = ''
  if (primary.kind === 'protection') {
    const found = findProtection(index, primary.id)
    if (!found) return null
    identifier = cleanText(found.protection.label) || found.protection.type
  } else if (primary.kind === 'domotica') {
    if (!include.includeDomotics) return null
    const found = index.endpoints.get(primary.endpointId)
    if (!found) return null
    identifier = cleanText(found.endpoint.label) || primary.endpointId
    technical = [found.endpoint.type, found.endpoint.symbol].map(cleanText).filter(Boolean).join(' · ')
  } else {
    const device = index.trunks.get(primary.id) ?? findTrunkDeviceInProject(project, primary.id)
    if (!device) return null
    const symbol = device.symbol ?? device.type
    const isTerminal = device.type === 'terminal_strip' || device.symbol === 'terminal_strip'
    const isConversion =
      device.type === 'conversion' ||
      ['transformer', 'rectifier', 'inverter', 'dc_dc_converter', 'source_changeover'].includes(
        symbol
      )
    if (isTerminal && !include.includeTerminalStrips) return null
    if (isConversion && !include.includeNonProtection) return null
    identifier = cleanText(device.label) || symbolLabel(symbol, device.type)
    technical = [device.protectionType ?? device.type, device.symbol]
      .map(cleanText)
      .filter(Boolean)
      .join(' · ')
  }

  const values = getPanelLabelValues(primary, project, {
    label: identifier,
    specLines: [],
    technical,
  })
  const widthCols = resolveModuleWidthCols(primary, project, module.slot)
  const partsForSide = (side: 'top' | 'bottom') =>
    getPanelLabelSources(values.config, side)
      .map((source) => ({
        source,
        text: values[source],
        ...(source === 'technical' && values.technicalParts
          ? { technicalParts: values.technicalParts }
          : {}),
      }))
      .filter((part) => part.text.length > 0)
  return {
    identifier: getPanelLabelText(values.config, 'top', values),
    description: getPanelLabelText(values.config, 'bottom', values),
    topParts: partsForSide('top'),
    bottomParts: partsForSide('bottom'),
    topAlignment: values.config?.top?.alignment ?? 'center',
    bottomAlignment: values.config?.bottom?.alignment ?? 'center',
    widthMm: Math.max(6, widthCols * MODULE_WIDTH_MM),
  }
}

function moduleIsIncluded(
  module: LabelStripModule,
  project: ProjectWithOptionalV2Electrical,
  index: EntityIndex,
  options: LabelStripExportOptions
): boolean {
  return segmentForModule(module, project, index, options) !== null
}

function modulesForPanel(
  panelId: string,
  provider: LabelStripModuleProvider,
  project: ProjectWithOptionalV2Electrical,
  index: EntityIndex,
  options: LabelStripExportOptions
): LabelStripModule[] {
  return provider(panelId).filter(
    (module) => module.inSupplyPanel !== true && moduleIsIncluded(module, project, index, options)
  )
}

function modulesForVirtual(enclosure: AuxiliaryElectricalEnclosure): LabelStripModule[] {
  return [...enclosure.gridView.slots, ...(enclosure.gridView.supplyPanelSlots ?? [])].map(
    (slot) => ({
      ref: slot.module,
      slot,
    })
  )
}

function buildSourceRows(
  project: ProjectWithOptionalV2Electrical,
  options: LabelStripExportOptions,
  provider: LabelStripModuleProvider,
  index: EntityIndex
): SourceRow[] {
  const selected = new Set(options.selectedSourceKeys)
  const rows: SourceRow[] = []
  const panels = flattenPanels(getProjectElectricalPanels(project))
  for (const panel of panels) {
    if (!selected.has(sourceKey('panel', panel.id))) continue
    const providedModules = provider(panel.id).filter((module) => module.inSupplyPanel !== true)
    const overflowModuleKeys = getPanelCanvasOverflowModuleKeys(
      panel,
      project,
      providedModules
    )
    const exportableModules = modulesForPanel(panel.id, provider, project, index, options)
    const modules = exportableModules.filter(
      (module) => !overflowModuleKeys.has(panelGridModuleRefKey(module.ref))
    )
    const exportableKeys = new Set(
      exportableModules.map((module) => panelGridModuleRefKey(module.ref))
    )
    exportLog('[label-strip] panel module classification', {
      panelId: panel.id,
      panelName: panel.name,
      configuredRows: panel.gridView?.rows ?? 0,
      configuredColumns: panel.gridView?.columns ?? DEFAULT_PANEL_GRID_COLUMNS,
      providedMainModules: providedModules.length,
      exportableModules: exportableModules.length,
      omittedModules: providedModules
        .filter((module) => !exportableKeys.has(panelGridModuleRefKey(module.ref)))
        .map((module) => ({
          key: panelGridModuleRefKey(module.ref),
          row: module.slot?.row ?? 0,
          col: module.slot?.col ?? null,
          reason: overflowModuleKeys.has(panelGridModuleRefKey(module.ref))
            ? 'overflow'
            : 'filtered-or-missing-data',
        })),
      omittedOverflowModules: providedModules
        .filter((module) => overflowModuleKeys.has(panelGridModuleRefKey(module.ref)))
        .map((module) => ({
          key: panelGridModuleRefKey(module.ref),
          row: module.slot?.row ?? 0,
          col: module.slot?.col ?? null,
        })),
      exportableRows: [...new Set(modules.map((module) => module.slot?.row ?? 0))].sort(
        (left, right) => left - right
      ),
    })
    const grouped = new Map<
      string,
      { row: number; inSupplyPanel: boolean; modules: LabelStripModule[] }
    >()
    for (const module of modules) {
      const row = module.slot?.row ?? 0
      const inSupplyPanel = module.inSupplyPanel === true
      const key = `${inSupplyPanel ? 'supply' : 'main'}:${row}`
      const group = grouped.get(key) ?? { row, inSupplyPanel, modules: [] }
      group.modules.push(module)
      grouped.set(key, group)
    }
    const configuredRows = panel.gridView?.rows ?? 0
    const occupiedRows = [...grouped.values()]
    const rowCount = Math.max(configuredRows, ...occupiedRows.map((group) => group.row + 1), 0)
    const groups = options.skipEmptyRows
      ? occupiedRows.sort((left, right) => left.row - right.row)
      : Array.from(
          { length: rowCount },
          (_, row) => grouped.get(`main:${row}`) ?? { row, inSupplyPanel: false, modules: [] }
        )
    for (const group of groups) {
      if (group.modules.length > 0 || !options.skipEmptyRows) {
        rows.push({
          sourceLabel: panel.name,
          row: group.row,
          modules: group.modules,
          columnCount: group.inSupplyPanel
            ? (panel.gridView?.supplyPanelColumns ??
              panel.gridView?.columns ??
              DEFAULT_PANEL_GRID_COLUMNS)
            : (panel.gridView?.columns ?? DEFAULT_PANEL_GRID_COLUMNS),
        })
      }
    }
  }

  const enclosures = selectProjectAuxiliaryElectricalEnclosures(project).filter(
    (item) => !item.hidden
  )
  for (const enclosure of enclosures) {
    if (!selected.has(sourceKey('virtual', enclosure.id))) continue
    const modules = modulesForVirtual(enclosure).filter((module) =>
      moduleIsIncluded(module, project, index, options)
    )
    if (modules.length > 0) {
      rows.push({
        sourceLabel: enclosure.name,
        row: 0,
        modules,
        columnCount: enclosure.gridView.columns,
      })
    }
  }

  if (options.includeTerminalStrips) {
    for (const identity of collectJunctionIdentities(project, 'junction_panel')) {
      if (!selected.has(sourceKey('junction-panel', identity))) continue
      const modules = [...index.trunks.values()]
        .filter(
          (device) => device.symbol === 'junction_panel' && getJunctionIdentity(device) === identity
        )
        .map((device) => ({
          ref: { kind: 'trunkDevice' as const, id: device.id, scope: 'circuit' as const },
        }))
      if (modules.length > 0) rows.push({ sourceLabel: identity, row: 0, modules })
    }
  }
  return rows
}

function blankSegment(widthMm: number): LabelStripSegment {
  return { identifier: '', description: '', widthMm, blank: true }
}

function rowSegments(
  row: SourceRow,
  project: ProjectWithOptionalV2Electrical,
  index: EntityIndex,
  options: LabelStripExportOptions
): LabelStripSegment[] {
  // The panel grid is the source of truth for the physical row width. Stored
  // module widths can be stale (or a manually resized module can extend past
  // the last configured column), so never let an individual segment change
  // the row's printable width.
  const fullWidthCols = row.columnCount != null ? Math.max(0, row.columnCount) : null
  const orderedModules = [...row.modules].sort(
    (left, right) =>
      (left.slot?.col ?? Number.MAX_SAFE_INTEGER) - (right.slot?.col ?? Number.MAX_SAFE_INTEGER)
  )
  const segments: LabelStripSegment[] = []
  let cursorCols = 0
  for (const module of orderedModules) {
    const segment = segmentForModule(module, project, index, options)
    if (!segment) continue
    const rawWidthCols = segment.widthMm / MODULE_WIDTH_MM
    const rawStartCols = Math.max(cursorCols, module.slot?.col ?? cursorCols)
    const startCols = fullWidthCols == null ? rawStartCols : Math.min(rawStartCols, fullWidthCols)
    const widthCols =
      fullWidthCols == null
        ? rawWidthCols
        : Math.min(rawWidthCols, Math.max(0, fullWidthCols - startCols))
    if (widthCols <= 0) continue
    if (startCols > cursorCols)
      segments.push(blankSegment((startCols - cursorCols) * MODULE_WIDTH_MM))
    segments.push(
      widthCols === rawWidthCols
        ? segment
        : { ...segment, widthMm: widthCols * MODULE_WIDTH_MM }
    )
    cursorCols = startCols + widthCols
  }
  const fullWidthMm = (fullWidthCols ?? cursorCols) * MODULE_WIDTH_MM
  const trailingWidthMm = fullWidthMm - cursorCols * MODULE_WIDTH_MM
  if (trailingWidthMm > 0) segments.push(blankSegment(trailingWidthMm))
  return segments
}

export function buildLabelStripModel(
  project: ProjectWithOptionalV2Electrical,
  options: LabelStripExportOptions,
  provider: LabelStripModuleProvider
): LabelStrip[] {
  const index = buildEntityIndex(project)
  const sourceRows = buildSourceRows(project, options, provider, index)
  const model = sourceRows
    .map((row) => ({
      sourceLabel: row.sourceLabel,
      row: row.row,
      segments: rowSegments(row, project, index, options),
    }))
    .filter((strip) => !options.skipEmptyRows || strip.segments.some((segment) => !segment.blank))
  exportLog('[label-strip] model built', {
    sourceRowCount: sourceRows.length,
    exportedRowCount: model.length,
    rows: model.map((strip) => ({
      sourceLabel: strip.sourceLabel,
      row: strip.row,
      widthMm: strip.segments.reduce((sum, segment) => sum + segment.widthMm, 0),
      nonBlankSegments: strip.segments.filter((segment) => !segment.blank).length,
      labels: strip.segments
        .filter((segment) => !segment.blank)
        .map((segment) => ({ identifier: segment.identifier, description: segment.description })),
    })),
  })
  return model
}

function wrapText(value: string, maxChars: number, maxLines: number): string[] {
  const lines: string[] = []
  for (const paragraph of value.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let current = ''
    for (const word of words) {
      if (word.length > maxChars) {
        if (current) lines.push(current)
        current = ''
        for (let offset = 0; offset < word.length; offset += maxChars) {
          const piece = word.slice(offset, offset + maxChars)
          if (offset + maxChars >= word.length) current = piece
          else lines.push(piece)
        }
        continue
      }
      const next = current ? `${current} ${word}` : word
      if (next.length <= maxChars || !current) current = next
      else {
        lines.push(current)
        current = word
      }
    }
    if (current) lines.push(current)
  }
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  const last = kept[maxLines - 1] ?? ''
  kept[maxLines - 1] = `${last.slice(0, Math.max(1, maxChars - 1))}…`
  return kept
}

function textSvg(
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  maxLines: number,
  bold = false,
  sizes = [3.4, 3, 2.6, 2.2],
  alignment: 'left' | 'center' | 'right' | 'justify' = 'center'
): string {
  for (const size of sizes) {
    const maxChars = Math.max(3, Math.floor(width / (size * 0.62)))
    const lines = wrapText(value, maxChars, maxLines)
    if (lines.length <= maxLines) {
      const lineHeight = size * 1.2
      const startY = y + Math.max(size + 1, (height - lines.length * lineHeight) / 2 + size)
      // svg2pdf applies a small, font-dependent offset to middle-anchored text.
      // Correct it here so identifiers and descriptions land on the same cell center.
      const textX =
        alignment === 'left'
          ? x - width / 2 + 1
          : alignment === 'right'
            ? x + width / 2 - 1
            : x
      const anchor = alignment === 'left' ? 'start' : alignment === 'right' ? 'end' : 'middle'
      return lines
        .map(
          (line, index) => {
            const spread =
              alignment === 'justify' && line.length > 1
                ? ` textLength="${Math.max(1, width - 2).toFixed(2)}" lengthAdjust="spacing"`
                : ''
            return `<text x="${textX.toFixed(2)}" y="${(startY + index * lineHeight).toFixed(2)}" text-anchor="${anchor}"${spread} font-family="Arial, sans-serif" font-size="${size}" font-weight="${bold ? '700' : '400'}" fill="#111827">${escapeXml(line)}</text>`
          }
        )
        .join('')
    }
  }
  return ''
}

function renderCellText(
  value: string,
  cellX: number,
  y: number,
  cellWidth: number,
  height: number,
  bold = false,
  alignment: 'left' | 'center' | 'right' | 'justify' = 'center'
): string {
  return textSvg(
    value,
    cellX + cellWidth / 2,
    y,
    cellWidth,
    height,
    bold ? 1 : 3,
    bold,
    bold ? [6.8, 5.8, 5, 4.2] : [3.2, 2.8, 2.5, 2.2],
    alignment
  )
}

function renderCellParts(
  parts: LabelStripContentPart[] | undefined,
  fallback: string,
  cellX: number,
  y: number,
  cellWidth: number,
  height: number,
  alignment: 'left' | 'center' | 'right' | 'justify' = 'center'
): string {
  const technicalPart = parts?.length === 1 && parts[0]?.source === 'technical' ? parts[0] : undefined
  if (technicalPart?.technicalParts?.length) {
    return technicalPartsSvg(technicalPart.technicalParts, cellX, y, cellWidth, height, alignment)
  }
  const label = parts?.find((part) => part.source === 'label')?.text ?? ''
  const secondary = (parts ?? [])
    .filter((part) => part.source !== 'label')
    .map((part) => part.text)
    .filter(Boolean)
    .join('\n')
  if (!label) return renderCellText(secondary || fallback, cellX, y, cellWidth, height, false, alignment)
  if (!secondary) return renderCellText(label, cellX, y, cellWidth, height, true, alignment)

  const labelHeight = Math.min(height * 0.5, 13)
  return `${renderCellText(label, cellX, y, cellWidth, labelHeight, true, alignment)}${renderCellText(
    secondary,
    cellX,
    y + labelHeight,
    cellWidth,
    Math.max(5, height - labelHeight),
    false,
    alignment
  )}`
}

function technicalPartsSvg(
  parts: Array<{ text: string; framed?: boolean }>,
  cellX: number,
  y: number,
  width: number,
  height: number,
  alignment: 'left' | 'center' | 'right' | 'justify'
): string {
  const sizes = [3.2, 2.8, 2.5, 2.2]
  const size =
    sizes.find(
      (candidate) =>
        parts.length * candidate * 1.35 <= height - 2 &&
        parts.every((part) => part.text.length * candidate * 0.56 + 2 <= width)
    ) ?? sizes.at(-1)!
  const lineHeight = size * 1.35
  const startY = y + (height - parts.length * lineHeight) / 2 + size
  return parts
    .map((part, index) => {
      const hasResidualTriangle = part.text.startsWith(RESIDUAL_CURRENT_DELTA)
      const plainText = hasResidualTriangle
        ? part.text.slice(RESIDUAL_CURRENT_DELTA.length)
        : part.text
      const triangleWidth = hasResidualTriangle ? size * 0.8 : 0
      const triangleGap = hasResidualTriangle ? size * 0.2 : 0
      const textWidth = Math.min(
        width - 2,
        Math.max(size, plainText.length * size * 0.56 + triangleWidth + triangleGap)
      )
      const textX =
        alignment === 'left'
          ? cellX + 1
          : alignment === 'right'
            ? cellX + width - 1
            : cellX + width / 2
      const anchor = alignment === 'left' ? 'start' : alignment === 'right' ? 'end' : 'middle'
      const baseline = startY + index * lineHeight
      const rectX =
        alignment === 'left'
          ? textX - 0.7
          : alignment === 'right'
            ? textX - textWidth - 0.7
            : textX - textWidth / 2 - 0.7
      const frame = part.framed
        ? `<rect x="${rectX.toFixed(2)}" y="${(baseline - size).toFixed(2)}" width="${(textWidth + 1.4).toFixed(2)}" height="${(size + 1).toFixed(2)}" fill="none" stroke="#111827" stroke-width="0.25"/>`
        : ''
      if (!hasResidualTriangle) {
        return `${frame}<text x="${textX.toFixed(2)}" y="${baseline.toFixed(2)}" text-anchor="${anchor}" font-family="Arial, sans-serif" font-size="${size}" font-weight="400" fill="#111827">${escapeXml(plainText)}</text>`
      }
      const contentLeft =
        alignment === 'left'
          ? textX
          : alignment === 'right'
            ? textX - textWidth
            : textX - textWidth / 2
      const triangleLeft = contentLeft
      const triangleTop = baseline - size * 0.82
      const triangle = `<path d="M${triangleLeft.toFixed(2)} ${baseline.toFixed(2)} L${(triangleLeft + triangleWidth / 2).toFixed(2)} ${triangleTop.toFixed(2)} L${(triangleLeft + triangleWidth).toFixed(2)} ${baseline.toFixed(2)} Z" fill="none" stroke="#111827" stroke-width="0.22"/>`
      const residualTextX = contentLeft + triangleWidth + triangleGap
      return `${frame}${triangle}<text x="${residualTextX.toFixed(2)}" y="${baseline.toFixed(2)}" text-anchor="start" font-family="Arial, sans-serif" font-size="${size}" font-weight="400" fill="#111827">${escapeXml(plainText)}</text>`
    })
    .join('')
}

function dimensionLabel(
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  showWidth = true
): string {
  const widthText = showWidth
    ? `<text x="${(x + width / 2).toFixed(2)}" y="${(y - 4.5).toFixed(2)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="2.5" fill="#374151">${escapeXml(label)}</text>`
    : ''
  return `${widthText}<text x="${(x - 5).toFixed(2)}" y="${(y + height / 2).toFixed(2)}" text-anchor="middle" transform="rotate(-90 ${(x - 5).toFixed(2)} ${(y + height / 2).toFixed(2)})" font-family="Arial, sans-serif" font-size="2.5" fill="#374151">${escapeXml(`${height} mm`)}</text>`
}

function cutterMarker(x: number, y: number, scale = 0.5): string {
  return `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale})" fill="none" stroke="#374151" stroke-width="0.35"><circle cx="0" cy="-1.3" r="1.1"/><circle cx="0" cy="1.3" r="1.1"/><path d="M0.8 -0.6 L4 -2.2 M0.8 0.6 L4 2.2"/></g>`
}

function horizontalCutLine(x: number, lineY: number, width: number, markY: number): string {
  return `<g><line x1="${x.toFixed(2)}" y1="${lineY.toFixed(2)}" x2="${(x + width).toFixed(2)}" y2="${lineY.toFixed(2)}" stroke="#9ca3af" stroke-width="0.2" stroke-dasharray="1.2 1.2"/><path d="M${(x - 4).toFixed(2)} ${(markY - 2).toFixed(2)} L${(x - 2).toFixed(2)} ${markY.toFixed(2)} L${(x - 4).toFixed(2)} ${(markY + 2).toFixed(2)} M${(x + width + 4).toFixed(2)} ${(markY - 2).toFixed(2)} L${(x + width + 2).toFixed(2)} ${markY.toFixed(2)} L${(x + width + 4).toFixed(2)} ${(markY + 2).toFixed(2)}" fill="none" stroke="#374151" stroke-width="0.35"/>${cutterMarker(x - 9, markY)}</g>`
}

function verticalCutMarker(x: number, y: number, rotation: number): string {
  return `<g transform="rotate(${rotation} ${x.toFixed(2)} ${y.toFixed(2)})">${cutterMarker(x, y)}</g>`
}

function verticalCutVMark(x: number, y: number, pointsDown: boolean): string {
  const armY = y + (pointsDown ? -2 : 2)
  return `<path d="M${(x - 2).toFixed(2)} ${armY.toFixed(2)} L${x.toFixed(2)} ${y.toFixed(2)} L${(x + 2).toFixed(2)} ${armY.toFixed(2)}" fill="none" stroke="#374151" stroke-width="0.35"/>`
}

function verticalCutMarkers(x: number, y: number, isTop: boolean, showScissors: boolean): string {
  const vMarkY = y
  const scissorY = y + (isTop ? -ENDPOINT_SCISSOR_OFFSET_MM : ENDPOINT_SCISSOR_OFFSET_MM)
  const scissorRotation = isTop ? 90 : -90
  return `${verticalCutVMark(x, vMarkY, isTop)}${showScissors ? verticalCutMarker(x, scissorY, scissorRotation) : ''}`
}

function pageVerticalCutGuides(
  leftX: number,
  rightX: number,
  firstTop: number,
  lastBottom: number,
  showTopScissors: boolean,
  showBottomScissors: boolean
): string {
  const topMarkY = firstTop - 4
  const bottomMarkY = lastBottom + 4
  const startY = topMarkY
  const endY = bottomMarkY
  const guide = (x: number) =>
    `<line x1="${x.toFixed(2)}" y1="${startY.toFixed(2)}" x2="${x.toFixed(2)}" y2="${endY.toFixed(2)}" stroke="#9ca3af" stroke-width="0.2" stroke-dasharray="1.2 1.2"/>${verticalCutMarkers(x, topMarkY, true, showTopScissors)}${verticalCutMarkers(x, bottomMarkY, false, showBottomScissors)}`
  return `<g>${guide(leftX)}${guide(rightX)}</g>`
}

function dashedTwoModuleGuides(
  x: number,
  y: number,
  width: number,
  height: number,
  segments: LabelStripSegment[]
): string {
  let guides = ''
  for (let offset = MODULE_WIDTH_MM * 2; offset < width - 0.1; offset += MODULE_WIDTH_MM * 2) {
    let cursor = 0
    const crossesOccupiedModule = segments.some((segment) => {
      const start = cursor
      const end = cursor + segment.widthMm
      cursor = end
      return !segment.blank && offset > start + 0.1 && offset < end - 0.1
    })
    if (crossesOccupiedModule) continue
    const guideX = x + offset
    guides += `<line x1="${guideX.toFixed(2)}" y1="${y.toFixed(2)}" x2="${guideX.toFixed(2)}" y2="${(y + height).toFixed(2)}" stroke="#9ca3af" stroke-width="0.2" stroke-dasharray="1.2 1.2"/>`
  }
  return guides
}

function renderStrip(
  segments: LabelStripSegment[],
  x: number,
  y: number,
  height: number,
  doubleMode: boolean,
  secondHeight: number
): string {
  const totalWidth = segments.reduce((sum, segment) => sum + segment.widthMm, 0)
  let cursor = x
  const renderOne = (
    top: number,
    stripHeight: number,
    content: (segment: LabelStripSegment, cellX: number) => string,
    widthLabel: string,
    showWidth = true
  ) => {
    let result = `${dimensionLabel(x, top, totalWidth, stripHeight, widthLabel, showWidth)}${horizontalCutLine(x, top - HORIZONTAL_CUT_OFFSET_MM, totalWidth, top)}<g><rect x="${x.toFixed(2)}" y="${top.toFixed(2)}" width="${totalWidth.toFixed(2)}" height="${stripHeight.toFixed(2)}" fill="#ffffff" stroke="none"/>${dashedTwoModuleGuides(x, top, totalWidth, stripHeight, segments)}`
    cursor = x
    for (const [index, segment] of segments.entries()) {
      const cellX = cursor + 1
      const previous = segments[index - 1]
      const isPhysicalBoundary =
        index > 0 && (!segment.blank || (previous != null && !previous.blank))
      if (isPhysicalBoundary) {
        result += `<line x1="${cursor.toFixed(2)}" y1="${top.toFixed(2)}" x2="${cursor.toFixed(2)}" y2="${(top + stripHeight).toFixed(2)}" stroke="#374151" stroke-width="0.2"/>`
      }
      if (!segment.blank) result += content(segment, cellX)
      cursor += segment.widthMm
    }
    result += `</g>${horizontalCutLine(x, top + stripHeight + HORIZONTAL_CUT_OFFSET_MM, totalWidth, top + stripHeight)}`
    return result
  }
  const first = renderOne(
    y,
    height,
    (segment, cellX) => {
      const value = doubleMode ? segment.identifier : segment.description
      return renderCellParts(
        doubleMode ? segment.topParts : segment.bottomParts,
        value,
        cellX,
        y,
        segment.widthMm - 2,
        height,
        doubleMode ? segment.topAlignment : segment.bottomAlignment
      )
    },
    `${totalWidth} mm`
  )
  if (!doubleMode) return first
  const secondY = y + height + 5
  const second = renderOne(
    secondY,
    secondHeight,
    (segment, cellX) => {
      const value = segment.description
      return renderCellParts(
        segment.bottomParts,
        value,
        cellX,
        secondY,
        segment.widthMm - 2,
        secondHeight,
        segment.bottomAlignment
      )
    },
    `${totalWidth} mm`,
    false
  )
  return `${first}${second}`
}

function heightPair(options: LabelStripExportOptions): [number, number] {
  if (options.preset === '25') return [25, 25]
  if (options.preset === '35') return [35, 35]
  return [Math.max(1, options.customHeightMm), Math.max(1, options.customSecondHeightMm)]
}

function pageSpecs(paperSize: 'A4' | 'A3'): PageSpec[] {
  const size = paperSize === 'A3' ? A3 : A4
  return [
    { width: size.height, height: size.width, orientation: 'landscape' },
    { width: size.width, height: size.height, orientation: 'portrait' },
  ]
}

function splitStripForWidth(strip: LabelStrip, maxWidth: number): LayoutItem[] {
  const printableSegments: LabelStripSegment[] = []
  for (const segment of strip.segments) {
    if (!segment.blank || segment.widthMm <= MODULE_WIDTH_MM) {
      printableSegments.push(segment)
      continue
    }
    let remaining = segment.widthMm
    while (remaining > 0.1) {
      const width = Math.min(MODULE_WIDTH_MM, remaining)
      printableSegments.push({ ...segment, widthMm: width })
      remaining -= width
    }
  }

  const items: LayoutItem[] = []
  let current: LabelStripSegment[] = []
  let currentWidth = 0
  let continuationIndex = 0
  for (const segment of printableSegments) {
    if (current.length > 0 && currentWidth + segment.widthMm > maxWidth) {
      items.push({
        sourceLabel: strip.sourceLabel,
        row: strip.row,
        continuationIndex,
        segments: current,
      })
      current = []
      currentWidth = 0
      continuationIndex += 1
    }
    current.push(segment)
    currentWidth += segment.widthMm
  }
  if (current.length > 0)
    items.push({
      sourceLabel: strip.sourceLabel,
      row: strip.row,
      continuationIndex,
      segments: current,
    })
  return items
}

function layoutItemWidth(item: LayoutItem): number {
  return item.segments.reduce((sum, segment) => sum + segment.widthMm, 0)
}

function packItems(
  strips: LabelStrip[],
  spec: PageSpec,
  options: LabelStripExportOptions
): PackedPage[] {
  const maxWidth = spec.width - PAGE_MARGIN_MM * 2
  const [firstHeight, secondHeight] = heightPair(options)
  const items = strips.flatMap((strip) => splitStripForWidth(strip, maxWidth))
  const pages: PackedPage[] = []
  let page: PackedPage = { spec, items: [] }
  let x = PAGE_MARGIN_MM
  let y = PAGE_MARGIN_MM
  const itemHeight =
    CAPTION_HEIGHT_MM +
    firstHeight +
    (options.stripMode === 'double' ? 5 + secondHeight : 0) +
    CUT_MARK_MM * 2
  const startPage = () => {
    page = { spec, items: [] }
    pages.push(page)
    x = PAGE_MARGIN_MM
    y = PAGE_MARGIN_MM
  }
  startPage()
  for (const item of items) {
    const width = layoutItemWidth(item)
    if (x > PAGE_MARGIN_MM && x + width > spec.width - PAGE_MARGIN_MM) {
      x = PAGE_MARGIN_MM
      y += itemHeight + ROW_GAP_MM
    }
    if (y + itemHeight > spec.height - PAGE_MARGIN_MM) startPage()
    page.items.push({ item, x, y })
    x += width + COLUMN_GAP_MM
  }
  return pages.filter((candidate) => candidate.items.length > 0)
}

function buildConduiLink(): string {
  return CONDUI_LINK
}

function inlineSvgMarkup(svg: string, x: number, y: number, width: number, height: number): string {
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 100 100'
  const inner = svg.replace(/^.*?<svg[^>]*>/s, '').replace(/<\/svg>\s*$/s, '')
  return `<svg x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${width.toFixed(2)}" height="${height.toFixed(2)}" viewBox="${viewBox}">${inner}</svg>`
}

function qrCodeToSvg(size: number, data: ArrayLike<number>): string {
  const quietZone = 1
  const viewSize = size + quietZone * 2
  let modules = ''
  for (let row = 0; row < size; row += 1) {
    let runStart: number | null = null
    for (let column = 0; column <= size; column += 1) {
      const isDark = column < size && data[row * size + column] === 1
      if (isDark && runStart === null) runStart = column
      if (!isDark && runStart !== null) {
        modules += `<rect x="${quietZone + runStart}" y="${quietZone + row}" width="${column - runStart}" height="1"/>`
        runStart = null
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges"><rect width="${viewSize}" height="${viewSize}" fill="#ffffff"/><g fill="#111827">${modules}</g></svg>`
}

function renderPage(page: PackedPage, options: LabelStripExportOptions, qrSvg: string): string {
  const { spec } = page
  const [firstHeight, secondHeight] = heightPair(options)
  let body = ''
  const stripHeight = firstHeight + (options.stripMode === 'double' ? 5 + secondHeight : 0)
  const pageFirstTop = Math.min(
    ...page.items.map((placement) => placement.y + CAPTION_HEIGHT_MM)
  )
  const pageLastBottom = Math.max(
    ...page.items.map((placement) => placement.y + CAPTION_HEIGHT_MM + stripHeight)
  )
  for (const placement of page.items) {
    const { item, x, y } = placement
    const currentTop = y + CAPTION_HEIGHT_MM
    const currentBottom = currentTop + stripHeight
    const stripWidth = layoutItemWidth(item)
    const rowCaption = i18n.t('labelStripExport.rowFromTop', {
      row: item.row + 1,
      defaultValue: 'Row {{row}} from top',
    })
    body += pageVerticalCutGuides(
      x - CUT_OFFSET_MM,
      x + stripWidth + CUT_OFFSET_MM,
      currentTop,
      currentBottom,
      Math.abs(currentTop - pageFirstTop) < 0.01,
      Math.abs(currentBottom - pageLastBottom) < 0.01
    )
    body += `<text x="${x.toFixed(2)}" y="${(y + 3).toFixed(2)}" font-family="Arial, sans-serif" font-size="2.5" fill="#4b5563">${escapeXml(`${item.sourceLabel} - ${rowCaption}`)}</text>`
    body += renderStrip(
      item.segments,
      x,
      y + CAPTION_HEIGHT_MM,
      firstHeight,
      options.stripMode === 'double',
      secondHeight
    )
  }
  const rightGuideX = page.items.reduce(
    (right, placement) =>
      Math.max(right, placement.x + layoutItemWidth(placement.item) + CUT_OFFSET_MM),
    PAGE_MARGIN_MM
  )
  const qrSize = 13
  const paperLabelWidth = 10
  const headerGap = 4
  const defaultHeaderX = spec.width - PAGE_MARGIN_MM
  const defaultQrRight = defaultHeaderX - paperLabelWidth - headerGap
  const maxQrRight = rightGuideX - ENDPOINT_MARKER_CLEARANCE_MM
  const defaultQrX = defaultQrRight - qrSize
  const endpointOverlapsQr =
    rightGuideX + ENDPOINT_MARKER_CLEARANCE_MM >= defaultQrX &&
    rightGuideX - ENDPOINT_MARKER_CLEARANCE_MM <= defaultQrRight
  const headerX = endpointOverlapsQr ? maxQrRight + paperLabelWidth + headerGap : defaultHeaderX
  const qrX = headerX - paperLabelWidth - headerGap - qrSize
  const paperLabelX = defaultHeaderX - paperLabelWidth
  const logoWidth = 20
  const logoHeight = 4.6
  const logoX = qrX - 26 - logoWidth
  const logoY = 4.2
  const headerBaseline = logoY + 3.8
  const attribution = i18n.t('labelStripExport.madeWith', {
    defaultValue: 'Cabinet labels made with',
  })
  const attributionWidth = attribution.length * 0.5 * 2.3
  const attributionX = logoX - attributionWidth - 1
  const header = `${inlineSvgMarkup(qrSvg, qrX, 1.2, qrSize, qrSize)}<text x="${attributionX.toFixed(2)}" y="${headerBaseline.toFixed(2)}" text-anchor="start" font-family="Arial, sans-serif" font-size="2.3" fill="#374151">${escapeXml(attribution)}</text><svg x="${logoX.toFixed(2)}" y="${logoY.toFixed(2)}" width="${logoWidth}" height="${logoHeight}" viewBox="0 0 482.5 111.5">${CONDUI_LOGO_INNER}</svg><text x="${(logoX + logoWidth + 1).toFixed(2)}" y="${headerBaseline.toFixed(2)}" font-family="Arial, sans-serif" font-size="3.5" font-weight="700" fill="#111827">.be</text><text x="${paperLabelX.toFixed(2)}" y="${headerBaseline.toFixed(2)}" text-anchor="start" font-family="Arial, sans-serif" font-size="4" font-weight="700" fill="#111827">${options.paperSize}</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}mm" height="${spec.height}mm" viewBox="0 0 ${spec.width} ${spec.height}"><rect width="100%" height="100%" fill="#ffffff"/>${header}${body}</svg>`
}

export async function exportLabelStripsToPdf(
  project: ProjectWithOptionalV2Electrical,
  options: LabelStripExportOptions,
  provider: LabelStripModuleProvider
): Promise<Blob> {
  // Keep the pure label-model path usable in Node-based tests and server tooling.
  // jsPDF/svg2pdf are browser-oriented and are loaded only when a PDF is requested.
  const [{ svg2pdf }, { createPdfDocument }, { default: QRCode }] = await Promise.all([
    import('svg2pdf.js'),
    import('./svgToPdf'),
    import('qrcode'),
  ])
  const qrCode = QRCode.create(buildConduiLink(), { errorCorrectionLevel: 'M' })
  const qrSvg = qrCodeToSvg(qrCode.modules.size, qrCode.modules.data)
  const strips = buildLabelStripModel(project, options, provider)
  if (strips.length === 0)
    throw new Error('No label strips can be generated from the selected modules.')

  const candidates = pageSpecs(options.paperSize).map((spec) => ({
    spec,
    pages: packItems(strips, spec, options),
  }))
  candidates.sort(
    (left, right) =>
      Number(right.spec.orientation === 'landscape') -
        Number(left.spec.orientation === 'landscape') || left.pages.length - right.pages.length
  )
  const selected = candidates[0]
  if (!selected || selected.pages.length === 0)
    throw new Error('No printable label rows were found.')

  const pageSize = options.paperSize === 'A3' ? A3 : A4
  const pdf = createPdfDocument(pageSize, selected.spec.orientation)
  for (let index = 0; index < selected.pages.length; index += 1) {
    if (index > 0)
      pdf.addPage([selected.spec.width, selected.spec.height], selected.spec.orientation)
    const parser = new DOMParser()
    const document = parser.parseFromString(
      renderPage(selected.pages[index]!, options, qrSvg),
      'image/svg+xml'
    )
    const mount = globalThis.document?.createElement('div')
    let svgElement = document.documentElement as unknown as SVGSVGElement
    if (mount && globalThis.document?.body) {
      mount.style.position = 'fixed'
      mount.style.left = '-10000px'
      mount.style.top = '0'
      mount.innerHTML = renderPage(selected.pages[index]!, options, qrSvg)
      svgElement = mount.querySelector('svg') as SVGSVGElement
      globalThis.document.body.appendChild(mount)
    }
    try {
      await svg2pdf(svgElement, pdf, {
        width: selected.spec.width,
        height: selected.spec.height,
      })
      pdf.link(selected.spec.width - PAGE_MARGIN_MM - 30, 3, 30, 10, {
        url: buildConduiLink(),
      })
    } finally {
      mount?.remove()
    }
  }
  return pdf.output('blob')
}
