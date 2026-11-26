const PROTECTION_DIR = '/symbols/protection/'
const DETAILED_DIR = '/symbols/protection/detailed/'

/** Protection symbols with an alternative detailed drawing (same 48x48 box, currentColor). */
const DETAILED_PROTECTION_FILES: ReadonlySet<string> = new Set([
  'mcb.svg',
  'rcd.svg',
  'rcbo.svg',
  'spd.svg',
  'spd_spark_gap.svg',
])

/**
 * Catalog SVG path to draw for a protection symbol. Returns the detailed drawing for
 * the MCB, RCD, RCBO and SPD symbols when `detailed` is on; every other path (fuse,
 * main switch, rotating switch, non-protection symbols, undefined) is returned as given.
 */
export function resolveProtectionSvgPath<T extends string | null | undefined>(
  svgPath: T,
  detailed: boolean
): T | string {
  if (!detailed || !svgPath || !svgPath.startsWith(PROTECTION_DIR)) return svgPath
  const file = svgPath.slice(PROTECTION_DIR.length)
  return DETAILED_PROTECTION_FILES.has(file) ? `${DETAILED_DIR}${file}` : svgPath
}

/** Every detailed drawing path, for cache warm-up. */
export function getDetailedProtectionSvgPaths(): string[] {
  return Array.from(DETAILED_PROTECTION_FILES, (file) => `${DETAILED_DIR}${file}`)
}
