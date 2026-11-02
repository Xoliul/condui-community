/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useRef, useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/stores/uiStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'
import { useThemeColors } from '@/lib/theme/hooks'
import CustomDropdown from '@/components/common/CustomDropdown'
import {
  MIN_SYMBOL_SIZE_CM,
  MAX_SYMBOL_SIZE_CM,
  DEFAULT_SYMBOL_SIZE_CM,
} from '@/constants/planConstants'
import type { PlanVisibilityState } from '@/types/ui'
import type { PlanWiringVisibility } from '@/types/schema'
import { resolvePlanWiringVisibility } from '@/lib/plan/planWiring'
import { selectProjectPlanWiringProjection } from '@/lib/projectV2/planWiring'
import { selectProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { getPanelDisplayName } from '@/utils/panelNames'
import { clamp } from '@/lib/geometry'
import { openHiddenSituationPlanDialogForFloor } from '@/components/plan/openHiddenSituationPlanDialog'
import { isCableRoutesEnabled } from '@/lib/cableRouting/availability'
import { PlanWireStyleButtons } from '@/components/cableRouting/PlanWireStyleButtons'
import { planCategoryColor } from '@/lib/plan/planColors'
import { PLAN_WIRE_CATEGORIES } from '@/lib/cableRouting/planWireCategoryVisibility'

import {
  getSymbolCategory,
  SITPLAN_CATEGORY_VISIBILITY_KEYS,
  type SitplanSymbolCategory,
} from '@/lib/plan/symbolCategories'
export { getSymbolCategory, type SitplanSymbolCategory } from '@/lib/plan/symbolCategories'
function EyeIcon({
  className,
  colors,
}: {
  className?: string
  colors: ReturnType<typeof useThemeColors>
}) {
  const fill = colors.gray700
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke={fill}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function VisibilitySection({
  label,
  checked,
  onChange,
  disabled = false,
  children,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()
  return (
    <div className="mt-2 rounded-md border border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 px-2.5 text-gray-800 dark:text-gray-200">
        <input
          type="checkbox"
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.checked)
            setExpanded(event.target.checked)
          }}
          className="shrink-0 rounded border-gray-400"
        />
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 py-2 text-left text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500"
        >
          <span>{label}</span>
          <ChevronDown
            className={`h-4 w-4 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>
      </div>
      <div id={contentId} hidden={!expanded} className="px-2.5 pb-2">
        {children}
      </div>
    </div>
  )
}

const defaultVisibility: PlanVisibilityState = {
  allVisible: true,
  groundPlansVisible: true,
  groundPlansOpacity: 100,
  labelsVisible: true,
  symbolsVisible: true,
  symbolSizeCm: DEFAULT_SYMBOL_SIZE_CM,
  socketsVisible: true,
  lightsVisible: true,
  switchesVisible: true,
  panelsVisible: true,
  fixedAppliancesVisible: true,
  dcVisible: true,
  energyConversionVisible: true,
  earthingVisible: true,
  otherVisible: true,
}

export default function SitplanVisibilityPanel({
  readOnly = false,
  wireToolActive = false,
}: {
  readOnly?: boolean
  wireToolActive?: boolean
}) {
  const { t } = useTranslation()
  const pickerId = useId()
  const pickerGesture = useRef(0)
  const theme = useSettingsStore((state) => state.theme)
  const planVisibility = useUIStore((s) => s.planVisibility)
  const setPlanVisibility = useUIStore((s) => s.setPlanVisibility)
  const setHover = useUIStore((s) => s.setHover)
  const clearHover = useUIStore((s) => s.clearHover)
  const activeFloorId = useUIStore((s) => s.activeFloorId)
  const sitplanPanelFilterId = useUIStore((s) => s.sitplanPanelFilterId)
  const setSitplanPanelFilterId = useUIStore((s) => s.setSitplanPanelFilterId)
  const syncSitplanFilterWithPanelView = useUIStore((s) => s.syncSitplanFilterWithPanelView)
  const panelIsInLayout = useUIStore((s) =>
    s.viewportLayout.panels.some((p) => p.canvas === 'panel')
  )
  const getPlacementsByFloor = useProjectStore((s: ProjectState) => s.getPlacementsByFloor)
  const getEndpointById = useProjectStore((s: ProjectState) => s.getEndpointById)
  const getTrunkDeviceById = useProjectStore((s: ProjectState) => s.getTrunkDeviceById)
  const currentProject = useProjectStore((s: ProjectState) => s.currentProject)
  const getFloorById = useProjectStore((s: ProjectState) => s.getFloorById)
  const planWiring = useMemo(
    () => (currentProject ? selectProjectPlanWiringProjection(currentProject) : undefined),
    [currentProject]
  )
  const planWiringVisibility = useMemo(() => resolvePlanWiringVisibility(planWiring), [planWiring])
  const useWireToolVisibility = wireToolActive && isCableRoutesEnabled()
  const wiresVisible = useWireToolVisibility
    ? planWiringVisibility.wireToolWiresVisible !== false
    : planWiringVisibility.wiresVisible
  const setPlanWiringVisibility = useCallback(
    (updates: Partial<PlanWiringVisibility>) => {
      if (readOnly) return
      runProjectCommand('plan.setWiringVisibility', updates, {
        label: 'change plan wire visibility',
      })
    },
    [readOnly]
  )

  const masterCheckRef = useRef<HTMLInputElement>(null)
  const colors = useThemeColors()
  const isDark = theme.mode === 'dark'

  // The store getters are stable and read state at call time, so key these memos on the
  // subscribed project to recompute after placement or floor edits.
  const placements = useMemo(() => {
    if (!activeFloorId || !currentProject) return []
    return getPlacementsByFloor(activeFloorId)
  }, [activeFloorId, currentProject, getPlacementsByFloor])
  const activeFloor = useMemo(
    () => (activeFloorId && currentProject ? getFloorById(activeFloorId) : undefined),
    [activeFloorId, currentProject, getFloorById]
  )
  const groundPlanOpacity = activeFloor?.planImageOpacity ?? planVisibility.groundPlansOpacity
  const symbolSizeCm =
    activeFloor?.sitplanSymbolSizeCm ?? planVisibility.symbolSizeCm ?? DEFAULT_SYMBOL_SIZE_CM

  /** Keep endpoint hover links and add the physical placements of other symbol owners. */
  const hoverByCategory = useMemo(() => {
    const map = new Map<SitplanSymbolCategory, { endpointIds: string[]; placementIds: string[] }>()
    const cats: SitplanSymbolCategory[] = [
      'sockets',
      'lights',
      'switches',
      'panels',
      'fixedAppliances',
      'dc',
      'energyConversion',
      'earthing',
      'other',
    ]
    cats.forEach((category) => map.set(category, { endpointIds: [], placementIds: [] }))
    placements.forEach((placement) => {
      const endpoint = placement.endpointId ? getEndpointById(placement.endpointId) : undefined
      const trunkDevice = placement.trunkDeviceId
        ? getTrunkDeviceById(placement.trunkDeviceId)?.device
        : undefined
      const symbol = placement.isEarthing
        ? 'earthing'
        : placement.junctionPanelLabel != null
          ? 'junction_panel'
          : placement.enclosureId != null
            ? 'panel_distribution'
            : (endpoint?.symbol ?? trunkDevice?.symbol)
      const category = symbol ? getSymbolCategory(symbol) : null
      if (!category) return
      const preview = map.get(category)!
      if (endpoint) preview.endpointIds.push(endpoint.id)
      else preview.placementIds.push(placement.id)
    })
    return map
  }, [placements, getEndpointById, getTrunkDeviceById])

  const handleHoverCategory = useCallback(
    (category: SitplanSymbolCategory | null) => {
      if (!category) {
        clearHover()
        return
      }
      const preview = hoverByCategory.get(category)
      setHover({
        type: 'endpoint',
        ids: [...new Set(preview?.endpointIds ?? [])],
        ...(preview?.placementIds.length ? { planPlacementIds: preview.placementIds } : {}),
      })
    },
    [hoverByCategory, setHover, clearHover]
  )

  const setAll = useCallback(
    (on: boolean) => {
      setPlanVisibility({
        allVisible: on,
        groundPlansVisible: on,
        labelsVisible: on,
        symbolsVisible: on,
        socketsVisible: on,
        lightsVisible: on,
        switchesVisible: on,
        panelsVisible: on,
        fixedAppliancesVisible: on,
        dcVisible: on,
        energyConversionVisible: on,
        earthingVisible: on,
        otherVisible: on,
      })
      setPlanWiringVisibility(
        useWireToolVisibility
          ? { wireToolWiresVisible: on, wireToolCategoriesVisible: {} }
          : { wiresVisible: on, lightingVisible: on, socketsVisible: on, otherVisible: on }
      )
    },
    [setPlanVisibility, setPlanWiringVisibility, useWireToolVisibility]
  )

  const allChecked =
    planVisibility.allVisible &&
    planVisibility.groundPlansVisible &&
    planVisibility.labelsVisible &&
    planVisibility.symbolsVisible &&
    wiresVisible

  const someChecked =
    planVisibility.groundPlansVisible ||
    planVisibility.labelsVisible ||
    planVisibility.symbolsVisible ||
    wiresVisible

  useEffect(() => {
    const el = masterCheckRef.current
    if (!el) return
    el.indeterminate = !allChecked && someChecked
  }, [allChecked, someChecked])

  const handleMasterChange = () => {
    const next = !allChecked
    setAll(next)
    if (!next) {
      setPlanVisibility({ groundPlansOpacity: 100 })
      if (!readOnly && activeFloorId) {
        runProjectCommand('plan.transformBackground', { floorId: activeFloorId, opacity: 100 })
      }
    }
  }

  const symbolsDisabled = !planVisibility.symbolsVisible
  const wiresDisabled = !wiresVisible
  // Reuse same labels as symbol library categories / symbol names
  const subSymbolKeys: { key: SitplanSymbolCategory; labelKey: string }[] = [
    { key: 'sockets', labelKey: 'symbols.categories.outlets' },
    { key: 'lights', labelKey: 'symbols.categories.lighting' },
    { key: 'switches', labelKey: 'symbols.categories.switches' },
    { key: 'panels', labelKey: 'symbols.panel_distribution' },
    { key: 'fixedAppliances', labelKey: 'symbols.categories.appliances' },
    { key: 'dc', labelKey: 'wireLegend.dc' },
    { key: 'energyConversion', labelKey: 'symbols.categories.energyConversion' },
    { key: 'earthing', labelKey: 'wireLegend.earthing' },
    { key: 'other', labelKey: 'wireLegend.other' },
  ]

  const bg = isDark ? 'bg-gray-800 border-gray-600' : 'bg-white border-gray-200'
  const text = isDark ? 'text-gray-200' : 'text-gray-800'
  const muted = isDark ? 'text-gray-400' : 'text-gray-500'
  const hoverBg = isDark ? 'hover:bg-gray-700' : 'hover:bg-gray-100'

  const panels = useMemo(
    () => (currentProject ? selectProjectElectricalPanels(currentProject) : []),
    [currentProject]
  )

  const hiddenItemCount = useMemo(
    () => activeFloor?.hiddenSitplanPlacementIds?.length ?? 0,
    [activeFloor]
  )

  const flattenedPanels: Array<{ id: string; name: string }> = useMemo(() => {
    function flattenPanels(
      localPanels: typeof panels,
      prefix = ''
    ): Array<{ id: string; name: string }> {
      const out: Array<{ id: string; name: string }> = []
      for (const p of localPanels) {
        const display = getPanelDisplayName(p, currentProject)
        const name = prefix ? `${prefix} / ${display}` : display
        out.push({ id: p.id, name })
        if (p.subPanels?.length) out.push(...flattenPanels(p.subPanels, name))
      }
      return out
    }
    return flattenPanels(panels)
  }, [panels, currentProject])

  return (
    <div
      className={`flex flex-col rounded-md border shadow-lg ${bg}`}
      role="region"
      aria-label={t('sitplanVisibility.title')}
    >
      <div
        className={`flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-600 ${text}`}
      >
        <EyeIcon colors={colors} />
        <span className="text-sm font-medium">{t('sitplanVisibility.title')}</span>
      </div>

      <div id="sitplan-visibility-content" className="w-[260px] max-w-full px-3 pb-3 pt-2">
        <button
          type="button"
          disabled={readOnly || hiddenItemCount === 0}
          onClick={() => {
            if (!activeFloorId) return
            openHiddenSituationPlanDialogForFloor(
              activeFloorId,
              t,
              t('hiddenItemsDialog.manageHidden', 'Manage hidden')
            )
          }}
          className="mb-2 flex w-full items-center justify-between rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          <span>{t('hiddenItemsDialog.manageHidden', 'Manage hidden')}</span>
          <span className="text-xs text-gray-500 dark:text-gray-400">{hiddenItemCount}</span>
        </button>

        {/* Master checkbox */}
        <label className={`flex items-center gap-2 py-1.5 ${text} cursor-pointer`}>
          <input
            ref={masterCheckRef}
            type="checkbox"
            checked={allChecked}
            onChange={handleMasterChange}
            className="rounded border-gray-400"
          />
          <span className="text-sm">{t('sitplanVisibility.showAll')}</span>
        </label>

        {/* Ground Plans */}
        <label className={`flex items-center gap-2 py-1.5 ${text} cursor-pointer`}>
          <input
            type="checkbox"
            checked={planVisibility.groundPlansVisible}
            onChange={(e) => setPlanVisibility({ groundPlansVisible: e.target.checked })}
            className="rounded border-gray-400"
          />
          <span className="text-sm">{t('sitplanVisibility.groundPlans')}</span>
        </label>
        <div className="pl-6 py-1">
          <div className="flex items-center gap-2">
            <span className={`text-xs ${muted}`}>{t('sitplanVisibility.opacity')}</span>
            <input
              type="range"
              min="0"
              max="100"
              value={groundPlanOpacity}
              onChange={(e) => {
                const value = Number(e.target.value)
                setPlanVisibility({ groundPlansOpacity: value })
                if (!readOnly && activeFloorId) {
                  runProjectCommand(
                    'plan.transformBackground',
                    { floorId: activeFloorId, opacity: value },
                    {
                      historyGroup: `plan-background-opacity:${activeFloorId}`,
                    }
                  )
                }
              }}
              className="flex-1 h-1.5 rounded appearance-none bg-gray-300 dark:bg-gray-600"
            />
            <span className={`text-xs w-8 ${muted}`}>{groundPlanOpacity}%</span>
          </div>
        </div>

        {/* Labels */}
        <label className={`flex items-center gap-2 py-1.5 ${text} cursor-pointer`}>
          <input
            type="checkbox"
            checked={planVisibility.labelsVisible}
            onChange={(e) => setPlanVisibility({ labelsVisible: e.target.checked })}
            className="rounded border-gray-400"
          />
          <span className="text-sm">{t('sitplanVisibility.labels')}</span>
        </label>

        <VisibilitySection
          label={t('sitplanVisibility.symbols')}
          checked={planVisibility.symbolsVisible}
          onChange={(checked) => setPlanVisibility({ symbolsVisible: checked })}
        >
          <div className="px-1 py-1">
            <div className="flex items-center gap-2">
              <span className={`shrink-0 whitespace-nowrap text-xs ${muted}`}>
                {t('sitplanVisibility.symbolSize')}
              </span>
              <input
                type="range"
                min={MIN_SYMBOL_SIZE_CM}
                max={MAX_SYMBOL_SIZE_CM}
                value={clamp(symbolSizeCm, MIN_SYMBOL_SIZE_CM, MAX_SYMBOL_SIZE_CM)}
                onChange={(e) => {
                  const value = Number(e.target.value)
                  setPlanVisibility({ symbolSizeCm: value })
                  if (!readOnly && activeFloorId) {
                    runProjectCommand(
                      'plan.setSymbolSize',
                      { floorId: activeFloorId, sizeCm: value },
                      {
                        label: 'change plan symbol size',
                        historyGroup: `plan-symbol-size:${activeFloorId}`,
                      }
                    )
                  }
                }}
                className="min-w-0 flex-1 h-1.5 rounded appearance-none bg-gray-300 dark:bg-gray-600"
                aria-label={t('sitplanVisibility.symbolSize')}
                disabled={symbolsDisabled}
              />
              <span className={`w-10 shrink-0 whitespace-nowrap text-xs ${muted}`}>
                {clamp(symbolSizeCm, MIN_SYMBOL_SIZE_CM, MAX_SYMBOL_SIZE_CM)} cm
              </span>
            </div>
          </div>

          <div className="flex justify-end px-1 pb-1 pt-1">
            <button
              type="button"
              aria-label={t('sitplanVisibility.colors')}
              aria-pressed={planWiringVisibility.colorCoded === true}
              disabled={readOnly}
              onClick={() =>
                runProjectCommand('plan.setColors', {
                  enabled: planWiringVisibility.colorCoded !== true,
                })
              }
              className={`inline-flex h-7 items-center gap-1.5 rounded border px-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-500 disabled:cursor-default disabled:opacity-50 ${
                planWiringVisibility.colorCoded
                  ? 'border-sky-400 bg-sky-100 text-sky-800 dark:border-sky-600 dark:bg-sky-900/50 dark:text-sky-100'
                  : 'border-gray-300 bg-gray-50 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 3a9 9 0 1 0 0 18h1a2.3 2.3 0 0 0 1.6-3.9 1.3 1.3 0 0 1 .9-2.2H18a3 3 0 0 0 3-3 9 9 0 0 0-9-8.9Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <circle cx="7.5" cy="10" r="1.5" fill="#38bdf8" />
                <circle cx="10.5" cy="6.5" r="1.5" fill="#4ade80" />
                <circle cx="15" cy="7" r="1.5" fill="#fbbf24" />
                <circle cx="17.5" cy="10.5" r="1.5" fill="#f87171" />
              </svg>
              {t('sitplanVisibility.colors')}
            </button>
          </div>

          {/* Symbol sub-items */}
          <div
            className="pl-4 space-y-0.5"
            role="group"
            aria-label={t('sitplanVisibility.symbols')}
          >
            {subSymbolKeys.map(({ key, labelKey }) => (
              <div
                key={key}
                onMouseEnter={() => handleHoverCategory(key)}
                onMouseLeave={() => handleHoverCategory(null)}
                className={`flex items-center gap-2 py-1 px-2 -mx-2 rounded cursor-pointer ${hoverBg} ${
                  symbolsDisabled ? 'opacity-50 pointer-events-none' : ''
                } ${text}`}
              >
                <label className="flex flex-1 items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={planVisibility[SITPLAN_CATEGORY_VISIBILITY_KEYS[key]] !== false}
                    disabled={symbolsDisabled}
                    onChange={(event) =>
                      setPlanVisibility({
                        [SITPLAN_CATEGORY_VISIBILITY_KEYS[key]]: event.target.checked,
                      })
                    }
                    className="rounded border-gray-400"
                  />
                  <span className="text-sm">{t(labelKey)}</span>
                </label>
                <input
                  type="color"
                  value={planCategoryColor(key, planWiringVisibility.symbolColors)}
                  aria-label={t('sitplanVisibility.symbolColor', { category: t(labelKey) })}
                  title={t('sitplanVisibility.symbolColor', { category: t(labelKey) })}
                  disabled={readOnly || symbolsDisabled || planWiringVisibility.colorCoded !== true}
                  onFocus={() => {
                    pickerGesture.current += 1
                  }}
                  onChange={(event) =>
                    runProjectCommand(
                      'plan.setColors',
                      { colors: { [key]: event.target.value } },
                      {
                        historyGroup: `${pickerId}:${key}:${pickerGesture.current}`,
                      }
                    )
                  }
                  className="ml-auto h-6 w-7 shrink-0 cursor-pointer rounded border border-gray-300 bg-transparent p-0.5 disabled:cursor-default disabled:opacity-35 disabled:grayscale dark:border-gray-600"
                />
              </div>
            ))}
          </div>
        </VisibilitySection>
        <VisibilitySection
          label={t('sitplanVisibility.wires')}
          checked={wiresVisible}
          disabled={readOnly}
          onChange={(checked) =>
            setPlanWiringVisibility(
              useWireToolVisibility ? { wireToolWiresVisible: checked } : { wiresVisible: checked }
            )
          }
        >
          <div className="pl-4 space-y-0.5" role="group" aria-label={t('sitplanVisibility.wires')}>
            {useWireToolVisibility
              ? PLAN_WIRE_CATEGORIES.map((category) => (
                  <label
                    key={category}
                    className={`flex items-center gap-2 py-1 px-2 -mx-2 rounded ${readOnly ? '' : `cursor-pointer ${hoverBg}`} ${wiresDisabled ? 'opacity-50' : ''} ${text}`}
                  >
                    <input
                      type="checkbox"
                      checked={planWiringVisibility.wireToolCategoriesVisible?.[category] !== false}
                      disabled={readOnly || wiresDisabled}
                      onChange={(e) =>
                        setPlanWiringVisibility({
                          wireToolCategoriesVisible: {
                            ...planWiringVisibility.wireToolCategoriesVisible,
                            [category]: e.target.checked,
                          },
                        })
                      }
                      className="rounded border-gray-400"
                    />
                    <span className="text-sm">{t(`wireLegend.${category}`)}</span>
                  </label>
                ))
              : [
                  {
                    key: 'lightingVisible' as const,
                    label: t('sitplanVisibility.wiresLighting'),
                  },
                  {
                    key: 'socketsVisible' as const,
                    label: t('sitplanVisibility.wiresSockets'),
                  },
                  {
                    key: 'otherVisible' as const,
                    label: t('sitplanVisibility.wiresOther'),
                  },
                  ...(isCableRoutesEnabled()
                    ? [
                        {
                          key: 'homeRunsVisible' as const,
                          label: t('sitplanVisibility.wiresHomeRuns', 'From board'),
                        },
                        {
                          key: 'branchFeedsVisible' as const,
                          label: t('sitplanVisibility.wiresBranchFeeds', 'Between branches'),
                        },
                        {
                          key: 'supplyVisible' as const,
                          label: t('sitplanVisibility.wiresSupply', 'Supply and earthing'),
                        },
                      ]
                    : []),
                ].map((item) => (
                  <label
                    key={item.key}
                    className={`flex items-center gap-2 py-1 px-2 -mx-2 rounded ${readOnly ? '' : `cursor-pointer ${hoverBg}`} ${
                      wiresDisabled ? 'opacity-50 pointer-events-none' : ''
                    } ${text}`}
                  >
                    <input
                      type="checkbox"
                      checked={
                        item.key === 'supplyVisible'
                          ? planWiringVisibility.supplyVisible !== false
                          : planWiringVisibility[item.key]
                      }
                      disabled={readOnly || wiresDisabled}
                      onChange={(e) => setPlanWiringVisibility({ [item.key]: e.target.checked })}
                      className="rounded border-gray-400"
                    />
                    <span className="text-sm">{item.label}</span>
                  </label>
                ))}
          </div>
          <div className={`mt-2 pl-6 ${wiresDisabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className={`mb-1 text-xs ${muted}`}>{t('sitplanVisibility.wireStyle')}</div>
            <PlanWireStyleButtons
              value={planWiringVisibility.defaultStyle}
              disabled={readOnly || wiresDisabled}
              onChange={(style) => setPlanWiringVisibility({ defaultStyle: style })}
            />
          </div>
        </VisibilitySection>
      </div>
      {/* Panel filter (previously in PlanCanvas top bar) */}
      <div className="px-3 pb-3 pt-2 border-t border-gray-200 dark:border-gray-700 space-y-2">
        <div className="flex items-center justify-between">
          <span className={`text-xs font-medium ${text}`}>{t('panelFilter.title')}</span>
        </div>
        <CustomDropdown
          value={sitplanPanelFilterId ?? ''}
          onChange={(nextValue) => setSitplanPanelFilterId(nextValue || null)}
          options={[
            { value: '', label: t('panelFilter.allPanels') },
            ...flattenedPanels.map((p) => ({ value: p.id, label: p.name })),
          ]}
          className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          placeholder={t('panelFilter.title')}
        />
        {panelIsInLayout && (
          <label className={`flex items-center gap-1.5 text-xs ${muted}`}>
            <input
              type="checkbox"
              checked={syncSitplanFilterWithPanelView}
              onChange={(e) =>
                useUIStore.getState().setSyncSitplanFilterWithPanelView(e.target.checked)
              }
              className="rounded"
            />
            {t('panelFilter.syncWithPanelView')}
          </label>
        )}
      </div>
    </div>
  )
}

export { defaultVisibility }
