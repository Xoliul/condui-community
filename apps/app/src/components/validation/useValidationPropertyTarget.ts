import { useCanvasWindow } from '@/components/viewport/ViewportContext'
import { useViewportWindowApi } from '@/components/viewport/ViewportWindowStore'
import { getGroundElementId, INSTALLATION_GROUND_ELEMENT_ID } from '@/lib/eendraad/panelGround'
import { findPanelById } from '@/lib/panel/panelTree'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import type { Issue } from '@/lib/validation/core/types'
import type { ProjectV2 } from '@/types/projectV2'
import type { Selection } from '@/types/ui'

export function validationPropertyTarget(issue: Issue, project: ProjectV2 | null): {
  selection: Selection
  field: string
} | undefined {
  if (issue.scope.type !== 'board') return undefined
  const boardId = issue.scope.id
  switch (issue.ruleId) {
    case 'be.areibook1.2025.nonhousehold-earth-resistance-entered': {
      const board = project && findPanelById(getProjectElectricalPanels(project), boardId)
      const id = board ? getGroundElementId(board) : INSTALLATION_GROUND_ELEMENT_ID
      return { selection: { type: 'ground', ids: [id] }, field: 'earthResistanceOhm' }
    }
    case 'be.areibook1.2025.nonhousehold-board-short-circuit-current':
      return {
        selection: { type: 'panel', ids: [boardId] },
        field: `expectedShortCircuitKa:${boardId}`,
      }
    default:
      return undefined
  }
}

export function useRevealValidationProperty(onRevealProperties?: () => void) {
  const viewport = useViewportWindowApi()
  const ownerWindow = useCanvasWindow()
  return ({ selection, field }: NonNullable<ReturnType<typeof validationPropertyTarget>>) => {
    const state = viewport.getState()
    if (onRevealProperties) onRevealProperties()
    else if (!state.panels.properties.visible) state.togglePanel('properties')

    // The field may mount after the selection changes or the properties panel opens.
    const deadline = ownerWindow.performance.now() + 500
    const reveal = () => {
      const current = viewport.getState().selection
      if (current.type !== selection.type || current.ids.length !== 1 || current.ids[0] !== selection.ids[0]) return
      const input = Array.from(ownerWindow.document.querySelectorAll<HTMLElement>(
        '[data-properties-panel] [data-property-field]'
      )).find((element) => element.dataset.propertyField === field && element.getClientRects().length > 0)
      if (input) input.scrollIntoView({ block: 'nearest' })
      else if (ownerWindow.performance.now() < deadline) ownerWindow.requestAnimationFrame(reveal)
    }
    ownerWindow.requestAnimationFrame(reveal)
  }
}
