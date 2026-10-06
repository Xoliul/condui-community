import type {
  DomoticaControlKey,
  Endpoint,
  ProjectAddress,
  ProjectCustomerContact,
  ProjectPartyContact,
  ProtectionDevice,
  ResidualCurrentType,
  Rotation,
  TrunkDevice,
} from '@/types/schema'
import { createLegacyEmptyProject } from '@/lib/import/createLegacyEmptyProject'

export type Project = ReturnType<typeof createLegacyEmptyProject>

export function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

export async function sha256Hex(text: string): Promise<string | undefined> {
  try {
    const bytes = new TextEncoder().encode(text)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const arr = new Uint8Array(digest)
    return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return undefined
  }
}

export type TrikNode = {
  id: string
  type: Endpoint['type']
  symbol: Endpoint['symbol']
  branchKey?: string
  endpointNote?: string
  socketCount?: number
  socketWaterproof?: boolean
  switchVerklikkerlamp?: boolean
  switchPoles?: 1 | 2 | 3 | 4
  relayProps?: Endpoint['relayProps']
  smokeDetectorProps?: Endpoint['smokeDetectorProps']
  motionDetectorProps?: Endpoint['motionDetectorProps']
  energyMeterProps?: Endpoint['energyMeterProps']
  domoticaControl?: DomoticaControlKey[]
  domoticaMainDeviceType?: 'none' | 'switch' | 'socket'
  domoticaMainSwitchSymbol?: Endpoint['symbol']
  lightPointProps?: Endpoint['lightPointProps']
  lightSpotProps?: Endpoint['lightSpotProps']
  lightFluorescentProps?: Endpoint['lightFluorescentProps']
  multiplierCount?: number
  solarPanelProps?: Endpoint['solarPanelProps']
  batteryProps?: Endpoint['batteryProps']
  energyConversionProps?: Endpoint['energyConversionProps']
  fixedApplianceProps?: Endpoint['fixedApplianceProps']
  hvacProps?: Endpoint['hvacProps']
  /** TRiK <Satellites><Nota> on this node — schematic text; becomes eendraad notes, not sitplan. */
  satelliteNotas?: Array<{ text: string; offsetX: number; offsetY: number }>
  /** TRiK <Satellites><Mark> pair corners, used to recover grouped eendraad frames. */
  satelliteMarks?: TrikSatelliteMark[]
  /** If this node is inside a DomoticaModule subtree, points to the module node id. */
  domoticaParentNodeId?: string
  /** True when node is a direct child of the DomoticaModule host. */
  domoticaDirectChild?: boolean
  /** Node id of the direct DomoticaModule child that owns this output chain. */
  domoticaOutputRootNodeId?: string
  /** TRiK `Adres` of a wired domotica output, imported as its control channel. */
  controlChannel?: string
  /** DC output (1-based beyond the primary output 0) of the circuit-trunk converter feeding this node. */
  converterDcConnection?: { converterTrunkDeviceId: string; connectionIndex: number }
}

export type TrikCircuit = {
  id: string
  name?: string
  fixedLetter?: string
  /** TRiK single-phase mark on the breaker (`Fase="L1|L2|L3"`). */
  fase?: 'L1' | 'L2' | 'L3'
  ratingA?: number
  breakingCapacityKa?: number
  protectionType?: ProtectionDevice['type']
  sensitivityMa?: number
  residualCurrentType?: ResidualCurrentType
  polesConfig?: ProtectionDevice['polesConfig']
  poles?: number
  curve?: string
  cableKind?: string
  cableSectionMm2?: number
  cableConductors?: number
  cableHasPe?: boolean
  inTube?: boolean
  nodes: TrikNode[]
  switchControls: Array<{ switchId: string; lightId: string }>
  childCircuitIds: string[]
  trunkDevices?: TrikCircuitTrunkDevice[]
  branchDevices?: TrikBranchDevice[]
  /**
   * Free-text TRiK Nota(s) under this circuit's first leiding.
   * Soft multipanel feed hint when a known panel name appears in the text;
   * topology remains authoritative.
   */
  outboundPanelNotas?: string[]
}

