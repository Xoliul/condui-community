import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { walkPanels } from '@/lib/panel/panelTree'
import type { Circuit, Panel, ProtectionDevice, TrunkDevice } from '@/types/schema'
import type { SupplyTapAnchor } from '@/types/supplySources'
import { getSupplyTapLegDevices, type SupplyTapLeg } from './legs'
import { isNestedSupplyTapProtection, isSupplyTapsPanel, isSupplyTapsPanelEmpty } from './virtualPanel'

const SUPPLY_TAP_LEGS: readonly SupplyTapLeg[] = ['grid-run', 'changeover-grid', 'converter-input']

function isSupplyTapLeg(value: unknown): value is SupplyTapLeg {
  return SUPPLY_TAP_LEGS.includes(value as SupplyTapLeg)
}

/** Repair one top-level tap anchor in place. Returns true when it changed. */
function healAnchor(
  item: ProtectionDevice | Circuit,
  legDevices: (leg: SupplyTapLeg) => readonly TrunkDevice[]
): boolean {
  const anchor: SupplyTapAnchor | undefined = item.supplyTap
  if (!anchor || typeof anchor !== 'object' || !isSupplyTapLeg(anchor.leg)) {
    item.supplyTap = { leg: 'grid-run' }
    return true
  }
  if (
    anchor.afterTrunkDeviceId !== undefined &&
    !legDevices(anchor.leg).some((device) => device.id === anchor.afterTrunkDeviceId)
  ) {
    // The anchor device is gone from that leg and its former position is unknown, so the tap
    // falls back to the start of the leg. Commands that remove a device retarget first with
    // `retargetSupplyTapAnchors`, which keeps the tap after the nearest surviving device.
    delete anchor.afterTrunkDeviceId
    return true
  }
  return false
}

/**
 * Keep supply taps consistent after load or import: merge duplicate supply-taps boards of one
 * owner, give top-level items an anchor (a breaker nested after a tap's strip gets none), move anchors whose trunk device left that leg to the
 * start of the leg, and remove empty supply-taps boards. Mutates `project`; returns true when
 * anything changed.
 */
export function healSupplyTaps(project: ProjectWithOptionalV2Electrical): boolean {
  const feeds = getProjectElectricalInstallation(project)?.feedTopology?.rootFeeds ?? []
  let changed = false
  for (const owner of [...walkPanels(getProjectElectricalPanels(project))]) {
    const boards = (owner.subPanels ?? []).filter((panel) => isSupplyTapsPanel(panel))
    if (boards.length === 0) continue
    const board = boards[0]!
    const extras = boards.slice(1)
    if (extras.length > 0) {
      for (const extra of extras) mergeInto(board, extra)
      owner.subPanels = owner.subPanels.filter((panel) => !extras.includes(panel))
      changed = true
    }
    const feedDevices = feeds.find((feed) => feed.panelId === owner.id)?.trunkDevices
    const legDevices = (leg: SupplyTapLeg) => getSupplyTapLegDevices(feedDevices, leg)
    changed = dropForeignSubCircuits(board) || changed
    for (const item of [...(board.protections ?? []), ...(board.circuits ?? [])]) {
      if ('type' in item && isNestedSupplyTapProtection(board, item)) {
        // A breaker after a tap's strip belongs to that tap and has no anchor of its own.
        if (item.supplyTap) {
          delete item.supplyTap
          changed = true
        }
        continue
      }
      changed = healAnchor(item, legDevices) || changed
    }
    if (isSupplyTapsPanelEmpty(board)) {
      owner.subPanels = owner.subPanels.filter((panel) => panel !== board)
      changed = true
    }
  }
  return changed
}

/**
 * A tap can only nest breakers of its own taps board. An older drop stored the breaker after a
 * tap's strip in the owner board while the tap still listed its circuit, so that breaker was fed
 * from both the tap and the owner's bus. The owner keeps it; the tap loses the reference.
 */
function dropForeignSubCircuits(board: Panel): boolean {
  const own = new Set([
    ...(board.circuits ?? []),
    ...(board.protections ?? []).flatMap((protection) => protection.circuits ?? []),
  ].map((circuit) => circuit.id))
  let changed = false
  for (const circuit of board.circuits ?? []) {
    const kept = circuit.subCircuitIds?.filter((id) => own.has(id))
    if (!circuit.subCircuitIds || kept?.length === circuit.subCircuitIds.length) continue
    circuit.subCircuitIds = kept
    changed = true
  }
  return changed
}

function mergeInto(target: Panel, source: Panel): void {
  target.protections = [...(target.protections ?? []), ...(source.protections ?? [])]
  target.circuits = [...(target.circuits ?? []), ...(source.circuits ?? [])]
  target.subPanels = [...(target.subPanels ?? []), ...(source.subPanels ?? [])]
}

/**
 * Before removing trunk device `removedDeviceId` from the owner's supply, move taps anchored
 * after it to the nearest surviving device before it on the same leg (or the start of the leg).
 * Pure draft-friendly mutation; returns true when an anchor changed.
 */
export function retargetSupplyTapAnchors(
  owner: Pick<Panel, 'subPanels'>,
  feedDevices: readonly TrunkDevice[] | undefined,
  removedDeviceId: string
): boolean {
  const board = (owner.subPanels ?? []).find((panel) => isSupplyTapsPanel(panel))
  if (!board) return false
  let changed = false
  for (const item of [...(board.protections ?? []), ...(board.circuits ?? [])]) {
    const anchor = item.supplyTap
    if (anchor?.afterTrunkDeviceId !== removedDeviceId) continue
    const leg = getSupplyTapLegDevices(feedDevices, anchor.leg)
    const index = leg.findIndex((device) => device.id === removedDeviceId)
    const previous = index > 0 ? leg[index - 1] : undefined
    if (previous) anchor.afterTrunkDeviceId = previous.id
    else delete anchor.afterTrunkDeviceId
    changed = true
  }
  return changed
}
