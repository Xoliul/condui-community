import type { Circuit, Panel, ProtectionDevice } from '@/types/schema'
import { IS_DEV, logger } from '@/lib/logger'
import {
  getEffectiveInstallYear,
  getExplicitInstallYear,
  type ProjectWithOptionalInstallYear,
} from '@/lib/installDates'
import {
  buildCircuitGraphIndex,
  resolveCircuitReference,
  type CircuitGraphIndex,
} from '@/lib/eendraad/circuitGraph'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

export type InstallDatePropagationMode = 'self' | 'protections' | 'all'

export interface InstallDateTarget {
  id: string
  type: 'panel' | 'protection' | 'circuit' | 'endpoint' | 'trunkDevice'
  clearOverride?: boolean
  explicitlyUnmark?: boolean
  preserveYear?: number
  forceOverride?: boolean
}

type InstallDateProject = ProjectWithOptionalV2Electrical & ProjectWithOptionalInstallYear

interface CircuitChildDebugEntry {
  parentCircuitId: string
  parentCircuitCode?: string
  kind:
    | 'endpoint'
    | 'trunkDevice'
    | 'subCircuit'
    | 'linkedPanel'
    | 'protection'
    | 'missingSubCircuit'
  id: string
  label?: string
  inheritedYear?: number
  effectiveYear?: number
}

interface CircuitPropagationDebugContext {
  rootCircuitId: string
  rootCircuitCode?: string
  mode: InstallDatePropagationMode
  children: CircuitChildDebugEntry[]
}

interface InstallDateTraversalState {
  circuits: Set<string>
  panels: Set<string>
}

function describeInstallDateTargetOwners(
  project: InstallDateProject,
  target: Pick<InstallDateTarget, 'id' | 'type'>
): Array<{
  panelId: string
  panelName?: string
  protectionId?: string
  protectionLabel?: string
  circuitId?: string
  circuitCode?: string
  path: string
}> {
  const owners: Array<{
    panelId: string
    panelName?: string
    protectionId?: string
    protectionLabel?: string
    circuitId?: string
    circuitCode?: string
    path: string
  }> = []
  const visitCircuit = (
    panel: Panel,
    circuit: Circuit,
    path: string,
    protection?: ProtectionDevice,
    visited = new Set<string>()
  ) => {
    if (visited.has(circuit.id)) return
    visited.add(circuit.id)
    const circuitPath = `${path} > circuit:${circuit.code ?? circuit.id}`
    if (target.type === 'circuit' && target.id === circuit.id) {
      owners.push({
        panelId: panel.id,
        panelName: panel.name,
        protectionId: protection?.id,
        protectionLabel: protection?.label,
        circuitId: circuit.id,
        circuitCode: circuit.code,
        path: circuitPath,
      })
    }
    for (const endpoint of circuit.endpoints) {
      if (target.type === 'endpoint' && target.id === endpoint.id) {
        owners.push({
          panelId: panel.id,
          panelName: panel.name,
          protectionId: protection?.id,
          protectionLabel: protection?.label,
          circuitId: circuit.id,
          circuitCode: circuit.code,
          path: `${circuitPath} > endpoint:${endpoint.label ?? endpoint.id}`,
        })
      }
    }
    for (const trunkDevice of circuit.trunkDevices ?? []) {
      if (target.type === 'trunkDevice' && target.id === trunkDevice.id) {
        owners.push({
          panelId: panel.id,
          panelName: panel.name,
          protectionId: protection?.id,
          protectionLabel: protection?.label,
          circuitId: circuit.id,
          circuitCode: circuit.code,
          path: `${circuitPath} > trunk:${trunkDevice.label ?? trunkDevice.id}`,
        })
      }
    }
  }
  const visitPanel = (panel: Panel, path: string) => {
    const panelPath = `${path}panel:${panel.name ?? panel.id}`
    if (target.type === 'panel' && target.id === panel.id) {
      owners.push({ panelId: panel.id, panelName: panel.name, path: panelPath })
    }
    for (const protection of panel.protections) {
      const protectionPath = `${panelPath} > protection:${protection.label ?? protection.id}`
      if (target.type === 'protection' && target.id === protection.id) {
        owners.push({
          panelId: panel.id,
          panelName: panel.name,
          protectionId: protection.id,
          protectionLabel: protection.label,
          path: protectionPath,
        })
      }
      for (const circuit of protection.circuits ?? []) {
        visitCircuit(panel, circuit, protectionPath, protection)
      }
    }
    for (const circuit of panel.circuits) {
      visitCircuit(panel, circuit, panelPath)
    }
    for (const subPanel of panel.subPanels) visitPanel(subPanel, `${panelPath} > `)
  }
  for (const panel of getProjectElectricalPanels(project)) visitPanel(panel, '')
  return owners
}