/** Serial fuse (or similar) sitting on a branch between endpoints. */
export type TrikBranchDevice = {
  id: string
  branchKey: string
  symbol: 'fuse'
  ratingA?: number
  label?: string
  notes?: string
}

/** Device on the circuit vertical trunk ahead of endpoint branches. */
export type TrikCircuitTrunkDevice = {
  id: string
  kind: 'transformer' | 'energy_meter' | 'protection' | 'converter'
  label?: string
  /** Converter only: symbol and number of DC outputs (TRiK output leidingen, max 4). */
  converterSymbol?: 'inverter' | 'rectifier' | 'dc_dc_converter'
  dcConnectionCount?: number
  notes?: string
  conversionProps?: TrunkDevice['conversionProps']
  ratingA?: number
  sensitivityMa?: number
  residualCurrentType?: ResidualCurrentType
  polesConfig?: ProtectionDevice['polesConfig']
  poles?: number
  protectionType?: ProtectionDevice['type']
  curve?: 'B' | 'C' | 'D'
  breakingCapacityKa?: number
}

export function normalizeTrikPanelNameKey(name: string | undefined | null): string {
  return (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Find which known panel name appears in free-text Nota copy.
 * Language-agnostic: "Naar Kast 2", "To Kast 2", or just "Kast 2" all match.
 * Prefers the longest match so "Kast 10" wins over "Kast 1".
 */
export function matchTrikPanelNameInText(
  text: string | undefined | null,
  panelNames: Iterable<string>,
): string | undefined {
  const haystack = normalizeTrikPanelNameKey(text)
  if (!haystack) return undefined

  let best: { name: string; len: number } | undefined
  for (const name of panelNames) {
    const needle = normalizeTrikPanelNameKey(name)
    if (needle.length < 1) continue
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Token boundary: not glued to letters/digits (handles "Kast 1" vs "Kast 10").
    const re = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i')
    if (!re.test(haystack)) continue
    if (!best || needle.length > best.len) {
      best = { name, len: needle.length }
    }
  }
  return best?.name
}

/** True when any nota text mentions the given panel name. */
export function trikNotasMentionPanel(
  texts: Iterable<string> | undefined | null,
  panelName: string,
): boolean {
  if (!texts) return false
  for (const text of texts) {
    if (matchTrikPanelNameInText(text, [panelName])) return true
  }
  return false
}

/** One root TRiK `Verdeelbord` that should become a Condui panel. */
export type TrikPanelBoard = {
  /** TRiK element Id when present. */
  trikBoardId: string
  name: string
  /** Present when TRiK set VasteLetter or NaamKring on the board. */
  explicitName?: string
  vasteLetter?: string
  /** True when this board sits on the metered supply spine (ancestor `Teller`). */
  onSupplySpine: boolean
  /** Soft free-text hint from an ancestor Nota that may mention a parent panel name. */
  inboundPanelNota?: string
  circuits: TrikCircuit[]
  /** Feeder breaker immediately above this board (outside the Verdeelbord). */
  incomingFeeder?: TrikCircuit
  /**
   * Panel-local supply devices on the PANEL wire (post-meter isolator/teller inside the
   * board, and/or the incoming feeder AS for subpanels).
   */
  localSupplyDevices?: TrikCircuitTrunkDevice[]
}

export type TrikPlanNode = {
  id: string
  x: number
  y: number
  rotationRad: number
}

export type TrikPoint = { x: number; y: number }
export type TrikWallSource = { p1: TrikPoint; p2: TrikPoint }
export type TrikFigure = {
  width: number
  height: number
  center: TrikPoint
  rotationDeg: number
  imageAsBase64: string
}

export type TrikVectorLine = {
  p1: TrikPoint
  p2: TrikPoint
  strokeWidth: number
  color?: string
}

export type TrikVectorRect = {
  width: number
  height: number
  center: TrikPoint
  rotationDeg: number
  strokeWidth: number
  color?: string
  fillType?: string
}

export const TRIK_TO_PLAN_SCALE = 0.1
export const TRIK_ARC_MAX_SEGMENT_SOURCE_LENGTH = 500 // 0.5m in TRiK mm-like source units
export const TRIK_ARC_MAX_SEGMENT_ANGLE_RAD = Math.PI / 16 // 8 segments per quarter turn
/**
 * Prefer mapping TRiK `<Boog>` to native rational-quadratic curved walls.
 * Set to `'polyline'` to restore the previous chord tessellation fallback.
 */
export type TrikBoogImportMode = 'curved' | 'polyline'
export const TRIK_BOOG_IMPORT_MODE: TrikBoogImportMode = 'curved'
/** Max central angle per rational-quadratic piece (90°). Larger TRiK sweeps are split. */
export const TRIK_ARC_MAX_CURVE_SWEEP_RAD = Math.PI / 2
export const TRIK_PLAN_COMPOSITE_RENDER_SCALE = 2

/** Match default note size when adding a note on eendraad or sitplan (see EendraadCanvas / dropHandlers). */
export const TRIK_NOTA_DEFAULT_FONT_SIZE_PX = 14
/** TRiK schematic notes: one-wire label size so imported free text does not dominate the drawing. */
export const TRIK_ONE_WIRE_NOTA_FONT_SIZE_PX = 9

/**
 * TRiK <Satellites><Nota><Position> offsets are schematic units relative to the host node.
 * Scale to pixels and add to the host endpoint position from {@link calculateBottomUpLayout}
 * (same coordinate space as the one-line diagram, with the panel frame enclosing the board).
 */
export const TRIK_SATELLITE_UNITS_TO_PX = 2.2

export type PendingTrikEendraadNote = {
  panelId: string
  endpointId: string
  text: string
  offsetX: number
  offsetY: number
}

export type TrikSatelliteMark = {
  markId: string
  buddyId: string
  isMain: boolean
  offsetX: number
  offsetY: number
}

export type PendingTrikFrameMarkCorner = {
  panelId: string
  endpointId: string
  markId: string
  buddyId: string
  isMain: boolean
  offsetX: number
  offsetY: number
}

export function parseNumber(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function readElementText(parent: Element | null | undefined, selector: string): string | undefined {
  const value = parent?.querySelector(`:scope > ${selector}`)?.textContent?.trim()
  return value ? value : undefined
}

export function normalizeCountryCode(country: string | undefined): string | undefined {
  if (!country) return undefined
  const normalized = country.trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized === 'belgië' || normalized === 'belgie' || normalized === 'belgium') return 'BE'
  if (normalized === 'nederland' || normalized === 'netherlands') return 'NL'
  if (normalized === 'frankrijk' || normalized === 'france') return 'FR'
  if (normalized === 'duitsland' || normalized === 'germany') return 'DE'
  if (country.length === 2) return country.toUpperCase()
  return country
}

export function parseTrikAddress(addressElement: Element | null | undefined): ProjectAddress | undefined {
  if (!addressElement) return undefined
  const street = readElementText(addressElement, 'Straat') ?? ''
  const number = readElementText(addressElement, 'Nummer')
  const postalCode = readElementText(addressElement, 'Postcode') ?? ''
  const city = readElementText(addressElement, 'Gemeente') ?? ''
  const country = normalizeCountryCode(readElementText(addressElement, 'Land')) ?? ''
  if (!street && !number && !postalCode && !city && !country) return undefined
  return {
    street,
    number,
    postalCode,
    city,
    country,
  }
}

export function parseTrikPartyContact(element: Element | null | undefined): ProjectPartyContact | undefined {
  if (!element) return undefined
  const name = readElementText(element, 'Naam') ?? ''
  const companyNumber = readElementText(element, 'Ondernemingsnummer')
  const email = readElementText(element, 'Email')
  const mobile = readElementText(element, 'Gsm')
  const phone = readElementText(element, 'Telefoon')
  const address = parseTrikAddress(element.querySelector(':scope > Adres'))
  if (!name && !companyNumber && !email && !mobile && !phone && !address) return undefined
  return {
    name,
    companyNumber,
    email,
    mobile,
    phone,
    address,
  }
}

export function parseTrikMetadata(doc: Document): {
  installer?: ProjectPartyContact & { logoDataUrl?: string | null }
  customer?: ProjectCustomerContact
  inspectionAgency?: ProjectPartyContact
  meterEanCode?: string
  installationAddress?: ProjectAddress
} {
  const installerElement = doc.querySelector('Document > Installateur')
  const installer = parseTrikPartyContact(installerElement)
  const installerLogoBase64 = readElementText(installerElement ?? null, 'LogoAsBase64')
  const installerWithLogo = installer
    ? {
      ...installer,
      logoDataUrl: installerLogoBase64 ? `data:image/png;base64,${installerLogoBase64}` : null,
    }
    : undefined

  const customerElement = doc.querySelector('Document > Klant')
  const customerBase = parseTrikPartyContact(customerElement)
  const customerAddress = parseTrikAddress(customerElement?.querySelector(':scope > Adres'))
  const siteAddress = parseTrikAddress(customerElement?.querySelector(':scope > Werfadres'))
  const meterEanCode = customerElement?.getAttribute('EAN')?.trim() || undefined
  const customer = customerBase
    ? {
      ...customerBase,
      meterEanCode,
      address: customerAddress ?? customerBase.address,
      siteAddress,
    }
    : undefined

  const inspectionAgencyElement = doc.querySelector('Document > Controleorganisme')
  const inspectionAgency = parseTrikPartyContact(inspectionAgencyElement)
  const installationAddress = siteAddress ?? customerAddress

  return {
    installer: installerWithLogo,
    customer,
    inspectionAgency,
    meterEanCode,
    installationAddress,
  }
}

export function parseBreakingCapacityKa(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase().replace(',', '.')
  if (!normalized) return undefined
  const numeric = Number(normalized.replace(/[^0-9.+-]/g, ''))
  if (!Number.isFinite(numeric)) return undefined
  if (normalized.includes('ka')) return numeric
  if (normalized.includes('a')) return numeric / 1000
  return numeric >= 100 ? numeric / 1000 : numeric
}

export function parseResidualCurrentType(value: string | null | undefined): ResidualCurrentType | undefined {
  if (!value) return undefined
  const normalized = value.trim().toUpperCase()
  if (normalized.includes('TYPE A') || normalized === 'A') return 'A'
  if (normalized.includes('TYPE AC') || normalized === 'AC') return 'AC'
  if (normalized.includes('TYPE F') || normalized === 'F') return 'F'
  if (normalized.includes('TYPE B') || normalized === 'B') return 'B'
  return undefined
}

export function parsePolesConfig(value: string | null | undefined): ProtectionDevice['polesConfig'] | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized.includes('enkel')) return '1P'
  if (normalized.includes('1+')) return '1P+N'
  if (normalized.includes('twee') || normalized.includes('dubbel') || normalized.includes('2')) return '2P'
  if (normalized.includes('drie') || normalized.includes('3')) return '3P'
  if (normalized.includes('vier') || normalized.includes('4')) return '4P'
  return undefined
}

