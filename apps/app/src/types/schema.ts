// Core data types matching the JSON schema (docs/Example.json)

import type { ViewportLayout } from './ui'

export interface Point2 {
  x: number
  y: number
}

export interface CableSpec {
  kind:
    | 'XVB'
    | 'VOB'
    | 'VOBst'
    | 'NYFAZ'
    | 'XGB'
    | 'EXVB'
    | 'H07RN-F'
    | 'PV1-F'
    | 'H1Z2Z2-K'
    | 'H07V-K'
    | 'SVV'
    | 'LiYY'
    | 'VTLB'
    | 'JYSTY'
    | 'Solar'
    | 'battery-cable'
    | 'twinflex'
    | 'other'
  conductors: number
  sectionMm2: number
  hasPE?: boolean
  fireClass?: 'Aca' | 'B1ca' | 'B2ca' | 'Cca' | 'Dca' | 'Eca' | 'Fca'
  /** Display name when `kind` is `other`. */
  customKind?: string
  notes?: string
}

export type AcPhase = 'L1' | 'L2' | 'L3' | 'N' | 'PE'
export type AcLinePhase = Extract<AcPhase, 'L1' | 'L2' | 'L3'>

/** Optional per-busbar phase rotation. Missing orders use L1, L2, L3. */
export interface BusbarPhaseConfiguration {
  main?: AcLinePhase[]
  /** Secondary busbar owner id (grouping protection or parent circuit) to phase rotation. */
  secondary?: Record<string, AcLinePhase[]>
}

/**
 * One independently supplied top-level busbar section inside a physical panel.
 *
 * The source and available conductors are resolved from the root feed or supply
 * assembly handoff that targets this section. `role` is only a presentation and
 * preset hint; it must never be used as the electrical source of truth.
 */
export interface PanelBusSection {
  id: string
  label: string
  role?: 'normal' | 'backup' | 'custom'
  /** Independent automatic phase sequence for circuits attached to this section. */
  phaseOrder?: AcLinePhase[]
}

export type CircuitPhaseAssignmentKind =
  'inherit' | 'single_phase' | 'phase_to_phase' | 'three_phase' | 'dc'

/** Typed conductor/phase assignment for an AC or DC circuit wire. */
export interface CircuitPhaseAssignment {
  kind: CircuitPhaseAssignmentKind
  phases: AcPhase[]
  neutral?: 'used' | 'not_used' | 'not_present'
  source?: 'manual' | 'derived_from_protection' | 'derived_from_voltage' | 'derived_from_busbar'
}

/** Reference to a module that can appear in the panel grid (kast) view */
export type PanelGridModuleRef =
  | { kind: 'protection'; id: string }
  | { kind: 'trunkDevice'; id: string; scope: 'supply' | 'ground' | 'circuit'; circuitId?: string }
  /** Legacy ref name used for every eligible endpoint-style panel module. */
  | { kind: 'domotica'; endpointId: string; circuitId: string }

/**
 * Slot position and optional width override in physical DIN-module measurements.
 * Panel layout normalizes values to an integer 1/12-module fixed-point grid;
 * whole numbers remain the normal representation for existing devices.
 */
export interface PanelGridSlot {
  row: number
  col: number
  /** Optional compact terminal-strip rail; only terminal-strip modules may use it. */
  terminalStripRail?: 'top' | 'bottom'
  moduleWidth?: number
  /** When true, `moduleWidth` is a deliberate user resize; otherwise width follows device poles. */
  moduleWidthManual?: boolean
  module: PanelGridModuleRef
}

/** Per-panel config for grid (kast) view: dimensions, feed side, and optional slot order */
export type EarthingSystemType = 'TT' | 'TN-S' | 'TN-C' | 'TN-C-S' | 'IT'

export interface PanelGridConfig {
  rows: number
  columns: number
  feedFromTop: boolean
  slots: PanelGridSlot[]
  terminalStripTopRail?: boolean
  terminalStripBottomRail?: boolean
  /** Independent supply-panel row count. */
  supplyPanelRows?: number
  /** Independent supply-panel column count. */
  supplyPanelColumns?: number
  /** Slots for modules ejected to the supply panel (main panel only). */
  supplyPanelSlots?: PanelGridSlot[]
  /** Whether the supply panel frame is rendered; set true on first eject */
  supplyPanelVisible?: boolean
  /** Module ref keys (panelGridModuleRefKey) for modules hidden from panel view */
  hiddenModuleKeys?: string[]
  /** Non-protection module ref keys explicitly shown in the panel view. */
  shownModuleKeys?: string[]
}

/** Source used to populate one of the two editable panel label cells. */
export type PanelLabelCellSource = 'label' | 'notes' | 'labelNotes' | 'technical'

export interface PanelLabelCellConfig {
  /** First source retained for backward compatibility with older editors. */
  source: PanelLabelCellSource
  /** Ordered sources rendered as separate lines. Missing uses the singular source. */
  sources?: PanelLabelCellSource[]
  alignment?: 'left' | 'center' | 'right' | 'justify'
}

/** Per-module label editor preferences. Missing sides use label/notes defaults. */
export interface PanelLabelConfig {
  top?: PanelLabelCellConfig
  bottom?: PanelLabelCellConfig
}

export interface Panel {
  id: string
  /**
   * Canonical panel name (backwards compatible). Kept for existing projects and
   * internal references (e.g. legacy endpoints that still use a label match).
   */
  name: string
  /**
   * Per-locale display names for the panel. Used to show a language-specific label
   * while still allowing user overrides per language.
   *
   * Keys typically match project/project.locale (e.g. "en", "nl-BE", "fr-BE").
   */
  nameByLocale?: Record<string, string>
  location?: string
  symbol: 'panel_distribution'
  isMain?: boolean // One panel must be marked as main, others are sub-panels
  protections: ProtectionDevice[]
  circuits: Circuit[] // Circuits not under a protection
  subPanels: Panel[] // Nested panels, connected via MCB
  /** Phase rotations reset independently for this panel's main and secondary busbars. */
  busbarPhases?: BusbarPhaseConfiguration
  /** Optional independently supplied top-level busbar sections. Missing means one legacy main bus. */
  busSections?: PanelBusSection[]
  /** Default destination for legacy/unassigned top-level devices when bus sections exist. */
  primaryBusSectionId?: string
  /** Optional config for panel (kast) grid view; only affects display in that view */
  gridView?: PanelGridConfig
  /** Generic one-wire label rendering options for the panel symbol label. */
  symbolLabelDisplay?: SymbolLabelDisplayConfig
  /** ISO installation date. Preferred over the legacy year override. */
  installationDate?: string
  /** Explicitly keeps automatic/version-derived installation dates off this entity. */
  installationDateSuppressed?: boolean
  /** Legacy year override for older project files. */
  rulesetDateOverride?: number
  /** Earthing arrangement shown on the one-wire panel header (omit = none). */
  earthingSystem?: EarthingSystemType
  /** Earthing arrangement carried by the panel's backup feed (omit = none). */
  backupEarthingSystem?: EarthingSystemType
  /**
   * Local earth-electrode stem on a secondary board. Main-board earthing stays on
   * {@link Installation.hasGround} / {@link Installation.groundTrunkDevices}.
   * Missing or false means this board has no local electrode.
   */
  hasGround?: boolean
  /** Devices on this panel's local ground wire (typically a linked earthing-separator pair). */
  groundTrunkDevices?: TrunkDevice[]
}

export type ProtectionType =
  'RCD' | 'MCB' | 'RCBO' | 'FUSE' | 'MAIN_SWITCH' | 'SPD' | 'ROTATING_SWITCH' | 'OTHER'
export type CurveType = 'B' | 'C' | 'D' | 'F' | 'K' | 'MA' | 'Z' | 'unknown'
export type ResidualCurrentType = 'AC' | 'A' | 'F' | 'B'
export type SurgeProtectionKind = 'standard' | 'sparkGap'
export type PolesConfig = '1P' | '1P+N' | '2P' | '3P' | '3P+N' | '4P'

export type SymbolLabelPosition = 'right' | 'left' | 'top' | 'bottom'
export type SymbolLabelLayout = 'stack' | 'sequence'

/**
 * Generic per-symbol label rendering preferences for one-wire canvas labels.
 * `visibility` stores per-label-key toggles without duplicating the source data.
 */
export interface SymbolLabelDisplayConfig {
  position?: SymbolLabelPosition
  layout?: SymbolLabelLayout
  visibility?: Record<string, boolean>
}

export interface ProtectionDevice {
  id: string
  type: ProtectionType
  label: string
  ratingA?: number
  curve?: CurveType // For MCB/RCBO (e.g. B, C, D)
  sensitivityMa?: number // For RCD/RCBO (e.g. 30mA, 300mA)
  residualCurrentType?: ResidualCurrentType // For RCD/RCBO - waveform class (AC, A, F, B)
  breakingCapacityKa?: number // For MCB/RCBO - breaking capacity in kA
  /** Unique breaking-capacity dropdown value (`3000` vs `3`, etc.). */
  breakingCapacityOption?: string
  /** SPD type. Missing values use the one-arrow lightning-protection symbol. */
  surgeProtectionKind?: SurgeProtectionKind
  polesConfig?: PolesConfig // Human-readable poles config (e.g. '2P', '1P+N', '4P')
  poles?: number // Numeric pole count (derived from polesConfig for backward compat)
  notes?: string
  /** Optional second comment used by the panel label editor. */
  labelNotes?: string
  /** Panel label cell source preferences. */
  panelLabel?: PanelLabelConfig
  circuits?: Circuit[] // Circuits protected by this device (e.g., RCD with multiple circuits)
  subPanelId?: string // For MCBs that connect to sub-panels
  /** Structural carrier for a secondary panel connected directly to a busbar; no protection symbol is rendered. */
  directPanelFeeder?: boolean
  /** Structural carrier for an unprotected branch connected directly to a DC bus; no protection symbol is rendered. */
  directDcBusFeeder?: boolean
  /** DC bus that owns this outgoing branch. Present on both structural and real protections. */
  dcBusId?: string
  /** ISO installation date. Preferred over the legacy year override. */
  installationDate?: string
  /** Explicitly keeps automatic/version-derived installation dates off this entity. */
  installationDateSuppressed?: boolean
  /** Legacy year override for older project files. */
  rulesetDateOverride?: number
  /** Generic one-wire label rendering options next to this protection symbol. */
  symbolLabelDisplay?: SymbolLabelDisplayConfig
  /** Top-level panel bus section supplying this protection; nested circuits inherit it. */
  busSectionId?: string
}

