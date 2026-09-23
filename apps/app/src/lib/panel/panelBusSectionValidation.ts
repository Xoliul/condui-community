import type { FeedTopology, Installation, Panel } from '@/types/schema'
import type { OffGridSupplyAssembly, SupplyAttachmentRef } from '@/types/supplyAssembly'
import { walkPanels } from './panelTree'
import { getPrimaryPanelBusSectionId, hasExplicitPanelBusSections } from './panelBusSections'
import {
  isChangeoverNormalHandoffRecord,
  isGeneratedChangeoverNormalHandoff,
  isPanelInputCarrierRootFeed,
} from './panelBusSectionSupply'

export type PanelBusSectionValidationCode =
  | 'empty-bus-sections'
  | 'duplicate-bus-section-id'
  | 'invalid-primary-bus-section'
  | 'invalid-bus-phase-order'
  | 'dangling-device-bus-section'
  | 'nested-circuit-bus-section-mismatch'
  | 'dangling-root-feed-panel'
  | 'dangling-root-feed-bus-section'
  | 'dangling-handoff-panel'
  | 'dangling-handoff-bus-section'
  | 'duplicate-bus-section-supply'

export interface PanelBusSectionValidationIssue {
  code: PanelBusSectionValidationCode
  message: string
  entityId: string
}

function issue(
  code: PanelBusSectionValidationCode,
  message: string,
  entityId: string
): PanelBusSectionValidationIssue {
  return { code, message, entityId }
}

function explicitSectionIds(panel: Panel): Set<string> {
  return new Set(panel.busSections?.map((section) => section.id) ?? [])
}

function validateAttachmentTarget(
  target: SupplyAttachmentRef,
  panelsById: ReadonlyMap<string, Panel>,
  issues: PanelBusSectionValidationIssue[],
  entityId: string
): string | undefined {
  if (target.kind !== 'panel-input' && target.kind !== 'panel-bus-input') return undefined
  const panel = panelsById.get(target.panelId)
  if (!panel) {
    issues.push(
      issue(
        'dangling-handoff-panel',
        `Supply attachment ${entityId} references missing panel ${target.panelId}.`,
        entityId
      )
    )
    return undefined
  }
  const busSectionId =
    target.kind === 'panel-bus-input' ? target.busSectionId : getPrimaryPanelBusSectionId(panel)
  if (
    target.kind === 'panel-bus-input' &&
    (!hasExplicitPanelBusSections(panel) || !explicitSectionIds(panel).has(busSectionId))
  ) {
    issues.push(
      issue(
        'dangling-handoff-bus-section',
        `Supply attachment ${entityId} references missing bus section ${busSectionId} on panel ${panel.id}.`,
        entityId
      )
    )
    return undefined
  }
  return JSON.stringify([panel.id, busSectionId])
}

