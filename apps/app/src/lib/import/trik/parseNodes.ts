import type {
  DomoticaControlKey,
  Endpoint,
  MotionDetectorType,
  RelayControlMode,
  SmokeDetectorType,
} from '@/types/schema'
import type { TrikNode } from '@/lib/import/trik/shared'
import {
  isTrikDraaischakelaarType,
  parseJaNeeBoolean,
  parseNumber,
  parsePolesConfig,
  parseTrikBreakerSwitchPoles,
  polesFromConfig,
} from '@/lib/import/trik/shared'

export function parseSocketCount(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized.includes('vier') || normalized === '4') return 4
  if (normalized.includes('drie') || normalized === '3') return 3
  if (normalized.includes('twee') || normalized === '2') return 2
  if (normalized.includes('een') || normalized === '1') return 1
  return undefined
}

export function parseEndpointCount(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const numeric = parseNumber(value)
  if (numeric != null && numeric >= 1) return Math.max(1, Math.round(numeric))
  const normalized = value.trim().toLowerCase()
  if (normalized.includes('zes') || normalized === '6') return 6
  if (normalized.includes('vijf') || normalized === '5') return 5
  if (normalized.includes('vier') || normalized === '4') return 4
  if (normalized.includes('drie') || normalized === '3') return 3
  if (normalized.includes('twee') || normalized === '2') return 2
  if (normalized.includes('een') || normalized === '1') return 1
  return undefined
}

export function parseSwitchSymbol(element: Element): Endpoint['symbol'] {
  const rawType = (element.getAttribute('Type') ?? '').trim().toLowerCase()
  const isDimmer = parseJaNeeBoolean(element.getAttribute('Dimmer')) === true
  if (rawType.includes('bewegings')) return 'motion_detector'
  if (isDimmer) return 'switch_dimmer'
  if (rawType.includes('kruis')) return 'switch_cross'
  if (rawType.includes('wissel')) {
    if (rawType.includes('dubbel')) return 'switch_2p_twoway'
    return 'switch_1p_twoway'
  }
  if (rawType.includes('omschakel') || rawType.includes('changeover') || rawType.includes('aansteking')) {
    return 'switch_1p_changeover'
  }
  return 'switch'
}

export function parseSwitchVerklikkerlamp(element: Element): boolean | undefined {
  return parseJaNeeBoolean(element.getAttribute('Verklikkerlamp'))
}

export function parseSwitchPoles(element: Element): 1 | 2 | 3 | 4 | undefined {
  const rawPoles = (element.getAttribute('AantalPolen') ?? '').trim().toLowerCase()
  if (!rawPoles) return undefined
  if (rawPoles.includes('vier') || rawPoles.includes('4')) return 4
  if (rawPoles.includes('drie') || rawPoles.includes('trip')) return 3
  if (rawPoles.includes('dubbel') || rawPoles.includes('2')) return 2
  if (rawPoles.includes('enkel') || rawPoles.includes('1')) return 1
  return undefined
}

export function parseRelayControl(value: string | null | undefined): RelayControlMode {
  const normalized = (value ?? '').trim().toLowerCase()
  if (normalized.includes('impuls')) return 'impulse'
  if (normalized.includes('thermost')) return 'thermostat'
  if (normalized.includes('dimm')) return 'dimmer'
  if (normalized.includes('tijd')) return 'clock'
  if (normalized.includes('minuter')) return 'timer'
  return 'standard'
}

export function parseSmokeDetectorType(value: string | null | undefined): SmokeDetectorType {
  const normalized = (value ?? '').trim().toLowerCase()
  if (!normalized) return 'smoke'
  if (normalized.includes('gas')) return 'gas'
  if (normalized.includes('manueel') || normalized.includes('manual')) return 'manual'
  if (normalized.includes('straal') || normalized.includes('beam')) return 'beam'
  if (normalized.includes('vlam') || normalized.includes('flame')) return 'flame'
  if (normalized.includes('warmte') || normalized.includes('heat')) return 'heat'
  return 'smoke'
}

export function parseMotionDetectorType(value: string | null | undefined): MotionDetectorType {
  const normalized = (value ?? '').trim().toLowerCase()
  if (!normalized) return 'spread'
  if (
    normalized.includes('algemeen') ||
    normalized.includes('general') ||
    normalized.includes('generic')
  ) {
    return 'generic'
  }
  return 'spread'
}

