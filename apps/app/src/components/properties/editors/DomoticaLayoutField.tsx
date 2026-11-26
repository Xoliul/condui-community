import CustomDropdown from '@/components/common/CustomDropdown'
import { DebouncedTextarea } from '@/components/forms'
import { editProperties } from '@/handlers/properties/editProperties'
import { getOpenProjectHorizontalSwitchBlock } from '@/lib/eendraad/horizontalDomoticaProject'
import { isHorizontalDomotica } from '@/lib/layout/domoticaHorizontalGeometry'
import type { Endpoint } from '@/types/schema'
import { labelClass, selectClass } from '../shared/propertiesSharedUtils'

/**
 * Vertical / Horizontal one-wire layout of a domotica module. Only a top-level circuit module off
 * the supply side (DC buses, converter lanes, supply taps) can be drawn horizontally, and only when nothing follows it on the circuit and no
 * module is nested on its outputs (the same rule `properties.edit` enforces). Switching back to
 * vertical is always possible.
 */
export function DomoticaLayoutField({
  endpointId,
  endpoint,
  t,
}: {
  endpointId: string
  endpoint: Endpoint
  t: (key: string, defaultValue?: string) => string
}) {
  if (endpoint.domoticaChildProps) return null
  const horizontal = isHorizontalDomotica(endpoint)
  const block = horizontal ? null : getOpenProjectHorizontalSwitchBlock(endpointId)
  const reason =
    block === 'has_nested_modules'
      ? t('endpoints.domotica.layout_horizontal_blocked_nested', 'Contains modules')
      : block === 'dc_bus' || block === 'supply_assembly'
        ? t('endpoints.domotica.layout_horizontal_blocked_supply', 'Not on the supply side')
        : block
          ? t('endpoints.domotica.layout_horizontal_blocked_last', 'Must be last on its circuit')
          : undefined
  const updateLayout = (layout: string) =>
    editProperties({
      edits: [
        {
          kind: 'endpoint',
          ids: [endpointId],
          set: { domoticaProps: { oneWireLayout: layout === 'horizontal' ? 'horizontal' : null } },
        },
      ],
    })
  const updateLabelText = (labelNotes: string) =>
    editProperties({ edits: [{ kind: 'endpoint', ids: [endpointId], set: { labelNotes } }] })
  return (
    <>
    <div>
      <label className={labelClass}>{t('endpoints.domotica.layout', 'Layout')}</label>
      <CustomDropdown
        value={horizontal ? 'horizontal' : 'vertical'}
        onChange={updateLayout}
        options={[
          { value: 'vertical', label: t('endpoints.domotica.layout_vertical', 'Vertical') },
          {
            value: 'horizontal',
            label: t('endpoints.domotica.layout_horizontal', 'Horizontal'),
            ...(block ? { disabled: true, title: reason } : {}),
          },
        ]}
        className={selectClass}
      />
    </div>
    {horizontal && (
      // The text inside the horizontal body: the default word for the module until one is entered.
      <div>
        <label className={labelClass}>{t('endpoints.domotica.labelText', 'Label text')}</label>
        <DebouncedTextarea
          value={endpoint.labelNotes ?? ''}
          onCommit={updateLabelText}
          delayMs={500}
          rows={1}
          className={`${selectClass} resize-none`}
          placeholder={t('endpoints.domotica.bodyDefault', 'Domotica')}
        />
      </div>
    )}
    </>
  )
}