function shouldLogInstallDatePropagation(): boolean {
  return IS_DEV && import.meta.env?.MODE !== 'test'
}

function logCircuitInstallDatePropagation(
  project: InstallDateProject,
  context: CircuitPropagationDebugContext,
  targets: InstallDateTarget[]
): void {
  if (!shouldLogInstallDatePropagation()) return
  const targetRows = targets.map((target) => {
    const inheritedYear = getInstallDateTargetInheritedYear(project, target)
    return {
      type: target.type,
      id: target.id,
      clearOverride: target.clearOverride === true,
      forceOverride: target.forceOverride === true,
      preserveYear: target.preserveYear,
      inheritedYear,
    }
  })
  // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
  console.groupCollapsed(
    `[install-date propagation] circuit ${context.rootCircuitCode ?? context.rootCircuitId} (${context.mode})`
  )
  logger.info('root', {
    circuitId: context.rootCircuitId,
    code: context.rootCircuitCode,
    mode: context.mode,
  })
  // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
  console.table(context.children)
  // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
  console.table(targetRows)
  // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
  console.groupEnd()
}

function logProtectionInstallDatePropagation(
  project: InstallDateProject,
  protection: ProtectionDevice,
  mode: InstallDatePropagationMode,
  context: CircuitPropagationDebugContext,
  targets: InstallDateTarget[]
): void {
  if (!shouldLogInstallDatePropagation()) return
  const targetRows = targets.map((target) => {
    const trace = traceInstallDateTargetInheritedYear(project, target)
    return {
      type: target.type,
      id: target.id,
      clearOverride: target.clearOverride === true,
      forceOverride: target.forceOverride === true,
      preserveYear: target.preserveYear,
      inheritedYear: getInstallDateTargetInheritedYear(project, target),
      traceYear: trace.inheritedYear,
      tracePath: trace.path,
      owners: describeInstallDateTargetOwners(project, target)
        .map((owner) => owner.path)
        .join(' || '),
    }
  })
  // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
  console.groupCollapsed(
    `[install-date propagation] protection ${protection.label ?? protection.id} (${mode})`
  )
  logger.info('root', {
    protectionId: protection.id,
    label: protection.label,
    mode,
    circuitIds: (protection.circuits ?? []).map((circuit) => circuit.id),
  })
  // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
  console.table(context.children)
  // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
  console.table(targetRows)
  // eslint-disable-next-line no-console -- debug-only structured browser traces use console grouping/tables for local diagnostics.
  console.groupEnd()
}

function pushUnique(targets: InstallDateTarget[], target: InstallDateTarget): void {
  if (targets.some((candidate) => candidate.id === target.id && candidate.type === target.type))
    return
  targets.push(target)
}

export interface InstallDateInheritance {
  year: number
  /** Nearest ancestor with an explicit date, or undefined when the project year applies. */
  source: Pick<InstallDateTarget, 'id' | 'type'> | undefined
}

/** Inherited date per entity, keyed by `installDateTargetKey`. */
export type InstallDateInheritanceIndex = Map<string, InstallDateInheritance>

export function installDateTargetKey(target: Pick<InstallDateTarget, 'id' | 'type'>): string {
  return `${target.type}:${target.id}`
}

function sameInheritanceFeeds(
  a: Map<string, InstallDateInheritance>,
  b: Map<string, InstallDateInheritance>
): boolean {
  if (a.size !== b.size) return false
  for (const [key, value] of a) {
    const other = b.get(key)
    if (
      !other ||
      other.year !== value.year ||
      other.source?.id !== value.source?.id ||
      other.source?.type !== value.source?.type
    ) {
      return false
    }
  }
  return true
}

