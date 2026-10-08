import {
  queryOneWireFrames,
  queryOneWireSegments,
  type AnnotationProject,
} from '@/lib/projectV2/annotations'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  selectProjectSupplyAssemblies,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import {
  selectProjectBuildingFloors,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import { selectProjectWireRuns, type ProjectWithOptionalV2WireRuns } from '@/lib/projectV2/wireRuns'

type ValidationSignatureProject = ProjectWithOptionalV2Electrical &
  ProjectWithOptionalV2WireRuns &
  AnnotationProject & {
    building?: ProjectWithOptionalV2Building['building']
    floors?: ProjectWithOptionalV2Building['floors']
    project?: unknown
  }

/**
 * Data that the validation engine actually reads. Excludes general floor plan
 * geometry (walls, doors, windows, sitplan notes, etc.) so that drawing in plan
 * mode does not trigger re-validation. Situation-plan visibility and symbol
 * pose (position, rotation, scale, hide/show) are also excluded: only whether
 * a required symbol is missing from the plan is validation-relevant.
 *
 * IMPORTANT: We aggressively memoize the validation signature based on these
 * top-level keys so that large projects do not incur a full JSON.stringify
 * on every project update (for example, while panning or drawing in plan
 * mode where only floors change).
 */
const VALIDATION_KEYS = ['project', 'installation', 'panels'] as const

const NON_VALIDATION_KEYS = new Set([
  // Implementation details / churn
  'createdAt',
  'updatedAt',

  // UI-only flags (visual toggles)
  'showDomainChangeLabel',
  'symbolLabelDisplay',
  'hideWireLabel',
  'notesVisible',
  'waterproof',
  'switchOverlay',
  'switchOverlayLock',

  // Free-form text
  'text',
  'title',

  // Positional / rotational / pose properties
  'pos',
  'rotationDeg',
  'rotationMode',
  'scale',
  'locked',
  'startPoint',
  'endPoint',
  'wireRoute',
  'metadataCalloutOffset',
])

// These affect documentation rules even though their names look like display-only flags.
const VALIDATION_RELEVANT_DISPLAY_KEYS = new Set(['showWireLengthLabel'])
const OPTIONAL_VISUAL_PROPERTY_GROUPS = new Set(['socketProps', 'lightPointProps'])

function isCircuitLikeObject(obj: Record<string, unknown>): boolean {
  // Minimal structural heuristics to identify circuit objects in the project schema:
  // circuits have code + cable + endpoints (array). We intentionally do NOT rely on
  // ids/names/labels because those are treated as descriptive and stripped.
  return typeof obj.code === 'string' && !!obj.cable && Array.isArray(obj.endpoints)
}

function isPoint2(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const point = value as Record<string, unknown>
  return typeof point.x === 'number' && typeof point.y === 'number'
}

/** Endpoint, trunk-device, earthing, and junction-panel symbols on a floor plan. */
function isSituationPlanPlacement(obj: Record<string, unknown>): boolean {
  return typeof obj.id === 'string' && typeof obj.floorId === 'string' && isPoint2(obj.pos)
}

/**
 * Strip non-validation fields from the project slice so that purely visual
 * toggles (like showDomainChangeLabel on trunk devices) do not trigger
 * re-validation.
 */
function stripNonValidationFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripNonValidationFields)
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (isSituationPlanPlacement(obj)) {
      // Presence and floor identity only. Dragging, rotating, scaling, or
      // hiding a symbol must not schedule a validation run.
      return { id: obj.id, floorId: obj.floorId }
    }
    const out: Record<string, unknown> = {}
    const isCircuit = isCircuitLikeObject(obj)
    for (const [key, val] of Object.entries(obj)) {
      // Locale-specific display names (e.g. panel.nameByLocale) are descriptive only.
      if (key.endsWith('ByLocale')) continue

      // A broad, centralized list of non-validation fields.
      if (NON_VALIDATION_KEYS.has(key)) continue

      // Circuit notes are validation-relevant (used for heuristics like bathroom detection).
      // Keep them only on circuit objects to avoid re-validation spam from arbitrary note
      // fields elsewhere in the project graph.
      if (key === 'notes' && !isCircuit) continue

      if (VALIDATION_RELEVANT_DISPLAY_KEYS.has(key)) {
        out[key] = stripNonValidationFields(val)
        continue
      }

      // Flags that are clearly UI-only (catch-all for current/future toggles).
      if (key.endsWith('Visible')) continue
      if (key.startsWith('show') && key.endsWith('Label')) continue
      if (key.startsWith('hide') && key.endsWith('Label')) continue

      const strippedValue = stripNonValidationFields(val)
      if (
        OPTIONAL_VISUAL_PROPERTY_GROUPS.has(key) &&
        isPlainObject(strippedValue) &&
        Object.keys(strippedValue).length === 0
      ) {
        continue
      }
      out[key] = strippedValue
    }
    return out
  }
  return value
}

// Simple module-level cache so that computing the validation signature is
// effectively O(1) when the validation-relevant slices of the project have
// not changed by reference. This relies on the project store updating
// different slices immutably (new array/object) only when they actually
// change, which is how the project store is structured.
let lastProjectSlices: {
  projectMetadataSignature: string
  installation: ReturnType<typeof getProjectElectricalInstallation>
  panels: ReturnType<typeof getProjectElectricalPanels>
  supplyAssemblies: ReturnType<typeof selectProjectSupplyAssemblies>
  wireSegments: ReturnType<typeof queryOneWireSegments>
  wireRuns: ReturnType<typeof selectProjectWireRuns>
  frames: ReturnType<typeof queryOneWireFrames>
  floors: ReturnType<typeof selectProjectBuildingFloors>
  junctionAssets: unknown
  terminalRails: unknown
  terminalShapes: unknown
} | null = null
let lastSignature = ''

