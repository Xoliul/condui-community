import type {
  ProjectAddress,
  ProjectCustomerContact,
  ProjectPartyContact,
  ProtectionDevice,
  ResidualCurrentType,
} from '@/types/schema'
import { generateId } from '@/utils/project'
import type {
  TrikBranchDevice,
  TrikCircuit,
  TrikCircuitTrunkDevice,
  TrikFigure,
  TrikNode,
  TrikPanelBoard,
  TrikPlanNode,
  TrikSatelliteMark,
  TrikVectorLine,
  TrikVectorRect,
} from '@/lib/import/trik/shared'
import {
  parseJaNeeBoolean,
  parseNumber,
  parsePoint,
  parseBooleanJaNee,
  parseSwitchPoles,
  parseTrikFase,
  readElementText,
  TRIK_NOTA_DEFAULT_FONT_SIZE_PX,
} from '@/lib/import/trik/shared'
import {
  getTraversalChildren,
  isDubbeleAansteking,
  isDubbeleWissel,
  mapCombiNodeToDomoticaNode,
  mapTrikElementToNode,
  resolveDubbeleWisselBranchStarts,
} from '@/lib/import/trik/parseNodes'

export function parseSatelliteNotasFromElement(element: Element): Array<{ text: string; offsetX: number; offsetY: number }> {
  const satellites = element.querySelector(':scope > Satellites')
  if (!satellites) return []
  const out: Array<{ text: string; offsetX: number; offsetY: number }> = []
  for (const nota of satellites.querySelectorAll(':scope > Nota')) {
    const text = nota.getAttribute('Tekst')?.trim() ?? ''
    if (!text) continue
    const positionEl = nota.querySelector(':scope > Position')
    const offsetX = parseNumber(positionEl?.getAttribute('X')) ?? 0
    const offsetY = parseNumber(positionEl?.getAttribute('Y')) ?? 0
    out.push({ text, offsetX, offsetY })
  }
  return out
}

export function parseSatelliteMarksFromElement(element: Element): TrikSatelliteMark[] {
  const satellites = element.querySelector(':scope > Satellites')
  if (!satellites) return []
  const out: TrikSatelliteMark[] = []
  for (const mark of satellites.querySelectorAll(':scope > Mark')) {
    const markId = mark.getAttribute('Id')?.trim() ?? ''
    const buddyId = mark.getAttribute('BuddyId')?.trim() ?? ''
    if (!markId || !buddyId) continue
    const isMain = parseJaNeeBoolean(mark.getAttribute('IsMain')) ?? false
    const positionEl = mark.querySelector(':scope > Position')
    const offsetX = parseNumber(positionEl?.getAttribute('X')) ?? 0
    const offsetY = parseNumber(positionEl?.getAttribute('Y')) ?? 0
    out.push({ markId, buddyId, isMain, offsetX, offsetY })
  }
  return out
}

export function attachSatelliteNotasToNode(node: TrikNode, sourceElement: Element): void {
  const satelliteNotas = parseSatelliteNotasFromElement(sourceElement)
  if (satelliteNotas.length > 0) node.satelliteNotas = satelliteNotas
}

export function attachSatelliteMarksToNode(node: TrikNode, sourceElement: Element): void {
  const satelliteMarks = parseSatelliteMarksFromElement(sourceElement)
  if (satelliteMarks.length > 0) node.satelliteMarks = satelliteMarks
}



export function normalizeCountryCode(country: string | undefined): string | undefined {
  if (!country) return undefined
  const normalized = country.trim().toLowerCase()
  if (!normalized) return undefined
  if (normalized === 'belgië' || normalized === 'belgie' || normalized === 'belgium') return 'BE'
  if (normalized === 'nederland' || normalized === 'netherlands') return 'NL'
  if (normalized === 'frankrijk' || normalized === 'france') return 'FR'
  if (normalized === 'duitsland' || normalized === 'germany') return 'DE'
  if (country.length === 2) return country.toUpperCase()
  return country
}

export function parseTrikAddress(addressElement: Element | null | undefined): ProjectAddress | undefined {
  if (!addressElement) return undefined
  const street = readElementText(addressElement, 'Straat') ?? ''
  const number = readElementText(addressElement, 'Nummer')
  const postalCode = readElementText(addressElement, 'Postcode') ?? ''
  const city = readElementText(addressElement, 'Gemeente') ?? ''
  const country = normalizeCountryCode(readElementText(addressElement, 'Land')) ?? ''
  if (!street && !number && !postalCode && !city && !country) return undefined
  return {
    street,
    number,
    postalCode,
    city,
    country,
  }
}

export function parseTrikPartyContact(element: Element | null | undefined): ProjectPartyContact | undefined {
  if (!element) return undefined
  const name = readElementText(element, 'Naam') ?? ''
  const companyNumber = readElementText(element, 'Ondernemingsnummer')
  const email = readElementText(element, 'Email')
  const mobile = readElementText(element, 'Gsm')
  const phone = readElementText(element, 'Telefoon')
  const address = parseTrikAddress(element.querySelector(':scope > Adres'))
  if (!name && !companyNumber && !email && !mobile && !phone && !address) return undefined
  return {
    name,
    companyNumber,
    email,
    mobile,
    phone,
    address,
  }
}

