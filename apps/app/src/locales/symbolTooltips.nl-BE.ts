/**
 * Dutch hover tooltips for the symbol library.
 * Keep each entry to one short sentence that adds meaning beyond the name.
 */
export const symbolTooltipsNlBE = {
  // Grid & Earthing
  mains: 'Voeding van het net.',
  backup_feed: 'backup/noodvoeding.',
  earthing: 'Aardingspunt van installatie.',
  earthing_separator: 'Scheidbaar aardingspunt.',
  panel_distribution: 'Verdeelbord of verdeelkast',
  junction_box: 'Lasdoos of verbindingsdoos.',
  junction_panel: 'Verbindingspaneel, bevat geen beveiligingsmodules.',
  terminal_strip: 'Klemmenstrook of verbindingsklem.',

  // Protection
  mcb: 'Automaat voor overbelasting en kortsluiting.',
  rcd: 'Differentieel voor lekstroom.',
  rcbo: 'Gecombineerde automaat en differentieel.',
  fuse: 'Smeltveiligheid als overstroombeveiliging.',
  spd: 'Beveiliging tegen bliksem of netstoring.',
  rotating_switch: 'Draaischakelaar of lastenscheider.',
  source_changeover: 'Omschakelaar tussen net, backup of andere bronnen.',

  // Outlets
  socket_gnd_child: 'Stopcontact met aarding en kinderbeveiliging.',
  double_socket_gnd_child: 'Dubbel stopcontact met aarding en kinderbeveiliging.',
  modular_socket: 'Stopcontact in het bord, niet op het plan.',
  socket_child: 'Stopcontact met kinderbeveiliging, zonder aarding.',
  double_socket_child: 'Dubbel stopcontact met kinderbeveiliging, zonder aarding.',

  // Switches & controls
  switch: 'Aan/uit-schakelaar.',
  switch_1p_twoway: 'Wisselschakelaar voor bediening op twee plaatsen.',
  switch_cross: 'Kruisschakelaar voor meer dan twee bedienpunten.',
  switch_dimmer: 'Dimmer om verlichting te regelen.',
  switch_1p_changeover: 'Omschakelaar die tussen twee circuits kiest.',
  switch_1p_pull: 'Trekschakelaar, vaak aan het plafond.',
  contact: 'Los contact, bv. een ingangscontact voor domotica.',
  switch_impulse: 'Drukknop of impulsschakelaar voor teleruptor of domotica.',
  motion_detector: 'Bewegingsdetector die schakelt.',
  smoke_detector: 'Rook-, gas-, warmte- of branddetector; kies het type in de eigenschappen.',
  relay: 'Relais voor sturing van een kring.',

  // Lighting
  light_point: 'Algemeen lichtpunt of armatuur.',
  light_spot: 'Spot of gerichte verlichting.',
  light_led: 'LED-armatuur of LED-verlichting.',
  light_fluorescent: 'TL- of fluorescentieverlichting.',

  // Fixed appliances
  stove: 'Elektrisch fornuis of kookplaat.',
  oven: 'Vaste elektrische oven.',
  washer: 'Wasmachine als vast toestel.',
  dryer: 'Droogkast of wasdroger.',
  dishwasher: 'Vaatwasmachine als vast toestel.',
  freezer: 'Vaste diepvriezer.',
  fridge: 'Vaste koelkast.',
  microwave: 'Vaste microgolfoven.',
  door_lock: 'Elektrisch deurslot of toegangscontrole.',
  ev: 'Laadpunt voor een elektrisch voertuig.',
  motor: 'Vaste motor of pomp.',
  fixed_appliance_generic: 'Generiek vast toestel zonder specifiek symbool.',

  // HVAC
  boiler: 'Elektrische boiler voor sanitair warm water.',
  heating: 'Elektrische ruimteverwarming of convector.',
  ventilation: 'Ventilatie-unit of mechanische afvoer.',
  furnace_heatpump: 'Warmtepomp als warmtebron.',
  furnace_gas: 'Gasketel of gasverwarming.',
  furnace_oil: 'Stookolieketel als warmtebron.',
  furnace_pellets: 'Pelletkachel of vaste-brandstofketel.',
  furnace: 'Algemene HVAC-bron; stel zelf samen.',

  // Sound
  buzzer: 'Zoemer voor akoestische signalisatie.',
  bell: 'Bel of deurbel.',
  horn: 'Hoorn of luide akoestische waarschuwing.',
  siren: 'Sirene voor alarm of noodsignaal.',

  // Domotica / metering / conversion / notes
  domotica: 'Domoticamodule of slimme sturing in het schema.',
  energy_meter: 'Energiemeter of kWh-teller.',
  transformer: 'Transformator die spanning omzet.',
  rectifier: 'Gelijkrichter van wissel- naar gelijkspanning.',
  inverter: 'Omvormer van gelijk- naar wisselspanning. Geschikt voor zonnepanelen en batterijen.',
  dc_dc_converter:
    'DC-DC-omzetter, geschikt om rechtstreeks tussen zonnepanelen en batterijen te gebruiken.',
  dc_bus: 'DC-verdeelrail voor aftakkende gelijkstroomkringen.',
  solar_panel: 'PV-string of zonnepaneel op gelijkspanning',
  battery: 'Batterijopslag op gelijkspanning.',
  note: 'Vrije notitie of label op het schema.',
} as const

export type SymbolTooltipId = keyof typeof symbolTooltipsNlBE
