import { z } from 'zod'
import { symbols } from '@/lib/symbols'
import { isLibraryPresetEntryId } from '@/lib/library/libraryPresets'
import type { LabelScheme, SymbolKey } from '@/types/schema'
import { CONTROL_SYSTEMS } from '@/types/schema'
import { MAX_PANEL_PREFIX_LENGTH } from '@/lib/eendraad/labelScheme'
import { addressCountrySchema } from './addressCountry'

const nullable = <T extends z.ZodType>(schema: T) => schema.nullable()
const str = nullable(z.string())
const num = nullable(z.number().finite().nonnegative())
const bool = nullable(z.boolean())
const stringArray = nullable(z.array(z.string()))
const count = nullable(z.number().int().nonnegative())
const positiveCount = nullable(z.number().int().positive())
const enumOrNull = <T extends readonly [string, ...string[]]>(values: T) => nullable(z.enum(values))

export function patchObject<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict().partial()
}

export const cableSpec = z
  .object({
    kind: z
      .enum([
        'XVB',
        'VOB',
        'VOBst',
        'NYFAZ',
        'XGB',
        'EXVB',
        'H07RN-F',
        'PV1-F',
        'H1Z2Z2-K',
        'H07V-K',
        'SVV',
        'LiYY',
        'VTLB',
        'JYSTY',
        'Solar',
        'battery-cable',
        'twinflex',
        'other',
      ])
      .optional(),
    conductors: z.number().int().positive().optional(),
    sectionMm2: z.number().finite().positive().optional(),
    hasPE: z.boolean().nullable().optional(),
    fireClass: z.enum(['Aca', 'B1ca', 'B2ca', 'Cca', 'Dca', 'Eca', 'Fca']).nullable().optional(),
    customKind: str.optional(),
    notes: str.optional(),
  })
  .strict()

export const phaseAssignment = z
  .object({
    kind: z.enum(['inherit', 'single_phase', 'phase_to_phase', 'three_phase', 'dc']).optional(),
    phases: z.array(z.enum(['L1', 'L2', 'L3', 'N', 'PE'])).optional(),
    neutral: z.enum(['used', 'not_used', 'not_present']).nullable().optional(),
    source: z
      .enum(['manual', 'derived_from_protection', 'derived_from_voltage', 'derived_from_busbar'])
      .nullable()
      .optional(),
  })
  .strict()

export const symbolLabelDisplay = patchObject({
  position: enumOrNull(['right', 'left', 'top', 'bottom']),
  layout: enumOrNull(['stack', 'sequence']),
  visibility: nullable(z.record(z.string(), z.boolean())),
})

const panelLabelCell = z
  .object({
    source: z.enum(['label', 'notes', 'labelNotes', 'technical', 'feeds']).optional(),
    sources: z
      .array(z.enum(['label', 'notes', 'labelNotes', 'technical', 'feeds']))
      .nullable()
      .optional(),
    alignment: z.enum(['left', 'center', 'right', 'justify']).nullable().optional(),
  })
  .strict()
export const panelLabel = patchObject({
  top: panelLabelCell.nullable(),
  bottom: panelLabelCell.nullable(),
  main: bool,
})

export const certification = patchObject({
  brand: str,
  model: str,
  serialNumber: str,
  serialNumbers: stringArray,
  synergrid: z
    .object({
      source: z.literal('synergrid_c10_26').optional(),
      sourceKey: z.string().optional(),
      c10Reference: z.string().optional(),
      sourceLastUpdate: str.optional(),
      approvalDate: str.optional(),
      isPlugAndPlay: bool.optional(),
    })
    .strict()
    .nullable(),
})