export function polesFromConfig(config: ProtectionDevice['polesConfig'] | undefined): number | undefined {
  if (!config) return undefined
  if (config === '1P') return 1
  if (config === '1P+N' || config === '2P') return 2
  if (config === '3P') return 3
  if (config === '3P+N' || config === '4P') return 4
  return undefined
}

export function isTrikDraaischakelaarType(element: Element): boolean {
  if (element.tagName !== 'AutomatischeSchakelaar') return false
  return (element.getAttribute('Type') ?? '').trim().toLowerCase() === 'draaischakelaar'
}

export function parseSwitchPoles(element: Element): 1 | 2 | 3 | 4 | undefined {
  const rawPoles = (element.getAttribute('AantalPolen') ?? '').trim().toLowerCase()
  if (!rawPoles) return undefined
  if (rawPoles.includes('vier') || rawPoles.includes('4')) return 4
  if (rawPoles.includes('drie') || rawPoles.includes('trip')) return 3
  if (rawPoles.includes('dubbel') || rawPoles.includes('2')) return 2
  if (rawPoles.includes('enkel') || rawPoles.includes('1')) return 1
  return undefined
}

export function parseTrikBreakerSwitchPoles(element: Element): 1 | 2 | 3 | 4 | undefined {
  const fromSwitchPoles = parseSwitchPoles(element)
  if (fromSwitchPoles) return fromSwitchPoles
  const fromPolesConfig = polesFromConfig(parsePolesConfig(element.getAttribute('AantalPolen')))
  if (fromPolesConfig === 1 || fromPolesConfig === 2 || fromPolesConfig === 3 || fromPolesConfig === 4) {
    return fromPolesConfig
  }
  return undefined
}