/** Electrical properties remembered from the last edited protection of each type. */
export type ProtectionCreationTemplate = Pick<
  ProtectionDevice,
  | 'ratingA'
  | 'curve'
  | 'sensitivityMa'
  | 'residualCurrentType'
  | 'breakingCapacityKa'
  | 'breakingCapacityOption'
  | 'surgeProtectionKind'
  | 'polesConfig'
  | 'poles'
>

export type CircuitKind =
  | 'lighting'
  | 'sockets'
  | 'fixed_appliance'
  | 'mixed'
  | 'stove'
  | 'solar'
  | 'battery'
  | 'doorbell'
  | 'subpanel'
  | 'hvac'
  | 'boiler'
  | 'heating'
  | 'ev'
  | 'empty'
  | 'other'

/**
 * Branch represents a horizontal branch in the eendraad diagram
 * Each branch contains one or more endpoints in series along the stub.
 * The label is the single source of truth for the branch name (e.g. "A1").
 * All endpoints on the branch share this label.
 */
export interface Branch {
  id: string
  label: string // Shared branch label (e.g. "A1") — source of truth for all endpoints on this branch
  endpointIds: string[] // Endpoint IDs in series order along the branch (authoritative)
  /** Ordinary-panel DC rail that renders this endpoint branch as a vertical rail tap. */
  dcBusId?: string
  /**
   * Optional serial devices on an ordinary DC-rail tap, ordered from the bus toward the
   * endpoint chain. These remain owned by the parent circuit; they are not child circuits
   * and must not make the DC bus a serial structure node.
   */
  branchDevices?: TrunkDevice[]
}

export interface Circuit {
  id: string
  code: string
  /** Optional non-bus origin for a circuit fed by a standalone supply converter backup port. */
  supplySource?: {
    kind: 'converter-backup'
    converterId: string
  }
  /** An outgoing circuit supplied by a selectable DC bus. */
  dcBusSource?: {
    busId: string
  }
  /** Bus section for an unprotected top-level circuit; protected circuits inherit their protection. */
  busSectionId?: string
  /** Preserve this code during automatic main-bus naming, used for plan-created circuits with chosen labels. */
  eendraadManualCodeLock?: boolean
  kind: CircuitKind
  cable: CableSpec
  /** Optional explicit phase/conductor assignment; omitted means inherit the upstream phase set. */
  phaseAssignment?: CircuitPhaseAssignment
  /** When true, show the assigned phase beside the protection in one-wire. Defaults off. */
  showPhaseLabel?: boolean
  inTube?: boolean // Flag: vertical wire is in tube (independent)
  inWall?: boolean // @deprecated use wireRoute === 'wall'
  /** Route/location: wall, ground, or air. Mutually exclusive; undefined/air = in air. */
  wireRoute?: 'wall' | 'ground' | 'air'
  hideWireLabel?: boolean // Flag: hide wire label on vertical wire
  /** When true, cable fire class is drawn below the wire label on the one-wire diagram. */
  showFireClassLabel?: boolean
  /** Wire run length in meters (optional). */
  wireLengthM?: number
  /** When true, {@link wireLengthM} is drawn below the fire class on the one-wire diagram. */
  showWireLengthLabel?: boolean
  notes?: string
  /** If false, circuit notes are not shown on the eendraad canvas. Default true. */
  notesVisible?: boolean
  endpoints: Endpoint[]
  branches?: Branch[] // Explicit branch structure - if not present, will be inferred from endpoints
  trunkDevices?: TrunkDevice[] // Devices on the vertical trunk (e.g. energy meters), ordered by trunkPosition
  /**
   * Optional per-domain wire property overrides.
   * AC/DC segments inherit circuit defaults unless their domain override is present.
   * This allows domain changes (e.g. after rectifier/inverter) to keep independent wire settings.
   */
  domainWireOverrides?: Partial<
    Record<
      ElectricalDomain,
      {
        cable?: CableSpec
        phaseAssignment?: CircuitPhaseAssignment
        showPhaseLabel?: boolean
        inTube?: boolean
        inWall?: boolean
        wireRoute?: 'wall' | 'ground' | 'air'
        hideWireLabel?: boolean
        showFireClassLabel?: boolean
        wireLengthM?: number
        showWireLengthLabel?: boolean
      }
    >
  >
  /**
   * Optional per-section wire overrides for the vertical circuit trunk.
   * A section is identified by the segment endpoints (from/to element references).
   * This lets every trunk section between protection/trunk devices carry its own
   * cable/route/tube/label settings. Panel-only feeder stubs can also identify
   * the short bus-to-feeder section before the linked panel symbol.
   */
  sectionWireOverrides?: Array<{
    fromElementType?: 'mainBus' | 'secondaryBus' | 'protection' | 'endpoint'
    fromElementId?: string
    toElementType?: 'protection' | 'endpoint'
    toElementId?: string
    domain?: ElectricalDomain
    cable?: CableSpec
    phaseAssignment?: CircuitPhaseAssignment
    showPhaseLabel?: boolean
    inTube?: boolean
    inWall?: boolean
    wireRoute?: 'wall' | 'ground' | 'air'
    hideWireLabel?: boolean
    showFireClassLabel?: boolean
    wireLengthM?: number
    showWireLengthLabel?: boolean
  }>
  subCircuitIds?: string[] // IDs of nested circuits (canonical data lives in protection.circuits)
  /** ISO installation date. Preferred over the legacy year override. */
  installationDate?: string
  /** Explicitly keeps automatic/version-derived installation dates off this entity. */
  installationDateSuppressed?: boolean
  /** Legacy year override for older project files. */
  rulesetDateOverride?: number
  /**
   * When false, the main circuit letter (A/B/…) is not drawn on the one-wire diagram.
   * Undefined/true = shown. Automatic naming may clear this for feeder rows when hiding feeder letters.
   */
  eendraadLetterVisible?: boolean
}

export type EndpointType = 'socket' | 'switch' | 'light_point' | 'fixed_appliance' | 'domotica'

/** Electrical domain for AC/DC awareness (expandable to SELV etc.) */
export type ElectricalDomain = 'AC' | 'DC'

/** Default domain for new wires and non-conversion components */
export const DEFAULT_ELECTRICAL_DOMAIN: ElectricalDomain = 'AC'

export type SymbolKey =
  | 'mains'
  | 'socket'
  | 'socket_gnd'
  | 'socket_child'
  | 'socket_gnd_child'
  | 'switch'
  | 'switch_1p_twoway'
  | 'switch_2p_twoway'
  | 'switch_dimmer'
  | 'switch_1p_changeover'
  | 'switch_1p_pull'
  | 'contact'
  | 'switch_impulse'
  | 'switch_cross'
  | 'motion_detector'
  | 'smoke_detector'
  | 'relay'
  | 'light_point'
  | 'light_spot'
  | 'light_led'
  | 'light_fluorescent'
  | 'fixed_appliance_generic'
  | 'oven'
  | 'washer'
  | 'dryer'
  | 'dishwasher'
  | 'boiler'
  | 'ev'
  | 'freezer'
  | 'fridge'
  | 'microwave'
  | 'motor'
  | 'stove'
  | 'furnace'
  | 'heating'
  | 'ventilation'
  | 'door_lock'
  | 'buzzer'
  | 'bell'
  | 'horn'
  | 'siren'
  | 'domotica'
  | 'energy_meter'
  | 'panel_distribution'
  // Protection symbols (used by supply trunk devices)
  | 'mcb'
  | 'rcd'
  | 'rcbo'
  | 'fuse'
  | 'main_switch'
  | 'spd'
  | 'rotating_switch'
  | 'source_changeover'
  // Grid & earthing symbols (used by ground trunk devices)
  | 'earthing_separator'
  | 'junction_box'
  | 'junction_panel'
  | 'terminal_strip'
  | 'note'
  // Energy conversion (AC/DC)
  | 'transformer'
  | 'rectifier'
  | 'inverter'
  | 'dc_dc_converter'
  | 'solar_panel'
  | 'battery'
  | 'dc_bus'
  // Legacy switch keys (backward compat; resolved to new SVGs at render)
  | 'switch_single'
  | 'switch_double'

export type RelayControlMode = 'standard' | 'timer' | 'clock' | 'impulse' | 'thermostat' | 'dimmer'

/** Detector kind when symbol is 'smoke_detector' (default smoke) */
export type SmokeDetectorType = 'smoke' | 'gas' | 'manual' | 'beam' | 'flame' | 'heat'

/** Motion detector artwork when symbol is 'motion_detector' (default spread) */
export type MotionDetectorType = 'spread' | 'generic'

/** Device-specific props when symbol is 'relay' */
export interface RelayDeviceProps {
  maxCurrentRatingA?: number
  poles?: number
  control?: RelayControlMode
}

/** Device-specific props when symbol is 'smoke_detector' */
export interface SmokeDetectorDeviceProps {
  /** Overlay kind; defaults to smoke when unset */
  type?: SmokeDetectorType
}

/** Device-specific props when symbol is 'motion_detector' */
export interface MotionDetectorDeviceProps {
  /** Artwork kind; defaults to spread when unset */
  type?: MotionDetectorType
}

/** Device-specific props when symbol is 'energy_meter' */
export interface EnergyMeterDeviceProps {
  /** Human-readable pole configuration (same as protection devices) */
  polesConfig?: PolesConfig
  /** Numeric pole count (derived from polesConfig for backward compat) */
  poles?: number
}

