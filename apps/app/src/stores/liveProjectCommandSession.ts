import {
  applyCommandBatch,
  CommandError,
  createDefaultCommandEnv,
  projectCommands,
  projectRevisionToken,
  type BatchOutcome,
  type CommandEnv,
  type CommandInvocation,
  type CommandResult,
  type ExecuteOptions,
  type PreviewOutcome,
  type ProjectCommandSession,
} from '@/lib/commands/project'
import { recordSessionAction } from '@/lib/diagnostics/sessionActionLog'
import { publishDomainEvents } from '@/lib/domainEvents'
import { trackGoogleAnalyticsEvent } from '@/lib/analytics/googleAnalytics'
import { logger } from '@/lib/logger'
import { isCollaborativeProject } from '@/lib/collab/client/activeProject'
import { getCollabBridge } from './collabProjectBridge'
import { useProjectStore } from './projectStore'
import { useSettingsStore } from './settingsStore'
import {
  appendUndoSnapshotInStore,
  captureProjectForHistory,
  projectHistory,
} from './slices/projectStoreHistory'

function currentProjectOrThrow() {
  const project = useProjectStore.getState().currentProject
  if (!project) throw new CommandError('no_project', 'No project is open')
  return project
}

/** The collaboration bridge, when the open project is the collaborative one. */
function collabBridgeForProject(project: { project: { id: string } } | null | undefined) {
  const bridge = getCollabBridge()
  return bridge && project?.project.id === bridge.projectId ? bridge : null
}

function lastTouchedCircuitId(results: readonly CommandResult[]): string | undefined {
  for (const result of [...results].reverse()) {
    const ref = [...result.created, ...result.changed, ...(result.related ?? [])]
      .reverse()
      .find((candidate) => candidate.kind === 'circuit')
    if (ref) return ref.id
  }
  return undefined
}

/**
 * Executes project commands against the open editor project (ADR 0003 live executor).
 * A changed batch is one undo step and commits with its bookkeeping; a failed or unchanged
 * batch leaves the project, history and dirty state untouched. Tests may inject `env`.
 */
