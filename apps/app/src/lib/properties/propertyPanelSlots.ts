/** These facts and labels never change cabinet module membership or widths. */
const drawingKeys = new Set([
  'notes', 'labelNotes', 'panelLabel', 'symbolLabelDisplay', 'notesVisible', 'eendraadLetterVisible',
  'ratingA', 'curve', 'sensitivityMa', 'residualCurrentType', 'breakingCapacityKa', 'breakingCapacityOption',
  'label', 'selective', 'superImmunized', 'tripSettings', 'fuseClass',
])
const conversionTextKeys = new Set([
  'transformerPrimaryVoltageV', 'transformerSecondaryVoltageV',
  'transformerRatedPowerKva', 'transformerShortCircuitVoltagePercent',
  'transformerOverlayLabel', 'pMaxPrimaryW', 'pMaxSecondaryW',
  'dcOutputVoltageV', 'dcInputMinVoltageV', 'brand', 'model', 'serialNumber', 'serialNumbers', 'power',
])
const certificationKeys = ['brand', 'model', 'serialNumber', 'serialNumbers', 'synergrid']
const nestedTextKeys: Record<string, ReadonlySet<string>> = {
  conversionProps: conversionTextKeys,
  energyConversionProps: conversionTextKeys,
  batteryProps: new Set([...certificationKeys, 'voltageV', 'capacityKWh', 'powerKw']),
  solarPanelProps: new Set([...certificationKeys, 'wattageW', 'voltageV']),
  dcBusProps: new Set(['ratedCurrentA', 'ratedVoltageV']),
  changeoverProps: new Set(['port1Label', 'port2Label']),
}

/** Inspect the requested partial patch, before nested properties are merged. */
export function propertyPatchPreservesPanelSlots(patch: Record<string, unknown>): boolean {
  return Object.entries(patch).every(([key, value]) => drawingKeys.has(key) || (
    Object.hasOwn(nestedTextKeys, key) &&
    value !== null && typeof value === 'object' &&
    Object.keys(value).every((field) => nestedTextKeys[key]!.has(field))
  ))
}
