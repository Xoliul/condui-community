import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Theme, FontFamily, WheelBehavior } from '@/types/ui'
import { getThemeColor } from '@/lib/theme/colors'
import { clearSymbolCache, warmSymbolSvgCache } from '@/lib/symbolImage'
import { setManualPlanPlacement } from '@/lib/plan/manualPlanPlacementPreference'
import {
  persistLanguagePreference,
  persistThemePreference,
  DEFAULT_THEME_MODE,
  resolveInitialLanguagePreference,
  resolveInitialThemePreference,
} from '@/utils/userPreferences'

interface Settings {
  theme: Theme
  language: string
  font: FontFamily
  gridEnabled: boolean
  gridSize: number
  autoSave: boolean
  autoSaveInterval: number // in seconds
  /** Debug: visualize 1draad hit zones used for drop detection */
  eendraadHitboxDebug: boolean
  /** Debug: visualize packed circuit and secondary-bus subtree envelopes */
  eendraadTrunkLayoutDebug: boolean
  /** Debug: visualize sitplan placement centers, bounds, label positions and wall orientation helpers */
  planPlacementDebug: boolean
  /** Debug: draw estimated physical cable routes and lengths on the sitplan */
  planCableRouteDebug: boolean
  /** Debug: color-code panel relation routing and module role overlays */
  panelRelationDebug: boolean
  /** Desktop/laptop: left-drag on empty canvas pans (Shift+left-drag = marquee select). */
  leftDragPansCanvas: boolean
  /** New symbols wait off the situation plan until the user places them (Quick Placer, drag). */
  placePlanSymbolsManually: boolean
  /** Plain wheel / two-finger scroll: zoom (mouse) or pan (trackpad). Pinch and Ctrl/Cmd + wheel always zoom. */
  wheelBehavior: WheelBehavior
  /** The one-time "using a trackpad?" hint was answered or dismissed, or the user chose a mode. */
  wheelBehaviorHintDone: boolean
}

const getDefaultLanguage = (): string => {
  if (typeof window === 'undefined') {
    return 'nl-BE'
  }

  return resolveInitialLanguagePreference(window.location.hostname)
}

const getDefaultThemeMode = (): 'light' | 'dark' => {
  if (typeof window === 'undefined') {
    return DEFAULT_THEME_MODE
  }

  return resolveInitialThemePreference(['eendra-theme'])
}

interface SettingsState extends Settings {
  setTheme: (theme: Theme) => void
  setLanguage: (language: string) => void
  setFont: (font: FontFamily) => void
  setGridEnabled: (enabled: boolean) => void
  setGridSize: (size: number) => void
  setAutoSave: (enabled: boolean) => void
  setAutoSaveInterval: (interval: number) => void
  setEendraadHitboxDebug: (enabled: boolean) => void
  setEendraadTrunkLayoutDebug: (enabled: boolean) => void
  setPlanPlacementDebug: (enabled: boolean) => void
  setPlanCableRouteDebug: (enabled: boolean) => void
  setPanelRelationDebug: (enabled: boolean) => void
  setLeftDragPansCanvas: (enabled: boolean) => void
  setPlacePlanSymbolsManually: (enabled: boolean) => void
  setWheelBehavior: (behavior: WheelBehavior) => void
  dismissWheelBehaviorHint: () => void
  reset: () => void
}

const defaultSettings: Settings = {
  theme: {
    mode: getDefaultThemeMode(),
    wallColors: {
      light: {
        fill: getThemeColor('light', 'wallColor'),
        stroke: getThemeColor('light', 'gray200'),
      },
      dark: {
        fill: getThemeColor('dark', 'wallColor'),
        stroke: getThemeColor('dark', 'grid'),
      },
    },
  },
  language: getDefaultLanguage(),
  font: 'Figtree',
  gridEnabled: true,
  gridSize: 20,
  autoSave: true,
  autoSaveInterval: 30,
  eendraadHitboxDebug: false,
  eendraadTrunkLayoutDebug: false,
  planPlacementDebug: false,
  planCableRouteDebug: false,
  panelRelationDebug: false,
  leftDragPansCanvas: true,
  placePlanSymbolsManually: false,
  wheelBehavior: 'zoom',
  wheelBehaviorHintDone: false,
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaultSettings,

      setTheme: (theme) => {
        clearSymbolCache()
        void warmSymbolSvgCache({ isDark: theme.mode === 'dark' })
        persistThemePreference(theme.mode, ['eendra-theme'])
        set({ theme })
      },
      setLanguage: (language) => {
        persistLanguagePreference(language, ['eendra-language'])
        set({ language })
      },
      setFont: (_font) => set({ font: 'Figtree' }),
      setGridEnabled: (enabled) => set({ gridEnabled: enabled }),
      setGridSize: (size) => set({ gridSize: size }),
      setAutoSave: (enabled) => set({ autoSave: enabled }),
      setAutoSaveInterval: (interval) => set({ autoSaveInterval: interval }),
      setEendraadHitboxDebug: (enabled) => set({ eendraadHitboxDebug: enabled }),
      setEendraadTrunkLayoutDebug: (enabled) => set({ eendraadTrunkLayoutDebug: enabled }),
      setPlanPlacementDebug: (enabled) => set({ planPlacementDebug: enabled }),
      setPlanCableRouteDebug: (enabled) => set({ planCableRouteDebug: enabled }),
      setPanelRelationDebug: (enabled) => set({ panelRelationDebug: enabled }),
      setLeftDragPansCanvas: (enabled) => set({ leftDragPansCanvas: enabled }),
      setPlacePlanSymbolsManually: (enabled) => set({ placePlanSymbolsManually: enabled }),
      setWheelBehavior: (behavior) => set({ wheelBehavior: behavior, wheelBehaviorHintDone: true }),
      dismissWheelBehaviorHint: () => set({ wheelBehaviorHintDone: true }),
      reset: () => set(defaultSettings),
    }),
    {
      name: 'eendra-settings',
      // Hard-lock to Figtree even if a previous OpenSans selection is stored.
      merge: (persistedState, currentState) => {
        const persisted =
          persistedState && typeof persistedState === 'object'
            ? (persistedState as Partial<SettingsState>)
            : {}
        return {
          ...currentState,
          ...persisted,
          font: 'Figtree',
        }
      },
    }
  )
)

setManualPlanPlacement(useSettingsStore.getState().placePlanSymbolsManually)
useSettingsStore.subscribe((state) => setManualPlanPlacement(state.placePlanSymbolsManually))