export function parseTrikMetadata(doc: Document): {
  installer?: ProjectPartyContact & { logoDataUrl?: string | null }
  customer?: ProjectCustomerContact
  inspectionAgency?: ProjectPartyContact
  meterEanCode?: string
  installationAddress?: ProjectAddress
} {
  const installerElement = doc.querySelector('Document > Installateur')
  const installer = parseTrikPartyContact(installerElement)
  const installerLogoBase64 = readElementText(installerElement ?? null, 'LogoAsBase64')
  const installerWithLogo = installer
    ? {
      ...installer,
      logoDataUrl: installerLogoBase64 ? `data:image/png;base64,${installerLogoBase64}` : null,
    }
    : undefined

  const customerElement = doc.querySelector('Document > Klant')
  const customerBase = parseTrikPartyContact(customerElement)
  const customerAddress = parseTrikAddress(customerElement?.querySelector(':scope > Adres'))
  const siteAddress = parseTrikAddress(customerElement?.querySelector(':scope > Werfadres'))
  const meterEanCode = customerElement?.getAttribute('EAN')?.trim() || undefined
  const customer = customerBase
    ? {
      ...customerBase,
      meterEanCode,
      address: customerAddress ?? customerBase.address,
      siteAddress,
    }
    : undefined

  const inspectionAgencyElement = doc.querySelector('Document > Controleorganisme')
  const inspectionAgency = parseTrikPartyContact(inspectionAgencyElement)
  const installationAddress = siteAddress ?? customerAddress

  return {
    installer: installerWithLogo,
    customer,
    inspectionAgency,
    meterEanCode,
    installationAddress,
  }
}

export function parseBreakingCapacityKa(value: string | null | undefined): number | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase().replace(',', '.')
  if (!normalized) return undefined
  const numeric = Number(normalized.replace(/[^0-9.+-]/g, ''))
  if (!Number.isFinite(numeric)) return undefined
  if (normalized.includes('ka')) return numeric
  if (normalized.includes('a')) return numeric / 1000
  return numeric >= 100 ? numeric / 1000 : numeric
}

export function parseResidualCurrentType(value: string | null | undefined): ResidualCurrentType | undefined {
  if (!value) return undefined
  const normalized = value.trim().toUpperCase()
  if (normalized.includes('TYPE A') || normalized === 'A') return 'A'
  if (normalized.includes('TYPE AC') || normalized === 'AC') return 'AC'
  if (normalized.includes('TYPE F') || normalized === 'F') return 'F'
  if (normalized.includes('TYPE B') || normalized === 'B') return 'B'
  return undefined
}

export function parsePolesConfig(value: string | null | undefined): ProtectionDevice['polesConfig'] | undefined {
  if (!value) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized.includes('enkel')) return '1P'
  if (normalized.includes('1+')) return '1P+N'
  if (normalized.includes('twee') || normalized.includes('dubbel') || normalized.includes('2')) return '2P'
  if (normalized.includes('drie') || normalized.includes('3')) return '3P'
  if (normalized.includes('vier') || normalized.includes('4')) return '4P'
  return undefined
}

export function polesFromConfig(config: ProtectionDevice['polesConfig'] | undefined): number | undefined {
  if (!config) return undefined
  if (config === '1P') return 1
  if (config === '1P+N' || config === '2P') return 2
  if (config === '3P') return 3
  if (config === '3P+N' || config === '4P') return 4
  return undefined
}

export function isTrikDraaischakelaarType(element: Element): boolean {
  if (element.tagName !== 'AutomatischeSchakelaar') return false
  return (element.getAttribute('Type') ?? '').trim().toLowerCase() === 'draaischakelaar'
}

export function parseTrikBreakerSwitchPoles(element: Element): 1 | 2 | 3 | 4 | undefined {
  const fromSwitchPoles = parseSwitchPoles(element)
  if (fromSwitchPoles) return fromSwitchPoles
  const fromPolesConfig = polesFromConfig(parsePolesConfig(element.getAttribute('AantalPolen')))
  if (fromPolesConfig === 1 || fromPolesConfig === 2 || fromPolesConfig === 3 || fromPolesConfig === 4) {
    return fromPolesConfig
  }
  return undefined
}

export function classifyProtectionType(breaker: Element): ProtectionDevice['type'] {
  if (breaker.tagName === 'Overspanningsbeveiliging') return 'SPD'
  if (isTrikDraaischakelaarType(breaker)) return 'ROTATING_SWITCH'
  if (breaker.tagName === 'Smeltveiligheid') return 'FUSE'
  const hasResidual = parseNumber(breaker.getAttribute('VerliesStroomsterkte')) != null
  const hasOvercurrent = parseNumber(breaker.getAttribute('NominaleStroomsterkte')) != null
  if (hasResidual && hasOvercurrent) return 'RCBO'
  if (hasResidual) return 'RCD'
  return 'MCB'
}

export function isTrikProtectionElement(element: Element): boolean {
  return (
    element.tagName === 'AutomatischeSchakelaar' ||
    element.tagName === 'Smeltveiligheid' ||
    element.tagName === 'Overspanningsbeveiliging'
  )
}



const TRIK_TRANSPARENT_BREAKER_WRAPPERS = new Set(['Verdeelbord', 'Teller'])

/**
 * Immediate protection children under a board/breaker, transparently descending through
 * wrappers TRiK inserts between bus and breakers (nested `Verdeelbord` sub-busbars and
 * `Teller` meters). Load paths (`Leiding`) stay opaque so in-circuit devices are not
 * promoted to nested protections.
 */
export function getNestedTrikBreakerChildren(parent: Element): Element[] {
  const childrenContainer = parent.querySelector(':scope > Children')
  if (!childrenContainer) return []
  const out: Element[] = []
  for (const child of Array.from(childrenContainer.children)) {
    if (isTrikProtectionElement(child)) out.push(child)
    else if (TRIK_TRANSPARENT_BREAKER_WRAPPERS.has(child.tagName)) {
      out.push(...getNestedTrikBreakerChildren(child))
    }
  }
  return out
}

