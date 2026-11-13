import type { SwitchDeviceProps } from '@/types/switchDeviceProps'

/** Visual switch properties shared by the drawing resolvers. */
export interface SwitchSymbolProps extends SwitchDeviceProps {
  motionDetectorType?: 'spread' | 'generic'
}

/** Keep the cover and indicator in one overlay for every canvas and SVG export. */
export function getPushbuttonOverlayPath(props: SwitchSymbolProps): string | undefined {
  if (props.protected) {
    return props.verklikkerlamp
      ? '/symbols/switches/switch_impulse_overlay_protected_light.svg'
      : '/symbols/switches/switch_impulse_overlay_protected.svg'
  }
  return props.verklikkerlamp ? '/symbols/switches/switch_impulse_overlay_light.svg' : undefined
}
