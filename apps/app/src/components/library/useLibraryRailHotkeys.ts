import { useEffect, useRef, type RefObject } from 'react'
import { libraryRailGroupForKeyCode } from '@/lib/library/libraryRailHotkeys'
import type { LibraryRailGroupKey } from '@/lib/library/libraryRailGroups'
import { isKeyboardTypingTarget } from '@/lib/ui/keyboardTypingTarget'

/**
 * Top-row letter keys jump to a library rail group while the pointer is over the library,
 * the same hover scoping the canvases use for their letter keys. Shift adds the group.
 * `onGroup` returns false when the group is not available in the current view.
 */
export function useLibraryRailHotkeys(
  rootRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  onGroup: (key: LibraryRailGroupKey, additive: boolean) => boolean
) {
  const onGroupRef = useRef(onGroup)
  useEffect(() => {
    onGroupRef.current = onGroup
  })

  useEffect(() => {
    const root = rootRef.current
    if (!enabled || !root) return
    let hovered = root.matches(':hover')
    const handleEnter = () => {
      hovered = true
    }
    const handleLeave = () => {
      hovered = false
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!hovered || event.defaultPrevented || event.repeat) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isKeyboardTypingTarget(event.target)) return
      const key = libraryRailGroupForKeyCode(event.code)
      if (key && onGroupRef.current(key, event.shiftKey)) event.preventDefault()
    }
    root.addEventListener('pointerenter', handleEnter)
    root.addEventListener('pointerleave', handleLeave)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      root.removeEventListener('pointerenter', handleEnter)
      root.removeEventListener('pointerleave', handleLeave)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [enabled, rootRef])
}
