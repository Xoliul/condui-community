import type { TFunction } from 'i18next'
import type { ControlSystem } from '@/types/schema'
import { escapeXml, fitText, paletteFor } from '@/lib/cableRouting/cableSchedulePdf'
import { formatChannelList, type AddressTableDevice, type AddressTableRow } from './addressTable'
import type { ConnectedEndpointSource, ConnectionDirection } from './controlLink'

/** Page geometry in millimetres, matching the cable schedule: A4 landscape, 15 mm margin. */
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
  { key: 'channel', width: 24 },
  { key: 'direction', width: 26 },
  { key: 'groups', width: 72 },
  { key: 'load', width: 80 },
  { key: 'circuit', width: 30 },
  { key: 'source', width: 35 },
] as const

/** Lines that fit on one page below the column header. */
export const ADDRESS_TABLE_LINES_PER_PAGE = Math.floor((FOOTER_Y - 6 - BODY_TOP) / ROW_HEIGHT)

export interface AddressTablePdfLabels {
  title: string
  channel: string
  direction: string
  groups: string
  load: string
  circuit: string
  source: string
  free: string
  continued: string
  /** Name of an operating relay's kind, shown in its heading instead of a system. */
  relay: string
  directionLabel: (direction: ConnectionDirection) => string
  sourceLabel: (source: ConnectedEndpointSource) => string
  system: (system: ControlSystem | undefined) => string
}

/** Localized labels, matching the address table in the Documents view. */
export function getAddressTablePdfLabels(t: TFunction): AddressTablePdfLabels {
  return {
    title: t('controlAddresses.title', 'Domotics addresses'),
    channel: t('controlAddresses.channel', 'Channel'),
    direction: t('controlAddresses.direction', 'Direction'),
    groups: t('controlAddresses.groups', 'Groups'),
    load: t('controlAddresses.load', 'Connected to'),
    circuit: t('controlAddresses.circuit', 'Circuit'),
    source: t('controlAddresses.source', 'Connection'),
    free: t('controlAddresses.free', 'Free'),
    continued: t('cableSchedule.continued', 'continued'),
    relay: t('symbols.relay', 'Relay'),
    directionLabel: (direction) =>
      direction === 'output'
        ? t('controlAddresses.output', 'Output')
        : t('controlAddresses.input', 'Input'),
    sourceLabel: (source) =>
      source === 'wired'
        ? t('controlAddresses.wired', 'Wired')
        : t('controlAddresses.linked', 'Linked'),
    system: (system) => (system ? t(`endpoints.domotica.systems.${system}`, system) : ''),
  }
}

/**
 * Module heading: label, system (gateway sides), device address and line, enclosure, usage.
 * A relay shows its kind instead of a system and no channel usage.
 */
