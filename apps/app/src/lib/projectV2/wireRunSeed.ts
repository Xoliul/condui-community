import { circuitWireNodeKind } from '@/lib/wires/circuitWireIdentity'
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

  const visitPanel = (panel: Panel) => {
    for (const circuit of [
      ...(panel.circuits ?? []),
      ...panel.protections.flatMap((protection) => protection.circuits ?? []),
    ])
      seedCircuitWireRuns(circuit, panel.id, acc)
    panel.subPanels?.forEach(visitPanel)
  }
  getProjectElectricalPanels(project).forEach(visitPanel)
  seedFeedWireRuns(project, acc)
  seedSupplyWireRuns(project, acc)

  return acc.runs
}

interface SectionSpec {
  cable: CableSpec
  route?: WireRun['route']
  inTube?: boolean
  labels?: WireRun['labels']
  lengthM?: number
}

function makeRunAccumulator() {
  const runs: WireRun[] = []
  const claimedAnchors = new Set<string>()
  let ordinal = 0
  const add = (dedupeScope: Map<string, WireRun>, anchorKey: string, spec: SectionSpec): void => {
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
    const run: WireRun = {
      id: `wirerun_${(ordinal++).toString(36)}`,
      members: [anchorKey],
      cable: spec.cable,
      conductors: deriveSeedConductors(spec.cable),
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

type RunAccumulator = ReturnType<typeof makeRunAccumulator>

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

function seedCircuitWireRuns(circuit: Circuit, panelId: string, acc: RunAccumulator): void {
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
    acc.add(dedupeScope, deriveWireAnchorKey(anchor), {
      cable,
      route: toWireRunRoute(
        override.wireRoute ?? circuit.wireRoute,
        override.inWall ?? circuit.inWall
      ),
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

function seedFeedWireRuns(project: ProjectWithOptionalV2Electrical, acc: RunAccumulator): void {
  const rootFeeds = getProjectElectricalInstallation(project)?.feedTopology?.rootFeeds ?? []
  for (const feed of rootFeeds) {
    const wireSections = feed.wireSections
    if (!wireSections) continue
    const dedupeScope = new Map<string, WireRun>()
    for (const [runKey, props] of Object.entries(wireSections)) {
      if (!props?.cable) continue
      const anchor: WireAnchor = { kind: 'feed-run', feedPathId: feed.id, runKey }
      acc.add(dedupeScope, deriveWireAnchorKey(anchor), {
        cable: props.cable,
        route: toWireRunRoute(props.wireRoute, props.inWall),
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

function seedSupplyWireRuns(project: ProjectWithOptionalV2Electrical, acc: RunAccumulator): void {
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
      acc.add(dedupeScope, deriveWireAnchorKey(anchor), {
        cable: props.cable,
        route: toWireRunRoute(props.wireRoute, props.inWall),
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
