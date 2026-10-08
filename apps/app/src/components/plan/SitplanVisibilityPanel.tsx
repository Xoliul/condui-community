/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/stores/uiStore'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useThemeColors } from '@/lib/theme/hooks'
import CustomDropdown from '@/components/common/CustomDropdown'
import {
  MIN_SYMBOL_SIZE_CM,
  MAX_SYMBOL_SIZE_CM,
  DEFAULT_SYMBOL_SIZE_CM,
} from '@/constants/planConstants'
import type { PlanVisibilityState } from '@/types/ui'
import type { Placement, SymbolKey, PlanWiringVisibility } from '@/types/schema'
import { resolvePlanWiringVisibility } from '@/lib/plan/planWiring'
import { selectProjectPlanWiringProjection } from '@/lib/projectV2/planWiring'
import { selectProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { getPanelDisplayName } from '@/utils/panelNames'
import { clamp } from '@/lib/geometry'
import { openHiddenSituationPlanDialogForFloor } from '@/components/plan/openHiddenSituationPlanDialog'
import { isCableRoutesEnabled } from '@/lib/cableRouting/availability'
import { PlanWireStyleButtons } from '@/components/cableRouting/PlanWireStyleButtons'
import { PLAN_WIRE_CATEGORIES } from '@/lib/cableRouting/planWireCategoryVisibility'

/** Symbol category for visibility and hover-highlight */
export type SitplanSymbolCategory = 'sockets' | 'lights' | 'switches' | 'panels' | 'fixedAppliances'

/** Map endpoint symbol key to visibility category */
export function getSymbolCategory(symbolKey: SymbolKey): SitplanSymbolCategory | null {
  if (
    symbolKey === 'socket' ||
    symbolKey === 'socket_gnd' ||
    symbolKey === 'socket_child' ||
    symbolKey === 'socket_gnd_child'
  )
    return 'sockets'
  if (
    symbolKey === 'light_point' ||
    symbolKey === 'light_spot' ||
    symbolKey === 'light_led' ||
    symbolKey === 'light_fluorescent'
  )
    return 'lights'
  if (
    symbolKey === 'switch' ||
    symbolKey === 'switch_1p_twoway' ||
    symbolKey === 'switch_2p_twoway' ||
    symbolKey === 'switch_dimmer' ||
    symbolKey === 'switch_1p_changeover' ||
    symbolKey === 'switch_1p_pull' ||
    symbolKey === 'switch_impulse' ||
    symbolKey === 'switch_cross' ||
    symbolKey === 'motion_detector' ||
    symbolKey === 'smoke_detector' ||
    symbolKey === 'relay' ||
    symbolKey === 'switch_single' ||
    symbolKey === 'switch_double'
  )
    return 'switches'
  if (
    symbolKey === 'panel_distribution' ||
    symbolKey === 'junction_panel' ||
    (symbolKey as string) === 'earthing'
  ) {
    return 'panels'
  }
  const fixedApplianceKeys: SymbolKey[] = [
    'oven',
    'washer',
    'dryer',
    'dishwasher',
    'boiler',
    'ev',
    'freezer',
    'fridge',
    'microwave',
    'motor',
    'fixed_appliance_generic',
    'stove',
    'furnace',
    'heating',
    'ventilation',
    'door_lock',
  ]
  if (fixedApplianceKeys.includes(symbolKey)) return 'fixedAppliances'
  return null
}

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
}

