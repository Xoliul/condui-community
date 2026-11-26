import type { SymbolMetadata } from './symbols'

/**
 * Search terms every domotica entry shares, so the entry with the extra literal tags never hides
 * the other one from a query that only matched it by synonym.
 */
export const DOMOTICA_SHARED_TAGS: string[] = [
  'home automation',
  'domotik',
  'woningautomatisering',
  'hausautomation',
  'gebäudeautomation',
  'automatyka domowa',
  'automatyka budynkowa',
  'dom inteligentny',
  'automatizări',
  'casă inteligentă',
]

/**
 * Catalog entries that are creation presets of another symbol (see lib/library/libraryPresets.ts).
 * They are stored as their base symbol, never under their own ID.
 */
export const libraryPresetEntries: SymbolMetadata[] = [
  {
    // Domotica module in the horizontal one-wire layout: one-wire only, stored as the plain
    // domotica endpoint with `domoticaProps.oneWireLayout: 'horizontal'`.
    id: 'domotica_horizontal',
    name: 'Domotica (horizontal)',
    nameNL: 'Domotica (horizontaal)',
    nameFR: 'Domotique (horizontale)',
    category: 'domotica',
    scope: 'eendraad',
    svgPath: '/symbols/domotica/domotica_horizontal_icon.svg',
    tags: [
      'bus',
      'knx',
      'domotica',
      'domotique',
      'smart home',
      'smarthome',
      'slimme installatie',
      ...DOMOTICA_SHARED_TAGS,
      'magistrala',
      'magistrală',
      'horizontal',
      'horizontaal',
      'horizontale',
      'poziomy',
      'orizontal',
    ],
    libraryPreset: true,
  },
]
