import type { CommandEnv, CommandInvocation } from '@/lib/commands/project'

interface PreparedRequest {
  requestId: string
  language: string
  env: CommandEnv
}

/** Only the capabilities read by shared editing code; Community never creates a bridge. */
interface CommandBridge {
  projectId: string
  assertCanEdit(): void
  prepare(project: unknown): PreparedRequest
  enqueue(batch: CommandInvocation[], label: string | undefined, prepared: PreparedRequest): void
  undo(): boolean
  redo(): boolean
  canUndo(): boolean
  canRedo(): boolean
}

export function getCollabBridge(): CommandBridge | null {
  return null
}

export function getActiveCollabProject(): Pick<CommandBridge, 'projectId' | 'undo' | 'redo'> | null {
  return null
}

export function isCollaborativeProject(_projectId: string | null | undefined): boolean {
  return false
}
