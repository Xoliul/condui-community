import { z } from 'zod'
import type { ProjectV2 } from '@/types/projectV2'
import type { CommandCheck, CommandEnv, EntityRef } from '@/lib/commands/project/types'
import { selectProjectBuildingFloors, selectProjectFloorPlan } from '@/lib/projectV2/buildingFloors'
import {
  queryOneWireNotes,
  querySitplanNotes,
  queryOneWireFrames,
} from '@/lib/projectV2/annotations'
import {
  getProjectDocuments,
  getProjectDocumentPatchAsset,
  type ProjectDocumentPatch,
} from '@/lib/documents/projectDocuments'
import { normalizePatch, patchChanges } from './propertyPatch'
import {
  updateBuildingPropertiesInProject,
  updateAnnotationPropertiesInProject,
  updateProjectMetadataInProject,
} from './generalPropertyMutations'
import { getPlanGraphicElementAsset } from '@/lib/plan/graphicElements'
import { addressCountrySchema } from './addressCountry'

const finite = z.number().finite()
const positive = finite.positive()
const optionalText = z.string().nullable().optional()
const point = z.object({ x: finite, y: finite }).strict()
const address = z
  .object({
    street: z.string().optional(),
    number: optionalText,
    postalCode: z.string().optional(),
    city: z.string().optional(),
    country: addressCountrySchema.optional(),
  })
  .strict()
const party = z
  .object({
    name: z.string().optional(),
    companyNumber: optionalText,
    email: optionalText,
    mobile: optionalText,
    phone: optionalText,
    address: address.nullable().optional(),
  })
  .strict()
const customer = party
  .extend({ siteAddress: address.nullable().optional(), meterEanCode: optionalText })
  .strict()
const installer = party
  .extend({ signatureDataUrl: optionalText, logoDataUrl: optionalText })
  .strict()
const projectPatch = z
  .object({
    name: z.string().optional(),
    locale: optionalText,
    yearOfConstruction: finite.int().min(0).max(9999).nullable().optional(),
    meterEanCode: optionalText,
    customer: customer.nullable().optional(),
    inspectionAgency: party.nullable().optional(),
    installerOverride: installer.nullable().optional(),
    showInspectionAgencyInInfoBlock: z.boolean().nullable().optional(),
    showConduiBranding: z.boolean().nullable().optional(),
    installerHeading: z.string().trim().max(80).nullable().optional(),
    installDateColors: z.record(z.string(), z.string()).nullable().optional(),
  })
  .strict()
