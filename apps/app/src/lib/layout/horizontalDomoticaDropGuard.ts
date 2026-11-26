import type { Circuit, Endpoint, Panel } from '@/types/schema'
import { isHorizontalDomotica } from './domoticaHorizontalGeometry'
import {
  isDropTargetAfterHorizontalDomotica,
  isDropTargetIntoSupplyAssembly,
  type SupplyDropTargetFields,
  type SupplySideOwner,
} from '@/lib/eendraad/horizontalDomoticaTerminal'
import type { DropTarget } from './findDropTarget'
import { findCircuitInProject, type PreviewProject } from './eendraadPreviewModel'
import type { LayoutNode, LayoutTree } from './layoutTree'

const circuitsByTree = new WeakMap<LayoutTree, Map<string, Circuit>>()

function isCircuit(value: unknown): value is Circuit {
  const candidate = value as Partial<Circuit> | undefined
  return !!candidate && typeof candidate.id === 'string' && Array.isArray(candidate.endpoints)
}

function getTreeCircuits(tree: LayoutTree): Map<string, Circuit> {
  const known = circuitsByTree.get(tree)
  if (known) return known
  const circuits = new Map<string, Circuit>()
  const visit = (node: LayoutNode) => {
    if (isCircuit(node.domainRef) && !circuits.has(node.domainRef.id))
      circuits.set(node.domainRef.id, node.domainRef)
    for (const child of node.children) visit(child)
  }
  for (const panel of tree.panels) visit(panel)
  circuitsByTree.set(tree, circuits)
  return circuits
}

/** Whether the circuit of `target` holds a horizontal domotica module (cheap pre-check, cached per tree). */
function targetCircuit(tree: LayoutTree, target: DropTarget): Circuit | undefined {
  return target.circuitId ? getTreeCircuits(tree).get(target.circuitId) : undefined
}

/**
 * A horizontal domotica module is terminal: no hit zone may place anything after it. Zones are
 * resolved from the layout tree, so the guard turns such a hit into "no target" instead of
 * touching every zone emitter. Output zones of the module itself stay valid.
 */
export function withoutDropAfterHorizontalDomotica(tree: LayoutTree, target: DropTarget): DropTarget {
  const circuit = targetCircuit(tree, target)
  if (!circuit || !isDropTargetAfterHorizontalDomotica(circuit, target)) return target
  return { type: null, panelId: target.panelId, diagramId: target.diagramId }
}

export function isDropAfterHorizontalDomotica(tree: LayoutTree, target: DropTarget): boolean {
  const circuit = targetCircuit(tree, target)
  return !!circuit && isDropTargetAfterHorizontalDomotica(circuit, target)
}

/** Owners (protection, panel) of the circuits in a tree, read from its panel nodes. */
const ownersByTree = new WeakMap<LayoutTree, Map<string, SupplySideOwner>>()

function isPanel(value: unknown): value is Panel {
  const candidate = value as Partial<Panel> | undefined
  return !!candidate && Array.isArray(candidate.protections) && Array.isArray(candidate.circuits)
}

function getTreeCircuitOwners(tree: LayoutTree): Map<string, SupplySideOwner> {
  const known = ownersByTree.get(tree)
  if (known) return known
  const owners = new Map<string, SupplySideOwner>()
  const visit = (node: LayoutNode) => {
    if (isPanel(node.domainRef)) {
      const panel = node.domainRef
      for (const circuit of panel.circuits) if (!owners.has(circuit.id)) owners.set(circuit.id, { panel })
      for (const protection of panel.protections)
        for (const circuit of protection.circuits ?? [])
          if (!owners.has(circuit.id)) owners.set(circuit.id, { panel, protection })
    }
    for (const child of node.children) visit(child)
  }
  for (const panel of tree.panels) visit(panel)
  ownersByTree.set(tree, owners)
  return owners
}

/** Whether any of `ids` is a horizontal domotica module of the tree (the dragged item decides). */
export function isMovingHorizontalDomotica(tree: LayoutTree, ids: readonly string[] | undefined): boolean {
  if (!ids?.length) return false
  const moving = new Set(ids)
  return collectHorizontalModuleNodes(tree).some((node) => !!node.domainId && moving.has(node.domainId))
}