const socketProps = patchObject({
  switchOverlay: bool,
  switchOverlayLock: bool,
  waterproof: bool,
  socketCount: nullable(z.number().int().min(1).max(4)),
  modular: bool,
})
const switchProps = patchObject({
  poles: nullable(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])),
  twoPole: bool,
  verklikkerlamp: bool,
  protected: bool,
  switchingCount: positiveCount,
})
const lightPointProps = patchObject({
  safety: bool,
  decentral: bool,
  autonomous: bool,
  switch1p: bool,
  onWall: bool,
  waterproof: bool,
})
const controlButtonAddresses = z.array(z.object({
  buttonIndex: z.number().int().nonnegative(),
  channel: z.string().optional(),
  groups: z.array(z.string()).optional(),
}).strict()).refine(
  (entries) => new Set(entries.map(({ buttonIndex }) => buttonIndex)).size === entries.length,
  'Button indices must be unique',
).nullable()
const domoticaChildProps = patchObject({
  parentEndpointId: str,
  outputGroup: enumOrNull(['control', 'endpoint']),
  outputIndex: count,
  channel: str,
  groups: stringArray,
  buttonAddresses: controlButtonAddresses,
})
const controlLink = patchObject({ deviceId: str, channel: str, groups: stringArray, buttonAddresses: controlButtonAddresses })
export const domoticaOutputWire = patchObject({
  connectionType: z.literal('bus').nullable(),
  busName: str,
  busSystem: enumOrNull(CONTROL_SYSTEMS),
  showBusLabel: bool,
  cable: cableSpec.nullable(),
  phaseAssignment: phaseAssignment.nullable(),
  showPhaseLabel: bool,
  inTube: bool,
  wireRoute: enumOrNull(['wall', 'ground', 'air']),
  inWall: bool,
  hideWireLabel: bool,
  showFireClassLabel: bool,
  wireLengthM: num,
  showWireLengthLabel: bool,
})
export const domoticaProps = patchObject({
  oneWireLayout: enumOrNull(['horizontal']),
  system: enumOrNull(CONTROL_SYSTEMS),
  outputSystem: enumOrNull(CONTROL_SYSTEMS),
  deviceAddress: str,
  line: str,
  channelCount: count,
  switchControlEnabled: bool,
  switchType: enumOrNull(['1p', '2p', 'impulse']),
  switchCount: count,
  endpointCount: count,
  controlChildEndpointIds: stringArray,
  endpointChildEndpointIds: stringArray,
  endpointOutputWires: nullable(z.array(domoticaOutputWire)),
  controlOutputWires: nullable(z.array(domoticaOutputWire)),
  control: nullable(
    z.array(
      z.enum([
        'switch_control',
        'button_control',
        'external_switch',
        'external_button',
        'programmed_control',
        'wireless_control',
        'detection_control',
      ])
    )
  ),
  mainDeviceType: enumOrNull(['none', 'switch', 'socket']),
  mainSwitchSymbol: str,
  mainSwitchProps: switchProps.nullable(),
  mainSocketSymbol: str,
  mainSocketProps: socketProps.nullable(),
  baseSymbol: str,
})
export const energyConversionProps = patchObject({
  transformerRole: z.literal('supply').nullable(),
  transformerPrimaryVoltageV: z.number().finite().positive().nullable(),
  transformerSecondaryVoltageV: z.number().finite().positive().nullable(),
  transformerRatedPowerKva: z.number().finite().positive().nullable(),
  transformerShortCircuitVoltagePercent: z.number().finite().positive().max(100).nullable(),
  dcConnectionCount: positiveCount,
  acPhaseAssignment: phaseAssignment.nullable(),
  acPhaseAssignments: nullable(z.array(phaseAssignment)),
  transformerSafetyType: enumOrNull(['none', 'safety_closed', 'safety_open']),
  transformerShortCircuitProtected: bool,
  transformerProtected: bool,
  transformerOverlayLabel: str,
  pMaxPrimaryW: str,
  pMaxSecondaryW: str,
  dcOutputVoltageV: str,
  dcInputMinVoltageV: str,
  brand: str,
  model: str,
  serialNumber: str,
  serialNumbers: stringArray,
  power: str,
  synergrid: certification.shape.synergrid,
})
export const endpointPropSchemas = {
  relayProps: patchObject({
    maxCurrentRatingA: num,
    poles: nullable(z.number().int().min(1).max(4)),
    control: enumOrNull(['standard', 'timer', 'clock', 'impulse', 'thermostat', 'dimmer']),
  }).nullable(),
  smokeDetectorProps: patchObject({
    type: enumOrNull(['smoke', 'gas', 'manual', 'beam', 'flame', 'heat']),
  }).nullable(),
  motionDetectorProps: patchObject({ type: enumOrNull(['spread', 'generic']) }).nullable(),
  energyMeterProps: patchObject({
    polesConfig: enumOrNull(['1P', '1P+N', '2P', '3P', '3P+N', '4P']),
    poles: nullable(z.number().int().min(1).max(4)),
  }).nullable(),
  domoticaProps: domoticaProps.nullable(),
  domoticaChildProps: domoticaChildProps.nullable(),
  busDeviceProps: patchObject({ deviceAddress: str }).nullable(),
  domoticaRowLabel: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('tail'), tail: z.string() }).strict(),
      z.object({ kind: z.literal('literal'), text: z.string() }).strict(),
    ])
    .nullable(),
  socketProps: socketProps.nullable(),
  switchProps: switchProps.nullable(),
  lightPointProps: lightPointProps.nullable(),
  lightSpotProps: patchObject({
    beamType: enumOrNull(['none', 'straight', 'diverging']),
  }).nullable(),
  lightFluorescentProps: patchObject({
    tubeCount: nullable(z.union([z.literal(1), z.literal(2), z.literal(3)])),
  }).nullable(),
  fixedApplianceProps: patchObject({
    accumulating: bool,
    accumulationHeating: bool,
    withFan: bool,
    chainedAfterHvacSource: bool,
  }).nullable(),
  solarPanelProps: patchObject({
    ...certification.shape,
    wattageW: num,
    voltageV: num,
    plugIn: bool,
  }).nullable(),
  batteryProps: patchObject({
    ...certification.shape,
    voltageV: num,
    capacityKWh: num,
    powerKw: num,
    plugIn: bool,
  }).nullable(),
  evChargerProps: patchObject({
    ...certification.shape,
    integratedDcResidualProtection: bool,
  }).nullable(),
  hvacProps: patchObject({
    energySource: enumOrNull([
      'electricity',
      'gas_fan',
      'gas_atmospheric',
      'liquid',
      'solid',
      'none',
    ]),
    hvacType: enumOrNull(['heat_exchange', 'cogeneration', 'tap_spiral', 'boiler', 'none']),
    hvacFunction: enumOrNull(['none', 'heat', 'cool', 'heat_cool']),
  }).nullable(),
  energyConversionProps: energyConversionProps.nullable(),
}

