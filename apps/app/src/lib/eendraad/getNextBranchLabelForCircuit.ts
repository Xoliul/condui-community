import type { Circuit } from '@/types/schema'
import { getNumberedCircuitTrunkSwitches } from '@/lib/eendraad/circuitPointNumbering'

/**
 * Next available branch label for a circuit (e.g. M1, M2), matching addEndpoint / drop naming.
 * Single source of truth for branch label sequencing.
 */
export function getNextBranchLabelForCircuit(circuit: Circuit): string {
  const branchLabels = (circuit.branches ?? [])
    .map((b) => b.label)
    .filter((l): l is string => !!l && l.trim().length > 0)

  const endpointLabels = circuit.endpoints
    .filter((e) => e.symbol !== 'panel_distribution')
    .map((e) => e.label)
    .filter((l): l is string => !!l && l.trim().length > 0)

  // Numbered trunk switches hold point numbers too.
  const trunkSwitchLabels = getNumberedCircuitTrunkSwitches(circuit)
    .map((device) => device.label)
    .filter((l): l is string => !!l && l.trim().length > 0)

  // Union both sources: preferring only branches could miss endpoint-only labels (out-of-sync data).
  const labels = [...new Set([...branchLabels, ...endpointLabels, ...trunkSwitchLabels])]

  const numbered = labels
    .map((label) => {
      const match = label.match(/^(.*?)(\d+)$/)
      if (!match) return null
      const prefix = match[1] ?? ''
      const num = parseInt(match[2] ?? '0', 10)
      if (!prefix || !Number.isFinite(num) || num <= 0) return null
      return { prefix, number: num }
    })
    .filter((x): x is { prefix: string; number: number } => x !== null)

  if (numbered.length > 0) {
    const basePrefix = numbered[0]!.prefix
    const used = new Set(numbered.filter((n) => n.prefix === basePrefix).map((n) => n.number))
    let next = 1
    while (used.has(next)) next++
    return `${basePrefix}${next}`
  }

  const circuitCode = (circuit.code ?? '').trim()
  if (circuitCode) {
    const numberPattern = new RegExp(`^${circuitCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`)
    const existingBranchNumbers = new Set(
      circuit.endpoints
        .filter((e) => e.symbol !== 'panel_distribution')
        .map((e) => {
          const match = e.label?.match(numberPattern)
          return match ? parseInt(match[1]!, 10) : 0
        })
        .filter((n) => n > 0),
    )
    let nextNumber = 1
    while (existingBranchNumbers.has(nextNumber)) {
      nextNumber++
    }
    return `${circuitCode}${nextNumber}`
  }

  const fallbackPrefix = 'B'
  const genericPattern = new RegExp(`^${fallbackPrefix}(\\d+)$`)
  const used = new Set(
    circuit.endpoints
      .filter((e) => e.symbol !== 'panel_distribution')
      .map((e) => {
        const match = e.label?.match(genericPattern)
        return match ? parseInt(match[1]!, 10) : 0
      })
      .filter((n) => n > 0),
  )
  let next = 1
  while (used.has(next)) next++
  return `${fallbackPrefix}${next}`
}