export function isVerdeelbordPanelRoot(board: Element): boolean {
  let ancestor: Element | null = board.parentElement
  while (ancestor) {
    if (ancestor.tagName === 'Verdeelbord') return false
    ancestor = ancestor.parentElement
  }
  return true
}

function collectNonEmptyNotaTexts(elements: Element[]): string[] {
  const texts: string[] = []
  for (const nota of elements) {
    const text = nota.getAttribute('Tekst')?.trim()
    if (text) texts.push(text)
  }
  return texts
}

function findAncestorPanelNotaText(board: Element): string | undefined {
  let ancestor: Element | null = board.parentElement
  while (ancestor) {
    if (ancestor.tagName === 'Nota') {
      const text = ancestor.getAttribute('Tekst')?.trim()
      if (text) return text
    }
    if (ancestor.tagName === 'StartNode' || ancestor.tagName === 'RootNodes') break
    ancestor = ancestor.parentElement
  }
  return undefined
}

function boardHasSupplyTellerAncestor(board: Element): boolean {
  let ancestor: Element | null = board.parentElement
  while (ancestor) {
    if (ancestor.tagName === 'Teller') return true
    if (ancestor.tagName === 'StartNode' || ancestor.tagName === 'RootNodes') break
    ancestor = ancestor.parentElement
  }
  return false
}

function collectOutboundPanelNotasFromLeiding(leiding: Element | null): string[] | undefined {
  if (!leiding) return undefined
  const texts = collectNonEmptyNotaTexts([
    ...Array.from(leiding.querySelectorAll(':scope > Children > Nota')),
    ...Array.from(leiding.querySelectorAll(':scope > Satellites > Nota')),
  ])
  return texts.length > 0 ? texts : undefined
}

