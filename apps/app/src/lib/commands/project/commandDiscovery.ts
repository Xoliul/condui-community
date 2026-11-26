import { z } from 'zod'
import { createdReferenceSchema } from './batchReferences'
import type { ProjectCommandRegistry } from './registry'
import { CommandError } from './types'

export const projectCommandDescriptionOptionsSchema = z
  .strictObject({
    detail: z.enum(['summary', 'full', 'fields']).optional(),
    section: z.string().min(1).max(200).optional(),
    variant: z.string().min(1).max(200).optional(),
  })
  .refine((input) => !input.variant || !!input.section, 'A variant requires a section')
  .refine((input) => input.detail !== 'fields' || !!input.section, 'Field discovery requires a section')
export type ProjectCommandDescriptionOptions = z.input<
  typeof projectCommandDescriptionOptionsSchema
>

type Schema = Record<string, unknown>
const object = (value: unknown): Schema | undefined =>
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Schema)
    : undefined
const alternatives = (schema: Schema): Schema[] =>
  [schema.anyOf, schema.oneOf].flatMap((value) =>
    Array.isArray(value) ? value.flatMap((item) => (object(item) ? [item as Schema] : [])) : []
  )

/** Shallow type hints keep summaries useful without expanding nested property schemas. */
function sectionShape(schema: Schema): { type?: string; fields?: string[]; values?: unknown[] } {
  const type = typeof schema.type === 'string' ? schema.type : undefined
  const properties = object(schema.properties)
  const values = Array.isArray(schema.enum) && schema.enum.length <= 10 ? schema.enum : undefined
  return {
    ...(type ? { type } : {}),
    ...(properties ? { fields: Object.keys(properties) } : {}),
    ...(values ? { values } : {}),
  }
}

/** Only traverse the selected input/array union, never unrelated nested property families. */
function variants(schema: Schema): string[] {
  const kind = object(object(schema.properties)?.kind)
  const own = typeof kind?.const === 'string' ? [kind.const] : []
  return [
    ...new Set([
      ...own,
      ...alternatives(schema).flatMap(variants),
      ...(object(schema.items) ? variants(schema.items as Schema) : []),
    ]),
  ]
}

function selectVariant(schema: Schema, variant: string | readonly string[]): Schema | null {
  const kind = object(object(schema.properties)?.kind)
  if ((typeof variant === 'string' ? [variant] : variant).includes(kind?.const as string)) return schema
  if (object(schema.items)) {
    const items = selectVariant(schema.items as Schema, variant)
    return items ? { ...schema, items } : null
  }
  for (const key of ['anyOf', 'oneOf']) {
    const choices = schema[key]
    if (!Array.isArray(choices)) continue
    const selected = choices.flatMap((choice) => {
      const candidate = object(choice)
      const narrowed = candidate && selectVariant(candidate, variant)
      return narrowed ? [narrowed] : []
    })
    if (selected.length) return { ...schema, [key]: selected }
  }
  return null
}

/** A bounded-depth inventory of writable names, without repeating their nested schemas. */
function writableFields(schema: Schema) {
  const leaves = (value: Schema): Schema[] => {
    const choices = alternatives(value)
    return choices.length ? choices.flatMap(leaves) : value.type === 'null' ? [] : [value]
  }
  const nonNull = (value: Schema): Schema => {
    const choice = alternatives(value).find((entry) => entry.type !== 'null')
    return choice ? nonNull(choice) : value
  }
  const typeOf = (value: Schema): string => {
    const types = alternatives(value).map(typeOf)
    if (types.length) return [...new Set(types)].join('|')
    if (value.type === 'array' && object(value.items))
      return `array<${typeOf(value.items as Schema)}>`
    if (typeof value.type === 'string') return value.type
    if (Array.isArray(value.type)) return value.type.join('|')
    return 'unknown'
  }
  const inventory = (value: Schema, prefix = '', depth = 0): Schema[] => {
    const base = nonNull(value)
    const required = Array.isArray(base.required) ? base.required : []
    return Object.entries(object(base.properties) ?? {}).flatMap(([name, entry]) => {
      const field = object(entry) ?? {}
      const choices = leaves(field)
      const inner = choices.length === 1 ? choices[0]! : field
      const path = prefix ? `${prefix}.${name}` : name
      const values = choices.length && choices.every((choice) => Array.isArray(choice.enum) || choice.const !== undefined)
        ? [...new Set(choices.flatMap((choice) => Array.isArray(choice.enum) ? choice.enum : [choice.const]))]
        : undefined
      const row = {
        path, type: typeOf(field), required: required.includes(name),
        ...(values && values.length <= 16 ? { values } : {}),
        ...(typeof field.description === 'string' ? { description: field.description } : {}),
        ...Object.fromEntries(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems']
          .filter((key) => inner[key] !== undefined).map((key) => [key, inner[key]])),
      }
      if (depth < 1 && object(inner.properties))
        return [...(row.type.split('|').includes('null') ? [row] : []), ...inventory(inner, path, depth + 1)]
      return [row]
    })
  }
  return inventory(object(schema.items) ?? schema)
}

