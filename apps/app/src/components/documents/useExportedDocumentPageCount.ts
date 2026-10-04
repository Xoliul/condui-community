import { useEffect, useMemo, useState } from 'react'
import {
  getExportedDocumentPages,
  getExportedProjectDocuments,
} from '@/lib/documents/projectDocuments'
import { usePaidDocumentPageCount } from '@/components/documents/documentsHostedFeatures'
import { cableRouteIndexFor } from '@/components/cableRouting/useCableRouteEstimation'
import { buildCableSchedule } from '@/lib/cableRouting/cableSchedule'
import { getCableSchedulePdfPageCount } from '@/lib/cableRouting/cableSchedulePdf'
import { buildAddressTable } from '@/lib/controlLink/addressTable'
import { getAddressTablePdfPageCount } from '@/lib/controlLink/addressTablePdf'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { useProjectStore } from '@/stores/projectStore'
import { loadPdfDocument } from './pdfDocuments'
import { useListedProjectDocuments } from './useProjectDocuments'

type PdfPageCounts = Record<string, { url: string; pages: number }>

/**
 * Pages the documents marked for export add to a PDF: one per image, every page of a PDF or only
 * its selected pages, the pages the cable schedule and the domotica address table fill, and
 * (with `includePaid`) the pages an external influences table fills.
 * Null while PDF page counts are still being read; 0 when `enabled` is false.
 */
export function useExportedDocumentPageCount(
  enabled: boolean,
  includePaid: boolean
): number | null {
  const allDocuments = useListedProjectDocuments()
  const documents = useMemo(
    () => getExportedProjectDocuments(allDocuments, { includePaid }),
    [allDocuments, includePaid]
  )
  const pdfs = useMemo(() => documents.filter((document) => document.kind === 'pdf'), [documents])
  const [pdfPages, setPdfPages] = useState<PdfPageCounts>({})
  const paidPages = usePaidDocumentPageCount(documents, enabled)
  const project = useProjectStore((s) => s.currentProject)
  const cableScheduleExported = documents.some((document) => document.kind === 'cableSchedule')
  const cableSchedulePages = useMemo(
    () =>
      enabled && cableScheduleExported && project
        ? getCableSchedulePdfPageCount(buildCableSchedule(cableRouteIndexFor(project).routes))
        : 0,
    [cableScheduleExported, enabled, project]
  )
  const addressTableExported = documents.some((document) => document.kind === 'controlAddresses')
  const addressTablePages = useMemo(() => {
    if (!enabled || !addressTableExported || !project) return 0
    const table = buildAddressTable(getProjectElectricalPanels(project))
    return table.length > 0 ? getAddressTablePdfPageCount(table) : 0
  }, [addressTableExported, enabled, project])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    for (const document of pdfs) {
      // A replaced file has a new URL, so its old count is not reused.
      if (pdfPages[document.id]?.url === document.url) continue
      loadPdfDocument(document)
        .then((pdf) => pdf.numPages)
        .catch(() => 0)
        .then((pages) => {
          if (cancelled) return
          setPdfPages((current) => ({ ...current, [document.id]: { url: document.url, pages } }))
        })
    }
    return () => {
      cancelled = true
    }
  }, [enabled, pdfPages, pdfs])

  if (!enabled) return 0
  let total = paidPages + cableSchedulePages + addressTablePages
  for (const document of documents) {
    if (document.kind === 'image') total += 1
  }
  for (const document of pdfs) {
    const counted = pdfPages[document.id]
    if (counted?.url !== document.url) return null
    total += getExportedDocumentPages(document, counted.pages).length
  }
  return total
}
