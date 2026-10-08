/**
 * Symbol Library Catalog
 *
 * Metadata for all electrical symbols in Eendra
 * Based on Belgian electrical diagram standards (AREI/RGIE)
 */

import type { ElectricalDomain } from '../types/schema'
import { DEFAULT_ELECTRICAL_DOMAIN as DEFAULT_DOMAIN } from '../types/schema'

export interface SymbolMetadata {
  id: string
  name: string
  nameNL: string
  nameFR: string
  category: string
  scope: 'eendraad' | 'situatieplan' | 'both'
  svgPath: string
  tags: string[]
  /** For energy conversion components: input electrical domain */
  inputDomain?: ElectricalDomain
  /** For energy conversion components: output electrical domain */
  outputDomain?: ElectricalDomain
  /**
   * Fixed typed ports for symbols that can sit between two wires.
   * Order is visual only; matching is domain-based and direction-agnostic.
   */
  portDomains?: [ElectricalDomain, ElectricalDomain]
  /** Passive two-terminal device that preserves the domain of the wire it is placed on. */
  inheritsWireDomain?: boolean
  /** If true, symbol is not shown in the library (e.g. deprecated types). */
  hiddenFromLibrary?: boolean
  /** Library-only preset; resolves to a base endpoint symbol (and defaults) on drop. */
  libraryPreset?: boolean
  /** Library drag marker that creates a top-level panel bus feed boundary. */
  busFeedKind?: 'grid' | 'backup'
}

export const symbolCategories = {
  grid: 'Grid & Earthing',
  protection: 'Protection Devices',
  outlets: 'Power Outlets',
  switches: 'Switches & Controls',
  lighting: 'Lighting',
  appliances: 'Fixed Appliances',
  hvac: 'HVAC',
  sound: 'Sound Devices',
  domotica: 'Domotica / Smart home',
  metering: 'Metering',
  energyConversion: 'Energy Conversion',
  notes: 'Notes & Labels',
} as const

