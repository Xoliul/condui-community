import { selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
/**
 * Build hardware tally from project: group devices by category and by properties
 * (protection, energy meters, energy conversion / solar / battery / AC–DC, sockets, switches, …).
 * Supply wire devices are marked so UI can show them as preinstalled/unchangeable.
 */

import { polesConfigToDisplay, configFromPoles } from '@/constants/poleConfig'
import { initializeBranchesIfNeeded } from '@/lib/layout/endpointChains'
import { calculateBottomUpLayout } from '@/lib/layout/bottomUpLayout'
import { buildLayoutTree } from '@/lib/layout/layoutTree'
import { deriveWires } from '@/lib/layout/deriveWires'
import {
  formatWireLengthMeters,
  formatWireTallySummaryLabel,
  isHardwareTallyWireSegment,
  wireSegmentFingerprint,
  type WireTranslateFn,
} from '@/lib/wires/wireFingerprint'
import type {
  Panel,
  Circuit,
  ProtectionDevice,
  Endpoint,
  TrunkDevice,
  EnergyConversionDeviceProps,
  WireSegment,
} from '@/types/schema'
import { getAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { collectAllGroundTrunkDevices } from '@/lib/eendraad/panelGround'
import { trunkDeviceCountsAsProtection } from '@/lib/protectionKind'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { Selection } from '@/types/ui'

/** Selection payload to select this item in the app */
export type TallyDetailSelection = Pick<Selection, 'type' | 'ids' | 'wireMetadata'>

/** Single detail row when a group is expanded (e.g. label for MCB, branch/circuit for endpoint) */
export interface TallyDetail {
  label: string
  /** Branch label or circuit code for endpoints */
  branchOrCircuit?: string
  /** Panel name (e.g. "Main panel") */
  panelName?: string
  /** Path within installation (e.g. "Main panel > RCD1 > A > A1") */
  subcircuitPath?: string
  /** Call setSelection with this to select the symbol in the canvas */
  selection?: TallyDetailSelection
}

/** One grouped line: e.g. "16A 2P MCB" with count and optional supply marking */
export interface TallyGroup {
  summaryLabel: string
  count: number
  details: TallyDetail[]
  /** True if any item is on the supply wire (preinstalled/unchangeable) */
  hasSupply: boolean
  /** Total wire length in meters for this group (when lengths were entered). */
  totalLengthM?: number
  /**
   * When set, expanded tally UI shows an “Options” heading and these lines only
   * (no repeat of the row title / base device name).
   */
  specLines?: string[]
}

/** One category (Protection devices, Sockets, etc.) with collapsible groups */
export interface TallyCategory {
  id: string
  labelKey: string
  totalDevices: number
  typeCount: number
  groups: TallyGroup[]
}

export type TallyData = TallyCategory[]

type TallyProject = ProjectWithOptionalV2Electrical

function deriveProjectWireSegments(project: TallyProject): WireSegment[] {
  try {
    const panels = getProjectElectricalPanels(project)
    const installation = getProjectElectricalInstallation(project)
    if (!installation) return []
    const layout = calculateBottomUpLayout(project, new Map())
    const tree = buildLayoutTree(layout)
    return deriveWires(tree, panels, installation, [], undefined, selectProjectWireRuns(project))
  } catch {
    return []
  }
}

function wireSegmentDetailLabel(segment: WireSegment, t: WireTranslateFn): string {
  if (
    segment.isSupplyTrunk ||
    (segment.type === 'vertical' && !segment.circuitId && !segment.fromElementType)
  ) {
    const role = segment.supplyWireRole
    if (role === 'upstream') return t('wires.supplySegmentUpstream', 'Supply side (to separator)')
    if (role === 'crossing') return t('wires.supplySegmentCrossing', 'Panel boundary')
    if (role === 'downstream') return t('wires.supplySegmentDownstream', 'Main panel (to bus)')
    return t('tally.supplyPathSegment', 'Supply')
  }
  if (segment.fromElementType === 'ground') return t('tally.groundPathSegment', 'Ground')
  if (segment.circuitId) return segment.circuitId
  return segment.id
}

/** Match the wire-selection payload created when the same segments are clicked on the canvas. */
function wireSegmentsSelection(segments: WireSegment[]): TallyDetailSelection {
  return {
    type: 'wire',
    ids: segments.map((segment) => segment.id),
    wireMetadata: segments.map((segment) => ({
      id: segment.id,
        type: segment.type === 'secondaryBus' ? 'mainBus' : segment.type,
        domain: segment.domain,
        circuitId: segment.circuitId,
        panelId: segment.panelId,
        isSupply:
          (segment.type === 'vertical' && !segment.circuitId && !segment.fromElementType) ||
          Boolean(segment.isSupplyTrunk),
        isGround: segment.fromElementType === 'ground',
        ...(segment.supplyWireRole && { supplyWireRole: segment.supplyWireRole }),
        ...(segment.supplyFeedScope && { supplyFeedScope: segment.supplyFeedScope }),
        ...(segment.supplyAssemblyId && { supplyAssemblyId: segment.supplyAssemblyId }),
        ...(segment.supplyConnectionId && { supplyConnectionId: segment.supplyConnectionId }),
        ...(segment.supplySectionKey && { supplySectionKey: segment.supplySectionKey }),
        ...(segment.isSupplyTrunk &&
          segment.supplySegmentIndex !== undefined && {
            supplySegmentIndex: segment.supplySegmentIndex,
          }),
        ...(segment.circuitId && {
          fromElementType: segment.fromElementType,
          fromElementId: segment.fromElementId,
          toElementType: segment.toElementType,
          toElementId: segment.toElementId,
        }),
        ...(segment.feederProtectionId && { feederProtectionId: segment.feederProtectionId }),
        ...(segment.showWireLabelOnBusStub && { showWireLabelOnBusStub: true as const }),
        ...(segment.domoticaOutputGroup &&
          typeof segment.domoticaOutputIndex === 'number' && {
            domoticaOutputGroup: segment.domoticaOutputGroup,
            domoticaOutputIndex: segment.domoticaOutputIndex,
          }),
    })),
  }
}

type CircuitOwner = { circuit: Circuit; panel: Panel }

function circuitOwnerKey(panelId: string, circuitId: string): string {
  return `${panelId}:${circuitId}`
}

function getCircuitOwners(panels: Panel[]): Map<string, CircuitOwner> {
  const owners = new Map<string, CircuitOwner>()
  for (const panel of panels) {
    for (const { circuit } of getAllCircuits(panel)) {
      owners.set(circuitOwnerKey(panel.id, circuit.id), { circuit, panel })
    }
  }
  return owners
}

function uniqueEnteredWireLength(segments: WireSegment[]): number | undefined {
  const lengths = new Set(
    segments
      .map((segment) => segment.wireLengthM)
      .filter((length): length is number => length != null && length > 0)
      .map((length) => Math.round(length * 1000) / 1000)
  )
  if (lengths.size === 0) return undefined
  return [...lengths].reduce((total, length) => total + length, 0)
}

const STOVE_LABEL_PATTERN = /stove|fornuis|cuisinière|cooker|four\s*intégré/i

function getAllPanelsRecursive(panels: Panel[]): Panel[] {
  const out: Panel[] = []
  for (const p of panels) {
    out.push(p)
    if (p.subPanels?.length) out.push(...getAllPanelsRecursive(p.subPanels))
  }
  return out
}

function getAllCircuits(
  panel: Panel
): Array<{ circuit: Circuit; protectionLabel?: string; panel: Panel }> {
  const out: Array<{ circuit: Circuit; protectionLabel?: string; panel: Panel }> = []
  for (const c of panel.circuits ?? []) {
    out.push({ circuit: c, panel })
  }
  for (const pr of panel.protections ?? []) {
    for (const c of pr.circuits ?? []) {
      out.push({ circuit: c, protectionLabel: pr.label, panel })
    }
  }
  return out
}

/** All circuits in the project (flat) for parent lookups */
function getAllCircuitsFlat(panels: Panel[]): Circuit[] {
  const out: Circuit[] = []
  for (const panel of panels) {
    for (const c of panel.circuits ?? []) {
      out.push(c)
    }
    for (const pr of panel.protections ?? []) {
      for (const c of pr.circuits ?? []) {
        out.push(c)
      }
    }
  }
  return out
}

/** Find the parent circuit id whose subCircuitIds contains the given circuit id */
function getParentCircuitId(circuits: Circuit[], circuitId: string): string | undefined {
  for (const c of circuits) {
    if (c.subCircuitIds?.includes(circuitId)) return c.id
  }
  return undefined
}

/** Path from root circuit to leaf (by code), e.g. ['A', 'B'] for circuit B under A */
function getCircuitPathFromRoot(panels: Panel[], circuitId: string): string[] {
  const circuits = getAllCircuitsFlat(panels)
  const byId = new Map(circuits.map((c) => [c.id, c]))
  const path: string[] = []
  let currentId: string | undefined = circuitId
  while (currentId) {
    const circuit = byId.get(currentId)
    if (!circuit) break
    path.push(circuit.code)
    currentId = getParentCircuitId(circuits, currentId)
  }
  return path.reverse()
}

function getBranchLabelForEndpoint(circuit: Circuit, endpointId: string): string {
  const branches = initializeBranchesIfNeeded(circuit)
  const branch = branches.find((b) => b.endpointIds.includes(endpointId))
  return branch?.label || circuit.code || ''
}

function getMainPanelName(panels: Panel[]): string {
  for (const p of panels) {
    if (p.isMain) return p.name
    const inSub = getMainPanelName(p.subPanels ?? [])
    if (inSub) return inSub
  }
  return panels[0]?.name ?? ''
}

function buildPathWithSubcircuits(
  panelName: string,
  protectionLabel: string | undefined,
  circuitPathFromRoot: string[],
  branchLabel: string | undefined,
  t: (key: string, fallback?: string) => string
): string {
  const directLabel = t('tally.directCircuit', 'Direct')
  const parts = [panelName, protectionLabel ?? directLabel, ...circuitPathFromRoot]
  if (branchLabel) parts.push(branchLabel)
  return parts.join(' > ')
}

function protectionGroupKey(pr: ProtectionDevice | TrunkDevice): string {
  const type = 'protectionType' in pr ? pr.protectionType : (pr as ProtectionDevice).type
  const rating = pr.ratingA != null ? `${pr.ratingA}A` : ''
  const curve = pr.curve ?? ''
  const sens = pr.sensitivityMa != null ? `${pr.sensitivityMa}mA` : ''
  const res = pr.residualCurrentType ?? ''
  const breakCap = pr.breakingCapacityKa != null ? `${pr.breakingCapacityKa}kA` : ''
  const poles = pr.polesConfig ?? ''
  return [type, rating, curve, sens, res, breakCap, poles].filter(Boolean).join('|')
}

function protectionSummaryLabel(
  pr: ProtectionDevice | TrunkDevice,
  t: (key: string) => string
): string {
  const type = ('protectionType' in pr ? pr.protectionType : (pr as ProtectionDevice).type) ?? 'MCB'
  const parts: string[] = []
  if (pr.ratingA != null) parts.push(`${pr.ratingA}A`)
  if (pr.polesConfig) parts.push(polesConfigToDisplay(pr.polesConfig) || pr.polesConfig)
  if (pr.curve) parts.push(pr.curve)
  if (pr.sensitivityMa != null) parts.push(`IΔn ${pr.sensitivityMa}mA`)
  if (pr.residualCurrentType) parts.push(pr.residualCurrentType)
  if (pr.breakingCapacityKa != null) parts.push(`${pr.breakingCapacityKa}kA`)
  const spec = parts.length ? ` ${parts.join(' ')}` : ''
  const typeLabel = t(`symbols.${type.toLowerCase()}`) || type
  return `${typeLabel}${spec}`.trim()
}

function socketGroupKey(ep: Endpoint): string {
  const sym = ep.symbol ?? 'socket'
  const sp = ep.socketProps
  const a = sp?.switchOverlay ? 'sw' : ''
  const b = sp?.switchOverlayLock ? 'lock' : ''
  const c = sp?.waterproof ? 'wp' : ''
  const d = sp?.socketCount ?? 1
  return [sym, a, b, c, d].join('|')
}

function socketSummaryLabel(ep: Endpoint, t: (key: string) => string): string {
  const sym = ep.symbol ?? 'socket'
  const base = t(`symbols.${sym}`) || sym
  const parts: string[] = []
  const sp = ep.socketProps
  if (sp?.socketCount && sp.socketCount > 1) parts.push(`${sp.socketCount}×`)
  if (sp?.switchOverlayLock) parts.push(t('tally.socketOptionTwoPoleSwitchLock'))
  else if (sp?.switchOverlay) parts.push(t('tally.socketOptionTwoPoleSwitch'))
  if (sp?.waterproof) parts.push(t('endpoints.socketWaterproof') || 'waterproof')
  return parts.length ? `${base} (${parts.join(', ')})` : base
}

function switchGroupKey(ep: Endpoint): string {
  const sym = ep.symbol ?? 'switch'
  const sp = ep.switchProps
  const poles = sp?.poles ?? 1
  const twoPole = sp?.twoPole ? '2p' : ''
  const v = sp?.verklikkerlamp ? 'v' : ''
  const smokeType = sym === 'smoke_detector' ? (ep.smokeDetectorProps?.type ?? 'smoke') : ''
  const motionType = sym === 'motion_detector' ? (ep.motionDetectorProps?.type ?? 'spread') : ''
  return [sym, poles, twoPole, v, smokeType, motionType].join('|')
}

function switchSummaryLabel(ep: Endpoint, t: (key: string) => string): string {
  const sym = ep.symbol ?? 'switch'
  const base = t(`symbols.${sym}`) || sym
  const sp = ep.switchProps
  const parts: string[] = []
  if (sp?.poles && sp.poles > 1) parts.push(`${sp.poles}P`)
  if (sym === 'switch_1p_twoway' && sp?.twoPole) {
    parts.push(t('symbols.switch_2p_twoway') || '2P')
  }
  if (sp?.verklikkerlamp) parts.push(t('endpoints.verklikkerlamp') || 'indicator')
  if (sym === 'smoke_detector') {
    const type = ep.smokeDetectorProps?.type ?? 'smoke'
    if (type !== 'smoke') {
      parts.push(t(`endpoints.smokeDetector.type_${type}`) || type)
    }
  }
  if (sym === 'motion_detector') {
    const type = ep.motionDetectorProps?.type ?? 'spread'
    if (type !== 'spread') {
      parts.push(t(`endpoints.motionDetector.type_${type}`) || type)
    }
  }
  return parts.length ? `${base} (${parts.join(', ')})` : base
}

/** Option-only lines for expanded tally (row title already names the device type). */
function buildSocketSpecLines(ep: Endpoint, t: WireTranslateFn): string[] | undefined {
  const sp = ep.socketProps
  const lines: string[] = []
  const count = sp?.socketCount ?? 1
  if (count > 1) {
    lines.push(t('tally.specSocketOutletCount', { count }))
  }
  if (sp?.switchOverlayLock) {
    lines.push(t('tally.socketOptionTwoPoleSwitchLock'))
  } else if (sp?.switchOverlay) {
    lines.push(t('tally.socketOptionTwoPoleSwitch'))
  }
  if (sp?.waterproof) {
    lines.push(t('endpoints.socketWaterproof'))
  }
  return lines.length ? lines : undefined
}

function buildSwitchSpecLines(
  ep: Endpoint,
  t: (key: string, fallback?: string) => string
): string[] | undefined {
  const sym = ep.symbol ?? 'switch'
  const sp = ep.switchProps
  const lines: string[] = []
  const poles = sp?.poles ?? 1
  if (poles === 2) {
    lines.push(t('endpoints.switchPoles2'))
  } else if (poles === 3) {
    lines.push(t('endpoints.switchPoles3'))
  }
  if (sym === 'switch_1p_twoway' && sp?.twoPole) {
    lines.push(t('symbols.switch_2p_twoway'))
  }
  if (sp?.verklikkerlamp) {
    lines.push(t('endpoints.verklikkerlamp'))
  }
  if (sym === 'smoke_detector') {
    const smokeLines = buildSmokeDetectorSpecLines(ep, t)
    if (smokeLines) lines.push(...smokeLines)
  }
  if (sym === 'motion_detector') {
    const type = ep.motionDetectorProps?.type ?? 'spread'
    if (type !== 'spread') {
      lines.push(t(`endpoints.motionDetector.type_${type}`))
    }
  }
  return lines.length ? lines : undefined
}

function buildRelaySpecLines(
  ep: Endpoint,
  t: (key: string, fallback?: string) => string
): string[] | undefined {
  const rp = ep.relayProps
  if (!rp) return undefined
  const lines: string[] = []
  if (rp.maxCurrentRatingA != null) {
    lines.push(`${t('endpoints.relay.maxCurrentRating')}: ${rp.maxCurrentRatingA} A`)
  }
  if (rp.poles != null && rp.poles > 0) {
    lines.push(`${t('endpoints.relay.poles')}: ${rp.poles}`)
  }
  if (rp.control) {
    lines.push(t(`endpoints.relay.control_${rp.control}`))
  }
  return lines.length ? lines : undefined
}

function buildSmokeDetectorSpecLines(
  ep: Endpoint,
  t: (key: string, fallback?: string) => string
): string[] | undefined {
  const type = ep.smokeDetectorProps?.type ?? 'smoke'
  if (type === 'smoke') return undefined
  return [t(`endpoints.smokeDetector.type_${type}`)]
}

function isStoveEndpoint(ep: Endpoint): boolean {
  if (ep.type !== 'fixed_appliance') return false
  if (ep.symbol === 'stove') return true
  return STOVE_LABEL_PATTERN.test(ep.label || '')
}

function energyMeterGroupKey(d: TrunkDevice): string {
  const polesConfig =
    d.polesConfig ??
    d.energyMeterProps?.polesConfig ??
    (d.poles != null ? configFromPoles(d.poles) : null) ??
    (d.energyMeterProps?.poles != null ? configFromPoles(d.energyMeterProps.poles) : null) ??
    ''
  return `energy_meter|${polesConfig}`
}

function energyMeterSummaryLabel(d: TrunkDevice, t: (key: string) => string): string {
  const base = t('symbols.energy_meter') || 'Energy meter'
  const polesConfig =
    d.polesConfig ??
    d.energyMeterProps?.polesConfig ??
    ((d.poles != null ? configFromPoles(d.poles) : '') ||
      (d.energyMeterProps?.poles != null ? configFromPoles(d.energyMeterProps.poles) : ''))
  const polesStr = polesConfig ? ` ${polesConfigToDisplay(polesConfig) || polesConfig}` : ''
  return `${base}${polesStr}`.trim()
}

const ENERGY_CONVERSION_ENDPOINT_SYMBOLS = new Set([
  'solar_panel',
  'battery',
  'transformer',
  'rectifier',
  'inverter',
  'dc_dc_converter',
])

function isEnergyConversionEndpoint(ep: Endpoint): boolean {
  return ep.symbol != null && ENERGY_CONVERSION_ENDPOINT_SYMBOLS.has(ep.symbol)
}

function energyConversionPropsKey(p?: EnergyConversionDeviceProps): string {
  if (!p) return ''
  return [
    p.transformerSafetyType ?? '',
    p.transformerShortCircuitProtected ? '1' : '',
    p.transformerProtected ? '1' : '',
    p.transformerOverlayLabel ?? '',
    p.pMaxPrimaryW ?? '',
    p.pMaxSecondaryW ?? '',
  ].join('\x1f')
}

function energyConversionEndpointGroupKey(ep: Endpoint): string {
  const sym = ep.symbol ?? ''
  if (sym === 'solar_panel') {
    const sp = ep.solarPanelProps
    return `ep|solar_panel|${sp?.wattageW ?? ''}|${sp?.voltageV ?? ''}`
  }
  if (sym === 'battery') {
    const bp = ep.batteryProps
    return `ep|battery|${bp?.voltageV ?? ''}|${bp?.capacityKWh ?? ''}`
  }
  return `ep|${sym}|${energyConversionPropsKey(ep.energyConversionProps)}`
}

function energyConversionTrunkGroupKey(d: TrunkDevice): string {
  return `tr|${d.symbol}|${energyConversionPropsKey(d.conversionProps)}`
}

function conversionSymbolLabel(sym: string, t: (key: string) => string): string {
  return t(`symbols.${sym}`) || sym
}

function energyConversionEndpointSummaryParts(ep: Endpoint, t: (key: string) => string): string[] {
  const sym = ep.symbol ?? ''
  const parts: string[] = []
  if (sym === 'solar_panel') {
    const sp = ep.solarPanelProps
    if (sp?.wattageW != null) parts.push(`${sp.wattageW} Wp`)
    if (sp?.voltageV != null) parts.push(`${sp.voltageV} V`)
    return parts
  }
  if (sym === 'battery') {
    const bp = ep.batteryProps
    if (bp?.voltageV != null) parts.push(`${bp.voltageV} V`)
    if (bp?.capacityKWh != null) parts.push(`${bp.capacityKWh} kWh`)
    return parts
  }
  const p = ep.energyConversionProps
  if (sym === 'transformer' && p?.transformerSafetyType && p.transformerSafetyType !== 'none') {
    parts.push(
      p.transformerSafetyType === 'safety_closed'
        ? t('endpoints.transformer.safety_closed_short')
        : t('endpoints.transformer.safety_open_short')
    )
  }
  if (p?.transformerShortCircuitProtected)
    parts.push(t('endpoints.transformer.shortCircuitProtected'))
  if (p?.transformerProtected) parts.push(t('endpoints.transformer.protective'))
  if (p?.transformerOverlayLabel?.trim()) parts.push(p.transformerOverlayLabel.trim())
  if (p?.pMaxPrimaryW?.trim())
    parts.push(`${t('endpoints.conversion.pMaxPrimary')} ${p.pMaxPrimaryW.trim()}`)
  if (p?.pMaxSecondaryW?.trim())
    parts.push(`${t('endpoints.conversion.pMaxSecondary')} ${p.pMaxSecondaryW.trim()}`)
  return parts
}

function energyConversionEndpointSummaryLabel(ep: Endpoint, t: (key: string) => string): string {
  const base = conversionSymbolLabel(ep.symbol ?? '', t)
  const parts = energyConversionEndpointSummaryParts(ep, t)
  return parts.length ? `${base} (${parts.join(' · ')})` : base
}

function energyConversionTrunkSummaryParts(d: TrunkDevice, t: (key: string) => string): string[] {
  const parts: string[] = []
  const p = d.conversionProps
  const sym = d.symbol
  if (sym === 'transformer' && p?.transformerSafetyType && p.transformerSafetyType !== 'none') {
    parts.push(
      p.transformerSafetyType === 'safety_closed'
        ? t('endpoints.transformer.safety_closed_short')
        : t('endpoints.transformer.safety_open_short')
    )
  }
  if (p?.transformerShortCircuitProtected)
    parts.push(t('endpoints.transformer.shortCircuitProtected'))
  if (p?.transformerProtected) parts.push(t('endpoints.transformer.protective'))
  if (p?.transformerOverlayLabel?.trim()) parts.push(p.transformerOverlayLabel.trim())
  if (p?.pMaxPrimaryW?.trim())
    parts.push(`${t('endpoints.conversion.pMaxPrimary')} ${p.pMaxPrimaryW.trim()}`)
  if (p?.pMaxSecondaryW?.trim())
    parts.push(`${t('endpoints.conversion.pMaxSecondary')} ${p.pMaxSecondaryW.trim()}`)
  return parts
}

function energyConversionTrunkSummaryLabel(d: TrunkDevice, t: (key: string) => string): string {
  const base = conversionSymbolLabel(d.symbol, t)
  const parts = energyConversionTrunkSummaryParts(d, t)
  return parts.length ? `${base} (${parts.join(' · ')})` : base
}

function buildEnergyConversionPropsSpecLines(
  p: EnergyConversionDeviceProps | undefined,
  symbol: string,
  t: (key: string, fallback?: string) => string
): string[] {
  const lines: string[] = []
  if (!p) return lines
  if (symbol === 'transformer') {
    if (p.transformerSafetyType && p.transformerSafetyType !== 'none') {
      const sk =
        p.transformerSafetyType === 'safety_closed'
          ? 'endpoints.transformer.safety_closed_short'
          : 'endpoints.transformer.safety_open_short'
      lines.push(`${t('endpoints.transformer.safetyType')}: ${t(sk)}`)
    }
    if (p.transformerShortCircuitProtected)
      lines.push(t('endpoints.transformer.shortCircuitProtected'))
    if (p.transformerProtected) lines.push(t('endpoints.transformer.protective'))
  }
  if (p.transformerOverlayLabel?.trim()) {
    lines.push(`${t('endpoints.transformer.overlayLabel')}: ${p.transformerOverlayLabel.trim()}`)
  }
  if (p.pMaxPrimaryW?.trim())
    lines.push(`${t('endpoints.conversion.pMaxPrimary')}: ${p.pMaxPrimaryW.trim()}`)
  if (p.pMaxSecondaryW?.trim())
    lines.push(`${t('endpoints.conversion.pMaxSecondary')}: ${p.pMaxSecondaryW.trim()}`)
  return lines
}

function buildEnergyConversionEndpointSpecLines(
  ep: Endpoint,
  t: (key: string, fallback?: string) => string
): string[] | undefined {
  const sym = ep.symbol ?? ''
  const lines: string[] = []
  if (sym === 'solar_panel') {
    const sp = ep.solarPanelProps
    if (sp?.wattageW != null) lines.push(`${t('endpoints.solarPanel.wattage')}: ${sp.wattageW}`)
    if (sp?.voltageV != null) lines.push(`${t('endpoints.solarPanel.voltage')}: ${sp.voltageV}`)
  } else if (sym === 'battery') {
    const bp = ep.batteryProps
    if (bp?.voltageV != null) lines.push(`${t('endpoints.battery.voltage')}: ${bp.voltageV}`)
    if (bp?.capacityKWh != null) lines.push(`${t('endpoints.battery.capacity')}: ${bp.capacityKWh}`)
  } else {
    lines.push(...buildEnergyConversionPropsSpecLines(ep.energyConversionProps, sym, t))
  }
  return lines.length ? lines : undefined
}

function buildEnergyConversionTrunkSpecLines(
  d: TrunkDevice,
  t: (key: string, fallback?: string) => string
): string[] | undefined {
  const lines = buildEnergyConversionPropsSpecLines(d.conversionProps, d.symbol, t)
  return lines.length ? lines : undefined
}

/** Build full hardware tally from project. t() is i18n t function for symbol/option labels. */
export function buildHardwareTally(
  project: TallyProject | null,
  t: WireTranslateFn
): TallyData {
  if (!project) return []

  const rootPanels = getProjectElectricalPanels(project)
  const panels = getAllPanelsRecursive(rootPanels)
  const mainPanelName = getMainPanelName(rootPanels)
  const installation = getProjectElectricalInstallation(project)

  const categories: TallyCategory[] = []

  // --- Protection devices (panel + supply) ---
  const protectionMap = new Map<
    string,
    { details: TallyDetail[]; hasSupply: boolean; representative: ProtectionDevice | TrunkDevice }
  >()
  function addProtection(pr: ProtectionDevice | TrunkDevice, isSupply: boolean, panel?: Panel) {
    const key = protectionGroupKey(pr)
    const existing = protectionMap.get(key)
    const label = pr.label || ''
    const panelName = panel?.name ?? mainPanelName
    const subcircuitPath = isSupply ? `${mainPanelName} > Supply` : `${panelName} > ${label}`
    const selection: TallyDetailSelection = isSupply
      ? { type: 'trunkDevice', ids: [pr.id] }
      : { type: 'protection', ids: [pr.id] }
    const detail: TallyDetail = {
      label,
      panelName,
      subcircuitPath,
      selection,
    }
    if (existing) {
      existing.details.push(detail)
      if (isSupply) existing.hasSupply = true
    } else {
      protectionMap.set(key, { details: [detail], hasSupply: isSupply, representative: pr })
    }
  }
  for (const panel of panels) {
    for (const pr of panel.protections ?? []) {
      addProtection(pr, false, panel)
    }
  }
  for (const d of getAllSupplyTrunkDevices(project)) {
    if (trunkDeviceCountsAsProtection(d)) {
      addProtection(d as TrunkDevice, true)
    }
  }
  if (protectionMap.size > 0) {
    const groups: TallyGroup[] = []
    for (const [, { details, hasSupply, representative }] of protectionMap) {
      const summaryLabel = protectionSummaryLabel(representative, t)
      groups.push({
        summaryLabel,
        count: details.length,
        details,
        hasSupply,
      })
    }
    const total = groups.reduce((s, g) => s + g.count, 0)
    categories.push({
      id: 'protection',
      labelKey: 'tally.categoryProtection',
      totalDevices: total,
      typeCount: groups.length,
      groups,
    })
  }

  // --- Energy meters (supply trunk + circuit trunk) ---
  const energyMeterMap = new Map<
    string,
    { details: TallyDetail[]; hasSupply: boolean; representative: TrunkDevice }
  >()
  for (const d of getAllSupplyTrunkDevices(project)) {
    if (d.type !== 'energy_meter') continue
    const key = energyMeterGroupKey(d)
    const detail: TallyDetail = {
      label: d.label || '',
      panelName: mainPanelName,
      subcircuitPath: `${mainPanelName} > Supply`,
      selection: { type: 'trunkDevice', ids: [d.id] },
    }
    const existing = energyMeterMap.get(key)
    if (existing) {
      existing.details.push(detail)
      existing.hasSupply = true
    } else {
      energyMeterMap.set(key, { details: [detail], hasSupply: true, representative: d })
    }
  }
  for (const panel of panels) {
    for (const { circuit, protectionLabel } of getAllCircuits(panel)) {
      for (const d of circuit.trunkDevices ?? []) {
        if (d.type !== 'energy_meter') continue
        const key = energyMeterGroupKey(d)
        const path = buildPathWithSubcircuits(
          panel.name,
          protectionLabel,
          getCircuitPathFromRoot(panels, circuit.id),
          undefined,
          t
        )
        const detail: TallyDetail = {
          label: d.label || circuit.code,
          panelName: panel.name,
          subcircuitPath: path,
          selection: { type: 'trunkDevice', ids: [d.id] },
        }
        const existing = energyMeterMap.get(key)
        if (existing) {
          existing.details.push(detail)
        } else {
          energyMeterMap.set(key, { details: [detail], hasSupply: false, representative: d })
        }
      }
    }
  }
  if (energyMeterMap.size > 0) {
    const groups: TallyGroup[] = []
    for (const [, { details, hasSupply, representative }] of energyMeterMap) {
      groups.push({
        summaryLabel: energyMeterSummaryLabel(representative, t),
        count: details.length,
        details,
        hasSupply,
      })
    }
    const total = groups.reduce((s, g) => s + g.count, 0)
    categories.push({
      id: 'energyMeters',
      labelKey: 'tally.categoryEnergyMeters',
      totalDevices: total,
      typeCount: groups.length,
      groups,
    })
  }

  // --- Energy conversion: solar, battery, AC/DC (circuit endpoints + conversion trunk devices) ---
  const energyConversionMap = new Map<
    string,
    { details: TallyDetail[]; summaryLabel: string; specLines?: string[]; hasSupply: boolean }
  >()
  function pushEnergyConversion(
    key: string,
    detail: TallyDetail,
    summaryLabel: string,
    specLines: string[] | undefined,
    isSupplyTrunk: boolean
  ) {
    const existing = energyConversionMap.get(key)
    if (existing) {
      existing.details.push(detail)
      if (isSupplyTrunk) existing.hasSupply = true
    } else {
      energyConversionMap.set(key, {
        details: [detail],
        summaryLabel,
        specLines,
        hasSupply: isSupplyTrunk,
      })
    }
  }

  const supplyPathSeg = t('tally.supplyPathSegment', 'Supply')
  const groundPathSeg = t('tally.groundPathSegment', 'Ground')

  for (const panel of panels) {
    for (const { circuit, protectionLabel } of getAllCircuits(panel)) {
      for (const ep of circuit.endpoints ?? []) {
        if (!isEnergyConversionEndpoint(ep)) continue
        const key = energyConversionEndpointGroupKey(ep)
        const branchLabel = getBranchLabelForEndpoint(circuit, ep.id)
        const summaryLabel = energyConversionEndpointSummaryLabel(ep, t)
        const specLines = buildEnergyConversionEndpointSpecLines(ep, t)
        const detail: TallyDetail = {
          label: ep.label || branchLabel,
          branchOrCircuit: branchLabel,
          panelName: panel.name,
          subcircuitPath: buildPathWithSubcircuits(
            panel.name,
            protectionLabel,
            getCircuitPathFromRoot(panels, circuit.id),
            branchLabel,
            t
          ),
          selection: { type: 'endpoint', ids: [ep.id] },
        }
        pushEnergyConversion(key, detail, summaryLabel, specLines, false)
      }
    }
  }

  for (const d of getAllSupplyTrunkDevices(project)) {
    if (d.type !== 'conversion') continue
    const key = energyConversionTrunkGroupKey(d)
    const summaryLabel = energyConversionTrunkSummaryLabel(d, t)
    const specLines = buildEnergyConversionTrunkSpecLines(d, t)
    const detail: TallyDetail = {
      label: d.label || '',
      panelName: mainPanelName,
      subcircuitPath: `${mainPanelName} > ${supplyPathSeg}`,
      selection: { type: 'trunkDevice', ids: [d.id] },
    }
    pushEnergyConversion(key, detail, summaryLabel, specLines, true)
  }

  for (const d of collectAllGroundTrunkDevices(rootPanels, installation)) {
    if (d.type !== 'conversion') continue
    const key = energyConversionTrunkGroupKey(d)
    const summaryLabel = energyConversionTrunkSummaryLabel(d, t)
    const specLines = buildEnergyConversionTrunkSpecLines(d, t)
    const detail: TallyDetail = {
      label: d.label || '',
      panelName: mainPanelName,
      subcircuitPath: `${mainPanelName} > ${groundPathSeg}`,
      selection: { type: 'trunkDevice', ids: [d.id] },
    }
    pushEnergyConversion(key, detail, summaryLabel, specLines, false)
  }

  for (const panel of panels) {
    for (const { circuit, protectionLabel } of getAllCircuits(panel)) {
      for (const d of circuit.trunkDevices ?? []) {
        if (d.type !== 'conversion') continue
        const key = energyConversionTrunkGroupKey(d)
        const summaryLabel = energyConversionTrunkSummaryLabel(d, t)
        const specLines = buildEnergyConversionTrunkSpecLines(d, t)
        const path = buildPathWithSubcircuits(
          panel.name,
          protectionLabel,
          getCircuitPathFromRoot(panels, circuit.id),
          undefined,
          t
        )
        const detail: TallyDetail = {
          label: d.label || circuit.code,
          panelName: panel.name,
          subcircuitPath: path,
          selection: { type: 'trunkDevice', ids: [d.id] },
        }
        pushEnergyConversion(key, detail, summaryLabel, specLines, false)
      }
    }
  }

  if (energyConversionMap.size > 0) {
    const groups: TallyGroup[] = []
    for (const [, { details, summaryLabel, specLines, hasSupply }] of energyConversionMap) {
      groups.push({
        summaryLabel,
        count: details.length,
        details,
        hasSupply,
        specLines,
      })
    }
    groups.sort((a, b) => a.summaryLabel.localeCompare(b.summaryLabel))
    const total = groups.reduce((s, g) => s + g.count, 0)
    categories.push({
      id: 'energyConversion',
      labelKey: 'endpoints.energyConversion.groupTitle',
      totalDevices: total,
      typeCount: groups.length,
      groups,
    })
  }

  // --- Sockets ---
  const socketMap = new Map<
    string,
    { details: TallyDetail[]; summaryLabel: string; representative: Endpoint }
  >()
  for (const panel of panels) {
    for (const { circuit, protectionLabel } of getAllCircuits(panel)) {
      for (const ep of circuit.endpoints ?? []) {
        if (ep.type !== 'socket') continue
        const key = socketGroupKey(ep)
        const branchLabel = getBranchLabelForEndpoint(circuit, ep.id)
        const existing = socketMap.get(key)
        const summaryLabel = socketSummaryLabel(ep, t)
        const detail: TallyDetail = {
          label: ep.label || branchLabel,
          branchOrCircuit: branchLabel,
          panelName: panel.name,
          subcircuitPath: buildPathWithSubcircuits(
            panel.name,
            protectionLabel,
            getCircuitPathFromRoot(panels, circuit.id),
            branchLabel,
            t
          ),
          selection: { type: 'endpoint', ids: [ep.id] },
        }
        if (existing) {
          existing.details.push(detail)
        } else {
          socketMap.set(key, { details: [detail], summaryLabel, representative: ep })
        }
      }
    }
  }
  if (socketMap.size > 0) {
    const groups: TallyGroup[] = []
    for (const [, { details, summaryLabel, representative }] of socketMap) {
      groups.push({
        summaryLabel,
        count: details.length,
        details,
        hasSupply: false,
        specLines: buildSocketSpecLines(representative, t),
      })
    }
    const total = groups.reduce((s, g) => s + g.count, 0)
    categories.push({
      id: 'sockets',
      labelKey: 'tally.categorySockets',
      totalDevices: total,
      typeCount: groups.length,
      groups,
    })
  }

  // --- Switches (excluding impulse) ---
  const switchMap = new Map<
    string,
    { details: TallyDetail[]; summaryLabel: string; representative: Endpoint }
  >()
  for (const panel of panels) {
    for (const { circuit, protectionLabel } of getAllCircuits(panel)) {
      for (const ep of circuit.endpoints ?? []) {
        if (ep.type !== 'switch' || ep.symbol === 'switch_impulse') continue
        const key = switchGroupKey(ep)
        const branchLabel = getBranchLabelForEndpoint(circuit, ep.id)
        const existing = switchMap.get(key)
        const summaryLabel = switchSummaryLabel(ep, t)
        const detail: TallyDetail = {
          label: ep.label || branchLabel,
          branchOrCircuit: branchLabel,
          panelName: panel.name,
          subcircuitPath: buildPathWithSubcircuits(
            panel.name,
            protectionLabel,
            getCircuitPathFromRoot(panels, circuit.id),
            branchLabel,
            t
          ),
          selection: { type: 'endpoint', ids: [ep.id] },
        }
        if (existing) {
          existing.details.push(detail)
        } else {
          switchMap.set(key, { details: [detail], summaryLabel, representative: ep })
        }
      }
    }
  }
  if (switchMap.size > 0) {
    const groups: TallyGroup[] = []
    for (const [, { details, summaryLabel, representative }] of switchMap) {
      groups.push({
        summaryLabel,
        count: details.length,
        details,
        hasSupply: false,
        specLines: buildSwitchSpecLines(representative, t),
      })
    }
    const total = groups.reduce((s, g) => s + g.count, 0)
    categories.push({
      id: 'switches',
      labelKey: 'tally.categorySwitches',
      totalDevices: total,
      typeCount: groups.length,
      groups,
    })
  }

  // --- Impulse switches ---
  const impulseMap = new Map<
    string,
    { details: TallyDetail[]; summaryLabel: string; representative: Endpoint }
  >()
  for (const panel of panels) {
    for (const { circuit, protectionLabel } of getAllCircuits(panel)) {
      for (const ep of circuit.endpoints ?? []) {
        if (ep.type !== 'switch' || ep.symbol !== 'switch_impulse') continue
        const key = switchGroupKey(ep)
        const branchLabel = getBranchLabelForEndpoint(circuit, ep.id)
        const existing = impulseMap.get(key)
        const summaryLabel = switchSummaryLabel(ep, t)
        const detail: TallyDetail = {
          label: ep.label || branchLabel,
          branchOrCircuit: branchLabel,
          panelName: panel.name,
          subcircuitPath: buildPathWithSubcircuits(
            panel.name,
            protectionLabel,
            getCircuitPathFromRoot(panels, circuit.id),
            branchLabel,
            t
          ),
          selection: { type: 'endpoint', ids: [ep.id] },
        }
        if (existing) {
          existing.details.push(detail)
        } else {
          impulseMap.set(key, { details: [detail], summaryLabel, representative: ep })
        }
      }
    }
  }
  if (impulseMap.size > 0) {
    const groups: TallyGroup[] = []
    for (const [, { details, summaryLabel, representative }] of impulseMap) {
      groups.push({
        summaryLabel,
        count: details.length,
        details,
        hasSupply: false,
        specLines: buildSwitchSpecLines(representative, t),
      })
    }
    const total = groups.reduce((s, g) => s + g.count, 0)
    categories.push({
      id: 'impulse',
      labelKey: 'tally.categoryImpulse',
      totalDevices: total,
      typeCount: groups.length,
      groups,
    })
  }

  // --- Light points ---
  const lightMap = new Map<string, { details: TallyDetail[]; summaryLabel: string }>()
  for (const panel of panels) {
    for (const { circuit, protectionLabel } of getAllCircuits(panel)) {
      for (const ep of circuit.endpoints ?? []) {
        if (ep.type !== 'light_point') continue
        const sym = ep.symbol ?? 'light_point'
        const key = sym
        const branchLabel = getBranchLabelForEndpoint(circuit, ep.id)
        const existing = lightMap.get(key)
        const summaryLabel = t(`symbols.${sym}`) || sym
        const detail: TallyDetail = {
          label: ep.label || branchLabel,
          branchOrCircuit: branchLabel,
          panelName: panel.name,
          subcircuitPath: buildPathWithSubcircuits(
            panel.name,
            protectionLabel,
            getCircuitPathFromRoot(panels, circuit.id),
            branchLabel,
            t
          ),
          selection: { type: 'endpoint', ids: [ep.id] },
        }
        if (existing) {
          existing.details.push(detail)
        } else {
          lightMap.set(key, { details: [detail], summaryLabel })
        }
      }
    }
  }
  if (lightMap.size > 0) {
    const groups: TallyGroup[] = []
    for (const [, { details, summaryLabel }] of lightMap) {
      groups.push({ summaryLabel, count: details.length, details, hasSupply: false })
    }
    const total = groups.reduce((s, g) => s + g.count, 0)
    categories.push({
      id: 'lights',
      labelKey: 'tally.categoryLights',
      totalDevices: total,
      typeCount: groups.length,
      groups,
    })
  }

  // --- Relays ---
  const relayMap = new Map<
    string,
    { details: TallyDetail[]; summaryLabel: string; representative: Endpoint }
  >()
  for (const panel of panels) {
    for (const { circuit, protectionLabel } of getAllCircuits(panel)) {
      for (const ep of circuit.endpoints ?? []) {
        if (ep.symbol !== 'relay') continue
        const rp = ep.relayProps
        const key = `relay|${rp?.maxCurrentRatingA ?? ''}|${rp?.poles ?? ''}|${rp?.control ?? ''}`
        const branchLabel = getBranchLabelForEndpoint(circuit, ep.id)
        const existing = relayMap.get(key)
        const summaryLabel = t('symbols.relay') || 'Relay'
        const detail: TallyDetail = {
          label: ep.label || branchLabel,
          branchOrCircuit: branchLabel,
          panelName: panel.name,
          subcircuitPath: buildPathWithSubcircuits(
            panel.name,
            protectionLabel,
            getCircuitPathFromRoot(panels, circuit.id),
            branchLabel,
            t
          ),
          selection: { type: 'endpoint', ids: [ep.id] },
        }
        if (existing) {
          existing.details.push(detail)
        } else {
          relayMap.set(key, { details: [detail], summaryLabel, representative: ep })
        }
      }
    }
  }
  if (relayMap.size > 0) {
    const groups: TallyGroup[] = []
    for (const [, { details, summaryLabel, representative }] of relayMap) {
      groups.push({
        summaryLabel,
        count: details.length,
        details,
        hasSupply: false,
        specLines: buildRelaySpecLines(representative, t),
      })
    }
    const total = groups.reduce((s, g) => s + g.count, 0)
    categories.push({
      id: 'relays',
      labelKey: 'tally.categoryRelays',
      totalDevices: total,
      typeCount: groups.length,
      groups,
    })
  }

  // --- Domotica (minimal: by base symbol) ---
  const domoticaMap = new Map<string, { details: TallyDetail[]; summaryLabel: string }>()
  for (const panel of panels) {
    for (const { circuit, protectionLabel } of getAllCircuits(panel)) {
      for (const ep of circuit.endpoints ?? []) {
        if (!ep.domoticaProps) continue
        const base = ep.domoticaProps.baseSymbol ?? 'domotica'
        const key = base
        const branchLabel = getBranchLabelForEndpoint(circuit, ep.id)
        const existing = domoticaMap.get(key)
        const summaryLabel = t(`symbols.${base}`) || 'Domotica'
        const detail: TallyDetail = {
          label: ep.label || branchLabel,
          branchOrCircuit: branchLabel,
          panelName: panel.name,
          subcircuitPath: buildPathWithSubcircuits(
            panel.name,
            protectionLabel,
            getCircuitPathFromRoot(panels, circuit.id),
            branchLabel,
            t
          ),
          selection: { type: 'endpoint', ids: [ep.id] },
        }
        if (existing) {
          existing.details.push(detail)
        } else {
          domoticaMap.set(key, { details: [detail], summaryLabel })
        }
      }
    }
  }
  if (domoticaMap.size > 0) {
    const groups: TallyGroup[] = []
    for (const [, { details, summaryLabel }] of domoticaMap) {
      groups.push({ summaryLabel, count: details.length, details, hasSupply: false })
    }
    const total = groups.reduce((s, g) => s + g.count, 0)
    categories.push({
      id: 'domotica',
      labelKey: 'tally.categoryDomotica',
      totalDevices: total,
      typeCount: groups.length,
      groups,
    })
  }

  // --- Stove junction boxes (fixed_appliance matching stove) ---
  let stoveCount = 0
  const stoveDetails: TallyDetail[] = []
  for (const panel of panels) {
    for (const { circuit, protectionLabel } of getAllCircuits(panel)) {
      for (const ep of circuit.endpoints ?? []) {
        if (!isStoveEndpoint(ep)) continue
        stoveCount++
        const branchLabel = getBranchLabelForEndpoint(circuit, ep.id)
        stoveDetails.push({
          label: ep.label || branchLabel,
          branchOrCircuit: branchLabel,
          panelName: panel.name,
          subcircuitPath: buildPathWithSubcircuits(
            panel.name,
            protectionLabel,
            getCircuitPathFromRoot(panels, circuit.id),
            branchLabel,
            t
          ),
          selection: { type: 'endpoint', ids: [ep.id] },
        })
      }
    }
  }
  if (stoveCount > 0) {
    categories.push({
      id: 'stove',
      labelKey: 'tally.categoryStove',
      totalDevices: stoveCount,
      typeCount: 1,
      groups: [
        {
          summaryLabel: t('tally.stoveJunctionBox'),
          count: stoveCount,
          details: stoveDetails,
          hasSupply: false,
        },
      ],
    })
  }

  // --- Panels (by rows × columns) ---
  const panelMap = new Map<string, { count: number; details: TallyDetail[] }>()
  for (const panel of panels) {
    const g = panel.gridView
    const rows = g?.rows ?? 0
    const cols = g?.columns ?? 0
    const key = rows && cols ? `${rows}R×${cols}` : '—'
    const detail: TallyDetail = {
      label: panel.name,
      panelName: panel.name,
      subcircuitPath: panel.name,
      selection: { type: 'panel', ids: [panel.id] },
    }
    const existing = panelMap.get(key)
    if (existing) {
      existing.count++
      existing.details.push(detail)
    } else {
      panelMap.set(key, { count: 1, details: [detail] })
    }
  }
  if (panelMap.size > 0) {
    const groups: TallyGroup[] = []
    for (const [key, { count, details }] of panelMap) {
      const summaryLabel = key === '—' ? t('tally.panelNoGrid') : `${key} ${t('tally.panelGrid')}`
      groups.push({
        summaryLabel,
        count,
        details,
        hasSupply: false,
      })
    }
    const total = groups.reduce((s, g) => s + g.count, 0)
    categories.push({
      id: 'panels',
      labelKey: 'tally.categoryPanels',
      totalDevices: total,
      typeCount: groups.length,
      groups,
    })
  }

  // --- Wires (one logical circuit/ground run, grouped by cable/route fingerprint) ---
  const wireSegments = deriveProjectWireSegments(project)
  const circuitOwners = getCircuitOwners(panels)
  const logicalWireRuns = new Map<string, WireSegment[]>()
  for (const segment of wireSegments) {
    if (!isHardwareTallyWireSegment(segment)) continue
    const logicalKey =
      segment.fromElementType === 'ground'
        ? `ground:${segment.panelId}`
        : segment.circuitId
          ? `circuit:${circuitOwnerKey(segment.panelId, segment.circuitId)}`
          : `segment:${segment.id}`
    logicalWireRuns.set(logicalKey, [...(logicalWireRuns.get(logicalKey) ?? []), segment])
  }
  const wireMap = new Map<
    string,
    {
      details: TallyDetail[]
      summaryLabel: string
      hasSupply: boolean
      totalLengthM: number
    }
  >()
  for (const segments of logicalWireRuns.values()) {
    const segment = segments[0]
    if (!segment) continue
    const key = wireSegmentFingerprint(segment)
    const summaryLabel = formatWireTallySummaryLabel(segment, t)
    const isSupply =
      segment.isSupplyTrunk === true ||
      (segment.type === 'vertical' && !segment.circuitId && !segment.fromElementType)
    const panel = panels.find((p) => p.id === segment.panelId)
    const circuitOwner = segment.circuitId
      ? circuitOwners.get(circuitOwnerKey(segment.panelId, segment.circuitId))
      : undefined
    const detail: TallyDetail = {
      label: circuitOwner?.circuit.code.trim() || wireSegmentDetailLabel(segment, t),
      panelName: panel?.name ?? mainPanelName,
      subcircuitPath: panel?.name ?? mainPanelName,
      selection: wireSegmentsSelection(
        segment.fromElementType === 'ground' ? [segment] : segments
      ),
    }
    const enteredLengthM = uniqueEnteredWireLength(segments)
    const existing = wireMap.get(key)
    if (existing) {
      existing.details.push(detail)
      if (isSupply) existing.hasSupply = true
      existing.totalLengthM += enteredLengthM ?? 0
    } else {
      wireMap.set(key, {
        details: [detail],
        summaryLabel,
        hasSupply: isSupply,
        totalLengthM: enteredLengthM ?? 0,
      })
    }
  }
  if (wireMap.size > 0) {
    const groups: TallyGroup[] = []
    for (const [, { details, summaryLabel, hasSupply, totalLengthM }] of wireMap) {
      const specLines = [
        ...(totalLengthM > 0
          ? [t('tally.wireLengthTotal', { length: formatWireLengthMeters(totalLengthM, t) })]
          : []),
      ]
      groups.push({
        summaryLabel,
        count: details.length,
        details,
        hasSupply,
        totalLengthM: totalLengthM > 0 ? totalLengthM : undefined,
        specLines: specLines.length > 0 ? specLines : undefined,
      })
    }
    groups.sort((a, b) => a.summaryLabel.localeCompare(b.summaryLabel))
    const total = groups.reduce((s, g) => s + g.count, 0)
    categories.push({
      id: 'wires',
      labelKey: 'tally.categoryWires',
      totalDevices: total,
      typeCount: groups.length,
      groups,
    })
  }

  return categories
}
