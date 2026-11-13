import type { Endpoint, TrunkDevice, ProtectionDevice } from '@/types/schema'
import type { SymbolMetadata } from '@/lib/symbols'

type Defaults = Partial<
  Pick<
    Endpoint,
    | 'relayProps'
    | 'switchProps'
    | 'lightPointProps'
    | 'lightSpotProps'
    | 'lightFluorescentProps'
    | 'fixedApplianceProps'
    | 'smokeDetectorProps'
    | 'socketProps'
  >
> &
  Pick<ProtectionDevice, 'surgeProtectionKind'>
export interface SearchPreset {
  id: string
  symbolId: string
  /** Explicit phrases only; fuzzy/synonym expansion must never choose settings. */
  aliases: readonly string[]
  defaults: Defaults
}

export const searchPresets: readonly SearchPreset[] = [
  {
    id: 'relay_impulse',
    symbolId: 'relay',
    aliases: [
      'teleruptor',
      'telerupteur',
      'teleruptoir',
      'télérupteur',
      'impulsrelais',
      'impulse relay',
      'latching relay',
      'Stromstoßrelais',
      'przekaźnik impulsowy',
      'releu de impuls',
    ],
    defaults: { relayProps: { control: 'impulse' } },
  },
  {
    id: 'relay_timer',
    symbolId: 'relay',
    aliases: [
      'tijdrelais',
      'timer relay',
      'time relay',
      'relais temporisé',
      'Zeitrelais',
      'przekaźnik czasowy',
      'releu temporizat',
    ],
    defaults: { relayProps: { control: 'timer' } },
  },
  {
    id: 'relay_clock',
    symbolId: 'relay',
    aliases: [
      'schakelklok',
      'clock relay',
      'time switch',
      'interrupteur horaire',
      'Zeitschaltuhr',
      'zegar sterujący',
      'ceas programator',
    ],
    defaults: { relayProps: { control: 'clock' } },
  },
  {
    id: 'relay_thermostat',
    symbolId: 'relay',
    aliases: ['thermostaat', 'thermostat', 'termostat'],
    defaults: { relayProps: { control: 'thermostat' } },
  },
  {
    id: 'relay_dimmer',
    symbolId: 'relay',
    aliases: [
      'dimmer relay',
      'dimmerrelais',
      'relais variateur',
      'Dimmrelais',
      'przekaźnik ściemniający',
      'releu variator',
    ],
    defaults: { relayProps: { control: 'dimmer' } },
  },
  {
    id: 'switch_1p',
    symbolId: 'switch',
    aliases: [
      'enkelpolig',
      'enkelpolige',
      'single pole',
      'single-pole',
      '1p',
      'unipolaire',
      'einpolig',
      'jednobiegunowy',
      'monopolar',
    ],
    defaults: { switchProps: { poles: 1 } },
  },
  {
    id: 'switch_2p',
    symbolId: 'switch',
    aliases: [
      'dubbelpolig',
      'dubbelpolige',
      'double pole',
      'double-pole',
      '2p',
      'bipolaire',
      'zweipolig',
      'dwubiegunowy',
      'bipolar',
    ],
    defaults: { switchProps: { poles: 2 } },
  },
  {
    id: 'switch_3p',
    symbolId: 'switch',
    aliases: [
      'driepolig',
      'driepolige',
      'triple pole',
      'three pole',
      '3p',
      'tripolaire',
      'dreipolig',
      'trójbiegunowy',
      'tripolar',
    ],
    defaults: { switchProps: { poles: 3 } },
  },
  {
    id: 'switch_4p',
    symbolId: 'switch',
    aliases: [
      'vierpolig',
      'vierpolige',
      'four pole',
      '4p',
      'tétrapolaire',
      'vierpolig',
      'czterobiegunowy',
      'tetrapolar',
    ],
    defaults: { switchProps: { poles: 4 } },
  },
  {
    id: 'switch_twoway_2p',
    symbolId: 'switch_1p_twoway',
    aliases: [
      'dubbelpolige wisselschakelaar',
      'two pole two way',
      'double pole two way',
      'va et vient bipolaire',
      'zweipoliger Wechselschalter',
      'łącznik schodowy dwubiegunowy',
      'comutator cap scară bipolar',
    ],
    defaults: { switchProps: { twoPole: true } },
  },
  {
    id: 'pushbutton_protected',
    symbolId: 'switch_impulse',
    aliases: [
      'beschermde drukknop',
      'protected pushbutton',
      'break glass',
      'bouton poussoir protégé',
      'geschützter Taster',
      'przycisk chroniony',
      'buton protejat',
    ],
    defaults: { switchProps: { protected: true } },
  },
  {
    id: 'switch_indicator',
    symbolId: 'switch',
    aliases: [
      'verklikkerlamp',
      'switch with indicator',
      'indicator switch',
      'interrupteur avec voyant',
      'Kontrollschalter',
      'łącznik z lampką',
      'întrerupător cu indicator',
    ],
    defaults: { switchProps: { verklikkerlamp: true } },
  },
  {
    id: 'spd_lightning',
    symbolId: 'spd',
    aliases: [
      'bliksembeveiliging',
      'bliksemafleider',
      'lightning protection',
      'lightning arrester',
      'protection contre la foudre',
      'Blitzschutz',
      'ochrona odgromowa',
      'protecție la trăsnet',
    ],
    defaults: { surgeProtectionKind: 'standard' },
  },
  {
    id: 'spd_spark',
    symbolId: 'spd',
    aliases: [
      'vonkbrug',
      'spark gap',
      'spark bridge',
      'éclateur',
      'Funkenstrecke',
      'iskiernik',
      'eclator',
    ],
    defaults: { surgeProtectionKind: 'sparkGap' },
  },
  {
    id: 'light_wall',
    symbolId: 'light_point',
    aliases: [
      'wandlamp',
      'licht op muur',
      'wall light',
      'light on wall',
      'applique murale',
      'Wandleuchte',
      'kinkiet',
      'aplică de perete',
    ],
    defaults: { lightPointProps: { onWall: true } },
  },
  {
    id: 'light_emergency',
    symbolId: 'light_point',
    aliases: [
      'noodverlichting',
      'emergency light',
      'éclairage de secours',
      'Notbeleuchtung',
      'oświetlenie awaryjne',
      'iluminat de urgență',
    ],
    defaults: { lightPointProps: { safety: true } },
  },
  {
    id: 'light_decentral',
    symbolId: 'light_point',
    aliases: [
      'decentrale noodverlichting',
      'autonome noodverlichting',
      'decentral emergency',
      'self contained emergency',
      'éclairage de secours autonome',
      'dezentrale Notbeleuchtung',
      'autonomiczne oświetlenie awaryjne',
      'iluminat de urgență autonom',
    ],
    defaults: { lightPointProps: { safety: true, decentral: true } },
  },
  {
    id: 'spot_straight',
    symbolId: 'light_spot',
    aliases: [
      'rechte bundel',
      'straight beam',
      'spot straight',
      'faisceau droit',
      'gerader Lichtkegel',
      'wiązka równoległa',
      'fascicul drept',
    ],
    defaults: { lightSpotProps: { beamType: 'straight' } },
  },
  {
    id: 'spot_diverging',
    symbolId: 'light_spot',
    aliases: [
      'divergerende spot',
      'divergerend',
      'diverging spot',
      'spot diverging',
      'diverging beam',
      'faisceau divergent',
      'divergierender Lichtkegel',
      'wiązka rozbieżna',
      'fascicul divergent',
    ],
    defaults: { lightSpotProps: { beamType: 'diverging' } },
  },
  {
    id: 'fluorescent_1',
    symbolId: 'light_fluorescent',
    aliases: ['tl', 'fluorescent', 'tl 1', '1 tube', '1 buis', '1 Röhre', '1 świetlówka', '1 tub'],
    defaults: { lightFluorescentProps: { tubeCount: 1 } },
  },
  {
    id: 'fluorescent_2',
    symbolId: 'light_fluorescent',
    aliases: ['tl 2', '2 tubes', '2 buizen', '2 Röhren', '2 świetlówki', '2 tuburi'],
    defaults: { lightFluorescentProps: { tubeCount: 2 } },
  },
  {
    id: 'fluorescent_3',
    symbolId: 'light_fluorescent',
    aliases: ['tl 3', '3 tubes', '3 buizen', '3 Röhren', '3 świetlówki', '3 tuburi'],
    defaults: { lightFluorescentProps: { tubeCount: 3 } },
  },
  {
    id: 'heating_accumulation',
    symbolId: 'heating',
    aliases: [
      'accumulatieverwarming',
      'accumulation heating',
      'storage heater',
      'chauffage à accumulation',
      'Speicherheizung',
      'ogrzewanie akumulacyjne',
      'încălzire cu acumulare',
    ],
    defaults: { fixedApplianceProps: { accumulationHeating: true } },
  },
  {
    id: 'heating_fan',
    symbolId: 'heating',
    aliases: [
      'accumulatieverwarming met ventilator',
      'storage heater with fan',
      'accumulation heating with fan',
      'chauffage à accumulation avec ventilateur',
      'Speicherheizung mit Lüfter',
      'piec akumulacyjny z wentylatorem',
      'încălzire cu acumulare cu ventilator',
    ],
    defaults: { fixedApplianceProps: { accumulationHeating: true, withFan: true } },
  },
  {
    id: 'boiler_accumulation',
    symbolId: 'boiler',
    aliases: [
      'accumulatieboiler',
      'accumulation boiler',
      'storage water heater',
      'chauffe eau à accumulation',
      'Speicherboiler',
      'bojler akumulacyjny',
      'boiler cu acumulare',
    ],
    defaults: { fixedApplianceProps: { accumulating: true } },
  },
  {
    id: 'socket_ungrounded',
    symbolId: 'socket',
    aliases: [
      'stopcontact zonder aarding',
      'stopcontact zonder aarde',
      'socket without ground',
      'socket without earth',
      'ungrounded socket',
      'prise sans terre',
      'Steckdose ohne Schutzkontakt',
      'gniazdo bez uziemienia',
      'priză fără împământare',
    ],
    defaults: {},
  },
  {
    id: 'socket_waterproof',
    symbolId: 'socket_gnd_child',
    aliases: [
      'waterdicht stopcontact',
      'waterproof socket',
      'weatherproof socket',
      'prise étanche',
      'wasserdichte Steckdose',
      'gniazdo hermetyczne',
      'priză etanșă',
    ],
    defaults: { socketProps: { waterproof: true } },
  },
  {
    id: 'detector_gas',
    symbolId: 'smoke_detector',
    aliases: [
      'gasdetector',
      'gas detector',
      'détecteur de gaz',
      'Gasmelder',
      'czujnik gazu',
      'detector de gaz',
    ],
    defaults: { smokeDetectorProps: { type: 'gas' } },
  },
  {
    id: 'detector_heat',
    symbolId: 'smoke_detector',
    aliases: [
      'hittedetector',
      'warmtedetector',
      'heat detector',
      'détecteur de chaleur',
      'Wärmemelder',
      'czujnik ciepła',
      'detector de căldură',
    ],
    defaults: { smokeDetectorProps: { type: 'heat' } },
  },
  {
    id: 'detector_flame',
    symbolId: 'smoke_detector',
    aliases: [
      'vlamdetector',
      'flame detector',
      'détecteur de flamme',
      'Flammenmelder',
      'czujnik płomienia',
      'detector de flacără',
    ],
    defaults: { smokeDetectorProps: { type: 'flame' } },
  },
]

