import { selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
import { calculateBottomUpLayout, type BottomUpLayoutResult } from './bottomUpLayout'
import {
  buildLayoutTree,
  getLayoutNodeIdentityKey,
  type LayoutNode,
  type LayoutTree,
} from './layoutTree'
import { deriveWires } from './deriveWires'
import { resolveSupplyDeviceMounting } from '@/lib/panel/auxiliarySupplyEnclosures'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  selectProjectSupplyAssemblies,
} from '@/lib/projectV2/electrical'
import type { ProjectV2 } from '@/types/projectV2'
import type { WireSegment } from '@/types/schema'
import type { Point } from '@/types/ui'

type OverrideCache = WeakMap<Map<string, Point>, BottomUpLayoutResult>
type AssemblyCache = WeakMap<object, OverrideCache>
type PanelCache = WeakMap<object, AssemblyCache>

const layoutCache = new WeakMap<object, PanelCache>()
const layoutTreeCache = new WeakMap<BottomUpLayoutResult, LayoutTree>()
const wireCache = new WeakMap<LayoutTree, WeakMap<object, WireSegment[]>>()
const projectIdByLayout = new WeakMap<BottomUpLayoutResult, string>()
const equivalentLayoutSourceByProject = new WeakMap<ProjectV2, ProjectV2>()
const latestLayoutTreeByProjectId = new Map<string, LayoutTree>()
const layoutTreesByProjectShape = new Map<string, Map<string, LayoutTree>>()
const latestWiresByProjectId = new Map<string, WireSegment[]>()

const MAX_REMEMBERED_PROJECTS = 10
const MAX_REMEMBERED_LAYOUT_SHAPES = 8

function projectCacheKey(project: ProjectV2): string {
  return `${project.project.id}\u0000${project.project.createdAt}`
}

function rememberLatest<T>(cache: Map<string, T>, projectId: string, value: T): void {
  cache.delete(projectId)
  cache.set(projectId, value)
  if (cache.size > MAX_REMEMBERED_PROJECTS) {
    const oldestKey = cache.keys().next().value as string | undefined
    if (oldestKey) cache.delete(oldestKey)
  }
}

function layoutTreeShapeKey(tree: LayoutTree): string {
  const parts = [`${tree.totalWidth}x${tree.totalHeight}`]
  const visit = (node: LayoutNode) => {
    parts.push(`${node.type}:${node.bounds.width}x${node.bounds.height}:${node.children.length}`)
    node.children.forEach(visit)
  }
  tree.panels.forEach(visit)
  return parts.join('|')
}

function findPreviousLayoutTree(projectId: string, next: LayoutTree): LayoutTree | undefined {
  const byShape = layoutTreesByProjectShape.get(projectId)
  return byShape?.get(layoutTreeShapeKey(next)) ?? latestLayoutTreeByProjectId.get(projectId)
}

function rememberLayoutTree(projectId: string, tree: LayoutTree): void {
  rememberLatest(latestLayoutTreeByProjectId, projectId, tree)
  let byShape = layoutTreesByProjectShape.get(projectId)
  if (!byShape) {
    byShape = new Map()
    layoutTreesByProjectShape.set(projectId, byShape)
  }
  const shapeKey = layoutTreeShapeKey(tree)
  byShape.delete(shapeKey)
  byShape.set(shapeKey, tree)
  if (byShape.size > MAX_REMEMBERED_LAYOUT_SHAPES) {
    const oldestShape = byShape.keys().next().value as string | undefined
    if (oldestShape) byShape.delete(oldestShape)
  }
  if (layoutTreesByProjectShape.size > MAX_REMEMBERED_PROJECTS) {
    const oldestProject = layoutTreesByProjectShape.keys().next().value as string | undefined
    if (oldestProject) layoutTreesByProjectShape.delete(oldestProject)
  }
}

function equalDerivedValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => equalDerivedValue(value, right[index]))
  }
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  if (leftKeys.length !== Object.keys(rightRecord).length) return false
  return leftKeys.every(
    (key) => Object.hasOwn(rightRecord, key) && equalDerivedValue(leftRecord[key], rightRecord[key])
  )
}