export function parseFluorescentTubeCount(value: string | null | undefined): 1 | 2 | 3 {
  const count = parseEndpointCount(value)
  if (count == null || count <= 1) return 1
  if (count >= 3) return 3
  return 2
}

export function isTrikFluorescentLightType(rawType: string): boolean {
  return rawType === 'tl' || rawType.includes('tl-buis') || rawType.includes('fluorescent')
}

/** TRiK misspells the attribute as NoodverlivhtingType; accept both spellings. */
export function parseTrikEmergencyLightPointProps(element: Element): Endpoint['lightPointProps'] | undefined {
  const raw = (
    element.getAttribute('NoodverlivhtingType') ??
    element.getAttribute('NoodverlichtingType') ??
    ''
  )
    .trim()
    .toLowerCase()
  if (!raw || raw.includes('geen') || raw === 'nee' || raw === 'none') return undefined
  const decentral =
    raw.includes('decentraal') ||
    raw.includes('decentral') ||
    raw.includes('autonoom') ||
    raw.includes('autonomous')
  return { safety: true, decentral }
}

export function mergeTrikLightPointProps(
  onWall: boolean,
  emergency?: Endpoint['lightPointProps'],
): Endpoint['lightPointProps'] | undefined {
  const props: Endpoint['lightPointProps'] = { ...(emergency ?? {}) }
  if (onWall) props.onWall = true
  if (!props.safety && !props.decentral && !props.onWall && !props.switch1p) return undefined
  return props
}

export function parseLightNode(element: Element, branchKey?: string, endpointNote?: string): TrikNode {
  const rawType = (element.getAttribute('Type') ?? '').trim().toLowerCase()
  const onWall = parseJaNeeBoolean(element.getAttribute('Wandverlichting')) === true
  const multiplierCount = parseEndpointCount(element.getAttribute('Aantal'))
  const lightPointProps = mergeTrikLightPointProps(onWall, parseTrikEmergencyLightPointProps(element))
  if (isTrikFluorescentLightType(rawType)) {
    return {
      id: element.getAttribute('Id') ?? '',
      type: 'light_point',
      symbol: 'light_fluorescent',
      branchKey,
      endpointNote,
      lightFluorescentProps: { tubeCount: parseFluorescentTubeCount(element.getAttribute('Aantal')) },
      lightPointProps,
    }
  }
  if (rawType.includes('spot')) {
    return {
      id: element.getAttribute('Id') ?? '',
      type: 'light_point',
      symbol: 'light_spot',
      branchKey,
      endpointNote,
      lightSpotProps: { beamType: 'none' },
      lightPointProps,
      multiplierCount,
    }
  }
  if (rawType.includes('led')) {
    return {
      id: element.getAttribute('Id') ?? '',
      type: 'light_point',
      symbol: 'light_led',
      branchKey,
      endpointNote,
      lightPointProps,
      multiplierCount,
    }
  }
  return {
    id: element.getAttribute('Id') ?? '',
    type: 'light_point',
    symbol: 'light_point',
    branchKey,
    endpointNote,
    lightPointProps,
    multiplierCount,
  }
}

export function parseConversionSymbol(element: Element): Endpoint['symbol'] {
  const inputRaw = (
    element.getAttribute('IngangSymbool') ??
    element.getAttribute('SymboolIngang') ??
    element.getAttribute('InputSymbol') ??
    element.getAttribute('Ingang') ??
    ''
  )
    .trim()
    .toUpperCase()
  const outputRaw = (
    element.getAttribute('UitgangSymbool') ??
    element.getAttribute('SymboolUitgangen') ??
    element.getAttribute('SymboolUitgang') ??
    element.getAttribute('OutputSymbol') ??
    element.getAttribute('Uitgang') ??
    ''
  )
    .trim()
    .toUpperCase()
  const inputIsAc = inputRaw.includes('AC') || inputRaw.includes('~')
  const inputIsDc = inputRaw.includes('DC') || inputRaw.includes('=')
  const outputIsAc = outputRaw.includes('AC') || outputRaw.includes('~')
  const outputIsDc = outputRaw.includes('DC') || outputRaw.includes('=')
  // TRiK <Omvormer> and AC↔DC DomoticaModule blocks are almost always PV/grid inverters (omvormer),
  // even when port labels read AC→DC from the supply side toward the DC branch.
  if ((inputIsAc && outputIsDc) || (inputIsDc && outputIsAc)) return 'inverter'
  if (inputIsAc && outputIsAc) return 'transformer'
  return 'inverter'
}