export const protectionPatchSchema = patchObject({
  type: z.enum(['RCD', 'MCB', 'RCBO', 'FUSE', 'MAIN_SWITCH', 'SPD', 'ROTATING_SWITCH', 'OTHER']),
  label: z.string(),
  ratingA: num,
  curve: enumOrNull(['B', 'C', 'D', 'F', 'K', 'MA', 'Z', 'unknown']),
  sensitivityMa: num,
  residualCurrentType: enumOrNull(['AC', 'A', 'F', 'B']),
  selective: bool,
  superImmunized: bool,
  breakingCapacityKa: num,
  breakingCapacityOption: str,
  surgeProtectionKind: enumOrNull(['standard', 'sparkGap']),
  tripSettings: patchObject({ irA: num, isdA: num, tsdS: num, iiA: num }).nullable(),
  fuseClass: enumOrNull(['gG', 'aM']),
  polesConfig: enumOrNull(['1P', '1P+N', '2P', '3P', '3P+N', '4P']),
  poles: nullable(z.number().int().min(1).max(4)),
  notes: str,
  labelNotes: str,
  panelLabel: panelLabel.nullable(),
  installationDate: str,
  installationDateSuppressed: bool,
  rulesetDateOverride: num,
  symbolLabelDisplay: symbolLabelDisplay.nullable(),
})

