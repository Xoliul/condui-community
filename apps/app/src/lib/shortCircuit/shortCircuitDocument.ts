import type {
  AssetModelV2,
  ShortCircuitDocumentV2,
  ShortCircuitRevisionV2,
  ShortCircuitSourceV2,
} from '@/types/projectV2'
import { isProjectDocumentAsset } from '@/lib/projectV2/documentAssets'
import type { ShortCircuitReport } from './projectShortCircuit'

/** The calculation document stored on an asset, normalized; null when it is not one. */
export function readShortCircuitDocument(asset: AssetModelV2 | undefined): ShortCircuitDocumentV2 | null {
  const raw = asset && isProjectDocumentAsset(asset) ? asset.document?.shortCircuit : undefined
  if (!raw || typeof raw !== 'object') return null
  return {
    version: 1,
    source: normalizeSource(raw.source),
    revisions: Array.isArray(raw.revisions) ? raw.revisions.filter(isRevision) : [],
  }
}

function positive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

export function normalizeSource(raw: unknown): ShortCircuitSourceV2 {
  const source = raw as Partial<Record<string, unknown>> | undefined
  const declaredIk3Ka = positive(source?.declaredIk3Ka)
  return declaredIk3Ka != null ? { kind: 'grid', declaredIk3Ka } : { kind: 'grid' }
}

function isRevision(value: unknown): value is ShortCircuitRevisionV2 {
  const revision = value as Partial<ShortCircuitRevisionV2> | undefined
  return (
    typeof revision?.id === 'string' &&
    typeof revision.index === 'string' &&
    typeof revision.issuedAt === 'string' &&
    typeof revision.report === 'object' &&
    revision.report !== null
  )
}

/** A, B, … Z, then AA, AB, … */
export function nextRevisionIndex(revisions: readonly Pick<ShortCircuitRevisionV2, 'index'>[]): string {
  const toNumber = (index: string) =>
    [...index].reduce((total, letter) => total * 26 + (letter.charCodeAt(0) - 64), 0)
  const highest = revisions.reduce((max, revision) => {
    const index = revision.index.toUpperCase()
    return /^[A-Z]+$/.test(index) ? Math.max(max, toNumber(index)) : max
  }, 0)
  let value = highest + 1
  let index = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    index = String.fromCharCode(65 + remainder) + index
    value = Math.floor((value - 1) / 26)
  }
  return index
}

/** An issued revision's frozen report, when it still has the expected shape. */
export function readRevisionReport(revision: ShortCircuitRevisionV2): ShortCircuitReport | null {
  const report = revision.report as Partial<ShortCircuitReport>
  return Array.isArray(report.boards) && report.source && report.summary
    ? (report as ShortCircuitReport)
    : null
}
