/** Adds subtle page numbers to longer exports, after all pages have been assembled. */
export async function numberPdfPages(bytes: ArrayBuffer): Promise<Uint8Array<ArrayBuffer>> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const document = await PDFDocument.load(bytes)
  const pages = document.getPages()
  if (pages.length <= 2) return new Uint8Array(bytes)

  const font = await document.embedFont(StandardFonts.Helvetica)
  const total = pages.length
  const margin = (7 * 72) / 25.4
  for (const [index, page] of pages.entries()) {
    const label = `${index + 1} / ${total}`
    const size = 8
    const width = font.widthOfTextAtSize(label, size)
    page.drawText(label, {
      x: page.getWidth() - margin - width,
      y: margin,
      size,
      font,
      color: rgb(0.45, 0.45, 0.45),
    })
  }
  return new Uint8Array(await document.save())
}
