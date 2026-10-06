import { LANGUAGE_OPTIONS } from '@/utils/languageRouting'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settingsStore'
import { switchEditorLanguage } from '@/lib/preferences/switchEditorLanguage'
import CustomDropdown from '@/components/common/CustomDropdown'
import { InstallerInfoSection } from '@/components/settings/InstallerInfoSection'
import { LAYOUT_PRESET_DEFS } from '@/components/viewport/LayoutSelector'
import { isLayoutPresetAvailable } from '@/stores/uiStore'
import { APP_BUILD_COMMIT, formatAppBuildDate, getAppBuildCommitShortLabel } from '@/lib/appBuildInfo'

const LANGUAGES = LANGUAGE_OPTIONS

/** Build commit and date for the Settings dialog header. */
export function SettingsBuildInfo() {
  const { t, i18n: activeI18n } = useTranslation()
  const buildCommitLabel = getAppBuildCommitShortLabel()
  if (!buildCommitLabel) return null
  const buildDateLabel = formatAppBuildDate(activeI18n.language)
  return (
    <span
      className="shrink-0 whitespace-nowrap text-xs text-gray-400 dark:text-gray-500"
      data-testid="settings-build-info"
      title={APP_BUILD_COMMIT}
    >
      {t('settings.build', { commit: buildCommitLabel })}
      {buildDateLabel ? ` · ${buildDateLabel}` : ''}
    </span>
  )
}

