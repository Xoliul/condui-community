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
  ) {
    super(translationKey)
  }
}

export async function recognizePlanWalls(): Promise<never> {
  throw new PlanWallRecognitionError('planImport.scanWorkerRequired')
}
