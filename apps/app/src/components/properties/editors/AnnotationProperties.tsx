import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { DebouncedTextInput } from '@/components/forms'
import CustomDropdown from '@/components/common/CustomDropdown'
import { calculatePxPerMeter } from '@/hooks/plan/usePlanScale'
import { resolveFrameContentItems } from '@/lib/eendraad/frameContent'
import { getPlanGraphicElementAsset } from '@/lib/plan/graphicElements'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import type { Floor, Frame, Note, PlanGraphicElement } from '@/types/schema'
import { NoteEditor } from '../NoteEditor'
import { labelClass, selectClass } from '../shared/propertiesSharedUtils'
export function NoteProperties({
  noteId,
  note,
  onUpdate,
}: {
  noteId: string
  note: Note | undefined
  onUpdate: (id: string, updates: Partial<Note>) => void
}) {
  const { t } = useTranslation()

  if (!note) {
    return (
      <div className="p-4 text-center text-gray-500">{t('notes.notFound', 'Note not found')}</div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <label className={labelClass}>{t('notes.formatting', 'Text Formatting')}</label>
        <NoteEditor
          content={note.text ?? ''}
          defaultFontSize={note.fontSize}
          onUpdate={(html) => onUpdate(noteId, { text: html })}
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          {t('notes.formattingHint', 'Select text and use formatting buttons')}
        </p>
      </div>
    </div>
  )
}

export function FrameProperties({
  frameId,
  frame,
  onUpdate,
}: {
  frameId: string
  frame: Frame | undefined
  onUpdate: (id: string, updates: Partial<Frame>) => void
}) {
  const { t } = useTranslation()
  const currentProject = useProjectStore((s: ProjectState) => s.currentProject)
  const resolvedMemberCount = useMemo(() => {
    if (!frame) return 0
    return resolveFrameContentItems(frame, currentProject ?? undefined).length
  }, [frame, currentProject])

  if (!frame) {
    return (
      <div className="p-4 text-center text-gray-500">{t('frames.notFound', 'Frame not found')}</div>
    )
  }

  const inputClass =
    'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500'
  const selectClass =
    'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-sky-500'

  return (
    <div className="space-y-4">
      <div>
        <label className={labelClass}>{t('frames.frameTitle', 'Title')}</label>
        <DebouncedTextInput
          type="text"
          value={frame.title}
          onCommit={(v) => onUpdate(frameId, { title: v })}
          className={inputClass}
          placeholder={t('frames.titlePlaceholder', 'Enter frame title...')}
        />
      </div>

      <div>
        <label className={labelClass}>{t('frames.titlePosition', 'Title Position')}</label>
        <CustomDropdown
          value={frame.titlePosition || 'inside'}
          onChange={(nextValue) =>
            onUpdate(frameId, { titlePosition: nextValue as 'inside' | 'outside' })
          }
          options={[
            { value: 'inside', label: t('frames.titlePositionInside', 'Inside') },
            { value: 'outside', label: t('frames.titlePositionOutside', 'Outside') },
          ]}
          className={selectClass}
        />
      </div>

      <div>
        <label className={labelClass}>{t('frames.fontSize', 'Title Font Size')}</label>
        <input
          type="number"
          value={frame.fontSize}
          onChange={(e) => {
            const size = Math.max(6, Math.min(24, parseInt(e.target.value) || 10))
            onUpdate(frameId, { fontSize: size })
          }}
          min={6}
          max={24}
          className={inputClass}
        />
      </div>

      <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-md">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('frames.contentInfo', 'This frame groups {{count}} {{type}} items', {
            count: resolvedMemberCount,
            type: t(`frames.contentType_${frame.contentType}`, frame.contentType),
          })}
        </p>
      </div>
    </div>
  )
}

export function GraphicElementProperties({
  element,
  floor,
  readOnly,
  onUpdate,
}: {
  element: PlanGraphicElement
  floor: Floor
  readOnly?: boolean
  onUpdate: (id: string, updates: Partial<PlanGraphicElement>) => void
}) {
  const { t } = useTranslation()
  const asset = getPlanGraphicElementAsset(element.assetId)
  const pxPerMeter = calculatePxPerMeter(floor) ?? 100
  const widthCm = pxPerMeter > 0 ? (element.width / pxPerMeter) * 100 : element.width
  const heightCm = pxPerMeter > 0 ? (element.height / pxPerMeter) * 100 : element.height
  const sizeLocked = element.sizeLocked || asset?.sizeLocked

  const commitCentimeters = (field: 'width' | 'height', value: string) => {
    if (sizeLocked) return
    const parsed = Number.parseFloat(value.replace(',', '.'))
    if (!Number.isFinite(parsed) || parsed <= 0 || pxPerMeter <= 0) return
    onUpdate(element.id, { [field]: (parsed / 100) * pxPerMeter })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800">
        {asset && <img src={asset.svgPath} alt="" className="h-10 w-10 object-contain" />}
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {asset
              ? t(asset.labelKey, asset.label)
              : t('floorPlanTools.graphicElements', 'Graphic elements')}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {sizeLocked
              ? t('planGraphic.sizeLocked', 'Fixed size')
              : t('planGraphic.resizable', 'Resizable')}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>{t('planGraphic.width', 'Width (cm)')}</label>
          <DebouncedTextInput
            type="number"
            value={String(Math.round(widthCm * 10) / 10)}
            disabled={readOnly || sizeLocked}
            onCommit={(value) => commitCentimeters('width', value)}
            className={selectClass}
          />
        </div>
        <div>
          <label className={labelClass}>{t('planGraphic.length', 'Length (cm)')}</label>
          <DebouncedTextInput
            type="number"
            value={String(Math.round(heightCm * 10) / 10)}
            disabled={readOnly || sizeLocked}
            onCommit={(value) => commitCentimeters('height', value)}
            className={selectClass}
          />
        </div>
      </div>

      <div>
        <label className={labelClass}>{t('planGraphic.rotation', 'Rotation (degrees)')}</label>
        <DebouncedTextInput
          type="number"
          value={String(Math.round((element.rotationDeg ?? 0) * 10) / 10)}
          disabled={readOnly}
          onCommit={(value) => {
            const parsed = Number.parseFloat(value.replace(',', '.'))
            if (Number.isFinite(parsed)) onUpdate(element.id, { rotationDeg: parsed })
          }}
          className={selectClass}
        />
      </div>
    </div>
  )
}