function buildTrikCircuitFromBreaker(
  breaker: Element,
  circuitsOut: TrikCircuit[],
): string {
  const breakerId = breaker.getAttribute('Id') ?? generateId()
  const firstLeiding = breaker.querySelector(':scope > Children > Leiding')
  const nodes: TrikNode[] = []
  const trunkDevices: TrikCircuitTrunkDevice[] = []
  const branchDevices: TrikBranchDevice[] = []
  const controls: Array<{ switchId: string; lightId: string }> = []

  if (firstLeiding) {
    const walk = (
      current: Element,
      branchKey: string,
      forceLinearBranch = false,
      activeDomoticaModuleId?: string,
      activeDomoticaOutputRootNodeId?: string,
    ): void => {
      const traversalChildren = getTraversalChildren(current)
      if (traversalChildren.length === 0) return
      const splitHere = !forceLinearBranch && traversalChildren.length > 1
      traversalChildren.forEach((child, index) => {
        const isDirectDomoticaChild = !!activeDomoticaModuleId && current.tagName === 'DomoticaModule'
        const directOutputRootNodeId = isDirectDomoticaChild
          ? (child.getAttribute('Id')?.trim() || activeDomoticaOutputRootNodeId)
          : activeDomoticaOutputRootNodeId
        const structuralKey = splitHere ? `${branchKey}.${index + 1}` : branchKey
        const normalizedStructuralKey = (structuralKey.replace(/^\./, '') || '1')
        if (isDubbeleWissel(child)) {
          const splitBranchStarts = resolveDubbeleWisselBranchStarts(child)
          const baseKey = normalizedStructuralKey
          if (splitBranchStarts.length > 0) {
            splitBranchStarts.forEach((branchStart, branchIndex) => {
              const splitKey = `${baseKey}.${branchIndex + 1}`.replace(/^\./, '')
              const splitNodeId = `${child.getAttribute('Id') ?? generateId()}::split-${branchIndex + 1}`
              const splitNode: TrikNode = {
                id: splitNodeId,
                type: 'switch',
                symbol: 'switch_1p_twoway',
                branchKey: splitKey || '1',
                endpointNote: child.getAttribute('NaamKring')?.trim() || undefined,
                domoticaParentNodeId: activeDomoticaModuleId,
                domoticaDirectChild: isDirectDomoticaChild,
                domoticaOutputRootNodeId: directOutputRootNodeId,
              }
              if (branchIndex === 0) {
                attachSatelliteNotasToNode(splitNode, child)
                attachSatelliteMarksToNode(splitNode, child)
              }
              nodes.push(splitNode)
              walk(branchStart, splitKey || '1', false, activeDomoticaModuleId, activeDomoticaOutputRootNodeId)
            })
            return
          }
        }
        if (isDubbeleAansteking(child)) {
          const branchStarts = resolveDubbeleWisselBranchStarts(child)
          if (branchStarts.length > 0) {
            const linearKey = normalizedStructuralKey
            const mappedNode = mapTrikElementToNode(child)
            if (mappedNode) {
              mappedNode.branchKey = linearKey
              mappedNode.domoticaParentNodeId = activeDomoticaModuleId
              mappedNode.domoticaDirectChild = isDirectDomoticaChild
              mappedNode.domoticaOutputRootNodeId = directOutputRootNodeId
              attachSatelliteNotasToNode(mappedNode, child)
              attachSatelliteMarksToNode(mappedNode, child)
              nodes.push(mappedNode)
            }
            branchStarts.forEach((branchStart) => {
              walk(branchStart, linearKey, true, activeDomoticaModuleId, activeDomoticaOutputRootNodeId)
            })
            return
          }
        }
        if (child.tagName === 'CombiNode') {
          const combiNode = mapCombiNodeToDomoticaNode(child)
          if (combiNode) {
            combiNode.branchKey = normalizedStructuralKey
            combiNode.domoticaParentNodeId = activeDomoticaModuleId
            combiNode.domoticaDirectChild = isDirectDomoticaChild
            combiNode.domoticaOutputRootNodeId = directOutputRootNodeId
            attachSatelliteNotasToNode(combiNode, child)
            attachSatelliteMarksToNode(combiNode, child)
            nodes.push(combiNode)
            return
          }
        }
        // Transformer ahead of further loads (typical: Transformator → Domotica) sits on the
        // circuit trunk, not as a trailing endpoint after the domotica module.
        if (
          child.tagName === 'Transformator' &&
          getTraversalChildren(child).length > 0
        ) {
          trunkDevices.push({
            id: child.getAttribute('Id') ?? generateId(),
            kind: 'transformer',
            label: child.getAttribute('NaamKring')?.trim() || undefined,
          })
          walk(
            child,
            normalizedStructuralKey,
            forceLinearBranch,
            activeDomoticaModuleId,
            directOutputRootNodeId,
          )
          return
        }
        // Mid-branch glass fuses protect downstream loads on the same branch.
        if (child.tagName === 'Smeltveiligheid') {
          branchDevices.push({
            id: child.getAttribute('Id') ?? generateId(),
            branchKey: normalizedStructuralKey,
            symbol: 'fuse',
            ratingA: parseNumber(child.getAttribute('NominaleStroomsterkte')),
            label: child.getAttribute('VasteLetter')?.trim() || child.getAttribute('NaamKring')?.trim() || undefined,
            notes: child.getAttribute('Type')?.trim() || undefined,
          })
          walk(
            child,
            normalizedStructuralKey,
            true,
            activeDomoticaModuleId,
            directOutputRootNodeId,
          )
          return
        }
        const mappedNode = mapTrikElementToNode(child)
        if (mappedNode) {
          mappedNode.branchKey = normalizedStructuralKey
          mappedNode.domoticaParentNodeId = activeDomoticaModuleId
          mappedNode.domoticaDirectChild = isDirectDomoticaChild
          mappedNode.domoticaOutputRootNodeId = directOutputRootNodeId
          attachSatelliteNotasToNode(mappedNode, child)
          attachSatelliteMarksToNode(mappedNode, child)
          nodes.push(mappedNode)
        }
        if (
          child.tagName === 'Schakelaar' ||
          child.tagName === 'Drukknop' ||
          child.tagName === 'Bewegingsdetector' ||
          child.tagName === 'Branddetector'
        ) {
          const childLight = child.querySelector(':scope > Children > Lichtpunt')
          const lightId = childLight?.getAttribute('Id')
          const switchId = child.getAttribute('Id')
          if (lightId && switchId) controls.push({ switchId, lightId })
        }
        const nextDomoticaModuleId =
          child.tagName === 'DomoticaModule' && mappedNode?.type === 'domotica'
            ? (child.getAttribute('Id')?.trim() || mappedNode.id || activeDomoticaModuleId)
            : activeDomoticaModuleId
        const nextDomoticaOutputRootNodeId = directOutputRootNodeId
        // Nested Leiding under a device (switch → leiding → socket + switch/light) is series
        // topology on one branch. Only Leiding-under-Leiding fans out into parallel taps.
        const nextForceLinear =
          forceLinearBranch ||
          (child.tagName === 'Leiding' && current.tagName !== 'Leiding')
        walk(
          child,
          normalizedStructuralKey,
          nextForceLinear,
          nextDomoticaModuleId,
          nextDomoticaOutputRootNodeId,
        )
      })
    }
    walk(firstLeiding, '')
  }

  const protectionType = classifyProtectionType(breaker)
  const parsedPolesConfig = parsePolesConfig(breaker.getAttribute('AantalPolen'))
  const circuitRecord: TrikCircuit = {
    id: breakerId,
    name: breaker.getAttribute('NaamKring') ?? undefined,
    fixedLetter: breaker.getAttribute('VasteLetter') ?? undefined,
    fase: parseTrikFase(breaker.getAttribute('Fase')),
    protectionType,
    ratingA: parseNumber(breaker.getAttribute('NominaleStroomsterkte')),
    breakingCapacityKa: parseBreakingCapacityKa(breaker.getAttribute('Kortsluitstroom')),
    sensitivityMa: parseNumber(breaker.getAttribute('VerliesStroomsterkte')),
    residualCurrentType: parseResidualCurrentType(
      breaker.getAttribute('VerliesstroomschakelaarType'),
    ),
    polesConfig:
      protectionType === 'ROTATING_SWITCH' || protectionType === 'SPD'
        ? parsedPolesConfig
        : (parsedPolesConfig ?? '2P'),
    poles:
      protectionType === 'ROTATING_SWITCH' || protectionType === 'SPD'
        ? polesFromConfig(parsedPolesConfig)
        : polesFromConfig(parsedPolesConfig ?? '2P'),
    curve: breaker.getAttribute('Uitschakelcurve') ?? undefined,
    cableKind: firstLeiding?.getAttribute('GeleiderType') ?? undefined,
    cableSectionMm2: parseNumber(firstLeiding?.getAttribute('GeleiderDoorsnede')),
    cableConductors: parseNumber(firstLeiding?.getAttribute('AantalGeleiders')),
    cableHasPe: parseBooleanJaNee(firstLeiding?.getAttribute('Beschermingsgeleider')),
    inTube: parseBooleanJaNee(firstLeiding?.getAttribute('InBuis')),
    nodes,
    switchControls: controls,
    childCircuitIds: [],
    trunkDevices: trunkDevices.length > 0 ? trunkDevices : undefined,
    branchDevices: branchDevices.length > 0 ? branchDevices : undefined,
    outboundPanelNotas: collectOutboundPanelNotasFromLeiding(firstLeiding),
  }
  circuitsOut.push(circuitRecord)

  const childCircuitIds = getNestedTrikBreakerChildren(breaker).map((child) =>
    buildTrikCircuitFromBreaker(child, circuitsOut),
  )
  circuitRecord.childCircuitIds = childCircuitIds

  return breakerId
}

