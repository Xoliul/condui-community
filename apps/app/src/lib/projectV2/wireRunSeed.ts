import { circuitWireNodeKind } from '@/lib/wires/circuitWireIdentity'
import { withConductorIds } from '@/lib/wires/conductorIdentity'
import type { CableSpec, Circuit, Panel } from '@/types/schema'
import type { WireConductor, WireConductorFunction, WireRun } from '@/types/projectV2'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  selectProjectSupplyAssemblies,
  type ProjectWithOptionalV2Electrical,
} from './electrical'
import { deriveWireAnchorKey, toWireRunRoute, type WireAnchor } from './wireRuns'

/**
 * Best-effort seed of canonical {@link WireRun}s from the legacy wire owners (Goal 19 / ADR-0002):
 * `Circuit.sectionWireOverrides`, `FeedTopology.rootFeeds[].wireSections`, and supply-assembly
 * `SupplyConnection.wireProperties`. Deliberately NOT lossless — only explicitly authored wire data
 * becomes runs; unauthored sections fall back to their default cable at render time. This never
 * throws and never emits a run without a well-formed anchor, so a malformed record degrades to a
 * default wire rather than crashing or orphaning.
 *
 * Runs are coalesced only *within* one source group (a circuit, a feed path, an assembly), so
 * distinct physical runs that merely share a spec never collapse into one linked run.
 */
export function seedWireRunsFromLegacy(project: ProjectWithOptionalV2Electrical): WireRun[] {
  const acc = makeRunAccumulator()
  visitLegacyWireSections(project, acc.add)
  return acc.runs
}

/**
 * `2.3.0` repair: the `2.2.0` seed dropped on-wall routes (every wall run became in-wall) and
 * ignored routes that only `inWall` or a domain override implied. Re-derive the route of each run
 * that still carries exactly what that seed wrote for all of its members; runs whose route was
 * changed since, or that gained non-legacy members, are left alone.
 */
export function repairSeededWireRunRoutes(
  project: ProjectWithOptionalV2Electrical,
  runs: readonly WireRun[]
): WireRun[] {
  const legacyRoutes = new Map<string, Pick<SectionSpec, 'route' | 'seededRoute'>>()
  visitLegacyWireSections(project, (_dedupeScope, anchorKey, spec) => {
    // First claim wins, as in the seed accumulator.
    if (!legacyRoutes.has(anchorKey)) legacyRoutes.set(anchorKey, spec)
  })
  return runs.map((run) => {
    const sources = run.members.map((member) => legacyRoutes.get(member))
    const [first] = sources
    if (!first || sources.some((source) => !source)) return run
    if (first.route === first.seededRoute || run.route !== first.seededRoute) return run
    const agree = sources.every(
      (source) => source?.route === first.route && source?.seededRoute === first.seededRoute
    )
    return agree ? { ...run, route: first.route } : run
  })
}

function visitLegacyWireSections(project: ProjectWithOptionalV2Electrical, add: AddSection): void {
  const visitPanel = (panel: Panel) => {
    for (const circuit of [
      ...(panel.circuits ?? []),
      ...panel.protections.flatMap((protection) => protection.circuits ?? []),
    ])
      seedCircuitWireRuns(circuit, panel.id, add)
    panel.subPanels?.forEach(visitPanel)
  }
  getProjectElectricalPanels(project).forEach(visitPanel)
  seedFeedWireRuns(project, add)
  seedSupplyWireRuns(project, add)
}

interface SectionSpec {
  cable: CableSpec
  route?: WireRun['route']
  /** The route the `2.2.0` seed wrote for this section; used only by the `2.3.0` repair. */
  seededRoute?: WireRun['route']
  inTube?: boolean
  labels?: WireRun['labels']
  lengthM?: number
}

type AddSection = (dedupeScope: Map<string, WireRun>, anchorKey: string, spec: SectionSpec) => void

