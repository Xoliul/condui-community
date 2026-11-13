import { z } from 'zod'

export const nullableOptionalNumber = z.number().finite().nonnegative().nullable().optional()
export const nullableOptionalString = z.string().trim().min(1).nullable().optional()

/** Shared semantic device/cable shapes, independent from the full import document. */
export const importProtectionSchema = z
  .object({
    type: z.enum(['RCD', 'MCB', 'RCBO', 'FUSE', 'MAIN_SWITCH']),
    label: nullableOptionalString,
    ratingA: nullableOptionalNumber,
    curve: z.enum(['B', 'C', 'D', 'F', 'K', 'MA', 'Z', 'unknown']).nullable().optional(),
    sensitivityMa: nullableOptionalNumber,
    residualCurrentType: z.enum(['AC', 'A', 'F', 'B']).nullable().optional(),
    poles: z.enum(['1P', '1P+N', '2P', '3P', '3P+N', '4P']).nullable().optional(),
    breakingCapacityKa: nullableOptionalNumber,
  })
  .strict()

export const importCableSchema = z
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
      .nullable()
      .optional(),
    customKind: nullableOptionalString,
    conductors: z.number().int().min(1).max(20).nullable().optional(),
    sectionMm2: z.number().positive().max(1000).nullable().optional(),
    hasPE: z.boolean().nullable().optional(),
    fireClass: z.enum(['Aca', 'B1ca', 'B2ca', 'Cca', 'Dca', 'Eca', 'Fca']).nullable().optional(),
    inTube: z.boolean().nullable().optional(),
    route: z.enum(['wall', 'ground', 'air']).nullable().optional(),
  })
  .strict()
