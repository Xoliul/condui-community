import type { Installation } from '@/types/schema'
import { createEmptyProjectV2 } from '@/utils/project'
import { migrateProjectV1ToV2 } from '@/lib/projectV2/migration'

export type LegacyImportProject = Parameters<typeof migrateProjectV1ToV2>[0]

/** Legacy-shaped construction is restricted to import adapters that still assemble V1 input. */
export function createLegacyEmptyProject(
  name: string,
  yearOfConstruction?: number,
  installation?: Installation,
  meterEanCode?: string,
): LegacyImportProject {
  const native = createEmptyProjectV2(name, yearOfConstruction, installation, meterEanCode)
  const electrical = native.disciplines.electrical
  if (!electrical) throw new Error('New project must include the electrical discipline')
  return {
    schemaVersion: '0.2.0',
    project: native.project,
    installation: electrical.installation,
    panels: electrical.panels,
    floors: native.building.floors,
  } as unknown as LegacyImportProject
}
