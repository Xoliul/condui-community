import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useDialog } from '@/hooks/useDialog'
import { canRemoveProjectDocument, type ProjectDocument } from '@/lib/documents/projectDocuments'
import { getFloorPlanDocumentFloors, removeProjectDocument } from '@/stores/projectDocumentsStore'
import { useUIStore } from '@/stores/uiStore'
import { releasePdfDocument } from './pdfDocuments'

/** Asks for confirmation, then removes a user document and anything showing it. */
export function useRemoveProjectDocument(): (document: ProjectDocument) => void {
  const { t } = useTranslation()
  const dialog = useDialog()

  return useCallback(
    (document: ProjectDocument) => {
      if (!canRemoveProjectDocument(document)) return
      const floors = document.sourceKind === 'floorPlan' ? getFloorPlanDocumentFloors(document.id) : null
      dialog.confirm({
        title: t('projectDocuments.removeConfirmTitle'),
        message:
          floors && floors.length > 0
            ? t('projectDocuments.removeFloorPlanConfirmMessage', {
                name: document.name,
                floors: floors.map((floor) => floor.name || '?').join(', '),
              })
            : t('projectDocuments.removeConfirmMessage', { name: document.name }),
        variant: 'danger',
        confirmLabel: t('projectDocuments.remove'),
        onConfirm: () => {
          const { selection, clearSelection } = useUIStore.getState()
          if (selection.type === 'document' && selection.ids.includes(document.id)) clearSelection()
          removeProjectDocument(document.id)
          releasePdfDocument(document.id)
        },
      })
    },
    [dialog, t]
  )
}