/**
 * Resolves what every panel, protection, circuit, consumer and circuit trunk device
 * inherits. This is the single source for both the date overlay and date editing.
 *
 * Protections fed by another circuit and panels fed by a panel symbol are only
 * discovered while walking, and the fed entity can be stored before its feeder.
 * The walk therefore repeats with the previous pass's feeds until they are stable.
 */
export function buildInstallDateInheritanceIndex(
  project: InstallDateProject
): InstallDateInheritanceIndex {
  const graph = buildCircuitGraphIndex(project)
  const projectInheritance: InstallDateInheritance = {
    year: getEffectiveInstallYear(project, null),
    source: undefined,
  }
  const panels = getProjectElectricalPanels(project)
  let protectionFeeds = new Map<string, InstallDateInheritance>()
  let panelFeeds = new Map<string, InstallDateInheritance>()
  let index: InstallDateInheritanceIndex = new Map()
  const maxPasses = graph.protectionsById.size + graph.panelsById.size + 1

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const nextProtectionFeeds = new Map<string, InstallDateInheritance>()
    const nextPanelFeeds = new Map<string, InstallDateInheritance>()
    const passIndex: InstallDateInheritanceIndex = new Map()
    const record = (
      target: Pick<InstallDateTarget, 'id' | 'type'>,
      inherited: InstallDateInheritance
    ) => {
      const key = installDateTargetKey(target)
      if (!passIndex.has(key)) passIndex.set(key, inherited)
    }
    const own = (
      entity: Parameters<typeof getExplicitInstallYear>[0],
      target: Pick<InstallDateTarget, 'id' | 'type'>,
      inherited: InstallDateInheritance
    ): InstallDateInheritance =>
      getExplicitInstallYear(entity) != null
        ? { year: getEffectiveInstallYear(project, entity, inherited.year), source: target }
        : inherited

    const visitCircuit = (
      circuit: Circuit,
      inherited: InstallDateInheritance,
      visited: Set<string>
    ) => {
      if (visited.has(circuit.id)) return
      visited.add(circuit.id)
      const circuitTarget = { id: circuit.id, type: 'circuit' as const }
      record(circuitTarget, inherited)
      const circuitDate = own(circuit, circuitTarget, inherited)
      for (const trunkDevice of circuit.trunkDevices ?? []) {
        record({ id: trunkDevice.id, type: 'trunkDevice' }, circuitDate)
      }
      for (const endpoint of circuit.endpoints) {
        const endpointTarget = { id: endpoint.id, type: 'endpoint' as const }
        record(endpointTarget, circuitDate)
        if (
          endpoint.symbol === 'panel_distribution' &&
          endpoint.panelId &&
          !nextPanelFeeds.has(endpoint.panelId)
        ) {
          nextPanelFeeds.set(endpoint.panelId, own(endpoint, endpointTarget, circuitDate))
        }
      }
      for (const subCircuitId of circuit.subCircuitIds ?? []) {
        const referenceTarget = resolveCircuitReference(graph, subCircuitId)
        if (referenceTarget.kind === 'protection') {
          if (!nextProtectionFeeds.has(referenceTarget.protection.id)) {
            nextProtectionFeeds.set(referenceTarget.protection.id, circuitDate)
          }
        } else if (referenceTarget.kind === 'circuit') {
          visitCircuit(referenceTarget.circuit, circuitDate, visited)
        }
      }
    }

    const visitPanel = (panel: Panel, parentInherited: InstallDateInheritance) => {
      const panelTarget = { id: panel.id, type: 'panel' as const }
      const inherited =
        nextPanelFeeds.get(panel.id) ?? panelFeeds.get(panel.id) ?? parentInherited
      record(panelTarget, inherited)
      const panelDate = own(panel, panelTarget, inherited)
      for (const protection of panel.protections) {
        const protectionTarget = { id: protection.id, type: 'protection' as const }
        const protectionInherited =
          nextProtectionFeeds.get(protection.id) ?? protectionFeeds.get(protection.id) ?? panelDate
        record(protectionTarget, protectionInherited)
        const protectionDate = own(protection, protectionTarget, protectionInherited)
        for (const circuit of protection.circuits ?? []) {
          visitCircuit(circuit, protectionDate, new Set())
        }
      }
      for (const circuit of panel.circuits) {
        if (graph.subCircuitIds.has(circuit.id)) continue
        visitCircuit(circuit, panelDate, new Set())
      }
      for (const subPanel of panel.subPanels) visitPanel(subPanel, panelDate)
    }

    for (const panel of panels) visitPanel(panel, projectInheritance)

    index = passIndex
    const stable =
      sameInheritanceFeeds(protectionFeeds, nextProtectionFeeds) &&
      sameInheritanceFeeds(panelFeeds, nextPanelFeeds)
    protectionFeeds = nextProtectionFeeds
    panelFeeds = nextPanelFeeds
    if (stable) break
  }

  return index
}