function buildTrikCircuitRecordOnly(breaker: Element): TrikCircuit {
  const firstLeiding =
    breaker.parentElement?.tagName === 'Children' &&
    breaker.parentElement.parentElement?.tagName === 'Leiding'
      ? breaker.parentElement.parentElement
      : breaker.querySelector(':scope > Children > Leiding')
  // Prefer the leiding that feeds this breaker (parent leiding above a board feeder AS).
  let feedLeiding: Element | null = null
  let cursor: Element | null = breaker.parentElement
  while (cursor) {
    if (cursor.tagName === 'Leiding') {
      feedLeiding = cursor
      break
    }
    if (cursor.tagName === 'StartNode' || cursor.tagName === 'Verdeelbord') break
    cursor = cursor.parentElement
  }
  const leiding = feedLeiding ?? firstLeiding
  const protectionType = classifyProtectionType(breaker)
  const parsedPolesConfig = parsePolesConfig(breaker.getAttribute('AantalPolen'))
  return {
    id: breaker.getAttribute('Id') ?? generateId(),
    name: breaker.getAttribute('NaamKring') ?? undefined,
    fixedLetter: breaker.getAttribute('VasteLetter') ?? undefined,
    fase: parseTrikFase(breaker.getAttribute('Fase')),
    protectionType,
    ratingA: parseNumber(breaker.getAttribute('NominaleStroomsterkte')),
    breakingCapacityKa: parseBreakingCapacityKa(breaker.getAttribute('Kortsluitstroom')),
    sensitivityMa: parseNumber(breaker.getAttribute('VerliesStroomsterkte')),
    residualCurrentType: parseResidualCurrentType(
      breaker.getAttribute('VerliesstroomschakelaarType'),
    ),
    polesConfig:
      protectionType === 'ROTATING_SWITCH' || protectionType === 'SPD'
        ? parsedPolesConfig
        : (parsedPolesConfig ?? '2P'),
    poles:
      protectionType === 'ROTATING_SWITCH' || protectionType === 'SPD'
        ? polesFromConfig(parsedPolesConfig)
        : polesFromConfig(parsedPolesConfig ?? '2P'),
    curve: breaker.getAttribute('Uitschakelcurve') ?? undefined,
    cableKind: leiding?.getAttribute('GeleiderType') ?? undefined,
    cableSectionMm2: parseNumber(leiding?.getAttribute('GeleiderDoorsnede')),
    cableConductors: parseNumber(leiding?.getAttribute('AantalGeleiders')),
    cableHasPe: parseBooleanJaNee(leiding?.getAttribute('Beschermingsgeleider')),
    inTube: parseBooleanJaNee(leiding?.getAttribute('InBuis')),
    nodes: [],
    switchControls: [],
    childCircuitIds: [],
  }
}

function findIncomingFeederAboveBoard(board: Element): TrikCircuit | undefined {
  let ancestor: Element | null = board.parentElement
  while (ancestor) {
    if (isTrikProtectionElement(ancestor)) {
      return buildTrikCircuitRecordOnly(ancestor)
    }
    if (ancestor.tagName === 'StartNode' || ancestor.tagName === 'RootNodes') break
    ancestor = ancestor.parentElement
  }
  return undefined
}

function trikCircuitTrunkFromBreaker(breaker: Element): TrikCircuitTrunkDevice {
  const curveRaw = breaker.getAttribute('Uitschakelcurve')
  const curve = (curveRaw === 'B' || curveRaw === 'C' || curveRaw === 'D' ? curveRaw : undefined) as
    | 'B'
    | 'C'
    | 'D'
    | undefined
  const polesConfig = parsePolesConfig(breaker.getAttribute('AantalPolen')) ?? '2P'
  return {
    id: breaker.getAttribute('Id') ?? generateId(),
    kind: 'protection',
    label: breaker.getAttribute('VasteLetter')?.trim() || breaker.getAttribute('NaamKring')?.trim() || undefined,
    protectionType: classifyProtectionType(breaker),
    ratingA: parseNumber(breaker.getAttribute('NominaleStroomsterkte')),
    sensitivityMa: parseNumber(breaker.getAttribute('VerliesStroomsterkte')),
    residualCurrentType: parseResidualCurrentType(
      breaker.getAttribute('VerliesstroomschakelaarType'),
    ),
    polesConfig,
    poles: polesFromConfig(polesConfig),
    curve,
    breakingCapacityKa: parseBreakingCapacityKa(breaker.getAttribute('Kortsluitstroom')),
  }
}

function collectUnwrappedMeterSupplyDevices(isolator: Element): TrikCircuitTrunkDevice[] {
  const devices: TrikCircuitTrunkDevice[] = [trikCircuitTrunkFromBreaker(isolator)]
  const teller = isolator.querySelector(':scope > Children > Teller')
  if (teller) {
    const polesConfig = parsePolesConfig(teller.getAttribute('AantalPolen'))
    devices.push({
      id: teller.getAttribute('Id') ?? generateId(),
      kind: 'energy_meter',
      label: teller.getAttribute('NaamKring')?.trim() || undefined,
      polesConfig,
      poles: polesFromConfig(polesConfig),
    })
  }
  return devices
}

/**
 * Root breakers for a board. A lone unnamed isolator whose only role is to host
 * `Teller → Verdeelbord → …` is treated as transparent so the real circuits land
 * at panel root (common multipanel TRiK pattern). The isolator/teller become
 * panel-local supply devices instead.
 */