export function classifyProtectionType(breaker: Element): ProtectionDevice['type'] {
  if (breaker.tagName === 'Overspanningsbeveiliging') return 'SPD'
  if (isTrikDraaischakelaarType(breaker)) return 'ROTATING_SWITCH'
  if (breaker.tagName === 'Smeltveiligheid') return 'FUSE'
  const hasResidual = parseNumber(breaker.getAttribute('VerliesStroomsterkte')) != null
  const hasOvercurrent = parseNumber(breaker.getAttribute('NominaleStroomsterkte')) != null
  if (hasResidual && hasOvercurrent) return 'RCBO'
  if (hasResidual) return 'RCD'
  return 'MCB'
}

export function isTrikProtectionElement(element: Element): boolean {
  return (
    element.tagName === 'AutomatischeSchakelaar' ||
    element.tagName === 'Smeltveiligheid' ||
    element.tagName === 'Overspanningsbeveiliging'
  )
}

export function parseBooleanJaNee(value: string | null | undefined): boolean | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === 'ja') return true
  if (normalized === 'nee') return false
  return undefined
}

export function indexToCircuitCode(index: number): string {
  let n = index + 1
  let label = ''
  while (n > 0) {
    const remainder = (n - 1) % 26
    label = String.fromCharCode(65 + remainder) + label
    n = Math.floor((n - 1) / 26)
  }
  return label
}

