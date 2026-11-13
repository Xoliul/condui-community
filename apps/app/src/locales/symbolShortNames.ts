import type { SupportedLanguage } from '@/utils/languageRouting'

/**
 * Library-only short display names for symbols whose full name is too long for a list row.
 * The full name stays the symbol's name everywhere else, in library search and in tooltips.
 * Languages without an entry for a symbol show its normal name.
 */
export const symbolShortNames: Record<SupportedLanguage, Readonly<Record<string, string>>> = {
  'nl-BE': {
    rcd: 'Diff.schakelaar',
    rcbo: 'Diff.automaat',
    spd: 'Overspanning',
    socket_gnd_child: 'Contactdoos',
    double_socket_gnd_child: 'Dubbele contactdoos',
    socket_child: 'Zonder aarding',
    double_socket_child: 'Dubbel zonder aarding',
    boiler: 'Elektr. boiler',
    heating: 'Elektr. verwarming',
    domotica: 'Domotica',
    modular_socket: 'Modul. contactdoos',
    rectifier: 'Gelijkrichter',
    inverter: 'Omvormer',
  },
  en: {
    mcb: 'MCB',
    rcd: 'RCD',
    rcbo: 'RCBO',
    spd: 'SPD',
    socket_gnd_child: 'Socket',
    double_socket_gnd_child: 'Double socket',
    socket_child: 'Socket, no earth',
    double_socket_child: 'Double, no earth',
    domotica: 'Smart home',
  },
  'fr-BE': {
    backup_feed: 'Alim. de secours',
    rcd: 'Différentiel',
    rcbo: 'Diff. combiné',
    socket_gnd_child: 'Prise de courant',
    double_socket_gnd_child: 'Double prise',
    socket_child: 'Prise sans terre',
    double_socket_child: 'Double sans terre',
    switch_cross: 'Inter. croisement',
    switch_shutter: 'Inter. volets',
    light_sensor: 'Crépusculaire',
    motion_detector: 'Détect. mouvement',
    ev: 'Borne recharge VE',
    boiler: 'Chauffe-eau élec.',
    domotica: 'Domotique',
  },
  de: {
    mcb: 'LS-Schalter',
    rcd: 'FI-Schalter',
    socket_gnd_child: 'Steckdose',
    double_socket_gnd_child: 'Doppelsteckdose',
    socket_child: 'Ohne Erdung',
    double_socket_child: 'Doppelt ohne Erdung',
    boiler: 'Warmwasserspeicher',
    rectifier: 'Gleichrichter',
    inverter: 'Wechselrichter',
    domotica: 'Gebäudeautomation',
  },
  pl: {
    earthing_separator: 'Złącze kontrolne',
    mcb: 'Wył. nadprądowy',
    rcd: 'Wył. różnicowy',
    rcbo: 'Wył. różn. z nadpr.',
    socket_gnd_child: 'Gniazdo',
    double_socket_gnd_child: 'Gniazdo podwójne',
    socket_child: 'Bez uziemienia',
    double_socket_child: 'Podwójne bez uziem.',
    light_sensor: 'Wył. zmierzchowy',
    boiler: 'Podgrzewacz wody',
    heating: 'Ogrzewanie elektr.',
    domotica: 'Smart home',
  },
  ro: {
    earthing_separator: 'Separator de pământ',
    mcb: 'Int. automat',
    rcbo: 'Dif. cu protecție',
    spd: 'Supratensiune',
    socket_gnd_child: 'Priză',
    double_socket_gnd_child: 'Priză dublă',
    socket_child: 'Fără împământare',
    double_socket_child: 'Dublă fără pământ',
    switch_shutter: 'Comandă rulouri',
    light_sensor: 'Int. crepuscular',
    furnace_oil: 'Cazan pe păcură',
    domotica: 'Domotică',
  },
}

export function getSymbolShortName(symbolId: string, language: SupportedLanguage): string | undefined {
  return symbolShortNames[language][symbolId]
}