export function getBoardRootBreakers(board: Element): {
  breakers: Element[]
  unwrappedSupplyDevices: TrikCircuitTrunkDevice[]
} {
  const roots = getNestedTrikBreakerChildren(board)
  if (roots.length !== 1) return { breakers: roots, unwrappedSupplyDevices: [] }
  const only = roots[0]!
  const hasDirectLeiding = !!only.querySelector(':scope > Children > Leiding')
  const hasTeller = !!only.querySelector(':scope > Children > Teller')
  if (hasDirectLeiding || !hasTeller) return { breakers: roots, unwrappedSupplyDevices: [] }
  if (only.getAttribute('VasteLetter')?.trim() || only.getAttribute('NaamKring')?.trim()) {
    return { breakers: roots, unwrappedSupplyDevices: [] }
  }
  const nested = getNestedTrikBreakerChildren(only)
  if (nested.length === 0) return { breakers: roots, unwrappedSupplyDevices: [] }
  return {
    breakers: nested,
    unwrappedSupplyDevices: collectUnwrappedMeterSupplyDevices(only),
  }
}

export function collectTrikCircuitsFromBoard(board: Element): TrikCircuit[] {
  const circuits: TrikCircuit[] = []
  for (const breaker of getBoardRootBreakers(board).breakers) {
    buildTrikCircuitFromBreaker(breaker, circuits)
  }
  return circuits
}

export function collectTrikCircuits(doc: Document): TrikCircuit[] {
  return Array.from(doc.querySelectorAll('Verdeelbord'))
    .filter(isVerdeelbordPanelRoot)
    .flatMap((board) => collectTrikCircuitsFromBoard(board))
}

export function collectTrikPanelBoards(doc: Document): TrikPanelBoard[] {
  const rootBoards = Array.from(doc.querySelectorAll('Verdeelbord')).filter(isVerdeelbordPanelRoot)
  return rootBoards.map((board, index) => {
    const vasteLetter = board.getAttribute('VasteLetter')?.trim() || undefined
    const naamKring = board.getAttribute('NaamKring')?.trim() || undefined
    const explicitName = vasteLetter || naamKring || undefined
    const name = explicitName ?? `Panel ${index + 1}`
    const trikBoardId = board.getAttribute('Id')?.trim() || generateId()
    const { breakers, unwrappedSupplyDevices } = getBoardRootBreakers(board)
    const circuits: TrikCircuit[] = []
    for (const breaker of breakers) {
      buildTrikCircuitFromBreaker(breaker, circuits)
    }
    const incomingFeeder = findIncomingFeederAboveBoard(board)
    const localSupplyDevices: TrikCircuitTrunkDevice[] = [...unwrappedSupplyDevices]
    if (incomingFeeder && !boardHasSupplyTellerAncestor(board)) {
      // Subpanel incoming AS (often 40A 30mA) belongs on the child PANEL wire.
      localSupplyDevices.unshift({
        id: incomingFeeder.id,
        kind: 'protection',
        label: incomingFeeder.fixedLetter || incomingFeeder.name,
        protectionType: incomingFeeder.protectionType,
        ratingA: incomingFeeder.ratingA,
        sensitivityMa: incomingFeeder.sensitivityMa,
        residualCurrentType: incomingFeeder.residualCurrentType,
        polesConfig: incomingFeeder.polesConfig,
        poles: incomingFeeder.poles,
        curve:
          incomingFeeder.curve === 'B' || incomingFeeder.curve === 'C' || incomingFeeder.curve === 'D'
            ? incomingFeeder.curve
            : undefined,
        breakingCapacityKa: incomingFeeder.breakingCapacityKa,
      })
    }
    return {
      trikBoardId,
      name,
      explicitName,
      vasteLetter,
      onSupplySpine: boardHasSupplyTellerAncestor(board),
      inboundPanelNota: findAncestorPanelNotaText(board),
      circuits,
      incomingFeeder,
      localSupplyDevices: localSupplyDevices.length > 0 ? localSupplyDevices : undefined,
    }
  })
}



export type TrikPlanNodesByFloor = Map<string, Map<string, TrikPlanNode[]>>

export type TrikGrondplanPageImport = {
  trikPageId?: string
  pageTitle?: string
  pageElement: Element
  planNodes: Map<string, TrikPlanNode[]>
}

export function parseTrikPlanNodes(scope: Element): Map<string, TrikPlanNode[]> {
  const map = new Map<string, TrikPlanNode[]>()
  for (const node of Array.from(scope.querySelectorAll('GrondplanNodes > GrondplanNode'))) {
    const id = node.querySelector(':scope > NodeId')?.textContent?.trim()
    const position = node.querySelector(':scope > Position')
    const rotationText = node.querySelector(':scope > Rotation')?.textContent?.trim()
    const x = parseNumber(position?.getAttribute('X'))
    const y = parseNumber(position?.getAttribute('Y'))
    const rotationRad = parseNumber(rotationText) ?? 0
    if (!id || x == null || y == null) continue
    const list = map.get(id) ?? []
    list.push({ id, x, y, rotationRad })
    map.set(id, list)
  }
  return map
}

export function parseTrikGrondplanPages(doc: Document): TrikGrondplanPageImport[] {
  const pageElements = Array.from(doc.querySelectorAll('Grondplan > Pages > GrondplanPage'))
  if (pageElements.length === 0) {
    return [{
      pageElement: doc.documentElement,
      planNodes: parseTrikPlanNodes(doc.documentElement),
    }]
  }
  return pageElements.map((pageElement) => ({
    trikPageId: pageElement.getAttribute('Id')?.trim() || undefined,
    pageTitle: parseTrikGrondplanPageTitle(pageElement),
    pageElement,
    planNodes: parseTrikPlanNodes(pageElement),
  }))
}