export function getInstallDateTargetInheritedYear(
  project: InstallDateProject,
  target: Pick<InstallDateTarget, 'id' | 'type'>,
  inheritanceIndex: InstallDateInheritanceIndex = buildInstallDateInheritanceIndex(project)
): number {
  return (
    inheritanceIndex.get(installDateTargetKey(target))?.year ??
    getEffectiveInstallYear(project, null)
  )
}

function traceInstallDateTargetInheritedYear(
  project: InstallDateProject,
  target: Pick<InstallDateTarget, 'id' | 'type'>
): { inheritedYear: number; path: string } {
  const graph = buildCircuitGraphIndex(project)
  const projectYear = getEffectiveInstallYear(project, null)
  const protectionFeedYears = new Map<string, number>()
  const visitCircuit = (
    circuit: Circuit,
    inheritedYear: number,
    path: string,
    visited = new Set<string>()
  ): { inheritedYear: number; path: string } | undefined => {
    if (visited.has(circuit.id)) return undefined
    visited.add(circuit.id)
    const circuitPath = `${path} > circuit:${circuit.code ?? circuit.id}`
    if (target.type === 'circuit' && circuit.id === target.id)
      return { inheritedYear, path: circuitPath }
    const circuitYear = getEffectiveInstallYear(project, circuit, inheritedYear)
    for (const endpoint of circuit.endpoints) {
      if (target.type === 'endpoint' && endpoint.id === target.id) {
        return {
          inheritedYear: circuitYear,
          path: `${circuitPath} > endpoint:${endpoint.label ?? endpoint.id}`,
        }
      }
    }
    for (const trunkDevice of circuit.trunkDevices ?? []) {
      if (target.type === 'trunkDevice' && trunkDevice.id === target.id) {
        return {
          inheritedYear: circuitYear,
          path: `${circuitPath} > trunk:${trunkDevice.label ?? trunkDevice.id}`,
        }
      }
    }
    for (const subCircuitId of circuit.subCircuitIds ?? []) {
      const referenceTarget = resolveCircuitReference(graph, subCircuitId)
      if (referenceTarget.kind === 'protection') {
        protectionFeedYears.set(referenceTarget.protection.id, circuitYear)
      } else if (referenceTarget.kind === 'circuit') {
        const found = visitCircuit(referenceTarget.circuit, circuitYear, circuitPath, visited)
        if (found) return found
      }
    }
    return undefined
  }
  const visitPanel = (
    panel: Panel,
    inheritedYear: number,
    path: string
  ): { inheritedYear: number; path: string } | undefined => {
    const panelPath = `${path}panel:${panel.name ?? panel.id}`
    if (target.type === 'panel' && panel.id === target.id) return { inheritedYear, path: panelPath }
    const panelYear = getEffectiveInstallYear(project, panel, inheritedYear)
    for (const protection of panel.protections) {
      const protectionPath = `${panelPath} > protection:${protection.label ?? protection.id}`
      const protectionInheritedYear = protectionFeedYears.get(protection.id) ?? panelYear
      if (target.type === 'protection' && protection.id === target.id) {
        return { inheritedYear: protectionInheritedYear, path: protectionPath }
      }
      const protectionYear = getEffectiveInstallYear(project, protection, protectionInheritedYear)
      for (const circuit of protection.circuits ?? []) {
        const found = visitCircuit(circuit, protectionYear, protectionPath)
        if (found) return found
      }
    }
    for (const circuit of panel.circuits) {
      const found = visitCircuit(circuit, panelYear, panelPath)
      if (found) return found
    }
    for (const subPanel of panel.subPanels) {
      const found = visitPanel(subPanel, panelYear, `${panelPath} > `)
      if (found) return found
    }
    return undefined
  }
  for (const panel of getProjectElectricalPanels(project)) {
    const found = visitPanel(panel, projectYear, '')
    if (found) return found
  }
  return { inheritedYear: projectYear, path: 'project' }
}

