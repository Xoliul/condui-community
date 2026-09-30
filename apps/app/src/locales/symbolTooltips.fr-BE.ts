/**
 * French hover tooltips for the symbol library.
 * Keep each entry to one short sentence that adds meaning beyond the name.
 */
export const symbolTooltipsFrBE = {
  // Grid & Earthing
  mains: 'Alimentation depuis le réseau.',
  backup_feed: 'Alimentation de secours ou de backup.',
  earthing: "Point de terre de l'installation.",
  earthing_separator: 'Point de terre séparable.',
  panel_distribution: 'Tableau ou coffret de distribution.',
  junction_box: 'Boîte de jonction ou de connexion.',
  junction_panel: 'Panneau de jonction sans modules de protection.',
  terminal_strip: 'Bornier ou borne de connexion.',

  // Protection
  mcb: 'Disjoncteur contre surcharge et court-circuit.',
  rcd: 'Disjoncteur différentiel contre courants de fuite.',
  rcbo: 'Disjoncteur différentiel combiné.',
  fuse: 'Fusible comme protection contre les surintensités.',
  spd: 'Protection contre la foudre ou les surtensions réseau.',
  rotating_switch: 'Commutateur rotatif ou sectionneur de charge.',
  source_changeover: 'Commutateur entre réseau, secours ou autres sources.',

  // Outlets
  socket_gnd_child: 'Prise avec terre et protection enfant.',
  double_socket_gnd_child: 'Double prise avec terre et protection enfant.',
  modular_socket: 'Prise montée dans le tableau, absente du plan.',
  socket_child: 'Prise avec protection enfant, sans terre.',
  double_socket_child: 'Double prise avec protection enfant, sans terre.',

  // Switches & controls
  switch: 'Interrupteur marche/arrêt.',
  switch_1p_twoway: 'Interrupteur va-et-vient pour commande à deux endroits.',
  switch_cross: 'Interrupteur croisé pour plus de deux points de commande.',
  switch_dimmer: "Variateur pour régler l'éclairage.",
  switch_1p_changeover: 'Commutateur entre deux circuits.',
  switch_1p_pull: 'Interrupteur à tirage, souvent au plafond.',
  contact: "Contact libre, p. ex. contact d'entrée pour la domotique.",
  switch_impulse: 'Bouton poussoir ou impulsionnel pour télérupteur ou domotique.',
  motion_detector: 'Détecteur de mouvement qui commande un circuit.',
  smoke_detector:
    'Détecteur de fumée, gaz, chaleur ou incendie ; choisissez le type dans les propriétés.',
  relay: 'Relais pour commander un circuit.',

  // Lighting
  light_point: 'Point lumineux ou luminaire général.',
  light_spot: 'Spot ou éclairage directionnel.',
  light_led: 'Luminaire LED ou éclairage LED.',
  light_fluorescent: 'Éclairage fluorescent ou tube.',

  // Fixed appliances
  stove: 'Cuisinière électrique ou plaque de cuisson.',
  oven: 'Four électrique fixe.',
  washer: 'Lave-linge en appareil fixe.',
  dryer: 'Sèche-linge.',
  dishwasher: 'Lave-vaisselle en appareil fixe.',
  freezer: 'Congélateur fixe.',
  fridge: 'Réfrigérateur fixe.',
  microwave: 'Four à micro-ondes fixe.',
  door_lock: "Serrure électrique ou contrôle d'accès.",
  ev: 'Point de charge pour véhicule électrique.',
  motor: 'Moteur ou pompe fixe.',
  fixed_appliance_generic: 'Appareil fixe générique sans symbole spécifique.',

  // HVAC
  boiler: 'Chauffe-eau électrique pour eau sanitaire.',
  heating: "Chauffage électrique d'ambiance ou convecteur.",
  ventilation: 'Unité de ventilation ou extraction mécanique.',
  furnace_heatpump: 'Pompe à chaleur comme source de chaleur.',
  furnace_gas: 'Chaudière au gaz ou chauffage au gaz.',
  furnace_oil: 'Chaudière au mazout comme source de chaleur.',
  furnace_pellets: 'Poêle à pellets ou chaudière à combustible solide.',
  furnace: 'Source CVC générique ; à configurer.',

  // Sound
  buzzer: 'Buzzer pour signalisation acoustique.',
  bell: 'Cloche ou sonnette.',
  horn: 'Corne ou avertissement acoustique fort.',
  siren: "Sirène pour alarme ou signal d'urgence.",

  // Domotica / metering / conversion / notes
  domotica: 'Module domotique ou commande intelligente dans le schéma.',
  energy_meter: "Compteur d'énergie ou compteur kWh.",
  transformer: 'Transformateur qui convertit la tension.',
  rectifier: 'Redresseur de courant alternatif vers continu.',
  inverter:
    'Onduleur de courant continu vers alternatif. Adapté aux panneaux solaires et batteries.',
  dc_dc_converter:
    'Convertisseur DC-DC, utilisable directement entre panneaux solaires et batteries.',
  dc_bus: 'Jeu de barres CC pour distribuer des circuits en courant continu.',
  solar_panel: 'Chaîne PV ou panneau solaire en courant continu.',
  battery: 'Stockage batterie en courant continu.',
  note: 'Note libre ou étiquette sur le schéma.',
} as const

export type SymbolTooltipId = keyof typeof symbolTooltipsFrBE