/**
 * A device that sits on the vertical trunk of a circuit (between MCB and branches)
 * OR on the supply wire of the main panel (between supply and main bus)
 * OR on the ground wire of the main panel (between ground symbol and main bus).
 *
 * For circuit trunk devices:
 *   trunkPosition determines where on the trunk the device is placed:
 *     0 = right after MCB, before all branches (measures entire circuit)
 *     1 = after 1st branch, 2 = after 2nd branch, etc.
 *
 * For supply trunk devices (stored on installation.mainSupply.supplyTrunkDevices):
 *   trunkPosition is a simple sequential index (0, 1, 2, ...) for ordering.
 *
 * For ground trunk devices (stored on installation.groundTrunkDevices):
 *   trunkPosition is a simple sequential index (0, 1, 2, ...) for ordering.
 */
export type TrunkDeviceType =
  | 'energy_meter'
  | 'relay'
  | 'switch'
  | 'protection'
  | 'earthing_separator'
  | 'junction_box'
  | 'junction_panel'
  | 'terminal_strip'
  | 'changeover'
  | 'conversion'
  | 'storage'
  | 'generation'
  | 'domotica'
  | 'dc_bus'

export interface DcBusDeviceProps {
  /** @deprecated Legacy unreleased model. Ordinary-panel rails now own Circuit.branches directly. */
  branchCircuitIds?: string[]
  ratedCurrentA?: number
  ratedVoltageV?: number
}

export interface JunctionPanelTerminalComponent {
  id: string
  label: string
  pinCount: number
}

export interface TrunkDevice {
  id: string
  type: TrunkDeviceType
  symbol: SymbolKey
  label: string
  /** Shared physical identity for junction boxes, junction panels, and terminal strips. */
  junctionIdentity?: string
  /** Stable link to the junction asset this occurrence belongs to; `junctionIdentity` is its label. */
  junctionAssetId?: string
  /** Shared panel-canvas layout for a physical junction panel. */
  junctionPanelGridView?: PanelGridConfig
  /** Physical terminal component created for this junction-panel connection occurrence. */
  junctionPanelTerminal?: JunctionPanelTerminalComponent
  /** Unique connection pin within the terminal strip identified by `junctionIdentity`. */
  terminalStripPin?: number
  /** Distinct outgoing connection pin for an in-line terminal strip. */
  terminalStripOutgoingPin?: number
  /** Shared identity for the two physical symbols of one earthing separator. */
  earthingSeparatorPairId?: string
  /** Physical panel-canvas mounting for supply devices and auxiliary-mounted terminal strips; independent from electrical ownership. */
  panelMounting?:
    | { kind: 'grid' }
    | { kind: 'panel'; panelId: string }
    | { kind: 'auxiliary'; enclosureId: string }
  /** Physical panel-canvas owner for terminal strips; independent from circuit ownership. */
  terminalStripPanelId?: string
  /** Situation-plan instances for trunk devices that also have a physical plan symbol. */
  placements?: Placement[]
  /** Show domain-change label (AC/DC symbol) after this device on 1draad trunk. Defaults to true. */
  showDomainChangeLabel?: boolean
  energyMeterProps?: EnergyMeterDeviceProps
  /** When symbol === 'relay'; shared with ordinary relay endpoints. */
  relayProps?: RelayDeviceProps
  /** When type === 'conversion' — energy conversion specific properties */
  conversionProps?: EnergyConversionDeviceProps
  /** When type === 'storage' and symbol === 'battery'. */
  batteryProps?: BatteryDeviceProps
  /** When type === 'generation' and symbol === 'solar_panel'. */
  solarPanelProps?: SolarPanelDeviceProps
  /** When type === 'dc_bus' and symbol === 'dc_bus'. */
  dcBusProps?: DcBusDeviceProps
  /** When type === 'domotica' and symbol === 'domotica'. */
  domoticaProps?: DomoticaDeviceProps
  /** Widened DC converter output on which this circuit or supply-branch device is placed. */
  converterDcConnection?: {
    converterId: string
    connectionIndex: number
  }
  /** Display labels for the two source ports of a supply changeover switch. */
  changeoverProps?: {
    port1Label?: string
    port2Label?: string
  }
  /** Protection-specific properties (when type === 'protection') */
  protectionType?: ProtectionType
  ratingA?: number
  curve?: CurveType
  sensitivityMa?: number
  residualCurrentType?: ResidualCurrentType
  breakingCapacityKa?: number
  /** Unique breaking-capacity dropdown value (`3000` vs `3`, etc.). */
  breakingCapacityOption?: string
  /** SPD type. Missing values use the one-arrow lightning-protection symbol. */
  surgeProtectionKind?: SurgeProtectionKind
  polesConfig?: PolesConfig
  poles?: number
  notes?: string
  /** Optional second comment used by the panel label editor. */
  labelNotes?: string
  /** Panel label cell source preferences. */
  panelLabel?: PanelLabelConfig
  /** Position on trunk relative to branches (circuit) or sequential index (supply). */
  trunkPosition: number
  /** Supply-only branch ownership. Omitted/serial devices stay on the ordinary grid-to-panel path. */
  supplyPath?:
    | 'serial'
    | 'backup'
    | 'backup-output'
    | 'changeover-grid'
    | 'converter-grid'
    | 'converter-branch'
    | 'converter-dc'
    | 'converter-dc-top'
  /** Supply-converter DC exit: 0 is the side exit and 1-4 are the independently routed top exits. */
  supplyConverterDcConnectionIndex?: number
  /** Supply DC bus that owns this device after the busbar. Omitted for the serial input side. */
  supplyDcBusId?: string
  /** Stable outgoing branch identity within the owning supply DC bus. */
  supplyDcBusBranchId?: string
  /** Geometry on the converter grid-input path. Missing means inline on the horizontal run. */
  converterGridPlacement?: 'inline' | 'input-leg'
  /** Geometry on the modular changeover grid-input path. Missing means inline on the lower rail. */
  changeoverGridPlacement?: 'inline' | 'input-leg'
  /**
   * Supply inverter only. False intentionally disconnects the inverter's grid AC input.
   * Missing remains backward-compatible and means connected.
   */
  converterGridInputConnected?: boolean
  /** Separate AC ports feed the common load through the inverter's internal transfer path. */
  converterAcConnection?: 'shared' | 'separate'
  /** Root-feed device downstream of the supply assembly handoff, before the panel bus. */
  supplyPanelInput?: boolean
  /** ISO installation date. Preferred over the legacy year override. */
  installationDate?: string
  /** Explicitly keeps automatic/version-derived installation dates off this entity. */
  installationDateSuppressed?: boolean
  /** Legacy year override for install-date annotations and ruleset selection. */
  rulesetDateOverride?: number
  /**
   * Generic one-wire label rendering options next to this trunk symbol.
   * For supply-wire protections (`installation.mainSupply.supplyTrunkDevices`), optional
   * `visibility.supplyProtectionNameLabel` toggles the device `label` above the symbol on the diagram.
   */
  symbolLabelDisplay?: SymbolLabelDisplayConfig
  /**
   * User-dragged one-wire metadata card position: card top-left relative to the
   * rendered symbol centre. Missing means automatic placement.
   */
  metadataCalloutOffset?: { x: number; y: number }
}

/** Domotica control option keys (any combination) */
export type DomoticaControlKey =
  | 'switch_control'
  | 'button_control'
  | 'external_switch'
  | 'external_button'
  | 'programmed_control'
  | 'wireless_control'
  | 'detection_control'

export type DomoticaSwitchType = '1p' | '2p' | 'impulse'

/**
 * Per-output wire overrides for a domotica module.
 * When unset for a given slot, the parent circuit's wire settings apply.
 */
export interface DomoticaOutputWireProps {
  /** Optional cable override for this output; falls back to the parent circuit cable when omitted. */
  cable?: CableSpec
  /** Optional phase assignment for this output; falls back to the parent circuit when omitted. */
  phaseAssignment?: CircuitPhaseAssignment
  /** When true, show the output's assigned phase in one-wire. Defaults off. */
  showPhaseLabel?: boolean
  /** Route flags for this specific output wire; fall back to the parent circuit when omitted. */
  inTube?: boolean
  wireRoute?: 'wall' | 'ground' | 'air'
  inWall?: boolean
  /** Optional per-output hide flag for the wire label; defaults to the parent circuit setting. */
  hideWireLabel?: boolean
  /** When true, show fire class below the wire label for this output (requires cable.fireClass). */
  showFireClassLabel?: boolean
  /** Wire run length in meters for this output. */
  wireLengthM?: number
  /** When true, show {@link wireLengthM} below the fire class on the one-wire diagram. */
  showWireLengthLabel?: boolean
}

/**
 * Domotica module configuration.
 * The parent domotica endpoint owns and orchestrates child endpoints via IDs.
 */
export interface DomoticaDeviceProps extends ControlDeviceFields {
  /** Enable optional control output wire on top of the domotica module. */
  switchControlEnabled?: boolean
  /** Switch type rendered on control output (only relevant when switchControlEnabled=true). */
  switchType?: DomoticaSwitchType
  /** Number of control switches (1-20). */
  switchCount?: number
  /** Number of endpoint outputs (1-20). */
  endpointCount?: number
  /** Child endpoint IDs that belong to control outputs (order = output index). */
  controlChildEndpointIds?: string[]
  /** Child endpoint IDs that belong to endpoint outputs (order = output index). */
  endpointChildEndpointIds?: string[]
  /**
   * Per-output wire overrides for domotica endpoint outputs.
   * Indexed by endpoint outputIndex; entries may be sparse.
   */
  endpointOutputWires?: DomoticaOutputWireProps[]
  /**
   * Per-output wire overrides for domotica control outputs.
   * Indexed by control outputIndex; entries may be sparse.
   */
  controlOutputWires?: DomoticaOutputWireProps[]
  /**
   * Selected control capabilities for the domotica module (any combination).
   * Used to drive control icons in the domotica 1draad symbol.
   */
  control?: DomoticaControlKey[]
  /**
   * Main device type rendered inside the domotica frame (lower section).
   * 'none' (or undefined) = no inner symbol; 'switch' or 'socket' = simplified representation.
   */
  mainDeviceType?: 'none' | 'switch' | 'socket'
  /** When mainDeviceType === 'switch': base switch symbol key to render. */
  mainSwitchSymbol?: SymbolKey
  /** When mainDeviceType === 'switch': visual switch options (poles, verklikkerlamp, …). */
  mainSwitchProps?: SwitchDeviceProps
  /** When mainDeviceType === 'socket': base socket symbol key to render. */
  mainSocketSymbol?: SymbolKey
  /** When mainDeviceType === 'socket': visual socket options (count, waterproof, overlays, …). */
  mainSocketProps?: SocketDeviceProps
  /** Legacy base symbol (kept for backward compatibility). */
  baseSymbol?: SymbolKey // one of: switch, switch_1p_twoway, switch_2p_twoway, switch_dimmer, switch_1p_changeover, switch_1p_pull, switch_impulse, switch_cross, socket, socket_gnd, socket_child, socket_gnd_child, relay
}