function readConversionDomain(raw: string | null): 'AC' | 'DC' | undefined {
  const value = (raw ?? '').trim().toUpperCase()
  if (value.includes('AC') || value.includes('~')) return 'AC'
  if (value.includes('DC') || value.includes('=')) return 'DC'
  return undefined
}

/**
 * TRiK draws PV/battery inverters as a DomoticaModule whose input and output symbols differ
 * (AC → DC). A module with only an input symbol, or AC on both sides, is a real controller
 * such as a PLC and its expansion modules.
 */
export function isTrikDomoticaModuleConverter(element: Element): boolean {
  const input = readConversionDomain(
    element.getAttribute('IngangSymbool') ??
      element.getAttribute('SymboolIngang') ??
      element.getAttribute('InputSymbol') ??
      element.getAttribute('Ingang')
  )
  const output = readConversionDomain(
    element.getAttribute('UitgangSymbool') ??
      element.getAttribute('SymboolUitgangen') ??
      element.getAttribute('SymboolUitgang') ??
      element.getAttribute('OutputSymbol') ??
      element.getAttribute('Uitgang')
  )
  return !!input && !!output && input !== output
}

export function parseSolarPanelProps(element: Element): Endpoint['solarPanelProps'] | undefined {
  const wattageW =
    parseNumber(element.getAttribute('VermogenW')) ??
    parseNumber(element.getAttribute('VermogenWp')) ??
    parseNumber(element.getAttribute('Vermogen')) ??
    parseNumber(element.getAttribute('Wattage'))
  const voltageV =
    parseNumber(element.getAttribute('SpanningV')) ??
    parseNumber(element.getAttribute('Spanning')) ??
    parseNumber(element.getAttribute('Voltage'))
  if (wattageW == null && voltageV == null) return undefined
  return { wattageW, voltageV }
}

export function parseBatteryProps(element: Element): Endpoint['batteryProps'] | undefined {
  const voltageV =
    parseNumber(element.getAttribute('SpanningV')) ??
    parseNumber(element.getAttribute('Spanning')) ??
    parseNumber(element.getAttribute('Voltage'))
  const capacityKWh =
    parseNumber(element.getAttribute('CapaciteitKWh')) ??
    parseNumber(element.getAttribute('Capaciteit')) ??
    parseNumber(element.getAttribute('CapacityKWh'))
  if (voltageV == null && capacityKWh == null) return undefined
  return { voltageV, capacityKWh }
}

export function parseKetelEnergySource(value: string | null | undefined): NonNullable<Endpoint['hvacProps']>['energySource'] {
  const v = (value ?? '').toLowerCase()
  if (v.includes('elektr')) return 'electricity'
  if (v.includes('gasventilator')) return 'gas_fan'
  if (v.includes('gas')) return 'gas_atmospheric'
  if (v.includes('vloei')) return 'liquid'
  if (v.includes('vaste')) return 'solid'
  return 'none'
}

export function parseKetelType(value: string | null | undefined): NonNullable<Endpoint['hvacProps']>['hvacType'] {
  const v = (value ?? '').toLowerCase()
  if (v.includes('warmtewisselaar')) return 'heat_exchange'
  if (v.includes('wkk') || v.includes('cogener')) return 'cogeneration'
  if (v.includes('tapspiraal')) return 'tap_spiral'
  if (v.includes('ketel') || v.includes('boiler')) return 'boiler'
  return 'none'
}

export function parseKetelFunction(value: string | null | undefined): NonNullable<Endpoint['hvacProps']>['hvacFunction'] {
  const v = (value ?? '').toLowerCase()
  if (v.includes('verwarmendkoelend')) return 'heat_cool'
  if (v.includes('verwarm')) return 'heat'
  if (v.includes('koelend')) return 'cool'
  return 'none'
}

