import type { ReactNode } from 'react'
import { scopeSvgMarkupClasses } from '../../lib/ui/scopedSvgMarkup'
import drawModeSvg from '../../../public/icons/ui-draw-mode.svg?raw'
import drawRectSvg from '../../../public/icons/ui-draw-rect.svg?raw'
import movePointSvg from '../../../public/icons/ui-move-point.svg?raw'
import insertDoorSvg from '../../../public/icons/ui-insert-door.svg?raw'
import insertWindowSvg from '../../../public/icons/ui-insert-window.svg?raw'
import clipWallSvg from '../../../public/icons/ui-clip-wall.svg?raw'
import insertPointSvg from '../../../public/icons/ui-insert-point.svg?raw'
import selectWallsSvg from '../../../public/icons/ui-select-walls.svg?raw'
import uploadFloorSvg from '../../../public/icons/ui-upload-floor.svg?raw'
import moveFloorSvg from '../../../public/icons/ui-move-floor.svg?raw'
import scaleSvg from '../../../public/icons/ui-scale.svg?raw'
import gridSvg from '../../../public/icons/ui-grid.svg?raw'
import floorSvg from '../../../public/icons/ui-floor.svg?raw'
import visibilitySvg from '../../../public/icons/ui-visibility.svg?raw'
import panelSelectorSvg from '../../../public/icons/ui-panel-selector.svg?raw'
import panelSettingsSvg from '../../../public/icons/ui-panel-settings.svg?raw'
import quickPlacerSvg from '../../../public/icons/ui-quick-placer_simple.svg?raw'
import librarySvg from '../../../public/icons/ui-library.svg?raw'
import domoticaSvg from '../../../public/icons/ui-domotica.svg?raw'
import rewireSvg from '../../../public/icons/ui-rewire.svg?raw'
import autoArrangeSvg from '../../../public/icons/ui-auto-arrange.svg?raw'
import undoSvg from '../../../public/icons/ui-undo.svg?raw'
import redoSvg from '../../../public/icons/ui-redo.svg?raw'
import wiringSvg from '../../../public/icons/ui-wiring.svg?raw'

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

