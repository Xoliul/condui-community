import { z } from 'zod'
import {
  cableSpec,
  patchObject,
  protectionPatchSchema,
  endpointPropSchemas,
  energyConversionProps,
  phaseAssignment,
  endpointPatchSchema,
  domoticaProps,
  domoticaOutputWire,
  installationDatePatchSchema,
  symbolLabelDisplay,
  circuitWirePatchSchema,
} from './propertySchemas'
const bool = z.boolean().nullable()
const str = z.string().nullable()
const num = z.number().finite().nonnegative().nullable()
export const panelGridPropertiesSchema = patchObject({
  rows: z.number().int().min(1).max(32),
  columns: z.number().int().min(1).max(48),
  feedFromTop: z.boolean(),
  terminalStripTopRail: bool,
  terminalStripBottomRail: bool,
  supplyPanelRows: z.number().int().min(1).max(32),
  supplyPanelColumns: z.number().int().min(1).max(48),
  supplyPanelVisible: bool,
})
export const panelPropertiesSchema = patchObject({
  busbarPhases: patchObject({
    main: z.array(z.enum(['L1', 'L2', 'L3'])),
    secondary: z.record(z.string(), z.array(z.enum(['L1', 'L2', 'L3']))),
  }),
  name: z.string().trim().min(1),
  nameByLocale: z.record(z.string(), z.string()),
  location: str,
  numberOverride: z.string().trim().min(1).max(12).nullable(),
  earthingSystem: z.enum(['TT', 'TN-S', 'TN-C', 'TN-C-S', 'IT']).nullable(),
  backupEarthingSystem: z.enum(['TT', 'TN-S', 'TN-C', 'TN-C-S', 'IT']).nullable(),
  hasGround: bool,
  expectedShortCircuitKa: num,
  symbolLabelDisplay: symbolLabelDisplay.nullable(),
  ...installationDatePatchSchema.shape,
})
export const trunkPropertiesSchema = patchObject({
  ...protectionPatchSchema.shape,
  type: z.enum([
    'protection',
    'energy_meter',
    'relay',
    'switch',
    'conversion',
    'junction_box',
    'junction_panel',
    'terminal_strip',
    'earthing_separator',
    'storage',
    'generation',
    'dc_bus',
    'domotica',
    'changeover',
  ]),
  symbol: endpointPatchSchema.shape.symbol.unwrap().unwrap(),
  protectionType: protectionPatchSchema.shape.type.nullable(),
  junctionIdentity: str,
  energyMeterProps: endpointPropSchemas.energyMeterProps,
  relayProps: endpointPropSchemas.relayProps,
  conversionProps: energyConversionProps.nullable(),
  batteryProps: endpointPropSchemas.batteryProps,
  solarPanelProps: endpointPropSchemas.solarPanelProps,
  domoticaProps: domoticaProps.nullable(),
  dcBusProps: patchObject({ ratedCurrentA: num, ratedVoltageV: num }).nullable(),
  changeoverProps: patchObject({ port1Label: str, port2Label: str }).nullable(),
  showDomainChangeLabel: bool,
  converterGridInputConnected: bool,
  converterAcConnection: z.enum(['shared', 'separate']).nullable(),
  metadataCalloutOffset: z
    .object({ x: z.number().finite(), y: z.number().finite() })
    .strict()
    .nullable(),
})
const ids = z.array(z.string().min(1)).min(1)
export const extraElectricalPropertyEditSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('panel'), ids, set: panelPropertiesSchema }).strict(),
  z.object({ kind: z.literal('panelGrid'), ids, set: panelGridPropertiesSchema }).strict(),
  z.object({ kind: z.literal('junctionPanelGrid'), ids, set: panelGridPropertiesSchema }).strict(),
  z
    .object({
      kind: z.literal('junctionPanelTerminal'),
      ids,
      set: patchObject({
        label: z.string().trim().min(1),
        pinCount: z.number().int().min(2).max(999),
      }),
    })
    .strict(),
  z
    .object({
      kind: z.literal('auxiliaryEnclosure'),
      ids,
      set: patchObject({
        name: z.string(),
        gridView: panelGridPropertiesSchema.extend({
          columns: z.number().int().min(12).max(48).optional(),
        }),
      }),
    })
    .strict(),
  z
    .object({
      kind: z.literal('supplyConnection'),
      ids,
      assemblyId: z.string().min(1),
      set: patchObject({ wireProperties: circuitWirePatchSchema }),
    })
    .strict(),
  z
    .object({
      kind: z.literal('rootFeed'),
      ids,
      set: patchObject({ ...circuitWirePatchSchema.shape }),
    })
    .strict(),
  z
    .object({
      kind: z.literal('rootFeedWireSection'),
      ids,
      sectionKey: z.string().min(1),
      set: circuitWirePatchSchema,
      defaultCable: cableSpec.required({ kind: true, conductors: true, sectionMm2: true }),
    })
    .strict(),
  z
    .object({
      kind: z.literal('domoticaOutputWire'),
      ids,
      outputGroup: z.enum(['control', 'endpoint']),
      outputIndex: z.number().int().nonnegative(),
      set: domoticaOutputWire,
    })
    .strict(),
  z
    .object({
      kind: z.literal('canonicalWire'),
      ids,
      sharedGeometryAnchors: z.array(z.string().min(1)).optional(),
      set: patchObject({
        cable: cableSpec,
        medium: z.enum(['cable', 'busbar']).nullable(),
        material: z.enum(['copper', 'aluminium']).nullable(),
        route: z.enum(['none', 'wall', 'on-wall', 'ground', 'air']).nullable(),
        inTube: bool,
        labels: patchObject({
          hideWireLabel: bool,
          showFireClassLabel: bool,
          showWireLengthLabel: bool,
          showConductorMarks: bool,
          showBranchConductorMarks: bool,
        }),
        lengthM: num,
        followsDefaultCable: bool,
        fireClassNone: bool,
      }),
      defaultCable: cableSpec.required({ kind: true, conductors: true, sectionMm2: true }),
    })
    .strict(),
])
export type ExtraElectricalPropertyEdit = z.output<typeof extraElectricalPropertyEditSchema>
export const extraElectricalPropertyKinds = [
  'panel',
  'panelGrid',
  'junctionPanelGrid',
  'junctionPanelTerminal',
  'auxiliaryEnclosure',
  'supplyConnection',
  'rootFeed',
  'rootFeedWireSection',
  'domoticaOutputWire',
  'canonicalWire',
] as const
export function isExtraElectricalPropertyEdit(edit: {
  kind: string
}): edit is ExtraElectricalPropertyEdit {
  return (extraElectricalPropertyKinds as readonly string[]).includes(edit.kind)
}