export function describeAddressTableDevice(
  device: AddressTableDevice,
  system: (system: ControlSystem | undefined) => string,
  relayLabel = ''
): string {
  if (device.kind === 'relay') return [device.label, relayLabel, device.panelName].filter(Boolean).join(' · ')
  const systems = device.outputSystem
    ? `${system(device.system)} → ${system(device.outputSystem)}`
    : system(device.system)
  return [
    device.label,
    systems,
    device.deviceAddress,
    device.line,
    device.panelName,
    `${device.capacity.used}/${device.capacity.capacity}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

type TableLine =
  | { kind: 'device'; device: AddressTableDevice; continued?: boolean }
  | { kind: 'row'; row: AddressTableRow }
  | { kind: 'free'; channels: string[] }

/** Module headings before each module's rows (repeated when it continues on the next page). */
function paginate(devices: AddressTableDevice[]): TableLine[][] {
  const lines: TableLine[] = []
  for (const device of devices) {
    lines.push({ kind: 'device', device })
    for (const row of device.rows) lines.push({ kind: 'row', row })
    if (device.freeChannels.length > 0) lines.push({ kind: 'free', channels: device.freeChannels })
  }
  const pages: TableLine[][] = []
  let page: TableLine[] = []
  let current: AddressTableDevice | undefined
  for (const [index, line] of lines.entries()) {
    if (page.length === ADDRESS_TABLE_LINES_PER_PAGE) {
      pages.push(page)
      page = []
      if (line.kind !== 'device' && current) page.push({ kind: 'device', device: current, continued: true })
    }
    // A heading never ends a page on its own.
    if (line.kind === 'device' && page.length === ADDRESS_TABLE_LINES_PER_PAGE - 1 && lines[index + 1]) {
      pages.push(page)
      page = []
    }
    if (line.kind === 'device') current = line.device
    page.push(line)
  }
  if (page.length > 0) pages.push(page)
  return pages
}

export function getAddressTablePdfPageCount(devices: AddressTableDevice[]): number {
  return paginate(devices).length
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/** One SVG (millimetre units, A4 landscape) per page of the address table. */
export function buildAddressTableSvgPages(
  devices: AddressTableDevice[],
  labels: AddressTablePdfLabels,
  fontFamily: string,
  theme: 'light' | 'dark' = 'light'
): string[] {
  const pages = paginate(devices)
  return pages.map((lines, pageIndex) => {
    const title = pages.length > 1 ? `${labels.title} (${pageIndex + 1}/${pages.length})` : labels.title
    return buildPage(title, lines, labels, fontFamily, paletteFor(theme))
  })
}

function buildPage(
  title: string,
  lines: TableLine[],
  labels: AddressTablePdfLabels,
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

  const cell = (index: number, text: string, baseline: number, weight = '', fill = palette.text) => {
    const column = COLUMNS[index]!
    const value = escapeXml(fitText(text, column.width - 3, 3))
    const bold = weight ? ` font-weight="${weight}"` : ''
    return `<text x="${round(columnX[index]! + 1.5)}" y="${baseline}" font-size="3"${bold} ${font} fill="${fill}">${value}</text>`
  }

  parts.push(
    `<text x="${left}" y="${TITLE_Y}" font-size="6" font-weight="bold" ${font} fill="${palette.text}">${escapeXml(fitText(title, right - left, 6))}</text>`
  )
  parts.push(
    `<rect x="${left}" y="${TABLE_TOP}" width="${right - left}" height="${HEADER_HEIGHT}" fill="${palette.headerFill}"/>`
  )
  const headerBaseline = round(TABLE_TOP + HEADER_HEIGHT - 2.3)
  ;[labels.channel, labels.direction, labels.groups, labels.load, labels.circuit, labels.source].forEach(
    (header, index) => parts.push(cell(index, header, headerBaseline, 'bold'))
  )

  lines.forEach((line, index) => {
    const top = BODY_TOP + index * ROW_HEIGHT
    const baseline = round(top + ROW_HEIGHT - 1.7)
    if (line.kind === 'device') {
      parts.push(
        `<rect x="${left}" y="${round(top)}" width="${right - left}" height="${ROW_HEIGHT}" fill="${palette.boardFill}"/>`
      )
      const heading = describeAddressTableDevice(line.device, labels.system, labels.relay)
      const text = line.continued ? `${heading} (${labels.continued})` : heading
      parts.push(
        `<text x="${left + 1.5}" y="${baseline}" font-size="3.2" font-weight="bold" ${font} fill="${palette.text}">${escapeXml(fitText(text, right - left - 3, 3.2))}</text>`
      )
      return
    }
    if (line.kind === 'free') {
      parts.push(cell(0, labels.free, baseline, '', palette.secondary))
      parts.push(
        `<text x="${round(columnX[1]! + 1.5)}" y="${baseline}" font-size="3" ${font} fill="${palette.secondary}">${escapeXml(fitText(formatChannelList(line.channels), right - columnX[1]! - 3, 3))}</text>`
      )
      return
    }
    const { row } = line
    parts.push(cell(0, row.channel ?? '–', baseline, 'bold'))
    parts.push(cell(1, labels.directionLabel(row.direction), baseline))
    parts.push(cell(2, row.groups.join(', '), baseline))
    parts.push(cell(3, row.load, baseline))
    parts.push(cell(4, row.circuit, baseline))
    parts.push(cell(5, labels.sourceLabel(row.source), baseline))
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
