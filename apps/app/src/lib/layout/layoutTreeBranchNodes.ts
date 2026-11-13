/** Endpoint branch scene nodes, including labels and domotica insertion targets. */
import { getEndpointNoteMinimumLeftX } from '@/lib/eendraad/endpointNoteLabelCollision'
import { getVisibleEndpointNoteText } from '@/lib/conversionLabels'
import { getControlButtonLabelLayout } from '@/lib/eendraad/controlButtonLabels'
import {
  DOMOTICA_BASE_HEIGHT,
  DOMOTICA_BOX_WIDTH,
  DOMOTICA_BRANCH_LEAD,
  DOMOTICA_CHILD_ON_DROP_ZONE_SIZE,
  DOMOTICA_MAX_ENDPOINT_OUTPUTS,
  DOMOTICA_MIN_ENDPOINT_OUTPUTS,
  DOMOTICA_OUTPUT_SPACING,
} from '@/lib/domoticaLayout'
import { LAYOUT_CONSTANTS, type BottomUpPanelLayout } from './bottomUpLayout'
import {
  getBranchConverterMetadataCallouts,
  type CircuitConverterMetadataCallout,
} from './circuitConverterMetadataCallouts'
import { getDomoticaRowLabelPlacement } from './domoticaRowLabelPlacement'
import type { LayoutNode } from './layoutTree'
import type { BranchLayout } from './wireSegments'