export const symbols: SymbolMetadata[] = [
  // Grid & Earthing
  {
    id: 'mains',
    name: 'Mains Entry',
    nameNL: 'Netaansluiting',
    nameFR: 'Raccordement réseau',
    category: 'grid',
    scope: 'eendraad',
    svgPath: '/symbols/grid/mains.svg',
    tags: ['grid', 'supply', 'phases'],
    busFeedKind: 'grid',
  },
  {
    id: 'backup_feed',
    name: 'Backup Feed',
    nameNL: 'Backupvoeding',
    nameFR: 'Alimentation de secours',
    category: 'grid',
    scope: 'eendraad',
    svgPath: '/symbols/grid/backup_feed.svg',
    tags: ['backup', 'battery', 'inverter', 'supply', 'noodvoeding', 'secours'],
    busFeedKind: 'backup',
  },
  {
    id: 'earthing',
    name: 'Earthing',
    nameNL: 'Aarding',
    nameFR: 'Mise à la terre',
    category: 'grid',
    scope: 'both',
    svgPath: '/symbols/grid/earthing.svg',
    tags: ['earth', 'ground', 'PE'],
  },
  {
    id: 'earthing_separator',
    name: 'Earthing Separator',
    nameNL: 'Aardingsonderbreker',
    nameFR: 'Séparateur de terre',
    category: 'grid',
    scope: 'eendraad',
    svgPath: '/symbols/grid/earthing_separator.svg',
    tags: ['earth', 'ground', 'PE', 'separator', 'aardingsonderbreker'],
  },
  {
    id: 'panel_distribution',
    name: 'Distribution Panel',
    nameNL: 'Verdeelbord',
    nameFR: 'Tableau de distribution',
    category: 'grid',
    scope: 'both',
    svgPath: '/symbols/grid/panel_distribution.svg',
    tags: [
      'panel',
      'board',
      'distribution',
      'verdeelbord',
      'tableau de distribution',
      'hoofdbord',
      'subbord',
      'zekeringkast',
      'kast',
      'coffret',
      'tableau électrique',
      'fuse box',
    ],
  },
  {
    id: 'junction_box',
    name: 'Junction Box',
    nameNL: 'Verbindingsdoos',
    nameFR: 'Boîte de jonction',
    category: 'grid',
    scope: 'both',
    svgPath: '/symbols/junction/junction_box.svg',
    tags: ['junction', 'box', 'verbindingsdoos', 'boîte de jonction', 'supply', 'ground'],
  },
  {
    id: 'junction_panel',
    name: 'Junction Panel',
    nameNL: 'Verbindingspaneel',
    nameFR: 'Panneau de jonction',
    category: 'grid',
    scope: 'both',
    svgPath: '/symbols/junction/junction_panel.svg',
    tags: [
      'junction',
      'panel',
      'verbindingspaneel',
      'panneau de jonction',
      'supply',
      'ground',
      'label',
    ],
  },
  {
    id: 'terminal_strip',
    name: 'Terminal Strip',
    nameNL: 'Klemmenstrook',
    nameFR: 'Bornier',
    category: 'grid',
    scope: 'both',
    svgPath: '/symbols/junction/terminal_strip.svg',
    tags: [
      'terminal',
      'strip',
      'terminal block',
      'wago',
      'clamp',
      'klemmenstrook',
      'klem',
      'bornier',
      'borne',
      'supply',
      'ground',
    ],
  },

  // Protection Devices
  {
    id: 'mcb',
    name: 'MCB (Circuit Breaker)',
    nameNL: 'Automaat',
    nameFR: 'Disjoncteur',
    category: 'protection',
    scope: 'eendraad',
    svgPath: '/symbols/protection/mcb.svg',
    tags: [
      'breaker',
      'protection',
      'MCB',
      'automaat',
      'automatische schakelaar',
      'beveiligingsschakelaar',
      'disjoncteur',
      'beveiligingstoestel',
      'circuit breaker',
    ],
  },
  {
    id: 'rcd',
    name: 'RCD (Residual Current Device)',
    nameNL: 'Differentieelschakelaar',
    nameFR: 'Disjoncteur différentiel',
    category: 'protection',
    scope: 'eendraad',
    svgPath: '/symbols/protection/rcd.svg',
    tags: [
      'RCD',
      'differential',
      'protection',
      'differentieelschakelaar',
      'disjoncteur différentiel',
      'beveiligingstoestel',
    ],
  },
  {
    id: 'rcbo',
    name: 'RCBO (Combined)',
    nameNL: 'Differentieelautomaat',
    nameFR: 'Disjoncteur différentiel combiné',
    category: 'protection',
    scope: 'eendraad',
    svgPath: '/symbols/protection/rcbo.svg',
    tags: [
      'RCBO',
      'combined',
      'protection',
      'differentieelautomaat',
      'disjoncteur différentiel combiné',
      'beveiligingstoestel',
    ],
  },
  {
    id: 'fuse',
    name: 'Fuse',
    nameNL: 'Zekering',
    nameFR: 'Fusible',
    category: 'protection',
    scope: 'eendraad',
    svgPath: '/symbols/protection/fuse.svg',
    tags: ['fuse', 'zekering', 'fusible', 'protection', 'beveiligingstoestel'],
  },
  {
    id: 'main_switch',
    name: 'Main Switch',
    nameNL: 'Hoofdschakelaar',
    nameFR: 'Interrupteur principal',
    category: 'protection',
    scope: 'eendraad',
    svgPath: '/symbols/protection/main_switch.svg',
    tags: ['main switch', 'hoofdschakelaar', 'interrupteur principal', 'switch', 'schakelaar'],
    hiddenFromLibrary: true,
  },
  {
    id: 'spd',
    name: 'SPD (Surge Protection Device)',
    nameNL: 'Overspanningsbeveiliging',
    nameFR: 'Parafoudre',
    category: 'protection',
    scope: 'eendraad',
    svgPath: '/symbols/protection/spd.svg',
    tags: [
      'SPD',
      'surge protection',
      'surge protector',
      'overvoltage protection',
      'lightning protection',
      'lightning protector',
      'lightning arrester',
      'spark gap',
      'spark-gap protector',
      'overspanning',
      'overspanningsbeveiliging',
      'bliksembeveiliging',
      'bliksemafleider',
      'vonkbrug',
      'vonkbrugbeveiliging',
      'parafoudre',
      'protection contre la foudre',
      'protection contre les surtensions',
      'surtension',
      'éclateur',
      'protection à éclateur',
      'beveiligingstoestel',
    ],
  },
  {
    id: 'rotating_switch',
    name: 'Rotating switch',
    nameNL: 'Draaischakelaar',
    nameFR: 'Commutateur rotatif',
    category: 'protection',
    scope: 'both',
    svgPath: '/symbols/protection/rotating_switch.svg',
    tags: [
      'rotating switch',
      'draaischakelaar',
      'commutateur rotatif',
      'schakelaar',
      'switch',
      'supply',
    ],
  },
  {
    id: 'source_changeover',
    name: 'Source transfer switch',
    nameNL: 'Omschakelaar',
    nameFR: 'Inverseur de sources',
    category: 'protection',
    scope: 'eendraad',
    svgPath: '/symbols/switches/source_changeover.svg',
    tags: [
      'source transfer switch',
      'transfer switch',
      'automatic transfer switch',
      'manual transfer switch',
      'ATS switch',
      'dual power transfer switch',
      'automatic changeover switch',
      'manual changeover switch',
      'ATS',
      'MTS',
      'source changeover',
      'modular switch',
      'modular source changeover',
      'changeover',
      'changeover switch',
      'source selector',
      'source selection switch',
      '1-0-2',
      'bronomschakelaar',
      'modulaire omschakelaar',
      'modulaire net-omschakelaar',
      'omschakelaar',
      'automatische omschakelaar',
      'handmatige omschakelaar',
      'automatische transferschakelaar',
      'handbediende omschakelaar',
      'noodstroomomschakelaar',
      'automatische netomschakelaar',
      'handmatige netomschakelaar',
      'bronkeuzeschakelaar',
      'netkeuzeschakelaar',
      'net-omschakelaar',
      'netomschakelaar',
      'inverseur de sources',
      'inverseur de source',
      'inverseur modulaire',
      'inverseur de source modulaire',
      'inverseur de source automatique',
      'inverseur automatique de source',
      'inverseur de source manuel',
      'inverseur réseau groupe',
      'commutateur de transfert',
      'commutateur de source',
    ],
  },

  // Outlets (library: child-protected variants + doubles; base/ground-only hidden — still in catalog for existing projects)
  {
    id: 'socket_gnd_child',
    name: 'Socket with protective conductor contact and child protection',
    nameNL: 'Contactdoos met contact voor beschermingsgeleider en met kinderbescherming',
    nameFR: 'Prise de courant avec contact pour conducteur de protection et protection enfant',
    category: 'outlets',
    scope: 'both',
    svgPath: '/symbols/outlets/socket_gnd_child.svg',
    tags: [
      'socket',
      'outlet',
      'contactdoos',
      'stopcontact',
      'prise',
      'prise de courant',
      'grounded',
      'child protection',
      'geaard',
      'kinderbescherming',
    ],
  },
  {
    id: 'double_socket_gnd_child',
    name: 'Double socket with protective conductor contact and child protection',
    nameNL: 'Dubbele contactdoos met contact voor beschermingsgeleider en met kinderbescherming',
    nameFR:
      'Double prise de courant avec contact pour conducteur de protection et protection enfant',
    category: 'outlets',
    scope: 'both',
    svgPath: '/symbols/outlets/double_socket_gnd_child.svg',
    tags: [
      'socket',
      'outlet',
      'double',
      'dubbel',
      'contactdoos',
      'stopcontact',
      'prise',
      'grounded',
      'child protection',
      'geaard',
      'kinderbescherming',
      '2',
    ],
    libraryPreset: true,
  },
  {
    id: 'socket_child',
    name: 'Socket with child protection',
    nameNL: 'Contactdoos met kinderbescherming',
    nameFR: 'Prise de courant avec protection enfant',
    category: 'outlets',
    scope: 'both',
    svgPath: '/symbols/outlets/socket_child.svg',
    tags: [
      'socket',
      'outlet',
      'contactdoos',
      'stopcontact',
      'prise',
      'prise de courant',
      'child protection',
      'kinderbescherming',
    ],
  },
  {
    id: 'double_socket_child',
    name: 'Double socket with child protection',
    nameNL: 'Dubbele contactdoos met kinderbescherming',
    nameFR: 'Double prise de courant avec protection enfant',
    category: 'outlets',
    scope: 'both',
    svgPath: '/symbols/outlets/double_socket_child.svg',
    tags: [
      'socket',
      'outlet',
      'double',
      'dubbel',
      'contactdoos',
      'stopcontact',
      'prise',
      'child protection',
      'kinderbescherming',
      '2',
    ],
    libraryPreset: true,
  },
  {
    id: 'modular_socket',
    name: 'Modular socket',
    nameNL: 'Modulaire contactdoos',
    nameFR: 'Prise modulaire',
    category: 'outlets',
    scope: 'eendraad',
    svgPath: '/symbols/outlets/socket_gnd_child.svg',
    tags: [
      'socket',
      'outlet',
      'modular',
      'din',
      'panel',
      'contactdoos',
      'stopcontact',
      'modulaire contactdoos',
      'prise',
      'prise modulaire',
      'tableau',
      'bord',
      'rail',
    ],
    libraryPreset: true,
  },
  {
    id: 'socket_gnd',
    name: 'Socket with protective conductor contact',
    nameNL: 'Contactdoos met contact voor beschermingsgeleider',
    nameFR: 'Prise de courant avec contact pour conducteur de protection',
    category: 'outlets',
    scope: 'both',
    svgPath: '/symbols/outlets/socket_gnd.svg',
    tags: [
      'socket',
      'outlet',
      'contactdoos',
      'stopcontact',
      'prise',
      'prise de courant',
      'grounded',
      'geaard',
    ],
    hiddenFromLibrary: true,
  },
  {
    id: 'socket',
    name: 'Socket',
    nameNL: 'Contactdoos',
    nameFR: 'Prise de courant',
    category: 'outlets',
    scope: 'both',
    svgPath: '/symbols/outlets/socket.svg',
    tags: ['socket', 'outlet', 'contactdoos', 'stopcontact', 'prise', 'prise de courant'],
    hiddenFromLibrary: true,
  },

  // Switches (base SVG resolved by getSwitchSymbolPaths; catalog icon uses default)
  {
    id: 'switch',
    name: 'Switch',
    nameNL: 'Schakelaar',
    nameFR: 'Interrupteur',
    category: 'switches',
    scope: 'both',
    svgPath: '/symbols/switches/switch_1p.svg',
    tags: ['switch', 'toggle', 'schakelaar', 'interrupteur', '1p', '2p', '3p'],
  },
  {
    id: 'switch_1p_twoway',
    name: 'Two-way Switch',
    nameNL: 'Wisselschakelaar',
    nameFR: 'Va-et-vient',
    category: 'switches',
    scope: 'both',
    svgPath: '/symbols/switches/switch_1p_twoway.svg',
    tags: ['switch', 'two-way', 'staircase', '1p', '2p'],
  },
  {
    id: 'switch_cross',
    name: 'Cross Switch',
    nameNL: 'Kruisschakelaar',
    nameFR: 'Interrupteur de croisement',
    category: 'switches',
    scope: 'both',
    svgPath: '/symbols/switches/switch_cross.svg',
    tags: ['switch', 'cross', 'intermediate'],
  },
  {
    id: 'switch_dimmer',
    name: 'Dimmer',
    nameNL: 'Dimmer',
    nameFR: 'Variateur',
    category: 'switches',
    scope: 'both',
    svgPath: '/symbols/switches/switch_dimmer.svg',
    tags: ['switch', 'dimmer', 'variateur'],
  },
  {
    id: 'switch_1p_changeover',
    name: 'Changeover Switch',
    nameNL: 'Omschakelaar',
    nameFR: 'Interrupteur à bascule',
    category: 'switches',
    scope: 'both',
    svgPath: '/symbols/switches/switch_1p_changeover.svg',
    tags: ['switch', 'changeover', 'omschakelaar'],
  },
  {
    id: 'switch_1p_pull',
    name: 'Pull Switch',
    nameNL: 'Trek schakelaar',
    nameFR: 'Interrupteur à tirette',
    category: 'switches',
    scope: 'both',
    svgPath: '/symbols/switches/switch_1p_pull.svg',
    tags: ['switch', 'pull', 'trek'],
  },
  {
    id: 'contact',
    name: 'Contact',
    nameNL: 'Contact',
    nameFR: 'Contact',
    category: 'switches',
    scope: 'eendraad',
    svgPath: '/symbols/switches/contact.svg',
    tags: ['contact', 'los contact', 'domotica', 'input', 'ingang', 'potentiaalvrij', 'dry contact'],
  },
  {
    id: 'switch_impulse',
    name: 'Impulse/Push Switch',
    nameNL: 'Impulsschakelaar',
    nameFR: 'Bouton-poussoir',
    category: 'switches',
    scope: 'both',
    svgPath: '/symbols/switches/switch_impulse.svg',
    tags: ['switch', 'push', 'impulse', 'momentary'],
  },
  {
    id: 'motion_detector',
    name: 'Motion detector',
    nameNL: 'Bewegingsdetector',
    nameFR: 'Détecteur de mouvement',
    category: 'switches',
    scope: 'both',
    svgPath: '/symbols/switches/motion_detector.svg',
    tags: [
      'switch',
      'motion',
      'detector',
      'presence',
      'bewegingsdetector',
      'bewegingsmelder',
      'IR',
    ],
  },
  {
    id: 'smoke_detector',
    name: 'Smoke detector',
    nameNL: 'Rookdetector',
    nameFR: 'Détecteur de fumée',
    category: 'switches',
    scope: 'both',
    svgPath: '/symbols/switches/smoke_detector.svg',
    tags: [
      'switch',
      'smoke',
      'detector',
      'fire',
      'gas',
      'heat',
      'flame',
      'beam',
      'rookdetector',
      'branddetector',
      'rookmelder',
      'gasdetector',
      'warmtedetector',
      'vlamdetector',
      'straaldetector',
    ],
  },
  {
    id: 'relay',
    name: 'Relay',
    nameNL: 'Relais',
    nameFR: 'Relais',
    category: 'switches',
    scope: 'eendraad',
    svgPath: '/symbols/switches/relay_standard.svg',
    tags: ['relay', 'relais', 'teleruptor', 'contactor'],
  },

  // Lighting
  {
    id: 'light_point',
    name: 'Light Point',
    nameNL: 'Lichtpunt',
    nameFR: 'Point lumineux',
    category: 'lighting',
    scope: 'both',
    svgPath: '/symbols/lighting/light_point.svg',
    tags: ['light', 'lamp', 'generic', 'lichtpunt', 'point lumineux'],
  },
  {
    id: 'light_spot',
    name: 'Spot Light',
    nameNL: 'Spot',
    nameFR: 'Spot',
    category: 'lighting',
    scope: 'both',
    svgPath: '/symbols/lighting/light_spot.svg',
    tags: ['light', 'spot', 'downlight'],
  },
  {
    id: 'light_led',
    name: 'LED Fixture',
    nameNL: 'LED armatuur',
    nameFR: 'Luminaire LED',
    category: 'lighting',
    scope: 'both',
    svgPath: '/symbols/lighting/light_led.svg',
    // A bare LED strip and an LED fixture with a driver use the same symbol.
    // The upstream supply determines the domain, rather than the light type.
    inheritsWireDomain: true,
    tags: ['light', 'LED', 'fixture'],
  },
  {
    id: 'light_fluorescent',
    name: 'Fluorescent Tube',
    nameNL: 'TL-buis',
    nameFR: 'Tube fluorescent',
    category: 'lighting',
    scope: 'both',
    svgPath: '/symbols/lighting/light_fluorescent.svg',
    tags: ['light', 'fluorescent', 'TL', 'tube'],
  },

  // Appliances (order: stove first, EV second-to-last, motor last, then generic device)
  {
    id: 'stove',
    name: 'Stove',
    nameNL: 'Fornuis',
    nameFR: 'Cuisinière',
    category: 'appliances',
    scope: 'both',
    svgPath: '/symbols/appliances/stove.svg',
    tags: [
      'appliance',
      'kitchen',
      'stove',
      'fornuis',
      'cuisinière',
      'kookplaat',
      'taque',
      'cooker',
      'hob',
    ],
  },
  {
    id: 'oven',
    name: 'Oven',
    nameNL: 'Oven',
    nameFR: 'Four',
    category: 'appliances',
    scope: 'both',
    svgPath: '/symbols/appliances/oven.svg',
    tags: ['appliance', 'kitchen', 'oven'],
  },
  {
    id: 'washer',
    name: 'Washing Machine',
    nameNL: 'Wasmachine',
    nameFR: 'Machine à laver',
    category: 'appliances',
    scope: 'both',
    svgPath: '/symbols/appliances/washer.svg',
    tags: ['appliance', 'laundry', 'washing'],
  },
  {
    id: 'dryer',
    name: 'Dryer',
    nameNL: 'Droogkast',
    nameFR: 'Sèche-linge',
    category: 'appliances',
    scope: 'both',
    svgPath: '/symbols/appliances/dryer.svg',
    tags: ['appliance', 'laundry', 'dryer'],
  },
  {
    id: 'dishwasher',
    name: 'Dishwasher',
    nameNL: 'Vaatwasmachine',
    nameFR: 'Lave-vaisselle',
    category: 'appliances',
    scope: 'both',
    svgPath: '/symbols/appliances/dishwasher.svg',
    tags: ['appliance', 'kitchen', 'dishwasher'],
  },
  {
    id: 'boiler',
    name: 'Electric Boiler',
    nameNL: 'Elektrische boiler',
    nameFR: 'Chauffe-eau électrique',
    category: 'hvac',
    scope: 'both',
    svgPath: '/symbols/appliances/boiler.svg',
    tags: [
      'appliance',
      'water',
      'heater',
      'boiler',
      'accumulating',
      'elektrische boiler',
      'chauffe-eau',
      'chauffe-eau électrique',
    ],
  },
  {
    id: 'freezer',
    name: 'Freezer',
    nameNL: 'Vriezer',
    nameFR: 'Congélateur',
    category: 'appliances',
    scope: 'both',
    svgPath: '/symbols/appliances/freezer.svg',
    tags: ['appliance', 'kitchen', 'freezer'],
  },
  {
    id: 'fridge',
    name: 'Fridge',
    nameNL: 'Koelkast',
    nameFR: 'Réfrigérateur',
    category: 'appliances',
    scope: 'both',
    svgPath: '/symbols/appliances/fridge.svg',
    tags: ['appliance', 'kitchen', 'fridge'],
  },
  {
    id: 'microwave',
    name: 'Microwave',
    nameNL: 'Microgolfoven',
    nameFR: 'Four à micro-ondes',
    category: 'appliances',
    scope: 'both',
    svgPath: '/symbols/appliances/microwave.svg',
    tags: ['appliance', 'kitchen', 'microwave'],
  },
  {
    id: 'heating',
    name: 'Electric heating',
    nameNL: 'Elektrische Verwarming',
    nameFR: 'Chauffage électrique',
    category: 'hvac',
    scope: 'both',
    svgPath: '/symbols/appliances/heating.svg',
    tags: [
      'appliance',
      'heating',
      'electric heating',
      'verwarming',
      'elektrische verwarming',
      'chauffage',
      'chauffage électrique',
      'radiator',
      'accumulation',
      'accumulatieverwarming',
      'convector',
      'kachel',
      'fan',
      'vloerverwarming',
    ],
  },
  {
    id: 'ventilation',
    name: 'Ventilation',
    nameNL: 'Ventilatie',
    nameFR: 'Ventilation',
    category: 'hvac',
    scope: 'both',
    svgPath: '/symbols/appliances/ventilation.svg',
    tags: [
      'appliance',
      'ventilation',
      'ventilator',
      'ventilatie-unit',
      'ventilatie unit',
      'afzuigventilator',
      'dampkap',
      'afzuigkap',
      'mechanische ventilatie',
      'kitchen hood',
      'range hood',
      'extractor hood',
      'ventilation fan',
      'exhaust fan',
      'extractor fan',
      'ventilation unit',
      'hotte',
      'hotte aspirante',
      'hotte de cuisine',
      'ventilateur',
      "extracteur d'air",
      "ventilateur d'extraction",
      'VMC',
      'airco',
      'a/c',
      'ac',
      'air conditioning',
      'airconditioning',
      'airoconditioning',
    ],
  },
  {
    id: 'door_lock',
    name: 'Door Lock',
    nameNL: 'Deurslot',
    nameFR: 'Serrure de porte',
    category: 'appliances',
    scope: 'both',
    svgPath: '/symbols/appliances/door_lock.svg',
    tags: ['appliance', 'door', 'lock'],
  },
  {
    id: 'ev',
    name: 'EV Charger',
    nameNL: 'EV-laadpaal',
    nameFR: 'Borne de recharge véhicule électrique',
    category: 'appliances',
    scope: 'both',
    svgPath: '/symbols/appliances/EV.svg',
    tags: ['appliance', 'EV', 'charger', 'electric vehicle'],
  },
  {
    id: 'motor',
    name: 'Motor',
    nameNL: 'Motor',
    nameFR: 'Moteur',
    category: 'appliances',
    scope: 'both',
    svgPath: '/symbols/appliances/motor.svg',
    tags: ['appliance', 'motor'],
  },
  {
    id: 'fixed_appliance_generic',
    name: 'Device',
    nameNL: 'Toestel',
    nameFR: 'Appareil',
    category: 'appliances',
    scope: 'both',
    svgPath: '/symbols/hvac/furnace_base.svg',
    tags: [
      'appliance',
      'device',
      'toestel',
      'appareil',
      'generic',
      'fixed appliance',
      'vast toestel',
    ],
  },

  // HVAC
  {
    id: 'furnace_heatpump',
    name: 'Heat pump',
    nameNL: 'Warmtepomp',
    nameFR: 'Pompe à chaleur',
    category: 'hvac',
    scope: 'both',
    svgPath: '/symbols/hvac/furnace_heatpump.svg',
    tags: [
      'hvac',
      'heat pump',
      'heating',
      'verwarming',
      'chauffage',
      'cooling',
      'electricity',
      'warmtepomp',
      'pompe à chaleur',
      'airco',
      'a/c',
      'ac',
      'air conditioning',
      'airconditioning',
      'airoconditioning',
    ],
  },
  {
    id: 'furnace_gas',
    name: 'Gas heating',
    nameNL: 'Gasverwarming',
    nameFR: 'Chauffage au gaz',
    category: 'hvac',
    scope: 'both',
    svgPath: '/symbols/hvac/furnace_gas.svg',
    tags: [
      'hvac',
      'gas',
      'boiler',
      'heating',
      'verwarming',
      'chauffage',
      'gasverwarming',
      'chauffage au gaz',
      'gaskachel',
    ],
  },
  {
    id: 'furnace_oil',
    name: 'Oil boiler',
    nameNL: 'Stookolie Ketel',
    nameFR: 'Chaudière au mazout',
    category: 'hvac',
    scope: 'both',
    svgPath: '/symbols/hvac/furnace_oil.svg',
    tags: [
      'hvac',
      'fuel oil',
      'oil',
      'oil boiler',
      'boiler',
      'heating',
      'verwarming',
      'chauffage',
      'mazout',
      'chaudière au mazout',
      'stookolie',
      'stookolie ketel',
    ],
  },
  {
    id: 'furnace_pellets',
    name: 'Pellet heating',
    nameNL: 'Pelletkachel',
    nameFR: 'Poêle à pellets',
    category: 'hvac',
    scope: 'both',
    svgPath: '/symbols/hvac/furnace_pellets.svg',
    tags: [
      'hvac',
      'pellets',
      'solid fuel',
      'heating',
      'verwarming',
      'chauffage',
      'pelletkachel',
      'poêle à pellets',
    ],
  },
  {
    id: 'furnace',
    name: 'HVAC source',
    nameNL: 'HVAC-bron',
    nameFR: 'Source HVAC',
    category: 'hvac',
    scope: 'both',
    svgPath: '/symbols/hvac/furnace_base.svg',
    tags: [
      'appliance',
      'hvac',
      'heating',
      'verwarming',
      'chauffage',
      'cooling',
      'furnace',
      'heat pump',
      'warmtepomp',
      'pompe à chaleur',
      'airco',
      'a/c',
      'ac',
      'air conditioning',
      'airconditioning',
      'airoconditioning',
    ],
  },

  // Sound Devices
  {
    id: 'buzzer',
    name: 'Buzzer',
    nameNL: 'Zoemer',
    nameFR: 'Buzzer',
    category: 'sound',
    scope: 'both',
    svgPath: '/symbols/sound/buzzer.svg',
    tags: ['sound', 'buzzer', 'alarm'],
  },
  {
    id: 'bell',
    name: 'Bell',
    nameNL: 'Bel',
    nameFR: 'Cloche',
    category: 'sound',
    scope: 'both',
    svgPath: '/symbols/sound/bell.svg',
    tags: ['sound', 'bell', 'doorbell'],
  },
  {
    id: 'horn',
    name: 'Horn',
    nameNL: 'Hoorn',
    nameFR: 'Corne',
    category: 'sound',
    scope: 'both',
    svgPath: '/symbols/sound/horn.svg',
    tags: ['sound', 'horn', 'signal'],
  },
  {
    id: 'siren',
    name: 'Siren',
    nameNL: 'Sirene',
    nameFR: 'Sirène',
    category: 'sound',
    scope: 'both',
    svgPath: '/symbols/sound/siren.svg',
    tags: ['sound', 'siren', 'alarm'],
  },

  // Domotica / Smart home
  {
    id: 'domotica',
    name: 'Domotica / Smart home device',
    nameNL: 'Domotica / slimme installatie',
    nameFR: 'Domotique / appareil domotique',
    category: 'domotica',
    scope: 'both',
    svgPath: '/symbols/domotica/domotica.svg',
    tags: [
      'domotica',
      'smarthome',
      'smart home',
      'domotique',
      'slimme installatie',
      'teleruptor',
    ],
  },

  // Metering
  {
    id: 'energy_meter',
    name: 'Energy Meter',
    nameNL: 'Energiemeter',
    nameFR: "Compteur d'énergie",
    category: 'metering',
    scope: 'eendraad',
    svgPath: '/symbols/metering/energy_meter.svg',
    tags: ['meter', 'kWh', 'energy', 'compteur', 'energiemeter'],
  },

  // Energy Conversion
  {
    id: 'transformer',
    name: 'Transformer',
    nameNL: 'Transformator',
    nameFR: 'Transformateur',
    category: 'energyConversion',
    scope: 'both',
    svgPath: '/symbols/energy-conversion/transformer.svg',
    tags: ['transformer', 'AC', 'conversion', 'transformateur'],
    inputDomain: 'AC',
    outputDomain: 'AC',
    portDomains: ['AC', 'AC'],
  },
  {
    id: 'rectifier',
    name: 'Rectifier (AC → DC)',
    nameNL: 'Gelijkrichter (AC → DC)',
    nameFR: 'Redresseur (AC → DC)',
    category: 'energyConversion',
    scope: 'both',
    svgPath: '/symbols/energy-conversion/rectifier.svg',
    tags: ['rectifier', 'AC', 'DC', 'conversion', 'gelijkrichter', 'redresseur'],
    inputDomain: 'AC',
    outputDomain: 'DC',
    portDomains: ['AC', 'DC'],
  },
  {
    id: 'inverter',
    name: 'Inverter (DC → AC)',
    nameNL: 'Omvormer (DC → AC)',
    nameFR: 'Onduleur (DC → AC)',
    category: 'energyConversion',
    scope: 'both',
    svgPath: '/symbols/energy-conversion/inverter.svg',
    tags: ['inverter', 'DC', 'AC', 'conversion', 'omvormer', 'onduleur', 'PV'],
    inputDomain: 'DC',
    outputDomain: 'AC',
    portDomains: ['DC', 'AC'],
  },
  {
    id: 'dc_dc_converter',
    name: 'DC-DC Converter',
    nameNL: 'DC-DC-omzetter',
    nameFR: 'Convertisseur DC-DC',
    category: 'energyConversion',
    scope: 'both',
    svgPath: '/symbols/energy-conversion/dc_dc_converter.svg',
    tags: ['DC', 'converter', 'conversion', 'dc-dc', 'omzetter'],
    inputDomain: 'DC',
    outputDomain: 'DC',
    portDomains: ['DC', 'DC'],
  },
  {
    id: 'solar_panel',
    name: 'Solar panel',
    nameNL: 'Zonnepaneel',
    nameFR: 'Panneau solaire',
    category: 'energyConversion',
    scope: 'both',
    svgPath: '/symbols/energy-conversion/solar_panel.svg',
    tags: ['solar', 'PV', 'DC', 'energy', 'conversion'],
    inputDomain: 'DC',
    outputDomain: 'DC',
  },
  {
    id: 'battery',
    name: 'Battery',
    nameNL: 'Batterij',
    nameFR: 'Batterie',
    category: 'energyConversion',
    scope: 'both',
    svgPath: '/symbols/energy-conversion/battery.svg',
    tags: ['battery', 'storage', 'DC', 'energy', 'conversion'],
    inputDomain: 'DC',
    outputDomain: 'DC',
  },
  {
    id: 'dc_bus',
    name: 'DC busbar',
    nameNL: 'DC-rail',
    nameFR: 'Jeu de barres CC',
    category: 'energyConversion',
    scope: 'eendraad',
    svgPath: '/symbols/energy-conversion/dc_bus.svg',
    tags: ['DC', 'bus', 'busbar', 'rail', 'Lynx', 'distribution'],
    inputDomain: 'DC',
    outputDomain: 'DC',
    portDomains: ['DC', 'DC'],
  },

  // Notes / Labels
  {
    id: 'note',
    name: 'Note / Label',
    nameNL: 'Notitie / Label',
    nameFR: 'Note / Étiquette',
    category: 'notes',
    scope: 'both',
    svgPath: '/symbols/notes/note.svg',
    tags: ['note', 'label', 'text', 'notitie', 'étiquette'],
  },
]