export function parseTrikGrondplanPageTitle(pageElement: Element): string | undefined {
  const raw = (pageElement.getAttribute('Titel') ?? pageElement.getAttribute('Naam') ?? '').trim()
  return raw || undefined
}

export function formatTrikGrondplanFloorName(pageIndex: number): string {
  return `Pagina ${pageIndex + 1}`
}

export function collectTrikSitplanNoteTextsOnPage(
  planNodes: Map<string, TrikPlanNode[]>,
  pendingNotes: PendingTrikSitplanNote[],
): string[] {
  const texts: string[] = []
  const seen = new Set<string>()
  for (const note of pendingNotes) {
    if (!planNodes.has(note.nodeId)) continue
    const text = note.text.trim()
    if (!text) continue
    const key = text.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    texts.push(text)
  }
  return texts
}

/** When a page has exactly one placed sitplan label, treat it as the floor name (e.g. Zolder, Tuin). */
export function inferTrikFloorNameFromSitplanLabels(
  planNodes: Map<string, TrikPlanNode[]>,
  pendingNotes: PendingTrikSitplanNote[],
): string | undefined {
  const texts = collectTrikSitplanNoteTextsOnPage(planNodes, pendingNotes)
  if (texts.length !== 1) return undefined
  return texts[0]
}

export function resolveTrikGrondplanFloorName(
  page: TrikGrondplanPageImport,
  pageIndex: number,
  pendingSitplanNotes: PendingTrikSitplanNote[],
): string {
  if (page.pageTitle) return page.pageTitle
  const fromLabel = inferTrikFloorNameFromSitplanLabels(page.planNodes, pendingSitplanNotes)
  if (fromLabel) return fromLabel
  return formatTrikGrondplanFloorName(pageIndex)
}

export function mergePlanNodeMaps(byFloor: TrikPlanNodesByFloor): Map<string, TrikPlanNode[]> {
  const merged = new Map<string, TrikPlanNode[]>()
  for (const pageMap of byFloor.values()) {
    for (const [id, nodes] of pageMap) {
      merged.set(id, [...(merged.get(id) ?? []), ...nodes])
    }
  }
  return merged
}

export type TrikSupplyInfo = {
  trunkDevices: Array<{
    kind: 'protection' | 'energy_meter'
    label?: string
    protectionType?: ProtectionDevice['type']
    ratingA?: number
    sensitivityMa?: number
    residualCurrentType?: ResidualCurrentType
    polesConfig?: ProtectionDevice['polesConfig']
    poles?: number
    curve?: 'B' | 'C' | 'D'
    breakingCapacityKa?: number
  }>
  protections: Array<{
    label?: string
    protectionType?: ProtectionDevice['type']
    ratingA?: number
    sensitivityMa?: number
    residualCurrentType?: ResidualCurrentType
    polesConfig?: ProtectionDevice['polesConfig']
    poles?: number
    curve?: 'B' | 'C' | 'D'
    breakingCapacityKa?: number
  }>
  cableKind?: string
  cableSectionMm2?: number
  cableConductors?: number
  cableHasPe?: boolean
  cableNotes?: string
}

export function collectSupplyInfo(doc: Document): TrikSupplyInfo {
  const supplyLeiding = doc.querySelector('RootNodes > StartNode > Children > Leiding')
  const trunkDevices: TrikSupplyInfo['trunkDevices'] = []
  const protections: TrikSupplyInfo['protections'] = []
  if (supplyLeiding) {
    let cursor: Element | null = supplyLeiding
    while (cursor) {
      const nextChild: Element | undefined = Array.from(cursor.querySelector(':scope > Children')?.children ?? [])
        .find((child): child is Element => isTrikProtectionElement(child) || child.tagName === 'Teller' || child.tagName === 'Verdeelbord')
      if (!nextChild || nextChild.tagName === 'Verdeelbord') break
      if (isTrikProtectionElement(nextChild)) {
        const nextProtection: Element = nextChild
        const curveRaw = nextProtection.getAttribute('Uitschakelcurve')
        const curve = (curveRaw === 'B' || curveRaw === 'C' || curveRaw === 'D' ? curveRaw : undefined) as
          | 'B'
          | 'C'
          | 'D'
          | undefined
        const protection = {
          label: nextProtection.getAttribute('NaamKring') ?? undefined,
          protectionType: classifyProtectionType(nextProtection),
          ratingA: parseNumber(nextProtection.getAttribute('NominaleStroomsterkte')),
          sensitivityMa: parseNumber(nextProtection.getAttribute('VerliesStroomsterkte')),
          residualCurrentType: parseResidualCurrentType(
            nextProtection.getAttribute('VerliesstroomschakelaarType'),
          ),
          polesConfig: parsePolesConfig(nextProtection.getAttribute('AantalPolen')) ?? '2P',
          poles: polesFromConfig(parsePolesConfig(nextProtection.getAttribute('AantalPolen')) ?? '2P'),
          curve,
          breakingCapacityKa: parseBreakingCapacityKa(nextProtection.getAttribute('Kortsluitstroom')),
        }
        protections.push(protection)
        trunkDevices.push({ kind: 'protection', ...protection })
        cursor = nextProtection
        continue
      }
      if (nextChild.tagName === 'Teller') {
        const polesConfig = parsePolesConfig(nextChild.getAttribute('AantalPolen'))
        trunkDevices.push({
          kind: 'energy_meter',
          label: nextChild.getAttribute('NaamKring') ?? undefined,
          polesConfig,
          poles: polesFromConfig(polesConfig),
        })
        cursor = nextChild
        continue
      }
      break
    }
  }
  return {
    trunkDevices,
    protections,
    cableKind: supplyLeiding?.getAttribute('GeleiderType') ?? undefined,
    cableSectionMm2: parseNumber(supplyLeiding?.getAttribute('GeleiderDoorsnede')),
    cableConductors: parseNumber(supplyLeiding?.getAttribute('AantalGeleiders')),
    cableHasPe: parseBooleanJaNee(supplyLeiding?.getAttribute('Beschermingsgeleider')),
    cableNotes: supplyLeiding?.getAttribute('NaamKring') ?? undefined,
  }
}