export function getSearchPreset(symbolId: string, presetId?: string): SearchPreset | undefined {
  return searchPresets.find((preset) => preset.id === presetId && preset.symbolId === symbolId)
}

export function normalizePresetQuery(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** Longest explicit phrase wins; equal competing variants stay generic. */
export function matchSearchPreset(symbolId: string, query: string): SearchPreset | undefined {
  const normalized = ` ${normalizePresetQuery(query)} `
  const matches = searchPresets
    .filter((preset) => preset.symbolId === symbolId)
    .map((preset) => ({
      preset,
      score: Math.max(
        0,
        ...preset.aliases.map((alias) => {
          const phrase = normalizePresetQuery(alias)
          return normalized.includes(` ${phrase} `) ? phrase.length : 0
        })
      ),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
  return matches[0] && matches[0].score !== matches[1]?.score ? matches[0].preset : undefined
}

export function withSearchPreset(symbol: SymbolMetadata, presetId?: string): SymbolMetadata {
  return getSearchPreset(symbol.id, presetId) ? { ...symbol, searchPreset: presetId } : symbol
}

/** Defaults are drawn from this allowlisted registry, never arbitrary drag payload properties. */
export function applySearchPreset(
  symbol: Pick<SymbolMetadata, 'id' | 'searchPreset'>,
  device: Endpoint | TrunkDevice | ProtectionDevice
): void {
  const preset = getSearchPreset(symbol.id, symbol.searchPreset)
  if (
    !preset ||
    !(
      ('symbol' in device && device.symbol === symbol.id) ||
      (symbol.id === 'spd' && device.type === 'SPD')
    )
  )
    return
  for (const key of Object.keys(preset.defaults) as (keyof Defaults)[]) {
    const value = preset.defaults[key]
    const target: Partial<Record<keyof Defaults, unknown>> = device
    target[key] = typeof value === 'object' ? { ...(target[key] as object), ...value } : value
  }
}
