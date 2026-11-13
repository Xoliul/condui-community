import { useInfoBlockHeight } from '@/hooks/eendraad/useInfoBlockHeight'
import { selectProjectWireRuns } from '@/lib/projectV2/wireRuns'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExportDialog } from './CommunityExportDialog'
import { useDialogStore } from '@/stores/dialogStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUIStore } from '@/stores/uiStore'
import { useInfoBlockLogoVisible } from '@/hooks/eendraad/useInfoBlockLogoVisible'
import {
  getCachedEendraadLayout,
  getEendraadRenderProjectRevision,
} from '@/lib/layout/eendraadDerivedLayout'
import { logger } from '@/lib/logger'
import { exportToPDF, type ExportContext, type ExportProgressCallbacks } from '@/lib/export/exportPipeline'
import { normalizeExportOptions, type ExportOptions } from '@/lib/export/types'
import { buildLayoutTree } from '@/lib/layout/layoutTree'
import { deriveWires } from '@/lib/layout/deriveWires'
import { resolveSupplyDeviceMounting } from '@/lib/panel/auxiliarySupplyEnclosures'
import { getProjectElectricalInstallation, getProjectElectricalPanels, selectProjectSupplyAssemblies } from '@/lib/projectV2/electrical'
import { queryOneWireSegments } from '@/lib/projectV2/annotations'
import { buildTimestampedExportFilename } from '@/lib/export/exportFilename'
import { reportPdfExportFailure, withCrashId } from '@/lib/export/reportPdfExportFailure'

export function useExportDialog() {
  const { t } = useTranslation()
  const currentProject = useProjectStore((state) => state.currentProject)
  const infoBlockHeight = useInfoBlockHeight()
  const infoBlockLogo = useInfoBlockLogoVisible()
  const lastExportOptions = useUIStore((state) => state.lastExportOptions)
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [currentPage, setCurrentPage] = useState<string>()

  const runExport = async (rawOptions: ExportOptions) => {
    if (!currentProject) return
    const options = normalizeExportOptions({
      ...rawOptions,
    })
    useUIStore.getState().setLastExportOptions(options)
    setIsExporting(true)
    setExportProgress(0)
    setCurrentPage(undefined)
    useUIStore.getState().setExporting(true)

    try {
      const eendraadLayout = options.includeEendraad
        ? getCachedEendraadLayout(
            getEendraadRenderProjectRevision(currentProject),
            useUIStore.getState().eendraadLayoutOverrides,
            { infoBlockLogo, infoBlockHeight }
          )
        : null
      await new Promise((resolve) => requestAnimationFrame(resolve))
      let eendraadWireSegments = queryOneWireSegments(currentProject)
      if (options.includeEendraad && eendraadLayout) {
        const tree = buildLayoutTree(eendraadLayout)
        eendraadWireSegments = deriveWires(
          tree,
          getProjectElectricalPanels(currentProject),
          getProjectElectricalInstallation(currentProject),
          selectProjectSupplyAssemblies(currentProject),
          (deviceId) => resolveSupplyDeviceMounting(currentProject, deviceId),
          selectProjectWireRuns(currentProject),
        )
      }
      const context: ExportContext = {
        project: currentProject,
        eendraadLayout,
        eendraadWireSegments,
      }
      const callbacks: ExportProgressCallbacks = {
        onProgress: setExportProgress,
        onPageChange: setCurrentPage,
      }
      const result = await exportToPDF(options, context, callbacks)
      const errorMessages = result.diagnostics
        .filter((diagnostic) => diagnostic.level === 'error')
        .map((diagnostic) => diagnostic.message)
        .join('\n')
      if (errorMessages) {
        const crashId = reportPdfExportFailure({ options, diagnostics: result.diagnostics })
        useDialogStore.getState().openDialog({
          type: 'info',
          title: t('export.error.title', 'Export Completed with Errors'),
          message: withCrashId(
            t('export.error.details', 'Export completed but some pages failed:\n{{errors}}', {
              errors: errorMessages,
            }),
            crashId
          ),
          variant: 'warning',
        })
      }
      const url = URL.createObjectURL(result.blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = buildTimestampedExportFilename(currentProject.project.name, 'pdf')
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      logger.error('Export failed:', error)
      const crashId = reportPdfExportFailure({ options, error })
      useDialogStore.getState().openDialog({
        type: 'info',
        title: t('export.error.title', 'Export Failed'),
        message: withCrashId(
          t('export.error.message', 'Failed to export PDF. Please try again.'),
          crashId
        ),
        variant: 'error',
      })
    } finally {
      setIsExporting(false)
      setExportProgress(0)
      setCurrentPage(undefined)
      useUIStore.getState().setExporting(false)
    }
  }

  const openExportDialog = () => {
    if (!currentProject) return
    useDialogStore.getState().openDialog({
      type: 'custom',
      title: t('export.dialog.title', 'Export to PDF'),
      content: (
        <ExportDialog
          onExport={async (options) => {
            useDialogStore.getState().closeDialog()
            await runExport(options)
          }}
          onCancel={() => useDialogStore.getState().closeDialog()}
        />
      ),
      size: 'lg',
    })
  }

  return {
    openExportDialog,
    reExportWithPrevious: async () => {
      if (lastExportOptions && currentProject) await runExport(lastExportOptions)
    },
    hasPreviousExport: Boolean(lastExportOptions),
    isExporting,
    exportProgress,
    currentPage,
  }
}