/**
 * Per-output-row label override. `tail` is appended to the label generated from the module,
 * so the row keeps following module renames; `literal` replaces the whole row label.
 */
export type DomoticaRowLabelOverride =
  | { kind: 'tail'; tail: string }
  | { kind: 'literal'; text: string }

/**
 * Marks an endpoint as a domotica child output of a parent domotica module.
 * Child endpoints remain real endpoints in the same circuit endpoint array.
 */
export interface DomoticaChildEndpointProps extends ControlAddressing {
  parentEndpointId: string
  outputGroup: 'control' | 'endpoint'
  outputIndex: number
}

export const CONTROL_SYSTEMS = ['knx', 'niko_hc', 'dali', 'loxone', 'other'] as const
/** Building control system of a device; only selects which address syntax warnings apply. */
export type ControlSystem = (typeof CONTROL_SYSTEMS)[number]

/** Physical identity of a control device. Every field is optional; absent means unspecified. */
export interface ControlDeviceFields {
  system?: ControlSystem
  /** Gateways only: system on the output side (e.g. KNX in, DALI out). */
  outputSystem?: ControlSystem
  /** Device address on its bus: KNX physical address `1.1.12`, Loxone extension, NHC module. */
  deviceAddress?: string
  /** Bus line or segment, e.g. a DALI line on a gateway. */
  line?: string
  /** Physical channel capacity; when absent it is derived from drawn outputs and connections. */
  channelCount?: number
}

/** Address of one connection on a control device (free text, never rejected). */
export interface ControlAddressing {
  /** Physical channel: KNX `C`, DALI short address `5`, Loxone `Q7`, NHC output `2`. */
  channel?: string
  /** Logical addresses the channel listens to: KNX group addresses, DALI groups. */
  groups?: string[]
}

/** Switch-specific props: poles and verklikkerlamp (indicator light) overlay */
export interface SwitchDeviceProps {
  /** For symbol 'switch': number of poles (1, 2, 3, or 4). Default 1. */
  poles?: 1 | 2 | 3 | 4
  /** For symbol 'switch_1p_twoway': when true use switch_2p_twoway. */
  twoPole?: boolean
  /** Draw verklikkerlamp (indicator light) overlay. Only for switch (1p/2p/3p), switch_1p_pull, and switch_impulse. */
  verklikkerlamp?: boolean
  /** For switch_impulse: number of switching locations. Values above 1 are shown on the symbol. */
  switchingCount?: number
}

/** Light point (regular light) overlays: safety, decentral, switch, on wall, waterproof */
export interface LightPointDeviceProps {
  /** Noodverlichting – emergency lighting circuit overlay (circle SVG) */
  safety?: boolean
  /** Decentral emergency lighting: safety circle + decentral square overlay */
  decentral?: boolean
  /** @deprecated Use decentral. Kept for imported/legacy projects. */
  autonomous?: boolean
  /** Switch (1 pole) overlay (SVG) */
  switch1p?: boolean
  /** On wall: line to the right of symbol (eendraad only, not sitplan) */
  onWall?: boolean
  /** Waterproof / weatherproof: show small "h" centered above symbol */
  waterproof?: boolean
}

/** Spot/projector beam type overlay */
export interface LightSpotDeviceProps {
  beamType?: 'none' | 'straight' | 'diverging'
}

/** Fluorescent tube count (lines drawn dynamically in symbol) */
export interface LightFluorescentDeviceProps {
  /** Number of tubes (1 = centered, 2 = over 25% height, 3 = evenly spaced). Default 1. */
  tubeCount?: 1 | 2 | 3
}

/** Fixed appliance props (e.g. boiler: accumulating variant) */
export interface FixedApplianceDeviceProps {
  /** When symbol === 'boiler': use accumulation boiler symbol */
  accumulating?: boolean
  /** When symbol === 'heating': use accumulation heating symbol */
  accumulationHeating?: boolean
  /** When symbol === 'heating' and accumulationHeating: use heating with fan symbol */
  withFan?: boolean
  /**
   * When symbol is an HVAC device (ventilation, boiler, heating, a downstream HVAC source, …):
   * derived from branch layout — the unit sits immediately after an HVAC source (furnace/heat
   * pump). Synced on branch changes. Enables the "add more" multiplier, mirroring lights.
   */
  chainedAfterHvacSource?: boolean
}

/** Solar panel specific props */
export interface SolarPanelDeviceProps extends EquipmentCertificationProps {
  /** Panel wattage in watts (e.g. 1000) */
  wattageW?: number
  /** Panel DC voltage in volts (e.g. 48) */
  voltageV?: number
  /** Derived from branch layout: immediately after a socket (synced on branch changes) */
  plugIn?: boolean
}

/** Battery specific props */
export interface BatteryDeviceProps extends EquipmentCertificationProps {
  /** Battery DC voltage in volts (e.g. 48) */
  voltageV?: number
  /** Battery capacity in kWh (e.g. 5) */
  capacityKWh?: number
  /** Rated power in kW (certification listing) */
  powerKw?: number
  /** Derived from branch layout: immediately after a socket (synced on branch changes) */
  plugIn?: boolean
}

export type HvacEnergySource =
  'electricity' | 'gas_fan' | 'gas_atmospheric' | 'liquid' | 'solid' | 'none'

export type HvacType = 'heat_exchange' | 'cogeneration' | 'tap_spiral' | 'boiler' | 'none'

export type HvacFunction = 'none' | 'heat' | 'cool' | 'heat_cool'

/** HVAC device props (furnace / heating-cooling source) */
export interface HvacDeviceProps {
  energySource?: HvacEnergySource
  hvacType?: HvacType
  hvacFunction?: HvacFunction
}

/** Certification / inspector listing fields shared by several device types (AREI). */
export interface EquipmentCertificationProps {
  brand?: string
  model?: string
  serialNumber?: string
  /** Ordered physical-unit serials for a multiplied supply device. */
  serialNumbers?: string[]
  synergrid?: SynergridCertification
}

/** Official Synergrid C10/26 list selection stored on the symbol after user confirmation. */
export interface SynergridCertification {
  source: 'synergrid_c10_26'
  sourceKey: string
  c10Reference: string
  sourceLastUpdate?: string
  approvalDate?: string
  isPlugAndPlay?: boolean
}

/** Energy conversion (transformer/rectifier/inverter/DC-DC) specific props */
export type TransformerSafetyType = 'none' | 'safety_closed' | 'safety_open'

export interface EnergyConversionDeviceProps {
  /** Number of independent DC connection blocks on a circuit or supply converter (1-4). */
  dcConnectionCount?: number
  /** Shared AC phase set used by every AC port of a supply-wire converter. */
  acPhaseAssignment?: CircuitPhaseAssignment
  /** Ordered per-unit AC assignments for a multiplied supply-wire inverter. */
  acPhaseAssignments?: CircuitPhaseAssignment[]
  /** Transformer: safety transformer type (none, gesloten/type closed, open/type open) */
  transformerSafetyType?: TransformerSafetyType
  /** Transformer: short-circuit-proof (Kortsluitvast) */
  transformerShortCircuitProtected?: boolean
  /** Transformer: protective transformer (Beschermingstransformator) */
  transformerProtected?: boolean
  /** Short text label drawn over transformer symbol */
  transformerOverlayLabel?: string
  /** Maximum power at primary voltage, in watts (Pmax U prim) */
  pMaxPrimaryW?: string
  /** Maximum power at secondary voltage, in watts (Pmax U sec) */
  pMaxSecondaryW?: string
  /** DC output voltage in volts (for rectifier/DC-DC output side sizing) */
  dcOutputVoltageV?: string
  /** Minimum DC input voltage in volts (for inverter input side sizing) */
  dcInputMinVoltageV?: string
  /** Inverter/rectifier: manufacturer (certification listing) */
  brand?: string
  /** Inverter/rectifier: model (certification listing) */
  model?: string
  /** Inverter/rectifier: serial number (certification listing) */
  serialNumber?: string
  /** Ordered inverter-unit serials; index matches the device's placement index. */
  serialNumbers?: string[]
  /** Inverter/rectifier: rated power (certification listing, e.g. "5 kW") */
  power?: string
  synergrid?: SynergridCertification
}

/** EV charger (symbol === 'ev') certification listing and AREI properties */
export interface EvChargerDeviceProps extends EquipmentCertificationProps {
  /** The charger includes coordinated residual-DC protection/detection (e.g. 6 mA DC detection). */
  integratedDcResidualProtection?: boolean
}

/** Socket-specific props: overlays drawn on top of the base socket symbol */
export interface SocketDeviceProps {
  /** Draw switch overlay on top of socket (socket_switchoverlay.svg) */
  switchOverlay?: boolean
  /** Draw switch overlay with lock on top (socket_switchoverlay_lock.svg) */
  switchOverlayLock?: boolean
  /** Waterproof / weatherproof: show small "h" in top right corner of symbol */
  waterproof?: boolean
  /** Number of physical sockets in this endpoint (1-4). Multiple sockets are drawn repeated & offset. Default 1. */
  socketCount?: number
  /**
   * Panel-mounted DIN modular socket. Electrically identical to a wall socket
   * (same one-wire symbol and rules). Shown in the panel view, omitted from the
   * situation plan, and limited to 1 or 2 outlets (2 or 4 modules).
   */
  modular?: boolean
}

