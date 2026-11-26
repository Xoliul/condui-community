import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveScanRoomNames } from '@/lib/plan/roomScanRooms'
import { ScanPlacementSymbol } from '@/components/documents/ScanPlacementSymbol'
import { RotateCcw, RotateCw } from 'lucide-react'
import { useSettingsStore } from '@/stores/settingsStore'
import { useProjectStore } from '@/stores/projectStore'
import { countRoomScanConsumerEndpoints } from '@/lib/plan/roomScanPlacementImport'
import { findMainPanel, walkPanels } from '@/lib/panel/panelTree'
import { isBoardPanel } from '@/lib/supplyTaps/virtualPanel'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { RoomPlan, prepareNativeRoomScanOptions } from '@/lib/native/roomPlan'
import { CommandError } from '@/lib/commands/project'
import { roomPlanScanSchema, type RoomPlanScanResult } from '@/lib/plan/roomPlanImport'
import {
  applyRoomPlanImport,
  prepareRoomPlanImport,
  rotateRoomPlanImportPreview,
  type RoomPlanImportPreview,
} from '@/handlers/plan/roomPlanScan'
import RoomPlanScanPreview from './RoomPlanScanPreview'

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  return typeof error.code === 'string' ? error.code : null
}

function importErrorKey(error: unknown): string {
  if (error instanceof CommandError) {
    if (error.code === 'stale_revision') return 'nativeRoomScan.stale'
    if (error.details?.reason === 'no_walls') return 'nativeRoomScan.noWalls'
    if (error.details?.reason === 'document_budget') return 'nativeRoomScan.documentBudget'
    if (error.details?.reason === 'floor_not_found') return 'nativeRoomScan.floorUnavailable'
  }
  return 'nativeRoomScan.importFailed'
}

type RoomPlanScanDialogProps = {
  floorId: string
  projectId: string
  source?: string
  onClose: () => void
}