export function combineEndpointNotes(primary: string | undefined, extra: string | undefined): string | undefined {
  const a = primary?.trim()
  const b = extra?.trim()
  if (a && b) return `${a}\n${b}`
  return a || b || undefined
}

/** TRiK device placement address → endpoint notes as `address <exact Adres text>`. */
export function buildAddressNote(element: Element): string | undefined {
  const adres = element.getAttribute('Adres')?.trim()
  if (!adres) return undefined
  return `address ${adres}`
}

export function withEndpointDeviceNotes(element: Element, primary?: string): string | undefined {
  return combineEndpointNotes(primary, buildAddressNote(element))
}

export function buildConvertedFromNote(element: Element): string {
  const tag = element.tagName
  const type = element.getAttribute('Type')?.trim()
  if (type) return `[converted-from: ${tag} (${type})]`
  return `[converted-from: ${tag}]`
}

export function appendConvertedFromNote(baseNote: string | undefined, element: Element): string {
  return combineEndpointNotes(baseNote, buildConvertedFromNote(element)) as string
}

export function mapCombiNodeToDomoticaNode(element: Element): TrikNode | null {
  const cells = Array.from(element.querySelectorAll(':scope > Cells > CombiNodeCell > Nodes > *'))
  if (cells.length === 0) return null
  const domoticaControl = cells.find((child) => child.tagName === 'DomoticaSturing')
  if (!domoticaControl) return null
  const id = domoticaControl.getAttribute('Id') ?? element.getAttribute('Id') ?? ''
  if (!id) return null
  const controls: DomoticaControlKey[] = []
  if (parseJaNeeBoolean(domoticaControl.getAttribute('Drukknop'))) controls.push('button_control')
  if (parseJaNeeBoolean(domoticaControl.getAttribute('Draadloos'))) controls.push('wireless_control')
  if (parseJaNeeBoolean(domoticaControl.getAttribute('Geprogrammeerd'))) controls.push('programmed_control')
  if (parseJaNeeBoolean(domoticaControl.getAttribute('Detectie'))) controls.push('detection_control')
  const mainSwitch = cells.find((child) => child.tagName === 'Schakelaar' || child.tagName === 'Drukknop')
  const switchSymbol: Endpoint['symbol'] =
    mainSwitch?.tagName === 'Drukknop' ? 'switch_impulse' : 'switch'
  return {
    id,
    type: 'domotica',
    symbol: 'domotica',
    endpointNote: withEndpointDeviceNotes(
      domoticaControl,
      domoticaControl.getAttribute('NaamKring')?.trim() || undefined,
    ),
    domoticaControl: controls,
    domoticaMainDeviceType: mainSwitch ? 'switch' : 'none',
    domoticaMainSwitchSymbol: mainSwitch ? switchSymbol : undefined,
    switchVerklikkerlamp: mainSwitch?.tagName === 'Schakelaar'
      ? parseJaNeeBoolean(mainSwitch.getAttribute('Verklikkerlamp'))
      : undefined,
  }
}

export function getTraversalChildren(current: Element): Element[] {
  const out: Element[] = []
  const childrenContainer = current.querySelector(':scope > Children')
  if (childrenContainer) out.push(...Array.from(childrenContainer.children))
  for (const nodes of Array.from(current.querySelectorAll(':scope > Cells > CombiNodeCell > Nodes'))) {
    out.push(...Array.from(nodes.children))
  }
  return out
}

export function isDubbeleWissel(element: Element): boolean {
  if (element.tagName !== 'Schakelaar') return false
  const rawType = (element.getAttribute('Type') ?? '').trim().toLowerCase()
  return rawType.includes('dubbelewissel')
}

export function resolveDubbeleWisselBranchStarts(element: Element): Element[] {
  let cursor: Element = element
  for (let depth = 0; depth < 8; depth += 1) {
    const children = getTraversalChildren(cursor)
    if (children.length === 0) return []
    if (children.length > 1) return children
    const only = children[0]
    if (!only) return []
    cursor = only
  }
  return []
}

export function isDubbeleAansteking(element: Element): boolean {
  if (element.tagName !== 'Schakelaar') return false
  const rawType = (element.getAttribute('Type') ?? '').trim().toLowerCase()
  return rawType.includes('dubbeleaansteking')
}

