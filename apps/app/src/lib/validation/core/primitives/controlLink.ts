import { registerPrimitive } from './registry'
import type { CheckContext, Issue, Offender } from './common'
import { i18n, projectInstallation, projectPanels } from './common'
import { getAllCircuits } from '@/lib/eendraad/projectElectricalDomain'
import { validateControlDevices, type ControlDeviceIssue } from '@/lib/controlLink/controlLink'
import type { Endpoint } from '@/types/schema'

const RULE_ID = 'be.areibook1.2025.control-link-integrity'

function name(endpoint: Endpoint | undefined): string {
  return endpoint?.label?.trim() || '?'
}

/**
 * Control-link findings for one board: a contact linked to a device that no longer exists, two
 * connections claiming the same channel on one device, and addresses that do not fit the device's
 * system. Each finding is reported on the board holding the endpoint it points at.
 */
function controlLinkIntegrity(context: CheckContext): Issue[] {
  const { scope, project } = context
  if (scope.type !== 'board') return []
  const panels = projectPanels(project)
  const panel = panels.find((candidate) => candidate.id === scope.id)
  if (!panel) return []

  const byId = new Map<string, Endpoint>()
  for (const candidate of panels) {
    for (const circuit of getAllCircuits(candidate)) {
      for (const endpoint of circuit.endpoints) byId.set(endpoint.id, endpoint)
    }
  }
  const onBoard = new Set<string>()
  for (const circuit of getAllCircuits(panel)) {
    for (const endpoint of circuit.endpoints) onBoard.add(endpoint.id)
  }

  const jurisdiction = projectInstallation(project)?.address?.country ?? 'BE'
  const endpointOffender = (id: string): Offender => ({ kind: 'endpoint', id, viewHint: 'eendraad' })
  const issues: Issue[] = []

  const push = (
    issue: ControlDeviceIssue,
    key: string,
    anchorId: string,
    offenderIds: string[],
    kind: 'dangling' | 'duplicateChannel' | 'invalidAddress',
    values: Record<string, string>
  ) => {
    if (!onBoard.has(anchorId)) return
    issues.push({
      id: `${RULE_ID}:board:${panel.id}:${issue.kind}:${key}`,
      ruleId: RULE_ID,
      severity: 'warning',
      jurisdiction,
      rulesetVersion: '2025',
      scope: { type: 'board', id: panel.id },
      offenders: offenderIds.map(endpointOffender),
      message: i18n.t(`validation.primitives.controlLinkIntegrity.${kind}.message`, values),
      details: i18n.t(`validation.primitives.controlLinkIntegrity.${kind}.details`, values),
      citations: [],
      tags: ['domotica', 'control-link'],
    })
  }

  for (const issue of validateControlDevices(panels)) {
    const device = byId.get('deviceId' in issue ? issue.deviceId : '')
    if (issue.kind === 'dangling') {
      push(issue, issue.endpointId, issue.endpointId, [issue.endpointId], 'dangling', {
        endpoint: name(byId.get(issue.endpointId)),
      })
    } else if (issue.kind === 'duplicate-channel') {
      push(issue, `${issue.deviceId}:${issue.direction}:${issue.channel}`, issue.deviceId, [issue.deviceId, ...issue.endpointIds], 'duplicateChannel', {
        device: name(device),
        channel: issue.channel,
        count: String(issue.endpointIds.length),
      })
    } else if (issue.kind === 'invalid-channel') {
      push(issue, `${issue.endpointId}:${issue.channel}`, issue.endpointId, [issue.endpointId], 'invalidAddress', {
        device: name(device),
        endpoint: name(byId.get(issue.endpointId)),
        address: issue.channel,
      })
    } else if (issue.kind === 'invalid-group') {
      push(issue, `${issue.endpointId}:${issue.group}`, issue.endpointId, [issue.endpointId], 'invalidAddress', {
        device: name(device),
        endpoint: name(byId.get(issue.endpointId)),
        address: issue.group,
      })
    } else if (issue.kind === 'invalid-device-address') {
      push(issue, issue.deviceId, issue.deviceId, [issue.deviceId], 'invalidAddress', {
        device: name(device),
        endpoint: name(device),
        address: issue.address,
      })
    }
  }
  return issues
}

registerPrimitive('controlLinkIntegrity', controlLinkIntegrity)
