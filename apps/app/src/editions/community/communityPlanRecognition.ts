/** Plan recognition is unavailable in the offline Community edition. */
export function isElectricalVisionScanEnabled(): boolean {
  return false
}

export function isFloorplanScanEnabled(): boolean {
  return false
}

export class PlanWallRecognitionError extends Error {
  constructor(
    readonly translationKey:
      | 'planImport.signInToRecognize'
      | 'planImport.scanWorkerRequired'
      | 'planImport.noWallsFound'
      | 'planImport.noScanCredits'
  ) {
    super(translationKey)
  }
}

export type RecognizedPlanWalls = { jobId: string; page: never }

export async function recognizePlanWalls(): Promise<never> {
  throw new PlanWallRecognitionError('planImport.scanWorkerRequired')
}

export async function acceptRecognizedPlanWalls(): Promise<void> {}

export async function discardRecognizedPlanWalls(): Promise<void> {}

export async function getAvailableWallScans(): Promise<number | null> {
  return null
}
