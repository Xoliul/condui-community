import { z } from 'zod'
import { importCableSchema, importProtectionSchema, nullableOptionalString } from './commonTypes'
import { importSupplySystemSchema } from './supplyTypes'
export { importCableSchema, importProtectionSchema } from './commonTypes'

export const ELECTRICAL_IMPORT_FORMAT = 'condui-electrical-import' as const
export const ELECTRICAL_IMPORT_VERSION = 1 as const

export const importEndpointSchema = z
  .object({
    ref: z.string().trim().min(1).optional(),
    type: z.enum(['socket', 'switch', 'light_point', 'fixed_appliance', 'domotica']),
    symbol: z
      .enum([
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
        'junction_box',
        'junction_panel',
        'terminal_strip',
      ])
      .nullable()
      .optional(),
    socketCount: z.number().int().min(1).max(4).nullable().optional(),
    quantity: z.number().int().min(2).max(250).nullable().optional(),
    waterproof: z.boolean().nullable().optional(),
    controls: z.array(z.string().trim().min(1)).optional(),
    /** @deprecated Endpoint labels from the initial dev prompt are accepted but ignored. */
    label: nullableOptionalString,
    notes: nullableOptionalString,
  })
  .strict()

export const importBranchSchema = z
  .object({
    ref: z.string().trim().min(1).optional(),
    endpoints: z.array(importEndpointSchema).min(1).max(50),
    repeat: z.number().int().min(1).max(250).optional(),
  })
  .strict()

export const importCircuitSchema = z
  .object({
    ref: z.string().trim().min(1),
    code: z.string().trim().min(1).nullable().optional(),
    order: z.number().int().min(1).max(10000).optional(),
    label: nullableOptionalString,
    kind: z
      .enum([
        'lighting',
        'sockets',
        'fixed_appliance',
        'mixed',
        'stove',
        'solar',
        'battery',
        'doorbell',
        'hvac',
        'boiler',
        'heating',
        'ev',
        'empty',
        'other',
      ])
      .nullable()
      .optional(),
    protection: importProtectionSchema.nullable().optional(),
    cable: importCableSchema.nullable().optional(),
    branches: z.array(importBranchSchema).max(250).default([]),
    /** @deprecated Experimental pre-branch input; each item compiles as its own branch. */
    endpoints: z.array(importEndpointSchema).max(250).default([]),
    notes: nullableOptionalString,
  })
  .strict()

export const importGroupSchema = z
  .object({
    ref: z.string().trim().min(1),
    protection: importProtectionSchema,
    circuits: z.array(importCircuitSchema).min(1).max(250),
  })
  .strict()

const importPointSchema = z.object({ x: z.number().finite(), y: z.number().finite() }).strict()
const confidenceSchema = z.number().min(0).max(1)

