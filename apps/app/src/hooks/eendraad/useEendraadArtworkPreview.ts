import { useState } from 'react'
import { PROTECTION_SYMBOL_IDS } from '@/lib/protectionKind'
import { isSecondaryBusPreviewTarget } from '@/lib/layout/eendraadPreviewTarget'
import { getEendraadPreviewIntentKey } from './useEendraadPreviewGraph'
import type { DragPreviewState } from './useEendraadDragPreview'

/** Stable slot artwork retains its first payload; bus and attachment previews follow the pointer. */
export function useEendraadArtworkPreview(preview: DragPreviewState | null, nodeId: string | null) {
  const key = getEendraadPreviewIntentKey(preview)
  const followsPointer = Boolean(
    preview?.movingPanelAttachment ||
      // A supply tap preview slides freely along the wire and locks only on drop.
      preview?.branchIntent?.lockPoint ||
      ((preview?.dropTarget?.type === 'mainBus' || isSecondaryBusPreviewTarget(preview?.dropTarget)) &&
        preview?.symbolData &&
        PROTECTION_SYMBOL_IDS.some((id) => id === preview.symbolData?.id))
  )
  const [cached, setCached] = useState({ key, nodeId, preview })
  if (
    cached.key !== key || cached.nodeId !== nodeId ||
    (followsPointer && cached.preview !== preview)
  ) {
    const next = { key, nodeId, preview }
    setCached(next)
    return next.preview
  }
  return cached.preview
}
