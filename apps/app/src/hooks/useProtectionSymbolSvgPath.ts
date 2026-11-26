import { useSettingsStore } from '@/stores/settingsStore'
import { resolveProtectionSvgPath } from '@/lib/detailedProtectionSymbols'

/** Catalog SVG path to draw, honouring the "detailed protection symbols" setting. */
export function useProtectionSymbolSvgPath<T extends string | null | undefined>(svgPath: T): T | string {
  const detailed = useSettingsStore((state) => state.detailedProtectionSymbols)
  return resolveProtectionSvgPath(svgPath, detailed)
}

export function useDetailedProtectionSymbols(): boolean {
  return useSettingsStore((state) => state.detailedProtectionSymbols)
}
