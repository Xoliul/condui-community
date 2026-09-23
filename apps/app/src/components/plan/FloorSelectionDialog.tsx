import { useState, useEffect, useRef, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { GripVertical, Plus, Trash2, Pencil, Check, X, Eye, EyeOff, Copy } from 'lucide-react'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { useDialogStore } from '@/stores/dialogStore'
import type { Floor } from '@/types/schema'
import { generateId } from '@/utils'
import { readLegacyCompatibilityFloors } from '@/lib/projectV2/buildingFloors'
import { duplicateFloorPlan } from '@/lib/plan/duplicateFloorPlan'
import ContextMenuPortal from '@/components/canvas/ContextMenuPortal'

interface FloorSelectionDialogProps {
  currentFloorId: string | null
  /**
   * Which floor row shows the “selected” highlight in the list.
   * Omit to use `currentFloorId` (floor picker, plan move-to-floor on the active plan).
   * Pass `null` to highlight no row (e.g. one-wire move when the endpoint is already on the active floor).
   */
  listHighlightFloorId?: string | null
  /** When true, show eye toggles to underlay other floors while drawing (plan draw mode only). */
  showReferenceOverlayToggles?: boolean
  /** When true, floor rows expose a context-menu action to duplicate their plan. */
  allowFloorDuplication?: boolean
  readOnly?: boolean
  onSelect: (floorId: string, options?: { closeMenu?: boolean; fitToView?: boolean }) => void
  onCancel: () => void
}

function FloorSelectionDialog({
  currentFloorId,
  listHighlightFloorId,
  showReferenceOverlayToggles = false,
  allowFloorDuplication = false,
  readOnly = false,
  onSelect,
  onCancel,
}: FloorSelectionDialogProps) {
  const { t } = useTranslation()
  const currentProject = useProjectStore((s: ProjectState) => s.currentProject)
  const addFloor = useProjectStore((s: ProjectState) => s.addFloor)
  const updateFloor = useProjectStore((s: ProjectState) => s.updateFloor)
  const deleteFloor = useProjectStore((s: ProjectState) => s.deleteFloor)
  const reorderFloors = useProjectStore((s: ProjectState) => s.reorderFloors)
  const togglePlanFloorOverlayFloor = useProjectStore(
    (s: ProjectState) => s.togglePlanFloorOverlayFloor
  )
  const overlayByBase = useProjectStore((s: ProjectState) => s.planFloorOverlayVisibleByBaseFloorId)
  const openDialog = useDialogStore((s: ReturnType<typeof useDialogStore.getState>) => s.openDialog)
  const floors = currentProject ? readLegacyCompatibilityFloors(currentProject) : []
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [newFloorName, setNewFloorName] = useState('')
  const [editingFloorId, setEditingFloorId] = useState<string | null>(null)
  const [editingFloorName, setEditingFloorName] = useState('')
  const [draggingFloorId, setDraggingFloorId] = useState<string | null>(null)
  const [duplicateSourceFloorId, setDuplicateSourceFloorId] = useState<string | null>(null)
  const [floorContextMenu, setFloorContextMenu] = useState<{
    floorId: string
    position: { x: number; y: number }
  } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // When there are no floors, show create form
  useEffect(() => {
    if (!readOnly && floors.length === 0) {
      setIsCreatingNew(true)
    }
  }, [floors.length, readOnly])

  // Focus input when creating new floor
  useEffect(() => {
    if (isCreatingNew && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isCreatingNew])

  const handleAddConfirm = () => {
    if (!newFloorName.trim()) return
    const newFloorId = generateId()
    const sourceFloor = duplicateSourceFloorId
      ? floors.find((floor) => floor.id === duplicateSourceFloorId)
      : undefined
    addFloor(
      sourceFloor
        ? duplicateFloorPlan(sourceFloor, newFloorId, newFloorName.trim())
        : {
            id: newFloorId,
            name: newFloorName.trim(),
          },
    )
    onSelect(newFloorId)
    setIsCreatingNew(false)
    setNewFloorName('')
    setDuplicateSourceFloorId(null)
  }

  const cancelCreate = () => {
    setIsCreatingNew(false)
    setNewFloorName('')
    setDuplicateSourceFloorId(null)
  }

  const handleFloorContextMenu = (event: ReactMouseEvent<HTMLLIElement>, floorId: string) => {
    if (!allowFloorDuplication || readOnly) return
    event.preventDefault()
    event.stopPropagation()
    setFloorContextMenu({
      floorId,
      position: { x: event.clientX, y: event.clientY },
    })
  }

  const startDuplicateFloor = () => {
    if (!floorContextMenu) return
    const sourceFloor = floors.find((floor) => floor.id === floorContextMenu.floorId)
    setFloorContextMenu(null)
    if (!sourceFloor) return
    setDuplicateSourceFloorId(sourceFloor.id)
    setNewFloorName('')
    setIsCreatingNew(true)
  }

  const handleDragStart = (floorId: string, e: DragEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    setDraggingFloorId(floorId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', floorId)
  }

  const handleDragEnterRow = (targetFloorId: string) => {
    if (!draggingFloorId || draggingFloorId === targetFloorId) return
    const fromIndex = floors.findIndex((f: Floor) => f.id === draggingFloorId)
    const toIndex = floors.findIndex((f: Floor) => f.id === targetFloorId)
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return
    reorderFloors(fromIndex, toIndex)
  }

  const resetDragging = () => setDraggingFloorId(null)

  const handleDeleteFloorById = (floorId: string) => {
    if (floors.length <= 1) return
    const floor = floors.find((f: Floor) => f.id === floorId)
    if (!floor) return
    const floorIndex = floors.findIndex((f: Floor) => f.id === floor.id)
    const nextFloorId =
      floorIndex > 0
        ? floors[floorIndex - 1]?.id
        : floors.length > 1
          ? floors[1]?.id
          : null

    openDialog({
      type: 'confirm',
      variant: 'danger',
      title: t('floorSelection.deleteConfirmTitle'),
      message: t('floorSelection.deleteConfirmMessage', { name: floor.name }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      onConfirm: () => {
        deleteFloor(floor.id)
        if (floor.id === currentFloorId && nextFloorId) {
          onSelect(nextFloorId, { closeMenu: false, fitToView: true })
        }
        if (editingFloorId === floor.id) {
          setEditingFloorId(null)
          setEditingFloorName('')
        }
        useDialogStore.getState().closeDialog()
      },
      onCancel: () => useDialogStore.getState().closeDialog(),
    })
  }

  const startRenameFloor = (floorId: string, currentName: string) => {
    setEditingFloorId(floorId)
    setEditingFloorName(currentName)
  }

  const commitRenameFloor = () => {
    if (!editingFloorId) return
    const trimmed = editingFloorName.trim()
    if (!trimmed) return
    updateFloor(editingFloorId, { name: trimmed })
    setEditingFloorId(null)
    setEditingFloorName('')
  }

  const cancelRenameFloor = () => {
    setEditingFloorId(null)
    setEditingFloorName('')
  }

  // No floors: create first floor
  if (floors.length === 0) {
    if (readOnly) {
      return (
        <div className="p-3 text-sm text-gray-600 dark:text-gray-400">
          {t('floorSelection.noFloors')}
        </div>
      )
    }
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('floorSelection.noFloors')}
        </p>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('floorSelection.floorName')}
          </label>
          <input
            ref={inputRef}
            type="text"
            name="floor-name-create"
            autoComplete="new-password"
            data-1p-ignore="true"
            data-lpignore="true"
            value={newFloorName}
            onChange={(e) => setNewFloorName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newFloorName.trim()) handleAddConfirm()
            }}
            placeholder={t('floorSelection.floorNamePlaceholder')}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleAddConfirm}
            disabled={!newFloorName.trim()}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium rounded-md transition-colors"
          >
            {t('common.ok')}
          </button>
        </div>
      </div>
    )
  }

  // Add new floor form (same interface as before)
  if (isCreatingNew) {
    return (
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('floorSelection.floorName')}
          </label>
          <input
            ref={inputRef}
            type="text"
            name="floor-name-create"
            autoComplete="new-password"
            data-1p-ignore="true"
            data-lpignore="true"
            value={newFloorName}
            onChange={(e) => setNewFloorName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newFloorName.trim()) handleAddConfirm()
              else if (e.key === 'Escape') {
                cancelCreate()
              }
            }}
            placeholder={t('floorSelection.floorNamePlaceholder')}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-sky-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={() => {
              cancelCreate()
            }}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            {t('common.back')}
          </button>
          <button
            onClick={handleAddConfirm}
            disabled={!newFloorName.trim()}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-medium rounded-md transition-colors"
          >
            {t('common.ok')}
          </button>
        </div>
      </div>
    )
  }

  const rowHighlightFloorId = listHighlightFloorId !== undefined ? listHighlightFloorId : currentFloorId

  // List of floors: select one to view, reorder, add/delete at bottom
  return (
    <div className="space-y-4">
      <ul className="space-y-1 max-h-[min(60vh,calc(100vh-18rem))] overflow-y-auto rounded-md border border-gray-200 dark:border-gray-600 p-1">
        {floors.map((floor: Floor) => {
          const isSelected = rowHighlightFloorId != null && floor.id === rowHighlightFloorId
          const isEditing = floor.id === editingFloorId
          const isOnlyFloor = floors.length <= 1
          const isDragging = floor.id === draggingFloorId
          const overlayOn =
            !!currentFloorId &&
            showReferenceOverlayToggles &&
            !isSelected &&
            (overlayByBase[currentFloorId] ?? []).includes(floor.id)
          return (
            <li
              key={floor.id}
              data-floor-selection-row={allowFloorDuplication && !readOnly ? 'true' : undefined}
              className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-sky-100 dark:bg-sky-900/40 border border-sky-300 dark:border-sky-700 ring-1 ring-sky-200 dark:ring-sky-800'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700/50 border border-transparent'
              } ${isDragging ? 'ring-2 ring-sky-400/70 dark:ring-sky-700/80' : ''}`}
              onClick={() => {
                setFloorContextMenu(null)
                onSelect(floor.id)
              }}
              onContextMenu={(event) => handleFloorContextMenu(event, floor.id)}
              onDragOver={(e) => e.preventDefault()}
              onDragEnter={() => handleDragEnterRow(floor.id)}
              onDrop={(e) => {
                e.preventDefault()
                e.stopPropagation()
                resetDragging()
              }}
            >
              <div className="shrink-0">
                <button
                  type="button"
                  draggable={!readOnly && !isEditing}
                  onDragStart={(e) => handleDragStart(floor.id, e)}
                  onDragEnd={resetDragging}
                  onClick={(e) => e.stopPropagation()}
                  disabled={readOnly || isEditing}
                  className="p-1 rounded text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 cursor-grab active:cursor-grabbing disabled:opacity-30 disabled:pointer-events-none"
                  aria-label={t('floorSelection.reorder', 'Reorder floor')}
                  title={t('floorSelection.reorder', 'Reorder floor')}
                >
                  <GripVertical className="w-4 h-4" />
                </button>
              </div>
              {isEditing ? (
                <input
                  autoFocus
                  type="text"
                  name="floor-name-rename"
                  autoComplete="new-password"
                  data-1p-ignore="true"
                  data-lpignore="true"
                  value={editingFloorName}
                  onChange={(e) => setEditingFloorName(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitRenameFloor()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      cancelRenameFloor()
                    }
                  }}
                  className="flex-1 min-w-0 px-2 py-1 text-sm border border-sky-300 dark:border-sky-700 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-transparent"
                />
              ) : (
                <span className="flex-1 min-w-0 truncate font-medium text-gray-900 dark:text-white">
                  {floor.name}
                </span>
              )}
              {isEditing ? (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      commitRenameFloor()
                    }}
                    disabled={!editingFloorName.trim()}
                    className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900/30 disabled:opacity-40 disabled:pointer-events-none text-green-700 dark:text-green-400"
                    aria-label={t('common.save')}
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      cancelRenameFloor()
                    }}
                    className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
                    aria-label={t('common.cancel')}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1 shrink-0">
                  {showReferenceOverlayToggles && !isSelected && currentFloorId && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        togglePlanFloorOverlayFloor(currentFloorId, floor.id)
                      }}
                      className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 ${
                        overlayOn
                          ? 'text-sky-600 dark:text-sky-400'
                          : 'text-gray-500 dark:text-gray-500'
                      }`}
                      aria-label={
                        overlayOn
                          ? t('floorSelection.referenceOverlayHide')
                          : t('floorSelection.referenceOverlayShow')
                      }
                      title={
                        overlayOn
                          ? t('floorSelection.referenceOverlayHide')
                          : t('floorSelection.referenceOverlayShow')
                      }
                    >
                      {overlayOn ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                  )}
                  {!readOnly && <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      startRenameFloor(floor.id, floor.name)
                    }}
                    className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-400"
                    aria-label={t('common.edit')}
                  >
                    <Pencil className="w-4 h-4" />
                  </button>}
                  {!readOnly && <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteFloorById(floor.id)
                    }}
                    disabled={isOnlyFloor}
                    className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 disabled:opacity-35 disabled:pointer-events-none text-red-600 dark:text-red-400"
                    aria-label={t('floorSelection.delete')}
                    title={isOnlyFloor ? t('floorSelection.cannotDeleteLast') : t('floorSelection.delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {!readOnly && <div className="flex gap-2 border-t border-gray-200 dark:border-gray-700 pt-2">
        <button
          type="button"
          onClick={() => setIsCreatingNew(true)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-sm font-medium text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-colors"
        >
          <Plus className="w-4 h-4 shrink-0" />
          {t('floorSelection.add')}
        </button>
      </div>}

      {floorContextMenu && (
        <ContextMenuPortal
          position={floorContextMenu.position}
          items={[
            {
              label: t('contextMenu.duplicate'),
              icon: <Copy className="w-4 h-4" />,
              onClick: startDuplicateFloor,
            },
          ]}
          onClose={() => setFloorContextMenu(null)}
        />
      )}
    </div>
  )
}

export default FloorSelectionDialog
