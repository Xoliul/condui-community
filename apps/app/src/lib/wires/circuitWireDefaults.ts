import type { CableSpec, Circuit, ElectricalDomain } from '@/types/schema'

/** Default fire class for new AC installation wires on the main board (not supply, not DC). */
export const DEFAULT_AC_FIRE_CLASS: NonNullable<CableSpec['fireClass']> = 'Cca'

export type DefaultAcCircuitCableOptions = {
  sectionMm2?: number
  kind?: CableSpec['kind']
  conductors?: number
  hasPE?: boolean
}

/** Default cable for a new AC circuit (includes fire class). */
export function createDefaultAcCircuitCable(
  options: DefaultAcCircuitCableOptions = {},
): CableSpec {
  return {
    kind: options.kind ?? 'XVB',
    conductors: options.conductors ?? 3,
    sectionMm2: options.sectionMm2 ?? 2.5,
    hasPE: options.hasPE ?? true,
    fireClass: DEFAULT_AC_FIRE_CLASS,
  }
}

/** Cable kind seeded on every new AC circuit and the project default when none is set. */
export const SEEDED_AC_CIRCUIT_CABLE_KIND: CableSpec['kind'] = 'XVB'

/** Cable kinds offered as the project default (AC circuit cable types without a custom name). */
export const PROJECT_DEFAULT_CABLE_KINDS: ReadonlyArray<CableSpec['kind']> = [
  'XVB', 'VOB', 'VOBst', 'XGB', 'EXVB', 'H07RN-F',
]

export function resolveProjectDefaultCableKind(
  installation?: { defaultCableKind?: CableSpec['kind'] },
): CableSpec['kind'] {
  return installation?.defaultCableKind ?? SEEDED_AC_CIRCUIT_CABLE_KIND
}

/** Only AC circuit wires follow the project default; supply, earthing, bus and DC wires keep their own. */
export function isProjectDefaultCableAnchor(anchor: string): boolean {
  return anchor.startsWith('circuit:') && anchor.endsWith(':AC')
}

/**
 * An unedited circuit still carries the seeded kind. Circuits are created with a concrete cable,
 * so the seed kind is the only signal that nobody chose a type; any other kind (imports, older
 * edits) is treated as authored and kept.
 */
export function isSeededCircuitCable(cable: CableSpec | undefined): boolean {
  return cable?.kind === SEEDED_AC_CIRCUIT_CABLE_KIND && !cable.customKind
}

/** The cable with its type replaced by the project default; section, cores and fire class stay. */
export function withProjectDefaultCableKind(cable: CableSpec, kind: CableSpec['kind']): CableSpec {
  if (cable.kind === kind && !cable.customKind) return cable
  const { customKind: _custom, ...rest } = cable
  return { ...rest, kind }
}

/** A derived circuit cable as rendered: seeded cables follow the project default. */
export function resolveDerivedCircuitCable<T extends CableSpec | undefined>(
  cable: T,
  defaultKind: CableSpec['kind'] | undefined,
): T {
  return cable && defaultKind && isSeededCircuitCable(cable)
    ? (withProjectDefaultCableKind(cable, defaultKind) as T)
    : cable
}

/**
 * Internal panel-bus links are distribution conductors, not final circuit wiring.
 * Keep their rendered cable at least 6 mm² while preserving the selected cable
 * type, conductor count, PE flag, and any larger section already present.
 */
export function ensurePanelBusCableMinimum(cable?: CableSpec): CableSpec {
  const base = cable ?? createDefaultAcCircuitCable({ sectionMm2: 6 })
  return {
    ...base,
    sectionMm2: Math.max(base.sectionMm2 ?? 0, 6),
  }
}

/** Default one-wire label flags for a new AC circuit. */
export const DEFAULT_AC_CIRCUIT_WIRE_LABEL_FLAGS: Pick<Circuit, 'showFireClassLabel'> = {
  showFireClassLabel: true,
}

export function resolveShowFireClassLabel(
  value: boolean | undefined,
  domain: ElectricalDomain,
): boolean {
  if (domain === 'DC') return value === true
  return value !== false
}

/** Wire length labels are opt-in on all domains. */
export function resolveShowWireLengthLabel(value: boolean | undefined): boolean {
  return value === true
}
