/**
 * English hover tooltips for the symbol library.
 * Keep each entry to one short sentence that adds meaning beyond the name.
 */
export const symbolTooltipsEn = {
  // Grid & Earthing
  mains: 'Supply from the grid.',
  backup_feed: 'Backup or emergency supply.',
  earthing: 'Earthing point of the installation.',
  earthing_separator: 'Separable earthing point.',
  panel_distribution: 'Distribution board or panel.',
  junction_box: 'Junction or connection box.',
  junction_panel: 'Junction panel; contains no protection modules.',
  terminal_strip: 'Terminal strip or connector clamp.',

  // Protection
  mcb: 'MCB for overload and short-circuit.',
  rcd: 'RCD for earth leakage.',
  rcbo: 'Combined MCB and RCD.',
  fuse: 'Fuse as overcurrent protection.',
  spd: 'Protection against lightning or mains surges.',
  rotating_switch: 'Rotary switch or load disconnector.',
  source_changeover: 'Changeover between grid, backup or other sources.',

  // Outlets
  socket_gnd_child: 'Socket with earth and child protection.',
  double_socket_gnd_child: 'Double socket with earth and child protection.',
  modular_socket: 'Panel-mounted socket, not shown on the plan.',
  socket_child: 'Socket with child protection, without earth.',
  double_socket_child: 'Double socket with child protection, without earth.',

  // Switches & controls
  switch: 'On/off switch.',
  switch_1p_twoway: 'Two-way switch for control from two locations.',
  switch_cross: 'Cross switch for more than two control points.',
  switch_dimmer: 'Dimmer to control lighting.',
  switch_1p_changeover: 'Changeover switch between two circuits.',
  switch_1p_pull: 'Pull switch, often at the ceiling.',
  contact: 'Loose contact, e.g. an input contact for home automation.',
  switch_impulse: 'Push button or impulse switch for teleruptor or smart home.',
  motion_detector: 'Motion detector that switches a circuit.',
  smoke_detector: 'Smoke, gas, heat or fire detector; pick the type in properties.',
  relay: 'Relay to control a circuit.',

  // Lighting
  light_point: 'General light point or luminaire.',
  light_spot: 'Spot or directional lighting.',
  light_led: 'LED luminaire or LED lighting.',
  light_fluorescent: 'Fluorescent or tube lighting.',

  // Fixed appliances
  stove: 'Electric stove or cooktop.',
  oven: 'Fixed electric oven.',
  washer: 'Washing machine as a fixed appliance.',
  dryer: 'Tumble dryer.',
  dishwasher: 'Dishwasher as a fixed appliance.',
  freezer: 'Fixed freezer.',
  fridge: 'Fixed refrigerator.',
  microwave: 'Fixed microwave oven.',
  door_lock: 'Electric door lock or access control.',
  ev: 'Charging point for an electric vehicle.',
  motor: 'Fixed motor or pump.',
  fixed_appliance_generic: 'Generic fixed appliance without a specific symbol.',

  // HVAC
  boiler: 'Electric boiler for domestic hot water.',
  heating: 'Electric space heating or convector.',
  ventilation: 'Ventilation unit or mechanical exhaust.',
  furnace_heatpump: 'Heat pump as a heat source.',
  furnace_gas: 'Gas boiler or gas heating.',
  furnace_oil: 'Oil boiler as a heat source.',
  furnace_pellets: 'Pellet stove or solid-fuel boiler.',
  furnace: 'Generic HVAC source; configure yourself.',

  // Sound
  buzzer: 'Buzzer for acoustic signalling.',
  bell: 'Bell or doorbell.',
  horn: 'Horn or loud acoustic warning.',
  siren: 'Siren for alarm or emergency signal.',

  // Domotica / metering / conversion / notes
  domotica: 'Smart home module or control in the diagram.',
  energy_meter: 'Energy meter or kWh meter.',
  transformer: 'Transformer that changes voltage.',
  rectifier: 'Rectifier from AC to DC.',
  inverter: 'Inverter from DC to AC. Suitable for solar panels and batteries.',
  dc_dc_converter: 'DC-DC converter, suitable for direct use between solar panels and batteries.',
  dc_bus: 'DC distribution busbar for branching DC circuits.',
  solar_panel: 'PV string or solar panel on DC.',
  battery: 'Battery storage on DC.',
  note: 'Free note or label on the diagram.',
} as const

export type SymbolTooltipId = keyof typeof symbolTooltipsEn