export function roundRotationDeg(rad: number): Rotation {
  const deg = ((rad * 180) / Math.PI + 360) % 360
  const snapped = Math.round(deg / 90) * 90
  const normalized = ((snapped % 360) + 360) % 360
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized
  return 0
}

/** TRiK only exposes a single live phase mark (`L1` / `L2` / `L3`). */
export function parseTrikFase(value: string | null | undefined): 'L1' | 'L2' | 'L3' | undefined {
  const normalized = value?.trim().toUpperCase()
  if (normalized === 'L1' || normalized === 'L2' || normalized === 'L3') return normalized
  return undefined
}

export function parsePoint(element: Element | null): TrikPoint | null {
  if (!element) return null
  const x = parseNumber(element.getAttribute('X'))
  const y = parseNumber(element.getAttribute('Y'))
  if (x == null || y == null) return null
  return { x, y }
}

export function scaledPoint(point: TrikPoint): { x: number; y: number } {
  return { x: point.x * TRIK_TO_PLAN_SCALE, y: point.y * TRIK_TO_PLAN_SCALE }
}

export function normalizeAngleRad(angle: number): number {
  const twoPi = Math.PI * 2
  let normalized = angle % twoPi
  if (normalized < 0) normalized += twoPi
  return normalized
}

export function pointsEqual(a: TrikPoint, b: TrikPoint, epsilon = 1e-3): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon
}

export function parseJaNeeBoolean(value: string | null | undefined): boolean | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === 'ja') return true
  if (normalized === 'nee') return false
  return undefined
}