export function reconcileLayoutNode(next: LayoutNode, previous: LayoutNode | undefined): LayoutNode {
  if (!previous || previous.id !== next.id || previous.type !== next.type) return next

  const previousChildren = new Map<string, LayoutNode[]>()
  for (const child of previous.children) {
    const key = getLayoutNodeIdentityKey(child)
    const matches = previousChildren.get(key)
    if (matches) matches.push(child)
    else previousChildren.set(key, [child])
  }
  const children = next.children.map((child) => {
    const key = getLayoutNodeIdentityKey(child)
    return reconcileLayoutNode(child, previousChildren.get(key)?.shift())
  })
  const childrenMatchPrevious =
    children.length === previous.children.length &&
    children.every((child, index) => child === previous.children[index])
  const reconciled = childrenMatchPrevious ? previous.children : children

  const { children: _nextChildren, domainRef: nextDomainRef, ...nextOwn } = next
  const { children: _previousChildren, domainRef: previousDomainRef, ...previousOwn } = previous
  if (
    equalDerivedValue(nextDomainRef, previousDomainRef) &&
    childrenMatchPrevious &&
    equalDerivedValue(nextOwn, previousOwn)
  ) {
    return previous
  }
  return reconciled === next.children ? next : { ...next, children: reconciled }
}

function reconcileLayoutTree(next: LayoutTree, previous: LayoutTree | undefined): LayoutTree {
  if (!previous) return next
  const previousPanels = new Map(
    previous.panels.map((panel) => [panel.diagramId ?? panel.id, panel])
  )
  const panels = next.panels.map((panel) =>
    reconcileLayoutNode(panel, previousPanels.get(panel.diagramId ?? panel.id))
  )
  if (
    panels.length === previous.panels.length &&
    panels.every((panel, index) => panel === previous.panels[index]) &&
    next.totalWidth === previous.totalWidth &&
    next.totalHeight === previous.totalHeight
  ) {
    return previous
  }
  return { ...next, panels }
}

function wireRenderValueKey(segment: WireSegment): string {
  const { id: _generatedId, ...renderedSegment } = segment
  return JSON.stringify(renderedSegment)
}

/**
 * Stable electrical identity for a drawable wire. Geometry and presentation are
 * deliberately excluded: those are allowed to update without remounting the
 * corresponding Konva node. Repeated orthogonal pieces with the same topology
 * are reconciled in derivation order.
 */
function wireTopologyKey(segment: WireSegment): string {
  return JSON.stringify([
    segment.type,
    segment.panelId,
    segment.diagramId,
    segment.circuitId,
    segment.busSectionId,
    segment.fromElementType,
    segment.fromElementId,
    segment.toElementType,
    segment.toElementId,
    segment.isSupplyTrunk,
    segment.isSubPanelSupply,
    segment.feederProtectionId,
    segment.supplyAssemblyId,
    segment.supplyConnectionId,
    segment.supplySectionKey,
    segment.supplyWireRole,
    segment.supplyFeedScope,
    segment.supplySegmentIndex,
    segment.domoticaOutputGroup,
    segment.domoticaOutputIndex,
    segment.converterDcConnection?.converterId,
    segment.converterDcConnection?.connectionIndex,
    segment.busFeedKind,
  ])
}

function getOrCreateWeakMap<K extends object, V>(cache: WeakMap<K, V>, key: K, create: () => V): V {
  const cached = cache.get(key)
  if (cached) return cached
  const value = create()
  cache.set(key, value)
  return value
}

function resolveEquivalentLayoutSource(project: ProjectV2): ProjectV2 {
  let source = project
  const visited = new Set<ProjectV2>()
  while (!visited.has(source)) {
    visited.add(source)
    const next = equivalentLayoutSourceByProject.get(source)
    if (!next) break
    source = next
  }
  return source
}

/**
 * Stable project revision for canvas owners that only consume layout-level data.
 * Visual-only endpoint revisions render through their leaf entity subscriptions and
 * must not wake every parent canvas subscriber.
 */
export function getEendraadRenderProjectRevision(project: ProjectV2): ProjectV2 {
  return resolveEquivalentLayoutSource(project)
}

/**
 * Reuse geometry for a revision that changed only endpoint artwork overlays.
 * EndpointSymbol reads the current endpoint record independently, so the layout
 * tree can remain stable while the one affected symbol updates.
 */
export function inheritEendraadLayoutForVisualEndpointChange(
  previousProject: ProjectV2,
  nextProject: ProjectV2
): void {
  equivalentLayoutSourceByProject.set(nextProject, resolveEquivalentLayoutSource(previousProject))
}

export function hasInheritedEendraadLayout(project: ProjectV2): boolean {
  return equivalentLayoutSourceByProject.has(project)
}