export default function SitplanVisibilityPanel({
  readOnly = false,
  wireToolActive = false,
}: {
  readOnly?: boolean
  wireToolActive?: boolean
}) {
  const { t } = useTranslation()
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
  const currentProject = useProjectStore((s: ProjectState) => s.currentProject)
  const updatePlanWiringVisibility = useProjectStore(
    (s: ProjectState) => s.updatePlanWiringVisibility
  )
  const getFloorById = useProjectStore((s: ProjectState) => s.getFloorById)
  const updateFloor = useProjectStore((s: ProjectState) => s.updateFloor)
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
      updatePlanWiringVisibility(updates)
    },
    [readOnly, updatePlanWiringVisibility]
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

  /** Endpoint IDs per category for hover highlight */
  const endpointIdsByCategory = useMemo(() => {
    const map = new Map<SitplanSymbolCategory, string[]>()
    const cats: SitplanSymbolCategory[] = [
      'sockets',
      'lights',
      'switches',
      'panels',
      'fixedAppliances',
    ]
    cats.forEach((c) => map.set(c, []))
    placements.forEach((p: Placement & { endpointId?: string }) => {
      if (!p.endpointId) return
      const ep = getEndpointById(p.endpointId)
      if (!ep?.symbol) return
      const cat = getSymbolCategory(ep.symbol as SymbolKey)
      if (cat) map.get(cat)!.push(ep.id)
    })
    return map
  }, [placements, getEndpointById])

  const handleHoverCategory = useCallback(
    (category: SitplanSymbolCategory | null) => {
      if (!category) {
        clearHover()
        return
      }
      const ids = endpointIdsByCategory.get(category) ?? []
      setHover({ type: 'endpoint', ids })
    },
    [endpointIdsByCategory, setHover, clearHover]
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
        updateFloor(activeFloorId, { planImageOpacity: 100 })
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

      <div id="sitplan-visibility-content" className="px-3 pb-3 pt-2 min-w-[220px]">
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
                  updateFloor(activeFloorId, { planImageOpacity: value })
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

        {/* Symbols (master) */}
        <label className={`flex items-center gap-2 py-1.5 ${text} cursor-pointer`}>
          <input
            type="checkbox"
            checked={planVisibility.symbolsVisible}
            onChange={(e) => setPlanVisibility({ symbolsVisible: e.target.checked })}
            className="rounded border-gray-400"
          />
          <span className="text-sm">{t('sitplanVisibility.symbols')}</span>
        </label>
        <div className="pl-6 py-1">
          <div className="flex items-center gap-2">
            <span className={`text-xs ${muted}`}>{t('sitplanVisibility.symbolSize')}</span>
            <input
              type="range"
              min={MIN_SYMBOL_SIZE_CM}
              max={MAX_SYMBOL_SIZE_CM}
              value={clamp(symbolSizeCm, MIN_SYMBOL_SIZE_CM, MAX_SYMBOL_SIZE_CM)}
              onChange={(e) => {
                const value = Number(e.target.value)
                setPlanVisibility({ symbolSizeCm: value })
                if (!readOnly && activeFloorId) {
                  updateFloor(activeFloorId, { sitplanSymbolSizeCm: value })
                }
              }}
              className="flex-1 h-1.5 rounded appearance-none bg-gray-300 dark:bg-gray-600"
              aria-label={t('sitplanVisibility.symbolSize')}
            />
            <span className={`text-xs w-10 ${muted}`}>
              {clamp(symbolSizeCm, MIN_SYMBOL_SIZE_CM, MAX_SYMBOL_SIZE_CM)} cm
            </span>
          </div>
        </div>

        {/* Symbol sub-items */}
        <div className="pl-4 space-y-0.5">
          {subSymbolKeys.map(({ key, labelKey }) => (
            <label
              key={key}
              onMouseEnter={() => handleHoverCategory(key)}
              onMouseLeave={() => handleHoverCategory(null)}
              className={`flex items-center gap-2 py-1 px-2 -mx-2 rounded cursor-pointer ${hoverBg} ${
                symbolsDisabled ? 'opacity-50 pointer-events-none' : ''
              } ${text}`}
            >
              <input
                type="checkbox"
                checked={
                  key === 'sockets'
                    ? planVisibility.socketsVisible
                    : key === 'lights'
                      ? planVisibility.lightsVisible
                      : key === 'switches'
                        ? planVisibility.switchesVisible
                        : key === 'panels'
                          ? planVisibility.panelsVisible
                          : planVisibility.fixedAppliancesVisible
                }
                disabled={symbolsDisabled}
                onChange={(e) => {
                  const v = e.target.checked
                  setPlanVisibility(
                    key === 'sockets'
                      ? { socketsVisible: v }
                      : key === 'lights'
                        ? { lightsVisible: v }
                        : key === 'switches'
                          ? { switchesVisible: v }
                          : key === 'panels'
                            ? { panelsVisible: v }
                            : { fixedAppliancesVisible: v }
                  )
                }}
                className="rounded border-gray-400"
              />
              <span className="text-sm">{t(labelKey)}</span>
            </label>
          ))}
        </div>
        <div className="mt-2 border-t border-gray-200 pt-2 dark:border-gray-700">
          <label
            className={`flex items-center gap-2 py-1.5 ${text} ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}
          >
            <input
              type="checkbox"
              checked={wiresVisible}
              disabled={readOnly}
              onChange={(e) =>
                setPlanWiringVisibility(
                  useWireToolVisibility
                    ? { wireToolWiresVisible: e.target.checked }
                    : { wiresVisible: e.target.checked }
                )
              }
              className="rounded border-gray-400"
            />
            <span className="text-sm">{t('sitplanVisibility.wires')}</span>
          </label>
          <div className="pl-4 space-y-0.5">
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
                        {
                          key: 'colorCoded' as const,
                          label: t('sitplanVisibility.wiresColorCoded', 'Colour by group'),
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
              disabled={readOnly}
              onChange={(style) => setPlanWiringVisibility({ defaultStyle: style })}
            />
          </div>
        </div>
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