/**
 * Get symbols by category
 */
export function getSymbolsByCategory(category: keyof typeof symbolCategories) {
  return symbols.filter((s) => s.category === category)
}

/** Socket overlay SVG paths (drawn on top of socket symbols when socketProps are set) */
export const SOCKET_OVERLAY_PATHS = {
  switchOverlay: '/symbols/outlets/socket_switchoverlay.svg',
  switchOverlayLock: '/symbols/outlets/socket_switchoverlay_lock.svg',
} as const

/** Switch overlay SVG paths (verklikkerlamp / indicator light) */
export const SWITCH_OVERLAY_PATHS = {
  /** For switch (1p/2p/3p) and switch_1p_pull */
  overlayLight: '/symbols/switches/switch_overlay_light.svg',
  /** For switch_impulse only */
  impulseOverlayLight: '/symbols/switches/switch_impulse_overlay_light.svg',
} as const

/** Relay control overlay SVG paths (drawn on top of relay symbol for control modes) */
export const RELAY_OVERLAY_PATHS = {
  standard: '/symbols/switches/relay_overlay_standard.svg',
  timer: '/symbols/switches/relay_overlay_time.svg',
  clock: '/symbols/switches/relay_overlay_clock.svg',
  impulse: '/symbols/switches/relay_overlay_impulse.svg',
  thermostat: '/symbols/switches/relay_overlay_thermostat.svg',
  dimmer: '/symbols/switches/relay_overlay_dimmer.svg',
} as const

