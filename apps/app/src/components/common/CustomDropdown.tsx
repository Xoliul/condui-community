import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { useCanvasWindow } from '@/components/viewport/ViewportContext'

export type CustomDropdownOption = {
  value: string
  label: string
  /** Explanation shown on hover and exposed to assistive technology. */
  title?: string
  /** Shown but not selectable; `title` carries the reason. */
  disabled?: boolean
  icon?: React.ReactNode
  textClassName?: string
  isBold?: boolean
}

interface CustomDropdownProps {
  value: string
  onChange: (value: string) => void
  options: CustomDropdownOption[]
  id?: string
  placeholder?: string
  ariaLabel?: string
  className?: string
  menuClassName?: string
  /** When true, shows the control styled like the dropdown but does not open a menu. */
  disabled?: boolean
  /** Show complete selected and menu labels in compact property fields. */
  wrapLabels?: boolean
  onPointerDown?: () => void
  renderValue?: (option: CustomDropdownOption | undefined) => React.ReactNode
  renderOption?: (option: CustomDropdownOption, isActive: boolean) => React.ReactNode
  /** When 'bottom', always opens below the control (e.g. inside dialogs with content above). */
  menuPlacement?: 'auto' | 'bottom'
  /** Render the menu in a body portal so overflow:hidden ancestors (dialogs) do not clip it. */
  menuPortal?: boolean
  /** Called when the pointer highlights a menu option, or null when highlight clears. */
  onOptionHover?: (value: string | null) => void
}

const defaultControlClassName =
  'w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500'

/** Default cap for menu height (matches former max-h-72) */
const MENU_MAX_HEIGHT_PX = 288

const MIN_MENU_HEIGHT_PX = 80

const defaultMenuClassName =
  'w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800'

const MENU_TRANSITION_MS = 100

type ClippingRect = { top: number; left: number; right: number; bottom: number }

function shouldUseNativeMobileSelect(ownerWindow: Window): boolean {
  if (typeof ownerWindow === 'undefined') return false
  const coarsePointer = ownerWindow.matchMedia('(pointer: coarse)').matches
  if (!coarsePointer) return false

  const width = ownerWindow.innerWidth
  const height = ownerWindow.innerHeight

  // Keep iPad/tablet widths on the custom dropdown. Phones get the native OS picker:
  // portrait phones are narrow, landscape phones are short and still below tablet width.
  return width < 768 || (height < 500 && width < 950)
}

function getVisualViewportRect(ownerWindow: Window): ClippingRect {
  const vv = ownerWindow.visualViewport
  if (!vv) {
    return { top: 0, left: 0, right: ownerWindow.innerWidth, bottom: ownerWindow.innerHeight }
  }
  return {
    top: vv.offsetTop,
    left: vv.offsetLeft,
    right: vv.offsetLeft + vv.width,
    bottom: vv.offsetTop + vv.height,
  }
}

function isOverflowClipping(value: string): boolean {
  return /^(auto|scroll|hidden|clip)/.test(value)
}

/**
 * Intersect the visual viewport with overflow clipping ancestors (scroll/hidden/auto),
 * similar to native popovers staying inside scrollable panels.
 */
function getClippingRect(container: HTMLElement): ClippingRect {
  const ownerWindow = container.ownerDocument.defaultView ?? window
  let clip: ClippingRect = getVisualViewportRect(ownerWindow)
  let el: HTMLElement | null = container.parentElement
  while (el) {
    const s = ownerWindow.getComputedStyle(el)
    if (isOverflowClipping(s.overflowX) || isOverflowClipping(s.overflowY)) {
      const r = el.getBoundingClientRect()
      clip = {
        top: Math.max(clip.top, r.top),
        left: Math.max(clip.left, r.left),
        right: Math.min(clip.right, r.right),
        bottom: Math.min(clip.bottom, r.bottom),
      }
    }
    el = el.parentElement
  }
  return clip
}

