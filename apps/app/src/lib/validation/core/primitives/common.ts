import type { CheckContext, CheckResult, Issue, Offender, ValidationProject } from '../types'
import type { InstallationQueryAPI, SitplanMapping } from '../query-api'
import type {
  ProtectionType,
  ElectricalDomain,
  SymbolKey,
  Panel,
  CircuitKind,
  Circuit,
  Endpoint,
  CableSpec,
  TrunkDevice,
  ProtectionDevice,
} from '@/types/schema'
import type { WireSegment } from '@/types/schema'
import { getPortDomainsForSymbol, DEFAULT_ELECTRICAL_DOMAIN, symbolInheritsWireDomain } from '@/lib/symbols'
import { calculateBottomUpLayout } from '@/lib/layout/bottomUpLayout'
import { computeAreiCircuitEndpointLimitCount } from '@/lib/validation/areiCircuitEndpointCount'
import { listLightingFeedCircuits } from '@/lib/validation/areiLightingCircuitCount'
import {
  MAX_BREAKER_BY_SECTION,
  getMaxProtectionRatingForSection,
  getCircuitMinSectionForCableProtectedByDevice,
  getCircuitSegmentsForValidation,
} from '@/lib/validation/circuitCableSection'
import { buildLayoutTree } from '@/lib/layout/layoutTree'
import { deriveWires } from '@/lib/layout/deriveWires'
import { detectPanelOrphans, orphanReportToIssues } from '@/lib/validation/orphanDetection'
import { findDuplicateProtectionLabelGroupsOnPanel } from '@/lib/eendraad/automaticMainBusNaming'
import {
  collectBranchSwitchSequenceIssues,
  type SwitchSequenceIssueCode,
} from '@/lib/validation/switchSequence'
import { getPanelFeedProjection } from '@/lib/feedTopology'
import { trunkDeviceCountsAsProtection } from '@/lib/protectionKind'
import {
  cableExplicitlyWithoutPe,
  cableForSupplyWireRole,
  type SupplyWireRole,
} from '@/lib/supplyWireCables'
import {
  resolvePanelSupplyLinkForPanel,
  resolvePanelSupplyLinkForPanelInPanels,
} from '@/lib/eendraad/panelSupplyLink'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
} from '@/lib/projectV2/electrical'
import i18n from '@/lib/validation/validationI18n'

export type {
  CheckContext,
  CheckResult,
  Issue,
  Offender,
  ValidationProject,
  InstallationQueryAPI,
  SitplanMapping,
  ProtectionType,
  ElectricalDomain,
  SymbolKey,
  Panel,
  CircuitKind,
  Circuit,
  Endpoint,
  CableSpec,
  TrunkDevice,
  ProtectionDevice,
  WireSegment,
  SwitchSequenceIssueCode,
  SupplyWireRole,
}

export {
  getPortDomainsForSymbol,
  DEFAULT_ELECTRICAL_DOMAIN,
  calculateBottomUpLayout,
  computeAreiCircuitEndpointLimitCount,
  listLightingFeedCircuits,
  MAX_BREAKER_BY_SECTION,
  getMaxProtectionRatingForSection,
  getCircuitMinSectionForCableProtectedByDevice,
  getCircuitSegmentsForValidation,
  buildLayoutTree,
  deriveWires,
  detectPanelOrphans,
  orphanReportToIssues,
  findDuplicateProtectionLabelGroupsOnPanel,
  collectBranchSwitchSequenceIssues,
  getPanelFeedProjection,
  trunkDeviceCountsAsProtection,
  cableExplicitlyWithoutPe,
  cableForSupplyWireRole,
  resolvePanelSupplyLinkForPanel,
  resolvePanelSupplyLinkForPanelInPanels,
  i18n,
}

export function isValidationDebugEnabled(): boolean {
  // Explicit opt-in: avoids console spam during normal development.
  // Enable by setting `localStorage.setItem('eendra.validation.debug', '1')`
  // or `window.__EENDRA_VALIDATION_DEBUG__ = true`.
  try {
    if (typeof window !== 'undefined') {
      const debugWindow = window as Window & { __EENDRA_VALIDATION_DEBUG__?: boolean }
      if (debugWindow.__EENDRA_VALIDATION_DEBUG__ === true) return true
      if (window.localStorage?.getItem('eendra.validation.debug') === '1') return true
    }
  } catch {
    // ignore
  }
  return false
}

export const VALIDATION_DEBUG = isValidationDebugEnabled()

export function projectPanels(project: ValidationProject): Panel[] {
  return getProjectElectricalPanels(project)
}

export function projectInstallation(project: ValidationProject) {
  return getProjectElectricalInstallation(project)
}

