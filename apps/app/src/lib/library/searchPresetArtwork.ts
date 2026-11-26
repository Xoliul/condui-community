import {
  getSymbolById,
  getSwitchSymbolPaths,
  getFixedApplianceSymbolPath,
  RELAY_OVERLAY_PATHS,
  SMOKE_DETECTOR_OVERLAY_PATHS,
  LIGHT_POINT_OVERLAY_PATHS,
  LIGHT_SPOT_OVERLAY_PATHS,
} from '@/lib/symbols'
import { getSurgeProtectionSymbolPath } from '@/lib/surgeProtectionSymbol'
import { getSearchPreset } from './searchPresets'

/** Catalog assets and geometry at the drawing's native 20px symbol size. */
export function getSearchPresetArtwork(symbolId: string, presetId: string, plan = false) {
  const preset = getSearchPreset(symbolId, presetId)
  const symbol = getSymbolById(symbolId)
  if (!preset || !symbol) return null
  // A preset with its own library entry shows that entry's drawing.
  const entry = preset.libraryEntry ? getSymbolById(preset.id) : null
  if (entry) return { paths: [entry.svgPath], lines: [] as number[][], waterproof: false }
  const props = preset.defaults
  let paths = [symbol.svgPath]
  if (symbolId === 'spd') paths = [getSurgeProtectionSymbolPath(props.surgeProtectionKind)]
  else if (symbolId === 'relay')
    paths = [
      '/symbols/switches/relay.svg',
      RELAY_OVERLAY_PATHS[props.relayProps?.control ?? 'standard'],
    ]
  else if (symbolId === 'smoke_detector')
    paths = [
      '/symbols/switches/smoke_detector_base.svg',
      SMOKE_DETECTOR_OVERLAY_PATHS[props.smokeDetectorProps?.type ?? 'smoke'],
    ]
  else if (symbol.category === 'switches') {
    const { basePath, overlayPath } = getSwitchSymbolPaths(symbolId, props.switchProps)
    paths = overlayPath ? [basePath, overlayPath] : [basePath]
  } else if (symbolId === 'light_point') {
    if (props.lightPointProps?.safety) paths.push(LIGHT_POINT_OVERLAY_PATHS.safety)
    if (props.lightPointProps?.decentral) paths.push(LIGHT_POINT_OVERLAY_PATHS.decentral)
  } else if (
    symbolId === 'light_spot' &&
    props.lightSpotProps?.beamType &&
    props.lightSpotProps.beamType !== 'none'
  ) {
    paths.push(LIGHT_SPOT_OVERLAY_PATHS[props.lightSpotProps.beamType])
  } else
    paths = [getFixedApplianceSymbolPath(symbolId, props.fixedApplianceProps) ?? symbol.svgPath]
  const lines: number[][] = []
  if (!plan && props.lightPointProps?.onWall) lines.push([12, -11, 12, 11])
  const tubes = props.lightFluorescentProps?.tubeCount
  if (tubes)
    for (const y of tubes === 1 ? [0] : tubes === 2 ? [-2, 2] : [-2.5, 0, 2.5])
      lines.push([-9.5, y, 9.5, y])
  return { paths, lines, waterproof: props.socketProps?.waterproof === true }
}
