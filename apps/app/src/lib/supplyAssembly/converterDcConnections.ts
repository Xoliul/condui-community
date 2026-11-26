import type { SupplyConnection } from '@/types/supplyAssembly'
import {
  deriveWireAnchorKey,
  editProjectWireRuns,
  selectProjectWireRuns,
  type ProjectWithOptionalV2WireRuns,
} from '@/lib/projectV2/wireRuns'
import type { TrunkDevice } from '@/types/schema'
import { CIRCUIT_CONVERTER_MAX_CONNECTIONS } from '@/lib/layout/circuitConverterGeometry'

export function getSupplyConverterDcConnectionIndex(device: TrunkDevice): number | undefined {
  if (device.supplyPath !== 'converter-dc' && device.supplyPath !== 'converter-dc-top') {
    return undefined
  }
  if (Number.isFinite(device.supplyConverterDcConnectionIndex)) {
    return Math.max(
      0,
      Math.min(
        CIRCUIT_CONVERTER_MAX_CONNECTIONS,
        Math.trunc(device.supplyConverterDcConnectionIndex!)
      )
    )
  }
  return device.supplyPath === 'converter-dc-top' ? 1 : 0
}

export function getSupplyConverterDcPath(connectionIndex: number): TrunkDevice['supplyPath'] {
  return connectionIndex > 0 ? 'converter-dc-top' : 'converter-dc'
}

const dcConnectionEndpointKey = (connection: SupplyConnection) =>
  `${connection.pathRole}:${connection.endpoints
    .map(({ nodeId, portId }) => `${nodeId}:${portId}`)
    .sort()
    .join('|')}`

/**
 * Rebuilt DC connections keep the id of the previous connection between the same two devices.
 * Wire runs (cable, labels, length) are anchored on that id, while a generated id spells out the
 * device's place in its string; without this, widening an MPPT to several outputs or inserting a
 * device lower in a string orphans the cables of every wire above it. With a project, runs that
 * were already orphaned this way are re-attached (adoptOrphanedDcRuns).
 */
export function keepDcConnectionIds(
  previous: readonly SupplyConnection[],
  next: SupplyConnection[],
  project?: ProjectWithOptionalV2WireRuns,
  assemblyId?: string
): SupplyConnection[] {
  const previousIdByEndpoints = new Map(
    previous.map((connection) => [dcConnectionEndpointKey(connection), connection.id])
  )
  // A kept id must not clash with an id another rebuilt connection already uses.
  const taken = new Set(next.map((connection) => connection.id))
  const kept = next.map((connection) => {
    const id = previousIdByEndpoints.get(dcConnectionEndpointKey(connection))
    if (!id || id === connection.id || taken.has(id)) return connection
    taken.add(id)
    return { ...connection, id }
  })
  if (project && assemblyId) adoptOrphanedDcRuns(project, assemblyId, previous, kept)
  return kept
}

/** `prefix-<index>-<deviceId>` without the trailing index and device id. */
function dcConnectionPath(connectionId: string, deviceId: string): string | undefined {
  const match = connectionId.slice(0, -(deviceId.length + 1)).match(/^(.*)-\d+$/)
  return connectionId.endsWith(`-${deviceId}`) ? match?.[1] : undefined
}

/**
 * Re-attach a DC string wire's run that still names the id the connection had before a string
 * became (or stopped being) the output of a multi-port converter: same assembly, same device,
 * same DC-bus branch path, nothing else claiming it. Projects edited before ids were kept lost
 * those cables silently; this restores them the next time the supply is reconciled.
 */
function adoptOrphanedDcRuns(
  project: ProjectWithOptionalV2WireRuns,
  assemblyId: string,
  previous: readonly SupplyConnection[],
  next: readonly SupplyConnection[]
): void {
  if (selectProjectWireRuns(project).length === 0) return
  const runs = editProjectWireRuns(project)
  const anchorOf = (connectionId: string) =>
    deriveWireAnchorKey({ kind: 'supply-connection', assemblyId, connectionId })
  const live = new Set([...previous, ...next].map((connection) => anchorOf(connection.id)))
  const claimed = new Set(runs.flatMap((run) => run.members))
  const prefix = anchorOf('')
  for (const connection of next) {
    const anchor = anchorOf(connection.id)
    if (claimed.has(anchor)) continue
    const deviceId = connection.endpoints[0].nodeId
    const path = dcConnectionPath(connection.id, deviceId)
    if (!path) continue
    const sameBranch = (otherPath: string | undefined) =>
      !!otherPath &&
      (otherPath === path || otherPath.startsWith(`${path}-`) || path.startsWith(`${otherPath}-`))
    const candidates = runs.flatMap((run) =>
      run.members.flatMap((member, index) =>
        member.startsWith(prefix) &&
        !live.has(member) &&
        sameBranch(dcConnectionPath(member.slice(prefix.length), deviceId))
          ? [{ run, index }]
          : []
      )
    )
    if (candidates.length !== 1) continue
    const { run, index } = candidates[0]!
    run.members[index] = anchor
    claimed.add(anchor)
  }
}
