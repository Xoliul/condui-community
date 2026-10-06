import { useDialogStore, type DialogConfig } from '@/stores/dialogStore'

/**
 * Hook for easily showing dialogs throughout the application
 *
 * @example
 * const dialog = useDialog()
 *
 * // Show a confirmation dialog
 * dialog.confirm({
 *   title: 'Delete Item?',
 *   message: 'Are you sure you want to delete this item?',
 *   variant: 'danger',
 *   onConfirm: () => {
 *     // Handle deletion
 *   }
 * })
 *
 * // Show a prompt dialog
 * dialog.prompt({
 *   title: 'Enter Name',
 *   inputLabel: 'Name',
 *   inputPlaceholder: 'Enter item name',
 *   onConfirm: (value) => {
 *     // Handle the submitted value.
 *   }
 * })
 */
export function useDialog() {
  const openDialog = useDialogStore((state) => state.openDialog)
  const closeDialog = useDialogStore((state) => state.closeDialog)

  return {
    /**
     * Show a confirmation dialog
     */
    confirm: (config: {
      title: string
      message?: string
      variant?: 'danger' | 'warning' | 'info'
      confirmLabel?: string
      cancelLabel?: string
      onConfirm: () => void
      onCancel?: () => void
      onClose?: () => void
      size?: 'sm' | 'md' | 'lg' | 'xl'
    }) => {
      openDialog({
        type: 'confirm',
        ...config,
      })
    },

    /**
     * Show a prompt dialog with a single input field
     */
    prompt: (config: {
      title: string
      message?: string
      inputLabel?: string
      inputPlaceholder?: string
      inputType?: 'text' | 'number' | 'email' | 'password'
      inputValue?: string
      inputValidator?: (value: string) => string | null
      confirmLabel?: string
      cancelLabel?: string
      onConfirm: (value: string) => void
      onCancel?: () => void
      size?: 'sm' | 'md' | 'lg' | 'xl'
    }) => {
      openDialog({
        type: 'prompt',
        ...config,
      })
    },

    /**
     * Show an info dialog
     */
    info: (config: {
      title: string
      message?: string
      variant?: 'info' | 'success' | 'warning' | 'error'
      confirmLabel?: string
      onConfirm?: () => void
      size?: 'sm' | 'md' | 'lg' | 'xl'
    }) => {
      openDialog({
        type: 'info',
        ...config,
      })
    },

    /**
     * Show a custom dialog with custom content and buttons
     */
    custom: (config: {
      id?: string
      title?: string
      titleIcon?: React.ReactNode
      titleAside?: React.ReactNode
      content: React.ReactNode
      buttons?: Array<{
        label: string
        onClick: () => void
        variant?: 'primary' | 'secondary' | 'danger'
        autoFocus?: boolean
      }>
      footerStart?: React.ReactNode
      showCloseButton?: boolean
      onClose?: () => void
      size?: 'sm' | 'md' | 'lg' | 'xl'
    }) => {
      openDialog({
        ...config,
        type: 'custom',
        title: config.title ?? '',
      })
    },

    /**
     * Close the current dialog
     */
    close: closeDialog,

    /**
     * Open a dialog with full configuration (for advanced use cases)
     */
    open: (config: DialogConfig) => {
      openDialog(config)
    },
  }
}
