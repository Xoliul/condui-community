import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Trash2 } from 'lucide-react'
import {
  clickPageSelection,
  EMPTY_PAGE_SELECTION,
  type PageSelectionState,
} from '@/lib/documents/pageSelection'
import type { ProjectDocument } from '@/lib/documents/projectDocuments'
import { PdfPageCanvas } from './PdfPageCanvas'

const THUMB_WIDTH_PX = 132

/**
 * Thumbnail overview of a multi-page PDF for removing many pages at once. Click marks or
 * unmarks a page, Shift+click marks the run from the last click, and Ctrl/Cmd+click adds
 * scattered pages. Nothing is removed until the bottom button commits the marked pages.
 */
export function PageDeleteGrid({
  document,
  aspects,
  busy,
  onCancel,
  onConfirm,
  onError,
}: {
  document: ProjectDocument
  aspects: readonly number[]
  busy: boolean
  onCancel: () => void
  onConfirm: (pages: number[]) => void
  onError: () => void
}) {
  const { t } = useTranslation()
  const [selection, setSelection] = useState<PageSelectionState>(EMPTY_PAGE_SELECTION)
  const markedCount = selection.marked.size
  // The file keeps at least one page.
  const canConfirm = markedCount > 0 && markedCount < aspects.length && !busy

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col bg-gray-100 dark:bg-gray-900"
      data-testid="document-page-delete-grid"
    >
      <div
        className="min-h-0 flex-1 overflow-y-auto p-6"
        data-app-scroll="true"
        onWheel={(event) => event.stopPropagation()}
      >
        <div className="mx-auto flex max-w-5xl flex-wrap justify-center gap-4">
          {aspects.map((aspect, index) => {
            const page = index + 1
            const marked = selection.marked.has(page)
            return (
              <button
                key={page}
                type="button"
                data-testid="document-page-delete-thumb"
                aria-pressed={marked}
                aria-label={t('projectDocuments.pageNumber', { page })}
                disabled={busy}
                onClick={(event) => {
                  // Shift+click would otherwise select page text.
                  window.getSelection()?.removeAllRanges()
                  setSelection((current) =>
                    clickPageSelection(current, page, { shift: event.shiftKey })
                  )
                }}
                className="group flex select-none flex-col items-center gap-1.5 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              >
                <span
                  className={`relative block shadow ${
                    marked ? '' : 'group-hover:ring-2 group-hover:ring-sky-400'
                  }`}
                >
                  <span className={`block transition ${marked ? 'opacity-40 grayscale' : ''}`}>
                    <PdfPageCanvas
                      document={document}
                      pageNumber={page}
                      width={THUMB_WIDTH_PX}
                      aspect={aspect}
                      onError={onError}
                    />
                  </span>
                  {marked && (
                    <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-400 shadow-sm dark:border-gray-600 dark:bg-gray-700">
                      <Trash2 className="h-5 w-5" />
                    </span>
                  )}
                </span>
                <span
                  className={`text-xs tabular-nums ${
                    marked ? 'text-gray-400 line-through' : 'text-gray-600 dark:text-gray-300'
                  }`}
                >
                  {page}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
        <button
          type="button"
          data-testid="document-page-delete-cancel"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          data-testid="document-page-delete-confirm"
          disabled={!canConfirm}
          onClick={() => onConfirm([...selection.marked].sort((a, b) => a - b))}
          className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          {t('projectDocuments.deletePagesConfirm', { count: markedCount })}
        </button>
      </div>
    </div>
  )
}
