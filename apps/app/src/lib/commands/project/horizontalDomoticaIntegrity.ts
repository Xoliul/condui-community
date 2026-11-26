import type { ProjectV2 } from '@/types/projectV2'
import type { Circuit, Panel, ProtectionDevice } from '@/types/schema'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  selectProjectSupplyAssemblies,
} from '@/lib/projectV2/electrical'
import { queryAllSupplyTrunkDevices } from '@/lib/feedTopology'
import { collectCircuits, walkPanels } from '@/lib/panel/panelTree'
import { findCircuitOwner } from '@/lib/eendraad/projectElectricalDomain'
import { isHorizontalDomotica } from '@/lib/layout/domoticaHorizontalGeometry'
import {
  circuitHasHorizontalDomotica,
  getHorizontalDomoticaViolations,
  HORIZONTAL_DOMOTICA_NO_NESTING_MESSAGE,
  HORIZONTAL_DOMOTICA_NO_SUPPLY_MESSAGE,
  HORIZONTAL_DOMOTICA_TERMINAL_MESSAGE,
  isCircuitOnSupplySide,
  isDropTargetIntoSupplyAssembly,
  isEndpointInSupplyAssembly,
  type SupplyDropTargetFields,
} from '@/lib/eendraad/horizontalDomoticaTerminal'
import { CommandError, type CommandCheck } from './types'

function* circuitsWithOwners(
  panels: readonly Panel[]
): Generator<{ circuit: Circuit; panel: Panel; protection?: ProtectionDevice }> {
  for (const panel of walkPanels(panels)) {
    for (const circuit of panel.circuits ?? []) yield { circuit, panel }
    for (const protection of panel.protections ?? [])
      for (const circuit of protection.circuits ?? []) yield { circuit, panel, protection }
  }
}

/**
 * Everything on the supply side that carries the horizontal layout: modules on a DC bus rail,
 * converter lane or supply-side circuit, trunk devices of such circuits, supply trunk devices
 * and supply-assembly DC bus nodes. Identity is the entity id, so a saved project that already
 * breaks the rule yields the same ids before and after a change and is never refused for it.
 */
export function getHorizontalDomoticaSupplyIds(project: ProjectV2): Set<string> {
  const ids = new Set<string>()
  for (const { circuit, panel, protection } of circuitsWithOwners(getProjectElectricalPanels(project))) {
    const owner = { panel, protection }
    for (const endpoint of circuit.endpoints)
      if (isHorizontalDomotica(endpoint) && isEndpointInSupplyAssembly(circuit, endpoint.id, owner))
        ids.add(endpoint.id)
    if (!isCircuitOnSupplySide(circuit, owner)) continue
    for (const device of [
      ...(circuit.trunkDevices ?? []),
      ...(circuit.branches ?? []).flatMap((branch) => branch.branchDevices ?? []),
    ])
      if (isHorizontalDomotica(device)) ids.add(device.id)
  }
  for (const device of queryAllSupplyTrunkDevices(project)) if (isHorizontalDomotica(device)) ids.add(device.id)
  for (const assembly of selectProjectSupplyAssemblies(project))
    for (const node of assembly.nodes)
      if (node.kind === 'dc-bus' && node.properties.domoticaProps?.oneWireLayout === 'horizontal') ids.add(node.id)
  return ids
}

/** Whether no part of the project that can hold supply-side horizontal modules changed. */
function supplyDomainUnchanged(base: ProjectV2, next: ProjectV2): boolean {
  return (
    getProjectElectricalPanels(base) === getProjectElectricalPanels(next) &&
    getProjectElectricalInstallation(base) === getProjectElectricalInstallation(next) &&
    selectProjectSupplyAssemblies(base) === selectProjectSupplyAssemblies(next)
  )
}

/** A horizontal module is never part of a supply assembly; refuse changes that put one there. */
function assertNoNewHorizontalDomoticaInSupply(base: ProjectV2, next: ProjectV2): void {
  if (supplyDomainUnchanged(base, next)) return
  const now = getHorizontalDomoticaSupplyIds(next)
  if (now.size === 0) return
  const before = getHorizontalDomoticaSupplyIds(base)
  for (const id of now)
    if (!before.has(id))
      throw new CommandError('check_failed', HORIZONTAL_DOMOTICA_NO_SUPPLY_MESSAGE, {
        reason: 'horizontal_domotica_no_supply',
      })
}

/** Where a command is about to put `endpointIds`: a drop target and/or a destination circuit. */
export interface HorizontalDomoticaDestination {
  target?: SupplyDropTargetFields
  circuitId?: string
}

/**
 * Early, plain refusal for the commands that move or copy endpoints: a horizontal module cannot
 * go to the supply side. The transaction invariant stays the backstop for every other path.
 */
export function checkHorizontalDomoticaNotIntoSupply(
  project: ProjectV2,
  endpointIds: readonly string[],
  destination: HorizontalDomoticaDestination
): CommandCheck {
  const panels = getProjectElectricalPanels(project)
  const modules = new Set<string>()
  for (const { circuit } of circuitsWithOwners(panels))
    for (const endpoint of circuit.endpoints)
      if (endpointIds.includes(endpoint.id) && isHorizontalDomotica(endpoint)) modules.add(endpoint.id)
  if (modules.size === 0) return { ok: true }
  const owner = destination.circuitId ? findCircuitOwner([...panels], destination.circuitId) : null
  if (isDropTargetIntoSupplyAssembly(destination.target ?? {}, owner?.circuit, owner ?? undefined))
    return { ok: false, code: 'horizontal_domotica_no_supply', message: HORIZONTAL_DOMOTICA_NO_SUPPLY_MESSAGE }
  return { ok: true }
}

/**
 * A horizontal domotica module is terminal: no command may add content after it or nest a
 * module on its outputs. Existing violations in saved projects are left alone; only a change
 * that makes one worse (or creates one) is refused, whichever command or surface made it.
 */
export function assertNoNewHorizontalDomoticaViolations(base: ProjectV2, next: ProjectV2): void {
  assertNoNewHorizontalDomoticaInSupply(base, next)
  const old = new Map(
    [...walkPanels(getProjectElectricalPanels(base))]
      .flatMap(collectCircuits)
      .map((circuit) => [circuit.id, circuit])
  )
  for (const circuit of [...walkPanels(getProjectElectricalPanels(next))].flatMap(collectCircuits)) {
    const previous = old.get(circuit.id)
    if (circuit === previous || !circuitHasHorizontalDomotica(circuit)) continue
    const before = previous ? getHorizontalDomoticaViolations(previous) : new Map()
    for (const [moduleId, now] of getHorizontalDomoticaViolations(circuit)) {
      const was = before.get(moduleId)
      if (now.nested > (was?.nested ?? 0))
        throw new CommandError('check_failed', HORIZONTAL_DOMOTICA_NO_NESTING_MESSAGE, {
          reason: 'horizontal_domotica_no_nesting',
        })
      if (now.after > (was?.after ?? 0))
        throw new CommandError('check_failed', HORIZONTAL_DOMOTICA_TERMINAL_MESSAGE, {
          reason: 'horizontal_domotica_terminal',
        })
    }
  }
}