function collectCircuitTargets(
  project: InstallDateProject,
  graph: CircuitGraphIndex,
  circuit: Circuit,
  mode: InstallDatePropagationMode,
  targets: InstallDateTarget[],
  inheritedYear?: number,
  isRoot = false,
  visited?: Set<string>,
  debug?: CircuitPropagationDebugContext,
  traversal?: InstallDateTraversalState
): void {
  traversal ??= { circuits: visited ?? new Set<string>(), panels: new Set<string>() }
  visited = traversal.circuits
  if (visited.has(circuit.id)) return
  visited.add(circuit.id)
  const circuitYear = getEffectiveInstallYear(project, circuit, inheritedYear)
  if (mode === 'self' || mode === 'protections') {
    pushUnique(targets, {
      id: circuit.id,
      type: 'circuit',
      preserveYear: isRoot ? undefined : circuitYear,
      forceOverride: true,
    })
    for (const endpoint of circuit.endpoints) {
      debug?.children.push({
        parentCircuitId: circuit.id,
        parentCircuitCode: circuit.code,
        kind: 'endpoint',
        id: endpoint.id,
        label: endpoint.label,
        inheritedYear: circuitYear,
        effectiveYear: getEffectiveInstallYear(project, endpoint, circuitYear),
      })
      pushUnique(targets, {
        id: endpoint.id,
        type: 'endpoint',
        preserveYear: getEffectiveInstallYear(project, endpoint, circuitYear),
        forceOverride: true,
      })
      if (endpoint.symbol === 'panel_distribution' && endpoint.panelId) {
        debug?.children.push({
          parentCircuitId: circuit.id,
          parentCircuitCode: circuit.code,
          kind: 'linkedPanel',
          id: endpoint.panelId,
          label: endpoint.label,
          inheritedYear: getEffectiveInstallYear(project, endpoint, circuitYear),
        })
        const linkedPanel = graph.panelsById.get(endpoint.panelId)
        if (linkedPanel) {
          collectPanelTargets(project, graph, linkedPanel, mode, targets, circuitYear, debug, traversal)
        }
      }
    }
    for (const trunkDevice of circuit.trunkDevices ?? []) {
      debug?.children.push({
        parentCircuitId: circuit.id,
        parentCircuitCode: circuit.code,
        kind: 'trunkDevice',
        id: trunkDevice.id,
        label: trunkDevice.label,
        inheritedYear: circuitYear,
        effectiveYear: getEffectiveInstallYear(project, trunkDevice, circuitYear),
      })
      pushUnique(targets, {
        id: trunkDevice.id,
        type: 'trunkDevice',
        preserveYear: getEffectiveInstallYear(project, trunkDevice, circuitYear),
        forceOverride: true,
      })
    }
    for (const child of circuit.subCircuitIds ?? []) {
      const referenceTarget = resolveCircuitReference(graph, child)
      if (referenceTarget.kind === 'protection') {
        const owningProtectionYear = getEffectiveInstallYear(
          project,
          referenceTarget.protection,
          circuitYear
        )
        debug?.children.push({
          parentCircuitId: circuit.id,
          parentCircuitCode: circuit.code,
          kind: 'protection',
          id: referenceTarget.protection.id,
          label: referenceTarget.protection.label,
          inheritedYear: circuitYear,
          effectiveYear: owningProtectionYear,
        })
        pushUnique(targets, {
          id: referenceTarget.protection.id,
          type: 'protection',
          preserveYear: owningProtectionYear,
          forceOverride: true,
        })
        for (const ownedCircuit of referenceTarget.protection.circuits ?? []) {
          collectCircuitTargets(
            project,
            graph,
            ownedCircuit,
            mode,
            targets,
            owningProtectionYear,
            false,
            visited,
            debug,
            traversal
          )
        }
      } else if (referenceTarget.kind === 'circuit') {
        debug?.children.push({
          parentCircuitId: circuit.id,
          parentCircuitCode: circuit.code,
          kind: 'subCircuit',
          id: referenceTarget.circuit.id,
          label: referenceTarget.circuit.code,
          inheritedYear: circuitYear,
          effectiveYear: getEffectiveInstallYear(project, referenceTarget.circuit, circuitYear),
        })
        collectCircuitTargets(
          project,
          graph,
          referenceTarget.circuit,
          mode,
          targets,
          circuitYear,
          false,
          visited,
          debug,
          traversal
        )
      } else {
        debug?.children.push({
          parentCircuitId: circuit.id,
          parentCircuitCode: circuit.code,
          kind: 'missingSubCircuit',
          id: child,
          inheritedYear: circuitYear,
        })
        pushUnique(targets, {
          id: child,
          type: 'circuit',
          preserveYear: circuitYear,
          forceOverride: true,
        })
      }
    }
    return
  }

  pushUnique(
    targets,
    isRoot
      ? { id: circuit.id, type: 'circuit', forceOverride: true }
      : { id: circuit.id, type: 'circuit', clearOverride: true }
  )
  for (const endpoint of circuit.endpoints) {
    debug?.children.push({
      parentCircuitId: circuit.id,
      parentCircuitCode: circuit.code,
      kind: 'endpoint',
      id: endpoint.id,
      label: endpoint.label,
      inheritedYear: circuitYear,
      effectiveYear: getEffectiveInstallYear(project, endpoint, circuitYear),
    })
    pushUnique(targets, { id: endpoint.id, type: 'endpoint', clearOverride: true })
    if (endpoint.symbol === 'panel_distribution' && endpoint.panelId) {
      debug?.children.push({
        parentCircuitId: circuit.id,
        parentCircuitCode: circuit.code,
        kind: 'linkedPanel',
        id: endpoint.panelId,
        label: endpoint.label,
        inheritedYear: getEffectiveInstallYear(project, endpoint, circuitYear),
      })
      const linkedPanel = graph.panelsById.get(endpoint.panelId)
      if (linkedPanel) {
        collectPanelTargets(project, graph, linkedPanel, mode, targets, circuitYear, debug, traversal)
      }
    }
  }
  for (const trunkDevice of circuit.trunkDevices ?? []) {
    debug?.children.push({
      parentCircuitId: circuit.id,
      parentCircuitCode: circuit.code,
      kind: 'trunkDevice',
      id: trunkDevice.id,
      label: trunkDevice.label,
      inheritedYear: circuitYear,
      effectiveYear: getEffectiveInstallYear(project, trunkDevice, circuitYear),
    })
    pushUnique(targets, { id: trunkDevice.id, type: 'trunkDevice', clearOverride: true })
  }
  for (const child of circuit.subCircuitIds ?? []) {
    const referenceTarget = resolveCircuitReference(graph, child)
    if (referenceTarget.kind === 'protection') {
      const owningProtectionYear = getEffectiveInstallYear(
        project,
        referenceTarget.protection,
        circuitYear
      )
      debug?.children.push({
        parentCircuitId: circuit.id,
        parentCircuitCode: circuit.code,
        kind: 'protection',
        id: referenceTarget.protection.id,
        label: referenceTarget.protection.label,
        inheritedYear: circuitYear,
        effectiveYear: owningProtectionYear,
      })
      pushUnique(targets, {
        id: referenceTarget.protection.id,
        type: 'protection',
        clearOverride: true,
      })
      for (const ownedCircuit of referenceTarget.protection.circuits ?? []) {
        collectCircuitTargets(
          project,
          graph,
          ownedCircuit,
          mode,
          targets,
          owningProtectionYear,
          false,
          visited,
          debug,
          traversal
        )
      }
    } else if (referenceTarget.kind === 'circuit') {
      debug?.children.push({
        parentCircuitId: circuit.id,
        parentCircuitCode: circuit.code,
        kind: 'subCircuit',
        id: referenceTarget.circuit.id,
        label: referenceTarget.circuit.code,
        inheritedYear: circuitYear,
        effectiveYear: getEffectiveInstallYear(project, referenceTarget.circuit, circuitYear),
      })
      collectCircuitTargets(
        project,
        graph,
        referenceTarget.circuit,
        mode,
        targets,
        circuitYear,
        false,
        visited,
        debug,
        traversal
      )
    } else {
      debug?.children.push({
        parentCircuitId: circuit.id,
        parentCircuitCode: circuit.code,
        kind: 'missingSubCircuit',
        id: child,
        inheritedYear: circuitYear,
      })
      pushUnique(targets, { id: child, type: 'circuit', clearOverride: true })
    }
  }
}

