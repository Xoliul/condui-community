import type { Installation, Panel } from '@/types/schema'
import type { SupplyLoadHandoff } from '@/types/supplyAssembly'
import { collectCircuits, findPanelById } from '@/lib/panel/panelTree'

/** Whether a persisted load handoff still points to an existing electrical target. */
export function isSupplyHandoffTargetPresent(
  handoff: SupplyLoadHandoff,
  panels: Panel[],
  installation?: Installation
): boolean {
  const { target } = handoff

  if (target.kind === 'root-feed') {
    const rootFeeds = installation?.feedTopology?.rootFeeds
    // Older projects may not persist root-feed topology, so its absence is unknown.
    return !rootFeeds || rootFeeds.some((feed) => feed.id === target.rootFeedId)
  }

  const panel = findPanelById(panels, target.panelId)
  if (!panel) return false
  if (target.kind === 'panel-input') return true
  if (target.kind === 'panel-bus-input') {
    // Preserve compatibility with projects that predate explicit bus sections.
    return (
      !panel.busSections || panel.busSections.some((section) => section.id === target.busSectionId)
    )
  }

  return collectCircuits(panel).some((circuit) => circuit.id === target.circuitId)
}
