import { current, produce } from 'immer'
import { assertForkEditsPreserveTopology, reconcileForkTrunkPositions } from './forkIntegrity'
import { assertRiserEditsStayEligible, normalizeRiserStems } from './riserIntegrity'
import { preserveWireRuns } from '@/lib/wires/preserveWireRuns'
import type { ProjectV2 } from '@/types/projectV2'
import { getProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { getRequiredSchemaVersion, maxSchemaVersion, raiseSchemaVersion } from '@/lib/projectV2/projectSchemaVersion'
import {
  followWireAnchorDomains,
  wireAnchorDomainsNeedFollowing,
} from '@/lib/wires/followWireAnchorDomains'
import { collectDomainEvents, type DomainEvent } from '@/lib/domainEvents'
import { withIdSource } from '@/utils/id'
import { withProjectMutationTime } from '@/lib/projectMutations/mutationTime'
import type { ParsedInvocation } from './registry'
import { CommandError, type CommandEnv, type CommandResult } from './types'
import { resolveCreatedReferences } from './batchReferences'
import { assertNoNewDuplicateIds, assertNoNewPlanPlacementConflicts } from './planPlacementIntegrity'
import { assertNoNewHorizontalDomoticaViolations } from './horizontalDomoticaIntegrity'
import { assertDirectTrunkFeedersCarryNoLoads, assertStripLedSupplyTapsCarryNoLoads } from './directTrunkFeederIntegrity'

/**
 * Domain repairs that must hold after any change, whoever made it. They used to run only as
 * live store subscribers; running them here keeps headless and draft results identical.
 */
function finalizeProjectDomain(base: ProjectV2, next: ProjectV2): ProjectV2 {
  if (getProjectElectricalPanels(next) === getProjectElectricalPanels(base)) return next
  const followed = wireAnchorDomainsNeedFollowing(next)
    ? produce(next, (draft) => {
        followWireAnchorDomains(draft as ProjectV2)
      })
    : next
  return raiseSchemaVersionFromContent(followed)
}

/**
 * Whatever a command created (a fork, a riser, a supply tap, through a drop, paste, duplicate or
 * import), the document must declare the lowest version whose readers understand it. Raise only:
 * a version never goes down.
 */
function raiseSchemaVersionFromContent(project: ProjectV2): ProjectV2 {
  const required = getRequiredSchemaVersion(project)
  if (maxSchemaVersion(project.schemaVersion, required) === project.schemaVersion) return project
  return produce(project, (draft) => {
    raiseSchemaVersion(draft as ProjectV2, required)
  })
}

/**
 * Checks and applies a parsed batch as one transaction. Each command checks the draft produced
 * by the commands before it. Any failure throws before anything is published, so callers only
 * ever see the original project or the complete result. Returns the base project unchanged
 * (same object) for a no-op. Domain events are returned for the executor to publish only after
 * it commits.
 */
export function applyCommandBatch(
  base: ProjectV2,
  batch: readonly ParsedInvocation[],
  env: CommandEnv
): { project: ProjectV2; results: CommandResult[]; events: DomainEvent[] } {
  const results: CommandResult[] = []
  const aliases = new Map<string, CommandResult>()
  const { result: next, events } = collectDomainEvents(() =>
    withIdSource(env.newId, () =>
      withProjectMutationTime(env.now, () =>
        produce(base, (draft) => {
          batch.forEach(({ command, input: originalInput, deferred, as }, index) => {
            let input = originalInput
            if (deferred) {
              let resolved: unknown
              try {
                resolved = resolveCreatedReferences(originalInput, aliases)
              } catch (error) {
                if (!(error instanceof CommandError)) throw error
                throw new CommandError(error.code, error.message, {
                  ...error.details,
                  index,
                  commandId: command.id,
                })
              }
              const parsed = command.input.safeParse(resolved)
              if (!parsed.success)
                throw new CommandError(
                  'invalid_input',
                  `Invalid resolved input for "${command.id}"`,
                  { index, commandId: command.id, cause: parsed.error.issues }
                )
              input = parsed.data
            }
            const check = command.check(draft as ProjectV2, input)
            if (!check.ok) {
              throw new CommandError('check_failed', check.message, {
                index,
                commandId: command.id,
                reason: check.code,
                cause: check.details,
              })
            }
            try {
              const wireBefore = current(draft) as ProjectV2
              const applied = command.apply(draft, input, env)
              normalizeRiserStems(draft as ProjectV2)
              reconcileForkTrunkPositions(wireBefore, draft as ProjectV2)
              assertForkEditsPreserveTopology(wireBefore, current(draft) as ProjectV2)
              assertRiserEditsStayEligible(wireBefore, current(draft) as ProjectV2)
              const wires = preserveWireRuns(
                wireBefore,
                current(draft) as ProjectV2,
                draft as ProjectV2,
                env.newId
              )
              for (const field of ['created', 'changed', 'removed'] as const) {
                for (const id of wires[field]) {
                  if (!applied[field].some((ref) => ref.kind === 'wireRun' && ref.id === id))
                    applied[field].push({ kind: 'wireRun', id })
                }
              }
              const result = as ? { ...applied, as } : applied
              results.push(result)
              if (as) aliases.set(as, result)
            } catch (error) {
              if (error instanceof CommandError) throw error
              throw new CommandError('apply_failed', `Command "${command.id}" failed`, {
                index,
                commandId: command.id,
                cause: error,
              })
            }
          })
        })
      )
    )
  )
  if (next === base) return { project: base, results, events: [] }
  const project = finalizeProjectDomain(base, next)
  assertNoNewPlanPlacementConflicts(base, project)
  assertNoNewDuplicateIds(base, project)
  assertNoNewHorizontalDomoticaViolations(base, project)
  assertDirectTrunkFeedersCarryNoLoads(base, project)
  assertStripLedSupplyTapsCarryNoLoads(base, project)
  return { project, results, events }
}
