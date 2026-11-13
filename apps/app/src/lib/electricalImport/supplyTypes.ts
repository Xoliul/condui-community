import { z } from 'zod'
import { importProtectionSchema } from './commonTypes'

const ref = z.string().trim().min(1).max(200)
const label = z.string().trim().min(1).max(200).optional()
const voltageV = z.number().finite().positive().max(1500)

/** Semantic sources, not native ports, device IDs, or graph edges. */
export const importSupplySourceSchema = z.discriminatedUnion('type', [
  z
    .object({
      ref,
      type: z.literal('battery'),
      label,
      brand: label,
      model: label,
      voltageV,
      capacityKWh: z.number().finite().positive().max(10000),
      count: z.number().int().min(1).max(8),
    })
    .strict(),
  z
    .object({
      ref,
      type: z.literal('solar'),
      label,
      wattageW: z.number().finite().positive().max(1000000),
      voltageV: voltageV.optional(),
    })
    .strict(),
])

export const importSupplyBranchSchema = z
  .object({
    ref,
    label,
    protection: importProtectionSchema.optional(),
    source: importSupplySourceSchema,
  })
  .strict()

/** Additive creation input compiled by the shared electrical importer. */
export const importSupplySystemSchema = z
  .object({
    ref,
    label,
    topology: z.enum(['manual_changeover', 'direct_backup']),
    // This controls the inverter's grid input, not the installation's utility bypass.
    gridInputConnected: z.boolean(),
    changeover: z
      .object({
        ref,
        label,
        poles: z.enum(['2P', '4P']),
        neutralTreatment: z.literal('switched'),
      })
      .strict()
      .optional(),
    inverter: z
      .object({
        ref,
        label,
        brand: label,
        model: label,
        powerW: z.number().finite().positive().max(1000000).optional(),
        unitCount: z.union([z.literal(1), z.literal(3)]),
      })
      .strict(),
    dcBus: z
      .object({
        ref,
        label,
        voltageV: voltageV.optional(),
        ratedCurrentA: z.number().finite().positive().max(10000).optional(),
      })
      .strict()
      .optional(),
    branches: z.array(importSupplyBranchSchema).min(1).max(8),
    acProtections: z
      .object({
        grid: importProtectionSchema.optional(),
        backup: importProtectionSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export type ElectricalImportSupplySystem = z.infer<typeof importSupplySystemSchema>
export type ElectricalImportSupplyBranch = z.infer<typeof importSupplyBranchSchema>
export type ElectricalImportSupplySource = z.infer<typeof importSupplySourceSchema>
