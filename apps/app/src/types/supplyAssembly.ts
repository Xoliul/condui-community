import type {
  AcPhase,
  BatteryDeviceProps,
  CableSpec,
  ElectricalDomain,
  Installation,
  PanelGridConfig,
  Placement,
  Point2,
  ProtectionDevice,
  SolarPanelDeviceProps,
  SymbolKey,
  SynergridCertification,
  DomoticaDeviceProps,
} from '@/types/schema'

export const SUPPLY_ASSEMBLY_GRAPH_VERSION = 1 as const

export type SupplyAssemblyGraphVersion = typeof SUPPLY_ASSEMBLY_GRAPH_VERSION
export type LiveAcPhase = Exclude<AcPhase, 'N' | 'PE'>
export type SupplyConductor = AcPhase | 'DC+' | 'DC-'
export type SupplyElectricalDomain = ElectricalDomain | 'PE'

export type SupplyPortRole =
  | 'utility-ac'
  | 'grid-distribution-ac'
  | 'inverter-grid-ac'
  | 'inverter-backup-ac'
  | 'source-grid-ac'
  | 'source-backup-ac'
  | 'load-ac'
  | 'serial-source-side'
  | 'serial-load-side'
  | 'battery-dc'
  | 'dc-bus'
  | 'solar-dc'
  | 'protective-earth'
  | 'panel-handoff'

export type SupplyPortBehavior = 'source' | 'sink' | 'bidirectional' | 'passive'

export interface SupplyPort {
  id: string
  role: SupplyPortRole
  domain: SupplyElectricalDomain
  behavior: SupplyPortBehavior
  conductors: SupplyConductor[]
  maxConnections: number | 'many'
  constraints?: {
    voltageSystems?: Installation['nominalVoltage']['system'][]
    nominalVoltageV?: number
  }
}

export interface SupplyPortRef {
  nodeId: string
  portId: string
}

export type ElectricalEnclosureRef =
  | { kind: 'grid' }
  | { kind: 'panel'; panelId: string }
  | { kind: 'auxiliary'; enclosureId: string }

export interface ChangeoverSwitchProperties {
  switchingMode: 'manual'
  transition: 'break-before-make'
  poles: 1 | 2 | 3 | 4
  switchedConductors: AcPhase[]
  neutralTreatment: 'not-present' | 'solid' | 'switched'
  port1Label?: string
  port2Label?: string
}

export type SupplyProtectionProperties = Pick<
  ProtectionDevice,
  | 'type'
  | 'ratingA'
  | 'curve'
  | 'sensitivityMa'
  | 'residualCurrentType'
  | 'breakingCapacityKa'
  | 'breakingCapacityOption'
  | 'surgeProtectionKind'
  | 'polesConfig'
  | 'poles'
  | 'notes'
>

export interface BackupSourceCapabilities {
  supportsBackupSupply: boolean
  supportsIslandMode: boolean
  hasBidirectionalGridPort?: boolean
  hasDedicatedBackupAcOutput?: boolean
  hasBatteryDcPort?: boolean
  hasIntegratedSolarDcInput?: boolean
  requiresExternalChangeover?: boolean
  requiresExternalGroundRelay?: boolean
  supportedNeutralTreatments?: Array<'not-present' | 'solid' | 'switched'>
  supportedVoltageSystems?: Installation['nominalVoltage']['system'][]
  evidence?:
    | { source: 'manual' }
    | { source: 'synergrid'; sourceKey: string }
    | { source: 'curated-model'; modelCapabilityKey: string }
}

export interface BackupSourceUse {
  enabledForBackup: boolean
  enabledForIslandMode: boolean
}

export interface GeneratorSourceProperties {
  capabilities: BackupSourceCapabilities
  use: BackupSourceUse
  ratedPowerW?: number
}

export type SupplyNodeKind =
  | 'utility-source'
  | 'ac-distribution'
  | 'changeover-switch'
  | 'inverter-unit'
  | 'battery'
  | 'solar-source'
  | 'dc-bus'
  | 'protection'
  | 'panel-handoff'
  | 'generator-source'
  | 'integrated-transfer'

export type SupplyWorkspaceSymbolKey = 'generator_source' | 'integrated_transfer'

export interface SupplyNodeBase<K extends SupplyNodeKind, P> {
  id: string
  /** Canonical physical-device record. Omitted for virtual topology nodes and legacy graphs. */
  deviceId?: string
  kind: K
  /** Legacy/fallback presentation snapshot; resolve through `deviceId` when available. */
  label?: string
  /** Legacy/fallback presentation snapshot; resolve through `deviceId` when available. */
  symbol: SymbolKey | SupplyWorkspaceSymbolKey
  ports: SupplyPort[]
  mounting?: {
    enclosure: ElectricalEnclosureRef
  }
  properties: P
}

export type SupplyNode =
  | SupplyNodeBase<'utility-source', { origin: 'grid' }>
  | SupplyNodeBase<'ac-distribution', { ratedCurrentA?: number }>
  | SupplyNodeBase<'changeover-switch', ChangeoverSwitchProperties>
  | SupplyNodeBase<'inverter-unit', { serialNumber?: string; gridInputConnected?: boolean; acConnection?: 'shared' | 'separate' }>
  | SupplyNodeBase<'battery', BatteryDeviceProps>
  | SupplyNodeBase<'solar-source', SolarPanelDeviceProps>
  | SupplyNodeBase<
      'dc-bus',
      { ratedCurrentA?: number; ratedVoltageV?: number; domoticaProps?: DomoticaDeviceProps }
    >
  | SupplyNodeBase<'protection', SupplyProtectionProperties>
  | SupplyNodeBase<'panel-handoff', Record<string, never>>
  | SupplyNodeBase<'generator-source', GeneratorSourceProperties>
  | SupplyNodeBase<'integrated-transfer', { modelCapabilityKey?: string }>