const MENU_PORTAL_Z_INDEX = 1200

function computeMenuPlacement(args: {
  containerRect: DOMRectReadOnly
  clip: ClippingRect
  menuScrollHeight: number
  menuWidth: number
  gap: number
  forceDownward?: boolean
}): {
  openUpward: boolean
  shiftX: number
  maxHeightPx: number
  fixedTop: number
  fixedLeft: number
  fixedWidth: number
} {
  const { containerRect: c, clip, menuScrollHeight, gap, forceDownward } = args

  const spaceBelow = clip.bottom - c.bottom - gap
  const spaceAbove = c.top - clip.top - gap

  const idealHeight = Math.min(menuScrollHeight, MENU_MAX_HEIGHT_PX)

  let openUpward: boolean
  if (forceDownward) {
    openUpward = false
  } else if (spaceBelow >= idealHeight) {
    openUpward = false
  } else if (spaceAbove >= idealHeight) {
    openUpward = true
  } else {
    openUpward = spaceAbove > spaceBelow
  }

  const available = openUpward ? spaceAbove : spaceBelow
  const maxHeightPx = Math.max(
    MIN_MENU_HEIGHT_PX,
    Math.min(MENU_MAX_HEIGHT_PX, Math.floor(available))
  )

  const fixedWidth = c.width
  const fixedLeft = Math.min(
    Math.max(c.left, clip.left + gap),
    Math.max(clip.left + gap, clip.right - gap - fixedWidth)
  )
  const shiftX = fixedLeft - c.left
  const fixedTop = openUpward
    ? Math.max(clip.top + gap, c.top - gap - maxHeightPx)
    : c.bottom + gap

  return { openUpward, shiftX, maxHeightPx, fixedTop, fixedLeft, fixedWidth }
}