function MaskIcon({ src, className = 'w-6 h-6' }: { src: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block shrink-0 bg-current ${className}`}
      style={{
        WebkitMask: `url("${src}") center / contain no-repeat`,
        mask: `url("${src}") center / contain no-repeat`,
      }}
    />
  )
}

export function FindFocusIcon({ className }: IconProps) {
  return <MaskIcon src="/icons/ui-find-focus.svg" className={className} />
}

export function MaximizeCanvasIcon({ className }: IconProps) {
  return <MaskIcon src="/icons/ui-maximize-canvas.svg" className={className} />
}

export function RestoreLayoutIcon({ className }: IconProps) {
  return <MaskIcon src="/icons/ui-restore-layout.svg" className={className} />
}

export function DrawPencilIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? 'w-6 h-6'}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        d="M3 21l3.9-1 10.9-10.9a1.8 1.8 0 0 0 0-2.6l-.3-.3a1.8 1.8 0 0 0-2.6 0L4 17.1 3 21z"
        strokeWidth="1.9"
      />
      <path d="M14.8 6.2l3 3" strokeWidth="1.9" />
    </svg>
  )
}

export function DrawStairsIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? 'w-6 h-6'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 18H20" />
      <path d="M6 18V14H10V10H14V6H18" />
    </svg>
  )
}

export function DrawModeIcon({ className }: IconProps) {
  return <SvgIcon svg={drawModeSvg} className={className} />
}

export function ExitDrawModeIcon({ className = 'w-6 h-6' }: IconProps) {
  return (
    <span className={`relative inline-flex items-center justify-center ${className}`}>
      <SvgIcon svg={drawModeSvg} className="w-full h-full" />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute h-1 w-[96%] rotate-45 rounded-full bg-current"
      />
    </span>
  )
}

export function DrawRectIcon({ className }: IconProps) {
  return <SvgIcon svg={drawRectSvg} className={className} />
}

export function MovePointIcon({ className }: IconProps) {
  return <SvgIcon svg={movePointSvg} className={className} />
}

export function InsertDoorIcon({ className }: IconProps) {
  return <SvgIcon svg={insertDoorSvg} className={className} />
}

export function InsertWindowIcon({ className }: IconProps) {
  return <SvgIcon svg={insertWindowSvg} className={className} />
}

export function ClipWallIcon({ className }: IconProps) {
  return <SvgIcon svg={clipWallSvg} className={className} />
}

export function InsertPointIcon({ className }: IconProps) {
  return <SvgIcon svg={insertPointSvg} className={className} />
}

export function SelectWallsIcon({ className }: IconProps) {
  return <SvgIcon svg={selectWallsSvg} className={className} />
}

export function UploadFloorIcon({ className }: IconProps) {
  return <SvgIcon svg={uploadFloorSvg} className={className} />
}

export function MoveFloorIcon({ className }: IconProps) {
  return <SvgIcon svg={moveFloorSvg} className={className} />
}

export function ScaleIcon({ className }: IconProps) {
  return <SvgIcon svg={scaleSvg} className={className} />
}

export function GridIcon({ className }: IconProps) {
  return <SvgIcon svg={gridSvg} className={className} />
}

export function FloorIcon({ className }: IconProps) {
  return <SvgIcon svg={floorSvg} className={className} />
}

export function VisibilityIcon({ className }: IconProps) {
  return <SvgIcon svg={visibilitySvg} className={className} />
}

export function PanelSelectorIcon({ className }: IconProps) {
  return <SvgIcon svg={panelSelectorSvg} className={className} />
}

export function PanelSettingsIcon({ className }: IconProps) {
  return <SvgIcon svg={panelSettingsSvg} className={className} />
}

export function RewireIcon({ className }: IconProps) {
  return <SvgIcon svg={rewireSvg} className={className} />
}

export function WiringIcon({ className }: IconProps) {
  return <SvgIcon svg={wiringSvg} className={className} />
}

export function AutoArrangeIcon({ className }: IconProps) {
  return <SvgIcon svg={autoArrangeSvg} className={className} />
}

export function QuickPlacerIcon({ className }: IconProps) {
  return <SvgIcon svg={quickPlacerSvg} className={className} />
}

export function LibraryIcon({ className }: IconProps) {
  return <SvgIcon svg={librarySvg} className={className} />
}

export function DomoticaIcon({ className }: IconProps) {
  return <SvgIcon svg={domoticaSvg} className={className} />
}

export function UndoIcon({ className }: IconProps) {
  return <SvgIcon svg={undoSvg} className={className} />
}

export function RedoIcon({ className }: IconProps) {
  return <SvgIcon svg={redoSvg} className={className} />
}

function StrokeIcon({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? 'w-6 h-6'}
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function HardwareTallyIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
      />
    </StrokeIcon>
  )
}

export function ExportPdfIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </StrokeIcon>
  )
}

export function ProjectDownloadIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
      />
    </StrokeIcon>
  )
}

export function ValidationMenuIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </StrokeIcon>
  )
}

export function MenuIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 6h16M4 12h16M4 18h16"
      />
    </StrokeIcon>
  )
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </StrokeIcon>
  )
}

export function ShortcutsIcon({ className }: IconProps) {
  return (
    <StrokeIcon className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z"
      />
    </StrokeIcon>
  )
}

export function QuickPlacerSlowIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? 'w-6 h-6'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3.5C12 3.5 6.5 9.4 6.5 13.2A5.5 5.5 0 0 0 12 18.7a5.5 5.5 0 0 0 5.5-5.5C17.5 9.4 12 3.5 12 3.5Z" />
      <path d="M9.6 14.2a2.6 2.6 0 0 0 2.4 1.5" />
    </svg>
  )
}

export function QuickPlacerFastIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? 'w-6 h-6'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13 2.5 6.5 12h4l-1 9.5 8-11h-4.5L13 2.5Z" />
    </svg>
  )
}