export function createLiveProjectSession(env?: CommandEnv): ProjectCommandSession {
  let groupedCommit:
    | {
        key: string
        project: ReturnType<typeof currentProjectOrThrow>
        snapshot: ReturnType<typeof captureProjectForHistory>
        undoLength: number
      }
    | undefined
  const commandEnv = (): CommandEnv =>
    env ?? createDefaultCommandEnv(useSettingsStore.getState().language)

  return {
    get revision() {
      const project = useProjectStore.getState().currentProject
      return project ? projectRevisionToken(project) : 'none'
    },

    execute(batch: CommandInvocation[], options?: ExecuteOptions): BatchOutcome {
      const parsed = projectCommands.parse(batch)
      const before = currentProjectOrThrow()
      const collab = collabBridgeForProject(before)
      collab?.assertCanEdit()
      if (!collab && isCollaborativeProject(before.project.id)) {
        // The session stopped (it rejoins on the next open); never fall back to local-only edits.
        throw new CommandError('check_failed', 'Collaboration is paused', { reason: 'collab_paused' })
      }
      if (
        options?.expectedRevision != null &&
        options.expectedRevision !== projectRevisionToken(before)
      ) {
        throw new CommandError('stale_revision', 'The project changed since this was prepared')
      }
      // A collaborative gesture previews with the ids the service will derive for it.
      const prepared = collab?.prepare(before, batch, options?.label)
      const { project: next, results, events } = applyCommandBatch(
        before,
        parsed,
        prepared?.env ?? commandEnv()
      )
      if (next === before) {
        return { revision: projectRevisionToken(before), changed: false, results }
      }

      // A pending debounced edit (typing) stays its own undo step before this batch.
      projectHistory.flushPending()
      const historyBefore = useProjectStore.getState()
      const continuesGroup =
        !!options?.historyGroup &&
        groupedCommit?.key === options.historyGroup &&
        groupedCommit.project === before &&
        historyBefore.undoStack.length === groupedCommit.undoLength &&
        historyBefore.undoStack.at(-1) === groupedCommit.snapshot &&
        historyBefore.redoStack.length === 0
      const circuitId = lastTouchedCircuitId(results)
      const removedFloors = new Set(
        results.flatMap((result) =>
          result.removed.filter((ref) => ref.kind === 'floor').map((ref) => ref.id)
        )
      )
      const floorViewCleanup = removedFloors.size
        ? {
            planFloorOverlayVisibleByBaseFloorId: Object.fromEntries(
              Object.entries(historyBefore.planFloorOverlayVisibleByBaseFloorId)
                .filter(([id]) => !removedFloors.has(id))
                .map(
                  ([id, overlays]) =>
                    [id, overlays.filter((floorId) => !removedFloors.has(floorId))] as const
                )
                .filter(([, overlays]) => overlays.length > 0)
            ),
            planCanvasPlanImageOffsetByFloorId: Object.fromEntries(
              Object.entries(historyBefore.planCanvasPlanImageOffsetByFloorId).filter(
                ([id]) => !removedFloors.has(id)
              )
            ),
          }
        : {}
      projectHistory.runWithoutRecording(() => {
        useProjectStore.setState({
          currentProject: next,
          // The service owns persistence of a collaborative project; nothing here is unsaved.
          isDirty: !collab,
          ...(circuitId ? { lastWorkedCircuitId: circuitId } : {}),
          ...floorViewCleanup,
        })
      })
      // Collaborative projects undo through the service, never through local snapshots.
      if (!continuesGroup && !collab) {
        appendUndoSnapshotInStore(() => {}, captureProjectForHistory(before))
      }
      const historyAfter = useProjectStore.getState()
      groupedCommit =
        options?.historyGroup && historyAfter.undoStack.at(-1)
          ? {
              key: options.historyGroup,
              project: next,
              snapshot: historyAfter.undoStack.at(-1)!,
              undoLength: historyAfter.undoStack.length,
            }
          : undefined
      if (collab && prepared) collab.enqueue(batch, options?.label, prepared)
      recordSessionAction(options?.label ?? batch.map((invocation) => invocation.id).join(', '))
      publishDomainEvents(events)
      for (const [index, invocation] of batch.entries()) {
        const result = results[index]
        if (
          !result ||
          result.created.length + result.changed.length + result.removed.length === 0
        ) {
          continue
        }
        try {
          trackGoogleAnalyticsEvent('command_run', {
            command_id: invocation.id,
            source: options?.source ?? 'ui',
          })
        } catch (error) {
          logger.warn('[ProjectCommand] analytics failed', { id: invocation.id, error })
        }
      }
      return { revision: this.revision, changed: true, results }
    },

    preview(invocation: CommandInvocation): PreviewOutcome {
      const { command, input } = projectCommands.parseOne(invocation)
      const project = currentProjectOrThrow()
      return { revision: projectRevisionToken(project), check: command.check(project, input) }
    },

    undo() {
      groupedCommit = undefined
      const collab = collabBridgeForProject(useProjectStore.getState().currentProject)
      if (collab) return collab.undo()
      if (!this.canUndo()) return false
      useProjectStore.getState().undo()
      return true
    },

    redo() {
      groupedCommit = undefined
      const collab = collabBridgeForProject(useProjectStore.getState().currentProject)
      if (collab) return collab.redo()
      if (!this.canRedo()) return false
      useProjectStore.getState().redo()
      return true
    },

    canUndo: () =>
      collabBridgeForProject(useProjectStore.getState().currentProject)?.canUndo() ??
      (projectHistory.hasPending() || useProjectStore.getState().undoStack.length > 0),
    canRedo: () =>
      collabBridgeForProject(useProjectStore.getState().currentProject)?.canRedo() ??
      useProjectStore.getState().redoStack.length > 0,
  }
}

export const liveProjectSession = createLiveProjectSession()

/**
 * Runs one command for a UI adapter. Failures are logged and reported as `null`, matching the
 * silent no-op behavior of the store actions these commands replace.
 */
export function runProjectCommand(
  id: string,
  input: unknown,
  options?: ExecuteOptions
): BatchOutcome | null {
  try {
    return liveProjectSession.execute([{ id, input }], options)
  } catch (error) {
    if (!(error instanceof CommandError)) throw error
    logger.warn('[ProjectCommand] rejected', { id, code: error.code, message: error.message })
    return null
  }
}
