import type { Circuit, Panel } from '@/types/schema'
import {
  PROJECT_V2_FORK_SCHEMA_VERSION,
  PROJECT_V2_RISER_SCHEMA_VERSION,
  PROJECT_V2_SCHEMA_VERSION,
  type ProjectV2,
  type ProjectV2SchemaVersion,
} from '@/types/projectV2'
import { isSupplyTapsPanel } from '@/lib/supplyTaps/virtualPanel'

/**
 * Current schema versions, oldest first. A document is written at the lowest version whose readers
 * understand all of its content, and the version never goes down again once raised.
 */
export const CURRENT_PROJECT_V2_SCHEMA_VERSIONS: readonly ProjectV2SchemaVersion[] = [
  PROJECT_V2_SCHEMA_VERSION,
  PROJECT_V2_FORK_SCHEMA_VERSION,
  PROJECT_V2_RISER_SCHEMA_VERSION,
]

export function isCurrentProjectV2SchemaVersion(value: unknown): value is ProjectV2SchemaVersion {
  return CURRENT_PROJECT_V2_SCHEMA_VERSIONS.includes(value as ProjectV2SchemaVersion)
}

function rank(version: unknown): number {
  return CURRENT_PROJECT_V2_SCHEMA_VERSIONS.indexOf(version as ProjectV2SchemaVersion)
}

/** The higher of two versions; an unknown value loses against a known one. */
export function maxSchemaVersion<T extends string | undefined>(a: T, b: T): T {
  return rank(b) > rank(a) ? b : a
}

const HIGHEST_RANK = CURRENT_PROJECT_V2_SCHEMA_VERSIONS.length - 1

function circuitRequiredRank(circuit: Circuit): number {
  if (circuit.sectionWireOverrides?.some((entry) => (entry.riserStem ?? 0) > 0)) return 2
  let required = 0
  for (const branch of circuit.branches ?? []) {
    if ((branch.stem ?? 0) > 0) return 2
    if (branch.forkFrom || branch.keepEmpty) required = 1
  }
  return required
}

/** The lowest current schema version whose readers understand everything in `project`. */
export function getRequiredSchemaVersion(project: ProjectV2): ProjectV2SchemaVersion {
  let required = 0
  const pending: Panel[] = [...(project.disciplines.electrical?.panels ?? [])]
  for (let index = 0; index < pending.length; index++) {
    const panel = pending[index]!
    if (isSupplyTapsPanel(panel)) return CURRENT_PROJECT_V2_SCHEMA_VERSIONS[HIGHEST_RANK]!
    for (const circuit of panel.circuits) required = Math.max(required, circuitRequiredRank(circuit))
    for (const protection of panel.protections) {
      for (const circuit of protection.circuits ?? []) required = Math.max(required, circuitRequiredRank(circuit))
    }
    if (required === HIGHEST_RANK) break
    pending.push(...(panel.subPanels ?? []))
  }
  return CURRENT_PROJECT_V2_SCHEMA_VERSIONS[required]!
}

/** Raises `project.schemaVersion` to at least `version`; never lowers it. */
export function raiseSchemaVersion(project: { schemaVersion: ProjectV2SchemaVersion }, version: ProjectV2SchemaVersion): void {
  project.schemaVersion = maxSchemaVersion(project.schemaVersion, version)
}

/** Whether the stored version is already at least what the content needs (cheap on the common path). */
export function hasSufficientSchemaVersion(project: ProjectV2): boolean {
  return project.schemaVersion === CURRENT_PROJECT_V2_SCHEMA_VERSIONS[HIGHEST_RANK] ||
    rank(project.schemaVersion) >= rank(getRequiredSchemaVersion(project))
}
