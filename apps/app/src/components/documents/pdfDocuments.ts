import { getPdfJs } from '@/lib/plan/pdfImport'
import type { ProjectDocument } from '@/lib/documents/projectDocuments'
import { readProjectDocumentBytes } from './documentBytes'

type PdfJs = Awaited<ReturnType<typeof getPdfJs>>
export type LoadedPdfDocument = Awaited<ReturnType<PdfJs['getDocument']>['promise']>

const loadedDocuments = new Map<string, { url: string; loading: Promise<LoadedPdfDocument> }>()

/**
 * One parsed PDF per document, shared by thumbnails and the viewer. A replaced file (or undoing
 * a replacement) changes the document's URL and reloads it.
 */
export function loadPdfDocument(document: ProjectDocument): Promise<LoadedPdfDocument> {
  const cached = loadedDocuments.get(document.id)
  if (cached?.url === document.url) return cached.loading
  if (cached) releasePdfDocument(document.id)
  const loading = (async () => {
    const [pdfjs, data] = await Promise.all([getPdfJs(), readProjectDocumentBytes(document)])
    return pdfjs.getDocument({ data }).promise
  })()
  loadedDocuments.set(document.id, { url: document.url, loading })
  loading.catch(() => {
    if (loadedDocuments.get(document.id)?.loading === loading) loadedDocuments.delete(document.id)
  })
  return loading
}

export function releasePdfDocument(documentId: string): void {
  const cached = loadedDocuments.get(documentId)
  loadedDocuments.delete(documentId)
  void cached?.loading.then((pdf) => pdf.destroy()).catch(() => undefined)
}
