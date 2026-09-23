import { useTranslation } from 'react-i18next'
import type { Selection } from '@/types/ui'

export function StructuralReadOnlyProperties({
  metadata,
}: {
  metadata: NonNullable<Selection['structuralMetadata']>
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4 p-4 text-sm text-gray-700 dark:text-gray-200">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {t('structure.item')}
        </div>
        <div className="mt-1 font-semibold">{metadata.label}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{metadata.kind}</div>
      </div>
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-2 text-xs">
        <dt className="text-gray-500 dark:text-gray-400">{t('structure.knowledge')}</dt>
        <dd>{t(`structure.knowledge_${metadata.knowledge}`)}</dd>
        <dt className="text-gray-500 dark:text-gray-400">{t('structure.source')}</dt>
        <dd className="break-all">{metadata.source.container}</dd>
        <dt className="text-gray-500 dark:text-gray-400">{t('structure.sourceType')}</dt>
        <dd>{metadata.source.entityKind}</dd>
        {metadata.source.entityId && (
          <>
            <dt className="text-gray-500 dark:text-gray-400">{t('structure.sourceId')}</dt>
            <dd className="break-all">{metadata.source.entityId}</dd>
          </>
        )}
      </dl>
      {metadata.wire ? (
        <div className="rounded border border-gray-200 p-2 dark:border-gray-700">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {metadata.wire.medium === 'busbar' ? t('structure.busbar') : t('structure.wire')}
          </div>
          <div className="mt-1 font-semibold">{metadata.wire.label}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {metadata.wire.medium === 'busbar'
              ? t('structure.busbarBars', { count: metadata.wire.conductorCount })
              : t('structure.wireConductors', { count: metadata.wire.conductorCount })}
            {typeof metadata.wire.lengthM === 'number' ? ` · ${metadata.wire.lengthM} m` : ''}
          </div>
        </div>
      ) : null}
      {metadata.diagnosticCodes?.length ? (
        <div className="rounded border border-orange-300 bg-orange-50 p-2 text-xs text-orange-800 dark:border-orange-700 dark:bg-orange-950/30 dark:text-orange-300">
          {metadata.diagnosticCodes.join(' · ')}
        </div>
      ) : null}
      {metadata.summary && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-gray-100 p-2 text-[11px] dark:bg-gray-800">
          {metadata.summary}
        </pre>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">{t('structure.projectedReadOnly')}</p>
    </div>
  )
}