export type GeneralProjectPropertyPatch = z.input<typeof projectPatch>
const sitePatch = z
  .object({
    address: address.nullable().optional(),
    location: z
      .object({
        latitude: finite.min(-90).max(90),
        longitude: finite.min(-180).max(180),
        altitudeM: finite.optional(),
        crs: z.literal('EPSG:4326'),
      })
      .strict()
      .nullable()
      .optional(),
    geocoding: z
      .object({
        provider: z.enum(['google', 'mapbox', 'geoapify', 'osm', 'manual', 'custom']),
        providerPlaceId: z.string().optional(),
        resolvedAt: z.string().datetime(),
        formattedAddress: z.string().optional(),
        confidence: finite.min(0).max(1).optional(),
        accuracy: z.enum(['rooftop', 'parcel', 'street', 'city', 'manual']).optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict()
const notePatch = z
  .object({
    text: z.string().optional(),
    fontSize: positive.optional(),
    formatting: z
      .object({
        bold: z.boolean().optional(),
        italic: z.boolean().optional(),
        underline: z.boolean().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    pos: point.optional(),
  })
  .strict()
const framePatch = z
  .object({
    title: z.string().optional(),
    fontSize: positive.optional(),
    titlePosition: z.enum(['inside', 'outside']).optional(),
  })
  .strict()
const wallPatch = z
  .object({
    thickness: positive.nullable().optional(),
    points: z.array(point).min(2).optional(),
    curve: z
      .object({ kind: z.literal('rationalQuadratic'), weight: positive })
      .strict()
      .nullable()
      .optional(),
    doorUpdates: z
      .array(z.object({ id: z.string().min(1), position: finite.min(0).max(1) }).strict())
      .optional(),
    windowUpdates: z
      .array(z.object({ id: z.string().min(1), position: finite.min(0).max(1) }).strict())
      .optional(),
  })
  .strict()
const openingPatch = z
  .object({ width: positive.optional(), position: finite.min(0).max(1).optional() })
  .strict()
const doorPatch = openingPatch
  .extend({
    swing: z.enum(['left', 'right', 'none', 'double']).optional(),
    direction: z.enum(['in', 'out']).optional(),
    swingAngleDeg: finite.min(1).max(180).optional(),
    isOpening: z.boolean().optional(),
  })
  .strict()
const cornerMode = z.enum(['turn', 'platform'])
const stairPatch = z
  .object({
    points: z.array(point).min(1).optional(),
    width: positive.optional(),
    stepDepth: positive.optional(),
    spiralPoleDiameter: finite.nonnegative().nullable().optional(),
    spiralSweepDegrees: finite.min(90).max(360).nullable().optional(),
    spiralRotationDeg: finite.nullable().optional(),
    cornerStyle: z.enum(['round', 'sharp']).optional(),
    cornerMode: cornerMode.optional(),
    cornerModeOverrides: z.record(z.string(), cornerMode).nullable().optional(),
    showUpArrow: z.boolean().optional(),
    invertUpArrow: z.boolean().optional(),
  })
  .strict()
const graphicPatch = z
  .object({
    width: positive.optional(),
    height: positive.optional(),
    rotationDeg: finite.optional(),
    pos: point.optional(),
  })
  .strict()
const documentPatch = z
  .object({
    name: z.string().optional(),
    category: z.enum(['inspection', 'datasheet', 'sourcePlan', 'schematic', 'other']).optional(),
    includeInExport: z.boolean().optional(),
    exportPages: z.array(finite.int().positive()).nullable().optional(),
    teamDocumentId: optionalText,
    oneWire: z
      .object({
        placements: z
          .record(
            z.string().regex(/^[1-9]\d{0,3}$/),
            z.object({ x: finite, y: finite, width: positive }).strict().nullable()
          )
          .optional(),
        hiddenPages: z.array(finite.int().positive()).max(1000).optional(),
        x: finite.nullable().optional(),
        y: finite.nullable().optional(),
        width: positive.nullable().optional(),
        levels: finite.min(0).max(2).optional(),
        highPass: finite.min(0).max(2).optional(),
        opacity: finite.min(10).max(100).optional(),
        blend: z.boolean().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    links: z
      .array(
        z
          .object({ type: z.string().min(1), id: z.string().min(1), label: z.string().optional() })
          .strict()
      )
      .optional(),
  })
  .strict()
const ids = z.array(z.string().min(1)).min(1)
export const generalPropertyEditSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('project'), ids, set: projectPatch }).strict(),
  z.object({ kind: z.literal('site'), ids, set: sitePatch }).strict(),
  z
    .object({ kind: z.literal('note'), ids, scope: z.enum(['oneWire', 'sitplan']), set: notePatch })
    .strict(),
  z.object({ kind: z.literal('frame'), ids, set: framePatch }).strict(),
  z.object({ kind: z.literal('wall'), ids, set: wallPatch }).strict(),
  z.object({ kind: z.literal('door'), ids, set: doorPatch }).strict(),
  z.object({ kind: z.literal('window'), ids, set: openingPatch }).strict(),
  z.object({ kind: z.literal('stair'), ids, set: stairPatch }).strict(),
  z.object({ kind: z.literal('graphicElement'), ids, set: graphicPatch }).strict(),
  z.object({ kind: z.literal('document'), ids, set: documentPatch }).strict(),
])
export type GeneralPropertyEdit = z.infer<typeof generalPropertyEditSchema>
const kinds = new Set([
  'project',
  'site',
  'note',
  'frame',
  'wall',
  'door',
  'window',
  'stair',
  'graphicElement',
  'document',
])
export function isGeneralPropertyEdit(edit: { kind: string }): edit is GeneralPropertyEdit {
  return kinds.has(edit.kind)
}
const collections = {
  wall: 'walls',
  door: 'doors',
  window: 'windows',
  stair: 'stairs',
  graphicElement: 'graphicElements',
} as const
function resolve(project: ProjectV2, edit: GeneralPropertyEdit, id: string): object | undefined {
  if (edit.kind === 'project') return project.project.id === id ? project.project : undefined
  if (edit.kind === 'site') return project.project.id === id ? (project.site ?? {}) : undefined
  if (edit.kind === 'note')
    return (
      edit.scope === 'oneWire' ? queryOneWireNotes(project) : querySitplanNotes(project)
    ).find((item) => item.id === id)
  if (edit.kind === 'frame') return queryOneWireFrames(project).find((item) => item.id === id)
  if (edit.kind === 'document')
    return getProjectDocumentPatchAsset(
      project.assets ?? [],
      id,
      normalizePatch({}, edit.set) as ProjectDocumentPatch
    )
      ? (getProjectDocuments(project.assets).find((item) => item.id === id) ?? {})
      : undefined
  for (const floor of selectProjectBuildingFloors(project)) {
    const entity = selectProjectFloorPlan(project, floor.id)?.[collections[edit.kind]]?.find(
      (item) => item.id === id
    )
    if (entity) return entity
  }
  return undefined
}
export function checkGeneralPropertyEdit(
  project: ProjectV2,
  edit: GeneralPropertyEdit
): CommandCheck {
  for (const id of edit.ids) {
    const entity = resolve(project, edit, id)
    if (!entity)
      return { ok: false, code: 'stale_target', message: 'The property target no longer exists.' }
    if (edit.kind === 'graphicElement' && ('width' in edit.set || 'height' in edit.set)) {
      const element = entity as { sizeLocked?: boolean; assetId: string }
      if (element.sizeLocked || getPlanGraphicElementAsset(element.assetId)?.sizeLocked)
        return { ok: false, code: 'size_locked', message: 'This graphic has fixed dimensions.' }
    }
    if (
      edit.kind === 'wall' &&
      edit.set.points &&
      !edit.set.curve &&
      !(entity as { curve?: unknown }).curve &&
      new Set(edit.set.points.map((point) => `${point.x}:${point.y}`)).size < 2
    )
      return { ok: false, code: 'invalid_wall', message: 'A wall requires two distinct points.' }
    if (
      edit.kind === 'wall' &&
      edit.set.points &&
      (edit.set.curve || (entity as { curve?: unknown }).curve) &&
      edit.set.points.length !== 3
    )
      return { ok: false, code: 'invalid_curve', message: 'A curved wall requires three points.' }
  }
  return { ok: true }
}
export function applyGeneralPropertyEdit(
  project: ProjectV2,
  edit: GeneralPropertyEdit,
  _env: CommandEnv
): EntityRef[] {
  const changed: EntityRef[] = []
  for (const id of edit.ids) {
    const current = resolve(project, edit, id) as Record<string, unknown> | undefined
    if (!current) continue
    const patch = normalizePatch(current, edit.set as Record<string, unknown>)
    if (edit.kind === 'project' && edit.set.installerOverride && patch.installerOverride) {
      const installer = patch.installerOverride as Record<string, unknown>
      for (const key of ['signatureDataUrl', 'logoDataUrl'] as const)
        if (key in edit.set.installerOverride && edit.set.installerOverride[key] === null)
          installer[key] = null
    }
    if (edit.kind === 'stair' && 'cornerModeOverrides' in edit.set)
      patch.cornerModeOverrides = edit.set.cornerModeOverrides ?? undefined
    if (edit.kind === 'document') {
      const next = getProjectDocumentPatchAsset(project.assets, id, patch as ProjectDocumentPatch)!
      const index = project.assets.findIndex((asset) => asset.id === next.id)
      if (
        index >= 0 &&
        !patchChanges(
          project.assets[index] as unknown as Record<string, unknown>,
          next as unknown as Record<string, unknown>
        )
      )
        continue
      if (index < 0) project.assets.push(next)
      else project.assets[index] = next
    } else {
      if (!patchChanges(current, patch)) continue
      if (edit.kind === 'project')
        updateProjectMetadataInProject(project, patch as Partial<ProjectV2['project']>)
      else if (edit.kind === 'site') project.site = { ...project.site, ...patch }
      else if (edit.kind === 'note' || edit.kind === 'frame')
        updateAnnotationPropertiesInProject(
          project,
          edit.kind,
          id,
          patch,
          edit.kind === 'note' ? edit.scope : undefined
        )
      else if (!updateBuildingPropertiesInProject(project, edit.kind, id, patch)) continue
    }
    changed.push({ kind: edit.kind, id })
  }
  return changed
}