export const projectCommandExamples: Record<
  string,
  Array<{ purpose: string; input: unknown; section?: string; variant?: string }>
> = {
  'floor.create': [
    {
      purpose: 'Create a calibrated floor at 100 canvas pixels per metre. Scale is an object, not a number.',
      section: 'scale',
      input: { name: 'Upper floor', scale: { pxPerMeter: 100 } },
    },
  ],
  'plan.createBuildingGeometry': [
    {
      purpose: 'Draw a straight 8 m wall on a floor calibrated at 100 pixels per metre.',
      input: { kind: 'wall', floorId: 'floor-id', points: [{ x: 0, y: 0 }, { x: 800, y: 0 }], thickness: 20 },
    },
    {
      purpose: 'Attach a 90 cm door at 100 pixels per metre to a straight wall at its midpoint; position is a fraction from 0 to 1, width is canvas pixels.',
      input: { kind: 'door', floorId: 'floor-id', wallId: 'wall-id', position: 0.5, width: 90, swing: 'left', direction: 'in' },
    },
    {
      purpose: 'Attach a 120 cm window to a straight wall at 100 pixels per metre.',
      input: { kind: 'window', floorId: 'floor-id', wallId: 'wall-id', position: 0.75, width: 120 },
    },
  ],
  'circuit.createEmpty': [
    {
      purpose: 'Create an empty lighting circuit and its protection on an existing board. Use the returned circuit/protection IDs; defaults are not verified installation facts.',
      input: { panelId: 'panel-id', kind: 'lighting' },
    },
  ],
  'plan.placeExisting': [
    {
      purpose: 'Locate an existing board on a floor, reusing its physical occurrence instead of creating another electrical board.',
      section: 'target',
      variant: 'panel',
      input: { target: { kind: 'panel', id: 'panel-id' }, floorId: 'floor-id', layer: 'electrical', pos: { x: 100, y: 100 } },
    },
  ],
  'electrical.placeSymbol': [
    {
      purpose: 'Start a switch branch at exact plan coordinates. Capture the returned endpoint and placement IDs.',
      section: 'planPlacement',
      input: {
        symbolId: 'switch',
        destination: { kind: 'circuit', circuitId: 'circuit-id' },
        planPlacement: { floorId: 'floor-id', pos: { x: 200, y: 150 } },
      },
    },
    {
      purpose:
        'Place on a new circuit branch; afterEndpointId orders the branch and does not join the anchor branch.',
      section: 'destination',
      variant: 'circuit',
      input: {
        symbolId: 'light_point',
        destination: { kind: 'circuit', circuitId: 'circuit-id', afterEndpointId: 'switch-id' },
      },
    },
    {
      purpose: 'Join an existing branch using its stable branch identity.',
      section: 'destination',
      variant: 'branch',
      input: {
        symbolId: 'light_point',
        destination: {
          kind: 'branch',
          circuitId: 'circuit-id',
          branchId: 'branch-id',
          afterEndpointId: 'switch-id',
        },
      },
    },
    {
      purpose:
        'Connect after a switch using only its endpoint ID; ownership and branch are resolved from the project.',
      section: 'destination',
      variant: 'endpoint',
      input: {
        symbolId: 'light_point',
        destination: { kind: 'endpoint', endpointId: 'switch-id' },
      },
    },
    {
      purpose:
        'Start a new branch on a supply DC bus, or (with afterDeviceId) place right after that device inside its branch; a device after a fuse sits above it. busDeviceId is the dc_bus supply device.',
      section: 'destination',
      variant: 'dcBusBranch',
      input: {
        symbolId: 'dc_dc_converter',
        destination: { kind: 'dcBusBranch', busDeviceId: 'dc-bus-id', afterDeviceId: 'fuse-id' },
      },
    },
    {
      purpose:
        'Place on one DC output of a widened converter (resize it first with properties_resize_converter); the symbol joins the end of that output string, or follows afterDeviceId.',
      section: 'destination',
      variant: 'converterOutput',
      input: {
        symbolId: 'solar_panel',
        destination: { kind: 'converterOutput', converterId: 'mppt-id', connectionIndex: 1 },
      },
    },
  ],
  'plan.drawWire': [
    {
      purpose:
        'Draw a connection between placed items. A compatible singleton light joins the switch branch electrically as well as gaining a plan route.',
      input: {
        floorId: 'floor-id',
        sourcePlacementId: 'switch-placement-id',
        targetPlacementId: 'light-placement-id',
      },
    },
  ],
  'properties.edit': [
    {
      purpose: 'Set the installation country used for validation. Use BE; Belgian country names are also normalized to BE.',
      section: 'installation',
      input: { installation: { address: { country: 'BE' } } },
    },
    {
      purpose: 'Declare which light the switch controls after joining the light to the switch branch.',
      section: 'edits',
      variant: 'endpoint',
      input: { edits: [{ kind: 'endpoint', ids: ['switch-id'], set: { controlledEndpointIds: ['light-id'] } }] },
    },
    {
      purpose: 'Show a protection module on its board. Use typed module identities from circuit creation or inspection.',
      section: 'actions',
      variant: 'panelModuleVisibility',
      input: { actions: [{ kind: 'panelModuleVisibility', panelId: 'panel-id', module: { kind: 'protection', id: 'protection-id' }, visible: true }] },
    },
    {
      purpose:
        'Clear unknown protection facts explicitly; omit fields to preserve them. Do not substitute guessed ratings.',
      section: 'edits',
      variant: 'protection',
      input: {
        edits: [
          {
            kind: 'protection',
            ids: ['protection-id'],
            set: { curve: null, breakingCapacityKa: null },
          },
        ],
      },
    },
  ],
  'panel.editLayout': [
    {
      purpose: 'Set the desired physical module slots on a board. This sample has one protection; include the other desired slots when arranging a populated board.',
      section: 'panels',
      input: { panels: [{ panelId: 'panel-id', mainSlots: [{ row: 0, col: 0, module: { kind: 'protection', id: 'protection-id' } }] }] },
    },
    {
      purpose: 'Arrange physical modules in the selected panels without reconnecting circuits.',
      section: 'autoArrange',
      input: { autoArrange: { panelIds: ['panel-id'], feedSideDirection: 'left' } },
    },
    {
      purpose: 'Show or hide the supply module area.',
      section: 'supplyVisibility',
      input: { supplyVisibility: [{ panelId: 'panel-id', visible: true }] },
    },
  ],
}