function makeRunAccumulator() {
  const runs: WireRun[] = []
  const claimedAnchors = new Set<string>()
  let ordinal = 0
  const add: AddSection = (dedupeScope, anchorKey, spec) => {
    // One downstream wire belongs to exactly one run; drop later collisions deterministically.
    if (claimedAnchors.has(anchorKey)) return
    claimedAnchors.add(anchorKey)
    const dedupeKey = JSON.stringify([
      spec.cable,
      spec.route ?? null,
      spec.inTube ?? null,
      spec.labels ?? null,
    ])
    const existing = dedupeScope.get(dedupeKey)
    if (existing) {
      existing.members.push(anchorKey)
      if (typeof spec.lengthM === 'number') {
        existing.segmentLengths = { ...existing.segmentLengths, [anchorKey]: spec.lengthM }
      }
      return
    }
    const runId = `wirerun_${(ordinal++).toString(36)}`
    const run: WireRun = {
      id: runId,
      members: [anchorKey],
      cable: spec.cable,
      conductors: withConductorIds(runId, deriveSeedConductors(spec.cable)),
      route: spec.route,
      inTube: spec.inTube,
      labels: spec.labels,
      ...(typeof spec.lengthM === 'number'
        ? { segmentLengths: { [anchorKey]: spec.lengthM } }
        : {}),
    }
    dedupeScope.set(dedupeKey, run)
    runs.push(run)
  }
  return { runs, add }
}

/** Map of circuit id → its default cable, across all panels. Used for transient default runs. */
export function buildCircuitCableIndex(
  project: ProjectWithOptionalV2Electrical
): Map<string, CableSpec> {
  const index = new Map<string, CableSpec>()
  for (const panel of getProjectElectricalPanels(project)) {
    for (const circuit of collectCircuitsDeep(panel)) {
      if (circuit.cable) index.set(circuit.id, circuit.cable)
    }
  }
  return index
}

/** Panel circuits + protection circuits, recursing into sub-panels. Self-contained and pure. */
function collectCircuitsDeep(panel: Panel): Circuit[] {
  const circuits: Circuit[] = [...(panel.circuits ?? [])]
  for (const protection of panel.protections ?? []) {
    if (protection.circuits) circuits.push(...protection.circuits)
  }
  for (const sub of panel.subPanels ?? []) circuits.push(...collectCircuitsDeep(sub))
  return circuits
}

function seedCircuitWireRuns(circuit: Circuit, panelId: string, add: AddSection): void {
  const overrides = circuit.sectionWireOverrides ?? []
  if (overrides.length === 0) return
  const dedupeScope = new Map<string, WireRun>()

  for (const override of overrides) {
    const anchor = anchorForSectionOverride(circuit, panelId, override)
    if (!anchor) continue // ill-formed section ref: fall back to the circuit default at render.
    const cable =
      override.cable ??
      circuit.domainWireOverrides?.[override.domain ?? 'AC']?.cable ??
      circuit.cable
    if (!cable) continue
    // Mirror the drawing's route resolution: a circuit with only `inWall` set still runs in the wall.
    const domainOverride = circuit.domainWireOverrides?.[override.domain ?? 'AC']
    const wireRoute =
      override.wireRoute ??
      domainOverride?.wireRoute ??
      circuit.wireRoute ??
      (circuit.inWall ? 'wall' : undefined)
    add(dedupeScope, deriveWireAnchorKey(anchor), {
      cable,
      route: toWireRunRoute(
        wireRoute,
        override.inWall ??
          domainOverride?.inWall ??
          (wireRoute === 'wall' ? (circuit.inWall ?? false) : false)
      ),
      seededRoute: override.wireRoute ?? circuit.wireRoute,
      inTube: override.inTube ?? circuit.inTube,
      labels: pruneUndefined({
        hideWireLabel: override.hideWireLabel ?? circuit.hideWireLabel,
        showFireClassLabel: override.showFireClassLabel ?? circuit.showFireClassLabel,
        showWireLengthLabel: override.showWireLengthLabel ?? circuit.showWireLengthLabel,
      }),
      lengthM: override.wireLengthM ?? circuit.wireLengthM,
    })
  }
}

