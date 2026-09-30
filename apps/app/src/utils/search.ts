/**
 * Fuzzy search with synonym support for electrical terminology
 * Handles common synonyms and variations in Dutch, French, and English
 */

/**
 * Synonym mappings for electrical terms
 * Maps common terms (including old/non-standard) to their standard equivalents
 */
const synonymMap: Record<string, string[]> = {
  // Dutch synonyms
  'stopcontact': ['contactdoos', 'stopcontact', 'socket', 'outlet'],
  'contactdoos': ['contactdoos', 'stopcontact', 'socket', 'outlet'],
  'beveiliging': ['beveiligingstoestel', 'beveiliging', 'protection', 'dispositif'],
  'beveiligingstoestel': ['beveiligingstoestel', 'beveiliging', 'protection', 'dispositif'],
  'beveiligingsschakelaar': ['beveiligingsschakelaar', 'automaat', 'automatische schakelaar', 'disjoncteur', 'mcb', 'circuit breaker', 'protection switch'],
  'schakelaar': ['schakelaar', 'interrupteur', 'switch'],
  'drukknop': ['drukknop', 'drukknoppen', 'impulsschakelaar', 'impulse switch', 'push button', 'push buttons', 'push switch', 'momentary switch', 'bouton poussoir', 'bouton-poussoir', 'boutons poussoirs'],
  'impulsschakelaar': ['drukknop', 'impulsschakelaar', 'impulse switch', 'push button', 'push switch', 'momentary switch', 'bouton poussoir', 'bouton-poussoir'],
  'drukknoppen': ['drukknop', 'drukknoppen', 'impulsschakelaar', 'impulse switch', 'push button', 'push buttons', 'push switch', 'momentary switch', 'bouton poussoir', 'bouton-poussoir', 'boutons poussoirs'],
  'lichtpunt': ['lichtpunt', 'point lumineux', 'light point', 'lamp'],
  'verdeelbord': ['verdeelbord', 'tableau de distribution', 'distribution board', 'panel', 'hoofdbord', 'subbord', 'zekeringkast', 'kast', 'coffret'],
  'hoofdbord': ['hoofdbord', 'verdeelbord', 'tableau de distribution', 'distribution board', 'panel', 'main panel'],
  'subbord': ['subbord', 'verdeelbord', 'tableau de distribution', 'distribution board', 'panel', 'sub panel'],
  'zekeringkast': ['zekeringkast', 'kast', 'verdeelbord', 'tableau de distribution', 'distribution board', 'panel', 'coffret', 'fuse box'],
  'kast': ['kast', 'zekeringkast', 'verdeelbord', 'tableau de distribution', 'distribution board', 'panel', 'coffret'],
  'vast toestel': ['vast toestel', 'appareil fixe', 'fixed appliance'],
  'differentieelschakelaar': ['differentieelschakelaar', 'disjoncteur différentiel', 'rcd', 'residual current device'],
  'automaat': ['automaat', 'automatische schakelaar', 'beveiligingsschakelaar', 'disjoncteur', 'mcb', 'circuit breaker'],
  'automatische schakelaar': ['automaat', 'automatische schakelaar', 'beveiligingsschakelaar', 'disjoncteur', 'mcb', 'circuit breaker'],
  'differentieelautomaat': ['differentieelautomaat', 'disjoncteur différentiel combiné', 'rcbo'],
  'zekering': ['zekering', 'smeltveiligheid', 'fusible', 'fuse'],
  'smeltveiligheid': ['smeltveiligheid', 'zekering', 'fusible', 'fuse'],
  // Heating / HVAC / appliances (Dutch core terms)
  'verwarming': ['verwarming', 'elektrische verwarming', 'chauffage', 'heating', 'electric heating', 'radiator', 'accumulatieverwarming', 'kachel', 'convector', 'vloerverwarming'],
  'elektrische verwarming': ['elektrische verwarming', 'verwarming', 'electric heating', 'chauffage électrique', 'heating'],
  'accumulatieverwarming': ['accumulatieverwarming', 'verwarming', 'chauffage', 'accumulation heating'],
  'vloerverwarming': ['vloerverwarming', 'verwarming', 'chauffage', 'underfloor heating'],
  'kachel': ['kachel', 'verwarming', 'chauffage', 'stove', 'heater'],
  'radiator': ['radiator', 'verwarming', 'chauffage', 'heating'],
  'boiler': ['boiler', 'elektrische boiler', 'chauffe-eau', 'water heater'],
  'stookolie': ['stookolie', 'stookolie ketel', 'mazout', 'oil boiler', 'fuel oil', 'chaudière au mazout'],
  'stookolie ketel': ['stookolie ketel', 'stookolie', 'oil boiler', 'mazout', 'chaudière au mazout'],
  'fornuis': ['fornuis', 'cuisinière', 'stove', 'kookplaat', 'taque', 'cooker', 'hob'],
  'kookplaat': ['kookplaat', 'fornuis', 'cuisinière', 'stove', 'taque', 'cooker', 'hob'],
  
  // French synonyms
  'prise': ['prise de courant', 'prise', 'contactdoos', 'stopcontact', 'socket', 'outlet'],
  'prise de courant': ['prise de courant', 'prise', 'contactdoos', 'stopcontact', 'socket', 'outlet'],
  'interrupteur': ['interrupteur', 'schakelaar', 'switch'],
  'bouton poussoir': ['bouton poussoir', 'bouton-poussoir', 'drukknop', 'impulsschakelaar', 'impulse switch', 'push button', 'push switch', 'momentary switch'],
  'bouton-poussoir': ['bouton poussoir', 'bouton-poussoir', 'drukknop', 'impulsschakelaar', 'impulse switch', 'push button', 'push switch', 'momentary switch'],
  'boutons poussoirs': ['bouton poussoir', 'bouton-poussoir', 'boutons poussoirs', 'drukknop', 'drukknoppen', 'impulsschakelaar', 'impulse switch', 'push button', 'push buttons', 'push switch', 'momentary switch'],
  'point lumineux': ['point lumineux', 'lichtpunt', 'light point', 'lamp'],
  'tableau de distribution': ['tableau de distribution', 'verdeelbord', 'distribution board', 'panel', 'hoofdbord', 'subbord', 'zekeringkast', 'kast', 'coffret', 'tableau électrique'],
  'tableau électrique': ['tableau électrique', 'tableau de distribution', 'verdeelbord', 'distribution board', 'panel', 'coffret'],
  'coffret': ['coffret', 'tableau de distribution', 'verdeelbord', 'distribution board', 'panel', 'zekeringkast', 'kast', 'tableau électrique'],
  'appareil fixe': ['appareil fixe', 'vast toestel', 'fixed appliance'],
  'dispositif de protection': ['dispositif de protection', 'beveiligingstoestel', 'beveiliging', 'protection'],
  'disjoncteur différentiel': ['disjoncteur différentiel', 'differentieelschakelaar', 'rcd', 'residual current device'],
  'disjoncteur': ['disjoncteur', 'automaat', 'automatische schakelaar', 'beveiligingsschakelaar', 'mcb', 'circuit breaker'],
  'disjoncteur différentiel combiné': ['disjoncteur différentiel combiné', 'differentieelautomaat', 'rcbo'],
  'fusible': ['fusible', 'zekering', 'smeltveiligheid', 'fuse'],
  // Heating / HVAC / appliances (French core terms)
  'chauffage': ['chauffage', 'chauffage électrique', 'verwarming', 'elektrische verwarming', 'heating', 'electric heating', 'radiator', 'convecteur', 'accumulation', 'plancher chauffant'],
  'chauffage électrique': ['chauffage électrique', 'chauffage', 'electric heating', 'elektrische verwarming', 'heating'],
  'convecteur': ['convecteur', 'radiateur', 'chauffage', 'verwarming', 'heater'],
  'plancher chauffant': ['plancher chauffant', 'chauffage', 'verwarming', 'underfloor heating', 'vloerverwarming'],
  'cuisinière': ['cuisinière', 'fornuis', 'stove', 'kookplaat', 'taque', 'cooker', 'hob'],
  'taque': ['taque', 'cuisinière', 'fornuis', 'stove', 'kookplaat', 'cooker', 'hob'],
  'chauffe-eau': ['chauffe-eau', 'boiler', 'water heater', 'chauffe-eau électrique'],
  'mazout': ['mazout', 'chaudière au mazout', 'stookolie', 'stookolie ketel', 'oil boiler', 'fuel oil'],
  'chaudière au mazout': ['chaudière au mazout', 'mazout', 'oil boiler', 'stookolie ketel', 'stookolie'],
  
  // English synonyms
  'socket': ['socket', 'outlet', 'contactdoos', 'stopcontact', 'prise', 'prise de courant'],
  'outlet': ['outlet', 'socket', 'contactdoos', 'stopcontact', 'prise', 'prise de courant'],
  'switch': ['switch', 'schakelaar', 'interrupteur'],
  'push button': ['push button', 'push buttons', 'push switch', 'momentary switch', 'impulse switch', 'impulsschakelaar', 'drukknop', 'bouton poussoir', 'bouton-poussoir'],
  'push buttons': ['push button', 'push buttons', 'push switch', 'momentary switch', 'impulse switch', 'impulsschakelaar', 'drukknop', 'drukknoppen', 'bouton poussoir', 'bouton-poussoir', 'boutons poussoirs'],
  'push switch': ['push button', 'push switch', 'momentary switch', 'impulse switch', 'impulsschakelaar', 'drukknop', 'bouton poussoir', 'bouton-poussoir'],
  'impulse switch': ['push button', 'push switch', 'momentary switch', 'impulse switch', 'impulsschakelaar', 'drukknop', 'bouton poussoir', 'bouton-poussoir'],
  'momentary switch': ['push button', 'push switch', 'momentary switch', 'impulse switch', 'impulsschakelaar', 'drukknop', 'bouton poussoir', 'bouton-poussoir'],
  'light point': ['light point', 'lichtpunt', 'point lumineux', 'lamp'],
  'distribution board': ['distribution board', 'verdeelbord', 'tableau de distribution', 'panel', 'hoofdbord', 'subbord', 'zekeringkast', 'kast', 'coffret', 'tableau électrique', 'fuse box'],
  'panel': ['panel', 'verdeelbord', 'tableau de distribution', 'distribution board', 'hoofdbord', 'subbord', 'zekeringkast', 'kast', 'coffret', 'tableau électrique'],
  'fuse box': ['fuse box', 'zekeringkast', 'kast', 'verdeelbord', 'tableau de distribution', 'distribution board', 'panel', 'coffret'],
  'fixed appliance': ['fixed appliance', 'vast toestel', 'appareil fixe'],
  'protection': ['protection', 'beveiligingstoestel', 'beveiliging', 'dispositif de protection'],
  'protection switch': ['protection switch', 'beveiligingsschakelaar', 'automaat', 'automatische schakelaar', 'disjoncteur', 'mcb', 'circuit breaker'],
  'rcd': ['rcd', 'differentieelschakelaar', 'disjoncteur différentiel', 'residual current device'],
  'mcb': ['mcb', 'automaat', 'automatische schakelaar', 'beveiligingsschakelaar', 'disjoncteur', 'circuit breaker'],
  'rcbo': ['rcbo', 'differentieelautomaat', 'disjoncteur différentiel combiné'],
  'fuse': ['fuse', 'zekering', 'smeltveiligheid', 'fusible'],
  // Heating / HVAC / appliances (English core terms)
  'heating': ['heating', 'electric heating', 'verwarming', 'elektrische verwarming', 'chauffage', 'chauffage électrique', 'radiator', 'heater', 'space heater'],
  'electric heating': ['electric heating', 'heating', 'elektrische verwarming', 'chauffage électrique', 'verwarming'],
  'heater': ['heater', 'heating', 'verwarming', 'chauffage', 'radiator'],
  'oil boiler': ['oil boiler', 'fuel oil', 'stookolie', 'stookolie ketel', 'mazout', 'chaudière au mazout'],
  'fuel oil': ['fuel oil', 'oil boiler', 'stookolie', 'stookolie ketel', 'mazout', 'chaudière au mazout'],
  'underfloor heating': ['underfloor heating', 'vloerverwarming', 'plancher chauffant'],
  'stove': ['stove', 'fornuis', 'cuisinière', 'kookplaat', 'taque', 'cooker', 'hob'],
  'hob': ['hob', 'cooktop', 'stove', 'kookplaat', 'taque', 'fornuis', 'cuisinière'],
  'cooktop': ['cooktop', 'hob', 'stove', 'kookplaat', 'taque', 'fornuis', 'cuisinière'],
  'water heater': ['water heater', 'boiler', 'chauffe-eau', 'electric boiler'],

  // Common transliteration / slang we still want to match
  'shufaas': ['shufaas', 'chauffage', 'heating', 'verwarming'],
}

