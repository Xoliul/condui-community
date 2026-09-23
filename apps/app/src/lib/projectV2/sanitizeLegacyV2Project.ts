import type { AssetModelV2, ProjectV2 } from '@/types/projectV2'

const OBSOLETE_PROJECT_SNAPSHOT_KEY = ['legacy', 'Project'].join('')

type ElectricalModelWithObsoleteSnapshot = NonNullable<
  ProjectV2['disciplines']['electrical']
> & Record<string, unknown>

type LegacyFloorAssetPayload = {
  id?: string
  planAsset?: string
  planAssetProcessed?: string
  planImportAsset?: {
    dataUrl?: string
    processedDataUrl?: string
  }
}

function isInlineDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:')
}

function isFloorPlanAsset(asset: AssetModelV2): boolean {
  return (
    asset.kind === 'floorplan-source' ||
    asset.kind === 'floorplan-processed' ||
    asset.kind === 'floorplan-vector'
  )
}

function legacyAssetContainsPayload(asset: AssetModelV2): boolean {
  return Boolean(
    asset.legacy?.dataUrl || asset.legacy?.processedDataUrl || asset.legacy?.svgContent
  )
}

export function hasLegacyV2ProjectBloat(project: unknown): boolean {
  if (!project || typeof project !== 'object') return false
  const candidate = project as Partial<ProjectV2>
  const schemaVersion = (project as { schemaVersion?: unknown }).schemaVersion
  if (schemaVersion !== '2.0.0' && schemaVersion !== '2.1.0' && schemaVersion !== '2.2.0')
    return false

  const electrical = candidate.disciplines?.electrical as
    | ElectricalModelWithObsoleteSnapshot
    | undefined
  if (
    electrical &&
    Object.prototype.hasOwnProperty.call(electrical, OBSOLETE_PROJECT_SNAPSHOT_KEY)
  ) {
    return true
  }
  if (
    candidate.building?.floors.some(
      (floor) => isInlineDataUrl(floor.planAssetId) || isInlineDataUrl(floor.processedPlanAssetId)
    )
  ) {
    return true
  }
  return Boolean(
    candidate.assets?.some(
      (asset) =>
        isFloorPlanAsset(asset) &&
        (isInlineDataUrl(asset.id) || legacyAssetContainsPayload(asset))
    )
  )
}

function cloneProject(project: ProjectV2): ProjectV2 {
  if (typeof structuredClone === 'function') return structuredClone(project)
  return JSON.parse(JSON.stringify(project)) as ProjectV2
}

function withoutLegacyPayloads(asset: AssetModelV2): AssetModelV2 {
  if (!asset.legacy) return asset
  const {
    dataUrl: _dataUrl,
    processedDataUrl: _processedDataUrl,
    svgContent: _svgContent,
    ...metadata
  } = asset.legacy
  return {
    ...asset,
    legacy: metadata,
  }
}

function withPromotedLegacyPayloads(asset: AssetModelV2): AssetModelV2 {
  if (!asset.legacy) return asset
  if (asset.kind === 'floorplan-processed') {
    return {
      ...asset,
      dataUrl: asset.dataUrl ?? asset.legacy.processedDataUrl ?? asset.legacy.dataUrl,
    }
  }
  return {
    ...asset,
    dataUrl: asset.dataUrl ?? asset.legacy.dataUrl,
    svgContent: asset.svgContent ?? asset.legacy.svgContent,
  }
}

function legacyFloorsFromUnknown(value: unknown): LegacyFloorAssetPayload[] {
  if (!value || typeof value !== 'object') return []
  const floors = (value as { floors?: unknown }).floors
  return Array.isArray(floors) ? (floors as LegacyFloorAssetPayload[]) : []
}

function mergeAssets(preferred: AssetModelV2, fallback: AssetModelV2): AssetModelV2 {
  const merged = { ...fallback, ...preferred }
  if (fallback.legacy || preferred.legacy) {
    merged.legacy = {
      ...(fallback.legacy ?? {}),
      ...(preferred.legacy ?? {}),
    } as NonNullable<AssetModelV2['legacy']>
  }
  return merged
}

function nextAvailableAssetId(base: string, usedIds: Set<string>): string {
  let candidate = base
  let suffix = 2
  while (usedIds.has(candidate)) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  usedIds.add(candidate)
  return candidate
}

/**
 * Repairs the short-lived V2 format that duplicated floor-plan payloads into
 * asset ids, legacy asset metadata, and the obsolete full-project snapshot.
 * Returns the original object when no repair is needed.
 */
