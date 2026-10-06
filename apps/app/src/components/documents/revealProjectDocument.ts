import { revealCanvas } from '@/lib/ui/revealCanvas'
import { useProjectDocumentsStore } from '@/stores/projectDocumentsStore'

/**
 * Opens a document in the Documents canvas, keeping the current drawing visible: a single
 * canvas becomes a side-by-side split, otherwise the last viewport slot shows the documents.
 */
export function revealProjectDocument(documentId: string): void {
  useProjectDocumentsStore.getState().openDocument(documentId)
  revealCanvas('documents')
}
