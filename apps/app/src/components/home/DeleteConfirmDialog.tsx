import { useTranslation } from 'react-i18next'

interface DeleteConfirmDialogProps {
  isOpen: boolean
  projectName: string
  /** When the free cloud project is available again after this delete; shown once known. */
  slotAvailableAtLabel?: string | null
  purchasedProject?: boolean
  /** The account's free cloud project: warn, and offer Versions instead. */
  freeCloudProject?: boolean
  onOpenVersions?: () => void
  onConfirm: () => void
  onCancel: () => void
}

function DeleteConfirmDialog({
  isOpen,
  projectName,
  slotAvailableAtLabel,
  purchasedProject = false,
  freeCloudProject = false,
  onOpenVersions,
  onConfirm,
  onCancel,
}: DeleteConfirmDialogProps) {
  const { t } = useTranslation()

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 rounded-md shadow-2xl max-w-md w-full">
        {/* Icon */}
        <div className="p-6">
          <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 bg-red-100 dark:bg-red-900/30 rounded-full">
            <svg
              className="w-6 h-6 text-red-600 dark:text-red-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>

          {/* Content */}
          <h3 className="text-xl font-bold text-gray-900 dark:text-white text-center mb-2">
            {t('project.deleteConfirmTitle', { name: projectName })}
          </h3>
          {freeCloudProject && (
            <p
              data-testid="delete-confirm-free-project"
              className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100"
            >
              {t('project.deleteConfirmFreeProject')}
            </p>
          )}
          <p className="text-gray-600 dark:text-gray-400 text-center mb-4">
            {purchasedProject && <>{t('project.deleteConfirmPurchased')} </>}
            {t('project.deleteConfirmIrreversible')}
            {slotAvailableAtLabel && (
              <> {t('project.deleteConfirmCooldown', { date: slotAvailableAtLabel })}</>
            )}
          </p>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              data-testid="delete-confirm-cancel"
              onClick={onCancel}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {t('common.cancel')}
            </button>
            {freeCloudProject && onOpenVersions && (
              <button
                data-testid="delete-confirm-versions"
                onClick={onOpenVersions}
                className="flex-1 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-medium rounded-md transition-colors"
              >
                {t('menu.versions')}
              </button>
            )}
            <button
              data-testid="delete-confirm-submit"
              onClick={onConfirm}
              className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-md transition-colors"
            >
              {t('common.delete')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default DeleteConfirmDialog
