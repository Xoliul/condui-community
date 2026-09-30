import { useUIStore } from '@/stores/uiStore'
import { useProjectDocumentsStore } from '@/stores/projectDocumentsStore'

/**
 * Opens a document in the Documents canvas, keeping the current drawing visible: a single
 * canvas becomes a side-by-side split, otherwise the last viewport slot shows the documents.
 */
export function revealProjectDocument(documentId: string): void {
  useProjectDocumentsStore.getState().openDocument(documentId)
  const ui = useUIStore.getState()
  const { panels } = ui.viewportLayout
  if (panels.some((panel) => panel.canvas === 'documents')) return
  if (panels.length === 1) {
    ui.setLayoutPreset('sideBySide', { sourcePanelIndex: 0 })
    useUIStore.getState().setPanelCanvas(1, 'documents')
    return
  }
  ui.setPanelCanvas(panels.length - 1, 'documents')
}
