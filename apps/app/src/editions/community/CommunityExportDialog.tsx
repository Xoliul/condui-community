import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import CustomDropdown from '@/components/common/CustomDropdown'
import { useEendraadLayout } from '@/hooks/eendraad/useEendraadLayout'
import { useProjectStore } from '@/stores/projectStore'
import { calculatePageCounts, type PageCountSummary } from '@/lib/export/calculatePageCount'
import type { ExportOptions, ExportTheme } from '@/lib/export/types'
import { useEffectiveInstallerProfile } from '@/hooks/useEffectiveInstallerProfile'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { countElectricalPanels } from '@/lib/export/exportPlan'
import { hasDuplicateSitplanEndpointLabels } from '@/lib/export/sitplanExportPlan'
import { PanelIcon, SitplanIcon } from '@/components/viewport/CanvasIcons'
import { AlertTriangle } from 'lucide-react'
/* @project-documents-strip-start */
import { useExportedDocumentPageCount } from '@/components/documents/useExportedDocumentPageCount'
import { useListedProjectDocuments } from '@/components/documents/useProjectDocuments'
import { isProjectDocumentsEnabled } from '@/lib/documents/availability'
import { getExportedProjectDocuments } from '@/lib/documents/projectDocuments'
/* @project-documents-strip-end */

interface CommunityExportDialogProps {
  onExport: (options: ExportOptions) => void
  onCancel: () => void
}