function isSupplyTarget(tree: LayoutTree, fields: SupplyDropTargetFields, circuitId?: string): boolean {
  const circuit = circuitId ? getTreeCircuits(tree).get(circuitId) : undefined
  return isDropTargetIntoSupplyAssembly(fields, circuit, circuitId ? getTreeCircuitOwners(tree).get(circuitId) : undefined)
}

/**
 * A horizontal domotica module never goes to the supply side: while one is dragged, a hit on a
 * supply wire, tap, converter lane, DC bus or supply-side circuit resolves to no target.
 */
export function withoutSupplyDropForHorizontalDomotica(tree: LayoutTree, target: DropTarget): DropTarget {
  if (!isSupplyTarget(tree, target, target.circuitId)) return target
  return { type: null, panelId: target.panelId, diagramId: target.diagramId }
}

/** Supply-side targets are not offered to a dragged horizontal module (branch intents). */
export function isSupplyDropTargetForHorizontalDomotica(tree: LayoutTree, target: DropTarget): boolean {
  return isSupplyTarget(tree, target, target.circuitId)
}

/** Hint counterpart: hints on the supply side disappear while a horizontal module is dragged. */
export function withoutSupplyHintsForHorizontalDomotica<
  T extends { targetType: string; match?: object & { circuitId?: string } },
>(tree: LayoutTree, hints: readonly T[], movingId: string | undefined, placingNew = false): T[] {
  // `placingNew`: a horizontal module is being created from the library, so nothing is moving yet.
  if (!placingNew && (!movingId || !isMovingHorizontalDomotica(tree, [movingId]))) return [...hints]
  return hints.filter(
    (hint) =>
      !isSupplyTarget(tree, { ...(hint.match as SupplyDropTargetFields | undefined), type: hint.targetType }, hint.match?.circuitId)
  )
}

/** Output zones of a module carry this infix in their node id. */
const OUTPUT_ZONE_INFIX = '-domotica-endpoint-output-'

function collectHorizontalModuleNodes(tree: LayoutTree): LayoutNode[] {
  const modules: LayoutNode[] = []
  const visit = (node: LayoutNode) => {
    if (node.type === 'endpoint' && isHorizontalDomotica(node.domainRef as Endpoint | undefined))
      modules.push(node)
    for (const child of node.children) visit(child)
  }
  for (const panel of tree.panels) visit(panel)
  return modules
}

/**
 * Drop-zone hints are not target objects, so the terminal rule reads them geometrically: the
 * module's own body and the trunk above it are "after" it, its output zones are not.
 */
export function withoutHintsAfterHorizontalDomotica<
  T extends { nodeId: string; y: number; targetType: string; match?: { endpointId?: string; circuitId?: string } },
>(tree: LayoutTree, hints: readonly T[]): T[] {
  const modules = collectHorizontalModuleNodes(tree)
  if (!modules.length) return [...hints]
  const moduleIds = new Set(modules.map((node) => node.domainId))
  const circuits = new Map<string, number>()
  for (const node of modules) {
    const circuitId = circuitIdOfModule(tree, node)
    if (!circuitId) continue
    // Trunk and later branches grow upward from the module's branch wire.
    circuits.set(circuitId, Math.max(circuits.get(circuitId) ?? -Infinity, node.bounds.y + node.bounds.height / 2))
  }
  return hints.filter((hint) => {
    if (hint.nodeId.includes(OUTPUT_ZONE_INFIX)) return true
    if (hint.targetType === 'endpoint') return !(hint.match?.endpointId && moduleIds.has(hint.match.endpointId))
    if (hint.targetType === 'circuit' && hint.match?.circuitId) {
      const moduleBottom = circuits.get(hint.match.circuitId)
      return moduleBottom === undefined || hint.y > moduleBottom
    }
    return true
  })
}

function circuitIdOfModule(tree: LayoutTree, module: LayoutNode): string | undefined {
  for (const [id, circuit] of getTreeCircuits(tree))
    if (circuit.endpoints.some((endpoint) => endpoint.id === module.domainId)) return id
  return undefined
}

/** Preview counterpart of the guard: a drop after a horizontal module previews nothing. */
export function isDropAfterHorizontalDomoticaInProject(
  project: PreviewProject,
  target: DropTarget
): boolean {
  const circuit = target.circuitId ? findCircuitInProject(project, target.circuitId) : undefined
  return !!circuit && isDropTargetAfterHorizontalDomotica(circuit, target)
}