/** Smoke / fire detector overlay SVG paths (drawn on top of smoke_detector_base) */
export const SMOKE_DETECTOR_OVERLAY_PATHS = {
  smoke: '/symbols/switches/smoke_detector_overlay_smoke.svg',
  gas: '/symbols/switches/smoke_detector_overlay_gas.svg',
  manual: '/symbols/switches/smoke_detector_overlay_manual.svg',
  beam: '/symbols/switches/smoke_detector_overlay_beam.svg',
  flame: '/symbols/switches/smoke_detector_overlay_flame.svg',
  heat: '/symbols/switches/smoke_detector_overlay_heat.svg',
} as const

/** Motion detector full-symbol SVG paths (spread is library default) */
export const MOTION_DETECTOR_SVG_PATHS = {
  spread: '/symbols/switches/motion_detector.svg',
  generic: '/symbols/switches/motion_detector_generic.svg',
} as const

/** Light point (regular light) overlay SVG paths */
export const LIGHT_POINT_OVERLAY_PATHS = {
  safety: '/symbols/lighting/light_point_overlay_safety.svg',
  decentral: '/symbols/lighting/light_point_decentral.svg',
  switch1p: '/symbols/lighting/light_point_overlay_switch.svg',
} as const

/** Light spot (projector) beam overlay SVG paths */
export const LIGHT_SPOT_OVERLAY_PATHS = {
  straight: '/symbols/lighting/light_spot_overlay_straight.svg',
  diverging: '/symbols/lighting/light_spot_overlay_diverging.svg',
} as const