export function ExportDialog({ onExport, onCancel }: CommunityExportDialogProps) {
  const { t } = useTranslation()
  const currentProject = useProjectStore((state) => state.currentProject)
  const { profile: effectiveInstallerProfile } = useEffectiveInstallerProfile(
    currentProject ?? null
  )
  const hasSignature = Boolean(effectiveInstallerProfile?.signatureDataUrl)
  const getFramesByPanel = useProjectStore((state) => state.getFramesByPanel)
  const layout = useEendraadLayout()
  const [includeEendraad, setIncludeEendraad] = useState(true)
  const [includePanel, setIncludePanel] = useState(true)
  const [includeSitplan, setIncludeSitplan] = useState(true)
  const [includeInstallDates, setIncludeInstallDates] = useState(false)
  const [includeSignature, setIncludeSignature] = useState(true)
  const [mergePlanPages, setMergePlanPages] = useState(false)
  const [theme, setTheme] = useState<ExportTheme>('light')
  const hasMultiplePanels = Boolean(
    currentProject && countElectricalPanels(getProjectElectricalPanels(currentProject)) > 1
  )
  const hasDuplicatePlanLabels = Boolean(
    hasMultiplePanels && currentProject && hasDuplicateSitplanEndpointLabels(currentProject)
  )

  const options = useMemo<ExportOptions>(
    () => ({
      includeEendraad,
      includePanel,
      includeSitplan,
      mergePlanPages: hasMultiplePanels && mergePlanPages,
      includeInstallDates: includeEendraad && includeInstallDates,
      includeSignature: hasSignature ? includeSignature : false,
      
      theme,
    }),
    [
      hasSignature,
      includeEendraad,
      includeInstallDates,
      includePanel,
      includeSignature,
      includeSitplan,
      mergePlanPages,
      hasMultiplePanels,
      theme,
    ]
  )

  const pageCounts = useMemo<PageCountSummary>(() => {
    if (!currentProject) return { eendraad: 0, panel: 0, sitplan: 0, total: 0 }
    return calculatePageCounts(options, currentProject, layout, getFramesByPanel)
  }, [currentProject, getFramesByPanel, layout, options])
  const canExport = pageCounts.total > 0
  let documentsAvailable = false
  let documentsSelected = false
  /** Pages attached documents add; null while PDF page counts load. */
  let documentPageCount: number | null = 0
  let toggleDocuments = () => {}
  /* @project-documents-strip-start */
  // The build flag is fixed per build, so these hooks are either always or never called.
  const [includeDocuments, setIncludeDocuments] = useState(true)
  const listedDocuments = useListedProjectDocuments()
  documentsAvailable =
    isProjectDocumentsEnabled() && getExportedProjectDocuments(listedDocuments).length > 0
  documentsSelected = documentsAvailable && includeDocuments
  documentPageCount = useExportedDocumentPageCount(documentsSelected, false)
  toggleDocuments = () => setIncludeDocuments((value) => !value)
  /* @project-documents-strip-end */

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-3 text-sm font-medium text-gray-900 dark:text-gray-100">
          {t('export.dialog.selectCanvases', 'Select canvases to export')}
        </h3>
        <div className="space-y-2">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={includeEendraad}
              onChange={(event) => setIncludeEendraad(event.target.checked)}
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {t('export.dialog.eendraad', 'One-wire diagram')}
            </span>
          </label>
          <label
            className={`ml-6 flex items-center gap-2 ${includeEendraad ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
          >
            <input
              type="checkbox"
              checked={includeEendraad && includeInstallDates}
              disabled={!includeEendraad}
              onChange={(event) => setIncludeInstallDates(event.target.checked)}
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {t('export.dialog.installDates', 'Include install dates')}
            </span>
          </label>
          {hasSignature ? (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={includeSignature}
                onChange={(event) => setIncludeSignature(event.target.checked)}
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {t('export.dialog.includeSignature', 'Include signature')}
              </span>
            </label>
          ) : null}
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={includePanel}
              onChange={(event) => setIncludePanel(event.target.checked)}
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {t('export.dialog.panel', 'Panel (Cabinet view)')}
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={includeSitplan}
              onChange={(event) => setIncludeSitplan(event.target.checked)}
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {t('export.dialog.sitplan', 'Sitplan (Floor plan)')}
            </span>
          </label>
          {documentsAvailable ? (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                data-testid="export-documents-toggle"
                checked={documentsSelected}
                onChange={toggleDocuments}
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {t('projectDocuments.exportTile')}
              </span>
            </label>
          ) : null}
        </div>
      </div>

      <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
        {hasMultiplePanels ? (
          <button
            type="button"
            aria-pressed={includeSitplan && mergePlanPages}
            disabled={!includeSitplan}
            onClick={() => setMergePlanPages((value) => !value)}
            className={`mb-3 flex w-full min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:cursor-not-allowed disabled:opacity-40 ${
              includeSitplan && mergePlanPages
                ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
                : 'border-gray-300 bg-white text-gray-700 hover:border-sky-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
              <PanelIcon className="h-6 w-6" />
              <SitplanIcon className="-ml-1 h-6 w-6" />
            </span>
            <span className="min-w-0 flex-1 text-sm font-medium">
              {t('export.dialog.mergePlanPages', 'Merge plan pages')}
            </span>
            {includeSitplan && mergePlanPages && hasDuplicatePlanLabels ? (
              <span
                className="inline-flex shrink-0 items-center text-amber-600 dark:text-amber-400"
                title={t(
                  'export.dialog.mergePlanPagesWarning',
                  'Duplicate labels detected; merged pages may be confusing.'
                )}
                aria-label={t(
                  'export.dialog.mergePlanPagesWarning',
                  'Duplicate labels detected; merged pages may be confusing.'
                )}
              >
                <AlertTriangle className="h-5 w-5" aria-hidden />
              </span>
            ) : null}
          </button>
        ) : null}
        <h4 className="mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">
          {t('export.dialog.theme', 'Export theme')}
        </h4>
        <CustomDropdown
          value={theme}
          onChange={(value) => setTheme(value as ExportTheme)}
          options={[
            { value: 'light', label: t('export.dialog.themeLight', 'Light (default)') },
            { value: 'dark', label: t('export.dialog.themeDark', 'Dark') },
          ]}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>

      <div className="border-t border-gray-200 pt-3 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">
        <div>
          {documentPageCount === null
            ? '…'
            : t('export.dialog.totalPages', 'Total: {{count}} pages', {
                count: pageCounts.total + documentPageCount,
              })}
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <button
          onClick={onCancel}
          className="flex-1 rounded-md border border-gray-300 px-4 py-2 font-medium text-gray-700 dark:border-gray-600 dark:text-gray-300"
        >
          {t('export.dialog.cancelButton', 'Cancel')}
        </button>
        <button
          onClick={() =>
            canExport &&
            onExport(documentsSelected ? { ...options, includeDocuments: true } : options)
          }
          disabled={!canExport}
          data-testid="e2e-export-pdf-submit"
          className="flex-1 rounded-md bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {t('export.dialog.exportButton', 'Export')}
        </button>
      </div>
    </div>
  )
}
