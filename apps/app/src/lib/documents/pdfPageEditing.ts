/**
 * Removes pages from a PDF. The kept pages are copied into a new document, so objects only
 * the removed page used (images, fonts) leave the file and it actually shrinks. Document-level
 * extras that pdf-lib does not carry across page copies, such as bookmarks and form fields,
 * are dropped.
 */
export async function deletePdfPages(
  bytes: Uint8Array,
  pageNumbers: readonly number[]
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const { PDFDocument } = await import('pdf-lib')
  const source = await PDFDocument.load(bytes)
  const pageCount = source.getPageCount()
  const removed = new Set(pageNumbers)
  for (const pageNumber of removed) {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pageCount) {
      throw new RangeError(`Page ${pageNumber} is outside 1-${pageCount}`)
    }
  }
  if (removed.size >= pageCount) throw new RangeError('Cannot delete every page of a PDF')

  const target = await PDFDocument.create()
  const title = source.getTitle()
  if (title) target.setTitle(title)
  const author = source.getAuthor()
  if (author) target.setAuthor(author)
  const kept = source.getPageIndices().filter((index) => !removed.has(index + 1))
  for (const page of await target.copyPages(source, kept)) target.addPage(page)
  return { bytes: await target.save(), pageCount: kept.length }
}

export function deletePdfPage(
  bytes: Uint8Array,
  pageNumber: number
): Promise<{ bytes: Uint8Array; pageCount: number }> {
  return deletePdfPages(bytes, [pageNumber])
}