export const circuitPatchSchema = patchObject({
  scanReview: z.null(),
  code: z.string(),
  kind: z.enum([
    'lighting',
    'sockets',
    'fixed_appliance',
    'mixed',
    'stove',
    'solar',
    'battery',
    'doorbell',
    'subpanel',
    'hvac',
    'boiler',
    'heating',
    'ev',
    'empty',
    'other',
  ]),
  cable: cableSpec,
  phaseAssignment: phaseAssignment.nullable(),
  showPhaseLabel: bool,
  inTube: bool,
  inWall: bool,
  wireRoute: enumOrNull(['wall', 'ground', 'air']),
  hideWireLabel: bool,
  showFireClassLabel: bool,
  wireLengthM: num,
  showWireLengthLabel: bool,
  notes: str,
  notesVisible: bool,
  installationDate: str,
  installationDateSuppressed: bool,
  rulesetDateOverride: num,
  eendraadLetterVisible: bool,
  eendraadManualCodeLock: bool,
})

export const endpointPatchSchema = patchObject({
  // Endpoint.label is required in the persisted schema. Empty string clears its visible value.
  label: z.string(),
  junctionIdentity: str,
  symbol: z
    .enum([
      ...new Set([
        'mains',
        'socket',
        'socket_gnd',
        'socket_child',
        'socket_gnd_child',
        'switch',
        'switch_1p_twoway',
        'switch_2p_twoway',
        'switch_dimmer',
        'switch_1p_changeover',
        'switch_shutter',
        'switch_1p_pull',
        'contact', 'light_sensor',
        'switch_impulse',
        'switch_cross',
        'motion_detector',
        'smoke_detector',
        'relay',
        'light_point',
        'light_spot',
        'light_led',
        'light_fluorescent',
        'fixed_appliance_generic',
        'oven',
        'washer',
        'dryer',
        'dishwasher',
        'boiler',
        'ev',
        'freezer',
        'fridge',
        'microwave',
        'motor',
        'stove',
        'furnace',
        'heating',
        'ventilation',
        'door_lock',
        'buzzer',
        'bell',
        'horn',
        'siren',
        'domotica',
        'energy_meter',
        'panel_distribution',
        'mcb',
        'rcd',
        'rcbo',
        'fuse',
        'main_switch',
        'spd',
        'rotating_switch',
        'source_changeover',
        'earthing_separator',
        'junction_box',
        'junction_panel',
        'terminal_strip',
        'note',
        'transformer',
        'rectifier',
        'inverter',
        'dc_dc_converter',
        'solar_panel',
        'battery',
        'dc_bus',
        'switch_single',
        'switch_double',
        // A library preset entry is never stored: it places its base symbol.
        ...symbols.filter((symbol) => !isLibraryPresetEntryId(symbol.id)).map((symbol) => symbol.id),
      ]),
    ] as [SymbolKey, ...SymbolKey[]])
    .nullable(),
  controlLink: controlLink.nullable(),
  controlledEndpointIds: stringArray,
  notes: str,
  labelNotes: str,
  panelLabel: panelLabel.nullable(),
  notesVisible: bool,
  ...endpointPropSchemas,
  installationDate: str,
  installationDateSuppressed: bool,
  rulesetDateOverride: num,
  symbolLabelDisplay: symbolLabelDisplay.nullable(),
  metadataCalloutOffset: z
    .object({ x: z.number().finite(), y: z.number().finite() })
    .strict()
    .nullable(),
})

export const installationDatePatchSchema = patchObject({
  installationDate: str,
  installationDateSuppressed: bool,
  rulesetDateOverride: num,
})
export const installDatePatchSchema = installationDatePatchSchema

