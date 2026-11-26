import type { Branch, Endpoint, TrunkDevice } from '@/types/schema'
import { getOneWireConverterRootIds, isOneWireConverterEndpoint } from './oneWireConverterBranches'

/**
 * Candidate topology contract, deliberately separate from the persisted Branch.
 * No loader, editor command or runtime renderer accepts these attachments yet.
 * Activation requires the versioned format and all connectivity consumers.
 */
export interface OneWireBranchDraft extends Pick<Branch, 'id' | 'label' | 'dcBusId' | 'branchDevices'> {
  endpointIds: readonly string[]
  forkFrom?: { afterEndpointId: string; port?: 2 }
  stem?: number
}

export type BranchTopologyIssueCode =
  | 'duplicate-branch' | 'duplicate-endpoint' | 'missing-endpoint'
  | 'duplicate-membership' | 'unassigned-endpoint' | 'missing-parent'
  | 'invalid-stem' | 'invalid-port' | 'attachment-conflict'
  | 'unsupported-attachment' | 'cycle' | 'unresolved-parent'

export interface BranchTopologyIssue {
  code: BranchTopologyIssueCode
  branchId?: string
  endpointId?: string
}

export type BranchFeed =
  | { kind: 'trunk'; stem: number; ordinaryBranchIndex: number | null; deviceIds: readonly string[] }
  | { kind: 'endpoint'; branchId: string; endpointId: string; port: 1 | 2 }
  /** Preserve specialized circuits without claiming a serial AC feed path. */
  | { kind: 'existing-specialized'; /** Only this root tree holds a converter endpoint; the rest of the circuit is ordinary. */ converterBranch?: true }
  | { kind: 'unresolved' }

export interface ResolvedOneWireBranch {
  branch: OneWireBranchDraft
  index: number
  /** Root stem or one endpoint/output: shared legs retain their stored order. */
  stemKey: string | null
  parentBranchId: string | null
  rootBranchId: string | null
  rootStem: number | null
  depth: number | null
  feed: BranchFeed
  issues: BranchTopologyIssue[]
}

export interface OneWireBranchTopology {
  branches: readonly ResolvedOneWireBranch[]
  /** Ambiguous duplicate IDs are deliberately absent from the lookup. */
  byBranchId: ReadonlyMap<string, ResolvedOneWireBranch>
  endpointLocations: ReadonlyMap<string, { branchId: string; index: number }>
  childrenByEndpoint: ReadonlyMap<string, readonly ResolvedOneWireBranch[]>
  stems: ReadonlyMap<string, readonly ResolvedOneWireBranch[]>
  issues: readonly BranchTopologyIssue[]
  valid: boolean
}

interface TopologyInput {
  endpoints: readonly Endpoint[]
  branches: readonly OneWireBranchDraft[]
  trunkDevices?: readonly TrunkDevice[]
  /** Existing nonordinary sources remain readable, but cannot acquire draft forks. */
  supplySource?: unknown
  dcBusSource?: unknown
}

/**
 * Resolve explicit flat branches without changing, sorting or repairing the input.
 * Specialized legacy paths stay opaque until their own consumer integration;
 * `valid` describes attachment integrity, not a complete electrical validation.
 */