export type SupplyConnectionPathRole =
  | 'grid-ac'
  | 'grid-only-bypass-ac'
  | 'inverter-grid-ac'
  | 'inverter-backup-ac'
  | 'generator-backup-ac'
  | 'battery-dc'
  | 'dc-bus'
  | 'solar-dc'
  | 'protective-earth'
  | 'load-ac'

export interface SupplyConnectionWireProperties {
  cable: CableSpec
  wireRoute?: 'wall' | 'ground' | 'air'
  inTube?: boolean
  inWall?: boolean
  hideWireLabel?: boolean
  showFireClassLabel?: boolean
  wireLengthM?: number
  showWireLengthLabel?: boolean
}

export interface SupplyConnection {
  id: string
  endpoints: [SupplyPortRef, SupplyPortRef]
  domain: SupplyElectricalDomain
  conductors: SupplyConductor[]
  pathRole: SupplyConnectionPathRole
  wireProperties?: SupplyConnectionWireProperties
  physicalRoute?: ElectricalEnclosureRef[]
}

export interface InverterGroup {
  id: string
  shared: {
    brand?: string
    model?: string
    ratedPowerW?: number
    synergrid?: SynergridCertification
    capabilities: BackupSourceCapabilities
  }
  use: BackupSourceUse
  coordination: 'independent-per-phase' | 'native-multiphase' | 'parallel-cluster'
  unitNodeIds: string[]
}

export type SupplyAttachmentRef =
  | { kind: 'shared-feed'; sharedFeedId: string }
  | { kind: 'root-feed'; rootFeedId: string }
  | { kind: 'panel-input'; panelId: string }
  | { kind: 'panel-bus-input'; panelId: string; busSectionId: string }
  | { kind: 'circuit-input'; panelId: string; circuitId: string }

export interface SupplyLoadHandoff {
  id: string
  handoffNodeId: string
  target: Extract<
    SupplyAttachmentRef,
    { kind: 'root-feed' | 'panel-input' | 'panel-bus-input' | 'circuit-input' }
  >
  conductors: AcPhase[]
}

export type SupplyAssemblyPresetIntent =
  | 'grid_connected_storage_branch'
  | 'single_phase_backup_on_three_phase'
  | 'partial_multi_phase_backup'
  | 'single_phase_installation'
  | 'three_phase_inverter_set'
  | 'native_multi_phase_hybrid'
  | 'custom_phase_mapping'

export interface OffGridSupplyAssembly {
  id: string
  graphVersion: SupplyAssemblyGraphVersion
  presetIntent?: SupplyAssemblyPresetIntent
  incomingAttachment: SupplyAttachmentRef
  loadHandoffs: SupplyLoadHandoff[]
  nodes: SupplyNode[]
  connections: SupplyConnection[]
  inverterGroups: InverterGroup[]
  /** Independent placement on the existing one-wire canvas; not owned by the mains symbol. */
  oneWireGeometry?: SupplyAssemblyOneWireGeometry
}

export interface SupplyAssemblyOneWireGeometry {
  nodePositions: Record<string, Point2>
  /** Optional orthogonal route control points between a connection's two node ports. */
  connectionWaypoints?: Record<string, Point2[]>
}

export type SupplyAssemblyLayoutPreset =
  | 'horizontal-source-selection'
  | 'remote-backup-enclosure-return'
  | 'single-enclosure-backup'
  | 'single-phase-backup-three-phase'
  | 'three-phase-inverter-stack'
  | 'compact'

export interface SupplyAssemblyLayoutConfig {
  preset: SupplyAssemblyLayoutPreset
  inverterSide?: 'left' | 'right' | 'above'
  batterySide?: 'left' | 'right' | 'above'
  phaseOrder?: LiveAcPhase[]
  protectedPhase?: LiveAcPhase
  changeoverSwitchSide?: 'left' | 'right' | 'center'
  showPrePanelBoundary?: boolean
  showModeLabels?: boolean
  laneSpacing?: 'compact' | 'normal' | 'wide'
}

export interface AuxiliaryElectricalEnclosure {
  id: string
  name: string
  kind: 'backup' | 'supply' | 'conversion' | 'other'
  /** Root/main panel whose incoming supply path this virtual enclosure belongs to. */
  ownerPanelId?: string
  gridView: PanelGridConfig
  panelViewPosition?: Point2
  hidden?: boolean
  /**
   * Where the enclosure hangs on the situation plan, so supply cables can be routed through it.
   * Hiding the placement on the plan also hides the cables that end at it.
   */
  placements?: Placement[]
}

export interface DerivedPhaseSupplyPath {
  phase: LiveAcPhase
  gridConnectionIds: string[]
  backupConnectionIds: string[]
  changeoverNodeId?: string
  inverterUnitNodeId?: string
  state:
    | 'grid-only'
    | 'grid-only-through-changeover'
    | 'backup-only-through-changeover'
    | 'backup-switchable'
    | 'not-present'
    | 'invalid'
}

/** Destination-specific phase result for assemblies with more than one load handoff. */
export interface DerivedHandoffPhaseSupplyPath extends DerivedPhaseSupplyPath {
  handoffId: string
  target: SupplyLoadHandoff['target']
}
