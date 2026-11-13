import type { ProjectV2 } from '@/types/projectV2'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { collectCircuits, walkPanels } from '@/lib/panel/panelTree'
import { canEditOneWireForks, hasOneWireForks } from '@/lib/eendraad/oneWireForkProject'
import { CommandError } from './types'

/** Legacy adapters must not corrupt attachments while the remaining specialized
 * operations are being integrated. Check inside the transaction, before cables.
 */
export function assertForkEditsPreserveTopology(before: ProjectV2, after: ProjectV2): void {
  const old = new Map([...walkPanels(getProjectElectricalPanels(before))].flatMap(collectCircuits).map((circuit) => [circuit.id, circuit]))
  for (const circuit of [...walkPanels(getProjectElectricalPanels(after))].flatMap(collectCircuits)) {
    if (circuit === old.get(circuit.id) || !hasOneWireForks(circuit)) continue
    if (!canEditOneWireForks(circuit)) throw new CommandError('check_failed', 'This edit cannot preserve the fork connections', { reason: 'unsupported_fork' })
  }
}

/** Keep surviving root branches on their original side of unchanged trunk
 * devices when forks are moved, deleted or joined through legacy adapters.
 */
export function reconcileForkTrunkPositions(before: ProjectV2, draft: ProjectV2): void {
  const old = new Map([...walkPanels(getProjectElectricalPanels(before))].flatMap(collectCircuits).map((circuit) => [circuit.id, circuit]))
  for (const circuit of [...walkPanels(getProjectElectricalPanels(draft))].flatMap(collectCircuits)) {
    const previous = old.get(circuit.id)
    if (!previous || !hasOneWireForks(previous) && !hasOneWireForks(circuit)) continue
    const beforeRoots = previous.branches?.filter((branch) => !branch.forkFrom) ?? []
    const roots = circuit.branches?.filter((branch) => !branch.forkFrom) ?? []
    if (beforeRoots.length === roots.length && beforeRoots.every((branch, index) => branch.id === roots[index]?.id)) continue
    for (const device of circuit.trunkDevices ?? []) {
      const prior = previous.trunkDevices?.find((item) => item.id === device.id)
      if (!prior || prior.trunkPosition !== device.trunkPosition) continue
      const following = beforeRoots.slice(prior.trunkPosition).find((branch) => roots.some((item) => item.id === branch.id))
      device.trunkPosition = following ? roots.findIndex((branch) => branch.id === following.id) : roots.length
    }
  }
}