/** Virtual control relation from an endpoint to the device that operates it. */
export interface EndpointControlLink extends ControlAddressing {
  /** Id of the operating device (a domotica module endpoint). May dangle after deletion. */
  deviceId: string
}

export interface Endpoint {
  id: string
  type: EndpointType
  label: string
  /** Shared physical identity, independent from the branch's automatic endpoint label. */
  junctionIdentity?: string
  /** Stable link to the junction asset this occurrence belongs to; `junctionIdentity` is its label. */
  junctionAssetId?: string
  /** Unique connection pin within the terminal strip identified by `junctionIdentity`. */
  terminalStripPin?: number
  /** Optional outgoing pin when an endpoint representation gains a second connection. */
  terminalStripOutgoingPin?: number
  /** Physical panel-canvas owner of an endpoint-form terminal strip; independent from circuit ownership. */
  terminalStripPanelId?: string
  symbol?: SymbolKey
  /**
   * Virtual "operated by" link to another device (currently a domotica module endpoint).
   * Carries no topology or wiring; the device side is always derived, never stored.
   */
  controlLink?: EndpointControlLink
  /** When symbol === 'panel_distribution', optional back-reference to the owning panel */
  panelId?: string
  controlledEndpointIds?: string[] // For switches: what they control (on same circuit)
  notes?: string
  /** Optional second comment used by the panel label editor. */
  labelNotes?: string
  /** Panel label cell source preferences. */
  panelLabel?: PanelLabelConfig
  /** If false, endpoint notes are not shown on the eendraad canvas. Default true. */
  notesVisible?: boolean
  placements: Placement[]
  /** When symbol === 'relay' */
  relayProps?: RelayDeviceProps
  /** When symbol === 'smoke_detector' */
  smokeDetectorProps?: SmokeDetectorDeviceProps
  /** When symbol === 'motion_detector' */
  motionDetectorProps?: MotionDetectorDeviceProps
  /** When symbol === 'energy_meter' */
  energyMeterProps?: EnergyMeterDeviceProps
  /** When symbol === 'domotica' */
  domoticaProps?: DomoticaDeviceProps
  /** When endpoint is generated/owned by a domotica parent module */
  domoticaChildProps?: DomoticaChildEndpointProps
  /** On the root endpoint of a domotica output row: custom row label. */
  domoticaRowLabel?: DomoticaRowLabelOverride
  /** When type === 'socket' — overlay options drawn on top of socket symbol */
  socketProps?: SocketDeviceProps
  /** When type === 'switch' — poles, twoPole, verklikkerlamp overlay */
  switchProps?: SwitchDeviceProps
  /** When symbol === 'light_point' — safety, autonomous, switch, onWall overlays */
  lightPointProps?: LightPointDeviceProps
  /** When symbol === 'light_spot' — beam type overlay */
  lightSpotProps?: LightSpotDeviceProps
  /** When symbol === 'light_fluorescent' — number of tubes */
  lightFluorescentProps?: LightFluorescentDeviceProps
  /** When type === 'fixed_appliance' — e.g. boiler accumulating variant */
  fixedApplianceProps?: FixedApplianceDeviceProps
  /** When symbol === 'solar_panel' — DC solar generator properties */
  solarPanelProps?: SolarPanelDeviceProps
  /** When symbol === 'battery' — DC storage properties */
  batteryProps?: BatteryDeviceProps
  /** When symbol === 'ev' — EV charger certification listing */
  evChargerProps?: EvChargerDeviceProps
  /** When symbol === 'furnace' — HVAC source options (energy, type, function) */
  hvacProps?: HvacDeviceProps
  /** When symbol is an energy conversion device (transformer/rectifier/inverter/DC-DC) */
  energyConversionProps?: EnergyConversionDeviceProps
  /** Endpoint chain attached to one widened circuit-trunk or DC-bus-branch converter output. */
  converterDcConnection?: {
    converterId: string
    connectionIndex: number
  }
  /** ISO installation date. Preferred over the legacy year override. */
  installationDate?: string
  /** Explicitly keeps automatic/version-derived installation dates off this entity. */
  installationDateSuppressed?: boolean
  /** Legacy year override for older project files. */
  rulesetDateOverride?: number
  /** Generic one-wire label rendering options next to this endpoint symbol. */
  symbolLabelDisplay?: SymbolLabelDisplayConfig
  /**
   * User-dragged one-wire metadata card position: card top-left relative to the
   * rendered symbol centre. A shared card stores it on its first target.
   * Missing means automatic placement.
   */
  metadataCalloutOffset?: { x: number; y: number }
}

export interface AttachedPoint {
  pointId: string // ID of the point that's attached
  wallId: string // ID of the wall this point belongs to
  pointIndex: number // Index in wall.points array
  t: number // Position along parent wall (0-1, where 0 = start, 1 = end)
}

export interface WallCurve {
  kind: 'rationalQuadratic'
  /** Weight applied to the middle control point. sqrt(1/2) yields an exact quarter circle for equal perpendicular legs. */
  weight: number
}

export interface Wall {
  id: string
  floorId: string // Redundant but useful for queries
  /** Straight-wall vertices, or [start, control, end] when curve is present. */
  points: Point2[] // At least 2 points (start, end)
  /** Standalone three-point curved wall. Curved walls intentionally cannot own openings. */
  curve?: WallCurve
  thickness?: number // Override master thickness (optional)
  attachedPoints?: AttachedPoint[] // Points from other walls attached to this wall
}

export interface Door {
  id: string
  floorId: string
  wallId: string // Parent wall
  /**
   * Normalised position along the wall in [0,1].
   * This is a derived view over the segment-local coordinates
   * (segmentIndex + centerAlongSegment) and is kept for backward
   * compatibility with existing projects and rendering code.
   */
  position: number
  /**
   * Index of the wall segment this opening belongs to. Together with
   * centerAlongSegment this is the canonical source of truth for the
   * opening's geometry along the wall.
   */
  segmentIndex?: number
  /**
   * Center position measured from the start of the owning segment,
   * in wall canvas units (pixels).
   */
  centerAlongSegment?: number
  width: number // Width in canvas units
  swing?: 'left' | 'right' | 'none' | 'double' // Door hinge configuration
  direction?: 'in' | 'out' // Door opens in or out
  /** Opening angle in degrees (e.g. 35). Optional; defaults to 35 when unset. */
  swingAngleDeg?: number
  isOpening?: boolean // If true, just an opening (no door)
}

export interface Window {
  id: string
  floorId: string
  wallId: string // Parent wall
  /**
   * Normalised position along the wall in [0,1].
   * This is derived from (segmentIndex + centerAlongSegment) and
   * kept for backward compatibility.
   */
  position: number
  /**
   * Index of the wall segment this opening belongs to.
   */
  segmentIndex?: number
  /**
   * Center position measured from the start of the owning segment,
   * in wall canvas units (pixels).
   */
  centerAlongSegment?: number
  width: number // Width in canvas units
}

export type StairCornerStyle = 'round' | 'sharp'
export type StairCornerMode = 'turn' | 'platform'

export interface Stair {
  id: string
  floorId: string
  points: Point2[] // Polyline path (at least 2 points)
  width: number // Stair width in canvas units
  stepDepth: number // Distance between step marks in canvas units
  /** Spiral center pole diameter in canvas units (optional). */
  spiralPoleDiameter?: number
  /** Spiral sweep in degrees (90–360). Defaults to a full turn. Only used for single-point spiral stairs. */
  spiralSweepDegrees?: number
  /** Rotation of the spiral sector around its center, in degrees. Only used for single-point spiral stairs. */
  spiralRotationDeg?: number
  cornerStyle: StairCornerStyle
  cornerMode: StairCornerMode
  /** Optional per-point override (point index -> point mode). */
  cornerModeOverrides?: Record<string, StairCornerMode>
  /** Draw repeated up-direction arrows on straight runs. */
  showUpArrow?: boolean
  /** Reverse the up-direction arrows relative to the stair point order. */
  invertUpArrow?: boolean
}

export type PlanGraphicElementKind =
  'bathtub' | 'shower' | 'washbasin' | 'toilet' | 'kitchen_cabinet' | 'car' | 'rectangle' | 'custom'

export interface PlanGraphicElement {
  id: string
  floorId: string
  kind: PlanGraphicElementKind
  assetId: string
  /** Center position in plan canvas coordinates. */
  pos: Point2
  width: number
  height: number
  rotationDeg?: number
  /** When true, dimensions are fixed by the asset definition. */
  sizeLocked?: boolean
  layer?: string
}

export interface FloorPlan {
  walls: Wall[]
  doors: Door[]
  windows: Window[]
  stairs?: Stair[]
  graphicElements?: PlanGraphicElement[]
  masterWallThickness: number // Default thickness (e.g., 20 pixels)
}

export type ImportedPlanAssetKind = 'raster' | 'pdf-vector' | 'pdf-raster' | 'cad-vector'

export function importedPlanAssetUsesSvgContent(kind: ImportedPlanAssetKind | undefined): boolean {
  return kind === 'pdf-vector' || kind === 'cad-vector'
}

export interface ImportedPlanAssetCrop {
  x: number
  y: number
  width: number
  height: number
}

export interface CadPoint3 {
  x: number
  y: number
  z?: number
}

export interface CadReferenceExtents {
  min: CadPoint3
  max: CadPoint3
}

export interface CadReferenceCropRect {
  x: number
  y: number
  width: number
  height: number
}

/** Versioned CAD import mapping for DXF overlay export (see docs-context/Future/dxf-electrical-overlay.md). */
export interface CadReferenceV1 {
  version: 1
  sourceKind: 'dxf' | 'dwg'
  sourceFileName: string
  sourceFingerprint: string
  cadImportSessionId: string

  insunitsRaw: number | null
  insunitsResolved: number
  metersPerCadUnit: number
  unitResolutionNote?: string