export const extraElectricalActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('projectSupplyConnection'),
    connection: z.enum(['direct', 'transformer']),
  }).strict(),
  z
    .object({
      kind: z.literal('busbarPhaseOrder'),
      panelId: z.string().min(1),
      ownerId: z.string().min(1).optional(),
      busSectionId: z.string().min(1).optional(),
      order: z.array(z.enum(['L1', 'L2', 'L3'])).length(3),
    })
    .strict(),
  z
    .object({
      kind: z.literal('supplyUnit'),
      deviceId: z.string().min(1),
      index: z.number().int().nonnegative(),
      set: patchObject({
        serialNumber: z.string(),
        phaseAssignment: phaseAssignment.required({ kind: true, phases: true }),
      }),
    })
    .strict(),
  z
    .object({
      kind: z.literal('supplyWire'),
      panelId: z.string().min(1),
      role: z.enum(['upstream', 'crossing', 'downstream']),
      set: circuitWirePatchSchema
        .pick({
          hideWireLabel: true,
          showFireClassLabel: true,
          wireLengthM: true,
          showWireLengthLabel: true,
          showPhaseLabel: true,
        })
        .extend({
          cable: cableSpec.optional(),
          phaseAssignment: phaseAssignment
            .required({ kind: true, phases: true })
            .nullable()
            .optional(),
        }),
    })
    .strict(),
  z
    .object({
      kind: z.literal('terminalStripPins'),
      entityId: z.string().min(1),
      stripId: z.string(),
      incomingPin: z.number().int().positive(),
      outgoingPin: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('junctionPanelIdentity'),
      deviceId: z.string().min(1),
      identity: z.string(),
      floorId: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('panelFeedOrganization'),
      panelId: z.string().min(1),
      organization: z.enum(['single', 'split-backup', 'split-switchable']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('panelBusFeedBoundary'),
      panelId: z.string().min(1),
      feed: z.enum(['grid', 'backup']),
      mainBusInsertIndex: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('changeoverGridSource'),
      panelId: z.string().min(1),
      source: z.enum(['grid', 'converter-input']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('auxiliaryPlanVisibility'),
      enclosureId: z.string().min(1),
      visible: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('wireCableDefault'),
      anchor: z.string().min(1),
      cable: cableSpec.required({ kind: true, conductors: true, sectionMm2: true }),
      sharedGeometryAnchors: z.array(z.string().min(1)).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('resizeConverter'),
      deviceId: z.string().min(1),
      count: z.number().int().min(1).max(4),
    })
    .strict(),
])
export type ExtraElectricalAction = z.output<typeof extraElectricalActionSchema>
export function isExtraElectricalAction(action: { kind: string }): action is ExtraElectricalAction {
  return [
    'projectSupplyConnection',
    'supplyUnit',
    'busbarPhaseOrder',
    'supplyWire',
    'terminalStripPins',
    'junctionPanelIdentity',
    'panelFeedOrganization',
    'panelBusFeedBoundary',
    'changeoverGridSource',
    'auxiliaryPlanVisibility',
    'wireCableDefault',
    'resizeConverter',
  ].includes(action.kind)
}
