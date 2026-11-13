import { compileElectricalImport } from './compile'
import { validateElectricalImport } from './validate'

/** Shared creation boundary for approved scans, JSON import and editor tools.
 * This creates a new native project; it must never round-trip an existing project.
 * Scan assets and plan geometry remain in the document and follow the same compiler.
 */
export function prepareElectricalCreation(input: unknown) {
  const validated = validateElectricalImport(input)
  if (!validated.success) {
    throw new Error(
      validated.diagnostics.map(({ path, message }) => `${path}: ${message}`).join('\n')
    )
  }
  return { ...compileElectricalImport(validated.document), document: validated.document }
}
