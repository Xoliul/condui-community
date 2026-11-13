import { useState } from 'react'
import type { Point } from '@/types/ui'

export type QuickPlacerMode = 'slow' | 'fast'

export type QuickPlacerCursorHint = {
  message: string
  x: number
  y: number
  tone: 'error' | 'info'
}

export function usePlanQuickPlacerState(source?: { open: boolean; docked: boolean }) {
  const [quickPlacerFocusPlacementId, setQuickPlacerFocusPlacementId] = useState<string | null>(null)
  const open = source?.open
  const docked = source?.docked
  const [focusSource, setFocusSource] = useState({ open, docked })
  const [quickPlacerMode, setQuickPlacerMode] = useState<QuickPlacerMode>('slow')
  const [quickPlacerSelectedCircuitId, setQuickPlacerSelectedCircuitId] = useState<string | null>(
    null,
  )
  const [quickPlacerManualCircuitFocusToken, setQuickPlacerManualCircuitFocusToken] = useState(0)
  const [quickPlacerFastIndex, setQuickPlacerFastIndex] = useState(0)
  const [quickPlacerFastAutoSkipCustom, setQuickPlacerFastAutoSkipCustom] = useState(true)
  const [quickPlacerDockHost, setQuickPlacerDockHost] = useState<HTMLElement | null>(null)
  const [quickPlacerDraggedPlacementId, setQuickPlacerDraggedPlacementId] = useState<string | null>(
    null,
  )
  const [quickPlacerCursorHint, setQuickPlacerCursorHint] =
    useState<QuickPlacerCursorHint | null>(null)
  const [quickPlacerFastPreviewClient, setQuickPlacerFastPreviewClient] = useState<Point | null>(
    null,
  )
  if (focusSource.open !== open || focusSource.docked !== docked) {
    setFocusSource({ open, docked })
    // Every way of leaving the quick placer (close button, dock switch, shortcut) ends its
    // placement session, so the symbol hanging on the cursor disappears with it.
    if (source && !open && !docked) {
      setQuickPlacerFocusPlacementId(null)
      setQuickPlacerMode('slow')
      setQuickPlacerFastPreviewClient(null)
      setQuickPlacerCursorHint(null)
      setQuickPlacerDraggedPlacementId(null)
    }
  }

  return {
    quickPlacerFocusPlacementId,
    setQuickPlacerFocusPlacementId,
    quickPlacerMode,
    setQuickPlacerMode,
    quickPlacerSelectedCircuitId,
    setQuickPlacerSelectedCircuitId,
    quickPlacerManualCircuitFocusToken,
    setQuickPlacerManualCircuitFocusToken,
    quickPlacerFastIndex,
    setQuickPlacerFastIndex,
    quickPlacerFastAutoSkipCustom,
    setQuickPlacerFastAutoSkipCustom,
    quickPlacerDockHost,
    setQuickPlacerDockHost,
    quickPlacerDraggedPlacementId,
    setQuickPlacerDraggedPlacementId,
    quickPlacerCursorHint,
    setQuickPlacerCursorHint,
    quickPlacerFastPreviewClient,
    setQuickPlacerFastPreviewClient,
  }
}
