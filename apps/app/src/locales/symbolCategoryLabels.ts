import type { SupportedLanguage } from '@/utils/languageRouting'
import { symbolCategories } from '@/lib/symbols'

/**
 * Symbol library category titles — single source for the app library and the AREI symbols page.
 * Keys must match `symbolCategories` in `@/lib/symbols`.
 */
export const symbolCategoryLabels = {
  de: {
    grid: 'Netz & Erdung', protection: 'Schutzgeräte', outlets: 'Steckdosen',
    switches: 'Schalter & Bedienung', lighting: 'Beleuchtung', appliances: 'Fest installierte Geräte',
    hvac: 'HVAC', sound: 'Signalgeräte', domotica: 'Gebäudeautomation / Smart Home',
    metering: 'Messgeräte', energyConversion: 'Energieumwandlung', notes: 'Notizen & Beschriftungen',
  },
  pl: {
    grid: 'Sieć i uziemienie', protection: 'Urządzenia zabezpieczające', outlets: 'Gniazda wtyczkowe',
    switches: 'Łączniki i sterowanie', lighting: 'Oświetlenie', appliances: 'Urządzenia stałe',
    hvac: 'HVAC', sound: 'Sygnalizatory dźwiękowe', domotica: 'Automatyka budynkowa / Smart home',
    metering: 'Urządzenia pomiarowe', energyConversion: 'Przekształcanie energii', notes: 'Notatki i etykiety',
  },
  ro: {
    grid: 'Rețea și împământare', protection: 'Dispozitive de protecție', outlets: 'Prize',
    switches: 'Întrerupătoare și comenzi', lighting: 'Iluminat', appliances: 'Aparate fixe',
    hvac: 'HVAC', sound: 'Dispozitive sonore', domotica: 'Domotică / Instalație inteligentă',
    metering: 'Aparate de măsură', energyConversion: 'Conversia energiei', notes: 'Note și etichete',
  },
  en: {
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
  },
  'nl-BE': {
    grid: 'Net & Aarding',
    protection: 'Beveiligingstoestellen',
    outlets: 'Contactdozen',
    switches: 'Schakelaars & Bediening',
    lighting: 'Verlichting',
    appliances: 'Vaste Toestellen',
    hvac: 'HVAC',
    sound: 'Geluidsapparaten',
    domotica: 'Domotica / Slimme installatie',
    metering: 'Meettoestellen',
    energyConversion: 'Energie-omzetting',
    notes: 'Notities & labels',
  },
  'fr-BE': {
    grid: 'Réseau & Terre',
    protection: 'Dispositifs de Protection',
    outlets: 'Prises de courant',
    switches: 'Interrupteurs & Commandes',
    lighting: 'Éclairage',
    appliances: 'Appareils Fixes',
    hvac: 'CVC',
    sound: 'Dispositifs sonores',
    domotica: 'Domotique / Maison intelligente',
    metering: 'Appareils de mesure',
    energyConversion: "Conversion d'énergie",
    notes: 'Notes et étiquettes',
  },
} as const satisfies Record<
  SupportedLanguage,
  Record<keyof typeof symbolCategories, string>
>

export type SymbolCategoryLabelLang = keyof typeof symbolCategoryLabels

/** Singular, short category nouns for compact UI such as the armed-placement banner. */
export const symbolCategorySingularLabels = {
  de: {
    grid: 'Versorgung', protection: 'Schutz', outlets: 'Steckdose', switches: 'Schalter',
    lighting: 'Lichtpunkt', appliances: 'Gerät', hvac: 'HVAC', sound: 'Signalgerät',
    domotica: 'Gebäudeautomation', metering: 'Zähler', energyConversion: 'Umrichter', notes: 'Notiz',
  },
  pl: {
    grid: 'Zasilanie', protection: 'Zabezpieczenie', outlets: 'Gniazdo', switches: 'Łącznik',
    lighting: 'Punkt świetlny', appliances: 'Urządzenie', hvac: 'HVAC', sound: 'Sygnalizator',
    domotica: 'Automatyka budynkowa', metering: 'Licznik', energyConversion: 'Przekształtnik', notes: 'Notatka',
  },
  ro: {
    grid: 'Alimentare', protection: 'Protecție', outlets: 'Priză', switches: 'Întrerupător',
    lighting: 'Punct de lumină', appliances: 'Aparat', hvac: 'HVAC', sound: 'Dispozitiv sonor',
    domotica: 'Domotică', metering: 'Contor', energyConversion: 'Convertor', notes: 'Notă',
  },
  en: {
    grid: 'Supply',
    protection: 'Protection',
    outlets: 'Outlet',
    switches: 'Switch',
    lighting: 'Light',
    appliances: 'Appliance',
    hvac: 'HVAC',
    sound: 'Sound device',
    domotica: 'Domotica',
    metering: 'Meter',
    energyConversion: 'Converter',
    notes: 'Note',
  },
  'nl-BE': {
    grid: 'Voeding',
    protection: 'Beveiliging',
    outlets: 'Contactdoos',
    switches: 'Schakelaar',
    lighting: 'Lichtpunt',
    appliances: 'Toestel',
    hvac: 'HVAC',
    sound: 'Geluidsapparaat',
    domotica: 'Domotica',
    metering: 'Meter',
    energyConversion: 'Omvormer',
    notes: 'Notitie',
  },
  'fr-BE': {
    grid: 'Alimentation',
    protection: 'Protection',
    outlets: 'Prise',
    switches: 'Interrupteur',
    lighting: 'Luminaire',
    appliances: 'Appareil',
    hvac: 'CVC',
    sound: 'Appareil sonore',
    domotica: 'Domotique',
    metering: 'Compteur',
    energyConversion: 'Convertisseur',
    notes: 'Note',
  },
} as const satisfies Record<SymbolCategoryLabelLang, Record<keyof typeof symbolCategories, string>>