/** Transformer overlay SVG paths (drawn on top of transformer symbol when energyConversionProps are set) */
export const TRANSFORMER_OVERLAY_PATHS = {
  safetyClosed: '/symbols/energy-conversion/transformer_overlay_safety_closed.svg',
  safetyOpen: '/symbols/energy-conversion/transformer_overlay_safety_open.svg',
  shortcircuit: '/symbols/energy-conversion/transformer_overlay_shortcircuit.svg',
  protection: '/symbols/energy-conversion/transformer_overlay_protection.svg',
} as const

/** HVAC energy source overlay SVG paths (drawn on bottom of furnace symbol) */
export const HVAC_ENERGY_SOURCE_PATHS = {
  electricity: '/symbols/hvac/furnace_overlay_electricity.svg',
  gas_fan: '/symbols/hvac/furnace_overlay_gas_fan.svg',
  gas_atmospheric: '/symbols/hvac/furnace_overlay_gas_atmospheric.svg',
  liquid: '/symbols/hvac/furnace_overlay_liquid.svg',
  solid: '/symbols/hvac/furnace_overlay_solid.svg',
} as const

/** HVAC type overlay SVG paths (centered on furnace symbol) */
export const HVAC_TYPE_OVERLAY_PATHS = {
  heat_exchange: '/symbols/hvac/furnace_overlay_heatexchange.svg',
  cogeneration: '/symbols/hvac/furnace_overlay_cogeneration.svg',
  tap_spiral: '/symbols/hvac/furnace_overlay_spiral.svg',
  boiler: '/symbols/hvac/furnace_overlay_boiler.svg',
} as const

