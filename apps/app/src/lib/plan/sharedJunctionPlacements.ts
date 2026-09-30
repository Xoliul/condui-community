import { getAllCircuits } from '@/lib/eendraad/projectElectricalDomain'
import { collectAllGroundTrunkDevices } from '@/lib/eendraad/panelGround'
import { getAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { getJunctionIdentity } from '@/lib/junctionIdentity'
import {
  selectProjectElectricalInstallation,
  selectProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { Endpoint, JunctionPanelPlacement, Placement, TrunkDevice } from '@/types/schema'

/**
 * A junction box or junction panel is one physical object, however often the one-wire draws it:
 * every occurrence with the same identity is the same box. On the plan it has one location.
 *
 * - A junction box's location is the placements of its first placed occurrence; the placements
 *   of the other occurrences are duplicates and are not drawn.
 * - A junction panel's location is the installation-level placement stored under its label.
 */

type SharedJunctionSymbol = 'junction_box' | 'junction_panel'

export interface JunctionOccurrence {
  kind: 'endpoint' | 'trunkDevice'
  entity: Endpoint | TrunkDevice
  /** Owning circuit, for circuit endpoints and circuit trunk devices. */
  circuitId?: string
}

export interface SharedJunction {
  key: string
  symbol: SharedJunctionSymbol
  identity: string
  occurrences: JunctionOccurrence[]
  /** The occurrence whose placements are the box's location (junction boxes only). */
  owner?: JunctionOccurrence
  /** Plan location: the owner's placements, or the panel's installation placement. */
  placements: Placement[]
  /** For junction panels: the installation placements behind `placements`. */
  panelPlacements?: JunctionPanelPlacement[]
}

function sharedSymbol(entity: Endpoint | TrunkDevice): SharedJunctionSymbol | undefined {
  const symbol = entity.symbol
  if (symbol === 'junction_box' || symbol === 'junction_panel') return symbol
  if ('type' in entity && entity.type === 'junction_panel') return 'junction_panel'
  return undefined
}

/** Grouping key of a junction occurrence: symbol plus case-insensitive identity. */
export function sharedJunctionKey(entity: Endpoint | TrunkDevice): string | undefined {
  const symbol = sharedSymbol(entity)
  if (!symbol) return undefined
  const identity = getJunctionIdentity({
    symbol,
    label: entity.label ?? '',
    junctionIdentity: entity.junctionIdentity,
  })
  return identity ? `${symbol}|${identity.toLocaleUpperCase('en-US')}` : undefined
}

function panelPlacementAsPlacement(placement: JunctionPanelPlacement): Placement {
  return {
    id: placement.id,
    floorId: placement.floorId,
    layer: placement.layer ?? 'default',
    pos: placement.pos,
    rotationDeg: (placement.rotationDeg ?? 0) as Placement['rotationDeg'],
    rotationMode: placement.rotationMode,
    scale: placement.scale ?? 1,
  }
}

/** Every junction box and junction panel identity in one-wire order, with its plan location. */
export function collectSharedJunctions(
  project: ProjectWithOptionalV2Electrical
): Map<string, SharedJunction> {
  const junctions = new Map<string, SharedJunction>()
  const visit = (occurrence: JunctionOccurrence) => {
    const key = sharedJunctionKey(occurrence.entity)
    const symbol = sharedSymbol(occurrence.entity)
    if (!key || !symbol) return
    let junction = junctions.get(key)
    if (!junction) {
      junction = {
        key,
        symbol,
        identity: key.slice(symbol.length + 1),
        occurrences: [],
        placements: [],
      }
      junctions.set(key, junction)
    }
    junction.occurrences.push(occurrence)
    const placements = occurrence.entity.placements ?? []
    if (symbol === 'junction_box' && !junction.owner && placements.length > 0) {
      junction.owner = occurrence
      junction.placements = placements
    }
  }

  const panels = selectProjectElectricalPanels(project)
  for (const panel of panels) {
    for (const circuit of getAllCircuits(panel)) {
      for (const endpoint of circuit.endpoints) {
        visit({ kind: 'endpoint', entity: endpoint, circuitId: circuit.id })
      }
      for (const device of circuit.trunkDevices ?? []) {
        visit({ kind: 'trunkDevice', entity: device, circuitId: circuit.id })
      }
    }
  }
  const installation = selectProjectElectricalInstallation(project)
  for (const device of getAllSupplyTrunkDevices(project)) visit({ kind: 'trunkDevice', entity: device })
  for (const device of collectAllGroundTrunkDevices(panels, installation)) {
    visit({ kind: 'trunkDevice', entity: device })
  }

  for (const placement of installation?.junctionPanelPlacements ?? []) {
    const identity = placement.label.trim().toLocaleUpperCase('en-US')
    const junction = junctions.get(`junction_panel|${identity}`)
    if (!junction) continue
    junction.panelPlacements = [...(junction.panelPlacements ?? []), placement]
    junction.placements = [...junction.placements, panelPlacementAsPlacement(placement)]
  }
  return junctions
}

/**
 * Junction box occurrences whose own placements duplicate the box drawn by another occurrence
 * with the same identity. Their placements stay stored but are not drawn or routed to.
 * Not cached: healers add placements to the project in place.
 */
export function duplicateJunctionOccurrenceIds(
  project: ProjectWithOptionalV2Electrical
): ReadonlySet<string> {
  const duplicates = new Set<string>()
  for (const junction of collectSharedJunctions(project).values()) {
    if (junction.symbol !== 'junction_box' || !junction.owner) continue
    for (const occurrence of junction.occurrences) {
      if (occurrence !== junction.owner && (occurrence.entity.placements?.length ?? 0) > 0) {
        duplicates.add(occurrence.entity.id)
      }
    }
  }
  return duplicates
}