export function validatePanelBusSectionTopology(
  panels: Panel[],
  installation: Installation | undefined,
  assemblies: readonly OffGridSupplyAssembly[]
): PanelBusSectionValidationIssue[] {
  const issues: PanelBusSectionValidationIssue[] = []
  const allPanels = [...walkPanels(panels)]
  const panelsById = new Map(allPanels.map((panel) => [panel.id, panel]))
  const supplyCounts = new Map<string, string[]>()
  const addSupply = (key: string | undefined, sourceId: string) => {
    if (!key) return
    const sources = supplyCounts.get(key) ?? []
    sources.push(sourceId)
    supplyCounts.set(key, sources)
  }

  for (const panel of allPanels) {
    if (Array.isArray(panel.busSections) && panel.busSections.length === 0) {
      issues.push(
        issue(
          'empty-bus-sections',
          `Panel ${panel.id} stores an empty bus-section list; omit it for the legacy main bus.`,
          panel.id
        )
      )
      continue
    }
    if (!hasExplicitPanelBusSections(panel)) continue

    const ids = explicitSectionIds(panel)
    if (
      ids.size !== panel.busSections!.length ||
      panel.busSections!.some((section) => !section.id)
    ) {
      issues.push(
        issue(
          'duplicate-bus-section-id',
          `Panel ${panel.id} contains blank or duplicate bus-section ids.`,
          panel.id
        )
      )
    }
    if (!panel.primaryBusSectionId || !ids.has(panel.primaryBusSectionId)) {
      issues.push(
        issue(
          'invalid-primary-bus-section',
          `Panel ${panel.id} must reference one of its bus sections as primary.`,
          panel.id
        )
      )
    }
    for (const section of panel.busSections!) {
      const order = section.phaseOrder ?? []
      if (
        order.length > 3 ||
        new Set(order).size !== order.length ||
        order.some((phase) => phase !== 'L1' && phase !== 'L2' && phase !== 'L3')
      ) {
        issues.push(
          issue(
            'invalid-bus-phase-order',
            `Bus section ${section.id} has an invalid phase order.`,
            section.id
          )
        )
      }
    }
    for (const protection of panel.protections) {
      if (protection.busSectionId && !ids.has(protection.busSectionId)) {
        issues.push(
          issue(
            'dangling-device-bus-section',
            `Protection ${protection.id} references missing bus section ${protection.busSectionId}.`,
            protection.id
          )
        )
      }
      for (const circuit of protection.circuits ?? []) {
        if (
          circuit.busSectionId &&
          circuit.busSectionId !== (protection.busSectionId ?? panel.primaryBusSectionId)
        ) {
          issues.push(
            issue(
              'nested-circuit-bus-section-mismatch',
              `Circuit ${circuit.id} must inherit bus section from protection ${protection.id}.`,
              circuit.id
            )
          )
        }
      }
    }
    for (const circuit of panel.circuits) {
      if (circuit.busSectionId && !ids.has(circuit.busSectionId)) {
        issues.push(
          issue(
            'dangling-device-bus-section',
            `Circuit ${circuit.id} references missing bus section ${circuit.busSectionId}.`,
            circuit.id
          )
        )
      }
    }
  }

  const topology: FeedTopology | undefined = installation?.feedTopology
  const generatedNormalHandoffKeys = new Set<string>()
  const handoffKeys = new Set<string>()
  for (const assembly of assemblies) {
    for (const handoff of assembly.loadHandoffs) {
      if (
        !isChangeoverNormalHandoffRecord(assembly, handoff) &&
        (handoff.target.kind === 'panel-input' || handoff.target.kind === 'panel-bus-input')
      ) {
        const panel = panelsById.get(handoff.target.panelId)
        if (panel) {
          handoffKeys.add(
            JSON.stringify([
              panel.id,
              handoff.target.kind === 'panel-bus-input'
                ? handoff.target.busSectionId
                : getPrimaryPanelBusSectionId(panel),
            ])
          )
        }
      }
      if (handoff.target.kind !== 'panel-bus-input') continue
      const panel = panelsById.get(handoff.target.panelId)
      if (
        panel &&
        isGeneratedChangeoverNormalHandoff(assembly, handoff, panel, handoff.target.busSectionId)
      ) {
        generatedNormalHandoffKeys.add(
          JSON.stringify([handoff.target.panelId, handoff.target.busSectionId])
        )
      }
    }
  }
  const rootFeedCounts = new Map<string, number>()
  for (const feed of topology?.rootFeeds ?? []) {
    const panel = panelsById.get(feed.panelId)
    if (!panel) continue
    const busSectionId = feed.busSectionId ?? getPrimaryPanelBusSectionId(panel)
    const key = JSON.stringify([panel.id, busSectionId])
    rootFeedCounts.set(key, (rootFeedCounts.get(key) ?? 0) + 1)
  }
  for (const feed of topology?.rootFeeds ?? []) {
    const panel = panelsById.get(feed.panelId)
    if (!panel) {
      issues.push(
        issue(
          'dangling-root-feed-panel',
          `Root feed ${feed.id} references missing panel ${feed.panelId}.`,
          feed.id
        )
      )
      continue
    }
    const busSectionId = feed.busSectionId ?? getPrimaryPanelBusSectionId(panel)
    if (
      feed.busSectionId &&
      (!hasExplicitPanelBusSections(panel) || !explicitSectionIds(panel).has(feed.busSectionId))
    ) {
      issues.push(
        issue(
          'dangling-root-feed-bus-section',
          `Root feed ${feed.id} references missing bus section ${feed.busSectionId}.`,
          feed.id
        )
      )
      continue
    }
    const key = JSON.stringify([panel.id, busSectionId])
    if (
      !(
        rootFeedCounts.get(key) === 1 &&
        (generatedNormalHandoffKeys.has(key) ||
          (handoffKeys.has(key) && isPanelInputCarrierRootFeed(feed)))
      )
    ) {
      addSupply(key, feed.id)
    }
  }

  for (const assembly of assemblies) {
    validateAttachmentTarget(assembly.incomingAttachment, panelsById, issues, assembly.id)
    for (const handoff of assembly.loadHandoffs) {
      addSupply(
        validateAttachmentTarget(handoff.target, panelsById, issues, handoff.id),
        handoff.id
      )
    }
  }

  for (const [key, sources] of supplyCounts) {
    if (sources.length <= 1) continue
    const [panelId, busSectionId] = JSON.parse(key) as [string, string]
    const panel = panelsById.get(panelId!)
    // Root-feed carriers mirrored by assembly handoffs are excluded above.
    // Any remaining duplicate is a separate incoming source.
    if (!panel || !hasExplicitPanelBusSections(panel)) continue
    issues.push(
      issue(
        'duplicate-bus-section-supply',
        `Bus section ${busSectionId} on panel ${panelId} has multiple incoming supplies: ${sources.join(', ')}.`,
        busSectionId!
      )
    )
  }

  return issues
}
