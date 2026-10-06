import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type React from 'react'

export type DialogType = 'confirm' | 'prompt' | 'info' | 'custom'

export interface DialogButton {
  label: string
  onClick: () => void
  variant?: 'primary' | 'secondary' | 'danger'
  autoFocus?: boolean
  testId?: string
}

export interface BaseDialogConfig {
  id?: string
  title: string
  titleIcon?: React.ReactNode
  /** Small secondary text shown after the title in the header. */
  titleAside?: React.ReactNode
  message?: string
  type?: DialogType
  size?: 'sm' | 'md' | 'lg' | 'xl'
  showCloseButton?: boolean
  onClose?: () => void
}

export interface ConfirmDialogConfig extends BaseDialogConfig {
  type: 'confirm'
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel?: () => void
  variant?: 'danger' | 'warning' | 'info'
}

export interface PromptDialogConfig extends BaseDialogConfig {
  type: 'prompt'
  inputLabel?: string
  inputPlaceholder?: string
  inputType?: 'text' | 'number' | 'email' | 'password'
  inputValue?: string
  inputValidator?: (value: string) => string | null // Returns error message or null
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: (value: string) => void
  onCancel?: () => void
}

export interface InfoDialogConfig extends BaseDialogConfig {
  type: 'info'
  confirmLabel?: string
  onConfirm?: () => void
  variant?: 'info' | 'success' | 'warning' | 'error'
}

export interface CustomDialogConfig extends BaseDialogConfig {
  type: 'custom'
  content: React.ReactNode
  buttons?: DialogButton[]
  /** Rendered on the left side of the custom dialog footer, below the divider. */
  footerStart?: React.ReactNode
}

export type DialogConfig =
  | ConfirmDialogConfig
  | PromptDialogConfig
  | InfoDialogConfig
  | CustomDialogConfig

interface DialogState {
  dialog: DialogConfig | null
  openDialog: (config: DialogConfig) => void
  closeDialog: () => void
}

export const selectIsAppDialogOpen = (state: DialogState) => state.dialog != null

export const useDialogStore = create<DialogState>()(
  immer((set) => ({
    dialog: null,

    openDialog: (config) =>
      set((state) => {
        state.dialog = config
      }),

    closeDialog: () =>
      set((state) => {
        state.dialog = null
      }),
  }))
)
