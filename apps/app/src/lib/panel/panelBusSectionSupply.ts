import type { Installation, Panel, RootPanelFeedPath } from '@/types/schema'
import type { OffGridSupplyAssembly, SupplyLoadHandoff } from '@/types/supplyAssembly'
import { getPrimaryPanelBusSectionId } from './panelBusSections'

export type PanelBusSectionSupplyInput =
  | { kind: 'root-feed'; rootFeed: RootPanelFeedPath }
  | {
      kind: 'supply-assembly-handoff'
      assembly: OffGridSupplyAssembly
      handoff: SupplyLoadHandoff
    }

export interface ResolvedPanelBusSectionSupply {
  panelId: string
  busSectionId: string
  status: 'unfed' | 'single' | 'multiple'
  inputs: PanelBusSectionSupplyInput[]
}

/** A root feed containing only panel-side devices carries an assembly handoff. */
export function isPanelInputCarrierRootFeed(rootFeed: RootPanelFeedPath): boolean {
  return (rootFeed.trunkDevices ?? []).every((device) => device.supplyPanelInput === true)
}

export function isChangeoverNormalHandoffRecord(
  assembly: OffGridSupplyAssembly,
  handoff: SupplyLoadHandoff
): boolean {
  return handoff.id === `${assembly.id}-normal-handoff-record`
}

/**
 * The switched root-feed graph mirrors its normal-bus feed twice: once as the
 * root-feed carrier for ordered one-wire devices and once as the generated
 * normal handoff in the supply assembly. Those records describe one physical
 * input, not two independent supplies. Keep the exception narrow so a stale
 * handoff left behind after deleting the changeover is still detectable.
 */
export function isGeneratedChangeoverNormalHandoff(
  assembly: OffGridSupplyAssembly,
  handoff: SupplyLoadHandoff,
  panel: Panel,
  busSectionId: string
): boolean {
  return (
    isChangeoverNormalHandoffRecord(assembly, handoff) &&
    handoff.target.kind === 'panel-bus-input' &&
    handoff.target.panelId === panel.id &&
    handoff.target.busSectionId === busSectionId &&
    panel.busSections?.some(
      (section) => section.id === busSectionId && section.role === 'normal'
    ) === true &&
    assembly.nodes.some((node) => node.kind === 'changeover-switch')
  )
}

function handoffTargetsSection(
  handoff: SupplyLoadHandoff,
  panel: Panel,
  busSectionId: string
): boolean {
  if (handoff.target.kind === 'panel-bus-input') {
    return handoff.target.panelId === panel.id && handoff.target.busSectionId === busSectionId
  }
  return (
    handoff.target.kind === 'panel-input' &&
    handoff.target.panelId === panel.id &&
    getPrimaryPanelBusSectionId(panel) === busSectionId
  )
}

/** Reverse-index the persisted feeds and graph handoffs targeting one panel bus section. */
export function resolvePanelBusSectionSupply(
  installation: Installation | undefined,
  assemblies: readonly OffGridSupplyAssembly[],
  panel: Panel,
  busSectionId: string = getPrimaryPanelBusSectionId(panel)
): ResolvedPanelBusSectionSupply {
  const inputs: PanelBusSectionSupplyInput[] = []
  const rootFeeds = (installation?.feedTopology?.rootFeeds ?? []).filter(
    (rootFeed) =>
      rootFeed.panelId === panel.id &&
      (rootFeed.busSectionId ?? getPrimaryPanelBusSectionId(panel)) === busSectionId
  )
  const hasGeneratedNormalHandoff = assemblies.some((assembly) =>
    assembly.loadHandoffs.some((handoff) =>
      isGeneratedChangeoverNormalHandoff(assembly, handoff, panel, busSectionId)
    )
  )
  const hasSectionHandoff = assemblies.some((assembly) =>
    assembly.loadHandoffs.some(
      (handoff) =>
        !isChangeoverNormalHandoffRecord(assembly, handoff) &&
        handoffTargetsSection(handoff, panel, busSectionId)
    )
  )
  const hasPanelInputCarrier =
    rootFeeds.length === 1 && hasSectionHandoff && isPanelInputCarrierRootFeed(rootFeeds[0]!)
  if (!(rootFeeds.length === 1 && (hasGeneratedNormalHandoff || hasPanelInputCarrier))) {
    for (const rootFeed of rootFeeds) {
      inputs.push({ kind: 'root-feed', rootFeed })
    }
  }
  for (const assembly of assemblies) {
    for (const handoff of assembly.loadHandoffs) {
      if (handoffTargetsSection(handoff, panel, busSectionId)) {
        inputs.push({ kind: 'supply-assembly-handoff', assembly, handoff })
      }
    }
  }
  return {
    panelId: panel.id,
    busSectionId,
    status: inputs.length === 0 ? 'unfed' : inputs.length === 1 ? 'single' : 'multiple',
    inputs,
  }
}
