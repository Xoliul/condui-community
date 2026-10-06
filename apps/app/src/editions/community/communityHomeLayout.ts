import {
  loadHomeProjectLayout,
  normalizeHomeProjectLayout,
  saveHomeProjectLayout,
  type HomeProjectLayout,
} from '@/lib/homeProjectLayout'
import { logger } from '@/lib/logger'
import { getServerSetting, isServerStorageEnabled, putServerSetting } from './communityServerStorage'

const HOME_LAYOUT_SETTING_KEY = 'homeProjectLayout'

/** Folders and view mode follow the projects: on the server when it stores them, else in this browser. */
export async function loadCommunityHomeLayout(): Promise<HomeProjectLayout> {
  const browserLayout = loadHomeProjectLayout(null)
  if (!(await isServerStorageEnabled())) return browserLayout
  const stored = await getServerSetting<unknown>(HOME_LAYOUT_SETTING_KEY)
  if (stored !== undefined) return normalizeHomeProjectLayout(stored)
  // First use of server storage: keep the folders this browser already had.
  await putServerSetting(HOME_LAYOUT_SETTING_KEY, browserLayout)
  return browserLayout
}

export function saveCommunityHomeLayout(layout: HomeProjectLayout): void {
  void isServerStorageEnabled().then((enabled) => {
    if (!enabled) {
      saveHomeProjectLayout(layout, null)
      return
    }
    putServerSetting(HOME_LAYOUT_SETTING_KEY, layout).catch((error: unknown) => {
      logger.error('Failed to save the project folders on the server:', error)
    })
  })
}
