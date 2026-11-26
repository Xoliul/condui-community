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
import { getDomoticaBusRowLabelMetrics } from '@/lib/eendraad/domoticaBusRowLabel'
import { isHorizontalDomotica } from './domoticaHorizontalGeometry'
import { getHorizontalDomoticaOutputLabels } from './horizontalDomoticaOutputLabels'

/** Left-aligned row label ("T6.1") painted after the last endpoint of a domotica output row. */
export interface DomoticaRowLabelPlacement {
  endpointId: string
  /** Left edge of the text. */
  x: number
  /** Vertical centre of the text line. */
  y: number
  text: string
  /** Bus markers retain their full text on one measured line instead of wrapping into device labels. */
  unwrappedWidth?: number
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
  const circuit = panelLayout.circuits.find((candidate) => candidate.circuit.endpoints.some((item) => item.id === endpoint.id))?.circuit
  const text = getDomoticaRowDisplayLabel(endpoint, circuit)
  const busLabel = getDomoticaBusRowLabelMetrics(endpoint)
  return {
    endpointId: endpoint.id,
    x: isDomoticaParent
      ? element.position.x - DOMOTICA_BOX_WIDTH / 2
      : element.position.x + LAYOUT_CONSTANTS.SYMBOL_SIZE / 2 + DOMOTICA_CHILD_LABEL_GAP,
    y: isDomoticaParent
      ? element.position.y + DOMOTICA_BASE_HEIGHT / 2 + 10
      : element.position.y,
    text,
    ...(busLabel ? { unwrappedWidth: busLabel.width } : {}),
  }
}

/** Output number labels of the horizontal modules on one branch, as row label placements. */
export function getHorizontalOutputLabelPlacements(
  panelLayout: BottomUpPanelLayout,
  branchEndpoints: Endpoint[],
  endpoint: Endpoint
): DomoticaRowLabelPlacement[] {
  if (!isHorizontalDomotica(endpoint)) return []
  const element = panelLayout.elements.find(
    (candidate) => candidate.type === 'endpoint' && candidate.endpointId === endpoint.id
  )
  if (!element) return []
  const code =
    panelLayout.circuits.find((candidate) =>
      candidate.circuit.endpoints.some((item) => item.id === endpoint.id)
    )?.circuit.code ?? ''
  return getHorizontalDomoticaOutputLabels(endpoint, branchEndpoints, element.position, code).map(
    (label) => ({ endpointId: label.id, x: label.x, y: label.y, text: label.text })
  )
}

export function collectDomoticaRowLabelPlacements(
  panelLayout: BottomUpPanelLayout
): DomoticaRowLabelPlacement[] {
  return (panelLayout.branches ?? []).flatMap((branch) =>
    branch.endpoints.flatMap((endpoint) => {
      const placement = getDomoticaRowLabelPlacement(panelLayout, branch.endpoints, endpoint)
      return [
        ...(placement ? [placement] : []),
        ...getHorizontalOutputLabelPlacements(panelLayout, branch.endpoints, endpoint),
      ]
    })
  )
}
