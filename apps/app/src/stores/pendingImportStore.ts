import { create } from 'zustand'

/**
 * Imports started from the main menu, waiting for the canvas that handles them. The menu reveals
 * the canvas first, so the request may arrive before the canvas has mounted. Session-only and
 * never persisted (it can hold File objects).
 */
type PendingImportState = {
  /** Open the floor-plan import dialog once the plan canvas is ready. */
  planImport: boolean
  /** Files to add as project documents once the documents canvas is ready. */
  documentFiles: File[] | null
  requestPlanImport: () => void
  requestDocumentFiles: (files: File[]) => void
  takePlanImport: () => boolean
  takeDocumentFiles: () => File[] | null
}

export const usePendingImportStore = create<PendingImportState>((set, get) => ({
  planImport: false,
  documentFiles: null,
  requestPlanImport: () => set({ planImport: true }),
  requestDocumentFiles: (files) => set({ documentFiles: files.length > 0 ? files : null }),
  takePlanImport: () => {
    if (!get().planImport) return false
    set({ planImport: false })
    return true
  },
  takeDocumentFiles: () => {
    const files = get().documentFiles
    if (files) set({ documentFiles: null })
    return files
  },
}))
