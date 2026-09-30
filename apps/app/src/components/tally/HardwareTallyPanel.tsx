import { useMemo, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/stores/uiStore'
import { useProjectStore } from '@/stores/projectStore'
import { buildHardwareTally, type TallyData, type TallyCategory, type TallyGroup, type TallyDetail } from '@/lib/tally/buildHardwareTally'
import { formatWireLengthMeters, type WireTranslateFn } from '@/lib/wires/wireFingerprint'
import { useDraggableFloatingWindow } from '@/hooks/useDraggableFloatingWindow'
import { DockablePanelShell } from '@/components/panels/DockablePanelShell'
import { trackGoogleAnalyticsEvent } from '@/lib/analytics/googleAnalytics'
import { focusSelectionOnCanvas } from '@/lib/ui/focusSelectionOnCanvas'
import type { Selection } from '@/types/ui'
import { useCableRouteEstimation } from '@/components/cableRouting/useCableRouteEstimation'
import { isCableRoutesEnabled } from '@/lib/cableRouting/availability'

function useTallyData(): TallyData {
  const { t } = useTranslation()
  const currentProject = useProjectStore((s) => s.currentProject)
  const cableRoutes = useCableRouteEstimation(isCableRoutesEnabled())
  const estimatedLengthByAnchor = useMemo(
    () =>
      cableRoutes
        ? new Map(
            cableRoutes.routes
              .filter((route) => route.highM > 0)
              .map((route) => [route.anchor, route.highM] as const)
          )
        : undefined,
    [cableRoutes]
  )
  return useMemo(
    () =>
      buildHardwareTally(
        currentProject,
        (key, options) => {
          if (typeof options === 'string') return t(key, options)
          if (options) return t(key, options)
          return t(key)
        },
        { estimatedLengthByAnchor }
      ),
    [currentProject, t, estimatedLengthByAnchor]
  )
}

function CategoryHeader({
  category,
  collapsed,
  onToggle,
}: {
  category: TallyCategory
  collapsed: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between gap-2 py-2 px-3 text-left font-medium bg-gray-100 dark:bg-gray-700/60 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-t-lg border-b border-gray-200 dark:border-gray-600"
    >
      <span className="text-gray-900 dark:text-gray-100">{t(category.labelKey)}</span>
      <span className="text-sm text-gray-500 dark:text-gray-400">
        {category.lengthsOnly
          ? `${category.typeCount} ${t('tally.typesCount')}`
          : `${category.totalDevices} ${t('tally.devicesCount')} · ${category.typeCount} ${t('tally.typesCount')}`}
      </span>
      <span className="text-gray-500 dark:text-gray-400" aria-hidden>
        {collapsed ? '▼' : '▲'}
      </span>
    </button>
  )
}

function DetailRow({ detail, onSelect }: { detail: TallyDetail; onSelect: (detail: TallyDetail) => void }) {
  const { t } = useTranslation()
  const canSelect = detail.selection && detail.selection.ids.length > 0
  return (
    <li className="flex items-start gap-2 py-1.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-700/50 group">
      <div className="min-w-0 flex-1">
        <div className="font-medium text-gray-800 dark:text-gray-200 truncate">{detail.label}</div>
        {(detail.panelName != null || detail.subcircuitPath != null) && (
          <div
            className="text-gray-500 dark:text-gray-400 text-[11px] mt-0.5 truncate"
            title={detail.subcircuitPath ?? detail.panelName ?? undefined}
          >
            {detail.subcircuitPath ?? detail.panelName}
          </div>
        )}
      </div>
      {canSelect && (
        <button
          type="button"
          onClick={() => onSelect(detail)}
          className="flex-shrink-0 p-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-sky-50 dark:hover:bg-sky-900/30 hover:border-sky-400 dark:hover:border-sky-600 hover:text-sky-700 dark:hover:text-sky-300 transition-colors"
          title={t('tally.selectSymbol')}
          aria-label={t('tally.selectSymbol')}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M5 12h.01M12 12h.01M19 12h.01" />
          </svg>
        </button>
      )}
    </li>
  )
}

/** A cable type and the total length to order; nothing to expand or select. */
function LengthRow({ group }: { group: TallyGroup }) {
  const { t } = useTranslation()
  return (
    <div
      className={`flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2 text-sm text-gray-800 last:border-b-0 dark:border-gray-700/80 dark:text-gray-100 ${group.hasSupply ? 'italic opacity-75' : ''}`}
      title={group.summaryLabel}
    >
      <span className="min-w-0 flex-1 truncate">{group.summaryLabel}</span>
      <span className="flex-shrink-0 font-semibold tabular-nums text-gray-700 dark:text-gray-300">
        {group.totalLengthM != null && group.totalLengthM > 0
          ? `${group.lengthIncludesEstimates ? '≈ ' : ''}${formatWireLengthMeters(group.totalLengthM, t as WireTranslateFn)}`
          : '–'}
      </span>
    </div>
  )
}

function GroupRow({
  group,
  defaultExpanded,
  onSelectDetail,
}: {
  group: TallyGroup
  defaultExpanded: boolean
  onSelectDetail: (detail: TallyDetail) => void
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const { t } = useTranslation()
  return (
    <div className="border-b border-gray-100 dark:border-gray-700/80 last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        title={group.summaryLabel}
        className={`w-full flex items-center justify-between gap-3 py-2 px-3 text-left text-sm text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-800/60 ${group.hasSupply ? 'opacity-75 italic' : ''}`}
      >
        <span className="flex items-center gap-2 min-w-0 flex-1">
          {group.hasSupply && (
            <span
              className="flex-shrink-0 text-amber-500 dark:text-amber-400"
              title={t('tally.supplyWarningTitle')}
              aria-label={t('tally.supplyWarningTitle')}
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
          )}
          <span className="truncate">{group.summaryLabel}</span>
        </span>
        <span className="flex-shrink-0 font-semibold text-gray-700 dark:text-gray-300 tabular-nums">
          {group.count}
          {group.totalLengthM != null && group.totalLengthM > 0 ? (
            <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
              · {group.lengthIncludesEstimates ? '≈ ' : ''}
              {formatWireLengthMeters(group.totalLengthM, t as WireTranslateFn)}
            </span>
          ) : null}
        </span>
        <span className="flex-shrink-0 text-gray-400" aria-hidden>
          {expanded ? '−' : '+'}
        </span>
      </button>
      {expanded && (
        <div className="pl-3 pr-2 pb-2">
          {group.specLines && group.specLines.length > 0 && (
            <div className="mb-2 ml-0.5 pl-2 border-l-2 border-sky-200 dark:border-sky-800">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                {t('tally.specOptionsHeading')}
              </div>
              <ul
                className="text-[11px] text-gray-600 dark:text-gray-300 space-y-0.5 list-none"
                aria-label={t('tally.specLinesAria')}
              >
                {group.specLines.map((line, i) => (
                  <li key={i} className="pl-0.5 break-words">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ul className="text-xs space-y-0.5 list-none">
            {group.details.map((d, i) => (
              <DetailRow key={i} detail={d} onSelect={onSelectDetail} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function ExportCsvButton({ data }: { data: TallyData }) {
  const { t } = useTranslation()
  const download = useCallback(() => {
    const totalDevices = data.reduce((sum, category) => sum + category.totalDevices, 0)
    const totalTypes = data.reduce((sum, category) => sum + category.typeCount, 0)
    trackGoogleAnalyticsEvent('hardware_tally_export_csv', {
      category_count: data.length,
      total_devices: totalDevices,
      total_types: totalTypes,
    })
    const rows: string[][] = []
    const escape = (s: string) => {
      const hasComma = /[",\n]/.test(s)
      return hasComma ? `"${s.replace(/"/g, '""')}"` : s
    }
    rows.push(
      [t('tally.csvCategory'), t('tally.csvSummary'), t('tally.csvCount'), t('tally.csvPanel'), t('tally.csvPath'), t('tally.csvDetails')].map(
        escape
      )
    )
    for (const cat of data) {
      const catLabel = t(cat.labelKey)
      for (const g of cat.groups) {
        for (const d of g.details) {
          const detailStr = d.branchOrCircuit ? `${d.label} (${d.branchOrCircuit})` : d.label
          rows.push(
            [
              catLabel,
              g.summaryLabel,
              String(g.count),
              d.panelName ?? '',
              d.subcircuitPath ?? '',
              detailStr,
            ].map(escape)
          )
        }
      }
    }
    const csv = rows.map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hardware-tally-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [data, t])
  return (
    <button
      type="button"
      onClick={download}
      className="w-full py-2.5 px-3 text-sm font-medium rounded-md bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
    >
      {t('tally.exportCsv')}
    </button>
  )
}

export function HardwareTallyPanelContent() {
  const { t } = useTranslation()
  const setSelection = useUIStore((s) => s.setSelection)
  const data = useTallyData()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const toggleCategory = useCallback((id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const handleSelectDetail = useCallback(
    (detail: TallyDetail) => {
      if (!detail.selection) return
      trackGoogleAnalyticsEvent('hardware_tally_select_item', {
        selection_type: detail.selection.type,
      })
      const nextSelection: Selection = { ...detail.selection }
      setSelection(nextSelection)
      focusSelectionOnCanvas(nextSelection, {
        preferredCanvas: detail.selection.type === 'protection' ? 'eendraad' : undefined,
      })
    },
    [setSelection]
  )

  return (
    <div className="flex h-full min-h-0 flex-col" data-no-window-drag>
      <div
        className="min-h-0 flex-1 overflow-y-auto p-2 space-y-2"
        data-tally-scroll="true"
        style={{
          WebkitOverflowScrolling: 'touch',
          overscrollBehaviorY: 'contain',
          touchAction: 'pan-y',
        }}
      >
        {data.length === 0 ? (
          <p className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400">{t('tally.empty')}</p>
        ) : (
          data.map((category) => (
            <div key={category.id} className="rounded-md border border-gray-200 dark:border-gray-600 overflow-hidden">
              <CategoryHeader
                category={category}
                collapsed={collapsed[category.id] ?? false}
                onToggle={() => toggleCategory(category.id)}
              />
              {!(collapsed[category.id] ?? false) && (
                <div className="bg-white dark:bg-gray-800">
                  {category.groups.map((group, idx) =>
                    category.lengthsOnly ? (
                      <LengthRow key={idx} group={group} />
                    ) : (
                      <GroupRow
                        key={idx}
                        group={group}
                        defaultExpanded={false}
                        onSelectDetail={handleSelectDetail}
                      />
                    )
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
      {data.length > 0 && (
        <div className="p-3 border-t border-gray-200 dark:border-gray-600 flex-shrink-0">
          <ExportCsvButton data={data} />
        </div>
      )}
    </div>
  )
}

export function HardwareTallyPanel() {
  const { t } = useTranslation()
  const close = useUIStore((s) => s.setTallyWindowOpen)
  const setLeftDockPanel = useUIStore((s) => s.setLeftDockPanel)
  const setLeftDockCollapsed = useUIStore((s) => s.setLeftDockCollapsed)
  const setLeftDockPreviewPanel = useUIStore((s) => s.setLeftDockPreviewPanel)
  const dragSeed = useUIStore((s) =>
    s.floatingPanelDragSeed?.panel === 'tally' ? s.floatingPanelDragSeed : null
  )
  const propertiesPanelVisible = useUIStore((s) => s.panels.properties.visible)
  const propertiesPanelWidth = useUIStore((s) => s.panels.properties.width)
  const propertiesPanelCollapsedWidthPx = 48
  const rightOffsetPx = propertiesPanelVisible ? propertiesPanelWidth + 16 : propertiesPanelCollapsedWidthPx + 16
  const [collapsed, setCollapsed] = useState(false)
  const { containerRef, onHeaderPointerDown, onWindowPointerDown, onResizeHandlePointerDown, windowStyle } = useDraggableFloatingWindow({
    initialTop: 56,
    initialRight: rightOffsetPx,
    initialWidth: 420,
    externalDragStart: dragSeed,
    debugName: 'tally',
    onDockLeft: () => {
      close(false)
      setLeftDockPanel('tally')
      setLeftDockCollapsed(false)
    },
    onDockPreviewChange: (active) => {
      setLeftDockPreviewPanel(active ? 'tally' : null)
    },
    minWidth: 320,
    minHeight: 240,
  })

  if (typeof document === 'undefined') return null

  return (
    createPortal(
      <DockablePanelShell
        panelId="tally"
        title={t('tally.title')}
        mode="floating"
        panelRef={containerRef}
        floatingCollapsed={collapsed}
        onFloatingCollapseToggle={() => setCollapsed((value) => !value)}
        onClose={() => close(false)}
        onHeaderPointerDown={onHeaderPointerDown}
        onWindowPointerDown={onWindowPointerDown}
        onResizeHandlePointerDown={onResizeHandlePointerDown}
        bodyClassName="overflow-hidden"
        panelStyle={{
          position: 'fixed',
          width: `min(420px, calc(100vw - ${rightOffsetPx}px - 2rem))`,
          height: collapsed ? undefined : 'min(78vh, calc(100vh - 6rem), 42rem)',
          ...windowStyle,
        }}
      >
        <HardwareTallyPanelContent />
      </DockablePanelShell>,
      document.body
    )
  )
}

export default HardwareTallyPanel
