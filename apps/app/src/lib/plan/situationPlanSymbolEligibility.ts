import { getSymbolById } from '@/lib/symbols'
import { symbolCanAppearInPanelGrid } from '@/lib/panel/panelGridSymbolEligibility'

const SITUATION_PLAN_EXCLUDED_SYMBOLS = new Set(['domotica', 'energy_meter', 'contact'])
const OPTIONAL_SITUATION_PLAN_SYMBOLS = new Set([
  'transformer',
  'rectifier',
  'inverter',
  'dc_dc_converter',
  'solar_panel',
  'battery',
  'rotating_switch',
])

export function canSymbolAppearOnSituationPlan(symbolId: string | undefined): boolean {
  if (!symbolId || SITUATION_PLAN_EXCLUDED_SYMBOLS.has(symbolId)) return false

  const symbol = getSymbolById(symbolId)
  return symbol?.scope === 'situatieplan' || symbol?.scope === 'both'
}

/** Whether absence from the situation plan is a data-integrity problem. */
export function symbolRequiresSituationPlanPlacement(symbolId: string | undefined): boolean {
  return (
    !!symbolId &&
    canSymbolAppearOnSituationPlan(symbolId) &&
    !symbolCanAppearInPanelGrid(symbolId) &&
    !OPTIONAL_SITUATION_PLAN_SYMBOLS.has(symbolId)
  )
}

/** Virtual one-wire elements: never get a plan placement or a panel module. */
export function isVirtualOneWireOnlySymbol(symbolId: string | undefined): boolean {
  return symbolId === 'contact'
}