export function SettingsPanel({ showDebug = import.meta.env.DEV }: { showDebug?: boolean }) {
  const { t } = useTranslation()
  const language = useSettingsStore((state) => state.language)
  const eendraadHitboxDebug = useSettingsStore((state) => state.eendraadHitboxDebug)
  const setEendraadHitboxDebug = useSettingsStore((state) => state.setEendraadHitboxDebug)
  const eendraadTrunkLayoutDebug = useSettingsStore((state) => state.eendraadTrunkLayoutDebug)
  const setEendraadTrunkLayoutDebug = useSettingsStore((state) => state.setEendraadTrunkLayoutDebug)
  const planPlacementDebug = useSettingsStore((state) => state.planPlacementDebug)
  const setPlanPlacementDebug = useSettingsStore((state) => state.setPlanPlacementDebug)
  const planCableRouteDebug = useSettingsStore((state) => state.planCableRouteDebug)
  const setPlanCableRouteDebug = useSettingsStore((state) => state.setPlanCableRouteDebug)
  const panelRelationDebug = useSettingsStore((state) => state.panelRelationDebug)
  const setPanelRelationDebug = useSettingsStore((state) => state.setPanelRelationDebug)
  const leftDragPansCanvas = useSettingsStore((state) => state.leftDragPansCanvas)
  const setLeftDragPansCanvas = useSettingsStore((state) => state.setLeftDragPansCanvas)
  const wheelBehavior = useSettingsStore((state) => state.wheelBehavior)
  const setWheelBehavior = useSettingsStore((state) => state.setWheelBehavior)
  const placePlanSymbolsManually = useSettingsStore((state) => state.placePlanSymbolsManually)
  const setPlacePlanSymbolsManually = useSettingsStore((state) => state.setPlacePlanSymbolsManually)
  const defaultLayoutPreset = useSettingsStore((state) => state.defaultLayoutPreset)
  const setDefaultLayoutPreset = useSettingsStore((state) => state.setDefaultLayoutPreset)

  const handleLanguageChange = switchEditorLanguage

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">
          {t('settings.interface.title')}
        </h3>
        <div className="space-y-4">
          <div>
            <label
              htmlFor="settings-language"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              {t('settings.interface.language')}
            </label>
            <CustomDropdown
              id="settings-language"
              value={language}
              onChange={handleLanguageChange}
              options={LANGUAGES.map((lang) => ({ value: lang.code, label: lang.label }))}
              className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">
          {t('settings.workflow.title')}
        </h3>
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              className="rounded"
              data-testid="settings-place-plan-symbols-manually"
              checked={placePlanSymbolsManually}
              onChange={(e) => setPlacePlanSymbolsManually(e.target.checked)}
            />
            {t('settings.workflow.placePlanSymbolsManually')}
          </label>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('settings.workflow.placePlanSymbolsManuallyHint')}
          </p>
        </div>
        <fieldset className="mt-4">
          <legend className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('settings.workflow.defaultLayout')}
          </legend>
          <div className="grid grid-cols-6 gap-1" role="radiogroup">
            {LAYOUT_PRESET_DEFS.filter(({ preset }) => isLayoutPresetAvailable(preset)).map(
              ({ preset, icon }) => {
                const selected = defaultLayoutPreset === preset
                return (
                  <button
                    key={preset}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={t(`layout.presets.${preset}`)}
                    data-testid={`settings-default-layout-${preset}`}
                    onClick={() => setDefaultLayoutPreset(preset)}
                    title={t(`layout.presets.${preset}`)}
                    className={`flex min-w-0 items-center justify-center rounded-md border p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                      selected
                        ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-300'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-sky-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200'
                    }`}
                  >
                    <span className="shrink-0" aria-hidden="true">
                      {icon}
                    </span>
                  </button>
                )
              }
            )}
          </div>
        </fieldset>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">
          {t('settings.navigation.title', 'Canvas navigation')}
        </h3>
        <div className="space-y-3">
          <div>
            <label
              htmlFor="settings-wheel-behavior"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              {t('settings.navigation.wheelBehavior')}
            </label>
            <CustomDropdown
              id="settings-wheel-behavior"
              value={wheelBehavior}
              onChange={(value) => setWheelBehavior(value === 'pan' ? 'pan' : 'zoom')}
              options={[
                { value: 'zoom', label: t('settings.navigation.wheelBehaviorZoom') },
                { value: 'pan', label: t('settings.navigation.wheelBehaviorPan') },
              ]}
              className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                className="rounded"
                checked={leftDragPansCanvas}
                onChange={(e) => setLeftDragPansCanvas(e.target.checked)}
              />
              {t('settings.navigation.leftDragPansCanvas', 'Left-drag to pan (desktop)')}
            </label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t(
                'settings.navigation.leftDragPansCanvasHint',
                'On laptop and desktop, drag with the left mouse button to pan the canvas (like touch). Hold Shift and drag to select with a rectangle. Middle- and right-button pan still work.'
              )}
            </p>
          </div>
        </div>
      </section>

      {import.meta.env.DEV && showDebug && (
        <section>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">
            {t('settings.debug.title', 'Debug')}
          </h3>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={eendraadHitboxDebug}
                  onChange={(e) => setEendraadHitboxDebug(e.target.checked)}
                />
                {t('settings.debug.eendraadHitboxDebug', 'Show one-wire diagram hitboxes')}
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t(
                  'settings.debug.eendraadHitboxDebugHint',
                  'Visualize the hit zones used for drop detection on the one-line diagram. UI-only, not exported.'
                )}
              </p>
            </div>

            <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={eendraadTrunkLayoutDebug}
                  onChange={(e) => setEendraadTrunkLayoutDebug(e.target.checked)}
                />
                {t('settings.debug.eendraadTrunkLayoutDebug', 'Show one-wire trunk layout boxes')}
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t(
                  'settings.debug.eendraadTrunkLayoutDebugHint',
                  'Show the painted envelopes used to space circuit trunks and secondary busbars. UI-only, not exported.'
                )}
              </p>
            </div>

            <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={planPlacementDebug}
                  onChange={(e) => setPlanPlacementDebug(e.target.checked)}
                />
                {t('settings.debug.planPlacementDebug', 'Show plan placement debug (sitplan)')}
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t(
                  'settings.debug.planPlacementDebugHint',
                  'Visualize symbol centers, selection bounds, label positions and wall-based orientation helpers on the sitplan. UI-only, not exported.'
                )}
              </p>
            </div>

            <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={planCableRouteDebug}
                  onChange={(e) => setPlanCableRouteDebug(e.target.checked)}
                />
                {t('settings.debug.planCableRouteDebug', 'Show plan cable length debug (sitplan)')}
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t(
                  'settings.debug.planCableRouteDebugHint',
                  'Draw the estimated 3D cable route and length of every circuit wire on the sitplan, with a table of the calculation. UI-only, not exported.'
                )}
              </p>
            </div>

            <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={panelRelationDebug}
                  onChange={(e) => setPanelRelationDebug(e.target.checked)}
                />
                {t(
                  'settings.debug.panelRelationDebug',
                  'Show panel relation routing debug (panel canvas)'
                )}
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t(
                  'settings.debug.panelRelationDebugHint',
                  'Color-code relation wire routing classes and module roles on the panel canvas. UI-only, not exported.'
                )}
              </p>
            </div>
          </div>
        </section>
      )}

      <InstallerInfoSection />
    </div>
  )
}
