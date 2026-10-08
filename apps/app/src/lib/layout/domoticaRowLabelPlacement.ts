import {
  DOMOTICA_BASE_HEIGHT,
  DOMOTICA_BOX_WIDTH,
  DOMOTICA_CHILD_LABEL_GAP,
} from '@/lib/domoticaLayout'
import {
  getDomoticaRowDisplayLabel,
  isDomoticaRowLabelShown,
} from '@/lib/eendraad/domoticaRowLabel'
import type { Endpoint } from '@/types/schema'
import { LAYOUT_CONSTANTS, type BottomUpPanelLayout } from './bottomUpLayout'

/** Left-aligned row label ("T6.1") painted after the last endpoint of a domotica output row. */
export interface DomoticaRowLabelPlacement {
  endpointId: string
  /** Left edge of the text. */
  x: number
  /** Vertical centre of the text line. */
  y: number
  text: string
}

/**
 * Where a domotica output row label is painted for one endpoint, or null when this
 * endpoint does not carry it. The canvas, the PDF export, frames and date labels all
 * read this so the label is drawn, exported and avoided in one place.
 */
export function getDomoticaRowLabelPlacement(
  panelLayout: BottomUpPanelLayout,
  branchEndpoints: Endpoint[],
  endpoint: Endpoint
): DomoticaRowLabelPlacement | null {
  const row = endpoint.domoticaChildProps
  if (!row || !endpoint.label || !isDomoticaRowLabelShown(branchEndpoints, endpoint)) return null

  const elementFor = (candidate: Endpoint) =>
    panelLayout.elements.find(
      (element) => element.type === 'endpoint' && element.endpointId === candidate.id
    )
  const rowEndpoints = branchEndpoints.filter(
    (candidate) =>
      candidate.domoticaChildProps?.parentEndpointId === row.parentEndpointId &&
      candidate.domoticaChildProps.outputGroup === row.outputGroup &&
      candidate.domoticaChildProps.outputIndex === row.outputIndex
  )
  let rightmost: { endpoint: Endpoint; x: number } | null = null
  for (const candidate of rowEndpoints) {
    const element = elementFor(candidate)
    if (!element) continue
    if (!rightmost || element.position.x > rightmost.x) {
      rightmost = { endpoint: candidate, x: element.position.x }
    }
  }
  if (rightmost?.endpoint.id !== endpoint.id) return null

  const element = elementFor(endpoint)!
  const isDomoticaParent = endpoint.symbol === 'domotica'
  return {
    endpointId: endpoint.id,
    x: isDomoticaParent
      ? element.position.x - DOMOTICA_BOX_WIDTH / 2
      : element.position.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 + DOMOTICA_CHILD_LABEL_GAP,
    y: isDomoticaParent
      ? element.position.y + DOMOTICA_BASE_HEIGHT / 2 + 10
      : element.position.y,
    text: getDomoticaRowDisplayLabel(endpoint),
  }
}

export function collectDomoticaRowLabelPlacements(
  panelLayout: BottomUpPanelLayout
): DomoticaRowLabelPlacement[] {
  return (panelLayout.branches ?? []).flatMap((branch) =>
    branch.endpoints.flatMap((endpoint) => {
      const placement = getDomoticaRowLabelPlacement(panelLayout, branch.endpoints, endpoint)
      return placement ? [placement] : []
    })
  )
}
