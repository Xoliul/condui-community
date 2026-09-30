import type { ProjectDocument } from '@/lib/documents/projectDocuments'

function dataUrlToBytes(dataUrl: string): ArrayBuffer {
  const comma = dataUrl.indexOf(',')
  const header = dataUrl.slice(0, comma)
  const payload = dataUrl.slice(comma + 1)
  if (!/;base64$/i.test(header)) return new TextEncoder().encode(decodeURIComponent(payload)).buffer
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

/** Raw document bytes without `fetch`, which the app CSP blocks for data: URLs. */
export async function readProjectDocumentBytes(document: ProjectDocument): Promise<ArrayBuffer> {
  if (document.url.startsWith('data:')) return dataUrlToBytes(document.url)
  throw new Error(`No readable source for document ${document.id}`)
}
