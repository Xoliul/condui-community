import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { logger } from '@/lib/logger'
import { useProjectStore } from '@/stores/projectStore'
import {
  overwriteServerProjectOnNextSave,
  SERVER_STORAGE_CONFLICT_EVENT,
  type ServerStorageConflictDetail,
} from './communityServerStorage'

/** Shown when another device saved the open project on the server after it was opened here. */
export default function CommunityStorageConflictDialog({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handleConflict = (event: Event) => {
      const detail = (event as CustomEvent<ServerStorageConflictDetail>).detail
      if (detail?.projectId === projectId) setOpen(true)
    }
    window.addEventListener(SERVER_STORAGE_CONFLICT_EVENT, handleConflict)
    return () => window.removeEventListener(SERVER_STORAGE_CONFLICT_EVENT, handleConflict)
  }, [projectId])

  if (!open) return null

  const keepMine = () => {
    overwriteServerProjectOnNextSave(projectId)
    setOpen(false)
    void useProjectStore
      .getState()
      .saveCurrentProject()
      .catch((error: unknown) => logger.error('Saving over the newer server version failed:', error))
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="storage-conflict-title"
        className="w-full max-w-md rounded-md bg-white p-6 shadow-2xl dark:bg-gray-800"
        data-testid="storage-conflict-dialog"
      >
        <h3 id="storage-conflict-title" className="mb-2 text-xl font-bold text-gray-900 dark:text-white">
          {t('project.serverConflict.title', { defaultValue: 'Changed on another device' })}
        </h3>
        <p className="mb-6 text-gray-600 dark:text-gray-400">
          {t('project.serverConflict.message', {
            defaultValue: 'This project was saved elsewhere after you opened it. Your latest changes here are not saved.',
          })}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={keepMine}
            className="flex-1 rounded-md border border-gray-300 px-4 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {t('project.serverConflict.overwrite', { defaultValue: 'Keep my version' })}
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex-1 rounded-md bg-sky-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-sky-700"
          >
            {t('project.serverConflict.reload', { defaultValue: 'Load latest version' })}
          </button>
        </div>
      </div>
    </div>
  )
}