export function resolveOneWireBranchTopology(
  input: TopologyInput,
  options: { supportsSecondOutput?: (endpoint: Endpoint) => boolean } = {}
): OneWireBranchTopology {
  const issues: BranchTopologyIssue[] = []
  const branches: ResolvedOneWireBranch[] = input.branches.map((branch, index) => ({
    branch, index, stemKey: null, parentBranchId: null, rootBranchId: null,
    rootStem: null, depth: null, feed: { kind: 'unresolved' }, issues: [],
  }))
  const addIssue = (code: BranchTopologyIssueCode, branch?: ResolvedOneWireBranch, endpointId?: string) => {
    const issue: BranchTopologyIssue = { code, ...(branch ? { branchId: branch.branch.id } : {}),
      ...(endpointId != null ? { endpointId } : {}) }
    issues.push(issue)
    branch?.issues.push(issue)
  }
  const endpointRecords = new Map<string, Endpoint[]>()
  for (const endpoint of input.endpoints) {
    const records = endpointRecords.get(endpoint.id) ?? []
    records.push(endpoint)
    endpointRecords.set(endpoint.id, records)
  }
  const branchRecords = new Map<string, ResolvedOneWireBranch[]>()
  for (const branch of branches) {
    const records = branchRecords.get(branch.branch.id) ?? []
    records.push(branch)
    branchRecords.set(branch.branch.id, records)
  }
  const byBranchId = new Map<string, ResolvedOneWireBranch>()
  for (const [id, records] of branchRecords) {
    if (records.length === 1) byBranchId.set(id, records[0]!)
    else records.forEach((record) => addIssue('duplicate-branch', record))
  }
  const memberships = new Map<string, Array<{ branch: ResolvedOneWireBranch; index: number }>>()
  for (const branch of branches) {
    branch.branch.endpointIds.forEach((id, index) => {
      const members = memberships.get(id) ?? []
      members.push({ branch, index })
      memberships.set(id, members)
      if (!endpointRecords.has(id)) addIssue('missing-endpoint', branch, id)
    })
  }
  for (const [id, members] of memberships) {
    if (members.length > 1) members.forEach(({ branch }) => addIssue('duplicate-membership', branch, id))
  }
  for (const [id, records] of endpointRecords) {
    if (records.length > 1) {
      const members = memberships.get(id) ?? []
      if (!members.length) addIssue('duplicate-endpoint', undefined, id)
      else members.forEach(({ branch }) => addIssue('duplicate-endpoint', branch, id))
    }
    if (!memberships.has(id)) addIssue('unassigned-endpoint', undefined, id)
  }
  const endpointLocations = new Map<string, { branchId: string; index: number }>()
  for (const [id, members] of memberships) {
    const member = members[0]!
    if (members.length === 1 && endpointRecords.get(id)?.length === 1 &&
      byBranchId.has(member.branch.branch.id)) {
      endpointLocations.set(id, { branchId: member.branch.branch.id, index: member.index })
    }
  }
  // Existing DC/domain-converter and domotica paths must first receive their own
  // explicit fork contract. Keep ordinary existing records intact; reject new
  // attachments to these paths instead of treating them as permanent AC feeds.
  const specialCircuit = !!input.supplySource || !!input.dcBusSource ||
    input.endpoints.some((endpoint) => endpoint.symbol === 'domotica' || !!endpoint.domoticaChildProps ||
      !!endpoint.converterDcConnection) ||
    (input.trunkDevices ?? []).some((device) => device.type === 'dc_bus' ||
      !!device.converterDcConnection || isOneWireConverterEndpoint(device)) ||
    input.branches.some((branch) => !!branch.dcBusId || !!branch.branchDevices?.length)
  // A branch-local converter endpoint specializes only its own root tree: nothing
  // forks from it and its rows keep the layout of a circuit without forks.
  const treeRootId = (branch: ResolvedOneWireBranch): string => {
    const seen = new Set<string>()
    let cursor = branch
    while (cursor.branch.forkFrom && !seen.has(cursor.branch.id)) {
      seen.add(cursor.branch.id)
      const location = endpointLocations.get(cursor.branch.forkFrom.afterEndpointId)
      const parent = location && byBranchId.get(location.branchId)
      if (!parent) break
      cursor = parent
    }
    return cursor.branch.id
  }
  const converterRoots = specialCircuit ? new Set<string>() : getOneWireConverterRootIds(input)
  const parents = new Map<ResolvedOneWireBranch, ResolvedOneWireBranch>()
  const children = new Map<ResolvedOneWireBranch, ResolvedOneWireBranch[]>()
  const childrenByEndpoint = new Map<string, ResolvedOneWireBranch[]>()
  const ordinaryRoots = branches.filter(({ branch }) => !branch.forkFrom && (branch.stem ?? 0) === 0)
  const ordinaryIndexes = new Map(ordinaryRoots.map((branch, index) => [branch, index]))
  const orderedDevices = (input.trunkDevices ?? []).map((device, index) => ({ device, index }))
    .sort((a, b) => (a.device.trunkPosition ?? 0) - (b.device.trunkPosition ?? 0) || a.index - b.index)

  for (const branch of branches) {
    const { forkFrom, stem = 0 } = branch.branch
    if (!Number.isSafeInteger(stem) || stem < 0) addIssue('invalid-stem', branch)
    if (forkFrom && stem !== 0) addIssue('attachment-conflict', branch)
    if ((forkFrom || stem > 0) && (specialCircuit || converterRoots.has(treeRootId(branch)))) addIssue('unsupported-attachment', branch)
    if (!forkFrom) continue
    if (forkFrom.port !== undefined && forkFrom.port !== 2) addIssue('invalid-port', branch)
    const location = endpointLocations.get(forkFrom.afterEndpointId)
    const parent = location && byBranchId.get(location.branchId)
    if (!parent) {
      addIssue('missing-parent', branch, forkFrom.afterEndpointId)
      continue
    }
    branch.parentBranchId = parent.branch.id
    parents.set(branch, parent)
    const siblings = children.get(parent) ?? []
    siblings.push(branch)
    children.set(parent, siblings)
    const legs = childrenByEndpoint.get(forkFrom.afterEndpointId) ?? []
    legs.push(branch)
    childrenByEndpoint.set(forkFrom.afterEndpointId, legs)
    if (forkFrom.port === 2 && !options.supportsSecondOutput?.(endpointRecords.get(forkFrom.afterEndpointId)![0]!)) {
      addIssue('invalid-port', branch, forkFrom.afterEndpointId)
    }
  }

  // Find cycles iteratively: malformed imported chains must not exhaust the JS
  // stack. Nodes feeding into a cycle get unresolved-parent, not a false root.
  const finished = new Set<ResolvedOneWireBranch>()
  for (const initial of branches) {
    const path: ResolvedOneWireBranch[] = []
    const position = new Map<ResolvedOneWireBranch, number>()
    let cursor: ResolvedOneWireBranch | undefined = initial
    while (cursor && !finished.has(cursor)) {
      const cycleAt = position.get(cursor)
      if (cycleAt != null) {
        path.slice(cycleAt).forEach((branch) => addIssue('cycle', branch))
        break
      }
      position.set(cursor, path.length)
      path.push(cursor)
      cursor = parents.get(cursor)
    }
    path.forEach((branch) => finished.add(branch))
  }

  const queue = branches.filter((branch) => !branch.branch.forkFrom)
  const visited = new Set<ResolvedOneWireBranch>()
  const stems = new Map<string, ResolvedOneWireBranch[]>()
  for (let index = 0; index < queue.length; index++) {
    const branch = queue[index]!
    if (visited.has(branch)) continue
    visited.add(branch)
    const parent = parents.get(branch)
    if (parent && parent.feed.kind === 'unresolved') addIssue('unresolved-parent', branch)
    if (!branch.issues.length) {
      const attachment = branch.branch.forkFrom
      if (parent && attachment) {
        const port = attachment.port ?? 1
        branch.feed = { kind: 'endpoint', branchId: parent.branch.id, endpointId: attachment.afterEndpointId, port }
        branch.stemKey = `fork:${JSON.stringify([attachment.afterEndpointId, port])}`
        branch.rootBranchId = parent.rootBranchId
        branch.rootStem = parent.rootStem
        branch.depth = parent.depth! + 1
      } else {
        const stem = branch.branch.stem ?? 0
        const ordinaryBranchIndex = ordinaryIndexes.get(branch) ?? null
        branch.feed = specialCircuit ? { kind: 'existing-specialized' } : converterRoots.has(branch.branch.id) ? { kind: 'existing-specialized', converterBranch: true } : {
          kind: 'trunk', stem, ordinaryBranchIndex,
          // A riser is fed through the devices on the shared part (position 0), after which it splits off.
          deviceIds: orderedDevices.filter(({ device }) =>
            (device.trunkPosition ?? 0) <= (stem === 0 ? ordinaryBranchIndex ?? 0 : 0)).map(({ device }) => device.id),
        }
        branch.stemKey = `root:${stem}`
        branch.rootBranchId = branch.branch.id
        branch.rootStem = stem
        branch.depth = 0
      }
      const group = stems.get(branch.stemKey!) ?? []
      group.push(branch)
      stems.set(branch.stemKey!, group)
    }
    for (const child of children.get(branch) ?? []) queue.push(child)
  }
  for (const branch of branches) {
    if (!visited.has(branch) && !branch.issues.length) addIssue('unresolved-parent', branch)
  }
  // Traversal is parent-first; visual stack order remains the stored array order.
  for (const group of stems.values()) group.sort((a, b) => a.index - b.index)
  return { branches, byBranchId, endpointLocations, childrenByEndpoint, stems, issues, valid: !issues.length }
}

