import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDialog } from '@/hooks/useDialog'
import { isCompressibleImageType } from '@/lib/documents/documentCompression'
import type { ProjectDocument } from '@/lib/documents/projectDocuments'
import { logger } from '@/lib/logger'
import { reduceProjectDocumentSize } from '@/stores/projectDocumentsStore'
import { ReduceSizeForm, type ReduceLevel } from './ReduceSizeForm'
import { formatBytes } from '@/utils/formatBytes'

/**
 * Every uploaded PDF and photo offers "Reduce size"; SVGs are already compact. When nothing
 * can be gained the result says so and the file is left untouched.
 */
export function canReduceProjectDocumentSize(document: ProjectDocument): boolean {
  if (document.origin !== 'upload') return false
  return document.kind === 'pdf' || isCompressibleImageType(document.mimeType)
}


/** Asks how strongly to reduce a document, then reduces it and reports the result. */
export function useReduceProjectDocumentSize(): {
  pendingId: string | null
  requestReduce: (document: ProjectDocument) => void
} {
  const { t, i18n } = useTranslation()
  const dialog = useDialog()
  const [pendingId, setPendingId] = useState<string | null>(null)

  const run = useCallback(
    (document: ProjectDocument, level: ReduceLevel) => {
      setPendingId(document.id)
      reduceProjectDocumentSize(document.id, level)
        .then(({ changed, beforeBytes, afterBytes }) =>
          dialog.info({
            title: t('projectDocuments.reduceSize'),
            message: changed
              ? t('projectDocuments.reduceSizeDone', {
                  before: formatBytes(beforeBytes, i18n.language),
                  after: formatBytes(afterBytes, i18n.language),
                })
              : t('projectDocuments.reduceSizeNoGain'),
            variant: changed ? 'success' : 'info',
          })
        )
        .catch((error) => {
          logger.warn('[documents] reduce size failed:', error)
          dialog.info({
            title: t('projectDocuments.reduceSize'),
            message: t('projectDocuments.reduceSizeFailed'),
            variant: 'error',
          })
        })
        .finally(() => setPendingId(null))
    },
    [dialog, i18n.language, t]
  )

  const levelRef = useRef<ReduceLevel>('balanced')

  const requestReduce = useCallback(
    (document: ProjectDocument) => {
      levelRef.current = 'balanced'
      dialog.custom({
        title: t('projectDocuments.reduceSize'),
        size: 'sm',
        content: (
          <ReduceSizeForm
            document={document}
            onLevelChange={(level) => {
              levelRef.current = level
            }}
          />
        ),
        buttons: [
          { label: t('common.cancel'), onClick: () => {} },
          {
            label: t('projectDocuments.reduceSize'),
            variant: 'primary',
            autoFocus: true,
            onClick: () => run(document, levelRef.current),
          },
        ],
      })
    },
    [dialog, run, t]
  )

  return { pendingId, requestReduce }
}