  fullSourceExtents: CadReferenceExtents | null
  uncroppedAssetSize: { width: number; height: number }

  extmin: CadPoint3 | null
  extmax: CadPoint3 | null
  yAxisUp: boolean

  isReferenceCrop: boolean
  cropInAssetSpace: CadReferenceCropRect
  cropInModelSpace: CadReferenceExtents
  referenceCropAssetRect?: CadReferenceCropRect

  svgNormalization: { scale: number; translateX: number; translateY: number }
  libreDwgToSvg: { translateX: number; translateY: number; scale: number; flipY: boolean }
  /** Parsed outer CAD→SVG affine matrix; authoritative for coordinate mapping. */
  cadToSvgMatrix?: { a: number; b: number; c: number; d: number; e: number; f: number }
  /** SVG viewBox from import conversion; used for inverse coordinate mapping at export. */
  rawViewBox?: { x: number; y: number; width: number; height: number }

  /** Editor-only alignment; not used as the sole export offset. */
  planImageOffset: { x: number; y: number }

  controlPoints?: Array<{ cad: { x: number; y: number }; asset: { x: number; y: number } }>
  capturedAt: string
}

export interface ImportedPlanAsset {
  id: string
  kind: ImportedPlanAssetKind
  sourceName?: string
  pageIndex?: number
  pageCount?: number
  width: number
  height: number
  dataUrl?: string
  processedDataUrl?: string
  svgContent?: string
  hasWhiteBackground?: boolean
  /** If true, adapt this imported asset for dark mode rendering. */
  darkModeAware?: boolean
  /** Vector plans: draw in greyscale; the stored SVG keeps its colours. */
  grayscale?: boolean
  crop?: ImportedPlanAssetCrop
  /** Present on CAD-derived plan assets; required for DXF overlay export. */
  cadReference?: CadReferenceV1
}

export interface Floor {
  id: string
  name: string
  /** Persistent plan image offset in canvas coordinates for this floor. */
  planImageOffset?: Point2
  /** Clockwise plan image rotation in degrees around `planImageOffset` (the image origin). */
  planImageRotationDeg?: number
  /** Persistent plan image opacity percentage (0-100) for this floor. */
  planImageOpacity?: number
  /**
   * Situation-plan symbol size in centimetres (same range as the visibility slider).
   * Stored on the floor so export/import keeps it with the project.
   */
  sitplanSymbolSizeCm?: number
  planAsset?: string // Reference to imported plan asset
  planAssetProcessed?: string // Processed version with white background removed
  planAssetHasWhiteBackground?: boolean // Whether the original had a white background
  /** Canonical imported-asset model (supports raster and PDF pages). */
  planImportAsset?: ImportedPlanAsset
  scale?: {
    pxPerMeter?: number
    reference?: {
      p1: Point2
      p2: Point2
      meters: number
      /** Coordinate system used by ruler points; absent on legacy calibrations. */
      coordinateSpace?: 'asset'
      /** Floor owning these asset-local ruler points. Absent on older files. */
      floorId?: string
    }
  }
  /** Imported plan has not yet been calibrated against a known distance. */
  planScaleNeedsCalibration?: boolean
  layers?: string[]
  floorPlan?: FloorPlan
  /** Placement IDs that are hidden on the situation plan (sitplan) view for this floor. */
  hiddenSitplanPlacementIds?: string[]
}

export type Rotation = 0 | 90 | 180 | 270

/** Clockwise situation-plan angle. Auto-oriented symbols beside curved walls may use any degree value. */
export type SituationPlanRotation = number

export interface Placement {
  id: string
  floorId: string
  layer: string
  pos: Point2
  rotationDeg: SituationPlanRotation
  /** Set after a user rotates the situation-plan symbol with R. Missing means auto-rotation may apply. */
  rotationMode?: 'explicit'
  scale: number
  locked?: boolean // If true, position cannot be moved
  style?: Record<string, unknown>
}

export type PlanWireKind = 'lighting-control' | 'sockets' | 'other'
export type PlanWireRouteStyle = 'spline' | 'orthogonal' | 'straight'
export type PlanWireSource = 'auto' | 'manual'

export interface PlanWireEndpointRef {
  endpointId: string
  /** Supply/circuit trunk-device anchor. `endpointId` remains its stable compatibility id. */
  trunkDeviceId?: string
  placementId?: string
}

/**
 * Spatial wire trace shown on the situation plan. Endpoints stay attached to
 * symbols; waypoints are user-controlled shaping points in plan coordinates.
 */
export interface PlanWireRoute {
  id: string
  kind: PlanWireKind
  source: PlanWireSource
  circuitId: string
  panelId?: string
  branchId?: string
  floorId: string
  from: PlanWireEndpointRef
  to: PlanWireEndpointRef
  waypoints?: Point2[]
  style?: PlanWireRouteStyle
  hidden?: boolean
  locked?: boolean
  notes?: string
  /** One-wire wire anchor of the cable this trace draws, when derived from cable routing. */
  wireAnchor?: string
  /** Other anchors of the same physical cable (e.g. the feeder's wire on the source board). */
  wireAnchorAliases?: string[]
  /**
   * The cable arrives from another floor: the trace starts at a riser instead of at `from`'s
   * symbol. `pos` moves the riser; absent, it sits at `from`'s plan position.
   */
  riser?: { fromFloorId: string; pos?: Point2 }
  /**
   * Derived only: the source-floor part of a cable that leaves for another floor. It runs from
   * `from` to the riser, the same passage as `riser` on the arrival trace `arrivalRouteId`,
   * which reaches `arrivalTo`. A floor passage is shared by every cable leaving `from` for the
   * same floor.
   */
  riserExit?: {
    toFloorId: string
    arrivalRouteId: string
    arrivalTo: PlanWireEndpointRef
    pos?: Point2
  }
}

/** Sitplan wire layer visibility and default draw style; stored on the project. */
export interface PlanWiringVisibility {
  wiresVisible?: boolean
  lightingVisible?: boolean
  socketsVisible?: boolean
  otherVisible?: boolean
  /** Cable routing: wires from the board to the first point of a circuit. */
  homeRunsVisible?: boolean
  /** Cable routing: wires between lighting branches (live feed looped between switches). */
  branchFeedsVisible?: boolean
  /** Cable routing: supply cables (inverter, solar panels, batteries) and earthing; default shown. */
  supplyVisible?: boolean
  /** Cable routing: colour wires by group outside wire mode too (wire mode always does). */
  colorCoded?: boolean
  /** Wire-tool master visibility; independent of wiresVisible and enabled on every entry. */
  wireToolWiresVisible?: boolean
  /** Wire-tool colour groups; omitted groups are visible. Independent of ordinary plan filters. */
  wireToolCategoriesVisible?: Partial<
    Record<'lighting' | 'sockets' | 'devices' | 'feeders' | 'supply' | 'dc' | 'earthing' | 'other', boolean>
  >
  /** Cable routing: mounting heights the length estimate assumes, in metres. */
  cableRouteSettings?: PlanCableRouteSettings
  defaultStyle?: PlanWireRouteStyle
}

export interface PlanCableRouteSettings {
  /** Floor-to-floor height, also the ceiling level, for floors without their own height. */
  floorHeightM?: number
  socketHeightM?: number
  switchHeightM?: number
  panelHeightM?: number
}

export interface PlanWiringModel {
  version: 1
  routes: PlanWireRoute[]
  visibility?: PlanWiringVisibility
}

/** One physical junction panel on the sitplan. Multiple 1draad symbols can share the same label (one placement). */
export interface JunctionPanelPlacement {
  id: string
  label: string
  floorId: string
  pos: Point2
  rotationDeg?: SituationPlanRotation
  rotationMode?: 'explicit'
  scale?: number
  layer?: string
}

/** Earthing (ground) symbol on the situation plan — one per floor when shown. */
export interface EarthingPlacement {
  id: string
  floorId: string
  pos: Point2
  rotationDeg?: SituationPlanRotation
  rotationMode?: 'explicit'
  scale?: number
  layer?: string
  locked?: boolean
}

export type InstallationProfile = 'household' | 'non_household'

