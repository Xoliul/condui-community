import { createContext } from 'react'

export type LabelPreviewSection = 'panels' | 'circuits' | 'branches' | 'terminals'

export const LabelPreviewContext = createContext<{
  highlighted: LabelPreviewSection | null
} | null>(null)