export default function CustomDropdown({
  value,
  onChange,
  options,
  id,
  placeholder = 'Select',
  ariaLabel,
  className = defaultControlClassName,
  menuClassName = defaultMenuClassName,
  disabled = false,
  wrapLabels = false,
  onPointerDown,
  renderValue,
  renderOption,
  menuPlacement = 'auto',
  menuPortal = false,
  onOptionHover,
}: CustomDropdownProps) {
  const ownerWindow = useCanvasWindow()
  const ownerDocument = ownerWindow.document
  const [isOpen, setIsOpen] = useState(false)
  const [openUpward, setOpenUpward] = useState(false)
  const [menuEnter, setMenuEnter] = useState(false)
  const [menuShiftX, setMenuShiftX] = useState(0)
  const [menuMaxHeightPx, setMenuMaxHeightPx] = useState(MENU_MAX_HEIGHT_PX)
  const [menuFixedStyle, setMenuFixedStyle] = useState<{
    top: number
    left: number
    width: number
  } | null>(null)
  const [useNativeSelect, setUseNativeSelect] = useState(() => shouldUseNativeMobileSelect(ownerWindow))
  const containerRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [previousDisabled, setPreviousDisabled] = useState(disabled)
  if (previousDisabled !== disabled) {
    setPreviousDisabled(disabled)
    if (disabled) setIsOpen(false)
  }
  const [previousOpen, setPreviousOpen] = useState(isOpen)
  if (previousOpen !== isOpen) {
    setPreviousOpen(isOpen)
    if (!isOpen) {
      setOpenUpward(false)
      setMenuEnter(false)
      setMenuShiftX(0)
      setMenuMaxHeightPx(MENU_MAX_HEIGHT_PX)
      setMenuFixedStyle(null)
    }
  }

  useEffect(() => {
    const updateMode = () => setUseNativeSelect(shouldUseNativeMobileSelect(ownerWindow))
    updateMode()
    ownerWindow.addEventListener('resize', updateMode)
    ownerWindow.visualViewport?.addEventListener('resize', updateMode)
    return () => {
      ownerWindow.removeEventListener('resize', updateMode)
      ownerWindow.visualViewport?.removeEventListener('resize', updateMode)
    }
  }, [ownerWindow])

  useEffect(() => {
    if (!isOpen) onOptionHover?.(null)
  }, [isOpen, onOptionHover])

  useLayoutEffect(() => {
    if (!isOpen) {
      return
    }

    let raf1 = 0
    let raf2 = 0

    const runMeasure = (withEnterAnimation: boolean) => {
      const container = containerRef.current
      if (!container) return

      const c = container.getBoundingClientRect()
      const clip = menuPortal ? getVisualViewportRect(ownerWindow) : getClippingRect(container)
      const menu = menuRef.current

      if (!menu) {
        if (menuPortal) {
          const gap = 4
          setOpenUpward(false)
          setMenuShiftX(0)
          setMenuMaxHeightPx(MENU_MAX_HEIGHT_PX)
          setMenuFixedStyle({
            top: c.bottom + gap,
            left: c.left,
            width: c.width,
          })
        }
        return
      }

      const mw = menu.getBoundingClientRect().width || c.width
      const {
        openUpward: up,
        shiftX,
        maxHeightPx,
        fixedTop,
        fixedLeft,
        fixedWidth,
      } = computeMenuPlacement({
        containerRect: c,
        clip,
        menuScrollHeight: menu.scrollHeight,
        menuWidth: mw,
        gap: 4,
        forceDownward: menuPlacement === 'bottom',
      })

      setOpenUpward(up)
      setMenuShiftX(shiftX)
      setMenuMaxHeightPx(maxHeightPx)
      setMenuFixedStyle({ top: fixedTop, left: fixedLeft, width: fixedWidth })

      if (withEnterAnimation) {
        setMenuEnter(false)
        ownerWindow.cancelAnimationFrame(raf1)
        ownerWindow.cancelAnimationFrame(raf2)
        raf1 = ownerWindow.requestAnimationFrame(() => {
          raf2 = ownerWindow.requestAnimationFrame(() => setMenuEnter(true))
        })
      }
    }

    runMeasure(true)

    const onViewportChange = () => runMeasure(false)
    ownerWindow.addEventListener('scroll', onViewportChange, true)
    const vv = ownerWindow.visualViewport
    vv?.addEventListener('resize', onViewportChange)
    vv?.addEventListener('scroll', onViewportChange)

    return () => {
      ownerWindow.removeEventListener('scroll', onViewportChange, true)
      vv?.removeEventListener('resize', onViewportChange)
      vv?.removeEventListener('scroll', onViewportChange)
      ownerWindow.cancelAnimationFrame(raf1)
      ownerWindow.cancelAnimationFrame(raf2)
    }
  }, [isOpen, options, menuPlacement, menuPortal, ownerWindow])

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (containerRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setIsOpen(false)
    }

    ownerDocument.addEventListener('mousedown', handleClickOutside)
    ownerDocument.addEventListener('touchstart', handleClickOutside)

    return () => {
      ownerDocument.removeEventListener('mousedown', handleClickOutside)
      ownerDocument.removeEventListener('touchstart', handleClickOutside)
    }
  }, [isOpen, ownerDocument])

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value]
  )

  const toggleOpen = () => {
    setIsOpen((open) => !open)
  }

  const controlInner = (
    <>
      <span className={`min-w-0 flex-1 ${wrapLabels ? 'whitespace-normal [overflow-wrap:anywhere]' : 'truncate'}`}>
        {renderValue ? renderValue(selectedOption) : selectedOption?.label ?? placeholder}
      </span>
      <ChevronDown
        data-custom-dropdown-chevron="true"
        className={`pointer-events-none absolute right-1 top-1/2 h-5 w-3.5 -translate-y-1/2 text-gray-700 dark:text-gray-100 transition-transform duration-100 ease-out ${
          isOpen ? 'rotate-180' : ''
        } ${disabled ? 'opacity-50' : ''}`}
        strokeWidth={2.5}
      />
    </>
  )

  if (disabled) {
    return (
      <div className="relative" ref={containerRef}>
        <div
          id={id}
          data-custom-dropdown-control="true"
          className={`${className} relative flex items-center pr-8 text-left cursor-default`}
          aria-disabled="true"
          aria-label={ariaLabel ?? placeholder}
          title={selectedOption?.title}
        >
          {controlInner}
        </div>
      </div>
    )
  }

  if (useNativeSelect) {
    return (
      <div className="relative" ref={containerRef}>
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onPointerDown={onPointerDown}
          className={`${className} relative appearance-none pr-8`}
          aria-label={ariaLabel ?? placeholder}
          title={selectedOption?.title}
        >
          {!selectedOption ? (
            <option value={value} disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value} title={option.title} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          data-custom-dropdown-chevron="true"
          className="pointer-events-none absolute right-1 top-1/2 h-5 w-3.5 -translate-y-1/2 text-gray-700 dark:text-gray-100"
          strokeWidth={2.5}
        />
      </div>
    )
  }

  const positionClass = openUpward ? 'bottom-full mb-1 origin-bottom' : 'top-full mt-1 origin-top'
  const enterFromClass = openUpward
    ? 'opacity-0 scale-[0.98] translate-y-1'
    : 'opacity-0 scale-[0.98] -translate-y-1'
  const enterToClass = 'opacity-100 scale-100 translate-y-0'

  const menuPanel = isOpen ? (
    <div
      ref={menuRef}
      role="listbox"
      tabIndex={-1}
      data-app-scroll="true"
      className={`${menuPortal ? 'fixed' : `absolute z-20 ${positionClass}`} ${menuClassName} transition-[opacity,transform] ease-out motion-reduce:transition-none ${
        menuEnter ? enterToClass : enterFromClass
      }`}
      style={{
        ...(menuPortal && menuFixedStyle
          ? {
              top: menuFixedStyle.top,
              left: menuFixedStyle.left,
              width: menuFixedStyle.width,
              zIndex: MENU_PORTAL_Z_INDEX,
            }
          : { left: menuShiftX }),
        maxHeight: menuMaxHeightPx,
        transitionDuration: `${MENU_TRANSITION_MS}ms`,
      }}
      onMouseLeave={() => onOptionHover?.(null)}
    >
      {options.map((option) => {
        const isActive = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={isActive}
            aria-disabled={option.disabled || undefined}
            title={option.title}
            aria-label={option.title ? `${option.label}: ${option.title}` : undefined}
            onMouseEnter={() => onOptionHover?.(option.value)}
            onClick={() => {
              if (option.disabled) return
              if (!isActive) onChange(option.value)
              setIsOpen(false)
            }}
            className={`flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors ${
              option.disabled
                ? 'cursor-not-allowed text-gray-400 dark:text-gray-500'
                : isActive
                ? 'bg-sky-50 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200'
                : 'text-gray-800 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700/60'
            }`}
          >
            <span className={`min-w-0 flex-1 ${wrapLabels ? 'whitespace-normal [overflow-wrap:anywhere]' : 'truncate'}`}>
              {renderOption ? renderOption(option, isActive) : option.label}
            </span>
          </button>
        )
      })}
    </div>
  ) : null

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        id={id}
        data-custom-dropdown-control="true"
        onPointerDown={onPointerDown}
        onClick={toggleOpen}
        className={`${className} relative flex items-center pr-8 text-left touch-manipulation select-none`}
        aria-label={ariaLabel ?? placeholder}
        title={selectedOption?.title}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        {controlInner}
      </button>
      {menuPortal && typeof document !== 'undefined'
        ? createPortal(menuPanel, ownerDocument.body)
        : menuPanel}
    </div>
  )
}
