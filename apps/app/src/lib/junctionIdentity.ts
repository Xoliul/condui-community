import type { Circuit, Endpoint, SymbolKey, SymbolLabelPosition, TrunkDevice } from '@/types/schema'
import {
  getTerminalStripDisplayLabel,
  getTerminalStripId,
  normalizeTerminalStripId,
} from '@/lib/terminalStrip/labels'

export const SHARED_JUNCTION_SYMBOLS = new Set<SymbolKey>([
  'junction_box',
  'junction_panel',
  'terminal_strip',
])

type JunctionEntity = Pick<
  Endpoint | TrunkDevice,
  'symbol' | 'label' | 'junctionIdentity' | 'terminalStripPin'
>

export function isSharedJunctionSymbol(symbol: string | undefined): boolean {
  return !!symbol && SHARED_JUNCTION_SYMBOLS.has(symbol as SymbolKey)
}

/** Junction boxes are named for reuse but stay visually quiet until explicitly enabled. */
export function isJunctionIdentityVisibleByDefault(symbol: string | undefined): boolean {
  return symbol !== 'junction_box'
}

export function getJunctionIdentityLabelPosition(
  symbol: string | undefined,
  isHorizontal: boolean
): SymbolLabelPosition {
  return symbol === 'terminal_strip' && isHorizontal ? 'top' : 'right'
}

export function getJunctionIdentity(entity: JunctionEntity): string {
  if (entity.symbol === 'terminal_strip') return getTerminalStripId(entity)
  return (entity.junctionIdentity ?? entity.label ?? '').trim()
}

/** A circuit may connect to a physical junction panel only once. */
export function circuitContainsJunctionPanelIdentity(
  circuit: Circuit,
  identity: string,
  excludeId?: string,
): boolean {
  const key = identity.trim().toUpperCase()
  if (!key) return false
  const devices = [
    ...(circuit.trunkDevices ?? []),
    ...(circuit.branches ?? []).flatMap((branch) => branch.branchDevices ?? []),
    ...circuit.endpoints,
  ]
  return devices.some((device) =>
    device.id !== excludeId &&
    device.symbol === 'junction_panel' &&
    getJunctionIdentity(device).toUpperCase() === key
  )
}

export function getJunctionIdentityDisplay(
  symbol: string | undefined,
  identity: string,
  terminalStripPin?: number,
  terminalStripOutgoingPin?: number
): string {
  const value = identity.trim()
  if (symbol !== 'terminal_strip') return value
  const incoming = getTerminalStripDisplayLabel(value, terminalStripPin)
  return terminalStripOutgoingPin == null ? incoming : `${incoming}/${terminalStripOutgoingPin}`
}

export function collectJunctionIdentities(project: unknown, symbol: string): string[] {
  const identities = new Set<string>()
  const seen = new Set<object>()
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value as object)) return
    seen.add(value as object)
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    const record = value as Record<string, unknown>
    if (record.symbol === symbol) {
      const identity =
        typeof record.junctionIdentity === 'string'
          ? record.junctionIdentity
          : typeof record.label === 'string'
            ? record.label
            : ''
      const normalized =
        symbol === 'terminal_strip' ? normalizeTerminalStripId(identity) : identity.trim()
      if (normalized) identities.add(normalized)
    }
    Object.values(record).forEach(visit)
  }
  visit(project)
  return [...identities].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true })
  )
}

export function getNextJunctionIdentity(project: unknown, symbol: string): string {
  const used = new Set(
    collectJunctionIdentities(project, symbol).map((value) => value.toUpperCase())
  )
  const format = (number: number) =>
    symbol === 'terminal_strip'
      ? `${number}`
      : symbol === 'junction_panel'
        ? `JP${number}`
        : `JB${number}`
  let number = 1
  while (used.has(format(number).toUpperCase())) number += 1
  return format(number)
}