/**
 * Returns a stable string that changes only when validation-relevant project
 * data changes. Used to avoid running validation on every project update
 * (e.g. when only floor plan geometry or visual flags change). Names,
 * labels and circuit codes are included because issue messages render them.
 */
export function getValidationSignature(project: ValidationSignatureProject | null): string {
  if (!project) return ''
  const projectMetadataSignature = JSON.stringify(stripNonValidationFields(project.project))
  const slices = {
    projectMetadataSignature,
    installation: getProjectElectricalInstallation(project),
    panels: getProjectElectricalPanels(project),
    supplyAssemblies: selectProjectSupplyAssemblies(project),
    wireSegments: queryOneWireSegments(project),
    wireRuns: selectProjectWireRuns(project),
    frames: queryOneWireFrames(project),
    floors: selectProjectBuildingFloors(project),
    // Hosted junction findings run with validation. Read the stored arrays directly: the
    // selectors return a fresh empty array when absent, which would defeat the cache.
    junctionAssets: project.disciplines?.electrical?.junctionAssets,
    terminalRails: project.disciplines?.electrical?.terminalRails,
    terminalShapes: project.disciplines?.electrical?.terminalShapes,
  }

  if (
    lastProjectSlices &&
    lastProjectSlices.projectMetadataSignature === slices.projectMetadataSignature &&
    lastProjectSlices.installation === slices.installation &&
    lastProjectSlices.panels === slices.panels &&
    lastProjectSlices.supplyAssemblies === slices.supplyAssemblies &&
    lastProjectSlices.wireSegments === slices.wireSegments &&
    lastProjectSlices.wireRuns === slices.wireRuns &&
    lastProjectSlices.frames === slices.frames &&
    lastProjectSlices.floors === slices.floors &&
    lastProjectSlices.junctionAssets === slices.junctionAssets &&
    lastProjectSlices.terminalRails === slices.terminalRails &&
    lastProjectSlices.terminalShapes === slices.terminalShapes
  ) {
    return lastSignature
  }

  const slice: Record<string, unknown> = {}
  for (const key of VALIDATION_KEYS) {
    const raw =
      key === 'installation'
        ? slices.installation
        : key === 'panels'
          ? slices.panels
          : project.project
    slice[key] = stripNonValidationFields(raw)
  }
  slice.wireSegments = stripNonValidationFields(slices.wireSegments)
  slice.wireRuns = stripNonValidationFields(slices.wireRuns)
  slice.supplyAssemblies = stripNonValidationFields(slices.supplyAssemblies)
  slice.oneWireFrames = slices.frames.map((frame) => ({
    id: frame.id,
    title: frame.title,
    panelId: frame.panelId,
    contentType: frame.contentType,
    contentIds: frame.contentIds,
    contentItems: frame.contentItems,
    trunkSpans: frame.trunkSpans,
  }))
  if (slices.junctionAssets) {
    slice.junction = {
      assets: slices.junctionAssets,
      rails: slices.terminalRails,
      shapes: slices.terminalShapes,
    }
  }
  slice.situationPlanFloors = slices.floors
    .map((floor) => floor.id)
    .sort((a, b) => a.localeCompare(b))

  lastProjectSlices = slices
  lastSignature = JSON.stringify(slice)
  return lastSignature
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function safeParseSignature(signature: string): unknown | null {
  if (!signature) return null
  try {
    return JSON.parse(signature) as unknown
  } catch {
    return null
  }
}

/**
 * Best-effort diff helper for debugging validation triggers.
 * Returns a list of JSON paths that changed between two signature strings.
 *
 * Intended for logging only: capped output, shallow-ish comparisons.
 */
export function diffValidationSignatures(
  prevSignature: string,
  nextSignature: string,
  options: { maxPaths?: number; maxDepth?: number } = {}
): string[] {
  const maxPaths = options.maxPaths ?? 25
  const maxDepth = options.maxDepth ?? 6

  const prev = safeParseSignature(prevSignature)
  const next = safeParseSignature(nextSignature)
  if (prev == null || next == null) return []

  const changed: string[] = []

  const push = (path: string) => {
    if (changed.length >= maxPaths) return
    changed.push(path || '$')
  }

  const walk = (a: unknown, b: unknown, path: string, depth: number) => {
    if (changed.length >= maxPaths) return
    if (depth > maxDepth) {
      if (a !== b) push(path)
      return
    }

    if (a === b) return

    const aIsArr = Array.isArray(a)
    const bIsArr = Array.isArray(b)
    if (aIsArr || bIsArr) {
      if (!aIsArr || !bIsArr) {
        push(path)
        return
      }
      const aa = a as unknown[]
      const bb = b as unknown[]
      if (aa.length !== bb.length) push(`${path}.length`)
      const n = Math.min(aa.length, bb.length, 10) // cap per-array work
      for (let i = 0; i < n; i++) {
        walk(aa[i], bb[i], `${path}[${i}]`, depth + 1)
        if (changed.length >= maxPaths) return
      }
      return
    }

    if (isPlainObject(a) && isPlainObject(b)) {
      const aKeys = Object.keys(a)
      const bKeys = Object.keys(b)
      const keySet = new Set([...aKeys, ...bKeys])
      for (const k of keySet) {
        if (!(k in a)) {
          push(`${path}.${k}(added)`)
          continue
        }
        if (!(k in b)) {
          push(`${path}.${k}(removed)`)
          continue
        }
        walk(a[k], b[k], path ? `${path}.${k}` : k, depth + 1)
        if (changed.length >= maxPaths) return
      }
      return
    }

    // primitives / mismatched types
    push(path)
  }

  walk(prev, next, '', 0)
  return changed
}