/** Domotica control overlay SVG paths (used in 1draad and properties UI) */
export const DOMOTICA_CONTROL_OVERLAY_PATHS = {
  programmed_control: '/symbols/domotica/control_programmed.svg',
  wireless_control: '/symbols/domotica/control_wireless.svg',
  detection_control: '/symbols/domotica/control_detection.svg',
  button_control: '/symbols/domotica/control_button.svg',
} as const

/** Boiler variant SVG paths */
export const BOILER_SVG_PATHS = {
  standard: '/symbols/appliances/boiler.svg',
  accumulation: '/symbols/appliances/boiler_accumulation.svg',
} as const

/** Heating variant SVG paths (accumulation heating; with fan when accumulation + withFan) */
export const HEATING_SVG_PATHS = {
  standard: '/symbols/appliances/heating.svg',
  accumulation: '/symbols/appliances/heating_accumulation.svg',
  accumulationFan: '/symbols/appliances/heating_accumulation_fan.svg',
} as const

/** Props used to resolve fixed appliance SVG (boiler, heating variants) */
export interface FixedApplianceSymbolProps {
  accumulating?: boolean
  /** Heating: accumulation heating variant */
  accumulationHeating?: boolean
  /** Heating: with fan (only when accumulationHeating is true) */
  withFan?: boolean
}