function collectPanelTargets(
  project: InstallDateProject,
  graph: CircuitGraphIndex,
  panel: Panel,
  mode: InstallDatePropagationMode,
  targets: InstallDateTarget[],
  inheritedYear?: number,
  debug?: CircuitPropagationDebugContext,
  traversal?: InstallDateTraversalState
): void {
  traversal ??= { circuits: new Set<string>(), panels: new Set<string>() }
  if (traversal.panels.has(panel.id)) return
  traversal.panels.add(panel.id)
  const panelYear = getEffectiveInstallYear(project, panel, inheritedYear)
  debug?.children.push({
    parentCircuitId: debug.rootCircuitId,
    parentCircuitCode: debug.rootCircuitCode,
    kind: 'linkedPanel',
    id: panel.id,
    label: panel.name,
    inheritedYear,
    effectiveYear: panelYear,
  })
  pushUnique(
    targets,
    mode === 'all'
      ? { id: panel.id, type: 'panel', clearOverride: true }
      : {
          id: panel.id,
          type: 'panel',
          preserveYear: panelYear,
          forceOverride: true,
        }
  )

  for (const protection of panel.protections) {
    pushUnique(targets, {
      id: protection.id,
      type: 'protection',
      clearOverride: mode === 'all',
      preserveYear:
        mode === 'all' ? undefined : getEffectiveInstallYear(project, protection, panelYear),
      forceOverride: mode !== 'all',
    })
    const protectionYear = getEffectiveInstallYear(project, protection, panelYear)
    debug?.children.push({
      parentCircuitId: debug.rootCircuitId,
      parentCircuitCode: debug.rootCircuitCode,
      kind: 'protection',
      id: protection.id,
      label: protection.label,
      inheritedYear: panelYear,
      effectiveYear: protectionYear,
    })
    for (const circuit of protection.circuits ?? []) {
      collectCircuitTargets(
        project,
        graph,
        circuit,
        mode,
        targets,
        protectionYear,
        false,
        traversal.circuits,
        debug,
        traversal
      )
    }
  }

  for (const circuit of panel.circuits) {
    collectCircuitTargets(
      project,
      graph,
      circuit,
      mode,
      targets,
      panelYear,
      false,
      traversal.circuits,
      debug,
      traversal
    )
  }

  for (const subPanel of panel.subPanels) {
    collectPanelTargets(project, graph, subPanel, mode, targets, panelYear, debug, traversal)
  }
}

