import type { CanvasType } from '@/types/ui'
import { isStructuralCanvasEnabled } from '@/lib/structuralCanvas/availability'
/* @project-documents-strip-start */
import { isProjectDocumentsEnabled } from '@/lib/documents/availability'
/* @project-documents-strip-end */

/** Canvas types the current build can show, in switcher order. */
export function getAvailableCanvasTypes(): CanvasType[] {
  const types: CanvasType[] = ['eendraad', 'plan', 'panel']
  if (isStructuralCanvasEnabled()) types.push('structure')
  /* @project-documents-strip-start */
  if (isProjectDocumentsEnabled()) types.push('documents')
  /* @project-documents-strip-end */
  return types
}

export function isAvailableCanvasType(value: string): value is CanvasType {
  return (getAvailableCanvasTypes() as readonly string[]).includes(value)
}
