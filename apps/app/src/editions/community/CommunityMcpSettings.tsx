import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { McpClientPicker, McpCopyRow } from '@/components/settings/McpClientPicker'
import { mcpButtonClassName as buttonClassName, mcpCodeClassName as codeClassName, useMcpClient } from '@/components/settings/mcpClient'

/**
 * MCP settings of a Community server with server storage: turn the `/mcp` endpoint on with a new
 * bearer token (shown once), copy the connection details, or turn it off. The server keeps only
 * a hash of the token (`apps/app/community/mcp.mjs`).
 */

const SETTINGS_URL = '/api/mcp/settings'

type McpState = { available: false } | { available: true; enabled: boolean; token?: string }
type Copied = 'server' | 'prompt' | 'token' | 'command' | 'config' | 'header' | 'failed' | null

const primaryButtonClassName =
  'rounded-md bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50'

async function readState(response: Response): Promise<McpState> {
  if (!response.ok) throw new Error(`MCP settings failed (${response.status}).`)
  return (await response.json()) as McpState
}

export function EditionMcpSettings() {
  const { t } = useTranslation()
  const [client, setClient] = useMcpClient()
  const [state, setState] = useState<McpState | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState<Copied>(null)

  useEffect(() => {
    let cancelled = false
    fetch(SETTINGS_URL, { cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(readState)
      .then((next) => {
        if (!cancelled) setState(next)
      })
      .catch(() => {
        if (!cancelled) setState({ available: false })
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!state) return null

  const serverUrl = new URL('/mcp', window.location.origin).href
  const starterPrompt = t('settings.mcp.communityStarterPrompt')
  const token = state.available ? state.token : undefined
  const tokenValue = token ?? '<token>'
  const command = `claude mcp add --transport http condui ${serverUrl} --header "Authorization: Bearer ${tokenValue}"`
  const codexConfig = `[mcp_servers.condui]
url = "${serverUrl}"
http_headers = { Authorization = "Bearer ${tokenValue}" }`
  const header = `Authorization: Bearer ${tokenValue}`

  async function change(action: 'create' | 'disable') {
    setBusy(true)
    setFailed(false)
    setCopied(null)
    try {
      const response = await fetch(SETTINGS_URL, {
        method: 'POST',
        cache: 'no-store',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      setState(await readState(response))
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  async function copy(text: string, kind: Exclude<Copied, 'failed' | null>) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
    } catch {
      setCopied('failed')
    }
  }

  return (
    <section className="space-y-3 border-t border-gray-200 pt-4 dark:border-gray-600" aria-labelledby="settings-mcp-title">
      <h3 id="settings-mcp-title" className="text-sm font-semibold text-gray-800 dark:text-gray-200">
        MCP
      </h3>
      {!state.available ? (
        <p className="text-sm text-gray-700 dark:text-gray-300">{t('settings.mcp.needsServerStorage')}</p>
      ) : !state.enabled ? (
        <button type="button" className={primaryButtonClassName} disabled={busy} onClick={() => void change('create')}>
          {t('settings.mcp.turnOn')}
        </button>
      ) : (
        <>
          {token && (
            <div className="space-y-2 rounded-md border border-sky-300 bg-sky-50 p-3 dark:border-sky-700 dark:bg-sky-950/40">
              <p className="text-sm text-gray-800 dark:text-gray-200">{t('settings.mcp.tokenShownOnce')}</p>
              <code className={`block ${codeClassName}`} data-testid="community-mcp-token">
                {token}
              </code>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClassName} onClick={() => void copy(token, 'token')}>
                  {t('settings.mcp.copyToken')}
                </button>
              </div>
            </div>
          )}
          <McpClientPicker client={client} onChange={setClient} surface="community_mcp_settings" />
          {client === 'claude' && (
            <McpCopyRow block value={command} copyLabel={t('settings.mcp.copyCommand')} onCopy={() => void copy(command, 'command')} />
          )}
          {client === 'chatgpt' && (
            <McpCopyRow
              block
              label={t('settings.mcp.codexConfig')}
              value={codexConfig}
              copyLabel={t('settings.mcp.copyCodexConfig')}
              onCopy={() => void copy(codexConfig, 'config')}
            />
          )}
          {client === 'other' && (
            <>
              <McpCopyRow value={serverUrl} copyLabel={t('settings.mcp.copyUrl')} onCopy={() => void copy(serverUrl, 'server')} />
              <McpCopyRow
                label={t('settings.mcp.headerLabel')}
                value={header}
                copyLabel={t('settings.mcp.copyHeader')}
                onCopy={() => void copy(header, 'header')}
              />
            </>
          )}
          {!token && <p className="text-sm text-gray-700 dark:text-gray-300">{t('settings.mcp.tokenHidden')}</p>}
          <div className="space-y-2">
            <p className="text-sm text-gray-700 dark:text-gray-300">{starterPrompt}</p>
            <button type="button" className={buttonClassName} onClick={() => void copy(starterPrompt, 'prompt')}>
              {t('settings.mcp.copyPrompt')}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClassName} disabled={busy} onClick={() => void change('create')}>
              {t('settings.mcp.newToken')}
            </button>
            <button type="button" className={buttonClassName} disabled={busy} onClick={() => void change('disable')}>
              {t('settings.mcp.turnOff')}
            </button>
          </div>
        </>
      )}
      <div role="status" className="text-sm text-gray-600 dark:text-gray-300">
        {failed && t('settings.mcp.changeFailed')}
        {copied === 'server' && t('settings.mcp.urlCopied')}
        {copied === 'prompt' && t('settings.mcp.promptCopied')}
        {copied === 'token' && t('settings.mcp.tokenCopied')}
        {copied === 'command' && t('settings.mcp.commandCopied')}
        {copied === 'config' && t('settings.mcp.configCopied')}
        {copied === 'header' && t('settings.mcp.headerCopied')}
        {copied === 'failed' && t('settings.mcp.copyFailed')}
      </div>
    </section>
  )
}