export function validationCircuitCode(code: string | undefined | null): string {
  return (
    code?.trim() ||
    i18n.t('validation.labels.unnamedCircuit', {
      defaultValue: '[unnamed circuit]',
    })
  )
}

export function validationProtectionLabel(label: string | undefined | null): string {
  return (
    label?.trim() ||
    i18n.t('validation.labels.unnamedProtection', {
      defaultValue: '[unnamed protection]',
    })
  )
}

export const ENERGY_CONVERSION_SYMBOLS = new Set<SymbolKey>([
  'transformer',
  'rectifier',
  'inverter',
  'dc_dc_converter',
  'solar_panel',
  'battery',
])

type PrimitiveRegistry = Map<
  string,
  (context: CheckContext, params?: Record<string, unknown>) => CheckResult | Issue[]
>

export const primitives: PrimitiveRegistry = new Map()

// Conservative current reference for additional (especially small) sections
// used in DC contexts. Values are intentionally cautious and should only be
// used for warning heuristics (not hard compliance checks).
export const CONSERVATIVE_DC_AMPACITY_BY_SECTION: Record<number, number> = {
  0.22: 2,
  0.34: 3,
  0.6: 5,
  0.72: 6,
  0.75: 6,
  0.8: 7,
  1: 10,
  1.5: 16,
  2.5: 20,
  4: 25,
  6: 32,
  10: 40,
  16: 63,
  25: 80,
  35: 100,
  50: 125,
}

export function getConservativeAmpacityForSection(
  section: number,
  table: Record<number, number>
): number | undefined {
  if (!Number.isFinite(section) || section <= 0) return undefined
  if (table[section] != null) return table[section]
  const keysAsc = Object.keys(table)
    .map((k) => Number(k))
    .filter((k) => Number.isFinite(k))
    .sort((a, b) => a - b)
  if (keysAsc.length === 0) return undefined
  // Conservative fallback: use the nearest LOWER known section.
  let chosen = keysAsc[0]!
  for (const k of keysAsc) {
    if (k <= section) chosen = k
    if (k > section) break
  }
  return table[chosen]
}

// Household appliances explicitly named by AREI 5.2.1.2 as requiring a
// dedicated circuit regardless of whether rated power is modeled.
export const HEAVY_APPLIANCE_SYMBOLS: Set<SymbolKey> = new Set<SymbolKey>([
  'stove',
  'oven',
  'washer',
  'dryer',
  'dishwasher',
])

/** Devices that do not warrant a dedicated circuit hint by themselves. */
export const FIXED_APPLIANCE_DEDICATED_HINT_EXCLUDED_SYMBOLS = new Set<SymbolKey>([
  'bell',
  'buzzer',
  'horn',
  'siren',
  'transformer',
])

/** Resolve fixed typed ports for an element (for domain validation) */
export function getElementPortDomains(
  query: InstallationQueryAPI,
  elementType: string | undefined,
  elementId: string | undefined
): readonly [ElectricalDomain, ElectricalDomain] {
  const fallback: readonly [ElectricalDomain, ElectricalDomain] = [
    DEFAULT_ELECTRICAL_DOMAIN,
    DEFAULT_ELECTRICAL_DOMAIN,
  ]
  if (!elementType || !elementId) return fallback
  switch (elementType) {
    case 'mainBus':
    case 'secondaryBus':
    case 'ground':
      return elementType === 'ground' ? fallback : ['AC', 'DC']
    case 'rcd':
      return getPortDomainsForSymbol('rcd')
    case 'protection': {
      const protection = query.getProtectionById(elementId)
      if (!protection) return fallback
      const symbolId = protection.type.toLowerCase()
      return symbolInheritsWireDomain(symbolId) ? ['AC', 'DC'] : getPortDomainsForSymbol(symbolId)
    }
    case 'endpoint': {
      const endpoint = query.getEndpointById(elementId)
      if (endpoint) {
        const symbolId = endpoint.symbol ?? 'socket'
        return symbolInheritsWireDomain(symbolId) ? ['AC', 'DC'] : getPortDomainsForSymbol(symbolId)
      }
      // Trunk devices are wired as endpoint anchors in eendraad metadata.
      // Resolve them here to avoid falling back to AC/AC and creating
      // premature domain mismatch warnings for valid converters.
      const trunkDevice = query.getTrunkDeviceById(elementId)
      if (trunkDevice) return symbolInheritsWireDomain(trunkDevice.symbol) ? ['AC', 'DC'] : getPortDomainsForSymbol(trunkDevice.symbol)
      return fallback
    }
    default: {
      const trunkDevice = query.getTrunkDeviceById(elementId)
      if (trunkDevice) return symbolInheritsWireDomain(trunkDevice.symbol) ? ['AC', 'DC'] : getPortDomainsForSymbol(trunkDevice.symbol)
      return fallback
    }
  }
}
