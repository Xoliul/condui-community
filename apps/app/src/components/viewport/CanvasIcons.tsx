/* eslint-disable react-refresh/only-export-components */
import type { CanvasType } from '@/types/ui'
import { scopeSvgMarkupClasses } from '../../lib/ui/scopedSvgMarkup'
import eendraadSvg from '../../../public/icons/canvas-eendraad.svg?raw'
import panelSvg from '../../../public/icons/canvas-panel.svg?raw'
import planSvg from '../../../public/icons/canvas-plan.svg?raw'

interface IconProps {
  className?: string
}

function SvgIcon({ svg, className = 'w-6 h-6' }: { svg: string; className?: string }) {
  return (
    <span
      className={`ui-svg-icon inline-block shrink-0 ${className}`}
      dangerouslySetInnerHTML={{ __html: scopeSvgMarkupClasses(svg) }}
    />
  )
}

export function EendraadIcon({ className }: IconProps) {
  return <SvgIcon svg={eendraadSvg} className={className} />
}

export function PanelIcon({ className }: IconProps) {
  return <SvgIcon svg={panelSvg} className={className} />
}

export function SitplanIcon({ className }: IconProps) {
  return <SvgIcon svg={planSvg} className={className} />
}

export function StructureIcon({ className = 'w-6 h-6' }: IconProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <circle cx="5" cy="12" r="2.2" />
      <circle cx="19" cy="7" r="2.2" />
      <circle cx="19" cy="17" r="2.2" />
      <path d="M7.1 11.3L16.9 7.7M7.1 12.7L16.9 16.3" />
    </svg>
  )
}

export const CANVAS_ICONS: Record<CanvasType, (props: IconProps) => React.JSX.Element> = {
  eendraad: EendraadIcon,
  plan: SitplanIcon,
  panel: PanelIcon,
  structure: StructureIcon,
}
