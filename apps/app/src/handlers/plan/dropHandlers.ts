import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import { createUiDropBehaviorHooks } from '@/handlers/eendraad/uiDropBehaviorHooks'
import { getEndpointTypeFromSymbol } from '@/utils'
import type { SymbolMetadata } from '@/lib/symbols'
import type { Point, Selection } from '@/types/ui'
import { trackSymbolPlace } from '@/lib/analytics/editorEventAnalytics'
import type { PlanDropCircuitChoice, PlanDropKind } from '@/lib/plan/planDropPicker'
import { endpointTypeToPlanDropKind } from '@/lib/plan/planDropPicker'

export interface CommitPlanSymbolDropParams {
  symbol: SymbolMetadata
  position: Point
  floorId: string
  floorLayer: string
  panelId: string
  circuitChoice: PlanDropCircuitChoice
  setSelection: (selection: Selection) => void
}

export type CreateEmptyCircuitOnPanelOptions = {
  /** Legacy MCB label; leave empty so circuit code sync sets the protection label after first endpoint. */
  protectionLabel?: string
  /** Stored on `Circuit.notes` (optional description). */
  circuitNotes?: string
}

/**
 * Add a new MCB + empty circuit on a panel (same defaults as plan drop “new circuit”), as one
 * `circuit.createEmpty` command. Returns the new circuit id.
 */
export function createEmptyCircuitOnPanel(
  panelId: string,
  dropKind: PlanDropKind,
  options?: CreateEmptyCircuitOnPanelOptions | string
): string | null {
  const normalized: CreateEmptyCircuitOnPanelOptions =
    typeof options === 'string' ? { protectionLabel: options } : (options ?? {})
  const outcome = runProjectCommand('circuit.createEmpty', {
    panelId,
    kind: dropKind,
    ...normalized,
  })
  return outcome?.results[0]?.created[0]?.id ?? null
}

/**
 * Place symbol on the plan and assign to a circuit, as one `plan.placeSymbol` command. Selects
 * the new placement on the situation plan.
 */
export function commitPlanSymbolDrop(
  params: CommitPlanSymbolDropParams
): { endpointId: string; placementId: string; circuitId: string; panelId: string } | null {
  const { symbol, position, floorId, floorLayer, panelId, circuitChoice, setSelection } = params
  const endpointType = getEndpointTypeFromSymbol(symbol)
  if (!endpointType) return null

  const sitplanTarget = createUiDropBehaviorHooks().getSitplanTarget()
  const outcome = runProjectCommand('plan.placeSymbol', {
    symbolId: symbol.id,
    searchPreset: symbol.searchPreset,
    floorId,
    floorLayer,
    pos: position,
    panelId,
    circuit: circuitChoice,
    viewportCenter: sitplanTarget.activeFloorId === floorId ? sitplanTarget.viewportCenter : null,
  })
  const result = outcome?.results[0]
  const placementId = result?.select?.[0]?.id
  const endpointId = result?.created.find((ref) => ref.kind === 'endpoint')?.id
  const circuitId = result?.related?.find((ref) => ref.kind === 'circuit')?.id
  if (!placementId || !endpointId || !circuitId) return null

  setSelection({ type: 'placement', ids: [placementId] })
  trackSymbolPlace({
    canvas: 'plan',
    symbol,
    placementMethod: 'library_drop',
    endpointType,
    dropKind: endpointTypeToPlanDropKind(endpointType),
    assignmentMode: circuitChoice.mode,
  })
  return { endpointId, placementId, circuitId, panelId }
}