/** TRiK Contactdoos: Kinderbescherming and Beschermingsgeleider default to Ja when omitted. */
export function parseTrikSocketSymbol(element: Element): Endpoint['symbol'] {
  const hasPe = parseJaNeeBoolean(element.getAttribute('Beschermingsgeleider')) ?? true
  const hasChildProtection = parseJaNeeBoolean(element.getAttribute('Kinderbescherming')) ?? true
  if (hasPe && hasChildProtection) return 'socket_gnd_child'
  if (hasPe) return 'socket_gnd'
  if (hasChildProtection) return 'socket_child'
  return 'socket'
}

export function mapTrikElementToNode(element: Element): TrikNode | null {
  const id = element.getAttribute('Id') ?? ''
  if (!id) return null
  const tag = element.tagName
  const sourceCircuitName = element.getAttribute('NaamKring')?.trim() || undefined
  // Branch identity comes from walk structure only — never from NaamKring notes.
  const branchKey = undefined
  const endpointNote = withEndpointDeviceNotes(element, sourceCircuitName)
  if (tag === 'Contactdoos') {
    return {
      id,
      type: 'socket',
      symbol: parseTrikSocketSymbol(element),
      branchKey,
      endpointNote,
      socketCount: parseSocketCount(element.getAttribute('Aantal')),
      socketWaterproof: parseJaNeeBoolean(element.getAttribute('HalfWaterdicht')),
    }
  }
  if (tag === 'Schakelaar') {
    const symbol = parseSwitchSymbol(element)
    const switchVerklikkerlamp = parseSwitchVerklikkerlamp(element)
    return {
      id,
      type: 'switch',
      symbol,
      branchKey,
      endpointNote,
      switchVerklikkerlamp,
      switchPoles: symbol === 'switch' ? parseSwitchPoles(element) : undefined,
    }
  }
  if (tag === 'Drukknop') {
    const symbol = parseJaNeeBoolean(element.getAttribute('Dimmer')) ? 'switch_dimmer' : 'switch_impulse'
    return {
      id,
      type: 'switch',
      symbol,
      branchKey,
      endpointNote,
      switchVerklikkerlamp: parseSwitchVerklikkerlamp(element),
    }
  }
  if (tag === 'Bewegingsdetector') {
    return {
      id,
      type: 'switch',
      symbol: 'motion_detector',
      branchKey,
      endpointNote,
      motionDetectorProps: { type: parseMotionDetectorType(element.getAttribute('Type')) },
    }
  }
  if (tag === 'Branddetector') {
    return {
      id,
      type: 'switch',
      symbol: 'smoke_detector',
      branchKey,
      endpointNote,
      smokeDetectorProps: { type: parseSmokeDetectorType(element.getAttribute('Type')) },
    }
  }
  if (tag === 'Lichtpunt') {
    const mapped = parseLightNode(element, branchKey, endpointNote)
    if (!mapped.id) return null
    return mapped
  }
  if (tag === 'Transformator') {
    return {
      id,
      type: 'fixed_appliance',
      symbol: 'transformer',
      branchKey,
      endpointNote,
    }
  }
  if (tag === 'Omvormer') {
    return {
      id,
      type: 'fixed_appliance',
      symbol: parseConversionSymbol(element),
      branchKey,
      endpointNote,
    }
  }
  if (tag === 'Zonnepaneel') {
    return {
      id,
      type: 'fixed_appliance',
      symbol: 'solar_panel',
      branchKey,
      endpointNote,
      solarPanelProps: parseSolarPanelProps(element),
      multiplierCount: parseEndpointCount(element.getAttribute('Aantal')),
    }
  }
  if (tag === 'Batterij') {
    return {
      id,
      type: 'fixed_appliance',
      symbol: 'battery',
      branchKey,
      endpointNote,
      batteryProps: parseBatteryProps(element),
      multiplierCount: parseEndpointCount(element.getAttribute('Aantal')),
    }
  }
  if (tag === 'Teller') {
    const polesConfig = parsePolesConfig(element.getAttribute('AantalPolen'))
    return {
      id,
      type: 'fixed_appliance',
      symbol: 'energy_meter',
      branchKey,
      endpointNote,
      energyMeterProps: {
        polesConfig,
        poles: polesFromConfig(polesConfig),
      },
    }
  }
  if (tag === 'Relais') {
    return {
      id,
      type: 'switch',
      symbol: 'relay',
      branchKey,
      endpointNote,
      relayProps: { control: parseRelayControl(element.getAttribute('Type')) },
    }
  }
  if (tag === 'DomoticaModule') {
    // TRiK models PV inverters and other AC↔DC blocks as DomoticaModule with SymboolIngang/Uitgangen,
    // not only as <Omvormer>. Same mapping as Omvormer — no converted-from note.
    if (isTrikDomoticaModuleConverter(element)) {
      return {
        id,
        type: 'fixed_appliance',
        symbol: parseConversionSymbol(element),
        branchKey,
        endpointNote,
      }
    }
    const moduleName = element.getAttribute('NaamModule')?.trim()
    return {
      id,
      type: 'domotica',
      symbol: 'domotica',
      branchKey,
      endpointNote: combineEndpointNotes(moduleName, endpointNote),
    }
  }
  if (tag === 'DomoticaSturing') {
    const controls: DomoticaControlKey[] = []
    if (parseJaNeeBoolean(element.getAttribute('Drukknop'))) controls.push('button_control')
    if (parseJaNeeBoolean(element.getAttribute('Draadloos'))) controls.push('wireless_control')
    if (parseJaNeeBoolean(element.getAttribute('Geprogrammeerd'))) controls.push('programmed_control')
    if (parseJaNeeBoolean(element.getAttribute('Detectie'))) controls.push('detection_control')
    return {
      id,
      type: 'domotica',
      symbol: 'domotica',
      branchKey,
      endpointNote,
      domoticaControl: controls,
    }
  }
  if (tag === 'Ketel') {
    return {
      id,
      type: 'fixed_appliance',
      symbol: 'furnace',
      branchKey,
      endpointNote,
      hvacProps: {
        energySource: parseKetelEnergySource(element.getAttribute('Energiebron')),
        hvacType: parseKetelType(element.getAttribute('Type')),
        hvacFunction: parseKetelFunction(element.getAttribute('WarmteFunctie')),
      },
    }
  }
  if (tag === 'Boiler') {
    return {
      id,
      type: 'fixed_appliance',
      symbol: 'boiler',
      branchKey,
      endpointNote,
    }
  }
  if (tag === 'Aftakkast') {
    return {
      id,
      type: 'fixed_appliance',
      symbol: 'junction_box',
      branchKey,
      endpointNote,
    }
  }
  if (tag === 'Verwarmingstoestel') {
    const accumulation = parseJaNeeBoolean(element.getAttribute('Accumulatie')) ?? false
    const withFan = parseJaNeeBoolean(element.getAttribute('Ventilator')) ?? false
    return {
      id,
      type: 'fixed_appliance',
      symbol: 'heating',
      branchKey,
      endpointNote,
      fixedApplianceProps: {
        accumulationHeating: accumulation,
        withFan: accumulation && withFan,
      },
    }
  }
  if (tag === 'Slot') return { id, type: 'fixed_appliance', symbol: 'door_lock', branchKey, endpointNote }
  if (tag === 'Geluidsbron') {
    const type = element.getAttribute('Type')?.toLowerCase() ?? ''
    if (type.includes('hoorn')) return { id, type: 'fixed_appliance', symbol: 'horn', branchKey, endpointNote }
    return { id, type: 'fixed_appliance', symbol: 'buzzer', branchKey, endpointNote }
  }
  if (tag === 'Toestel') {
    const type = (element.getAttribute('Type') ?? '').toLowerCase()
    if (type.includes('laadpuntauto') || type.includes('laadpaal') || type.includes('ev')) {
      return { id, type: 'fixed_appliance', symbol: 'ev', branchKey, endpointNote }
    }
    if (type.includes('ventilator')) return { id, type: 'fixed_appliance', symbol: 'ventilation', branchKey, endpointNote }
    if (type.includes('stoomoven') || type.includes('elektrischeoven')) {
      return { id, type: 'fixed_appliance', symbol: 'oven', branchKey, endpointNote }
    }
    if (type.includes('kookfornuis')) return { id, type: 'fixed_appliance', symbol: 'stove', branchKey, endpointNote }
    if (type.includes('microgolf')) return { id, type: 'fixed_appliance', symbol: 'microwave', branchKey, endpointNote }
    if (type.includes('diepvriezer')) return { id, type: 'fixed_appliance', symbol: 'freezer', branchKey, endpointNote }
    if (type.includes('koelkast')) return { id, type: 'fixed_appliance', symbol: 'fridge', branchKey, endpointNote }
    if (type.includes('vaatwasmachine')) return { id, type: 'fixed_appliance', symbol: 'dishwasher', branchKey, endpointNote }
    if (type.includes('droogkast')) return { id, type: 'fixed_appliance', symbol: 'dryer', branchKey, endpointNote }
    if (type.includes('wasmachine')) return { id, type: 'fixed_appliance', symbol: 'washer', branchKey, endpointNote }
    return {
      id,
      type: 'fixed_appliance',
      symbol: 'fixed_appliance_generic',
      branchKey,
      endpointNote,
    }
  }
  if (tag === 'Motor') return { id, type: 'fixed_appliance', symbol: 'motor', branchKey, endpointNote }
  if (tag === 'Pomp' || tag === 'Ventiel') {
    return {
      id,
      type: 'fixed_appliance',
      symbol: 'motor',
      branchKey,
      endpointNote,
    }
  }
  if (tag === 'ToestelKlein') {
    const tekst = element.getAttribute('Tekst')?.trim()
    return {
      id,
      type: 'fixed_appliance',
      symbol: 'fixed_appliance_generic',
      branchKey,
      endpointNote: withEndpointDeviceNotes(element, tekst || sourceCircuitName),
    }
  }
  if (tag === 'Kiezer' || tag === 'Camera') {
    return {
      id,
      type: 'fixed_appliance',
      symbol: 'fixed_appliance_generic',
      branchKey,
      endpointNote: appendConvertedFromNote(endpointNote, element),
    }
  }
  // In-circuit draaischakelaars act as regular switches, not panel rotating switches.
  if (tag === 'AutomatischeSchakelaar' && isTrikDraaischakelaarType(element)) {
    return {
      id,
      type: 'switch',
      symbol: 'switch',
      branchKey,
      endpointNote: appendConvertedFromNote(endpointNote, element),
      switchPoles: parseTrikBreakerSwitchPoles(element) ?? 1,
    }
  }
  // A loose (potential-free) contact, e.g. a domotics input, is an AutomatischeSchakelaar with Type="Contact".
  if (tag === 'AutomatischeSchakelaar' && (element.getAttribute('Type') ?? '').trim().toLowerCase() === 'contact') {
    return {
      id,
      type: 'switch',
      symbol: 'contact',
      branchKey,
      endpointNote,
    }
  }
  // Twilight / photocell switches appear as AutomatischeSchakelaar with a Type hint.
  if (tag === 'AutomatischeSchakelaar') {
    const type = (element.getAttribute('Type') ?? '').toLowerCase()
    if (type.includes('schemer')) {
      return {
        id,
        type: 'switch',
        symbol: 'switch',
        branchKey,
        endpointNote,
        switchPoles: parseTrikBreakerSwitchPoles(element) ?? 1,
      }
    }
  }
  // Smeltveiligheid is handled as a branch device during walk, not as an endpoint.
  if (tag === 'Smeltveiligheid') return null
  // A Nota inside a device's Children is a text label on that device, attached during walk.
  if (tag === 'Nota') return null
  // Fallback: import unknown endpoint-like nodes as static appliances.
  if (tag !== 'Leiding' && tag !== 'AutomatischeSchakelaar' && tag !== 'CombiNode' && tag !== 'Verdeelbord') {
    return {
      id,
      type: 'fixed_appliance',
      symbol: 'fixed_appliance_generic',
      branchKey,
      endpointNote: appendConvertedFromNote(endpointNote, element),
    }
  }
  return null
}

/**
 * Returns the immediate `AutomatischeSchakelaar` children of a `Verdeelbord` or
 * `AutomatischeSchakelaar`, transparently descending through any `Verdeelbord` wrappers
 * (TRiK uses nested `Verdeelbord` elements to model sub-busbars without a separating breaker).
 */
