import { useTranslation } from 'react-i18next'
import { trackGoogleAnalyticsEvent } from '@/lib/analytics/googleAnalytics'
import { MCP_CLIENTS, mcpButtonClassName, mcpCodeClassName, type McpClient } from './mcpClient'

/** Client picker and copy bits shared by the hosted and Community MCP settings. */

export function McpClientPicker({ client, onChange, surface }: {
  client: McpClient
  onChange: (client: McpClient) => void
  surface: 'hosted_mcp_settings' | 'community_mcp_settings'
}) {
  const { t } = useTranslation()
  return (
    <div role="group" aria-label={t('settings.mcp.client.label')} className="inline-flex overflow-hidden rounded-md border border-gray-300 dark:border-gray-600">
      {MCP_CLIENTS.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={client === option}
          className={`px-3 py-1.5 text-sm font-medium ${
            client === option
              ? 'bg-sky-600 text-white'
              : 'text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'
          }`}
          onClick={() => {
            if (client === option) return
            trackGoogleAnalyticsEvent(`mcp_client_selected_${option}`, { surface })
            onChange(option)
          }}
        >
          {t(`settings.mcp.client.${option}`)}
        </button>
      ))}
    </div>
  )
}

/** A code snippet with a copy button; `block` keeps multi-line text as written. */
export function McpCopyRow({
  value,
  copyLabel,
  onCopy,
  label,
  block = false,
}: {
  value: string
  copyLabel: string
  onCopy: () => void
  label?: string
  block?: boolean
}) {
  return (
    <div className="space-y-1">
      {label && <p className="text-sm text-gray-700 dark:text-gray-300">{label}</p>}
      <div className="flex flex-wrap items-start gap-2">
        {block ? (
          <pre className={`${mcpCodeClassName} whitespace-pre-wrap`}>{value}</pre>
        ) : (
          <code className={mcpCodeClassName}>{value}</code>
        )}
        <button type="button" className={mcpButtonClassName} onClick={onCopy}>
          {copyLabel}
        </button>
      </div>
    </div>
  )
}