export function sanitizeLegacyV2Project(project: ProjectV2): {
  project: ProjectV2
  changed: boolean
} {
  if (!hasLegacyV2ProjectBloat(project)) return { project, changed: false }

  const next = cloneProject(project)
  const electrical = next.disciplines.electrical as
    | ElectricalModelWithObsoleteSnapshot
    | undefined
  const obsoleteSnapshot = electrical?.[OBSOLETE_PROJECT_SNAPSHOT_KEY]
  const runtimeCompatibilityFloors = legacyFloorsFromUnknown(next)
  const snapshotFloors = legacyFloorsFromUnknown(obsoleteSnapshot)
  const legacyFloorById = new Map(
    [...runtimeCompatibilityFloors, ...snapshotFloors]
      .filter((floor): floor is LegacyFloorAssetPayload & { id: string } => Boolean(floor.id))
      .map((floor) => [floor.id, floor])
  )

  next.assets = next.assets.map((asset) =>
    isFloorPlanAsset(asset) ? withPromotedLegacyPayloads(asset) : asset
  )

  const floorPlanAssets = next.assets.filter(isFloorPlanAsset)
  const stableAssetByPayloadAndKind = new Map<string, AssetModelV2>()
  const replacementByAssetId = new Map<string, string>()
  const usedIds = new Set([
    ...next.assets.filter((asset) => !isInlineDataUrl(asset.id)).map((asset) => asset.id),
    ...next.building.floors.flatMap((floor) =>
      [floor.planAssetId, floor.processedPlanAssetId].filter(
        (id): id is string => Boolean(id) && !isInlineDataUrl(id)
      )
    ),
  ])

  for (const asset of floorPlanAssets) {
    if (!isInlineDataUrl(asset.id) && asset.dataUrl) {
      stableAssetByPayloadAndKind.set(`${asset.kind}\0${asset.dataUrl}`, asset)
    }
  }

  for (const floor of next.building.floors) {
    const legacyFloor = legacyFloorById.get(floor.id)
    const legacySourcePayload =
      legacyFloor?.planImportAsset?.dataUrl ?? legacyFloor?.planAsset
    const legacyProcessedPayload =
      legacyFloor?.planImportAsset?.processedDataUrl ?? legacyFloor?.planAssetProcessed
    const sourceId = floor.planAssetId
    if (isInlineDataUrl(sourceId)) {
      const stable = stableAssetByPayloadAndKind.get(`floorplan-source\0${sourceId}`)
      const replacement =
        stable?.id ?? nextAvailableAssetId(`floor-${floor.id}-source`, usedIds)
      replacementByAssetId.set(sourceId, replacement)
      floor.planAssetId = replacement
      if (!stable) {
        const recoveredAsset: AssetModelV2 = {
          id: replacement,
          kind: 'floorplan-source',
          dataUrl: sourceId,
        }
        floorPlanAssets.push(recoveredAsset)
        next.assets.push(recoveredAsset)
      }
    } else if (
      sourceId &&
      !floorPlanAssets.some((asset) => asset.id === sourceId) &&
      legacySourcePayload
    ) {
      const recoveredAsset: AssetModelV2 = {
        id: sourceId,
        kind: 'floorplan-source',
        dataUrl: legacySourcePayload,
      }
      floorPlanAssets.push(recoveredAsset)
      next.assets.push(recoveredAsset)
    }

    const processedId = floor.processedPlanAssetId
    if (isInlineDataUrl(processedId)) {
      const stable = stableAssetByPayloadAndKind.get(`floorplan-processed\0${processedId}`)
      const sourceAssetId = floor.planAssetId
      const replacement =
        stable?.id ??
        nextAvailableAssetId(
          sourceAssetId && !isInlineDataUrl(sourceAssetId)
            ? `${sourceAssetId}-processed`
            : `floor-${floor.id}-processed`,
          usedIds
        )
      replacementByAssetId.set(processedId, replacement)
      floor.processedPlanAssetId = replacement
      if (!stable) {
        const recoveredAsset: AssetModelV2 = {
          id: replacement,
          kind: 'floorplan-processed',
          dataUrl: processedId,
        }
        floorPlanAssets.push(recoveredAsset)
        next.assets.push(recoveredAsset)
      }
    } else if (
      processedId &&
      !floorPlanAssets.some((asset) => asset.id === processedId)
    ) {
      const sourceAsset = floorPlanAssets.find((asset) => asset.id === floor.planAssetId)
      const recoveredProcessedPayload =
        sourceAsset?.legacy?.processedDataUrl ?? legacyProcessedPayload
      const processedAsset = recoveredProcessedPayload
        ? floorPlanAssets.find(
            (asset) =>
              asset.kind === 'floorplan-processed' && asset.dataUrl === recoveredProcessedPayload
          )
        : undefined
      if (processedAsset) {
        replacementByAssetId.set(processedAsset.id, processedId)
      } else if (recoveredProcessedPayload) {
        const recoveredAsset: AssetModelV2 = {
          id: processedId,
          kind: 'floorplan-processed',
          dataUrl: recoveredProcessedPayload,
        }
        floorPlanAssets.push(recoveredAsset)
        next.assets.push(recoveredAsset)
      }
    }
  }

  if (electrical) delete electrical[OBSOLETE_PROJECT_SNAPSHOT_KEY]

  const sanitizedAssets = new Map<string, AssetModelV2>()
  let fallbackIndex = 1
  for (const originalAsset of next.assets) {
    let asset = withoutLegacyPayloads(originalAsset)
    const referencedReplacement = replacementByAssetId.get(asset.id)
    if (isFloorPlanAsset(asset) && referencedReplacement) {
      asset = { ...asset, id: referencedReplacement }
    } else if (isFloorPlanAsset(asset) && isInlineDataUrl(asset.id)) {
      const stable = asset.dataUrl
        ? stableAssetByPayloadAndKind.get(`${asset.kind}\0${asset.dataUrl}`)
        : undefined
      const replacement =
        replacementByAssetId.get(asset.id) ??
        stable?.id ??
        nextAvailableAssetId(`legacy-floorplan-asset-${fallbackIndex++}`, usedIds)
      asset = { ...asset, id: replacement }
    }

    const existing = sanitizedAssets.get(asset.id)
    sanitizedAssets.set(asset.id, existing ? mergeAssets(existing, asset) : asset)
  }
  next.assets = Array.from(sanitizedAssets.values())

  return { project: next, changed: true }
}