/**
 * Normalize search query - lowercase and trim
 */
function normalizeQuery(query: string): string {
  return query
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

const normalizedSynonymsByTerm = (() => {
  const index = new Map<string, Set<string>>()

  for (const values of Object.values(synonymMap)) {
    const normalizedValues = values.map(normalizeQuery)
    for (const value of normalizedValues) {
      const synonyms = index.get(value) ?? new Set<string>()
      normalizedValues.forEach((synonym) => synonyms.add(synonym))
      index.set(value, synonyms)
    }
  }

  return index
})()

/**
 * Get all synonyms for a given term
 */
function getSynonyms(term: string): string[] {
  const normalized = normalizeQuery(term)
  const allSynonyms = new Set<string>([normalized, ...(normalizedSynonymsByTerm.get(normalized) ?? [])])
  return Array.from(allSynonyms)
}

/**
 * Expand search query with synonyms
 */
export function expandSearchQuery(query: string): string[] {
  if (!query) return []
  
  const normalized = normalizeQuery(query)
  if (isShortExactQuery(normalized)) return [normalized]
  const words = normalized.split(/\s+/)
  
  // Get synonyms for each word
  const expandedTerms = new Set<string>()
  
  // Add the original query
  expandedTerms.add(normalized)
  
  // Add synonyms for individual words
  words.forEach(word => {
    const synonyms = getSynonyms(word)
    synonyms.forEach(syn => expandedTerms.add(syn))
  })
  
  // Also try to match multi-word terms
  if (words.length > 1) {
    const fullPhrase = words.join(' ')
    const phraseSynonyms = getSynonyms(fullPhrase)
    phraseSynonyms.forEach(syn => expandedTerms.add(syn))
  }
  
  return Array.from(expandedTerms)
}

/**
 * Check if text matches any of the search terms (with synonyms)
 */
export function fuzzyMatch(text: string, query: string): boolean {
  if (!query) return true
  const searchTerms = expandSearchQuery(query)

  return matchesSearchTerms(text, searchTerms, isShortExactQuery(normalizeQuery(query)))
}

function isShortExactQuery(normalizedQuery: string): boolean {
  return normalizedQuery.length > 0 && normalizedQuery.length <= 3 && !normalizedQuery.includes(' ')
}

function matchesSearchTerms(
  text: string,
  searchTerms: readonly string[],
  exactTokensOnly: boolean,
): boolean {
  const normalizedText = normalizeQuery(text)
  const textTokens = normalizedText.split(' ').filter(Boolean)

  return searchTerms.some(term => {
    if (exactTokensOnly) return textTokens.includes(term)
    if (normalizedText.includes(term)) return true
    const queryTokens = term.split(' ').filter(Boolean)
    return queryTokens.length > 0 && queryTokens.every(queryToken =>
      textTokens.some(textToken => fuzzyTokenMatch(textToken, queryToken))
    )
  })
}

function fuzzyTokenMatch(textToken: string, queryToken: string): boolean {
  if (textToken.includes(queryToken)) return true
  if (textToken.length >= 4 && queryToken.includes(textToken)) return true
  const shortestLength = Math.min(textToken.length, queryToken.length)
  if (shortestLength < 5) return false
  const allowedDistance = shortestLength >= 10 ? 2 : 1
  return levenshteinDistance(textToken, queryToken) <= allowedDistance
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + substitutionCost
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]!
}

