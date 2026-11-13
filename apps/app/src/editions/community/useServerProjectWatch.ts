import { useEffect, useRef } from 'react'
import { logger } from '@/lib/logger'
import { useProjectStore } from '@/stores/projectStore'
import {
  getKnownServerRevision,
  getServerProjectRevision,
  isServerProjectSaving,
  isServerStorageEnabled,
} from './communityServerStorage'

const POLL_MS = 3000

/** True while the open project has no unsaved or in-flight changes in this tab. */
export function isServerProjectClean(projectId: string): boolean {
  const state = useProjectStore.getState()
  return !state.isDirty && state.currentProject?.project.id === projectId && !isServerProjectSaving(projectId)
}

/**
 * Calls `onNewerRevision` when the open project was saved elsewhere on the server (an MCP client
 * or another device) while this tab has no unsaved changes. With unsaved changes the next save
 * reports the conflict instead. Polls the cheap metadata route while the tab is visible.
 */
export function useServerProjectWatch(
  projectId: string | undefined,
  active: boolean,
  onNewerRevision: () => void,
): void {
  const callback = useRef(onNewerRevision)
  useEffect(() => {
    callback.current = onNewerRevision
  }, [onNewerRevision])

  useEffect(() => {
    if (!projectId || !active) return
    let cancelled = false
    let busy = false
    let requested: number | undefined

    const check = async () => {
      if (busy || cancelled || document.visibilityState === 'hidden' || !isServerProjectClean(projectId)) return
      busy = true
      try {
        if (!(await isServerStorageEnabled())) return
        const known = getKnownServerRevision(projectId)
        const remote = await getServerProjectRevision(projectId)
        if (known === undefined || remote === undefined || remote <= known || remote === requested) return
        if (cancelled || !isServerProjectClean(projectId)) return
        requested = remote
        callback.current()
      } catch (error) {
        logger.warn('Checking the server for project changes failed:', error)
      } finally {
        busy = false
      }
    }

    const run = () => void check()
    const timer = window.setInterval(run, POLL_MS)
    window.addEventListener('focus', run)
    document.addEventListener('visibilitychange', run)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', run)
      document.removeEventListener('visibilitychange', run)
    }
  }, [projectId, active])
}