/**
 * The run includes later endpoints and every leg attached to them. The first
 * branch is only included from endpointId onward; branchIds are touched records,
 * not a list of whole records to remove. Opaque specialized paths are ineligible.
 */
export function collectOneWireEndpointRun(
  topology: OneWireBranchTopology, endpointId: string
): { endpointIds: string[]; branchIds: string[] } | null {
  const location = topology.endpointLocations.get(endpointId)
  if (!location) return null
  const root = topology.byBranchId.get(location.branchId)
  if (!root || root.feed.kind === 'unresolved') return null
  const endpointIds: string[] = []
  const branchIds: string[] = []
  const seen = new Set<string>()
  const pending = [{ branch: root, start: location.index }]
  while (pending.length) {
    const { branch, start } = pending.pop()!
    if (branch.feed.kind === 'unresolved' || branch.feed.kind === 'existing-specialized' ||
      seen.has(branch.branch.id)) return null
    seen.add(branch.branch.id)
    branchIds.push(branch.branch.id)
    const ids = branch.branch.endpointIds.slice(start)
    endpointIds.push(...ids)
    const descendants = ids.flatMap((id) => topology.childrenByEndpoint.get(id) ?? [])
    for (let index = descendants.length - 1; index >= 0; index--) {
      pending.push({ branch: descendants[index]!, start: 0 })
    }
  }
  return { endpointIds, branchIds }
}

