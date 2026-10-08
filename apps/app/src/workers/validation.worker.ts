/// <reference lib="webworker" />

import { validateProject } from '../lib/validation/core/engine'
import type { Issue, ValidationProject } from '../lib/validation/core/types'
import { beAreiBook1_2025 } from '../lib/validation/rules/be/be.areibook1.2025'
import { loadRulePack } from '../lib/validation/core/rulepack-loader'
import validationI18n, { setValidationLanguage } from '../lib/validation/validationI18n'
import { collectJunctionValidationIssuesForEdition } from '@/lib/junction/junctionHostedHooks'

type ValidationRequest = {
  type: 'validate'
  id: number
  project: ValidationProject
  language: string
}

type ValidationResponse =
  | { type: 'result'; id: number; issues: Issue[] }
  | { type: 'error'; id: number; message: string }

const workerScope = self as unknown as DedicatedWorkerGlobalScope

self.onmessage = (event: MessageEvent<ValidationRequest>) => {
  const request = event.data
  try {
    setValidationLanguage(request.language)
    const pack = loadRulePack(beAreiBook1_2025)
    const issues = [
      ...validateProject(request.project, { packs: [pack] }),
      ...collectJunctionValidationIssuesForEdition(request.project, validationI18n.t.bind(validationI18n)),
    ]
    workerScope.postMessage({ type: 'result', id: request.id, issues } satisfies ValidationResponse)
  } catch (error) {
    workerScope.postMessage({
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    } satisfies ValidationResponse)
  }
}

export {}
