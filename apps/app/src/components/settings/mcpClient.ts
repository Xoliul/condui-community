import { useState } from 'react'

/** Chosen MCP client (remembered per device) and shared styles for the MCP settings sections. */

export type McpClient = 'claude' | 'chatgpt' | 'other'

export const MCP_CLIENTS: readonly McpClient[] = ['claude', 'chatgpt', 'other']
const STORAGE_KEY = 'condui.mcpClient'

export const mcpButtonClassName =
  'rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700'
export const mcpCodeClassName =
  'select-all break-all rounded bg-gray-100 px-2 py-1 text-sm text-gray-800 dark:bg-gray-700 dark:text-gray-200'

function readStoredClient(): McpClient {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return MCP_CLIENTS.find((client) => client === stored) ?? 'claude'
  } catch {
    return 'claude'
  }
}

/** The chosen client, remembered per device. */
export function useMcpClient(): [McpClient, (client: McpClient) => void] {
  const [client, setClientState] = useState<McpClient>(readStoredClient)
  function setClient(next: McpClient) {
    setClientState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage can be blocked; the choice then only lasts for this visit.
    }
  }
  return [client, setClient]
}