// Preserve extension fields accepted by the stored-scheme parser, while keeping
// this complete replacement discoverable through the property command's JSON Schema.
const labelSchemeProperties: z.ZodType<LabelScheme, LabelScheme> = z.object({
  version: z.literal(1),
  separator: z.enum(['.', '-', '/']),
  panel: z.object({
    prefix: z.string().max(MAX_PANEL_PREFIX_LENGTH).regex(/^[^\s0-9]*$/),
    style: z.enum(['number', 'number2', 'upper']),
    start: z.union([z.literal(0), z.literal(1)]),
    nested: z.boolean(),
  }).passthrough(),
  circuit: z.object({
    style: z.enum(['upper', 'lower', 'number', 'number2']),
    panelPart: z.enum(['none', 'number', 'full', 'continuous']),
    joinPanel: z.boolean(),
  }).passthrough(),
  branch: z.object({ join: z.boolean() }).passthrough(),
  terminalStrip: z.object({
    numbering: z.enum(['circuit', 'cable']),
    format: z.enum(['X5-1', 'X5.1', 'X5.01']),
  }).passthrough().optional(),
}).passthrough()

export const installationPropertiesSchema = patchObject({
  installationProfile: enumOrNull(['household', 'non_household']),
  connectionCurrentA: z.number().finite().int().positive().nullable(),
  address: patchObject({
    street: z.string(),
    postalCode: z.string(),
    city: z.string(),
    country: addressCountrySchema,
  }),
  nominalVoltage: patchObject({
    system: z.enum(['1~', '2~', '1N~', '3~', '3N~', 'DC']),
    uLineToNeutral: z.number().finite().nonnegative(),
    uLineToLine: z.number().finite().nonnegative(),
  }),
  mainSupply: patchObject({
    cable: cableSpec,
    crossingCable: cableSpec.nullable(),
    rootCable: cableSpec.nullable(),
    origin: enumOrNull(['grid', 'generator', 'pv_inverter', 'unknown']),
    hideWireLabel: bool,
    hideWireLabelUpstream: bool,
    hideWireLabelCrossing: bool,
    hideWireLabelDownstream: bool,
    showFireClassLabelUpstream: bool,
    showFireClassLabelCrossing: bool,
    showFireClassLabelDownstream: bool,
    wireLengthMUpstream: num,
    wireLengthMCrossing: num,
    wireLengthMDownstream: num,
    showWireLengthLabelUpstream: bool,
    showWireLengthLabelCrossing: bool,
    showWireLengthLabelDownstream: bool,
  }),
  groundCable: cableSpec.nullable(),
  hasGround: bool,
  earthResistanceOhm: num,
  notes: str,
  defaultCableKind: cableSpec.shape.kind.nullable(),
  circuitNotesOrientation: enumOrNull(['horizontal', 'vertical']),
  supplyTrunkNotesOrientation: enumOrNull(['horizontal', 'vertical']),
  panelNumberingEnabled: bool,
  panelNetTypeLabelsEnabled: bool,
  // A complete scheme replaces the stored one; null returns to the classic scheme.
  labelScheme: nullable(
    labelSchemeProperties
  ),
  eendraadAutomaticNaming: bool,
  eendraadAutoNamingHideFeederLetters: bool,
  eendraadAutoNamingSkipParentCircuits: bool,
})

export const circuitWirePatchSchema = patchObject({
  phaseAssignment: phaseAssignment.nullable(),
  showPhaseLabel: bool,
  hideWireLabel: bool,
  showFireClassLabel: bool,
  wireLengthM: num,
  showWireLengthLabel: bool,
  cable: cableSpec.nullable(),
  inTube: bool,
  inWall: bool,
  wireRoute: enumOrNull(['wall', 'ground', 'air']),
})

export const circuitSectionRefSchema = z
  .object({
    fromElementType: z.enum(['mainBus', 'secondaryBus', 'protection', 'endpoint']).optional(),
    fromElementId: z.string().optional(),
    toElementType: z.enum(['protection', 'endpoint']).optional(),
    toElementId: z.string().optional(),
    domain: z.enum(['AC', 'DC']).optional(),
  })
  .strict()
