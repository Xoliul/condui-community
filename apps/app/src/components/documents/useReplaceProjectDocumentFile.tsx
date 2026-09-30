import { useCallback, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useDialog } from '@/hooks/useDialog'
import { logger } from '@/lib/logger'
import { replaceProjectDocumentFile } from '@/stores/projectDocumentsStore'

/**
 * File picker that swaps an uploaded document's file in place: links, category, and export
 * choice stay, and undo restores the previous file. Render `input` once in the owning component.
 */
export function useReplaceProjectDocumentFile(): {
  input: ReactNode
  pickReplacement: (documentId: string) => void
} {
  const { t } = useTranslation()
  const dialog = useDialog()
  const inputRef = useRef<HTMLInputElement>(null)
  const documentIdRef = useRef<string | null>(null)

  const pickReplacement = useCallback((documentId: string) => {
    documentIdRef.current = documentId
    inputRef.current?.click()
  }, [])

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,image/svg+xml"
      className="hidden"
      data-testid="project-document-replace-input"
      onChange={(event) => {
        const file = event.target.files?.[0]
        const documentId = documentIdRef.current
        event.target.value = ''
        if (!file || !documentId) return
        replaceProjectDocumentFile(documentId, file)
          .then((rejection) => {
            if (!rejection) return
            dialog.info({
              title: t('projectDocuments.replaceFile'),
              message: t(
                {
                  unsupported: 'projectDocuments.rejected',
                  tooLarge: 'projectDocuments.rejectedTooLarge',
                  overBudget: 'projectDocuments.rejectedStorageFull',
                }[rejection],
                { count: 1 }
              ),
              variant: 'warning',
            })
          })
          .catch((error) => {
            logger.error('[documents] replace failed:', error)
            dialog.info({
              title: t('projectDocuments.replaceFile'),
              message: t('projectDocuments.uploadFailed'),
              variant: 'error',
            })
          })
      }}
    />
  )

  return { input, pickReplacement }
}
