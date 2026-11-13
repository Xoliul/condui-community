import type { BottomUpLayoutResult } from './bottomUpLayout'
import { getPanelDiagramId } from './bottomUpLayout'
import type { BranchDropTargets } from './branchDropInteraction'
import { isChangeoverSwitchEndpoint } from '@/lib/eendraad/circuitPointNumbering'
import type { SymbolMetadata } from '@/lib/symbols'
import { canEditOneWireForks, canForkAfterEndpoint } from '@/lib/eendraad/oneWireForkProject'
import { checkForkSymbolPlacement } from '@/lib/eendraad/forkSymbolPlacement'
import { checkForkRunMove } from '@/lib/eendraad/forkRunMove'
import type { DropTarget } from './findDropTarget'

const SYMBOL_HALF = 15

/** Discrete fork and empty-leg slots use the exact command destination. */
export function collectSavedForkDropTargets(layout: BottomUpLayoutResult, symbol: SymbolMetadata, zoom: number, movingIds: readonly string[], result: BranchDropTargets): void {
  const moving = new Set(movingIds)
  const source = layout.panels.flatMap((panel) => panel.circuits).map((column) => column.circuit)
    .find((circuit) => circuit.endpoints.some((endpoint) => movingIds.includes(endpoint.id)))
  for (const panel of layout.panels) {
    if (panel.frameRole === 'supply') continue
    const positions = new Map(panel.elements.filter((element) => element.type === 'endpoint').map((element) => [element.endpointId!, element.position]))
    for (const branch of panel.branches) {
      const circuit = panel.circuits.find((column) => column.circuit.id === branch.circuitId)?.circuit
      if (!circuit || !canEditOneWireForks(circuit)) continue
      const stored = circuit.branches?.find((item) => branch.storedBranchId ? item.id === branch.storedBranchId :
        item.endpointIds.length === branch.endpoints.length && item.endpointIds.every((id, index) => id === branch.endpoints[index]?.id))
      // A circuit without a stored branch list is one implicit run: it can fork, but has no taps or legs yet.
      if (!stored && circuit.branches?.length) continue
      const diagramId = getPanelDiagramId(panel)
      const base = { type: 'endpoint' as const, panelId: panel.ownerPanelId ?? panel.panel.id, diagramId, circuitId: circuit.id, wireDomain: 'AC' }
      const add = (id: string, target: DropTarget, x: number, y: number, fork: boolean) => {
        const move = source && movingIds[0] ? checkForkRunMove(source, circuit, movingIds[0], movingIds, target) : null
        if (move ? !move.ok || move.noOp : !checkForkSymbolPlacement(circuit, target, symbol.id)) return
        const point = { x, y: y - (fork ? 22 / zoom : 0) }
        result.intents.push({ id, kind: fork ? 'fork' : 'insert', target, point, wirePoint: { x, y }, direction: 1, radiusPx: 10 })
        result.regions.push({ left: point.x - 14 / zoom, right: point.x + 14 / zoom, top: point.y - 14 / zoom, bottom: point.y + 14 / zoom })
        result.circuitIds.add(circuit.id)
      }
      for (let index = 0; index < branch.endpoints.length; index++) {
        const endpoint = branch.endpoints[index]!
        const position = positions.get(endpoint.id), next = positions.get(branch.endpoints[index + 1]?.id ?? '')
        if (!position || !canForkAfterEndpoint(circuit, endpoint.id, moving)) continue
        const tapX = next ? (position.x + next.x) / 2 : position.x + 15
        add(`${diagramId}/${circuit.id}/fork/${endpoint.id}`, { ...base, endpointId: endpoint.id, forkAfterEndpointId: endpoint.id }, tapX, position.y, true)
      }
      if (!stored) continue
      // Either side of a tap: before it the dropped run takes over the legs (`adoptForksOf`), after it
      // they stay. Dragging an anchor past its own tap gives its legs to the symbol before it (`releaseForkLegsOf`).
      const taps = new Map(panel.branches.filter((row) => row.circuitId === circuit.id && row.forkFrom)
        .map((row) => [row.forkFrom!.afterEndpointId, row.trunkX] as const))
      const ids = stored.endpointIds
      ids.forEach((id, index) => {
        const tapX = taps.get(id), position = positions.get(id), next = positions.get(ids[index + 1] ?? '')
        if (tapX == null || !position) return
        const beforeX = (position.x + SYMBOL_HALF + tapX) / 2, afterX = next ? (tapX + next.x - SYMBOL_HALF) / 2 : tapX + SYMBOL_HALF
        const common = { ...base, endpointId: id, forkBranchId: stored.id, branchEndpoints: [...ids], insertAfterEndpointId: id }
        add(`${diagramId}/${circuit.id}/tap-before/${id}`, { ...common, adoptForksOf: id }, beforeX, branch.branchY, false)
        add(`${diagramId}/${circuit.id}/tap-after/${id}`, common, afterX, branch.branchY, false)
        if (movingIds[0] === id) add(`${diagramId}/${circuit.id}/tap-release/${id}`, { ...common, endpointId: ids[index - 1] ?? id,
          insertAfterEndpointId: ids[index - 1] ?? null, releaseForkLegsOf: id }, afterX, branch.branchY, false)
      })
      if (stored.forkFrom || stored.keepEmpty) {
        for (let index = 0; index <= ids.length; index++) {
          if (taps.has(ids[index - 1] ?? '')) continue
          const previous = positions.get(ids[index - 1] ?? ''), next = positions.get(ids[index] ?? '')
          const x = next ? ((previous?.x ?? branch.trunkX) + next.x) / 2 : previous ? previous.x + 15 : branch.branchX + branch.branchWidth
          const target = { ...base, endpointId: previous ? ids[index - 1] : ids[0] ?? stored.forkFrom?.afterEndpointId,
            forkBranchId: stored.id, branchEndpoints: [...ids], insertAfterEndpointId: ids[index - 1] ?? null }
          add(`${diagramId}/${circuit.id}/fork-series/${stored.id}/${index}`, target, x, branch.branchY, false)
        }
      }
    }
  }
  preferForkAfterChangeoverSwitch(layout, result)
}