export function buildPanelInstallDateTargets(
  project: InstallDateProject,
  panelId: string,
  mode: InstallDatePropagationMode
): InstallDateTarget[] {
  const graph = buildCircuitGraphIndex(project)
  const panel = graph.panelsById.get(panelId)
  if (!panel) return [{ id: panelId, type: 'panel' }]

  const targets: InstallDateTarget[] = [{ id: panel.id, type: 'panel', forceOverride: true }]
  const traversal: InstallDateTraversalState = { circuits: new Set<string>(), panels: new Set<string>() }

  const collectPanel = (current: Panel) => {
    if (traversal.panels.has(current.id)) return
    traversal.panels.add(current.id)
    const panelYear = getEffectiveInstallYear(project, current)
    for (const protection of current.protections) {
      pushUnique(targets, {
        id: protection.id,
        type: 'protection',
        clearOverride: mode !== 'self',
        preserveYear:
          mode === 'self' ? getEffectiveInstallYear(project, protection, panelYear) : undefined,
        forceOverride: mode === 'self',
      })
      const protectionYear = getEffectiveInstallYear(project, protection, panelYear)
      if (mode === 'all') {
        for (const circuit of protection.circuits ?? [])
          collectCircuitTargets(
            project,
            graph,
            circuit,
            mode,
            targets,
            protectionYear,
            false,
            traversal.circuits,
            undefined,
            traversal
          )
      } else if (mode === 'self' || mode === 'protections') {
        for (const circuit of protection.circuits ?? [])
          collectCircuitTargets(
            project,
            graph,
            circuit,
            mode,
            targets,
            protectionYear,
            false,
            traversal.circuits,
            undefined,
            traversal
          )
      }
    }
    if (mode === 'all') {
      for (const circuit of current.circuits)
        collectCircuitTargets(
          project,
          graph,
          circuit,
          mode,
          targets,
          panelYear,
          false,
          traversal.circuits,
          undefined,
          traversal
        )
      for (const subPanel of current.subPanels) {
        pushUnique(targets, { id: subPanel.id, type: 'panel', clearOverride: true })
        collectPanel(subPanel)
      }
    } else if (mode === 'self' || mode === 'protections') {
      for (const circuit of current.circuits)
        collectCircuitTargets(
          project,
          graph,
          circuit,
          mode,
          targets,
          panelYear,
          false,
          traversal.circuits,
          undefined,
          traversal
        )
      for (const subPanel of current.subPanels) {
        pushUnique(targets, {
          id: subPanel.id,
          type: 'panel',
          preserveYear: getEffectiveInstallYear(project, subPanel, panelYear),
          forceOverride: true,
        })
      }
    }
  }

  collectPanel(panel)
  return targets
}

