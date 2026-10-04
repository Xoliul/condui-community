import type { Circuit, Endpoint } from '@/types/schema'
import { getCircuitBranches } from '@/lib/layout/endpointChains'

export interface AreiEndpointCountBreakdownRow {
  id: string
  label: string
  symbol?: string
  type?: string
  isDomoticaParent: boolean
  isDomoticaChild: boolean
  outputGroup?: string
  socketCount?: number
  countedAsEndpoint: boolean
}

/**
 * Effective endpoint count for AREI-style “max contactdozen per circuit” (§ 5.3.5.2).
 *
 * - Each socket endpoint counts as one enkelvoudige or meervoudige contactdoos,
 *   regardless of socketProps.socketCount (visual/meervoudige doos on one plate).
 * - Switches are not consumption points, including numbered circuit-trunk switches.
 * - Fixed loads on one branch behind a common control count as one equivalent
 *   point. Individually controlled loads remain separate because they live on
 *   separate branches.
 * - A switch-only draft branch does not represent a socket-equivalent point.
 */
export function computeAreiCircuitEndpointLimitCount(circuit: Circuit): {
  endpointCount: number
  /** Kept for validation debug compatibility; switch-only branches add no points. */
  switchOnlyBranchCredits: number
  rawEndpoints: Endpoint[]
  breakdown: AreiEndpointCountBreakdownRow[]
} {
  const rawEndpoints = circuit.endpoints
  const domoticaParentLabels = rawEndpoints
    .filter((ep) => ep.symbol === 'domotica')
    .map((ep) => ep.label)

  const endpointsById = new Map(rawEndpoints.map((ep) => [ep.id, ep]))

  const fixedOnSocketBranchIds = new Set<string>()
  if (circuit.branches) {
    for (const branch of circuit.branches) {
      const ids = branch.endpointIds ?? []
      const hasSocket = ids.some((id) => endpointsById.get(id)?.type === 'socket')
      if (!hasSocket) continue
      for (const id of ids) {
        const ep = endpointsById.get(id)
        if (ep?.type === 'fixed_appliance') {
          fixedOnSocketBranchIds.add(id)
        }
      }
    }
  }

  const countsAsLoadEndpointForBranch = (ep: Endpoint): boolean => {
    const isDomoticaParent = ep.symbol === 'domotica'
    const isJunction =
      ep.symbol === 'junction_box' ||
      ep.symbol === 'junction_panel'
    const isSocketForDomoticaParent =
      ep.type === 'socket' && domoticaParentLabels.includes(ep.label)
    const isFixedOnSocketBranch = fixedOnSocketBranchIds.has(ep.id)
    const isDomoticaChild = !!ep.domoticaChildProps
    const outputGroup = ep.domoticaChildProps?.outputGroup
    if (isDomoticaParent || isJunction || isSocketForDomoticaParent || isFixedOnSocketBranch) {
      return false
    }
    if (ep.type === 'switch') return false
    if (isDomoticaChild) return outputGroup === 'endpoint'
    return true
  }

  let branchGroups = getCircuitBranches(circuit)
  const coveredEndpointIds = new Set<string>()
  for (const group of branchGroups) {
    for (const ep of group) coveredEndpointIds.add(ep.id)
  }
  for (const ep of rawEndpoints) {
    if (!coveredEndpointIds.has(ep.id)) {
      branchGroups = [...branchGroups, [ep]]
    }
  }

  const switchOnlyBranchCredits = 0
  let endpointCount = 0

  // A group of fixed loads controlled by the same branch control device is one
  // socket-equivalent point. Socket endpoints themselves remain one point each.
  const groupedLoadRepresentativeIds = new Set<string>()
  for (const branch of branchGroups) {
    const nonSocketLoads = branch.filter(
      (ep) => ep.type !== 'socket' && countsAsLoadEndpointForBranch(ep),
    )
    const hasCommonControl = branch.some((ep) => ep.type === 'switch')
    if (nonSocketLoads.length > 0 && hasCommonControl) {
      groupedLoadRepresentativeIds.add(nonSocketLoads[0]!.id)
    } else {
      for (const load of nonSocketLoads) groupedLoadRepresentativeIds.add(load.id)
    }
  }

  const breakdown: AreiEndpointCountBreakdownRow[] = []

  for (const ep of rawEndpoints) {
    const isDomoticaParent = ep.symbol === 'domotica'
    const isJunction =
      ep.symbol === 'junction_box' ||
      ep.symbol === 'junction_panel'
    const isSocketForDomoticaParent =
      ep.type === 'socket' && domoticaParentLabels.includes(ep.label)
    const isFixedOnSocketBranch = fixedOnSocketBranchIds.has(ep.id)
    const isDomoticaChild = !!ep.domoticaChildProps
    const outputGroup = ep.domoticaChildProps?.outputGroup
    const socketCount = ep.type === 'socket' ? ep.socketProps?.socketCount ?? 1 : undefined

    let countedAsEndpoint = false
    if (ep.type === 'socket' && !isSocketForDomoticaParent) {
      countedAsEndpoint = true
    } else if (
      !isDomoticaParent &&
      !isJunction &&
      !isFixedOnSocketBranch &&
      groupedLoadRepresentativeIds.has(ep.id)
    ) {
      countedAsEndpoint = !isDomoticaChild || outputGroup === 'endpoint'
    }

    if (countedAsEndpoint) {
      endpointCount += 1
    }

    breakdown.push({
      id: ep.id,
      label: ep.label,
      symbol: ep.symbol,
      type: ep.type,
      isDomoticaParent,
      isDomoticaChild,
      outputGroup,
      socketCount,
      countedAsEndpoint,
    })
  }

  return { endpointCount, switchOnlyBranchCredits, rawEndpoints, breakdown }
}