/**
 * Resolve SVG path for fixed appliances that have variants (boiler, heating).
 * Returns the path for the given symbol and props, or undefined if the symbol uses its catalog svgPath.
 */
export function getFixedApplianceSymbolPath(
  symbolKey: string,
  props?: FixedApplianceSymbolProps | null
): string | undefined {
  if (symbolKey === 'boiler') {
    return props?.accumulating ? BOILER_SVG_PATHS.accumulation : BOILER_SVG_PATHS.standard
  }
  if (symbolKey === 'heating') {
    if (props?.accumulationHeating) {
      return props?.withFan ? HEATING_SVG_PATHS.accumulationFan : HEATING_SVG_PATHS.accumulation
    }
    return HEATING_SVG_PATHS.standard
  }
  return undefined
}

/** Legacy symbol IDs and variants mapped to catalog ID for getSymbolById (switch_2p_twoway not in catalog, resolves to two-way) */
const LEGACY_SYMBOL_IDS: Record<string, string> = {
  socket_230v: 'socket_gnd_child',
  socket_3phase: 'socket',
  switch_single: 'switch',
  switch_double: 'switch_1p_twoway',
  switch_2p_twoway: 'switch_1p_twoway', // 2-pole two-way is option on two-way, not separate library symbol
}

/**
 * Get symbol by ID (supports legacy socket_230v/socket_3phase/switch_single/switch_double for old projects)
 */
export function getSymbolById(id: string) {
  const resolvedId = LEGACY_SYMBOL_IDS[id] ?? id
  return symbols.find((s) => s.id === resolvedId) ?? null
}

/** True for any HVAC-category appliance symbol (furnace/HVAC source, ventilation, boiler, heating, …). */
export function isHvacDeviceSymbol(symbol: string | undefined): boolean {
  return !!symbol && getSymbolById(symbol)?.category === 'hvac'
}

/** Re-export default domain (single source: schema) */
export const DEFAULT_ELECTRICAL_DOMAIN = DEFAULT_DOMAIN

export type SymbolPortDomains = readonly [ElectricalDomain, ElectricalDomain]

/**
 * Get input and output electrical domain for a symbol. Conversion components use their
 * inputDomain/outputDomain. Untyped symbols use AC for display defaults;
 * connectivity must use resolveSymbolPortsForWire to inherit the actual wire domain.
 */
export function getDomainForSymbol(symbolId: string): {
  inputDomain: ElectricalDomain
  outputDomain: ElectricalDomain
} {
  const meta = getSymbolById(symbolId)
  const portDomains = getPortDomainsForSymbol(symbolId)
  const inputDomain = meta?.inputDomain ?? portDomains[0]
  const outputDomain = meta?.outputDomain ?? portDomains[1]
  return { inputDomain, outputDomain }
}

/** Resolve fixed port metadata, with AC display defaults for untyped symbols. */
export function getPortDomainsForSymbol(symbolId: string): SymbolPortDomains {
  const meta = getSymbolById(symbolId)
  if (meta?.portDomains) return meta.portDomains
  return [
    meta?.inputDomain ?? DEFAULT_ELECTRICAL_DOMAIN,
    meta?.outputDomain ?? DEFAULT_ELECTRICAL_DOMAIN,
  ]
}