export type OneWireFeedStep =
  | { kind: 'trunk-device'; id: string }
  | { kind: 'endpoint'; id: string; output: 1 | 2 }

/** Cable ancestry entering an endpoint, including the selected output at each fork. */
export function getOneWireEndpointFeedPath(
  topology: OneWireBranchTopology, endpointId: string
): OneWireFeedStep[] | null {
  const location = topology.endpointLocations.get(endpointId)
  if (!location) return null
  let branch = topology.byBranchId.get(location.branchId)
  let count = location.index
  let output: 1 | 2 = 1
  const chunks: OneWireFeedStep[][] = []
  const visited = new Set<string>()
  while (branch) {
    if (branch.feed.kind === 'unresolved' || branch.feed.kind === 'existing-specialized' ||
      visited.has(branch.branch.id)) return null
    visited.add(branch.branch.id)
    const prefix: OneWireFeedStep[] = branch.branch.endpointIds.slice(0, count).map((id, index) => ({
      kind: 'endpoint', id, output: index === count - 1 ? output : 1,
    }))
    chunks.push(prefix)
    if (branch.feed.kind === 'endpoint') {
      const parentLocation = topology.endpointLocations.get(branch.feed.endpointId)
      if (!parentLocation) return null
      count = parentLocation.index + 1
      output = branch.feed.port
      branch = topology.byBranchId.get(branch.feed.branchId)
      if (!branch) return null
    } else {
      const root: OneWireFeedStep[] = branch.feed.deviceIds.map((id) => ({ kind: 'trunk-device', id }))
      return [...root, ...chunks.reverse().flat()]
    }
  }
  return null
}