/**
 * A changeover switch is a two-in-one switch, so once its first output is used
 * the gap right after it means "another output": the fork slot becomes the only
 * target there. The plain series slot and the drop on the symbol body (which
 * would insert after the run or start a branch) resolve to the fork, so what the preview shows is what
 * commits. Either side of an existing tap keeps its series slots, and a
 * changeover switch at the end of its run has no fork slot, so the first drop
 * after it still continues the run.
 */
function preferForkAfterChangeoverSwitch(layout: BottomUpLayoutResult, result: BranchDropTargets): void {
  const circuits = new Map(layout.panels.flatMap((panel) => panel.circuits).map((column) => [column.circuit.id, column.circuit] as const))
  const forks = new Map<string, BranchDropTargets['intents'][number]>()
  for (const intent of result.intents) {
    const circuit = intent.target.circuitId ? circuits.get(intent.target.circuitId) : undefined
    if (intent.kind === 'fork' && circuit && isChangeoverSwitchEndpoint(circuit, intent.target.forkAfterEndpointId))
      forks.set(`${circuit.id}/${intent.target.forkAfterEndpointId}`, intent)
  }
  if (!forks.size) return
  result.intents = result.intents.flatMap((intent) => {
    const key = (id: string | null | undefined) => `${intent.target.circuitId}/${id}`
    if (intent.id.includes('/body/') && (intent.kind === 'insert' || intent.kind === 'branch')) {
      const fork = forks.get(key(intent.target.endpointId))
      if (!fork) return [intent]
      const { wireOrigin: _newBranchOrigin, ...rest } = intent
      return [{ ...rest, kind: 'fork' as const, target: fork.target }]
    }
    // The first output is taken: adding another of the same symbol right after the switch is its second output.
    if (intent.kind === 'multiply' && intent.target.endpointId) {
      const circuit = circuits.get(intent.target.circuitId ?? '')
      const run = circuit?.branches?.length
        ? circuit.branches.find((branch) => branch.endpointIds.includes(intent.target.endpointId!))?.endpointIds
        : circuit?.endpoints.map((endpoint) => endpoint.id)
      const fork = run && forks.get(key(run[run.indexOf(intent.target.endpointId) - 1]))
      if (fork) {
        const { sameSymbolTarget: _addMore, ...rest } = intent
        return [{ ...rest, kind: 'fork' as const, target: fork.target }]
      }
    }
    if (intent.kind === 'insert' && (intent.id.includes('/slot/') || intent.id.includes('/fork-series/')))
      return forks.has(key(intent.target.insertAfterEndpointId)) ? [] : [intent]
    return [intent]
  })
}