export default function RoomPlanScanDialog({ floorId, projectId, source, onClose }: RoomPlanScanDialogProps) {
  const { t, i18n } = useTranslation()
  const project = useProjectStore((state) => state.currentProject)
  const panels = project ? [...walkPanels(getProjectElectricalPanels(project))].filter(isBoardPanel) : []
  const consumerCount = project ? countRoomScanConsumerEndpoints(project) : 0
  const [includePlacements, setIncludePlacements] = useState(() => consumerCount <= 3)
  const roomName = project?.building.floors.find((floor) => floor.id === floorId)?.name ?? ''
  const [roomNames, setRoomNames] = useState<Record<string, string>>({})
  const [panelId, setPanelId] = useState<string | undefined>(() => project ? findMainPanel(getProjectElectricalPanels(project))?.id : undefined)
  const [supported, setSupported] = useState<boolean | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scan, setScan] = useState<RoomPlanScanResult | null>(null)
  const [preview, setPreview] = useState<RoomPlanImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void RoomPlan.isSupported()
      .then(({ supported: available }) => { if (active) setSupported(available) })
      .catch(() => { if (active) setSupported(false) })
    return () => { active = false }
  }, [])

  const startScan = async () => {
    setScanning(true)
    setError(null)
    setScan(null)
    setPreview(null)
    try {
      const options = await prepareNativeRoomScanOptions(roomName.trim() || t('nativeRoomScan.roomNameDefault'), includePlacements, t, i18n.language, useSettingsStore.getState().theme.mode === 'dark' ? 'dark' : 'light')
      const result = roomPlanScanSchema.parse(await RoomPlan.scanRoom(options))
      setScan(result)
      const prepared = prepareRoomPlanImport(result, floorId, projectId, 0, { roomName, roomNames: {}, panelId })
      const names = resolveScanRoomNames(prepared.rooms, {}, (key) => t(key))
      setRoomNames(names)
      setPreview({ ...prepared, roomNames: names, invocation: { id: 'plan.importRoomScan', input: { floorId, origin: prepared.origin, scan: result, quarterTurns: 0, roomName, roomNames: names, panelId } } })
    } catch (scanError) {
      setError(scanError instanceof CommandError
        ? importErrorKey(scanError)
        : errorCode(scanError) === 'CANCELLED' ? 'nativeRoomScan.cancelled' : 'nativeRoomScan.failed')
    } finally {
      setScanning(false)
    }
  }

  const refreshPreview = () => {
    if (!scan) return
    try {
      setPreview(prepareRoomPlanImport(scan, floorId, projectId, preview?.quarterTurns ?? 0, { roomName, roomNames, panelId }))
      setError(null)
    } catch (previewError) { setError(importErrorKey(previewError)) }
  }

  const addScan = () => {
    if (!preview) return
    try {
      const names = resolveScanRoomNames(preview.rooms, roomNames, (key) => t(key))
      applyRoomPlanImport({ ...preview, invocation: { id: 'plan.importRoomScan', input: { floorId, origin: preview.origin, scan, quarterTurns: preview.quarterTurns, roomName, roomNames: names, panelId } } }, source)
      onClose()
    } catch (importError) { setError(importErrorKey(importError)) }
  }

  const updateDetails = (names: Record<string, string>, targetPanel: string | undefined) => {
    setRoomNames(names); setPanelId(targetPanel)
    setPreview((current) => current && scan ? {
      ...current, roomNames: names, panelId: targetPanel,
      invocation: { id: 'plan.importRoomScan', input: {
        floorId: current.floorId, origin: current.origin, scan, quarterTurns: current.quarterTurns,
        roomName, roomNames: names, panelId: targetPanel,
      } },
    } : current)
  }
  const format = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 })
  return (
    <div className="space-y-4" data-testid="room-plan-scan">
      <p className="text-sm text-gray-600 dark:text-gray-300">{t('nativeRoomScan.description')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {panels.length > 1 && <label className="space-y-1 text-sm text-gray-700 dark:text-gray-200">
          <span>{t('nativeRoomScan.targetPanel')}</span>
          <select value={panelId ?? ''} disabled={scanning} onChange={(event) => updateDetails(roomNames, event.target.value)}
            className="min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-base dark:border-gray-600 dark:bg-gray-900">
            {panels.map((panel) => <option key={panel.id} value={panel.id}>{panel.name}</option>)}
          </select>
        </label>}
      </div>
      {!preview && <label className="flex min-h-11 items-center gap-3 text-sm text-gray-700 dark:text-gray-200">
        <input type="checkbox" checked={includePlacements} disabled={scanning}
          onChange={(event) => setIncludePlacements(event.target.checked)} className="h-5 w-5 accent-sky-600" />
        {t('nativeRoomScan.includePlacements')}
      </label>}
      {!preview && consumerCount > 3 && <p className="text-xs text-gray-500 dark:text-gray-400">{t('nativeRoomScan.existingInstallation')}</p>}
      {supported === false && (
        <p role="status" className="rounded-lg bg-amber-100 p-4 text-amber-950 dark:bg-amber-950 dark:text-amber-100">
          {t('nativeRoomScan.unsupported')}
        </p>
      )}
      <button type="button" data-testid="room-plan-start-scan"
        disabled={supported !== true || scanning} onClick={() => void startScan()}
        className="rounded-md bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700 disabled:cursor-wait disabled:opacity-50">
        {scanning ? t('nativeRoomScan.scanning') : t(preview ? 'nativeRoomScan.scanAgain' : 'nativeRoomScan.start')}
      </button>
      {preview && (
        <section className="space-y-3" aria-live="polite">
          <RoomPlanScanPreview preview={preview} roomNames={roomNames} />
          {preview.rooms.length > 0 && <div className="grid gap-2 sm:grid-cols-2">
            {preview.rooms.map((room, index) => <label key={room.id} className="flex min-h-11 items-center gap-2 text-sm">
              <span className="text-gray-500">{index + 1}</span>
              <input aria-label={`${t('nativeRoomScan.roomName')} ${index + 1}`} value={roomNames[room.id] ?? ''} maxLength={80}
                onChange={(event) => updateDetails({ ...roomNames, [room.id]: event.target.value }, panelId)}
                onBlur={() => updateDetails(resolveScanRoomNames(preview.rooms, roomNames, (key) => t(key)), panelId)}
                className="min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 text-base dark:border-gray-600 dark:bg-gray-900" />
            </label>)}
          </div>}
          {preview.rooms.length === 0 && <p className="text-sm text-gray-500">{t('nativeRoomScan.noClosedRooms')}</p>}
          {preview.placements.length > 0 && <p className="rounded-md bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-100">
            {t('nativeRoomScan.reviewHint')}
          </p>}
          {preview.placements.length > 0 && <div data-app-scroll="true" className="flex gap-2 overflow-x-auto pb-2">
            {preview.placements.map((placement) => <div key={placement.id} className="relative w-20 shrink-0 overflow-hidden rounded-md border border-gray-200 dark:border-gray-700">
              {placement.photoDataUrl && <img src={placement.photoDataUrl} alt="" className="aspect-square w-full object-cover" />}
              <span className="absolute bottom-1 right-1 rounded bg-white/95 p-1 dark:bg-gray-900/95">
                <ScanPlacementSymbol symbolId={placement.symbolId} quantity={placement.quantity} compact />
                {placement.quantity > 2 && <span className="absolute -top-1 right-0 rounded bg-sky-600 px-1 text-[10px] text-white">×{placement.quantity}</span>}
              </span>
            </div>)}
          </div>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {format.format(preview.widthMeters)} × {format.format(preview.depthMeters)} m
            </p>
            <div className="flex gap-2">
              {([-1, 1] as const).map((direction) => {
                const label = t(direction === -1 ? 'nativeRoomScan.rotateLeft' : 'nativeRoomScan.rotateRight')
                const Icon = direction === -1 ? RotateCcw : RotateCw
                return <button key={direction} type="button" aria-label={label} title={label}
                  data-testid={direction === -1 ? 'room-plan-rotate-left' : 'room-plan-rotate-right'}
                  onClick={() => setPreview((current) => current && scan ? rotateRoomPlanImportPreview(current, scan, direction) : current)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-md border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800">
                  <Icon size={18} aria-hidden="true" />{direction === -1 ? '−90°' : '+90°'}
                </button>
              })}
            </div>
          </div>
          <dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-700 dark:text-gray-200">
            {[
              ['walls', preview.floorPlan.walls.length],
              ['doors', preview.floorPlan.doors.filter((door) => !door.isOpening).length],
              ['windows', preview.floorPlan.windows.length],
              ['openings', preview.floorPlan.doors.filter((door) => door.isOpening).length],
            ].map(([key, count]) => (
              <div key={key}><dt className="inline">{t(`nativeRoomScan.${key}`)}: </dt><dd className="inline">{count}</dd></div>
            ))}
          </dl>
          {preview.unmatchedOpenings > 0 && (
            <p role="status" className="text-sm text-amber-700 dark:text-amber-300">
              {t('nativeRoomScan.unmatched')}: {preview.unmatchedOpenings}
            </p>
          )}
          {preview.skippedWalls > 0 && (
            <p role="status" className="text-sm text-amber-700 dark:text-amber-300">
              {t('nativeRoomScan.skippedWalls')}: {preview.skippedWalls}
            </p>
          )}
          {preview.uncenteredWalls > 0 && (
            <p role="status" className="text-sm text-amber-700 dark:text-amber-300">
              {t('nativeRoomScan.checkCenters')}: {preview.uncenteredWalls}
            </p>
          )}
        </section>
      )}
      {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{t(error)}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
        <button type="button" onClick={onClose} disabled={scanning}
          className="rounded-md border border-gray-300 px-4 py-2 text-gray-700 dark:border-gray-600 dark:text-gray-200">
          {t('common.cancel')}
        </button>
        {error === 'nativeRoomScan.stale' && (
          <button type="button" onClick={refreshPreview} className="rounded-md bg-sky-600 px-4 py-2 text-white">
            {t('nativeRoomScan.refresh')}
          </button>
        )}
        {preview && (
          <button type="button" onClick={addScan} disabled={scanning || error === 'nativeRoomScan.stale'}
            className="rounded-md bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-700 disabled:opacity-50">
            {t('nativeRoomScan.addToFloor', { floor: preview.floorName })}
          </button>
        )}
      </div>
    </div>
  )
}