/**
 * Check if any of the provided texts match the query
 */
export function fuzzyMatchAny(texts: string[], query: string): boolean {
  if (!query) return true
  const searchTerms = expandSearchQuery(query)
  const exactTokensOnly = isShortExactQuery(normalizeQuery(query))
  return texts.some((text) => matchesSearchTerms(text, searchTerms, exactTokensOnly))
}

/**
 * Prepare a reusable matcher when the same query is applied to many records.
 * Query normalization and synonym expansion happen once instead of once per record.
 */
export function createFuzzyMatcher(query: string): (texts: readonly string[]) => boolean {
  if (!query) return () => true
  const searchTerms = expandSearchQuery(query)
  const exactTokensOnly = isShortExactQuery(normalizeQuery(query))
  return (texts) =>
    texts.some((text) => matchesSearchTerms(text, searchTerms, exactTokensOnly))
}

function createLiteralMatcher(query: string): (texts: readonly string[]) => boolean {
  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) return () => true
  const exactTokensOnly = isShortExactQuery(normalizedQuery)

  return (texts) =>
    texts.some((text) => {
      const normalizedText = normalizeQuery(text)
      if (exactTokensOnly) {
        return normalizedText.split(' ').includes(normalizedQuery)
      }
      return normalizedText.includes(normalizedQuery)
    })
}

/**
 * Prefer literal catalog matches and use synonyms/typo tolerance only when there are none.
 * This keeps precise terms relevant without losing fuzzy fallback for misspellings.
 */
export function filterBySearchRelevance<T>(
  items: readonly T[],
  query: string,
  getSearchableTexts: (item: T) => readonly string[],
): T[] {
  if (!query) return Array.from(items)

  const matchesLiteral = createLiteralMatcher(query)
  const literalMatches = items.filter((item) => matchesLiteral(getSearchableTexts(item)))
  if (literalMatches.length > 0) return literalMatches

  const matchesFuzzy = createFuzzyMatcher(query)
  return items.filter((item) => matchesFuzzy(getSearchableTexts(item)))
}