export function buildBranchNode(
  panelLayout: BottomUpPanelLayout,
  branch: BranchLayout,
  metadataCallouts?: Map<string, CircuitConverterMetadataCallout>
): LayoutNode | null {
  const children: LayoutNode[] = []
  const constrainSingleEndpointLabel =
    branch.endpoints.length === 1 && branch.endpoints[0]?.type !== 'switch'
  const bottomNoteEndpointIndexes = new Set(
    branch.endpoints.flatMap((endpoint, endpointIndex) => {
      const isRightLabel =
        endpointIndex === branch.endpoints.length - 1 &&
        (endpoint.symbol === 'solar_panel' ||
          endpoint.symbol === 'battery' ||
          endpoint.symbol === 'ev')
      return endpoint.symbol !== 'domotica' && !isRightLabel && (getVisibleEndpointNoteText(endpoint) || getControlButtonLabelLayout(endpoint)) ? [endpointIndex] : []
    })
  )

  // Find branch visual element
  const branchElement = panelLayout.elements.find(
    (e) => e.type === 'branch' && e.branchId === branch.id
  )

  if (!branchElement) {
    return null
  }

  const endpointElements = branch.endpoints.flatMap((endpoint) => {
    const element = panelLayout.elements.find(
      (candidate) => candidate.type === 'endpoint' && candidate.endpointId === endpoint.id
    )
    return element ? [{ endpoint, element }] : []
  })
  const branchMetadataCallouts =
    metadataCallouts ??
    getBranchConverterMetadataCallouts({
      targets: endpointElements.map(({ endpoint, element }) => ({
        endpoint,
        position: element.position,
      })),
      symbolSize: LAYOUT_CONSTANTS.SYMBOL_SIZE,
      segments: [
        {
          startPoint: { x: branch.trunkX, y: branch.branchY },
          endPoint: { x: branch.branchX + branch.branchWidth, y: branch.branchY },
        },
      ],
    })

  // Add endpoints on this branch
  for (const [endpointIndex, endpoint] of branch.endpoints.entries()) {
    const endpointElement = panelLayout.elements.find(
      (e) => e.type === 'endpoint' && e.endpointId === endpoint.id
    )

    if (endpointElement) {
      const isDomoticaParent = endpoint.symbol === 'domotica'
      const isDomoticaChild = !!endpoint.domoticaChildProps
      const endpointMetadataCallout = branchMetadataCallouts.get(endpoint.id)
      const domoticaEndpointCount = isDomoticaParent
        ? Math.max(
            DOMOTICA_MIN_ENDPOINT_OUTPUTS,
            Math.min(
              DOMOTICA_MAX_ENDPOINT_OUTPUTS,
              Math.trunc(endpoint.domoticaProps?.endpointCount ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS)
            )
          )
        : DOMOTICA_MIN_ENDPOINT_OUTPUTS
      const domoticaHeight =
        DOMOTICA_BASE_HEIGHT + Math.max(0, domoticaEndpointCount - 1) * DOMOTICA_OUTPUT_SPACING

      // Domotica box is drawn with center at position (EndpointSymbol: x = position.x - BOX_WIDTH/2)
      const endpointNode: LayoutNode = {
        id: endpointElement.id,
        type: 'endpoint',
        bounds: {
          x: endpointElement.position.x,
          y: isDomoticaParent
            ? endpointElement.position.y - domoticaHeight / 2 + DOMOTICA_BASE_HEIGHT / 2
            : endpointElement.position.y,
          width: isDomoticaParent ? DOMOTICA_BOX_WIDTH : LAYOUT_CONSTANTS.SYMBOL_SIZE,
          height: isDomoticaParent ? domoticaHeight : LAYOUT_CONSTANTS.SYMBOL_SIZE,
        },
        domainId: endpoint.id,
        domainRef: endpoint,
        visual: {
          type: 'symbol',
          symbolId: endpoint.symbol || getDefaultSymbolForEndpointType(endpoint.type),
          label: endpoint.label,
          isEndpointAtBranchEnd: endpointIndex === branch.endpoints.length - 1,
          mirrorHorizontally: endpointElement.mirrorEndpointHorizontally,
          bottomLabelMinimumLeftX: constrainSingleEndpointLabel || isDomoticaParent
            ? getEndpointNoteMinimumLeftX(endpointElement.position.x, branch.branchX)
            : bottomNoteEndpointIndexes.has(endpointIndex)
              ? getEndpointNoteMinimumLeftX(endpointElement.position.x, branch.branchX)
              : undefined,
          metadataCallout: endpointMetadataCallout
            ? {
                x: endpointMetadataCallout.x,
                y: endpointMetadataCallout.y,
                width: endpointMetadataCallout.width,
                height: endpointMetadataCallout.height,
                leaderPoints: endpointMetadataCallout.leaderPoints,
                leaderSegments: endpointMetadataCallout.leaderSegments,
                targetIds: endpointMetadataCallout.sharedTargetIds,
                totalMultiplier: endpointMetadataCallout.totalMultiplier,
              }
            : undefined,
        },
        hitZone: isDomoticaParent
          ? {
              // Domotica parent hitbox = just its box; wires have their own separate hit zones.
              type: 'endpoint',
              padding: 4,
            }
          : isDomoticaChild
            ? {
                type: 'endpoint',
                // The symbol body owns the center zone. Before/after have
                // narrow wire-aligned zones of their own below.
                padding: 0,
              }
            : {
              type: 'endpoint',
              // Generous padding for regular endpoints so dropping ON the socket (and nearby) reliably targets it.
              padding: 15,
            },
        children: [],
      }

      if (isDomoticaChild || isDomoticaParent) {
        const symbolLeft = endpointElement.position.x - DOMOTICA_CHILD_ON_DROP_ZONE_SIZE / 2
        const symbolRight = endpointElement.position.x + DOMOTICA_CHILD_ON_DROP_ZONE_SIZE / 2
        const sideZoneWidth = 15
        const sideZoneHeight = 20
        const previousEndpointId = branch.endpoints[endpointIndex - 1]?.id ?? null
        const sideZone = (
          id: string,
          x: number,
          intent: 'insertBefore' | 'insertAfter',
          insertAfterEndpointId: string | null
        ): LayoutNode => ({
          id,
          type: 'wire',
          bounds: {
            x,
            y: endpointElement.position.y - sideZoneHeight / 2,
            width: sideZoneWidth,
            height: sideZoneHeight,
          },
          domainId: endpoint.id,
          domainRef: endpoint,
          hitZone: {
            type: 'endpoint',
            padding: 0,
            domoticaChildDropIntent: intent,
            branchInsertAfterEndpointId: insertAfterEndpointId,
          },
          children: [],
        })

        endpointNode.children.push(
          sideZone(
            `${endpointElement.id}-drop-before`,
            symbolLeft - sideZoneWidth,
            'insertBefore',
            previousEndpointId
          )
        )
        if (isDomoticaChild) endpointNode.children.push(
          sideZone(
            `${endpointElement.id}-drop-after`,
            symbolRight,
            'insertAfter',
            endpoint.id
          )
        )
      }

      children.push(endpointNode)

      // Domotica child endpoints: label to the right of the symbol (A1.1, A1.2, …)
      const rowLabel = getDomoticaRowLabelPlacement(panelLayout, branch.endpoints, endpoint)
      if (rowLabel) {
        children.push({
          id: `${endpointElement.id}-label`,
          type: 'label',
          bounds: {
            x: rowLabel.x,
            y: rowLabel.y,
            width: rowLabel.unwrappedWidth ?? 80,
            height: 20,
          },
          visual: {
            type: 'label',
            text: rowLabel.text,
            ...(rowLabel.unwrappedWidth != null ? { unwrappedWidth: rowLabel.unwrappedWidth } : {}),
            align: 'left',
          },
          children: [],
        })
      }

      if (isDomoticaParent) {
        // Match deriveWires: variable part only (no BASE_HEIGHT) for output Y positioning
        const domoticaVariableHeight =
          Math.max(0, domoticaEndpointCount - 1) * DOMOTICA_OUTPUT_SPACING
        // Box center = position.x (EndpointSymbol draws box centered at position)
        const boxRightX = endpointElement.position.x + DOMOTICA_BOX_WIDTH / 2

        // Same as deriveWires: firstOutputY = branchY - domoticaVariableHeight
        const firstOutputY = endpointElement.position.y - domoticaVariableHeight
        for (let index = 0; index < domoticaEndpointCount; index++) {
          const outputY = firstOutputY + index * DOMOTICA_OUTPUT_SPACING
          // Hit zone overlaps box right edge and extends right along the wire for reliable drop detection
          const zoneWidth = DOMOTICA_BRANCH_LEAD + 30
          children.push({
            id: `${endpointElement.id}-domotica-endpoint-output-${index}`,
            type: 'wire',
            bounds: {
              x: boxRightX,
              y: outputY - 7.5,
              width: zoneWidth,
              height: 15,
            },
            domainId: endpoint.id,
            domainRef: endpoint,
            hitZone: {
              type: 'endpoint',
              padding: 14,
              outputGroup: 'endpoint',
              outputIndex: index,
            },
            children: [],
          })
        }

        const endpointSlots = endpoint.domoticaProps?.endpointChildEndpointIds ?? []
        const currentSlotsAreFull = Array.from({ length: domoticaEndpointCount }).every(
          (_, index) => {
            const childId = endpointSlots[index]
            return typeof childId === 'string' && childId.trim().length > 0
          }
        )
        if (currentSlotsAreFull && domoticaEndpointCount < DOMOTICA_MAX_ENDPOINT_OUTPUTS) {
          children.push({
            id: `${endpointElement.id}-domotica-endpoint-output-expand`,
            type: 'wire',
            bounds: {
              x: boxRightX,
              y: endpointElement.position.y + DOMOTICA_OUTPUT_SPACING / 2 - 10,
              width: DOMOTICA_BRANCH_LEAD + 18,
              height: 20,
            },
            domainId: endpoint.id,
            domainRef: endpoint,
            hitZone: {
              type: 'endpoint',
              padding: 12,
              outputGroup: 'endpoint',
              outputIndex: domoticaEndpointCount,
              outputExpands: true,
            },
            children: [],
          })
        }
      }
    }
  }

  // Note: sub-panel symbols are handled in buildMcbNode (directly on MCB, not on a branch)

  // Add branch label
  const branchLabelElement = panelLayout.elements.find(
    (e) => e.type === 'label' && e.branchId === branch.id
  )
  if (branchLabelElement) {
    children.push({
      id: branchLabelElement.id,
      type: 'label',
      bounds: {
        x: branchLabelElement.position.x,
        y: branchLabelElement.position.y,
        width: 100,
        height: 20,
      },
      visual: {
        type: 'label',
        text: branchLabelElement.label || '',
        fontSize: 12,
        // Right-align branch labels so the right edge of the text box
        // sits at the layout-provided X (offset from trunk wire).
        align: 'right',
      },
      children: [],
    })
  }

  // Bounds include full horizontal wire: from trunk to end of branch (so drop on wire = circuit)
  const pad = 10
  const wireLeft = Math.min(branch.trunkX, branch.branchX)
  const wireRight = Math.max(branch.trunkX, branch.branchX + branch.branchWidth)
  const wireTop = branch.branchY - pad
  const wireHeight = pad * 2

  return {
    id: branchElement.id,
    type: 'branch',
    bounds: {
      x: wireLeft,
      y: wireTop,
      width: wireRight - wireLeft,
      height: wireHeight,
    },
    domainId: branch.id,
    branchLayout: branch,
    hitZone: {
      type: 'circuit',
      padding: 0,
    },
    children,
  }
}

export function getDefaultSymbolForEndpointType(type: string): string {
  switch (type) {
    case 'socket':
      return 'socket_gnd_child'
    case 'light_point':
      return 'light_point'
    case 'switch':
      return 'switch'
    case 'fixed_appliance':
      return 'fixed_appliance_generic'
    case 'domotica':
      return 'domotica'
    default:
      return 'light_point'
  }
}
