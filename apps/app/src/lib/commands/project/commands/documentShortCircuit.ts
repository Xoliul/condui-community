import { z } from 'zod'
import { createShortCircuitDocumentAsset } from '@/lib/documents/projectDocuments'
import {
  nextRevisionIndex,
  normalizeSource,
  readShortCircuitDocument,
} from '@/lib/shortCircuit/shortCircuitDocument'
import type { ProjectV2 } from '@/types/projectV2'
import { defineProjectCommand } from '../types'

const sourceSchema = z
  .object({ kind: z.literal('grid'), declaredIk3Ka: z.number().positive().max(200).optional() })
  .strict()

const inputSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: z.string().trim().min(1).max(200) }).strict(),
  z.object({ action: z.literal('setSource'), documentId: z.string().min(1), source: sourceSchema }).strict(),
  z
    .object({
      action: z.literal('issueRevision'),
      documentId: z.string().min(1),
      description: z.string().trim().max(500).optional(),
      report: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({ action: z.literal('removeRevision'), documentId: z.string().min(1), revisionId: z.string().min(1) })
    .strict(),
])

function findAsset(project: ProjectV2, documentId: string) {
  return project.assets.find((asset) => asset.id === documentId)
}

/**
 * Creates a short-circuit calculation document and edits its own inputs: the source and the
 * issued revisions. Everything else in the calculation is the project itself.
 */
export const documentShortCircuit = defineProjectCommand({
  id: 'document.shortCircuit',
  version: 1,
  input: inputSchema,
  check(project, input) {
    if (input.action === 'create') return { ok: true }
    const document = readShortCircuitDocument(findAsset(project, input.documentId))
    if (!document)
      return { ok: false, code: 'document_not_found', message: 'Short-circuit calculation not found' }
    if (
      input.action === 'removeRevision' &&
      !document.revisions?.some((revision) => revision.id === input.revisionId)
    )
      return { ok: false, code: 'revision_not_found', message: 'Revision not found' }
    return { ok: true }
  },
  apply(draft, input, env) {
    if (input.action === 'create') {
      const id = `document-${env.newId()}`
      draft.assets.push(createShortCircuitDocumentAsset({ id, name: input.name, addedAt: env.now() }))
      return { created: [{ kind: 'document', id }], changed: [], removed: [] }
    }
    const asset = findAsset(draft, input.documentId)!
    const current = readShortCircuitDocument(asset)!
    const ref = { kind: 'document' as const, id: input.documentId }
    const unchanged = { created: [], changed: [], removed: [] }
    let next = current
    if (input.action === 'setSource') {
      const source = normalizeSource(input.source)
      if (JSON.stringify(source) === JSON.stringify(current.source)) return unchanged
      next = { ...current, source }
    } else if (input.action === 'issueRevision') {
      const revisions = current.revisions ?? []
      next = {
        ...current,
        revisions: [
          ...revisions,
          {
            id: env.newId(),
            index: nextRevisionIndex(revisions),
            issuedAt: env.now(),
            ...(input.description ? { description: input.description } : {}),
            report: structuredClone(input.report),
          },
        ],
      }
    } else {
      next = {
        ...current,
        revisions: (current.revisions ?? []).filter((revision) => revision.id !== input.revisionId),
      }
    }
    asset.document = { ...asset.document, shortCircuit: next }
    return { created: [], changed: [ref], removed: [] }
  },
})
