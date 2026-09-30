import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Point } from '@/types/ui'
import {
  useFloorPlanDrawDimensionEditor,
  type FloorPlanDrawDimensionEditor,
  type FloorPlanDrawDimensionField,
} from './floorPlanDrawDimensionEditorStore'

function isValidDimensionText(text: string): boolean {
  return /^\d*(?:[.,]\d*)?$/.test(text)
}

interface FloorPlanDrawDimensionInputProps {
  pan: Point
  zoom: number
}

function FloorPlanDrawDimensionFieldInput({
  field,
  editor,
  pan,
  zoom,
}: FloorPlanDrawDimensionInputProps & {
  field: FloorPlanDrawDimensionField
  editor: FloorPlanDrawDimensionEditor
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!field.active) return
    const input = inputRef.current
    if (!input) return
    input.focus({ preventScroll: true })
    input.select()
  }, [field.active, field.id])

  // A live (untyped) value follows the pointer, and every re-render would make the
  // browser drop the selection and park the caret at the end. Re-select it so the
  // first typed character replaces the measurement instead of being appended to it.
  useLayoutEffect(() => {
    if (!field.active || !field.live) return
    const input = inputRef.current
    if (!input || input.ownerDocument.activeElement !== input) return
    input.select()
  }, [field.active, field.live, field.value])

  // The selection alone is not reliable: typing right after a pointer move can land
  // before the re-select. While the value is live, replace it outright instead.
  const liveRef = useRef(field.live)
  liveRef.current = field.live
  const replaceLiveValueRef = useRef<(text: string) => void>(() => undefined)
  replaceLiveValueRef.current = (text) => {
    if (isValidDimensionText(text)) editor.onChange(field.id, text)
  }
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    const handleBeforeInput = (event: InputEvent) => {
      if (!liveRef.current || event.inputType !== 'insertText' || event.data == null) return
      event.preventDefault()
      replaceLiveValueRef.current(event.data)
    }
    input.addEventListener('beforeinput', handleBeforeInput)
    return () => input.removeEventListener('beforeinput', handleBeforeInput)
  }, [])

  const transform =
    field.placement === 'above'
      ? `translate(-50%, calc(-100% - 6px)) rotate(${field.rotationDeg ?? 0}deg)`
      : field.placement === 'right'
        ? `translate(6px, -50%) rotate(${field.rotationDeg ?? 0}deg)`
        : `translate(-50%, -50%) rotate(${field.rotationDeg ?? 0}deg)`

  return (
    <label
      // The field is focused programmatically for keyboard entry. It must never
      // become a pointer target because it sits directly on top of the canvas
      // gesture being measured.
      className={`pointer-events-none absolute z-30 flex h-7 items-center overflow-hidden rounded-md border bg-gray-100 shadow-sm dark:bg-gray-900 ${
        field.active
          ? 'border-sky-600 ring-1 ring-sky-600/30'
          : 'border-gray-900 dark:border-gray-200'
      }`}
      style={{
        left: pan.x + field.anchor.x * zoom,
        top: pan.y + field.anchor.y * zoom,
        transform,
      }}
    >
      <input
        ref={inputRef}
        data-floor-plan-dimension-input="true"
        type="text"
        inputMode="decimal"
        value={field.value}
        onFocus={() => editor.onActivate(field.id)}
        onChange={(event) => {
          const next = event.target.value
          if (!isValidDimensionText(next)) return
          editor.onChange(field.id, next)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            event.preventDefault()
            editor.onTab()
          } else if (event.key === 'Enter') {
            event.preventDefault()
            editor.onEnter()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            editor.onEscape()
          }
          event.stopPropagation()
        }}
        className={`h-full min-w-12 bg-transparent px-2 text-right text-[13px] outline-none selection:bg-sky-200 selection:text-gray-950 dark:text-gray-100 dark:selection:bg-sky-700 dark:selection:text-white ${
          field.active ? 'text-sky-700 dark:text-sky-300' : 'text-gray-900'
        }`}
        style={{ width: `${Math.max(48, field.value.length * 8 + 16)}px` }}
      />
      <span className="pointer-events-none pr-2 text-[13px] text-gray-500 dark:text-gray-400">
        cm
      </span>
    </label>
  )
}

export function FloorPlanDrawDimensionInput(props: FloorPlanDrawDimensionInputProps) {
  const editor = useFloorPlanDrawDimensionEditor((state) => state.editor)
  if (!editor) return null

  return (
    <>
      {editor.fields.map((field) => (
        <FloorPlanDrawDimensionFieldInput key={field.id} {...props} editor={editor} field={field} />
      ))}
    </>
  )
}