export type TrikPlanPanel = {
  id: string
  name?: string
  number?: string
  vasteLetter?: string
}

export type TrikGroundInfo = {
  separatorLabel?: string
  earthLabel?: string
}

export type PendingTrikSitplanNote = {
  nodeId: string
  text: string
  fontSize: number
}

export function collectPlacedPlanPanels(doc: Document): TrikPlanPanel[] {
  const out: TrikPlanPanel[] = []
  for (const panel of Array.from(doc.querySelectorAll('VerdeelbordGrondplan'))) {
    const id = panel.getAttribute('Id')
    if (!id) continue
    out.push({
      id,
      name: panel.getAttribute('NaamKring') ?? undefined,
      number: panel.getAttribute('Nummer') ?? undefined,
      vasteLetter: panel.getAttribute('VasteLetter')?.trim() || undefined,
    })
  }
  return out
}

export function collectGroundInfo(doc: Document): TrikGroundInfo {
  const strip = doc.querySelector('Verdeelbord > Children > Aardingsstrip')
  const earth = strip?.querySelector(':scope > Children > Aarding')
  return {
    separatorLabel: strip?.getAttribute('NaamKring') ?? undefined,
    earthLabel: earth?.getAttribute('NaamKring') ?? undefined,
  }
}



export function parseFigures(scope: Element): TrikFigure[] {
  const out: TrikFigure[] = []
  for (const figure of Array.from(scope.querySelectorAll('GrondplanElementen > Figuur'))) {
    const width = parseNumber(figure.getAttribute('Breedte'))
    const height = parseNumber(figure.getAttribute('Hoogte'))
    const rotationDeg = parseNumber(figure.getAttribute('Hoek')) ?? 0
    const imageAsBase64 = figure.getAttribute('ImageAsBase64')?.trim()
    const center = parsePoint(figure.querySelector(':scope > Center'))
    if (!width || !height || !center || !imageAsBase64) continue
    out.push({ width, height, center, rotationDeg, imageAsBase64 })
  }
  return out
}

export function colorFromTrikInt(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(parsed)) return undefined
  const unsigned = parsed >>> 0
  const a = (unsigned >>> 24) & 0xff
  const r = (unsigned >>> 16) & 0xff
  const g = (unsigned >>> 8) & 0xff
  const b = unsigned & 0xff
  // If alpha is zero, treat as opaque RGB.
  if (a === 0) return `rgb(${r}, ${g}, ${b})`
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`
}

export function parseVectorLines(scope: Element): TrikVectorLine[] {
  const out: TrikVectorLine[] = []
  for (const line of Array.from(scope.querySelectorAll('GrondplanElementen > Lijn'))) {
    const p1 = parsePoint(line.querySelector(':scope > P1'))
    const p2 = parsePoint(line.querySelector(':scope > P2'))
    if (!p1 || !p2) continue
    const strokeWidth = Math.max(1, parseNumber(line.querySelector(':scope > Lijndikte')?.textContent) ?? 1)
    const color = colorFromTrikInt(line.querySelector(':scope > KleurAsInt')?.textContent)
    out.push({ p1, p2, strokeWidth, color })
  }
  return out
}

export function parseVectorRects(scope: Element): TrikVectorRect[] {
  const out: TrikVectorRect[] = []
  for (const rect of Array.from(scope.querySelectorAll('GrondplanElementen > Rechthoek'))) {
    const width = parseNumber(rect.getAttribute('Breedte'))
    const height = parseNumber(rect.getAttribute('Hoogte'))
    const center = parsePoint(rect.querySelector(':scope > Center'))
    if (!width || !height || !center) continue
    const rotationDeg = parseNumber(rect.getAttribute('Hoek')) ?? 0
    const strokeWidth = Math.max(1, parseNumber(rect.querySelector(':scope > Lijndikte')?.textContent) ?? 2)
    const color = colorFromTrikInt(rect.querySelector(':scope > KleurAsInt')?.textContent)
    const fillType = rect.getAttribute('VullingType')?.trim()
    out.push({ width, height, center, rotationDeg, strokeWidth, color, fillType })
  }
  return out
}



export function parseTrikSitplanNotes(doc: Document): PendingTrikSitplanNote[] {
  const notes: PendingTrikSitplanNote[] = []
  for (const note of Array.from(doc.querySelectorAll('RootNodes > StartNode > Children > Nota, Grondplan > Pages > GrondplanPage > Nota'))) {
    const nodeId = note.getAttribute('Id')?.trim() ?? ''
    const text = note.getAttribute('Tekst')?.trim() ?? ''
    if (!nodeId || !text) continue
    const sizeRaw = parseNumber(note.getAttribute('TekstGrootte'))
    const fontSize = sizeRaw != null
      ? Math.max(8, Math.min(36, Math.round(sizeRaw * 3)))
      : TRIK_NOTA_DEFAULT_FONT_SIZE_PX
    notes.push({ nodeId, text, fontSize })
  }
  return notes
}