/**
 * Return the synchronous one-wire layout for a canonical V2 electrical revision.
 *
 * React hook memoization is local to each mounted consumer. The canvas, hit testing,
 * wire rendering, dialogs, and individual symbols all ask for the same layout, so a
 * module cache is needed to make that expensive derivation shared. Keys are the
 * canonical electrical containers rather than the project root: metadata-only writes
 * such as `updatedAt` therefore keep the valid layout, while every electrical Immer
 * revision still invalidates it immediately.
 */
export function getCachedEendraadLayout(
  project: ProjectV2,
  overrides: Map<string, Point>
): BottomUpLayoutResult {
  const layoutSource = resolveEquivalentLayoutSource(project)
  const installation = getProjectElectricalInstallation(layoutSource)
  if (!installation) {
    return calculateBottomUpLayout(project, new Map(overrides))
  }

  const panels = getProjectElectricalPanels(layoutSource)
  const supplyAssemblies = layoutSource.disciplines?.electrical?.supplyAssemblies
  const supplyAssembliesCacheKey = supplyAssemblies ?? layoutSource.disciplines?.electrical ?? installation
  const panelCache = getOrCreateWeakMap(layoutCache, installation, () => new WeakMap())
  const assemblyCache = getOrCreateWeakMap(panelCache, panels, () => new WeakMap())
  const overrideCache = getOrCreateWeakMap(assemblyCache, supplyAssembliesCacheKey, () => new WeakMap())
  const cached = overrideCache.get(overrides)
  if (cached) return cached

  const layoutStartedAt = import.meta.env.VITE_E2E ? performance.now() : 0
  const layout = calculateBottomUpLayout(project, new Map(overrides))
  if (import.meta.env.VITE_E2E) {
    performance.measure('eendra:layout-derivation', {
      start: layoutStartedAt,
      end: performance.now(),
    })
  }
  projectIdByLayout.set(layout, projectCacheKey(project))
  overrideCache.set(overrides, layout)
  return layout
}

export function getCachedLayoutTree(layout: BottomUpLayoutResult): LayoutTree {
  return getOrCreateWeakMap(layoutTreeCache, layout, () => {
    const startedAt = import.meta.env.VITE_E2E ? performance.now() : 0
    const projectId = projectIdByLayout.get(layout)
    const next = buildLayoutTree(layout)
    const result = projectId ? reconcileLayoutTree(next, findPreviousLayoutTree(projectId, next)) : next
    if (projectId) rememberLayoutTree(projectId, result)
    if (import.meta.env.VITE_E2E) {
      performance.measure('eendra:layout-tree', { start: startedAt, end: performance.now() })
    }
    return result
  })
}

export function getCachedEendraadWireSegments(
  project: ProjectV2,
  layoutTree: LayoutTree
): WireSegment[] {
  const electrical = project.disciplines?.electrical
  const installation = getProjectElectricalInstallation(project)
  if (!installation) return []
  const auxiliaryEnclosuresCacheKey = electrical ?? installation
  const enclosureCache = getOrCreateWeakMap(wireCache, layoutTree, () => new WeakMap())
  const cached = enclosureCache.get(auxiliaryEnclosuresCacheKey)
  if (cached) return cached

  const startedAt = import.meta.env.VITE_E2E ? performance.now() : 0
  const derivedWires = deriveWires(
    layoutTree,
    getProjectElectricalPanels(project),
    installation,
    selectProjectSupplyAssemblies(project),
    (deviceId) => resolveSupplyDeviceMounting(project, deviceId),
    selectProjectWireRuns(project)
  )
  const previousByTopology = new Map<string, WireSegment[]>()
  const projectKey = projectCacheKey(project)
  for (const segment of latestWiresByProjectId.get(projectKey) ?? []) {
    const key = wireTopologyKey(segment)
    const matches = previousByTopology.get(key)
    if (matches) matches.push(segment)
    else previousByTopology.set(key, [segment])
  }
  const wires = derivedWires.map((segment) => {
    const previous = previousByTopology.get(wireTopologyKey(segment))?.shift()
    if (!previous) return segment
    if (wireRenderValueKey(previous) === wireRenderValueKey(segment)) return previous
    return { ...segment, id: previous.id }
  })
  rememberLatest(latestWiresByProjectId, projectKey, wires)
  enclosureCache.set(auxiliaryEnclosuresCacheKey, wires)
  if (import.meta.env.VITE_E2E) {
    performance.measure('eendra:wire-derivation', { start: startedAt, end: performance.now() })
  }
  return wires
}