export const importPlanSchema = z
  .object({
    source: z
      .object({
        width: z.number().positive(),
        height: z.number().positive(),
        background: z
          .object({
            dataUrl: z.string().startsWith('data:image/'),
            sourceName: z.string().trim().min(1).optional(),
            opacity: z.number().min(0).max(100).default(25),
            width: z.number().positive(),
            height: z.number().positive(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    floor: z
      .object({
        name: z.string().trim().min(1).max(200).optional(),
        wallThickness: z.number().positive().optional(),
        walls: z
          .array(
            z
              .object({
                ref: z.string().trim().min(1),
                points: z.array(importPointSchema).length(2),
                thickness: z.number().positive().optional(),
                confidence: confidenceSchema,
              })
              .strict()
          )
          .max(1000)
          .default([]),
        doors: z
          .array(
            z
              .object({
                wallRef: z.string().trim().min(1),
                position: z.number().min(0).max(1),
                width: z.number().positive(),
                swing: z.enum(['left', 'right', 'none', 'double']).optional(),
                direction: z.enum(['in', 'out']).optional(),
                confidence: confidenceSchema,
              })
              .strict()
          )
          .max(1000)
          .default([]),
        windows: z
          .array(
            z
              .object({
                wallRef: z.string().trim().min(1),
                position: z.number().min(0).max(1),
                width: z.number().positive(),
                confidence: confidenceSchema,
              })
              .strict()
          )
          .max(1000)
          .default([]),
        stairs: z
          .array(
            z
              .object({
                kind: z.enum(['straight', 'polyline', 'spiral']),
                points: z.array(importPointSchema).min(1).max(100),
                width: z.number().positive(),
                stepDepth: z.number().positive().optional(),
                direction: z.enum(['up', 'down', 'unknown']).optional(),
                confidence: confidenceSchema,
              })
              .strict()
          )
          .max(100)
          .default([]),
        placements: z
          .array(
            z
              .object({
                target: z
                  .object({
                    circuitCode: z.string().trim().min(1),
                    branch: z.number().int().min(1),
                    endpoint: z.number().int().min(1),
                    instance: z.number().int().min(1).optional(),
                  })
                  .strict(),
                position: importPointSchema,
                rotationDeg: z.number().finite().optional(),
                confidence: confidenceSchema,
              })
              .strict()
          )
          .max(10000)
          .default([]),
      })
      .strict(),
  })
  .strict()

export const electricalImportSchema = z
  .object({
    format: z.literal(ELECTRICAL_IMPORT_FORMAT),
    version: z.literal(ELECTRICAL_IMPORT_VERSION),
    project: z
      .object({
        name: z.string().trim().min(1).max(200),
        locale: z.enum(['nl-BE', 'fr-BE', 'en', 'de', 'pl', 'ro']).optional(),
        installer: z
          .object({
            name: z.string().trim().min(1).max(200),
            address: z
              .object({
                street: z.string().trim().max(200),
                postalCode: z.string().trim().max(20),
                city: z.string().trim().max(100),
                country: z.string().trim().length(2),
              })
              .strict()
              .nullable()
              .optional(),
            companyNumber: nullableOptionalString,
          })
          .strict()
          .optional(),
      })
      .strict(),
    installation: z
      .object({
        voltageSystem: z.enum(['1~', '2~', '1N~', '3~', '3N~']).nullable(),
        origin: z.enum(['grid', 'generator', 'pv_inverter', 'unknown']).optional(),
        address: z
          .object({
            street: z.string().trim().max(200),
            postalCode: z.string().trim().max(20),
            city: z.string().trim().max(100),
            country: z.string().trim().length(2),
          })
          .strict()
          .optional(),
        supply: z
          .object({
            cable: importCableSchema.nullable().optional(),
            system: importSupplySystemSchema.optional(),
            devices: z
              .array(
                z.discriminatedUnion('type', [
                  z
                    .object({
                      type: z.literal('energy_meter'),
                      label: nullableOptionalString,
                      poles: z.enum(['1P', '1P+N', '2P', '3P', '3P+N', '4P']).nullable().optional(),
                    })
                    .strict(),
                  z
                    .object({
                      type: z.literal('protection'),
                      protection: importProtectionSchema,
                    })
                    .strict(),
                ])
              )
              .max(20)
              .default([]),
          })
          .strict()
          .optional(),
      })
      .strict(),
    panel: z
      .object({
        ref: z.string().trim().min(1),
        name: z.string().trim().min(1).max(200),
        groups: z.array(importGroupSchema).max(100).default([]),
        circuits: z.array(importCircuitSchema).max(500).default([]),
      })
      .strict(),
    /** Legacy single-floor spelling; retained for additive v1 compatibility. */
    plan: importPlanSchema.optional(),
    /** Ordered recognized floors. New producers should use this collection. */
    plans: z.array(importPlanSchema).min(1).max(100).optional(),
  })
  .strict()
  .superRefine((document, context) => {
    if (document.plan && document.plans) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['plans'],
        message: 'Use either legacy plan or plans, not both.',
      })
    }
  })

export type ElectricalImportDocument = z.infer<typeof electricalImportSchema>
export type ElectricalImportCircuit = z.infer<typeof importCircuitSchema>
export type ElectricalImportEndpoint = z.infer<typeof importEndpointSchema>
export type ElectricalImportProtection = z.infer<typeof importProtectionSchema>
export type ElectricalImportPlan = z.infer<typeof importPlanSchema>

export function getElectricalImportPlans(
  document: ElectricalImportDocument
): ElectricalImportPlan[] {
  return document.plans ?? (document.plan ? [document.plan] : [])
}

export type ElectricalImportDiagnostic = {
  severity: 'error' | 'warning'
  path: string
  message: string
}

export type ElectricalImportValidationResult =
  | { success: true; document: ElectricalImportDocument; diagnostics: ElectricalImportDiagnostic[] }
  | { success: false; diagnostics: ElectricalImportDiagnostic[] }
