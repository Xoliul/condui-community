import { LANGUAGE_OPTIONS } from '@/utils/languageRouting'
import { startTransition } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settingsStore'
import i18n from '@/i18n'
import CustomDropdown from '@/components/common/CustomDropdown'
import { InstallerInfoSection } from '@/components/settings/InstallerInfoSection'

const LANGUAGES = LANGUAGE_OPTIONS

export function SettingsPanel({ showDebug = import.meta.env.DEV }: { showDebug?: boolean }) {
  const { t } = useTranslation()
  const language = useSettingsStore((state) => state.language)
  const setLanguage = useSettingsStore((state) => state.setLanguage)
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

  const handleLanguageChange = (newLanguage: string) => {
    setLanguage(newLanguage)
    startTransition(() => {
      void i18n.changeLanguage(newLanguage)
    })
    localStorage.setItem('eendra-language', newLanguage)
  }

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