function seedFeedWireRuns(project: ProjectWithOptionalV2Electrical, add: AddSection): void {
  const rootFeeds = getProjectElectricalInstallation(project)?.feedTopology?.rootFeeds ?? []
  for (const feed of rootFeeds) {
    const wireSections = feed.wireSections
    if (!wireSections) continue
    const dedupeScope = new Map<string, WireRun>()
    for (const [runKey, props] of Object.entries(wireSections)) {
      if (!props?.cable) continue
      const anchor: WireAnchor = { kind: 'feed-run', feedPathId: feed.id, runKey }
      add(dedupeScope, deriveWireAnchorKey(anchor), {
        cable: props.cable,
        route: toWireRunRoute(props.wireRoute, props.inWall),
        seededRoute: props.wireRoute,
        inTube: props.inTube,
        labels: pruneUndefined({
          hideWireLabel: props.hideWireLabel,
          showFireClassLabel: props.showFireClassLabel,
          showWireLengthLabel: props.showWireLengthLabel,
        }),
        lengthM: props.wireLengthM,
      })
    }
  }
}

function seedSupplyWireRuns(project: ProjectWithOptionalV2Electrical, add: AddSection): void {
  for (const assembly of selectProjectSupplyAssemblies(project)) {
    const dedupeScope = new Map<string, WireRun>()
    for (const connection of assembly.connections ?? []) {
      const props = connection.wireProperties
      if (!props?.cable) continue
      const anchor: WireAnchor = {
        kind: 'supply-connection',
        assemblyId: assembly.id,
        connectionId: connection.id,
      }
      add(dedupeScope, deriveWireAnchorKey(anchor), {
        cable: props.cable,
        route: toWireRunRoute(props.wireRoute, props.inWall),
        seededRoute: props.wireRoute,
        inTube: props.inTube,
        labels: pruneUndefined({
          hideWireLabel: props.hideWireLabel,
          showFireClassLabel: props.showFireClassLabel,
          showWireLengthLabel: props.showWireLengthLabel,
        }),
        lengthM: props.wireLengthM,
      })
    }
  }
}

function anchorForSectionOverride(
  circuit: Circuit,
  panelId: string,
  override: NonNullable<Circuit['sectionWireOverrides']>[number]
): WireAnchor | undefined {
  // Anchor on the downstream ("to") node only: the wire flowing into it. The upstream end is
  // intentionally ignored so a wire keeps one identity regardless of what precedes it.
  if (!override.toElementId || !override.toElementType) return undefined
  if (override.toElementType === 'protection') {
    return {
      kind: 'protection-input',
      panelId,
      protectionId: override.toElementId,
      domain: override.domain ?? 'AC',
    }
  }
  return {
    kind: 'circuit-section',
    circuitId: circuit.id,
    nodeRef: `${override.toElementType === 'endpoint' ? circuitWireNodeKind(circuit, override.toElementId) : override.toElementType}:${override.toElementId}`,
    domain: override.domain ?? 'AC',
  }
}

/**
 * Best-effort conductor list from a cable spec. Phase-accurate derivation (line vs neutral for the
 * 2-active-conductor case) is Goal 19 phase D; the seed picks a plausible default and leaves
 * `conductorsOverridden` unset so phase reconciliation can refine it.
 */
export function deriveSeedConductors(cable: CableSpec): WireConductor[] {
  const total = Math.max(0, Math.floor(cable.conductors || 0))
  const pe = cable.hasPE ? 1 : 0
  const active = Math.max(0, total - pe)
  const functions: WireConductorFunction[] = []
  const lines: WireConductorFunction[] = ['L1', 'L2', 'L3']
  if (active === 1) {
    functions.push('L1')
  } else if (active === 2) {
    functions.push('L1', 'N')
  } else if (active >= 3) {
    for (let i = 0; i < Math.min(active, 3); i += 1) functions.push(lines[i]!)
    for (let i = 3; i < active; i += 1) functions.push('N')
  }
  if (pe) functions.push('PE')
  return functions.map((fn) => ({ function: fn }))
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined)
  return entries.length ? (Object.fromEntries(entries) as T) : undefined
}