export interface Installation {
  /** Installation use category. Missing values are interpreted as household for backward compatibility. */
  installationProfile?: InstallationProfile
  address: {
    street: string
    postalCode: string
    city: string
    country: string
  }
  nominalVoltage: {
    system: '1~' | '2~' | '1N~' | '3~' | '3N~' | 'DC'
    uLineToNeutral: number
    uLineToLine: number
  }
  /** Incoming grid/supply side before any root split. Cable spec here is the single source of truth when there is only one main panel. */
  mainSupply: {
    /** Utility / supply-panel side: from supply symbol through shared trunk devices to the dashed separator. */
    cable: CableSpec
    /** Segment at the dashed separator between supply panel and main panel (optional; defaults to `cable`). */
    crossingCable?: CableSpec
    /** Main-panel side when there is a single main panel (optional; defaults to `cable`). With multiple mains, use `feedTopology.rootFeeds[].cable`. */
    rootCable?: CableSpec
    origin?: 'grid' | 'generator' | 'pv_inverter' | 'unknown'
    /** @deprecated Prefer role-specific flags; still synced for downstream on single-main installs. */
    hideWireLabel?: boolean
    /** Hide cable label on upstream supply segments (utility → separator). `false` = shown. */
    hideWireLabelUpstream?: boolean
    /** Hide cable label on the panel-boundary (crossing) segment. `false` = shown. */
    hideWireLabelCrossing?: boolean
    /** Hide cable label on downstream supply (root trunk + vertical to bus). `false` = shown. */
    hideWireLabelDownstream?: boolean
    /** Show fire class on upstream supply segments when cable has `fireClass`. */
    showFireClassLabelUpstream?: boolean
    /** Show fire class on crossing supply segments when cable has `fireClass`. */
    showFireClassLabelCrossing?: boolean
    /** Show fire class on downstream supply segments when cable has `fireClass`. */
    showFireClassLabelDownstream?: boolean
    /** Wire length in meters for upstream supply segments. */
    wireLengthMUpstream?: number
    /** Wire length in meters for crossing supply segments. */
    wireLengthMCrossing?: number
    /** Wire length in meters for downstream supply segments. */
    wireLengthMDownstream?: number
    /** Show wire length on upstream supply segments when {@link wireLengthMUpstream} is set. */
    showWireLengthLabelUpstream?: boolean
    /** Show wire length on crossing supply segments when {@link wireLengthMCrossing} is set. */
    showWireLengthLabelCrossing?: boolean
    /** Show wire length on downstream supply segments when {@link wireLengthMDownstream} is set. */
    showWireLengthLabelDownstream?: boolean
    /** Devices on the supply wire (energy meters, protection devices).
     *  Drawn on the horizontal supply wire between supply symbol and main bus. */
    supplyTrunkDevices?: TrunkDevice[]
    /**
     * @deprecated Prefer {@link SupplyWireRole} segments (`upstream` / `crossing` / `downstream`).
     * Legacy per-index overrides between consecutive trunk devices.
     */
    supplyTrunkSegmentCables?: Array<{ panelId: string; segmentIndex: number; cable: CableSpec }>
  }
  /**
   * Upstream path: shared trunk (meters/breakers before the split) → optional per-panel root feeds.
   * `sharedFeed.cable` is kept equal to `mainSupply.cable` by `ensureInstallationFeedTopology`.
   * When there is exactly one main panel, `rootFeeds[].cable` is omitted — use `mainSupply.cable`.
   * With multiple main panels, `rootFeeds[].cable` may differ per panel (drop from split to that board).
   */
  feedTopology?: FeedTopology
  /** Ground cable specification (separate from supply cable) */
  groundCable?: CableSpec
  /**
   * Cable type followed by AC circuit wires nobody has edited. Missing = `XVB`, the seed kind of
   * new circuits, so older projects render unchanged.
   */
  defaultCableKind?: CableSpec['kind']
  hasGround?: boolean // Flag: show the shared earth electrode on main boards (default true). Secondary boards use Panel.hasGround.
  /** Devices on the shared ground wire (earthing separators).
   *  Drawn on the vertical ground wire between ground symbol and main bus. */
  groundTrunkDevices?: TrunkDevice[]
  /** Sitplan placements for junction panels (one per unique label). */
  junctionPanelPlacements?: JunctionPanelPlacement[]
  /** Sitplan placements for the earthing symbol (typically one per floor). */
  earthingPlacements?: EarthingPlacement[]
  notes?: string
  /** Global orientation for circuit notes on eendraad: vertical on new projects; horizontal when unset (legacy). */
  circuitNotesOrientation?: 'horizontal' | 'vertical'
  /** Shared note orientation for devices on attached supply wires; detached assemblies stay horizontal. */
  supplyTrunkNotesOrientation?: 'horizontal' | 'vertical'
  /**
   * When true, main-bus circuit/protection letters follow placement order per panel (A, B, C, …)
   * and are rewritten whenever bus order changes.
   */
  eendraadAutomaticNaming?: boolean
  /**
   * When true with {@link eendraadAutomaticNaming}, feeder-only parent rows (no outlets but
   * {@link Circuit.subCircuitIds}) get no auto label and stay manually editable. Empty circuits
   * without sub-circuits keep the letter visible.
   */
  eendraadAutoNamingHideFeederLetters?: boolean
  /**
   * @deprecated Use {@link eendraadAutoNamingHideFeederLetters}. Kept for migration only.
   */
  eendraadAutoNamingSkipParentCircuits?: boolean
  /**
   * When true, panels are labeled B01, B02, … on the one-wire diagram (off by default).
   */
  panelNumberingEnabled?: boolean
  /** Show net / feed / earthing lines on panel headers (independent of panel numbering). */
  panelNetTypeLabelsEnabled?: boolean
}

export interface FeedConnectorNode {
  id: string
  kind: 'connector'
  role: 'root_split'
}

export interface FeedSegmentCableOverride {
  segmentIndex: number
  cable: CableSpec
}

/** Independently editable physical wire run between two supply devices or terminals. */
export interface FeedWireSectionProperties {
  cable: CableSpec
  wireRoute?: 'wall' | 'ground' | 'air'
  inTube?: boolean
  inWall?: boolean
  hideWireLabel?: boolean
  showFireClassLabel?: boolean
  wireLengthM?: number
  showWireLengthLabel?: boolean
}

export interface SharedFeedPath {
  id: string
  kind: 'shared'
  connectorId: string
  /** Denormalized copy of `installation.mainSupply.cable`; do not treat as an independent editable source. */
  cable: CableSpec
  origin?: 'grid' | 'generator' | 'pv_inverter' | 'unknown'
  hideWireLabel?: boolean
  trunkDevices?: TrunkDevice[]
  segmentCables?: FeedSegmentCableOverride[]
}

export interface RootPanelFeedPath {
  id: string
  kind: 'root_panel'
  connectorId: string
  panelId: string
  /** Optional destination bus section. Missing targets the panel's primary/legacy main bus. */
  busSectionId?: string
  /** Omitted when there is only one main panel (`mainSupply.cable` applies). Set when multiple mains may use different drops. */
  cable?: CableSpec
  /** Optional phase set carried by this panel's private supply section. */
  phaseAssignment?: CircuitPhaseAssignment
  /** Show the incoming phase beside this panel's supply wire. Defaults off. */
  showPhaseLabel?: boolean
  hideWireLabel?: boolean
  showFireClassLabel?: boolean
  wireLengthM?: number
  showWireLengthLabel?: boolean
  trunkDevices?: TrunkDevice[]
  segmentCables?: FeedSegmentCableOverride[]
  /** Stable per-run overrides for supply-frame wires that are not assembly connections. */
  wireSections?: Record<string, FeedWireSectionProperties>
}

export interface FeedTopology {
  version: 1
  rootConnector: FeedConnectorNode
  sharedFeed: SharedFeedPath
  rootFeeds: RootPanelFeedPath[]
}

export interface WireSegment {
  /** Derived electrical connection identity; never a persisted WireRun id. */
  wireAnchor?: string
  /** All connections represented by shared stem geometry. */
  wireAnchors?: string[]
  /** Shared electrical bus represented by rail geometry. */
  wireBusGroup?: string
  id: string
  type: 'trunk' | 'branch' | 'vertical' | 'mainBus' | 'secondaryBus'
  startPoint: Point2
  endPoint: Point2
  cable: CableSpec
  /** Electrical domain of this segment (AC or DC). Default for new wires: AC. */
  domain?: ElectricalDomain
  /** Effective typed phase/conductor assignment carried by this segment. */
  phaseAssignment?: CircuitPhaseAssignment
  /** Effective phase-label visibility carried by this segment. */
  showPhaseLabel?: boolean
  /** Mandatory source-boundary annotation; cannot be hidden by wire label preferences. */
  forcePhaseLabel?: boolean
  /** Optional derived canvas anchor for a mandatory phase label. */
  phaseLabelAnchor?: Point2
  installationType?: 'in-wall' | 'in-tube' | 'surface' | 'conduit'
  inTube?: boolean // Flag: wire is in tube (independent)
  inWall?: boolean // @deprecated use wireRoute === 'wall'
  /** Route: wall, ground, or air. Mutually exclusive. */
  wireRoute?: 'wall' | 'ground' | 'air'
  hideWireLabel?: boolean // Flag: hide wire label on vertical wire
  /** Optional end of the first physical run, used for labels and route decorations when the drawable trunk continues higher. */
  wireLabelEndPoint?: Point2
  /** Derived label-only boundary near the circuit base; does not limit route decorations. */
  wireLabelBaseEndPoint?: Point2
  /** When true, show cable fire class below the wire label on the one-wire diagram. */
  showFireClassLabel?: boolean
  /** Wire run length in meters (derived from circuit/section overrides or supply settings). */
  wireLengthM?: number
  /** True when {@link wireLengthM} is an accepted plan estimate rather than an entered length. */
  wireLengthEstimated?: boolean
  /** When true, {@link wireLengthM} is drawn below the fire class on the one-wire diagram. */
  showWireLengthLabel?: boolean
  conduitType?: string
  notes?: string
  // References to connected elements
  fromElementId?: string // protection, endpoint, etc.
  fromElementType?: 'protection' | 'endpoint' | 'rcd' | 'mainBus' | 'secondaryBus' | 'ground'
  toElementId?: string
  toElementType?: 'protection' | 'endpoint' | 'rcd' | 'mainBus' | 'secondaryBus'
  circuitId?: string // For branch wires
  panelId: string
  /** Top-level panel bus section represented by this busbar or incoming stub. */
  busSectionId?: string
  /** Derived source marker shown on a bus-section incoming stub. */
  busFeedKind?: 'grid' | 'backup'
  showBusFeedMarker?: boolean
  /** Optional side placement used by compact detached-supply rail markers. */
  busFeedMarkerSide?: 'left' | 'right' | 'below' | 'below-left' | 'below-right' | 'stub-center'
  /** Ephemeral one-wire frame identity when one panel renders in multiple frames. */
  diagramId?: string
  /** True for horizontal supply trunk segments (between supply symbol and main bus). */
  isSupplyTrunk?: boolean
  /** True for a sub-panel incoming supply wire segment (parent panel feeder shown inside child panel). */
  isSubPanelSupply?: boolean
  /** When true, allow cable/route label on the short main/secondary-bus → feeder stub (panel-only sub-panel feeders). */
  showWireLabelOnBusStub?: boolean
  /** Panel-only merged bus→panel vertical: hidden feeder protection id for legacy section overrides (bus→protection). */
  feederProtectionId?: string
  /**
   * @deprecated Use {@link supplyWireRole}. Legacy index on the supply trunk horizontal run.
   */
  supplySegmentIndex?: number
  /**
   * Supply trunk segment role: utility side (`upstream`), dashed separator (`crossing`),
   * or main-panel side including the vertical to the bus (`downstream`).
   */
  supplyWireRole?: 'upstream' | 'crossing' | 'downstream'
  /** Canonical dashed panel-boundary X carried by the horizontal crossing segment. */
  supplySeparatorX?: number
  /** Derived enclosure transition carried by the physical supply-assembly connection. */
  supplyEnclosureBoundary?: boolean
  /** Bus-drop vertical that also includes the bus-side crossing run (no trunk device before the separator). */
  supplyMergesCrossingToBus?: boolean
  /** Horizontal crossing run absorbed into the bus drop; not a separate property segment. */
  supplyMergedIntoBusDrop?: boolean
  /** Feed path for supply trunk segments (shared = supply panel, root = main panel). */
  supplyFeedScope?: 'shared' | 'root'
  /** Canonical supply-assembly connection represented by this drawable segment. */
  supplyAssemblyId?: string
  supplyConnectionId?: string
  /** Stable physical run between supply devices/terminals; orthogonal pieces share one key. */
  supplySectionKey?: string
  /** When this segment is a domotica module output wire, group indicates 'endpoint' or 'control'. */
  domoticaOutputGroup?: 'endpoint' | 'control'
  /** When this segment is a domotica module output wire, index is the absolute output index within that group. */
  domoticaOutputIndex?: number
  /** Widened ordinary circuit-trunk converter DC connection represented by this segment. */
  converterDcConnection?: { converterId: string; connectionIndex: number }
  /** Small repeated label shown under long secondary busbars to identify the parent circuit/protection. */
  secondaryBusReferenceLabel?: string
  /** Export-only source label for secondary busbar slices, present on every segment in the busbar. */
  secondaryBusReferenceExportLabel?: string
}

