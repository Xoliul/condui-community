import type { ProjectV2, WireRun } from '@/types/projectV2'
import { editProjectWireRuns } from '@/lib/projectV2/wireRuns'
import { getProjectElectricalPanels, getProjectElectricalInstallation } from '@/lib/projectV2/electrical'
import { walkPanels, collectCircuits } from '@/lib/panel/panelTree'
import { hasOneWireForks } from '@/lib/eendraad/oneWireForkProject'
import { deriveSeedConductors } from '@/lib/projectV2/wireRunSeed'
import { withConductorIds } from './conductorIdentity'
import { wireRunAppearance } from './wireRunAppearance'
import { circuitWireSpecifications } from './circuitWireSpecifications'
import { resolveProjectDefaultCableKind } from './circuitWireDefaults'
import type { getWireTopologyContext } from './wireTopologyContext'

export function preserveForkWireRuns(before: ProjectV2, after: ProjectV2, draft: ProjectV2,
  previous: ReturnType<typeof getWireTopologyContext>, next: ReturnType<typeof getWireTopologyContext>,
  oldOwner: ReadonlyMap<string, WireRun>, newId: () => string
): string[] {
  const circuits = new Set([...walkPanels(getProjectElectricalPanels(after))].flatMap(collectCircuits).filter(hasOneWireForks).map((circuit) => circuit.id))
  if (!circuits.size) return []
  const runs = editProjectWireRuns(draft)
  const occupied = new Set(runs.flatMap((run) => run.members))
  const specs = circuitWireSpecifications(getProjectElectricalPanels(before), [...new Set(oldOwner.values())])
  const defaultKind = resolveProjectDefaultCableKind(getProjectElectricalInstallation(before))
  const created: string[] = []
  for (const connection of next.connections.values()) {
    if (!circuits.has(connection.circuitId) || !connection.sourceKey.startsWith('endpoint:') || occupied.has(connection.anchor)) continue
    const outgoing = previous.feeds.get(connection.sourceKey) ?? []
    const incoming = previous.byTarget.get(connection.sourceKey)
    const inputs = outgoing.length ? outgoing : incoming ? [incoming] : []
    const first = inputs[0], source = first && oldOwner.get(first.anchor)
    if (!first || !source || source.medium === 'busbar') continue
    const appearance = wireRunAppearance(source, first.anchor, specs.get(first.anchor), defaultKind)
    if (!inputs.every((input) => {
      const candidate = oldOwner.get(input.anchor)
      return !!candidate && wireRunAppearance(candidate, input.anchor, specs.get(input.anchor), defaultKind) === appearance
    })) continue
    const id = newId()
    runs.push({ id, members: [connection.anchor], cable: { ...source.cable },
      conductors: withConductorIds(id, deriveSeedConductors(source.cable)),
      ...(source.followsDefaultCable ? { followsDefaultCable: true } : {}),
      ...(source.fireClassNone ? { fireClassNone: true } : {}),
      ...(source.medium ? { medium: source.medium } : {}), ...(source.material ? { material: source.material } : {}),
      ...(source.route !== undefined ? { route: source.route } : {}), ...(source.inTube !== undefined ? { inTube: source.inTube } : {}),
      ...(source.labels ? { labels: { ...source.labels } } : {}),
    })
    occupied.add(connection.anchor); created.push(id)
  }
  return created
}