/** Untyped symbols inherit their wire domain; only explicit port metadata constrains AC/DC. */
export function symbolInheritsWireDomain(symbolId: string): boolean {
  const meta = getSymbolById(symbolId)
  if (meta?.inheritsWireDomain != null) return meta.inheritsWireDomain
  return !meta?.portDomains && !meta?.inputDomain && !meta?.outputDomain
}

/** Whether a symbol can connect to the requested wire domain. */
export function symbolSupportsWireDomain(symbolId: string, wireDomain: ElectricalDomain): boolean {
  return (
    symbolInheritsWireDomain(symbolId) || getPortDomainsForSymbol(symbolId).includes(wireDomain)
  )
}

/**
 * Untyped symbols preserve the connected wire domain. Otherwise match the
 * wire to one of the symbol's explicit fixed ports by domain.
 * If both ports match, picks the first deterministically.
 */
export function resolveSymbolPortsForWire(
  symbolId: string,
  wireDomain: ElectricalDomain
): {
  matched: boolean
  connectedPortIndex: 0 | 1 | null
  oppositePortDomain: ElectricalDomain | null
  portDomains: SymbolPortDomains
} {
  const portDomains: SymbolPortDomains = symbolInheritsWireDomain(symbolId)
    ? [wireDomain, wireDomain]
    : getPortDomainsForSymbol(symbolId)
  const matching: Array<0 | 1> = []
  if (portDomains[0] === wireDomain) matching.push(0)
  if (portDomains[1] === wireDomain) matching.push(1)
  if (matching.length === 0) {
    return {
      matched: false,
      connectedPortIndex: null,
      oppositePortDomain: null,
      portDomains,
    }
  }
  const connectedPortIndex = matching[0]!
  const oppositePortDomain = portDomains[connectedPortIndex === 0 ? 1 : 0]
  return {
    matched: true,
    connectedPortIndex,
    oppositePortDomain,
    portDomains,
  }
}

/** Props used to resolve switch base SVG and overlay (matches SwitchDeviceProps) */
export interface SwitchSymbolProps {
  poles?: 1 | 2 | 3 | 4
  twoPole?: boolean
  verklikkerlamp?: boolean
  /** Only used when symbol is motion_detector; defaults to spread */
  motionDetectorType?: 'spread' | 'generic'
}

/**
 * Resolve base SVG path and optional overlay path for a switch endpoint.
 * Handles legacy symbol keys (switch_single, switch_double) and pole/twoPole variants.
 */
export function getSwitchSymbolPaths(
  symbolKey: string,
  switchProps?: SwitchSymbolProps | null
): { basePath: string; overlayPath?: string } {
  const sp = switchProps ?? {}
  const poles = sp.poles ?? 1
  const verklikkerlamp = sp.verklikkerlamp ?? false
  const twoPole = sp.twoPole ?? false
  const motionDetectorType = sp.motionDetectorType ?? 'spread'

  // Legacy: treat as new symbol with default props
  const key = LEGACY_SYMBOL_IDS[symbolKey] ?? symbolKey

  let basePath: string
  let overlayPath: string | undefined

  switch (key) {
    case 'switch':
      basePath =
        poles === 2
          ? '/symbols/switches/switch_2p.svg'
          : poles === 4
            ? '/symbols/switches/switch_4p.svg'
            : poles === 3
              ? '/symbols/switches/switch_3p.svg'
              : '/symbols/switches/switch_1p.svg'
      if (verklikkerlamp) overlayPath = SWITCH_OVERLAY_PATHS.overlayLight
      break
    case 'switch_1p_twoway':
      basePath = twoPole
        ? '/symbols/switches/switch_2p_twoway.svg'
        : '/symbols/switches/switch_1p_twoway.svg'
      break
    case 'switch_2p_twoway':
      basePath = '/symbols/switches/switch_2p_twoway.svg'
      break
    case 'switch_dimmer':
      basePath = '/symbols/switches/switch_dimmer.svg'
      break
    case 'switch_1p_changeover':
      basePath = '/symbols/switches/switch_1p_changeover.svg'
      break
    case 'switch_1p_pull':
      basePath = '/symbols/switches/switch_1p_pull.svg'
      if (verklikkerlamp) overlayPath = SWITCH_OVERLAY_PATHS.overlayLight
      break
    case 'contact':
      basePath = '/symbols/switches/contact.svg'
      break
    case 'switch_impulse':
      basePath = '/symbols/switches/switch_impulse.svg'
      if (verklikkerlamp) overlayPath = SWITCH_OVERLAY_PATHS.impulseOverlayLight
      break
    case 'switch_cross':
      basePath = '/symbols/switches/switch_cross.svg'
      break
    case 'motion_detector':
      basePath = MOTION_DETECTOR_SVG_PATHS[motionDetectorType]
      break
    case 'smoke_detector':
      basePath = '/symbols/switches/smoke_detector_base.svg'
      break
    case 'relay':
      basePath = '/symbols/switches/relay.svg'
      break
    default:
      basePath = '/symbols/switches/switch_1p.svg'
  }

  return overlayPath ? { basePath, overlayPath } : { basePath }
}

/**
 * SVG path for compact previews (library icon, Domotica main device, switch type dropdown).
 * For overlay-based symbols (relay, smoke_detector) this is the catalog composite that
 * already includes the default overlay artwork — not the bare base used on canvas.
 */
export function getSwitchDisplaySvgPath(
  symbolKey: string,
  switchProps?: SwitchSymbolProps | null
): string {
  const key = LEGACY_SYMBOL_IDS[symbolKey] ?? symbolKey
  if (key === 'relay' || key === 'smoke_detector') {
    return getSymbolById(key)?.svgPath ?? getSwitchSymbolPaths(key, switchProps).basePath
  }
  return getSwitchSymbolPaths(key, switchProps).basePath
}

/** Symbol keys that support the verklikkerlamp (indicator light) overlay */
export const SWITCH_SYMBOLS_WITH_VERKLIKKERLAMP = [
  'switch',
  'switch_1p_pull',
  'switch_impulse',
] as const

/**
 * Get symbols by scope
 */
export function getSymbolsByScope(scope: 'eendraad' | 'situatieplan' | 'both') {
  return symbols.filter((s) => s.scope === scope || s.scope === 'both')
}