/** Text formatting style */
export interface TextFormatting {
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

/** Note/Label element for eendraad canvas or sitplan */
export interface Note {
  id: string
  text: string
  fontSize: number // Font size in pixels (typical range ~2–48 for canvas notes)
  formatting?: TextFormatting // Optional text formatting
  pos: Point2 // Position on canvas or floor plan
  /** For eendraad notes: which panel this note belongs to */
  panelId?: string
  /** For sitplan notes: which floor this note is on */
  floorId?: string
}

/** One explicit member of a mixed or extended eendraad frame (supply/ground trunk, endpoint, etc.) */
export interface FrameContentItem {
  id: string
  kind: 'endpoint' | 'protection' | 'trunkDevice' | 'ground'
}

/**
 * Dynamic inclusion on a circuit trunk: all trunk devices with trunkPosition in
 * [minTrunkPosition, maxTrunkPosition] belong to the frame (recomputed as devices are inserted).
 */
export interface FrameTrunkSpan {
  circuitId: string
  minTrunkPosition: number
  maxTrunkPosition: number
}

/** Frame/Box element for grouping items on eendraad canvas */
export interface Frame {
  id: string
  title: string // Title shown at top left corner
  fontSize: number // Font size for title in pixels (reasonable limits: 6-24)
  /** Where to show the title: inside the box (with top padding) or outside above it */
  titlePosition: 'inside' | 'outside'
  /** IDs of content items (endpoints, protections, trunk devices, or ground symbols) */
  contentIds: string[]
  /** Type of content this frame contains (for validation) */
  contentType: 'endpoint' | 'protection' | 'trunkDevice' | 'ground' | 'mixed'
  /** For eendraad frames: which panel this frame belongs to */
  panelId: string
  /** Explicit members (used with mixed frames or supply/ground trunk devices). */
  contentItems?: FrameContentItem[]
  /** Per-circuit trunk position ranges (circuit trunk devices only). */
  trunkSpans?: FrameTrunkSpan[]
}

/** Explicit data state for items that can be orphaned or recovered */
export type OrphanStatus =
  'valid' | 'orphaned' | 'danglingReference' | 'invalidGeometry' | 'quarantined'

/** Reason an item was moved to quarantine (for recovery/debugging) */
export type OrphanReason =
  | 'circuitMissingProtection'
  | 'circuitRefMismatch'
  /** Circuit is referenced by multiple protections instead of being owned by exactly one. */
  | 'protectionReferenceConflict'
  | 'endpointNotInBranch'
  | 'branchRefsMissingEndpoint'
  | 'frameContentOrphan'
  | 'subCircuitIdMissingCircuit'
  /** Circuit lists its own id in subCircuitIds (invalid nest); one-line view may hide the circuit while pickers still see it */
  | 'subCircuitSelfReference'
  | 'endpointOnPanelCircuit'
  | 'endpointMultipleFloorPlacements'
  | 'endpointPlacementIntegrity'
  /** Two or more plan symbols share one placement identity and cannot be selected independently. */
  | 'planPlacementIdentityConflict'
  | 'endpointMissingPlanPlacement'
  | 'domoticaChildLinkMismatch'
  | 'panelDistributionLabelDrift'
  | 'panelMissingOneWireSymbol'
  | 'branchMultiplierEndpointsSplit'
  | 'panelGridDuplicateModule'
  /** Supply trunk device slotted on main panel grid instead of supply strip (one-line vs canvas mismatch). */
  | 'supplyTrunkMisplacedInMainGrid'
  /** Supply trunk device has no reachable panel-canvas placement for its physical mounting. */
  | 'supplyTrunkVisualPlacementMissing'
  /** Main panel retains multiple source bus sections without a connected backup supply path. */
  | 'splitBusWithoutBackupSupply'
  | 'danglingReference'
  | 'invalidGeometry'

/** Quarantined item: full data + metadata for recovery. Excluded from normal render/save behavior until restored or deleted. */
export interface QuarantinedItem {
  id: string
  kind: 'circuit' | 'endpoint'
  /** Full copy of the entity at quarantine time */
  data: Circuit | Endpoint
  reason: OrphanReason
  /** ISO timestamp when quarantined */
  timestamp: string
  panelId: string
  /** Where it lived before (for restore). For circuit: protection id that owned it. For endpoint: circuit id. */
  originalParentId?: string
  /** For circuit: id of the circuit that had it in subCircuitIds (if any). For endpoint: branch id if known. */
  originalRefId?: string
}

export interface ProjectAddress {
  street: string
  number?: string
  postalCode: string
  city: string
  country: string
}

export interface ProjectPartyContact {
  name: string
  companyNumber?: string
  email?: string
  mobile?: string
  phone?: string
  address?: ProjectAddress
}

export interface ProjectCustomerContact extends ProjectPartyContact {
  meterEanCode?: string
  siteAddress?: ProjectAddress
}

export interface Project {
  schemaVersion: '0.2.0'
  project: {
    id: string
    name: string
    createdAt: string
    updatedAt: string
    /** Last selected sitplan floor in the editor for this project. */
    lastActiveFloorId?: string
    /** Last selected panel (kast) in the editor; any panel id in the tree. */
    lastActivePanelId?: string
    /**
     * Last viewport layout (which canvases, preset, split ratios). Zoom/pan are not stored;
     * opening a project runs fit-to-view on visible canvases.
     */
    lastViewportLayout?: ViewportLayout
    /** Per-base-floor reference overlay visibility state for plan draw mode. */
    planFloorOverlayVisibleByBaseFloorId?: Record<string, string[]>
    /** Automatically learned creation properties from the last edited protection of each type. */
    protectionCreationTemplates?: Partial<Record<ProtectionType, ProtectionCreationTemplate>>
    locale?: string
    /** Building construction year; separate from electrical installation dates. */
    yearOfConstruction?: number
    /** Project-level color overrides for install-date annotations, keyed by year. */
    installDateColors?: Record<string, string>
    /** Optional meter EAN code (Belgian electricity meter identifier). */
    meterEanCode?: string
    /** Optional customer metadata imported from external tools (for future UI use). */
    customer?: ProjectCustomerContact
    /** Optional control/inspection organism metadata imported from external tools. */
    inspectionAgency?: ProjectPartyContact
    /** Show the inspection agency as a fourth, left-most column in every drawing info block. */
    showInspectionAgencyInInfoBlock?: boolean
    /** Optional per-project installer override; when set, used instead of global installer profile. */
    installerOverride?: {
      name: string
      address: {
        street: string
        postalCode: string
        city: string
        country: string
      }
      companyNumber?: string
      email?: string
      mobile?: string
      phone?: string
      signatureDataUrl: string | null
      logoDataUrl: string | null
    }
    /** Optional sidecar references for imported source files. */
    importSources?: {
      trik?: {
        /** Original filename as provided by the user (e.g. "project.trik"). */
        originalFilename: string
        /** ISO timestamp when the import happened. */
        importedAt: string
        /** Content hash for dedupe/analytics correlation (sha256 hex). */
        sha256?: string
        /** Raw size in bytes of the original payload. */
        sizeBytes?: number
        /** MIME type for the original file (typically application/xml). */
        mimeType: string
        /**
         * Data URL containing the original source payload, or an assets/ path when exported as ZIP.
         * (ZIP import hydrates assets/ paths back into data URLs.)
         */
        dataUrl: string
      }
      /** Parsed Schematicals text export (JSON in a data URL). Dev import pipeline; mapping to native graph is incremental. */
      schematicals?: {
        /** Archive filename, or a placeholder when importing from a folder picker. */
        originalFilename: string
        importedAt: string
        sha256?: string
        sizeBytes?: number
        mimeType: string
        dataUrl: string
      }
    }
  }
  installation: Installation
  panels: Panel[] // Hierarchical structure
  floors: Floor[] // Independent spatial structure
  planWiring?: PlanWiringModel // Spatial wire traces for the situation plan
  wireSegments?: WireSegment[] // Wire segments for eendraad view
  eendraadNotes?: Note[] // Notes/labels for eendraad canvas
  sitplanNotes?: Note[] // Notes/labels for sitplan (floor-specific via floorId)
  eendraadFrames?: Frame[] // Frames/boxes for grouping items on eendraad canvas
  /** Items moved to quarantine due to orphan/dangling state; preserved for recovery, excluded from normal render */
  quarantinedItems?: QuarantinedItem[]
  /** V2-first project chronology; transitional runtime field while editors still mutate compatibility data. */
  chronology?: import('./projectV2').ChronologyModelV2
}

/** Metadata shared by legacy import documents and the native V2 project envelope. */
export type ProjectMetadata = Project['project']