/** Existing programmatic callers retain full schemas; front ends opt into concise discovery. */
export function describeProjectCommand(
  registry: ProjectCommandRegistry,
  commandId: string,
  input: ProjectCommandDescriptionOptions = {}
) {
  const options = projectCommandDescriptionOptionsSchema.parse(input)
  const command = registry.get(commandId)
  if (!command) throw new CommandError('unknown_command', `Unknown command "${commandId}"`)
  let schema: Schema
  try {
    schema = z.toJSONSchema(command.input, {
      io: 'input',
      target: 'draft-2020-12',
      reused: 'inline',
    })
  } catch {
    return {
      id: command.id,
      version: command.version,
      inputSchema: null,
      fieldSets: undefined,
      sections: undefined,
      examples: undefined,
      exampleIds: undefined,
      discovery: undefined,
      unavailable: 'This internal clipboard command has no portable input schema.',
    }
  }
  const properties = object(schema.properties) ?? {}
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : []
  const requestedVariants = options.variant?.split(',').map((value) => value.trim())
  if (requestedVariants?.some((value) => !value) || (requestedVariants?.length ?? 0) > 20)
    throw new CommandError('invalid_input', 'Request 1–20 comma-separated kind variants')
  const sections = Object.entries(properties).map(([name, value]) => ({
    name,
    required: required.includes(name),
    variants: variants(object(value) ?? {}),
    ...(options.detail === 'summary' && !options.section ? sectionShape(object(value) ?? {}) : {}),
  }))
  if (options.section) {
    const selected = object(properties[options.section])
    if (!selected)
      throw new CommandError('invalid_input', `Unknown section "${options.section}". Available sections: ${sections.map(({ name }) => name).join(', ')}.`)
    const narrowed = requestedVariants
      ? requestedVariants.every((variant) => selectVariant(selected, variant))
        ? selectVariant(selected, requestedVariants)
        : null
      : selected
    if (!narrowed)
      throw new CommandError(
        'invalid_input',
        `Unknown variant "${options.variant}" in "${options.section}". Available variants: ${variants(selected).join(', ')}.`
      )
    // Keep required siblings so this is an input envelope, not an unusable field fragment.
    schema = {
      ...schema,
      required: [...new Set([...required, options.section])],
      properties: {
        ...Object.fromEntries(
          required
            .filter((name) => name !== options.section)
            .map((name) => [name, properties[name]])
        ),
        [options.section]: narrowed,
      },
    }
  }
  const selectedExamples = (projectCommandExamples[commandId] ?? [])
    .filter(
      (example) =>
        (!options.section || example.section === options.section) &&
        (!requestedVariants || requestedVariants.includes(example.variant ?? ''))
    )
    .map(({ purpose, input: exampleInput }) => ({ purpose, input: exampleInput }))
  return {
    id: command.id,
    version: command.version,
    inputSchema: options.detail === 'fields' || (options.detail === 'summary' && !options.section) ? undefined : schema,
    ...(options.detail === 'fields' && options.section ? {
      fieldSets: (requestedVariants ?? (variants(object(properties[options.section]) ?? {}).length
        ? variants(object(properties[options.section]) ?? {}) : [undefined])).map((variant) => {
          const selected = object(properties[options.section!])!
          return { section: options.section, ...(variant ? { variant } : {}), fields: writableFields(variant ? selectVariant(selected, variant)! : selected) }
        }),
      fieldSemantics: 'Types include null when clearing is accepted. Nested objects below one level are summarized; use a focused schema for their fields and constraints. Required means required within its containing object; command checks still apply.',
    } : {}),
    sections: options.section
      ? sections
          .filter(({ name }) => name === options.section || required.includes(name))
          .map(({ name, variants: choices }) => ({
            name,
            required: true,
            variants: name === options.section && requestedVariants ? requestedVariants : choices,
          }))
      : sections,
    discovery: sections.length
      ? 'Request section and optional comma-separated kind variants for a focused schema. Use detail: fields with a section for compact writable names and nullable types; detail: full returns every field. Runtime checks still enforce ownership, alternatives and refinements.'
      : 'This schema has no top-level object sections; focused selectors are unavailable. Request detail: full for the complete input schema.',
    ...(selectedExamples.length ? { examples: selectedExamples } : {}),
    ...(selectedExamples.length ? { exampleIds: 'Replace illustrative IDs such as panel-id with IDs returned by creation or project inspection. Examples are inputs, not project facts. See the house workflow guide for dependent commands using batch-local $created references.' } : {}),
    ...(commandId === 'electrical.placeSymbol' || commandId === 'plan.drawWire'
      ? { connectionSemantics: 'Branch membership and controlledEndpointIds control metadata are distinct. Inspect the resulting endpoints instead of inferring control metadata from drawing position or branch membership alone.' }
      : {}),
    ...(commandId === 'properties.edit'
      ? {
          propertySemantics:
            'Absent fields preserve existing facts. Null clears fields that accept null. installation.address.country uses country codes (BE for Belgium); Belgian names are normalized. installation.nominalVoltage.system 1N~ denotes the existing 1N400V network convention (230V line-neutral, 400V line-line), not a literal 400V appliance supply.',
        }
      : {}),
    ...(commandId === 'electrical.placeSymbol' ? {
      placementSemantics: 'Use planPlacement {floorId,pos:{x,y},rotationDeg?,scale?} for exact coordinates and rotation (default 0). sitplan.viewportCenter is an automatic-placement hint and may move to avoid collisions. Choose one mode. Existing occurrences can be moved with plan.movePlacements.',
    } : {}),
    batchReferences:
      options.detail === 'summary' || options.detail === 'fields'
        ? 'Name an invocation with as; later fields may use {$created:{from:NAME,kind:ENTITY_KIND,index:0}}. References select actual created IDs and roll back on failure.'
        : {
            alias: 'Give an earlier invocation an optional as name, unique within this batch.',
            referenceSchema: z.toJSONSchema(createdReferenceSchema, { io: 'input' }),
            resolution:
              'A reference anywhere in a later input selects the created entity ID by kind and zero-based index. Inputs are then checked against the normal command schema. Unknown, forward and missing references roll back the batch.',
          },
    coordinates: {
      plan: 'canvas pixels',
      panelRow: 'zero-based',
      panelColumn: 'module units, zero-based',
      rotation: 'degrees',
      scaleReference: 'metres',
    },
    inspectionLimits: {
      entityPage: 100,
      symbolPage: 100,
      entityReadRefs: 20,
      sceneGeometryPage: 100,
    },
  }
}
