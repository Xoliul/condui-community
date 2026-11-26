import { trackGoogleAnalyticsEvent } from '@/lib/analytics/googleAnalytics'
import { CommandError, type EntityRef } from '@/lib/commands/project'
import type { DropTarget } from '@/lib/layout/findDropTarget'
import type { PanelDropPlacement } from '@/lib/commands/project/panelDropPlacement'
import { logger } from '@/lib/logger'
import { liveProjectSession } from '@/stores/liveProjectCommandSession'
import { useUIStore } from '@/stores/uiStore'
import type { Point, Selection } from '@/types/ui'
import { createUiDropBehaviorHooks } from './uiDropBehaviorHooks'

export type PlaceElectricalSymbolResult =
  | { status: 'placed'; changed: boolean; created: EntityRef[] }
  | { status: 'rejected'; message: string }
  | { status: 'blocked' }
  | { status: 'failed' }

const SELECTION_TYPES = new Set<string>(['endpoint', 'note', 'panel', 'protection', 'trunkDevice'])

/**
 * Drops a library symbol on a one-wire or panel target as one undoable `electrical.placeSymbol`
 * command, then applies the suggested selection. The caller shows `rejected` messages.
 */
export function placeElectricalSymbol(options: {
  symbolId: string
  searchPreset?: string
  target: DropTarget
  dropCanvasPosition?: Point
  panelGrid?: PanelDropPlacement
  label?: string
  ownerDocument?: Document
}): PlaceElectricalSymbolResult {
  try {
    const tapAnchor = options.target.supplyTapAnchor
    const outcome = liveProjectSession.execute(
      [
        tapAnchor && options.target.panelId
          ? {
              // A drop on a tap handle above the supply wire starts a tap instead of a device in series.
              id: 'supply.createTap',
              input: {
                ownerPanelId: options.target.panelId,
                anchor: tapAnchor,
                symbolId: options.symbolId,
                searchPreset: options.searchPreset,
              },
            }
          : {
              id: 'electrical.placeSymbol',
              input: {
                symbolId: options.symbolId,
                searchPreset: options.searchPreset,
                target: options.target,
                dropCanvasPosition: options.dropCanvasPosition,
                panelGrid: options.panelGrid,
                sitplan: createUiDropBehaviorHooks(options.ownerDocument).getSitplanTarget(),
              },
            },
      ],
      { label: options.label ?? 'drop symbol from library' }
    )
    const select = outcome.results[0]?.select ?? []
    const kind = select[0]?.kind
    if (kind && SELECTION_TYPES.has(kind)) {
      useUIStore
        .getState()
        .setSelection({
          type: kind as NonNullable<Selection['type']>,
          ids: select.map((ref) => ref.id),
        })
    }
    if (outcome.changed && kind === 'note') {
      trackGoogleAnalyticsEvent('note_place', { canvas: 'eendraad', source: 'symbol_drop' })
    }
    return {
      status: 'placed',
      changed: outcome.changed,
      created: outcome.results[0]?.created ?? [],
    }
  } catch (error) {
    if (!(error instanceof CommandError)) throw error
    if (error.details?.reason === 'drop_rejected') {
      return { status: 'rejected', message: error.message }
    }
    logger.info('[placeElectricalSymbol] not placed', {
      symbolId: options.symbolId,
      code: error.code,
      reason: error.details?.reason,
    })
    return error.details?.reason === 'protection_after_junction_panel'
      ? { status: 'blocked' }
      : { status: 'failed' }
  }
}
