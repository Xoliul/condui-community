import { useCallback, useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useDialogStore } from '@/stores/dialogStore'
import { APP_MODAL_BACKDROP_ATTR } from '@/lib/ui/appModalInteraction'
import { X, AlertTriangle, Info, CheckCircle, AlertCircle } from 'lucide-react'

function Dialog() {
  const { t } = useTranslation()
  const dialog = useDialogStore((state) => state.dialog)
  const closeDialog = useDialogStore((state) => state.closeDialog)
  const [promptValue, setPromptValue] = useState('')
  const [promptError, setPromptError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogOpenedAtRef = useRef(0)

  const handleClose = useCallback(() => {
    if (dialog?.onClose) {
      dialog.onClose()
    }
    closeDialog()
  }, [dialog, closeDialog])

  // Reset prompt value when dialog opens/closes
  useEffect(() => {
    if (dialog) {
      dialogOpenedAtRef.current = Date.now()
    }
    if (dialog?.type === 'prompt') {
      setPromptValue(dialog.inputValue || '')
      setPromptError(null)
      // Focus input after a short delay to ensure dialog is rendered
      setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
    }
  }, [dialog])

  // Handle Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dialog) {
        handleClose()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [dialog, handleClose])

  // Prevent body scroll when dialog is open
  useEffect(() => {
    if (dialog) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [dialog])

  if (!dialog) return null

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      // Prevent "open then instantly close" when the same pointer/click sequence
      // that triggered opening the dialog also lands on the backdrop.
      if (Date.now() - dialogOpenedAtRef.current < 180) return
      handleClose()
    }
  }

  const handlePromptConfirm = () => {
    if (dialog?.type !== 'prompt') return
    if (dialog.inputValidator) {
      const error = dialog.inputValidator(promptValue)
      if (error) {
        setPromptError(error)
        return
      }
    }
    dialog.onConfirm(promptValue)
    handleClose()
  }

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl',
  }

  const size = dialog.size || 'md'

  // Render icon based on type and variant
  const renderIcon = () => {
    if (dialog.type === 'confirm') {
      const variant = dialog.variant || 'warning'
      if (variant === 'danger') {
        return <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
      }
      if (variant === 'warning') {
        return <AlertTriangle className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
      }
      return <Info className="w-6 h-6 text-sky-600 dark:text-sky-400" />
    }
    if (dialog.type === 'info') {
      const variant = dialog.variant || 'info'
      if (variant === 'success') {
        return <CheckCircle className="w-6 h-6 text-green-600 dark:text-green-400" />
      }
      if (variant === 'error') {
        return <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
      }
      if (variant === 'warning') {
        return <AlertTriangle className="w-6 h-6 text-yellow-600 dark:text-yellow-400" />
      }
      return <Info className="w-6 h-6 text-sky-600 dark:text-sky-400" />
    }
    return null
  }

  const iconBgColor = () => {
    if (dialog.type === 'confirm') {
      const variant = dialog.variant || 'warning'
      if (variant === 'danger') {
        return 'bg-red-100 dark:bg-red-900/30'
      }
      if (variant === 'warning') {
        return 'bg-yellow-100 dark:bg-yellow-900/30'
      }
      return 'bg-sky-100 dark:bg-sky-900/30'
    }
    if (dialog.type === 'info') {
      const variant = dialog.variant || 'info'
      if (variant === 'success') {
        return 'bg-green-100 dark:bg-green-900/30'
      }
      if (variant === 'error') {
        return 'bg-red-100 dark:bg-red-900/30'
      }
      if (variant === 'warning') {
        return 'bg-yellow-100 dark:bg-yellow-900/30'
      }
      return 'bg-sky-100 dark:bg-sky-900/30'
    }
    return 'bg-gray-100 dark:bg-gray-700'
  }

  const titleIcon = dialog.type === 'custom' ? dialog.titleIcon : renderIcon()
  const titleIconBackground =
    dialog.type === 'custom' && dialog.titleIcon
      ? 'bg-sky-100 text-sky-600 dark:bg-sky-900/30 dark:text-sky-400'
      : iconBgColor()

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      {...{ [APP_MODAL_BACKDROP_ATTR]: 'true' }}
      className="fixed inset-0 z-[1100] flex items-stretch justify-center bg-black/50 p-2 backdrop-blur-sm transition-opacity duration-200 sm:items-center sm:p-4"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={handleBackdropClick}
    >
      <div
        data-testid="app-dialog-panel"
        className={`flex min-h-0 w-full ${sizeClasses[size]} max-h-[calc(100dvh-1rem)] flex-col overflow-hidden rounded-md bg-white shadow-2xl transition-all duration-200 dark:bg-gray-800 sm:max-h-[95dvh]`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        {(dialog.title || dialog.showCloseButton !== false) && (
          <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700 sm:px-6 sm:py-4">
            <div className="flex min-w-0 items-center gap-3">
              {titleIcon && (
                <div
                  className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${titleIconBackground}`}
                >
                  {titleIcon}
                </div>
              )}
              {dialog.title && (
                <h2 className="min-w-0 truncate text-lg font-bold text-gray-900 dark:text-white sm:text-xl">
                  {dialog.title}
                </h2>
              )}
            </div>
            {dialog.showCloseButton !== false && (
              <button
                onClick={handleClose}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                aria-label={t('common.close')}
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}

        {/* Content */}
        {(dialog.type === 'custom' || dialog.type === 'prompt' || !!dialog.message) && (
          <div
            data-export-scroll={dialog.id === 'label-strip-export' ? 'true' : undefined}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-6 sm:py-4"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {dialog.type === 'custom' ? (
              dialog.content
            ) : (
              <>
                {dialog.message && (
                  <p className="text-gray-600 dark:text-gray-400 whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {dialog.message}
                  </p>
                )}

                {dialog.type === 'prompt' && (
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {dialog.inputLabel || t('dialog.inputLabel')}
                    </label>
                    <input
                      ref={inputRef}
                      type={dialog.inputType || 'text'}
                      value={promptValue}
                      onChange={(e) => {
                        setPromptValue(e.target.value)
                        if (promptError && dialog.inputValidator) {
                          const error = dialog.inputValidator(e.target.value)
                          setPromptError(error)
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          handlePromptConfirm()
                        }
                      }}
                      onBlur={() => {
                        if (dialog.inputValidator) {
                          const error = dialog.inputValidator(promptValue)
                          setPromptError(error)
                        }
                      }}
                      placeholder={dialog.inputPlaceholder}
                      className={`w-full px-4 py-2 border rounded-md focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white ${
                        promptError
                          ? 'border-red-500 dark:border-red-500'
                          : 'border-gray-300 dark:border-gray-600'
                      }`}
                    />
                    {promptError && (
                      <p className="mt-1 text-sm text-red-600 dark:text-red-400">{promptError}</p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Footer / Actions */}
        {dialog.type !== 'custom' || dialog.buttons || dialog.footerStart ? (
          <div className="flex-shrink-0 border-t border-gray-200 px-4 py-3 dark:border-gray-700 sm:px-6 sm:py-4">
            {dialog.type === 'custom' && dialog.buttons ? (
              <div className="flex items-center justify-between gap-3">
                {dialog.footerStart ? (
                  <div className="min-w-0 flex-1">{dialog.footerStart}</div>
                ) : null}
                <div
                  className={`flex min-w-0 flex-wrap justify-end gap-2 sm:gap-3 ${
                    dialog.footerStart ? '' : 'ml-auto'
                  }`}
                >
                  {dialog.buttons.map((button, index) => (
                    <button
                      key={index}
                      data-testid={button.testId}
                      onClick={() => {
                        button.onClick()
                        if (!dialog.onClose) {
                          closeDialog()
                        }
                      }}
                      autoFocus={button.autoFocus}
                      className={`max-w-full whitespace-normal rounded-md px-4 py-2 text-center font-medium transition-colors ${
                        button.variant === 'danger'
                          ? 'bg-red-600 hover:bg-red-700 text-white'
                          : button.variant === 'primary'
                            ? 'bg-sky-600 hover:bg-sky-700 text-white'
                            : 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      {button.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : dialog.type === 'confirm' ? (
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-3">
                <button
                  onClick={() => {
                    if (dialog.onCancel) {
                      dialog.onCancel()
                    }
                    handleClose()
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  {dialog.cancelLabel || t('common.cancel')}
                </button>
                <button
                  autoFocus
                  onClick={() => {
                    dialog.onConfirm()
                    handleClose()
                  }}
                  className={`flex-1 px-4 py-2 font-medium rounded-md transition-colors ${
                    dialog.variant === 'danger'
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : 'bg-sky-600 hover:bg-sky-700 text-white'
                  }`}
                >
                  {dialog.confirmLabel || t('common.confirm')}
                </button>
              </div>
            ) : dialog.type === 'prompt' ? (
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-3">
                <button
                  onClick={() => {
                    if (dialog.onCancel) {
                      dialog.onCancel()
                    }
                    handleClose()
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  {dialog.cancelLabel || t('common.cancel')}
                </button>
                <button
                  onClick={handlePromptConfirm}
                  disabled={!!promptError || (dialog.inputValidator && !promptValue.trim())}
                  className="flex-1 px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium rounded-md transition-colors"
                >
                  {dialog.confirmLabel || t('common.confirm')}
                </button>
              </div>
            ) : dialog.type === 'info' ? (
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    if (dialog.onConfirm) {
                      dialog.onConfirm()
                    }
                    handleClose()
                  }}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-medium rounded-md transition-colors"
                >
                  {dialog.confirmLabel || t('common.ok')}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  )
}

export default Dialog