export function buildCircuitInstallDateTargets(
  project: InstallDateProject,
  circuit: Circuit,
  mode: InstallDatePropagationMode
): InstallDateTarget[] {
  const graph = buildCircuitGraphIndex(project)
  const targets: InstallDateTarget[] = []
  const resolvedMode = mode === 'protections' ? 'self' : mode
  const debug: CircuitPropagationDebugContext = {
    rootCircuitId: circuit.id,
    rootCircuitCode: circuit.code,
    mode: resolvedMode,
    children: [],
  }
  const traversal: InstallDateTraversalState = { circuits: new Set<string>(), panels: new Set<string>() }
  collectCircuitTargets(
    project,
    graph,
    circuit,
    resolvedMode,
    targets,
    undefined,
    true,
    traversal.circuits,
    debug,
    traversal
  )
  logCircuitInstallDatePropagation(project, debug, targets)
  return targets
}

export function protectionHasInstallDateChildren(protection: ProtectionDevice): boolean {
  return (protection.circuits ?? []).some(
    (circuit) =>
      circuit.endpoints.length > 0 ||
      (circuit.trunkDevices?.length ?? 0) > 0 ||
      (circuit.subCircuitIds?.length ?? 0) > 0
  )
}

export function buildProtectionInstallDateTargets(
  project: InstallDateProject,
  protectionId: string,
  mode: InstallDatePropagationMode
): InstallDateTarget[] {
  const graph = buildCircuitGraphIndex(project)
  const protection = graph.protectionsById.get(protectionId)
  if (!protection) return [{ id: protectionId, type: 'protection' }]

  const targets: InstallDateTarget[] = [{ id: protection.id, type: 'protection' }]
  const protectionInheritedYear = getInstallDateTargetInheritedYear(project, {
    id: protection.id,
    type: 'protection',
  })
  const protectionYear = getEffectiveInstallYear(project, protection, protectionInheritedYear)
  const resolvedMode = mode === 'protections' ? 'self' : mode
  const debug: CircuitPropagationDebugContext = {
    rootCircuitId: protection.id,
    rootCircuitCode: protection.label,
    mode: resolvedMode,
    children: [],
  }
  const traversal: InstallDateTraversalState = { circuits: new Set<string>(), panels: new Set<string>() }
  if (mode === 'self' || mode === 'protections') {
    for (const circuit of protection.circuits ?? []) {
      collectCircuitTargets(
        project,
        graph,
        circuit,
        'self',
        targets,
        protectionYear,
        false,
        traversal.circuits,
        debug,
        traversal
      )
    }
    logProtectionInstallDatePropagation(project, protection, resolvedMode, debug, targets)
    return targets
  }

  for (const circuit of protection.circuits ?? []) {
    collectCircuitTargets(
      project,
      graph,
      circuit,
      'all',
      targets,
      protectionYear,
      false,
      traversal.circuits,
      debug,
      traversal
    )
  }
  logProtectionInstallDatePropagation(project, protection, resolvedMode, debug, targets)
  return targets
}
