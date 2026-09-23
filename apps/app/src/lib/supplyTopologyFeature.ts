import type { SymbolMetadata } from '@/lib/symbols'

const SUPPLY_TOPOLOGY_LIBRARY_SYMBOL_IDS = new Set(['mains', 'backup_feed', 'source_changeover'])

/** Supply topology creation is a permanent part of the editor surface. */
export function isSupplyTopologyEnabled(): true {
  return true
}

export function isSupplyTopologyLibrarySymbol(symbol: Pick<SymbolMetadata, 'id'>): boolean {
  return SUPPLY_TOPOLOGY_LIBRARY_SYMBOL_IDS.has(symbol.id)
}

export function isSymbolAvailableInLibrary(symbol: SymbolMetadata): boolean {
  return !symbol.hiddenFromLibrary
}

/** Kept as a shared creation-policy boundary; supply topology is always available. */
export function canCreateSupplyTopologyFromDrop(
  _symbol: Pick<SymbolMetadata, 'id' | 'busFeedKind'>,
  _targetType: string | null
): boolean {
  return true
}
